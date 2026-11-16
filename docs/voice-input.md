# Voice input in Page Aura and Page Orbit

Branch `voice-input` (stacked on `unlimited-panes`, PR #8). The same feature as Page Relay's voice input on the
iPhone, Android and Page Studio for Mac (`roysinclair/page`, `Designs/voice-input.md`), brought to the two web/desktop
apps here.

## What the user asked (2026-11-13)

> "Can you make Aura as well as Orbit both have the same speech stuff?"

Decisions (the user, 2026-11-13):

- **Design: approved** as rendered (the board of ten composer states, Aura and Orbit, dark and light).
- **Mac desktop engine: the same as Page Studio.** On the Mac first (`SpeechAnalyzer` + `SpeechTranscriber`, then
  `DictationTranscriber`, then `SFSpeechRecognizer` on-device), then Apple's speech service (`SFSpeechRecognizer` with
  `requiresOnDeviceRecognition = false`). The line names the service whenever audio leaves the Mac.
- **Windows desktop: native Windows speech too** (`Windows.Media.SpeechRecognition`, which uses Microsoft's online
  service for dictation). It is compiled and CI-built but can't be run on a Windows machine here, so it ships
  untested and the docs say so.
- **Linux desktop: no mic.** WebKitGTK has no working speech recognition. The mic doesn't show and the guide says why.
- **Browsers:** the Web Speech API where it exists (Chrome, Edge, Safari). Firefox has none, so no mic.

## Rules that do not bend

1. **Speaking only fills the box.** Nothing is ever sent by voice. Enter and Send are unchanged. Saying "send" is a word.
2. **Never through Page.** Audio goes from the microphone to the platform's recogniser and nowhere else. The apps never
   record, store, log or upload audio or transcripts. The text goes nowhere until you send it, by the same route as
   typed text.
3. **Say where the voice goes.** On the device, the line says "Listening on this Mac". Whenever a server does the work it
   names it: "Apple's speech service", "Microsoft's speech service" or "this browser's speech service".
4. **Dictated text is one line.** Newlines in a result become spaces and runs of spaces collapse, so dictation can never
   look like Enter.
5. **Nothing typed is overwritten.** Spoken words are added after the existing draft. If the box changes under the
   dictation (the person typed, pasted, cleared it), listening stops and late results are dropped.
6. **One input at a time, app-wide.** Starting the mic in another pane, box or window stops the first one. Its words stay.

## Where the mic goes

| App | Box | Code |
|---|---|---|
| Aura | Every chat pane's composer (`Reply…` / `Ask anything…`) | `buildComposer(p)` in `page-aura.html`, in the `.tools` row, immediately before `sendBtn` |
| Orbit | A session's "Message the agent…" | `buildComposer()` in `orbit/src/sessions.js`, in `.composerBar`, immediately before `send` (after `stopBtn`) |
| Orbit | Diagnose's "Ask a follow-up about this session…" | `openDiagnose()` in `orbit/src/diagnose.js`, in `.composerBar`, immediately before `send` |

Not in: the notes, system-prompt, edit-message, settings, search and dialog fields.

The mic is its own button beside Send. It never swaps places with Send or Aura's Stop.

## Look (approved render)

CSS goes in one shared `<style id="page-dictation-css">` block (see "One copy of the code"):

