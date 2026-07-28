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
  api/       oRPC router、共享业务契约和 PostgreSQL 业务仓储适配
  auth/      Better Auth 配置
  db/        Drizzle schema、数据库脚本和 Docker Compose
  env/       服务端与客户端环境变量校验
  mail/      腾讯云 SES 邮件发送封装
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

认证安全相关服务端变量：

- `AUTH_RATE_LIMIT_WINDOW_SECONDS` / `AUTH_RATE_LIMIT_MAX`：Better Auth 全局请求限流窗口与上限。
- `AUTH_SENSITIVE_RATE_LIMIT_WINDOW_SECONDS` / `AUTH_SENSITIVE_RATE_LIMIT_MAX`：登录、注册、改密和密码重置等敏感端点的更严格限流。
- `AUTH_PASSWORD_MIN_LENGTH` / `AUTH_PASSWORD_MAX_LENGTH`：邮箱密码注册、改密和重置密码的服务端长度策略。

当前限流使用 Better Auth 内存存储，适合单实例部署和本地验证；多实例生产环境应接入共享的 secondary storage 或数据库存储后再按流量调参。

生产试运行相关服务端变量：

- `DATABASE_POOL_MAX` / `DATABASE_POOL_IDLE_TIMEOUT_MS` / `DATABASE_POOL_CONNECTION_TIMEOUT_MS` / `DATABASE_STATEMENT_TIMEOUT_MS`：PostgreSQL 连接池与语句超时；单机试运行建议保持默认或按内存余量下调 `DATABASE_POOL_MAX`。
- `ALLOW_PUBLIC_SIGNUP`：是否允许公开注册。本地开发可设为 `true`；生产试运行应设为 `false`。既有机构成员只能通过邀请链接注册；新机构必须使用平台签发的受控 onboarding 邀请链接开通，不能依赖公开注册初始化。
- `SHUTDOWN_TIMEOUT_MS`：收到 SIGTERM/SIGINT 后等待在途请求完成的最长时间。

Web 端需同步设置 `VITE_ALLOW_PUBLIC_SIGNUP`，与 `ALLOW_PUBLIC_SIGNUP` 保持一致。

邮件服务（腾讯云 SES，Issue #59）：

- `EMAIL_ENABLED`：是否启用发信。本地开发与 CI 保持 `false`；生产设为 `true` 并补齐下方密钥。
- `APP_PUBLIC_NAME`：邮件标题与应用名展示，默认 `Easy Training`。
- `TENCENT_SES_SECRET_ID` / `TENCENT_SES_SECRET_KEY`：腾讯云 API 密钥。
- `TENCENT_SES_REGION`：`ap-guangzhou` 或 `ap-hongkong`。
- `TENCENT_SES_FROM_ADDRESS`：已验证发信地址，格式如 `Easy Training <noreply@yourdomain.com>`。
- `TENCENT_SES_TEMPLATE_ID_PASSWORD_RESET` / `TENCENT_SES_TEMPLATE_ID_INVITATION` / `TENCENT_SES_TEMPLATE_ID_EMAIL_VERIFICATION`（可选）：控制台模板 ID。未配置时使用 Simple HTML/Text 发信。
- 模板内的超链接必须保留静态域名和域名后的 `/`；创建脚本会以运行时的 `CORS_ORIGIN` 写入 `https://域名/{{linkPath}}`，发送时仅传不带前导 `/` 的路径、查询参数和 hash，避免腾讯云 SES 拒绝“变量填充完整链接”。
- 密码重置模板变量：`appName`、`userName`、`linkPath`。
- 邀请模板变量：`appName`、`organizationName`、`role`、`linkPath`。
- 邮箱验证模板变量：`appName`、`userName`、`linkPath`。
- 发信失败会写入结构化日志（`email.failed`），不会阻塞邀请创建、注册或密码重置请求。

腾讯云账户默认可能未开通自定义（Simple）发送权限，此时发信会返回「未开通自定义发送权限，必须使用模版发送」。可用脚本一次性创建三个模板并把返回的 ID 填入上述变量：

