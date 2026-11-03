<p align="center">
  <img src="logo.svg" width="96" height="96" alt="Page Orbit logo">
</p>

<h1 align="center">Page Orbit</h1>

<p align="center">
  <strong>Build, run and fix Anthropic Managed Agents with your own API key.</strong><br>
  Page Aura's sister app: create and version agents, talk to them while they work, approve what they ask,
  see every step and every cent, and let a model diagnose what went wrong.
</p>

<p align="center">
  <a href="https://roysinclair.github.io/page-studio-apps/page-orbit.html?demo"><strong>▶ Explore the demo in your browser</strong></a> ·
  <a href="https://github.com/roysinclair/page-studio-apps/releases/latest"><strong>⬇ Download</strong></a> ·
  <a href="../../README.md">Both apps</a>
</p>

<p align="center">
  A desktop app for Windows, macOS and Linux ·
  no server · no sign-up · your key only ever reaches <code>api.anthropic.com</code>
</p>

> **Why desktop only?** Anthropic lets web pages call its chat API directly, but not its Managed Agents API (checked November 2026: the browser's permission check is refused on every agent endpoint). The desktop app sends its requests from the app itself, so it isn't affected. `page-orbit.html` is the app's interface. Opened in a browser, it offers a **demo**: a sample workspace that runs entirely in the page, with sessions that reply live, approvals, Diagnose, schedules and memory. Nothing is sent anywhere.

<p align="center">
  <img src="session.png" alt="A Page Orbit session: the agent's conversation with tool calls, approvals and a retry notice on the left, and a timeline of every event with model request durations, tokens and cost on the right" width="100%">
  <br><sub>A live session: the conversation on the left, every event with timing and cost on the right. (Demo data.)</sub>
</p>

---

## What are Managed Agents?

[Managed Agents](https://platform.claude.com/docs/en/managed-agents/overview) are agents that run in Anthropic's cloud. Each **session** gets its own sandbox (a small Linux machine) where the agent can run commands, read and write files, search the web and call MCP servers. You don't host anything. You pay list price for tokens, plus $0.08 per hour of sandbox time and $10 per 1,000 web searches.

The Console lets you do some of this. Page Orbit puts all of it in one place, with a focus on **seeing what an agent did and making it better**.

| You want to… | In Page Orbit |
|---|---|
| Set up an agent | **Agents → New agent**: model, effort, fast mode and the region it runs in; instructions; tools and what needs your approval, including rules for single MCP tools and web search/fetch site lists; private MCP servers through tunnels; custom tools; skills; a team of helpers with an advisor |
| Change it safely | Every save is a new **version**. Compare any two versions, roll back with one click. If someone else saved in the meantime, you're told instead of overwriting them. |
| Talk to it | **Talk to it** starts a session, optionally with a different model or instructions for just that session, files to work on, or a goal to meet. Watch it think, call tools and reply, live. Approve or deny what it asks. Answer your own custom tools. Add an instruction mid-session, change its tools for that session, add or remove files, stop it, or stop a single helper. |
| Know what it did | The **timeline** lists every event: messages, tool calls and results, model requests with duration, tokens and estimated cost, errors and retries. Click any event for the raw JSON. Helpers each have a live thread, and background **workflows** show their phases. |
| Know what it cost | **Usage** shows Anthropic's own list cost, tokens, cache use, active time, tool calls and errors. Set a **spending cap** when you start a session. |
| Find out why it went wrong | **Diagnose** sends the session and the agent's setup to a model you choose. It explains what happened, points to the exact events, and proposes fixes as a diff you can apply as a new version. Ask follow-up questions. |
| Check the work automatically | **Outcome**: give it a goal and a rubric. A separate grader checks the work and sends it back until it passes. |
| Run it on a timetable | **Schedules**: a cron schedule in your time zone, or Run now. See every run, open its session, pause and resume. |
| Give it logins | **Vaults** hold MCP tokens (including OAuth with automatic refresh) and secret variables. Secrets are write-only. |
| Control its sandbox | **Environments**: limit internet access to listed sites, allow package managers, pre-install packages. |
| Give it a memory | **Memory** stores: folders of notes agents read and update across sessions. Edit them, see who changed what, restore or redact old versions, and see which sessions used them. **Dreams** (research preview) have a model tidy a store using what past sessions learned. |
| Give it skills | **Skills**: upload a folder with a `SKILL.md`, keep versions, and switch it on in any agent. |

<table>
  <tr>
    <td width="50%"><img src="agent.png" alt="The agent editor: instructions, and a table of sandbox tools with Allow, Ask or Auto for each"><br><sub>Edit an agent: each tool can run freely, ask you first, or let a safety check decide</sub></td>
    <td width="50%"><img src="versions.png" alt="Agent versions: a list of versions and a diff between two of them, with Restore and Talk to this version"><br><sub>Every save is a version: compare and restore</sub></td>
  </tr>
  <tr>
    <td width="50%"><img src="diagnose.png" alt="Diagnose: a model explains what happened in a session and proposes a change to the agent as a diff, with an Apply button"><br><sub>Diagnose: an explanation, and fixes you can apply as a new version</sub></td>
    <td width="50%"><img src="overview.png" alt="The overview in the light theme: recent sessions with status and cost, and agents with model and version"><br><sub>Overview (light theme)</sub></td>
  </tr>
  <tr>
    <td width="50%"><img src="schedule.png" alt="A schedule's runs: a successful scheduled run and a failed one with its error"><br><sub>Schedules and their runs</sub></td>
    <td width="50%"><img src="memory.png" alt="A memory store: a list of memory files, an editor, and the history of changes with who made them"><br><sub>Memory, with full history</sub></td>
  </tr>
  <tr>
    <td width="50%"><img src="vault.png" alt="A vault with two credentials marked 'secret set', with Test and Replace secret buttons"><br><sub>Vaults: secrets can be set and replaced, never read</sub></td>
    <td width="50%"><img src="environment.png" alt="An environment: limited network access to listed hosts, package managers on, pip packages"><br><sub>Environments: what the sandbox can reach and what's installed</sub></td>
  </tr>
</table>

---

## Getting started

1. You need an Anthropic API key from [platform.claude.com](https://platform.claude.com) with Managed Agents available for your workspace.
2. Install the desktop app (below).
3. Click **Add your API key**. If the Page Aura desktop app already has it, Page Orbit picks it up: they share one keychain entry.
4. **Agents → New agent.** Give it a name and instructions and save. The defaults are deliberately careful: it can read and search files freely, but asks before running commands or changing files, and web access is off.
5. **Talk to it.** The first time, Page Orbit offers to create an environment: a safe one (package registries, the agent's MCP servers and only the web sites its tools are limited to) or an open-internet one. It warns you when an environment would block the agent's web tools.

### The desktop app

The same Rust core as Page Aura, built as a separate app with its own name, icon, data folder and shortcut (<kbd>Ctrl/⌘</kbd> + <kbd>Shift</kbd> + <kbd>O</kbd>). Download it from the release (files start with `Page.Orbit`), or build it yourself:

```bash
cd desktop
npm ci
npm run build:orbit
```

The installers aren't code-signed, for the same reason as Page Aura's. See [Get the desktop app](../../README.md#get-the-apps) for how to open them, and how to check the checksums (`SHA256SUMS-Orbit-*.txt`).

---

## Using it well

### Approvals: Allow, Ask, Auto

Each sandbox tool and each MCP server has a permission:

- **Allow**: runs without asking.
- **Ask**: the agent pauses until you click Allow or Deny in the session. You can tell it why when you deny.
- **Auto**: Anthropic's safety check decides each call: it runs it, blocks it, or asks you when it's unsure.

Scheduled runs have nobody watching, so a tool on **Ask** stops them for good. Page Orbit warns you when you schedule an agent like that. Open the run's session to answer, or switch those tools to Allow for that agent.

### Web search and page reading

- In an environment with **limited** internet, the agent's web search and page reading only reach the sites the environment lists. With none listed they find nothing. If an agent's web tools are limited to a site the environment doesn't list, the session won't start. Page Orbit warns you about both when you start a session.
- Page reading only opens links that have already come up in the conversation (in your message, in search results or on a page it read). If you want it to read a page, paste the link in your message.
- Your organisation's Console settings can switch web tools off or restrict them, whatever the agent says.

### Helpers and advisors

An agent with a **team** can hand work to helper agents, start background **workflows**, and consult an **advisor** model. Page Orbit only offers advisors that work with the agent's model. Advice from the newest advisors (Opus 5.5, Fable 5.1, Sonnet 5.5, Haiku 5.5, Opus 5, Fable 5) is hidden from you by design. The agent still gets it. Opus 4.8 gives advice you can read.

### When a turn stops early

- **Tool-step limit**: a turn can only take so many tool steps. Nothing failed: send a message such as "carry on".
- **Context limit**: the conversation was summarised too many times in a row. Send a message to continue, ideally narrowing the task.
- **Stopped** (red): a session stops only after an unrecoverable error or when it's archived. A session that has finished its work is simply idle, and you can keep talking to it.

### Diagnose

Diagnose sends the session's events (long results shortened), the setup the session ran with and the agent's current setup to the model you pick in **Settings → Diagnose** (Opus 5.5 by default). It doesn't see your vault secrets: the API never returns them. Its cost is shown in the corner. Proposed changes are applied only when you click **Apply**, as a new version, and only to new sessions: the one you're looking at keeps the version it started with.

### Costs

- A session's **list cost** comes from Anthropic and includes tokens, sandbox time and web searches. Your contract price may differ.
- Per-request costs in the timeline are estimates from token counts.
- Set a **spending cap** when you start a session. At the cap the session pauses, and you can raise the cap to continue. A cap can only be added when a session starts.

### Things that can't be undone

The API has no undo for **archive**: archived agents, environments, vaults, memory stores and schedules become read-only for good, and agents can't be deleted at all. Page Orbit asks you to type the name before archiving or deleting. Leave old sessions in place: they're your debugging record.

---

## Security

Page Orbit follows the same rules as Page Aura (see the [Page Aura guide](../aura/README.md#security)):

- **One file, nothing fetched at runtime.** The official Anthropic SDK, marked, DOMPurify and highlight.js are embedded, copied byte for byte from `page-aura.html`, where they are checked against their published fingerprints. A strict Content Security Policy lists the hash of every script and allows connections to `api.anthropic.com` only.
- **Your key**: in the browser it stays on your device (optionally AES-256 encrypted with a passphrase). In the desktop app it lives in the system keychain and never enters the page.
- **Vault secrets** are typed into password fields, sent once, then cleared from the page. Page Orbit never stores them and the API never returns them.
- **Agent output is untrusted.** It's rendered as sanitised Markdown; links open in your browser.
- **Local data** is only your settings (theme, Diagnose model, Console workspace). Everything else lives in your Anthropic workspace.

---

## How it's built

- Source: `orbit/src/` (`shell.html`, `base.css` + `style.css`, and the modules `core.js`, `agents.js`, `sessions.js`, `diagnose.js`, `resources.js`, `app.js`).
- `python3 tools/build-orbit.py` joins them into `page-orbit.html`, copies the embedded libraries from `page-aura.html` and writes the CSP hashes. Edit the sources, then rebuild.
- Sessions stream events with no replay, so Page Orbit opens the stream first, then loads the history and skips anything it has already seen. It reconnects with back-off and re-checks the history for approvals still waiting.
- Desktop: `desktop/src-tauri/tauri.orbit.conf.json` on top of Page Aura's config; `desktop/scripts/prepare.mjs orbit` copies the page in.
- Design notes: [design.md](design.md).

## Not yet

- **Test sets**: run an agent version against saved prompts and compare results side by side. (Anthropic doesn't offer evaluations for Managed Agents yet.)
- Self-hosted environments' worker queue, and webhooks (they need a server).
- OpenAI-style agents. Page Orbit is for Anthropic's Managed Agents.

Page Orbit is **not affiliated with, endorsed by, or sponsored by Anthropic**. Licence: Page Studio License, like Page Aura.
