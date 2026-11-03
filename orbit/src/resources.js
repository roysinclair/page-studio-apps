/* ================= environments ================= */
const PKG_MANAGERS = [["pip","Python (pip)"],["npm","Node (npm)"],["apt","System (apt)"],["cargo","Rust (cargo)"],["gem","Ruby (gem)"],["go","Go"]];
const netLabel = (e)=> e.config?.type==="self_hosted" ? "Self-hosted" : e.config?.networking?.type==="limited" ? "Limited network" : "Open network";

async function viewEnvironments(){
  const body = shell({title:"Environments", sub:"The cloud sandboxes your agents run in: network access and pre-installed packages.",
    actions:[h("button",{class:"btn primary", onclick:()=>go("environments/new")}, icon("plus"), "New environment")]});
  simpleList(body, {
    load:(arch)=> listAll(C().beta.environments.list({limit:100, include_archived:arch}), 500),
    card:(e)=> h("div",{class:"card"+(e.archived_at?" archived":""), onclick:()=>go(`environments/${e.id}`)}, h("div",{class:"av soft"}, icon("box")),
      h("div",{class:"main"}, h("div",{class:"t"}, e.name), h("div",{class:"s"}, e.description || e.id)),
      h("div",{class:"chips hideSm"}, chip(netLabel(e), e.config?.networking?.type==="limited" ? "ok" : ""), e.archived_at ? chip("Archived","ghost") : ""),
      h("div",{class:"when"}, ago(e.updated_at))),
    empty:["box","No environments yet","An environment is a template for the sandbox: which websites it can reach and what’s installed. You need one to start a session.", ()=>go("environments/new"), "New environment"],
    what:"Environments"});
}
async function viewEnvironment(id){
  const isNew = id==="new";
  let e = null;
  if(!isNew){ e = await api(c=>c.beta.environments.retrieve(id), "Environment"); if(!e){ shell({crumb:[["Environments","environments"]], title:"Not found"}); return; } }
  const more = h("button",{class:"iconBtn", title:"More"}, icon("menu"));
  more.onclick = ()=> popMenu(more, [{label:"Copy ID", value:"id", icon:"copy"},
    ...(e.archived_at ? [] : [{label:"Archive…", sub:"New sessions can’t use it", value:"archive", icon:"archive", danger:true}]),
    {label:"Delete…", value:"delete", icon:"trash", danger:true}], async v=>{
    if(v==="id") copyText(e.id);
    if(v==="archive" && await typedConfirm("Archive this environment?","Archiving is permanent. Running sessions carry on, but new sessions and schedules can’t use it.", e.name, "Archive forever")){ if(await api(c=>c.beta.environments.archive(e.id),"Archive")){ toast("Archived"); route(); } }
    if(v==="delete" && await typedConfirm("Delete this environment?","It’s removed for good. Schedules that use it will pause with an error.", e.name, "Delete forever")){ if(await api(c=>c.beta.environments.delete(e.id),"Delete")){ toast("Deleted"); go("environments"); } }
  });
  const body = shell({crumb:[["Environments","environments"]], title: isNew ? "New environment" : e.name,
    sub: isNew ? "A sandbox template" : [idTag(e.id), chip(netLabel(e)), e.archived_at ? chip("Archived","bad") : "", h("span",{}, "updated "+ago(e.updated_at))],
    actions: isNew ? [] : [more]});
  const cfg = e?.config || {type:"cloud", networking:{type:"limited", allowed_hosts:[], allow_package_managers:true, allow_mcp_servers:true}, packages:{}};
  if(cfg.type==="self_hosted"){ body.append(h("div",{class:"wrapW"}, h("div",{class:"note"}, icon("info"), "This is a self-hosted environment: tools run on your own worker machines. Page Orbit can show it but not edit its worker setup."), h("div",{style:"margin-top:14px"}, jsonView(e)))); return; }
  const name = field({value:e?.name||"", placeholder:"e.g. python-data"});
  const desc = field({value:e?.description||"", placeholder:"Optional"});
  let net = cfg.networking?.type || "unrestricted";
  const hosts = area({rows:4, class:"field mono", placeholder:"api.example.com\n*.example.org", value:(cfg.networking?.allowed_hosts||[]).join("\n")});
  const pm = h("input",{type:"checkbox", class:"switch", checked: cfg.networking?.allow_package_managers ?? true});
  const mcp = h("input",{type:"checkbox", class:"switch", checked: cfg.networking?.allow_mcp_servers ?? true});
  const limBox = h("div",{style:"display:grid;gap:10px"},
    h("div",{}, h("div",{class:"hint", style:"margin-bottom:4px"},"Websites it may reach, one per line. *.example.com covers subdomains but not example.com itself."), hosts),
    h("label",{class:"toggle"}, h("div",{class:"tx"}, h("b",{},"Package managers"), h("span",{},"PyPI, npm and the other package registries")), pm),
    h("label",{class:"toggle"}, h("div",{class:"tx"}, h("b",{},"The agent’s MCP servers")), mcp));
  const netSeg = seg([{value:"limited", label:"Limited (safer)"}, {value:"unrestricted", label:"Open internet"}], net, v=>{ net = v; limBox.style.display = v==="limited" ? "grid" : "none"; });
  limBox.style.display = net==="limited" ? "grid" : "none";
  const pkgIns = PKG_MANAGERS.map(([k,l])=>({k, l, el:field({class:"field mono", placeholder: k==="pip" ? "pandas==2.2.0, requests" : "", value:(cfg.packages?.[k]||[]).join(", ")})}));
  const status = h("span",{class:"msg"});
  const save = async()=>{
    if(!name.value.trim()){ status.className="err"; status.textContent = "Give it a name."; return; }
    const networking = net==="limited" ? {type:"limited", allowed_hosts: hosts.value.split(/[\s,]+/).map(x=>x.trim()).filter(Boolean), allow_package_managers:pm.checked, allow_mcp_servers:mcp.checked} : {type:"unrestricted"};
    const packages = {type:"packages"}; for(const p of pkgIns) packages[p.k] = p.el.value.split(/[,\n]+/).map(x=>x.trim()).filter(Boolean);
    if(net==="limited" && !pm.checked && PKG_MANAGERS.some(([k])=>packages[k].length)){ status.className="err"; status.textContent = "Installing packages needs “Package managers” switched on."; return; }
    const params = {name:name.value.trim(), description:desc.value.trim()||null, config:{type:"cloud", networking, packages}};
    status.className = "msg"; status.textContent = "Saving…";
    try{ const r = isNew ? await C().beta.environments.create(params) : await C().beta.environments.update(e.id, params); toast(isNew ? "Environment created" : "Saved — new sandboxes use it from now on"); go(`environments/${r.id}`); }
    catch(err){ status.className = "err"; status.textContent = errText(err); }
  };
  body.append(h("div",{class:"wrapW"}, h("div",{class:"form"},
    h("label",{},"Name"), name, h("label",{},"Description"), desc,
    h("h3",{},"Network"),
    h("label",{},"Internet access", h("small",{},"Limited blocks everything you don’t list — also for web search and fetch")), h("div",{style:"display:grid;gap:12px"}, netSeg, limBox,
      h("p",{class:"hint", style:"margin:0"},"With limited access, an agent’s web search and page reading only reach the sites listed here, and a session fails to start if the agent’s web tools are limited to a site that isn’t listed.")),
    h("h3",{},"Pre-installed packages"),
    ...pkgIns.flatMap(p=>[h("label",{}, p.l), p.el]),
    h("label",{}), h("p",{class:"hint", style:"margin:0"},"Comma-separated. Use each manager’s own version syntax; no version means the latest.")),
    e?.archived_at ? "" : h("div",{class:"saveBar"}, status, h("span",{class:"sp"}), isNew ? h("button",{class:"btn", onclick:()=>go("environments")},"Cancel") : h("span",{class:"hint"},"Changes apply to new sandboxes only"),
      h("button",{class:"btn primary", onclick:save}, icon("check"), isNew ? "Create environment" : "Save"))));
}

