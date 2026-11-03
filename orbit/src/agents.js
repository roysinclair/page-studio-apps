/* ================= agents ================= */
const SANDBOX_TOOLS = [
  {name:"bash",       desc:"Run shell commands in the sandbox", def:"always_ask"},
  {name:"read",       desc:"Read files",                         def:"always_allow"},
  {name:"write",      desc:"Create files",                       def:"always_ask"},
  {name:"edit",       desc:"Change files",                       def:"always_ask"},
  {name:"glob",       desc:"Find files by pattern",              def:"always_allow"},
  {name:"grep",       desc:"Search inside files",                def:"always_allow"},
  {name:"web_search", desc:"Search the web ($10 per 1,000 searches)", def:"always_allow", off:true},
  {name:"web_fetch",  desc:"Read web pages",                     def:"always_allow", off:true},
];
const TOOLSET = "agent_toolset_20260401";
const PERMS = [
  {value:"always_allow", label:"Allow", cls:"p-allow", title:"Runs without asking"},
  {value:"always_ask",   label:"Ask",   cls:"p-ask",   title:"Pauses for your approval every time"},
  {value:"auto",         label:"Auto",  cls:"p-auto",  title:"Anthropic’s safety check decides: runs, blocks, or asks you"},
];
const ANTHROPIC_SKILLS = [["xlsx","Excel"],["docx","Word"],["pptx","PowerPoint"],["pdf","PDF"]];
const CONFIG_KEYS = ["name","description","model","system","tools","mcp_servers","skills","multiagent"];
let agentCache = null;   // [{id,name,…}] for pickers
async function agentList(force=false){
  if(!agentCache || force) agentCache = await listAll(C().beta.agents.list({limit:100}), 1000);
  return agentCache;
}
function pickConfig(a){ const o = {}; for(const k of CONFIG_KEYS) if(a[k] !== undefined) o[k] = structuredClone(a[k]); return o; }
function initials(name){ return (String(name||"?").match(/\b\w/g)||["?"]).slice(0,2).join("").toUpperCase(); }
const toolCount = (a)=> (a.tools||[]).reduce((n,t)=> n + (t.type===TOOLSET ? SANDBOX_TOOLS.filter(s=>toolEnabled(t,s.name)).length : t.type==="custom" ? 1 : 1), 0);
function toolEnabled(ts, name){ const c = (ts.configs||[]).find(c=>c.name===name); return (c?.enabled ?? ts.default_config?.enabled ?? true) !== false; }
function toolPerm(ts, name){ const c = (ts.configs||[]).find(c=>c.name===name); return c?.permission_policy?.type || ts.default_config?.permission_policy?.type || "always_allow"; }

function agentCard(a){
  return h("div",{class:"card"+(a.archived_at?" archived":""), onclick:()=>go(`agents/${a.id}`)},
    h("div",{class:"av"}, initials(a.name)),
    h("div",{class:"main"}, h("div",{class:"t"}, a.name), h("div",{class:"s"}, a.description || short(a.system || "No instructions yet", 120))),
    h("div",{class:"chips hideSm"}, chip(modelName(a.model)), chip("v"+a.version, "mono"), a.multiagent ? chip("Team","", "users") : "",
      a.archived_at ? chip("Archived","ghost") : ""),
    h("div",{class:"when"}, ago(a.updated_at)));
}

