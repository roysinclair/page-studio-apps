//! The link to Page Power (a Page Studio app) on the same Mac.
//!
//! Page Power keeps the Mac awake while agents work and pages your phone when a decision is
//! yours. It runs a Unix-socket server at `~/Library/Application Support/ClaudePowerMode/`:
//! `aura.sock` for Page Aura and `orbit.sock` for Page Orbit. This module is the client. It
//! connects only while the user has switched the link on, only to a socket owned by the
//! current user, and only passes known, well-formed commands to the page. The protocols are
//! documented in the Page repository: `docs/AURA-LINK.md` and `docs/ORBIT-LINK.md`.
//!
//! macOS only: on other systems `page_link_status` reports `supported: false`.

use serde::Serialize;
use serde_json::Value;
use std::sync::Mutex;
use tauri::{AppHandle, State};

/// One line (JSON + newline) is at most this long, both ways.
pub const MAX_LINE: usize = 256 * 1024;

#[derive(Default)]
pub struct PageLink(Mutex<LinkState>);

#[derive(Default)]
struct LinkState {
    enabled: bool,
    connected: bool,
    outbox: Option<tokio::sync::mpsc::UnboundedSender<String>>,
    task: Option<tauri::async_runtime::JoinHandle<()>>,
}

#[derive(Serialize)]
pub struct LinkStatus {
    supported: bool,
    enabled: bool,
    connected: bool,
    path: String,
}

/// Which link this app speaks: Page Aura (chat) or Page Orbit (managed agents).
#[derive(Clone, Copy, PartialEq, Debug)]
pub enum Kind {
    Aura,
    Orbit,
}

impl Kind {
    pub fn for_app(app: &AppHandle) -> Kind {
        if crate::desktop::is_orbit(app) { Kind::Orbit } else { Kind::Aura }
    }
    fn socket_name(self) -> &'static str {
        match self { Kind::Aura => "aura.sock", Kind::Orbit => "orbit.sock" }
    }
    /// Frames this app may send to Page Power.
    fn may_send(self, t: &str) -> bool {
        match self {
            Kind::Aura => matches!(t, "hello" | "state" | "finished" | "ack" | "chats" | "transcript"),
            Kind::Orbit => matches!(t, "hello" | "state" | "finished" | "ack"),
        }
    }
}

/// Where Page Power listens (docs/AURA-LINK.md §1). macOS: the Mac app's
/// `~/Library/Application Support/ClaudePowerMode/<name>`. Linux: paged's
/// `$XDG_DATA_HOME/page/<name>` (`~/.local/share/page`). Same protocol, same
/// 0600 socket and same-user check on both. Elsewhere there is no Page Power.
pub fn socket_path(kind: Kind) -> Option<std::path::PathBuf> {
    socket_path_in(dirs::data_dir()?, std::env::consts::OS, kind)
}

fn socket_path_in(data_dir: std::path::PathBuf, os: &str, kind: Kind) -> Option<std::path::PathBuf> {
    let folder = match os {
        "macos" => "ClaudePowerMode",
        "linux" => "page",
        _ => return None,
    };
    Some(data_dir.join(folder).join(kind.socket_name()))
}

fn is_id(v: &Value) -> bool {
    v.as_str().is_some_and(|s| !s.is_empty() && s.len() <= 64 && s.bytes().all(|b| b.is_ascii_alphanumeric() || b == b'_' || b == b'-'))
}
fn is_text(v: &Value, max_chars: usize) -> bool {
    v.as_str().is_some_and(|s| s.chars().count() <= max_chars)
}

/// Checks a command from Page Power. Anything that isn't a known, well-formed command is dropped.
pub fn validate_incoming(kind: Kind, v: &Value) -> bool {
    let Some(t) = v.get("t").and_then(Value::as_str) else { return false };
    // Page Orbit speaks Page Aura's wire format: its sessions travel as "chats" (docs/ORBIT-LINK.md).
    let id_ok = |k: &str| v.get(k).is_some_and(is_id);
    match t {
        "send" => id_ok("id") && id_ok("chatId") && v.get("text").is_some_and(|x| is_text(x, 8000)) && v["text"].as_str().is_some_and(|s| !s.trim().is_empty()),
        "approve" => {
            id_ok("id") && id_ok("chatId") && id_ok("approvalId")
                && matches!(v.get("decision").and_then(Value::as_str), Some("once" | "deny"))
        }
        "stop" => id_ok("id") && id_ok("chatId"),
        "watch" if kind == Kind::Aura => {
            v.get("list").is_some_and(Value::is_boolean)
                && v.get("chatIds").and_then(Value::as_array).is_some_and(|a| a.len() <= 100 && a.iter().all(is_id))
        }
        _ => false,
    }
}

