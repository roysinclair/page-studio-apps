const Anthropic = window.AnthropicSDK.default; // official SDK, embedded by tools/build-orbit.py (copied from page-aura.html)
const APP = "Page Orbit";

/* ================= constants ================= */
const MODELS = [
  {id:"claude-opus-5-5",  name:"Opus 5.5",   sub:"Smart all-rounder · recommended"},
  {id:"claude-fable-5-1", name:"Fable 5.1",  sub:"Most capable · premium price"},
  {id:"claude-sonnet-5-5",name:"Sonnet 5.5", sub:"Fast and capable"},
  {id:"claude-haiku-5-5", name:"Haiku 5.5",  sub:"Fastest · lowest cost"},
  {id:"claude-opus-5",    name:"Opus 5",     sub:"Previous generation"},
  {id:"claude-sonnet-5",  name:"Sonnet 5",   sub:"Previous generation"},
  {id:"claude-opus-4-8",  name:"Opus 4.8",   sub:"Older · its advice is readable when used as an advisor"},
];
/* What each model supports in Managed Agents (live docs, checked 3 Nov 2026).
   effort: the default effort · fast: fast mode · sys: mid-session system notes ·
   advisors: valid advisor models when this is the agent's model · redacted: its advice comes back hidden */
const MYTHOS = ["claude-mythos-5-1","claude-mythos-5"];
const TOP_ADVISORS = ["claude-fable-5-1","claude-mythos-5-1","claude-fable-5","claude-mythos-5","claude-opus-5-5","claude-opus-5"];
const MODEL_INFO = {
  "claude-opus-5-5":   {effort:"medium", fast:true,  sys:true, advisors:TOP_ADVISORS, redacted:true},
  "claude-fable-5-1":  {effort:"high",   fast:false, sys:true, advisors:["claude-fable-5-1","claude-mythos-5-1"], redacted:true},
  "claude-fable-5":    {effort:"high",   fast:false, sys:true, advisors:["claude-fable-5-1","claude-mythos-5-1","claude-fable-5","claude-mythos-5"], redacted:true},
  "claude-sonnet-5-5": {effort:"high",   fast:false, sys:true, advisors:[...TOP_ADVISORS, "claude-sonnet-5-5"], redacted:true},
  "claude-haiku-5-5":  {effort:"medium", fast:false, sys:true, advisors:[...TOP_ADVISORS, "claude-opus-4-8","claude-opus-4-7","claude-sonnet-5-5","claude-sonnet-5","claude-haiku-5-5"], redacted:true},
  "claude-opus-5":     {effort:"high",   fast:true,  sys:true, advisors:TOP_ADVISORS, redacted:true},
  "claude-sonnet-5":   {effort:"high",   fast:false, sys:false},
  "claude-opus-4-8":   {effort:"high",   fast:false, sys:true, redacted:false},
};
const REDACTED_ADVISORS = new Set([...TOP_ADVISORS, "claude-sonnet-5-5","claude-haiku-5-5"]);
const modelInfo = (id)=> MODEL_INFO[modelId(id)] || {};
const advisorName = (id)=> MYTHOS.includes(id) ? id.replace("claude-mythos-","Mythos ").replace("-",".") + " (limited access)" : modelName(id);
function effortOptions(id){
  const d = modelInfo(id).effort;
  return EFFORTS.map(e=>({value:e.id, label: e.id ? e.name : d ? `Model default (${d})` : e.name}));
}
const EFFORTS = [
  {id:"",       name:"Model default"},
  {id:"low",    name:"Low"},
  {id:"medium", name:"Medium"},
  {id:"high",   name:"High"},
  {id:"xhigh",  name:"Extra high"},
  {id:"max",    name:"Max"},
];
const MA_BETA = "managed-agents-2026-04-01";

