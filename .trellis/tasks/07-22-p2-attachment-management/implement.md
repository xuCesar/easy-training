# 实施计划

## 1. 共享存储与本地基础设施

- [ ] 新建纯服务端 `packages/object-storage`，定义 `PrivateObjectStore`、S3/MinIO 适配器、受控错误和依赖注入测试替身；仅引入完成 S3 兼容私有对象读写所需依赖。
- [ ] 扩展服务端环境变量及 `.env.example`，实现 `ATTACHMENTS_ENABLED` 和存储/ClamAV 配置的 fail-closed 能力诊断，确保任何凭证不进入 Web bundle 或日志。
- [ ] 增加独立本地 Docker Compose 与脚本，提供 MinIO 私有桶初始化和 ClamAV；保留现有 PostgreSQL `db:start` 的轻量行为。

## 2. Schema、迁移与领域状态机

- [ ] 新增 attachment/link/access grant/event/job enum、表、FK、CHECK、机构索引、幂等唯一约束和租约索引；生成并审查 additive migration。
- [ ] 实现一附件一实体的判别联合与数据库恰一外键约束，覆盖 lead/student/enrollment/invoice/payment/receiptDocument 的机构一致性。
- [ ] 实现状态/version 条件更新、append-only 事件、requestId+inputHash 幂等和对象删除独立事实，禁止未知状态跃迁。

## 3. 权限、元数据 API 与审计

- [ ] 实现穷举式目标授权器，事务内重读当前成员、角色和校区；复用现有招生、学员/报名和财务权限语义，统一隐藏不存在与越权资源。
- [ ] 增加 capability、关联列表、初始化上传、创建访问授权、重试扫描和归档的 Zod/oRPC 契约、repository、router 与结构化错误映射。
- [ ] 扩展中央审计 action 和 Web 审计标签；审计白名单不得包含文件名、说明、对象键、病毒详情或内容。

## 4. 流式上传与访问

- [ ] 在 Hono 增加独立文件流路由，复用 Better Auth、当前机构解析、可信 Origin、请求 ID 和结构化日志；不经过 `/rpc/*` body limit，也不把业务 SQL 写进路由。
- [ ] 实现单次上传 grant：安全文件名、扩展名/MIME/声明大小/SHA-256 校验，流式 10 MiB 限制、实际哈希和 magic signature 检查，只写 quarantine。
- [ ] 实现图片预览/PDF 下载 grant：每次请求重验当前 session、用户、机构、校区、实体权限和 available 状态，支持安全 Range、Content-Disposition、nosniff 与 no-store。
- [ ] 覆盖上传中断、超限、哈希不符、伪扩展/MIME、对象写入失败和重复 grant，确保不会留下可访问对象或重复业务关系。

## 5. 扫描、重试与清理 worker

- [ ] 实现 ClamAV `INSTREAM` 受限适配器和超时/结果错误码；扫描器无对象存储凭证。
- [ ] 实现 scan/delete 持久任务的多实例租约、指数退避、dead/scan_failed、手动重试与条件完成，沿用 operation task reminder 的成熟算法但不抽象通用队列。
- [ ] 扫描通过时幂等复制到 clean key、事务切换 available、删除 quarantine；命中风险、结构不符或扫描失败始终保持不可访问。
- [ ] 实现 24 小时未完成/拒绝、7 天扫描失败、30 天人工归档清理，并把 `NoSuchKey` 视为幂等成功；添加结构化 worker 日志。
- [ ] 增加独立 worker 启动装配和停用开关；核心 `/readyz` 不因 ClamAV 短暂不可用而整体失败。

## 6. Web 业务接入

- [ ] 在 `apps/web/src/features/training` 实现可复用 `AttachmentPanel`，复用 `packages/ui` 现有 attachment 基础组件，覆盖上传进度、待扫描、扫描中、失败重试、拒绝、预览/下载、归档和错误状态。
- [ ] 文件 SHA-256 使用不阻塞主线程的浏览器路径；文件变化生成新 requestId，网络重试保留同一 requestId 和 grant 语义。
- [ ] 接入线索、学员、报名、账单、收款和凭证详情；只在当前目标权限允许时展示操作，不提供机构级附件总表。
- [ ] JPEG/PNG 使用受控图片预览，PDF 仅触发下载；完成桌面和 390px 单列布局、键盘焦点、取消/失败和空态验证。

## 7. 测试与质量门

- [ ] PostgreSQL 集成测试覆盖 migration、状态图、版本、requestId 重放/冲突、一附件一实体 FK/CHECK、事件、审计和所有保留期限。
- [ ] 权限测试覆盖六类目标、全部角色、跨机构、跨校区、成员撤权、归档、过期/他人 grant，并断言不存在与越权响应等价。
- [ ] 存储/扫描契约测试覆盖 MinIO 兼容读写、Range、超限、SHA 不符、伪类型、截断内容、EICAR、扫描超时/失败、copy/delete 崩溃点和 `NoSuchKey`。
- [ ] worker 测试覆盖并发租约、租约过期恢复、重复任务、退避、手动重试、对象清理和日志不含敏感值。
- [ ] server 应用测试覆盖可信 Origin、Cookie/机构头、独立 body limit、安全响应头、受控文件名和核心 readiness 降级边界。
- [ ] 运行 `pnpm db:generate`、审查 migration、执行 `pnpm db:migrate`、相关/全量集成测试、`pnpm check-types`、`pnpm check`、`pnpm build` 与 `git diff --check`。
- [ ] 真实浏览器验证桌面/390px 的上传、处理中、重试、拒绝、图片预览、PDF 下载、归档、撤权和无横向溢出。

## 8. 审查门与回滚点

- [ ] 开放上传前确认私有桶、对象键无业务信息、生产扫描器配置、quarantine 不可访问和 capability fail closed。
- [ ] 开放访问前确认每次文件请求重新授权、PDF 不内联、响应头无注入、旧/他人 grant 无法读取。
- [ ] 开放 worker 前确认跨数据库/S3 崩溃点均可重放，不会把未扫描对象标记 available 或提前删除唯一对象。
- [ ] 审查新增依赖的用途、生产体积和安全维护成本，不为首期引入通用队列、公开 CDN 或第二套权限模型。
- [ ] 回滚只关闭 UI、上传/授权生成和 worker；保留 schema、元数据、事件、审计和私有对象，禁止逆向删除事实。
