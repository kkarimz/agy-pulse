# Product Requirements Document: Antigravity Pulse (`agy-pulse`)

**Version:** 1.0  
**Repository:** `agy-pulse`  
**Target Platform:** Web + Local Node.js Server (macOS)  

---

## 1. Product Overview & Goal

**Antigravity Pulse (`agy-pulse`)** is a lightweight, zero-config web application for **macOS**. It monitors and reports Gemini Antigravity subscription quotas, rolling usage windows (5-hour and weekly limits), G1 AI credits, burn-rate pace, and local token/conversation telemetry.

In addition to running locally on each machine (`http://localhost:<port>`), `agy-pulse` supports LAN/Tailscale cross-Mac access (`--host 0.0.0.0`) and optional peer Mac federation (`PEER_MAC_URL`), allowing a single dashboard view to display shared subscription quotas alongside per-Mac local token usage comparisons across multiple Macs.

---

## 2. Sanctioned Data Sources (100% Read-Only)

All data collection uses documented, sanctioned CLI interfaces and read-only access to local Antigravity state files:

1. **Live Subscription Quotas (`agy -p "/usage" --output-format json`)**
   - Returns structured quota groups and buckets:
     - **Gemini Models** (`Gemini 4 Hydrogen`, `Gemini 3.8 Flash`): Weekly Limit Remaining (`weekly`) and Five Hour Limit Remaining (`5h`)
     - **Gemini 4 Argon**: Weekly Limit Remaining (`weekly`)
     - **Claude and GPT models** (`Claude Opus 5.5`, `Claude Sonnet 5.5`, `GPT-OSS 120B`): Weekly Limit Remaining (`weekly`) and Five Hour Limit Remaining (`5h`)
   - Provides exact `remaining_fraction`, `reset_time` (ISO-8601 UTC), `window`, and human-readable status descriptions.

2. **Credits, Active Model & Settings (`agy -p "/credits" --output-format json`, `agy -p "/model" --output-format json`, `~/.gemini/antigravity-cli/settings.json`)**
   - Remaining G1 AI credits (`remaining_credits`), upgrade link (`upgrade_uri`), and `useG1Credits` overage toggle state.
   - Currently active default model ID, human-readable label, and reasoning effort level.

3. **Local SQLite & JSONL Transcript Telemetry (`~/.gemini/antigravity-cli/conversation_summaries.db` & `~/.gemini/antigravity-cli/brain/<id>/.system_generated/logs/transcript.jsonl`)**
   - Read-only telemetry aggregation across conversations and step logs:
     - `input_tokens`, `cache_read_tokens` (and derived cache-hit efficiency %), `output_tokens`
     - Thinking / tool-call step counts
     - Breakdowns by model, workspace URI, and date/time window.

4. **Local Quota Snapshot History (`~/.gemini/antigravity-cli/agy-pulse-history.json`)**
   - Appends time-stamped quota fraction snapshots locally so the dashboard can plot historical quota burn trends over time without external databases.

---

## 3. User Stories & Acceptance Criteria

### US-1: Live CLI Quota & Credits Collector Service
**As a** Gemini Antigravity subscriber,  
**I want** a backend collector service that pulls live quota, credit, and model data from `agy`,  
**So that** I always see accurate remaining percentages, reset countdowns, and burn-rate pace.

**Acceptance Criteria:**
- Executes `agy -p "/usage" --output-format json`, `agy -p "/credits" --output-format json`, and `agy -p "/model" --output-format json` safely with configurable timeout and short-lived in-memory caching (plus force-refresh support).
- Reads `useG1Credits` from `~/.gemini/antigravity-cli/settings.json` in read-only mode.
- Normalizes all model group buckets (`Gemini Models`, `Gemini 4 Argon`, `Claude and GPT models`) across `5h` and `weekly` windows.
- Computes **Burn-Rate Pace** for each bucket by comparing `% quota used` vs. `% time elapsed` in the rolling window (5 hours or 7 days), generating status badges (`Safe`, `On Pace`, `Burning Fast`), projected time-to-exhaustion, and live reset countdowns.
- Degrades gracefully with structured error details if `agy` is missing, times out, or returns non-JSON output.

### US-2: Local Transcript & SQLite Token Telemetry Engine
**As a** user running Antigravity on macOS,  
**I want** the app to summarize local token consumption and conversation activity from Antigravity's local files,  
**So that** I understand which models, workspaces, and sessions consume my quota on each machine.

