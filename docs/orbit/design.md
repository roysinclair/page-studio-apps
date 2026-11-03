# Page Orbit — design

Page Orbit is Page Aura's sister app for **Anthropic Managed Agents**: agents that run in Anthropic's
cloud, with their own sandbox, tools, memory and schedules. Page Aura is for chatting with a model;
Page Orbit is for building, running and fixing agents. It uses your own API key, like Page Aura.

## What it covers

| Area | What you can do |
|---|---|
| **Agents** | Create and edit agents in a form or as raw JSON. Every save makes a new version. Browse versions, compare any two, and restore an old one (which saves it as a new version). Archive. |
| **Talk** | Start a session with any agent (latest or a pinned version), in an environment, with vaults, memory stores, a GitHub repository and a spending cap. Watch it work live: messages, tool calls and results, thinking indicators. Approve or deny tool calls that ask. Answer custom tools. Stop it. Set an outcome with a rubric and watch the grader. |
| **Inspect** | Every session has a timeline of every event, model requests with time, tokens and cost, errors with their retry status, sub-agent threads, workflow runs, and files the agent produced. |
| **Diagnose** | One click sends the session's transcript and the agent's settings to a model, which explains what went wrong and proposes changes to the agent. You see the change as a diff and apply it as a new version. You can keep talking to it about the session. |
| **Environments** | Cloud sandboxes: networking (open or limited to listed hosts), package managers, MCP access, pre-installed packages. |
| **Vaults** | Credentials for MCP servers (bearer tokens, OAuth with refresh) and secret environment variables. Secrets are write-only: you can set and rotate them, never read them back. OAuth credentials can be tested. |
| **Schedules** | Deployments: run an agent on a cron schedule in your time zone, or on demand. Pause, resume, run now, see every run and open its session. |
| **Memory** | Memory stores: browse, edit and create memories, see every version and who wrote it, and redact a version. |

## Security model

The same rules as Page Aura:

- **One file, nothing fetched at runtime.** `page-orbit.html` embeds the official Anthropic SDK and its
  three UI libraries. A strict Content Security Policy lists the hash of every script and allows
  network connections to `api.anthropic.com` only.
- **Your key.** In the browser it stays on your device (optionally encrypted with a passphrase:
  PBKDF2-SHA256, 600,000 rounds, AES-256-GCM). In the desktop app it lives in the system keychain and
  never enters the page; the Rust core adds it to each request and only talks to `api.anthropic.com`.
  Page Aura and Page Orbit desktop apps share the same keychain entry, so you add your key once.
- **Secrets are write-only.** Vault secrets are typed into a password field, sent once, and cleared.
  Page Orbit never stores them and the API never returns them.
- **Nothing irreversible without asking.** Archiving is permanent on every resource and agents can't be
  deleted, so every archive and delete asks first and says so.
- **Safe defaults.** New agents can read files and search the sandbox freely, but must ask before running
  commands or writing files. Web access is off until you turn it on.
- **Model output is untrusted.** Agent messages are rendered as sanitised Markdown (DOMPurify), and links
  open in your browser.

## How it is built

- `orbit/src/` holds the source: `shell.html`, `style.css` and the app's JavaScript modules.
  `tools/build-orbit.py` joins them into `page-orbit.html`, copies the embedded libraries from
  `page-aura.html` (so both apps always ship the same verified copies), and writes the CSP hashes.
- The desktop app is the same Rust core as Page Aura, built with a second config
  (`desktop/src-tauri/tauri.orbit.conf.json`): its own name, bundle identifier, icon, data folder and
  shortcut (Ctrl/⌘+Shift+O). The release workflow builds both apps.
- The only state Page Orbit keeps locally is its settings and your Diagnose conversations. Everything
  else (agents, sessions, schedules…) lives in your Anthropic workspace, so it's the same in the
  browser, the desktop app and the Anthropic Console.

## Event handling (the tricky part)

Sessions stream events with no replay, so Page Orbit opens the stream first, then loads the history and
skips events it has already seen. A turn is finished only when the session is idle for a reason other than
`requires_action`, or terminated. Tool approvals are answered with the event's own `sevt_` id, and only for
calls the server marked `ask`. If the connection drops, Page Orbit reconnects and re-checks the history
for approvals that are still waiting, so a session can't get stuck.

## Not yet

- Test sets (run an agent against saved prompts and compare versions).
- Self-hosted environments' worker queue.
- Webhooks (they need a server).