async function viewAgents(){
  let archived = false, q = "";
  const listEl = h("div",{class:"list"});
  const search = field({placeholder:"Search agents", type:"search"}); search.oninput = ()=>{ q = search.value.toLowerCase(); draw(); };
  let items = [];
  const draw = ()=>{
    const shown = items.filter(a=> !q || (a.name+" "+(a.description||"")+" "+a.id).toLowerCase().includes(q));
    if(!items.length) listEl.replaceChildren(h("div",{class:"empty"}, h("div",{class:"ic"}, icon("bot")), h("b",{},"No agents yet"),
      h("p",{},"An agent is a saved setup — a model, instructions and tools — that runs in Anthropic’s cloud. Create one, then talk to it."),
      h("button",{class:"btn primary", onclick:()=>go("agents/new")}, icon("plus"), "New agent")));
    else listEl.replaceChildren(...shown.map(agentCard));
  };
  const load = async()=>{
    listEl.replaceChildren(h("div",{class:"hint"},"Loading…"));
    const r = await api(c=>listAll(c.beta.agents.list({limit:100, include_archived:archived}), 1000), "Agents");
    if(!r){ listEl.replaceChildren(h("div",{class:"err"},"Couldn’t load agents.")); return; }
    items = r.sort((a,b)=> toMs(b.updated_at)-toMs(a.updated_at)); if(!archived) agentCache = items; draw();
  };
  const body = shell({title:"Agents", sub:"Saved agent setups. Every change makes a new version.",
    actions:[h("button",{class:"btn primary", onclick:()=>go("agents/new")}, icon("plus"), "New agent")]});
  body.append(h("div",{class:"wrapW"},
    h("div",{class:"toolbar"}, h("div",{class:"searchIn"}, icon("search"), search), h("span",{class:"sp"}),
      h("label",{class:"check"}, h("input",{type:"checkbox", onchange:(e)=>{ archived = e.target.checked; load(); }}), "Show archived"),
      h("button",{class:"btn sm ghost", onclick:load}, icon("refresh"), "Refresh")),
    listEl));
  load();
}

/* ---------- agent page ---------- */
async function viewAgent(id, tab="configure"){
  if(id==="new") return agentEditor(null);
  const body = shell({crumb:[["Agents","agents"]], title:"Loading…"});
  const a = await api(c=>c.beta.agents.retrieve(id), "Agent");
  if(!a){ body.append(h("div",{class:"err"},"Couldn’t load this agent.")); return; }
  const tabs = [{id:"configure", label:"Configure"}, {id:"versions", label:"Versions", n:a.version}, {id:"sessions", label:"Sessions"}, {id:"schedules", label:"Schedules"}, {id:"json", label:"JSON"}];
  const more = h("button",{class:"iconBtn", title:"More"}, icon("menu"));
  more.onclick = ()=> popMenu(more, [
    {label:"Duplicate", sub:"A new agent with the same setup", value:"dup", icon:"copy"},
    {label:"Copy ID", value:"id", icon:"copy"},
    ...(a.archived_at ? [] : [{label:"Archive agent…", sub:"Permanent — it can’t be undone", value:"archive", icon:"archive", danger:true}]),
  ], async v=>{
    if(v==="id") copyText(a.id);
    if(v==="dup"){ const cfg = pickConfig(a); cfg.name = a.name+" (copy)"; const n = await api(c=>c.beta.agents.create(cfg), "Duplicate"); if(n){ agentCache = null; toast("Duplicated"); go(`agents/${n.id}`); } }
    if(v==="archive"){
      if(!await typedConfirm("Archive this agent?", "Archiving is permanent. The agent becomes read-only, new sessions can’t use it, and its schedules are archived too. Running sessions carry on. There is no undo and agents can’t be deleted.", a.name, "Archive forever")) return;
      if(await api(c=>c.beta.agents.archive(a.id), "Archive")){ agentCache = null; toast("Agent archived"); route(); }
    }
  });
  const b = shell({crumb:[["Agents","agents"]], title:a.name,
    sub:[idTag(a.id), chip("v"+a.version,"mono"), chip(modelName(a.model)), a.archived_at ? chip("Archived","bad") : "", h("span",{}, "updated "+ago(a.updated_at))],
    actions:[a.archived_at ? "" : h("button",{class:"btn primary", onclick:()=>newSessionDialog({agent:a})}, icon("chat"), "Talk to it"), more],
    tabs, tab, tabBase:`agents/${a.id}`});
  if(tab==="configure") return agentEditor(a, b);
  if(tab==="json") return agentJson(a, b);
  if(tab==="versions") return agentVersions(a, b);
  if(tab==="sessions") return sessionsInto(b, {agent_id:a.id}, a);
  if(tab==="schedules") return deploymentsInto(b, {agent_id:a.id}, a);
}

/* ---------- editor ---------- */
function blankAgent(){
  return {name:"", description:"", model:{id:"claude-opus-5-5"}, system:"",
    tools:[{type:TOOLSET, default_config:{enabled:true, permission_policy:{type:"always_allow"}},
      configs: SANDBOX_TOOLS.map(t=>({name:t.name, enabled:!t.off, permission_policy:{type:t.def}}))}],
    mcp_servers:[], skills:[], multiagent:null};
}

