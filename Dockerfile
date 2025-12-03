# Dockerfile
FROM node:18-slim

# 安装 Chromium 及字体依赖
RUN apt-get update && \
    apt-get install -y chromium fonts-liberation ca-certificates && \
    rm -rf /var/lib/apt/lists/*

WORKDIR /app
COPY package*.json ./
# Install server deps (use npm install to tolerate lock drift)
RUN npm install

# Install frontend deps (cached separately)
COPY frontend/package*.json ./frontend/
RUN cd frontend && npm install

# Copy source
COPY . .

# Build frontend into /app/public and then build server
RUN npm run build --prefix frontend && npm run build

ENV PUPPETEER_EXECUTABLE_PATH=/usr/bin/chromium
ENV PORT=5001
EXPOSE 5001

COPY entrypoint.sh /app/entrypoint.sh
RUN chmod +x /app/entrypoint.sh

CMD ["/app/entrypoint.sh"]