**Acceptance Criteria:**
- Opens `~/.gemini/antigravity-cli/conversation_summaries.db` in read-only mode to retrieve conversation metadata (`conversation_id`, `title`, `workspace_uris`, `last_modified_time`, `step_count`).
- Streams and parses `~/.gemini/antigravity-cli/brain/*/.system_generated/logs/transcript.jsonl` to aggregate `input_tokens`, `cache_read_tokens`, `output_tokens`, and step counts per model, conversation, and workspace.
- Computes cache efficiency (`cache_read_tokens / (input_tokens + cache_read_tokens)`).
- Supports filtering aggregations by time window: `Last 5h`, `24h`, `7d`, and `All-Time`.
- Gracefully handles missing/empty SQLite or transcript files (returning clean empty telemetry rather than crashing).

### US-3: Quota Snapshot History & Multi-Mac Peer API
**As a** user with two Macs sharing one Antigravity subscription,  
**I want** historical quota tracking and optional peer Mac telemetry federation,  
**So that** I can view quota burn trends over time and compare multiple Macs side by side in one dashboard.

**Acceptance Criteria:**
- Persists deduplicated periodic quota snapshots to `~/.gemini/antigravity-cli/agy-pulse-history.json` (configurable path for testing) with bounded retention.
- Exposes REST JSON endpoints:
  - `GET /api/health` (machine hostname, node/app version, `agy` availability)
  - `GET /api/summary?window=5h|24h|7d|all&refresh=1` (live quotas, credits, model, local telemetry, snapshot history, and peer Mac summary if configured)
  - `GET /api/history` (time-series snapshots)
  - `GET /api/peer` (read-only machine telemetry payload for peer polling)
- Supports optional `PEER_MAC_URL` environment variable / CLI flag to fetch and merge a peer Mac's local token telemetry into a unified cross-Mac comparison view without failing if the peer Mac is offline/asleep.

### US-4: Responsive 4-State Web Dashboard (Light/Dark + Color-Blind Safe)
**As a** user checking my subscription health from a browser on either Mac,  
**I want** a clear, responsive, accessible web UI,  
**So that** I can immediately read remaining quotas, burn pace, and token breakdowns in Light or Dark mode.

**Acceptance Criteria:**
- Implements all **4 UI states**: **Loading** (skeleton loaders), **Empty** (no local sessions yet), **Populated** (full quota & telemetry dashboard), and **Error** (actionable retry banner when `agy` or backend fails).
- Supports **Light and Dark themes** (respecting `prefers-color-scheme` with manual toggle) using a **color-blind-safe** palette and clear icons/text badges (never relying solely on red/green color).
- Displays radial/linear gauges for every quota bucket (`Gemini Models` 5h/weekly, `Gemini 4 Argon` weekly, `Claude and GPT models` 5h/weekly) with burn-rate pace badges (`Safe`, `On Pace`, `Burning Fast`) and live-ticking reset countdowns.
- Renders G1 AI credits card (`remaining_credits`, `useG1Credits` state, upgrade link), active model/effort pill, historical burn trend chart, token breakdown charts by model/window, recent conversations table, and Cross-Mac comparison panel (Local Mac vs. Peer Mac when configured).
- Provides manual Refresh button, configurable auto-refresh polling interval, and time-window selector (`5h`, `24h`, `7d`, `All`).

### US-5: Cross-Mac Portability & Launch Scripts
**As a** user running `agy-pulse` on one or more Macs,  
**I want** effortless setup, LAN/Tailscale binding options, and optional background launch support,  
**So that** I can start or keep the dashboard running reliably on both machines.

**Acceptance Criteria:**
- Zero-config startup via `npm install && npm start` or `./run.sh` (auto-detecting `agy` path and local `~/.gemini/antigravity-cli` directory).
- Supports `--port <port>`, `--host 0.0.0.0` (for LAN/Tailscale access between Macs), and `--peer <url>` configuration via CLI flags or environment variables.
- Includes a `launchd` plist generator script (`scripts/install-launchd.sh` / `--print-launchd`) so users can optionally run `agy-pulse` as a background LaunchAgent on macOS.
- Comprehensive `README.md` documenting single-Mac setup, optional multi-Mac LAN/Tailscale pairing, and troubleshooting.

---

## 4. Non-Functional Requirements & Architecture Guardrails

- **Zero External Paid Dependencies:** Uses Node.js built-ins / lightweight open-source packages only; no external hosted database or third-party cloud API keys required.
- **Strict Read-Only Antigravity Access:** Never modifies `~/.gemini/antigravity-cli/settings.json`, `conversation_summaries.db`, `antigravity-oauth-token`, or `brain/` transcripts. Only writes its own `agy-pulse-history.json` snapshot file.
- **Automated Testing:** Unit tests for CLI JSON parsing, burn-rate pace calculation, transcript/SQLite telemetry aggregation, history persistence, and HTTP API integration tests using mock fixtures.
- **PR-Gated Workflow:** After the initial `main` bootstrap commit, all implementation work occurs on `feature/*` or `fix/*` branches and merges into `main` via GitHub PR review.
