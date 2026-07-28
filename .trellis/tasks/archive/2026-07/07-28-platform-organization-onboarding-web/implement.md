# 平台机构负责人初始化 Web 管理：实施计划

## 实施原则

- 本任务保持一个强关联实施单元，不拆成独立子任务：授权、邀请状态机、token 最终绑定和审计共享同一数据不变量，分开发布容易形成安全窗口。
- 按“安全不变量 → 数据约束 → API → UI → 运维”的顺序推进，每一步均可独立验证。
- 不引入新的第三方依赖，优先复用现有 Drizzle、oRPC、TanStack Router、表单和 UI 组件模式。
- 所有业务代码修改前重新执行 `trellis-before-dev` 并读取目标 layer spec。

## Phase 1：修复 onboarding 最终 token 绑定

### 影响文件

- `packages/db/src/repositories/organization-onboarding.ts`
- `packages/db/src/repositories/organization.ts`
- `packages/api/src/repositories/organization.ts`
- `packages/api/src/index.ts`
- `packages/api/src/context.ts`
- `apps/web/src/utils/orpc.ts`
- `apps/web/src/routes/onboard.tsx`
- 相关 server / DB integration tests

### 工作项

1. 将 `lockActiveOnboardingInvitation` 改为邮箱 + token hash 双重匹配并在事务内锁定。
2. 在 `getOrCreateCurrentOrganization` 的 Web → API context → API repository → DB repository 调用链中显式传递 onboarding token。
3. 保持 token 位于 URL fragment/sessionStorage；仅在机构初始化确认成功后清除。
4. 检查 server access/error logging，确保 `X-Onboarding-Token` 不进入日志。
5. 补充竞态测试：前置校验成功后 rotate，旧 token 不能领取新邀请；同 token 安全重试不会重复建机构。

### 阶段验证

- onboarding repository integration tests
- server signup / organization current tests
- `packages/db`、`packages/api`、`apps/server`、`apps/web` 相关类型检查

## Phase 2：数据模型、状态机与平台审计

### 影响文件

- `packages/db/src/schema/training/organization.ts`
- `packages/db/src/schema/index.ts`（如现有导出模式需要）
- `packages/db/src/repositories/organization-onboarding.ts`
- 新增或扩展 platform onboarding repository
- `packages/db/drizzle/*` 新 migration 与 metadata
- `packages/db/tests/organization-onboarding.integration.ts`
- `.trellis/spec/db/backend/organization-management.md`
- `.trellis/spec/db/backend/audit.md`

### 工作项

1. 添加 invitation 操作员、requestId、替代关系和 closed reason nullable 字段。
2. 新增独立 `platform_audit_event` 表及 action/source 类型。
3. 生成 additive migration，并人工审查历史重复开放记录清理 SQL。
4. 增加同邮箱未领取且未关闭记录 partial unique index。
5. 实现明确领域错误及 repository 操作：list、create、rotate、revoke。
6. create 遇到 pending 返回冲突；expired 开放记录先关闭再创建；rotate/revoke 保持事务与审计原子性。
7. requestId 重试不重复创建，也不重新返回 secret。
8. 领取事务同时写平台审计，并保留现有机构审计。

### 阶段验证

- migration 在空库与包含历史邀请的测试库上验证
- repository 集成测试覆盖状态机、唯一性、并发和事务回滚
- 检查所有 list/audit 返回中不存在 token/hash

## Phase 3：平台授权、contracts 与 router

### 影响文件

- `packages/env/src/server.ts`
- `apps/server/.env.example`
- `packages/api/src/authorization/*`（新增平台授权 provider）
- `packages/api/src/index.ts`
- `packages/api/src/contracts/platform/*`
- `packages/api/src/routers/platform/*`
- `packages/api/src/routers/index.ts`
- `packages/api/src/repositories/*`
- `apps/server/src/app.ts`
- `apps/server/src/app.test.ts`

### 工作项