```css
:root{--listen:#0f766e;--listen-soft:rgba(20,184,166,.13);--warn:#a8550a;--warn-soft:rgba(217,119,6,.11)}
@media (prefers-color-scheme: dark){:root:not([data-theme="light"]){--listen:#2dd4bf;--listen-soft:rgba(45,212,191,.13);--warn:#fbbf24;--warn-soft:rgba(251,191,36,.10)}}
:root[data-theme="dark"]{--listen:#2dd4bf;--listen-soft:rgba(45,212,191,.13);--warn:#fbbf24;--warn-soft:rgba(251,191,36,.10)}
.mic{width:34px;height:34px;border-radius:11px;display:inline-grid;place-items:center;color:var(--muted);position:relative;flex:none;transition:background .15s,color .15s}
.mic:hover{background:var(--hover);color:var(--text)}
.mic svg.i{width:19px;height:19px}
.mic.on{background:var(--listen-soft);color:var(--listen);box-shadow:inset 0 0 0 1.5px color-mix(in srgb,var(--listen) 75%,transparent)}
.mic.on::before{content:"";position:absolute;inset:-4px;border-radius:15px;border:2px solid var(--listen);opacity:.32;transform:scale(calc(1 + .16*var(--lvl,0)));transition:transform .08s linear}
.mic.busy::after{content:"";position:absolute;inset:-3px;border-radius:14px;padding:2px;background:conic-gradient(var(--listen) calc(var(--p,.28)*360deg),transparent 0);
  -webkit-mask:linear-gradient(#000 0 0) content-box,linear-gradient(#000 0 0);-webkit-mask-composite:xor;mask-composite:exclude}
.mic.busy:not([style*="--p"])::after{animation:micspin 1s linear infinite}
@keyframes micspin{to{transform:rotate(360deg)}}
.mic.off{color:var(--muted);opacity:.75}
.vline{max-width:780px;margin:0 auto 8px;display:flex;align-items:center;gap:9px;padding:7px 12px;border-radius:11px;font-size:12.5px;line-height:1.4;color:var(--text2);background:var(--hover)}
.vline svg.i{width:15px;height:15px;flex:none}
.vline.listen{color:var(--listen);background:var(--listen-soft)}
.vline.listen b{font-weight:600}
.vline.warn{color:var(--warn);background:var(--warn-soft)}
.vline .bars{display:inline-flex;align-items:center;gap:2px;height:14px;flex:none}
.vline .bars i{width:2.5px;border-radius:2px;background:currentColor;transition:height .08s linear}
.vline .act{margin-left:auto;font-weight:600;color:var(--text);padding:3px 9px;border-radius:7px;background:var(--hover);white-space:nowrap}
.vline .col{display:flex;flex-direction:column;gap:5px;flex:1;min-width:0}
.vline .prog{height:3px;border-radius:2px;background:var(--line2);overflow:hidden}
.vline .prog i{display:block;height:100%;background:var(--listen);border-radius:2px}
@media (prefers-reduced-motion: reduce){.mic.on::before{transform:scale(1.08);transition:none}.vline .bars i{transition:none}.mic.busy::after{animation:none}}
```

Orbit's `.composerBox` is 760 px wide, so the line takes the box's max-width there (`.vline` inside Orbit gets
`max-width:760px`; in Diagnose `max-width:none`).

