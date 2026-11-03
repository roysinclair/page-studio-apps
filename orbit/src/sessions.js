/* ================= sessions ================= */
const sleep = (ms)=> new Promise(r=>setTimeout(r, ms));
const sessTitle = (s)=> s.title || `${s.agent?.name || "Agent"} session`;
const sessCost = (s)=> centsToDollars(s.usage?.list_cost);

function sessionCard(s){
  const cost = sessCost(s);
  return h("div",{class:"card"+(s.archived_at?" archived":""), onclick:()=>go(`sessions/${s.id}`)},
    h("div",{class:"av soft"}, icon(s.deployment_id ? "clock" : "chat")),
    h("div",{class:"main"}, h("div",{class:"t"}, sessTitle(s)),
      h("div",{class:"s"}, `${s.agent?.name||"?"} v${s.agent?.version??"?"} · ${s.id}`)),
    h("div",{class:"chips hideSm"}, statusChip(s.status), cost!=null ? chip(money(cost),"mono") : "", s.deployment_id ? chip("Scheduled","","clock") : "",
      (s.outcome_evaluations||[]).length ? chip(s.outcome_evaluations.at(-1).result, s.outcome_evaluations.at(-1).result==="satisfied"?"ok":"") : "",
      s.archived_at ? chip("Archived","ghost") : ""),
    h("div",{class:"when"}, ago(s.created_at)));
}

async function viewSessions(){
  const body = shell({title:"Sessions", sub:"Every conversation an agent has had — live or finished.",
    actions:[h("button",{class:"btn primary", onclick:()=>newSessionDialog({})}, icon("plus"), "New session")]});
  sessionsInto(body, {});
}
function sessionsInto(body, filter, agent){
  let statuses = [], archived = false, page = null;
  const listEl = h("div",{class:"list"}), moreEl = h("div",{class:"more"});
  const load = async(next=false)=>{
    if(!next){ listEl.replaceChildren(h("div",{class:"hint"},"Loading…")); page = null; }
    const params = {limit:30, order:"desc", ...filter, include_archived:archived};
    if(statuses.length) params.statuses = statuses;
    if(since) params["created_at[gte]"] = new Date(Date.now() - Number(since)*86400e3).toISOString();
    if(page) params.page = page;
    const r = await api(c=>c.beta.sessions.list(params), "Sessions");
    if(!r){ listEl.replaceChildren(h("div",{class:"err"},"Couldn’t load sessions.")); return; }
    if(!next) listEl.replaceChildren();
    if(!r.data.length && !next) listEl.append(h("div",{class:"empty"}, h("div",{class:"ic"}, icon("chat")), h("b",{},"No sessions yet"),
      h("p",{},"A session is one run of an agent in its own sandbox. Start one and talk to it."),
      h("button",{class:"btn primary", onclick:()=>newSessionDialog(agent?{agent}:{})}, icon("plus"), "New session")));
    listEl.append(...r.data.map(sessionCard));
    page = r.next_page || null;
    moreEl.replaceChildren(page ? h("button",{class:"btn", onclick:()=>load(true)}, "Load more") : "");
  };
  let since = "";
  const sinceSel = select([{value:"", label:"Any time"}, {value:"1", label:"Last 24 hours"}, {value:"7", label:"Last 7 days"}, {value:"30", label:"Last 30 days"}], "", {style:"height:30px;width:auto;font-size:12.5px"});
  sinceSel.onchange = ()=>{ since = sinceSel.value; load(); };
  const filt = h("div",{class:"filt", style:"margin:0"});
  const drawFilt = ()=> filt.replaceChildren(...[["","All"],["running","Running"],["idle","Idle"],["terminated","Ended"]].map(([v,l])=>
    h("button",{class:(v ? statuses.includes(v) : !statuses.length) ? "on":"", onclick:()=>{ statuses = v ? [v] : []; drawFilt(); load(); }}, l)));
  drawFilt();
  body.append(h("div",{class:"wrapW"},
    h("div",{class:"toolbar"}, filt, sinceSel, h("span",{class:"sp"}),
      h("label",{class:"check"}, h("input",{type:"checkbox", onchange:(e)=>{ archived = e.target.checked; load(); }}), "Show archived"),
      h("button",{class:"btn sm ghost", onclick:()=>load()}, icon("refresh"), "Refresh"),
      agent && !agent.archived_at ? h("button",{class:"btn sm", onclick:()=>newSessionDialog({agent})}, icon("plus"), "New session") : ""),
    listEl, moreEl));
  load();
}

