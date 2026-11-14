# Architecture: Antigravity Pulse (`agy-pulse`)

## 1. Design Philosophy

`agy-pulse` is a **zero-dependency Node.js + Web application** built on standard ESM JavaScript, native `node:http`, `node:sqlite`, `node:child_process`, and vanilla HTML/CSS/SVG. Because it avoids third-party npm packages and native compilation toolchains, it installs and launches identically on any **Mac** with Node.js `>=20.0.0`.

All access to Antigravity state and binaries is **strictly read-only** and uses documented CLI commands.

---

## 2. Backend Module Pipeline

```
┌─────────────────────────────────────────────────────────────────────────┐
│                             src/server.mjs                              │
│  HTTP API (/api/health, /api/summary, /api/history, /api/peer) + Static │
└───────────┬──────────────────────┬───────────────────────┬──────────────┘
            │                      │                       │
            ▼                      ▼                       ▼
┌──────────────────────┐ ┌─────────────────────┐ ┌────────────────────────┐
│  src/collector.mjs   │ │  src/telemetry.mjs  │ │     src/peer.mjs       │
│  agy -p "/usage"     │ │ conversation_       │ │  GET <peer>/api/peer   │
│  agy -p "/credits"   │ │   summaries.db      │ │  (LAN / Tailscale      │
│  agy -p "/model"     │ │ brain/*/transcript  │ │   cross-Mac federation)│
│  settings.json       │ └──────────┬──────────┘ └────────────────────────┘
└───────────┬──────────┘            │
            │                       ▼
            ▼              ┌─────────────────────┐
┌──────────────────────┐   │    Local Files      │
│   src/history.mjs    │   │ (Read-only SQLite   │
│ agy-pulse-history    │   │  & JSONL streaming) │
│   .json snapshots    │   └─────────────────────┘
└──────────────────────┘
```

### 2.1 Live CLI Collector (`src/collector.mjs`)
- **Binary Resolution (`resolveAgyBinary`)**: Checks `AGY_BIN`, `~/.gemini/antigravity-cli/bin/agy`, `~/.local/bin/agy`, `/opt/homebrew/bin/agy`, `/usr/local/bin/agy`, then falls back to `agy` on `PATH`.
- **Parallel Sanctioned Queries**: Invokes:
  - `agy -p "/usage" --output-format json --print-timeout 10s`
  - `agy -p "/credits" --output-format json --print-timeout 10s`
  - `agy -p "/model" --output-format json --print-timeout 10s`
- **Burn-Rate Pace Formula (`calculateBucketPace`)**:
  - `windowHours`: `5` for `5h` buckets, `168` (7 days) for `weekly` buckets.
  - `elapsedFraction = clamp((windowDurationMs - msUntilReset) / windowDurationMs, 0, 1)`
  - `usedFraction = 1 - remaining_fraction`
  - `paceDelta = usedFraction - elapsedFraction`
  - Pace classification:
    - **Burning Fast (`burning_fast`)**: `remaining_fraction <= 0.15` or `paceDelta > 0.12`
    - **On Pace (`on_pace`)**: `paceDelta > -0.05`
    - **Safe (`safe`)**: otherwise (`paceDelta <= -0.05`)
  - **Projected Exhaustion**: When `usedFraction > 0.01` and `elapsedMs > 60s`, computes linear `burnRatePerMs = usedFraction / elapsedMs` and estimates `msToExhaustion = remaining_fraction / burnRatePerMs` relative to `msUntilReset`.

### 2.2 Local Token & SQLite Telemetry Engine (`src/telemetry.mjs`)
- **Dual-Engine Read-Only SQLite**: Uses Node's built-in `node:sqlite` (`DatabaseSync(dbPath, { readOnly: true })`) when available (Node 22.5+) and seamlessly falls back to `sqlite3 -readonly -json` on Node 20.x.
- **Streaming JSONL Aggregation**: Streams `brain/<conversationId>/.system_generated/logs/transcript.jsonl` line-by-line via `node:readline`, filtering `PLANNER_RESPONSE` entries within the active window (`5h`, `24h`, `7d`, `all`).
- **Metrics Computed**:
  - Uncached `input_tokens`, `cache_read_tokens`, `output_tokens`, `totalTokens`, and `cacheEfficiencyPercent` (`cache_read_tokens / (input_tokens + cache_read_tokens)`).
  - Per-model breakdowns, hourly/daily activity buckets, and enriched conversation list merged with SQLite titles and workspaces.

### 2.3 Snapshot History (`src/history.mjs`)
- Persists bounded time-series quota snapshots (max 500 entries) to `<dataDir>/agy-pulse-history.json`, deduplicating entries within 60 seconds when percentages have not changed by `>= 0.1%`.

### 2.4 Cross-Mac Federation (`src/peer.mjs`)
- Because both Macs share the same Google Antigravity subscription account, either Mac reports live subscription quotas while tracking its own local SQLite/JSONL token usage.
- Setting `PEER_MAC_URL` (via env var, `--peer <url>`, or the UI panel) fetches `/api/peer` from the second Mac over LAN or Tailscale with a 4-second timeout so the dashboard gracefully degrades if the second Mac is asleep or offline.