```bash
cd apps/server && pnpm exec tsx ../../packages/mail/scripts/create-templates.ts
```

脚本按模板名安全处理：不存在时创建；仅当同名模板处于“审核拒绝”状态时更新内容并重新提交审核；已通过和审核中的模板只输出状态。因此可直接修复审核拒绝的同名模板，不需要删除模板或更换环境变量中的模板 ID。新建或更新模板需经腾讯云人工审核，审核期间发信会返回「模板ID无效或者不可用」。用以下脚本查看审核状态；附带收件邮箱参数时会真实发送三封测试邮件：

```bash
cd apps/server && pnpm exec tsx ../../packages/mail/scripts/smoke.ts
cd apps/server && pnpm exec tsx ../../packages/mail/scripts/smoke.ts you@example.com
```

邮箱验证在注册时自动发送（`sendOnSignUp`）。既有机构邀请领取前必须完成邮箱验证；新机构 onboarding 则由平台签发的、与目标邮箱绑定的开通 token 授权。

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

首次使用可在登录页创建本地管理员账号（需 `ALLOW_PUBLIC_SIGNUP=true`）。

## 常用命令

```bash
pnpm dev          # 启动全部应用
pnpm dev:web      # 仅启动 Web
pnpm dev:server   # 仅启动 API
pnpm build        # 构建全部应用和包
pnpm check-types  # 全仓类型检查
pnpm test:integration # 运行 PostgreSQL 机构隔离与工作台集成测试
pnpm check        # Biome 只读检查
pnpm check:fix    # 自动修复可安全处理的格式与 lint 问题
pnpm db:generate  # 生成 Drizzle migration
pnpm db:migrate   # 执行 migration
pnpm db:studio    # 打开 Drizzle Studio
```

## 数据库发布与恢复 Runbook

### 本地开发与生产迁移的边界

本地 Docker 数据库可用以下命令初始化；`db:push` 会直接将当前 schema 推送到数据库，仅适用于可丢弃的本地开发数据，**不得**用于 CI、预发或生产环境：

```bash
pnpm db:start
pnpm db:push
```

生产环境只能应用已提交、已审查的 Drizzle migration。根目录的 `pnpm db:migrate` 会经过 Turbo，当前被配置为持久任务；发布执行器应从受控的 release checkout 直接调用数据库包脚本：

```bash
# DATABASE_URL 由部署时的密钥管理系统注入，不能写入命令历史或仓库。
pnpm --filter @easy-training/db db:migrate
```

不要在生产服务器生成 migration，也不要编辑已发布的 migration 文件。每个 schema 变更必须随应用版本提交新的 migration，并先在与生产兼容的环境中完成迁移和回归验证。

### 子表租户边界决策

`attendance`、`studentContact`、`teacherCampus` 暂不直接增加 `organizationId`。这些表的租户归属分别来自 `lesson`、`student`、`teacher`/`campus`，直接加列需要 expand/backfill/dual-read-or-write/contract 多阶段兼容发布，当前阶段先采用强制 repository 边界、父表 join 机构条件和非破坏性索引兜底。`makeupLesson` 已包含 `organizationId`，列表和详情查询必须继续把它作为第一查询边界。

代码审查时按以下清单检查子表查询：

- 查询 `attendance` 必须先锁定或校验所属 `lesson`，或 join `lesson` 并限制 `lesson.organizationId`；不能只凭 `attendance.id`、`lessonId` 或 `studentId` 返回业务数据。
- 查询 `studentContact` 必须 join `student` 并限制 `student.organizationId`；手机号查重不能使用 `studentContact.phoneNormalized` 做全局判重。
- 查询 `teacherCampus` 必须通过 `teacher` 与 `campus` 绑定机构和校区范围；不能只凭 `teacherId` 或 `campusId` 返回机构级业务数据。
- 查询 `makeupLesson` 必须带 `organizationId`，涉及同一 requestId 重放时还要重新校验关联班级、课次和校区权限。
- 后续若为子表补 `organizationId`，必须拆成 expand/backfill/dual-read-or-write/contract 发布，不得和应用回滚绑定执行破坏性回退。