const ICONS = {
  mark:'<g fill="currentColor" stroke="none"><path d="M14.66 7.35A5.5 5.5 0 1 0 17.46 9.87A3.85 3.85 0 0 1 14.66 7.35Z"/><path d="M15.88 21.47A9.6 9.6 0 1 1 15.63 3.34A3.85 3.85 0 0 0 14.61 5.03C13.47 4.64 12.22 4.51 10.99 4.69C9.76 4.86 8.55 5.34 7.5 6.07C6.45 6.81 5.57 7.8 4.95 8.97C4.33 10.13 3.99 11.46 3.96 12.82C3.94 14.17 4.24 15.55 4.85 16.8C5.47 18.05 6.38 19.17 7.53 20.03C8.67 20.89 10.03 21.49 11.48 21.74C12.92 22 14.44 21.91 15.88 21.47Z"/><circle cx="18.3" cy="6.11" r="2.55"/></g>',
  plus:'<path d="M12 5v14M5 12h14"/>',
  skill:'<path d="M6 4.5h9.5a3 3 0 0 1 3 3v12H9a3 3 0 0 1-3-3z"/><path d="M6 16.5a3 3 0 0 1 3-3h9.5"/><path d="M10 8h5"/>',
  trash:'<path d="M4 7h16"/><path d="M9 7V4.5h6V7"/><path d="M6 7l1 13h10l1-13"/>',
  sliders:'<path d="M4 6h10M18 6h2M4 12h4M12 12h8M4 18h12M20 18h0"/><circle cx="16" cy="6" r="2"/><circle cx="10" cy="12" r="2"/><circle cx="18" cy="18" r="2"/>',
  folder:'<path d="M3 7.5A2.5 2.5 0 0 1 5.5 5H9l2 2.2h7.5A2.5 2.5 0 0 1 21 9.7v7.8a2.5 2.5 0 0 1-2.5 2.5h-13A2.5 2.5 0 0 1 3 17.5z"/>',
  clip:'<path d="m20.5 11.5-8.6 8.6a5.5 5.5 0 0 1-7.8-7.8l8.6-8.6a3.7 3.7 0 0 1 5.2 5.2l-8.6 8.6a1.8 1.8 0 0 1-2.6-2.6l7.9-7.9"/>',
  up:'<path d="M12 19V5M6 11l6-6 6 6"/>',
  stop:'<rect x="7" y="7" width="10" height="10" rx="2.5" fill="currentColor" stroke="none"/>',
  copy:'<rect x="9" y="9" width="11" height="11" rx="2.5"/><path d="M5 15V6.5A2.5 2.5 0 0 1 7.5 4H15"/>',
  check:'<path d="M5 12.5 10 17l9-10"/>',
  x:'<path d="M6 6l12 12M18 6 6 18"/>',
  menu:'<path d="M4 7h16M4 12h16M4 17h10"/>',
  search:'<circle cx="11" cy="11" r="6.5"/><path d="m20 20-4.2-4.2"/>',
  sun:'<circle cx="12" cy="12" r="4"/><path d="M12 2.5v2M12 19.5v2M4.6 4.6 6 6M18 18l1.4 1.4M2.5 12h2M19.5 12h2M4.6 19.4 6 18M18 6l1.4-1.4"/>',
  moon:'<path d="M20 14.5A8 8 0 1 1 9.5 4a6.5 6.5 0 0 0 10.5 10.5z"/>',
  chevD:'<path d="m7 10 5 5 5-5"/>',
  chevR:'<path d="m10 7 5 5-5 5"/>',
  chevL:'<path d="m14 7-5 5 5 5"/>',
  file:'<path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8z"/><path d="M14 3v5h5"/><path d="M9 13h6M9 17h4"/>',
  info:'<circle cx="12" cy="12" r="9"/><path d="M12 11v5M12 8h.01"/>',
  alert:'<path d="M12 3 2.5 20h19z"/><path d="M12 10v4M12 17h.01"/>',
  key:'<circle cx="8" cy="15" r="4"/><path d="m11 12 9-9M17 6l3 3M15 8l2 2"/>',
  eye:'<path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7S2 12 2 12z"/><circle cx="12" cy="12" r="3"/>',
  code:'<path d="m8 8-4 4 4 4M16 8l4 4-4 4M13.5 5l-3 14"/>',
  plug:'<path d="M9 3v5M15 3v5M6 8h12v3a6 6 0 0 1-12 0z"/><path d="M12 17v4"/>',
  globe:'<circle cx="12" cy="12" r="9"/><path d="M3 12h18"/><path d="M12 3c2.6 2.5 3.9 5.5 3.9 9s-1.3 6.5-3.9 9c-2.6-2.5-3.9-5.5-3.9-9S9.4 5.5 12 3z"/>',
  link:'<path d="M10 14a4 4 0 0 0 5.7 0l3-3a4 4 0 0 0-5.7-5.7l-1 1"/><path d="M14 10a4 4 0 0 0-5.7 0l-3 3a4 4 0 0 0 5.7 5.7l1-1"/>',
  ext:'<path d="M14 4h6v6"/><path d="M10 14 20 4"/><path d="M19 14v4a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V7a2 2 0 0 1 2-2h4"/>',
  pen:'<path d="M4 20h4L19 9l-4-4L4 16z"/><path d="m13.5 6.5 4 4"/>',
  refresh:'<path d="M20 11a8 8 0 0 0-14.5-4.5L4 8"/><path d="M4 4v4h4"/><path d="M4 13a8 8 0 0 0 14.5 4.5L20 16"/><path d="M20 20v-4h-4"/>',
  bot:'<rect x="4" y="8" width="16" height="11" rx="3.5"/><path d="M12 4v4"/><circle cx="12" cy="3.4" r=".6" fill="currentColor"/><circle cx="9" cy="13.5" r="1.2" fill="currentColor" stroke="none"/><circle cx="15" cy="13.5" r="1.2" fill="currentColor" stroke="none"/>',
  chat:'<path d="M5 18.5V7a3 3 0 0 1 3-3h8a3 3 0 0 1 3 3v6a3 3 0 0 1-3 3H8.5z"/><path d="M9 9h6M9 12.5h4"/>',
  box:'<path d="M12 3 4 7v10l8 4 8-4V7z"/><path d="m4 7 8 4 8-4M12 11v10"/>',
  lock:'<rect x="5" y="10.5" width="14" height="10" rx="2.5"/><path d="M8 10.5V8a4 4 0 0 1 8 0v2.5"/><path d="M12 14.5v2.5"/>',
  clock:'<circle cx="12" cy="12" r="8.5"/><path d="M12 7.5V12l3 2"/>',
  db:'<ellipse cx="12" cy="6" rx="7" ry="2.8"/><path d="M5 6v6c0 1.5 3.1 2.8 7 2.8s7-1.3 7-2.8V6"/><path d="M5 12v6c0 1.5 3.1 2.8 7 2.8s7-1.3 7-2.8v-6"/>',
  play:'<path d="M8 5.5v13l10.5-6.5z" fill="currentColor" stroke="none"/>',
  pause:'<rect x="7" y="5.5" width="3.4" height="13" rx="1.2" fill="currentColor" stroke="none"/><rect x="13.6" y="5.5" width="3.4" height="13" rx="1.2" fill="currentColor" stroke="none"/>',
  archive:'<rect x="3.5" y="4.5" width="17" height="4.5" rx="1.5"/><path d="M5 9v9a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V9"/><path d="M10 13h4"/>',
  history:'<path d="M4 12a8 8 0 1 0 2.4-5.7L4 8.5"/><path d="M4 4v4.5h4.5"/><path d="M12 8v4l3 2"/>',
  pulse:'<path d="M3 12h4l2.5-6 4 12 2.5-6H21"/>',
  flag:'<path d="M5 21V4"/><path d="M5 4h11l-2 4 2 4H5"/>',
  users:'<circle cx="9" cy="8.5" r="3.2"/><path d="M3.5 19.5a5.5 5.5 0 0 1 11 0"/><circle cx="17" cy="9.5" r="2.5"/><path d="M15.5 14.4a4.6 4.6 0 0 1 5.5 4.6"/>',
  terminal:'<rect x="3" y="4.5" width="18" height="15" rx="3"/><path d="m7 9.5 3 2.5-3 2.5M12.5 15H17"/>',
  shield:'<path d="M12 3 5 6v5.5c0 4.4 3 8.2 7 9.5 4-1.3 7-5.1 7-9.5V6z"/><path d="m9 12 2.2 2.2L15.5 10"/>',
  diff:'<path d="M7 4v10M2 9h10M15 15h7"/><rect x="13" y="3" width="8" height="8" rx="2" fill="none"/>',
  download:'<path d="M12 4v11M7 10l5 5 5-5"/><path d="M5 20h14"/>',
  panel:'<rect x="3" y="4" width="18" height="16" rx="3"/><path d="M15 4v16"/>',
  rocket:'<path d="M5 15c-1.5 1.5-2 4-2 6 2 0 4.5-.5 6-2"/><path d="M9 15 6.5 12.5c1.5-4.5 5-9 12.5-9.5-.5 7.5-5 11-9.5 12.5z"/><circle cx="14.5" cy="9.5" r="1.6"/>',
};
function icon(name, cls=""){
  const s = document.createElementNS("http://www.w3.org/2000/svg","svg");
  s.setAttribute("viewBox","0 0 24 24"); s.setAttribute("fill","none"); s.setAttribute("stroke","currentColor");
  s.setAttribute("stroke-width","1.8"); s.setAttribute("stroke-linecap","round"); s.setAttribute("stroke-linejoin","round");
  s.setAttribute("aria-hidden","true"); s.setAttribute("class","i "+cls); s.innerHTML = ICONS[name]||""; return s;
}

