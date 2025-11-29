# Installation Guide

Complete installation instructions for XRCrawler.

## Prerequisites

- **Node.js** 18 or higher (Node 18 is used in Docker)
- **pnpm** (recommended) or **npm**
- **Python 3** (for Reddit scraping, if using Reddit features)
- **Chromium/Chrome** (automatically installed with Puppeteer, or use system Chrome)

## Step-by-Step Installation

### 1. Clone the Repository

```bash
git clone https://github.com/yourusername/XRCrawler.git
cd XRCrawler
```

### 2. Install Dependencies

```bash
# Install main dependencies
pnpm install

# Install frontend dependencies
cd frontend && pnpm install && cd ..
```

### 3. Configure Cookies (Required)

To access age-restricted content, search, or avoid rate limits, you must provide Twitter cookies.

#### Export Cookies

1. Install a browser extension:
   - [EditThisCookie](https://chrome.google.com/webstore/detail/editthiscookie/fngmhnnpilhplaeedifhccceomclgfbg) (Chrome)
   - [Cookie-Editor](https://chrome.google.com/webstore/detail/cookie-editor/hlkenndednhfkekhgcdicdfddnkalmdm) (Chrome/Firefox)

2. While logged in to X.com, open the extension and export cookies as JSON

3. Save the exported JSON file to the `cookies/` directory:
   ```
   cookies/my-account.json
   ```

#### Multiple Accounts (Rotation)

For better rate limit handling, you can place multiple cookie files in the `cookies/` directory:

```
cookies/
├── account1.json
├── account2.json
├── account3.json
└── account4.json
```

The crawler will automatically rotate through them when rate limits are detected.

### 4. Configure Environment Variables (Optional)

Create a `.env` file in the project root:

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

### 5. Start Reddit API Server (If using Reddit features)

```bash
# The dev scripts will start it automatically, or run manually:
pnpm run dev:reddit

# Or directly:
python3 platforms/reddit/reddit_api_server.py
```

## Verify Installation

### Test the Web Interface

```bash
# Start the server
pnpm run dev:fast

# Open http://localhost:5173 in your browser
```

### Test CLI

```bash
# Build the project
pnpm run build

# Test with a simple scrape
node dist/cli.js twitter -u elonmusk -c 10
```

## Next Steps

- Read the [CLI Usage Guide](./CLI_USAGE.md) for command-line options
- Check the [Web Interface Guide](./WEB_INTERFACE.md) for UI usage
- Review [Configuration](./CONFIGURATION.md) for advanced settings

