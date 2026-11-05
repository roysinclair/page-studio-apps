//! Local apps: MCP servers that run on this computer (the "stdio" kind Claude Desktop uses).
//! Page Aura starts each server as a child process, speaks JSON-RPC over its stdin/stdout,
//! and exposes its tools to the model as client tools. Every call is approved in the UI
//! unless the user chose "always allow" for that tool in that chat.
//!
//! Server definitions live in <app data>/local-apps.json; their environment variables
//! (often API tokens) live in the system keychain and are only read here, when starting.

use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use std::collections::HashMap;
use std::path::{Path, PathBuf};
use std::process::Stdio;
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::Arc;
use tauri::State;
use tokio::io::{AsyncBufReadExt, AsyncWriteExt, BufReader};
use tokio::process::{Child, ChildStdin, Command};
use tokio::sync::{oneshot, Mutex};

use crate::secrets;

const PROTOCOL: &str = "2025-06-18";
const CALL_TIMEOUT: u64 = 180;

#[derive(Clone, Serialize, Deserialize)]
pub struct ServerDef {
    pub id: String,
    pub name: String,
    pub command: String,
    #[serde(default)]
    pub args: Vec<String>,
    #[serde(default)]
    pub has_env: bool,
}

#[derive(Clone, Serialize)]
pub struct ToolDef {
    server_id: String,
    server_name: String,
    name: String,
    description: String,
    input_schema: Value,
}

struct Running {
    child: Child,
    stdin: Arc<Mutex<ChildStdin>>,
    pending: Arc<Mutex<HashMap<u64, oneshot::Sender<Value>>>>,
    tools: Vec<ToolDef>,
    stderr: Arc<Mutex<Vec<String>>>,
}

pub struct LocalApps {
    file: PathBuf,
    defs: Mutex<Vec<ServerDef>>,
    running: Mutex<HashMap<String, Running>>,
    seq: AtomicU64,
}

impl LocalApps {
    pub fn load(dir: &Path) -> Self {
        let file = dir.join("local-apps.json");
        let defs = std::fs::read_to_string(&file).ok().and_then(|s| serde_json::from_str(&s).ok()).unwrap_or_default();
        Self { file, defs: Mutex::new(defs), running: Mutex::new(HashMap::new()), seq: AtomicU64::new(1) }
    }
    async fn save(&self, defs: &[ServerDef]) -> Result<(), String> {
        tokio::fs::write(&self.file, serde_json::to_string_pretty(defs).map_err(|e| e.to_string())?).await.map_err(|e| e.to_string())
    }
}

fn valid_id(id: &str) -> bool {
    !id.is_empty() && id.len() <= 40 && id.chars().all(|c| c.is_ascii_alphanumeric() || c == '_')
}
fn env_secret(id: &str) -> Option<String> {
    secrets::app_secret_name(&format!("localenv_{id}"))
}

/// GUI apps on macOS/Linux don't inherit the shell's PATH, so `npx`, `uvx` and friends
/// aren't found. Add the usual install locations.
fn augmented_path() -> String {
    let mut parts: Vec<String> = std::env::var("PATH").map(|p| std::env::split_paths(&p).map(|x| x.display().to_string()).collect()).unwrap_or_default();
    if !cfg!(windows) {
        let home = dirs::home_dir().map(|h| h.display().to_string()).unwrap_or_default();
        for extra in ["/opt/homebrew/bin", "/usr/local/bin", "/usr/bin", "/bin"] {
            parts.push(extra.into());
        }
        for extra in [".local/bin", ".cargo/bin", ".bun/bin", ".deno/bin", ".volta/bin"] {
            parts.push(format!("{home}/{extra}"));
        }
        if let Ok(rd) = std::fs::read_dir(format!("{home}/.nvm/versions/node")) {
            for e in rd.flatten() {
                parts.push(e.path().join("bin").display().to_string());
            }
        }
    }
    std::env::join_paths(parts.iter()).map(|p| p.to_string_lossy().to_string()).unwrap_or_default()
}

async fn send(stdin: &mut ChildStdin, msg: &Value) -> Result<(), String> {
    let mut line = serde_json::to_vec(msg).map_err(|e| e.to_string())?;
    line.push(b'\n');
    stdin.write_all(&line).await.map_err(|e| format!("couldn't talk to the app: {e}"))?;
    stdin.flush().await.map_err(|e| e.to_string())
}

