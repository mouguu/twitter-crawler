# Twitter/X Crawler & Analyzer

A powerful, full-featured tool to scrape, archive, and analyze Twitter/X content. Designed for researchers, archivists, and AI developers, it supports scraping Profiles, Threads, Home Timelines, and Search results with flexible output formats.

![License](https://img.shields.io/badge/license-MIT-blue.svg)
![Node](https://img.shields.io/badge/node-%3E%3D16-green.svg)
![TypeScript](https://img.shields.io/badge/typescript-%5E5.0-blue)

## 🚀 Features

- **Dual Scraping Modes**:
  - **GraphQL API Mode** (Default): Fast, lightweight scraping using Twitter's internal GraphQL API. No browser needed, perfect for quick data collection.
  - **Puppeteer DOM Mode**: Full browser automation for deeper timeline access and complex scenarios. Bypasses API limitations.
- **Multi-Mode Scraping**:
  - **User Profiles**: Scrape tweets, replies, and pinned tweets from any public profile.
  - **Threads**: Archive complete conversation threads, including nested replies.
  - **Home Timeline**: Scrape your personal "For You" or "Following" feed (requires login).
  - **Likes**: Extract tweets liked by a specific user.
- **AI-Powered Analysis**:
  - **Persona Mode**: Automatically generates AI prompts and analysis based on scraped user data.
  - **Smart Exports**: Outputs clean Markdown and JSON optimized for LLM context windows.
- **Modern Web Interface**: A beautiful, responsive React UI to manage scraping tasks visually.
- **Intelligent Session Management**: Automatic multi-account rotation with health monitoring and smart fallback.
- **Robust & Stealthy**: Built with Puppeteer and Stealth plugins to handle dynamic content and rate limits.
- **Flexible Output**:
  - Structured JSON/CSV for data analysis.
  - Markdown for reading and LLM ingestion.
  - Automatic media detection.

---

## 📦 Installation

### Prerequisites
- **Node.js** 16 or higher
- **npm** or **yarn**

### Setup

1. **Clone the repository**
   ```bash
   git clone https://github.com/yourusername/twitter-crawler.git
   cd twitter-crawler
   ```

2. **Install dependencies**
   ```bash
   npm install
   ```

3. **Configure Cookies (Required)**
   To access age-restricted content, search, or avoid rate limits, you must provide Twitter cookies.

   - **Export Cookies**: Use a browser extension like "EditThisCookie" or "Cookie-Editor" to export your Twitter cookies as JSON while logged in to X.com.
   - **Place in Directory**: Save the exported JSON file into the `cookies/` directory in the project root.
     - Example: `cookies/my-account.json`
   - **Multiple Accounts (Rotation)**: You can place multiple JSON files in the `cookies/` directory (e.g., `account1.json`, `account2.json`). The crawler will automatically rotate through them to distribute the load and reduce the risk of rate limiting.

---

## 🖥️ Web Interface

The easiest way to use the crawler is through the built-in web interface.

1. **Start the server**
   ```bash
   npm run dev
   ```
   *Or directly via:* `npx ts-node server.ts`

2. **Open your browser**
   Navigate to `http://localhost:5001`.

3. **Use the UI**
   - Enter a Twitter username, Tweet URL, or Search query.
   - Select options (Crawl Likes, Max Tweets, etc.).
   - Click **Start Scraping**.
   - Download the resulting Markdown/JSON artifacts directly from the browser.

---

## 💻 CLI Usage

For automation and batch processing, use the Command Line Interface.

### Basic Commands

**Scrape a Profile**
```bash
# Scrape 50 tweets from @elonmusk (uses GraphQL API mode by default)
node cli.js twitter -u elonmusk -c 50

# Use Puppeteer DOM mode for deeper access (bypasses ~800 tweet API limit)
node cli.js twitter -u elonmusk -c 2000 --mode puppeteer

# Save to a specific folder
node cli.js twitter -u elonmusk -o ./my-data
```

**Scrape a Thread**
```bash
# Archive a specific thread with up to 100 replies
node cli.js twitter --thread https://x.com/username/status/123456789 --max-replies 100
```

**Scrape Home Timeline**
```bash
# Scrape your own "For You" feed (requires valid cookies)
node cli.js twitter --home -c 50
```

### Advanced Options

**Persona Analysis**
Generates a comprehensive AI prompt based on the user's tweets and reply style.
```bash
node cli.js twitter -u elonmusk --persona
```

**Scrape Likes**
```bash
node cli.js twitter -u elonmusk --likes
```

**Batch Processing**
Scrape multiple accounts from a file (one username/URL per line).
```bash
node cli.js twitter -f accounts.txt --merge
```

**Export Formats**
```bash
# Export as JSON and CSV in addition to Markdown
node cli.js twitter -u elonmusk --json --csv
```

### Full CLI Help
```bash
node cli.js --help
```

---

## 📂 Output Structure

Results are organized by target and timestamp to prevent overwriting.

```text
output/
└── twitter/
    └── {username}/
        └── run-{timestamp}/
            ├── index.md           # Main summary and content (Markdown)
            ├── tweets.json        # Full raw data (JSON)
            ├── tweets.csv         # Tabular data (CSV)
            ├── metadata.json      # Run statistics and config
            ├── markdown/          # Individual tweet markdown files
            └── screenshots/       # Captured screenshots (if enabled)
```

---

## ⚙️ Configuration

### `crawler-config.json`
Used for scheduled tasks or default settings.

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
  }
}
```

### Scheduled Runs
Run the crawler periodically based on your config:
```bash
node cli.js schedule -c crawler-config.json
```

---

## 🔧 Technical Architecture

This project goes beyond simple scraping scripts by implementing enterprise-grade features for reliability and stealth.

### 🛡️ Advanced Fingerprinting
To avoid detection, the crawler uses `fingerprint-injector` to inject realistic browser fingerprints into every Puppeteer session.
- **Canvas & WebGL Noise**: Randomizes rendering outputs to defeat canvas fingerprinting.
- **AudioContext**: Modifies audio stack processing.
- **Hardware Concurrency & Device Memory**: Emulates consistent hardware specs matching the User-Agent.

### ⚡ Intelligent Rate Limiting & Session Rotation
The system implements advanced rate limit handling with automatic session rotation:
- **Smart Detection**: Detects Rate Limit (429) errors and authentication failures automatically.
- **Automatic Session Rotation**: When a rate limit is hit, automatically switches to the next available account.
- **Multi-Account Support**: Loads all cookie files from `cookies/` directory and rotates through them seamlessly.
- **Intelligent Retry**: Distinguishes between rate limits and API boundaries (e.g., ~800 tweet limit).
- **Adaptive Delays**: Adjusts request frequency based on success rates and error patterns.

### 🔄 Session Management & Rotation
- **Multi-Account Support**: The `SessionManager` automatically loads all cookie files from the `cookies/` directory (e.g., `account1.json`, `account2.json`, etc.).
- **Health Checks**: Monitors session validity and tracks error counts for each account.
- **Automatic Rotation**: 
  - **Rate Limit Handling**: Automatically switches to the next available session when rate limits are detected.
  - **Empty Response Handling**: Intelligently switches sessions when encountering empty API responses to distinguish between account-specific limits and API boundaries.
  - **Priority-Based Selection**: Chooses sessions based on health (error count) and usage statistics.
- **Comprehensive Tracking**: Records which sessions have been tried at each cursor position to avoid redundant attempts.

### 📸 Error Snapshotting
Debugging headless browsers can be difficult. The `ErrorSnapshotter` automatically captures context when an error occurs:
- **Screenshots**: Saves a PNG of the browser state at the moment of failure.
- **HTML Dumps**: Saves the full page source to analyze DOM structure.
- **Logs**: Correlates browser console logs with the error.

---

## 🎯 Scraping Modes: GraphQL vs Puppeteer

The crawler supports two scraping modes, each optimized for different use cases:

### GraphQL API Mode (Default)
- **Speed**: ⚡ Fast - No browser overhead, direct API calls
- **Resource Usage**: 💾 Lightweight - Minimal memory and CPU
- **Limitation**: ⚠️ **~800 tweet limit per request chain** (Twitter/X API restriction)
- **Use Case**: Quick data collection, monitoring, small to medium profiles
- **When to Use**: 
  - Scraping less than 800 tweets
  - Need fast, efficient scraping
  - Running in resource-constrained environments

```bash
# GraphQL mode (default)
node cli.js twitter -u elonmusk -c 500 --mode graphql
```

### Puppeteer DOM Mode
- **Speed**: 🐢 Slower - Full browser rendering required
- **Resource Usage**: 💻 Higher - Requires browser instance
- **Limitation**: ✅ No hard limit - Can access deeper timeline history
- **Use Case**: Deep archival, large profiles (>800 tweets), complex scenarios
- **When to Use**:
  - Need more than ~800 tweets
  - Require access to very old tweets
  - Encountering API limitations

```bash
# Puppeteer mode for deeper access
node cli.js twitter -u elonmusk -c 2000 --mode puppeteer
```

### Mode Selection in Web UI
The web interface allows you to switch between modes via the API selection tabs:
- **GraphQL API**: Fast, API-only mode
- **Puppeteer DOM**: Full browser automation mode

---

## ⚠️ Known Limitations & FAQ

### GraphQL API Limit
**Q: Why does scraping stop at ~800 tweets in GraphQL mode?**

**A:** Twitter/X's GraphQL API has an internal limit of approximately 800-900 tweets per pagination chain. This is a server-side restriction, not a bug in the crawler. 

**Solutions:**
1. Use Puppeteer mode: `--mode puppeteer` for deeper timeline access
2. Split into batches: Use `stopAtTweetId` to scrape in multiple sessions
3. Wait and retry: The limit may reset after some time

### Session Rotation
**Q: How does automatic session rotation work?**

**A:** When a rate limit or empty response is detected:
1. The system automatically switches to the next available account
2. All accounts in the `cookies/` directory are tried in sequence
3. The system tracks which accounts have been tested at each cursor position
4. If all accounts return empty responses at the same position, it indicates an API boundary

**Tips:**
- Place multiple cookie files (`account1.json`, `account2.json`, etc.) in the `cookies/` directory
- The more accounts you have, the better the rate limit resilience
- Accounts are selected based on health (fewer errors) and usage statistics

### Rate Limits
**Q: What should I do if all accounts hit rate limits?**

**A:** 
1. Wait 15-30 minutes for limits to reset
2. Reduce request frequency (currently using minimal delays for speed)
3. Use more accounts to distribute the load
4. Consider using Puppeteer mode which may have different rate limit thresholds

---

## 🔌 API Reference

The server exposes a RESTful API for integrating with other tools.

### `POST /api/scrape`
Trigger a scraping task.
```json
{
  "type": "profile",      // "profile", "thread", "search"
  "input": "elonmusk",    // Username, URL, or Query
  "limit": 50,            // Max tweets
  "likes": false,         // Scrape likes tab?
  "mergeResults": false,
  "scrapeMode": "graphql" // "graphql" or "puppeteer"
}
```

### `POST /api/stop`
Gracefully stop the current scraping task.

### `GET /api/progress`
Server-Sent Events (SSE) stream for real-time progress updates.
- Events: `scrape:progress`, `log:message`, `scrape:complete`

### `GET /api/download?path={path}`
Download generated artifacts (Markdown, JSON, CSV).

---

## 🛠️ Development

- **Run Tests**: `npm test`
- **Build Frontend**: `cd frontend && npm run build`
- **Linting**: `npm run lint` (if configured)

## 🤝 Contributing

Contributions are welcome! Please feel free to submit a Pull Request.

## 📄 License

This project is licensed under the MIT License.

## ⚠️ Disclaimer

This tool is for **educational and research purposes only**.
- Respect Twitter/X's Terms of Service and Robots.txt.
- Use rate limiting to avoid stressing their servers.
- The authors are not responsible for any misuse of this tool.
