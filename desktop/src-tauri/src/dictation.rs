//! Voice input on the desktop: the operating system's own speech recogniser, driven from Rust.
//!
//! The page (Aura or Orbit) calls five commands and listens to one event; see `docs/voice-input.md`,
//! "Engines" -> "Desktop (Tauri)". Nothing here records, stores, logs or forwards audio or
//! words: the platform module hands the recogniser's events to `Emit`, and `Emit` sends them to the one
//! window that started the session. Nothing is ever sent anywhere by voice; the words only fill a box.
//!
//! * `dictation_supported() -> {supported, platform}`, platform `"mac"` | `"windows"` | `"none"`.
//! * `dictation_start(window) -> id`. App-wide there is one session: starting cancels the live one first
//!   (its window gets `{id, t:"ended"}`). The starting window's label is the owner.
//! * `dictation_stop(id)` finalises (the last words arrive, then `ended`); `dictation_cancel(id)` drops.
//!   An id that is not the live session is ignored.
//! * `dictation_open_settings(what)`, `what` `"microphone"` | `"speech"`: opens the system's privacy
//!   pane from Rust. The page never supplies a URL.
//! * Event `"dictation"`, payload `{id, t, ...}`, sent to the owner window only (`emit_to` its label).
//!   A window that is destroyed cancels its session.
//!
//! Every session ends with exactly one terminal event (`ended`, `interrupted`, `denied`, `unavailable`
//! or `failed`) unless the page cancels it, and nothing arrives after that. See `is_terminal`.

use serde::Serialize;
use serde_json::{json, Value};
use std::sync::{Arc, Mutex, MutexGuard};
use tauri::{AppHandle, Emitter, Manager, State};

/// How a platform engine reports: one JSON object per event, from any thread.
pub(crate) type Emit = Arc<dyn Fn(Value) + Send + Sync>;

/// One live recognition, as the platform module sees it. Called with no lock held.
pub(crate) trait Session: Send {
    /// Close the microphone, finalise what was heard, deliver it, then end with `ended`.
    fn stop(&self);
    /// Close the microphone and drop everything: no more events.
    fn cancel(&self);
}

#[cfg(target_os = "macos")]
#[path = "dictation_macos.rs"]
mod platform;

#[cfg(target_os = "windows")]
#[path = "dictation_windows.rs"]
mod platform;

/// Every other system: no recogniser, `supported() = false`, the page shows no mic.
#[cfg(not(any(target_os = "macos", target_os = "windows")))]
mod platform {
    pub fn supported() -> bool {
        false
    }

    struct Nothing;
    impl super::Session for Nothing {
        fn stop(&self) {}
        fn cancel(&self) {}
    }

    pub fn start(_emit: super::Emit) -> Box<dyn super::Session> {
        Box::new(Nothing)
    }
}

/// The Tauri event the page listens to.
const EVENT: &str = "dictation";

// ---------------------------------------------------------------------------------------------
// Pure helpers (no cfg: every OS unit-tests these)
// ---------------------------------------------------------------------------------------------

/// `"mac"`, `"windows"` or `"none"`, for the engine that is actually compiled in and able to run.
pub(crate) fn platform_name(supported: bool) -> &'static str {
    if !supported {
        "none"
    } else if cfg!(target_os = "macos") {
        "mac"
    } else if cfg!(target_os = "windows") {
        "windows"
    } else {
        "none"
    }
}

/// Adds the session id to an event: `{t:"volatile", s:"hi"}` -> `{id:7, t:"volatile", s:"hi"}`.
pub(crate) fn with_id(id: u64, event: Value) -> Value {
    let mut map = match event {
        Value::Object(m) => m,
        _ => serde_json::Map::new(),
    };
    map.insert("id".into(), json!(id));
    Value::Object(map)
}

/// An engine event has a string `t` and nothing that could pass for a different session's id.
pub(crate) fn well_formed(event: &Value) -> bool {
    event.get("t").is_some_and(Value::is_string)
}