impl LocalApps {
    async fn request(&self, id: &str, method: &str, params: Value) -> Result<Value, String> {
        let rid = self.seq.fetch_add(1, Ordering::SeqCst);
        let (stdin, pending) = {
            let running = self.running.lock().await;
            let r = running.get(id).ok_or("app is not running")?;
            (r.stdin.clone(), r.pending.clone())
        };
        let (tx, rx) = oneshot::channel();
        pending.lock().await.insert(rid, tx);
        send(&mut *stdin.lock().await, &json!({"jsonrpc":"2.0","id":rid,"method":method,"params":params})).await?;
        let resp = tokio::time::timeout(std::time::Duration::from_secs(CALL_TIMEOUT), rx)
            .await
            .map_err(|_| format!("the app didn't answer within {CALL_TIMEOUT} seconds"))?
            .map_err(|_| "the app stopped".to_string())?;
        if let Some(err) = resp.get("error") {
            return Err(err.get("message").and_then(|m| m.as_str()).unwrap_or("app error").to_string());
        }
        Ok(resp.get("result").cloned().unwrap_or(Value::Null))
    }

    async fn start(&self, def: &ServerDef) -> Result<(), String> {
        if self.running.lock().await.contains_key(&def.id) {
            return Ok(());
        }
        let mut cmd = if cfg!(windows) {
            // lets "npx", "uvx" and other .cmd launchers work, as in Claude Desktop configs
            let mut c = Command::new("cmd");
            c.arg("/C").arg(&def.command).args(&def.args);
            c
        } else {
            let mut c = Command::new(&def.command);
            c.args(&def.args);
            c
        };
        cmd.env("PATH", augmented_path());
        if def.has_env {
            if let Some(raw) = env_secret(&def.id).and_then(|n| secrets::get(&n)) {
                if let Ok(map) = serde_json::from_str::<HashMap<String, String>>(&raw) {
                    cmd.envs(map);
                }
            }
        }
        #[cfg(windows)]
        cmd.creation_flags(0x0800_0000); // CREATE_NO_WINDOW
        cmd.stdin(Stdio::piped()).stdout(Stdio::piped()).stderr(Stdio::piped()).kill_on_drop(true);
        let mut child = cmd.spawn().map_err(|e| format!("couldn't start “{}”: {e}", def.command))?;
        let stdin = Arc::new(Mutex::new(child.stdin.take().ok_or("no stdin")?));
        let stdout = child.stdout.take().ok_or("no stdout")?;
        let stderr_pipe = child.stderr.take().ok_or("no stderr")?;
        let pending: Arc<Mutex<HashMap<u64, oneshot::Sender<Value>>>> = Arc::default();
        let stderr: Arc<Mutex<Vec<String>>> = Arc::default();

        // stdout: route responses to waiting requests; answer the server's own requests
        // (ping, roots) so it never stalls; ignore notifications
        let (p, w) = (pending.clone(), stdin.clone());
        tokio::spawn(async move {
            let mut lines = BufReader::new(stdout).lines();
            while let Ok(Some(line)) = lines.next_line().await {
                let Ok(msg) = serde_json::from_str::<Value>(&line) else { continue };
                if msg.get("method").is_some() {
                    if let Some(id) = msg.get("id").cloned() {
                        let reply = match msg["method"].as_str() {
                            Some("ping") => json!({"jsonrpc":"2.0","id":id,"result":{}}),
                            Some("roots/list") => json!({"jsonrpc":"2.0","id":id,"result":{"roots":[]}}),
                            _ => json!({"jsonrpc":"2.0","id":id,"error":{"code":-32601,"message":"not supported by Page Aura"}}),
                        };
                        let _ = send(&mut *w.lock().await, &reply).await;
                    }
                    continue;
                }
                if let Some(id) = msg.get("id").and_then(|v| v.as_u64()) {
                    if let Some(tx) = p.lock().await.remove(&id) {
                        let _ = tx.send(msg);
                    }
                }
            }
            p.lock().await.clear(); // the app exited: wake everyone waiting
        });
        let e = stderr.clone();
        tokio::spawn(async move {
            let mut lines = BufReader::new(stderr_pipe).lines();
            while let Ok(Some(line)) = lines.next_line().await {
                let mut v = e.lock().await;
                v.push(line);
                let n = v.len();
                if n > 40 {
                    v.drain(0..n - 40);
                }
            }
        });
        self.running.lock().await.insert(def.id.clone(), Running { child, stdin: stdin.clone(), pending, tools: vec![], stderr });

        let init = async {
            self.request(&def.id, "initialize", json!({
                "protocolVersion": PROTOCOL,
                "capabilities": {},
                "clientInfo": {"name": "Page Aura", "version": env!("CARGO_PKG_VERSION")}
            }))
            .await?;
            send(&mut *stdin.lock().await, &json!({"jsonrpc":"2.0","method":"notifications/initialized"})).await?;
            let mut tools = Vec::new();
            let mut cursor: Option<String> = None;
            for _ in 0..20 {
                let params = match &cursor { Some(c) => json!({"cursor": c}), None => json!({}) };
                let res = self.request(&def.id, "tools/list", params).await?;
                for t in res.get("tools").and_then(|t| t.as_array()).cloned().unwrap_or_default() {
                    let Some(name) = t.get("name").and_then(|n| n.as_str()) else { continue };
                    tools.push(ToolDef {
                        server_id: def.id.clone(),
                        server_name: def.name.clone(),
                        name: name.to_string(),
                        description: t.get("description").and_then(|d| d.as_str()).unwrap_or("").chars().take(2000).collect(),
                        input_schema: t.get("inputSchema").cloned().unwrap_or(json!({"type":"object"})),
                    });
                }
                cursor = res.get("nextCursor").and_then(|c| c.as_str()).map(String::from);
                if cursor.is_none() {
                    break;
                }
            }
            Ok::<Vec<ToolDef>, String>(tools)
        };
        let outcome = match tokio::time::timeout(std::time::Duration::from_secs(60), init).await {
            Ok(r) => r,
            Err(_) => Err("the app didn't finish starting within 60 seconds".into()),
        };
        match outcome {
            Ok(tools) => {
                if let Some(r) = self.running.lock().await.get_mut(&def.id) {
                    r.tools = tools;
                }
                Ok(())
            }
            Err(reason) => {
                let log = self.stop_inner(&def.id).await;
                Err(if log.is_empty() { reason } else { format!("{reason}\n{log}") })
            }
        }
    }

