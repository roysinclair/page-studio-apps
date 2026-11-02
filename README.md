<p align="center">
  <img src="docs/logo.svg" width="96" height="96" alt="Page Aura logo">
</p>

<h1 align="center">Page Aura</h1>

<p align="center">
  <strong>A beautiful, private, bring-your-own-key chat app for Anthropic’s Claude models.</strong><br>
  Several chats side by side · pick the model and effort for each one · photos, PDFs and long text ·
  optional project context from your local folders · a live estimate of what you’re spending.
</p>

<p align="center">
  One HTML file · no server · no build step · no sign-up · nothing leaves your browser except your requests to the API
</p>

<p align="center">
  <img src="docs/side-by-side.png" alt="Page Aura with two chats side by side: one on Opus 5.5 using a project folder as context, one on Haiku 5.5. The sidebar shows an estimated balance of $24.97." width="100%">
  <br><sub>Two chats running side by side on different models. The left one uses a project folder as background context. (Demo data.)</sub>
</p>

---

## Contents

- [Why we built Page Aura](#why-we-built-page-aura)
- [What it offers at a glance](#what-it-offers-at-a-glance)
- [Getting started](#getting-started)
- [Features in depth](#features-in-depth)
  - [Multiple chats at once](#multiple-chats-at-once)
  - [Choosing the model and effort](#choosing-the-model-and-effort)
  - [Images](#images)
  - [Long text, documents and PDFs](#long-text-documents-and-pdfs)
  - [Project context from your own folders](#project-context-from-your-own-folders)
  - [Reading replies](#reading-replies)
- [API credits: cost tracking and the balance gauge](#api-credits-cost-tracking-and-the-balance-gauge)
- [Limits you should know about](#limits-you-should-know-about)
- [Privacy and security](#privacy-and-security)
- [How it works under the hood](#how-it-works-under-the-hood)
- [Troubleshooting](#troubleshooting)
- [Roadmap](#roadmap)
- [Disclaimer](#disclaimer)

---

## Why we built Page Aura

We pay for Anthropic API access directly, with a key and prepaid credits. That gives you the most capable models and full control. Out of the box, though, there's nowhere pleasant to *talk* to them. The choices were writing code, or using the API console's test playground, which was never meant for everyday work.

We wanted the experience of a polished desktop chat app, on our own API key, and without the things that kept getting in the way:

1. **One conversation at a time is too limiting.** Real work means several threads: research in one window, a quick question in another, comparing what two models say about the same thing. We wanted chats **side by side** and in **separate windows**, each answering at the same time.

2. **We wanted control over the model and how hard it thinks.** Some questions need the most capable model at maximum effort. Most don't, and paying top rates for "what's the capital of Peru?" is wasteful. Page Aura lets you set **model and effort for each chat**, with a plain-English description of each option.

3. **Real questions come with real material.** A photo of a circuit board, a 40-page PDF datasheet, a giant log file pasted in from a terminal. Page Aura handles all of it, the way a chat app should: **paste, drag or attach**. Long pastes become neat attachments instead of flooding the message box.

4. **Our context already exists on our own machine.** We use Claude Code for development. Our projects already contain `CLAUDE.md` files, configs and notes describing exactly what we use: which modem, which board, which vendor. When we step out of coding to ask a *research* question, like *"list modems that support VoLTE and would work with my setup"*, the answer should know that setup. Page Aura lets you **point a chat at a project folder**, read-only and only when you choose, so answers fit your situation without copying and pasting.

5. **Prepaid credits make you nervous when you can't see them.** The API doesn't let apps read your remaining balance, so it's easy to lose track. Page Aura shows the **estimated cost of every reply and every chat**, plus a **balance gauge** that counts down from your Console balance.

6. **It should be ours.** No account, no server, no telemetry, no build tools. A single file you can read, keep and change.

---

## What it offers at a glance

| | |
|---|---|
| 🪟 **Multiple chats** | Up to 4 side by side, plus any number of pop-out windows. Each one streams its replies independently. |
| 🎚️ **Model and effort for each chat** | Opus 5.5, Fable 5.1, Sonnet 5.5, Haiku 5.5 (and previous generations), with effort from *Low* to *Max* |
| 🖼️ **Images** | PNG, JPEG, GIF, WebP: paste, drop or attach. Large photos are resized automatically. |
| 📄 **Long text and files** | Pastes over about 4,000 characters become attachments. Text, code and config files, and PDFs up to 30 MB. |
| 📁 **Project context** | An optional, read-only project folder for a chat. You choose exactly which files are sent. It can include Claude Code's memory folder. |
| 💭 **Thought process** | Collapsible summaries of the model's reasoning, streamed live |
| 💲 **Cost tracking** | An estimated cost for every reply and every chat, plus spend today and this month |
| ⛽ **Balance gauge** | Enter your Console balance once, and it counts down as you chat |
| 🛟 **Refusal fallback** | Optionally retries a declined request on another model, server-side |
| 💾 **Saved locally** | Chats survive restarts. They're stored in your browser (IndexedDB). |
| 🌗 **Light and dark** | Follows your system setting, with a manual toggle |
| 📱 **Works on phones** | A responsive layout with a slide-out sidebar |

<table>
  <tr>
    <td width="50%"><img src="docs/welcome.png" alt="Welcome screen"><br><sub>Welcome screen with starter suggestions</sub></td>
    <td width="50%"><img src="docs/light.png" alt="Light theme"><br><sub>Light theme</sub></td>
  </tr>
</table>

---

## Getting started

### What you need
- An **Anthropic API key** and some API credit. Create both in the [Anthropic Console](https://console.anthropic.com).
- A modern browser. **Chrome or Edge is recommended**, because the project-folder feature works best there. Firefox and Safari work too; see [Limits](#limits-you-should-know-about).

### Run it
1. Download `page-aura.html` from this repository.
2. Double-click it to open it in your browser.
3. Paste your API key when asked, then click **Save**.
4. Optionally, click the card at the bottom of the sidebar and enter your current Console balance so the gauge can track it.

That's it. There's nothing to install.

> **Tip:** if your browser restricts pages opened directly from disk, serve the folder locally instead:
> ```bash
> python3 -m http.server 8000
> ```
> Then open <http://localhost:8000/page-aura.html>. Chats and settings are stored per address, so pick one way of opening the app and stick with it.

### Keyboard shortcuts

| Shortcut | Action |
|---|---|
| <kbd>Enter</kbd> | Send |
| <kbd>Shift</kbd> + <kbd>Enter</kbd> | New line |
| <kbd>Ctrl/⌘</kbd> + <kbd>Shift</kbd> + <kbd>O</kbd> | New chat |
| <kbd>Ctrl/⌘</kbd> + <kbd>\\</kbd> | New chat side by side |
| <kbd>Ctrl/⌘</kbd>-click a chat in the sidebar | Open it side by side |
| <kbd>Esc</kbd> | Close a menu or dialog |

---

## Features in depth

### Multiple chats at once

- **Side by side:** click the split icon in a chat's header, use <kbd>Ctrl/⌘</kbd> + <kbd>\\</kbd>, or <kbd>Ctrl/⌘</kbd>-click a chat in the sidebar. Up to **4** chats share the window. The focused one is marked with a gradient line.
- **Pop-out windows:** the ↗ button opens a chat in its own browser window, with no sidebar. Windows keep each other updated: a chat changed in one appears in the others.
- **Independent streaming:** every chat streams on its own, so you can ask three models three different things and watch them all answer at once. A pulsing dot in the sidebar marks chats that are still replying.
- **Rename** by clicking a chat's title. **Delete** from the sidebar (with a confirmation step). **Search** with the box at the top of the sidebar. Chats are grouped into *Today*, *Yesterday*, *Previous 7 days* and so on.
- **Instructions for each chat:** the sliders icon opens that chat's system prompt, so one chat can be "a terse hardware engineer" while another is "a patient tutor".

### Choosing the model and effort

Both pickers sit in the message box, and every chat remembers its own choice.

| Model | Best for | Price (input / output per 1M tokens) |
|---|---|---|
| **Opus 5.5** *(default)* | A smart all-rounder: research, writing, analysis | $4 / $20 |
| **Fable 5.1** | The hardest, longest reasoning tasks | $10 / $50 |
| **Sonnet 5.5** | Fast and capable everyday work | $2 / $10 |
| **Haiku 5.5** | Quick questions, very low cost | $0.10 / $0.50 |
| Opus 5 · Sonnet 5 | Previous generation | $5 / $25 · $2 / $10 |

Once your key is saved, the model list is refreshed from the API, so it only shows models your account can use.

**Effort** controls how much the model thinks before answering, which affects quality, speed and cost:

| Effort | What it means |
|---|---|
| ▂ **Low** | Quick, direct answers. The cheapest option. |
| ▂▃ **Medium** *(default)* | Balanced. Fine for most questions. |
| ▂▃▅ **High** | Thinks problems through |
| ▂▃▅▆ **Extra high** | Deep work: slower, more thorough |
| ▂▃▅▆█ **Max** | Everything it's got. Use it when being right matters more than cost. |

### Images

- **Formats:** PNG, JPEG, GIF, WebP.
- **Three ways in:** paste a screenshot straight from the clipboard, drag a file anywhere onto a chat, or use the 📎 button.
- **Automatic resizing:** images with a longest side over 2048 px, or files over about 3.7 MB, are scaled down and compressed in your browser before sending. That keeps them under the API's 5 MB limit for each image and avoids paying for detail the model doesn't use.
- Each image shows as a thumbnail before you send. In the conversation, click any image to view it full size.

### Long text, documents and PDFs

- **Long pastes become attachments.** Paste more than about **4,000 characters** (a log, an article, a whole file) and it turns into a tidy *"Pasted text 1"* card showing its length, instead of flooding the message box. Shorter pastes go in as normal text.
- **Text and code files:** `.txt`, `.md`, `.csv`, `.json`, `.yaml`, source code, config files. Anything that's text is sent as a titled document, so the model knows what it's reading.
- **PDFs** up to **30 MB** in this app. The API reads both the text and the page images, so charts and scanned pages work too. The API itself caps a request at 32 MB and 600 pages.
- Binary files that aren't images or PDFs (`.zip`, `.exe` and so on) are politely refused.

### Project context from your own folders

<img src="docs/context.png" alt="Project context dialog: a sample folder named modem-gw with CLAUDE.md, README.md and config/modem.yaml ticked" width="100%">
<sub>Choosing which files from a project folder to share with a chat. (Demo folder.)</sub>

This is the feature that sets Page Aura apart. If you use **Claude Code**, your projects already describe themselves in `CLAUDE.md`, `README` and config files. Page Aura can use that knowledge in an ordinary chat, **only when you ask it to**.

**How to use it**
1. Click **📁 Context** in the message box, or **"Bring a project along"** on the welcome screen.
2. Choose a project folder, for example one on your Desktop that you've been using with Claude Code.
3. `CLAUDE.md`, `CLAUDE.local.md`, `AGENTS.md`, `README` and `.claude/*.md` are **ticked for you**. Use the filter to find and tick anything else that describes your setup, such as `config/modem.yaml`.
4. Optionally click **Add Claude Code memory folder** to include the memories Claude Code saved for that project. They live in `~/.claude/projects/<project-path-with-dashes>/memory`, a hidden folder: press <kbd>⌘</kbd><kbd>⇧</kbd><kbd>.</kbd> in the Mac file picker, or tick *Hidden items* on Windows.
5. Click **Use as context**. The chat header shows the folder's name, and the sidebar marks the chat with a folder icon.

**What gets sent:** only the files you tick, plus (optionally) a list of the folder's file names so the model understands how the project is laid out. They're sent as background in the system prompt, with an instruction that this chat is for questions and research, not for editing the project.

**What is never done:** Page Aura **never writes to, moves or deletes** anything in the folder. It can't run commands or edit code. It's a chat app, not a coding agent.

**Smart defaults:** dependency and build folders are skipped automatically: `node_modules`, `.git`, `dist`, `build`, `venv`, `__pycache__`, `target`, `.next` and so on. Only text files are offered.

**Size check:** a live meter shows roughly how many tokens the context adds to *every* message, and turns red above about 150k tokens. Caching makes repeated sends much cheaper (see [Cost](#api-credits-cost-tracking-and-the-balance-gauge)), but untick large files you don't need.

**Staying current:** in Chrome and Edge, Page Aura remembers your folders (*Recent*) and can **Re-read** a folder later to pick up changes Claude Code has made since. In other browsers it takes a one-time copy when you choose the folder.

### Reading replies

- **Live streaming** with a soft caret, and a "Thinking" indicator while the model reasons.
- **Thought process:** collapsible summaries of the model's reasoning. You can turn them off in Settings.
- **Rich formatting:** headings, lists, tables, quotes and links, all sanitised for safety. **Code blocks** have syntax highlighting, a language label and a one-click **Copy** button.
- **Copy**, **Retry** (generate the last reply again) and **Stop** (cancel mid-reply; the partial answer is kept).
- **Refusals and errors are explained in plain language.** A declined request is shown clearly and left out of the conversation history, so it doesn't derail later turns. API errors include hints, such as *"check your API key"* or *"rate limited, wait a moment"*.
- **Refusal fallback (optional, on by default):** for the models that support it, a declined request is retried on another model server-side, and the reply is marked when that happens.

---

## API credits: cost tracking and the balance gauge

### Why not just show the real balance?

Anthropic's API **doesn't let an ordinary API key read your remaining credit balance**. That's only shown on the Billing page of the Anthropic Console. There is an *Admin API* with a cost report, but it needs an organisation admin key that can also create and delete keys and manage members. Putting a key that powerful into a web page would be unwise, so Page Aura deliberately doesn't use it.

Page Aura **estimates** your spend precisely instead, and lets you anchor that estimate to your real balance.

### Cost of each reply and each chat

Every reply from the API reports exactly how many tokens it used. Page Aura multiplies those numbers by the model's published price:

```
cost = uncached input  × input price
     + cache writes    × input price × 1.25
     + cache reads     × cache-read price
     + output          × output price          (all per million tokens)
```

- Hover over any reply to see, for example, `Opus 5.5 · ≈ $0.03 · 3.1k in · 640 out`. The latest reply always shows it.
- The **chat header** shows a running total for the conversation, for example `≈ $0.08`.
- **Output includes thinking.** Reasoning tokens are billed as output, so higher effort costs more even when the visible answer is the same length.
- **Stopped replies count too.** If you press Stop, the tokens generated before you stopped are still billed, and still counted.
- Older chats show costs as well, because their token counts were saved.

### The balance gauge

<img src="docs/balance.png" alt="Sidebar balance card showing about $24.97 left, with spend today and this month" width="320">

1. Click the card at the bottom of the sidebar.
2. Enter the balance shown at **console.anthropic.com → Billing**, for example `25.00`.
3. From then on the card shows **≈ $24.97 left**, a progress bar, and spend **today** and **this month**.

- The bar turns **amber** when less than 10% (or under $2) is left, and **red** when the estimate reaches zero.
- Re-enter your balance whenever you check the Console to correct any drift. **Stop tracking balance** removes it.
- The gauge stays in sync across pop-out windows and survives restarts.

### How accurate is it?

It's an estimate, usually within a few cents over a session. It drifts because:

- **It only sees this app in this browser.** Other apps, devices, scripts or teammates using the same account aren't counted.
- **Prices are built into the app.** If Anthropic changes them, update the `PRICES` table in the file.
- Special cases, such as refusal fallbacks charged at the fallback model's rate, or long-context pricing tiers, are approximated.

### Tips to spend less

| Do this | Why |
|---|---|
| Use **Haiku 5.5** or **Sonnet 5.5** for quick questions | It can cost 40× less than Opus for the same question |
| Keep **effort** at Low or Medium unless it's a hard problem | Higher effort means more thinking tokens, billed as output |
| Start a **new chat** when the topic changes | Every message re-sends the whole conversation as input |
| Tick only the **project files** you need | Context is sent with *every* message in that chat |
| Keep a conversation going rather than coming back hours later | Re-sent history is **cached for about 5 minutes**. Cached input costs a fraction of the normal rate, but the cache expires when idle. |
| Set a spend limit in the Console | A hard backstop that Page Aura can't provide on its own |

---

## Limits you should know about

### API limits (set by Anthropic)

| Limit | Value |
|---|---|
| Context window (current models) | Up to **1M tokens** for each conversation |
| Max output for each reply | **64,000** tokens by default in Page Aura, adjustable up to **128,000** in Settings |
| Image size | **5 MB** each (Page Aura resizes larger images automatically) |
| PDF | **32 MB** for each request, **600 pages** (Page Aura caps a single PDF at 30 MB) |
| Rate limits | Depend on your account's **usage tier**. When you exceed them you get an HTTP 429 *"rate limited"* error; wait and press Retry. |
| Credit | When your prepaid credit runs out, requests fail until you top up in the Console |

### App limits

| Limit | Value |
|---|---|
| Chats side by side | 4 in each window (use pop-out windows for more) |
| Project folder scan | First **4,000** entries, 10 folder levels deep. The file list shows 400 at a time; use the filter. |
| Long-paste threshold | About **4,000** characters becomes an attachment |
| Storage | Chats live in **this browser only**. They don't sync between devices or browsers, and clearing site data deletes them. |
| Folder re-reading | Chrome and Edge only. Firefox and Safari take a one-time snapshot. |
| Tools | None. Page Aura can't browse the web, run code or change files; it chats. |

---

## Privacy and security

- **No server.** Page Aura is a static HTML file. Your browser talks **directly to `api.anthropic.com`**, and there is no middleman, analytics or tracking.
- **Your API key** is stored in your browser's local storage, or only for the session if you untick *Remember key*. It is sent only to Anthropic.
- **Your chats** are stored in your browser's IndexedDB on your device.
- **Project files** are read only when you choose a folder, and only the files you tick are sent, to Anthropic, as part of that chat.
- **Direct browser access.** Anthropic requires browser apps to opt in to calling the API directly. Page Aura does this, which is fine for a personal app on your own machine. **Don't host Page Aura publicly with your key in it**, because anyone using that page would be spending your credit.
- **Rendered content is sanitised** (DOMPurify) before display, and links open in a new tab.
- **Recommended:** create a dedicated API key for Page Aura, in its own Console workspace with a monthly spend limit, so you can revoke or cap it independently.

---

## How it works under the hood

- **One file:** `page-aura.html` (HTML, CSS and an ES module). No build step.
- **Libraries** load from CDNs at pinned versions: the official [`@anthropic-ai/sdk`](https://github.com/anthropics/anthropic-sdk-typescript) (0.135.0), [marked](https://marked.js.org) for Markdown, [DOMPurify](https://github.com/cure53/DOMPurify) for sanitising, [highlight.js](https://highlightjs.org) for code, and the Geist and Bricolage Grotesque fonts from Google Fonts. An internet connection is needed for these and for the API.
- **Each request is streamed** with:
  - `thinking: { type: "adaptive", display: "summarized" }`: the model decides how much to think, and its reasoning comes back as readable summaries.
  - `output_config: { effort }`: the effort level you chose.
  - top-level `cache_control: { type: "ephemeral" }`: automatic prompt caching of the conversation so far.
  - `system`: the chat's instructions, plus the project context when one is attached.
  - `fallbacks: "default"` with the `server-side-fallback-2026-07-01` beta header, on models that support it, when refusal fallback is on.
- **The conversation history is sent back exactly as the API returned it,** including the thought-process data, so multi-turn reasoning stays intact.
- **Storage:** IndexedDB holds chats and remembered folders; localStorage holds settings, the spend ledger and your balance. A BroadcastChannel keeps windows in sync.

---

## Troubleshooting

| Problem | Fix |
|---|---|
| `401 — invalid x-api-key` | The key is wrong or was revoked. Paste it again in **Settings**. |
| `429 — rate limited` | You've hit your tier's limit. Wait a few seconds and press **Retry**. |
| `400` mentioning **fallback** | Your account may not have the fallback beta. Turn off **Auto-fallback on refusal** in Settings. |
| `529 — overloaded` | Anthropic is busy. Try again shortly. |
| "Couldn't reach the API" | Check your connection. If the file is open inside a preview or a sandboxed viewer, open it directly in your browser. |
| Chats are missing | They're stored per browser and per address. Make sure you opened the same file, from the same place, in the same browser. |
| The folder picker doesn't show `.claude` | It's a hidden folder: press <kbd>⌘</kbd><kbd>⇧</kbd><kbd>.</kbd> on Mac, or tick *Hidden items* on Windows. |
| No **Re-read** or **Recent** buttons for folders | Those need Chrome or Edge. |
| The balance looks off | Re-enter your Console balance. It only counts usage from this app in this browser. |

---

## Roadmap

Ideas we're considering:

- **Export and import** of all chats as a backup file
- **Save chats to a folder** you choose (and sync it through iCloud or Dropbox)
- **A memory panel:** standing notes that go with every chat
- **Edit and branch** an earlier message
- **Web search** using Anthropic's server-side tools
- **A desktop app wrapper** with a dock icon

Contributions and suggestions are welcome. Open an issue.

---

## Disclaimer

Page Aura is an independent project. It is **not affiliated with, endorsed by, or sponsored by Anthropic**. *Claude*, *Claude Code* and the model names (Opus, Sonnet, Haiku, Fable) are trademarks of Anthropic, PBC, used here only to describe what the app works with. You are responsible for your API usage and costs, and for following [Anthropic's usage policies](https://www.anthropic.com/legal/aup).

Prices, limits and model availability shown in this README and in the app reflect Anthropic's published information at the time of writing. Check the Console and Anthropic's documentation for current figures.

## License

**Page Studio License.** See [`LICENSE`](LICENSE) for the full text.

In plain English:

| ✅ You can | ❌ You can't |
|---|---|
| Use Page Aura for free, personally or at work | Sell Page Aura, or a lightly modified copy of it, as your own product |
| Use it for commercial work and client projects | Charge for hosting it, or for a service whose value comes mainly from Page Aura |
| Share unmodified copies, and send changes back as contributions | Distribute modified versions or forks, or remove the copyright and licence notice |
| Include it inside a larger project, as long as that project's value doesn't come mainly from Page Aura | |

This summary is for convenience only; the `LICENSE` file is what counts. Page Aura is *source-available* rather than "open source" under the OSI definition. GitHub may list the licence as "Other".
