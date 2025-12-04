# ==========================================
# 🏗️ XRCrawler Bun Dockerfile
# Multi-stage build for production optimization
# ==========================================

# ==========================================
# 阶段 1: 构建阶段 (Builder)
# ==========================================
FROM oven/bun:1.2.24 as builder
WORKDIR /app

# 1. 缓存层：只复制依赖文件，利用 Docker Layer Caching
COPY package.json bun.lockb ./
COPY prisma ./prisma

# 2. 安装所有依赖 (包括 devDependencies，因为构建前端需要)
RUN bun install --frozen-lockfile

# 3. 生成 Prisma Client
COPY prisma.config.ts ./
RUN DATABASE_URL="postgresql://dummy:dummy@localhost:5432/dummy" bunx prisma generate

# 4. 复制源码
COPY . .

# 5. 构建前端 (产出到 frontend/dist)
RUN cd frontend && bun install && bun run build

# ==========================================
# 阶段 2: 运行阶段 (Runner)
# ==========================================
FROM oven/bun:1.2.24-slim as runner
WORKDIR /app

# 1. 安装 Chromium (Puppeteer 运行环境)
RUN apt-get update && apt-get install -y \
    chromium \
    fonts-liberation \
    libasound2 \
    libnss3 \
    libxss1 \
    libatk-bridge2.0-0 \
    libgtk-3-0 \
    ca-certificates \
    && rm -rf /var/lib/apt/lists/*

# 2. 环境变量配置
ENV NODE_ENV=production
ENV CHROME_BIN=/usr/bin/chromium
ENV PUPPETEER_SKIP_CHROMIUM_DOWNLOAD=true
ENV PUPPETEER_EXECUTABLE_PATH=/usr/bin/chromium

# 3. 只从 Builder 阶段复制必要文件
COPY --from=builder /app/package.json ./
COPY --from=builder /app/bunfig.toml ./
COPY --from=builder /app/node_modules ./node_modules

# 4. 复制核心代码
COPY --from=builder /app/cmd ./cmd
COPY --from=builder /app/core ./core
COPY --from=builder /app/utils ./utils
COPY --from=builder /app/types ./types
COPY --from=builder /app/config ./config
COPY --from=builder /app/server ./server
COPY --from=builder /app/middleware ./middleware
COPY --from=builder /app/routes ./routes
COPY --from=builder /app/proxy ./proxy

# 5. 复制 WASM 模块
COPY --from=builder /app/wasm/tweet-cleaner/pkg ./wasm/tweet-cleaner/pkg
COPY --from=builder /app/wasm/reddit-cleaner/pkg ./wasm/reddit-cleaner/pkg
COPY --from=builder /app/wasm/url-normalizer/pkg ./wasm/url-normalizer/pkg

# 6. 复制前端构建产物
COPY --from=builder /app/frontend/dist ./frontend/dist
COPY --from=builder /app/public ./public

# 7. 复制 Prisma 生成的 Client
COPY --from=builder /app/prisma ./prisma
COPY --from=builder /app/generated ./generated

EXPOSE 5001

# 直接运行 TS，Bun 不需要编译成 JS 也能跑生产环境
CMD ["bun", "run", "cmd/start-server.ts"]