    async fn stop_inner(&self, id: &str) -> String {
        if let Some(mut r) = self.running.lock().await.remove(id) {
            let _ = r.child.start_kill();
            return r.stderr.lock().await.iter().rev().take(6).rev().cloned().collect::<Vec<_>>().join("\n");
        }
        String::new()
    }
}

#[derive(Serialize)]
pub struct ServerInfo {
    #[serde(flatten)]
    def: ServerDef,
    running: bool,
    tools: usize,
}

#[tauri::command]
pub async fn local_list(apps: State<'_, LocalApps>) -> Result<Vec<ServerInfo>, String> {
    let defs = apps.defs.lock().await.clone();
    let running = apps.running.lock().await;
    Ok(defs
        .into_iter()
        .map(|d| {
            let r = running.get(&d.id);
            ServerInfo { running: r.is_some(), tools: r.map(|r| r.tools.len()).unwrap_or(0), def: d }
        })
        .collect())
}

#[derive(Deserialize)]
pub struct NewServer {
    name: String,
    command: String,
    #[serde(default)]
    args: Vec<String>,
    /// KEY → value; stored in the keychain. `None` keeps whatever is stored.
    env: Option<HashMap<String, String>>,
}

fn new_id() -> String {
    format!("l{}", std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).map(|d| d.as_micros()).unwrap_or(0))
}

async fn add_def(apps: &LocalApps, s: NewServer) -> Result<String, String> {
    let name: String = s.name.trim().chars().take(40).collect();
    if name.is_empty() || s.command.trim().is_empty() {
        return Err("a name and a command are required".into());
    }
    let id = new_id();
    let mut has_env = false;
    if let Some(env) = s.env.filter(|e| !e.is_empty()) {
        if env.keys().any(|k| k.is_empty() || !k.chars().all(|c| c.is_ascii_alphanumeric() || c == '_')) {
            return Err("environment variable names may only use letters, digits and _".into());
        }
        let raw = serde_json::to_string(&env).map_err(|e| e.to_string())?;
        secrets::secret_set(format!("localenv_{id}"), raw)?;
        has_env = true;
    }
    let mut defs = apps.defs.lock().await;
    defs.push(ServerDef { id: id.clone(), name, command: s.command.trim().into(), args: s.args, has_env });
    apps.save(&defs).await?;
    Ok(id)
}

