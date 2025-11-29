# Technical Architecture

Deep dive into XRCrawler's technical architecture and design decisions.

## Overview

XRCrawler implements enterprise-grade features for reliability and stealth, using a hybrid Node.js + Python architecture.

## Core Components

### Scraping Engine

**Location**: `core/scraper-engine.ts`

The main orchestrator that coordinates all scraping activities:

- Mode selection (GraphQL API, Puppeteer DOM, Mixed)
- Strategy switching based on limits
- Error handling and retry logic
- Progress tracking and checkpointing

### Timeline Runners

**GraphQL API Runner** (`core/timeline-api-runner.ts`):
- Fast, lightweight scraping using Twitter's internal GraphQL API
- No browser needed
- Limited to ~800 tweets (server-side restriction)

**Puppeteer DOM Runner** (`core/timeline-dom-runner.ts`):
- Full browser automation for deeper timeline access
- Handles complex scenarios and error recovery
- Virtually unlimited depth

**Date Chunker** (`core/timeline-date-chunker.ts`):
- Implements reverse-chronological date chunking
- Splits timeframes into monthly chunks
- Uses search queries (`from:user since:A until:B`) instead of scrolling

### Deep Search & Date Chunking

To bypass the ~800 tweet limit, XRCrawler uses intelligent date chunking:

1. **Intelligent Segmentation**: Timeframe split into monthly chunks (e.g., 2025-11, 2025-10, 2025-09...)
2. **Search-Based Retrieval**: Uses Puppeteer to perform advanced search queries instead of scrolling
3. **Smart Pacing**: Limits scrolling per chunk to prevent frontend crashes
4. **Auto-Stop**: Automatically stops once target count is reached

### Session Management

**Session Manager** (`core/session-manager.ts`):
- Loads all cookie files from `cookies/` directory
- Automatic rotation on rate limits
- Chunk retry mechanism (prevents data gaps)

**Cookie Manager** (`core/cookie-manager.ts`):
- Cookie file loading and validation
- Session validation before use

**Key Features**:
- **Multi-Account Support**: Multiple cookie files
- **Automatic Rotation**: Switches sessions on 429 errors or load failures
- **Chunk Retry**: If session fails during a chunk, next session retries the same chunk
- **Configurable**: Enable/disable rotation via `enableRotation` option

### Browser Management

**Browser Manager** (`core/browser-manager.ts`):
- Creates and manages browser instances
- Handles browser lifecycle

**Browser Pool** (`core/browser-pool.ts`):
- Reuses browser instances to reduce overhead
- Improves performance for multiple scrapes

**Fingerprint Manager** (`core/fingerprint-manager.ts`):
- Injects realistic browser fingerprints using `fingerprint-injector`
- Canvas & WebGL noise randomization
- Hardware emulation matching User-Agent

### Rate Limiting & Error Handling

**Rate Limit Manager** (`core/rate-limit-manager.ts`):
- Detects 429 errors and rate limit responses
- Triggers session rotation
- Configurable retry delays

**Error Snapshotter** (`core/error-snapshotter.ts`):
- Captures screenshots on errors
- Saves error details for debugging

**Error Classifier** (`utils/error-classifier.ts`):
- Classifies errors into categories
- Provides user-friendly error messages

### Progress Management

**Progress Manager** (`core/progress-manager.ts`):
- Tracks scraping progress
- Saves checkpoints (oldest tweet ID)
- Enables resume functionality

### Performance Monitoring

**Metrics Collector** (`core/metrics-collector.ts`):
- Collects real-time performance metrics
- Scraping speed, success rates, resource usage

**Performance Monitor** (`core/performance-monitor.ts`):
- Real-time performance tracking
- Resource usage monitoring

### Request Queue

**Task Queue** (`server/task-queue.ts`):
- Manages concurrent requests
- Priority-based queuing
- Prevents conflicts and ensures orderly execution

## Hybrid Architecture

### Frontend (React + Vite)

**Location**: `frontend/`