Icons (24-unit, stroke 1.8, the apps' `icon()` style): `mic` = `<rect x="9" y="3" width="6" height="11.5" rx="3"/><path d="M5.5 11.5a6.5 6.5 0 0 0 13 0"/><path d="M12 18v3"/>`;
`micOff` = the same plus `<path d="M4 4l16 16"/>`; `micStop` = `<rect x="8" y="8" width="8" height="8" rx="2" fill="currentColor" stroke="none"/>`;
`download` = `<path d="M12 4v11M7 10.5l5 5 5-5"/><path d="M5 20h14"/>`. Build SVG with DOM calls, not `innerHTML` with
anything but these constants. All copy goes in with `textContent` (the bold lead is a `<b>` element made with DOM calls).

### The mic button

- **Idle:** `mic` glyph, muted. Tooltip "Dictate (⌘D) · nothing is sent until you press Enter" ("Ctrl+D" off the Mac).
  `aria-label="Dictate"`.
- **Getting ready / downloading:** `.busy`. A spinning arc while preparing; `--p` set to the real fraction while a language
  downloads.
- **Listening:** `.on`, `micStop` glyph, `--lvl` follows the voice level (0…1). Tooltip "Stop dictating (⌘D)".
  `aria-label="Stop dictating"`, `aria-pressed="true"`.
- **Can't listen** (denied, unavailable): `.off`, `micOff` glyph. A click shows the reason line again.
- **Not shown at all:** Linux desktop, Firefox, any browser without `SpeechRecognition`/`webkitSpeechRecognition`.

### The line above the box

Inserted just before the `.box` (Aura) / `.composerBox` (Orbit). `{App}` is "Page Aura" or "Page Orbit".

| State | Line | Class |
|---|---|---|
| Listening on the device | bars + **Listening on this Mac** · nothing is sent until you press Enter (browser on-device: "this computer") | `listen` |
| Listening on a server | bars + **Listening with Apple’s speech service** / **Microsoft’s speech service** / **this browser’s speech service** · nothing is sent until you press Enter | `listen` |
| Getting ready | mic icon + Getting ready to listen… | (plain) |
| Downloading | download icon + Getting {Language} speech for this Mac · 40%. A one-off download that macOS keeps; listening starts by itself. + thin bar (no percent and an indeterminate bar when the fraction is unknown) | (plain) |
| Microphone off (Mac) | micOff + {App} can’t hear you: microphone access is off for {App}. [Open Settings] | `warn` |
| Speech recognition off (Mac) | micOff + Speech recognition is off for {App}. [Open Settings] | `warn` |
| Microphone off (Windows) | micOff + {App} can’t hear you: microphone access is off for desktop apps. [Open Settings] | `warn` |
| Online speech off (Windows) | micOff + Online speech recognition is off in Windows, so {App} can’t turn speech into text. [Open Settings] | `warn` |
| Microphone blocked (browser) | micOff + {App} can’t hear you: this browser has blocked the microphone for this page. | `warn` |
| Language not supported | micOff + Speech in {Language} can’t be turned into text on this {Device}. | (plain) |
| No recogniser | micOff + This {Device} has no speech recogniser, so the mic is off. | (plain) |
| Interrupted | info + Stopped listening. Your words are kept. (goes away by itself after 4 s) | (plain) |

{Device} is "Mac", "PC" or "computer" (browser). With an empty draft while listening, the placeholder reads
"Listening…" and goes back afterwards. Aura's hint row under the box gains "⌘D dictate" (`Ctrl + D` off the Mac) in the
same keycap style, only where the mic exists.

A visually hidden `aria-live="polite"` element announces "Listening" and "Stopped listening".

## Behaviour

- **Start:** click the mic, or ⌘D (Ctrl+D off the Mac) while that composer's textarea has focus. The first time, the
  system asks for microphone (and on the Mac, speech recognition) permission.
- **Words:** each update replaces only the words still changing (volatile). Finished words (committed) are kept. All of
  it shows in the textarea as plain text.
- **Joining:** the first spoken words join an existing draft with one space, unless the draft is empty or ends in
  whitespace. Newlines become spaces; runs of spaces collapse; the result is never trimmed at the end while volatile
  words may still follow.
- **Each write** sets `ta.value`, then calls the composer's `onWrite(text)` so it can do what its `input` handler does
  (Aura: `p.draft.text = text; autosize(); updateSend()`; Orbit: `fit()`). It does not dispatch a synthetic `input`
  event, because the guard listens to real input.
- **The guard:** a real `input` event (typing, paste, cut, undo), or `ta.value !== lastWritten` when a result arrives,
  cancels the session and drops late results. The words already in the box stay.
- **Stop and keep the words:** mic click, ⌘D/Ctrl+D, Esc (the first Esc stops listening and calls `preventDefault`, so
  Diagnose's modal doesn't close; the next Esc does what it always did), 20 s without new words, 10 min in all. The engine
  finalises the words still changing (wait up to 3 s for them).
- **Cancel (stop now, write nothing more):** Enter or Send (the message goes with what shows), typing, the composer
  being removed for good (pane closed, chat switched, Orbit session left, Diagnose closed, session archived or ended),
  the page going hidden (`visibilitychange` → hidden), another box starting.
- **Composer rebuilt:** Aura rebuilds a pane's composer on `renderPane` (model, effort, tools changes, a reply
  finishing). Sessions are keyed (Aura: `"aura:" + chatId`; Orbit: `"session:" + sessionId`, `"diagnose"`). When a
  composer mounts with the key of the live session, the session re-binds to the new textarea, mic and line, and the
  new textarea gets `lastWritten`. If no composer with that key comes back within 1 s, the session is cancelled.
- **Aura while a reply runs:** dictation works; Enter does nothing (as now).
- **Busy and blocked boxes:** Orbit's composer is hidden for archived/ended sessions; hide → cancel.

## Engines

All engines report the same events (JSON objects with a `t` field):

| Event | Fields | Meaning |
|---|---|---|
| `preparing` | | getting ready |
| `downloading` | `f` (0…1 or null), `language` | a language model is downloading |
| `listening` | `onDevice` (bool), `service` (`"apple"`, `"microsoft"`, `"browser"`, or null when on-device) | the microphone is open |
| `level` | `v` (0…1) | voice level, about 15 Hz |
| `volatile` | `s` | the words still changing (replaces the previous volatile text) |
| `committed` | `s` | finished words (appended) |
| `interrupted` | | the input went away (another app took the mic, a network failure on a server engine); words kept |
| `ended` | | finished after a stop, or the engine ended by itself |
| `denied` | `what` (`"microphone"` or `"speech"`) | permission is off |
| `unavailable` | `why` (`"language"` or `"noRecognizer"`), `language` | can't listen here |
| `failed` | | the engine broke while listening; the session stops, words kept |

