import { defineConfig, env } from 'prisma/config'
import 'dotenv/config' // ⚠️ 必须显式引入 dotenv，否则读不到 .env

export default defineConfig({
  // 指定 schema 文件位置
  schema: 'prisma/schema.prisma',
  
  // 指定迁移文件位置
  migrations: {
    path: 'prisma/migrations',
  },
  
  // ⚠️ 数据库连接在这里配置，而不是 schema.prisma
  datasource: {
    url: env('DATABASE_URL'),
  },
})
