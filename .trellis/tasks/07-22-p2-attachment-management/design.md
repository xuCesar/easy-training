# 技术设计

## 1. 架构边界

附件能力拆为四层，不把业务授权或文件字节塞进现有 oRPC JSON 通道：

- `packages/object-storage`：新增纯服务端共享包，封装私有 S3 兼容对象的写入、读取、复制、查询和幂等删除；只识别对象键，不感知机构、用户或业务实体。
- `packages/db`：保存附件元数据、唯一业务关联、短时授权哈希、不可变事件和扫描/清理任务；负责事务、幂等、租约、状态版本、机构隔离和审计。
- `packages/api`：定义 Zod/oRPC 元数据契约、穷举式目标授权器和错误映射；创建上传/访问授权、列出关联附件、重试扫描和归档。
- `apps/server`：装配 Cookie 鉴权、可信 Origin、原始字节流 HTTP 入口、对象存储和 ClamAV 适配器，并启动附件 worker。业务权限判断仍调用 `packages/api` / `packages/db`，不复制进 Hono 路由。

现有 `/rpc/*` 保持 256 KiB 导入请求上限。文件流使用独立路径，不经过 oRPC/OpenAPI body parser：

- `POST /attachments/uploads/:grant`：原始文件流上传；必须带当前 session、可信 Origin 和当前机构头。
- `GET /attachments/access/:grant`：图片预览或文件下载；必须带当前 session 和当前机构头。

首期不使用浏览器直传或 S3 预签名 URL。10 MiB 上限使服务端代理成本可控，并满足对象键隐藏、每次访问重新授权和撤权立即生效。

## 2. 对象存储与环境配置

`PrivateObjectStore` 只暴露最小接口：

```ts
type PrivateObjectStore = {
	putObject(input: { key: string; body: Readable; contentLength?: number }): Promise<void>;
	headObject(key: string): Promise<{ size: number; contentType?: string } | null>;
	getObject(key: string, range?: string): Promise<ObjectStreamResult>;
	copyObject(input: { sourceKey: string; targetKey: string }): Promise<void>;
	deleteObject(key: string): Promise<void>;
};
```

对象键由服务端随机生成，使用 `quarantine/<uuid>` 与 `clean/<uuid>` 两个前缀，不包含机构名、学员名、原始文件名或业务 ID。桶保持私有，禁止公共 ACL 和公开网站配置。扫描器只接收字节流，不持有对象存储凭证。

新增服务端配置：

- `ATTACHMENTS_ENABLED`
- `S3_ENDPOINT`、`S3_REGION`、`S3_BUCKET`
- `S3_ACCESS_KEY_ID`、`S3_SECRET_ACCESS_KEY`
- `S3_FORCE_PATH_STYLE`
- `CLAMAV_HOST`、`CLAMAV_PORT`

`ATTACHMENTS_ENABLED=false` 时元数据读取可保持兼容，但创建上传授权返回稳定的功能不可用错误。启用时配置必须完整；生产缺少存储或扫描器配置时附件能力 fail closed，但 `/readyz` 不因扫描器短暂故障拖垮核心业务。能力状态和 worker 错误使用结构化日志，不记录凭证、文件名或内容。

本地新增独立 Docker Compose，提供 MinIO 初始化后的私有桶与 ClamAV；避免把资源较重的扫描器强塞进仅启动 PostgreSQL 的 `db:start`。测试通过依赖注入使用内存对象存储和受控扫描器，不依赖本机 Docker。

## 3. 数据模型与迁移

新增 additive schema：

### `attachment`

- `id`、`organizationId`、`campusId`
- `originalFileName`、可空 `description`
- `declaredMimeType`、可空 `detectedMimeType`
- `declaredSize`、可空 `actualSize`
- `declaredSha256`、可空 `actualSha256`
- 可空 `quarantineObjectKey`、`cleanObjectKey`
- `status`：`pending_upload | scan_pending | scanning | available | scan_failed | rejected | archived`
- `version`、可空 `failureCode`
- `uploadedByUserId`、`createdAt`、`updatedAt`
- 可空 `uploadedAt`、`availableAt`、`archivedAt`、`objectDeleteAfter`、`objectDeletedAt`
- `requestId`、`inputHash`；`(organizationId, requestId)` 唯一