/// The last event of a session. After one of these the session is over and nothing more is sent.
pub(crate) fn is_terminal(event: &Value) -> bool {
    matches!(
        event.get("t").and_then(Value::as_str),
        Some("ended" | "interrupted" | "denied" | "unavailable" | "failed")
    )
}

// Event constructors. The macOS engine builds its JSON in Swift; the Windows engine and the tests use these.

#[allow(dead_code)]
pub(crate) fn ev_preparing() -> Value {
    json!({"t": "preparing"})
}
/// `fraction` is 0..=1, or `None` when macOS gives no percentage.
#[allow(dead_code)]
pub(crate) fn ev_downloading(fraction: Option<f64>, language: &str) -> Value {
    let f = fraction.filter(|f| f.is_finite()).map(|f| f.clamp(0.0, 1.0));
    json!({"t": "downloading", "f": f, "language": language})
}
/// `service` is `"apple"`, `"microsoft"`, `"browser"`, or `None` when the words stay on the device.
#[allow(dead_code)]
pub(crate) fn ev_listening(on_device: bool, service: Option<&str>) -> Value {
    json!({"t": "listening", "onDevice": on_device, "service": service})
}
#[allow(dead_code)]
pub(crate) fn ev_level(v: f64) -> Value {
    let v = if v.is_finite() { v.clamp(0.0, 1.0) } else { 0.0 };
    json!({"t": "level", "v": v})
}
#[allow(dead_code)]
pub(crate) fn ev_volatile(s: &str) -> Value {
    json!({"t": "volatile", "s": s})
}
#[allow(dead_code)]
pub(crate) fn ev_committed(s: &str) -> Value {
    json!({"t": "committed", "s": s})
}
#[allow(dead_code)]
pub(crate) fn ev_interrupted() -> Value {
    json!({"t": "interrupted"})
}
#[allow(dead_code)]
pub(crate) fn ev_ended() -> Value {
    json!({"t": "ended"})
}
/// `what` is `"microphone"` or `"speech"`.
#[allow(dead_code)]
pub(crate) fn ev_denied(what: &str) -> Value {
    json!({"t": "denied", "what": what})
}
/// `why` is `"language"` or `"noRecognizer"`.
#[allow(dead_code)]
pub(crate) fn ev_unavailable(why: &str, language: &str) -> Value {
    json!({"t": "unavailable", "why": why, "language": language})
}
#[allow(dead_code)]
pub(crate) fn ev_failed() -> Value {
    json!({"t": "failed"})
}

/// The HRESULT for "the speech privacy policy was not accepted" (online speech recognition is off).
pub(crate) const HRESULT_SPEECH_PRIVACY: i32 = 0x8004_5509_u32 as i32;
/// `E_ACCESSDENIED`: the microphone is off for desktop apps.
pub(crate) const HRESULT_ACCESS_DENIED: i32 = 0x8007_0005_u32 as i32;

/// `Windows.Media.SpeechRecognition.SpeechRecognitionResultStatus`, as the numbers the `windows` crate uses
/// (0.62: `Success` = 0 ... `MicrophoneUnavailable` = 10, checked against its source).
#[allow(dead_code)]
pub(crate) mod windows_status {
    pub const SUCCESS: i32 = 0;
    pub const TOPIC_LANGUAGE_NOT_SUPPORTED: i32 = 1;
    pub const GRAMMAR_LANGUAGE_MISMATCH: i32 = 2;
    pub const GRAMMAR_COMPILATION_FAILURE: i32 = 3;
    pub const AUDIO_QUALITY_FAILURE: i32 = 4;
    pub const USER_CANCELED: i32 = 5;
    pub const UNKNOWN: i32 = 6;
    pub const TIMEOUT_EXCEEDED: i32 = 7;
    pub const PAUSE_LIMIT_EXCEEDED: i32 = 8;
    pub const NETWORK_FAILURE: i32 = 9;
    pub const MICROPHONE_UNAVAILABLE: i32 = 10;
}