- Modern, responsive UI
- Real-time updates via Server-Sent Events (SSE)
- Component-based architecture:
  - `HeaderBar`: API key and navigation
  - `TaskForm`: Task creation
  - `ResultsPanel`: Results display and download
  - `SessionManager`: Cookie file management
  - `ErrorNotification`: Error display

### Backend (Node.js + Express)

**Location**: `server.ts`, `server/`

- Orchestrates scraping process
- Manages Request Queue and Session Rotation
- Handles Twitter scraping via TypeScript/Puppeteer
- REST API endpoints for frontend
- SSE streaming for real-time updates

### Python Bridge (Reddit Integration)

**Location**: `platforms/reddit/`

- Node.js communicates with Python via HTTP API
- `reddit_api_server.py`: Lightweight HTTP server
- Structured JSON responses
- Health checks and observability

**Why HTTP instead of stdout parsing?**
- Structured errors
- Health checks
- Easier observability
- Better error handling

## Directory Structure

```
XRCrawler/
├── frontend/              # React application
│   ├── src/
│   │   ├── components/    # UI components
│   │   ├── types/         # TypeScript types
│   │   └── utils/         # Frontend utilities
│   └── vite.config.ts
├── server.ts              # Main Express backend
├── server/
│   └── task-queue.ts      # Task queue management
├── core/                  # Twitter scraping logic
│   ├── scraper-engine.ts
│   ├── timeline-api-runner.ts
│   ├── timeline-dom-runner.ts
│   ├── timeline-date-chunker.ts
│   ├── session-manager.ts
│   ├── cookie-manager.ts
│   ├── browser-manager.ts
│   ├── browser-pool.ts
│   ├── fingerprint-manager.ts
│   ├── rate-limit-manager.ts
│   ├── error-snapshotter.ts
│   ├── progress-manager.ts
│   ├── metrics-collector.ts
│   └── ...
├── platforms/reddit/      # Python Reddit scripts
│   └── reddit_api_server.py
├── cookies/               # Session storage
├── output/                # Scraped data
├── middleware/            # Express middleware
├── utils/                 # Utility functions
├── types/                 # TypeScript types
└── config/                # Configuration
```

## Security Features

### API Key Protection

- Optional API key authentication for all `/api/*` endpoints
- Set via `API_KEY` environment variable
- Frontend sends key via `X-API-Key` header or `api_key` query parameter

### Path Validation

- All file download paths validated to prevent directory traversal
- Output path manager with security checks

### Session Validation

- Cookie files validated before use
- Prevents invalid sessions from causing errors

## Scraping Modes

### GraphQL API Mode (Default)

- **Speed**: ⚡ Fast
- **Limitation**: ⚠️ ~800 tweet limit
- **Best For**: Quick monitoring, daily updates, small profiles

### Puppeteer DOM Mode

- **Speed**: 🐢 Slower (full browser rendering)
- **Limitation**: ✅ Virtually unlimited
- **Best For**: Archival, large datasets, historical analysis

### Mixed Mode

- **Speed**: ⚡ Fast start, 🐢 Slower continuation
- **Logic**: Starts with GraphQL API, switches to Puppeteer when limit reached
- **Best For**: Large profiles needing both speed and depth

## Data Flow

1. **User Request** → Frontend/CLI
2. **Task Creation** → Task Queue
3. **Session Selection** → Session Manager
4. **Mode Selection** → Scraper Engine
5. **Scraping Execution** → Timeline Runner (API or DOM)
6. **Progress Updates** → Progress Manager → SSE/Frontend
7. **Error Handling** → Error Snapshotter → Error Classification
8. **Result Export** → Output Manager → File System

## Recent Improvements

- HTTP-based Reddit bridge (replaced stdout parsing)
- Modular UI components (split from monolithic App.tsx)
- Request queue orchestration (moved to `server/task-queue.ts`)
- Performance monitoring with real-time metrics
- Error snapshotting for debugging
- Browser pool for performance
- Progress management with checkpointing
- Mixed mode automatic switching
- Enhanced error handling and classification

