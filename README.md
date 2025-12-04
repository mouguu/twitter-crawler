# XRCrawler

> AI-powered Twitter/X & Reddit archiver with queue workers, live SSE telemetry, and WASM acceleration.

[![License: ISC](https://img.shields.io/badge/License-ISC-blue.svg)](https://opensource.org/licenses/ISC)
[![TypeScript](https://img.shields.io/badge/TypeScript-5.0-blue)](https://www.typescriptlang.org/)
[![Docker](https://img.shields.io/badge/Docker-Enabled-blue)](https://www.docker.com/)
[![Redis](https://img.shields.io/badge/Redis-Queue-red)](https://redis.io/)
[![WASM](https://img.shields.io/badge/WASM-Rust-orange)](https://webassembly.org/)

---

## 🖥️ Web UI

<p align="center">
  <img src="docs/images/web-ui-screenshot.png" alt="XRCrawler Web UI" width="100%" />
</p>

**Modern, minimalist interface** inspired by [Paradigm.xyz](https://paradigm.xyz) design principles:

- **📊 Platform Selector** — Choose between Profile, Thread, Search, or Reddit modes with intuitive cards
- **⚡ Real-time Dashboard** — Monitor active jobs with live progress, logs, and SSE streaming
- **🔐 Session Manager** — Upload and manage multiple cookie files with custom naming
- **🎯 Smart Configuration** — GraphQL/Puppeteer/Mixed modes, date chunking, parallel scrapers
- **🌓 Dark/Light Mode** — Professional aesthetics with smooth transitions

---

## ✨ Highlights

- **Break the ~800 tweet wall**: Date chunking + resilient session rotation for deep timelines.
- **Rust/WASM micro-kernel**: Fast, low-memory dedupe/normalization; LLM-ready Markdown export.
- **Modern Web UI**: Real-time SSE streaming, live progress/logs, one-click **Download .md**, with custom session naming.
- **Queue-first architecture**: BullMQ on Redis; workers publish progress/logs via Pub/Sub, server streams to `/api/job/:id/stream`.
- **Multi-platform**: Twitter/X + Reddit, all in TypeScript with plugin-style adapters.

---

## 🧰 Requirements

- **Node.js** 20+ (LTS recommended)
- **pnpm** (enforced - no npm/yarn)
- **Redis** on `localhost:6379` (for queue + SSE pub/sub)
- **PostgreSQL** 14+ (for data persistence and resume capabilities)

**Using Docker Compose?** All services (Redis + PostgreSQL) are included.

---

## 🚀 Quick Start

### 1. Install

```bash
git clone https://github.com/mouguu/XRCrawler.git
cd XRcrawler
pnpm install                # Installs deps + auto-builds WASM
pnpm run install:frontend   # Install frontend deps
```

> **Note**: `pnpm install` automatically runs `postinstall` to build Rust/WASM modules.

---

### 2. Setup Database (PostgreSQL)

**Option A: Docker Compose (Recommended)**

```bash
docker-compose up -d postgres
```

**Option B: Use your own PostgreSQL**

```bash
# Set DATABASE_URL
export DATABASE_URL="postgresql://user:password@localhost:5432/xrcrawler"
```

**Push Schema:**

```bash
npx prisma db push
npx prisma generate
```

👉 **See [DATABASE.md](docs/DATABASE.md)** for detailed database setup.

---

### 3. Configure Cookies

Export Twitter cookies (e.g., using [EditThisCookie](https://www.editthiscookie.com/) or browser DevTools) to the `cookies/` directory:

```
cookies/
├── my_main_account.json
├── backup_account.json
└── ...any_name_you_want.json
```

> **Tip:** Use the Web UI's **Session Manager** to upload cookies with custom names. The system supports unlimited accounts with automatic rotation.

---

### 4. Run (Web UI - Recommended)

```bash
pnpm run dev
# Opens http://localhost:5173
# Starts server, worker, frontend, and database concurrently
```

> **Important**: Ensure Redis and PostgreSQL are running; otherwise progress/log streaming will be missing.

**Access**:

- **Frontend**: http://localhost:5173
- **API**: http://localhost:5001
- **Queue Dashboard**: http://localhost:5001/admin/queues
- **Database Studio**: `npx prisma studio` → http://localhost:5555
- **Health Check**: http://localhost:5001/api/health
- **Stats Dashboard**: http://localhost:5001/api/stats

---

### 5. Run (Docker Compose - One Command)

**Setup cookies first**:

```bash
mkdir -p data/cookies
# Place your cookie files:
# data/cookies/account1.json
# data/cookies/account2.json
# ...
```

**Run**:

```bash
docker compose up --build -d
```

**Services**:

- `postgres`: PostgreSQL database
- `redis`: Queue + Pub/Sub
- `app`: Server + Static UI
- `worker`: Job processor

**Volumes**: `./data` → `/app/data` (cookies + output)

**Ports**:

- `5001`: Server/UI
- `6379`: Redis

**Logs**:

```bash
docker compose logs -f app worker
```

---

## 🛠️ CLI Usage

### Build First

```bash
pnpm run build
```

### Examples

**Scrape a Twitter profile**:

```bash
node dist/cmd/cli.js twitter -u elonmusk -c 50
```

**Scrape a thread**:

```bash
node dist/cmd/cli.js twitter --thread https://x.com/user/status/123456
```

**Search Twitter**:

```bash
node dist/cmd/cli.js twitter --query "climate change" -c 100
```

**Scrape Reddit**:

```bash
node dist/cmd/cli.js reddit -r programming -c 500
```

**More Options**: See detailed CLI guide below.

---

## 📚 Documentation

We have comprehensive documentation for all aspects of the project:

| Document                                      | Description                                                    |
| --------------------------------------------- | -------------------------------------------------------------- |
| [**DATABASE.md**](docs/DATABASE.md)           | PostgreSQL schema, repositories, and SQL analysis tools        |
| [**OPERATIONS.md**](docs/OPERATIONS.md)       | Health checks, monitoring, rate limiting, dashboard API        |
| [**ARCHITECTURE.md**](docs/ARCHITECTURE.md)   | Technical architecture and component overview                  |
| [**API_REFERENCE.md**](docs/API_REFERENCE.md) | REST API endpoints documentation                               |
| [**CONFIGURATION.md**](docs/CONFIGURATION.md) | Configuration system guide (ConfigManager, env vars, priority) |
| [**LOGGING.md**](docs/LOGGING.md)             | Logging standards for Node.js and Python services              |
| [**CONTRIBUTING.md**](CONTRIBUTING.md)        | Contribution guidelines and code standards                     |

---

## 🔌 Realtime Pipeline

**How live progress works**:

1. **BullMQ** enqueues jobs
2. **Worker** processes jobs and publishes:
   - `job:{id}:progress` (current/total)
   - `job:{id}:log` (info/warn/error messages)
   - Via **Redis Pub/Sub**
3. **Server** streams via **SSE** at `/api/job/:id/stream`
4. **Frontend** renders live progress/logs; on completion shows **Download .md**

If SSE payload lacks `downloadUrl`, UI fetches `/api/job/{id}` as fallback.

---

## 🧩 Platform Adapter System

XRCrawler uses a **plugin-style architecture** for multi-platform support:

- **Core worker** dispatches by platform name via adapters (`core/platforms/*-adapter.ts`)
- **Registered** in `core/platforms/registry.ts`
- **Contract**: `PlatformAdapter.process(job, ctx)` → `ScrapeJobResult`
  - Optional: `init()`, `classifyError()`
- **Shared types**: `core/platforms/types.ts`

**Existing platforms**:

- ✅ Twitter/X (`twitter-adapter.ts`)
- ✅ Reddit (`reddit-adapter.ts`)

**To add a new platform**:

1. Create `core/platforms/yourplatform-adapter.ts`
2. Implement `PlatformAdapter` interface
3. Register in `registry.ts`: `registerAdapter(yourAdapter)`
4. Pass `job.data.type = 'yourplatform'` from API

---

## 📂 Output Layout

```
output/
├── x/{username}/run-{timestamp}/
│   ├── index.md           # Human-readable summary
│   ├── tweets.json        # Full raw data
│   ├── tweets.md          # All tweets in Markdown
│   ├── metadata.json      # Run statistics
│   └── ai-persona.txt     # LLM analysis prompt (auto-generated)
└── reddit/{subreddit}/run-{timestamp}/
    ├── index.md
    ├── posts.json
    └── posts.md
```

---

## 🧪 Development

### Run Tests

```bash
pnpm run test
```

### Lint & Type Check

```bash
pnpm run lint
```

### Format Code

```bash
pnpm run format        # Auto-format all code
pnpm run format:check  # Check formatting
```

### Build WASM (if editing Rust)

```bash
pnpm run build:wasm:all
```

---

## 🧭 Troubleshooting

### No live logs/progress in UI

- **Check Redis**: Ensure Redis is running on `localhost:6379`
- **Inspect Network**: Watch `/api/job/{id}/stream` events in DevTools

### Download button missing URL

- Click **"Get Download"** (fetches `/api/job/{id}`)
- Ensure worker sets `downloadUrl` in job result

### Redis connection errors

- Verify Redis host/port in configuration
- Default: `localhost:6379`
- Set via env: `REDIS_HOST=yourhost REDIS_PORT=6379`

### TypeScript compilation errors

```bash
pnpm run lint  # Check for type errors
pnpm run build # Rebuild
```

### WASM build errors

```bash
# Install Rust toolchain
curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh
rustup target add wasm32-unknown-unknown

# Rebuild WASM
pnpm run build:wasm:all
```

---

## 🗂️ Project Structure

```
XRcrawler/
├── cmd/                    # Entry points
│   ├── cli.ts             # CLI application
│   ├── start-server.ts    # API server
│   └── start-worker.ts    # Queue worker
├── core/                   # Core business logic
│   ├── scrape-unified.ts  # Main scraping API
│   ├── platforms/         # Platform adapters
│   └── queue/             # BullMQ workers
├── frontend/               # React UI (Vite)
├── utils/                  # Utilities
├── types/                  # Shared TypeScript types
├── wasm/                   # Rust/WASM modules
│   ├── tweet-cleaner/
│   ├── reddit-cleaner/
│   └── url-normalizer/
├── docs/                   # Documentation
└── config/                 # Constants and config
```

---

## 🤝 Contributing

We welcome contributions! Please see [CONTRIBUTING.md](CONTRIBUTING.md) for:

- Code style guidelines (EditorConfig, Prettier)
- Testing requirements
- Pull request process

---

## 🛠️ Tech Stack

### Backend

| Technology                                            | Purpose                                                               |
| ----------------------------------------------------- | --------------------------------------------------------------------- |
| **[Node.js](https://nodejs.org/) 22**                 | Runtime environment                                                   |
| **[TypeScript](https://www.typescriptlang.org/) 5.x** | Type-safe JavaScript                                                  |
| **[Express](https://expressjs.com/)**                 | HTTP server framework                                                 |
| **[BullMQ](https://docs.bullmq.io/)**                 | Redis-backed job queue with retries, backoff, and concurrency control |
| **[Prisma](https://www.prisma.io/)**                  | Type-safe ORM for PostgreSQL                                          |
| **[Puppeteer](https://pptr.dev/)**                    | Headless Chrome for dynamic content scraping                          |

### Database & Cache

| Technology                                       | Purpose                                                      |
| ------------------------------------------------ | ------------------------------------------------------------ |
| **[PostgreSQL](https://www.postgresql.org/) 15** | Persistent storage for jobs, tweets, checkpoints, error logs |
| **[Redis](https://redis.io/) 7**                 | Job queue, Pub/Sub for real-time SSE, caching                |

### Frontend

| Technology                                          | Purpose                                   |
| --------------------------------------------------- | ----------------------------------------- |
| **[React](https://react.dev/) 18**                  | UI components                             |
| **[Vite](https://vitejs.dev/)**                     | Fast dev server and build tool            |
| **[TypeScript](https://www.typescriptlang.org/)**   | Type-safe frontend code                   |
| **[Tailwind CSS](https://tailwindcss.com/)**        | Utility-first CSS framework               |
| **[shadcn/ui](https://ui.shadcn.com/)**             | High-quality accessible component library |
| **[Framer Motion](https://www.framer.com/motion/)** | Smooth animations and transitions         |

### Performance (Rust/WASM)

| Module               | Purpose                                    |
| -------------------- | ------------------------------------------ |
| **`tweet-cleaner`**  | Fast tweet deduplication and normalization |
| **`reddit-cleaner`** | Reddit post/comment cleaning               |
| **`url-normalizer`** | URL canonicalization for dedup             |

> Built with Rust + `wasm-pack`, compiled to WebAssembly for near-native performance in Node.js.

### DevOps

| Technology                                                | Purpose                       |
| --------------------------------------------------------- | ----------------------------- |
| **[Docker](https://www.docker.com/)**                     | Containerization              |
| **[Docker Compose](https://docs.docker.com/compose/)**    | Multi-container orchestration |
| **[Bull Board](https://github.com/felixmosh/bull-board)** | Queue monitoring dashboard    |
| **[Prisma Studio](https://www.prisma.io/studio)**         | Database GUI                  |

### Architecture Patterns

- **Queue-first design**: All scraping jobs go through BullMQ for reliability
- **Event-driven**: Redis Pub/Sub for real-time progress streaming via SSE
- **Platform adapters**: Plugin architecture for multi-platform support
- **Resume-capable**: Checkpoints saved to PostgreSQL for crash recovery
- **Error classification**: Smart retry strategies based on error types

---

## 📜 License

ISC - See [LICENSE](LICENSE) for details.

---

## 🙏 Acknowledgments

Built with:

- [BullMQ](https://github.com/taskforcesh/bullmq) - Robust queue system
- [Puppeteer](https://pptr.dev/) - Browser automation
- [Redis](https://redis.io/) - Fast data store
- [Prisma](https://www.prisma.io/) - Next-generation ORM
- [Rust/WASM](https://www.rust-lang.org/what/wasm) - High-performance data processing
- [React](https://react.dev/) + [Vite](https://vitejs.dev/) - Frontend