### 生产发布前置条件

发布负责人必须在开始前逐项确认。以下是当前试运行状态：备份、恢复演练、主机资源
告警、基础外部拨测、就绪探针、TLS、应用日志监控、应用异常事件和备份健康告警已有
生产执行记录；2026-07-28 已完成一次不写入业务数据的受控生产冒烟，当前证据见
`ops/deploy/README.md`。后续发布仍须按本节逐项复核，不能以首次验收替代持续检查。

- 外部备份存储已启用加密、访问控制与保留策略，生产数据库备份已成功上传；当前证据和保留策略见 `ops/backup/README.md`，备份位置和对象标识不能提交到仓库。
- 发布器具有最小权限的数据库迁移凭据、应用部署/流量切换权限，以及从密钥管理系统注入 `DATABASE_URL` 的方式；不得使用开发数据库或个人凭据。
- 已确定试运行期 RPO ≤ 24 小时，并记录当前数据量下实测 RTO；数据量上升后需重新评估 WAL 归档和演练频率。
- 已完成一次网络、凭据和外部副作用均与生产隔离的恢复演练；后续变更恢复流程、备份配置或达到演练周期时仍必须重复演练。
- 本次 migration 已完成代码审查、在预发/隔离数据库验证，并确认锁表、长事务、数据回填、磁盘容量及兼容发布顺序的影响；应用构建产物和上一稳定版本均可取得。

### 受控发布与备份步骤

1. 记录发布版本、待执行 migration、当前应用版本和开始时间；确认应用具备与新旧 schema 同时工作的兼容窗口。对破坏性变更采用 expand/contract 多次发布，不与代码回滚绑定执行。
2. 将应用切入维护/只读模式或暂停写流量，避免备份与 schema 变更期间出现未记录的并发写入；具体流量控制由部署平台负责。
3. 使用生产数据库的只读备份凭据创建一致性 dump，并上传至上述外部备份存储。以下命令仅是受控发布器中的示例，变量必须由密钥管理系统和发布流程提供：

   ```bash
   pg_dump --format=custom --no-owner --no-privileges \
     --file "$BACKUP_FILE" "$DATABASE_URL"
   pg_restore --list "$BACKUP_FILE"
   ```

4. 记录备份对象标识、校验值、完成时间和对应发布版本；确认其满足已批准的 RPO。上传失败、校验失败或无法定位备份时停止发布并恢复写流量。
5. 在受控 release checkout 中注入迁移凭据，执行 `pnpm --filter @easy-training/db db:migrate`。命令失败时停止后续发布，不重复盲目执行，也不使用 `db:push` 修复。
6. 部署兼容应用版本，执行平台的 readiness/关键业务冒烟检查，确认错误率、结构化日志和数据库连接正常后再逐步恢复流量；保留发布与备份记录以支持追溯。

### 隔离恢复验证

每次变更恢复流程、备份配置或按已批准的演练周期，都应在隔离环境演练；尚未完成演练不能声称已经验证可恢复。

1. 创建与生产网络、数据库、密钥和外部副作用隔离的临时数据库，确认其 `DATABASE_URL` 不指向生产。
2. 从外部备份存储取得指定备份，并恢复到该临时数据库；使用该环境的权限和目标库执行 `pg_restore`，不在生产库上测试恢复命令。
3. 使用与备份对应的应用版本启动隔离实例，核对 migration 记录、关键表/行数抽样、机构隔离以及关键读写流程；再检查 `/readyz` 与应用日志。
4. 记录实际恢复耗时、数据恢复点、失败项和清理结果，与 RPO/RTO 比对。未达到目标时调整备份或运行步骤，并在下次发布前重新演练。

### 应用回滚与 schema 回退限制