/* ================= settings ================= */
const DEFAULTS = {apiKey:"", remember:true, keyEnc:null, theme:"", workspace:"default",
  diagModel:"claude-opus-5-5", diagEffort:"high", inspector:true, pageLink:false};
let client = null;
function loadSettings(){
  let s = {...DEFAULTS};
  try{ Object.assign(s, JSON.parse(localStorage.getItem("orbit.settings")||"{}")); }catch{}
  try{ const k = sessionStorage.getItem("orbit.key"); if(k && !s.apiKey) s.apiKey = k; }catch{}
  return s;
}
let settings = loadSettings();
function saveSettings(){
  const copy = {...settings};
  if(settings.keyEnc || DESKTOP) copy.apiKey = "";     // only the encrypted form is stored (desktop: the keychain holds it)
  if(!settings.remember){ try{ sessionStorage.setItem("orbit.key", settings.apiKey); }catch{}; copy.apiKey = ""; copy.keyEnc = null; }
  if(DEMO){ try{ const st = JSON.parse(localStorage.getItem("orbit.settings")||"{}"); copy.apiKey = st.apiKey||""; copy.keyEnc = st.keyEnc||null; }catch{ copy.apiKey = ""; } }   // the demo never touches a saved key
  try{ localStorage.setItem("orbit.settings", JSON.stringify(copy)); }catch{}
  applyTheme(); renderChrome();
}
function isDark(){ return settings.theme ? settings.theme==="dark" : matchMedia("(prefers-color-scheme: dark)").matches; }
function applyTheme(){ if(settings.theme) document.documentElement.dataset.theme = settings.theme; else delete document.documentElement.dataset.theme; }

/* ================= desktop bridge (Tauri) =================
   Inside the desktop app, API calls go through the Rust core: it adds the key from the
   system keychain (shared with Page Aura), so the key never enters this page. */
