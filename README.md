# Antigravity Pulse (`agy-pulse`)

A zero-dependency local web application for **macOS** that reports your **Gemini Antigravity subscription quotas**, **burn-rate pace**, **G1 AI credits**, and **local token/conversation telemetry** across one or multiple Macs.

---

## Features

- **Live Subscription Quotas (`agy -p "/usage"`):** Tracks every model group (`Gemini Models`, `Gemini 4 Argon`, `Claude and GPT models`) across rolling **5-hour** and **Weekly** windows with live-ticking reset countdowns.
- **Burn-Rate Pace & Exhaustion Projection:** Compares `% quota used` vs. `% time elapsed` in each rolling window using color-blind-safe badges (`● Safe`, `◐ On Pace`, `▲ Burning Fast`) and warns if current pace will exhaust before reset.
- **G1 Credits & Active Model Pill:** Reads `/credits`, `/model`, and `useG1Credits` from `~/.gemini/antigravity-cli/settings.json` (strictly read-only).
- **Local Token & Cache Telemetry:** Reads `~/.gemini/antigravity-cli/conversation_summaries.db` and `brain/*/.system_generated/logs/transcript.jsonl` to report uncached input, cache read (plus cache-hit %), output tokens, and per-model breakdowns across `5h`, `24h`, `7d`, and `All`.
- **Multi-Mac Support (LAN / Tailscale):**
  - **Option A (Open over LAN/Tailscale):** Run on one Mac (`0.0.0.0:4321`) and open `http://<mac-ip>:4321` from another Mac's browser.
  - **Option B (Run on Multiple Macs & Compare Side-by-Side):** Run `./run.sh` on two Macs and link the second Mac via `--peer http://second-mac.local:4321` (or directly in the dashboard's **Cross-Mac Comparison** box) to see shared subscription quotas plus per-Mac token usage side by side.
- **4-State Responsive UI + Light/Dark Mode:** Includes Loading skeletons, Empty window state, Populated dashboard, and Error recovery banner.

---

## Quick Start

Requires **Node.js >= 20** (no `npm install` needed — zero third-party npm dependencies!).

```bash
git clone https://github.com/kkarimz/agy-pulse.git
cd agy-pulse
./run.sh
```

Then open in your browser:
- On the same Mac: `http://localhost:4321`
- From your other Mac on the same Wi-Fi/LAN or Tailscale: `http://<hostname-or-lan-ip>:4321` (printed at startup and shown in the top bar)

---

## Using on Your Own Account (Settings & Onboarding)

`agy-pulse` never stores credentials, tokens, or account identifiers in this repository. Each person runs it locally against their own signed-in Antigravity CLI session:

1. Install & sign in to the Antigravity CLI (`agy`) on your Mac:
   ```bash
   agy
   ```
2. Start `agy-pulse` (`./run.sh` or `npm start`) and click **⚙️ Settings** in the top bar:
   - Verify **agy CLI Binary**, **Google OAuth Session**, and **Local SQLite Telemetry** status.
   - Customize your **Profile / Plan Name**, **This Mac Label**, **Second Mac (Peer URL)**, **Default Landing View**, **Low Quota Warning Threshold (%)**, **Claude & GPT visibility**, or custom `agy` / data directory paths.
   - Settings are stored locally in `~/.gemini/antigravity-cli/agy-pulse-config.json` (git-ignored and never committed).

---

## Linking Two Macs Side by Side (Optional)

1. Start `agy-pulse` on **Mac B**:
   ```bash
   ./run.sh --label "Secondary Mac"
   ```
2. On **Mac A** (or directly in the browser under **Cross-Mac Comparison**):
   ```bash
   ./run.sh --label "Primary Mac" --peer http://second-mac.local:4321
   ```
   *(Or use the second Mac's LAN/Tailscale IP, e.g. `http://10.0.0.45:4321`.)*

If the peer Mac is asleep or offline, the dashboard continues working smoothly and displays `Offline / Asleep` for the peer panel.

---

## Auto-Start on Login (`launchd`)

To run `agy-pulse` silently in the background on macOS:

```bash
./scripts/install-launchd.sh
```

You can also pass `--label "Primary Mac"`, `--port 4321`, or `--peer http://second-mac.local:4321` to `install-launchd.sh`. To stop and remove the background service:

```bash
./scripts/install-launchd.sh --uninstall
```

Or generate a plist manually without installing:

```bash
npm run launchd
```

---

## CLI Options & Environment Variables

| Flag | Env Var | Default | Description |
| :--- | :--- | :--- | :--- |
| `--port <n>` | `PORT` | `4321` | HTTP listening port |
| `--host <addr>` | `HOST` | `0.0.0.0` | Bind address (`0.0.0.0` enables LAN/Tailscale access) |
| `--peer <url>` | `PEER_MAC_URL` | `""` | Optional peer Mac base URL (`http://...:4321`) |
| `--label <name>` | `MAC_LABEL` | `os.hostname()` | Friendly Mac badge label |
| `--data-dir <path>` | `AGY_DATA_DIR` | `~/.gemini/antigravity-cli` | Antigravity state directory |
| `--agy-bin <path>` | `AGY_BIN` | auto-detected | Path to `agy` CLI binary |
| `--print-launchd` | — | `false` | Print macOS `launchd` plist XML and exit |

---

## API Endpoints

- `GET /api/health` — Machine metadata, LAN URL, Node version, and resolved `agy` binary path.
- `GET /api/summary?window=5h|24h|7d|all&refresh=0|1&peer=<url>` — Combined live quotas, credits, model, local telemetry, snapshot history, and peer Mac telemetry.
- `GET /api/history?limit=120` — Local quota snapshot history (`~/.gemini/antigravity-cli/agy-pulse-history.json`).
- `GET /api/peer?window=5h|24h|7d|all` — Read-only machine & telemetry payload used for cross-Mac federation.

---

## Running Tests

```bash
npm test
```

---

## Troubleshooting

- **`agy` CLI not found:** Ensure Antigravity CLI is installed and available via `~/.gemini/antigravity-cli/bin/agy`, `~/.local/bin/agy`, or set `AGY_BIN=/path/to/agy`.
- **Peer Mac shows `Offline / Asleep`:** Confirm port `4321` is allowed by macOS Firewall on the peer Mac (allow incoming connections for `node`) and both Macs are on the same LAN or Tailscale network.
- **Older Node.js on second Mac:** Node 22.5+ uses built-in `node:sqlite` directly; Node 20.x automatically falls back to macOS's built-in `sqlite3 -readonly -json`.