对象删除事实与业务状态分离：归档、拒绝或超时先设置 `objectDeleteAfter`，实际删除成功后写 `objectDeletedAt`。元数据和审计不随对象清理删除。

### `attachment_link`

- `attachmentId` 同时作为主键和唯一关系，保证一附件一实体。
- `organizationId` 及六个可空外键：`leadId | studentId | enrollmentId | invoiceId | paymentId | receiptDocumentId`。
- CHECK 保证六个目标恰好一个非空；公开 API 使用对应判别联合，不接受任意字符串实体类型。

### `attachment_access_grant`

- `tokenHash` 唯一，数据库不保存明文授权 ID。
- `organizationId`、`attachmentId`、`userId`、`kind=upload|preview|download`、`expiresAt`、可空 `consumedAt`、`createdAt`。
- 上传授权单次成功消费；预览/下载授权在极短期限内可重试，但每次仍校验当前 session、用户、机构、附件状态和目标权限。

### `attachment_event`

不可变记录 `upload_completed | scan_started | scan_passed | scan_failed | rejected | retry_requested | archived | object_deleted | object_delete_failed`，保存附件/状态/错误码/操作者或 worker、时间，不复制文件名、说明或内容。

### `attachment_job`

- `kind=scan|delete`、`attachmentId`、`status=pending|leased|completed|dead`
- `availableAt`、`attemptCount`、`leaseToken`、`leaseExpiresAt`、可空错误码/摘要
- 每个附件和任务类型最多一个非终态任务；使用与运营任务提醒相同的 `FOR UPDATE SKIP LOCKED`、租约和条件更新模式。

新增中央审计 action：`attachment_upload_completed`、`attachment_access_granted`、`attachment_archived`。扫描、重试和对象清理由 `attachment_event` 追踪，避免中央审计高频噪声。审计白名单只包含附件 ID、目标类型/ID、状态、操作者、校区和授权类型。

## 4. 类型校验、上传和扫描状态机

创建上传授权时校验：

- 原始文件名规范化后长度受限，拒绝路径分隔符、控制字符和双扩展伪装。
- 扩展名仅 `.pdf/.jpg/.jpeg/.png`，声明 MIME 仅 `application/pdf/image/jpeg/image/png`，二者必须匹配。
- 声明大小为 1～10 MiB，SHA-256 为 64 位十六进制。
- 目标实体存在且操作者拥有 attach 权限。

上传流执行：

1. 锁定并消费有效上传授权，重验 session、当前机构和目标权限。
2. 流式限制实际字节数，超过 10 MiB 立即中止；同步计算 SHA-256 并缓存有限头部用于 PDF/JPEG/PNG signature 检查。
3. 只写入 quarantine 对象；传输完成后比较声明/实际大小、SHA-256、扩展名、声明 MIME 和检测类型。
4. 任一不一致将附件置为 `rejected`、写事件并安排 24 小时内清理；成功则置为 `scan_pending` 并创建 scan job。
5. 代理上传自身即为完成确认，不再信任客户端另发的“上传完成”声明。

扫描 worker：

1. 租约领取 `scan` job，将附件从 `scan_pending` 条件更新为 `scanning`。
2. 从 quarantine 流式读取并再次执行大小、SHA-256 和真实类型检查，然后使用 ClamAV `INSTREAM` 扫描；设置连接、读取和总扫描超时。
3. 命中恶意内容或类型不符时置为 `rejected`，立即禁止访问并安排 24 小时清理。
4. 扫描器故障或超时按指数退避重试；达到上限置为 `scan_failed`，隔离对象保留 7 天，可由有 attach 权限的用户手动重试。
5. 通过后复制为随机 clean key，事务内把附件切换到 `available` 并写事件，再幂等删除 quarantine 对象。copy、状态切换和源删除均允许崩溃后安全重放。

PDF 因首期不内联预览，只做完整字节、类型和恶意文件扫描后以 `attachment` 下载；浏览器不能通过本系统内联执行 PDF 主动内容。JPEG/PNG 只有 `available` 时可内联预览。

