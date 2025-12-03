# XRCrawler

<div align="center">

**AI-powered social media crawler that bypasses Twitter's 800-tweet limit. Built by a non-coder using 100% AI-generated code.**

[![GitHub stars](https://img.shields.io/github/stars/mouguu/XRCrawler?style=social)](https://github.com/mouguu/XRCrawler/stargazers)
[![GitHub forks](https://img.shields.io/github/forks/mouguu/XRCrawler?style=social)](https://github.com/mouguu/XRCrawler/network/members)
[![GitHub issues](https://img.shields.io/github/issues/mouguu/XRCrawler)](https://github.com/mouguu/XRCrawler/issues)
[![GitHub license](https://img.shields.io/github/license/mouguu/XRCrawler)](https://github.com/mouguu/XRCrawler/blob/main/LICENSE)
[![Node version](https://img.shields.io/badge/node-%3E%3D18-green.svg)](https://nodejs.org/)
[![TypeScript](https://img.shields.io/badge/typescript-%5E5.0-blue)](https://www.typescriptlang.org/)
[![PRs Welcome](https://img.shields.io/badge/PRs-welcome-brightgreen.svg)](http://makeapullrequest.com)
[![Tests](https://img.shields.io/badge/tests-356%20passed-brightgreen)](https://github.com/mouguu/XRCrawler/actions)

**Features deep search, multi-account rotation, and zero data gaps.**

[Quick Start](#-quick-start) • [Features](#-features) • [Documentation](#-documentation) • [Contributing](./CONTRIBUTING.md)

</div>

---

A powerful, multi-platform tool to scrape, archive, and analyze content from Twitter/X and Reddit. Designed for researchers, archivists, and AI developers.

## 🎯 What Makes It Special

**Break the 800-Tweet Limit**: Unlike other tools that hit Twitter's hard limit, XRCrawler uses intelligent date chunking to scrape **unlimited historical tweets** with zero data gaps.

**Smart Session Rotation**: Automatically rotates between multiple accounts when rate limits are hit, ensuring continuous scraping without manual intervention.

**Zero Data Gaps**: If a session fails during a time chunk, the next session **retries the same chunk** to ensure no data is lost.

**Dual Scraping Modes**:

- **GraphQL API Mode**: Fast, lightweight scraping (< 800 tweets)
- **Puppeteer DOM Mode**: Deep archival scraping (unlimited depth)
- **Mixed Mode**: Automatically switches from API to Puppeteer when limits are reached

**Multi-Platform Support**: Scrape Twitter/X profiles, threads, search, likes, home timeline, and Reddit subreddits/posts.

## ⚡ Quick Start

### Prerequisites

- **Node.js** 18 or higher
- **pnpm** (recommended) or **npm**
- **Python 3** (for Reddit features, optional)

### Installation

```bash
# Clone the repository
git clone https://github.com/yourusername/XRCrawler.git
cd XRCrawler

# Install dependencies
pnpm install
cd frontend && pnpm install && cd ..
```

### Configure Cookies

1. Export your Twitter cookies using a browser extension (EditThisCookie or Cookie-Editor) while logged in to X.com
2. Save the JSON file to `cookies/` directory (e.g., `cookies/my-account.json`)
3. For multi-account rotation, add multiple cookie files to `cookies/`

### Optional: Configure Proxy (Optional)

Proxy is an **optional feature** and is disabled by default. Most users don't need it.

**To enable proxy:**

1. Create a `proxy/` directory in the project root
2. Add proxy files (`.txt` format) with format: `IP:PORT:USERNAME:PASSWORD` (one per line)
3. Enable the "Enable Proxy" option in the web interface when creating a task

**Example proxy file:**

```
123.45.67.89:8080:user1:pass1
123.45.67.90:8080:user2:pass2
```

### Start the Web Interface

```bash
# Fast start (recommended for development)
pnpm run dev:fast

# Or production mode
pnpm run dev
```

Open `http://localhost:5173` (dev:fast) or `http://localhost:5001` (dev) in your browser.

### Quick CLI Example

```bash
# Build the project
pnpm run build

# Scrape 50 tweets (fast GraphQL API mode)
node dist/cli.js twitter -u elonmusk -c 50

# Deep archive 2000 tweets (auto-switches to Puppeteer)
node dist/cli.js twitter -u elonmusk -c 2000 --mode puppeteer
```

**📖 For detailed installation and configuration, see [Installation Guide](./docs/INSTALLATION.md)**

## 🦀 Rust + WASM Data Cleaner

- Added a Rust micro-kernel (`wasm/tweet-cleaner`) compiled to WebAssembly that normalizes and deduplicates tweet batches before they hit the pipeline.
- Timeline DOM/API runners automatically load the WASM module when `wasm/tweet-cleaner/pkg` is present; otherwise they fall back to the TypeScript path.
- Build once with `pnpm run build:wasm` (requires Rust + `wasm-pack`). The compiled files live in `wasm/tweet-cleaner/pkg` and can be shipped with your deployment.
- The cleaner enforces stricter normalization for large payloads (JSON/HTML heavy runs) so CPU-heavy parsing happens outside V8.
- Experimental Reddit parser core lives at `wasm/reddit-cleaner` with a Node helper (`utils/reddit-cleaner.ts`) for normalizing Reddit listings in a CPU-friendly way; you can build it alongside tweet-cleaner.

## 🚀 Key Features

### 🔥 Deep Search (Date Chunking)

Bypasses the ~800 tweet hard limit by automatically splitting timeframes into monthly chunks. Scrapes from newest to oldest with **no depth limit**.

**🚀 Accelerated with Browser Pool**: When enabled, automatically uses browser pool to process multiple date chunks in parallel (2-3x faster).

### 🔄 Multi-Account Rotation

Automatically rotates between multiple cookie files when rate limits are detected, ensuring continuous scraping without interruption.

### 📊 Multiple Scraping Modes

- **User Profiles**: Tweets, replies, pinned tweets
- **Threads**: Complete conversation threads with nested replies
- **Search**: Advanced search with keywords, hashtags, date ranges
- **Likes**: Extract tweets liked by a user
- **Home Timeline**: Scrape "For You" or "Following" feed
- **Reddit**: Subreddits and individual posts with comments

### 🛡️ Resilient Architecture

- **Progress Management**: Resume interrupted scrapes from checkpoints
- **Error Recovery**: Automatic retry on failures with error snapshotting
- **Performance Monitoring**: Real-time metrics and resource usage tracking
- **Browser Pool**: Reuses browser instances for better performance

### 🎨 Modern Web Interface

- **Session Manager**: Upload and validate cookie files via UI
- **Real-time Progress**: Live updates with progress bars and log streaming
- **Performance Dashboard**: View scraping speed and success rates
- **API Key Protection**: Optional authentication for secure deployments

### 🤖 AI-Powered Analysis

- **Persona Mode**: Generates AI prompts based on scraped user data
- **Smart Exports**: Clean Markdown and JSON optimized for LLM context windows

**📖 For complete feature list, see [Full Documentation](./docs/ARCHITECTURE.md)**

## 📖 Documentation

- **[Installation Guide](./docs/INSTALLATION.md)** - Detailed setup instructions
- **[CLI Usage](./docs/CLI_USAGE.md)** - Complete command-line reference
- **[Web Interface](./docs/WEB_INTERFACE.md)** - Web UI usage guide
- **[Architecture](./docs/ARCHITECTURE.md)** - Technical architecture and design
- **[API Reference](./docs/API_REFERENCE.md)** - REST API documentation
- **[Configuration](./docs/CONFIGURATION.md)** - Environment variables and config files
- **[Docker Deployment](./docs/DOCKER.md)** - Containerized deployment guide
- **[Troubleshooting](./docs/TROUBLESHOOTING.md)** - Common issues and solutions
- **[FAQ](./docs/FAQ.md)** - Frequently asked questions

## 📂 Output Structure

Results are organized by target and timestamp:

```
output/
├── x/{username}/run-{timestamp}/
│   ├── index.md           # Main summary (Markdown)
│   ├── tweets.json        # Full raw data (JSON)
│   ├── metadata.json      # Run statistics
│   └── persona-analysis.md # AI analysis (if enabled)
└── reddit/{subreddit}/
    └── {post_id}.json
```

## 🤝 Contributing

Contributions are welcome! Please read our [Contributing Guide](./CONTRIBUTING.md) and feel free to submit a Pull Request.

## 📄 License

This project is licensed under the MIT License.

## ⚠️ Disclaimer

This tool is for **educational and research purposes only**.

- Respect Twitter/X's Terms of Service and Robots.txt
- Use rate limiting to avoid stressing their servers
- The authors are not responsible for any misuse of this tool

---

<div align="center">

**Made with ❤️ by a non-coder using 100% AI-generated code**

[Report Bug](https://github.com/mouguu/XRCrawler/issues) • [Request Feature](https://github.com/mouguu/XRCrawler/issues) • [Documentation](./docs/)

</div>
