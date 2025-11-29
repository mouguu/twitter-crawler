# XRCrawler

A powerful, multi-platform tool to scrape, archive, and analyze content from Twitter/X and Reddit. Designed for researchers, archivists, and AI developers.

![License](https://img.shields.io/badge/license-MIT-blue.svg)
![Node](https://img.shields.io/badge/node-%3E%3D18-green.svg)
![TypeScript](https://img.shields.io/badge/typescript-%5E5.0-blue)

## 🚀 Features

- **Dual Scraping Modes**:
  - **GraphQL API Mode** (Default): Fast, lightweight scraping using Twitter's internal GraphQL API. No browser needed, perfect for quick data collection (< 800 tweets).
  - **Puppeteer DOM Mode**: Full browser automation for deeper timeline access and complex scenarios.
  - **Mixed Mode**: Automatically starts with GraphQL API for speed, then switches to Puppeteer when API limits are reached.
- **🔥 Deep Search (Date Chunking)**: Bypasses the ~800 tweet hard limit by automatically splitting the timeframe into monthly chunks. Scrapes from newest to oldest with **no depth limit**.
- **Seamless Auto-Switching**: Automatically detects when a target requires deep scraping (>800 tweets) and switches strategies transparently.
- **Multi-Mode Scraping**:
  - **User Profiles**: Scrape tweets, replies, and pinned tweets.
  - **Home Timeline**: Scrape the "For You" or "Following" feed of the logged-in account.
  - **Threads**: Archive complete conversation threads, including nested replies.
  - **Search**: Advanced search scraping (keywords, hashtags, date ranges, user filters).
  - **Likes**: Extract tweets liked by a specific user.
- **Reddit Integration**:
  - **Subreddit Scraping**: Scrape posts from any subreddit.
  - **Post Scraping**: Scrape individual Reddit posts with all comments.
  - **Multi-Strategy**: Auto, Super Full, Super Recent, and New modes.
  - **Local Storage**: Saves data to JSON and Markdown without external databases.
- **AI-Powered Analysis**:
  - **Persona Mode**: Automatically generates AI prompts and analysis based on scraped user data.
  - **Smart Exports**: Outputs clean Markdown and JSON optimized for LLM context windows.
- **Resilient Architecture**:
  - **Smart Session Rotation**: Automatically rotates accounts on rate limits.
  - **Data Gap Prevention**: If a session fails during a time chunk, the next session **retries the same chunk** to ensure no data is lost.
  - **"Try Again" Handling**: Automatically detects and recovers from Twitter's frontend error screens.
  - **Task Queue System**: Manages concurrent requests with priority queuing to prevent conflicts and ensure orderly execution.
- **Browser Pool**: Reuses browser instances to reduce overhead and improve performance.
- **Progress Management**: Resume interrupted scrapes from the last saved checkpoint.
  - **Error Snapshotting**: Captures screenshots and error details for debugging.
  - **Performance Monitoring**: Real-time metrics collection and reporting.
- **Flexible Output**:
  - Structured JSON/CSV for data analysis.
  - Markdown for reading and LLM ingestion.
  - Automatic media detection.
- **Web Interface Features**:
  - **Session Manager**: Upload and manage multiple Twitter cookie files via UI with validation.
  - **Real-time Progress**: Live updates via Server-Sent Events (SSE) with progress bars and log streaming.
  - **Performance Metrics**: View scraping speed, success rates, and resource usage in real-time.
  - **API Key Protection**: Optional API key authentication for secure deployments.
  - **Error Notifications**: Clear error messages with retry suggestions and error classification.
  - **Results Panel**: Download scraped results (Markdown/JSON) directly from the browser.
- **Monitoring & Automation**:
  - **Monitor Service**: Track multiple users for new tweets with keyword filtering.
  - **Daily Reports**: Automated report generation for monitored accounts.
  - **Scheduled Tasks**: Run crawler on schedule with configurable intervals.

---

## 📦 Installation

### Prerequisites

- **Node.js** 18 or higher (Node 18 is used in Docker)
- **pnpm** (recommended) or **npm**
- **Python 3** (for Reddit scraping, if using Reddit features)
- **Chromium/Chrome** (automatically installed with Puppeteer, or use system Chrome)

### Setup

1. **Clone the repository**

   ```bash
   git clone https://github.com/yourusername/XRCrawler.git
   cd XRCrawler
   ```

2. **Install dependencies**

   ```bash
   pnpm install
   cd frontend && pnpm install && cd ..
   ```

3. **Configure Cookies (Required)**
   To access age-restricted content, search, or avoid rate limits, you must provide Twitter cookies.

   - **Export Cookies**: Use a browser extension like "EditThisCookie" or "Cookie-Editor" to export your Twitter cookies as JSON while logged in to X.com.
   - **Place in Directory**: Save the exported JSON file into the `cookies/` directory in the project root.
     - Example: `cookies/my-account.json`
   - **Multiple Accounts (Rotation)**: You can place multiple JSON files in the `cookies/` directory (e.g., `account1.json`, `account2.json`). The crawler will automatically rotate through them to distribute the load and reduce the risk of rate limiting.

4. **Configure Environment Variables (Optional)**

   Create a `.env` file in the project root or set environment variables:

   ```bash
   # Server Configuration
   PORT=5001
   API_KEY=your-secret-api-key  # Optional: Protect API endpoints

   # Reddit API Server
   REDDIT_API_URL=http://127.0.0.1:5002

   # Output Directory
   OUTPUT_DIR=./output

   # Logging
   LOG_LEVEL=info  # debug, info, warn, error
   ```

5. **Start Reddit API Server (If using Reddit features)**

   ```bash
   # The dev scripts will start it automatically, or run manually:
   pnpm run dev:reddit
   # Or directly:
   python3 platforms/reddit/reddit_api_server.py
   ```

---

## 🖥️ Web Interface

The easiest way to use the crawler is through the built-in web interface.

1. **Start the server**

   ```bash
   # Recommended: Fast start with Vite dev server (HMR enabled)
   pnpm run dev:fast

   # Or: Production simulation mode (builds frontend to static files)
   pnpm run dev
   ```

2. **Open your browser**

   - If using `dev:fast`: Navigate to `http://localhost:5173`
   - If using `dev`: Navigate to `http://localhost:5001`

3. **Use the UI**
   - **Session Management**: Upload cookie files via the Session Manager tab.
   - **Task Types**: Choose from Profile, Thread, Search, or Reddit scraping.
   - **Options**: Configure scrape mode, limits, date ranges, and advanced settings.
   - **Real-time Monitoring**: Watch progress, logs, and performance metrics in real-time.
   - **Download Results**: Download Markdown/JSON artifacts directly from the browser.

**Web Interface Features:**

- **Session Manager**: Upload and validate Twitter cookie files
- **API Key Protection**: Set API key in header bar for secure access
- **Progress Tracking**: Real-time progress bars and log streaming
- **Performance Dashboard**: View scraping speed and resource usage
- **Error Handling**: Clear error messages with retry suggestions

---

## CLI Usage

For automation and batch processing, use the Command Line Interface.

### Basic Commands

**Note**: After building the project (`pnpm run build`), use `node dist/cli.js` or the npm scripts. For development, you can use `ts-node cli.ts`.

**Scrape a Profile (Quick Mode)**

```bash
# Build first (if not already built)
pnpm run build

# Scrape 50 tweets (uses GraphQL API by default)
node dist/cli.js twitter -u elonmusk -c 50

# Or use npm script
pnpm start twitter -u elonmusk -c 50

# Scrape using profile URL
node dist/cli.js twitter -U https://x.com/elonmusk -c 50
```

**Deep Archive (The "Limit Breaker")**

```bash
# Scrape 2000 tweets.
# System automatically detects count > 800 and switches to Date-Chunked Deep Search.
node dist/cli.js twitter -u elonmusk -c 2000 --mode puppeteer
```

**Resume Interrupted Scrape**

```bash
# Continues from where you left off (based on the oldest tweet ID found previously)
node dist/cli.js twitter -u elonmusk -c 2000 --mode puppeteer --resume

# Resume from a specific tweet ID
node dist/cli.js twitter -u elonmusk -c 2000 --mode puppeteer --resume-from 1234567890123456789
```

**Scrape a Thread**

```bash
# Archive a specific thread with up to 100 replies
node dist/cli.js twitter --thread https://x.com/username/status/123456789 --max-replies 100
```

**Scrape Home Timeline**

```bash
# Scrape the logged-in account's home feed (For You / Following)
node dist/cli.js twitter --home -c 100
```

**Search Mode**

```bash
# Search for tweets matching a query
node dist/cli.js twitter --query "climate change" -c 200

# Search with date range (requires puppeteer mode)
node dist/cli.js twitter --query "from:username keyword" -c 500 --mode puppeteer
```

### Advanced Options

**Persona Analysis**
Generates a comprehensive AI prompt based on the user's tweets and reply style.

```bash
node dist/cli.js twitter -u elonmusk --persona
```

**Scrape Likes**

```bash
node dist/cli.js twitter -u elonmusk --likes
```

**Scrape with Replies Tab**

```bash
# Include replies in the user's timeline
node dist/cli.js twitter -u elonmusk --with-replies -c 200
```

**Batch Processing**
Scrape multiple accounts from a file (one username/URL per line). Supports mixing usernames, @handles, and profile URLs.

```bash
# Scrape multiple accounts, merge results into one file
node dist/cli.js twitter -f accounts.txt --merge

# Scrape multiple accounts, save separately
node dist/cli.js twitter -f accounts.txt --separate
```

**Monitor Multiple Users**

```bash
# Monitor users for new tweets and generate daily reports
node dist/cli.js monitor -u elonmusk,trump,billgates
```

### Full CLI Help

```bash
node dist/cli.js --help
node dist/cli.js twitter --help
node dist/cli.js reddit --help
```

### Reddit Commands

**Scrape a Subreddit**

```bash
# Scrape 100 posts from r/UofT
node dist/cli.js reddit -r UofT -c 100

# Deep scrape with specific strategy
node dist/cli.js reddit -r AskReddit -c 500 -s super_full

# Available strategies: auto, super_full, super_recent, new
```

**Scrape a Reddit Post**

```bash
# Scrape a specific Reddit post with all comments (via web interface)
# Or use the Python API directly:
curl -X POST http://127.0.0.1:5002/api/scrape/post \
  -H "Content-Type: application/json" \
  -d '{"post_url": "https://www.reddit.com/r/.../comments/..."}'
```

**Note**: Reddit scraping requires the Python API server to be running. Start it with `pnpm run dev:reddit` or `python3 platforms/reddit/reddit_api_server.py`.

---

## 📂 Output Structure

Results are organized by target and timestamp to prevent overwriting.

```text
output/
├── x/                              # Twitter/X output (platform: 'x')
│   └── {username}/
│       ├── run-{timestamp}/
│       │   ├── index.md           # Main summary and content (Markdown)
│       │   ├── tweets.json        # Full raw data (JSON)
│       │   ├── tweets.csv         # Tabular data (CSV, if enabled)
│       │   ├── metadata.json      # Run statistics and config
│       │   ├── persona-analysis.md # AI persona analysis (if --persona)
│       │   ├── markdown/          # Individual tweet markdown files
│       │   └── screenshots/       # Captured screenshots (if enabled)
│       └── ...
├── twitter/                        # Legacy Twitter output (deprecated, use 'x')
│   └── ...
├── reddit/
│   ├── {subreddit}/
│   │   └── {post_id}.json         # Individual post data
│   └── latest/
│       └── index.md               # Latest scraped content
└── reports/
    └── daily_report_{date}.md     # Monitor service reports
```

---

## 🔧 Technical Architecture

This project implements enterprise-grade features for reliability and stealth.

### ⚡ Deep Search & Date Chunking

To bypass the ~800 tweet limit of the standard timeline API, this tool implements a **reverse-chronological date chunking strategy**:

1. **Intelligent Segmentation**: The timeframe is split into monthly chunks (e.g., 2025-11, 2025-10, 2025-09...).
2. **Search-Based Retrieval**: Instead of scrolling the timeline, it uses Puppeteer to perform advanced search queries (`from:user since:A until:B`).
3. **Smart Pacing**: Limits scrolling per chunk to prevent frontend crashes, then moves to the next month.
4. **Auto-Stop**: Automatically stops once the total target count (e.g., 2000 tweets) is reached.

### 🛡️ Advanced Fingerprinting

To avoid detection, the crawler uses `fingerprint-injector` to inject realistic browser fingerprints into every Puppeteer session.

- **Canvas & WebGL Noise**: Randomizes rendering outputs.
- **Hardware Emulation**: Emulates consistent hardware specs matching the User-Agent.
- **Browser Pool**: Reuses browser instances to reduce overhead and improve performance.

### 🔐 Security Features

- **API Key Protection**: Optional API key authentication for all `/api/*` endpoints.
  - Set via `API_KEY` environment variable or config file.
  - Frontend can store and send API key via `X-API-Key` header or `api_key` query parameter.
- **Path Validation**: All file download paths are validated to prevent directory traversal attacks.
- **Session Validation**: Cookie files are validated before use to prevent invalid sessions.

### 🔄 Robust Session Management

- **Multi-Account Support**: Loads all cookie files from `cookies/` directory.
- **Automatic Rotation**:
  - **Rate Limit Handling**: Switches sessions on 429 errors.
  - **Load Failure Handling**: Switches sessions if Twitter returns "Something went wrong" or empty results repeatedly.
  - **Configurable**: Enable/disable rotation via `enableRotation` option.
- **Chunk Retry Mechanism**: **Critical Feature.** If a session gets rate-limited while scraping "May 2024", the system rotates to the next session and **retries "May 2024" immediately**. This prevents data gaps (black holes) in your archive.
- **Session Manager UI**: Upload, validate, and manage cookie files through the web interface.
- **Session Selection**: Manually select a specific session file via `--session` CLI option.

### 🏗️ Hybrid Architecture (Node.js + Python)

This project uses a hybrid architecture to leverage the best tools for each platform:

1.  **Frontend (React + Vite)**:

    - Provides a modern, responsive UI.
    - Communicates with the backend via REST APIs and Server-Sent Events (SSE) for real-time progress.

2.  **Backend (Node.js + Express)**:

    - Orchestrates the scraping process.
    - Manages the **Request Queue** and **Session Rotation**.
    - Handles Twitter scraping directly via TypeScript/Puppeteer.

3.  **Python Bridge (Reddit Integration)**:
    - Node.js now talks to the Python layer via a lightweight HTTP API (`platforms/reddit/reddit_api_server.py`) instead of parsing stdout from a spawned process.
    - **Why this change?** Structured errors, health checks, and easier observability while keeping Python’s Reddit ecosystem.
    - **Communication**:
      - Node -> Python: Sends JSON payloads to `/api/scrape/subreddit` or `/api/scrape/post`, performing a health check before dispatching the job.
      - Python -> Node: Returns structured JSON (status + artifact paths), which the backend forwards to the UI/SSE stream.

**Directory Structure**:

- `frontend/`: React application with Vite.
  - `src/components/`: UI components (HeaderBar, TaskForm, ResultsPanel, SessionManager, ErrorNotification).
  - `src/types/`: TypeScript type definitions.
  - `src/utils/`: Frontend utility functions.
- `server.ts`: Main Node.js backend (Express).
- `server/task-queue.ts`: Task queue management with priority queuing.
- `core/`: Twitter scraping logic (TypeScript).
  - `scraper-engine.ts`: Main scraping engine orchestrator.
  - `scraper-engine.types.ts`: Type definitions for scraper engine.
  - `timeline-api-runner.ts`: GraphQL API mode implementation.
  - `timeline-dom-runner.ts`: Puppeteer DOM mode implementation.
  - `timeline-date-chunker.ts`: Date chunking strategy for deep search.
  - `monitor-service.ts`: User monitoring service for new tweets.
  - `metrics-collector.ts`: Performance metrics collection.
  - `session-manager.ts`: Multi-account session rotation.
  - `cookie-manager.ts`: Cookie file loading and validation.
  - `browser-manager.ts`: Browser instance management.
  - `browser-pool.ts`: Browser instance pooling for performance.
  - `proxy-manager.ts`: Proxy configuration and rotation.
  - `fingerprint-manager.ts`: Browser fingerprint injection.
  - `rate-limit-manager.ts`: Rate limit detection and handling.
  - `error-snapshotter.ts`: Error screenshot capture.
  - `performance-monitor.ts`: Real-time performance tracking.
  - `progress-manager.ts`: Progress tracking and checkpointing.
  - `x-api.ts`: Twitter/X GraphQL API client.
  - `reddit-api-client.ts`: Reddit Python API HTTP client.
- `platforms/reddit/`: Python scripts for Reddit scraping.
  - `reddit_api_server.py`: HTTP API server for Reddit scraping.
- `cookies/`: Session storage (cookie JSON files).
- `output/`: Scraped data artifacts.
- `logs/`: Application logs (if file logging enabled).
- `middleware/`: Express middleware (API key, etc.).
- `utils/`: Utility functions (export, markdown, config, logger, etc.).
- `types/`: Shared TypeScript type definitions.
- `config/`: Configuration constants and validation.

## 🧼 Recent Improvements

- **Repository hygiene**: `dist/`, `logs/`, `output/`, and other generated artifacts are now git-ignored by default so the repo stays lightweight and conflict-free.
- **HTTP-based Reddit bridge**: `server.ts` talks to `platforms/reddit/reddit_api_server.py` over HTTP with health checks instead of parsing stdout, making failures easier to diagnose.
- **Modular UI & server queue**: The monolithic `frontend/src/App.tsx` has been split into focused components (`HeaderBar`, `TaskForm`, `ResultsPanel`, `SessionManager`, `ErrorNotification`), and request queue orchestration now lives in `server/task-queue.ts`, keeping `server.ts` readable.
- **Performance Monitoring**: Real-time metrics collection with `/api/metrics` and `/api/metrics/summary` endpoints.
- **Error Snapshotting**: Automatic screenshot capture on errors for debugging.
- **API Key Protection**: Optional API key middleware for secure deployments.
- **Session Manager UI**: Web-based cookie file upload and validation.
- **Task Queue System**: Priority-based request queuing to prevent concurrent scraping conflicts.
- **Browser Pool**: Reuses browser instances to reduce overhead and improve performance.
- **Progress Management**: Resume interrupted scrapes from checkpoints.
- **Mixed Mode**: Automatic switching between GraphQL API and Puppeteer for optimal speed and depth.
- **Output Path Manager**: Unified output path management with security validation.
- **Enhanced Error Handling**: Error classification and user-friendly error messages in the UI.

## 🎯 Scraping Modes

### GraphQL API Mode (Default for small tasks)

- **Speed**: ⚡ Fast
- **Limitation**: ⚠️ **~800 tweet limit** (Server-side restriction).
- **Best For**: Quick monitoring, daily updates, small profiles.

### Puppeteer DOM Mode (Deep Search)

- **Speed**: 🐢 Slower (Full browser rendering).
- **Limitation**: ✅ **Virtually Unlimited**.
- **Best For**: Archival, large datasets (>800 tweets), historical analysis.
- **Logic**: Uses the Date-Chunking engine described above.

### Mixed Mode

- **Speed**: ⚡ Fast start, 🐢 Slower continuation
- **Logic**: Starts with GraphQL API for speed. Once the API limit (~800 tweets) is hit, it automatically switches to Puppeteer DOM mode to continue scraping deeper.
- **Best For**: Large profiles where you want speed for recent tweets but need depth for historical data.
- **Auto-Detection**: Automatically enabled when `scrapeMode: 'mixed'` is specified, or when scraping likes (which requires browser access).

---

## ⚠️ Known Limitations & FAQ

### Why does it scrape slowly?

Deep scraping uses a real browser (Puppeteer) and respects rate limits to avoid getting your accounts banned. It scrolls, waits for network idle, and handles "Try again" buttons automatically. This takes time but ensures high success rates.

### Can I use this without login?

No. Twitter/X has removed most public access. You must provide valid cookies in the `cookies/` directory.

### What if a month is missing?

The system logs warnings if a specific time chunk returns 0 tweets after multiple retries. Check the logs for "Gaps detected" warnings. You can manually verify if the user actually tweeted during that period.

### How do I use Docker?

A `Dockerfile` is provided for containerized deployments:

```bash
# Build the image
docker build -t xrcrawler .

# Run the container
docker run -p 5001:5001 \
  -v $(pwd)/cookies:/app/cookies \
  -v $(pwd)/output:/app/output \
  -e API_KEY=your-secret-key \
  xrcrawler
```

**Note**: The Docker image includes Chromium for Puppeteer. For Reddit features, you'll need to run the Python API server separately or in a separate container.

**Docker Compose Example** (if you want to run Reddit API server alongside):

```yaml
version: '3.8'
services:
  crawler:
    build: .
    ports:
      - "5001:5001"
    volumes:
      - ./cookies:/app/cookies
      - ./output:/app/output
    environment:
      - API_KEY=your-secret-key
      - PORT=5001
      - REDDIT_API_URL=http://reddit-api:5002
  
  reddit-api:
    build:
      context: ./platforms/reddit
      dockerfile: Dockerfile  # You may need to create this
    ports:
      - "5002:5002"
    # Add Reddit API dependencies here
```

### How do I configure proxy support?

Proxy support is available through the `ProxyManager` class. Configure proxies via:

- Environment variables (e.g., `PROXY_URL`, `PROXY_LIST`)
- Configuration file (`crawler-config.json`)
- Programmatic API

The proxy manager supports:
- Single proxy configuration
- Proxy rotation from a list
- Automatic proxy health checking
- Fallback mechanisms

See `core/proxy-manager.ts` for implementation details.

### How does the Monitor Service work?

The Monitor Service tracks multiple Twitter users for new tweets:

- Compares against last known tweet ID stored in progress files
- Supports keyword filtering (only tweets containing specified keywords are included)
- Supports lookback hours (only check tweets from the last N hours)
- Generates daily reports in `output/reports/daily_report_{date}.md`
- Can be scheduled via CLI (`node dist/cli.js monitor`) or web interface (`POST /api/monitor`)
- Uses GraphQL API mode by default for fast monitoring

### What are the API endpoints?

**Scraping & Monitoring:**
- `POST /api/scrape` - Start a scraping task (profile, thread, search, or reddit)
- `POST /api/monitor` - Start monitoring multiple users for new tweets
- `POST /api/stop` - Stop current scraping task gracefully

**Progress & Status:**
- `GET /api/progress` - Server-Sent Events (SSE) stream for real-time updates
- `GET /api/status` - Get current scraping status and stop signal state
- `GET /api/result` - Get the download URL for the last completed scrape

**Metrics & Health:**
- `GET /api/metrics` - Get detailed performance metrics
- `GET /api/metrics/summary` - Get summary of performance metrics
- `GET /api/health` - Health check endpoint with system information

**Session Management:**
- `GET /api/sessions` - List available cookie sessions
- `POST /api/cookies` - Upload and validate a cookie file (multipart/form-data)

**Configuration & Downloads:**
- `GET /api/config` - Get public configuration for frontend
- `GET /api/download` - Download scraped results (requires `path` query parameter)

**Note:** All `/api/*` endpoints are protected by API key middleware if `API_KEY` environment variable is set. The frontend can send the API key via `X-API-Key` header or `api_key` query parameter.

---

## 🐳 Docker Deployment

The project includes a `Dockerfile` for containerized deployments:

```bash
# Build
docker build -t xrcrawler .

# Run
docker run -d \
  --name xrcrawler \
  -p 5001:5001 \
  -v $(pwd)/cookies:/app/cookies \
  -v $(pwd)/output:/app/output \
  -e API_KEY=your-secret-key \
  -e PORT=5001 \
  xrcrawler
```

The Docker image includes:
- Node.js runtime
- Chromium for Puppeteer
- All dependencies pre-installed
- Frontend pre-built

## ⚙️ Configuration

### Environment Variables

**Server Configuration:**
- `PORT` - Server port (default: 5001)
- `HOST` - Server host (default: 0.0.0.0)
- `API_KEY` - API key for endpoint protection (optional)

**Reddit Configuration:**
- `REDDIT_API_URL` - Reddit Python API server URL (default: `http://127.0.0.1:5002`)
- `REDDIT_API_PORT` - Reddit API server port (default: 5002)
- `REDDIT_API_TIMEOUT` - Reddit API request timeout in ms (default: 300000)

**Output Configuration:**
- `OUTPUT_DIR` - Output directory (default: ./output)

**Logging Configuration:**
- `LOG_LEVEL` - Logging level: debug, info, warn, error (default: info)
- `ENABLE_FILE_LOGGING` - Enable file logging (default: false)
- `LOG_DIR` - Log directory (default: ./logs)

**Browser Configuration:**
- `PUPPETEER_EXECUTABLE_PATH` - Custom Chromium path (for Docker, default: auto-detect)
- `HEADLESS` - Run browser in headless mode (default: true)

**Twitter Configuration:**
- `TWITTER_DEFAULT_MODE` - Default scraping mode: graphql, puppeteer, or mixed (default: graphql)
- `TWITTER_DEFAULT_LIMIT` - Default tweet limit (default: 50)
- `TWITTER_API_TIMEOUT` - API request timeout in ms (default: 30000)
- `TWITTER_BROWSER_TIMEOUT` - Browser operation timeout in ms (default: 60000)

**Rate Limiting:**
- `RATE_LIMIT_MAX_RETRIES` - Maximum retries on rate limit (default: 3)
- `RATE_LIMIT_BASE_DELAY` - Base delay between retries in ms (default: 2000)
- `RATE_LIMIT_MAX_DELAY` - Maximum delay between retries in ms (default: 30000)
- `ENABLE_ROTATION` - Enable automatic session rotation (default: true)

### Configuration File

Create `crawler-config.json` for scheduled tasks:

```json
{
  "twitter": {
    "usernames": ["user1", "user2"],
    "tweetCount": 50,
    "separateFiles": true
  },
  "schedule": {
    "interval": 60,
    "timezone": "UTC"
  },
  "output": {
    "directory": "./output",
    "format": "md"
  }
}
```

## 📊 Monitoring & Metrics

Access performance metrics via the web interface or API:

```bash
# Get metrics summary
curl http://localhost:5001/api/metrics/summary

# Health check
curl http://localhost:5001/api/health
```

Metrics include:
- Scraping speed (tweets/second)
- Success/failure rates
- Session rotation statistics
- Resource usage (memory, CPU)

## 🔍 Troubleshooting

### Reddit API Server Not Starting

Ensure Python 3 is installed and dependencies are available:

```bash
cd platforms/reddit
pip install -r requirements.txt
python3 reddit_api_server.py
```

### Cookie Files Not Working

- Verify cookies are exported correctly (must be JSON format)
- Check that cookies include authentication tokens (auth_token, ct0)
- Ensure cookies are from a logged-in X.com session
- Use the Session Manager UI to validate cookie files

### Rate Limiting Issues

- Use multiple cookie files for rotation
- Reduce scraping speed (increase delays)
- Use GraphQL mode for smaller batches
- Monitor via `/api/metrics` endpoint

### Browser/Chromium Issues

- Ensure Chromium is installed (Puppeteer will download it automatically)
- For Docker, Chromium is pre-installed
- Set `PUPPETEER_EXECUTABLE_PATH` if using system Chrome

## 🤝 Contributing

Contributions are welcome! Please feel free to submit a Pull Request.

## 📄 License

This project is licensed under the MIT License.

## ⚠️ Disclaimer

This tool is for **educational and research purposes only**.

- Respect Twitter/X's Terms of Service and Robots.txt.
- Use rate limiting to avoid stressing their servers.
- The authors are not responsible for any misuse of this tool.
