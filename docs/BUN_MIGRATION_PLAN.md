# XRCrawler Bun 迁移计划

> 分支: `feature/bun-migration`  
> 创建日期: 2025-12-04  
> 状态: 🚧 进行中

## 📋 概述

将 XRCrawler 从 Node.js + pnpm 迁移到 Bun 运行时，以获得：

- 🚀 **更快的启动速度** - 原生 TypeScript 支持，无需编译
- 📦 **更快的依赖安装** - Bun 包管理比 pnpm 快 3-5 倍
- 💾 **更低的内存占用** - 对爬虫这种内存密集型应用尤为重要
- 🎯 **更简洁的 Docker 镜像** - 体积减半，启动速度翻倍

---

## ✅ 迁移清单

### 第一阶段：基础设施替换

- [ ] **1.1 替换包管理器**

  ```bash
  rm -rf node_modules pnpm-lock.yaml package-lock.json
  bun install
  ```

- [ ] **1.2 更新 package.json scripts**
  - 将 `node` 命令替换为 `bun`
  - 移除 `ts-node`，Bun 原生支持 TypeScript
  - 将 `pnpm` 命令替换为 `bun`

### 第二阶段：Puppeteer 适配（关键）

- [ ] **2.1 切换到 puppeteer-core**

  ```json
  {
    "dependencies": {
      "puppeteer-core": "^23.0.0" // 替换 puppeteer
    }
  }
  ```

- [ ] **2.2 更新爬虫代码**
  - 修改 `core/platforms/twitter-adapter.ts`
  - 添加 `executablePath` 配置指向系统 Chromium
  - 添加 Bun 优化参数 `--disable-dev-shm-usage`

### 第三阶段：依赖兼容性修复

- [ ] **3.1 Prisma 适配**
  - 确保使用最新版 `@prisma/client`
  - 验证 Prisma 在 Bun 环境下正常工作

- [ ] **3.2 BullMQ (Redis 队列) 验证**
  - BullMQ 底层用 `ioredis`
  - 验证 Bun 兼容性，必要时配置 `bunfig.toml`

- [ ] **3.3 WASM 加载优化**
  - Bun 原生支持直接 import `.wasm` 文件
  - 可选：简化 WASM 加载逻辑

### 第四阶段：Docker 迁移

- [ ] **4.1 创建新 Dockerfile**
  - 基于 `oven/bun:1.2.24` 镜像
  - 安装 Chromium 浏览器
  - 配置 `CHROME_BIN` 环境变量

- [ ] **4.2 更新 docker-compose.yml**
  - 更新镜像引用
  - 调整启动命令

### 第五阶段：测试与验证

- [ ] **5.1 本地开发测试**
  - 验证 `bun run dev` 正常工作
  - 验证 CLI 命令正常工作
  - 验证爬虫功能正常

- [ ] **5.2 Docker 构建测试**
  - 验证镜像构建成功
  - 验证容器正常运行

- [ ] **5.3 生产环境测试**
  - 验证所有功能正常
  - 对比性能指标

---

## 📁 需要修改的文件

| 文件                                | 修改内容                                      |
| ----------------------------------- | --------------------------------------------- |
| `package.json`                      | 更新 scripts，替换 puppeteer → puppeteer-core |
| `Dockerfile`                        | 切换到 Bun 基础镜像                           |
| `docker-compose.yml`                | 更新启动命令                                  |
| `core/platforms/twitter-adapter.ts` | 添加 puppeteer 配置                           |
| `core/scraper/*.ts`                 | 检查 puppeteer 启动逻辑                       |
| `bunfig.toml`                       | 新增 Bun 配置文件                             |
| `.gitignore`                        | 添加 bun.lockb                                |

---

## 🐳 新 Dockerfile 模板

```dockerfile
FROM oven/bun:1.2.24 as base
WORKDIR /app

# 安装 Chromium (Puppeteer 必须)
RUN apt-get update && apt-get install -y \
    chromium \
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
    openssl \
    && rm -rf /var/lib/apt/lists/*

# 复制依赖配置
COPY package.json bun.lockb ./
RUN bun install --production

# 复制 Prisma
COPY prisma ./prisma
COPY prisma.config.ts ./
RUN DATABASE_URL="postgresql://dummy:dummy@localhost:5432/dummy" bunx prisma generate

# 复制 WASM 模块
COPY wasm/tweet-cleaner/pkg ./wasm/tweet-cleaner/pkg
COPY wasm/reddit-cleaner/pkg ./wasm/reddit-cleaner/pkg
COPY wasm/url-normalizer/pkg ./wasm/url-normalizer/pkg

# 复制源码
COPY . .

# 构建前端
RUN cd frontend && bun install && bun run build

ENV CHROME_BIN=/usr/bin/chromium
EXPOSE 5001

CMD ["bun", "run", "cmd/start-server.ts"]
```

---

## 📝 注意事项

1. **本地开发环境**
   - macOS: Chrome 路径为 `/Applications/Google Chrome.app/Contents/MacOS/Google Chrome`
   - Linux: 通常为 `/usr/bin/chromium` 或 `/usr/bin/google-chrome`

2. **环境变量**

   ```env
   CHROME_BIN=/path/to/chromium  # Docker 或 Serverless 环境必须设置
   ```

3. **已知坑点**
   - Puppeteer 在 Bun 中需要显式指定 `executablePath`
   - 某些 Node.js 专有 API 可能需要在 `bunfig.toml` 中开启兼容模式

---

## 🔗 参考资源

- [Bun 官方文档](https://bun.sh/docs)
- [Bun Node.js 兼容性](https://bun.sh/docs/runtime/nodejs-apis)
- [Puppeteer + Bun 指南](https://bun.sh/guides/ecosystem/puppeteer)
