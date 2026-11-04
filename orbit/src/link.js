/* ================= Page Power link (Page Studio) =================
   Page Power, Page Studio's app for macOS and Linux, pages your phone when a decision is yours. With the link switched
   on (Settings ▸ Page Power on this computer; desktop app on macOS and Linux), Page Orbit checks your sessions in
   the background and tells Page Power which agents are working, which are waiting for your approval, and
   when one finishes. Allow / Deny, a message, or Stop from the phone come back here and go to the agent
   through Anthropic's API. Wire format: Page Aura's (docs/AURA-LINK.md in the Page repo), with sessions
   as "chats"; Page Orbit's specifics are in docs/ORBIT-LINK.md. Agents run in Anthropic's cloud, so
   Page Power never keeps the computer awake for them. */
const orbitLink = {supported:false, connected:false, timer:0, polling:false, known:new Map(), lastState:"", version:""};
const OL_ID = /^[A-Za-z0-9_-]{1,64}$/;
const OL_WINDOW = 48*3600e3;
function olSend(obj){ if(orbitLink.connected) invoke("page_link_send",{line:JSON.stringify(obj)}).catch(()=>{}); }
const olPlain = (t)=> String(t||"").replace(/```[\s\S]*?```/g," (code) ").replace(/[#*_`>|]/g,"").replace(/\s+/g," ").trim();

/** What one session is doing now: from its object plus, when idle, its latest events. */
async function olInspect(s, prev){
  const info = {id:s.id, title:(s.title || s.agent?.name || "Agent session").slice(0,200), model:modelId(s.agent?.model) || "", agent:s.agent?.name || "Agent",
    status:s.status, updatedAt:s.updated_at, since:prev?.since || toMs(s.updated_at) || Date.now(), approval:null, stop:null, snippet:prev?.snippet || ""};
  if(s.status==="running" || s.status==="rescheduling"){ info.since = prev?.status==="running" ? prev.since : Date.now(); return info; }
  if(prev && prev.updatedAt===s.updated_at && prev.status===s.status){ return {...prev}; }   // nothing changed since last look
  const evs = (await C().beta.sessions.events.list(s.id, {order:"desc", limit:60})).data || [];
  const idle = evs.find(e=>e.type==="session.status_idle");
  info.stop = idle?.stop_reason?.type || (s.status==="terminated" ? "terminated" : null);
  const msg = evs.find(e=>e.type==="agent.message"); if(msg) info.snippet = olPlain(blocksText(msg.content)).slice(-600);
  if(idle?.stop_reason?.type==="requires_action"){
    for(const eid of idle.stop_reason.event_ids||[]){
      const ev = evs.find(e=>e.id===eid);
      if(ev && (ev.type==="agent.tool_use" || ev.type==="agent.mcp_tool_use") && ev.evaluated_permission==="ask" && OL_ID.test(ev.id)){
        info.approval = {id:ev.id, server:(ev.mcp_server_name || info.agent).slice(0,80), tool:String(ev.name||"").slice(0,80), args:JSON.stringify(ev.input ?? {}).slice(0,1500)};
        break;
      }
    }
  }
  return info;
}
async function olPoll(){
  if(!orbitLink.connected || orbitLink.polling || !getClient()) return;
  orbitLink.polling = true;
  try{
    const since = new Date(Date.now() - OL_WINDOW).toISOString();
    const r = await C().beta.sessions.list({limit:50, order:"desc", "created_at[gte]":since});
    const next = new Map();
    for(const s of r.data||[]){
      if(!OL_ID.test(s.id) || s.archived_at) continue;
      const prev = orbitLink.known.get(s.id);
      if(!prev && s.status!=="running" && s.status!=="rescheduling" && Date.now() - toMs(s.updated_at) > 15*60e3){ next.set(s.id, {id:s.id, status:s.status, updatedAt:s.updated_at, quiet:true}); continue; }
      const info = prev?.quiet && prev.updatedAt===s.updated_at ? prev : await olInspect(s, prev?.quiet ? null : prev).catch(()=>prev || null);
      if(!info) continue;
      next.set(s.id, info);
      // a turn ended since the last look: tell Page Power (it pages if you're away)
      const wasWorking = prev && !prev.quiet && (prev.status==="running" || prev.status==="rescheduling" || prev.approval);
      if(wasWorking && info.status!=="running" && info.status!=="rescheduling" && !info.approval && info.stop!=="requires_action"){
        const ok = info.stop==="end_turn";
        olSend({t:"finished", chatId:s.id, title:info.title, ok, stopped:false, at:Date.now(),
          snippet: ok ? (info.snippet || "Finished") : info.stop==="budget_reached" ? "Paused at its spending cap" : info.stop==="terminated" ? "The session stopped" : `Stopped: ${String(info.stop||"error").replace(/_/g," ")}`});
      }
    }
    orbitLink.known = next;
    const chats = [...next.values()].filter(i=>!i.quiet && (i.status==="running" || i.status==="rescheduling" || i.approval))
      .map(i=>({id:i.id, title:i.title, model:i.model, busy:!i.approval, since:i.since, approval:i.approval}));
    const frame = {t:"state", chats}, j = JSON.stringify(frame);
    if(j!==orbitLink.lastState || !orbitLink.sentAt || Date.now()-orbitLink.sentAt > 25000){ orbitLink.lastState = j; orbitLink.sentAt = Date.now(); olSend(frame); }
  }catch(e){ console.warn("Page Power link poll", e); }
  finally{ orbitLink.polling = false; }
}
function olSoon(ms=600){ if(!orbitLink.connected) return; clearTimeout(orbitLink.soon); orbitLink.soon = setTimeout(olPoll, ms); }
async function olCommand(cmd){
  const ack = (ok, detail)=>{ olSend({t:"ack", ref:cmd.id, ok, detail}); olSoon(1500); };
  const info = orbitLink.known.get(cmd.chatId);
  const sess = await C().beta.sessions.retrieve(cmd.chatId).catch(()=>null);
  if(!sess) return ack(false, "That session no longer exists");
  try{
    if(cmd.t==="approve"){
      if(!info?.approval || info.approval.id!==cmd.approvalId) return ack(false, "That request was already answered");
      await C().beta.sessions.events.send(sess.id, {events:[{type:"user.tool_confirmation", tool_use_id:cmd.approvalId, result: cmd.decision==="once" ? "allow" : "deny",
        ...(cmd.decision==="once" ? {} : {deny_message:"Denied from your phone"})}]}, NO_RETRY);
      info.updatedAt = null; olSoon(1500);   // look again soon; the page closes on this ack
      return ack(true, cmd.decision==="once" ? "Allowed once" : "Denied");
    }
    if(cmd.t==="send"){
      if(sess.status==="running" || sess.status==="rescheduling") return ack(false, "Page Orbit is still working in that session");
      if(sess.status==="terminated" || sess.archived_at) return ack(false, "That session has ended");
      if(info?.approval) return ack(false, "A tool request is waiting — answer it first");
      await C().beta.sessions.events.send(sess.id, {events:[{type:"user.message", content:[{type:"text", text:cmd.text}]}]}, NO_RETRY);
      olSoon(1500); return ack(true, "Sent to the agent");
    }
    if(cmd.t==="stop"){
      if(sess.status!=="running" && sess.status!=="rescheduling") return ack(true, "Nothing to stop");
      await C().beta.sessions.events.send(sess.id, {events:[{type:"user.interrupt"}]}, NO_RETRY);
      olSoon(1500); return ack(true, "Stopping at the next safe point");
    }
  }catch(e){
    return ack(false, e.status===400 ? "That request was already answered" : short(errText(e), 180));
  }
}
function renderOrbitLinkStatus(){
  const el = document.getElementById("olStatus"); if(!el) return;
  el.textContent = !settings.pageLink ? "" : orbitLink.connected ? "● Connected to Page Power" : "Waiting for Page Power… Is it running, with its Page Orbit switch on (Preferences ▸ Agents)?";
  el.style.color = orbitLink.connected ? "var(--ok)" : "";
}
async function initOrbitLink(){
  if(!DESKTOP || DEMO || !window.__TAURI__.event) return;
  try{ const label = window.__TAURI__.window?.getCurrentWindow?.().label; if(label && label!=="main") return; }catch{}
  const st = await invoke("page_link_status").catch(()=>null); if(!st?.supported) return;
  orbitLink.supported = true;
  orbitLink.version = await window.__TAURI__.app?.getVersion?.().catch(()=>"") || "";
  await window.__TAURI__.event.listen("page-link", (e)=>{
    const ev = e.payload || {};
    if(ev.kind==="connected"){
      Object.assign(orbitLink, {connected:true, lastState:"", sentAt:0});
      olSend({t:"hello", proto:1, app:"Page Orbit", version:orbitLink.version || "0"}); olPoll();
    } else if(ev.kind==="disconnected"){ orbitLink.connected = false; }
    else if(ev.kind==="command" && ev.cmd) olCommand(ev.cmd);
    renderOrbitLinkStatus();
  });
  if(settings.pageLink) await invoke("page_link_set",{enabled:true}).catch(()=>{});
  orbitLink.timer = setInterval(olPoll, 15000);
}
function orbitLinkSettings(){
  if(!orbitLink.supported) return "";
  const on = h("input",{type:"checkbox", class:"switch", checked:!!settings.pageLink});
  on.onchange = async()=>{ settings.pageLink = on.checked; saveSettings(); if(!on.checked) orbitLink.connected = false;
    await invoke("page_link_set",{enabled:on.checked}).catch(e=>toast(String(e))); renderOrbitLinkStatus(); };
  setTimeout(renderOrbitLinkStatus);
  return h("div",{class:"section"}, h("h3",{},"Page Power on this computer"),
    h("p",{class:"hint", style:"margin:4px 0 8px"},"Page Power is the Page Studio app that pages your phone when a decision is yours. Linked, it tells you when an agent is waiting for your approval or has finished, and you can allow, deny, reply or stop it from your phone — even when this window is closed to the menu bar."),
    h("label",{class:"toggle"}, h("span",{class:"tx"}, h("b",{},"Link Page Orbit to Page Power"), h("span",{},"Checks your recent sessions every 15 seconds while it’s on")), on),
    h("p",{class:"hint", id:"olStatus", style:"margin:2px 0 6px"}),
    h("p",{class:"hint", style:"margin:0"},"What reaches your phone, through your own relay: session titles, the agent’s name, the tool it wants to use with a short, redacted preview of its input, and the end of a finished reply. Never your API key."));
}
