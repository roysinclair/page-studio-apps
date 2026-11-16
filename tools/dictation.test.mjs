// Unit tests for the voice-input ("dictation") script shared by page-aura.html and page-orbit.html.
// Spec: docs/voice-input.md. Run from anywhere:  node --test tools/dictation.test.mjs
// No installs: Node's built-in test runner. The block is read out of the HTML and evaluated with a fake `module`.
import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const AURA = path.join(ROOT, "page-aura.html");
const ORBIT = path.join(ROOT, "page-orbit.html");

const OPEN = '<script id="page-dictation">';
function blockOf(file){
  const html = readFileSync(file, "utf8");
  const start = html.indexOf(OPEN);
  assert.notEqual(start, -1, `no ${OPEN} in ${file}`);
  const from = start + OPEN.length;
  const end = html.indexOf("</script>", from);
  assert.notEqual(end, -1, `unterminated page-dictation block in ${file}`);
  return html.slice(from, end);
}

const SRC = blockOf(AURA);
const mod = { exports: {} };
new Function("module", SRC)(mod);
const PD = mod.exports;

const MAC = { app: "Page Aura", platform: "mac", device: "Mac" };
const WIN = { app: "Page Aura", platform: "windows", device: "PC" };
const WEB = { app: "Page Aura", platform: "browser", device: "computer" };
const NOTHING = " · nothing is sent until you press Enter";
const flush = ()=> new Promise((r)=> setImmediate(r));

/* ---------- fakes ---------- */

function fakeEngine(emit){
  return {
    emit, started: false, stopped: 0, cancelled: 0,
    start(){ this.started = true; return Promise.resolve(); },
    stop(){ this.stopped++; },
    cancel(){ this.cancelled++; },
  };
}

/** A textarea: value, placeholder, listeners (fire() calls them), dispatchEvent recorded. */
function fakeTA(value = ""){
  const listeners = {};
  return {
    value, placeholder: "Reply…", scrollHeight: 0, scrollTop: 0, dispatched: [],
    focus(){},
    addEventListener(t, f){ (listeners[t] ||= []).push(f); },
    removeEventListener(t, f){ listeners[t] = (listeners[t] || []).filter((x)=> x !== f); },
    dispatchEvent(e){ this.dispatched.push(e); return true; },
    fire(t, ev = {}){ for(const f of [...(listeners[t] || [])]) f(ev); },
  };
}

/** Just enough DOM for the mic button and the line: elements, text nodes, attributes, children, click listeners. */
function fakeDoc(){
  const detach = (x)=>{ const p = x.parentNode; if(p){ const i = p.children.indexOf(x); if(i >= 0) p.children.splice(i, 1); x.parentNode = null; } };
  const attach = (p, x)=>{ detach(x); p.children.push(x); x.parentNode = p; };
  const make = (tag)=>{
    const n = { tag, nodeType: 1, children: [], parentNode: null, attrs: {}, listeners: {}, style: {}, className: "", title: "", innerHTML: "" };
    n.setAttribute = (k, v)=>{ n.attrs[k] = String(v); };
    n.getAttribute = (k)=> (k in n.attrs ? n.attrs[k] : null);
    n.style.setProperty = (k, v)=>{ n.style[k] = String(v); };
    n.style.removeProperty = (k)=>{ delete n.style[k]; };
    const node = (x)=> x && x.nodeType ? x : {nodeType: 3, textContent: String(x), parentNode: null};
    n.append = (...xs)=>{ for(const x of xs) attach(n, node(x)); };
    n.insertBefore = (x, before)=>{ detach(x); const i = before ? n.children.indexOf(before) : -1; if(i < 0) n.children.push(x); else n.children.splice(i, 0, x); x.parentNode = n; return x; };
    n.replaceChildren = (...xs)=>{ for(const k of n.children) k.parentNode = null; n.children = []; n.append(...xs); };
    n.remove = ()=> detach(n);
    n.addEventListener = (t, f)=>{ (n.listeners[t] ||= []).push(f); };
    n.removeEventListener = ()=>{};
    n.focus = ()=>{};
    n.getClientRects = ()=> [1];
    return n;
  };
  const doc = {
    hidden: false, listeners: {},
    createElement: (t)=> make(t),
    createElementNS: (ns, t)=> make(t),
    createTextNode: (s)=> ({ nodeType: 3, textContent: String(s), parentNode: null }),
    addEventListener: (t, f)=>{ (doc.listeners[t] ||= []).push(f); },
  };
  doc.body = make("body");
  return doc;
}
const textOf = (n)=> n.nodeType === 3 ? n.textContent : (n.children || []).map(textOf).join("");
const findTag = (n, tag)=> (n.children || []).find((c)=> c.tag === tag);
const clickOf = (n)=> (n.listeners.click || []).forEach((f)=> f({}));