### Desktop (Tauri): native, through Rust

JS sees `window.__TAURI__.core` and calls `invoke("dictation_supported")` once → `{supported, platform}` where platform is
`"mac"`, `"windows"` or `"none"`. Linux returns `supported:false` and the mic is not shown. The desktop app never falls
back to the webview's own `webkitSpeechRecognition`.

Commands (new `desktop/src-tauri/src/dictation.rs`, registered in `lib.rs`):

- `dictation_supported() -> {supported: bool, platform: String}`
- `dictation_start(window: tauri::Window) -> u64` (session id). Cancels any live session first (app-wide, every window;
  the old owner gets `{id, t:"ended"}`). Remembers the owner window's label.
- `dictation_stop(id: u64)` (finalise) and `dictation_cancel(id: u64)` (drop). Stale ids are ignored.
- `dictation_open_settings(what: String)` (`"microphone"` | `"speech"`). Mac:
  `x-apple.systempreferences:com.apple.preference.security?Privacy_Microphone` / `?Privacy_SpeechRecognition`. Windows:
  `ms-settings:privacy-microphone` / `ms-settings:privacy-speech`. Opened from Rust (tauri-plugin-opener's Rust API, or
  `open` / `explorer.exe`), never from a URL the page supplies.

Events go to the owner window only, as Tauri event `"dictation"` with payload `{id, ...event}`. JS drops events whose
`id` is not the live session. A window closing cancels its session.

Platform modules behind one interface (so each can be built and tested alone):

```rust
// dictation.rs
pub(crate) type Emit = std::sync::Arc<dyn Fn(serde_json::Value) + Send + Sync>;
pub(crate) trait Session: Send { fn stop(&self); fn cancel(&self); }
#[cfg(target_os = "macos")]   #[path = "dictation_macos.rs"]   mod platform;
#[cfg(target_os = "windows")] #[path = "dictation_windows.rs"] mod platform;
#[cfg(not(any(target_os = "macos", target_os = "windows")))] mod platform { /* supported() = false */ }
// each platform module: pub fn supported() -> bool; pub fn start(emit: super::Emit) -> Box<dyn super::Session>;
```

Pure helpers that every OS can unit-test live in `dictation.rs` without a cfg: event construction, one-line cleanup
is NOT done here (JS does it), the Windows error mapping (`fn windows_status_event(code: i32 /*HRESULT*/, status: Option<i32>) -> serde_json::Value`),
the settings URL for each platform/what, and the session-ownership bookkeeping.

#### macOS: Swift, linked into the Rust app

- One Swift file, `desktop/src-tauri/src/dictation_macos.swift` (no new folders), ported from Page Studio:
  `~/projects/page/Sources/ClaudePowerMode/DictationAnalyzerEngine.swift`, `DictationRecognizerEngine.swift`,
  `DictationMicTap.swift`, `DictationEngine.swift`, and the probe/permissions in `DictationController.swift`
  (`DictationProbe`, `DictationPermissions`) plus the engine choice in `~/projects/page/Sources/PageCore/Dictation.swift`.
  Keep their behaviour: `SpeechTranscriber` with `[.volatileResults, .fastResults]`, `DictationTranscriber`
  `.progressiveLongDictation`, `AssetInventory` download with progress, `SFSpeechRecognizer` on-device when supported,
  else Apple's server with a new request at 55 s carrying committed words over, RMS level at ~15 Hz.
  `SpeechAnalyzer` code sits behind `#if compiler(>=6.2)` and `@available(macOS 26, *)`, so an older Xcode (CI) still
  builds the `SFSpeechRecognizer` path.
- C ABI with `@_cdecl`: `pd_start(cb, ctx)`, `pd_stop()`, `pd_cancel()`, where
  `cb: @convention(c) (UnsafePointer<CChar>?, UnsafeMutableRawPointer?) -> Void` receives one JSON event string per call
  (from any thread). `dictation_macos.rs` wraps it: a session id, the `Emit`, and a `Box` leaked into `ctx` and freed on
  `ended`/cancel.