/// Maps what Windows reports to one terminal event.
///
/// * `code`: an HRESULT, from a failed `StartAsync` / `CompileConstraintsAsync` (0 when there was none).
///   `0x80045509` -> `denied speech`; `0x80070005` -> `denied microphone`.
/// * `status`: the `SpeechRecognitionResultStatus` from the session's `Completed` event, when there is one.
///   `Success`, `UserCanceled`, `TimeoutExceeded`, `PauseLimitExceeded` -> `ended`;
///   `NetworkFailure`, `AudioQualityFailure` -> `interrupted`; `MicrophoneUnavailable` -> `denied microphone`;
///   `TopicLanguageNotSupported` -> `unavailable language`; anything else (grammar errors, `Unknown`,
///   a number Windows adds later) -> `failed`.
///
/// A known HRESULT wins over `status`. Any other non-zero HRESULT with no status is `failed`; no error at all
/// is `ended`. The `unavailable language` event carries `language: null`: use `windows_status_event_in` when
/// the system's speech language name is at hand.
#[allow(dead_code)]
pub(crate) fn windows_status_event(code: i32, status: Option<i32>) -> Value {
    windows_status_event_in(code, status, None)
}

/// `windows_status_event` with the display name of the system speech language for `unavailable language`.
#[allow(dead_code)]
pub(crate) fn windows_status_event_in(code: i32, status: Option<i32>, language: Option<&str>) -> Value {
    use windows_status as s;
    match code {
        HRESULT_SPEECH_PRIVACY => return ev_denied("speech"),
        HRESULT_ACCESS_DENIED => return ev_denied("microphone"),
        _ => {}
    }
    let Some(status) = status else {
        return if code == 0 { ev_ended() } else { ev_failed() };
    };
    match status {
        s::SUCCESS | s::USER_CANCELED | s::TIMEOUT_EXCEEDED | s::PAUSE_LIMIT_EXCEEDED => ev_ended(),
        s::NETWORK_FAILURE | s::AUDIO_QUALITY_FAILURE => ev_interrupted(),
        s::MICROPHONE_UNAVAILABLE => ev_denied("microphone"),
        s::TOPIC_LANGUAGE_NOT_SUPPORTED => {
            json!({"t": "unavailable", "why": "language", "language": language})
        }
        _ => ev_failed(),
    }
}

/// The system settings page for a permission: `os` is `"mac"` or `"windows"` (what `dictation_supported`
/// reports), `what` is `"microphone"` or `"speech"`. Anything else is `None`, so a page can never choose a URL.
pub(crate) fn settings_url(os: &str, what: &str) -> Option<&'static str> {
    match (os, what) {
        ("mac", "microphone") => Some("x-apple.systempreferences:com.apple.preference.security?Privacy_Microphone"),
        ("mac", "speech") => Some("x-apple.systempreferences:com.apple.preference.security?Privacy_SpeechRecognition"),
        ("windows", "microphone") => Some("ms-settings:privacy-microphone"),
        ("windows", "speech") => Some("ms-settings:privacy-speech"),
        _ => None,
    }
}

/// Who owns the live session. App-wide there is at most one; ids count up from 1 and are never reused.
pub(crate) struct Registry<S> {
    next_id: u64,
    live: Option<Live<S>>,
}

/// The live session. `session` is empty between `begin` and `attach` (the platform is still starting it).
pub(crate) struct Live<S> {
    pub(crate) id: u64,
    pub(crate) owner: String,
    pub(crate) session: Option<S>,
}

impl<S> Default for Registry<S> {
    fn default() -> Self {
        Registry { next_id: 1, live: None }
    }
}

