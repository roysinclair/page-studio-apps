/* ================= demo workspace =================
   Opens with page-orbit.html?demo. A complete in-memory stand-in for the Managed Agents API, so anyone can
   explore Page Orbit in a browser: sample agents, sessions, schedules and memory; sessions that reply live
   (streamed text, tool approvals, outcomes); and a scripted Diagnose. Nothing is sent anywhere, no key is
   needed, and everything resets when the tab closes. */
const DEMO = (()=>{ try{ return new URLSearchParams(location.search).has("demo"); }catch{ return false; } })();

function demoWorkspace(){
  let seq = 100;
  const nid = (p)=> `${p}_demo${(seq++).toString(36)}`;
  const now = ()=> new Date().toISOString();
  const T = (sec)=> new Date(Date.now() + sec*1000).toISOString();
  const S = {agents:new Map(), versions:new Map(), envs:new Map(), vaults:new Map(), creds:new Map(), stores:new Map(), mems:new Map(), memvers:[],
    deps:new Map(), runs:[], sessions:new Map(), events:new Map(), listeners:new Map(), resources:new Map(), skills:new Map(), dreams:[], files:new Map(), diag:0};
  const sha = (t)=> sha256Hex(t);

  /* ---- seed ---- */
  const toolset = (perms)=>({type:"agent_toolset_20260401", default_config:{enabled:true, permission_policy:{type:"always_allow"}},
    configs: SANDBOX_TOOLS.map(t=>({name:t.name, enabled: perms[t.name]!==false && !(t.off && !perms[t.name]), permission_policy:{type: perms[t.name]||t.def}}))});
  function addAgent(p, history=[]){
    const a = {id:p.id||nid("agent"), type:"agent", name:p.name, description:p.description??null, model:{effort:modelInfo(p.model.id).effort||"high", ...p.model}, system:p.system??null,
      tools:p.tools||[toolset({})], mcp_servers:p.mcp_servers||[], skills:p.skills||[], multiagent:p.multiagent??null, metadata:p.metadata||{},
      execution_identity:{type:"service_account"}, version:1, created_at:T(-86400*14), updated_at:T(-86400*14), archived_at:null};
    S.versions.set(a.id, [structuredClone(a)]);
    for(const [ago, change] of history){ Object.assign(a, change); a.version++; a.updated_at = T(-ago); S.versions.get(a.id).push(structuredClone(a)); }
    S.agents.set(a.id, a); return a;
  }
  const relSys = "You prepare releases for the Acme web app.\n\n- Read the merged pull requests since the last tag.\n- Write release notes for customers: plain English, grouped by New, Improved, Fixed.\n- Never push or tag anything yourself.";
  const rel = addAgent({id:"agent_demo_release", name:"Release manager", description:"Prepares release notes and checks the changelog", model:{id:"claude-opus-5-5"}, system:relSys,
    tools:[toolset({bash:"always_ask", write:"auto", edit:"auto", web_search:"always_allow"}), {type:"mcp_toolset", mcp_server_name:"github", default_config:{enabled:true, permission_policy:{type:"always_ask"}}}],
    mcp_servers:[{type:"url", name:"github", url:"https://api.githubcopilot.com/mcp/"}]},
    [[86400*3, {system: relSys + "\n- Keep it under 300 words."}], [3600*7, {model:{id:"claude-opus-5-5", effort:"high"}}]]);
  addAgent({id:"agent_demo_triage", name:"Support triage", description:"Labels new tickets and drafts first replies", model:{id:"claude-sonnet-5-5"},
    system:"Triage incoming support tickets: label each one (billing, bug, how-to, feature request), set a priority, and draft a friendly first reply. Never promise refunds.",
    tools:[toolset({}), {type:"custom", name:"lookup_order", description:"Look up an order by its number", input_schema:{type:"object", properties:{order:{type:"string"}}, required:["order"]}}]},
    [[86400*6,{}],[86400*4,{}],[86400*2,{}]]);
  addAgent({id:"agent_demo_analyst", name:"Data analyst", description:"Answers questions about the sales data", model:{id:"claude-fable-5-1"},
    system:"Answer questions about the sales data in /mnt/session/uploads. Show your working, and save charts to /mnt/session/outputs/.",
    tools:[toolset({bash:"always_allow"})], skills:[{type:"anthropic", skill_id:"xlsx", version:"latest"}],
    multiagent:{type:"multiagent_20261001", subagents:{type:"enabled", predefined_agents:[{type:"self"}], inline_agents:{type:"enabled"}}, workflows:{type:"disabled"}, advisor:{type:"disabled"}}},
    [[86400*5,{}]]);

  const env = (id, name, desc, networking, pip=[])=>{ const e = {id, type:"environment", name, description:desc, config:{type:"cloud", networking, packages:{type:"packages", pip, npm:[], apt:[], cargo:[], gem:[], go:[]}}, metadata:{}, scope:"organization", created_at:T(-86400*20), updated_at:T(-86400*4), archived_at:null}; S.envs.set(id, e); return e; };
  env("env_demo_safe", "safe", "Package registries, MCP servers and GitHub only", {type:"limited", allowed_hosts:["api.github.com","github.com"], allow_package_managers:true, allow_mcp_servers:true});
  env("env_demo_data", "python-data", "Python with pandas and matplotlib", {type:"limited", allowed_hosts:[], allow_package_managers:true, allow_mcp_servers:false}, ["pandas==2.2.0","matplotlib"]);

  S.vaults.set("vlt_demo_team", {id:"vlt_demo_team", type:"vault", display_name:"Team GitHub", metadata:{}, created_at:T(-86400*12), updated_at:T(-86400*12), archived_at:null});
  S.creds.set("vcrd_demo_1", {id:"vcrd_demo_1", type:"vault_credential", vault_id:"vlt_demo_team", display_name:"GitHub (Copilot MCP)", metadata:{},
    auth:{type:"mcp_oauth", mcp_server_url:"https://api.githubcopilot.com/mcp/", expires_at:T(86400*20), refresh:{client_id:"Iv1.demo", token_endpoint:"https://github.com/login/oauth/access_token", token_endpoint_auth:{type:"none"}}}, created_at:T(-86400*12), archived_at:null});
  S.creds.set("vcrd_demo_2", {id:"vcrd_demo_2", type:"vault_credential", vault_id:"vlt_demo_team", display_name:"Sentry API", metadata:{},
    auth:{type:"environment_variable", secret_name:"SENTRY_TOKEN", networking:{type:"limited", allowed_hosts:["sentry.io"]}, injection_location:{header:true, body:false}}, created_at:T(-86400*9), archived_at:null});

  const store = {id:"memstore_demo_playbook", type:"memory_store", name:"Release playbook", description:"House style for release notes, product names, and what customers care about.", metadata:{}, created_at:T(-86400*25), updated_at:T(-3600*5), archived_at:null};
  S.stores.set(store.id, store);
  const memo = async(path, content, ago, by)=>{ const id = "mem_demo_" + path.replace(/\W/g,""); const x = {id, type:"memory", memory_store_id:store.id, path, content, content_sha256: await sha(content), content_size_bytes:new TextEncoder().encode(content).length, memory_version_id:"memver_"+id, created_at:T(-ago-86400*5), updated_at:T(-ago)};
    S.mems.set(id, x);
    S.memvers.unshift({id:"memver0_"+id, memory_id:id, memory_store_id:store.id, operation:"created", content:content.split("\n")[0], path, content_size_bytes:40, created_by:{type:"user_actor", user_id:"user_demo"}, created_at:T(-ago-86400*5)});
    S.memvers.unshift({id:"memver_"+id, memory_id:id, memory_store_id:store.id, operation:"modified", content, path, content_size_bytes:x.content_size_bytes, created_by: by || {type:"session_actor", session_id:"sesn_demo_notes"}, created_at:T(-ago)}); };
  S.ready = Promise.all([
    memo("/style/voice.md", "# Voice\n\n- Plain English, short sentences.\n- Say what changed for the customer, not how we built it.\n- British spelling.\n- The product is “Acme”, never “ACME”.", 3600*5),
    memo("/style/sections.md", "Group changes under New, Improved and Fixed. Skip internal refactors and dependency bumps.", 86400*3),
    memo("/customers/enterprise.md", "Enterprise customers care most about SSO, audit logs and data export. Mention those first when they change.", 86400*6),
  ]);
  S.skills.set("skill_demo_notes", {id:"skill_demo_notes", type:"skill", display_name:"release-notes-style", latest_version_id:"skv_demo_2", source:"custom", created_at:T(-86400*10), updated_at:T(-86400*2)});
  S.dreams.push({id:"dream_demo_1", type:"dream", status:"completed", inputs:[{type:"memory_store", memory_store_id:store.id}, {type:"sessions", session_ids:["sesn_demo_notes","sesn_demo_old"]}], model:{id:"claude-opus-5-5"},
    instructions:"Merge duplicate style notes.", output_behavior:{type:"create_new"}, outputs:[{type:"memory_store", memory_store_id:store.id}], session_id:null, error:null, usage:{list_cost:{amount:"21", currency:"USD"}}, created_at:T(-86400*2), ended_at:T(-86400*2+600), archived_at:null});

  // a finished session, with a realistic event history
  function addSession(p, evs=[]){
    const a = S.agents.get(p.agent);
    const snap = {...structuredClone(S.versions.get(a.id).find(v=>v.version===(p.version||a.version))), type:"agent"};
    const s = {id:p.id||nid("sesn"), type:"session", title:p.title??null, status:p.status||"idle", environment_id:p.env||"env_demo_safe", agent:snap,
      resources:p.resources||[], vault_ids:p.vaults||[], budget:p.budget||null, metadata:{}, outcome_evaluations:[], stats:p.stats||{}, usage:p.usage||{}, deployment_id:p.deployment||null,
      created_at:p.created||now(), updated_at:p.created||now(), archived_at:null};
    S.sessions.set(s.id, s); S.events.set(s.id, evs); S.resources.set(s.id, (s.resources||[]).filter(r=>r.type==="file").map(r=>({id:nid("sres"), ...r, created_at:s.created_at})));
    return s;
  }
  { const E = []; let t = -600; const add = (e, dt=1.2)=>{ t += dt; E.push({id:"sevt_demo_"+(E.length+101), processed_at:T(t), ...e}); return E.at(-1); };
    add({type:"user.message", content:[{type:"text", text:"Write the customer release notes for v4.2 from the PRs merged since v4.1."}]}, 0);
    add({type:"session.status_running"}, .2);
    let ms = add({type:"span.model_request_start"}, .1);
    add({type:"agent.message", content:[{type:"text", text:"I’ll list the pull requests merged since the **v4.1** tag, then group them for customers."}]}, 3.1);
    add({type:"span.model_request_end", model_request_start_id:ms.id, is_error:false, model_usage:{input_tokens:9100, output_tokens:210, cache_read_input_tokens:0, cache_creation_input_tokens:9000}}, .1);
    const tu = add({type:"agent.mcp_tool_use", mcp_server_name:"github", name:"list_pull_requests", input:{repo:"acme/web", state:"merged", since:"v4.1"}, evaluated_permission:"ask", evaluation:{type:"always_ask"}}, .2);
    add({type:"session.status_idle", stop_reason:{type:"requires_action", event_ids:[tu.id]}}, .1);
    add({type:"user.tool_confirmation", tool_use_id:tu.id, result:"allow"}, 8);
    add({type:"session.status_running"}, .2);
    add({type:"agent.mcp_tool_result", mcp_tool_use_id:tu.id, content:[{type:"text", text:'[{"number":812,"title":"Faster CSV export"},{"number":815,"title":"Dark mode for reports"},{"number":819,"title":"Fix: invoice totals rounding"}, … 14 more]'}]}, 2.4);
    ms = add({type:"span.model_request_start"}, .1);
    const bt = add({type:"agent.tool_use", name:"bash", input:{command:"git log v4.1..HEAD --oneline | wc -l"}, evaluated_permission:"ask", evaluation:{type:"always_ask"}}, 4.2);
    add({type:"span.model_request_end", model_request_start_id:ms.id, is_error:false, model_usage:{input_tokens:14200, output_tokens:160, cache_read_input_tokens:9000, cache_creation_input_tokens:0}}, .1);
    add({type:"session.status_idle", stop_reason:{type:"requires_action", event_ids:[bt.id]}}, .1);
    add({type:"user.tool_confirmation", tool_use_id:bt.id, result:"allow"}, 5);
    add({type:"session.status_running"}, .2);
    add({type:"agent.tool_result", tool_use_id:bt.id, content:[{type:"text", text:"17"}]}, 1.1);
    add({type:"session.error", error:{type:"model_overloaded_error", message:"Overloaded", retry_status:{type:"retrying"}}}, 2);
    ms = add({type:"span.model_request_start"}, 4);
    add({type:"agent.message", content:[{type:"text", text:"## Acme 4.2 — what’s new\n\n**New**\n- **Dark mode for reports.** Reports now follow your system theme.\n\n**Improved**\n- **Faster CSV export** — large exports finish up to 5× faster.\n\n**Fixed**\n- Invoice totals no longer round incorrectly for some currencies.\n\n| Area | Changes |\n|---|---|\n| Reports | 6 |\n| Billing | 4 |\n| Exports | 7 |"}]}, 14);
    add({type:"span.model_request_end", model_request_start_id:ms.id, is_error:false, model_usage:{input_tokens:15400, output_tokens:2750, cache_read_input_tokens:14000, cache_creation_input_tokens:0}}, .1);
    add({type:"session.usage", usage:{input_tokens:38700, output_tokens:3120, cache_read_input_tokens:23000, list_cost:{amount:"38", currency:"USD"}}}, .05);
    add({type:"session.status_idle", stop_reason:{type:"end_turn"}}, .1);
    addSession({id:"sesn_demo_notes", agent:rel.id, version:2, title:"Release notes for v4.2", vaults:["vlt_demo_team"], budget:{type:"limit", max_list_cost:{amount:"500", currency:"USD"}},
      resources:[{type:"github_repository", url:"https://github.com/acme/web", mount_path:"/workspace/web"}, {type:"memory_store", memory_store_id:store.id, name:store.name, access:"read_write", mount_path:"/mnt/memory/release-playbook"}],
      usage:{input_tokens:38700, output_tokens:3120, cache_read_input_tokens:23000, list_cost:{amount:"38", currency:"USD"}, active_seconds:96}, stats:{active_seconds:96, duration_seconds:412}, created:T(-660)}, E);
  }
  addSession({id:"sesn_demo_ticket", agent:"agent_demo_triage", title:"Ticket #4471 — refund request", usage:{list_cost:{amount:"9", currency:"USD"}}, created:T(-86400)}, [
    {id:"sevt_demo_t1", type:"user.message", processed_at:T(-86400), content:[{type:"text", text:"Ticket #4471: “I was charged twice for order A-17, please refund one.”"}]},
    {id:"sevt_demo_t2", type:"session.status_running", processed_at:T(-86399)},
    {id:"sevt_demo_t3", type:"agent.custom_tool_use", name:"lookup_order", input:{order:"A-17"}, processed_at:T(-86396)},
    {id:"sevt_demo_t4", type:"session.status_idle", stop_reason:{type:"requires_action", event_ids:["sevt_demo_t3"]}, processed_at:T(-86396)}]);
  addSession({id:"sesn_demo_old", agent:rel.id, version:1, title:"Release notes for v4.1", usage:{list_cost:{amount:"31", currency:"USD"}}, created:T(-86400*8), deployment:"depl_demo_weekly"}, []);

  S.deps.set("depl_demo_weekly", {id:"depl_demo_weekly", type:"deployment", name:"Weekly release notes draft", description:"Every Monday morning", agent:{type:"agent", id:rel.id, version:3}, environment_id:"env_demo_safe",
    initial_events:[{type:"user.message", content:[{type:"text", text:"Draft release notes for everything merged this week."}]}], resources:[], vault_ids:["vlt_demo_team"], budget:{type:"limit", max_list_cost:{amount:"300", currency:"USD"}}, metadata:{},
    schedule:{type:"cron", expression:"0 9 * * 1", timezone:"Pacific/Auckland", last_run_at:T(-86400), upcoming_runs_at:[T(86400*6), T(86400*13), T(86400*20)]}, status:"active", paused_reason:null, created_at:T(-86400*30), updated_at:T(-86400), archived_at:null});
  S.runs.push({id:"drun_demo_1", type:"deployment_run", deployment_id:"depl_demo_weekly", agent:{type:"agent", id:rel.id, version:3}, trigger_context:{type:"schedule", scheduled_at:T(-86400)}, session_id:"sesn_demo_notes", error:null, created_at:T(-86400)},
    {id:"drun_demo_2", type:"deployment_run", deployment_id:"depl_demo_weekly", agent:{type:"agent", id:rel.id, version:1}, trigger_context:{type:"schedule", scheduled_at:T(-86400*8)}, session_id:"sesn_demo_old", error:null, created_at:T(-86400*8)},
    {id:"drun_demo_3", type:"deployment_run", deployment_id:"depl_demo_weekly", agent:{type:"agent", id:rel.id, version:1}, trigger_context:{type:"schedule", scheduled_at:T(-86400*15)}, session_id:null, error:{type:"session_rate_limited_error", message:"Too many sessions started at once"}, created_at:T(-86400*15)});
  S.files.set("sesn_demo_notes", [{id:"file_demo_notes", type:"file", filename:"release-notes-4.2.md", size_bytes:1840, mime_type:"text/markdown", created_at:T(-200), downloadable:true,
    content:"## Acme 4.2 — what’s new\n\nNew: Dark mode for reports.\nImproved: Faster CSV export.\nFixed: Invoice totals rounding.\n"}]);

  /* ---- live sessions ---- */
  function emit(sid, evs){
    const list = S.events.get(sid);
    for(const e of evs){ if(e.type!=="event_start" && e.type!=="event_delta"){ e.id ??= nid("sevt"); e.processed_at ??= now(); list.push(e); } (S.listeners.get(sid)||[]).forEach(f=>f(e)); }
  }
  const later = (ms, fn)=> setTimeout(fn, ms);
  function speak(sid, text, done){
    const id = nid("sevt"), words = text.split(/(?<=\s)/); let i = 0;
    emit(sid, [{type:"event_start", event:{type:"agent.message", id}}]);
    const tick = ()=>{ if(i < words.length){ const chunk = words.slice(i, i+3).join(""); i += 3; emit(sid, [{type:"event_delta", event_id:id, delta:{type:"content_delta", index:0, content:{type:"text", text:chunk}}}]); later(45, tick); }
      else { emit(sid, [{type:"agent.message", id, content:[{type:"text", text}]}]); done?.(); } };
    tick();
  }
  function modelTurn(sid, fn){ const st = {type:"span.model_request_start"}; emit(sid, [st, {type:"agent.thinking"}]);
    later(900, ()=> fn(()=> emit(sid, [{type:"span.model_request_end", model_request_start_id:st.id, is_error:false, model_usage:{input_tokens:3000+Math.round(Math.random()*4000), output_tokens:120+Math.round(Math.random()*300), cache_read_input_tokens:2500, cache_creation_input_tokens:0}}]))); }
  function bump(s, cents){ const u = s.usage ||= {}; const c = Number(u.list_cost?.amount||0) + cents; u.list_cost = {amount:String(c), currency:"USD"}; u.input_tokens = (u.input_tokens||0)+6000; u.output_tokens = (u.output_tokens||0)+400; u.active_seconds = (u.active_seconds||0)+9; }
  function finish(s){ bump(s, 4); s.status = "idle"; emit(s.id, [{type:"session.usage", usage:structuredClone(s.usage), budget:s.budget||undefined}, {type:"session.status_idle", stop_reason:{type:"end_turn"}}]); }
  function asks(s){ const ts = (s.agent.tools||[]).find(t=>t.type==="agent_toolset_20260401"); return ts ? toolPerm(ts, "bash")!=="always_allow" && toolEnabled(ts, "bash") : false; }
  function onUserMessage(s, text){
    s.status = "running"; emit(s.id, [{type:"session.status_running"}]);
    modelTurn(s.id, (end)=> speak(s.id, `Sure. I’ll start by looking at what’s in the workspace.`, ()=>{
      end();
      const tu = {id:nid("sevt"), type:"agent.tool_use", name:"bash", input:{command:"ls -la /workspace && git -C /workspace/web log --oneline -5"}, evaluated_permission: asks(s) ? "ask" : "allow", evaluation:{type: asks(s) ? "always_ask" : "always_allow"}};
      emit(s.id, [tu]);
      s.pendingText = text;
      if(asks(s)){ s.status = "idle"; emit(s.id, [{type:"session.status_idle", stop_reason:{type:"requires_action", event_ids:[tu.id]}}]); }
      else later(700, ()=> afterTool(s, tu.id, "allow"));
    }));
  }
  function afterTool(s, toolId, result, msg){
    s.status = "running"; emit(s.id, [{type:"session.status_running"}]);
    if(result==="deny"){ emit(s.id, [{type:"agent.tool_result", tool_use_id:toolId, is_error:true, content:[{type:"text", text:`Permission denied by user${msg ? ": "+msg : ""}`}]}]);
      return modelTurn(s.id, (end)=> speak(s.id, "Understood — I won’t run that. I can work from what you tell me instead: paste the details you’d like me to use.", ()=>{ end(); finish(s); })); }
    emit(s.id, [{type:"agent.tool_result", tool_use_id:toolId, content:[{type:"text", text:"total 12\ndrwxr-xr-x  web\n-rw-r--r--  README.md\n\n9f2c1e1 Faster CSV export (#812)\n7ab03d4 Dark mode for reports (#815)\n51e9c0a Fix invoice rounding (#819)\n2d4f7b8 Bump dependencies\n0c1a9e2 Release v4.1"}]}]);
    modelTurn(s.id, (end)=> speak(s.id, `Here’s what I found.\n\n- **3 customer-facing changes** since v4.1: faster CSV export, dark mode for reports, and an invoice rounding fix.\n- 1 internal change (dependency bumps), which I’d leave out of customer notes.\n\nThis is a demo workspace, so my replies are scripted — with your own key, the real agent does the work in its sandbox.`, ()=>{ end(); finish(s); }));
  }
  function onEvents(s, events){
    const out = [];
    for(const e of events){
      const ev = {...e, id:nid("sevt"), processed_at: e.type==="user.message" || e.type==="user.tool_confirmation" || e.type==="user.interrupt" ? null : now()};
      out.push(ev); emit(s.id, [ev]);
      if(ev.processed_at==null) later(150, ()=>{ ev.processed_at = now(); emit(s.id, [{...ev}]); });
      if(e.type==="user.message") later(300, ()=> onUserMessage(s, (e.content||[]).filter(b=>b.type==="text").map(b=>b.text).join(" ")));
      if(e.type==="user.tool_confirmation") later(300, ()=> afterTool(s, e.tool_use_id, e.result, e.deny_message));
      if(e.type==="user.custom_tool_result"){ s.status = "running"; later(300, ()=>{ emit(s.id, [{type:"session.status_running"}]); modelTurn(s.id, (end)=> speak(s.id, "Thanks — that confirms a duplicate charge. **Label:** billing · **Priority:** high.\n\nDraft reply: “Sorry about that! I can see order A-17 was charged twice; I’ve asked our billing team to refund the duplicate, which usually takes 3–5 working days.”", ()=>{ end(); finish(s); })); }); }
      if(e.type==="user.interrupt") later(200, ()=>{ s.status = "idle"; emit(s.id, [{type:"session.status_idle", stop_reason:{type:"end_turn"}}]); });
      if(e.type==="user.define_outcome"){ ev.outcome_id = nid("outc"); s.status = "running";
        later(400, ()=>{ emit(s.id, [{type:"session.status_running"}]); modelTurn(s.id, (end)=> speak(s.id, "Working towards the goal…", ()=>{ end();
          emit(s.id, [{type:"span.outcome_evaluation_start", outcome_id:ev.outcome_id, iteration:0}]);
          later(1800, ()=>{ emit(s.id, [{type:"span.outcome_evaluation_end", outcome_id:ev.outcome_id, outcome_evaluation_start_id:"", iteration:0, result:"satisfied", explanation:"All the checks in the rubric are met. (Demo: the grader’s verdict is scripted.)", usage:{input_tokens:2400, output_tokens:180}}]); finish(s); });
        })); }); }
    }
    return out;
  }

  /* ---- Diagnose (Messages API), scripted ---- */
  function diagnose(body){
    S.diag++;
    const log = body.messages?.[0]?.content?.[0]?.text || "";
    const n = (re)=> (log.match(re)||[]).length;
    const asked = n(/permission=ask/g), errors = n(/session\.error/g), denied = n(/user\.tool_confirmation: for=\S+ deny/g);
    const first = S.diag===1 || body.messages.length===1;
    const text = first ? `**What happened** — the agent made ${n(/tool_use:/g)} tool call${n(/tool_use:/g)===1?"":"s"}; ${asked} needed your approval${denied ? ` and you denied ${denied}` : ""}.${errors ? ` There ${errors===1?"was":"were"} ${errors} error event${errors===1?"":"s"}, retried automatically.` : ""}\n\n**What slowed it down** — every approval pauses the agent until someone answers. In scheduled runs nobody is watching, so those pauses would stall it.\n\n**Suggested fix** — keep \`bash\` on Ask, but tell the agent to prefer read-only commands and say why it needs each one, so approvals are quick to give.\n\n_This is a demo: the diagnosis is scripted. With your key, a real model reads the whole transcript._`
      : "In the demo I can only give scripted answers — with your own key, Diagnose answers follow-up questions about the session properly.";
    const ev = (t,d)=>`event: ${t}\ndata: ${JSON.stringify({type:t,...d})}\n\n`;
    let out = ev("message_start",{message:{id:"msg_demo",type:"message",role:"assistant",model:body.model,content:[],stop_reason:null,usage:{input_tokens:8200,output_tokens:1}}});
    out += ev("content_block_start",{index:0,content_block:{type:"text",text:""}});
    for(const chunk of text.match(/.{1,40}/gs)) out += ev("content_block_delta",{index:0,delta:{type:"text_delta",text:chunk}});
    out += ev("content_block_stop",{index:0});
    if(first){
      const agent = [...S.agents.values()].find(a=>log.includes(a.id)) || [...S.agents.values()][0];
      const input = {title:"Explain each command before running it", rationale:`${asked} approval${asked===1?"":"s"} in this session were for commands that turned out to be read-only. Asking the agent to explain each command makes approvals faster, without letting it run anything unchecked.`,
        changes:{system:(agent.system||"") + "\n- Before running a command, say in one line what it does and whether it changes anything. Prefer read-only commands."}};
      out += ev("content_block_start",{index:1,content_block:{type:"tool_use",id:"toolu_demo",name:"propose_agent_change",input:{}}}) + ev("content_block_delta",{index:1,delta:{type:"input_json_delta",partial_json:JSON.stringify(input)}}) + ev("content_block_stop",{index:1});
    }
    out += ev("message_delta",{delta:{stop_reason: first ? "tool_use" : "end_turn"},usage:{output_tokens:420}}) + ev("message_stop",{});
    return new Response(out, {status:200, headers:{"content-type":"text/event-stream"}});
  }

  /* ---- the fake HTTP API ---- */
  const J = (o, status=200)=> new Response(JSON.stringify(o), {status, headers:{"content-type":"application/json", "request-id":"req_demo"}});
  const page = (arr)=> J({data:arr, next_page:null, prev_page:null});
  const err = (status, message, type="invalid_request_error")=> J({type:"error", error:{type, message}, request_id:"req_demo"}, status);
  const sseStream = (sid, signal)=>{
    let fn;
    return new Response(new ReadableStream({
      start(c){ const enc = new TextEncoder(); fn = (e)=>{ try{ c.enqueue(enc.encode(`event: ${e.type}\ndata: ${JSON.stringify(e)}\n\n`)); }catch{} };
        const l = S.listeners.get(sid) || []; l.push(fn); S.listeners.set(sid, l);
        signal?.addEventListener("abort", ()=>{ S.listeners.set(sid, (S.listeners.get(sid)||[]).filter(x=>x!==fn)); try{ c.close(); }catch{} }); },
      cancel(){ S.listeners.set(sid, (S.listeners.get(sid)||[]).filter(x=>x!==fn)); },
    }), {status:200, headers:{"content-type":"text/event-stream"}});
  };

  return async function demoFetch(input, init={}){
    await S.ready;
    const req = new Request(input, init), u = new URL(req.url), p = u.pathname.replace(/\/$/,""), q = u.searchParams, m = req.method;
    let body = null;
    if(m!=="GET" && m!=="DELETE"){ const ct = req.headers.get("content-type")||""; body = /json/.test(ct) ? await req.json().catch(()=>null) : /multipart/.test(ct) ? await req.formData().catch(()=>null) : null; }
    await new Promise(r=>setTimeout(r, 80));     // feel like a network
    let mm;
    // agents
    if(p==="/v1/agents" && m==="GET") return page([...S.agents.values()].filter(a=>q.get("include_archived")==="true" || !a.archived_at));
    if(p==="/v1/agents" && m==="POST"){ if(!body?.name) return err(400, "name: required"); const a = addAgent({...body, model: typeof body.model==="string" ? {id:body.model} : body.model}); a.created_at = a.updated_at = now(); S.versions.set(a.id, [structuredClone(a)]); return J(a); }
    if((mm = p.match(/^\/v1\/agents\/([^/]+)$/))){
      const a = S.agents.get(mm[1]); if(!a) return err(404, "Agent not found", "not_found_error");
      if(m==="GET"){ const v = q.get("version"); return J(v ? S.versions.get(a.id).find(x=>x.version==v) : a); }
      if(body.version && body.version !== a.version) return err(409, `Version conflict: the agent is at version ${a.version}.`);
      let changed = false;
      for(const k of [...CONFIG_KEYS]) if(k in body && k!=="version" && JSON.stringify(body[k])!==JSON.stringify(a[k])){ a[k] = body[k]; changed = true; }
      if(body.metadata) for(const [k,v] of Object.entries(body.metadata)){ if(v===null){ if(k in a.metadata){ delete a.metadata[k]; changed = true; } } else if(a.metadata[k]!==v){ a.metadata[k] = v; changed = true; } }
      if(changed){ a.version++; a.updated_at = now(); S.versions.get(a.id).push(structuredClone(a)); }
      return J(a);
    }
    if((mm = p.match(/^\/v1\/agents\/([^/]+)\/versions$/))) return page([...(S.versions.get(mm[1])||[])].reverse());
    if((mm = p.match(/^\/v1\/agents\/([^/]+)\/archive$/))){ const a = S.agents.get(mm[1]); a.archived_at = now(); return J(a); }
    // environments
    if(p==="/v1/environments" && m==="GET") return page([...S.envs.values()].filter(e=>q.get("include_archived")==="true" || !e.archived_at));
    if(p==="/v1/environments" && m==="POST"){ const e = {id:nid("env"), type:"environment", metadata:{}, scope:"organization", created_at:now(), updated_at:now(), archived_at:null, ...body, config:{type:"cloud", networking:{type:"unrestricted"}, packages:{type:"packages"}, ...(body.config||{})}}; S.envs.set(e.id, e); return J(e); }
    if((mm = p.match(/^\/v1\/environments\/([^/]+)(\/archive)?$/))){ const e = S.envs.get(mm[1]); if(!e) return err(404, "Environment not found", "not_found_error");
      if(mm[2]){ e.archived_at = now(); return J(e); } if(m==="DELETE"){ S.envs.delete(e.id); return J({id:e.id, type:"environment_deleted"}); }
      if(m==="POST"){ Object.assign(e, body, {config:{...e.config, ...(body.config||{})}, updated_at:now()}); } return J(e); }
    // vaults & credentials
    if(p==="/v1/vaults" && m==="GET") return page([...S.vaults.values()].filter(v=>q.get("include_archived")==="true" || !v.archived_at));
    if(p==="/v1/vaults" && m==="POST"){ const v = {id:nid("vlt"), type:"vault", display_name:body.display_name, metadata:{}, created_at:now(), updated_at:now(), archived_at:null}; S.vaults.set(v.id, v); return J(v); }
    if((mm = p.match(/^\/v1\/vaults\/([^/]+)(\/archive)?$/))){ const v = S.vaults.get(mm[1]); if(!v) return err(404, "Vault not found", "not_found_error");
      if(mm[2]){ v.archived_at = now(); return J(v); } if(m==="DELETE"){ S.vaults.delete(v.id); return J({id:v.id, type:"vault_deleted"}); } if(m==="POST") Object.assign(v, body, {updated_at:now()}); return J(v); }
    if((mm = p.match(/^\/v1\/vaults\/([^/]+)\/credentials$/))){
      if(m==="GET") return page([...S.creds.values()].filter(c=>c.vault_id===mm[1] && (q.get("include_archived")==="true" || !c.archived_at)));
      const auth = structuredClone(body.auth); delete auth.token; delete auth.access_token; delete auth.secret_value; if(auth.refresh){ delete auth.refresh.refresh_token; if(auth.refresh.token_endpoint_auth) delete auth.refresh.token_endpoint_auth.client_secret; }
      const c = {id:nid("vcrd"), type:"vault_credential", vault_id:mm[1], display_name:body.display_name, metadata:{}, auth, created_at:now(), updated_at:now(), archived_at:null}; S.creds.set(c.id, c); return J(c);
    }
    if((mm = p.match(/^\/v1\/vaults\/([^/]+)\/credentials\/([^/]+)(\/mcp_oauth_validate|\/archive)?$/))){ const c = S.creds.get(mm[2]); if(!c) return err(404, "Credential not found", "not_found_error");
      if(mm[3]==="/mcp_oauth_validate") return J({status:"valid", has_refresh_token:true, mcp_probe:{method:"tools/list", http_response:{status_code:200}}, refresh:null, validated_at:now()});
      if(mm[3]==="/archive"){ c.archived_at = now(); return J(c); } if(m==="DELETE"){ S.creds.delete(c.id); return J({id:c.id, type:"vault_credential_deleted"}); }
      if(m==="POST"){ c.updated_at = now(); if(body.display_name) c.display_name = body.display_name; } return J(c); }
    // memory
    if(p==="/v1/memory_stores" && m==="GET") return page([...S.stores.values()].filter(s=>q.get("include_archived")==="true" || !s.archived_at));
    if(p==="/v1/memory_stores" && m==="POST"){ const s = {id:nid("memstore"), type:"memory_store", name:body.name, description:body.description||"", metadata:{}, created_at:now(), updated_at:now(), archived_at:null}; S.stores.set(s.id, s); return J(s); }
    if((mm = p.match(/^\/v1\/memory_stores\/([^/]+)(\/archive)?$/))){ const s = S.stores.get(mm[1]); if(!s) return err(404, "Memory store not found", "not_found_error");
      if(mm[2]){ s.archived_at = now(); return J(s); } if(m==="DELETE"){ S.stores.delete(s.id); return J({id:s.id, type:"memory_store_deleted"}); } if(m==="POST") Object.assign(s, body, {updated_at:now()}); return J(s); }
    if((mm = p.match(/^\/v1\/memory_stores\/([^/]+)\/memories$/))){
      if(m==="GET") return page([...S.mems.values()].filter(x=>x.memory_store_id===mm[1]).map(x=>({...x, content:null})));
      if([...S.mems.values()].some(x=>x.memory_store_id===mm[1] && (x.path===body.path || x.path.startsWith(body.path+"/") || body.path.startsWith(x.path+"/")))) return err(409, "A memory already uses that path.", "memory_path_conflict_error");
      const x = {id:nid("mem"), type:"memory", memory_store_id:mm[1], path:body.path, content:body.content, content_sha256:await sha(body.content), content_size_bytes:new TextEncoder().encode(body.content).length, created_at:now(), updated_at:now()};
      S.mems.set(x.id, x); S.memvers.unshift({id:nid("memver"), memory_id:x.id, memory_store_id:mm[1], operation:"created", content:x.content, path:x.path, content_size_bytes:x.content_size_bytes, created_by:{type:"user_actor", user_id:"user_demo"}, created_at:now()}); return J(x);
    }
    if((mm = p.match(/^\/v1\/memory_stores\/([^/]+)\/memories\/([^/]+)$/))){ const x = S.mems.get(mm[2]); if(!x) return err(404, "Memory not found", "not_found_error");
      if(m==="DELETE"){ S.mems.delete(x.id); S.memvers.unshift({id:nid("memver"), memory_id:x.id, memory_store_id:mm[1], operation:"deleted", created_by:{type:"user_actor", user_id:"user_demo"}, created_at:now()}); return J({id:x.id, type:"memory_deleted"}); }
      if(m==="POST"){ if(body.precondition && body.precondition.content_sha256!==x.content_sha256) return err(409, "The memory changed since you read it.", "memory_precondition_failed_error");
        if(body.content!=null){ x.content = body.content; x.content_sha256 = await sha(x.content); x.content_size_bytes = new TextEncoder().encode(x.content).length; } if(body.path) x.path = body.path; x.updated_at = now();
        S.memvers.unshift({id:nid("memver"), memory_id:x.id, memory_store_id:mm[1], operation:"modified", content:x.content, path:x.path, content_size_bytes:x.content_size_bytes, created_by:{type:"user_actor", user_id:"user_demo"}, created_at:now()}); }
      return J(x); }
    if((mm = p.match(/^\/v1\/memory_stores\/([^/]+)\/memory_versions$/))) return page(S.memvers.filter(v=>v.memory_store_id===mm[1] && (!q.get("memory_id") || v.memory_id===q.get("memory_id"))));
    if((mm = p.match(/^\/v1\/memory_stores\/([^/]+)\/memory_versions\/([^/]+)(\/redact)?$/))){ const v = S.memvers.find(x=>x.id===mm[2]); if(!v) return err(404, "Version not found", "not_found_error");
      if(mm[3]){ Object.assign(v, {content:null, content_sha256:null, content_size_bytes:null, path:null, redacted_at:now(), redacted_by:{type:"user_actor", user_id:"user_demo"}}); } return J(v); }
    // dreams, skills, tunnels
    if(p==="/v1/dreams" && m==="GET") return page(S.dreams);
    if(p==="/v1/dreams" && m==="POST"){ const d = {id:nid("dream"), type:"dream", status:"running", inputs:body.inputs, model:{id:body.model}, instructions:body.instructions??null, output_behavior:body.output_behavior||{type:"create_new"}, outputs:[], session_id:null, error:null, usage:{}, created_at:now(), ended_at:null, archived_at:null};
      S.dreams.unshift(d); later(9000, ()=>{ const ns = {id:nid("memstore"), type:"memory_store", name:"Release playbook (dreamed)", description:"Tidied up by a dream", metadata:{}, created_at:now(), updated_at:now(), archived_at:null};
        S.stores.set(ns.id, ns); for(const x of [...S.mems.values()].filter(x=>x.memory_store_id===body.inputs[0].memory_store_id)){ const c = {...x, id:nid("mem"), memory_store_id:ns.id}; S.mems.set(c.id, c); }
        Object.assign(d, {status:"completed", outputs:[{type:"memory_store", memory_store_id:ns.id}], ended_at:now(), usage:{list_cost:{amount:"18", currency:"USD"}}}); }); return J(d); }
    if((mm = p.match(/^\/v1\/dreams\/([^/]+)\/(cancel|archive)$/))){ const d = S.dreams.find(x=>x.id===mm[1]); if(mm[2]==="cancel") d.status = "canceled"; else d.archived_at = now(); return J(d); }
    if(p==="/v1/skills" && m==="GET") return page([...S.skills.values()]);
    if(p==="/v1/skills" && m==="POST"){ const files = body?.getAll?.("files[]")||body?.getAll?.("files")||[]; const top = (files[0]?.name||"my-skill").split("/")[0];
      const k = {id:nid("skill"), type:"skill", display_name:top, latest_version_id:nid("skv"), source:"custom", created_at:now(), updated_at:now()}; S.skills.set(k.id, k); return J(k); }
    if((mm = p.match(/^\/v1\/skills\/([^/]+)$/))){ const k = S.skills.get(mm[1]); if(!k) return err(404, "Skill not found", "not_found_error"); if(m==="DELETE"){ S.skills.delete(k.id); return J({id:k.id, type:"skill_deleted"}); } return J(k); }
    if((mm = p.match(/^\/v1\/skills\/([^/]+)\/versions$/))){ const k = S.skills.get(mm[1]);
      if(m==="POST"){ k.latest_version_id = nid("skv"); k.updated_at = now(); return J({id:k.latest_version_id, type:"skill_version", version:k.latest_version_id, skill_id:k.id, name:k.display_name, description:"", created_at:now()}); }
      return page([{id:k.latest_version_id, type:"skill_version", version:k.latest_version_id, skill_id:k.id, name:k.display_name, description:"Tone, structure and banned words for release notes", created_at:k.updated_at},
        {id:"skv_demo_1", type:"skill_version", version:"skv_demo_1", skill_id:k.id, name:k.display_name, description:"First version", created_at:k.created_at}]); }
    if(p==="/v1/tunnels") return page([{id:"tnl_demo", type:"tunnel", display_name:"Office network", domain:"t-demo42.tunnel.example", created_at:T(-86400*30), archived_at:null}]);
    // deployments
    if(p==="/v1/deployments" && m==="GET") return page([...S.deps.values()].filter(d=>(!q.get("agent_id") || d.agent.id===q.get("agent_id")) && (q.get("include_archived")==="true" || !d.archived_at)));
    if(p==="/v1/deployments" && m==="POST"){ const aid = typeof body.agent==="string" ? body.agent : body.agent.id, a = S.agents.get(aid);
      const d = {id:nid("depl"), type:"deployment", description:null, resources:[], vault_ids:[], metadata:{}, ...body, agent:{type:"agent", id:aid, version: body.agent.version || a.version},
        schedule: body.schedule ? {...body.schedule, upcoming_runs_at:[T(86400), T(86400*2)]} : null, status:"active", paused_reason:null, created_at:now(), updated_at:now(), archived_at:null};
      S.deps.set(d.id, d); return J(d); }
    if((mm = p.match(/^\/v1\/deployments\/([^/]+)(\/pause|\/unpause|\/run|\/archive)?$/))){ const d = S.deps.get(mm[1]); if(!d) return err(404, "Deployment not found", "not_found_error");
      if(mm[2]==="/run"){ const s = newSession({agent:{type:"agent", id:d.agent.id, version:d.agent.version}, environment_id:d.environment_id, title:d.name, initial_events:d.initial_events, deployment_id:d.id});
        const r = {id:nid("drun"), type:"deployment_run", deployment_id:d.id, agent:d.agent, trigger_context:{type:"manual"}, session_id:s.id, error:null, created_at:now()}; S.runs.unshift(r); return J(r); }
      if(mm[2]==="/pause"){ d.status = "paused"; d.paused_reason = {type:"manual"}; } if(mm[2]==="/unpause"){ d.status = "active"; d.paused_reason = null; } if(mm[2]==="/archive") d.archived_at = now();
      if(!mm[2] && m==="POST"){ Object.assign(d, body, {updated_at:now()}); if(typeof body.agent==="string") d.agent = {type:"agent", id:body.agent, version:S.agents.get(body.agent).version}; if(body.schedule) d.schedule = {...body.schedule, upcoming_runs_at:[T(86400)]}; }
      return J(d); }
    if(p==="/v1/deployment_runs") return page(S.runs.filter(r=>!q.get("deployment_id") || r.deployment_id===q.get("deployment_id")));
    // files
    if(p==="/v1/files" && m==="GET") return J({data:S.files.get(q.get("scope_id"))||[], next_page:null, has_more:false});
    if(p==="/v1/files" && m==="POST"){ const f = body?.get?.("file"); const o = {id:nid("file"), type:"file", filename:f?.name||"upload", size_bytes:f?.size||0, mime_type:f?.type||"application/octet-stream", created_at:now()}; return J(o); }
    if((mm = p.match(/^\/v1\/files\/([^/]+)\/content$/))){ const f = [...S.files.values()].flat().find(x=>x.id===mm[1]); return new Response(f?.content||"", {status:200, headers:{"content-type":f?.mime_type||"text/plain"}}); }
    // sessions
    if(p==="/v1/sessions" && m==="GET"){
      let list = [...S.sessions.values()].filter(s=>(q.get("include_archived")==="true" || !s.archived_at) && (!q.get("agent_id") || s.agent.id===q.get("agent_id")) && (!q.get("deployment_id") || s.deployment_id===q.get("deployment_id"))
        && (!q.get("memory_store_id") || (s.resources||[]).some(r=>r.memory_store_id===q.get("memory_store_id"))) && (!q.getAll("statuses[]").length || q.getAll("statuses[]").includes(s.status))
        && (!q.get("created_at[gte]") || s.created_at >= q.get("created_at[gte]")));
      list.sort((a,b)=> b.created_at.localeCompare(a.created_at)); return page(list.slice(0, Number(q.get("limit")||30)));
    }
    if(p==="/v1/sessions" && m==="POST") return J(newSession(body));
    if((mm = p.match(/^\/v1\/sessions\/([^/]+)(\/archive)?$/))){ const s = S.sessions.get(mm[1]); if(!s) return err(404, "Session not found", "not_found_error");
      if(mm[2]){ s.archived_at = now(); return J(s); } if(m==="DELETE"){ S.sessions.delete(s.id); return J({id:s.id, type:"session_deleted"}); }
      if(m==="POST"){ if(body.agent){ if(s.status==="running") return err(400, "The session must be idle to change its tools."); Object.assign(s.agent, body.agent); emit(s.id, [{type:"session.updated", agent:structuredClone(s.agent)}]); }
        if("title" in body) s.title = body.title; if("budget" in body) s.budget = body.budget; if(body.metadata) Object.assign(s.metadata, body.metadata); }
      return J(s); }
    if((mm = p.match(/^\/v1\/sessions\/([^/]+)\/events$/))){ const s = S.sessions.get(mm[1]); if(!s) return err(404, "Session not found", "not_found_error");
      if(m==="GET"){ const gte = q.get("created_at[gte]"); return page(S.events.get(s.id).filter(e=>!gte || (e.processed_at && e.processed_at >= gte))); }
      return J({data:onEvents(s, body.events||[])}); }
    if((mm = p.match(/^\/v1\/sessions\/([^/]+)\/events\/stream$/))) return sseStream(mm[1], init.signal);
    if((mm = p.match(/^\/v1\/sessions\/([^/]+)\/resources$/))){ const list = S.resources.get(mm[1]) || []; S.resources.set(mm[1], list);
      if(m==="GET") return page(list); const r = {id:nid("sres"), ...body, created_at:now()}; list.push(r); return J(r); }
    if((mm = p.match(/^\/v1\/sessions\/([^/]+)\/resources\/([^/]+)$/))){ S.resources.set(mm[1], (S.resources.get(mm[1])||[]).filter(r=>r.id!==mm[2])); return J({id:mm[2], type:"session_resource_deleted"}); }
    if((mm = p.match(/^\/v1\/sessions\/([^/]+)\/threads$/))) return page([{id:"sthr_main", type:"session_thread", session_id:mm[1], status:S.sessions.get(mm[1])?.status||"idle", agent:{type:"agent", name:"main"}, parent_thread_id:null, created_at:now()}]);
    if(/\/threads\/[^/]+\/events$/.test(p)) return page([]);
    if(/\/threads\/[^/]+\/stream$/.test(p)) return sseStream("thread-none", init.signal);
    // messages (Diagnose)
    if(p==="/v1/messages") return diagnose(body);
    if(p==="/v1/models") return page(MODELS.map(x=>({id:x.id, type:"model", display_name:x.name})));
    return err(404, `The demo doesn’t include ${m} ${p}.`, "not_found_error");
  };

  function newSession(body){
    const aid = typeof body.agent==="string" ? body.agent : body.agent.id, a = S.agents.get(aid);
    const ver = typeof body.agent==="object" && body.agent.version ? body.agent.version : a.version;
    const snap = {...structuredClone(S.versions.get(aid).find(v=>v.version===ver) || a), type:"agent"};
    if(body.agent.type==="agent_with_overrides") for(const k of ["model","system","tools","mcp_servers","skills"]) if(k in body.agent) snap[k] = body.agent[k];
    const s = {id:nid("sesn"), type:"session", title:body.title??null, status:"idle", environment_id:body.environment_id, agent:snap,
      resources:(body.resources||[]).map(r=>({...r, authorization_token:undefined, mount_path: r.mount_path || (r.type==="memory_store" ? "/mnt/memory/"+memSlug(S.stores.get(r.memory_store_id)?.name) : r.type==="github_repository" ? "/workspace/"+r.url.split("/").pop() : undefined)})),
      vault_ids:body.vault_ids||[], budget:body.budget||null, metadata:body.metadata||{}, outcome_evaluations:[], stats:{}, usage:{}, deployment_id:body.deployment_id||null, created_at:now(), updated_at:now(), archived_at:null};
    S.sessions.set(s.id, s); S.events.set(s.id, []);
    S.resources.set(s.id, (body.resources||[]).filter(r=>r.type==="file").map(r=>({id:nid("sres"), ...r, created_at:now()})));
    if(body.initial_events?.length){ s.status = "running"; setTimeout(()=> onEvents(s, body.initial_events), 600); }
    return s;
  }
}
function demoBanner(){
  if(!DEMO) return "";
  return h("div",{class:"note", style:"margin:0 0 18px;text-align:left"}, icon("info"), h("div",{},
    h("b",{},"You’re exploring a demo. "), "Sample agents and sessions, all made up; sessions reply with scripted answers. Nothing is sent anywhere and nothing is kept. ",
    h("a",{href:RELEASES, target:"_blank", rel:"noopener noreferrer", style:"color:var(--accent);font-weight:500"}, "Get the desktop app"), " to use your own agents · ",
    h("a",{href:location.pathname, style:"color:var(--accent);font-weight:500"}, "Leave the demo")));
}
