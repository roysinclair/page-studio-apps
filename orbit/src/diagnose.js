/* global agentCache -- declared in agents.js; tools/build-orbit.py joins the sources into one script */
/* ================= diagnose =================
   Sends a session's transcript and its agent's setup to a model (Messages API), which explains
   what happened and can propose changes to the agent. Proposals are shown as a diff and applied
   only when you click — as a new agent version. You can keep asking questions about the session. */
const DIAG_MAX_CHARS = 180000;
const DIAG_TOOL = {
  name:"propose_agent_change",
  description:"Propose a concrete change to the agent's saved setup. The user sees a diff and decides whether to apply it as a new agent version. Give the FULL new value of each field you change (lists like tools are replaced whole). Only include fields you want to change.",
  input_schema:{type:"object", required:["title","rationale","changes"], properties:{
    title:{type:"string", description:"Short name for the change, e.g. 'Ask before running bash'"},
    rationale:{type:"string", description:"Why this fixes what went wrong, citing event ids"},
    changes:{type:"object", description:"New values for agent fields", properties:{
      system:{type:"string"}, description:{type:"string"},
      model:{type:"object", properties:{id:{type:"string"}, effort:{type:"string", enum:["low","medium","high","xhigh","max"]}}, required:["id"]},
      tools:{type:"array", items:{type:"object"}}, mcp_servers:{type:"array", items:{type:"object"}}, skills:{type:"array", items:{type:"object"}},
    }},
  }},
};
const DIAG_SYSTEM = `You are an expert at debugging agents built on Anthropic's Managed Agents platform. The user runs Page Orbit, a tool for building and running these agents, and wants to understand one session.

You get: the agent's current saved setup, the setup the session actually ran with, and a condensed event log. Each log line starts with time since the session began and the event id (sevt_…).

How Managed Agents work (for your reasoning):
- An agent = model + system prompt + tools. Built-in sandbox tools (agent_toolset_20260401): bash, read, write, edit, glob, grep, web_search, web_fetch, each with enabled and a permission_policy: always_allow, always_ask (pauses for a human), or auto (a safety check allows, blocks or asks). MCP servers are reached through mcp_toolset entries; their credentials live in vaults attached when the session starts. Custom tools are answered by the user.
- The sandbox runs in an environment whose networking may be "limited" to listed hosts; blocked hosts look like network errors in tool results. Package managers and MCP servers need explicit allow flags under limited networking.
- session.error events carry a type and retry_status. tool_use_limit_reached_error and compaction_limit_reached_error end a turn as retries_exhausted although no request failed: the turn hit the per-turn tool-step limit, or context was compacted too many times in a row (both fixed by a follow-up message, narrower tasks or clearer instructions).
- session.status_idle carries a stop_reason: end_turn, requires_action (waiting on a person), retries_exhausted, budget_reached, refusal. A session that finishes its work goes idle; session.status_terminated means an unrecoverable error or that it was archived.
- Web tools: since Oct 2026, a limited environment's allowed_hosts also filter web_search and web_fetch (an empty list means they return nothing), and web_fetch only opens URLs that already appeared in the session (error url_not_in_prior_context). Organisation Console settings can also disable or restrict web tools.
- Advisors (multi-agent): advice from Opus 5.5, Fable 5.1, Sonnet 5.5, Haiku 5.5, Opus 5 and Fable 5 is redacted from the transcript by design.
- Outcomes: a grader checks work against a rubric (span.outcome_evaluation_end: satisfied / needs_revision / max_iterations_reached / failed).

Write for a capable non-specialist. Be specific and brief:
1. **What happened** — two or three sentences.
2. **What went wrong** (if anything) — each issue with the event ids that show it, and its root cause: instructions, tool permissions, missing tools, environment networking, credentials, the model or effort level, or the user's request.
3. **Fixes** — for changes to the agent, call propose_agent_change (one call per independent fix; full new values). For changes you can't make directly (environment networking, vault credentials, a spending cap, the prompt the user sent), say exactly what to change and where in Page Orbit (Environments, Vaults, the session's spending cap).
If nothing went wrong, say so and suggest at most one or two improvements (for cost, speed or reliability). Never invent events. Never ask for or repeat secrets.`;

