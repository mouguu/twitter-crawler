#!/usr/bin/env bash
set -e

# Prepare shared volume directories and symlinks
mkdir -p /app/data/output /app/data/cookies


exec node dist/cmd/start-server.js
