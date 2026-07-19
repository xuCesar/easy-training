# P0 CSV 请求契约统一：技术设计

## 边界与数据流

`File` → Web 读取文本并构造 preview/confirm input → oRPC JSON envelope → Hono `/rpc/*` body limit → Zod input → API repository → DB CSV parser。

本任务的事实源是“发送到 `/rpc` 的 UTF-8 JSON envelope 字节数”，而不是 `File.size` 或 `content.length`。Web 与 API 共用一个纯函数，按照当前 oRPC fetch 协议计算 `JSON.stringify({ json: input })` 的 UTF-8 字节数；Hono 使用同一请求体上限。

## 契约

- 在 API contracts 下定义并导出导入请求体上限、稳定错误文案和 `getLeadImportRpcBodyBytes(input)` 纯函数；函数不依赖浏览器、Node 或数据库。
- preview 与 confirm schema 在结构校验和默认校区校验后执行大小校验。错误附着在 `content`，不泄漏序列化细节。
- Web 读取 CSV 后，对即将发送的 input 调用同一纯函数。由于 confirm 比 preview 多 `requestId`，两个动作各自预检。
- Hono `bodyLimit` 使用契约导出的上限。超过限额的请求保持 413；其余超限/构造请求由 Zod 返回 BAD_REQUEST。
- DB parser 使用 `Buffer.byteLength(content, "utf8")` 做防御性内容限制。该限制不得小于通过 schema 的 `content` 可达最大值；它不负责判断 oRPC envelope。

## 可测试的 HTTP 装配

将 Hono app 装配从启动入口中抽为无副作用的 app factory / app export，`index.ts` 只负责 `serve`。这使测试可直接调用 `app.fetch`，断言 `/rpc/*` 的 Hono body limit 在 router 前生效，不启动监听端口。

## 兼容性与回滚

- 不变更 CSV 列、导入 batch、审计、权限或数据库 schema。
- 旧客户端的同一内容将按实际可发送 envelope 得到更早且明确的错误；不存在数据迁移。
- 回滚应用版本仅恢复旧限制策略，不影响已导入数据；因此不需要 down migration。

## 风险控制

- oRPC envelope 属于依赖协议。测试必须锁定当前 `{ json: input }` 形状；若升级依赖或客户端 transport，修改唯一的 envelope helper 和测试，而不是在 Web/Server 各自猜测。
- 不将 `Buffer` 引入浏览器共享函数；使用 `TextEncoder`，并为 Node 测试环境确认可用。