function condenseEvents(events){
  const t0 = events.find(e=>e.processed_at)?.processed_at;
  const rel = (e)=> t0 && e.processed_at ? "+"+((toMs(e.processed_at)-toMs(t0))/1000).toFixed(1)+"s" : "+?";
  const clip = (s, n)=>{ s = String(s ?? ""); return s.length > n ? s.slice(0, n) + ` …[${s.length-n} more chars]` : s; };
  const starts = new Map();
  const lines = [];
  for(const e of events){
    const head = `[${rel(e)}] ${e.id||"-"} ${e.type}`;
    const t = e.type;
    let body = "";
    if(t==="user.message" || t==="agent.message" || t==="system.message") body = clip(blocksText(e.content), 4000);
    else if(/tool_use$/.test(t)) body = `${e.mcp_server_name ? e.mcp_server_name+"/" : ""}${e.name} permission=${e.evaluated_permission||"-"}${e.evaluation?.type==="auto" ? " auto="+JSON.stringify(e.evaluation.evaluated_permission) : ""}${e.session_thread_id ? " thread="+e.session_thread_id : ""} input=${clip(JSON.stringify(e.input), 1500)}`;
    else if(/tool_result$/.test(t)) body = `for=${e.tool_use_id||e.mcp_tool_use_id||e.custom_tool_use_id} ${e.is_error ? "ERROR " : ""}${clip(blocksText(e.content), 2000)}`;
    else if(t==="user.tool_confirmation") body = `for=${e.tool_use_id} ${e.result}${e.deny_message ? " message="+clip(e.deny_message, 300) : ""}`;
    else if(t==="session.error") body = clip(JSON.stringify(e.error), 1200);
    else if(t==="session.status_idle") body = JSON.stringify(e.stop_reason||{}) + (e.stop_details ? " details="+JSON.stringify(e.stop_details) : "");
    else if(t==="span.model_request_start"){ starts.set(e.id, e); continue; }
    else if(t==="span.model_request_end"){ const st = starts.get(e.model_request_start_id); const u = e.model_usage||{}; body = `${st ? ((toMs(e.processed_at)-toMs(st.processed_at))/1000).toFixed(1)+"s " : ""}in=${u.input_tokens} out=${u.output_tokens} cache_read=${u.cache_read_input_tokens}${e.is_error ? " ERROR" : ""}`; }
    else if(t==="user.define_outcome") body = `goal=${clip(e.description, 1000)} rubric=${clip(e.rubric?.content || JSON.stringify(e.rubric), 2000)} max_iterations=${e.max_iterations}`;
    else if(t==="span.outcome_evaluation_end") body = `round ${e.iteration+1}: ${e.result} — ${clip(e.explanation, 1500)}`;
    else if(t==="session.usage") body = `cost_cents=${e.usage?.list_cost?.amount ?? "?"}`;
    else if(t==="agent.thread_message_sent" || t==="agent.thread_message_received") body = `${e.to_agent_name||e.from_agent_name||""}: ${clip(blocksText(e.content), 1500)}`;
    else if(t==="session.thread_created") body = e.agent_name;
    else if(t.startsWith("workflow_run.")) body = clip(JSON.stringify({name:e.name, result:e.result, error:e.error}), 600);
    else if(t==="span.outcome_evaluation_ongoing" || t==="agent.thinking") continue;
    lines.push(body ? `${head}: ${body}` : head);
  }
  let text = lines.join("\n");
  if(text.length > DIAG_MAX_CHARS){
    const head = text.slice(0, DIAG_MAX_CHARS*0.25), tail = text.slice(-DIAG_MAX_CHARS*0.75);
    text = head + `\n\n…[${text.length - DIAG_MAX_CHARS} characters of the middle of the log omitted]…\n\n` + tail;
  }
  return text;
}

