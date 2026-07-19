# 服务端可观测性契约

## 1. Scope / Trigger

Hono 入口新增或修改健康检查、请求关联和访问/异常日志时适用。目标是让同一请求的响应与日志可关联，同时不扩大请求数据或认证信息的暴露面。

## 2. Signatures

- Liveness：`GET /` → `200 OK`，不依赖数据库。
- Readiness：`GET /readyz` → 数据库 `SELECT 1` 成功时 `200 OK`，失败时 `503 Service Unavailable`。
- 请求关联：入站与出站 HTTP header 为 `X-Request-Id`。

## 3. Contracts

- 仅复用长度不超过 128、匹配 `[A-Za-z0-9._:-]+` 的入站请求 ID；缺失或非法值必须生成 UUID 替代。
- 每个响应回显最终 `X-Request-Id`；CORS 必须允许请求头并暴露响应头。
- 访问日志为单行 JSON，至少含 `event: "http.access"`、`requestId`、`method`、`path`、`status`、`durationMs`。
- 未预期异常日志为单行 JSON，至少含 `event: "http.unexpected_error"` 与 `requestId`；错误字段使用安全的固定描述。

## 4. Validation & Error Matrix

| 条件 | 行为 |
| --- | --- |
| 合法 `X-Request-Id` | 复用并回显 |
| 缺失、含空白/换行或超长 ID | 生成 UUID 并回显 |
| readiness 数据库查询失败 | 仅返回 503，不返回内部错误 |
| 未预期服务端异常 | 记录安全异常事件并返回 500 |

## 5. Good / Base / Bad Cases

- Good：通过 `createApp` 的可注入 readiness/log 依赖测试成功、失败和脱敏，不触发真实生产数据库。
- Base：`GET /` 始终可用于进程 liveness；`GET /readyz` 只代表可服务性。
- Bad：将 Authorization、Cookie、请求体、连接串或原始异常堆栈序列化进日志。

## 6. Tests Required

- 合法 ID 复用、非法 ID 替换、响应回显与日志不含敏感请求内容。
- readiness 成功/失败及 `/` 与 `/readyz` 的语义分离。
- 修改 oRPC/OpenAPI 处理链时，补覆盖其成功和 5xx 失败响应仍携带请求 ID 的测试。

## 7. Wrong vs Correct

### Wrong

```ts
console.error(error);
```

这会丢失请求关联，且异常内容可能包含敏感上下文。

### Correct

```ts
log({
	event: "http.unexpected_error",
	requestId,
	error: "Unexpected server error",
});
```