- Permissions: `AVCaptureDevice.requestAccess(for: .audio)`, then `SFSpeechRecognizer.requestAuthorization`. Denials →
  `denied`.
- Language: `Locale.current`, mapped with `SpeechTranscriber.supportedLocale(equivalentTo:)` as in Page; the display name
  for the copy comes with `downloading`/`unavailable`.
- Build: `build.rs` compiles the Swift file with `swiftc` when `CARGO_CFG_TARGET_OS == "macos"`, for the cargo `TARGET`
  arch (`arm64-apple-macos12.0` / `x86_64-apple-macos12.0`; the universal CI build runs cargo once per arch), into a
  static library in `OUT_DIR`, and links it with the Speech, AVFoundation and Foundation frameworks and the Swift
  runtime search paths (`xcrun --show-sdk-path`/usr/lib/swift, the toolchain's `usr/lib/swift/macosx`,
  `-Wl,-rpath,/usr/lib/swift`). Rerun only when the Swift file changes. No new crates if it can be helped.
- `tauri.conf.json` and `tauri.orbit.conf.json`: `bundle.macOS.minimumSystemVersion` `"12.0"` (Swift concurrency is in
  the OS from 12), and `bundle.macOS.entitlements` → `Entitlements.plist` with
  `com.apple.security.device.audio-input` (needed the day the app is signed with the hardened runtime).
- `desktop/src-tauri/Info.plist` (merged by Tauri into both apps; no app name in the strings):
  - `NSMicrophoneUsageDescription`: "Uses the microphone only while you dictate a message. What you say is turned into
    text on this Mac, or by Apple's speech service when the Mac can't. It isn't recorded or kept."
  - `NSSpeechRecognitionUsageDescription`: "Turns what you say into text so you can dictate messages. Nothing is sent
    until you press Enter."
  Missing strings make macOS kill the app on the first mic use, so check both built apps' `Contents/Info.plist`, and
  check `tauri dev` too.

#### Windows: `Windows.Media.SpeechRecognition`, in Rust

- `desktop/src-tauri/src/dictation_windows.rs`, with the `windows` crate (the version already in `Cargo.lock`, 0.62)
  as a `[target.'cfg(windows)'.dependencies]` entry with the features it needs (`Media_SpeechRecognition`,
  `Foundation`, `Foundation_Collections`, `Globalization`, `Win32_System_Com` or `Win32_System_WinRT`).
- A worker thread initialised for the MTA. `SpeechRecognizer::new()`; constraint
  `SpeechRecognitionTopicConstraint::Create(SpeechRecognitionScenario::Dictation, "dictation")`;
  `CompileConstraintsAsync().get()`; `ContinuousRecognitionSession().SetAutoStopSilenceTimeout(10 min)`;
  `StartAsync().get()`.
- `HypothesisGenerated` → `volatile` (the hypothesis text); `ContinuousRecognitionSession.ResultGenerated` → `committed`
  (`Result().Text()`); `Completed` → `ended` (Success, UserCanceled, TimeoutExceeded, PauseLimitExceeded),
  `interrupted` (NetworkFailure, AudioQualityFailure), `denied microphone` (MicrophoneUnavailable when access is off);
  `StateChanged` (`SpeechDetected`/`SoundStarted` → level 0.6, `SoundEnded`/`Idle` → 0.15) since Windows gives no level.
- HRESULT `0x80045509` (speech privacy policy not accepted) → `denied speech`; `0x80070005` (E_ACCESSDENIED) → `denied
  microphone`; `TopicLanguageNotSupported` → `unavailable language` with `SpeechRecognizer::SystemSpeechLanguage()
  .DisplayName()`.
