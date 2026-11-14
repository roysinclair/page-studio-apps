//! Voice input on Windows: `Windows.Media.SpeechRecognition`, behind `dictation::Session`.
//!
//! Continuous dictation (`SpeechRecognizer` + `ContinuousRecognitionSession`, the dictation topic constraint).
//! Windows sends dictation to Microsoft's online service, so `listening` says `onDevice:false, service:"microsoft"`.
//! This engine is compiled and CI-built but has not been run on a Windows machine. Nothing here records, stores,
//! logs or forwards audio or words: they go to `Emit` and nowhere else.
//!
//! One worker thread per session, in the MTA, owns the recognizer from start to finish (WinRT objects live as long as
//! some MTA thread does). It starts the recognizer, then waits for commands: `Stop`, `Cancel`, or `Finished` from
//! the `Completed` handler. The WinRT event handlers run on thread-pool threads and only talk to `Shared`.
//!
//! * Exactly one terminal event per session, and nothing after it: `Shared::say` checks and sends under one lock.
//! * `cancel()` closes that door first (no more events from then on), then tells the worker to tear down.
//! * `stop()` -> `StopAsync()`; `Completed` follows and says `ended`. If it never comes, the worker says `ended`
//!   itself after `STOP_GRACE`.

use super::{
    ev_committed, ev_ended, ev_level, ev_listening, ev_preparing, ev_unavailable, ev_volatile, is_terminal,
    windows_status, windows_status_event, windows_status_event_in, Emit, Session,
};
use serde_json::Value;
use std::sync::mpsc::{channel, Receiver, RecvTimeoutError, Sender};
use std::sync::{Arc, Mutex};
use std::time::Duration;
use windows::core::HSTRING;
use windows::Foundation::{TimeSpan, TypedEventHandler};
use windows::Media::SpeechRecognition::{
    SpeechContinuousRecognitionCompletedEventArgs, SpeechContinuousRecognitionResultGeneratedEventArgs,
    SpeechContinuousRecognitionSession, SpeechRecognitionHypothesisGeneratedEventArgs, SpeechRecognitionResultStatus,
    SpeechRecognitionScenario, SpeechRecognitionTopicConstraint, SpeechRecognizer, SpeechRecognizerState,
    SpeechRecognizerStateChangedEventArgs,
};
use windows::Win32::System::WinRT::{RoInitialize, RO_INIT_MULTITHREADED};

/// Windows gives no audio level, so the bars follow what the recogniser says it hears.
const LEVEL_SPEECH: f64 = 0.6;
const LEVEL_QUIET: f64 = 0.15;
/// The page ends a session after 20 s without words; this is only the engine's own ceiling (10 min, in 100 ns ticks).
const AUTO_STOP_SILENCE: i64 = 10 * 60 * 10_000_000;
/// After `StopAsync`, how long to wait for `Completed` before ending the session ourselves.
const STOP_GRACE: Duration = Duration::from_secs(4);

/// Windows has a recogniser on every desktop edition that ships speech; whether it can run (microphone, online speech,
/// language) is found out per session and reported as `denied` / `unavailable`.
pub fn supported() -> bool {
    true
}

enum Cmd {
    Stop,
    Cancel,
    /// The `Completed` handler has said the session's last event.
    Finished,
}

/// What the event handlers and the commands share.
struct Shared {
    emit: Emit,
    state: Mutex<Door>,
}

struct Door {
    /// A terminal event was sent, or the session was cancelled: nothing more is said.
    closed: bool,
    /// `listening` has been sent; the recogniser's early state changes before that are not levels yet.
    listening: bool,
}

impl Shared {
    /// Sends `event` unless the session is over; a terminal event closes the door behind it. The lock is held across
    /// `emit` so two threads can't interleave a terminal event with a late word. `emit` never calls back in here.
    fn say(&self, event: Value) {
        let mut door = self.state.lock().unwrap_or_else(|p| p.into_inner());
        if door.closed {
            return;
        }
        if event.get("t").and_then(Value::as_str) == Some("level") && !door.listening {
            return;
        }
        if is_terminal(&event) {
            door.closed = true;
        }
        (self.emit)(event);
    }

    fn listening(&self) {
        let mut door = self.state.lock().unwrap_or_else(|p| p.into_inner());
        if door.closed {
            return;
        }
        door.listening = true;
        (self.emit)(ev_listening(false, Some("microsoft")));
    }

    /// Closes the door with no event: the session was cancelled.
    fn close(&self) {
        self.state.lock().unwrap_or_else(|p| p.into_inner()).closed = true;
    }

    fn is_closed(&self) -> bool {
        self.state.lock().unwrap_or_else(|p| p.into_inner()).closed
    }
}

struct Windows {
    shared: Arc<Shared>,
    tx: Sender<Cmd>,
}

