# API Reference

Complete REST API documentation for XRCrawler.

## Base URL

- Development: `http://localhost:5001`
- Production: Configure via `PORT` environment variable

## Authentication

If `API_KEY` is set in environment variables, all `/api/*` endpoints require authentication:

- **Header**: `X-API-Key: your-api-key`
- **Query Parameter**: `?api_key=your-api-key`

## Endpoints

### Scraping & Monitoring

#### Start Scraping Task

```http
POST /api/scrape
Content-Type: application/json
```

**Request Body**:

```json
{
  "taskType": "profile" | "thread" | "search" | "reddit",
  "target": "username or URL",
  "options": {
    "scrapeMode": "graphql" | "puppeteer" | "mixed",
    "tweetCount": 100,
    "dateRange": {
      "start": "2024-01-01",
      "end": "2024-12-31"
    },
    "includeReplies": false,
    "persona": false,
    "maxReplies": 100
  }
}
```

**Response**:

```json
{
  "success": true,
  "taskId": "task-123",
  "message": "Scraping started"
}
```

#### Start Monitoring

```http
POST /api/monitor
Content-Type: application/json
```

**Request Body**:

```json
{
  "usernames": ["user1", "user2"],
  "keywords": ["AI", "space"],
  "lookbackHours": 24
}
```

**Response**:

```json
{
  "success": true,
  "taskId": "monitor-123",
  "message": "Monitoring started"
}
```

#### Stop Current Task

```http
POST /api/stop
```

**Response**:

```json
{
  "success": true,
  "message": "Task stopped"
}
```

### Progress & Status

#### Get Progress Stream (SSE)

```http
GET /api/progress
```

Server-Sent Events stream with real-time updates:

```
event: progress
data: {"progress": 50, "total": 100, "status": "scraping"}

event: log
data: {"level": "info", "message": "Scraped 50 tweets"}

event: error
data: {"error": "Rate limit exceeded"}
```

#### Get Current Status

```http
GET /api/status
```

**Response**:

```json
{
  "isRunning": true,
  "taskId": "task-123",
  "progress": 50,
  "total": 100,
  "status": "scraping"
}
```

#### Get Result

```http
GET /api/result
```

**Response**:

```json
{
  "success": true,
  "result": {
    "markdownPath": "/output/x/username/run-123/index.md",
    "jsonPath": "/output/x/username/run-123/tweets.json",
    "metadataPath": "/output/x/username/run-123/metadata.json"
  }
}
```

### Metrics & Health

#### Get Detailed Metrics

```http
GET /api/metrics
```

**Response**:

```json
{
  "scrapingSpeed": 2.5,
  "successRate": 0.95,
  "sessionRotations": 3,
  "memoryUsage": 512,
  "cpuUsage": 25.5,
  "totalTweets": 1000,
  "errors": 5
}
```

#### Get Metrics Summary

```http
GET /api/metrics/summary
```

**Response**:

```json
{
  "speed": "2.5 tweets/sec",
  "successRate": "95%",
  "rotations": 3
}
```

#### Health Check

```http
GET /api/health
```

**Response**:

```json
{
  "status": "healthy",
  "version": "1.0.0",
  "uptime": 3600,
  "system": {
    "node": "18.0.0",
    "platform": "linux"
  }
}
```

### Session Management

#### List Sessions

```http
GET /api/sessions
```

**Response**:

```json
{
  "sessions": [
    {
      "filename": "account1.json",
      "valid": true,
      "username": "user1"
    },
    {
      "filename": "account2.json",
      "valid": true,
      "username": "user2"
    }
  ]
}
```

#### Upload Cookie File

```http
POST /api/cookies
Content-Type: multipart/form-data
```

**Form Data**:
- `file`: Cookie JSON file

**Response**:

```json
{
  "success": true,
  "filename": "account1.json",
  "message": "Cookie file uploaded and validated"
}
```

### Configuration & Downloads

#### Get Public Configuration

```http
GET /api/config
```

**Response**:

```json
{
  "apiKeyRequired": true,
  "redditApiUrl": "http://127.0.0.1:5002",
  "outputDir": "./output"
}
```

#### Download Result

```http
GET /api/download?path=/output/x/username/run-123/index.md
```

Downloads the file at the specified path (validated for security).

## Error Responses

All endpoints may return error responses:

```json
{
  "success": false,
  "error": "Error message",
  "code": "ERROR_CODE"
}
```

**Common Error Codes**:
- `AUTH_REQUIRED`: API key required
- `INVALID_API_KEY`: Invalid API key
- `TASK_RUNNING`: Another task is already running
- `INVALID_SESSION`: Invalid cookie file
- `RATE_LIMITED`: Rate limit exceeded
- `INVALID_PATH`: Invalid file path (security)

## Example Usage

### cURL Examples

**Start Scraping**:

```bash
curl -X POST http://localhost:5001/api/scrape \
  -H "Content-Type: application/json" \
  -H "X-API-Key: your-api-key" \
  -d '{
    "taskType": "profile",
    "target": "elonmusk",
    "options": {
      "scrapeMode": "mixed",
      "tweetCount": 100
    }
  }'
```

**Get Progress**:

```bash
curl -N http://localhost:5001/api/progress \
  -H "X-API-Key: your-api-key"
```

**Upload Cookie**:

```bash
curl -X POST http://localhost:5001/api/cookies \
  -H "X-API-Key: your-api-key" \
  -F "file=@cookies/account1.json"
```

### JavaScript Example

```javascript
// Start scraping
const response = await fetch('http://localhost:5001/api/scrape', {
  method: 'POST',
  headers: {
    'Content-Type': 'application/json',
    'X-API-Key': 'your-api-key'
  },
  body: JSON.stringify({
    taskType: 'profile',
    target: 'elonmusk',
    options: {
      scrapeMode: 'mixed',
      tweetCount: 100
    }
  })
});

const data = await response.json();
console.log(data);

// Listen to progress
const eventSource = new EventSource('http://localhost:5001/api/progress?api_key=your-api-key');
eventSource.addEventListener('progress', (e) => {
  const progress = JSON.parse(e.data);
  console.log('Progress:', progress);
});
```

