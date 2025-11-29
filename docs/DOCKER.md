# Docker Deployment Guide

Complete guide to deploying XRCrawler with Docker.

## Quick Start

### Build the Image

```bash
docker build -t xrcrawler .
```

### Run the Container

```bash
docker run -d \
  --name xrcrawler \
  -p 5001:5001 \
  -v $(pwd)/cookies:/app/cookies \
  -v $(pwd)/output:/app/output \
  -e API_KEY=your-secret-key \
  -e PORT=5001 \
  xrcrawler
```

## Dockerfile Overview

The `Dockerfile` includes:

- Node.js runtime (18+)
- Chromium for Puppeteer (pre-installed)
- All dependencies pre-installed
- Frontend pre-built
- Production-ready configuration

## Volume Mounts

### Required Volumes

- `cookies/`: Cookie files directory
- `output/`: Output directory for scraped data

### Optional Volumes

- `logs/`: Log files directory (if file logging enabled)

## Environment Variables

Set environment variables when running the container:

```bash
docker run -d \
  --name xrcrawler \
  -p 5001:5001 \
  -v $(pwd)/cookies:/app/cookies \
  -v $(pwd)/output:/app/output \
  -e API_KEY=your-secret-key \
  -e PORT=5001 \
  -e LOG_LEVEL=info \
  -e HEADLESS=true \
  xrcrawler
```

See [Configuration Guide](./CONFIGURATION.md) for all available environment variables.

## Docker Compose

For running Reddit API server alongside the main crawler:

```yaml
version: '3.8'

services:
  crawler:
    build: .
    ports:
      - "5001:5001"
    volumes:
      - ./cookies:/app/cookies
      - ./output:/app/output
    environment:
      - API_KEY=your-secret-key
      - PORT=5001
      - REDDIT_API_URL=http://reddit-api:5002
    depends_on:
      - reddit-api
  
  reddit-api:
    build:
      context: ./platforms/reddit
      dockerfile: Dockerfile
    ports:
      - "5002:5002"
    # Add Reddit API dependencies here
```

**Note**: You may need to create a `Dockerfile` for the Reddit API server in `platforms/reddit/`.

## Running with Docker Compose

```bash
docker-compose up -d
```

## Accessing the Web Interface

Once the container is running:

- Web Interface: `http://localhost:5001`
- Health Check: `http://localhost:5001/api/health`

## Reddit Features

For Reddit scraping, you have two options:

### Option 1: Separate Container

Run the Reddit API server in a separate container (see Docker Compose example above).

### Option 2: External Server

Run the Reddit API server on the host machine and configure the crawler to connect to it:

```bash
# On host machine
python3 platforms/reddit/reddit_api_server.py

# In Docker container, set:
REDDIT_API_URL=http://host.docker.internal:5002
```

## Troubleshooting

### Chromium Not Found

The Dockerfile includes Chromium, but if you encounter issues:

```bash
# Check if Chromium is installed
docker exec xrcrawler which chromium

# Set custom path if needed
-e PUPPETEER_EXECUTABLE_PATH=/usr/bin/chromium
```

### Cookie Files Not Working

Ensure cookie files are mounted correctly:

```bash
# Check mounted files
docker exec xrcrawler ls -la /app/cookies
```

### Permission Issues

If you encounter permission issues with volumes:

```bash
# Fix permissions
sudo chown -R $USER:$USER cookies/ output/
```

### Logs

View container logs:

```bash
# View logs
docker logs xrcrawler

# Follow logs
docker logs -f xrcrawler
```

## Production Deployment

### Security Considerations

1. **API Key**: Always set a strong `API_KEY`
2. **Network**: Use reverse proxy (nginx, Traefik) for HTTPS
3. **Volumes**: Use Docker secrets for sensitive data
4. **Resource Limits**: Set CPU and memory limits

### Example with Resource Limits

```bash
docker run -d \
  --name xrcrawler \
  --memory="2g" \
  --cpus="2" \
  -p 5001:5001 \
  -v $(pwd)/cookies:/app/cookies \
  -v $(pwd)/output:/app/output \
  -e API_KEY=your-secret-key \
  xrcrawler
```

### Using Docker Secrets

```bash
# Create secret
echo "your-secret-key" | docker secret create api_key -

# Use in docker-compose.yml
services:
  crawler:
    secrets:
      - api_key
    environment:
      - API_KEY_FILE=/run/secrets/api_key
```

## Updating the Container

```bash
# Pull latest changes
git pull

# Rebuild image
docker build -t xrcrawler .

# Stop and remove old container
docker stop xrcrawler
docker rm xrcrawler

# Run new container
docker run -d \
  --name xrcrawler \
  -p 5001:5001 \
  -v $(pwd)/cookies:/app/cookies \
  -v $(pwd)/output:/app/output \
  -e API_KEY=your-secret-key \
  xrcrawler
```