/// Checks a frame from this app before it goes out: a JSON object of a known type, one line, not too long.
pub fn prepare_outgoing(kind: Kind, line: &str) -> Result<String, String> {
    let v: Value = serde_json::from_str(line).map_err(|_| "not JSON".to_string())?;
    let t = v.get("t").and_then(Value::as_str).ok_or("no type")?;
    if !v.is_object() || !kind.may_send(t) {
        return Err(format!("unknown frame type {t}"));
    }
    let mut out = serde_json::to_string(&v).map_err(|e| e.to_string())?; // one line, no raw newlines
    if out.len() + 1 > MAX_LINE {
        return Err("frame too large".into());
    }
    out.push('\n');
    Ok(out)
}

/// Splits incoming bytes into lines, refusing any line longer than MAX_LINE.
#[derive(Default)]
pub struct LineBuffer(Vec<u8>);
impl LineBuffer {
    pub fn push(&mut self, chunk: &[u8]) -> Option<Vec<Vec<u8>>> {
        self.0.extend_from_slice(chunk);
        let mut lines = Vec::new();
        while let Some(pos) = self.0.iter().position(|&b| b == b'\n') {
            let line: Vec<u8> = self.0.drain(..=pos).take(pos).collect();
            if line.len() > MAX_LINE {
                return None;
            }
            lines.push(line);
        }
        if self.0.len() > MAX_LINE {
            return None;
        }
        Some(lines)
    }
}

#[derive(Clone, Serialize, Debug, PartialEq)]
#[serde(tag = "kind", rename_all = "lowercase")]
pub enum LinkEvent {
    Connected,
    Disconnected,
    Command { cmd: Value },
}

#[cfg(unix)]
mod conn {
    use super::*;
    use std::os::unix::fs::{FileTypeExt, MetadataExt};
    use tokio::io::{AsyncReadExt, AsyncWriteExt};
    use tokio::net::UnixStream;
    use tokio::sync::mpsc;

    /// Only a socket owned by us (Page Power runs as the same user) is good enough.
    pub fn socket_is_ours(path: &std::path::Path) -> bool {
        match std::fs::symlink_metadata(path) {
            Ok(m) => m.file_type().is_socket() && m.uid() == unsafe { libc::getuid() },
            Err(_) => false,
        }
    }

    /// Connects, pumps lines both ways until the connection ends, then waits and retries,
    /// for as long as the link stays switched on. `on_event` gets connects, disconnects and
    /// validated commands; `set_outbox` receives the sender for outgoing lines (or None).
    pub async fn run(
        kind: Kind,
        path: std::path::PathBuf,
        retry: std::time::Duration,
        on_event: impl Fn(LinkEvent) + Send + Sync + 'static,
        set_outbox: impl Fn(Option<mpsc::UnboundedSender<String>>) + Send + Sync + 'static,
    ) {
        loop {
            if socket_is_ours(&path) {
                if let Ok(stream) = UnixStream::connect(&path).await {
                    let (mut rd, mut wr) = stream.into_split();
                    let (tx, mut rx) = mpsc::unbounded_channel::<String>();
                    set_outbox(Some(tx));
                    on_event(LinkEvent::Connected);
                    let writer = tokio::spawn(async move {
                        while let Some(line) = rx.recv().await {
                            if wr.write_all(line.as_bytes()).await.is_err() {
                                break;
                            }
                        }
                    });
                    let mut buf = LineBuffer::default();
                    let mut chunk = vec![0u8; 64 * 1024];
                    loop {
                        match rd.read(&mut chunk).await {
                            Ok(0) | Err(_) => break,
                            Ok(n) => {
                                let Some(lines) = buf.push(&chunk[..n]) else { break };
                                for l in lines {
                                    if let Ok(v) = serde_json::from_slice::<Value>(&l) {
                                        if validate_incoming(kind, &v) {
                                            on_event(LinkEvent::Command { cmd: v });
                                        }
                                    }
                                }
                            }
                        }
                    }
                    set_outbox(None);
                    writer.abort();
                    on_event(LinkEvent::Disconnected);
                }
            }
            tokio::time::sleep(retry).await;
        }
    }
}

