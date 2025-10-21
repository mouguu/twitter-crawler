# Twitter/X Crawler

A Node.js tool for scraping content from Twitter/X. Extract user profiles and tweets with flexible output options.

## Features

- Scrape Twitter/X user profiles and metadata
- Extract tweets with media flag, likes, retweets, and reply counts
- Export as Markdown, JSON, or CSV
- Batch processing from username lists
- Optional scheduled crawling

## Installation

### Prerequisites

- Node.js 16 or later
- npm or yarn

### Setup

1. Clone the repository:
   ```bash
   git clone https://github.com/yourusername/twitter-crawler.git
   cd twitter-crawler
   ```

2. Install dependencies:
   ```bash
   npm install
   ```

3. No extra browser install needed; Puppeteer downloads Chromium automatically on install.

## Usage

The crawler offers multiple commands through its CLI interface. Here are some common usage examples:

### Output Layout

Each scrape run now writes into a dedicated folder so results stay organized:

- Root: `./output/twitter/<username>/run-YYYY-MM-DDTHH-MM-SS/`
- Contents: `tweets.json`, `tweets.csv`, `index.md`, per-tweet Markdown under `markdown/`, optional screenshots under `screenshots/`
- Metadata: `metadata.json` summarises the run (counts, profile info, selected options)
- Cache files such as seen-URL lists are stored separately under `./.cache/twitter/<username>.json`

You can override the root directory with `-o/--output`.

### Twitter Scraping

```bash
# Scrape a single Twitter user's tweets
node cli.js twitter -u elonmusk -c 50 -o ./output

# Or pass a profile URL directly
node cli.js twitter -U https://x.com/elonmusk -c 50 -o ./output

# Scrape multiple Twitter users from a file
node cli.js twitter -f twitter_accounts.txt -c 20 -o ./output --merge

# (Optional) Run headful for debugging
node cli.js twitter -u username --headless false
```

### Scheduling

```bash
# Schedule crawling every 60 minutes
node cli.js schedule -c ./crawler-config.json -i 60 -o ./output
```

### See All Examples

```bash
node cli.js examples
```

## Configuration File

For scheduled crawling, create a JSON configuration file:

```json
{
  "twitter": {
    "usernames": ["elonmusk", "BillGates"],
    "tweetCount": 50,
    "separateFiles": true,
    "useAxios": false
  }
}
```

## Authentication and Cookies

The crawler uses cookies for authenticated access to Twitter/X:

- Twitter cookies: Prefer `env.json` at project root (object with `cookies` array). Fallback path supported: `./cookies/twitter-cookies.json`.

These files should follow the standard format used by Puppeteer's browser context.

## Advanced Configuration

Edit the constants in `scrape-unified.js` to customize:

- User agents
- Request timeouts
- Retry strategies
- CSS selectors for content extraction

## Troubleshooting

### Common Issues

1. **Rate Limiting**: If you're being rate-limited:
   - Reduce the number of requests
   - Use longer intervals between requests
   - Use authenticated cookies

## License

This project is licensed under the MIT License - see the LICENSE file for details.

## Disclaimer

This tool is for educational purposes only. Be sure to comply with the Terms of Service of the respective platforms and respect rate limits. The authors are not responsible for any misuse of this tool.

## Acknowledgments

- [Puppeteer](https://pptr.dev/) with Stealth plugin for browser automation
- [Commander.js](https://github.com/tj/commander.js/) for CLI interface 
