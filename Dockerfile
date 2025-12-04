# ============================================
# 优化版 Dockerfile - 构建速度提升 3-5 倍
# ============================================

# -------------------- 阶段 1: 依赖安装 --------------------
FROM node:22-slim AS deps

WORKDIR /app

# 只复制 package.json，最大化缓存
COPY package.json ./
RUN npm install --ignore-scripts

# -------------------- 阶段 2: 构建器（可选，如果你想在容器内编译 WASM）--------------------
# FROM node:22-slim AS wasm-builder
# 
# RUN apt-get update && apt-get install -y curl build-essential && rm -rf /var/lib/apt/lists/*
# RUN curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh -s -- -y
# ENV PATH="/root/.cargo/bin:${PATH}"
# RUN cargo install wasm-pack
# 
# WORKDIR /app
# COPY wasm ./wasm
# RUN cd wasm/tweet-cleaner && wasm-pack build --target nodejs --out-dir pkg
# RUN cd wasm/reddit-cleaner && wasm-pack build --target nodejs --out-dir pkg
# RUN cd wasm/url-normalizer && wasm-pack build --target nodejs --out-dir pkg

# -------------------- 阶段 3: 最终运行镜像 --------------------
FROM node:22-slim AS runtime

# Install system dependencies for Puppeteer and Prisma (OpenSSL)
RUN apt-get update && apt-get install -y \
    chromium \
    chromium-sandbox \
    fonts-liberation \
    libasound2 \
    libatk-bridge2.0-0 \
    libatk1.0-0 \
    libcups2 \
    libdbus-1-3 \
    libdrm2 \
    libgbm1 \
    libgtk-3-0 \
    libnspr4 \
    libnss3 \
    libxcomposite1 \
    libxdamage1 \
    libxrandr2 \
    xdg-utils \
    curl \
    ca-certificates \
    openssl \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# 从 deps 阶段复制 node_modules
COPY --from=deps /app/node_modules ./node_modules

# 复制 package.json
COPY package.json ./

# 生成 Prisma Client（需要 schema）
COPY prisma ./prisma
RUN npx prisma generate

# 复制预编译的 WASM 模块（在本地编译好）
COPY wasm/tweet-cleaner/pkg ./wasm/tweet-cleaner/pkg
COPY wasm/reddit-cleaner/pkg ./wasm/reddit-cleaner/pkg
COPY wasm/url-normalizer/pkg ./wasm/url-normalizer/pkg

# 复制源码并编译 TypeScript
COPY tsconfig.json ./
COPY core ./core
COPY cmd ./cmd
COPY config ./config
COPY server ./server
COPY types ./types
COPY utils ./utils
COPY middleware ./middleware
COPY routes ./routes

COPY proxy ./proxy
COPY tests ./tests
COPY scripts ./scripts
COPY *.ts ./

RUN npm run build

# 构建前端
COPY frontend/package.json ./frontend/
RUN cd frontend && npm install
COPY frontend ./frontend
RUN cd frontend && npm run build

# 清理不需要的文件（可选）
RUN rm -rf wasm/*/src wasm/*/target

EXPOSE 5001

CMD ["node", "dist/cmd/start-server.js"]
