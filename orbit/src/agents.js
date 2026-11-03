/* ================= agents ================= */
const SANDBOX_TOOLS = [
  {name:"bash",       desc:"Run shell commands in the sandbox", def:"always_ask"},
  {name:"read",       desc:"Read files",                         def:"always_allow"},
  {name:"write",      desc:"Create files",                       def:"always_ask"},
  {name:"edit",       desc:"Change files",                       def:"always_ask"},
  {name:"glob",       desc:"Find files by pattern",              def:"always_allow"},
  {name:"grep",       desc:"Search inside files",                def:"always_allow"},
  {name:"web_search", desc:"Search the web ($10 per 1,000 searches)", def:"always_allow", off:true},
  {name:"web_fetch",  desc:"Read web pages that came up in the conversation", def:"always_allow", off:true},
];
const TOOLSET = "agent_toolset_20260401";
const PERMS = [
  {value:"always_allow", label:"Allow", cls:"p-allow", title:"Runs without asking"},
  {value:"always_ask",   label:"Ask",   cls:"p-ask",   title:"Pauses for your approval every time"},
  {value:"auto",         label:"Auto",  cls:"p-auto",  title:"Anthropic’s safety check decides: runs, blocks, or asks you"},
];
const ANTHROPIC_SKILLS = [["xlsx","Excel"],["docx","Word"],["pptx","PowerPoint"],["pdf","PDF"]];
const CONFIG_KEYS = ["name","description","model","system","tools","mcp_servers","skills","multiagent","execution_identity"];
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
let skillCache = null;
async function skillList(force=false){ if(!skillCache || force) skillCache = await listAll(C().skills.list({limit:100}), 500); return skillCache; }