impl<S: Clone> Registry<S> {
    /// A new session for the window labelled `owner`: its id, and the session it replaces (to be cancelled
    /// by the caller, with no lock held).
    pub(crate) fn begin(&mut self, owner: &str) -> (u64, Option<Live<S>>) {
        let id = self.next_id;
        self.next_id += 1;
        let previous = self.live.replace(Live { id, owner: owner.to_string(), session: None });
        (id, previous)
    }

    /// Stores the platform's session for `id`. Gives it back when `id` is not live any more (it ended or was
    /// replaced while starting), so the caller can cancel it.
    pub(crate) fn attach(&mut self, id: u64, session: S) -> Option<S> {
        match self.live.as_mut() {
            Some(live) if live.id == id => {
                live.session = Some(session);
                None
            }
            _ => Some(session),
        }
    }

    /// The window that owns `id`, or `None` for any id that is not the live session.
    pub(crate) fn owner(&self, id: u64) -> Option<&str> {
        self.live.as_ref().filter(|l| l.id == id).map(|l| l.owner.as_str())
    }

    /// The live session for `id`, for `stop`.
    pub(crate) fn session(&self, id: u64) -> Option<S> {
        self.live.as_ref().filter(|l| l.id == id).and_then(|l| l.session.clone())
    }

    /// Ends `id`: removes and returns it. A stale id returns `None` and changes nothing.
    pub(crate) fn end(&mut self, id: u64) -> Option<Live<S>> {
        if self.live.as_ref().is_some_and(|l| l.id == id) {
            self.live.take()
        } else {
            None
        }
    }

    /// Ends the live session if the window labelled `owner` owns it.
    pub(crate) fn end_owned_by(&mut self, owner: &str) -> Option<Live<S>> {
        if self.live.as_ref().is_some_and(|l| l.owner == owner) {
            self.live.take()
        } else {
            None
        }
    }
}

// ---------------------------------------------------------------------------------------------
// The commands
// ---------------------------------------------------------------------------------------------

/// A platform session behind a lock of its own, so `stop` and `cancel` run with the registry unlocked.
type Handle = Arc<Mutex<Box<dyn Session>>>;

#[derive(Default)]
pub struct Dictation(Mutex<Registry<Handle>>);

fn lock(state: &Dictation) -> MutexGuard<'_, Registry<Handle>> {
    state.0.lock().unwrap_or_else(|poisoned| poisoned.into_inner())
}

fn run(handle: &Handle, f: impl FnOnce(&dyn Session)) {
    let guard = handle.lock().unwrap_or_else(|poisoned| poisoned.into_inner());
    f(guard.as_ref());
}

#[derive(Serialize)]
pub struct Support {
    supported: bool,
    platform: &'static str,
}

#[tauri::command]
pub fn dictation_supported() -> Support {
    let supported = platform::supported();
    Support { supported, platform: platform_name(supported) }
}

/// The `Emit` for session `id`: drops events of a session that is no longer live, sends the rest to the owner
/// window only, and ends the session after a terminal event.
fn emitter(app: AppHandle, id: u64) -> Emit {
    Arc::new(move |event: Value| {
        if !well_formed(&event) {
            return;
        }
        let Some(state) = app.try_state::<Dictation>() else { return };
        let terminal = is_terminal(&event);
        let (owner, ended) = {
            let mut reg = lock(&state);
            let Some(owner) = reg.owner(id).map(str::to_string) else { return };
            (owner, if terminal { reg.end(id) } else { None })
        };
        // The window may be gone by now; there is nobody to tell then.
        let _ = app.emit_to(owner.as_str(), EVENT, with_id(id, event));
        drop(ended);
    })
}