/** Controller with fake clock, timers and engine. Time is h.t (ms). */
function harness(opts = {}){
  const h = { t: 0, engines: [], writes: [], announced: [], opened: [], timers: new Map(), intervals: new Map(), ids: 0 };
  h.doc = opts.withDoc ? fakeDoc() : null;
  h.ctl = PD.createController({
    doc: h.doc,
    now: ()=> h.t,
    setInterval: (f)=>{ const id = ++h.ids; h.intervals.set(id, f); return id; },
    clearInterval: (id)=>{ h.intervals.delete(id); },
    setTimeout: (f, ms)=>{ const id = ++h.ids; h.timers.set(id, {f, ms}); return id; },
    clearTimeout: (id)=>{ h.timers.delete(id); },
    supported: async ()=> ({ supported: true, platform: opts.platform || "mac", device: opts.device || "Mac" }),
    isMac: opts.isMac === undefined ? true : opts.isMac,
    makeEngine: (info, emit)=>{ const e = fakeEngine(emit); h.engines.push(e); return e; },
    openSettings: (what)=>{ h.opened.push(what); },
    announce: (text)=>{ h.announced.push(text); },
  });
  return h;
}
/** Fires the timers set with this delay (the fake clock does not run by itself). */
function fireTimers(h, ms){ for(const [id, t] of [...h.timers]) if(t.ms === ms){ h.timers.delete(id); t.f(); } }
function fireTicks(h){ for(const f of [...h.intervals.values()]) f(); }
function domOf(h){
  const bar = h.doc.createElement("div"), before = h.doc.createElement("button"), lineHost = h.doc.createElement("div"), lineBefore = h.doc.createElement("div");
  bar.append(before); lineHost.append(lineBefore);
  return { bar, before, lineHost, lineBefore };
}
/** Mounts a composer and starts dictation from it. Asserts that the engine really started. */
async function startSession(h, ta, opts = {}){
  const writes = [];
  const handle = h.ctl.mount({ key: opts.key || "aura:1", ta, app: "Page Aura", ...(opts.dom || {}),
    onWrite: (t)=>{ writes.push(t); h.writes.push(t); } });
  await h.ctl.supported(); await flush();
  handle.start();
  const eng = h.engines[h.engines.length - 1];
  assert.ok(eng && eng.started, "the engine was made and started");
  return { handle, eng, ta, writes };
}

/* ---------- the file itself ---------- */