#[tauri::command]
pub fn page_link_status(app: AppHandle, link: State<'_, PageLink>) -> LinkStatus {
    let path = socket_path(Kind::for_app(&app));
    let s = link.0.lock().unwrap();
    LinkStatus {
        supported: path.is_some(),
        enabled: s.enabled,
        connected: s.connected,
        path: path.map(|p| p.display().to_string()).unwrap_or_default(),
    }
}

#[tauri::command]
pub fn page_link_set(app: AppHandle, link: State<'_, PageLink>, enabled: bool) -> Result<(), String> {
    let kind = Kind::for_app(&app);
    let path = socket_path(kind).ok_or("The link to Page Power is only available on macOS and Linux.")?;
    let mut s = link.0.lock().map_err(|e| e.to_string())?;
    if let Some(t) = s.task.take() {
        t.abort();
    }
    s.outbox = None;
    s.connected = false;
    s.enabled = enabled;
    #[cfg(unix)]
    if enabled {
        use tauri::{Emitter, Manager};
        let (a1, a2) = (app.clone(), app.clone());
        s.task = Some(tauri::async_runtime::spawn(conn::run(
            kind,
            path,
            std::time::Duration::from_secs(5),
            move |ev| {
                if let Some(state) = a1.try_state::<PageLink>() {
                    if let Ok(mut st) = state.0.lock() {
                        match ev { LinkEvent::Connected => st.connected = true, LinkEvent::Disconnected => st.connected = false, _ => {} }
                    }
                }
                let _ = a1.emit_to("main", "page-link", ev);
            },
            move |tx| {
                if let Some(state) = a2.try_state::<PageLink>() {
                    if let Ok(mut st) = state.0.lock() { st.outbox = tx; }
                }
            },
        )));
    }
    #[cfg(not(unix))]
    let _ = path;
    Ok(())
}