async function openDiagnose(sess, events){
  if(!getClient()){ openSettings(); return; }
  const thread = h("div",{class:"diag"});
  const scroller = h("div",{style:"flex:1;min-height:0;overflow:auto;padding:4px 2px 10px"}, thread);
  const ta = h("textarea",{rows:1, placeholder:"Ask a follow-up about this session…"});
  const send = h("button",{class:"send", title:"Send"}, icon("up"));
  const modelSel = select(MODELS.map(m=>({value:m.id, label:m.name})), settings.diagModel, {style:"height:30px;width:auto;font-size:12.5px"});
  const costEl = h("span",{class:"hint"});
  const cbar = h("div",{class:"composerBar"}, h("span",{class:"sp"}), send);
  const cbox = h("div",{class:"composerBox", style:"margin:8px 0 0;max-width:none"}, ta, cbar);
  const box = h("div",{class:"modal wide", style:"width:min(920px,100%);height:min(86vh,1000px);display:flex;flex-direction:column"},
    h("div",{class:"row", style:"margin-bottom:10px"}, h("h2",{style:"margin:0"}, "Diagnose"), h("span",{class:"sp"}), costEl, modelSel, h("button",{class:"iconBtn", title:"Close", onclick:()=>bg.close()}, icon("x"))),
    h("p",{class:"lead", style:"margin:0 0 10px"}, `Sends this session’s ${events.length} events and the agent’s setup to ${modelName(settings.diagModel)} to find what went wrong. Nothing changes unless you apply a fix.`),
    scroller, cbox);
  const dict = window.PageDictation?.mount({key:"diagnose", ta, bar:cbar, before:send, lineBefore:cbox, app:"Page Orbit", onWrite:()=>{}});
  const bg = modal(box, ()=>{ dict?.cancel(); dict?.destroy(); });
  modelSel.onchange = ()=>{ settings.diagModel = modelSel.value; saveSettings(); };
  const scroll = ()=> requestAnimationFrame(()=>{ scroller.scrollTop = scroller.scrollHeight; });
  let spent = 0, busy = false;

  thread.append(h("div",{class:"hint"},"Loading the agent’s current setup…"));
  const current = await C().beta.agents.retrieve(sess.agent.id).catch(()=>null);
  thread.replaceChildren();
  const ran = pickConfig(sess.agent);
  const intro = [
    `Session ${sess.id} (status: ${sess.status}${sess.title ? `, title: ${sess.title}` : ""}, environment ${sess.environment_id}${sess.budget ? `, spending cap ${sess.budget.max_list_cost?.amount} cents` : ""}).`,
    `\n## Setup the session ran with (agent ${sess.agent.id} version ${sess.agent.version})\n\`\`\`json\n${JSON.stringify(ran, null, 2)}\n\`\`\``,
    current && current.version !== sess.agent.version ? `\n## The agent's CURRENT saved setup (version ${current.version}) — propose changes against this one\n\`\`\`json\n${JSON.stringify(pickConfig(current), null, 2)}\n\`\`\`` : `\n(The agent's current saved setup is the same version.)`,
    sess.usage?.list_cost ? `\nSession list cost so far: $${(Number(sess.usage.list_cost.amount)/100).toFixed(2)}.` : "",
    `\n## Event log\n${condenseEvents(events)}`,
    `\n\nDiagnose this session.`,
  ].join("\n");
  const messages = [{role:"user", content:[{type:"text", text:intro, cache_control:{type:"ephemeral"}}]}];

  async function turn(){
    busy = true; send.disabled = true;
    for(let round=0; round<5; round++){
      const out = h("div",{class:"ev agent"}, h("div",{class:"av"}, icon("pulse")), h("div",{class:"body"}, h("div",{class:"who"}, modelName(settings.diagModel)), h("div",{class:"md"}, h("span",{class:"dots"}, h("i"),h("i"),h("i")))));
      thread.append(out); scroll();
      let text = "", final;
      try{
        const stream = C().beta.messages.stream({model:settings.diagModel, max_tokens:16000, thinking:{type:"adaptive"}, output_config:{effort:settings.diagEffort||"high"},
          system:DIAG_SYSTEM, messages, tools:[DIAG_TOOL]});
        let raf = 0;
        stream.on("text", (d)=>{ text += d; if(!raf) raf = requestAnimationFrame(()=>{ raf = 0; out.querySelector(".md").replaceWith(renderMd(text)); scroll(); }); });
        final = await stream.finalMessage();
      }catch(e){ out.querySelector(".body").append(h("div",{class:"err"}, errText(e))); break; }
      out.querySelector(".md").replaceWith(renderMd(text || (final.content.some(b=>b.type==="tool_use") ? "" : "(no text)")));
      const c = costOf(final.model || settings.diagModel, final.usage); if(c) { spent += c; costEl.textContent = "~"+money(spent)+" so far"; }
      messages.push({role:"assistant", content:final.content});
      const uses = final.content.filter(b=>b.type==="tool_use");
      for(const u of uses) thread.append(proposalCard(u.input, current || sess.agent));
      scroll();
      if(final.stop_reason!=="tool_use" || !uses.length) break;
      messages.push({role:"user", content:uses.map(u=>({type:"tool_result", tool_use_id:u.id, content:"Shown to the user as a diff. They will decide whether to apply it."}))});
    }
    busy = false; send.disabled = false; ta.focus();
  }
  async function ask(){
    const q = ta.value.trim(); if(!q || busy) return;
    dict?.cancel(); ta.value = ""; thread.append(h("div",{class:"diagMsg me"}, q)); scroll();   // dictation stops before the box is cleared
    messages.push({role:"user", content:[{type:"text", text:q}]});
    await turn();
  }
  send.onclick = ask;
  ta.onkeydown = (e)=>{ if(e.key==="Enter" && !e.shiftKey && !e.isComposing){ e.preventDefault(); fire(ask()); } };
  fire(turn());
}