#[tauri::command]
pub async fn local_add(apps: State<'_, LocalApps>, server: NewServer) -> Result<String, String> {
    add_def(&apps, server).await
}

#[tauri::command]
pub async fn local_remove(apps: State<'_, LocalApps>, id: String) -> Result<(), String> {
    if !valid_id(&id) {
        return Err("invalid id".into());
    }
    apps.stop_inner(&id).await;
    let mut defs = apps.defs.lock().await;
    if let Some(d) = defs.iter().find(|d| d.id == id) {
        if d.has_env {
            let _ = secrets::secret_clear(format!("localenv_{id}"));
        }
    }
    defs.retain(|d| d.id != id);
    apps.save(&defs).await
}

/// Starts the chosen apps if needed and returns their tools.
#[tauri::command]
pub async fn local_tools(apps: State<'_, LocalApps>, ids: Vec<String>) -> Result<Vec<Value>, String> {
    let defs = apps.defs.lock().await.clone();
    let mut out = Vec::new();
    for id in ids {
        let Some(def) = defs.iter().find(|d| d.id == id) else { continue };
        match apps.start(def).await {
            Ok(()) => {
                if let Some(r) = apps.running.lock().await.get(&id) {
                    out.extend(r.tools.iter().map(|t| serde_json::to_value(t).unwrap_or(Value::Null)));
                }
            }
            Err(e) => out.push(json!({"server_id": id, "server_name": def.name, "error": e})),
        }
    }
    Ok(out)
}

#[derive(Serialize)]
pub struct CallResult {
    text: String,
    is_error: bool,
}

#[tauri::command]
pub async fn local_call(apps: State<'_, LocalApps>, id: String, tool: String, args: Value) -> Result<CallResult, String> {
    let def = apps.defs.lock().await.iter().find(|d| d.id == id).cloned().ok_or("unknown app")?;
    apps.start(&def).await?;
    let res = apps.request(&id, "tools/call", json!({"name": tool, "arguments": args})).await?;
    let mut text = String::new();
    for c in res.get("content").and_then(|c| c.as_array()).cloned().unwrap_or_default() {
        match c.get("type").and_then(|t| t.as_str()) {
            Some("text") => text.push_str(c.get("text").and_then(|t| t.as_str()).unwrap_or("")),
            Some(other) => text.push_str(&format!("[{other} content omitted]")),
            None => {}
        }
        text.push('\n');
    }
    if text.trim().is_empty() {
        if let Some(sc) = res.get("structuredContent") {
            text = sc.to_string();
        }
    }
    if text.len() > 200_000 {
        text.truncate(200_000);
        text.push_str("\n…(truncated)");
    }
    Ok(CallResult { text, is_error: res.get("isError").and_then(|v| v.as_bool()).unwrap_or(false) })
}

#[tauri::command]
pub async fn local_stop(apps: State<'_, LocalApps>, id: String) -> Result<(), String> {
    apps.stop_inner(&id).await;
    Ok(())
}