1. 增加 `PLATFORM_OPERATOR_EMAILS` 服务端配置、规范化与 fail-closed 行为。
2. 实现 `PlatformAuthorizationProvider` 与 MVP env provider。
3. 增加不依赖机构上下文的 `platformProcedure`。
4. 定义 `platform.access.get` 和 onboarding list/create/rotate/revoke contracts。
5. 实现 router、领域错误到 oRPC 语义的稳定映射。
6. 对含一次性链接的响应设置 `Cache-Control: no-store`，确认跨域允许的 header 不扩散 token。
7. 增加授权矩阵、状态冲突、requestId、响应脱敏和无机构操作员测试。

### 阶段验证

- API/server tests
- 环境变量缺失、空白名单、大小写/空格规范化测试
- 检查普通机构 owner/admin 无法调用平台过程

## Phase 4：独立 Web 管理入口

### 影响文件

- `apps/web/src/routes/platform/*`
- `apps/web/src/routeTree.gen.ts`（由现有生成流程更新）
- `apps/web/src/routes/login.tsx`
- `apps/web/src/components/sign-in-form.tsx`（按实际登录导航实现定位）
- `apps/web/src/routes/_auth/route.tsx` 或现有用户菜单组件
- `apps/web/src/utils/orpc.ts`
- 平台 onboarding 页面拆分出的局部组件/hooks

### 工作项

1. 创建独立 platform 认证布局，不加载/创建当前机构。
2. 增加受限站内 return target 登录恢复，拒绝外部 URL。
3. 通过 `platform.access.get` 控制“平台管理”入口展示；失败默认隐藏。
4. 实现列表、状态筛选、邮箱搜索、分页和状态摘要。
5. 实现创建、rotate 二次确认、revoke 二次确认。
6. 一次性链接只存在于当前 mutation 成功对话框；关闭即 reset，并提供复制反馈。
7. 完成加载、空态、错误态、提交中、防重复提交和移动端适配。

### 阶段验证

- Web 类型检查与生产构建
- 浏览器实际验证授权用户、非授权用户和未登录跳转
- 桌面与移动端截图检查
- 刷新、关闭对话框、列表重取后无法恢复历史链接

## Phase 5：紧急脚本、文档与上线准备

### 影响文件

- `ops/onboarding/create-onboarding-link.sh`
- `ops/onboarding/README.md` 或实际 onboarding 运维文档
- 根/部署环境变量文档（按仓库现有位置）
- `.trellis/spec/*` 中形成稳定约定的相关章节

### 工作项

1. 更新 break-glass 脚本：默认 create 冲突、显式 `--rotate`、关闭过期开放记录、写平台审计。
2. 确认脚本与 Web 使用相同的 7 天、邮箱规范化和状态约束。
3. 文档化白名单配置、邮箱验证要求、migration 顺序、一次性链接处理、脚本权限和回滚步骤。
4. 记录从 env provider 向数据库平台操作员 provider 的后续迁移边界，但不在本任务实现完整 RBAC。
5. 运行 `trellis-update-spec`，只沉淀稳定且可复用的新约束。

## 最终质量门禁

按风险从窄到宽执行：

1. 相关 package 类型检查。
2. onboarding repository / server 定向测试。
3. 数据库 integration tests（含 migration 与并发场景）。
4. `pnpm check-types`。
5. `pnpm check`。
6. `pnpm build`。
7. 浏览器桌面/移动端关键路径验证。
8. 安全复核：服务端授权、跨租户边界、token/hash 泄漏、开放重定向、secret 缓存、脚本旁路。

若集成测试需要本地 PostgreSQL/Docker 而环境不可用，必须明确记录未执行项与准确命令，不得将其表述为已通过。

## 完成定义

- `prd.md` 中所有验收项均有实现或测试证据。
- 代码、migration、脚本与文档对 create/rotate/revoke 语义一致。
- 旧 `/onboard` 邀请可用，旧 token 无法在 rotate 后领取新邀请。
- 平台操作员即使不属于任何机构也能操作；普通机构 owner/admin 无平台权限。
- 一次性链接无法通过列表、日志、审计、缓存或重试恢复。
- 发布与回滚步骤在 staging 或等价本地流程完成验证。
