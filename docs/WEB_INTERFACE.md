# Web Interface Guide

Complete guide to using the XRCrawler web interface.

## Starting the Web Interface

### Development Mode (Recommended)

```bash
# Fast start with Vite dev server (HMR enabled)
pnpm run dev:fast
```

Navigate to `http://localhost:5173`

### Production Mode

```bash
# Production simulation mode (builds frontend to static files)
pnpm run dev
```

Navigate to `http://localhost:5001`

## Features Overview

### Session Manager

Upload and manage multiple Twitter cookie files via the UI.

1. **Navigate to Session Manager Tab**
2. **Upload Cookie File**:
   - Click "Upload Cookie File"
   - Select your exported cookie JSON file
   - The system validates the file automatically
3. **View Active Sessions**: See all available cookie files
4. **Validation**: Invalid cookies are flagged with clear error messages

### Task Form

Create scraping tasks with a user-friendly interface.

#### Task Types

- **Profile**: Scrape a user's tweets, replies, and pinned tweets
- **Thread**: Archive a complete conversation thread
- **Search**: Advanced search with keywords, hashtags, date ranges
- **Reddit**: Scrape Reddit subreddits or posts

#### Configuration Options

- **Scrape Mode**:
  - `graphql`: Fast API mode (< 800 tweets)
  - `puppeteer`: Deep archival mode (unlimited)
  - `mixed`: Auto-switch from API to Puppeteer

- **Tweet Count**: Number of tweets to scrape
- **Date Range**: Optional start and end dates
- **Advanced Settings**:
  - Include replies
  - Generate persona analysis
  - Enable screenshots
  - Custom output format

### Real-time Progress

Watch your scraping progress in real-time:

- **Progress Bars**: Visual progress indicators
- **Log Streaming**: Live log output via Server-Sent Events (SSE)
- **Status Updates**: Current status and statistics
- **Performance Metrics**: Scraping speed, success rates, resource usage

### Results Panel

Download scraped results directly from the browser:

- **Markdown Files**: Human-readable format
- **JSON Files**: Structured data for analysis
- **Metadata**: Run statistics and configuration
- **Persona Analysis**: AI-generated analysis (if enabled)

### Performance Dashboard

View real-time metrics:

- **Scraping Speed**: Tweets per second
- **Success Rate**: Percentage of successful requests
- **Session Rotation**: Account rotation statistics
- **Resource Usage**: Memory and CPU metrics

### Error Handling

Clear error messages with:

- **Error Classification**: Automatic error type detection
- **Retry Suggestions**: Recommended actions
- **Error Screenshots**: Visual debugging aids (if enabled)
- **Stack Traces**: Detailed error information

## API Key Protection

If `API_KEY` is set in environment variables:

1. **Set API Key**: Enter your API key in the header bar
2. **Secure Requests**: All API requests include the key in headers
3. **Validation**: Invalid keys are rejected with clear messages

## Best Practices

1. **Start Small**: Test with small tweet counts first
2. **Monitor Progress**: Watch the progress panel for issues
3. **Use Multiple Sessions**: Upload multiple cookie files for rotation
4. **Check Logs**: Review log streaming for detailed information
5. **Download Results**: Save results promptly after completion

## Troubleshooting

### Session Not Working

- Verify cookie file format (must be JSON)
- Check that cookies include `auth_token` and `ct0`
- Use Session Manager validation feature

### Progress Not Updating

- Check browser console for errors
- Verify SSE connection in Network tab
- Refresh the page and retry

### API Key Issues

- Verify API key matches environment variable
- Check that key is set in header bar
- Review server logs for authentication errors

For more troubleshooting help, see [Troubleshooting Guide](./TROUBLESHOOTING.md).

