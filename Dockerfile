# Dockerfile
FROM node:18-slim

# 安装 Chromium 及字体依赖，以及 curl 和构建工具
RUN apt-get update && \
    apt-get install -y chromium fonts-liberation ca-certificates curl build-essential && \
    rm -rf /var/lib/apt/lists/*

# 安装 Rust 和 wasm-pack (needed for WASM builds)
RUN curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh -s -- -y
ENV PATH="/root/.cargo/bin:${PATH}"
RUN cargo install wasm-pack

# 安装 pnpm
RUN npm install -g pnpm

WORKDIR /app

# Copy package files
COPY package*.json pnpm-lock.yaml* ./

# Install server deps (skip postinstall to avoid WASM build before source is copied)
RUN npm install --ignore-scripts

# Install frontend deps (cached separately)
COPY frontend/package*.json frontend/pnpm-lock.yaml* ./frontend/
RUN cd frontend && pnpm install

# Copy all source code
COPY . .

# Now build WASM modules and compile TypeScript
RUN pnpm run build:wasm:all && npm run build

# Build frontend into /app/public
RUN pnpm run build:frontend

ENV PUPPETEER_EXECUTABLE_PATH=/usr/bin/chromium
ENV PORT=5001
EXPOSE 5001

COPY entrypoint.sh /app/entrypoint.sh
RUN chmod +x /app/entrypoint.sh

CMD ["/app/entrypoint.sh"]
