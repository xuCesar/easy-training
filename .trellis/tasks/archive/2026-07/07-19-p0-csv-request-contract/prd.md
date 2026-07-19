# P0 CSV 请求契约统一

## Goal

统一 CSV 导入的前端、oRPC 契约、服务端请求体与解析器字节边界并补真实 HTTP 回归测试。

## Confirmed Facts

- Web 目前以 `File.size <= 500_000` 预检；API 与 DB 则以 JavaScript 字符数限制 `content` 为 500,000。
- `/rpc/*` 在到达 oRPC/Zod 之前受 256 KiB Hono body limit 限制；oRPC 会将输入包装并 JSON 序列化，因此实际 HTTP body 不等于 CSV 原文件大小。
- 现有导入集成测试经 router client 直连，不经过 Hono middleware，无法证明 HTTP 413 行为。

## Requirements

### R1：唯一且字节化的边界语义

- CSV 内容、oRPC JSON 包装与 HTTP body 的大小必须按 UTF-8 字节而非 JavaScript 字符数评估。
- 定义一个可由 Web、API 和 Hono 装配层复用的请求体上限；任何可由前端发出的导入请求均不得因隐藏的包装开销在服务端得到意外 413。
- 数据库解析器继续保留独立的防御性 UTF-8 内容限制，且不得比 API 可接受输入更严格。

### R2：一致失败体验

- 前端选择文件后，基于实际 oRPC 输入的序列化大小预检 preview/confirm 两种请求，明确提示“导入请求超过 256 KiB”或等价一致文案。
- API 输入校验拒绝超出可达请求边界的输入，返回既有 BAD_REQUEST 语义。
- Hono body limit 仍是绕过前端和 schema 的最后防线，返回 413；三层不能出现相互矛盾的阈值或单位。

### R3：真实链路回归

- 覆盖 ASCII、中文 UTF-8 与 JSON 转义字符，验证预检、Zod、DB 防御和 HTTP middleware 的边界一致。
- 覆盖 preview 和 confirm；验证超限 HTTP 请求不进入数据库导入流程。

## Acceptance Criteria

- [ ] 前端、API、Hono 和 DB 的限制均以 UTF-8 字节为依据，且上限/错误提示来自受控的单一契约，而不是散落的 500,000 或 256 KiB 常量。
- [ ] 边界内的 preview 与 confirm 请求可穿过 Hono middleware 并抵达原有业务校验；边界外请求分别按预检、BAD_REQUEST 或 413 的职责拒绝。
- [ ] 具有大量中文、引号、反斜杠或换行的 CSV 不会因 `string.length` 与 JSON 转义差异产生错误判定。
- [ ] 新增真实 HTTP 回归测试以及受影响的现有导入集成测试；类型检查、Biome、生产构建与完整集成测试通过。

## Out of Scope

- 异步大文件导入、文件对象存储、分片上传或对 CSV 格式本身的重新设计。
- 修改现有导入的机构、校区、幂等、行级错误和审计语义。