/// Sends one frame to Page Power. False when not connected (the frame is dropped).
#[tauri::command]
pub fn page_link_send(app: AppHandle, link: State<'_, PageLink>, line: String) -> Result<bool, String> {
    let out = prepare_outgoing(Kind::for_app(&app), &line)?;
    let s = link.0.lock().map_err(|e| e.to_string())?;
    Ok(match &s.outbox { Some(tx) if s.connected => tx.send(out).is_ok(), _ => false })
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn validates_commands() {
        assert!(validate_incoming(Kind::Aura, &json!({"t":"send","id":"c1","chatId":"k3j9x","text":"hi"})));
        assert!(!validate_incoming(Kind::Aura, &json!({"t":"send","id":"c1","chatId":"bad id!","text":"hi"})));
        assert!(!validate_incoming(Kind::Aura, &json!({"t":"send","id":"c1","chatId":"k","text":"x".repeat(8001)})));
        assert!(validate_incoming(Kind::Aura, &json!({"t":"approve","id":"c2","chatId":"p","approvalId":"a7f3","decision":"once"})));
        assert!(!validate_incoming(Kind::Aura, &json!({"t":"approve","id":"c2","chatId":"p","approvalId":"a7f3","decision":"always"})));
        assert!(validate_incoming(Kind::Aura, &json!({"t":"watch","list":true,"chatIds":["a","b"]})));
        assert!(!validate_incoming(Kind::Aura, &json!({"t":"exec","cmd":"rm -rf /"})));
        assert!(validate_incoming(Kind::Orbit, &json!({"t":"approve","id":"c2","chatId":"sesn_01","approvalId":"sevt_01","decision":"deny"})));
        assert!(!validate_incoming(Kind::Orbit, &json!({"t":"watch","list":true,"chatIds":[]})));
    }

    #[test]
    fn outgoing_frames_are_one_known_line() {
        assert_eq!(prepare_outgoing(Kind::Aura, "{\"t\":\"hello\",\n \"proto\":2}").unwrap(), "{\"proto\":2,\"t\":\"hello\"}\n");
        assert!(prepare_outgoing(Kind::Aura, "{\"t\":\"send\"}").is_err());
        assert!(prepare_outgoing(Kind::Orbit, "{\"t\":\"chats\",\"chats\":[]}").is_err());
        assert!(prepare_outgoing(Kind::Aura, &format!("{{\"t\":\"ack\",\"detail\":\"{}\"}}", "x".repeat(MAX_LINE))).is_err());
    }

    #[test]
    fn socket_paths_follow_page_power_on_each_system() {
        let d = std::path::PathBuf::from("/data");
        assert_eq!(socket_path_in(d.clone(), "macos", Kind::Aura).unwrap(), d.join("ClaudePowerMode/aura.sock"));
        assert_eq!(socket_path_in(d.clone(), "linux", Kind::Aura).unwrap(), d.join("page/aura.sock"));
        assert_eq!(socket_path_in(d.clone(), "linux", Kind::Orbit).unwrap(), d.join("page/orbit.sock"));
        assert!(socket_path_in(d, "windows", Kind::Aura).is_none());
    }

    #[test]
    fn line_buffer_splits_and_caps() {
        let mut b = LineBuffer::default();
        assert_eq!(b.push(b"{\"a\":1}\n{\"b\"").unwrap(), vec![b"{\"a\":1}".to_vec()]);
        assert_eq!(b.push(b":2}\n").unwrap(), vec![b"{\"b\":2}".to_vec()]);
        assert!(b.push(&vec![b'x'; MAX_LINE + 1]).is_none());
    }

    #[cfg(unix)]
    #[tokio::test(flavor = "multi_thread")]
    async fn talks_to_a_server() {
        use std::sync::{Arc, Mutex as M};
        use tokio::io::{AsyncBufReadExt, AsyncWriteExt, BufReader};
        let dir = std::env::temp_dir().join(format!("pagelink-{}", std::process::id()));
        std::fs::create_dir_all(&dir).unwrap();
        let path = dir.join("aura.sock");
        let _ = std::fs::remove_file(&path);
        let listener = tokio::net::UnixListener::bind(&path).unwrap();
        let events = Arc::new(M::new(Vec::<LinkEvent>::new()));
        let outbox = Arc::new(M::new(None));
        let (e2, o2) = (events.clone(), outbox.clone());
        let task = tokio::spawn(conn::run(Kind::Aura, path.clone(), std::time::Duration::from_millis(50),
            move |ev| e2.lock().unwrap().push(ev), move |tx| *o2.lock().unwrap() = tx));
        let (sock, _) = listener.accept().await.unwrap();
        let (rd, mut wr) = sock.into_split();
        // server → client: one good command, one bad one, one unknown
        wr.write_all(b"{\"t\":\"stop\",\"id\":\"c3\",\"chatId\":\"k3j9x\"}\n{\"t\":\"send\",\"id\":\"c4\",\"chatId\":\"../x\",\"text\":\"hi\"}\n{\"t\":\"shell\"}\n").await.unwrap();
        // client → server
        for _ in 0..50 { if outbox.lock().unwrap().is_some() { break } tokio::time::sleep(std::time::Duration::from_millis(20)).await; }
        let tx = outbox.lock().unwrap().clone().unwrap();
        tx.send(prepare_outgoing(Kind::Aura, r#"{"t":"hello","proto":2,"app":"Page Aura"}"#).unwrap()).unwrap();
        let mut lines = BufReader::new(rd).lines();
        assert_eq!(lines.next_line().await.unwrap().unwrap(), r#"{"app":"Page Aura","proto":2,"t":"hello"}"#);
        tokio::time::sleep(std::time::Duration::from_millis(100)).await;
        {
            let ev = events.lock().unwrap();
            assert_eq!(ev[0], LinkEvent::Connected);
            assert_eq!(ev.len(), 2, "only the valid command gets through: {ev:?}");
            assert!(matches!(&ev[1], LinkEvent::Command { cmd } if cmd["t"]=="stop"));
        }
        drop(wr); drop(lines);
        tokio::time::sleep(std::time::Duration::from_millis(100)).await;
        assert!(events.lock().unwrap().contains(&LinkEvent::Disconnected));
        // a regular file at the socket path is not trusted
        drop(listener); let _ = std::fs::remove_file(&path); std::fs::write(&path, b"x").unwrap();
        assert!(!conn::socket_is_ours(&path));
        task.abort();
        let _ = std::fs::remove_dir_all(&dir);
    }
}