/// Imports the `mcpServers` from Claude Desktop's configuration file, if present.
#[tauri::command]
pub async fn local_import_claude(apps: State<'_, LocalApps>) -> Result<usize, String> {
    let candidates: Vec<PathBuf> = [
        dirs::config_dir().map(|d| d.join("Claude").join("claude_desktop_config.json")),
        dirs::home_dir().map(|h| h.join("Library/Application Support/Claude/claude_desktop_config.json")),
        dirs::home_dir().map(|h| h.join(".config/Claude/claude_desktop_config.json")),
    ]
    .into_iter()
    .flatten()
    .collect();
    let Some(path) = candidates.into_iter().find(|p| p.is_file()) else {
        return Err("Claude Desktop's configuration wasn't found on this computer.".into());
    };
    let cfg: Value = serde_json::from_str(&tokio::fs::read_to_string(&path).await.map_err(|e| e.to_string())?).map_err(|e| e.to_string())?;
    let existing: Vec<(String, String)> = apps.defs.lock().await.iter().map(|d| (d.name.clone(), d.command.clone())).collect();
    let mut n = 0;
    for (name, s) in cfg.get("mcpServers").and_then(|m| m.as_object()).cloned().unwrap_or_default() {
        let Some(command) = s.get("command").and_then(|c| c.as_str()) else { continue }; // remote (url) servers are skipped
        if existing.iter().any(|(n2, c2)| n2 == &name && c2 == command) {
            continue;
        }
        let args = s.get("args").and_then(|a| a.as_array()).map(|a| a.iter().filter_map(|x| x.as_str().map(String::from)).collect()).unwrap_or_default();
        let env = s.get("env").and_then(|e| e.as_object()).map(|e| e.iter().filter_map(|(k, v)| v.as_str().map(|v| (k.clone(), v.to_string()))).collect());
        add_def(&apps, NewServer { name, command: command.into(), args, env }).await?;
        n += 1;
    }
    Ok(n)
}

#[cfg(test)]
mod tests {
    use super::*;

    /// Starts a real stdio MCP server (a tiny Node script) and exercises the protocol.
    #[tokio::test]
    async fn talks_to_a_real_stdio_server() {
        if std::process::Command::new("node").arg("--version").output().is_err() {
            eprintln!("node not installed; skipping");
            return;
        }
        let dir = std::env::temp_dir().join(format!("pa-mcp-{}", std::process::id()));
        std::fs::create_dir_all(&dir).unwrap();
        let script = dir.join("server.js");
        std::fs::write(&script, r#"
const rl = require('readline').createInterface({ input: process.stdin });
const out = (m) => process.stdout.write(JSON.stringify(m) + '\n');
let pinged = false;
rl.on('line', (line) => {
  const m = JSON.parse(line);
  if (m.method === 'initialize') { out({ jsonrpc: '2.0', id: m.id, result: { protocolVersion: m.params.protocolVersion, capabilities: { tools: {} }, serverInfo: { name: 'test', version: '1' } } }); out({ jsonrpc: '2.0', id: 'srv-1', method: 'ping' }); }
  else if (m.id === 'srv-1') { pinged = true; }
  else if (m.method === 'tools/list') out({ jsonrpc: '2.0', id: m.id, result: { tools: [{ name: 'add', description: 'Adds two numbers', inputSchema: { type: 'object', properties: { a: { type: 'number' }, b: { type: 'number' } } } }] } });
  else if (m.method === 'tools/call') out({ jsonrpc: '2.0', id: m.id, result: { content: [{ type: 'text', text: `sum=${m.params.arguments.a + m.params.arguments.b} env=${process.env.PA_TEST || ''} pinged=${pinged}` }] } });
});
"#).unwrap();
        let apps = LocalApps::load(&dir);
        let def = ServerDef { id: "ltest".into(), name: "Test".into(), command: "node".into(), args: vec![script.display().to_string()], has_env: false };
        apps.start(&def).await.expect("start");
        let tools = apps.running.lock().await.get("ltest").unwrap().tools.clone();
        assert_eq!(tools.len(), 1);
        assert_eq!(tools[0].name, "add");
        let res = apps.request("ltest", "tools/call", json!({"name":"add","arguments":{"a":2,"b":3}})).await.expect("call");
        let text = res["content"][0]["text"].as_str().unwrap();
        assert!(text.starts_with("sum=5"), "{text}");
        assert!(text.ends_with("pinged=true"), "server's ping wasn't answered: {text}");
        apps.stop_inner("ltest").await;
        assert!(apps.running.lock().await.is_empty());
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[tokio::test]
    async fn reports_a_server_that_fails_to_start() {
        let dir = std::env::temp_dir().join(format!("pa-mcp-bad-{}", std::process::id()));
        std::fs::create_dir_all(&dir).unwrap();
        let apps = LocalApps::load(&dir);
        let def = ServerDef { id: "lbad".into(), name: "Bad".into(), command: "definitely-not-a-real-command-xyz".into(), args: vec![], has_env: false };
        let err = apps.start(&def).await.unwrap_err();
        assert!(!err.is_empty());
        assert!(apps.running.lock().await.is_empty());
        let _ = std::fs::remove_dir_all(&dir);
    }
}