若发布后出现应用故障，优先将流量切回上一稳定且仍兼容当前 schema 的应用版本，再暂停问题版本的写入和进一步 migration。确认健康检查、错误率和关键业务路径稳定后再决定修复发布。

Drizzle migration 在本项目中是向前应用的流程，`db:migrate` 不提供可安全自动执行的生产“down”操作。已应用的 schema 不能因为应用回滚而直接回退；尤其不得删除 migration 记录、手工改元数据表或以 `db:push` 覆盖生产 schema。确需 schema 回退时，必须同时满足以下条件：

- 已审查独立的逆向 migration 或恢复方案，并在隔离环境用生产副本验证；
- 已确认数据兼容性、可能的数据丢失、锁表时间和对仍在运行应用版本的影响；
- 已有本次迁移前可定位且可验证的备份，并获得负责人的明确恢复/回退批准。

无法满足这些条件时，保持 schema 向前兼容，发布修复应用或新的补偿 migration；不要在生产环境临场设计回退 SQL。

### 告警接入与恢复演练证据

服务端会输出带 `requestId` 的 `http.access` 和 `http.unexpected_error` JSON 事件，
并提供 `/readyz` 作为数据库就绪探针。腾讯云云监控已完成主机 CPU、内存和磁盘告警
短信演练；`/readyz`、TLS、证书到期和应用日志外部拨测已配置。备份健康端点
`/backup-healthz` 已完成腾讯云拨测和短信、邮件双通道真实告警与恢复演练；
`/readyz`、TLS 和应用异常事件也已完成真实告警与恢复演练。生产责任人与证据位置见
`ops/deploy/README.md`，Issue #23 作为状态索引。

最小告警策略如下：

- 对 `event = "http.unexpected_error"` 告警；按 `environment + service + event` 聚合，避免以每个 `requestId` 单独触发通知。通知须包含时间窗口、事件数量、一个样例 `requestId`，以及用该 ID 查询对应访问日志的方式。
- 对 `/readyz` 连续两次探测失败告警；探测频率、阈值和通知升级规则由部署平台配置并记录。
- 4xx 业务或鉴权错误不应触发基础故障告警。要为具体业务事务建立告警时，先定义稳定事件名、脱敏字段、阈值和负责人，不能以原始异常或请求体作为通知内容。

每次隔离恢复演练必须保留以下记录；未填完整记录不得宣称恢复能力已经验证：

| 字段 | 记录内容 |
| --- | --- |
| 演练时间、操作者、审批人 | 使用的隔离环境与授权人，不记录凭据 |
| 备份证据 | 备份对象标识、校验值、对应应用版本和数据恢复点 |
| 恢复结果 | `pg_restore` 结果、migration 状态、关键表/机构隔离抽样和 `/readyz` 检查 |
| RPO / RTO | 已批准目标、实际恢复点和实际耗时，以及是否达标 |
| 后续动作 | 发现的问题、责任人、截止时间和下次演练日期 |

应用异常事件已完成真实投递验证；备份、首次隔离恢复、备份健康、就绪探针、TLS 和
应用异常告警证据已记录在 `ops/backup/README.md` 与 `ops/deploy/README.md`，
后续证据继续回链 Issue #23。

## Trellis AI 开发工作流

仓库已使用 Trellis `0.6.7` 管理 Codex 的项目规范、任务上下文和跨会话记录。核心入口如下：

- `AGENTS.md`：AI 助手入口。
- `.trellis/spec/`：项目级与 workspace 级工程规范。
- `.trellis/tasks/`：任务 PRD、设计、执行计划和归档。
- `.trellis/workspace/`：按开发者维护的会话记录。
- `.codex/`、`.agents/skills/`：Codex Hooks、代理和 Trellis skills。

当前只集成 Codex，并由主代理采用 inline 模式实现。`session_auto_commit: true` 仅允许 Trellis 在任务归档和会话记录时自动提交其管理的 task/journal 文件；业务代码仍需经过检查和明确批准后提交。