const DESKTOP = !!(window.__TAURI__ && window.__TAURI__.core);
const KEYCHAIN = "stored-in-system-keychain";        // placeholder: the real key stays in Rust
const invoke = DESKTOP ? window.__TAURI__.core.invoke : null;
applyTheme();
const bytesToB64 = (u8)=>{ let s = ""; for(let i=0;i<u8.length;i+=0x8000) s += String.fromCharCode.apply(null, u8.subarray(i, i+0x8000)); return btoa(s); };
const b64ToBytes = (b)=> Uint8Array.from(atob(b), c=>c.charCodeAt(0));
let fetchSeq = 0;
async function desktopFetch(input, init={}){
  const req = new Request(input, init);
  const id = ++fetchSeq;
  const headers = [...req.headers.entries()];
  const buf = (req.method==="GET" || req.method==="HEAD") ? null : new Uint8Array(await req.arrayBuffer());
  const body = buf && buf.length ? bytesToB64(buf) : null;
  const signal = init.signal || req.signal;
  return new Promise((resolve, reject)=>{
    let ctrl, headDone = false, closed = false;
    const stream = new ReadableStream({ start(c){ ctrl = c; }, cancel(){ invoke("api_abort",{id}).catch(()=>{}); } });
    const fail = (e)=>{ if(closed) return; closed = true; if(!headDone) reject(e); else { try{ ctrl.error(e); }catch{} } };
    const ch = new window.__TAURI__.core.Channel();
    ch.onmessage = (m)=>{
      if(m.event==="head"){ headDone = true; const st = m.data.status; resolve(new Response([101,204,205,304].includes(st) ? null : stream, {status:st, headers:m.data.headers})); }
      else if(m.event==="chunk"){ try{ ctrl.enqueue(b64ToBytes(m.data.b64)); }catch{} }
      else if(m.event==="end"){ if(!closed){ closed = true; try{ ctrl.close(); }catch{} } }
      else if(m.event==="error") fail(new TypeError(m.data.message));
    };
    if(signal){
      if(signal.aborted) return reject(new DOMException("Aborted","AbortError"));
      signal.addEventListener("abort", ()=>{ invoke("api_abort",{id}).catch(()=>{}); fail(new DOMException("Aborted","AbortError")); }, {once:true});
    }
    invoke("api_fetch", {id, url:req.url, method:req.method, headers, body, onEvent:ch}).catch(e=>fail(new TypeError(String(e))));
  });
}
// open web links in the user's browser, not inside the app
if(DESKTOP) document.addEventListener("click", (e)=>{
  const a = e.target.closest?.("a[href]"); if(!a) return;
  const href = a.getAttribute("href");
  if(/^https?:\/\//i.test(href)){ e.preventDefault(); invoke("plugin:opener|open_url",{url:href}).catch(()=>toast("Couldn’t open the link")); }
}, true);

/* ---- optional passphrase encryption of the saved key (PBKDF2-SHA256 → AES-256-GCM, WebCrypto) ---- */
const canEncrypt = !!(globalThis.crypto && crypto.subtle);
const b64 = buf => { let s=""; new Uint8Array(buf).forEach(b=>s+=String.fromCharCode(b)); return btoa(s); };
const unb64 = str => Uint8Array.from(atob(str), c=>c.charCodeAt(0));
async function deriveKey(pass, salt, iter){
  const base = await crypto.subtle.importKey("raw", new TextEncoder().encode(pass), "PBKDF2", false, ["deriveKey"]);
  return crypto.subtle.deriveKey({name:"PBKDF2", salt, iterations:iter, hash:"SHA-256"}, base, {name:"AES-GCM", length:256}, false, ["encrypt","decrypt"]);
}
async function encryptKey(apiKey, pass){
  const iter = 600000, salt = crypto.getRandomValues(new Uint8Array(16)), iv = crypto.getRandomValues(new Uint8Array(12));
  const k = await deriveKey(pass, salt, iter);
  const ct = await crypto.subtle.encrypt({name:"AES-GCM", iv}, k, new TextEncoder().encode(apiKey));
  return {v:1, kdf:"PBKDF2-SHA256", iter, salt:b64(salt), iv:b64(iv), ct:b64(ct)};
}
async function decryptKey(enc, pass){
  const k = await deriveKey(pass, unb64(enc.salt), enc.iter||600000);
  return new TextDecoder().decode(await crypto.subtle.decrypt({name:"AES-GCM", iv:unb64(enc.iv)}, k, unb64(enc.ct)));
}
const isLocked = ()=> !!settings.keyEnc && !settings.apiKey;
function lockNow(){ settings.apiKey = ""; client = null; renderChrome(); fire(route()); toast("Locked — your key is no longer in memory"); }
function unlockDialog(){
  return new Promise(res=>{
    const pass = h("input",{class:"field", type:"password", placeholder:"Passphrase", autocomplete:"current-password"});
    const err = h("p",{class:"hint", style:"min-height:1.2em;margin:8px 0 0"});
    let busy = false, done = false;
    const finish = v=>{ if(!done){ done = true; res(v); } };
    const go = async()=>{
      if(busy || !pass.value) return; busy = true; err.style.color = ""; err.textContent = "Unlocking…";
      try{ settings.apiKey = await decryptKey(settings.keyEnc, pass.value); client = null; bg.remove(); renderChrome(); finish(true); }
      catch{ err.style.color = "var(--danger)"; err.textContent = "That passphrase didn’t work."; busy = false; pass.select(); }
    };
    pass.onkeydown = e=>{ if(e.key==="Enter") fire(go()); };
    const bg = modal(h("div",{class:"modal sm"},
      h("h2",{},"Unlock Page Orbit"),
      h("p",{class:"lead"},"Your API key is encrypted on this device. Enter your passphrase to use it — it stays in memory only until you close this tab."),
      pass, err,
      h("div",{class:"actions"},
        h("button",{class:"btn ghost", onclick:async()=>{
          if(!await confirmDialog("Forget the saved key?","The encrypted key will be deleted from this browser. You can add your key again in Settings.","Forget key")) return;
          settings.keyEnc = null; settings.apiKey = ""; saveSettings(); bg.remove(); finish(false); openSettings(); }}, "Forgot passphrase"),
        h("span",{class:"sp"}),
        h("button",{class:"btn primary", onclick:go}, icon("key"), "Unlock"))), ()=>finish(false));
    setTimeout(()=>pass.focus());
  });
}

let demoClient = null;
function getClient(){
  if(DEMO) return demoClient ||= new Anthropic({apiKey:"demo", dangerouslyAllowBrowser:true, maxRetries:0, fetch:demoWorkspace()});
  if(!settings.apiKey) return null;
  if(!client || client._key !== settings.apiKey){
    client = DESKTOP
      ? new Anthropic({apiKey: KEYCHAIN, dangerouslyAllowBrowser: true, fetch: desktopFetch, maxRetries: 2})
      : new Anthropic({apiKey: settings.apiKey, dangerouslyAllowBrowser: true, maxRetries: 2});
    client._key = settings.apiKey;
  }
  return client;
}
/** For saves that check a version or content hash: a 409 means "someone else changed it", so don't retry it. */
const NO_RETRY = {maxRetries:0};
class NoKey extends Error { constructor(){ super("Add your API key in Settings first."); this.noKey = true; } }
function C(){ const c = getClient(); if(!c) throw new NoKey(); return c; }

/* ================= DOM helpers ================= */
const $ = (sel, el=document)=> el.querySelector(sel);
function h(tag, attrs={}, ...kids){
  const el = document.createElement(tag);
  for(const [k,v] of Object.entries(attrs||{})){
    if(k==="class") el.className=v; else if(k==="style") el.setAttribute("style",v);
    else if(k.startsWith("on")) el.addEventListener(k.slice(2),v);
    else if(k==="value") el.value = v ?? "";
    else if(k==="checked" || k==="disabled" || k==="selected") el[k] = !!v;
    else if(v===true) el.setAttribute(k,""); else if(v!==false && v!=null) el.setAttribute(k,v);
  }
  for(const k of kids.flat(Infinity)) if(k!=null && k!==false && k!=="") el.append(k.nodeType? k : document.createTextNode(String(k)));
  return el;
}
function copyText(text, btn){
  navigator.clipboard.writeText(text).then(()=>{
    if(!btn) return toast("Copied"); const old = [...btn.childNodes]; btn.replaceChildren(icon("check"), ...(old.length>1?[h("span",{},"Copied")]:[]));
    setTimeout(()=>btn.replaceChildren(...old), 1300);
  }).catch(()=>toast("Couldn't copy"));
}
marked.setOptions({gfm:true, breaks:false});
function renderMd(text){
  const div = h("div",{class:"md"});
  div.innerHTML = DOMPurify.sanitize(marked.parse(text||""));
  div.querySelectorAll("pre").forEach(pre=>{
    const code = pre.querySelector("code");
    const lang = ((code?.className||"").match(/language-([\w+#-]+)/)||[])[1] || "text";
    if(code){ try{ hljs.highlightElement(code); }catch{} }
    const wrap = h("div",{class:"codeblock"}); pre.replaceWith(wrap);
    const btn = h("button",{class:"btn sm", onclick:()=>copyText(code?.innerText||pre.innerText, btn)}, icon("copy"), h("span",{},"Copy"));
    wrap.append(h("div",{class:"codehead"}, h("span",{}, lang), btn), pre);
  });
  div.querySelectorAll("table").forEach(t=>{ const w = h("div",{class:"tableWrap"}); t.replaceWith(w); w.append(t); });
  div.querySelectorAll("a").forEach(a=>{ a.target="_blank"; a.rel="noopener noreferrer"; if(!/^https?:\/\//i.test(a.getAttribute("href")||"")) a.removeAttribute("href"); });
  return div;
}
function jsonView(obj){ const pre = h("pre",{class:"json"}); pre.textContent = typeof obj==="string" ? obj : JSON.stringify(obj, null, 2); return pre; }

/* popover menu */
let menuEl = null;
function closeMenu(){ menuEl?.remove(); menuEl=null; document.removeEventListener("mousedown", outsideMenu, true); }
function outsideMenu(e){ if(menuEl && !menuEl.contains(e.target)) closeMenu(); }
function popMenu(anchor, items, onPick){
  closeMenu();
  menuEl = h("div",{class:"menu", role:"menu"}, ...items.map(it=> it.header ? h("div",{class:"menuHead"}, it.header) :
    h("button",{class:"menuItem"+(it.selected?" sel":""), role:"menuitem", style: it.danger?"color:var(--danger)":"", onclick:()=>{ closeMenu(); onPick(it.value); }},
      it.icon? icon(it.icon) : "", h("span",{class:"mi"}, h("span",{class:"ml"}, it.label), it.sub? h("span",{class:"ms"}, it.sub):""), it.selected? icon("check"):"")));
  document.body.append(menuEl);
  const r = anchor.getBoundingClientRect(), mw = menuEl.offsetWidth, mh = menuEl.offsetHeight;
  let left = Math.max(8, Math.min(r.right - mw, innerWidth - mw - 8)); if(r.left + mw < innerWidth - 8 && r.left < innerWidth/2) left = r.left;
  let top = r.bottom + 6; if(top + mh > innerHeight - 8){ top = r.top - mh - 6; if(top < 8) top = Math.max(8, innerHeight - 8 - mh); }
  menuEl.style.left = left+"px"; menuEl.style.top = top+"px";
  setTimeout(()=>document.addEventListener("mousedown", outsideMenu, true));
}
function modal(content, onClose){
  const bg = h("div",{class:"modalBg"}, content);
  const close = ()=>{ bg.remove(); document.removeEventListener("keydown", esc); onClose?.(); };
  bg.addEventListener("mousedown", e=>{ if(e.target===bg) close(); });
  const esc = (e)=>{ if(e.key==="Escape" && !e.defaultPrevented && !menuEl) close(); };
  document.addEventListener("keydown", esc);
  document.body.append(bg);
  const origRemove = bg.remove.bind(bg); bg.remove = ()=>{ document.removeEventListener("keydown", esc); origRemove(); };
  bg.close = close;
  return bg;
}
function confirmDialog(title, text, okLabel="OK", danger=true){
  return new Promise(res=>{
    const bg = modal(h("div",{class:"modal sm"}, h("h2",{}, title), h("p",{class:"lead"}, text),
      h("div",{class:"actions"}, h("button",{class:"btn", onclick:()=>{ bg.remove(); res(false); }},"Cancel"),
        h("button",{class:"btn "+(danger?"danger":"primary"), onclick:()=>{ bg.remove(); res(true); }}, okLabel))), ()=>res(false));
    setTimeout(()=>bg.querySelector(".btn.danger,.btn.primary")?.focus());
  });
}
/** Asks the user to type the resource's name before a permanent action. */
function typedConfirm(title, text, name, okLabel){
  return new Promise(res=>{
    const inp = h("input",{class:"field", placeholder:name, autocomplete:"off", spellcheck:"false"});
    const ok = h("button",{class:"btn danger", disabled:true, onclick:()=>{ bg.remove(); res(true); }}, okLabel);
    inp.oninput = ()=>{ ok.disabled = inp.value.trim() !== name; };
    inp.onkeydown = e=>{ if(e.key==="Enter" && !ok.disabled) ok.click(); };
    const bg = modal(h("div",{class:"modal sm"}, h("h2",{}, title), h("p",{class:"lead"}, text),
      h("p",{class:"hint", style:"margin:0 0 6px"}, "Type ", h("b",{}, name), " to confirm."), inp,
      h("div",{class:"actions"}, h("button",{class:"btn", onclick:()=>{ bg.remove(); res(false); }},"Cancel"), ok)), ()=>res(false));
    setTimeout(()=>inp.focus());
  });
}
function toast(msg, ms=3600){
  document.querySelectorAll(".toast").forEach(t=>t.remove());
  const t = h("div",{class:"toast", role:"status"}, msg); document.body.append(t); setTimeout(()=>t.remove(), ms);
}

/* ================= formatting ================= */
const fmtN = n => n==null ? "—" : n>=1e6 ? (n/1e6).toFixed(1)+"M" : n>=1000 ? (n/1000).toFixed(n>=10000?0:1)+"k" : String(n);
const toMs = (t)=> typeof t==="number" ? t : (t ? Date.parse(t) : Number.NaN);
function ago(t){
  const ms = toMs(t); if(!Number.isFinite(ms)) return "";
  const s = (Date.now()-ms)/1000;
  if(s < 45) return "just now"; if(s < 3600) return Math.round(s/60)+"m ago"; if(s < 86400) return Math.round(s/3600)+"h ago";
  if(s < 86400*7) return Math.round(s/86400)+"d ago";
  return new Date(ms).toLocaleDateString(undefined,{day:"numeric", month:"short", year: new Date(ms).getFullYear()===new Date().getFullYear()? undefined : "numeric"});
}
const when = (t)=>{ const ms = toMs(t); return Number.isFinite(ms) ? new Date(ms).toLocaleString(undefined,{dateStyle:"medium", timeStyle:"short"}) : "—"; };
function dur(sec){ if(sec==null || !Number.isFinite(sec)) return "—"; if(sec < 1) return Math.round(sec*1000)+"ms"; if(sec < 60) return sec.toFixed(sec<10?1:0)+"s"; const m = Math.floor(sec/60); return m<60 ? `${m}m ${Math.round(sec%60)}s` : `${Math.floor(m/60)}h ${m%60}m`; }
const money = (d)=> d==null ? "—" : d < 0.01 && d > 0 ? "<$0.01" : "$"+d.toFixed(d>=100?0:2);
const centsToDollars = (lc)=> lc?.amount!=null ? Number(lc.amount)/100 : null;
function modelId(m){ return typeof m==="string" ? m : m?.id; }
function modelName(id){ id = modelId(id); return MODELS.find(m=>m.id===id)?.name || id || "—"; }
const short = (s, n=90)=>{ s = String(s??""); return s.length>n ? s.slice(0,n-1)+"…" : s; };

/* list prices (USD per million tokens) — estimates; the API's own list_cost is authoritative */
const PRICES = {
  "claude-opus-5-5":   {in:4,   out:20,  read:0.20},
  "claude-fable-5-1":  {in:10,  out:50,  read:0.25},
  "claude-fable-5":    {in:10,  out:50,  read:1.00},
  "claude-sonnet-5-5": {in:2,   out:10,  read:0.10},
  "claude-haiku-5-5":  {in:0.10,out:0.50,read:0.01, long:{over:100000, in:0.50, out:2.50, read:0.05}},
  "claude-opus-5":     {in:5,   out:25,  read:0.50},
  "claude-opus-4-8":   {in:5,   out:25,  read:0.50},
  "claude-sonnet-5":   {in:2,   out:10,  read:0.20},
  "claude-haiku-4-5":  {in:1,   out:5,   read:0.10},
};
function priceFor(model){ model = modelId(model); if(!model) return null; if(PRICES[model]) return PRICES[model]; const k = Object.keys(PRICES).find(k=>model.startsWith(k)); return k? PRICES[k] : null; }
function costOf(model, u){
  const pr = priceFor(model); if(!pr || !u) return null;
  const inp = u.input_tokens||0, cw = u.cache_creation_input_tokens||0, cr = u.cache_read_input_tokens||0, out = u.output_tokens||0;
  const p = (pr.long && inp+cw+cr > pr.long.over) ? {...pr, ...pr.long} : pr;
  return (inp*p.in + cw*p.in*1.25 + cr*p.read + out*p.out) / 1e6;
}

/* ================= API helpers ================= */
function errText(e){
  if(!e) return "Something went wrong.";
  if(e.noKey) return e.message;
  const msg = e.error?.error?.message || e.error?.message || e.message || String(e);
  if(e.status===401) return "Your API key was rejected (401). Check it in Settings.";
  if(e.status===403) return "Not allowed (403): " + msg;
  if(e.status===404) return "Not found (404): " + msg;
  if(e.status===409) return "Conflict (409): " + msg;
  if(e.status===429) return "Rate limited (429) — wait a moment and try again.";
  if(e.status) return `${msg} (${e.status})`;
  if(/Failed to fetch|NetworkError|Load failed|Connection error/i.test(msg))
    return DESKTOP ? "Couldn’t reach api.anthropic.com — check your connection." :
      "Your browser can’t reach Anthropic’s agent service: Anthropic only accepts agent requests from apps, not from web pages. Use the Page Orbit desktop app.";
  return msg;
}
const RELEASES = "https://github.com/roysinclair/page-studio-apps/releases/latest";
/** In a browser, Anthropic's Managed Agents endpoints refuse cross-origin requests (checked Nov 2026:
    their CORS preflight returns 405, while /v1/messages allows it). The desktop app is required. */
function browserNote(){
  if(DESKTOP || DEMO) return "";
  return h("div",{class:"note warn", style:"margin:0 0 18px;text-align:left"}, icon("alert"), h("div",{},
    h("b",{},"Page Orbit needs the desktop app. "),
    "Anthropic doesn’t let web pages call its Managed Agents service directly (only apps), so this browser version can’t load your agents. ",
    h("a",{href:RELEASES, target:"_blank", rel:"noopener noreferrer", style:"color:var(--accent);font-weight:500"}, "Download Page Orbit for Windows, macOS or Linux"),
    ", or ", h("a",{href:"?demo", style:"color:var(--accent);font-weight:500"}, "explore the demo"), " to see what it does."));
}
/** The one place errors nobody else handled end up: logs, shows a toast, and asks for the key if it is missing. */
function reportError(e, what){
  if(e?.name==="AbortError" || (Anthropic.APIUserAbortError && e instanceof Anthropic.APIUserAbortError)) return;
  console.warn(what||"error", e); toast((what? what+": " : "") + errText(e), 6000); if(e?.noKey) openSettings();
}
/** Runs an API call, shows errors as a toast, returns undefined on failure. */
async function api(fn, what){
  try{ return await fn(C()); }
  catch(e){ reportError(e, what||"api"); }
}
/** Starts a promise without waiting for it (the caller is not async, or must not be held up) and reports a failure
    through reportError instead of losing it. `quiet` logs only, for background work with no screen of its own. */
function fire(p, quiet=false){ Promise.resolve(p).catch(e=> quiet ? console.warn("background task", e) : reportError(e)); }
window.addEventListener("unhandledrejection", e=> reportError(e.reason));
/** Collects up to `max` items from an auto-paginating list. */
async function listAll(pagePromise, max=500){
  const out = []; for await (const x of pagePromise){ out.push(x); if(out.length >= max) break; } return out;
}
function idTag(id){ return h("span",{class:"idTag", title:"Copy ID", onclick:(e)=>{ e.stopPropagation(); copyText(id); }}, id); }
function chip(text, cls="", ic){ return h("span",{class:"chip "+cls}, ic? icon(ic) : "", text); }
function statusChip(st){
  const map = {running:["Running","run"], idle:["Idle","ok"], rescheduling:["Rescheduling","warn"], terminated:["Ended","ghost"],
    active:["Active","ok"], paused:["Paused","warn"]};
  const [t,c] = map[st] || [st||"—",""]; return chip(t, c);
}
const consoleUrl = (path)=> `https://platform.claude.com/workspaces/${encodeURIComponent(settings.workspace||"default")}/${path}`;
function field(attrs={}){ return h("input",{class:"field", autocomplete:"off", spellcheck:"false", ...attrs}); }
function area(attrs={}){ return h("textarea",{class:"field", spellcheck:"false", ...attrs}); }
function select(options, value, attrs={}){
  return h("select",{class:"field", ...attrs}, ...options.map(o=> typeof o==="string" ? h("option",{value:o, selected:o===value}, o) : h("option",{value:o.value, selected:o.value===value}, o.label)));
}
function seg(options, value, onChange, cls="miniSeg"){
  const wrap = h("div",{class:cls});
  const draw = ()=> wrap.replaceChildren(...options.map(o=> h("button",{type:"button", class:(o.value===value?"on ":"")+(o.cls||""), title:o.title||"", onclick:()=>{ value = o.value; draw(); onChange(value); }}, o.label)));
  draw(); wrap.get = ()=> value; return wrap;
}
function parseJSON(text, what){
  try{ return {ok:true, value: text.trim() ? JSON.parse(text) : undefined}; }
  catch(e){ return {ok:false, error:`${what||"JSON"}: ${e.message}`}; }
}
/** Line diff (LCS) for two JSON-able values. */
function diffLines(a, b){
  const A = (typeof a==="string"? a : JSON.stringify(a, null, 2)).split("\n"), B = (typeof b==="string"? b : JSON.stringify(b, null, 2)).split("\n");
  const n = A.length, m = B.length;
  if(n*m > 4e6) return [...A.map(t=>({t, k:"del"})), ...B.map(t=>({t, k:"add"}))];
  const L = Array.from({length:n+1}, ()=> new Uint32Array(m+1));
  for(let i=n-1;i>=0;i--) for(let j=m-1;j>=0;j--) L[i][j] = A[i]===B[j] ? L[i+1][j+1]+1 : Math.max(L[i+1][j], L[i][j+1]);
  const out = []; let i=0, j=0;
  while(i<n && j<m){ if(A[i]===B[j]){ out.push({t:A[i], k:"same"}); i++; j++; } else if(L[i+1][j] >= L[i][j+1]) out.push({t:A[i++], k:"del"}); else out.push({t:B[j++], k:"add"}); }
  while(i<n) out.push({t:A[i++], k:"del"}); while(j<m) out.push({t:B[j++], k:"add"});
  return out;
}
function diffView(a, b, context=3){
  const lines = diffLines(a, b), pre = h("div",{class:"diff"});
  if(!lines.some(l=>l.k!=="same")){ pre.append(h("div",{class:"gap"},"No differences.")); return pre; }
  const keep = lines.map((l,i)=> l.k!=="same" || lines.slice(Math.max(0,i-context), i+context+1).some(x=>x.k!=="same"));
  let skipped = 0;
  lines.forEach((l,i)=>{
    if(!keep[i]){ skipped++; return; }
    if(skipped){ pre.append(h("div",{class:"gap"}, `… ${skipped} unchanged line${skipped>1?"s":""}`)); skipped = 0; }
    pre.append(h("div",{class:l.k}, l.t));
  });
  if(skipped) pre.append(h("div",{class:"gap"}, `… ${skipped} unchanged line${skipped>1?"s":""}`));
  return pre;
}
async function sha256Hex(text){ const d = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text)); return [...new Uint8Array(d)].map(b=>b.toString(16).padStart(2,"0")).join(""); }
function readFileAs(file, how){ return new Promise((res, rej)=>{ const r = new FileReader(); r.onload = ()=>res(r.result); r.onerror = ()=>rej(r.error); r[how](file); }); }
async function saveBlob(blob, name){
  name = (String(name||"file").split(/[\\/]/).pop().replace(/[^\w.\- ()]/g,"_").slice(0,120)) || "file";
  if(DESKTOP){ const where = await invoke("save_bytes",{name, b64:bytesToB64(new Uint8Array(await blob.arrayBuffer()))}).catch(e=>{ toast(String(e)); return null; }); if(where) toast("Saved to "+where); return; }
  const url = URL.createObjectURL(blob); const a = h("a",{href:url, download:name}); document.body.append(a); a.click(); a.remove(); setTimeout(()=>URL.revokeObjectURL(url), 4000); }
