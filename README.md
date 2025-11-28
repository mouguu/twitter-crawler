# Social Media Crawler (Twitter/X & Reddit)

A powerful, multi-platform tool to scrape, archive, and analyze content from Twitter/X and Reddit. Designed for researchers, archivists, and AI developers.

![License](https://img.shields.io/badge/license-MIT-blue.svg)
![Node](https://img.shields.io/badge/node-%3E%3D16-green.svg)
![TypeScript](https://img.shields.io/badge/typescript-%5E5.0-blue)

## 🚀 Features

- **Dual Scraping Modes**:
  - **GraphQL API Mode** (Default): Fast, lightweight scraping using Twitter's internal GraphQL API. No browser needed, perfect for quick data collection (< 800 tweets).
  - **Puppeteer DOM Mode**: Full browser automation for deeper timeline access and complex scenarios.
- **🔥 Deep Search (Date Chunking)**: Bypasses the ~800 tweet hard limit by automatically splitting the timeframe into monthly chunks. Scrapes from newest to oldest with **no depth limit**.
- **Seamless Auto-Switching**: Automatically detects when a target requires deep scraping (>800 tweets) and switches strategies transparently.
- **Multi-Mode Scraping**:
  - **User Profiles**: Scrape tweets, replies, and pinned tweets.
  - **Threads**: Archive complete conversation threads, including nested replies.
  - **Search**: Advanced search scraping (keywords, hashtags, date ranges).
  - **Search**: Advanced search scraping (keywords, hashtags, date ranges).
  - **Likes**: Extract tweets liked by a specific user.
- **Reddit Integration**:
  - **Subreddit Scraping**: Scrape posts from any subreddit.
  - **Multi-Strategy**: Auto, Super Full, Super Recent, and New modes.
  - **Local Storage**: Saves data to JSON and CSV without external databases.
- **AI-Powered Analysis**:
  - **Persona Mode**: Automatically generates AI prompts and analysis based on scraped user data.
  - **Smart Exports**: Outputs clean Markdown and JSON optimized for LLM context windows.
- **Resilient Architecture**:
  - **Smart Session Rotation**: Automatically rotates accounts on rate limits.
  - **Data Gap Prevention**: If a session fails during a time chunk, the next session **retries the same chunk** to ensure no data is lost.
  - **"Try Again" Handling**: Automatically detects and recovers from Twitter's frontend error screens.
- **Flexible Output**:
  - Structured JSON/CSV for data analysis.
  - Markdown for reading and LLM ingestion.
  - Automatic media detection.

---

## 📦 Installation

### Prerequisites

- **Node.js** 16 or higher
- **pnpm** (recommended) or **npm**

### Setup

1. **Clone the repository**

   ```bash
   git clone https://github.com/yourusername/twitter-crawler.git
   cd twitter-crawler
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
   - Enter a Twitter username, Tweet URL, or Search query.
   - Select options (Crawl Likes, Max Tweets, etc.).
   - Click **Start Scraping**.
   - Download the resulting Markdown/JSON artifacts directly from the browser.

---

## CLI Usage

For automation and batch processing, use the Command Line Interface.

### Basic Commands

**Scrape a Profile (Quick Mode)**

```bash
# Scrape 50 tweets (uses GraphQL API by default)
node cli.js twitter -u elonmusk -c 50
```

**Deep Archive (The "Limit Breaker")**

```bash
# Scrape 2000 tweets.
# System automatically detects count > 800 and switches to Date-Chunked Deep Search.
node cli.js twitter -u elonmusk -c 2000 --mode puppeteer
```

**Resume Interrupted Scrape**

```bash
# Continues from where you left off (based on the oldest tweet ID found previously)
node cli.js twitter -u elonmusk -c 2000 --mode puppeteer --resume
```

**Scrape a Thread**

```bash
# Archive a specific thread with up to 100 replies
node cli.js twitter --thread https://x.com/username/status/123456789 --max-replies 100
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

### Full CLI Help

```bash
node cli.js --help
```

### Reddit Commands

**Scrape a Subreddit**

```bash
# Scrape 100 posts from r/UofT
node cli.js reddit -r UofT -c 100

# Deep scrape with specific strategy
node cli.js reddit -r AskReddit -c 500 -s super_popular
```

---

## 📂 Output Structure

Results are organized by target and timestamp to prevent overwriting.

```text
output/
└── twitter/
    └── {username}/
        ├── run-{timestamp}/
        │   ├── index.md           # Main summary and content (Markdown)
        │   ├── tweets.json        # Full raw data (JSON)
        │   ├── tweets.csv         # Tabular data (CSV)
        │   ├── metadata.json      # Run statistics and config
        │   ├── markdown/          # Individual tweet markdown files
        │   └── screenshots/       # Captured screenshots (if enabled)
        └── ...
```

---

## 🔧 Technical Architecture

This project implements enterprise-grade features for reliability and stealth.

### ⚡ Deep Search & Date Chunking

To bypass the ~800 tweet limit of the standard timeline API, this tool implements a **reverse-chronological date chunking strategy**:

1.  **Intelligent Segmentation**: The timeframe is split into monthly chunks (e.g., 2025-11, 2025-10, 2025-09...).
2.  **Search-Based Retrieval**: Instead of scrolling the timeline, it uses Puppeteer to perform advanced search queries (`from:user since:A until:B`).
3.  **Smart Pacing**: Limits scrolling per chunk to prevent frontend crashes, then moves to the next month.
4.  **Auto-Stop**: Automatically stops once the total target count (e.g., 2000 tweets) is reached.

### 🛡️ Advanced Fingerprinting

To avoid detection, the crawler uses `fingerprint-injector` to inject realistic browser fingerprints into every Puppeteer session.

- **Canvas & WebGL Noise**: Randomizes rendering outputs.
- **Hardware Emulation**: Emulates consistent hardware specs matching the User-Agent.

### 🔄 Robust Session Management

- **Multi-Account Support**: Loads all cookie files from `cookies/` directory.
- **Automatic Rotation**:
  - **Rate Limit Handling**: Switches sessions on 429 errors.
  - **Load Failure Handling**: Switches sessions if Twitter returns "Something went wrong" or empty results repeatedly.
- **Chunk Retry Mechanism**: **Critical Feature.** If a session gets rate-limited while scraping "May 2024", the system rotates to the next session and **retries "May 2024" immediately**. This prevents data gaps (black holes) in your archive.

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
    - For Reddit, the Node.js server spawns a Python subprocess (`reddit_cli.py`).
    - **Why Python?** Python has superior libraries for Reddit (like PRAW) and data processing.
    - **Communication**:
      - Node -> Python: Spawns process with CLI arguments (e.g., `--post_url ...`).
      - Python -> Node: Prints JSON results to `stdout` (delimited by `__JSON_RESULT__`).
      - Node parses this JSON and sends it back to the frontend.

**Directory Structure**:

- `frontend/`: React application.
- `server.ts`: Main Node.js backend.
- `core/`: Twitter scraping logic (TypeScript).
- `platforms/reddit/`: Python scripts for Reddit scraping.
- `cookies/`: Session storage.
- `output/`: Scraped data artifacts.

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

- **Logic**: Starts with API for speed. Once the API limit is hit, it automatically hands over the cursor (or date range) to Puppeteer to continue digging deeper.

---

## ⚠️ Known Limitations & FAQ

### Why does it scrape slowly?

Deep scraping uses a real browser (Puppeteer) and respects rate limits to avoid getting your accounts banned. It scrolls, waits for network idle, and handles "Try again" buttons automatically. This takes time but ensures high success rates.

### Can I use this without login?

No. Twitter/X has removed most public access. You must provide valid cookies in the `cookies/` directory.

### What if a month is missing?

The system logs warnings if a specific time chunk returns 0 tweets after multiple retries. Check the logs for "Gaps detected" warnings. You can manually verify if the user actually tweeted during that period.

---

## 🤝 Contributing

Contributions are welcome! Please feel free to submit a Pull Request.

## 📄 License

This project is licensed under the MIT License.

## ⚠️ Disclaimer

This tool is for **educational and research purposes only**.

- Respect Twitter/X's Terms of Service and Robots.txt.
- Use rate limiting to avoid stressing their servers.
- The authors are not responsible for any misuse of this tool.