impl Session for Windows {
    fn stop(&self) {
        // The worker may be gone already (the session ended by itself): nothing to stop then.
        let _ = self.tx.send(Cmd::Stop);
    }
    fn cancel(&self) {
        self.shared.close();
        let _ = self.tx.send(Cmd::Cancel);
    }
}

impl Drop for Windows {
    // The registry dropped the session (it ended, or a window closed): make sure the recogniser is released.
    // Only the channel is touched here, never `Shared`'s lock: this can run inside `emit`.
    fn drop(&mut self) {
        let _ = self.tx.send(Cmd::Cancel);
    }
}

pub fn start(emit: Emit) -> Box<dyn Session> {
    let shared = Arc::new(Shared { emit, state: Mutex::new(Door { closed: false, listening: false }) });
    let (tx, rx) = channel();
    let worker = (shared.clone(), tx.clone());
    let spawned = std::thread::Builder::new().name("page-dictation".into()).spawn(move || run(worker.0, worker.1, rx));
    if spawned.is_err() {
        shared.say(super::ev_failed());
    }
    Box::new(Windows { shared, tx })
}

/// The `HRESULT` of a failed call, as the number `windows_status_event` takes.
fn code(e: &windows::core::Error) -> i32 {
    e.code().0
}

/// What this PC's speech language is called, for "Speech in {Language} can't be turned into text on this PC".
fn system_language() -> Option<String> {
    let name = SpeechRecognizer::SystemSpeechLanguage().ok()?.DisplayName().ok()?;
    Some(name.to_string())
}

/// Dictated text is one line: line breaks become spaces (the page collapses runs of spaces).
fn one_line(text: &str) -> String {
    text.replace(['\r', '\n', '\u{2028}', '\u{2029}'], " ")
}

/// Everything the worker holds on to for tearing down.
struct Live {
    recognizer: SpeechRecognizer,
    session: SpeechContinuousRecognitionSession,
    state_token: i64,
    hypothesis_token: i64,
    result_token: i64,
    completed_token: i64,
}

fn run(shared: Arc<Shared>, tx: Sender<Cmd>, rx: Receiver<Cmd>) {
    // SAFETY: plain COM/WinRT initialisation of this worker thread; every WinRT object below lives and dies on it
    // (or on the thread pool, which is also in the MTA).
    if let Err(e) = unsafe { RoInitialize(RO_INIT_MULTITHREADED) } {
        // `RPC_E_CHANGED_MODE` and friends: this thread can't host the recogniser.
        shared.say(windows_status_event(code(&e), None));
        return;
    }
    // A cancel that came in while the thread was starting.
    if shared.is_closed() {
        return;
    }
    shared.say(ev_preparing());

    let live = match begin(&shared, &tx) {
        Ok(live) => live,
        Err(event) => {
            shared.say(event);
            return;
        }
    };

    // Late `Cancel` / `Stop` commands queued up while starting are handled by the loop below.
    let mut stopping = false;
    loop {
        let next = if stopping { rx.recv_timeout(STOP_GRACE) } else { rx.recv().map_err(|_| RecvTimeoutError::Disconnected) };
        match next {
            Ok(Cmd::Stop) if !stopping => {
                if shared.is_closed() {
                    break;
                }
                stopping = true;
                if let Err(e) = live.session.StopAsync() {
                    shared.say(windows_status_event(code(&e), None));
                    break;
                }
            }
            Ok(Cmd::Stop) => {}
            Ok(Cmd::Cancel) => {
                shared.close();
                // Not awaited: the handlers are removed and the recogniser closed right after.
                let _ = live.session.CancelAsync();
                break;
            }
            Ok(Cmd::Finished) => break,
            // `Completed` never came after the stop: the words are in, end it.
            Err(RecvTimeoutError::Timeout) => {
                shared.say(ev_ended());
                break;
            }
            Err(RecvTimeoutError::Disconnected) => break,
        }
    }
    teardown(live);
}