- `listening` has `onDevice:false, service:"microsoft"` (dictation goes through Microsoft's online service).
- `stop()` → `StopAsync()` (finalises; `Completed` follows); `cancel()` → `CancelAsync()`.
- Verification here: `cargo check --target x86_64-pc-windows-msvc` on a scratch crate holding only this module and its
  `windows` dependency, plus the GitHub "Desktop app" test build (workflow_dispatch, empty version) on the branch.

### Browsers: the Web Speech API

- `const SR = window.SpeechRecognition || window.webkitSpeechRecognition`; none → no mic.
- `continuous = true`, `interimResults = true`, `lang = navigator.language`.
- On-device first where the browser offers it (Chrome's `processLocally`, feature-detected):
  `await SR.available({langs:[lang], processLocally:true})`: `"available"` → `processLocally = true` and
  `listening {onDevice:true}` ("Listening on this computer"); `"downloadable"` → call
  `SR.install({langs:[lang], processLocally:true})` in the background (don't wait) and use the server this time;
  anything else, or no `available` → the server, `listening {onDevice:false, service:"browser"}`.
- `onresult`: walk `event.results` from `event.resultIndex`; each final result not yet committed → `committed`; the
  non-final ones joined → `volatile`.
- `onend` while still listening → start again (browsers end after a pause or ~60 s); count it toward the 20 s silence.
- `onerror`: `not-allowed` → `denied microphone`; `service-not-allowed` → `unavailable noRecognizer`; `no-speech`,
  `aborted` → restart/ignore; `network`, `audio-capture` → `interrupted`; `language-not-supported` → `unavailable
  language` (language name from `Intl.DisplayNames`).
- Level: no audio level from the API, so `onspeechstart` → 0.6, `onspeechend` → 0.15, each result nudges it to 0.75 and
  it eases back. (No second `getUserMedia` stream.)
- Stop: `recognition.stop()` (final results arrive, then `onend` → `ended`). Cancel: `recognition.abort()`.

## One copy of the code

- `page-aura.html` gets two new blocks before its main `<script type="module">`: `<style id="page-dictation-css">` and
  a classic `<script id="page-dictation">` that defines `window.PageDictation` and works under Node too
  (`if (typeof module !== "undefined") module.exports = PageDictation`).
- `tools/build-orbit.py` copies both blocks into `page-orbit.html` through a new `<!--@DICTATION-->` marker in
  `orbit/src/shell.html` (like the vendor blocks), and the existing CSP step hashes it. After any edit:
  `python3 tools/update-csp.py page-aura.html` and `python3 tools/build-orbit.py`.
- `PageDictation` holds:
  - Pure logic, unit-tested: `Draft` (`constructor(base)`, `setVolatile(s)`, `commit(s)`, `text`, `finish()`),
    `oneLine(s)`, `userEdited(current, lastWritten)`, `Clock` (`silence 20 s`, `cap 10 min`, `heardWords(t)`,
    `expired(t)` → `"silence" | "cap" | null`, `nextDeadline`), `copy(state, ctx)` → `{cls, icon, lead, text, action,
    progress}` for every line above, and `mapWebSpeechError(code)` → event.
  - The engines: `NativeEngine` (Tauri commands + `"dictation"` events) and `WebSpeechEngine`.
  - The controller (one per window): `PageDictation.mount({key, ta, bar, before, lineHost, lineBefore, app, onWrite,
    hintEl?}) → {destroy()}` and `PageDictation.supported()` (a promise of `{supported, platform, device}`).
  - The key handling: ⌘D/Ctrl+D and Esc on the mounted textarea.

## Privacy and security (for the guides)

- Audio goes from the microphone to the operating system's or browser's recogniser only: on the Mac first; Apple's,
  Microsoft's or the browser's speech service otherwise, and the line says which while it listens.
- The apps never write audio to disk, never send it anywhere themselves and never log transcripts. The words go into the
  draft, and nowhere else until you send.
- The microphone is open only while the stop square shows.
- The CSP doesn't change: speech needs no new network permission from the page.

## Build plan

1. **Sonnet, web:** the shared blocks, the Aura and Orbit wiring, the Web Speech and native engines in JS,
   `build-orbit.py`, CSP.
2. **Sonnet, Mac + Rust:** `dictation.rs`, the Swift engine, `build.rs`, `Info.plist`, entitlements, both configs.
3. **Sonnet, Windows:** `dictation_windows.rs`, the `windows` features, the cross-target check.
4. **Haiku, tests:** `node --test tools/dictation.test.mjs` (pure logic, the controller with a fake engine and a fake
   DOM-free textarea, the Web Speech result walk, error mapping), and Rust unit tests in `dictation.rs`.
5. **Opus, verification:** builds of both desktop apps, Info.plist strings, renders against the approved board, a
   browser run with a fake `SpeechRecognition`, the test suites, and a spoken test on this Mac. Then the guides, the
   root README, the product page and screenshots.
