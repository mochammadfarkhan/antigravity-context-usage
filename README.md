# Context & Usage — Antigravity Plugin

A clean, zero-token-overhead sidecar UI plugin for **Google Antigravity** that monitors your live **Context Window**, **Local Token Usage**, and **Estimated API Cost** across all sessions.

- **Bilingual (`EN` / `ID`)** with persistent default preferences (`⚙`)
- **Concise & human-friendly** — remaining tokens, estimated turns left, cache savings, and code-file / line equivalents
- **API cost estimator** — supports `USD ($)` and `IDR (Rp)` with per-model breakdown and prompt-cache savings
- **Zero token overhead** — runs purely as a local Node.js sidecar reading local transcripts (no MCP tools injected into model context)
- **Zero external dependencies** — no `npm install` needed; works out of the box on Windows, macOS, and Linux

## Features

### Context
- Live fill percentage, status badge (`Healthy` / `Growing` / `Getting Full` / `Near Limit`), and `200K` / `1M` limit toggle (auto-detected by model or pinned in defaults).
- Remaining room + estimated turns left based on recent session growth pace + prompt-cache hit rate.
- Compact memory-growth sparkline with turn-by-turn hover delta and cumulative session cost estimate.

### Usage
- Timeframe filter: `Today`, `7D`, `30D`, and `All`.
- One-line pace & cost digest (`Light` / `Normal` / `Busy` / `Intense`, estimated API spend, lines of code written, and fresh files read).
- 3 core KPIs: **Fresh In**, **Output**, and **Cached** (with estimated money saved via cache).
- Per-model breakdown table with turns, `In / Out`, and estimated cost.

### Persistent Defaults (`⚙`)
Save your preferred **Language**, **Currency** (`Auto` / `USD` / `IDR`), **Context Limit**, **Timeframe**, and **Auto-refresh** interval directly in the panel.

## Installation

### Option 1: Antigravity CLI (Recommended)
```bash
agy plugin install https://github.com/mochammadfarkhan/antigravity-context-usage
```

### Option 2: Git Clone
**macOS / Linux:**
```bash
git clone https://github.com/mochammadfarkhan/antigravity-context-usage.git ~/.gemini/config/plugins/context-usage
```

**Windows (PowerShell):**
```powershell
git clone https://github.com/mochammadfarkhan/antigravity-context-usage.git "$env:USERPROFILE\.gemini\config\plugins\context-usage"
```

### Option 3: Manual ZIP
1. Click **Code → Download ZIP** on GitHub.
2. Extract to:
   - **Windows:** `%USERPROFILE%\.gemini\config\plugins\context-usage`
   - **macOS / Linux:** `~/.gemini/config/plugins/context-usage`

Once installed, open the Antigravity side pane (`+` button) and select **Context & Usage**.

## Updating
If installed via `git clone`:
```bash
git -C ~/.gemini/config/plugins/context-usage pull
```

## Requirements
- [Node.js](https://nodejs.org/) (v18+)
- Google Antigravity

## Privacy
All analytics are computed **100% locally** from `~/.gemini/antigravity/brain/*/.system_generated/logs/transcript.jsonl`. Nothing is sent over the network.

## License
MIT