async function agentEditor(a, body){
  const isNew = !a;
  if(isNew) body = shell({crumb:[["Agents","agents"]], title:"New agent", sub:"Set it up, save it, then talk to it."});
  const cfg = isNew ? blankAgent() : pickConfig(a);
  if(typeof cfg.model==="string") cfg.model = {id:cfg.model};
  const others = (await agentList().catch(()=>[])).filter(x=>!a || x.id!==a.id);

  const name = field({value:cfg.name, placeholder:"e.g. Support triage"});
  const desc = field({value:cfg.description||"", placeholder:"What it’s for (optional)"});
  const modelSel = select([...MODELS.map(m=>({value:m.id, label:`${m.name} — ${m.sub}`})), ...(MODELS.some(m=>m.id===cfg.model.id)?[]:[{value:cfg.model.id, label:cfg.model.id}])], cfg.model.id);
  const effortSel = select(EFFORTS.map(e=>({value:e.id, label:e.name})), cfg.model.effort?.type || cfg.model.effort || "");
  const fast = h("input",{type:"checkbox", class:"switch", checked: cfg.model.speed==="fast"});
  const system = area({rows:12, placeholder:"Instructions the agent always follows: its job, tone, what to do and not do, when to ask.", value:cfg.system||""});

  // sandbox tools
  let ts = (cfg.tools||[]).find(t=>t.type===TOOLSET);
  const tsOn = h("input",{type:"checkbox", class:"switch", checked:!!ts});
  const toolState = SANDBOX_TOOLS.map(t=>({...t, enabled: ts ? toolEnabled(ts, t.name) : !t.off, perm: ts ? toolPerm(ts, t.name) : t.def,
    extra: structuredClone((ts?.configs||[]).find(c=>c.name===t.name) || {})}));
  const toolRows = toolState.map(t=>{
    const en = h("input",{type:"checkbox", checked:t.enabled, onchange:(e)=>{ t.enabled = e.target.checked; }});
    const domains = (t.name==="web_search"||t.name==="web_fetch") ? field({placeholder:"Only these sites (optional): example.com, docs.example.org", value:(t.extra.allowed_domains||[]).join(", "), style:"height:30px;font-size:12.5px;margin-top:6px"}) : null;
    if(domains) domains.oninput = ()=>{ t.domains = domains.value; };
    return h("tr",{}, h("td",{}, h("label",{class:"check"}, en)),
      h("td",{}, h("div",{class:"nm"}, t.name), h("div",{class:"ds"}, t.desc), domains),
      h("td",{style:"text-align:right"}, seg(PERMS, t.perm, v=>{ t.perm = v; })));
  });

  // MCP servers
  const mcpState = (cfg.mcp_servers||[]).map(s=>{ const tset = (cfg.tools||[]).find(t=>t.type==="mcp_toolset" && t.mcp_server_name===s.name);
    return {name:s.name, url:s.url, perm: tset?.default_config?.permission_policy?.type || "always_ask", toolset: tset ? structuredClone(tset) : null}; });
  const mcpBox = h("div",{});
  const drawMcp = ()=> mcpBox.replaceChildren(...mcpState.map((s,i)=>{
    const n = field({value:s.name, placeholder:"name, e.g. github", style:"max-width:180px"}); n.oninput = ()=>{ s.name = n.value.trim(); };
    const u = field({value:s.url, placeholder:"https://mcp.example.com/mcp", class:"field mono"}); u.oninput = ()=>{ s.url = u.value.trim(); };
    return h("div",{class:"box"}, h("div",{class:"inline"}, n, u, h("button",{class:"iconBtn sm", title:"Remove", onclick:()=>{ mcpState.splice(i,1); drawMcp(); }}, icon("x"))),
      h("div",{class:"inline", style:"margin-top:8px"}, h("span",{class:"hint"},"Its tools:"), seg(PERMS, s.perm, v=>{ s.perm = v; })));
  }), h("button",{class:"btn sm", onclick:()=>{ mcpState.push({name:"", url:"", perm:"always_ask"}); drawMcp(); }}, icon("plus"), "Add MCP server"));
  drawMcp();

  // custom tools
  const customState = (cfg.tools||[]).filter(t=>t.type==="custom").map(t=>({name:t.name, description:t.description||"", schema: JSON.stringify(t.input_schema||{type:"object", properties:{}}, null, 2)}));
  const customBox = h("div",{});
  const drawCustom = ()=> customBox.replaceChildren(...customState.map((t,i)=>{
    const n = field({value:t.name, placeholder:"tool_name", class:"field mono", style:"max-width:220px"}); n.oninput = ()=>{ t.name = n.value.trim(); };
    const d = field({value:t.description, placeholder:"What it does and when to use it"}); d.oninput = ()=>{ t.description = d.value; };
    const s = area({rows:5, class:"field code"}); s.value = t.schema; s.oninput = ()=>{ t.schema = s.value; };
    return h("div",{class:"box"}, h("div",{class:"inline"}, n, d, h("button",{class:"iconBtn sm", title:"Remove", onclick:()=>{ customState.splice(i,1); drawCustom(); }}, icon("x"))),
      h("div",{class:"hint", style:"margin:8px 0 4px"},"Input schema (JSON Schema). You answer these calls yourself while talking to the agent."), s);
  }), h("button",{class:"btn sm", onclick:()=>{ customState.push({name:"", description:"", schema:'{\n  "type": "object",\n  "properties": {}\n}'}); drawCustom(); }}, icon("plus"), "Add custom tool"));
  drawCustom();

  // skills
  const skills = cfg.skills||[];
  const skillChecks = ANTHROPIC_SKILLS.map(([id,label])=> ({id, el:h("input",{type:"checkbox", checked: skills.some(s=>s.type==="anthropic" && s.skill_id===id)}), label}));
  const customSkills = field({class:"field mono", placeholder:"skill_01… , skill_02…@3", value: skills.filter(s=>s.type==="custom").map(s=> s.skill_id + (s.version && s.version!=="latest" ? "@"+s.version : "")).join(", ")});

  // team (multi-agent)
  const ma = cfg.multiagent ? structuredClone(cfg.multiagent) : null;
  const maSupported = !ma || ma.type==="multiagent_20261001";
  const maOn = h("input",{type:"checkbox", class:"switch", checked:!!ma, disabled:!maSupported});
  const preset = new Set((ma?.subagents?.predefined_agents||[]).map(x=> typeof x==="string" ? x : x.type==="self" ? "self" : x.id));
  const teamChecks = [{id:"self", name:"Copies of itself"}, ...others.filter(o=>!o.archived_at && !o.multiagent)].map(o=>
    h("label",{class:"check", style:"margin:3px 14px 3px 0"}, h("input",{type:"checkbox", checked:preset.has(o.id), onchange:(e)=>{ e.target.checked ? preset.add(o.id) : preset.delete(o.id); }}), o.name));
  const inlineOn = h("input",{type:"checkbox", checked: (ma?.subagents?.inline_agents?.type ?? "enabled")==="enabled"});
  const wfOn = h("input",{type:"checkbox", checked: ma ? (ma.workflows?.type ?? "enabled")==="enabled" : false});
  const advOn = h("input",{type:"checkbox", checked: ma?.advisor?.type==="enabled"});
  const advModel = select(MODELS.map(m=>({value:m.id, label:m.name})), ma?.advisor?.model || "claude-opus-5-5", {style:"max-width:200px;height:32px"});
  const teamBox = h("div",{class:"box", style: ma ? "" : "display:none"},
    h("div",{class:"hint", style:"margin-bottom:6px"},"Agents it can hand work to (each must not have a team of its own):"), h("div",{}, teamChecks),
    h("label",{class:"check", style:"margin-top:10px"}, inlineOn, "Let it create helpers on the fly"),
    h("br"), h("label",{class:"check", style:"margin-top:6px"}, wfOn, "Let it run background workflows (set a spending cap on sessions)"),
    h("div",{class:"inline", style:"margin-top:6px"}, h("label",{class:"check"}, advOn, "Consult an advisor model"), advModel));
  maOn.onchange = ()=>{ teamBox.style.display = maOn.checked ? "" : "none"; };

  const meta = area({rows:3, class:"field code", placeholder:'{"team": "support"}'}); meta.value = a && Object.keys(a.metadata||{}).length ? JSON.stringify(a.metadata, null, 2) : "";
  const status = h("span",{class:"msg"});

  function build(){
    const out = {name:name.value.trim(), description: desc.value.trim() || null, system: system.value || null};
    if(!out.name) throw new Error("Give the agent a name.");
    const model = {...cfg.model, id: modelSel.value};
    if(effortSel.value) model.effort = effortSel.value; else delete model.effort;
    if(fast.checked) model.speed = "fast"; else delete model.speed;
    out.model = model;
    const tools = [];
    if(tsOn.checked){
      tools.push({type:TOOLSET, default_config:{enabled:true, permission_policy:{type:"always_allow"}},
        configs: toolState.map(t=>{
          const c = {...t.extra, name:t.name, enabled:t.enabled, permission_policy:{type:t.perm}}; delete c.type;
          if(t.domains !== undefined){ const d = t.domains.split(/[\s,]+/).map(x=>x.trim().replace(/^https?:\/\//,"").replace(/\/.*$/,"")).filter(Boolean); if(d.length){ c.allowed_domains = d; delete c.blocked_domains; } else delete c.allowed_domains; }
          return c; })});
    }
    const names = new Set();
    for(const s of mcpState){
      if(!s.name && !s.url) continue;
      if(!/^[\w.-]{1,255}$/.test(s.name)) throw new Error(`MCP server name “${s.name}” — use letters, numbers, dots, dashes or underscores.`);
      if(!/^https:\/\//i.test(s.url)) throw new Error(`MCP server “${s.name}” needs an https:// URL.`);
      if(names.has(s.name)) throw new Error(`Two MCP servers are called “${s.name}”.`); names.add(s.name);
      const tset = s.toolset || {type:"mcp_toolset", mcp_server_name:s.name};
      tset.mcp_server_name = s.name; tset.default_config = {...(tset.default_config||{}), permission_policy:{type:s.perm}};
      tools.push(tset);
    }
    for(const t of customState){
      if(!t.name && !t.description) continue;
      if(!/^[A-Za-z0-9_-]{1,128}$/.test(t.name)) throw new Error(`Custom tool name “${t.name}” — letters, numbers, - and _ only.`);
      const sc = parseJSON(t.schema, `Schema for ${t.name}`); if(!sc.ok) throw new Error(sc.error);
      tools.push({type:"custom", name:t.name, description:t.description, input_schema: sc.value || {type:"object", properties:{}}});
    }
    out.tools = tools;
    out.mcp_servers = mcpState.filter(s=>s.name).map(s=>({type:"url", name:s.name, url:s.url}));
    const sk = skillChecks.filter(s=>s.el.checked).map(s=>({type:"anthropic", skill_id:s.id}));
    for(const tok of customSkills.value.split(/[\s,]+/).filter(Boolean)){ const [sid, ver] = tok.split("@"); sk.push(ver ? {type:"custom", skill_id:sid, version:ver} : {type:"custom", skill_id:sid}); }
    if(sk.length && tsOn.checked && !toolState.find(t=>t.name==="read").enabled) throw new Error("Skills need the “read” tool switched on.");
    out.skills = sk;
    if(!maSupported) out.multiagent = cfg.multiagent;
    else if(maOn.checked){
      const m = ma ? structuredClone(ma) : {type:"multiagent_20261001"};
      const list = [...preset].map(x=> x==="self" ? {type:"self"} : x);
      m.subagents = {...(m.subagents||{}), type:"enabled", predefined_agents:list, inline_agents:{type: inlineOn.checked ? "enabled" : "disabled"}};
      if(!list.length && !inlineOn.checked) throw new Error("A team needs at least one member, or “create helpers on the fly” switched on.");
      m.workflows = wfOn.checked ? {...(m.workflows||{}), type:"enabled"} : {type:"disabled"};
      m.advisor = advOn.checked ? {type:"enabled", model:advModel.value} : {type:"disabled"};
      out.multiagent = m;
    } else out.multiagent = null;
    const md = parseJSON(meta.value, "Metadata"); if(!md.ok) throw new Error(md.error);
    if(md.value){
      if(typeof md.value!=="object" || Array.isArray(md.value)) throw new Error("Metadata must be an object of text values.");
      const patch = {...md.value}; if(a) for(const k of Object.keys(a.metadata||{})) if(!(k in patch)) patch[k] = null;   // removed keys
      out.metadata = patch;
    } else if(a && Object.keys(a.metadata||{}).length) out.metadata = Object.fromEntries(Object.keys(a.metadata).map(k=>[k,null]));
    return out;
  }

  async function save(force=false){
    let params; try{ params = build(); }catch(e){ status.className = "err"; status.textContent = e.message; return; }
    status.className = "msg"; status.textContent = "Saving…";
    try{
      if(isNew){ const n = await C().beta.agents.create(params); agentCache = null; toast("Agent created"); go(`agents/${n.id}`); return; }
      const n = await C().beta.agents.update(a.id, force ? params : {...params, version:a.version}, NO_RETRY);
      agentCache = null;
      if(n.version === a.version){ status.textContent = "No changes to save."; return; }
      toast(`Saved as version ${n.version}`); route();
    }catch(e){
      if(e.status===409 && !force){
        status.textContent = "";
        const ok = await confirmDialog("Someone else changed this agent", "It was saved somewhere else since you opened it. Overwrite their version with yours (it still becomes a new version, so nothing is lost), or cancel and reload?", "Save mine anyway", false);
        if(ok) return save(true);
        return;
      }
      status.className = "err"; status.textContent = errText(e);
    }
  }

  body.append(h("div",{class:"wrapW"},
    a?.archived_at ? h("div",{class:"note warn", style:"margin-bottom:16px"}, icon("archive"), "This agent is archived. It’s read-only and can’t be used for new sessions.") : "",
    h("div",{class:"form"},
      h("h3",{},"Basics"),
      h("label",{},"Name"), name,
      h("label",{},"Description", h("small",{},"For you and your team")), desc,
      h("label",{},"Model"), modelSel,
      h("label",{},"Effort", h("small",{},"How hard it thinks")), effortSel,
      h("label",{},"Fast mode", h("small",{},"Opus 5.5 / 5 only, costs more")), h("div",{style:"padding-top:8px"}, fast),
      h("label",{},"Instructions", h("small",{},"The system prompt")), system,
      h("h3",{},"Sandbox tools"),
      h("label",{},"Built-in tools", h("small",{},"Run in the agent’s own cloud sandbox")), h("div",{}, h("div",{style:"padding:8px 0"}, tsOn),
        h("table",{class:"toolTable"}, h("tbody",{}, toolRows)),
        h("p",{class:"hint"},"Ask pauses the agent until you approve in the session. Scheduled runs have nobody to approve, so they wait forever on Ask.")),
      h("h3",{},"Connected tools"),
      h("label",{},"MCP servers", h("small",{},"Logins and tokens go in a vault, not here")), mcpBox,
      h("label",{},"Custom tools", h("small",{},"Tools you answer yourself")), customBox,
      h("h3",{},"Skills"),
      h("label",{},"Anthropic skills"), h("div",{class:"inline", style:"padding-top:8px"}, skillChecks.map(s=>h("label",{class:"check", style:"margin-right:12px"}, s.el, s.label))),
      h("label",{},"Your skills", h("small",{},"IDs, optionally @version")), customSkills,
      h("h3",{},"Team"),
      h("label",{},"Multi-agent", h("small",{},"Coordinate other agents")), h("div",{}, h("div",{style:"padding:8px 0"}, maOn),
        maSupported ? "" : h("div",{class:"note"}, icon("info"), "This agent uses an older team format. Edit it on the JSON tab."), teamBox),
      h("h3",{},"Advanced"),
      h("label",{},"Metadata", h("small",{},"Up to 16 text labels")), meta),
    a?.archived_at ? "" : h("div",{class:"saveBar"}, status, h("span",{class:"sp"}),
      isNew ? h("button",{class:"btn", onclick:()=>go("agents")}, "Cancel") : h("span",{class:"hint"}, `Saving makes version ${a.version+1}`),
      h("button",{class:"btn primary", onclick:()=>save()}, icon("check"), isNew ? "Create agent" : "Save"))));
  if(isNew) setTimeout(()=>name.focus());
}

/* ---------- raw JSON ---------- */
function agentJson(a, body){
  const ta = area({rows:28, class:"field code"}); ta.value = JSON.stringify(pickConfig(a), null, 2);
  const status = h("span",{class:"msg"});
  body.append(h("div",{class:"wrapW"},
    h("p",{class:"hint", style:"margin-top:0"},"The agent’s full setup. Lists (tools, MCP servers, skills) are replaced as a whole when you save. Fields you remove are left as they were — set them to null to clear them."),
    ta,
    a.archived_at ? "" : h("div",{class:"saveBar"}, status, h("span",{class:"sp"}),
      h("button",{class:"btn", onclick:()=>copyText(ta.value)}, icon("copy"), "Copy"),
      h("button",{class:"btn primary", onclick:async()=>{
        const p = parseJSON(ta.value); if(!p.ok || typeof p.value!=="object"){ status.className="err"; status.textContent = p.error || "Not an object"; return; }
        status.className = "msg"; status.textContent = "Saving…";
        try{ const n = await C().beta.agents.update(a.id, {...p.value, version:a.version}, NO_RETRY); agentCache = null; toast(n.version===a.version ? "No changes" : `Saved as version ${n.version}`); route(); }
        catch(e){ status.className = "err"; status.textContent = e.status===409 ? "This agent changed since you opened it. Reload the page and try again." : errText(e); }
      }}, icon("check"), "Save as new version"))));
}

/* ---------- versions ---------- */
async function agentVersions(a, body){
  const wrap = h("div",{class:"verGrid"}, h("div",{class:"hint"},"Loading versions…"));
  body.append(wrap);
  const vs = await api(c=>listAll(c.beta.agents.versions.list(a.id, {limit:100}), 1000), "Versions");
  if(!vs) return;
  vs.sort((x,y)=>y.version-x.version);
  let sel = vs.find(v=>v.version===a.version-1) || vs[0], against = "current";
  const listEl = h("div",{class:"verList"}), right = h("div",{});
  const summary = (v, prev)=>{
    if(!prev) return "First version";
    const ch = CONFIG_KEYS.filter(k=> JSON.stringify(v[k]??null) !== JSON.stringify(prev[k]??null));
    return ch.length ? "Changed " + ch.map(k=>k.replace("_"," ")).join(", ") : "No config changes";
  };
  const drawList = ()=> listEl.replaceChildren(...vs.map((v,i)=> h("div",{class:"ver"+(v===sel?" sel":""), onclick:()=>{ sel = v; drawList(); drawRight(); }},
    h("span",{class:"vn"}, "v"+v.version), h("span",{class:"vs"}, summary(v, vs[i+1])),
    v.version===a.version ? chip("Current","ok") : h("span",{class:"hint"}, ago(v.updated_at||v.created_at)))));
  const drawRight = ()=>{
    const idx = vs.indexOf(sel), prev = vs[idx+1];
    const base = against==="current" ? vs[0] : prev;
    right.replaceChildren(
      h("div",{class:"toolbar"},
        h("b",{}, `Version ${sel.version}`), h("span",{class:"hint"}, when(sel.updated_at||sel.created_at)), h("span",{class:"sp"}),
        seg([{value:"current", label:`vs current (v${vs[0].version})`}, {value:"previous", label:"vs previous"}], against, v=>{ against = v; drawRight(); })),
      base ? h("p",{class:"hint", style:"margin:0 0 8px"}, h("span",{style:"color:var(--danger)"},"−"), ` v${base.version}  `, h("span",{style:"color:var(--ok)"},"+"), ` v${sel.version}`) : "",
      base ? diffView(pickConfig(base), pickConfig(sel)) : jsonView(pickConfig(sel)),
      h("div",{class:"row", style:"margin-top:14px"},
        sel.version!==a.version && !a.archived_at ? h("button",{class:"btn primary", onclick:async()=>{
          if(!await confirmDialog(`Restore version ${sel.version}?`, `Its setup is saved as a new version (v${a.version+1}). Nothing is deleted — you can always go back.`, "Restore", false)) return;
          const n = await api(c=>c.beta.agents.update(a.id, {...pickConfig(sel), version:a.version}, NO_RETRY), "Restore");
          if(n){ agentCache = null; toast(`Restored as version ${n.version}`); go(`agents/${a.id}/versions`); }
        }}, icon("history"), "Restore this version") : "",
        a.archived_at ? "" : h("button",{class:"btn", onclick:()=>newSessionDialog({agent:a, version:sel.version})}, icon("chat"), `Talk to v${sel.version}`),
        h("button",{class:"btn ghost", onclick:()=>{ const bg = modal(h("div",{class:"modal wide"}, h("h2",{},`Version ${sel.version}`), jsonView(pickConfig(sel)), h("div",{class:"actions"}, h("button",{class:"btn", onclick:()=>bg.remove()},"Close")))); }}, icon("code"), "Full JSON")));
  };
  wrap.replaceChildren(listEl, right); drawList(); drawRight();
}
