# Troubleshooting Guide

Common issues and solutions for XRCrawler.

## Reddit API Server Not Starting

### Symptoms

- Reddit scraping fails
- Connection refused errors
- "Reddit API server not available" messages

### Solutions

1. **Check Python Installation**:

```bash
python3 --version
# Should be Python 3.8+
```

2. **Install Dependencies**:

```bash
cd platforms/reddit
pip install -r requirements.txt
```

3. **Start Server Manually**:

```bash
python3 platforms/reddit/reddit_api_server.py
```

4. **Check Port Availability**:

```bash
# Check if port 5002 is in use
lsof -i :5002
```

5. **Verify Environment Variable**:

```bash
# Check REDDIT_API_URL
echo $REDDIT_API_URL
# Should be: http://127.0.0.1:5002
```

## Cookie Files Not Working

### Symptoms

- Authentication errors
- "Invalid session" messages
- Rate limits immediately

### Solutions

1. **Verify Cookie Format**:

   - Must be JSON format
   - Must include `auth_token` and `ct0` cookies
   - Must be exported from a logged-in X.com session

2. **Check Cookie File Location**:

```bash
# Verify files are in cookies/ directory
ls -la cookies/
```

3. **Validate Cookies**:

   - Use the Session Manager in the web interface
   - Check for validation errors
   - Re-export cookies if invalid

4. **Check Cookie Expiration**:

   - Cookies expire after some time
   - Re-export fresh cookies if old ones don't work

5. **Multiple Accounts**:

   - Ensure each cookie file is valid
   - Remove invalid cookie files
   - Test each account individually

## Rate Limiting Issues

### Symptoms

- Frequent 429 errors
- Scraping stops unexpectedly
- "Rate limit exceeded" messages

### Solutions

1. **Use Multiple Accounts**:

   - Add multiple cookie files to `cookies/` directory
   - Enable session rotation (default: enabled)
   - System will automatically rotate on rate limits

2. **Reduce Scraping Speed**:

   - Increase delays in configuration
   - Use GraphQL mode for smaller batches
   - Reduce concurrent requests

3. **Monitor Rate Limits**:

```bash
# Check metrics
curl http://localhost:5001/api/metrics/summary
```

4. **Wait and Retry**:

   - Rate limits are temporary
   - Wait 15-30 minutes before retrying
   - Use `--resume` to continue from checkpoint

## Browser/Chromium Issues

### Symptoms

- "Chromium not found" errors
- Browser crashes
- Puppeteer timeouts

### Solutions

1. **Install Chromium**:

```bash
# Puppeteer will download it automatically, or:
# macOS
brew install chromium

# Linux
sudo apt-get install chromium-browser

# Or set custom path
export PUPPETEER_EXECUTABLE_PATH=/usr/bin/chromium
```

2. **Docker Issues**:

   - Chromium is pre-installed in Docker image
   - Check `PUPPETEER_EXECUTABLE_PATH` if using custom Chrome

3. **Headless Mode**:

```bash
# Run in headless mode (default)
export HEADLESS=true

# Or disable for debugging
export HEADLESS=false
```

4. **Memory Issues**:

   - Reduce browser pool size
   - Close other applications
   - Increase system memory

## Progress Not Updating

### Symptoms

- Progress bar stuck
- No log updates
- SSE connection issues

### Solutions

1. **Check Browser Console**:

   - Open browser developer tools
   - Check for JavaScript errors
   - Verify SSE connection in Network tab

2. **Verify Server Status**:

```bash
# Check if server is running
curl http://localhost:5001/api/health
```

3. **Refresh and Retry**:

   - Refresh the web interface
   - Check if task is still running
   - Restart server if needed

4. **Check Logs**:

```bash
# View server logs
tail -f logs/combined.log

# Or Docker logs
docker logs -f xrcrawler
```

## API Key Issues

### Symptoms

- "Authentication required" errors
- 401 Unauthorized responses
- API requests rejected

### Solutions

1. **Set API Key**:

```bash
# In environment
export API_KEY=your-secret-key

# Or in .env file
API_KEY=your-secret-key
```

2. **Web Interface**:

   - Enter API key in header bar
   - Verify key matches environment variable

3. **API Requests**:

```bash
# Include in header
curl -H "X-API-Key: your-secret-key" http://localhost:5001/api/status

# Or query parameter
curl "http://localhost:5001/api/status?api_key=your-secret-key"
```

## Data Gaps in Archive

### Symptoms

- Missing months in archive
- "Gaps detected" warnings in logs
- Incomplete historical data

### Solutions

1. **Check Logs**:

```bash
# Look for "Gaps detected" warnings
grep "Gaps detected" logs/combined.log
```

2. **Verify User Activity**:

   - Check if user actually tweeted during missing period
   - Some users have inactive periods

3. **Retry Specific Chunks**:

   - Use `--resume-from` with specific tweet ID
   - Manually retry failed chunks

4. **Session Issues**:

   - Ensure multiple valid cookie files
   - Check session rotation is working
   - Verify no rate limits during scraping

## Performance Issues

### Symptoms

- Slow scraping
- High memory usage
- CPU spikes

### Solutions

1. **Reduce Browser Pool**:

   - Lower `maxInstances` in browser pool config
   - Close unused browser instances

2. **Use GraphQL Mode**:

   - Faster for small batches (< 800 tweets)
   - Avoids browser overhead

3. **Monitor Resources**:

```bash
# Check metrics
curl http://localhost:5001/api/metrics
```

4. **Optimize Configuration**:

   - Reduce scroll delays
   - Increase network idle timeout
   - Limit concurrent requests

## Build Issues

### Symptoms

- TypeScript compilation errors
- Missing dependencies
- Build failures

### Solutions

1. **Clean Install**:

```bash
# Remove node_modules and lock files
rm -rf node_modules package-lock.json pnpm-lock.yaml
rm -rf frontend/node_modules frontend/package-lock.json

# Reinstall
pnpm install
cd frontend && pnpm install && cd ..
```

2. **Check Node Version**:

```bash
node --version
# Should be 18+
```

3. **Update Dependencies**:

```bash
pnpm update
```

4. **TypeScript Errors**:

```bash
# Check TypeScript version
pnpm list typescript

# Rebuild
pnpm run build
```

## Getting Help

If you're still experiencing issues:

1. **Check Logs**: Review `logs/` directory for detailed error messages
2. **GitHub Issues**: Search existing issues or create a new one
3. **Error Screenshots**: Enable error snapshotting for visual debugging
4. **Minimal Reproduction**: Create a minimal test case to isolate the issue