describe("the block", ()=>{
  test("page-orbit.html carries the same dictation block as page-aura.html", ()=>{
    assert.equal(blockOf(ORBIT), blockOf(AURA));
  });

  test("it exposes the documented pure parts and the controller", ()=>{
    for(const name of ["Draft", "Clock", "oneLine", "userEdited", "copy", "mapWebSpeechError", "createController", "NativeEngine", "WebSpeechEngine"])
      assert.ok(PD[name], `${name} is exported`);
    assert.equal(typeof PD.mount, "function");
    assert.equal(typeof PD.supported, "function");
  });

  test("nothing in the block records, stores, logs, uploads or submits anything", ()=>{
    const forbidden = [/\bfetch\s*\(/, /XMLHttpRequest/, /sendBeacon/, /WebSocket/, /localStorage/, /sessionStorage/,
      /indexedDB/, /MediaRecorder/, /console\./, /requestSubmit/, /\.submit\s*\(/];
    for(const re of forbidden) assert.doesNotMatch(SRC, re, `the block must not use ${re}`);
  });
});

/* ---------- oneLine ---------- */

describe("oneLine", ()=>{
  test("collapses newlines, CRLF, tabs, U+0085, U+2028 and U+2029 into single spaces", ()=>{
    assert.equal(PD.oneLine("a\r\nb\tc  d\u0085e\u2028f\u2029g"), "a b c d e f g");
  });

  test("trims the ends", ()=>{
    assert.equal(PD.oneLine("  \n hi \t "), "hi");
    assert.equal(PD.oneLine("   "), "");
  });

  test("null and undefined are empty", ()=>{
    assert.equal(PD.oneLine(null), "");
    assert.equal(PD.oneLine(undefined), "");
  });

  test("never returns a line break, a tab, a CR or a double space (random inputs)", ()=>{
    const alphabet = ["a", "b", " ", "\n", "\r", "\t", "\u0085", "\u2028", "\u2029", " ", "x"];
    let seed = 12345;
    const rnd = ()=> (seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff;
    for(let i = 0; i < 2000; i++){
      let s = ""; const n = Math.floor(rnd() * 20);
      for(let j = 0; j < n; j++) s += alphabet[Math.floor(rnd() * alphabet.length)];
      const out = PD.oneLine(s);
      assert.doesNotMatch(out, /[\n\r\t\u0085\u2028\u2029]/, `input ${JSON.stringify(s)}`);
      assert.doesNotMatch(out, /\s\s/, `input ${JSON.stringify(s)}`);
      assert.doesNotMatch(out, /^\s|\s$/, `input ${JSON.stringify(s)}`);
    }
  });
});

/* ---------- Draft ---------- */

describe("Draft", ()=>{
  test("an empty draft with no words is empty", ()=>{
    const d = new PD.Draft("");
    assert.equal(d.text, "");
    assert.equal(d.hasWords, false);
    assert.equal(new PD.Draft(null).text, "");
  });

  test("the first words join the draft with exactly one space", ()=>{
    const d = new PD.Draft("Hi there");
    d.setVolatile("world");
    assert.equal(d.text, "Hi there world");
    assert.equal(d.hasWords, true);
  });

  test("no double space when the draft already ends in whitespace", ()=>{
    const d = new PD.Draft("hello ");
    d.setVolatile("world");
    assert.equal(d.text, "hello world");
    const e = new PD.Draft("hello\t");
    e.commit("world");
    assert.equal(e.text, "hello\tworld");
  });

  test("with no draft, the words stand alone (no leading space)", ()=>{
    const d = new PD.Draft("");
    d.commit("hello");
    d.commit("world");
    assert.equal(d.text, "hello world");
  });

  test("a draft ending in a newline keeps it and gets no extra space", ()=>{
    const d = new PD.Draft("x\n");
    d.commit("y");
    assert.equal(d.text, "x\ny");
  });

  test("a typed multi-line draft is kept exactly; only the spoken part is added after it", ()=>{
    const d = new PD.Draft("a\nb");
    d.commit("c");
    assert.equal(d.text, "a\nb c");
    assert.equal(d.text.slice(0, 3), "a\nb");
    assert.equal(d.text.slice(3), " c");
  });

  test("setVolatile replaces the volatile tail", ()=>{
    const d = new PD.Draft("");
    d.setVolatile("a b");
    d.setVolatile("a bc");
    assert.equal(d.text, "a bc");
    d.setVolatile("");
    assert.equal(d.text, "");
    assert.equal(d.hasWords, false);
  });

  test("commit appends to the committed words and clears the volatile tail", ()=>{
    const d = new PD.Draft("");
    d.commit("one");
    d.commit("two");
    assert.equal(d.text, "one two");
    d.setVolatile("three");
    assert.equal(d.text, "one two three");
    d.commit("three");
    assert.equal(d.text, "one two three");
    assert.equal(d.spoken, "one two three");
  });

  test("a volatile result that is finalised replaces itself, it is not duplicated", ()=>{
    const d = new PD.Draft("");
    d.setVolatile("wor");
    d.setVolatile("worl");
    d.commit("world");
    assert.equal(d.text, "world");
  });

  test("commit of empty text clears the volatile tail and keeps the committed words", ()=>{
    const d = new PD.Draft("");
    d.commit("a");
    d.setVolatile("b");
    d.commit("");
    assert.equal(d.text, "a");
    assert.equal(d.spoken, "a");
  });

  test("spoken whitespace of every kind never reaches the text as a line break", ()=>{
    const d = new PD.Draft("");
    d.commit("one\r\ntwo\tthree\u0085four\u2028five\u2029six\n");
    d.setVolatile("seven\n\n");
    assert.equal(d.text, "one two three four five six seven");
    assert.doesNotMatch(d.text, /[\n\r\t\u0085\u2028\u2029]/);
  });

  test("spoken words after a draft never add a line break", ()=>{
    const d = new PD.Draft("base");
    d.setVolatile("x\ny");
    assert.equal(d.text.slice("base".length), " x y");
  });

  test("finish() is the text", ()=>{
    const d = new PD.Draft("x");
    d.commit("y");
    assert.equal(d.finish(), d.text);
  });

  test("a volatile that is only whitespace adds nothing", ()=>{
    const d = new PD.Draft("");
    d.setVolatile("   ");
    assert.equal(d.hasWords, false);
    assert.equal(d.text, "");
  });
});

/* ---------- userEdited ---------- */

describe("userEdited", ()=>{
  test("the same text is not an edit; different text is", ()=>{
    assert.equal(PD.userEdited("hello", "hello"), false);
    assert.equal(PD.userEdited("hello!", "hello"), true);
    assert.equal(PD.userEdited("hello", "hello "), true);
  });

  test("null and undefined count as empty", ()=>{
    assert.equal(PD.userEdited(null, ""), false);
    assert.equal(PD.userEdited(undefined, ""), false);
    assert.equal(PD.userEdited(undefined, "x"), true);
  });
});

/* ---------- Clock ---------- */

describe("Clock", ()=>{
  test("the constants are 20 s of silence and 10 min in all", ()=>{
    assert.equal(PD.Clock.silence, 20000);
    assert.equal(PD.Clock.cap, 600000);
  });

  test("with no words, the silence deadline comes 20 s after the start", ()=>{
    const c = new PD.Clock(1000);
    assert.equal(c.silenceDeadline, 21000);
    assert.equal(c.capDeadline, 601000);
    assert.equal(c.nextDeadline, 21000);
    assert.equal(c.expired(20999), null);
    assert.equal(c.expired(21000), "silence");
  });

  test("heard words push the silence deadline on; an earlier time is ignored", ()=>{
    const c = new PD.Clock(1000);
    c.heardWords(15000);
    assert.equal(c.silenceDeadline, 35000);
    assert.equal(c.expired(21000), null);
    c.heardWords(5000);
    assert.equal(c.silenceDeadline, 35000);
    assert.equal(c.expired(34999), null);
    assert.equal(c.expired(35000), "silence");
  });

  test("the next deadline is capped at 10 min from the start", ()=>{
    const c = new PD.Clock(0);
    c.heardWords(590000);
    assert.equal(c.silenceDeadline, 610000);
    assert.equal(c.nextDeadline, 600000);
    assert.equal(c.expired(599999), null);
    assert.equal(c.expired(600000), "cap");
  });

  test("when both have passed, the cap wins", ()=>{
    const c = new PD.Clock(0);
    c.heardWords(590000);
    assert.equal(c.expired(605000), "cap");
    assert.equal(c.expired(615000), "cap");
  });
});

/* ---------- copy ---------- */

describe("copy", ()=>{
  test("listening on the device: the bars, the device name, and that nothing is sent", ()=>{
    const c = PD.copy({t:"listening", onDevice:true, service:null}, MAC);
    assert.equal(c.cls, "listen");
    assert.equal(c.icon, "bars");
    assert.equal(c.lead, "Listening on this Mac");
    assert.equal(c.lead + c.text, "Listening on this Mac · nothing is sent until you press Enter");
    assert.equal(c.text, NOTHING);
    assert.equal(c.action, null);
    assert.equal(c.progress, null);
  });

  test("listening on the device in a browser says this computer", ()=>{
    const c = PD.copy({t:"listening", onDevice:true, service:null}, WEB);
    assert.equal(c.lead, "Listening on this computer");
  });

  test("listening on a server names that service (curly apostrophes, as in the spec)", ()=>{
    assert.equal(PD.copy({t:"listening", onDevice:false, service:"apple"}, MAC).lead, "Listening with Apple’s speech service");
    assert.equal(PD.copy({t:"listening", onDevice:false, service:"microsoft"}, WIN).lead, "Listening with Microsoft’s speech service");
    assert.equal(PD.copy({t:"listening", onDevice:false, service:"browser"}, WEB).lead, "Listening with this browser’s speech service");
  });

  test("every listening line says nothing is sent until Enter, and a server line names its service", ()=>{
    const states = [
      {t:"listening", onDevice:true, service:null}, {t:"listening", onDevice:false, service:"apple"},
      {t:"listening", onDevice:false, service:"microsoft"}, {t:"listening", onDevice:false, service:"browser"},
    ];
    for(const ctx of [MAC, WIN, WEB]) for(const s of states){
      const c = PD.copy(s, ctx);
      assert.ok(c.text.includes("nothing is sent until you press Enter"), `${JSON.stringify(s)} on ${ctx.platform}`);
      if(!s.onDevice) assert.match(c.lead, /service$/, `${JSON.stringify(s)} names the service`);
    }
  });

  test("getting ready: plain line with the mic glyph", ()=>{
    assert.deepEqual(PD.copy({t:"preparing"}, MAC), {cls:"", icon:"mic", lead:"", text:"Getting ready to listen…", action:null, progress:null});
  });

  test("downloading shows the language, the percent and a bar at that fraction", ()=>{
    const c = PD.copy({t:"downloading", f:0.4, language:"German"}, MAC);
    assert.equal(c.icon, "download");
    assert.equal(c.cls, "");
    assert.equal(c.text, "Getting German speech for this Mac · 40%. A one-off download that macOS keeps; listening starts by itself.");
    assert.equal(c.progress, 0.4);
    assert.equal(PD.copy({t:"downloading", f:0.5, language:"German"}, MAC).progress, 0.5);
  });

  test("downloading with an unknown fraction: no percent and an indeterminate bar", ()=>{
    const c = PD.copy({t:"downloading", f:null, language:"French"}, WIN);
    assert.equal(c.text, "Getting French speech for this PC. A one-off download that macOS keeps; listening starts by itself.");
    assert.equal(c.progress, "indeterminate");
  });

  test("downloading clamps the fraction to 0..1", ()=>{
    assert.equal(PD.copy({t:"downloading", f:1.7, language:"German"}, MAC).progress, 1);
    assert.equal(PD.copy({t:"downloading", f:-3, language:"German"}, MAC).progress, 0);
  });

  test("denied microphone on the Mac: warn, and an Open Settings action for the microphone", ()=>{
    const c = PD.copy({t:"denied", what:"microphone"}, MAC);
    assert.equal(c.cls, "warn");
    assert.equal(c.icon, "micOff");
    assert.equal(c.lead + c.text, "Page Aura can’t hear you: microphone access is off for Page Aura.");
    assert.deepEqual(c.action, {label:"Open Settings", what:"microphone"});
  });

  test("denied speech recognition on the Mac: Open Settings for speech", ()=>{
    const c = PD.copy({t:"denied", what:"speech"}, MAC);
    assert.equal(c.cls, "warn");
    assert.equal(c.text, "Speech recognition is off for Page Aura.");
    assert.deepEqual(c.action, {label:"Open Settings", what:"speech"});
  });

  test("denied on Windows: microphone for desktop apps, and online speech", ()=>{
    const mic = PD.copy({t:"denied", what:"microphone"}, WIN);
    assert.equal(mic.text, "Page Aura can’t hear you: microphone access is off for desktop apps.");
    assert.deepEqual(mic.action, {label:"Open Settings", what:"microphone"});
    const speech = PD.copy({t:"denied", what:"speech"}, WIN);
    assert.equal(speech.text, "Online speech recognition is off in Windows, so Page Aura can’t turn speech into text.");
    assert.deepEqual(speech.action, {label:"Open Settings", what:"speech"});
    assert.equal(speech.cls, "warn");
  });

  test("denied in a browser: warn, the blocked-microphone sentence, and no settings button", ()=>{
    const c = PD.copy({t:"denied", what:"microphone"}, WEB);
    assert.equal(c.cls, "warn");
    assert.equal(c.text, "Page Aura can’t hear you: this browser has blocked the microphone for this page.");
    assert.equal(c.action, null);
  });

  test("language not supported names the language and the device", ()=>{
    const c = PD.copy({t:"unavailable", why:"language", language:"German"}, MAC);
    assert.equal(c.cls, "");
    assert.equal(c.icon, "micOff");
    assert.equal(c.text, "Speech in German can’t be turned into text on this Mac.");
    assert.equal(c.action, null);
    assert.equal(PD.copy({t:"unavailable", why:"language"}, WEB).text, "Speech in this language can’t be turned into text on this computer.");
  });

  test("no recogniser says which device has none", ()=>{
    const c = PD.copy({t:"unavailable", why:"noRecognizer"}, MAC);
    assert.equal(c.text, "This Mac has no speech recogniser, so the mic is off.");
    assert.equal(c.cls, "");
    assert.equal(PD.copy({t:"unavailable", why:"noRecognizer"}, WEB).text, "This computer has no speech recogniser, so the mic is off.");
  });

  test("interrupted and failed both say the words are kept", ()=>{
    for(const t of ["interrupted", "failed"]){
      const c = PD.copy({t}, MAC);
      assert.equal(c.icon, "info");
      assert.equal(c.text, "Stopped listening. Your words are kept.");
      assert.equal(c.cls, "");
    }
  });

  test("events that have no line return null", ()=>{
    assert.equal(PD.copy({t:"level", v:0.4}, MAC), null);
    assert.equal(PD.copy({t:"volatile", s:"hi"}, MAC), null);
    assert.equal(PD.copy({t:"ended"}, MAC), null);
    assert.equal(PD.copy(null, MAC), null);
  });

  test("without a context it still reads (device defaults to computer, app to Page)", ()=>{
    assert.equal(PD.copy({t:"listening", onDevice:true}).lead, "Listening on this computer");
    assert.equal(PD.copy({t:"denied", what:"microphone"}).text, "Page can’t hear you: this browser has blocked the microphone for this page.");
  });
});

/* ---------- mapWebSpeechError ---------- */

describe("mapWebSpeechError", ()=>{
  test("not-allowed is denied for the microphone", ()=>{
    assert.deepEqual(PD.mapWebSpeechError("not-allowed"), {t:"denied", what:"microphone"});
  });

  test("service-not-allowed means no recogniser", ()=>{
    assert.deepEqual(PD.mapWebSpeechError("service-not-allowed"), {t:"unavailable", why:"noRecognizer"});
  });

  test("no-speech and aborted are ignored (the engine restarts by itself)", ()=>{
    assert.equal(PD.mapWebSpeechError("no-speech"), null);
    assert.equal(PD.mapWebSpeechError("aborted"), null);
  });

  test("network and audio-capture interrupt, keeping the words", ()=>{
    assert.deepEqual(PD.mapWebSpeechError("network"), {t:"interrupted"});
    assert.deepEqual(PD.mapWebSpeechError("audio-capture"), {t:"interrupted"});
  });

  test("language-not-supported is unavailable for the language, named by Intl.DisplayNames", ()=>{
    const expected = new Intl.DisplayNames(["en"], {type:"language"}).of("en-GB");
    assert.deepEqual(PD.mapWebSpeechError("language-not-supported", "en-GB"), {t:"unavailable", why:"language", language: expected});
    assert.equal(PD.languageName("en-GB"), expected);
    assert.equal(typeof PD.mapWebSpeechError("language-not-supported").language, "string");
  });

  test("any other error fails the session", ()=>{
    assert.deepEqual(PD.mapWebSpeechError("something-new"), {t:"failed"});
    assert.deepEqual(PD.mapWebSpeechError(undefined), {t:"failed"});
  });
});

/* ---------- WebSpeechEngine ---------- */

function fakeSR({available} = {}){
  const made = [];
  class Rec{
    constructor(){ made.push(this); this.started = 0; this.stopped = 0; this.aborted = 0; }
    start(){ this.started++; }
    stop(){ this.stopped++; }
    abort(){ this.aborted++; }
  }
  if(available) Rec.available = available;
  return {SR: Rec, made};
}
const alt = (text, isFinal)=> Object.assign([{transcript: text}], {isFinal});

describe("WebSpeechEngine", ()=>{
  test("the result walk: each new final result is committed once; the rest is the volatile text", ()=>{
    const events = [];
    const eng = new PD.WebSpeechEngine((e)=> events.push(e), {SR: null, lang: "en-US"});
    eng.result({resultIndex: 0, results: [alt("hello", true), alt("wor", false)]});
    assert.deepEqual(events, [{t:"committed", s:"hello"}, {t:"volatile", s:"wor"}]);
    events.length = 0;
    eng.result({resultIndex: 0, results: [alt("hello", true), alt("worl", false)]});
    assert.deepEqual(events, [{t:"volatile", s:"worl"}], "a final result already committed is not committed again");
    events.length = 0;
    eng.result({resultIndex: 1, results: [alt("hello", true), alt("world", true)]});
    assert.deepEqual(events, [{t:"committed", s:"world"}, {t:"volatile", s:""}]);
  });

  test("several interim results join into one volatile text", ()=>{
    const events = [];
    const eng = new PD.WebSpeechEngine((e)=> events.push(e), {SR: null});
    eng.result({resultIndex: 0, results: [alt("a", false), alt("b", false)]});
    assert.deepEqual(events, [{t:"volatile", s:"a b"}]);
  });

  test("start() on a browser with on-device recognition: listens on this computer, not the server", async ()=>{
    const {SR, made} = fakeSR({available: async ()=> "available"});
    const events = [];
    const eng = new PD.WebSpeechEngine((e)=> events.push(e), {SR, lang: "en-GB", now: ()=> 0, setInterval: ()=> 1, clearInterval: ()=>{}});
    await eng.start();
    assert.deepEqual(events[0], {t:"preparing"});
    assert.equal(made.length, 1);
    assert.equal(made[0].continuous, true);
    assert.equal(made[0].interimResults, true);
    assert.equal(made[0].lang, "en-GB");
    assert.equal(made[0].processLocally, true);
    made[0].onstart();
    assert.deepEqual(events.find((e)=> e.t === "listening"), {t:"listening", onDevice:true, service:null});
    eng.cancel();
  });

  test("start() without on-device recognition: listens on the browser's service and says so", async ()=>{
    const {SR, made} = fakeSR();
    const events = [];
    const eng = new PD.WebSpeechEngine((e)=> events.push(e), {SR, lang: "en-US", now: ()=> 0, setInterval: ()=> 1, clearInterval: ()=>{}});
    await eng.start();
    assert.equal(made[0].processLocally, undefined);
    made[0].onstart();
    assert.deepEqual(events.find((e)=> e.t === "listening"), {t:"listening", onDevice:false, service:"browser"});
    eng.cancel();
  });

  test("not-allowed ends the session as denied for the microphone", async ()=>{
    const {SR, made} = fakeSR();
    const events = [];
    const eng = new PD.WebSpeechEngine((e)=> events.push(e), {SR, lang: "en-US", now: ()=> 0, setInterval: ()=> 1, clearInterval: ()=>{}});
    await eng.start();
    made[0].onerror({error: "not-allowed"});
    assert.deepEqual(events.at(-1), {t:"denied", what:"microphone"});
    assert.equal(events.filter((e)=> e.t === "ended").length, 0);
    eng.cancel();
  });

  test("the browser ends a pause by itself: it listens again, and stop() ends after the recogniser does", async ()=>{
    const {SR, made} = fakeSR();
    const events = [];
    let t = 0;
    const eng = new PD.WebSpeechEngine((e)=> events.push(e), {SR, lang: "en-US", now: ()=> t, setInterval: ()=> 1, clearInterval: ()=>{}});
    await eng.start();
    made[0].onstart();
    t = 5000; made[0].onend();
    assert.equal(made.length, 2, "a new recogniser was started");
    eng.stop();
    assert.equal(made[1].stopped, 1, "stop() finalises the live recogniser");
    made[1].onend();
    assert.deepEqual(events.at(-1), {t:"ended"});
  });

  test("cancel() aborts the recogniser and drops its handlers", async ()=>{
    const {SR, made} = fakeSR();
    const eng = new PD.WebSpeechEngine(()=>{}, {SR, lang: "en-US", now: ()=> 0, setInterval: ()=> 1, clearInterval: ()=>{}});
    await eng.start();
    const rec = made[0];
    eng.cancel();
    assert.equal(rec.aborted, 1);
    assert.equal(rec.onresult, null);
    assert.equal(rec.onend, null);
  });

  test("no SpeechRecognition at all: no recogniser", async ()=>{
    const events = [];
    const eng = new PD.WebSpeechEngine((e)=> events.push(e), {SR: undefined});
    await eng.start();
    assert.deepEqual(events, [{t:"unavailable", why:"noRecognizer"}]);
  });
});

/* ---------- createController: the session with a fake engine ---------- */

describe("createController: words and the box", ()=>{
  test("committed and volatile words land in the box through onWrite", async ()=>{
    const h = harness(); const ta = fakeTA("");
    const { eng, writes } = await startSession(h, ta);
    eng.emit({t:"listening", onDevice:true, service:null});
    eng.emit({t:"volatile", s:"hel"});
    assert.equal(ta.value, "hel");
    eng.emit({t:"volatile", s:"hello wor"});
    eng.emit({t:"committed", s:"hello world"});
    eng.emit({t:"volatile", s:""});
    assert.equal(ta.value, "hello world");
    assert.deepEqual(writes, ["hel", "hello wor", "hello world"]);
    assert.deepEqual(ta.dispatched, [], "no synthetic input event is dispatched");
  });

  test("a volatile word is replaced by its final, not added to it", async ()=>{
    const h = harness(); const ta = fakeTA("");
    const { eng } = await startSession(h, ta);
    eng.emit({t:"listening", onDevice:true, service:null});
    eng.emit({t:"volatile", s:"wor"});
    eng.emit({t:"volatile", s:"worl"});
    eng.emit({t:"committed", s:"world"});
    assert.equal(ta.value, "world");
  });

  test("the typed draft comes first; the spoken words follow with one space", async ()=>{
    const h = harness(); const ta = fakeTA("Dinner at 7");
    const { eng } = await startSession(h, ta);
    eng.emit({t:"listening", onDevice:true, service:null});
    eng.emit({t:"committed", s:"tonight"});
    assert.equal(ta.value, "Dinner at 7 tonight");
  });

  test("a draft that ends in a space gets no double space", async ()=>{
    const h = harness(); const ta = fakeTA("hi ");
    const { eng } = await startSession(h, ta);
    eng.emit({t:"listening", onDevice:true, service:null});
    eng.emit({t:"committed", s:"there"});
    assert.equal(ta.value, "hi there");
  });

  test("line breaks from the engine never reach the box", async ()=>{
    const h = harness(); const ta = fakeTA("");
    const { eng } = await startSession(h, ta);
    eng.emit({t:"listening", onDevice:true, service:null});
    eng.emit({t:"committed", s:"one\ntwo"});
    eng.emit({t:"volatile", s:"three\r\nfour"});
    assert.equal(ta.value, "one two three four");
    assert.doesNotMatch(ta.value, /[\n\r]/);
  });

  test("dictation never sends: saying 'send' is a word, and nothing is dispatched", async ()=>{
    const h = harness(); const ta = fakeTA("");
    const { eng } = await startSession(h, ta);
    eng.emit({t:"listening", onDevice:true, service:null});
    eng.emit({t:"committed", s:"send this now"});
    eng.emit({t:"committed", s:"\n"});
    assert.equal(ta.value, "send this now");
    assert.deepEqual(ta.dispatched, []);
  });

  test("the person typing under the dictation cancels it; later words are dropped", async ()=>{
    const h = harness(); const ta = fakeTA("");
    const { eng, writes, handle } = await startSession(h, ta);
    eng.emit({t:"listening", onDevice:true, service:null});
    eng.emit({t:"volatile", s:"hel"});
    ta.value = "hel!"; ta.fire("input");
    assert.equal(eng.cancelled, 1, "the engine is cancelled");
    assert.equal(eng.stopped, 0);
    assert.equal(handle.listening, false);
    const before = writes.length;
    eng.emit({t:"committed", s:"hello"});
    eng.emit({t:"volatile", s:"more"});
    assert.equal(ta.value, "hel!", "the typed text is kept");
    assert.equal(writes.length, before, "onWrite is not called again");
  });

  test("a change to the box without an input event (a clear, a paste by the app) is caught before the next write", async ()=>{
    const h = harness(); const ta = fakeTA("");
    const { eng, writes } = await startSession(h, ta);
    eng.emit({t:"listening", onDevice:true, service:null});
    eng.emit({t:"committed", s:"one"});
    ta.value = "pasted";
    eng.emit({t:"committed", s:"two"});
    assert.equal(ta.value, "pasted");
    assert.equal(eng.cancelled, 1);
    assert.deepEqual(writes, ["one"]);
    eng.emit({t:"volatile", s:"three"});
    assert.equal(ta.value, "pasted");
  });

  test("cancel keeps what is already shown and writes nothing more", async ()=>{
    const h = harness(); const ta = fakeTA("");
    const { eng, handle, writes } = await startSession(h, ta);
    eng.emit({t:"listening", onDevice:true, service:null});
    eng.emit({t:"committed", s:"kept words"});
    handle.cancel();
    assert.equal(eng.cancelled, 1);
    assert.equal(ta.value, "kept words");
    eng.emit({t:"committed", s:"late"});
    assert.equal(ta.value, "kept words");
    assert.deepEqual(writes, ["kept words"]);
  });

  test("stop() finalises: a late final result is still written, then ended closes without cancelling", async ()=>{
    const h = harness(); const ta = fakeTA("");
    const { eng, handle } = await startSession(h, ta);
    eng.emit({t:"listening", onDevice:true, service:null});
    eng.emit({t:"volatile", s:"hel"});
    handle.stop();
    assert.equal(eng.stopped, 1);
    assert.equal(handle.listening, false);
    assert.ok([...h.timers.values()].some((t)=> t.ms === 3000), "a 3 s drain is armed");
    eng.emit({t:"committed", s:"hello"});
    assert.equal(ta.value, "hello");
    eng.emit({t:"ended"});
    assert.equal(eng.cancelled, 0);
    assert.equal(ta.value, "hello");
    assert.ok(h.announced.includes("Listening"));
    assert.ok(h.announced.includes("Stopped listening"));
  });

  test("when the engine does not finish within 3 s, the session ends and keeps the words", async ()=>{
    const h = harness(); const ta = fakeTA("");
    const { eng, handle } = await startSession(h, ta);
    eng.emit({t:"listening", onDevice:true, service:null});
    eng.emit({t:"committed", s:"kept"});
    handle.stop();
    fireTimers(h, 3000);
    assert.equal(eng.cancelled, 1);
    assert.equal(ta.value, "kept");
    assert.equal(h.ctl.live, null);
  });

  test("20 s without new words stops the session and keeps the words", async ()=>{
    const h = harness(); const ta = fakeTA("");
    const { eng } = await startSession(h, ta);
    h.t = 0; eng.emit({t:"listening", onDevice:true, service:null});
    h.t = 5000; eng.emit({t:"committed", s:"hi"});
    h.t = 24999; fireTicks(h);
    assert.equal(eng.stopped, 0, "not yet: the silence counts from the last words");
    h.t = 25000; fireTicks(h);
    assert.equal(eng.stopped, 1);
    eng.emit({t:"ended"});
    assert.equal(ta.value, "hi");
  });

  test("10 min in all stops the session even while words keep coming", async ()=>{
    const h = harness(); const ta = fakeTA("");
    const { eng } = await startSession(h, ta);
    h.t = 0; eng.emit({t:"listening", onDevice:true, service:null});
    for(let i = 1; i <= 59; i++){ h.t = i * 10000; eng.emit({t:"committed", s:`w${i}`}); }
    h.t = 600000; fireTicks(h);
    assert.equal(eng.stopped, 1);
  });

  test("starting a second box stops the first and keeps its words", async ()=>{
    const h = harness();
    const A = await startSession(h, fakeTA(""), {key:"aura:a"});
    A.eng.emit({t:"listening", onDevice:true, service:null});
    A.eng.emit({t:"committed", s:"alpha"});
    const B = await startSession(h, fakeTA(""), {key:"aura:b"});
    assert.equal(A.eng.cancelled, 1);
    assert.equal(A.ta.value, "alpha");
    B.eng.emit({t:"listening", onDevice:true, service:null});
    B.eng.emit({t:"committed", s:"beta"});
    assert.equal(B.ta.value, "beta");
    A.eng.emit({t:"committed", s:"late"});
    assert.equal(A.ta.value, "alpha");
  });

  test("level events do not write into the box", async ()=>{
    const h = harness(); const ta = fakeTA("");
    const { eng } = await startSession(h, ta);
    eng.emit({t:"listening", onDevice:true, service:null});
    eng.emit({t:"level", v:0.5});
    eng.emit({t:"committed", s:"just words"});
    eng.emit({t:"ended"});
    assert.equal(ta.value, "just words");
    assert.deepEqual(ta.dispatched, []);
  });

  test("a composer rebuilt under the same key takes over the session", async ()=>{
    const h = harness(); const ta1 = fakeTA("");
    const A = await startSession(h, ta1, {key:"aura:1"});
    A.eng.emit({t:"listening", onDevice:true, service:null});
    A.eng.emit({t:"committed", s:"one"});
    A.handle.destroy();
    assert.ok([...h.timers.values()].some((t)=> t.ms === 1000), "a 1 s grace is armed");
    const ta2 = fakeTA("one"); const writes2 = [];
    h.ctl.mount({key:"aura:1", ta: ta2, app:"Page Aura", onWrite:(t)=> writes2.push(t)});
    await flush();
    assert.equal(ta2.value, "one");
    fireTimers(h, 1000);
    assert.ok(h.ctl.live, "the session survived the grace period");
    A.eng.emit({t:"committed", s:"two"});
    assert.equal(ta2.value, "one two");
    assert.deepEqual(writes2, ["one", "one two"]);
    assert.equal(A.eng.cancelled, 0);
  });

  test("when no composer with that key comes back within 1 s, the session is cancelled", async ()=>{
    const h = harness(); const ta = fakeTA("");
    const A = await startSession(h, ta, {key:"aura:1"});
    A.eng.emit({t:"listening", onDevice:true, service:null});
    A.eng.emit({t:"committed", s:"gone"});
    A.handle.destroy();
    fireTimers(h, 1000);
    assert.equal(A.eng.cancelled, 1);
    assert.equal(h.ctl.live, null);
    assert.equal(ta.value, "gone");
  });

  test("a visible-to-hidden page change ends the session", async ()=>{
    const h = harness({withDoc: true}); const dom = domOf(h); const ta = fakeTA("");
    const { eng } = await startSession(h, ta, {dom});
    eng.emit({t:"listening", onDevice:true, service:null});
    h.doc.hidden = true;
    for(const f of h.doc.listeners.visibilitychange || []) f();
    assert.equal(eng.cancelled, 1);
  });

  test("a browser session tells other tabs that dictation started, and never what was said", async ()=>{
    const posted = []; const Orig = globalThis.BroadcastChannel;
    class FakeBC{ constructor(name){ this.name = name; this.onmessage = null; } postMessage(m){ posted.push(m); } }
    globalThis.BroadcastChannel = FakeBC;
    try{
      const h = harness({platform: "browser", device: "computer"}); const ta = fakeTA("");
      const { eng } = await startSession(h, ta);
      eng.emit({t:"listening", onDevice:false, service:"browser"});
      eng.emit({t:"committed", s:"secret words"});
      assert.deepEqual(posted.map((m)=> m.t), ["start"]);
      assert.ok(!JSON.stringify(posted).includes("secret"));
    }finally{
      globalThis.BroadcastChannel = Orig;
    }
  });
});

describe("createController: the line, the mic and the keys (with a fake DOM)", ()=>{
  test("the mic is in the bar, before Send; its state follows the session", async ()=>{
    const h = harness({withDoc: true}); const dom = domOf(h); const ta = fakeTA("");
    const { handle, eng } = await startSession(h, ta, {dom});
    const mic = handle.mic;
    assert.equal(dom.bar.children[0], mic, "the mic sits before Send");
    assert.equal(mic.attrs["aria-label"], "Dictate");
    assert.equal(mic.title, "Dictate (⌘D) · nothing is sent until you press Enter");
    assert.equal(mic.className, "mic busy");
    eng.emit({t:"listening", onDevice:true, service:null});
    assert.equal(mic.className, "mic on");
    assert.equal(mic.attrs["aria-pressed"], "true");
    assert.equal(mic.attrs["aria-label"], "Stop dictating");
    assert.equal(mic.title, "Stop dictating (⌘D)");
    const line = dom.lineHost.children.find((c)=> c.className.startsWith("vline"));
    assert.ok(line, "the line is shown above the box");
    assert.equal(line.className, "vline listen");
    assert.equal(textOf(line), "Listening on this Mac" + NOTHING);
  });

  test("the mic click starts, then stops (and keeps the words)", async ()=>{
    const h = harness({withDoc: true}); const dom = domOf(h); const ta = fakeTA("");
    const { handle, eng } = await startSession(h, ta, {dom});
    eng.emit({t:"listening", onDevice:true, service:null});
    eng.emit({t:"committed", s:"clicked"});
    clickOf(handle.mic);
    assert.equal(eng.stopped, 1);
    eng.emit({t:"ended"});
    assert.equal(ta.value, "clicked");
    clickOf(handle.mic);
    assert.equal(h.engines.length, 2, "a second click starts a new session");
  });

  test("denied: the mic shows off, the line says why, and its button opens Settings", async ()=>{
    const h = harness({withDoc: true}); const dom = domOf(h); const ta = fakeTA("");
    const { handle, eng } = await startSession(h, ta, {dom});
    eng.emit({t:"denied", what:"microphone"});
    assert.equal(handle.mic.className, "mic off");
    assert.equal(handle.mic.attrs["aria-pressed"], "false");
    const line = dom.lineHost.children.find((c)=> c.className.startsWith("vline"));
    assert.equal(line.className, "vline warn");
    const sentence = line.children.find((c)=> c.tag === "span");
    assert.equal(textOf(sentence), "Page Aura can’t hear you: microphone access is off for Page Aura.");
    const act = findTag(line, "button");
    assert.ok(act, "an action button is shown");
    clickOf(act);
    assert.deepEqual(h.opened, ["microphone"]);
  });

  test("an interrupted line goes away by itself after 4 s", async ()=>{
    const h = harness({withDoc: true}); const dom = domOf(h); const ta = fakeTA("");
    const { eng } = await startSession(h, ta, {dom});
    eng.emit({t:"listening", onDevice:true, service:null});
    eng.emit({t:"committed", s:"kept"});
    eng.emit({t:"interrupted"});
    assert.equal(ta.value, "kept");
    const shown = () => dom.lineHost.children.find((c)=> c.className.startsWith("vline"));
    assert.equal(textOf(shown()), "Stopped listening. Your words are kept.");
    fireTimers(h, 4000);
    assert.equal(shown(), undefined);
  });

  test("Esc while listening stops (and calls preventDefault); the next Esc is not ours", async ()=>{
    const h = harness({withDoc: true}); const dom = domOf(h); const ta = fakeTA("");
    const { eng } = await startSession(h, ta, {dom});
    eng.emit({t:"listening", onDevice:true, service:null});
    let prevented = 0, stopped = 0;
    const ev = (key, extra = {})=> ({key, metaKey:false, ctrlKey:false, altKey:false, shiftKey:false, isComposing:false,
      preventDefault(){ prevented++; }, stopPropagation(){ stopped++; }, ...extra});
    ta.fire("keydown", ev("Escape"));
    assert.equal(eng.stopped, 1);
    assert.equal(prevented, 1);
    assert.equal(stopped, 1);
    eng.emit({t:"ended"});
    ta.fire("keydown", ev("Escape"));
    assert.equal(eng.stopped, 1, "the next Esc does not stop anything");
    assert.equal(prevented, 1);
  });

  test("Cmd+D on the Mac starts and stops; Ctrl+D is not ours there", async ()=>{
    const h2 = harness({withDoc: true, isMac: true}); const dom2 = domOf(h2); const ta2 = fakeTA("");
    h2.ctl.mount({key:"aura:k", ta: ta2, app:"Page Aura", ...dom2});
    await h2.ctl.supported(); await flush();
    const cmd = (extra)=> ({key:"d", metaKey:true, ctrlKey:false, altKey:false, shiftKey:false, repeat:false, isComposing:false, preventDefault(){}, ...extra});
    ta2.fire("keydown", {key:"d", ctrlKey:true, metaKey:false, altKey:false, shiftKey:false, repeat:false, isComposing:false, preventDefault(){}});
    assert.equal(h2.engines.length, 0, "Ctrl+D does nothing on the Mac");
    ta2.fire("keydown", cmd());
    assert.equal(h2.engines.length, 1, "Cmd+D starts");
    h2.engines[0].emit({t:"listening", onDevice:true, service:null});
    ta2.fire("keydown", cmd());
    assert.equal(h2.engines[0].stopped, 1, "Cmd+D again stops");
  });

  test("Ctrl+D on Windows starts dictation (and its mic says Ctrl + D)", async ()=>{
    const h = harness({withDoc: true, isMac: false, platform: "windows", device: "PC"}); const dom = domOf(h); const ta = fakeTA("");
    const hint = h.doc.createElement("span");
    h.ctl.mount({key:"aura:w", ta, app:"Page Aura", ...dom, hintEl: hint});
    await h.ctl.supported(); await flush();
    assert.equal(textOf(hint), "Ctrl + D dictate  ·  ");
    ta.fire("keydown", {key:"d", ctrlKey:true, metaKey:false, altKey:false, shiftKey:false, repeat:false, isComposing:false, preventDefault(){}});
    assert.equal(h.engines.length, 1);
  });
});