/// Creates the recogniser, compiles the dictation constraint, hooks the events and starts listening.
/// `Err` is the terminal event to send.
fn begin(shared: &Arc<Shared>, tx: &Sender<Cmd>) -> Result<Live, Value> {
    // No recogniser at all (no speech language installed, say): the mic can't work on this PC.
    let recognizer = SpeechRecognizer::new().map_err(|e| match code(&e) {
        known @ (super::HRESULT_SPEECH_PRIVACY | super::HRESULT_ACCESS_DENIED) => windows_status_event(known, None),
        _ => ev_unavailable("noRecognizer", &system_language().unwrap_or_default()),
    })?;

    let constraint = SpeechRecognitionTopicConstraint::Create(SpeechRecognitionScenario::Dictation, &HSTRING::from("dictation"))
        .map_err(|e| windows_status_event(code(&e), None))?;
    recognizer
        .Constraints()
        .and_then(|list| list.Append(&constraint))
        .map_err(|e| windows_status_event(code(&e), None))?;
    let compiled = recognizer
        .CompileConstraintsAsync()
        .and_then(|op| op.join())
        .map_err(|e| windows_status_event(code(&e), None))?;
    let status = compiled.Status().map_err(|e| windows_status_event(code(&e), None))?;
    if status != SpeechRecognitionResultStatus::Success {
        let language = if status.0 == windows_status::TOPIC_LANGUAGE_NOT_SUPPORTED { system_language() } else { None };
        return Err(windows_status_event_in(0, Some(status.0), language.as_deref()));
    }

    let session = recognizer.ContinuousRecognitionSession().map_err(|e| windows_status_event(code(&e), None))?;
    // Not fatal: the default (20 s of silence) still ends in `ended`.
    let _ = session.SetAutoStopSilenceTimeout(TimeSpan { Duration: AUTO_STOP_SILENCE });

    // Level: Windows gives no audio level, only what it hears.
    let s = shared.clone();
    let state_token = recognizer
        .StateChanged(&TypedEventHandler::new(move |_, args: windows::core::Ref<SpeechRecognizerStateChangedEventArgs>| {
            if let Some(args) = args.as_ref() {
                if let Ok(state) = args.State() {
                    if state == SpeechRecognizerState::SpeechDetected || state == SpeechRecognizerState::SoundStarted {
                        s.say(ev_level(LEVEL_SPEECH));
                    } else if state == SpeechRecognizerState::SoundEnded || state == SpeechRecognizerState::Idle {
                        s.say(ev_level(LEVEL_QUIET));
                    }
                }
            }
            Ok(())
        }))
        .map_err(|e| windows_status_event(code(&e), None))?;

    // The words still changing.
    let s = shared.clone();
    let hypothesis_token = recognizer
        .HypothesisGenerated(&TypedEventHandler::new(move |_, args: windows::core::Ref<SpeechRecognitionHypothesisGeneratedEventArgs>| {
            if let Some(text) = args.as_ref().and_then(|a| a.Hypothesis().ok()).and_then(|h| h.Text().ok()) {
                s.say(ev_volatile(&one_line(&text.to_string())));
            }
            Ok(())
        }))
        .map_err(|e| windows_status_event(code(&e), None))?;

    // Finished words. An empty result (speech Windows could not make out) says nothing.
    let s = shared.clone();
    let result_token = session
        .ResultGenerated(&TypedEventHandler::new(move |_, args: windows::core::Ref<SpeechContinuousRecognitionResultGeneratedEventArgs>| {
            if let Some(text) = args.as_ref().and_then(|a| a.Result().ok()).and_then(|r| r.Text().ok()) {
                let text = one_line(&text.to_string());
                if !text.trim().is_empty() {
                    s.say(ev_committed(&text));
                }
            }
            Ok(())
        }))
        .map_err(|e| windows_status_event(code(&e), None))?;

    // The session ended by itself, after a stop, or because something broke: one terminal event, then tear down.
    let s = shared.clone();
    let t = tx.clone();
    let completed_token = session
        .Completed(&TypedEventHandler::new(move |_, args: windows::core::Ref<SpeechContinuousRecognitionCompletedEventArgs>| {
            let status = args.as_ref().and_then(|a| a.Status().ok()).map(|st| st.0);
            let language = if status == Some(windows_status::TOPIC_LANGUAGE_NOT_SUPPORTED) { system_language() } else { None };
            s.say(match status {
                Some(status) => windows_status_event_in(0, Some(status), language.as_deref()),
                None => super::ev_failed(),
            });
            let _ = t.send(Cmd::Finished);
            Ok(())
        }))
        .map_err(|e| windows_status_event(code(&e), None))?;

    let live = Live { recognizer, session, state_token, hypothesis_token, result_token, completed_token };

    // `0x80045509` (online speech recognition is off) and `0x80070005` (microphone off) come out of here.
    if let Err(e) = live.session.StartAsync().and_then(|op| op.join()) {
        teardown(live);
        return Err(windows_status_event(code(&e), None));
    }
    shared.listening();
    Ok(live)
}

/// Unhooks the events and releases the recogniser. Errors are ignored: there is nobody left to tell.
fn teardown(live: Live) {
    let _ = live.session.RemoveCompleted(live.completed_token);
    let _ = live.session.RemoveResultGenerated(live.result_token);
    let _ = live.recognizer.RemoveHypothesisGenerated(live.hypothesis_token);
    let _ = live.recognizer.RemoveStateChanged(live.state_token);
    let _ = live.recognizer.Close();
}
