#!/bin/bash
# Quick Reset - 快速重置（清理所有任务）

echo "🔄 Quick Reset - 清理所有任务..."
echo ""

# 1. 清理 Redis 中的所有任务
echo "1. 清理 Redis 队列..."
docker compose exec -T redis redis-cli FLUSHDB 2>/dev/null || echo "  ⚠️  Redis not accessible"

# 2. 重启 worker（中断所有正在运行的任务）
echo "2. 重启 worker（中断所有任务）..."
docker compose restart worker 2>/dev/null || echo "  ⚠️  Worker not accessible"

echo ""
echo "✅ 重置完成！"
echo ""
echo "所有任务已清理，worker 已重启。"
echo "刷新浏览器页面即可看到更新。"