/* ---------- start a session ---------- */
/** Web tools the agent has switched on, and the sites they're limited to. */
function agentWeb(agent){
  const ts = (agent?.tools||[]).find(t=>t.type===TOOLSET); if(!ts) return {on:false, domains:[]};
  const on = ["web_search","web_fetch"].filter(n=>toolEnabled(ts, n));
  const domains = [...new Set(on.flatMap(n=> (ts.configs||[]).find(c=>c.name===n)?.allowed_domains || []))];
  return {on: on.length>0, tools:on, domains};
}
/** Since Oct 2026, a limited environment's allowed_hosts also filter web search and fetch. */
function webVsEnv(agent, env){
  const w = agentWeb(agent); if(!w.on || !env || env.config?.networking?.type!=="limited") return null;
  const hosts = env.config.networking.allowed_hosts||[];
  const ok = (d)=> hosts.some(hh=> hh===d || (hh.startsWith("*.") && d.endsWith(hh.slice(1))));
  const missing = w.domains.filter(d=>!ok(d));
  if(missing.length) return `This agent’s web tools are limited to ${missing.join(", ")}, which this environment doesn’t allow. Starting the session will fail: add those sites to the environment, or pick an open one.`;
  if(!w.domains.length) return hosts.length ? `This environment only reaches ${hosts.slice(0,4).join(", ")}${hosts.length>4?"…":""}, so the agent’s web search and page reading only work on those sites.` : "This environment has no websites allowed, so the agent’s web search and page reading will find nothing. Pick an open environment, or add sites to this one.";
  return null;
}
async function newSessionDialog({agent, version, envId}={}){
  if(!getClient()){ openSettings(); return; }
  const status = h("span",{class:"err"});
  const box = h("div",{class:"modal wide"}, h("h2",{},"Start a session"), h("p",{class:"lead"},"Loading your agents, environments and vaults…"));
  const bg = modal(box);
  const [agents, envs, vaults, stores] = await Promise.all([
    agentList(true).catch(()=>[]),
    listAll(C().beta.environments.list({limit:100}), 200).catch(()=>[]),
    listAll(C().beta.vaults.list({limit:100}), 200).catch(()=>[]),
    listAll(C().beta.memoryStores.list({limit:100}), 200).catch(()=>[]),
  ]);
  const live = agents.filter(a=>!a.archived_at);
  if(!live.length){ box.replaceChildren(h("h2",{},"No agents yet"), h("p",{class:"lead"},"Create an agent first, then talk to it."),
    h("div",{class:"actions"}, h("button",{class:"btn", onclick:()=>bg.remove()},"Cancel"), h("button",{class:"btn primary", onclick:()=>{ bg.remove(); go("agents/new"); }}, icon("plus"),"New agent"))); return; }
  const agentSel = select(live.map(a=>({value:a.id, label:`${a.name}  ·  v${a.version}`})), agent?.id || live[0].id);
  const verIn = field({type:"number", min:1, placeholder:"Latest", value: version || "", style:"max-width:120px"});
  const liveEnvs = envs.filter(e=>!e.archived_at);
  const envSel = select([...liveEnvs.map(e=>({value:e.id, label:`${e.name}  ·  ${e.config?.networking?.type==="limited" ? "limited network" : "open network"}`})),
    {value:"__new", label:"+ New safe environment (only the sites this agent needs)"}, {value:"__open", label:"+ New open-internet environment"}], envId || liveEnvs[0]?.id || "__new");
  const envNote = h("div",{});
  const title = field({placeholder:"Optional, e.g. “Fix the login bug”"});
  const vChecks = vaults.filter(v=>!v.archived_at).map(v=>({id:v.id, el:h("input",{type:"checkbox"}), name:v.display_name}));
  const mChecks = stores.filter(s=>!s.archived_at).map(s=>({id:s.id, el:h("input",{type:"checkbox"}), ro:h("input",{type:"checkbox"}), name:s.name}));
  const repo = field({placeholder:"https://github.com/owner/repo", class:"field mono"});
  const branch = field({placeholder:"Branch (optional)", style:"max-width:200px"});
  const token = field({type:"password", placeholder:"Access token — only for private repos", autocomplete:"new-password"});
  const cap = field({type:"number", min:0.5, step:0.5, placeholder:"No cap", style:"max-width:140px"});
  // files to mount read-only at /mnt/session/uploads/
  const files = []; const fileRow = h("div",{class:"inline"});
  const drawFiles = ()=> fileRow.replaceChildren(...files.map((f,i)=>h("span",{class:"att"}, icon("file"), h("span",{}, f.name), h("button",{class:"iconBtn sm", onclick:()=>{ files.splice(i,1); drawFiles(); }}, icon("x")))),
    h("button",{class:"btn sm", onclick:()=>{ const fi = $("#fileInput"); fi.value = ""; fi.accept = ""; fi.onchange = ()=>{ for(const f of fi.files){ if(f.size > 500*1024*1024) toast(`${f.name} is over 500 MB`); else files.push(f); } drawFiles(); }; fi.click(); }}, icon("clip"), "Add files"));
  drawFiles();
  // how it starts: a message, or a goal with a rubric
  let startMode = "message";
  const first = area({rows:4, placeholder:"First message (optional) — the agent starts working straight away."});
  const goal = area({rows:2, placeholder:"The goal, e.g. “A tested fix for the login bug, as a patch in /mnt/session/outputs/”"});
  const rubric = area({rows:5, placeholder:"How to judge it — one check per line:\n- The patch applies cleanly\n- All tests pass"});
  const iters = field({type:"number", min:1, max:20, value:3, style:"max-width:90px"});
  const goalBox = h("div",{style:"display:none;gap:8px"}, goal, rubric, h("div",{class:"inline"}, h("span",{class:"hint"},"Most grading rounds"), iters), h("p",{class:"hint", style:"margin:0"},"The first message above is sent too, as context (optional)."));
  const modeSeg = seg([{value:"message", label:"Start with a message"}, {value:"goal", label:"Give it a goal to meet"}], startMode, v=>{ startMode = v; goalBox.style.display = v==="goal" ? "grid" : "none"; });
  // per-session changes to the agent (no new version)
  const ovModel = select([{value:"", label:"Agent’s own model"}, ...MODELS.map(m=>({value:m.id, label:m.name}))], "");
  const ovEffortWrap = h("span",{}); let ovEffort;
  const ovFast = h("input",{type:"checkbox"});
  const ovSystem = area({rows:5, placeholder:"Leave empty to use the agent’s own instructions"});
  const syncOv = ()=>{ const a = live.find(x=>x.id===agentSel.value); const id = ovModel.value || a?.model?.id;
    ovEffort = select(effortOptions(id), ovEffort?.value || ""); ovEffort.style.maxWidth = "220px"; ovEffortWrap.replaceChildren(ovEffort);
    ovFast.disabled = !modelInfo(id).fast; if(ovFast.disabled) ovFast.checked = false; };
  ovModel.onchange = syncOv;
  const ovBox = h("details",{}, h("summary",{class:"hint", style:"cursor:pointer"},"Run this session with a different model or instructions"),
    h("div",{style:"display:grid;gap:8px;margin-top:10px"}, h("div",{class:"inline"}, ovModel, ovEffortWrap, h("label",{class:"check"}, ovFast, "Fast")), ovSystem,
      h("p",{class:"hint", style:"margin:0"},"Only for this session: the agent itself doesn’t change and no version is made.")));
  const syncAgent = ()=>{ const a = live.find(x=>x.id===agentSel.value), e = liveEnvs.find(x=>x.id===envSel.value);
    const msg = e ? webVsEnv(a, e) : envSel.value==="__new" && agentWeb(a).on && !agentWeb(a).domains.length ? "This agent searches the web without a site list. A safe environment would block that: choose the open-internet option, or limit its web tools to certain sites in the agent." : null;
    envNote.replaceChildren(msg ? h("div",{class:"note warn", style:"margin-top:8px"}, icon("alert"), msg) : ""); syncOv(); };
  agentSel.onchange = syncAgent; envSel.onchange = syncAgent; syncAgent();

  const go_ = h("button",{class:"btn primary"}, icon("play"), "Start session");
  go_.onclick = async()=>{
    status.textContent = ""; go_.disabled = true;
    try{
      const a = live.find(x=>x.id===agentSel.value);
      if(startMode==="goal" && (!goal.value.trim() || !rubric.value.trim())) throw new Error("Fill in the goal and the rubric.");
      let env = envSel.value;
      if(env==="__new" || env==="__open"){ status.className = "hint"; status.textContent = "Creating environment…";
        const hosts = agentWeb(a).domains;
        const e = await C().beta.environments.create(env==="__open"
          ? {name:"open-internet", description:"Created by Page Orbit: cloud sandbox with open internet access", config:{type:"cloud", networking:{type:"unrestricted"}}}
          : {name:"safe", description:"Created by Page Orbit: cloud sandbox, package managers, MCP servers" + (hosts.length ? " and the agent’s web sites" : ""),
             config:{type:"cloud", networking:{type:"limited", allowed_hosts:hosts, allow_package_managers:true, allow_mcp_servers:true}}});
        env = e.id; }
      const params = {environment_id: env};
      const ver = parseInt(verIn.value, 10);
      const ov = {};
      if(ovModel.value || ovEffort.value || ovFast.checked){ const base = ovModel.value || a.model.id; ov.model = {id:base}; const ef = ovEffort.value || (!ovModel.value && (a.model.effort?.type||a.model.effort)); if(ef) ov.model.effort = ef; if(ovFast.checked) ov.model.speed = "fast"; if(!ovModel.value && a.model.inference_geo) ov.model.inference_geo = a.model.inference_geo; }
      if(ovSystem.value.trim()) ov.system = ovSystem.value;
      if(Object.keys(ov).length) params.agent = {type:"agent_with_overrides", id:a.id, ...(ver ? {version:ver} : {}), ...ov};
      else params.agent = ver ? {type:"agent", id:a.id, version:ver} : a.id;
      if(title.value.trim()) params.title = title.value.trim();
      const vids = vChecks.filter(v=>v.el.checked).map(v=>v.id); if(vids.length) params.vault_ids = vids;
      const res = mChecks.filter(m=>m.el.checked).map(m=>({type:"memory_store", memory_store_id:m.id, access: m.ro.checked ? "read_only" : "read_write"}));
      if(repo.value.trim()){
        if(!/^https:\/\/github\.com\/[\w.-]+\/[\w.-]+\/?$/.test(repo.value.trim().replace(/\.git$/,""))) throw new Error("Use a repository link like https://github.com/owner/repo");
        const r = {type:"github_repository", url:repo.value.trim().replace(/\.git$/,"")};
        if(branch.value.trim()) r.checkout = {type:"branch", name:branch.value.trim()};
        if(token.value) r.authorization_token = token.value;
        res.push(r);
      }
      for(let i=0;i<files.length;i++){ status.className = "hint"; status.textContent = `Uploading ${files[i].name} (${i+1}/${files.length})…`;
        const up = await C().beta.files.upload({file:files[i]}); res.push({type:"file", file_id:up.id, mount_path:"/"+safeName(files[i].name)}); }
      if(res.length) params.resources = res;
      const c = parseFloat(cap.value); if(c > 0) params.budget = {type:"limit", max_list_cost:{amount:String(Math.round(c*100)), currency:"USD"}};
      const ie = [];
      if(first.value.trim()) ie.push({type:"user.message", content:[{type:"text", text:first.value.trim()}]});
      if(startMode==="goal") ie.push({type:"user.define_outcome", description:goal.value.trim(), rubric:{type:"text", content:rubric.value.trim()}, max_iterations:Math.max(1, Math.min(20, parseInt(iters.value,10)||3))});
      if(ie.length) params.initial_events = ie;
      status.className = "hint"; status.textContent = "Starting…";
      const s = await C().beta.sessions.create(params);
      token.value = "";
      bg.remove(); go(`sessions/${s.id}`);
    }catch(e){ status.className = "err"; status.textContent = e.message && !e.status ? e.message : errText(e); go_.disabled = false; }
  };
  box.replaceChildren(h("h2",{},"Start a session"),
    h("p",{class:"lead"},"The agent gets its own cloud sandbox. Sessions are billed at list price for tokens plus $0.08 per hour of sandbox time."),
    h("div",{class:"form"},
      h("label",{},"Agent"), h("div",{style:"display:grid;gap:8px"}, h("div",{class:"inline"}, agentSel, verIn), ovBox),
      h("label",{},"Environment", h("small",{},"The sandbox it runs in")), h("div",{}, envSel, envNote),
      h("label",{},"Title"), title,
      h("label",{},"Spending cap", h("small",{},"Pauses the session at this list cost")), h("div",{class:"inline"}, h("span",{},"$"), cap),
      vChecks.length ? [h("label",{},"Vaults", h("small",{},"Credentials for MCP servers")), h("div",{style:"padding-top:8px"}, vChecks.map(v=>h("label",{class:"check", style:"margin-right:14px"}, v.el, v.name)))] : "",
      mChecks.length ? [h("label",{},"Memory", h("small",{},"Mounted at /mnt/memory/")), h("div",{style:"padding-top:6px;display:grid;gap:6px"}, mChecks.map(m=>h("div",{class:"inline"}, h("label",{class:"check"}, m.el, m.name), h("label",{class:"check hint"}, m.ro, "read-only"))))] : "",
      h("label",{},"GitHub repository", h("small",{},"Cloned into /workspace")), h("div",{style:"display:grid;gap:8px"}, h("div",{class:"inline"}, repo, branch), token),
      h("label",{},"Files", h("small",{},"Read-only at /mnt/session/uploads/")), fileRow,
      h("label",{},"How it starts"), h("div",{style:"display:grid;gap:8px"}, modeSeg, first, goalBox)),
    h("p",{class:"hint", style:"margin:14px 0 0"},"Vaults, memory and repositories can only be attached now. Files can also be added later."),
    h("div",{class:"actions"}, status, h("span",{class:"sp"}), h("button",{class:"btn", onclick:()=>bg.remove()},"Cancel"), go_));
  setTimeout(()=>first.focus());
}
const safeName = (n)=> (String(n||"file").split(/[\\/]/).pop().replace(/[^\w.\- ()]/g,"_").slice(0,120)) || "file";

/* ---------- live session ---------- */
/** Keeps one session's event history in sync: stream first, then history, de-duplicated by id. */
class SessionFeed {
  constructor(sid, handlers){ this.sid = sid; this.h = handlers; this.byKey = new Map(); this.events = []; this.closed = false; this.lastAt = null; this.connected = false; }
  key(ev){ return ev.id || `${ev.type}@${ev.processed_at}`; }
  start(){ this.loop(); }
  stop(){ this.closed = true; try{ this.stream?.controller?.abort(); }catch{} }
  async loadHistory(){
    const params = {limit:1000};
    if(this.lastAt) params["created_at[gte]"] = this.lastAt;
    for await (const ev of C().beta.sessions.events.list(this.sid, params)){ if(this.closed) return; this.ingest(ev); }
  }
  ingest(ev){
    if(ev.type==="event_start" || ev.type==="event_delta"){ this.h.preview?.(ev); return; }
    const k = this.key(ev), old = this.byKey.get(k);
    if(old){
      if(old.processed_at==null && ev.processed_at){ old.processed_at = ev.processed_at; this.h.update?.(old); }
      return;
    }
    this.byKey.set(k, ev); this.events.push(ev);
    if(ev.processed_at && (!this.lastAt || ev.processed_at > this.lastAt)) this.lastAt = ev.processed_at;
    if(ev.type==="session.status_terminated" || ev.type==="session.deleted") this.ended = true;
    this.h.event(ev);
  }
  async loop(){
    let backoff = 1000;
    while(!this.closed){
      try{
        this.stream = await C().beta.sessions.events.stream(this.sid, {event_deltas:["agent.message","agent.thinking"]});
        this.connected = true; this.h.conn?.(true);
        await this.loadHistory();            // after the stream is open, so nothing falls in the gap
        this.h.synced?.();
        backoff = 1000;
        for await (const ev of this.stream){ if(this.closed) break; this.ingest(ev); }
      }catch(e){
        if(this.closed || e?.name==="AbortError") break;
        console.warn("session stream", e);
        if(e?.status===404 || e?.status===401){ this.h.fatal?.(e); break; }
        this.h.conn?.(false, e);
      }
      this.connected = false;
      if(this.closed || this.ended) break;
      await sleep(backoff); backoff = Math.min(backoff*2, 30000);
    }
  }
}
let activeFeed = null;