首次在新的开发环境使用时，确保 Node.js >= 18、Python >= 3.9，并初始化个人身份：

```bash
python3 ./.trellis/scripts/init_developer.py <your-name>
```

如需更新 Trellis 生成文件，使用仓库当前固定版本并先审查 diff：

```bash
pnpm dlx @mindfoldhq/trellis@0.6.7 update --codex
```

Codex 自动注入工作流状态还需要在用户级 `~/.codex/config.toml` 启用 Hooks，并在 Codex 中执行一次 `/hooks` 审批项目 Hook：

```toml
[features]
hooks = true
```

用户级 Codex 配置不属于仓库，本项目不会自动修改。

## 当前数据边界

认证数据和教培领域 schema 已接入 PostgreSQL。生产环境关闭公开注册：既有机构通过受邀邮箱加入，新机构通过平台签发的 onboarding 邀请链接创建并成为 `owner`；本地开发仍可显式开启公开注册。后续业务接口只使用服务端解析出的机构上下文，不接受客户端传入的机构 ID。

机构上下文解析区分读写路径：稳态只读 RPC 通过普通查询读取当前 session、成员关系与校区范围，不持有用户级 advisory lock；首次受控 onboarding 建机构、修正 session 当前机构或补齐历史初始化标记时才进入加锁事务。领域写入仍必须在各自 repository 事务内重新读取成员角色与校区范围，并保留机构级锁或行锁防止 TOCTOU。

招生线索已使用真实 PostgreSQL 数据，支持列表、搜索、阶段筛选、新增、编辑和阶段流转。线索读取与写入仅允许 `owner`、`admin`、`campus_manager`、`consultant`，并按当前机构隔离；`teacher`、`finance` 无权访问线索隐私数据。

运营工作台已迁移为机构维度的 PostgreSQL 聚合查询，只返回待跟进线索、学员与报名计数、活跃班级、当日待办、未来 7 日课次和待收款摘要。金额接口统一使用“分”，时间统计暂按 `Asia/Shanghai` 自然日计算；线索和财务数据会按成员角色裁剪，不向无权限角色返回明细。

学员与报名已支持独立建档报名、入班、冻结/复课、转班/退班、联系人查重合并，以及报名、账单、收款、考勤和课消的完整业务时间线。所有写入继续按机构、角色和校区范围授权，跨表业务动作使用事务、幂等或并发保护。

教务已支持单次与每周周期排课、冲突预览、批量生成、未来课次调课/换教师/换教室、教室容量、班级停复课和补课；教师账号可显式绑定成员，并在个人工作台保存点名草稿、完成课次和记录教学小结。

财务已支持报名/续费自动账单、手工开单、受控账单调整、收款、退款审批、不可变收款冲正、欠费周期与跟进状态，以及机构内唯一编号的收款凭证开具、作废、补开和浏览器打印/PDF。退款、冲正和凭证不会静默改写既有资金事实，相关关键操作保留机构审计。

前端金额输入统一使用 `finance-form-utils.ts` 解析人民币金额：报名、线索转化和续费允许 0 元应收但最高不超过 1,000,000 元；收款、退款、冲正、手工开单和账单金额调整要求大于 0 元，并使用相同上限与最多两位小数规则。

当前仍未覆盖隔周/自定义间隔和节假日例外排课、附件档案、在线支付与自动对账、完整
外部通知、家长端、原生教师移动端。生产运行方面，备份/隔离恢复演练、主机资源告警、
基础拨测、就绪探针、TLS、应用日志监控、应用异常事件、备份健康告警和首次只读生产
冒烟已有记录。容量性能验收和多实例共享限流尚未完成，因此试运行仍限定为单实例、
受邀制和少量真实机构，不承诺规模化容量或 SLA。

本地联调时请统一使用 `http://localhost:3001` 访问 Web。服务端会严格校验带 Cookie 的 RPC 请求来源与 `CORS_ORIGIN`，使用 `127.0.0.1` 和 `localhost` 混用会被浏览器视为不同来源。