/* ================= vaults ================= */
async function viewVaults(){
  const body = shell({title:"Vaults", sub:"Credentials your agents use for MCP servers and APIs. Secrets can be set and replaced, never read back.",
    actions:[h("button",{class:"btn primary", onclick:newVault}, icon("plus"), "New vault")]});
  simpleList(body, {
    load:(arch)=> listAll(C().beta.vaults.list({limit:100, include_archived:arch}), 500),
    card:(v)=> h("div",{class:"card"+(v.archived_at?" archived":""), onclick:()=>go(`vaults/${v.id}`)}, h("div",{class:"av soft"}, icon("lock")),
      h("div",{class:"main"}, h("div",{class:"t"}, v.display_name), h("div",{class:"s"}, v.id)),
      h("div",{class:"chips hideSm"}, v.archived_at ? chip("Archived","ghost") : ""), h("div",{class:"when"}, ago(v.updated_at))),
    empty:["lock","No vaults yet","A vault holds logins for the MCP servers and APIs your agents use. You pick which vaults a session gets when it starts.", newVault, "New vault"],
    what:"Vaults"});
}
async function newVault(){
  const n = field({placeholder:"e.g. Team GitHub"}); const err = h("span",{class:"err"});
  const bg = modal(h("div",{class:"modal sm"}, h("h2",{},"New vault"), h("p",{class:"lead"},"Give it a name. You’ll add credentials next."), n,
    h("div",{class:"actions"}, err, h("span",{class:"sp"}), h("button",{class:"btn", onclick:()=>bg.remove()},"Cancel"), h("button",{class:"btn primary", onclick:async()=>{
      if(!n.value.trim()){ err.textContent = "Name it first."; return; }
      const v = await api(c=>c.beta.vaults.create({display_name:n.value.trim()}), "Vault"); if(v){ bg.remove(); go(`vaults/${v.id}`); } }}, "Create"))));
  n.onkeydown = (e)=>{ if(e.key==="Enter") bg.querySelector(".btn.primary").click(); };
  setTimeout(()=>n.focus());
}
const credLabel = (c)=> c.auth?.type==="mcp_oauth" ? "MCP · OAuth" : c.auth?.type==="static_bearer" ? "MCP · token" : c.auth?.type==="environment_variable" ? "Secret variable" : c.auth?.type;
const credTarget = (c)=> c.auth?.mcp_server_url || (c.auth?.secret_name ? `$${c.auth.secret_name}` : "");
async function viewVault(id){
  const v = await api(c=>c.beta.vaults.retrieve(id), "Vault");
  if(!v){ shell({crumb:[["Vaults","vaults"]], title:"Not found"}); return; }
  const more = h("button",{class:"iconBtn", title:"More"}, icon("menu"));
  more.onclick = ()=> popMenu(more, [{label:"Rename", value:"rename", icon:"pen"}, {label:"Copy ID", value:"id", icon:"copy"},
    ...(v.archived_at ? [] : [{label:"Archive…", value:"archive", icon:"archive", danger:true}]), {label:"Delete…", value:"delete", icon:"trash", danger:true}], async x=>{
    if(x==="id") copyText(v.id);
    if(x==="rename"){ const n = field({value:v.display_name}); const bg = modal(h("div",{class:"modal sm"}, h("h2",{},"Rename vault"), n, h("div",{class:"actions"}, h("button",{class:"btn", onclick:()=>bg.remove()},"Cancel"), h("button",{class:"btn primary", onclick:async()=>{ if(await api(c=>c.beta.vaults.update(v.id,{display_name:n.value.trim()}),"Rename")){ bg.remove(); route(); } }},"Save")))); }
    if(x==="archive" && await typedConfirm("Archive this vault?","Archiving is permanent, and its secrets are purged. Sessions and schedules that use it will stop being able to authenticate.", v.display_name, "Archive forever")){ if(await api(c=>c.beta.vaults.archive(v.id),"Archive")){ toast("Archived"); route(); } }
    if(x==="delete" && await typedConfirm("Delete this vault?","The vault and every credential in it are removed for good.", v.display_name, "Delete forever")){ if(await api(c=>c.beta.vaults.delete(v.id),"Delete")){ toast("Deleted"); go("vaults"); } }
  });
  const body = shell({crumb:[["Vaults","vaults"]], title:v.display_name, sub:[idTag(v.id), v.archived_at ? chip("Archived","bad") : "", h("span",{}, "created "+ago(v.created_at))],
    actions:[v.archived_at ? "" : h("button",{class:"btn primary", onclick:()=>credentialDialog(v)}, icon("plus"), "Add credential"), more]});
  const listEl = h("div",{class:"list"}, h("div",{class:"hint"},"Loading…"));
  body.append(h("div",{class:"wrapW"}, h("div",{class:"note", style:"margin-bottom:14px"}, icon("shield"), "Secrets are write-only: once saved, nobody — including Page Orbit — can read them back. They’re only used inside Anthropic’s sandbox when an agent calls the matching server."), listEl));
  const creds = await api(c=>listAll(c.beta.vaults.credentials.list(v.id, {limit:100}), 200), "Credentials");
  if(!creds) return;
  listEl.replaceChildren(...(creds.length ? creds.map(c=>h("div",{class:"card static"+(c.archived_at?" archived":"")}, h("div",{class:"av soft"}, icon(c.auth?.type==="environment_variable" ? "terminal" : "plug")),
    h("div",{class:"main"}, h("div",{class:"t"}, c.display_name || credTarget(c)), h("div",{class:"s"}, `${credLabel(c)} · ${credTarget(c)}${c.auth?.expires_at ? " · expires "+when(c.auth.expires_at) : ""}`)),
    h("div",{class:"chips"}, chip("secret set","ok","lock"), c.archived_at ? chip("Archived","ghost") : ""),
    c.archived_at ? "" : h("div",{class:"row", style:"flex-wrap:nowrap"},
      c.auth?.type==="mcp_oauth" ? h("button",{class:"btn sm", onclick:(e)=>testCred(v, c, e.currentTarget)}, icon("pulse"), "Test") : "",
      h("button",{class:"btn sm", onclick:()=>credentialDialog(v, c)}, icon("key"), "Replace secret"),
      h("button",{class:"iconBtn sm", title:"Delete", onclick:async()=>{ if(!await confirmDialog("Delete this credential?","Agents lose access to this server or secret straight away.","Delete")) return; if(await api(x=>x.beta.vaults.credentials.delete(c.id,{vault_id:v.id}),"Delete")){ toast("Deleted"); route(); } }}, icon("trash")))))
    : [h("div",{class:"empty"}, h("div",{class:"ic"}, icon("key")), h("b",{},"No credentials yet"), h("p",{},"Add a token for an MCP server your agent uses, or a secret environment variable for an API."), v.archived_at ? "" : h("button",{class:"btn primary", onclick:()=>credentialDialog(v)}, icon("plus"), "Add credential"))]));
}
async function testCred(v, c, btn){
  btn.disabled = true; const r = await api(x=>x.beta.vaults.credentials.mcpOAuthValidate(c.id, {vault_id:v.id}), "Test"); btn.disabled = false;
  if(!r) return;
  const ok = r.status==="valid";
  modal(h("div",{class:"modal sm"}, h("h2",{}, ok ? "Credential works" : r.status==="invalid" ? "Credential rejected" : "Couldn’t tell"),
    h("p",{class:"lead"}, ok ? "The MCP server accepted it." : r.refresh?.status==="failed" ? "The token was refused and refreshing it failed. Replace the secret." : "See the details below."),
    jsonView({status:r.status, has_refresh_token:r.has_refresh_token, refresh:r.refresh?.status, server_status:r.mcp_probe?.http_response?.status_code, validated_at:r.validated_at})));
}
function credentialDialog(v, existing){
  const replacing = !!existing;
  let type = existing?.auth?.type || "static_bearer";
  const label = field({placeholder:"Label (optional)", value:existing?.display_name||""});
  const url = field({class:"field mono", placeholder:"https://mcp.example.com/mcp — must match the agent’s MCP server URL", value:existing?.auth?.mcp_server_url||"", disabled:replacing});
  const secret = field({type:"password", class:"field mono", autocomplete:"new-password", placeholder: replacing ? "New value" : "Token"});
  const refresh = field({type:"password", class:"field mono", autocomplete:"new-password", placeholder:"Refresh token (optional — lets Anthropic renew it)"});
  const clientId = field({class:"field mono", placeholder:"OAuth client ID", value:existing?.auth?.refresh?.client_id||"", disabled:replacing});
  const tokenUrl = field({class:"field mono", placeholder:"Token endpoint, https://…", value:existing?.auth?.refresh?.token_endpoint||"", disabled:replacing});
  const clientSecret = field({type:"password", class:"field mono", autocomplete:"new-password", placeholder:"Client secret (only if the server needs one)"});
  const expires = field({type:"datetime-local"});
  const secName = field({class:"field mono", placeholder:"API_KEY", value:existing?.auth?.secret_name||"", disabled:replacing});
  const secHosts = field({class:"field mono", placeholder:"api.example.com (hosts it may be sent to)", value:(existing?.auth?.networking?.allowed_hosts||[]).join(", ")});
  const err = h("span",{class:"err"});
  const area_ = h("div",{class:"form", style:"grid-template-columns:150px minmax(0,1fr)"});
  const draw = ()=>{
    area_.replaceChildren(h("label",{},"Label"), label);
    if(type==="static_bearer") area_.append(h("label",{},"MCP server URL"), url, h("label",{},"Bearer token"), secret);
    if(type==="mcp_oauth") area_.append(h("label",{},"MCP server URL"), url, h("label",{},"Access token"), secret, h("label",{},"Expires"), expires,
      h("label",{},"Refresh", h("small",{},"Optional")), h("div",{style:"display:grid;gap:8px"}, refresh, clientId, tokenUrl, clientSecret));
    if(type==="environment_variable") area_.append(h("label",{},"Variable name"), secName, h("label",{},"Value"), secret, h("label",{},"Only send to", h("small",{},"Leave empty to allow any host")), secHosts,
      h("label",{}), h("p",{class:"hint", style:"margin:0"},"The sandbox only ever sees a placeholder; the real value is swapped in on the way out, in headers and request bodies."));
  };
  const typeSeg = seg([{value:"static_bearer", label:"MCP token"}, {value:"mcp_oauth", label:"MCP OAuth"}, {value:"environment_variable", label:"Secret variable"}], type, x=>{ type = x; draw(); }, "seg");
  draw();
  const save = h("button",{class:"btn primary"}, icon("lock"), replacing ? "Replace secret" : "Save credential");
  save.onclick = async()=>{
    err.textContent = "";
    if(!secret.value && !(replacing && type==="environment_variable")){ err.textContent = "Enter the secret."; return; }
    let auth;
    if(type==="static_bearer") auth = replacing ? {type, token:secret.value} : {type, mcp_server_url:url.value.trim(), token:secret.value};
    if(type==="mcp_oauth"){
      auth = replacing ? {type, access_token:secret.value} : {type, mcp_server_url:url.value.trim(), access_token:secret.value};
      if(expires.value) auth.expires_at = new Date(expires.value).toISOString();
      if(refresh.value){
        auth.refresh = replacing ? {refresh_token:refresh.value} : {refresh_token:refresh.value, client_id:clientId.value.trim(), token_endpoint:tokenUrl.value.trim(),
          token_endpoint_auth: clientSecret.value ? {type:"client_secret_post", client_secret:clientSecret.value} : {type:"none"}};
        if(replacing && clientSecret.value) auth.refresh.token_endpoint_auth = {type:"client_secret_post", client_secret:clientSecret.value};
      }
    }
    if(type==="environment_variable"){
      const hs = secHosts.value.split(/[\s,]+/).filter(Boolean);
      auth = replacing ? {type, networking: hs.length ? {type:"limited", allowed_hosts:hs} : {type:"unrestricted"}} : {type, secret_name:secName.value.trim(), secret_value:secret.value, networking: hs.length ? {type:"limited", allowed_hosts:hs} : {type:"unrestricted"}};
      if(replacing && secret.value) auth.secret_value = secret.value;
      if(!replacing && !/^[A-Za-z_][A-Za-z0-9_]*$/.test(auth.secret_name)){ err.textContent = "Variable names use letters, numbers and _."; return; }
    }
    if(!replacing && type!=="environment_variable" && !/^https:\/\//.test(url.value.trim())){ err.textContent = "The MCP server URL must start with https://"; return; }
    save.disabled = true;
    try{
      const params = {auth}; if(label.value.trim()) params.display_name = label.value.trim();
      if(replacing) await C().beta.vaults.credentials.update(existing.id, {vault_id:v.id, ...params});
      else await C().beta.vaults.credentials.create(v.id, params);
      secret.value = refresh.value = clientSecret.value = "";           // don't keep secrets around
      bg.remove(); toast(replacing ? "Secret replaced" : "Credential saved"); route();
    }catch(e){ save.disabled = false; err.textContent = errText(e); }
  };
  const bg = modal(h("div",{class:"modal wide"}, h("h2",{}, replacing ? "Replace secret" : "Add credential"),
    h("p",{class:"lead"}, "Sent once, straight to Anthropic, over an encrypted connection. Page Orbit doesn’t store it."),
    replacing ? "" : h("div",{style:"margin-bottom:16px"}, typeSeg), area_,
    h("div",{class:"actions"}, err, h("span",{class:"sp"}), h("button",{class:"btn", onclick:()=>{ secret.value = ""; bg.remove(); }},"Cancel"), save)),
    ()=>{ secret.value = refresh.value = clientSecret.value = ""; });
  setTimeout(()=> (replacing ? secret : url).focus());
}

/* ================= schedules (deployments) ================= */
const CRON_PRESETS = [["0 9 * * 1-5","Weekdays at 9:00"],["0 9 * * *","Every day at 9:00"],["0 * * * *","Every hour"],["0 9 * * 1","Mondays at 9:00"],["0 9 1 * *","1st of the month at 9:00"],["","Custom…"]];
const cronText = (s)=> !s ? "On demand only" : (CRON_PRESETS.find(p=>p[0]===s.expression)?.[1] || s.expression) + ` · ${s.timezone}`;
async function viewSchedules(){
  const body = shell({title:"Schedules", sub:"Run an agent on a timetable, or on demand, with a fixed first message.",
    actions:[h("button",{class:"btn primary", onclick:()=>go("schedules/new")}, icon("plus"), "New schedule")]});
  deploymentsInto(body, {});
}
function deploymentCard(d){
  return h("div",{class:"card"+(d.archived_at?" archived":""), onclick:()=>go(`schedules/${d.id}`)}, h("div",{class:"av soft"}, icon("clock")),
    h("div",{class:"main"}, h("div",{class:"t"}, d.name), h("div",{class:"s"}, cronText(d.schedule) + (d.schedule?.upcoming_runs_at?.[0] ? ` · next ${when(d.schedule.upcoming_runs_at[0])}` : ""))),
    h("div",{class:"chips hideSm"}, d.archived_at ? chip("Archived","ghost") : statusChip(d.status), d.paused_reason?.type==="error" ? chip(d.paused_reason.error?.type?.replace(/_/g," ")||"error","bad") : ""),
    h("div",{class:"when"}, d.schedule?.last_run_at ? "ran "+ago(d.schedule.last_run_at) : "never run"));
}
function deploymentsInto(body, filter, agent){
  simpleList(body, {
    load:(arch)=> listAll(C().beta.deployments.list({limit:100, ...filter, ...(arch ? {include_archived:true} : {})}), 500),
    card:deploymentCard,
    empty:["clock","No schedules yet","A schedule starts a session for an agent at set times — say, a daily report at 9am — or whenever you click Run now.", ()=>go("schedules/new"+(agent?`?agent=${agent.id}`:"")), "New schedule"],
    what:"Schedules"});
}
async function viewSchedule(id, tab="settings"){
  const isNew = id==="new";
  let d = null;
  if(!isNew){ d = await api(c=>c.beta.deployments.retrieve(id), "Schedule"); if(!d){ shell({crumb:[["Schedules","schedules"]], title:"Not found"}); return; } }
  const actions = [];
  if(d && !d.archived_at){
    actions.push(h("button",{class:"btn", onclick:async()=>{ const r = await api(c=>c.beta.deployments.run(d.id), "Run"); if(r){ if(r.session_id){ toast("Started"); go(`sessions/${r.session_id}`); } else toast("Couldn’t start: "+(r.error?.message||r.error?.type), 6000); } }}, icon("play"), "Run now"));
    actions.push(h("button",{class:"btn", onclick:async()=>{ const r = await api(c=> d.status==="paused" ? c.beta.deployments.unpause(d.id) : c.beta.deployments.pause(d.id), "Schedule"); if(r){ toast(r.status==="paused" ? "Paused" : "Resumed — next run at the next scheduled time"); route(); } }}, icon(d.status==="paused" ? "play" : "pause"), d.status==="paused" ? "Resume" : "Pause"));
    const more = h("button",{class:"iconBtn", title:"More"}, icon("menu"));
    more.onclick = ()=> popMenu(more, [{label:"Copy ID", value:"id", icon:"copy"}, {label:"Archive…", sub:"Stops it for good", value:"archive", icon:"archive", danger:true}], async v=>{
      if(v==="id") copyText(d.id);
      if(v==="archive" && await typedConfirm("Archive this schedule?","It stops running for good and can’t be edited. Its past runs and sessions stay.", d.name, "Archive forever")){ if(await api(c=>c.beta.deployments.archive(d.id),"Archive")){ toast("Archived"); route(); } }
    });
    actions.push(more);
  }
  const body = shell({crumb:[["Schedules","schedules"]], title: isNew ? "New schedule" : d.name,
    sub: isNew ? "Runs an agent on a timetable" : [idTag(d.id), d.archived_at ? chip("Archived","bad") : statusChip(d.status), h("span",{}, cronText(d.schedule))],
    actions, tabs: isNew ? null : [{id:"settings", label:"Settings"}, {id:"runs", label:"Runs"}, {id:"sessions", label:"Sessions"}], tab, tabBase:`schedules/${id}`});
  if(d?.paused_reason?.type==="error") body.append(h("div",{class:"note bad wrapW", style:"margin-bottom:14px"}, icon("alert"), h("div",{}, h("b",{},"Paused because of an error: "), d.paused_reason.error?.type?.replace(/_/g," "), ". Fix it (for example, pick a different environment or vault), save, then Resume.")));
  if(tab==="runs") return scheduleRuns(d, body);
  if(tab==="sessions") return sessionsInto(body, {deployment_id:d.id});
  const [agents, envs, vaults] = await Promise.all([agentList(true).catch(()=>[]), listAll(C().beta.environments.list({limit:100}),200).catch(()=>[]), listAll(C().beta.vaults.list({limit:100}),200).catch(()=>[])]);
  const qAgent = new URLSearchParams(location.hash.split("?")[1]||"").get("agent");
  const liveAgents = agents.filter(a=>!a.archived_at);
  const name = field({value:d?.name||"", placeholder:"e.g. Morning inbox summary"});
  const desc = field({value:d?.description||"", placeholder:"Optional"});
  const agentSel = select(liveAgents.map(a=>({value:a.id, label:`${a.name}  ·  v${a.version}`})), d?.agent?.id || qAgent || liveAgents[0]?.id);
  const pin = h("input",{type:"checkbox", checked: false});
  const envSel = select(envs.filter(e=>!e.archived_at).map(e=>({value:e.id, label:e.name})), d?.environment_id);
  const tz = Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";
  const expr0 = d ? (d.schedule?.expression ?? null) : "0 9 * * 1-5";
  let mode = expr0==null ? "manual" : "cron";
  const preset = select(CRON_PRESETS.map(([v,l])=>({value:v, label:l})), CRON_PRESETS.some(p=>p[0]===expr0) ? expr0 : "");
  const cron = field({class:"field mono", value:expr0||"", placeholder:"min hour day month weekday — e.g. 30 8 * * 1-5"});
  const tzIn = field({value:d?.schedule?.timezone || tz, placeholder:"Europe/London", class:"field mono"});
  preset.onchange = ()=>{ if(preset.value) cron.value = preset.value; else cron.focus(); };
  cron.oninput = ()=>{ preset.value = CRON_PRESETS.some(p=>p[0]===cron.value.trim()) ? cron.value.trim() : ""; };
  const cronBox = h("div",{style:"display:grid;gap:8px"}, h("div",{class:"inline"}, preset, cron), h("div",{class:"inline"}, h("span",{class:"hint"},"Time zone"), tzIn));
  const modeSeg = seg([{value:"cron", label:"On a schedule"}, {value:"manual", label:"Only when I click Run now"}], mode, v=>{ mode = v; cronBox.style.display = v==="cron" ? "grid" : "none"; });
  cronBox.style.display = mode==="cron" ? "grid" : "none";
  const firstEv = (d?.initial_events||[]).find(e=>e.type==="user.message"), outEv = (d?.initial_events||[]).find(e=>e.type==="user.define_outcome");
  const msg = area({rows:5, placeholder:"What the agent should do each time, e.g. “Summarise yesterday’s new GitHub issues and post the summary to #triage.”", value: firstEv ? blocksText(firstEv.content) : ""});
  const goal = area({rows:2, placeholder:"Optional: a goal a grader checks the work against", value: outEv?.description || ""});
  const rubric = area({rows:4, placeholder:"Rubric — one check per line", value: outEv?.rubric?.content || ""});
  const vChecks = vaults.filter(v=>!v.archived_at).map(v=>({id:v.id, name:v.display_name, el:h("input",{type:"checkbox", checked:(d?.vault_ids||[]).includes(v.id)})}));
  const cap = field({type:"number", min:0.5, step:0.5, placeholder:"No cap", style:"max-width:140px", value: d?.budget ? (Number(d.budget.max_list_cost?.amount)/100) : ""});
  const status = h("span",{class:"msg"});
  const warn = h("div",{});
  const checkAsk = ()=>{ const a = liveAgents.find(x=>x.id===agentSel.value); const asks = a && (a.tools||[]).some(t=> t.type===TOOLSET ? SANDBOX_TOOLS.some(s=>toolEnabled(t,s.name) && toolPerm(t,s.name)!=="always_allow") : t.type==="mcp_toolset" ? (t.default_config?.permission_policy?.type||"always_ask")!=="always_allow" : t.type==="custom");
    warn.replaceChildren(asks ? h("div",{class:"note warn"}, icon("alert"), "This agent has tools set to Ask, Auto, or custom tools. Nobody is watching a scheduled run, so it will wait forever at the first approval. Open the session to answer, or set those tools to Allow for scheduled use.") : ""); };
  agentSel.onchange = checkAsk; checkAsk();
  const save = async()=>{
    status.className = "err";
    if(!name.value.trim()) return status.textContent = "Give it a name.";
    if(!agentSel.value || !envSel.value) return status.textContent = "Choose an agent and an environment.";
    if(!msg.value.trim()) return status.textContent = "Write the message it starts with.";
    if(mode==="cron" && cron.value.trim().split(/\s+/).length!==5) return status.textContent = "A schedule needs five parts: minute hour day month weekday.";
    if(goal.value.trim() && !rubric.value.trim()) return status.textContent = "An outcome needs a rubric too.";
    const a = liveAgents.find(x=>x.id===agentSel.value);
    const ie = [{type:"user.message", content:[{type:"text", text:msg.value.trim()}]}];
    if(goal.value.trim()) ie.push({type:"user.define_outcome", description:goal.value.trim(), rubric:{type:"text", content:rubric.value.trim()}});
    const params = {name:name.value.trim(), description:desc.value.trim()||null, agent: pin.checked ? {type:"agent", id:a.id, version:a.version} : a.id, environment_id:envSel.value,
      initial_events:ie, schedule: mode==="cron" ? {type:"cron", expression:cron.value.trim(), timezone:tzIn.value.trim()||"UTC"} : null,
      vault_ids: vChecks.filter(v=>v.el.checked).map(v=>v.id)};
    const c = parseFloat(cap.value); params.budget = c > 0 ? {type:"limit", max_list_cost:{amount:String(Math.round(c*100)), currency:"USD"}} : null;
    if(isNew && !params.budget) delete params.budget;
    status.className = "msg"; status.textContent = "Saving…";
    try{ const r = isNew ? await C().beta.deployments.create(params) : await C().beta.deployments.update(d.id, params); toast(isNew ? "Schedule created" : "Saved"); go(`schedules/${r.id}`); }
    catch(e){ status.className = "err"; status.textContent = errText(e); }
  };
  body.append(h("div",{class:"wrapW"}, h("div",{class:"form"},
    h("label",{},"Name"), name, h("label",{},"Description"), desc,
    h("h3",{},"What runs"),
    h("label",{},"Agent"), h("div",{style:"display:grid;gap:8px"}, agentSel, h("label",{class:"check hint"}, pin, "Pin to this version (otherwise each run uses the version current when you save)"), warn),
    h("label",{},"Environment"), envSel,
    h("label",{},"First message"), msg,
    h("label",{},"Outcome", h("small",{},"Optional")), h("div",{style:"display:grid;gap:8px"}, goal, rubric),
    h("h3",{},"When"),
    h("label",{},"Timing"), h("div",{style:"display:grid;gap:10px"}, modeSeg, cronBox, h("p",{class:"hint", style:"margin:0"},"Times are in the time zone you set. Runs can start up to a few minutes late. Paused schedules don’t catch up on missed runs.")),
    h("h3",{},"Limits and access"),
    h("label",{},"Spending cap", h("small",{},"Per run")), h("div",{class:"inline"}, h("span",{},"$"), cap),
    vChecks.length ? [h("label",{},"Vaults"), h("div",{style:"padding-top:8px"}, vChecks.map(v=>h("label",{class:"check", style:"margin-right:14px"}, v.el, v.name)))] : ""),
    d?.archived_at ? "" : h("div",{class:"saveBar"}, status, h("span",{class:"sp"}), isNew ? h("button",{class:"btn", onclick:()=>go("schedules")},"Cancel") : "",
      h("button",{class:"btn primary", onclick:save}, icon("check"), isNew ? "Create schedule" : "Save"))));
}
async function scheduleRuns(d, body){
  const listEl = h("div",{class:"list"}, h("div",{class:"hint"},"Loading…"));
  body.append(h("div",{class:"wrapW"}, d.schedule?.upcoming_runs_at?.length ? h("p",{class:"hint", style:"margin-top:0"}, "Next: ", d.schedule.upcoming_runs_at.map(when).join(" · ")) : "", listEl));
  const runs = await api(c=>listAll(c.beta.deploymentRuns.list({deployment_id:d.id, limit:100}), 300), "Runs");
  if(!runs) return;
  listEl.replaceChildren(...(runs.length ? runs.map(r=>h("div",{class:"card"+(r.session_id?"":" static"), onclick:()=>{ if(r.session_id) go(`sessions/${r.session_id}`); }},
    h("div",{class:"av soft"}, icon(r.error ? "alert" : r.trigger_context?.type==="manual" ? "play" : "clock")),
    h("div",{class:"main"}, h("div",{class:"t"}, r.trigger_context?.type==="manual" ? "Run now" : "Scheduled run"), h("div",{class:"s"}, r.error ? `${r.error.type}: ${r.error.message||""}` : r.session_id)),
    h("div",{class:"chips"}, r.error ? chip("Failed","bad") : chip("Started","ok"), chip("v"+r.agent?.version,"mono")),
    h("div",{class:"when"}, ago(r.created_at)))) : [h("div",{class:"empty"}, h("b",{},"No runs yet"), h("p",{},"Runs appear here when the schedule fires or you click Run now."))]));
}

/* ================= memory stores ================= */
async function viewMemory(){
  const body = shell({title:"Memory", sub:"Notes agents keep between sessions. Mounted in the sandbox at /mnt/memory/.",
    actions:[h("button",{class:"btn primary", onclick:()=>storeDialog()}, icon("plus"), "New memory store")]});
  simpleList(body, {
    load:(arch)=> listAll(C().beta.memoryStores.list({limit:100, include_archived:arch}), 500),
    card:(s)=> h("div",{class:"card"+(s.archived_at?" archived":""), onclick:()=>go(`memory/${s.id}`)}, h("div",{class:"av soft"}, icon("db")),
      h("div",{class:"main"}, h("div",{class:"t"}, s.name), h("div",{class:"s"}, s.description || s.id)),
      h("div",{class:"chips hideSm"}, chip("/mnt/memory/"+memSlug(s.name),"mono"), s.archived_at ? chip("Archived","ghost") : ""), h("div",{class:"when"}, ago(s.updated_at))),
    empty:["db","No memory stores yet","A memory store is a folder of notes an agent can read and update across sessions — preferences, decisions, what it learned. Attach it when you start a session.", ()=>storeDialog(), "New memory store"],
    what:"Memory"});
}
const memSlug = (n)=> String(n||"").toLowerCase().replace(/[^a-z0-9]+/g,"-").replace(/^-|-$/g,"");
function storeDialog(s){
  const n = field({value:s?.name||"", placeholder:"e.g. support-playbook"});
  const d = area({rows:3, value:s?.description||"", placeholder:"What’s in it and how to use it — the agent sees this."});
  const err = h("span",{class:"err"});
  const bg = modal(h("div",{class:"modal"}, h("h2",{}, s ? "Edit memory store" : "New memory store"),
    h("label",{class:"f"},"Name"), n, h("label",{class:"f"},"Description"), d,
    s ? h("p",{class:"hint"},"Renaming changes the folder name for sessions started later.") : "",
    h("div",{class:"actions"}, err, h("span",{class:"sp"}), h("button",{class:"btn", onclick:()=>bg.remove()},"Cancel"), h("button",{class:"btn primary", onclick:async()=>{
      if(!n.value.trim()){ err.textContent = "Name it first."; return; }
      const params = {name:n.value.trim(), description:d.value.trim()};
      const r = await api(c=> s ? c.beta.memoryStores.update(s.id, params) : c.beta.memoryStores.create(params), "Memory store");
      if(r){ bg.remove(); s ? route() : go(`memory/${r.id}`); } }}, "Save"))));
  setTimeout(()=>n.focus());
}
async function viewStore(id, tab="memories"){
  const s = await api(c=>c.beta.memoryStores.retrieve(id), "Memory store");
  if(!s){ shell({crumb:[["Memory","memory"]], title:"Not found"}); return; }
  const more = h("button",{class:"iconBtn", title:"More"}, icon("menu"));
  more.onclick = ()=> popMenu(more, [{label:"Edit name & description", value:"edit", icon:"pen"}, {label:"Copy ID", value:"id", icon:"copy"},
    {label:"Export all (JSON)", value:"export", icon:"download"},
    ...(s.archived_at ? [] : [{label:"Archive…", value:"archive", icon:"archive", danger:true}]), {label:"Delete…", sub:"Every memory and version", value:"delete", icon:"trash", danger:true}], async v=>{
    if(v==="edit") storeDialog(s);
    if(v==="id") copyText(s.id);
    if(v==="export"){ const all = []; for(const m of items){ const full = await C().beta.memoryStores.memories.retrieve(m.id, {memory_store_id:s.id}).catch(()=>null); if(full) all.push({path:full.path, content:full.content}); } saveBlob(new Blob([JSON.stringify({store:s, memories:all}, null, 2)], {type:"application/json"}), `${memSlug(s.name)||s.id}.json`); }
    if(v==="archive" && await typedConfirm("Archive this memory store?","Archiving is permanent. It becomes read-only and new sessions can’t attach it.", s.name, "Archive forever")){ if(await api(c=>c.beta.memoryStores.archive(s.id),"Archive")){ toast("Archived"); route(); } }
    if(v==="delete" && await typedConfirm("Delete this memory store?","Every memory in it, and every past version, is removed for good.", s.name, "Delete forever")){ if(await api(c=>c.beta.memoryStores.delete(s.id),"Delete")){ toast("Deleted"); go("memory"); } }
  });
  const body = shell({crumb:[["Memory","memory"]], title:s.name, sub:[idTag(s.id), chip("/mnt/memory/"+memSlug(s.name),"mono"), s.archived_at ? chip("Archived","bad") : ""],
    actions:[tab==="memories" && !s.archived_at ? h("button",{class:"btn primary", onclick:()=>openMem(null)}, icon("plus"), "New memory") : "",
      tab==="dreams" ? h("button",{class:"btn primary", onclick:()=>dreamDialog(s)}, icon("mark"), "Start a dream") : "", more],
    tabs:[{id:"memories", label:"Memories"}, {id:"sessions", label:"Sessions that used it"}, {id:"dreams", label:"Dreams"}], tab, tabBase:`memory/${s.id}`});
  if(tab==="sessions") return sessionsInto(body, {memory_store_id:s.id});
  if(tab==="dreams") return dreamsInto(body, s);
  const tree = h("div",{class:"memTree"}, h("div",{class:"hint", style:"padding:8px"},"Loading…"));
  const pane = h("div",{});
  body.append(h("div",{class:"wrapW"}, s.description ? h("p",{class:"hint", style:"margin-top:0"}, s.description) : "", h("div",{class:"memGrid"}, tree, pane)));
  let items = [], sel = null;
  const loadTree = async()=>{
    const r = await api(c=>listAll(c.beta.memoryStores.memories.list(s.id, {limit:100}), 2000), "Memories");
    if(!r) return;
    items = r.filter(m=>m.type==="memory").sort((a,b)=>a.path.localeCompare(b.path));
    drawTree();
  };
  const drawTree = ()=> tree.replaceChildren(...(items.length ? items.map(m=>h("div",{class:"memItem"+(sel===m.id?" on":""), onclick:()=>openMem(m)}, icon("file"), h("span",{}, m.path), h("small",{}, kb(m.content_size_bytes))))
    : [h("div",{class:"hint", style:"padding:8px"},"Empty. Agents add memories as they work, or add one yourself.")]));
  const kb = (n)=> n==null ? "" : n < 1024 ? n+"B" : (n/1024).toFixed(1)+"K";
  async function openMem(m){
    sel = m?.id || null; drawTree();
    const full = m ? await api(c=>c.beta.memoryStores.memories.retrieve(m.id, {memory_store_id:s.id}), "Memory") : {path:"/", content:""};
    if(!full) return;
    const path = field({class:"field mono", value:full.path});
    const ta = area({rows:18, class:"field code"}); ta.value = full.content || "";
    const status = h("span",{class:"msg"});
    const hist = h("div",{});
    const saveBtn = h("button",{class:"btn primary", onclick:async()=>{
      if(!/^\/.+/.test(path.value.trim())){ status.className = "err"; status.textContent = "Paths start with / — e.g. /notes/customers.md"; return; }
      status.className = "msg"; status.textContent = "Saving…";
      try{
        let r;
        if(!m) r = await C().beta.memoryStores.memories.create(s.id, {path:path.value.trim(), content:ta.value}, NO_RETRY);
        else r = await C().beta.memoryStores.memories.update(m.id, {memory_store_id:s.id, content:ta.value, ...(path.value.trim()!==full.path ? {path:path.value.trim()} : {}), precondition:{type:"content_sha256", content_sha256:full.content_sha256}}, NO_RETRY);
        toast("Saved"); await loadTree(); openMem(items.find(x=>x.id===r.id) || r);
      }catch(e){ status.className = "err"; status.textContent = e.status===409 ? (e.error?.error?.type==="memory_precondition_failed_error" ? "It changed since you opened it (an agent may have written to it). Reopen it to see the latest." : "Another memory already uses that path (or a folder above/below it).") : errText(e); }
    }}, icon("check"), m ? "Save" : "Create");
    pane.replaceChildren(h("div",{class:"box"},
      h("div",{class:"boxHead"}, path, m ? h("span",{class:"hint", style:"white-space:nowrap"}, "updated "+ago(full.updated_at)) : ""),
      ta,
      h("div",{class:"row", style:"margin-top:10px"}, status, h("span",{class:"sp"}),
        m ? h("button",{class:"btn ghost", style:"color:var(--danger)", onclick:async()=>{ if(!await confirmDialog("Delete this memory?","It’s removed from the store. Its past versions stay in the history.","Delete")) return; if(await api(c=>c.beta.memoryStores.memories.delete(m.id,{memory_store_id:s.id, expected_content_sha256:full.content_sha256}),"Delete")){ toast("Deleted"); sel = null; pane.replaceChildren(); loadTree(); } }}, icon("trash"), "Delete") : "",
        s.archived_at ? "" : saveBtn)),
      h("p",{class:"hint"},"Never put passwords or keys in memory — agents and anyone with access to the store can read it."),
      hist);
    if(!m) { setTimeout(()=>path.focus()); return; }
    hist.append(h("div",{class:"hint"},"Loading history…"));
    const vers = await api(c=>listAll(c.beta.memoryStores.memoryVersions.list(s.id, {memory_id:m.id, limit:100}), 200), "History");
    if(!vers) return;
    const actor = (c)=> !c ? "" : c.type==="session_actor" ? h("a",{href:`#/sessions/${c.session_id}`, style:"color:var(--accent)"}, "a session") : c.type==="api_actor" ? "the API" : c.type==="user_actor" ? "a person" : "a service account";
    hist.replaceChildren(h("h4",{class:"hint", style:"margin:16px 0 6px;text-transform:uppercase;letter-spacing:.06em;font-size:11px"}, `History (${vers.length})`),
      h("div",{class:"list"}, vers.map(v=>h("div",{class:"card", style:"padding:9px 12px", onclick:async()=>{
        if(v.redacted_at) return toast("This version was redacted");
        const full2 = await api(c=>c.beta.memoryStores.memoryVersions.retrieve(v.id, {memory_store_id:s.id}), "Version"); if(!full2) return;
        const bg = modal(h("div",{class:"modal wide"}, h("h2",{}, `${v.operation} · ${when(v.created_at)}`), h("p",{class:"lead"}, full2.path || ""),
          full2.operation==="deleted" ? h("p",{},"(deleted)") : diffView(full2.content||"", ta.value),
          h("p",{class:"hint"},"Red: this version · Green: what’s in the editor now"),
          h("div",{class:"actions"},
            h("button",{class:"btn ghost", style:"color:var(--danger)", onclick:async()=>{ if(!await confirmDialog("Redact this version?","Its content is wiped for good (for example, if a secret ended up in it). Who changed it and when are kept.","Redact")) return; if(await api(c=>c.beta.memoryStores.memoryVersions.redact(v.id,{memory_store_id:s.id}),"Redact")){ bg.remove(); toast("Redacted"); openMem(m); } }}, "Redact"),
            h("span",{class:"sp"}),
            full2.content!=null ? h("button",{class:"btn", onclick:()=>{ ta.value = full2.content; bg.remove(); toast("Loaded into the editor — click Save to restore it"); }}, icon("history"), "Use this version") : "",
            h("button",{class:"btn", onclick:()=>bg.remove()},"Close")))); }},
        h("div",{class:"main"}, h("div",{class:"t", style:"font-size:13.5px"}, v.operation, " by ", actor(v.created_by)), h("div",{class:"s"}, when(v.created_at))),
        v.redacted_at ? chip("Redacted","ghost") : chip(kb(v.content_size_bytes),"mono")))));
  }
  loadTree();
}

/* ---------- shared list scaffold ---------- */
function simpleList(body, {load, card, empty, what}){
  let archived = false, q = "", items = [];
  const listEl = h("div",{class:"list"});
  const search = field({placeholder:"Search", type:"search"}); search.oninput = ()=>{ q = search.value.toLowerCase(); draw(); };
  const draw = ()=>{
    if(!items.length){ const [ic, t, p, fn, label] = empty; listEl.replaceChildren(h("div",{class:"empty"}, h("div",{class:"ic"}, icon(ic)), h("b",{},t), h("p",{},p), h("button",{class:"btn primary", onclick:fn}, icon("plus"), label))); return; }
    listEl.replaceChildren(...items.filter(x=>!q || JSON.stringify([x.name, x.display_name, x.description, x.id]).toLowerCase().includes(q)).map(card));
  };
  const reload = async()=>{
    listEl.replaceChildren(h("div",{class:"hint"},"Loading…"));
    const r = await api(()=>load(archived), what);
    if(!r){ listEl.replaceChildren(h("div",{class:"err"},`Couldn’t load ${what.toLowerCase()}.`)); return; }
    items = r.sort((a,b)=> toMs(b.updated_at||b.created_at)-toMs(a.updated_at||a.created_at)); draw();
  };
  body.append(h("div",{class:"wrapW"},
    h("div",{class:"toolbar"}, h("div",{class:"searchIn"}, icon("search"), search), h("span",{class:"sp"}),
      h("label",{class:"check"}, h("input",{type:"checkbox", onchange:(e)=>{ archived = e.target.checked; reload(); }}), "Show archived"),
      h("button",{class:"btn sm ghost", onclick:reload}, icon("refresh"), "Refresh")),
    listEl));
  reload();
}

/* ================= dreams (research preview) =================
   A dream reads past sessions and a memory store, and writes a tidied-up store. */
const DREAM_MODELS = ["claude-opus-5-5","claude-fable-5-1","claude-sonnet-5-5","claude-opus-5","claude-fable-5","claude-sonnet-5","claude-opus-4-8"];
async function dreamsInto(body, store){
  const listEl = h("div",{class:"list"}, h("div",{class:"hint"},"Loading…"));
  body.append(h("div",{class:"wrapW"},
    h("div",{class:"note", style:"margin-bottom:14px"}, icon("info"), h("div",{}, h("b",{},"Dreams "), "(research preview, by request) read past sessions and this memory store, then write a new, tidied-up store: duplicates merged, stale notes dropped, lessons from the sessions added. Your store isn’t changed unless you choose that.")),
    listEl));
  let r;
  try{ r = await listAll(C().beta.dreams.list({limit:100}), 300); }
  catch(e){ listEl.replaceChildren(h("div",{class:"empty"}, h("b",{},"Dreams aren’t available"), h("p",{}, e.status===403 || e.status===404 ? "Your workspace doesn’t have access to this research preview yet. You can request it from Anthropic." : errText(e)))); return; }
  const mine = r.filter(d=>(d.inputs||[]).some(i=>i.type==="memory_store" && i.memory_store_id===store.id));
  listEl.replaceChildren(...(mine.length ? mine.map(d=>dreamCard(d, ()=>route())) : [h("div",{class:"empty"}, h("div",{class:"ic"}, icon("mark")), h("b",{},"No dreams yet"), h("p",{},"Pick some sessions that used this store and let a model reorganise what it learned."), h("button",{class:"btn primary", onclick:()=>dreamDialog(store)}, icon("mark"), "Start a dream"))]));
  if(mine.some(d=>["pending","running"].includes(d.status))) setTimeout(()=>{ if(location.hash.endsWith(`memory/${store.id}/dreams`)) route(); }, 8000);
}
function dreamCard(d, refresh){
  const out = d.outputs?.[0]?.memory_store_id, sessions = (d.inputs||[]).find(i=>i.type==="sessions")?.session_ids || [];
  const st = d.status==="completed" ? chip("Done","ok") : d.status==="failed" ? chip("Failed","bad") : d.status==="canceled" ? chip("Cancelled","ghost") : chip(d.status==="pending" ? "Waiting" : "Dreaming","run");
  return h("div",{class:"card static"}, h("div",{class:"av soft"}, icon("mark")),
    h("div",{class:"main"}, h("div",{class:"t"}, `${sessions.length} session${sessions.length===1?"":"s"} · ${modelName(d.model)}`),
      h("div",{class:"s"}, d.error ? `${d.error.type}: ${d.error.message||""}` : d.instructions || when(d.created_at))),
    h("div",{class:"chips"}, st, d.usage?.list_cost ? chip(money(centsToDollars(d.usage.list_cost)),"mono") : ""),
    h("div",{class:"row", style:"flex-wrap:nowrap"},
      out ? h("button",{class:"btn sm", onclick:()=>go(`memory/${out}`)}, icon("db"), "Open result") : "",
      d.session_id ? h("button",{class:"btn sm ghost", title:"Watch the dream’s own session", onclick:()=>go(`sessions/${d.session_id}`)}, icon("eye")) : "",
      ["pending","running"].includes(d.status) ? h("button",{class:"btn sm ghost", onclick:async()=>{ if(await api(c=>c.beta.dreams.cancel(d.id),"Cancel")){ toast("Cancelled"); refresh(); } }}, "Cancel") : ""));
}
async function dreamDialog(store){
  const box = h("div",{class:"modal wide"}, h("h2",{},"Start a dream"), h("p",{class:"lead"},"Loading sessions that used this store…"));
  const bg = modal(box);
  const ss = await api(c=>c.beta.sessions.list({memory_store_id:store.id, limit:100, order:"desc"}), "Sessions");
  if(!ss){ bg.remove(); return; }
  const picks = ss.data.map((x,i)=>({id:x.id, el:h("input",{type:"checkbox", checked:i<20}), label:`${sessTitle(x)} · ${ago(x.created_at)}`}));
  const model = select(DREAM_MODELS.map(m=>({value:m, label:modelName(m)})), "claude-opus-5-5");
  const instr = area({rows:3, placeholder:"Optional: what to focus on, e.g. “Keep customer preferences; drop one-off debugging notes.”"});
  let outMode = "new";
  const err = h("span",{class:"err"});
  box.replaceChildren(h("h2",{},"Start a dream"),
    h("p",{class:"lead"},"A model reads the sessions you pick and this store, and writes an improved memory store. It runs in the background; you’re billed like a session."),
    h("label",{class:"f"},`Sessions (${picks.length} used this store; up to 100)`),
    picks.length ? h("div",{class:"fileList", style:"max-height:30vh"}, picks.map(p=>h("label",{class:"fileRow"}, p.el, h("span",{class:"p", style:"font-family:var(--font)"}, p.label)))) : h("p",{class:"hint"},"No sessions have used this store yet. A dream can still tidy the store on its own."),
    h("label",{class:"f"},"Model"), model,
    h("label",{class:"f"},"Instructions"), instr,
    h("label",{class:"f"},"Result"), seg([{value:"new", label:"A new store (recommended)"}, {value:"update", label:"Update this store"}], outMode, v=>{ outMode = v; }, "seg"),
    h("div",{class:"actions"}, err, h("span",{class:"sp"}), h("button",{class:"btn", onclick:()=>bg.remove()},"Cancel"), h("button",{class:"btn primary", onclick:async()=>{
      const ids = picks.filter(p=>p.el.checked).map(p=>p.id);
      if(ids.length > 100){ err.textContent = "At most 100 sessions."; return; }
      const inputs = [{type:"memory_store", memory_store_id:store.id}]; if(ids.length) inputs.push({type:"sessions", session_ids:ids});
      const params = {inputs, model:model.value}; if(instr.value.trim()) params.instructions = instr.value.trim();
      if(outMode==="update") params.output_behavior = {type:"update_existing", memory_store_id:store.id};
      try{ await C().beta.dreams.create(params); bg.remove(); toast("Dream started"); go(`memory/${store.id}/dreams`); }
      catch(e){ err.textContent = e.status===403 || e.status===404 ? "Your workspace doesn’t have access to Dreams yet (research preview)." : errText(e); }
    }}, icon("mark"), "Start")));
}

/* ================= skills ================= */
async function viewSkills(){
  const body = shell({title:"Skills", sub:"Folders of instructions and scripts your agents can use. Upload one, then switch it on in an agent.",
    actions:[h("button",{class:"btn primary", onclick:()=>uploadSkill()}, icon("plus"), "Upload a skill")]});
  simpleList(body, {
    load:()=> listAll(C().skills.list({limit:100}), 500),
    card:(k)=> h("div",{class:"card", onclick:()=>go(`skills/${k.id}`)}, h("div",{class:"av soft"}, icon("skill")),
      h("div",{class:"main"}, h("div",{class:"t"}, k.display_name), h("div",{class:"s"}, k.id)),
      h("div",{class:"chips hideSm"}, chip(k.source==="anthropic" ? "Anthropic" : "Yours", k.source==="anthropic" ? "" : "ok")), h("div",{class:"when"}, ago(k.updated_at||k.created_at))),
    empty:["skill","No skills yet","A skill is a folder with a SKILL.md file (instructions) and any scripts or files it needs. Agents load it when it’s relevant.", ()=>uploadSkill(), "Upload a skill"],
    what:"Skills"});
}
/** Picks a folder (it must contain SKILL.md at its top level) and uploads it as a new skill or a new version. */
function uploadSkill(skill){
  const fi = h("input",{type:"file", webkitdirectory:true, multiple:true, style:"display:none"}); document.body.append(fi);
  fi.onchange = async()=>{
    const all = [...fi.files]; fi.remove(); if(!all.length) return;
    const top = (all[0].webkitRelativePath||all[0].name).split("/")[0];
    if(!all.some(f=>f.webkitRelativePath===`${top}/SKILL.md`)){ toast("That folder needs a SKILL.md file at its top level.", 6000); return; }
    const files = all.filter(f=>!/(^|\/)(\.|node_modules\/|__pycache__\/)/.test(f.webkitRelativePath)).map(f=>new File([f], f.webkitRelativePath, {type:f.type||"application/octet-stream"}));
    if(files.reduce((n,f)=>n+f.size,0) > 30*1024*1024){ toast("Skills can be at most 30 MB.", 6000); return; }
    toast(`Uploading ${files.length} file${files.length>1?"s":""}…`, 10000);
    const r = await api(c=> skill ? c.skills.versions.create(skill.id, {files}) : c.skills.create({files}), "Upload");
    if(r){ skillCache = null; toast(skill ? "New version uploaded" : "Skill uploaded"); go(`skills/${skill ? skill.id : r.id}`); if(skill) route(); }
  };
  fi.click();
}
async function viewSkill(id){
  const k = await api(c=>c.skills.retrieve(id), "Skill");
  if(!k){ shell({crumb:[["Skills","skills"]], title:"Not found"}); return; }
  const mineSkill = k.source!=="anthropic";
  const body = shell({crumb:[["Skills","skills"]], title:k.display_name, sub:[idTag(k.id), chip(mineSkill ? "Yours" : "Anthropic")],
    actions: mineSkill ? [h("button",{class:"btn primary", onclick:()=>uploadSkill(k)}, icon("up"), "Upload a new version"),
      h("button",{class:"btn ghost", style:"color:var(--danger)", onclick:async()=>{
        if(!await typedConfirm("Delete this skill?","It’s removed for good. Agents that use it will fail to start new sessions until you remove it from them.", k.display_name, "Delete forever")) return;
        if(await api(c=>c.skills.delete(k.id),"Delete")){ skillCache = null; toast("Deleted"); go("skills"); } }}, icon("trash"), "Delete")] : []});
  const listEl = h("div",{class:"list"}, h("div",{class:"hint"},"Loading versions…"));
  const users = (await agentList().catch(()=>[])).filter(a=>!a.archived_at && (a.skills||[]).some(x=>x.skill_id===k.id));
  body.append(h("div",{class:"wrapW"},
    h("p",{class:"hint", style:"margin-top:0"}, users.length ? ["Used by ", ...users.flatMap((a,i)=>[i?", ":"", h("a",{href:`#/agents/${a.id}`, style:"color:var(--accent)"}, a.name)]), "."] : "No agents use it yet. Switch it on in an agent’s Skills section."),
    listEl));
  const vs = await api(c=>listAll(c.skills.versions.list(k.id, {limit:100}), 300), "Versions");
  if(!vs) return;
  listEl.replaceChildren(...vs.map(v=>{ const ver = v.version || v.id;
    return h("div",{class:"card static"}, h("div",{class:"av soft"}, icon("history")),
      h("div",{class:"main"}, h("div",{class:"t"}, v.name || k.display_name, " ", chip(ver,"mono")), h("div",{class:"s"}, v.description || when(v.created_at))),
      v.id===k.latest_version_id || ver===k.latest_version_id ? chip("Latest","ok") : "",
      mineSkill && vs.length > 1 ? h("button",{class:"iconBtn sm", title:"Delete this version", onclick:async()=>{ if(!await confirmDialog("Delete this version?","Agents pinned to it will fail to start new sessions.","Delete")) return; if(await api(c=>c.skills.versions.delete(ver,{skill_id:k.id}),"Delete")){ toast("Deleted"); route(); } }}, icon("trash")) : "");
  }));
}
