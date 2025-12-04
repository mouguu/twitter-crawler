# Logging Standards

## Overview

XRCrawler uses consistent structured logging across all services to enable easy debugging and monitoring.

## Node.js / TypeScript Logging

### Current Implementation

We use **winston** via the `createEnhancedLogger` utility.

**Usage**:

```typescript
import { createEnhancedLogger } from "./utils/logger";

const logger = createEnhancedLogger("ModuleName");

logger.info("Operation started", { userId: "123", action: "scrape" });
logger.warn("Rate limit approaching", { remaining: 5 });
logger.error("Failed to connect", error);
```

### Log Format

**Console Output** (Development):

```
18:06:41 [info]: Server started {"service":"xrcrawler","module":"Server","port":5001}
```

**JSON Output** (Production, recommended):

```json
{
  "timestamp": "2025-12-03T18:06:41.000Z",
  "level": "info",
  "message": "Server started",
  "service": "xrcrawler",
  "module": "Server",
  "port": 5001
}
```

### Standard Fields

Every log entry MUST include:

- `timestamp`: ISO 8601 timestamp
- `level`: `debug` | `info` | `warn` | `error`
- `message`: Human-readable description
- `service`: Always `"xrcrawler"`
- `module`: Component name (e.g., "Server", "Worker", "Scraper")

### Contextual Data

Add context as additional fields:

```typescript
logger.info("Job completed", {
  jobId: "profile-123",
  duration: 4500,
  itemsProcessed: 50,
});
```

---

## Log Levels

Use levels consistently:

- **`debug`**: Detailed diagnostic information (e.g., "Scrolling page...")
- **`info`**: General informational messages (e.g., "Job started", "Server listening")
- **`warn`**: Warning conditions that don't prevent operation (e.g., "Retrying after rate limit")
- **`error`**: Error conditions (e.g., "Failed to scrape", "Database connection lost")

---

## Configuration

Log level is controlled via `ConfigManager`:

```typescript
const config = getConfigManager();
const logLevel = config.getLoggingConfig().level; // 'debug' | 'info' | 'warn' | 'error'
```

Or via environment variable:

```bash
LOG_LEVEL=debug pnpm run dev:server
```

---

## Best Practices

### ✅ DO:

- Use structured fields for machine-parseable data
- Include context (jobId, userId, etc.) in logs
- Log important state transitions
- Use appropriate log levels

### ❌ DON'T:

- Log sensitive data (passwords, API keys, auth tokens)
- Use string concatenation for log messages
- Log inside tight loops (causes performance issues)
- Mix console.log with logger calls

---

## Example: Complete Service Logging

```typescript
import { createEnhancedLogger } from "./utils/logger";

const logger = createEnhancedLogger("JobProcessor");

async function processJob(jobId: string) {
  logger.info("Job processing started", { jobId });

  try {
    const data = await fetchData(jobId);
    logger.debug("Data fetched successfully", {
      jobId,
      recordCount: data.length,
    });

    const result = await transform(data);
    logger.info("Job completed successfully", {
      jobId,
      duration: result.duration,
      itemsProcessed: result.count,
    });

    return result;
  } catch (error) {
    logger.error("Job processing failed", {
      jobId,
      error: error.message,
      stack: error.stack,
    });
    throw error;
  }
}
```

---

## Centralized Log Aggregation (Future)

For production deployments, consider:

- **Elasticsearch + Kibana** (ELK stack)
- **Grafana Loki**
- **Cloud logging** (AWS CloudWatch, Google Cloud Logging)

All services output JSON logs to stdout, making them compatible with any log aggregation system.