## 5. 目标授权与防泄露

实现穷举式 `authorizeAttachmentTarget`：

```ts
authorizeAttachmentTarget({
	target,
	operation: "read" | "attach" | "archive",
	organizationId,
	userId,
});
```

每次从数据库重读当前成员角色和校区范围，并按目标复用现有领域语义：

- lead：owner/admin/campus_manager/consultant，按线索校区。
- student/enrollment：owner/admin/campus_manager/consultant，按学员校区。
- invoice/payment/receiptDocument：owner/admin/campus_manager/finance，按财务记录所属学员校区。

consultant 延续现有产品权限：可操作其有权校区的线索、学员和报名，不另加“仅本人负责”规则。附件模块不提供机构级全部文件列表，也不通过一个模块权限放宽目标领域权限。

目标不存在、附件不存在、跨机构、校区越权和角色无权对外统一为 `NOT_FOUND`，响应时间和正文不返回可用于判断资源存在性的差异。访问 grant 绑定用户且不是独立 bearer credential；token 泄漏给另一 session 无效。

## 6. 读取、响应和 UI

oRPC 提供：

- `attachments.capability`：上传是否可用及受控错误码。
- `attachments.list({ target })`
- `attachments.initiateUpload({ target, fileName, mimeType, size, sha256, requestId, description? })`
- `attachments.createAccessGrant({ attachmentId, disposition })`
- `attachments.retryScan({ attachmentId, expectedVersion })`
- `attachments.archive({ attachmentId, expectedVersion, requestId })`

文件响应：

- `X-Content-Type-Options: nosniff`
- `Cache-Control: private, no-store`
- RFC 5987 安全文件名；移除 CR/LF、路径和控制字符
- JPEG/PNG preview 使用受控 `Content-Type` 与 `inline`
- PDF 和显式下载统一 `Content-Disposition: attachment`
- 支持合法 Range；对象不存在或存储失败不泄露对象键

Web 在现有业务详情中复用一个 `AttachmentPanel`，由目标判别联合驱动。首期接入线索、学员、报名、账单、收款和凭证详情，不建立全局附件页面。状态覆盖选择文件、哈希计算、上传进度、待扫描、扫描中、失败可重试、已拒绝、可预览/下载、归档和下载失败；哈希在 Web Worker 或增量异步路径计算，避免 10 MiB 文件阻塞主线程。移动端为单列列表，图片预览用受控对话框。

## 7. 清理、幂等和可观测性

- `pending_upload` 超过 24 小时归档并清理可能存在的 quarantine 对象。
- `rejected` 在 24 小时内清理。
- `scan_failed` 保留 7 天供重试，期限后归档并清理。
- 人工归档对象保留 30 天后清理；元数据、link、event 和中央审计永久保留。
- 对象存储 `NoSuchKey` 视为删除成功；重复 job、租约过期、worker 崩溃和重复启动不得重复状态事件或审计。
- 结构化日志记录 claim 数量、通过/拒绝/重试/清理数量、错误码和耗时；不记录文件名、说明、对象键、病毒原文或内容。

## 8. 发布、回滚与后续复用

发布顺序：

1. 上线 additive migration、环境契约和默认关闭的能力。
2. 部署私有 MinIO/S3 桶、quarantine 生命周期和 ClamAV，验证能力诊断。
3. 启动 worker，验证扫描/清理租约和失败重试，不开放 UI。
4. 开放代理上传与 JPEG/PNG 预览、PDF 下载，并按实体逐步接入 UI。
5. 验证权限撤回、对象生命周期和多实例 worker 后完成发布。

回滚只关闭上传、授权生成、worker 或 UI，保留 schema、元数据和私有对象；不删除表、桶或已产生的附件事实。清理 worker 可独立继续运行。`packages/object-storage` 作为 T7 报表私有文件的稳定底座，但附件 target、扫描状态和 UI 不泄漏到报表领域。

主要风险：应用代理带宽、ClamAV 资源占用、对象存储与数据库无法形成单一事务、状态机崩溃点、Range/文件名响应头注入、授权器遗漏新目标。通过 10 MiB 上限、独立 worker、补偿式幂等、受控响应头和穷举判别联合控制。
