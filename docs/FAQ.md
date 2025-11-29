# Frequently Asked Questions

Common questions about XRCrawler.

## General Questions

### What is XRCrawler?

XRCrawler is an AI-powered social media crawler that bypasses Twitter's 800-tweet limit. It can scrape unlimited historical tweets using intelligent date chunking and multi-account rotation.

### Who built this?

This project was built by a non-coder using 100% AI-generated code.

### Is this legal?

This tool is for **educational and research purposes only**. You must:
- Respect Twitter/X's Terms of Service
- Respect Robots.txt
- Use rate limiting to avoid stressing servers
- The authors are not responsible for any misuse

## Technical Questions

### Why does it scrape slowly?

Deep scraping uses a real browser (Puppeteer) and respects rate limits to avoid getting your accounts banned. It scrolls, waits for network idle, and handles "Try again" buttons automatically. This takes time but ensures high success rates.

### Can I use this without login?

No. Twitter/X has removed most public access. You must provide valid cookies in the `cookies/` directory.

### What if a month is missing?

The system logs warnings if a specific time chunk returns 0 tweets after multiple retries. Check the logs for "Gaps detected" warnings. You can manually verify if the user actually tweeted during that period.

### How does the 800-tweet limit bypass work?

XRCrawler uses **date chunking**:
1. Splits the timeframe into monthly chunks
2. Uses search queries (`from:user since:A until:B`) instead of scrolling
3. Scrapes each chunk independently
4. Combines results with no depth limit

### What's the difference between GraphQL and Puppeteer mode?

- **GraphQL API Mode**: Fast, lightweight, but limited to ~800 tweets
- **Puppeteer DOM Mode**: Slower, but unlimited depth
- **Mixed Mode**: Starts with GraphQL for speed, switches to Puppeteer when limit is reached

## Usage Questions

### How do I export cookies?

1. Install a browser extension (EditThisCookie or Cookie-Editor)
2. While logged in to X.com, export cookies as JSON
3. Save to `cookies/` directory

### Can I scrape multiple accounts?

Yes! Place multiple cookie files in `cookies/` directory. The system will automatically rotate through them when rate limits are detected.

### How do I resume an interrupted scrape?

Use the `--resume` flag:

```bash
node dist/cli.js twitter -u username -c 2000 --mode puppeteer --resume
```

Or resume from a specific tweet ID:

```bash
node dist/cli.js twitter -u username -c 2000 --mode puppeteer --resume-from 1234567890123456789
```

### Can I scrape Reddit?

Yes! XRCrawler supports Reddit subreddit and post scraping. You need to start the Reddit API server:

```bash
pnpm run dev:reddit
```

### How do I use the web interface?

1. Start the server: `pnpm run dev:fast`
2. Open `http://localhost:5173` in your browser
3. Upload cookie files in Session Manager
4. Create scraping tasks in Task Form
5. Monitor progress in real-time

## Configuration Questions

### How do I configure proxy support?

Proxy support is available through the `ProxyManager` class. Configure via:
- Environment variables (`PROXY_URL`, `PROXY_LIST`)
- Configuration file (`crawler-config.json`)
- Programmatic API

See [Configuration Guide](./CONFIGURATION.md) for details.

### How do I set up API key protection?

Set `API_KEY` environment variable:

```bash
export API_KEY=your-secret-key
```

Then include it in API requests:
- Header: `X-API-Key: your-secret-key`
- Query: `?api_key=your-secret-key`

### How do I change the output directory?

Set `OUTPUT_DIR` environment variable:

```bash
export OUTPUT_DIR=/path/to/output
```

Or configure in `crawler-config.json`:

```json
{
  "output": {
    "directory": "/path/to/output"
  }
}
```

## Docker Questions

### How do I use Docker?

See [Docker Deployment Guide](./DOCKER.md) for complete instructions.

Quick start:

```bash
docker build -t xrcrawler .
docker run -d \
  --name xrcrawler \
  -p 5001:5001 \
  -v $(pwd)/cookies:/app/cookies \
  -v $(pwd)/output:/app/output \
  -e API_KEY=your-secret-key \
  xrcrawler
```

### Does Docker include Chromium?

Yes, the Docker image includes Chromium for Puppeteer.

### How do I run Reddit features in Docker?

You have two options:
1. Run Reddit API server in a separate container (see Docker Compose example)
2. Run Reddit API server on host and connect via `host.docker.internal`

## Monitoring Questions

### How does the Monitor Service work?

The Monitor Service tracks multiple Twitter users for new tweets:
- Compares against last known tweet ID
- Supports keyword filtering
- Supports lookback hours
- Generates daily reports

### How do I monitor users?

Via CLI:

```bash
node dist/cli.js monitor -u user1,user2 --keywords "AI,space"
```

Via API:

```bash
curl -X POST http://localhost:5001/api/monitor \
  -H "Content-Type: application/json" \
  -d '{"usernames": ["user1", "user2"], "keywords": ["AI"]}'
```

## Output Questions

### Where are results saved?

Results are saved to `output/` directory (or `OUTPUT_DIR` if configured):

```
output/
├── x/{username}/run-{timestamp}/
│   ├── index.md
│   ├── tweets.json
│   └── metadata.json
└── reddit/{subreddit}/
    └── {post_id}.json
```

### What formats are supported?

- **Markdown** (`.md`): Human-readable format
- **JSON** (`.json`): Structured data for analysis
- **CSV** (`.csv`): Tabular data (if enabled)

### Can I customize output format?

Yes, configure in options or `crawler-config.json`. See [Configuration Guide](./CONFIGURATION.md).

## Error Questions

### What do I do if I get rate limited?

1. Use multiple cookie files for rotation
2. Wait 15-30 minutes before retrying
3. Use `--resume` to continue from checkpoint
4. Reduce scraping speed

### What if cookies stop working?

Cookies expire after some time. Re-export fresh cookies from your browser.

### How do I debug errors?

1. Check logs in `logs/` directory
2. Enable error snapshotting for visual debugging
3. Review error messages in web interface
4. Check browser console for frontend errors

## Contributing Questions

### How can I contribute?

Contributions are welcome! Please read [Contributing Guide](../CONTRIBUTING.md) and submit a Pull Request.

### How do I report bugs?

Create an issue on GitHub with:
- Description of the problem
- Steps to reproduce
- Expected vs actual behavior
- Logs and error messages (if available)

### How do I request features?

Create an issue on GitHub with:
- Feature description
- Use case
- Proposed implementation (if any)

