# Configuration Guide

Complete configuration reference for XRCrawler.

## Environment Variables

### Server Configuration

- `PORT` - Server port (default: `5001`)
- `HOST` - Server host (default: `0.0.0.0`)
- `API_KEY` - API key for endpoint protection (optional)

### Reddit Configuration

- `REDDIT_API_URL` - Reddit Python API server URL (default: `http://127.0.0.1:5002`)
- `REDDIT_API_PORT` - Reddit API server port (default: `5002`)
- `REDDIT_API_TIMEOUT` - Reddit API request timeout in ms (default: `300000`)

### Output Configuration

- `OUTPUT_DIR` - Output directory (default: `./output`)

### Logging Configuration

- `LOG_LEVEL` - Logging level: `debug`, `info`, `warn`, `error` (default: `info`)
- `ENABLE_FILE_LOGGING` - Enable file logging (default: `false`)
- `LOG_DIR` - Log directory (default: `./logs`)

### Browser Configuration

- `PUPPETEER_EXECUTABLE_PATH` - Custom Chromium path (for Docker, default: auto-detect)
- `HEADLESS` - Run browser in headless mode (default: `true`)

### Twitter Configuration

- `TWITTER_DEFAULT_MODE` - Default scraping mode: `graphql`, `puppeteer`, or `mixed` (default: `graphql`)
- `TWITTER_DEFAULT_LIMIT` - Default tweet limit (default: `50`)
- `TWITTER_API_TIMEOUT` - API request timeout in ms (default: `30000`)
- `TWITTER_BROWSER_TIMEOUT` - Browser operation timeout in ms (default: `60000`)

### Rate Limiting

- `RATE_LIMIT_MAX_RETRIES` - Maximum retries on rate limit (default: `3`)
- `RATE_LIMIT_BASE_DELAY` - Base delay between retries in ms (default: `2000`)
- `RATE_LIMIT_MAX_DELAY` - Maximum delay between retries in ms (default: `30000`)
- `ENABLE_ROTATION` - Enable automatic session rotation (default: `true`)

## Configuration File

Create `crawler-config.json` in the project root for scheduled tasks:

```json
{
  "twitter": {
    "usernames": ["user1", "user2"],
    "tweetCount": 50,
    "separateFiles": true,
    "scrapeMode": "mixed"
  },
  "schedule": {
    "interval": 60,
    "timezone": "UTC"
  },
  "output": {
    "directory": "./output",
    "format": "md"
  },
  "monitor": {
    "usernames": ["user1", "user2"],
    "keywords": ["AI", "space"],
    "lookbackHours": 24
  }
}
```

### Configuration Options

**Twitter Section**:
- `usernames`: Array of usernames to scrape
- `tweetCount`: Number of tweets per user
- `separateFiles`: Save each user to separate file (default: `false`)
- `scrapeMode`: `graphql`, `puppeteer`, or `mixed`

**Schedule Section**:
- `interval`: Interval in minutes
- `timezone`: Timezone for scheduling

**Output Section**:
- `directory`: Output directory path
- `format`: Output format (`md`, `json`, or both)

**Monitor Section**:
- `usernames`: Array of usernames to monitor
- `keywords`: Optional keyword filter
- `lookbackHours`: Hours to look back for new tweets

## Proxy Configuration

Proxy support is available through the `ProxyManager` class. Configure via:

### Environment Variables

```bash
PROXY_URL=http://proxy.example.com:8080
PROXY_LIST=proxy1.txt  # Path to proxy list file
```

### Configuration File

```json
{
  "proxy": {
    "enabled": true,
    "url": "http://proxy.example.com:8080",
    "list": "proxy/proxy-list.txt",
    "rotation": true,
    "healthCheck": true
  }
}
```

### Programmatic API

```typescript
import { ProxyManager } from './core/proxy-manager';

const proxyManager = new ProxyManager({
  enabled: true,
  url: 'http://proxy.example.com:8080',
  rotation: true
});
```

## Cookie Configuration

### Cookie File Format

Cookie files must be JSON format exported from browser extensions:

```json
[
  {
    "name": "auth_token",
    "value": "your-auth-token",
    "domain": ".x.com",
    "path": "/",
    "secure": true,
    "httpOnly": true
  },
  {
    "name": "ct0",
    "value": "your-csrf-token",
    "domain": ".x.com",
    "path": "/",
    "secure": true,
    "httpOnly": false
  }
]
```

### Required Cookies

- `auth_token`: Authentication token
- `ct0`: CSRF token

### Cookie Directory

Place cookie files in `cookies/` directory:

```
cookies/
├── account1.json
├── account2.json
└── account3.json
```

## Advanced Configuration

### Browser Pool Settings

```json
{
  "browserPool": {
    "maxInstances": 3,
    "reuseInstances": true,
    "idleTimeout": 300000
  }
}
```

### Fingerprint Settings

```json
{
  "fingerprint": {
    "enabled": true,
    "canvasNoise": true,
    "webglNoise": true,
    "hardwareEmulation": true
  }
}
```

### Performance Tuning

```json
{
  "performance": {
    "scrollDelay": 1000,
    "networkIdleTimeout": 5000,
    "maxConcurrentRequests": 5
  }
}
```

## Example .env File

```bash
# Server
PORT=5001
HOST=0.0.0.0
API_KEY=your-secret-api-key

# Reddit
REDDIT_API_URL=http://127.0.0.1:5002
REDDIT_API_TIMEOUT=300000

# Output
OUTPUT_DIR=./output

# Logging
LOG_LEVEL=info
ENABLE_FILE_LOGGING=true
LOG_DIR=./logs

# Browser
HEADLESS=true
PUPPETEER_EXECUTABLE_PATH=/usr/bin/chromium

# Twitter
TWITTER_DEFAULT_MODE=mixed
TWITTER_DEFAULT_LIMIT=100
TWITTER_API_TIMEOUT=30000

# Rate Limiting
RATE_LIMIT_MAX_RETRIES=3
RATE_LIMIT_BASE_DELAY=2000
ENABLE_ROTATION=true

# Proxy (optional)
PROXY_URL=http://proxy.example.com:8080
```