function blocksText(content){ return (content||[]).map(b=> b.type==="text" ? b.text : b.type==="redacted" ? "[redacted]" : b.type==="image" ? "[image]" : b.type==="document" ? `[document${b.title?": "+b.title:""}]` : b.type==="search_result" ? `[search result: ${b.title||b.source||""}]` : `[${b.type}]`).join("\n"); }
function toolPreview(input){ if(input==null) return ""; if(typeof input==="string") return input; const v = input.command ?? input.path ?? input.file_path ?? input.pattern ?? input.query ?? input.url; return v!=null ? String(v) : JSON.stringify(input); }

async function viewSession(id, tab){
  activeFeed?.stop(); activeFeed = null;
  const s0 = await api(c=>c.beta.sessions.retrieve(id), "Session");
  if(!s0){ shell({crumb:[["Sessions","sessions"]], title:"Session not found"}); return; }
  let sess = s0;
  const ui = {status:s0.status, pending:new Map(), usage:s0.usage, budget:s0.budget, outcomes:new Map(), tools:new Map(), customs:new Map(), previews:new Map(), firstAt:null, thinking:false, stopReason:null, interrupted:false};
  const archived = !!s0.archived_at;

  // ---- header
  const stChip = h("span",{}); const conn = h("span",{class:"hint"});
  const drawStatus = ()=>{ stChip.replaceChildren(statusChip(ui.status === "idle" && ui.pending.size ? "waiting" : ui.status)); if(ui.status==="idle" && ui.pending.size) stChip.replaceChildren(chip("Needs you","warn","alert")); };
  const more = h("button",{class:"iconBtn", title:"More"}, icon("menu"));
  more.onclick = ()=> popMenu(more, [
    {label:"Rename", value:"rename", icon:"pen"},
    {label:"Open in Anthropic Console", value:"console", icon:"ext"},
    {label:"Copy ID", value:"id", icon:"copy"},
    {label:"Export events (JSON)", value:"export", icon:"download"},
    ...(archived ? [] : [{label:"Archive session…", sub:"Read-only from then on", value:"archive", icon:"archive", danger:true}]),
    {label:"Delete session…", sub:"Removes its history and sandbox", value:"delete", icon:"trash", danger:true},
  ], async v=>{
    if(v==="id") copyText(id);
    if(v==="console"){ const a = h("a",{href:consoleUrl(`sessions/${id}`), target:"_blank", rel:"noopener noreferrer"}); document.body.append(a); a.click(); a.remove(); }
    if(v==="export") saveBlob(new Blob([JSON.stringify({session:sess, events:feed.events}, null, 2)], {type:"application/json"}), `${id}.json`);
    if(v==="rename"){
      const t = field({value:sess.title||""}); const bg = modal(h("div",{class:"modal sm"}, h("h2",{},"Rename session"), t,
        h("div",{class:"actions"}, h("button",{class:"btn", onclick:()=>bg.remove()},"Cancel"), h("button",{class:"btn primary", onclick:async()=>{
          const r = await api(c=>c.beta.sessions.update(id, {title:t.value.trim()||null}), "Rename"); if(r){ bg.remove(); sess = r; $("h1", document.getElementById("view")).textContent = sessTitle(r); } }}, "Save"))));
      setTimeout(()=>t.select());
    }
    if(v==="archive" || v==="delete"){
      const del = v==="delete";
      if(!await confirmDialog(del ? "Delete this session?" : "Archive this session?", del ? "Its full event history, sandbox and files are removed for good. Consider keeping it as a record for debugging." : "Archiving is permanent: the session becomes read-only. Its history stays available.", del ? "Delete forever" : "Archive")) return;
      for(let i=0;i<10;i++){ const s = await C().beta.sessions.retrieve(id).catch(()=>null); if(!s || s.status!=="running") break; await sleep(250); }
      const r = await api(c=> del ? c.beta.sessions.delete(id) : c.beta.sessions.archive(id), del ? "Delete" : "Archive");
      if(r){ toast(del ? "Session deleted" : "Session archived"); feed.stop(); go(del ? "sessions" : `sessions/${id}`); }
    }
  });
  const inspBtn = h("button",{class:"iconBtn", title:"Show / hide the inspector"}, icon("panel"));
  const body = shell({crumb:[["Sessions","sessions"], [sess.agent?.name||"Agent", `agents/${sess.agent?.id}`]], title:sessTitle(sess),
    sub:[stChip, idTag(id), h("a",{href:`#/agents/${sess.agent?.id}/versions`, class:"chip mono", style:"text-decoration:none"}, `v${sess.agent?.version}`), chip(modelName(sess.agent?.model)), conn],
    actions:[h("button",{class:"btn", onclick:()=>openDiagnose(sess, feed.events)}, icon("pulse"), "Diagnose"), inspBtn, more], full:true});
  drawStatus();

  // ---- layout
  const inner = h("div",{class:"streamInner"});
  const streamEl = h("div",{class:"stream"}, inner);
  const thinkingEl = h("div",{class:"thinking", style:"display:none"}, h("span",{class:"dots"}, h("i"),h("i"),h("i")), h("span",{}, "Working…"));
  const noteEl = h("div",{class:"composerNote"});
  const composer = buildComposer();
  const convo = h("div",{class:"convo"}, streamEl, h("div",{class:"composer"}, noteEl, composer.el));
  const inspTabs = h("div",{class:"tabs"}), inspBody = h("div",{class:"inspBody"});
  const insp = h("div",{class:"insp"}, inspTabs, inspBody);
  const layoutEl = h("div",{class:"sess"+(settings.inspector?"":" noInspector")}, convo, insp);
  body.replaceWith(layoutEl);
  inspBtn.onclick = ()=>{ if(innerWidth <= 860){ layoutEl.classList.toggle("showInsp"); return; } settings.inspector = !settings.inspector; saveSettings(); layoutEl.classList.toggle("noInspector", !settings.inspector); };
  inner.append(thinkingEl);

  let stick = true;
  streamEl.addEventListener("scroll", ()=>{ stick = streamEl.scrollHeight - streamEl.scrollTop - streamEl.clientHeight < 80; });
  const scroll = ()=>{ if(stick) requestAnimationFrame(()=>{ streamEl.scrollTop = streamEl.scrollHeight; }); };
  const add = (el)=>{ inner.insertBefore(el, thinkingEl); scroll(); return el; };
  const sys = (ic, text)=> add(h("div",{class:"ev sys"}, icon(ic), h("span",{}, text)));

  // ---- conversation renderers
  const userEls = new Map();
  function userBubble(ev){
    const atts = (ev.content||[]).filter(b=>b.type!=="text");
    const el = h("div",{class:"ev user"+(ev.processed_at?"":" queued")}, blocksText((ev.content||[]).filter(b=>b.type==="text")),
      atts.length ? h("div",{class:"att"}, atts.map(b=>chip(b.type==="image" ? "Image" : (b.title || "Document"), "", b.type==="image" ? "eye" : "file"))) : "",
      ev.processed_at ? "" : h("span",{class:"q"},"Queued"));
    userEls.set(ev.id, el); return add(el);
  }
  function agentBubble(ev, preview){
    const who = ev.session_thread_id ? "Helper" : (sess.agent?.name || "Agent");
    return h("div",{class:"ev agent"+(preview?" preview":"")}, h("div",{class:"av"}, icon("mark")),
      h("div",{class:"body"}, h("div",{class:"who"}, who), renderMd(blocksText(ev.content))));
  }
  function toolRow(ev){
    const name = ev.type==="agent.mcp_tool_use" ? `${ev.mcp_server_name} · ${ev.name}` : ev.name;
    const spin = h("span",{class:"spin"});
    const det = h("details",{class:"tool"}, h("summary",{}, icon("chevR","chev"), icon(ev.type==="agent.mcp_tool_use" ? "plug" : ev.type==="agent.custom_tool_use" ? "code" : "terminal"),
      h("span",{class:"nm"}, name), h("span",{class:"pv"}, short(toolPreview(ev.input), 140)), spin),
      h("div",{class:"tb"}, h("h4",{},"Input"), jsonView(ev.input ?? {})));
    det.setResult = (r)=>{
      spin.remove(); if(r.is_error) det.classList.add("err");
      det.querySelector("summary").append(r.is_error ? chip("error","bad") : icon("check"));
      const text = blocksText(r.content);
      const why = /url_not_in_prior_context/.test(text) ? "Page reading only opens links that already came up in the conversation. Paste the link in your message, or let it search first."
        : /url_not_allowed|domain.*not allowed|blocked_domain/i.test(text) ? "That site isn’t allowed by the agent’s web settings, the environment’s network list, or your organisation’s Console settings." : "";
      if(why) det.querySelector(".tb").append(h("div",{class:"note warn"}, icon("info"), why));
      det.querySelector(".tb").append(h("h4",{}, r.is_error ? "Error" : "Result"), jsonView(text.length > 20000 ? text.slice(0,20000)+"\n… (shortened here)" : text || "(empty)"));
    };
    ui.tools.set(ev.id, det); return add(det);
  }
  function askCard(ev){
    const reason = ev.evaluation?.type==="auto" ? " The automatic safety check wasn’t sure about this one." : "";
    const denyMsg = field({placeholder:"Why not? (optional — the agent sees this)", style:"flex:1"});
    const card = h("div",{class:"ev ask"},
      h("div",{class:"ah"}, icon("alert"), `Allow ${ev.type==="agent.mcp_tool_use" ? ev.mcp_server_name+" · " : ""}${ev.name}?`),
      h("div",{class:"ad"}, "The agent is waiting for your approval." + reason + (ev.session_thread_id ? " (asked by a helper agent)" : "")),
      jsonView(ev.input ?? {}),
      h("div",{class:"row"}, denyMsg,
        h("button",{class:"btn", onclick:()=>answer("deny")}, icon("x"), "Deny"),
        h("button",{class:"btn primary", onclick:()=>answer("allow")}, icon("check"), "Allow")));
    async function answer(result){
      card.querySelectorAll("button").forEach(b=>b.disabled = true);
      const e = {type:"user.tool_confirmation", tool_use_id:ev.id, result};
      if(result==="deny" && denyMsg.value.trim()) e.deny_message = denyMsg.value.trim();
      const r = await api(c=>c.beta.sessions.events.send(id, {events:[e]}), "Answer");
      if(!r){ card.querySelectorAll("button").forEach(b=>b.disabled = false); return; }
      (r.data||[]).forEach(x=>feed.ingest(x));
      card.resolve(result);
    }
    card.resolve = (result)=>{ if(card.done) return; card.done = true; card.classList.add("done"); card.querySelector(".row").replaceWith(h("div",{class:"hint"}, result==="allow" ? "✓ You allowed this." : "✕ You denied this.")); ui.pending.delete(ev.id); refresh(); };
    card.stale = ()=>{ if(card.done) return; card.done = true; card.classList.add("done"); card.querySelector(".row").replaceWith(h("div",{class:"hint"},"No longer waiting — the turn ended.")); ui.pending.delete(ev.id); };
    ui.pending.set(ev.id, card); return add(card);
  }
  function customCard(ev){
    const ta = area({rows:3, placeholder:"The result to give the agent (text or JSON)"});
    const card = h("div",{class:"ev ask"},
      h("div",{class:"ah"}, icon("code"), `The agent called your tool “${ev.name}”`),
      h("div",{class:"ad"}, "Run it however you like and paste the result. The agent waits until you answer."),
      jsonView(ev.input ?? {}), ta,
      h("div",{class:"row", style:"margin-top:8px"}, h("span",{class:"sp"}),
        h("button",{class:"btn", onclick:()=>answer(true)}, icon("alert"), "Send as error"),
        h("button",{class:"btn primary", onclick:()=>answer(false)}, icon("up"), "Send result")));
    async function answer(isErr){
      card.querySelectorAll("button").forEach(b=>b.disabled = true);
      const r = await api(c=>c.beta.sessions.events.send(id, {events:[{type:"user.custom_tool_result", custom_tool_use_id:ev.id, content:[{type:"text", text:ta.value||"(no output)"}], is_error:isErr}]}), "Send result");
      if(!r){ card.querySelectorAll("button").forEach(b=>b.disabled = false); return; }
      (r.data||[]).forEach(x=>feed.ingest(x));
      card.resolve();
    }
    card.resolve = ()=>{ if(card.done) return; card.done = true; card.classList.add("done"); ta.disabled = true; card.querySelector(".row").replaceWith(h("div",{class:"hint"},"✓ Result sent.")); ui.pending.delete(ev.id); refresh(); };
    card.stale = ()=>{ if(card.done) return; card.done = true; card.classList.add("done"); ta.disabled = true; card.querySelector(".row").replaceWith(h("div",{class:"hint"},"No longer waiting — the turn ended.")); ui.pending.delete(ev.id); };
    ui.pending.set(ev.id, card); ui.customs.set(ev.id, card); return add(card);
  }
  function outcomeCard(ev){
    const iters = h("div",{class:"iters"}), st = h("span",{});
    const card = h("div",{class:"ev outcome"}, h("div",{class:"oh"}, icon("flag"), "Outcome: ", h("span",{style:"font-weight:500"}, short(ev.description, 140)), h("span",{class:"sp", style:"flex:1"}), st),
      h("details",{style:"margin-top:6px"}, h("summary",{class:"hint", style:"cursor:pointer"},"Rubric"), jsonView(ev.rubric?.content || ev.rubric || "")), iters);
    st.replaceChildren(chip("Working","run"));
    card.start = (e)=>{ st.replaceChildren(chip(`Grading · round ${e.iteration+1}`,"run")); };
    card.end = (e)=>{
      const good = e.result==="satisfied";
      st.replaceChildren(chip(e.result.replace(/_/g," "), good ? "ok" : e.result==="needs_revision" ? "warn" : "bad"));
      iters.append(h("div",{class:"box"}, h("div",{class:"boxHead"}, h("b",{}, `Round ${e.iteration+1}`), chip(e.result.replace(/_/g," "), good?"ok":"")), e.explanation ? renderMd(e.explanation) : ""));
      scroll();
    };
    ui.outcomes.set(ev.outcome_id, card); return add(card);
  }
  const ERR_LABEL = {model_overloaded_error:"The model is overloaded", model_rate_limited_error:"Rate limited", billing_error:"Billing problem — check your Anthropic balance",
    mcp_connection_failed_error:"Couldn’t connect to an MCP server", mcp_authentication_failed_error:"An MCP server rejected its credentials — check the vault",
    credential_host_unreachable_error:"A vault credential’s host is unreachable", repository_authentication_error:"GitHub rejected the repository token",
    tool_use_limit_reached_error:"Hit the limit on tool steps for one turn — send a message to let it continue",
    compaction_limit_reached_error:"The conversation was summarised too many times in a row — send a message to continue",
    model_request_failed_error:"A model request failed"};
  function errorBanner(ev){
    const e = ev.error||{}, rs = e.retry_status?.type;
    const label = ERR_LABEL[e.type] || e.type?.replace(/_/g," ") || "Error";
    return add(h("div",{class:"ev banner "+(rs==="retrying" ? "warn" : "")}, icon("alert"), h("div",{},
      h("b",{}, label + (e.mcp_server_name ? ` (${e.mcp_server_name})` : "")), " — ", e.message || "",
      h("div",{class:"hint"}, rs==="retrying" ? "Retrying automatically." : rs==="exhausted" ? "Gave up on this turn. You can send another message." : rs==="terminal" ? "The session will end." : ""))));
  }

  function onEvent(ev){
    if(!ui.firstAt && ev.processed_at) ui.firstAt = ev.processed_at;
    const t = ev.type;
    if(t==="user.message") userBubble(ev);
    else if(t==="agent.message"){
      const p = ui.previews.get(ev.id); const el = agentBubble(ev);
      if(p){ p.el.replaceWith(el); ui.previews.delete(ev.id); } else add(el);
      scroll();
    }
    else if(t==="agent.tool_use" || t==="agent.mcp_tool_use"){
      toolRow(ev);
      if(ev.evaluated_permission==="ask") askCard(ev);
      else if(ev.evaluated_permission==="deny") add(h("div",{class:"ev hint", style:"margin-left:40px"},"⛔ Blocked by the automatic safety check."));
    }
    else if(t==="agent.custom_tool_use"){ toolRow(ev); customCard(ev); }
    else if(t==="agent.tool_result") ui.tools.get(ev.tool_use_id)?.setResult(ev);
    else if(t==="agent.mcp_tool_result") ui.tools.get(ev.mcp_tool_use_id)?.setResult(ev);
    else if(t==="user.tool_confirmation"){ ui.pending.get(ev.tool_use_id)?.resolve(ev.result); }
    else if(t==="user.custom_tool_result"){ ui.customs.get(ev.custom_tool_use_id)?.resolve(); ui.tools.get(ev.custom_tool_use_id)?.setResult(ev); }
    else if(t==="user.interrupt"){ sys("stop","You stopped the agent"); }
    else if(t==="user.define_outcome") outcomeCard(ev);
    else if(t==="span.outcome_evaluation_start") ui.outcomes.get(ev.outcome_id)?.start(ev);
    else if(t==="span.outcome_evaluation_end") ui.outcomes.get(ev.outcome_id)?.end(ev);
    else if(t==="system.message") sys("info", "System note: " + short(blocksText(ev.content), 160));
    else if(t==="session.error") errorBanner(ev);
    else if(t==="session.status_running"){ ui.status = "running"; ui.stopReason = null; }
    else if(t==="session.status_rescheduled"){ ui.status = "rescheduling"; }
    else if(t==="session.status_idle"){
      ui.status = "idle"; ui.stopReason = ev.stop_reason;
      const r = ev.stop_reason?.type;
      if(r==="budget_reached") add(h("div",{class:"ev banner warn"}, icon("alert"), h("div",{}, h("b",{},"Paused at the spending cap. "), "Raise the cap to let it carry on.", h("div",{style:"margin-top:6px"}, h("button",{class:"btn sm", onclick:()=>budgetDialog()}, "Change cap")))));
      else if(r==="retries_exhausted"){
        const last = [...feed.events].reverse().find(e=>e.type==="session.error");
        const t2 = last?.error?.type;
        add(h("div",{class:"ev banner"}, icon("alert"), h("div",{}, t2==="tool_use_limit_reached_error" ? [h("b",{},"The turn stopped at the tool-step limit. "), "Nothing failed: send a message (for example “carry on”) to let it continue."]
          : t2==="compaction_limit_reached_error" ? [h("b",{},"The turn stopped: its context kept filling up. "), "Send a message to continue, ideally narrowing the task."]
          : [h("b",{},"This turn failed after several retries. "), "You can send another message, or click Diagnose."])));
      }
      else if(r==="refusal") add(h("div",{class:"ev banner"}, icon("shield"), h("div",{}, h("b",{},"The model declined. "), ev.stop_details?.explanation || "", ev.stop_details?.category ? ` (${ev.stop_details.category})` : "")));
    }
    else if(t==="session.status_terminated"){ ui.status = "terminated"; sys("alert", sess.archived_at ? "Session stopped: it was archived" : "Session stopped (an unrecoverable error or it was archived)");
      if(!sess.archived_at) C().beta.sessions.retrieve(id).then(s=>{ if(s?.archived_at){ sess = s; } }).catch(()=>{}); }
    else if(t==="session.deleted"){ ui.status = "terminated"; sys("trash","Session deleted"); }
    else if(t==="session.thread_created") sys("users", ev.agent_name==="anthropic.advisor" ? "Consulting the advisor" : `Started helper “${ev.agent_name}”${ev.workflow_run_id ? " (workflow)" : ""}`);
    else if(t==="session.thread_status_idle" && ev.stop_reason && !["end_turn","requires_action"].includes(ev.stop_reason.type) && ev.agent_name!=="anthropic.advisor") sys("alert", `Helper “${ev.agent_name}” stopped: ${ev.stop_reason.type.replace(/_/g," ")}`);
    else if(t==="session.thread_status_terminated" && ev.agent_name!=="anthropic.advisor") sys("check", `Helper “${ev.agent_name}” finished`);
    else if(t==="agent.thread_message_sent" || t==="agent.thread_message_received"){
      const out = t.endsWith("sent"), raw = out ? ev.to_agent_name : ev.from_agent_name, adv = raw==="anthropic.advisor", who = adv ? "Advisor" : raw;
      const hidden = (ev.content||[]).some(b=>b.type==="redacted");
      add(h("details",{class:"tool"}, h("summary",{}, icon("chevR","chev"), icon(adv ? "pulse" : "users"), h("span",{class:"nm"}, out ? `→ ${who||"helper"}` : `← ${who||"helper"}`), h("span",{class:"pv"}, short(blocksText(ev.content), 140))),
        h("div",{class:"tb"}, hidden && adv ? h("div",{class:"note"}, icon("info"), "This advisor’s advice is hidden from you by design; the agent still received it. Advisors such as Opus 4.8 give readable advice.") : "", renderMd(blocksText(ev.content)))));
    }
    else if(t==="agent.thread_context_compacted") sys("history","Earlier context was summarised to make room");
    else if(t==="workflow_run.created") sys("rocket", `Workflow started: ${ev.name}`);
    else if(t==="workflow_run.status_ended") sys(ev.result?.type==="completed"?"check":"alert", `Workflow ${ev.result?.type || "ended"}${ev.result?.error ? ": "+ev.result.error.message : ""}`);
    else if(t==="session.usage"){ ui.usage = ev.usage; if(ev.budget) ui.budget = ev.budget; }
    else if(t==="session.updated"){ if(ev.budget!==undefined) ui.budget = ev.budget; if(ev.title!==undefined) sess.title = ev.title; }
    else if(t==="agent.thinking"){ ui.thinking = true; }
    if(t==="span.model_request_end" || t==="agent.message") ui.thinking = false;
    // make sure every outstanding ask has a live card
    if(t==="session.status_idle"){
      const owed = new Set(ev.stop_reason?.type==="requires_action" ? ev.stop_reason.event_ids||[] : []);
      for(const [eid, card] of [...ui.pending]) if(!owed.has(eid)) card.stale();
      for(const eid of owed) if(!ui.pending.has(eid)){ const src = feed.byKey.get(eid); if(src && !src._asked){ src._asked = true; (src.type==="agent.custom_tool_use" ? customCard : askCard)(src); } }
    }
    timelineAdd(ev);
    refresh();
  }
  function onPreview(ev){
    if(ev.type==="event_start"){ if(ev.event?.type==="agent.thinking"){ ui.thinking = true; refresh(); } if(ev.event?.type!=="agent.message" || feed.byKey.has(ev.event.id)) return;
      const el = agentBubble({content:[{type:"text", text:""}]}, true); ui.previews.set(ev.event.id, {el, parts:[]}); add(el); return; }
    const p = ui.previews.get(ev.event_id); if(!p) return;
    const i = ev.delta?.index ?? 0; p.parts[i] = (p.parts[i]||"") + (ev.delta?.content?.text||"");
    const md = renderMd(p.parts.join("")); p.el.querySelector(".md").replaceWith(md); scroll();
  }
  function onUpdate(ev){ const el = userEls.get(ev.id); if(el){ el.classList.remove("queued"); el.querySelector(".q")?.remove(); } }

  // ---- state → composer & header
  function refresh(){
    drawStatus();
    thinkingEl.style.display = ui.status==="running" ? "" : "none";
    thinkingEl.lastChild.textContent = ui.thinking ? "Thinking…" : "Working…";
    const ended = ui.status==="terminated";
    noteEl.replaceChildren();
    if(archived) noteEl.append(h("div",{class:"note"}, icon("archive"), "This session is archived and read-only."));
    else if(ended) noteEl.append(h("div",{class:"note"}, icon("info"), "This session has ended. Start a new one to keep going."));
    else if(ui.pending.size) noteEl.append(h("div",{class:"note warn"}, icon("alert"), `The agent is waiting for you to answer ${ui.pending.size===1 ? "the request" : ui.pending.size+" requests"} above.`));
    else if(ui.stopReason?.type==="budget_reached") noteEl.append(h("div",{class:"note warn"}, icon("alert"), "Paused at the spending cap. ", h("button",{class:"btn sm", onclick:()=>budgetDialog()},"Change cap")));
    composer.el.style.display = archived || ended ? "none" : "";
    composer.setRunning(ui.status==="running" || ui.status==="rescheduling");
    composer.setBlocked(ui.pending.size>0 || ui.stopReason?.type==="budget_reached");
    if(inspTab==="usage") drawInspector();
  }

  // ---- composer
  function buildComposer(){
    const ta = h("textarea",{rows:1, placeholder:"Message the agent…"});
    const attRow = h("div",{class:"attRow", style:"display:none"});
    const atts = [];
    const drawAtts = ()=>{ attRow.style.display = atts.length ? "" : "none"; attRow.replaceChildren(...atts.map((a,i)=>h("span",{class:"att"}, icon(a.block.type==="image"?"eye":"file"), h("span",{}, a.name), h("button",{class:"iconBtn sm", onclick:()=>{ atts.splice(i,1); drawAtts(); }}, icon("x"))))); };
    const send = h("button",{class:"send", title:"Send"}, icon("up"));
    const stopBtn = h("button",{class:"btn sm", style:"display:none", title:"Stop the agent"}, icon("stop"), "Stop");
    const st = h("span",{class:"st"});
    const attach = h("button",{class:"iconBtn", title:"Attach images, PDFs or text files"}, icon("clip"));
    const outcome = h("button",{class:"btn sm ghost", title:"Give it a goal with a rubric; a grader checks the work"}, icon("flag"), "Outcome");
    let running = false, blocked = false;
    const fit = ()=>{ ta.style.height = "auto"; ta.style.height = Math.min(ta.scrollHeight, innerHeight*0.4)+"px"; };
    ta.oninput = fit;
    ta.onkeydown = (e)=>{ if(e.key==="Enter" && !e.shiftKey && !e.isComposing){ e.preventDefault(); go_(); } };
    attach.onclick = ()=>{ const fi = $("#fileInput"); fi.value = ""; fi.accept = "image/png,image/jpeg,image/gif,image/webp,application/pdf,text/*,.md,.csv,.json,.txt"; fi.onchange = async()=>{
      for(const f of fi.files){
        if(f.size > 20*1024*1024){ toast(`${f.name} is over 20 MB`); continue; }
        if(/^image\//.test(f.type)) atts.push({name:f.name, block:{type:"image", source:{type:"base64", media_type:f.type, data:(await readFileAs(f,"readAsDataURL")).split(",")[1]}}});
        else if(f.type==="application/pdf") atts.push({name:f.name, block:{type:"document", title:f.name, source:{type:"base64", media_type:"application/pdf", data:(await readFileAs(f,"readAsDataURL")).split(",")[1]}}});
        else atts.push({name:f.name, block:{type:"document", title:f.name, source:{type:"text", media_type:"text/plain", data:await readFileAs(f,"readAsText")}}});
      } drawAtts(); }; fi.click(); };
    stopBtn.onclick = async()=>{ stopBtn.disabled = true; const r = await api(c=>c.beta.sessions.events.send(id, {events:[{type:"user.interrupt"}]}), "Stop"); stopBtn.disabled = false; if(r) toast("Stopping at the next safe point…"); };
    outcome.onclick = ()=> outcomeDialog();
    const note = modelInfo(sess.agent?.model).sys ? h("button",{class:"btn sm ghost", title:"Add a standing instruction for the rest of this session (a system note)"}, icon("info"), "Instruction") : "";
    if(note) note.onclick = ()=>{ if(blocked) return toast("Answer the request above first."); systemNoteDialog(); };
    async function go_(){
      const text = ta.value.trim(); if(!text && !atts.length) return;
      if(blocked){ toast("Answer the request above first (or raise the spending cap)."); return; }
      send.disabled = true;
      const content = [...atts.map(a=>a.block), ...(text ? [{type:"text", text}] : [])];
      const r = await api(c=>c.beta.sessions.events.send(id, {events:[{type:"user.message", content}]}), "Send");
      send.disabled = false;
      if(!r) return;
      ta.value = ""; atts.length = 0; drawAtts(); fit(); stick = true;
      (r.data||[]).forEach(x=>feed.ingest(x));
    }
    send.onclick = go_;
    const el = h("div",{class:"composerBox"}, attRow, ta, h("div",{class:"composerBar"}, attach, outcome, note, h("span",{class:"sp"}), st, stopBtn, send));
    return {el, ta,
      setRunning(v){ running = v; stopBtn.style.display = v ? "" : "none"; st.textContent = v ? "Messages you send now are queued" : ""; },
      setBlocked(v){ blocked = v; ta.placeholder = v ? "Answer the request above first…" : "Message the agent…"; }};
  }
  function systemNoteDialog(){
    const ta = area({rows:5, placeholder:"e.g. “From now on, don’t touch the database schema — ask me first.”"});
    const bg = modal(h("div",{class:"modal"}, h("h2",{},"Add an instruction"),
      h("p",{class:"lead"},"Sent as a system note: it applies to this turn and every later turn of this session, with the weight of the agent’s own instructions. The agent itself doesn’t change."),
      ta, h("div",{class:"actions"}, h("button",{class:"btn", onclick:()=>bg.remove()},"Cancel"), h("button",{class:"btn primary", onclick:async()=>{
        if(!ta.value.trim()) return;
        const r = await api(c=>c.beta.sessions.events.send(id, {events:[{type:"system.message", content:[{type:"text", text:ta.value.trim()}]}]}), "Instruction");
        if(r){ bg.remove(); (r.data||[]).forEach(x=>feed.ingest(x)); toast("Instruction added"); } }}, icon("check"), "Add"))));
    setTimeout(()=>ta.focus());
  }
  function outcomeDialog(){
    const d = area({rows:3, placeholder:"What should the finished work be? e.g. “A one-page summary of the bug and a tested fix in /mnt/session/outputs/fix.patch”"});
    const rub = area({rows:8, placeholder:"How to judge it — 5 to 10 clear checks, one per line:\n- The patch applies cleanly\n- All existing tests pass\n- …"});
    const it = field({type:"number", min:1, max:20, value:3, style:"max-width:100px"});
    const err = h("span",{class:"err"});
    const bg = modal(h("div",{class:"modal wide"}, h("h2",{},"Set an outcome"),
      h("p",{class:"lead"},"The agent works towards the goal, and a separate grader checks its work against your rubric — sending it back to revise until it passes or runs out of rounds."),
      h("label",{class:"f"},"Goal"), d, h("label",{class:"f"},"Rubric"), rub, h("label",{class:"f"},"Most rounds"), it,
      h("div",{class:"actions"}, err, h("span",{class:"sp"}), h("button",{class:"btn", onclick:()=>bg.remove()},"Cancel"), h("button",{class:"btn primary", onclick:async()=>{
        if(!d.value.trim() || !rub.value.trim()){ err.textContent = "Fill in the goal and the rubric."; return; }
        const r = await api(c=>c.beta.sessions.events.send(id, {events:[{type:"user.define_outcome", description:d.value.trim(), rubric:{type:"text", content:rub.value.trim()}, max_iterations:Math.max(1, Math.min(20, parseInt(it.value,10)||3))}]}), "Outcome");
        if(r){ bg.remove(); (r.data||[]).forEach(x=>feed.ingest(x)); }
      }}, icon("flag"), "Start"))));
    setTimeout(()=>d.focus());
  }
  function budgetDialog(){
    const cur = centsToDollars(ui.budget?.max_list_cost), used = centsToDollars(ui.usage?.list_cost) || 0;
    const inp = field({type:"number", min:0, step:0.5, value: cur!=null ? Math.max(cur*2, used+1).toFixed(2) : ""});
    const err = h("span",{class:"err"});
    const bg = modal(h("div",{class:"modal sm"}, h("h2",{},"Spending cap"),
      h("p",{class:"lead"}, ui.budget ? `Current cap ${money(cur)} · used so far ${money(used)}. A new cap must be higher than what’s been used.` : "This session was started without a cap. Caps can only be set when a session starts."),
      ui.budget ? h("div",{class:"inline"}, h("span",{},"$"), inp) : "",
      h("div",{class:"actions"}, err, h("span",{class:"sp"}),
        ui.budget ? h("button",{class:"btn ghost", style:"color:var(--danger)", onclick:async()=>{ if(!await confirmDialog("Remove the cap?","The session can then spend without limit, and a cap can’t be added back.","Remove cap")) return; const r = await api(c=>c.beta.sessions.update(id,{budget:null}),"Cap"); if(r){ ui.budget = null; bg.remove(); toast("Cap removed"); refresh(); } }}, "Remove cap") : "",
        h("button",{class:"btn", onclick:()=>bg.remove()},"Close"),
        ui.budget ? h("button",{class:"btn primary", onclick:async()=>{
          const v = parseFloat(inp.value); if(!(v > used)){ err.textContent = `Must be more than ${money(used)}.`; return; }
          const r = await api(c=>c.beta.sessions.update(id, {budget:{type:"limit", max_list_cost:{amount:String(Math.round(v*100)), currency:"USD"}}}), "Cap");
          if(r){ ui.budget = r.budget; bg.remove(); toast("Cap raised"); refresh(); } }}, "Save") : "")));
  }

  // ---- inspector
  let inspTab = ["timeline","usage","details","threads","files"].includes(tab) ? tab : "timeline";
  let tlFilter = "all";
  const CAT = (t)=> t.startsWith("user.") ? "user" : t==="agent.message"||t==="agent.thinking" ? "agent" : /tool_(use|result)$/.test(t) ? "tool" : t.startsWith("span.model") ? "model"
    : t==="session.error"||t==="workflow_run.error" ? "error" : t.startsWith("span.outcome") ? "outcome" : /thread|workflow/.test(t) ? "thread" : "status";
  const modelStarts = new Map();
  function tlSummary(ev){
    const t = ev.type;
    if(t==="user.message" || t==="agent.message" || t==="system.message") return short(blocksText(ev.content), 120);
    if(/tool_use$/.test(t)) return `${ev.name}${ev.evaluated_permission?" · "+ev.evaluated_permission:""} · ${short(toolPreview(ev.input), 80)}`;
    if(/tool_result$/.test(t)) return (ev.is_error?"error · ":"") + short(blocksText(ev.content), 100);
    if(t==="user.tool_confirmation") return ev.result;
    if(t==="session.status_idle") return ev.stop_reason?.type || "";
    if(t==="session.error") return `${ev.error?.type} · ${ev.error?.retry_status?.type||""} · ${short(ev.error?.message, 80)}`;
    if(t==="span.model_request_end"){ const u = ev.model_usage||{}; const st = modelStarts.get(ev.model_request_start_id); const d = st ? (toMs(ev.processed_at)-toMs(st.processed_at))/1000 : null;
      const c = costOf(sess.agent?.model, u); return `${d!=null?dur(d)+" · ":""}${fmtN(u.input_tokens)} in · ${fmtN(u.output_tokens)} out · ${fmtN(u.cache_read_input_tokens)} cached${c!=null?" · ~"+money(c):""}${ev.is_error?" · error":""}`; }
    if(t==="span.outcome_evaluation_end") return `${ev.result} · round ${ev.iteration+1}`;
    if(t==="session.usage") return ev.usage?.list_cost ? money(centsToDollars(ev.usage.list_cost))+" so far" : "";
    if(t==="session.thread_created") return ev.agent_name;
    if(t==="workflow_run.created") return ev.name;
    return "";
  }
  const tlRows = [];
  function timelineAdd(ev){
    if(ev.type==="span.model_request_start") modelStarts.set(ev.id, ev);
    tlRows.push(ev);
    const n = inspTabs.querySelector(".n"); if(n) n.textContent = tlRows.length;
    if(!hasWf && ev.type.startsWith("workflow_run.")) drawTabs();
    if(inspTab==="workflows" && ev.type.startsWith("workflow_run.")) drawInspector();
    if(inspTab==="timeline") drawTimelineRow(ev, true);
  }
  let tlList = null, maxDur = 1;
  function drawTimelineRow(ev, live){
    if(!tlList) return;
    const cat = CAT(ev.type);
    if(tlFilter!=="all" && cat!==tlFilter) return;
    const rel = ui.firstAt && ev.processed_at ? (toMs(ev.processed_at)-toMs(ui.firstAt))/1000 : null;
    let bar = "";
    if(ev.type==="span.model_request_end"){ const st = modelStarts.get(ev.model_request_start_id); if(st){ const d = (toMs(ev.processed_at)-toMs(st.processed_at))/1000; maxDur = Math.max(maxDur, d); bar = h("div",{class:"bar", style:`width:${Math.max(3, Math.min(100, d/maxDur*100))}%`}); } }
    const row = h("div",{class:"tlRow c-"+cat, title:"Click for the full event", onclick:()=>{ const bg = modal(h("div",{class:"modal wide"}, h("h2",{style:"font:600 18px var(--mono)"}, ev.type), h("p",{class:"lead"}, when(ev.processed_at), " · ", idTag(ev.id||"(no id)")), jsonView(ev), h("div",{class:"actions"}, h("button",{class:"btn", onclick:()=>copyText(JSON.stringify(ev,null,2))}, icon("copy"),"Copy"), h("button",{class:"btn", onclick:()=>bg.remove()},"Close")))); }},
      h("span",{class:"tm"}, rel==null ? "…" : rel < 60 ? rel.toFixed(1)+"s" : dur(rel)), h("span",{class:"dot"}), h("div",{class:"tx"}, h("div",{class:"ty"}, ev.type), h("div",{class:"ds"}, tlSummary(ev)), bar));
    tlList.append(row);
    if(live) row.scrollIntoView?.({block:"nearest"});
  }
  let hasWf = false;
  function drawTabs(){
    hasWf ||= tlRows.some(e=>e.type.startsWith("workflow_run."));
    const tabs = [["timeline","Timeline"],["usage","Usage"],["details","Details"],["threads","Threads"], ...(hasWf ? [["workflows","Workflows"]] : []),["files","Files"]];
    inspTabs.replaceChildren(...tabs.map(([k,l])=>h("button",{class:inspTab===k?"on":"", onclick:()=>{ inspTab = k; drawInspector(); }}, l, k==="timeline" ? h("span",{class:"n"}, tlRows.length) : "")));
  }
  function drawInspector(){
    drawTabs();
    inspBody.replaceChildren(); tlList = null;
    if(inspTab==="timeline"){
      const cats = [["all","All"],["user","You"],["agent","Agent"],["tool","Tools"],["model","Model"],["error","Errors"],["status","Status"],["outcome","Outcomes"],["thread","Helpers"]];
      inspBody.append(h("div",{class:"filt"}, cats.map(([k,l])=>h("button",{class:tlFilter===k?"on":"", onclick:()=>{ tlFilter = k; drawInspector(); }}, l))));
      tlList = h("div",{class:"tl"}); inspBody.append(tlList);
      maxDur = 1; for(const ev of tlRows) if(ev.type==="span.model_request_end"){ const st = modelStarts.get(ev.model_request_start_id); if(st) maxDur = Math.max(maxDur, (toMs(ev.processed_at)-toMs(st.processed_at))/1000); }
      tlRows.forEach(ev=>drawTimelineRow(ev));
      if(!tlRows.length) inspBody.append(h("p",{class:"hint"},"No events yet."));
    }
    else if(inspTab==="usage"){
      const u = ui.usage || {}, cost = centsToDollars(u.list_cost);
      const reqs = tlRows.filter(e=>e.type==="span.model_request_end"), tools = tlRows.filter(e=>/tool_use$/.test(e.type)), errs = tlRows.filter(e=>e.type==="session.error");
      const est = reqs.reduce((n,e)=> n + (costOf(sess.agent?.model, e.model_usage)||0), 0);
      const cw = (u.cache_creation?.ephemeral_5m_input_tokens||0) + (u.cache_creation?.ephemeral_1h_input_tokens||0);
      inspBody.append(
        h("div",{class:"stat"},
          h("div",{}, h("b",{}, cost!=null ? money(cost) : est ? "~"+money(est) : "—"), h("span",{}, cost!=null ? "List cost (from Anthropic)" : "Estimated cost")),
          h("div",{}, h("b",{}, dur(u.active_seconds ?? sess.stats?.active_seconds)), h("span",{},"Active time")),
          h("div",{}, h("b",{}, fmtN(u.input_tokens)), h("span",{},"Input tokens")),
          h("div",{}, h("b",{}, fmtN(u.output_tokens)), h("span",{},"Output tokens")),
          h("div",{}, h("b",{}, fmtN(u.cache_read_input_tokens)), h("span",{},"Read from cache")),
          h("div",{}, h("b",{}, fmtN(cw)), h("span",{},"Written to cache")),
          h("div",{}, h("b",{}, reqs.length), h("span",{},"Model requests")),
          h("div",{}, h("b",{}, tools.length), h("span",{},"Tool calls")),
          h("div",{}, h("b",{}, u.server_tool_use?.web_search_requests ?? 0), h("span",{},"Web searches")),
          h("div",{}, h("b",{style: errs.length ? "color:var(--danger)" : ""}, errs.length), h("span",{},"Errors"))),
        h("div",{class:"box"}, h("div",{class:"boxHead"}, h("b",{},"Spending cap"), h("span",{class:"sp"}), h("button",{class:"btn sm", onclick:()=>budgetDialog()}, ui.budget ? "Change" : "About caps")),
          h("div",{class:"hint"}, ui.budget ? `${money(centsToDollars(ui.budget.max_list_cost))} — the session pauses when it gets there.` : "No cap on this session.")),
        h("p",{class:"hint"},"List cost is tokens at list price, plus $10 per 1,000 web searches and $0.08 per hour of sandbox time. Your contract price may differ."));
    }
    else if(inspTab==="details"){
      const a = sess.agent || {};
      inspBody.append(h("dl",{class:"kv"},
        h("dt",{},"Agent"), h("dd",{}, h("a",{href:`#/agents/${a.id}`, style:"color:var(--accent)"}, a.name), ` v${a.version}`),
        h("dt",{},"Model"), h("dd",{}, modelName(a.model), a.model?.effort ? ` · ${a.model.effort.type||a.model.effort}` : ""),
        h("dt",{},"Environment"), h("dd",{}, h("a",{href:`#/environments/${sess.environment_id}`, style:"color:var(--accent)"}, sess.environment_id)),
        h("dt",{},"Started"), h("dd",{}, when(sess.created_at)),
        h("dt",{},"Duration"), h("dd",{}, dur(sess.stats?.duration_seconds)),
        sess.deployment_id ? [h("dt",{},"Schedule"), h("dd",{}, h("a",{href:`#/schedules/${sess.deployment_id}`, style:"color:var(--accent)"}, sess.deployment_id))] : "",
        h("dt",{},"Vaults"), h("dd",{}, (sess.vault_ids||[]).length ? sess.vault_ids.map(v=>h("div",{}, h("a",{href:`#/vaults/${v}`, style:"color:var(--accent)"}, v))) : "None"),
        h("dt",{},"Resources"), h("dd",{}, (sess.resources||[]).length ? sess.resources.map(r=>h("div",{}, r.type==="github_repository" ? `Repo ${r.url}${r.mount_path ? " → "+r.mount_path : ""}` : r.type==="memory_store" ? `Memory “${r.name||r.memory_store_id}” (${(r.access||"read_write").replace("_"," ")}) → ${r.mount_path||"/mnt/memory/"}` : `File → ${r.mount_path||r.file_id}`)) : "None"),
        Object.keys(sess.metadata||{}).length ? [h("dt",{},"Metadata"), h("dd",{}, jsonView(sess.metadata))] : ""),
        sess.archived_at || ui.status==="terminated" ? "" : h("div",{class:"box", style:"margin-top:14px"}, h("div",{class:"boxHead"}, h("b",{},"Tools for this session"), h("span",{class:"sp"}), h("button",{class:"btn sm", onclick:changeTools}, icon("sliders"), "Change…")),
          h("div",{class:"hint"},"Switch tools on or off, or change what needs your approval, for this session only. The agent and its versions don’t change.")),
        h("h4",{class:"hint", style:"margin:18px 0 6px;text-transform:uppercase;letter-spacing:.06em;font-size:11px"},"Instructions this session ran with"),
        a.system ? renderMd("```\n"+a.system.replace(/```/g,"ˋˋˋ")+"\n```") : h("p",{class:"hint"},"None"),
        h("details",{style:"margin-top:10px"}, h("summary",{class:"hint", style:"cursor:pointer"},"Full agent snapshot (JSON)"), jsonView(a)));
    }
    else if(inspTab==="threads"){
      inspBody.append(h("p",{class:"hint"},"Loading…"));
      api(c=>listAll(c.beta.sessions.threads.list(id, {limit:100}), 200), "Threads").then(ts=>{
        if(inspTab!=="threads" || !ts) return;
        inspBody.replaceChildren(ts.length <= 1 ? h("p",{class:"hint"},"No helper agents in this session. Agents with a team hand work to helpers, and each helper gets its own thread here.") : "",
          h("div",{class:"list"}, ts.map(t=>h("div",{class:"card", style:"padding:10px 12px", onclick:()=>threadDialog(t)},
            h("div",{class:"main"}, h("div",{class:"t"}, !t.parent_thread_id ? "Main thread" : t.agent?.type==="advisor" ? `Advisor (${modelName(t.agent.model)})` : (t.agent?.name || "Helper") + (t.workflow_run_id ? " · workflow" : "")), h("div",{class:"s"}, t.id)),
            h("div",{class:"chips"}, statusChip(t.status), t.usage?.list_cost ? chip(money(centsToDollars(t.usage.list_cost)),"mono") : "")))));
      });
    }
    else if(inspTab==="workflows"){
      // there's no list endpoint: rebuild each run from its events
      const runs = new Map();
      for(const e of tlRows){ if(!e.type.startsWith("workflow_run.") || !e.workflow_run_id) continue;
        const r = runs.get(e.workflow_run_id) || {id:e.workflow_run_id, phases:new Map(), status:"running", errors:[]}; runs.set(r.id, r);
        if(e.type==="workflow_run.created"){ r.name = e.name; r.description = e.description; r.start = e.processed_at; for(const p of e.phases||[]) r.phases.set(p.id, {...p, state:"waiting"}); }
        if(e.type==="workflow_run.status_idle") r.status = "idle"; if(e.type==="workflow_run.status_running") r.status = "running";
        if(e.type==="workflow_run.phase_started"){ const p = r.phases.get(e.workflow_run_phase_id); if(p){ p.state = "running"; p.start = e.processed_at; p.startId = e.id; } }
        if(e.type==="workflow_run.phase_ended"){ const p = [...r.phases.values()].find(x=>x.startId===e.phase_started_id) || r.phases.get(e.workflow_run_phase_id); if(p){ p.state = "done"; p.end = e.processed_at; } }
        if(e.type==="workflow_run.error") r.errors.push(e.error);
        if(e.type==="workflow_run.status_ended"){ r.status = "ended"; r.result = e.result; r.end = e.processed_at; } }
      inspBody.append(...(runs.size ? [...runs.values()].map(r=>h("div",{class:"box"},
        h("div",{class:"boxHead"}, icon("rocket"), h("b",{}, r.name || r.id), h("span",{class:"sp"}),
          r.status==="ended" ? chip(r.result?.type || "ended", r.result?.type==="completed" ? "ok" : "bad") : chip(r.status, r.status==="running" ? "run" : "")),
        r.description ? h("div",{class:"hint", style:"margin-bottom:6px"}, r.description) : "",
        h("div",{style:"display:grid;gap:4px"}, [...r.phases.values()].map(p=>h("div",{class:"inline"}, chip(p.state, p.state==="done" ? "ok" : p.state==="running" ? "run" : "ghost"), h("span",{}, p.name),
          p.start && p.end ? h("span",{class:"hint"}, dur((toMs(p.end)-toMs(p.start))/1000)) : ""))),
        r.result?.error ? h("div",{class:"err", style:"margin-top:6px"}, `${r.result.error.type}: ${r.result.error.message}`) : "",
        ...r.errors.map(er=>h("div",{class:"err", style:"margin-top:4px"}, `${er.type}: ${er.message}`))))
        : [h("p",{class:"hint"},"No workflow runs in this session.")]),
        h("p",{class:"hint"},"While a workflow is running, the session stays busy: its tools can’t be changed and it can’t be archived. To stop one, ask the agent in a message."));
    }
    else if(inspTab==="files"){
      const inputs = h("div",{}, h("p",{class:"hint"},"Loading…")), outputs = h("div",{}, h("p",{class:"hint"},"Loading…"));
      inspBody.append(h("h4",{class:"hint", style:"margin:0 0 6px;text-transform:uppercase;letter-spacing:.06em;font-size:11px"},"Files you gave it (/mnt/session/uploads/)"), inputs,
        h("h4",{class:"hint", style:"margin:18px 0 6px;text-transform:uppercase;letter-spacing:.06em;font-size:11px"},"Files it made (/mnt/session/outputs/)"), outputs,
        h("button",{class:"btn sm ghost", style:"margin-top:10px", onclick:()=>drawInspector()}, icon("refresh"), "Refresh"));
      api(c=>listAll(c.beta.sessions.resources.list(id, {limit:100}), 500), "Inputs").then(rs=>{
        if(inspTab!=="files" || !rs) return;
        const fl = rs.filter(r=>r.type==="file");
        inputs.replaceChildren(...fl.map(r=>h("div",{class:"card static", style:"padding:8px 12px;margin-bottom:6px"}, h("div",{class:"av soft"}, icon("file")),
          h("div",{class:"main"}, h("div",{class:"t"}, r.mount_path || r.file_id), h("div",{class:"s"}, r.file_id)),
          ui.status==="terminated" || sess.archived_at ? "" : h("button",{class:"iconBtn sm", title:"Remove from the session", onclick:async()=>{ if(!await confirmDialog("Remove this file?","It disappears from the agent’s sandbox. The agent may already have read it.","Remove")) return; if(await api(c=>c.beta.sessions.resources.delete(r.id,{session_id:id}),"Remove")){ toast("Removed"); drawInspector(); } }}, icon("trash")))),
          fl.length ? "" : h("p",{class:"hint", style:"margin:0 0 6px"},"None."),
          ui.status==="terminated" || sess.archived_at ? "" : h("button",{class:"btn sm", onclick:()=>{ const fi = $("#fileInput"); fi.value = ""; fi.accept = ""; fi.onchange = async()=>{
            for(const f of fi.files){ toast(`Uploading ${f.name}…`); const up = await api(c=>c.beta.files.upload({file:f}), "Upload"); if(!up) continue;
              await api(c=>c.beta.sessions.resources.add(id, {type:"file", file_id:up.id, mount_path:"/"+safeName(f.name)}), "Add file"); }
            toast("Added — mention it in your next message"); drawInspector(); }; fi.click(); }}, icon("plus"), "Add files"));
      });
      api(c=>listAll(c.beta.files.list({scope_id:id, betas:[MA_BETA]}), 200), "Files").then(fs=>{
        if(inspTab!=="files" || !fs) return;
        outputs.replaceChildren(fs.length ? h("div",{class:"list"}, fs.map(f=>h("div",{class:"card static", style:"padding:10px 12px"}, h("div",{class:"av soft"}, icon("file")),
            h("div",{class:"main"}, h("div",{class:"t"}, f.filename), h("div",{class:"s"}, `${(f.size_bytes/1024).toFixed(1)} KB · ${ago(f.created_at)}${f.expires_at ? " · kept until "+when(f.expires_at) : ""}`)),
            h("button",{class:"btn sm", onclick:async()=>{ const r = await api(c=>c.beta.files.download(f.id), "Download"); if(r) saveBlob(await r.blob(), f.filename.split(/[\\/]/).pop()); }}, icon("download"), "Save"))))
          : h("p",{class:"hint", style:"margin:0"},"None yet. Files can take a few seconds to appear after a turn ends."));
      });
    }
  }
  async function changeTools(){
    const ed = toolsEditor(sess.agent||{});
    const err = h("span",{class:"err"});
    const save = h("button",{class:"btn primary"}, icon("check"), "Apply to this session");
    const bg = modal(h("div",{class:"modal wide", style:"width:min(900px,100%)"}, h("h2",{},"Tools for this session"),
      h("p",{class:"lead"},"Changes apply to this session only, from its next step. The agent itself, and new sessions, keep their own settings."),
      h("h4",{class:"hint", style:"text-transform:uppercase;letter-spacing:.06em;font-size:11px;margin:0 0 6px"},"Sandbox tools"), ed.sandbox,
      h("h4",{class:"hint", style:"text-transform:uppercase;letter-spacing:.06em;font-size:11px;margin:16px 0 6px"},"MCP servers"), ed.mcp,
      h("h4",{class:"hint", style:"text-transform:uppercase;letter-spacing:.06em;font-size:11px;margin:16px 0 6px"},"Custom tools"), ed.custom,
      h("div",{class:"actions"}, err, h("span",{class:"sp"}), h("button",{class:"btn", onclick:()=>bg.remove()},"Cancel"), save)));
    save.onclick = async()=>{
      let body; try{ body = ed.build(); }catch(e){ err.textContent = e.message; return; }
      if((sess.agent?.skills||[]).length && !ed.readOn()){ err.textContent = "This session uses skills, which need the “read” tool."; return; }
      save.disabled = true; err.textContent = "";
      if(ui.status==="running" || ui.status==="rescheduling"){
        if(!await confirmDialog("Pause the agent first?","Tools can only change while the session is idle. Page Orbit will stop the current turn, apply your changes, and you can then tell it to carry on.","Stop and apply", false)){ save.disabled = false; return; }
        await api(c=>c.beta.sessions.events.send(id, {events:[{type:"user.interrupt"}]}), "Stop");
        for(let i=0;i<30;i++){ const s2 = await C().beta.sessions.retrieve(id).catch(()=>null); if(s2 && s2.status!=="running" && s2.status!=="rescheduling") break; await sleep(500); }
      }
      try{ const r = await C().beta.sessions.update(id, {agent:body}); sess = r; bg.remove(); toast("Tools updated for this session"); drawInspector(); }
      catch(e){ save.disabled = false; err.textContent = /workflow_run_open/.test(JSON.stringify(e.error||"")+e.message) ? "A workflow is still running in this session. Ask the agent to stop it, then try again." : errText(e); }
    };
  }
  function threadDialog(t){
    const list = h("div",{class:"tl"}, h("p",{class:"hint"},"Loading…"));
    const stEl = h("span",{}, statusChip(t.status));
    const stopBtn = h("button",{class:"btn", onclick:async()=>{ if(await api(c=>c.beta.sessions.events.send(id, {events:[{type:"user.interrupt", session_thread_id:t.id}]}), "Stop")) toast("Stopping this helper…"); }}, icon("stop"), "Stop this helper");
    const archBtn = h("button",{class:"btn ghost", onclick:async()=>{ if(!await confirmDialog("Archive this helper’s thread?","It frees a slot (a session can run 25 helpers). Its history stays readable. This can’t be undone.","Archive")) return;
      if(await api(c=>c.beta.sessions.threads.archive(t.id, {session_id:id}), "Archive")){ toast("Thread archived"); bg.remove(); drawInspector(); } }}, icon("archive"), "Archive");
    const name = t.agent?.type==="advisor" ? "Advisor" : t.agent?.name || "Thread";
    const ctrl = new AbortController(); let stream = null;
    const bg = modal(h("div",{class:"modal wide"}, h("h2",{}, name), h("p",{class:"lead"}, idTag(t.id), " ", stEl), list,
      h("div",{class:"actions"}, t.parent_thread_id && !t.archived_at ? [archBtn, stopBtn] : "", h("span",{class:"sp"}), h("button",{class:"btn", onclick:()=>bg.close()},"Close"))), ()=>{ try{ stream?.controller?.abort(); }catch{} });
    const seen = new Set(); let t0 = null;
    const row = (ev)=> h("div",{class:"tlRow c-"+CAT(ev.type), onclick:()=>{ const b2 = modal(h("div",{class:"modal wide"}, h("h2",{style:"font:600 18px var(--mono)"}, ev.type), jsonView(ev), h("div",{class:"actions"}, h("button",{class:"btn", onclick:()=>b2.remove()},"Close")))); }},
        h("span",{class:"tm"}, t0 && ev.processed_at ? dur((toMs(ev.processed_at)-toMs(t0))/1000) : ""), h("span",{class:"dot"}), h("div",{class:"tx"}, h("div",{class:"ty"}, ev.type), h("div",{class:"ds"}, tlSummary(ev))));
    const addEv = (ev)=>{ if(!ev.id || seen.has(ev.id)) return; seen.add(ev.id); t0 ||= ev.processed_at; list.append(row(ev));
      if(/status_(idle|running|terminated)$/.test(ev.type)) stEl.replaceChildren(statusChip(ev.type.split("_").pop()==="terminated" ? "terminated" : ev.type.split("_").pop())); };
    (async()=>{
      try{ stream = await C().beta.sessions.threads.events.stream(t.id, {session_id:id}); }catch{}
      const evs = await api(c=>listAll(c.beta.sessions.threads.events.list(t.id, {session_id:id, limit:1000}), 2000), "Thread");
      list.replaceChildren(); (evs||[]).forEach(addEv);
      if(stream) try{ for await (const ev of stream){ if(ev.type!=="event_start" && ev.type!=="event_delta") addEv(ev); } }catch{}
    })();
  }

  // ---- go
  const feed = new SessionFeed(id, {event:onEvent, preview:onPreview, update:onUpdate,
    conn:(ok)=>{ conn.textContent = ok ? "" : "Reconnecting…"; },
    synced:()=>{ refresh(); scroll(); },
    fatal:(e)=>{ conn.textContent = errText(e); }});
  activeFeed = feed; feed.start();
  drawInspector(); refresh();
  // refresh the session object now and then for authoritative usage/stats
  const poll = setInterval(async()=>{ if(feed.closed){ clearInterval(poll); return; } if(document.hidden) return;
    const s = await C().beta.sessions.retrieve(id).catch(()=>null); if(s){ sess = s; ui.usage = s.usage || ui.usage; ui.budget = s.budget; if(inspTab==="usage") drawInspector(); } }, 60000);
  return ()=>{ feed.stop(); clearInterval(poll); };
}
