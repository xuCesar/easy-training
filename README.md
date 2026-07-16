# Easy Training 教培管理系统

基于 [Better-T-Stack](https://www.better-t-stack.dev/) 的全栈 TypeScript monorepo，面向多校区教培机构，覆盖招生、学员、课程班级、排课教务、财务收款和校区配置。

## 技术栈

- Web：React 19、TanStack Router、TanStack Query、Tailwind CSS、共享 shadcn/ui
- Server：Hono、Node.js
- API：oRPC，提供端到端类型推导和 OpenAPI 文档
- 数据库：PostgreSQL、Drizzle ORM
- 认证：Better Auth，邮箱密码登录
- 工程：pnpm workspace、Turborepo、Biome

Better-T-Stack 复现命令记录在 `bts.jsonc`。当前架构由以下配置生成：

```bash
pnpm create better-t-stack@latest easy-training \
  --frontend tanstack-router \
  --backend hono \
  --runtime node \
  --database postgres \
  --orm drizzle \
  --api orpc \
  --auth better-auth \
  --addons turborepo biome \
  --db-setup docker \
  --package-manager pnpm
```

## 目录结构

```text
apps/
  web/       管理后台、路由、认证页面和教培业务 UI
  server/    Hono 服务、Better Auth、oRPC 与 OpenAPI 入口
packages/
  api/       oRPC router、共享业务契约和当前 Mock 数据适配器
  auth/      Better Auth 配置
  db/        Drizzle schema、数据库脚本和 Docker Compose
  env/       服务端与客户端环境变量校验
  ui/        跨应用共享的 UI 基础组件
  config/    TypeScript 共享配置
```

## 本地运行

1. 安装依赖：

```bash
pnpm install
```

2. 准备环境变量：

```bash
cp apps/server/.env.example apps/server/.env
cp apps/web/.env.example apps/web/.env
```

`BETTER_AUTH_SECRET` 必须替换为至少 32 个字符的随机值，不要提交真实密钥。

3. 启动 PostgreSQL 并应用 schema：

```bash
pnpm db:start
pnpm db:push
```

4. 启动 Web 和 API：

```bash
pnpm dev
```

- Web：<http://localhost:3001>
- API：<http://localhost:3000>
- OpenAPI：<http://localhost:3000/api-reference>

首次使用可在登录页创建本地管理员账号。

## 常用命令

```bash
pnpm dev          # 启动全部应用
pnpm dev:web      # 仅启动 Web
pnpm dev:server   # 仅启动 API
pnpm build        # 构建全部应用和包
pnpm check-types  # 全仓类型检查
pnpm check        # Biome 只读检查
pnpm check:fix    # 自动修复可安全处理的格式与 lint 问题
pnpm db:generate  # 生成 Drizzle migration
pnpm db:migrate   # 执行 migration
pnpm db:studio    # 打开 Drizzle Studio
```

## 当前数据边界

认证数据和教培领域 schema 已接入 PostgreSQL。认证用户首次进入业务系统时，会自动创建一个机构并成为 `owner`；后续业务接口只使用服务端解析出的机构上下文，不接受客户端传入的机构 ID。

招生线索已使用真实 PostgreSQL 数据，支持列表、搜索、阶段筛选、新增、编辑和阶段流转。线索读取与写入仅允许 `owner`、`admin`、`campus_manager`、`consultant`，并按当前机构隔离；`teacher`、`finance` 无权访问线索隐私数据。

运营工作台中的学员、课程、班级、课次、账单和待办仍由 `packages/api/src/data/training.ts` 提供原型快照。后续将按 GitHub Roadmap 逐步迁移为机构维度的真实查询，并完成线索转报名、合同收款、排课签到、课消和续费闭环。

本地联调时请统一使用 `http://localhost:3001` 访问 Web。服务端会严格校验带 Cookie 的 RPC 请求来源与 `CORS_ORIGIN`，使用 `127.0.0.1` 和 `localhost` 混用会被浏览器视为不同来源。
