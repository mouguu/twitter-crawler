# XRCrawler

> AI-powered Twitter/X & Reddit archiver with queue-based workers, live SSE telemetry, and WASM-accelerated processing.

## Table of Contents
- [Overview](#overview)
- [What’s Inside](#whats-inside)
- [Requirements](#requirements)
- [Installation](#installation)
- [Configure Cookies](#configure-cookies)
- [Run (Web UI)](#run-web-ui)
- [Run (CLI)](#run-cli)
- [Realtime Pipeline](#realtime-pipeline)
- [Output Layout](#output-layout)
- [Troubleshooting](#troubleshooting)

## Overview
XRCrawler bypasses Twitter/X’s ~800-tweet wall using date chunking, resilient session rotation, and a Rust/WASM micro-kernel for fast, low-memory exports. A queue-based pipeline (BullMQ + Redis) streams live logs and progress to the Mission Control web UI, with one-click markdown downloads.

## What’s Inside
- **Platforms**: Twitter/X + Reddit (optional helper API).
- **Mission Control UI**: Live SSE logs/progress, Abort/Dismiss controls, one-click **Download .md**, friendly session labels for `account1.json`–`account4.json` (e.g., Sistine Fibel, pretextyourmama, Shirone, Jeanne Howard).
- **Queue & Telemetry**: BullMQ on Redis; workers publish progress/logs via Pub/Sub to `/api/job/:id/stream` (EventSource).
- **Exports**: Markdown (LLM-ready), JSON; WASM micro-kernel handles dedupe/normalization for speed and stability.
- **Session Rotation**: Drop multiple cookie files under `cookies/` for automatic rotation.

## Requirements
- Node.js 18+
- pnpm
- Redis running locally on `6379` (queue + SSE)
- Python 3 (for the optional Reddit helper API started by `pnpm run dev`)

## Installation
```bash
git clone https://github.com/mouguu/XRCrawler.git
cd XRCrawler
pnpm install
pnpm run install:frontend    # install frontend deps
```

Optional (rebuild WASM toolchain if you change Rust code):
```bash
pnpm run build:wasm:all
```

## Configure Cookies
Export Twitter cookies (e.g., via EditThisCookie) and place them in `cookies/`:
- `cookies/account1.json`, `account2.json`, … are auto-rotated.
- Mission Control shows friendly labels for account1–4.

## Run (Web UI)
```bash
pnpm run dev
# Opens http://localhost:5173 (frontend)
# Also starts: server, worker, Reddit helper API (auto-venv under platforms/reddit)
```
Ensure Redis is running; otherwise progress/log streaming will be missing.

## Run (CLI)
```bash
pnpm run build
node dist/cli.js twitter -u elonmusk --mode search --deep-search --start-date 2020-01-01
```
See `docs/CLI_USAGE.md` for more options (profile/thread/search, limits, date ranges, etc.).

## Realtime Pipeline
1) BullMQ enqueues jobs.  
2) Worker processes, publishes `job:{id}:progress` and `job:{id}:log` via Redis Pub/Sub.  
3) Server streams them over SSE at `/api/job/:id/stream`.  
4) Mission Control renders live progress/logs; on completion, it shows a **Download .md** button.  
If SSE payload lacks `downloadUrl`, the UI will fetch `/api/job/{id}` as a fallback.

## Output Layout
```
output/
├── x/{username}/run-{timestamp}/
│   ├── index.md        # summary / entry point
│   ├── tweets.json     # full raw data
│   ├── metadata.json   # run stats
│   └── 001-xxxx.md     # optional per-tweet markdown
```

## Troubleshooting
- **No live logs/progress**: Verify Redis is running; check `/api/job/{id}/stream` in DevTools Network for events.
- **Download button missing URL**: Click “Get Download” on the card (it will fetch `/api/job/{id}`); ensure worker writes `downloadUrl` to the job result.
- **Redis connection errors**: Confirm host/port match your Redis instance (defaults to localhost:6379).
- **Reddit helper not starting**: Ensure Python 3 is installed; the script creates `.venv` under `platforms/reddit` automatically.

## License
ISC (see LICENSE).