#[tauri::command]
pub fn dictation_start(app: AppHandle, window: tauri::Window, state: State<'_, Dictation>) -> Result<u64, String> {
    if !platform::supported() {
        return Err("Voice input isn't available on this system.".into());
    }
    let (id, previous) = lock(&state).begin(window.label());

    // One input at a time, app-wide: the old owner is told it ended, and its words stay.
    if let Some(old) = previous {
        if let Some(handle) = &old.session {
            run(handle, |s| s.cancel());
        }
        let _ = app.emit_to(old.owner.as_str(), EVENT, with_id(old.id, ev_ended()));
    }

    // No lock is held while the platform starts: it may report straight away (and ends the session itself on
    // a terminal event).
    let session: Handle = Arc::new(Mutex::new(platform::start(emitter(app.clone(), id))));
    if let Some(stale) = lock(&state).attach(id, session) {
        run(&stale, |s| s.cancel());
    }
    Ok(id)
}

#[tauri::command]
pub fn dictation_stop(state: State<'_, Dictation>, id: u64) {
    let handle = lock(&state).session(id);
    if let Some(handle) = handle {
        run(&handle, |s| s.stop());
    }
}

#[tauri::command]
pub fn dictation_cancel(state: State<'_, Dictation>, id: u64) {
    let ended = lock(&state).end(id);
    if let Some(handle) = ended.and_then(|l| l.session) {
        run(&handle, |s| s.cancel());
    }
}

#[tauri::command]
pub fn dictation_open_settings(app: AppHandle, what: String) -> Result<(), String> {
    use tauri_plugin_opener::OpenerExt;
    let url = settings_url(platform_name(platform::supported()), &what)
        .ok_or_else(|| "No settings page for that here.".to_string())?;
    app.opener().open_url(url, None::<&str>).map_err(|e| e.to_string())
}

