//! Voice input on the Mac: the Swift engine in `dictation_macos.swift`, behind `dictation::Session`.
//!
//! `build.rs` compiles that file into a static library and links it. Its C ABI is three functions (see the header
//! of the Swift file for the full contract):
//!
//! * `pd_start(cb, ctx)`: starts a session (and cancels the current one). `cb(json, ctx)` is called on the main
//!   thread with one event as a NUL-terminated UTF-8 JSON object per call, never from inside a `pd_*` call.
//! * `pd_stop()`: finalise, then `ended`. `pd_cancel()`: drop everything, no more events.
//! * After the terminal event (or a cancel) Swift calls `cb(NULL, ctx)` exactly once and never touches `ctx`
//!   again. That call is where the leaked `Box` behind `ctx` is freed, so a late callback can't see freed memory.
//!
//! Only one session exists at a time (the registry in `dictation.rs` makes sure), so `pd_stop` and `pd_cancel`
//! need no id.

use super::{Emit, Session};
use serde_json::Value;
use std::ffi::{c_char, c_void, CStr};

type Callback = extern "C" fn(*const c_char, *mut c_void);

extern "C" {
    fn pd_start(cb: Callback, ctx: *mut c_void);
    fn pd_stop();
    fn pd_cancel();
}

/// The Mac always has SFSpeechRecognizer (macOS 12 is the floor); which engine listens is decided per session.
pub fn supported() -> bool {
    true
}

struct Mac;

impl Session for Mac {
    fn stop(&self) {
        // SAFETY: no arguments; the Swift side hops to the main queue and ignores a stop with nothing running.
        unsafe { pd_stop() }
    }
    fn cancel(&self) {
        // SAFETY: as above.
        unsafe { pd_cancel() }
    }
}

pub fn start(emit: Emit) -> Box<dyn Session> {
    // Leaked into `ctx`; freed by `on_event` when Swift sends the NULL release call.
    let ctx = Box::into_raw(Box::new(emit)) as *mut c_void;
    // SAFETY: `on_event` is a plain `extern "C"` function and `ctx` stays valid until Swift's release call.
    unsafe { pd_start(on_event, ctx) };
    Box::new(Mac)
}

extern "C" fn on_event(json: *const c_char, ctx: *mut c_void) {
    if ctx.is_null() {
        return;
    }
    if json.is_null() {
        // SAFETY: the release call comes once, last, and `ctx` is the `Box<Emit>` leaked in `start`.
        drop(unsafe { Box::from_raw(ctx as *mut Emit) });
        return;
    }
    // SAFETY: Swift passes a NUL-terminated string that lives for this call, and `ctx` is live until the release.
    let (text, emit) = unsafe { (CStr::from_ptr(json).to_bytes().to_vec(), &*(ctx as *const Emit)) };
    // Words are never logged: a bad event is dropped without a trace of its content.
    if let Ok(event) = serde_json::from_slice::<Value>(&text) {
        emit(event);
    }
}