function proposalCard(p, agent){
  const changes = p?.changes || {};
  const allowed = ["system","description","model","tools","mcp_servers","skills"];
  const patch = Object.fromEntries(Object.entries(changes).filter(([k])=>allowed.includes(k)));
  const before = pickConfig(agent), after = {...before, ...patch};
  if(patch.model && before.model && typeof before.model==="object") after.model = {...before.model, ...patch.model};
  const keys = Object.keys(patch);
  const status = h("span",{class:"hint"});
  const apply = h("button",{class:"btn primary"}, icon("check"), `Apply as version ${agent.version+1}`);
  apply.onclick = async()=>{
    apply.disabled = true; status.textContent = "Saving…";
    try{
      const upd = {version:agent.version}; for(const k of keys) upd[k] = after[k];
      const n = await C().beta.agents.update(agent.id, upd, NO_RETRY);
      agentCache = null; agent.version = n.version; Object.assign(agent, n);
      status.textContent = n.version ? `Saved as version ${n.version}. New sessions use it; this one keeps the version it started with.` : "Saved.";
      apply.replaceWith(h("button",{class:"btn", onclick:()=>{ document.querySelector(".modalBg")?.close?.(); fire(newSessionDialog({agent:n})); }}, icon("play"), "Try it in a new session"));
    }catch(e){ apply.disabled = false; status.textContent = e.status===409 ? "The agent changed since this proposal was made — open the agent and apply it by hand." : errText(e); status.className = "err"; }
  };
  return h("div",{class:"proposal"},
    h("div",{class:"ph"}, icon("pen"), p?.title || "Proposed change"),
    h("div",{class:"why"}, renderMd(p?.rationale || "")),
    keys.length ? diffView(before, after) : h("p",{class:"hint"},"(No applicable changes in this proposal.)"),
    keys.length ? h("div",{class:"row"}, status, h("span",{class:"sp"}), apply) : "");
}