/* ---------- shared tools editor (agent editor + "change tools for this session") ---------- */
const splitList = (v)=> String(v||"").split(/[\s,]+/).map(x=>x.trim()).filter(Boolean);
const cleanHost = (x)=> x.replace(/^https?:\/\//,"").replace(/\/.*$/,"");
function toolsEditor({tools=[], mcp_servers=[]}={}){
  const ts = tools.find(t=>t.type===TOOLSET);
  const tsOn = h("input",{type:"checkbox", class:"switch", checked:!!ts});
  const state = SANDBOX_TOOLS.map(t=>({...t, enabled: ts ? toolEnabled(ts, t.name) : !t.off, perm: ts ? toolPerm(ts, t.name) : t.def,
    extra: structuredClone((ts?.configs||[]).find(c=>c.name===t.name) || {})}));
  const rows = state.map(t=>{
    const en = h("input",{type:"checkbox", checked:t.enabled, onchange:(e)=>{ t.enabled = e.target.checked; }});
    let more = "";
    if(t.name==="web_search" || t.name==="web_fetch"){
      const x = t.extra;
      t.domMode = x.blocked_domains?.length ? "block" : "only";
      const dom = field({placeholder:"example.com, docs.example.org", value:(x.allowed_domains||x.blocked_domains||[]).join(", "), style:"height:30px;font-size:12.5px"});
      dom.oninput = ()=>{ t.domains = dom.value; };
      const modeSeg = seg([{value:"only", label:"Only these sites"}, {value:"block", label:"Never these sites"}], t.domMode, v=>{ t.domMode = v; t.domains = dom.value; });
      const extraRows = [];
      if(t.name==="web_search"){
        const loc = x.user_location||{};
        t.loc = {country:field({placeholder:"Country (e.g. NZ)", value:loc.country||"", style:"height:30px;font-size:12.5px;max-width:150px"}),
                 city:field({placeholder:"City", value:loc.city||"", style:"height:30px;font-size:12.5px;max-width:160px"}),
                 timezone:field({placeholder:"Time zone (e.g. Pacific/Auckland)", value:loc.timezone||"", style:"height:30px;font-size:12.5px"})};
        extraRows.push(h("div",{class:"inline"}, h("span",{class:"hint"},"Search from:"), t.loc.country, t.loc.city, t.loc.timezone));
      } else {
        t.maxTok = field({type:"number", min:1000, step:1000, placeholder:"Max tokens per page (optional)", value:x.max_content_tokens||"", style:"height:30px;font-size:12.5px;max-width:240px"});
        extraRows.push(h("div",{class:"inline"}, t.maxTok, h("span",{class:"hint"},"It can only open pages already mentioned in the conversation: paste the link in your message.")));
      }
      more = h("details",{style:"margin-top:6px"}, h("summary",{class:"hint", style:"cursor:pointer"},"Settings"),
        h("div",{style:"display:grid;gap:8px;margin-top:8px"}, h("div",{class:"inline"}, modeSeg), dom, ...extraRows));
    }
    return h("tr",{}, h("td",{}, h("label",{class:"check"}, en)),
      h("td",{}, h("div",{class:"nm"}, t.name), h("div",{class:"ds"}, t.desc), more),
      h("td",{style:"text-align:right"}, seg(PERMS, t.perm, v=>{ t.perm = v; })));
  });
  const sandbox = h("div",{}, h("div",{style:"padding:8px 0"}, tsOn), h("table",{class:"toolTable"}, h("tbody",{}, rows)),
    h("p",{class:"hint"},"Ask pauses the agent until you approve in the session. Scheduled runs have nobody to approve, so they wait forever on Ask."));

  // MCP servers, each with optional per-tool rules
  const mcpState = mcp_servers.map(s=>{ const tset = tools.find(t=>t.type==="mcp_toolset" && t.mcp_server_name===s.name);
    return {name:s.name, url:s.url, perm: tset?.default_config?.permission_policy?.type || "always_ask", on: tset?.default_config?.enabled !== false,
      rules:(tset?.configs||[]).map(c=>({name:c.name, enabled:c.enabled!==false, perm:c.permission_policy?.type||""})), toolset: tset ? structuredClone(tset) : null}; });
  const mcp = h("div",{});
  const drawMcp = ()=> mcp.replaceChildren(...mcpState.map((s,i)=>{
    const n = field({value:s.name, placeholder:"name, e.g. github", style:"max-width:180px"}); n.oninput = ()=>{ s.name = n.value.trim(); };
    const u = field({value:s.url, placeholder:"https://mcp.example.com/mcp", class:"field mono"}); u.oninput = ()=>{ s.url = u.value.trim(); };
    const tunnel = h("button",{class:"btn sm ghost", title:"Use a private MCP server reached through a tunnel", onclick:()=>pickTunnel(url=>{ s.url = url; u.value = url; })}, icon("link"), "Tunnel…");
    const rulesBox = h("div",{style:"display:grid;gap:6px;margin-top:6px"});
    const drawRules = ()=> rulesBox.replaceChildren(...s.rules.map((r,j)=>{
      const rn = field({value:r.name, placeholder:"tool name, e.g. create_issue", class:"field mono", style:"height:30px;font-size:12.5px;max-width:240px"}); rn.oninput = ()=>{ r.name = rn.value.trim(); };
      return h("div",{class:"inline"}, h("label",{class:"check"}, h("input",{type:"checkbox", checked:r.enabled, onchange:(e)=>{ r.enabled = e.target.checked; }}), "on"), rn,
        seg(PERMS, r.perm || s.perm, v=>{ r.perm = v; }), h("button",{class:"iconBtn sm", title:"Remove rule", onclick:()=>{ s.rules.splice(j,1); drawRules(); }}, icon("x")));
    }), h("div",{}, h("button",{class:"btn sm ghost", onclick:()=>{ s.rules.push({name:"", enabled:true, perm:""}); drawRules(); }}, icon("plus"), "Rule for one tool")));
    drawRules();
    return h("div",{class:"box"}, h("div",{class:"inline"}, n, u, tunnel, h("button",{class:"iconBtn sm", title:"Remove", onclick:()=>{ mcpState.splice(i,1); drawMcp(); }}, icon("x"))),
      h("div",{class:"inline", style:"margin-top:8px"}, h("label",{class:"check"}, h("input",{type:"checkbox", checked:s.on, onchange:(e)=>{ s.on = e.target.checked; }}), "Tools on"), h("span",{class:"hint"},"All its tools:"), seg(PERMS, s.perm, v=>{ s.perm = v; })),
      h("details",{open: s.rules.length>0}, h("summary",{class:"hint", style:"cursor:pointer;margin-top:6px"}, `Rules for single tools (${s.rules.length})`), rulesBox));
  }), h("button",{class:"btn sm", onclick:()=>{ mcpState.push({name:"", url:"", perm:"always_ask", on:true, rules:[]}); drawMcp(); }}, icon("plus"), "Add MCP server"));
  drawMcp();

  // custom tools
  const customState = tools.filter(t=>t.type==="custom").map(t=>({name:t.name, description:t.description||"", schema: JSON.stringify(t.input_schema||{type:"object", properties:{}}, null, 2)}));
  const custom = h("div",{});
  const drawCustom = ()=> custom.replaceChildren(...customState.map((t,i)=>{
    const n = field({value:t.name, placeholder:"tool_name", class:"field mono", style:"max-width:220px"}); n.oninput = ()=>{ t.name = n.value.trim(); };
    const d = field({value:t.description, placeholder:"What it does and when to use it"}); d.oninput = ()=>{ t.description = d.value; };
    const s = area({rows:5, class:"field code"}); s.value = t.schema; s.oninput = ()=>{ t.schema = s.value; };
    return h("div",{class:"box"}, h("div",{class:"inline"}, n, d, h("button",{class:"iconBtn sm", title:"Remove", onclick:()=>{ customState.splice(i,1); drawCustom(); }}, icon("x"))),
      h("div",{class:"hint", style:"margin:8px 0 4px"},"Input schema (JSON Schema). You answer these calls yourself while talking to the agent."), s);
  }), h("button",{class:"btn sm", onclick:()=>{ customState.push({name:"", description:"", schema:'{\n  "type": "object",\n  "properties": {}\n}'}); drawCustom(); }}, icon("plus"), "Add custom tool"));
  drawCustom();

  function build(){
    const out = [];
    if(tsOn.checked){
      out.push({type:TOOLSET, default_config:{enabled:true, permission_policy:{type:"always_allow"}},
        configs: state.map(t=>{
          const c = {...t.extra, name:t.name, enabled:t.enabled, permission_policy:{type:t.perm}}; delete c.type;
          if(t.domains !== undefined){
            const d = splitList(t.domains).map(cleanHost); delete c.allowed_domains; delete c.blocked_domains;
            if(d.length > 64) throw new Error(`${t.name}: at most 64 sites.`);
            if(d.length) c[t.domMode==="block" ? "blocked_domains" : "allowed_domains"] = d;
          }
          if(t.loc){ const l = {type:"approximate"}; for(const k of ["country","city","timezone"]) if(t.loc[k].value.trim()) l[k] = k==="country" ? t.loc[k].value.trim().toUpperCase() : t.loc[k].value.trim();
            if(l.country && !/^[A-Z]{2}$/.test(l.country)) throw new Error("web_search: the country is a 2-letter code, like NZ or US.");
            if(Object.keys(l).length > 1) c.user_location = l; else delete c.user_location; }
          if(t.maxTok){ const m = parseInt(t.maxTok.value,10); if(m > 0) c.max_content_tokens = m; else delete c.max_content_tokens; }
          return c; })});
    }
    const names = new Set();
    for(const s of mcpState){
      if(!s.name && !s.url) continue;
      if(!/^[\w.-]{1,255}$/.test(s.name)) throw new Error(`MCP server name “${s.name}” — use letters, numbers, dots, dashes or underscores.`);
      if(!/^https:\/\//i.test(s.url)) throw new Error(`MCP server “${s.name}” needs an https:// URL.`);
      if(names.has(s.name)) throw new Error(`Two MCP servers are called “${s.name}”.`); names.add(s.name);
      const tset = s.toolset || {type:"mcp_toolset", mcp_server_name:s.name};
      tset.mcp_server_name = s.name; tset.default_config = {...(tset.default_config||{}), enabled:s.on, permission_policy:{type:s.perm}};
      const rules = s.rules.filter(r=>r.name);
      for(const r of rules) if(!/^[\w.-]{1,128}$/.test(r.name)) throw new Error(`“${r.name}” isn’t a valid tool name.`);
      if(rules.length) tset.configs = rules.map(r=>({name:r.name, enabled:r.enabled, ...(r.perm ? {permission_policy:{type:r.perm}} : {})})); else delete tset.configs;
      out.push(tset);
    }
    for(const t of customState){
      if(!t.name && !t.description) continue;
      if(!/^[A-Za-z0-9_-]{1,128}$/.test(t.name)) throw new Error(`Custom tool name “${t.name}” — letters, numbers, - and _ only.`);
      const sc = parseJSON(t.schema, `Schema for ${t.name}`); if(!sc.ok) throw new Error(sc.error);
      out.push({type:"custom", name:t.name, description:t.description, input_schema: sc.value || {type:"object", properties:{}}});
    }
    return {tools:out, mcp_servers: mcpState.filter(s=>s.name).map(s=>({type:"url", name:s.name, url:s.url}))};
  }
  return {sandbox, mcp, custom, build, readOn: ()=> !tsOn.checked || state.find(t=>t.name==="read").enabled};
}
async function pickTunnel(onPick){
  const box = h("div",{class:"modal"}, h("h2",{},"Use a tunnel"), h("p",{class:"lead"},"Tunnels let agents reach an MCP server on your own network without opening it to the internet (research preview). Set one up in the Anthropic Console, then pick it here."), h("p",{class:"hint"},"Loading…"));
  const bg = modal(box);
  let list = null;
  try{ list = (await listAll(C().beta.tunnels.list({limit:100}), 200)).filter(t=>!t.archived_at); }
  catch(e){ box.lastChild.replaceWith(h("p",{class:"err"}, e.status===403 || e.status===404 ? "Tunnels aren’t enabled for this workspace (research preview)." : errText(e))); box.append(h("div",{class:"actions"}, h("button",{class:"btn", onclick:()=>bg.remove()},"Close"))); return; }
  const sub = field({class:"field mono", value:"mcp", placeholder:"mcp", style:"max-width:140px"});
  const path = field({class:"field mono", value:"/mcp", placeholder:"/mcp", style:"max-width:140px"});
  box.lastChild.replaceWith(h("div",{}, h("div",{class:"inline", style:"margin-bottom:10px"}, h("span",{class:"hint"},"Server name"), sub, h("span",{class:"hint"},"Path"), path),
    list.length ? h("div",{class:"list"}, list.map(t=>h("div",{class:"card", style:"padding:10px 12px", onclick:()=>{
        const s = sub.value.trim().replace(/[^a-z0-9-]/gi,"") || "mcp", p = path.value.trim() || "/";
        onPick(`https://${s}.${t.domain}${p.startsWith("/") ? p : "/"+p}`); bg.remove(); }},
      h("div",{class:"av soft"}, icon("link")), h("div",{class:"main"}, h("div",{class:"t"}, t.display_name || t.id), h("div",{class:"s"}, `${sub.value||"mcp"}.${t.domain}`)))))
    : h("p",{},"No tunnels in this workspace yet.")));
  box.append(h("div",{class:"actions"}, h("button",{class:"btn", onclick:()=>bg.remove()},"Close")));
}

async function agentEditor(a, body){
  const isNew = !a;
  if(isNew) body = shell({crumb:[["Agents","agents"]], title:"New agent", sub:"Set it up, save it, then talk to it."});
  const cfg = isNew ? blankAgent() : pickConfig(a);
  if(typeof cfg.model==="string") cfg.model = {id:cfg.model};
  const [others, skillsAvail] = await Promise.all([agentList().catch(()=>[]), skillList().catch(()=>null)]);
  const otherAgents = others.filter(x=>!a || x.id!==a.id);

  const name = field({value:cfg.name, placeholder:"e.g. Support triage"});
  const desc = field({value:cfg.description||"", placeholder:"What it’s for (optional)"});
  const modelSel = select([...MODELS.map(m=>({value:m.id, label:`${m.name} — ${m.sub}`})), ...(MODELS.some(m=>m.id===cfg.model.id)?[]:[{value:cfg.model.id, label:cfg.model.id}])], cfg.model.id);
  const effortWrap = h("div",{});
  let effortSel;
  const fast = h("input",{type:"checkbox", class:"switch", checked: cfg.model.speed==="fast"});
  const fastHint = h("small",{});
  const geo = select([{value:"", label:"Default"}, {value:"us", label:"United States only"}, {value:"global", label:"Global"}], cfg.model.inference_geo || "");
  const system = area({rows:12, placeholder:"Instructions the agent always follows: its job, tone, what to do and not do, when to ask.", value:cfg.system||""});
  const tl = toolsEditor(cfg);

  // skills: Anthropic's + your uploaded ones (with versions)
  const skills = cfg.skills||[];
  const skillChecks = ANTHROPIC_SKILLS.map(([id,label])=> ({id, el:h("input",{type:"checkbox", checked: skills.some(s=>s.type==="anthropic" && s.skill_id===id)}), label}));
  const mine = skills.filter(s=>s.type==="custom");
  let customSkills, customSkillState = null;
  if(skillsAvail){
    customSkillState = skillsAvail.map(sk=>({id:sk.id, name:sk.display_name, on: mine.some(m=>m.skill_id===sk.id), version: mine.find(m=>m.skill_id===sk.id)?.version || ""}));
    for(const m of mine) if(!skillsAvail.some(sk=>sk.id===m.skill_id)) customSkillState.push({id:m.skill_id, name:m.skill_id+" (not found)", on:true, version:m.version||""});
    customSkills = customSkillState.length ? h("div",{style:"display:grid;gap:6px;padding-top:6px"}, customSkillState.map(st=>{
      const ver = field({class:"field mono", placeholder:"latest", value: st.version==="latest" ? "" : st.version, style:"height:30px;font-size:12.5px;max-width:200px"}); ver.oninput = ()=>{ st.version = ver.value.trim(); };
      return h("div",{class:"inline"}, h("label",{class:"check", style:"min-width:200px"}, h("input",{type:"checkbox", checked:st.on, onchange:(e)=>{ st.on = e.target.checked; }}), st.name), h("span",{class:"hint"},"version"), ver);
    }), h("a",{href:"#/skills", class:"hint", style:"color:var(--accent)"}, "Manage your skills →"))
      : h("p",{class:"hint", style:"padding-top:8px;margin:0"}, "You haven’t uploaded any skills. ", h("a",{href:"#/skills", style:"color:var(--accent)"}, "Add one in Skills"), ".");
  } else customSkills = field({class:"field mono", placeholder:"skill_01… , skill_02…@3", value: mine.map(s=> s.skill_id + (s.version && s.version!=="latest" ? "@"+s.version : "")).join(", ")});

  // team (multi-agent)
  const ma = cfg.multiagent ? structuredClone(cfg.multiagent) : null;
  const maSupported = !ma || ma.type==="multiagent_20261001";
  const maOn = h("input",{type:"checkbox", class:"switch", checked:!!ma, disabled:!maSupported});
  const preset = new Set((ma?.subagents?.predefined_agents||[]).map(x=> typeof x==="string" ? x : x.type==="self" ? "self" : x.id));
  const teamChecks = [{id:"self", name:"Copies of itself"}, ...otherAgents.filter(o=>!o.archived_at && !o.multiagent)].map(o=>
    h("label",{class:"check", style:"margin:3px 14px 3px 0"}, h("input",{type:"checkbox", checked:preset.has(o.id), onchange:(e)=>{ e.target.checked ? preset.add(o.id) : preset.delete(o.id); }}), o.name));
  const inlineOn = h("input",{type:"checkbox", checked: (ma?.subagents?.inline_agents?.type ?? "enabled")==="enabled"});
  const wfOn = h("input",{type:"checkbox", checked: ma ? (ma.workflows?.type ?? "enabled")==="enabled" : false});
  const advOn = h("input",{type:"checkbox", checked: ma?.advisor?.type==="enabled"});
  const advWrap = h("span",{}), advHint = h("div",{class:"hint", style:"margin-top:4px"});
  let advModel;
  const teamBox = h("div",{class:"box", style: ma ? "" : "display:none"},
    h("div",{class:"hint", style:"margin-bottom:6px"},"Agents it can hand work to (each must not have a team of its own):"), h("div",{}, teamChecks),
    h("label",{class:"check", style:"margin-top:10px"}, inlineOn, "Let it create helpers on the fly"),
    h("br"), h("label",{class:"check", style:"margin-top:6px"}, wfOn, "Let it run background workflows (set a spending cap on sessions)"),
    h("div",{class:"inline", style:"margin-top:6px"}, h("label",{class:"check"}, advOn, "Consult an advisor model"), advWrap), advHint);
  maOn.onchange = ()=>{ teamBox.style.display = maOn.checked ? "" : "none"; };

  // everything that depends on the chosen model
  function syncModel(){
    const id = modelSel.value, info = modelInfo(id);
    const cur = effortSel ? effortSel.value : (cfg.model.effort?.type || cfg.model.effort || "");
    effortSel = select(effortOptions(id), cur); effortWrap.replaceChildren(effortSel);
    fast.disabled = !info.fast; if(!info.fast) fast.checked = false;
    fastHint.textContent = info.fast ? "Faster replies, costs more" : "Only Opus 5.5 and Opus 5";
    const allowed = info.advisors || [...MODELS.map(m=>m.id)];
    const curAdv = advModel ? advModel.value : (ma?.advisor?.model || allowed[0]);
    advModel = select(allowed.map(m=>({value:m, label:advisorName(m)})), allowed.includes(curAdv) ? curAdv : allowed[0], {style:"max-width:240px;height:32px"});
    const upd = ()=>{ advHint.textContent = REDACTED_ADVISORS.has(advModel.value) ? "This advisor’s advice is hidden from you ([redacted] in the transcript); the agent still gets it." : ""; };
    advModel.onchange = upd; advWrap.replaceChildren(advModel); upd();
  }
  modelSel.onchange = syncModel; syncModel();

  const execId = select([{value:"service_account", label:"Anthropic service account (default)"}, {value:"aws_role", label:"An AWS role (Claude Platform on AWS)"}], cfg.execution_identity?.type || "service_account");
  const roleArn = field({class:"field mono", placeholder:"arn:aws:iam::123456789012:role/agent", value: cfg.execution_identity?.role_arn || ""});
  const roleRow = h("div",{style:"margin-top:8px"}, roleArn);
  const syncExec = ()=>{ roleRow.style.display = execId.value==="aws_role" ? "" : "none"; }; execId.onchange = syncExec; syncExec();
  const meta = area({rows:3, class:"field code", placeholder:'{"team": "support"}'}); meta.value = a && Object.keys(a.metadata||{}).length ? JSON.stringify(a.metadata, null, 2) : "";
  const status = h("span",{class:"msg"});

  function build(){
    const out = {name:name.value.trim(), description: desc.value.trim() || null, system: system.value || null};
    if(!out.name) throw new Error("Give the agent a name.");
    const model = {...cfg.model, id: modelSel.value};
    if(effortSel.value) model.effort = effortSel.value; else delete model.effort;
    if(fast.checked && !fast.disabled) model.speed = "fast"; else delete model.speed;
    if(geo.value) model.inference_geo = geo.value; else delete model.inference_geo;
    out.model = model;
    Object.assign(out, tl.build());
    const sk = skillChecks.filter(s=>s.el.checked).map(s=>({type:"anthropic", skill_id:s.id}));
    if(customSkillState) for(const st of customSkillState.filter(x=>x.on)) sk.push(st.version ? {type:"custom", skill_id:st.id, version:st.version} : {type:"custom", skill_id:st.id});
    else for(const tok of splitList(customSkills.value)){ const [sid, ver] = tok.split("@"); sk.push(ver ? {type:"custom", skill_id:sid, version:ver} : {type:"custom", skill_id:sid}); }
    if(sk.length && !tl.readOn()) throw new Error("Skills need the “read” tool switched on.");
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
    if(execId.value==="aws_role"){
      if(!/^arn:aws[\w-]*:iam::\d{12}:role\/.+/.test(roleArn.value.trim())) throw new Error("Enter the AWS role’s ARN, like arn:aws:iam::123456789012:role/agent");
      out.execution_identity = {type:"aws_role", role_arn:roleArn.value.trim()};
    } else if(cfg.execution_identity?.type==="aws_role") out.execution_identity = {type:"service_account"};
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
      h("label",{},"Effort", h("small",{},"How hard it thinks")), effortWrap,
      h("label",{},"Fast mode", fastHint), h("div",{style:"padding-top:8px"}, fast),
      h("label",{},"Instructions", h("small",{},"The system prompt")), system,
      h("h3",{},"Sandbox tools"),
      h("label",{},"Built-in tools", h("small",{},"Run in the agent’s own cloud sandbox")), tl.sandbox,
      h("h3",{},"Connected tools"),
      h("label",{},"MCP servers", h("small",{},"Logins and tokens go in a vault, not here")), tl.mcp,
      h("label",{},"Custom tools", h("small",{},"Tools you answer yourself")), tl.custom,
      h("h3",{},"Skills"),
      h("label",{},"Anthropic skills"), h("div",{class:"inline", style:"padding-top:8px"}, skillChecks.map(s=>h("label",{class:"check", style:"margin-right:12px"}, s.el, s.label))),
      h("label",{},"Your skills", h("small",{},"Uploaded in Skills")), customSkills,
      h("h3",{},"Team"),
      h("label",{},"Multi-agent", h("small",{},"Coordinate other agents")), h("div",{}, h("div",{style:"padding:8px 0"}, maOn),
        maSupported ? "" : h("div",{class:"note"}, icon("info"), "This agent uses an older team format. Edit it on the JSON tab."), teamBox),
      h("h3",{},"Advanced"),
      h("label",{},"Where it runs", h("small",{},"Pin model processing to a region")), geo,
      h("label",{},"Acts as", h("small",{},"The identity its tools use")), h("div",{}, execId, roleRow),
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