/// A window was destroyed: if it owned the session, drop it. Nothing is sent: nobody is listening.
pub fn window_closed(app: &AppHandle, label: &str) {
    let Some(state) = app.try_state::<Dictation>() else { return };
    let ended = lock(&state).end_owned_by(label);
    if let Some(handle) = ended.and_then(|l| l.session) {
        run(&handle, |s| s.cancel());
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn with_id_adds_the_id_and_keeps_the_fields() {
        let v = with_id(7, ev_volatile("hello \"there\""));
        assert_eq!(v, json!({"id": 7, "t": "volatile", "s": "hello \"there\""}));
        // an engine can't pick its own id
        assert_eq!(with_id(3, json!({"t": "ended", "id": 99}))["id"], 3);
        // not an object: nothing of it survives, but the id does
        assert_eq!(with_id(4, json!("x")), json!({"id": 4}));
    }

    #[test]
    fn event_shapes_match_the_spec() {
        assert_eq!(ev_preparing(), json!({"t": "preparing"}));
        assert_eq!(ev_downloading(Some(0.4), "English (UK)"), json!({"t": "downloading", "f": 0.4, "language": "English (UK)"}));
        assert_eq!(ev_downloading(None, "x")["f"], Value::Null);
        assert_eq!(ev_downloading(Some(f64::NAN), "x")["f"], Value::Null);
        assert_eq!(ev_downloading(Some(7.0), "x")["f"], 1.0);
        assert_eq!(ev_listening(true, None), json!({"t": "listening", "onDevice": true, "service": null}));
        assert_eq!(ev_listening(false, Some("apple")), json!({"t": "listening", "onDevice": false, "service": "apple"}));
        assert_eq!(ev_level(2.0)["v"], 1.0);
        assert_eq!(ev_level(f64::INFINITY)["v"], 0.0);
        assert_eq!(ev_committed("hi"), json!({"t": "committed", "s": "hi"}));
        assert_eq!(ev_interrupted(), json!({"t": "interrupted"}));
        assert_eq!(ev_ended(), json!({"t": "ended"}));
        assert_eq!(ev_denied("speech"), json!({"t": "denied", "what": "speech"}));
        assert_eq!(ev_unavailable("noRecognizer", "French"), json!({"t": "unavailable", "why": "noRecognizer", "language": "French"}));
        assert_eq!(ev_failed(), json!({"t": "failed"}));
    }

    #[test]
    fn terminal_events_are_exactly_the_ones_that_end_a_session() {
        for t in ["ended", "interrupted", "denied", "unavailable", "failed"] {
            assert!(is_terminal(&json!({"t": t})), "{t}");
        }
        for t in ["preparing", "downloading", "listening", "level", "volatile", "committed", "nonsense"] {
            assert!(!is_terminal(&json!({"t": t})), "{t}");
        }
        assert!(!is_terminal(&json!({})));
        assert!(!is_terminal(&json!({"t": 5})));
    }

    #[test]
    fn events_without_a_string_t_are_dropped() {
        assert!(well_formed(&json!({"t": "level", "v": 0.5})));
        assert!(!well_formed(&json!({"v": 0.5})));
        assert!(!well_formed(&json!({"t": 1})));
        assert!(!well_formed(&json!("level")));
    }

    #[test]
    fn windows_codes_and_statuses_map_to_one_event() {
        use windows_status as s;
        let denied_speech = json!({"t": "denied", "what": "speech"});
        let denied_mic = json!({"t": "denied", "what": "microphone"});
        assert_eq!(windows_status_event(0x8004_5509_u32 as i32, None), denied_speech);
        assert_eq!(windows_status_event(0x8007_0005_u32 as i32, None), denied_mic);
        // a known HRESULT wins over a status
        assert_eq!(windows_status_event(0x8004_5509_u32 as i32, Some(s::SUCCESS)), denied_speech);
        assert_eq!(windows_status_event(0x8007_0005_u32 as i32, Some(s::NETWORK_FAILURE)), denied_mic);

        for ended in [s::SUCCESS, s::USER_CANCELED, s::TIMEOUT_EXCEEDED, s::PAUSE_LIMIT_EXCEEDED] {
            assert_eq!(windows_status_event(0, Some(ended)), ev_ended(), "status {ended}");
        }
        for interrupted in [s::NETWORK_FAILURE, s::AUDIO_QUALITY_FAILURE] {
            assert_eq!(windows_status_event(0, Some(interrupted)), ev_interrupted(), "status {interrupted}");
        }
        assert_eq!(windows_status_event(0, Some(s::MICROPHONE_UNAVAILABLE)), denied_mic);
        assert_eq!(
            windows_status_event(0, Some(s::TOPIC_LANGUAGE_NOT_SUPPORTED)),
            json!({"t": "unavailable", "why": "language", "language": null})
        );
        assert_eq!(
            windows_status_event_in(0, Some(s::TOPIC_LANGUAGE_NOT_SUPPORTED), Some("Zulu")),
            json!({"t": "unavailable", "why": "language", "language": "Zulu"})
        );
        for failed in [s::GRAMMAR_LANGUAGE_MISMATCH, s::GRAMMAR_COMPILATION_FAILURE, s::UNKNOWN, 11, -1] {
            assert_eq!(windows_status_event(0, Some(failed)), ev_failed(), "status {failed}");
        }
        // no status: an unknown HRESULT is a failure, no error at all is a normal end
        assert_eq!(windows_status_event(0x8000_4005_u32 as i32, None), ev_failed());
        assert_eq!(windows_status_event(0, None), ev_ended());
    }

    #[test]
    fn windows_hresults_are_the_documented_numbers() {
        assert_eq!(HRESULT_SPEECH_PRIVACY as u32, 0x8004_5509);
        assert_eq!(HRESULT_ACCESS_DENIED as u32, 0x8007_0005);
        // both are negative as an i32, which is how the windows crate reports an HRESULT
        assert!(HRESULT_SPEECH_PRIVACY < 0 && HRESULT_ACCESS_DENIED < 0);
    }

    #[test]
    fn settings_urls_are_fixed_per_platform() {
        assert_eq!(settings_url("mac", "microphone"), Some("x-apple.systempreferences:com.apple.preference.security?Privacy_Microphone"));
        assert_eq!(settings_url("mac", "speech"), Some("x-apple.systempreferences:com.apple.preference.security?Privacy_SpeechRecognition"));
        assert_eq!(settings_url("windows", "microphone"), Some("ms-settings:privacy-microphone"));
        assert_eq!(settings_url("windows", "speech"), Some("ms-settings:privacy-speech"));
        for (os, what) in [("none", "microphone"), ("mac", "camera"), ("mac", "https://evil.example"), ("windows", ""), ("linux", "speech")] {
            assert_eq!(settings_url(os, what), None, "{os} {what}");
        }
    }

    #[test]
    fn platform_name_follows_support() {
        assert_eq!(platform_name(false), "none");
        let expected = if cfg!(target_os = "macos") { "mac" } else if cfg!(target_os = "windows") { "windows" } else { "none" };
        assert_eq!(platform_name(true), expected);
    }

    #[test]
    fn ids_count_up_and_a_new_session_replaces_the_old() {
        let mut reg: Registry<u32> = Registry::default();
        let (a, none) = reg.begin("main");
        assert_eq!(a, 1);
        assert!(none.is_none());
        assert_eq!(reg.attach(a, 10), None);
        assert_eq!(reg.owner(a), Some("main"));
        assert_eq!(reg.session(a), Some(10));

        let (b, replaced) = reg.begin("chat-2");
        assert_eq!(b, 2);
        let old = replaced.expect("the first session is handed back to be cancelled");
        assert_eq!((old.id, old.owner.as_str(), old.session), (1, "main", Some(10)));
        // the old id is stale now
        assert_eq!(reg.owner(a), None);
        assert_eq!(reg.session(a), None);
        assert!(reg.end(a).is_none());
        assert_eq!(reg.owner(b), Some("chat-2"));
    }

    #[test]
    fn a_session_that_ended_while_starting_is_given_back() {
        let mut reg: Registry<u32> = Registry::default();
        let (a, _) = reg.begin("main");
        // it reported a terminal event before the platform returned
        assert!(reg.end(a).is_some());
        assert_eq!(reg.attach(a, 5), Some(5));
        // replaced while starting
        let (b, _) = reg.begin("main");
        let (c, _) = reg.begin("main");
        assert_eq!(reg.attach(b, 6), Some(6));
        assert_eq!(reg.attach(c, 7), None);
    }

    #[test]
    fn stale_ids_change_nothing() {
        let mut reg: Registry<u32> = Registry::default();
        let (a, _) = reg.begin("main");
        reg.attach(a, 1);
        assert!(reg.end(a + 1).is_none());
        assert!(reg.end(0).is_none());
        assert_eq!(reg.owner(a), Some("main"));
        let ended = reg.end(a).unwrap();
        assert_eq!(ended.session, Some(1));
        assert_eq!(reg.owner(a), None);
        assert!(reg.end(a).is_none());
        // ids are not reused
        assert_eq!(reg.begin("main").0, a + 1);
    }

    #[test]
    fn only_the_owner_window_closing_ends_the_session() {
        let mut reg: Registry<u32> = Registry::default();
        let (a, _) = reg.begin("chat-1");
        reg.attach(a, 1);
        assert!(reg.end_owned_by("main").is_none());
        assert_eq!(reg.owner(a), Some("chat-1"));
        let ended = reg.end_owned_by("chat-1").unwrap();
        assert_eq!((ended.id, ended.session), (a, Some(1)));
        assert!(reg.end_owned_by("chat-1").is_none());
    }

    #[test]
    fn the_unsupported_stub_never_starts_anything() {
        // On a system without an engine the commands refuse and `supported` is false; on the others the engine decides.
        if !cfg!(any(target_os = "macos", target_os = "windows")) {
            assert!(!platform::supported());
            assert_eq!(platform_name(platform::supported()), "none");
        }
    }
}
