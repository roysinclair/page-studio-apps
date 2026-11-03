/* ================= app shell: navigation, routing, settings ================= */
const NAV = [
  {group:null, items:[{id:"home", label:"Overview", icon:"mark"}]},
  {group:"Run", items:[{id:"sessions", label:"Sessions", icon:"chat"}, {id:"schedules", label:"Schedules", icon:"clock"}]},
  {group:"Build", items:[{id:"agents", label:"Agents", icon:"bot"}, {id:"environments", label:"Environments", icon:"box"}, {id:"vaults", label:"Vaults", icon:"lock"}, {id:"memory", label:"Memory", icon:"db"}, {id:"skills", label:"Skills", icon:"skill"}]},
];
let currentSection = "home", cleanup = null;

function go(path){ const h_ = "#/"+path; if(location.hash===h_) route(); else location.hash = h_; }
function shell({crumb, title, sub, actions, tabs, tab, tabBase, full}={}){
  const view = document.getElementById("view");
  const head = h("div",{class:"viewHead"},
    h("button",{class:"iconBtn", id:"menuBtn", title:"Menu", onclick:()=>document.body.classList.toggle("navOpen")}, icon("menu")),
    h("div",{class:"tt"},
      crumb ? h("div",{class:"crumb"}, crumb.map(([l,p],i)=>[i? icon("chevR") : "", h("button",{onclick:()=>go(p)}, l)])) : "",
      h("h1",{}, title||""), sub ? h("div",{class:"sub"}, sub) : ""),
    ...(actions||[]));
  const body = h("div",{class:"viewBody"});
  const kids = DEMO ? [h("div",{class:"demoBar"}, icon("info"), h("span",{}, h("b",{},"Demo workspace"), " · sample data, scripted replies, nothing is sent anywhere"), h("span",{class:"sp"}),
    h("a",{href:RELEASES, target:"_blank", rel:"noopener noreferrer"}, "Get the desktop app"), h("a",{href:location.pathname}, "Leave the demo")), head] : [head];
  if(tabs) kids.push(h("div",{style:"padding:0 28px"}, h("div",{class:"tabs wrapW", style:"margin-bottom:0"}, tabs.map(t=>h("button",{class:t.id===tab?"on":"", onclick:()=>go(`${tabBase}/${t.id}`)}, t.label, t.n!=null ? h("span",{class:"n"}, t.n) : "")))));
  if(tabs) body.style.paddingTop = "18px";
  kids.push(body);
  view.replaceChildren(...kids);
  return body;
}
async function route(){
  try{ cleanup?.(); }catch{} cleanup = null; activeFeed?.stop(); activeFeed = null;
  closeMenu(); document.body.classList.remove("navOpen");
  const path = location.hash.replace(/^#\/?/,"").split("?")[0];
  const [sec, id, tab] = path.split("/").map(decodeURIComponent);
  currentSection = sec || "home"; renderNav();
  const view = document.getElementById("view");
  if(!getClient() && currentSection!=="home"){ currentSection = "home"; renderNav(); return viewHome(); }
  try{
    let r;
    switch(currentSection){
      case "agents": r = id ? viewAgent(id, tab) : viewAgents(); break;
      case "sessions": r = id ? viewSession(id, tab) : viewSessions(); break;
      case "environments": r = id ? viewEnvironment(id) : viewEnvironments(); break;
      case "vaults": r = id ? viewVault(id) : viewVaults(); break;
      case "schedules": r = id ? viewSchedule(id, tab||"settings") : viewSchedules(); break;
      case "memory": r = id ? viewStore(id, tab) : viewMemory(); break;
      case "skills": r = id ? viewSkill(id) : viewSkills(); break;
      default: r = viewHome();
    }
    const c = await r; if(typeof c==="function") cleanup = c;
  }catch(e){ console.error(e); view.replaceChildren(h("div",{class:"viewBody"}, h("div",{class:"note bad", style:"margin-top:30px"}, icon("alert"), errText(e)))); }
}

function renderNav(){
  const list = document.getElementById("navList");
  list.replaceChildren(...NAV.flatMap(g=>[g.group ? h("div",{class:"navGroup"}, g.group) : "", ...g.items.map(it=>
    h("button",{class:"navItem"+(currentSection===it.id?" on":""), onclick:()=>go(it.id==="home" ? "" : it.id)}, icon(it.icon), it.label))]));
}
function renderChrome(){
  document.getElementById("brandMark").replaceChildren(icon("mark"));
  const ks = document.getElementById("keyState");
  ks.className = "keyState" + (settings.apiKey ? " ok" : "");
  ks.querySelector(".kt").textContent = DEMO ? "Demo workspace" : settings.apiKey ? (DESKTOP ? "Key in keychain" : "Key added") : isLocked() ? "Locked" : "No API key";
  if(DEMO) ks.className = "keyState ok";
  ks.onclick = ()=> isLocked() ? unlockDialog().then(ok=>ok && route()) : openSettings();
  const tb = document.getElementById("themeBtn"); tb.replaceChildren(icon(isDark() ? "sun" : "moon"));
  tb.onclick = ()=>{ settings.theme = isDark() ? "light" : "dark"; saveSettings(); };
  const sb = document.getElementById("settingsBtn"); sb.replaceChildren(icon("sliders")); sb.onclick = openSettings;
  renderNav();
}

/* ---------- overview ---------- */
async function viewHome(){
  const view = document.getElementById("view");
  const body = shell({});
  body.parentElement.querySelector(".viewHead").style.minHeight = "0";
  if(!getClient()){
    body.append(h("div",{class:"hero"},
      browserNote(),
      h("div",{class:"mk"}, icon("mark")),
      h("h1",{},"Build, run and fix ", h("em",{},"agents")),
      h("p",{},"Page Orbit is a free control room for Anthropic’s Managed Agents, using your own API key. Create agents, talk to them while they work, see exactly what they did, and let a model diagnose what went wrong."),
      h("div",{class:"row", style:"justify-content:center"},
        isLocked() ? h("button",{class:"btn primary", onclick:()=>unlockDialog().then(ok=>ok && route())}, icon("key"), "Unlock")
          : DESKTOP ? h("button",{class:"btn primary", onclick:openSettings}, icon("key"), "Add your API key")
          : [h("a",{class:"btn primary", href:"?demo", style:"text-decoration:none"}, icon("play"), "Explore the demo"), h("a",{class:"btn", href:RELEASES, target:"_blank", rel:"noopener noreferrer", style:"text-decoration:none"}, icon("download"), "Get the desktop app")]),
      h("div",{class:"steps"},
        h("div",{}, h("i",{},"01"), h("b",{},"Create an agent"), h("span",{},"Pick a model, write its instructions, choose its tools and what needs your approval.")),
        h("div",{}, h("i",{},"02"), h("b",{},"Talk to it"), h("span",{},"It works in its own cloud sandbox. Watch every step, approve what it asks, stop it any time.")),
        h("div",{}, h("i",{},"03"), h("b",{},"Diagnose & improve"), h("span",{},"One click explains what went wrong and proposes a fix, saved as a new version you can roll back."))),
      h("p",{class:"hint", style:"margin-top:26px"}, DESKTOP ? "Your key is kept in your system keychain." : "Your key stays in this browser and is only ever sent to api.anthropic.com. ", "Not affiliated with Anthropic.")));
    return;
  }
  const recent = h("div",{class:"list"}, h("div",{class:"hint"},"Loading…"));
  const agentsEl = h("div",{class:"list"}, h("div",{class:"hint"},"Loading…"));
  const head = h("div",{class:"row", style:"margin:4px 0 22px"},
    h("div",{}, h("h1",{style:"margin:0;font:650 30px/1.1 var(--serif);letter-spacing:-.03em"}, "Mission control"), h("div",{class:"hint", style:"margin-top:4px"},"Your agents and what they’ve been doing.")),
    h("span",{class:"sp"}),
    h("button",{class:"btn", onclick:()=>go("agents/new")}, icon("plus"), "New agent"),
    h("button",{class:"btn primary", onclick:()=>newSessionDialog({})}, icon("play"), "Start a session"));
  body.append(h("div",{class:"wrapW"}, browserNote(), head,
    h("div",{class:"row", style:"margin-bottom:8px"}, h("b",{},"Recent sessions"), h("span",{class:"sp"}), h("button",{class:"btn sm ghost", onclick:()=>go("sessions")}, "All sessions", icon("chevR"))), recent,
    h("div",{class:"row", style:"margin:26px 0 8px"}, h("b",{},"Agents"), h("span",{class:"sp"}), h("button",{class:"btn sm ghost", onclick:()=>go("agents")}, "All agents", icon("chevR"))), agentsEl));
  const [ss, as] = await Promise.all([api(c=>c.beta.sessions.list({limit:6, order:"desc"}), "Sessions"), api(c=>agentList(true), "Agents")]);
  if(ss) recent.replaceChildren(...(ss.data.length ? ss.data.map(sessionCard) : [h("div",{class:"empty", style:"padding:28px"}, h("p",{style:"margin:0"},"No sessions yet."))]));
  else recent.replaceChildren(h("div",{class:"err"},"Couldn’t load sessions."));
  if(as) agentsEl.replaceChildren(...(as.length ? as.filter(a=>!a.archived_at).slice(0,6).map(agentCard) : [h("div",{class:"empty"}, h("div",{class:"ic"}, icon("bot")), h("b",{},"Create your first agent"), h("p",{},"Start from safe defaults: it can read and search freely, and asks before running commands or changing files."), h("button",{class:"btn primary", onclick:()=>go("agents/new")}, icon("plus"), "New agent"))]));
}

/* ---------- settings ---------- */
function auraKey(){ try{ const s = JSON.parse(localStorage.getItem("cc.settings")||"{}"); return s.keyEnc ? {keyEnc:s.keyEnc} : s.apiKey ? {apiKey:s.apiKey} : null; }catch{ return null; } }
function openSettings(){
  if(DEMO){ const bg = modal(h("div",{class:"modal sm"}, h("h2",{},"Demo workspace"),
      h("p",{class:"lead"},"This demo runs entirely in your browser with made-up data. To work with your own agents, install the Page Orbit desktop app and add your Anthropic API key there."),
      h("label",{class:"f"},"Appearance"), seg([{value:"", label:"System"}, {value:"light", label:"Light"}, {value:"dark", label:"Dark"}], settings.theme||"", v=>{ settings.theme = v; saveSettings(); }, "seg"),
      h("div",{class:"actions"}, h("a",{class:"btn", href:location.pathname, style:"text-decoration:none"}, "Leave the demo"), h("a",{class:"btn primary", href:RELEASES, target:"_blank", rel:"noopener noreferrer", style:"text-decoration:none"}, icon("download"), "Get the desktop app"))));
    return; }
  const key = h("input",{class:"field", type:"password", value: DESKTOP ? "" : settings.apiKey, placeholder: DESKTOP && settings.apiKey ? "Saved in your system keychain — paste a new key to replace it" : "sk-ant-…", autocomplete:"off", spellcheck:"false"});
  const eye = h("button",{class:"btn", type:"button", title:"Show / hide", onclick:()=>{ key.type = key.type==="password"?"text":"password"; }}, icon("eye"));
  const remember = h("input",{type:"checkbox", class:"switch", checked:settings.remember});
  const protect = h("input",{type:"checkbox", class:"switch", checked:!!settings.keyEnc, disabled:!canEncrypt});
  const p1 = h("input",{class:"field", type:"password", placeholder:"New passphrase (8+ characters)", autocomplete:"new-password"});
  const p2 = h("input",{class:"field", type:"password", placeholder:"Repeat passphrase", autocomplete:"new-password"});
  const passBox = h("div",{style:"display:grid;gap:8px;margin:2px 0 6px"},
    settings.keyEnc ? h("p",{class:"hint", style:"margin:0"},"Your key is encrypted. Leave these empty to keep your current passphrase.") : "", p1, p2,
    h("p",{class:"hint", style:"margin:0"},"There’s no way to recover a forgotten passphrase — you’d just enter your API key again."));
  const syncProtect = ()=>{ passBox.style.display = (protect.checked && remember.checked) ? "grid" : "none"; protect.disabled = !canEncrypt || !remember.checked; };
  protect.onchange = syncProtect; remember.onchange = syncProtect; syncProtect();
  const ws = field({value:settings.workspace||"default", class:"field mono", placeholder:"default"});
  const dm = select(MODELS.map(m=>({value:m.id, label:`${m.name} — ${m.sub}`})), settings.diagModel);
  const de = select(EFFORTS.filter(e=>e.id).map(e=>({value:e.id, label:e.name})), settings.diagEffort||"high");
  const status = h("span",{class:"hint"});
  const aura = !DESKTOP && !settings.apiKey && !settings.keyEnc ? auraKey() : null;
  const bg = modal(h("div",{class:"modal"},
    h("h2",{},"Settings"),
    h("p",{class:"lead"},"Page Orbit talks straight to Anthropic’s API with your own key. Nothing goes anywhere else."),
    h("label",{class:"f"},"Anthropic API key"),
    h("div",{class:"keyRow"}, key, eye),
    aura ? h("button",{class:"btn sm", style:"margin-top:8px", onclick:()=>{ if(aura.keyEnc){ settings.keyEnc = aura.keyEnc; settings.apiKey = ""; saveSettings(); bg.remove(); unlockDialog().then(ok=>ok && route()); } else { key.value = aura.apiKey; toast("Your Page Aura key is filled in — click Save"); } }}, icon("key"), "Use the key saved in Page Aura") : "",
    h("p",{class:"hint"}, DESKTOP ? "Stored in your system keychain (shared with the Page Aura desktop app). The app never shows it to this window." : "Create one at platform.claude.com → API keys. Managed Agents must be enabled for your workspace."),
    DESKTOP ? (settings.apiKey ? h("button",{class:"btn sm ghost", style:"color:var(--danger)", onclick:async()=>{ if(!await confirmDialog("Remove the key from the keychain?","Page Aura’s desktop app uses the same key, so it will be removed there too.","Remove")) return; await invoke("key_clear"); settings.apiKey = ""; client = null; bg.remove(); renderChrome(); route(); }}, icon("trash"), "Remove key from keychain") : "") : h("div",{},
      h("label",{class:"toggle"}, h("div",{class:"tx"}, h("b",{},"Remember on this device"), h("span",{},"Off: forgotten when you close the tab")), remember),
      h("label",{class:"toggle"}, h("div",{class:"tx"}, h("b",{},"Protect with a passphrase"), h("span",{},"Encrypts the saved key (AES-256)")), protect), passBox),
    h("div",{class:"section"}, h("h3",{},"Diagnose"),
      h("label",{class:"f"},"Model that reads your sessions"), dm,
      h("label",{class:"f"},"Effort"), de),
    h("div",{class:"section"}, h("h3",{},"Anthropic Console"),
      h("label",{class:"f"},"Workspace ID for “Open in Console” links"), ws),
    h("div",{class:"section"}, h("h3",{},"Appearance"),
      seg([{value:"", label:"System"}, {value:"light", label:"Light"}, {value:"dark", label:"Dark"}], settings.theme||"", v=>{ settings.theme = v; saveSettings(); }, "seg")),
    h("div",{class:"actions"},
      !DESKTOP && settings.keyEnc && settings.apiKey ? h("button",{class:"btn ghost", onclick:()=>{ bg.remove(); lockNow(); }}, icon("lock"), "Lock now") : "",
      h("span",{class:"sp"}), status,
      h("button",{class:"btn", onclick:()=>bg.remove()},"Cancel"),
      h("button",{class:"btn primary", onclick:async()=>{
        Object.assign(settings, {workspace:ws.value.trim()||"default", diagModel:dm.value, diagEffort:de.value});
        const nk = key.value.trim();
        if(DESKTOP){
          if(nk){
            status.style.color = ""; status.textContent = "Saving to keychain…";
            try{ const where = await invoke("key_set",{key:nk}); if(where==="session") toast("No system keychain found — the key is kept until you quit"); }
            catch(e){ status.style.color = "var(--danger)"; status.textContent = String(e); return; }
            settings.apiKey = KEYCHAIN; client = null;
            if(!await checkKey(status)){ await invoke("key_clear").catch(()=>{}); settings.apiKey = ""; client = null; return; }
          }
          saveSettings(); bg.remove(); route(); return;
        }
        let keyEnc = settings.keyEnc;
        const changed = nk !== settings.apiKey;
        if(!(remember.checked && protect.checked) || !nk && !isLocked()) keyEnc = null;
        else if(nk && (!keyEnc || changed || p1.value)){
          status.style.color = "var(--danger)";
          if(p1.value.length < 8){ status.textContent = "Choose a passphrase of at least 8 characters."; p1.focus(); return; }
          if(p1.value !== p2.value){ status.textContent = "The passphrases don’t match."; p2.focus(); return; }
          status.style.color = ""; status.textContent = "Encrypting…";
          keyEnc = await encryptKey(nk, p1.value);
        }
        const prev = {apiKey:settings.apiKey, keyEnc:settings.keyEnc};
        Object.assign(settings, {apiKey:nk, remember:remember.checked, keyEnc}); client = null;
        if(nk && changed && !await checkKey(status)){ Object.assign(settings, prev); client = null; return; }
        saveSettings(); bg.remove(); route();
      }}, icon("check"), "Save"))));
  setTimeout(()=>key.focus());
}
async function checkKey(status){
  status.style.color = ""; status.textContent = "Checking key…";
  try{ await C().beta.agents.list({limit:1}); return true; }
  catch(e){
    if(e.status===401){ status.style.color = "var(--danger)"; status.textContent = "That key was rejected — check it and try again."; return false; }
    if(e.status===403 || e.status===404){ toast("Key saved, but Managed Agents isn’t available for it yet: " + errText(e), 8000); return true; }
    if(!e.status){ toast(errText(e), 9000); return true; }   // network/browser issue: keep the key, explain
    return true;
  }
}

/* ---------- start ---------- */
(async()=>{
  renderChrome();
  if(DESKTOP){
    settings.keyEnc = null; settings.apiKey = (await invoke("key_status").catch(()=>false)) ? KEYCHAIN : "";
    document.documentElement.classList.add("desktop");
  } else if(!DEMO && isLocked()){ renderChrome(); route(); if(await unlockDialog()) route(); window.addEventListener("hashchange", route); return; }
  renderChrome(); route();
  window.addEventListener("hashchange", route);
})();
