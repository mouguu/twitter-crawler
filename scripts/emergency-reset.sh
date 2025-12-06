#!/bin/bash
# Emergency Reset Script - 紧急重置脚本
# 强制清理所有卡住的任务和 Redis 数据

set -e

echo "⚠️  EMERGENCY RESET - 这将清理所有任务数据！"
echo "Press Ctrl+C to cancel, or wait 3 seconds to continue..."
sleep 3

echo ""
echo "🔄 Resetting Redis queue..."
docker compose exec -T redis redis-cli FLUSHDB

echo "🔄 Restarting worker..."
docker compose restart worker

echo "✅ Reset complete!"
echo ""
echo "All jobs have been cleared. You can now start fresh."


