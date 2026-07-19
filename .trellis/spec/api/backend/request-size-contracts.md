# RPC 请求大小契约

## 场景：CSV 导入的 oRPC 请求体边界

### 1. Scope / Trigger

- 触发条件：Web、API 契约、Hono middleware 与 repository 同时处理 CSV 导入，单独按 `File.size`、`string.length` 或内容字节限制都会遗漏 oRPC JSON envelope 的开销。
- 目标：所有可发送的导入请求在进入 Hono 前已按实际 UTF-8 JSON body 判定；repository 仍保留独立的内容防线。

### 2. Signatures

```ts
export const LEAD_IMPORT_RPC_BODY_LIMIT_BYTES: number;
export const LEAD_IMPORT_REQUEST_TOO_LARGE_MESSAGE: string;
export function getLeadImportRpcBodyBytes(input: unknown): number;
```

- 输入 schema：`previewLeadImportInputSchema`、`confirmLeadImportInputSchema`。
- HTTP 装配：`apps/server/src/app.ts` 的 `bodyLimit` 必须复用同一上限与错误消息。

### 3. Contracts

- oRPC fetch body 的当前协议形状是 `JSON.stringify({ json: input })`，并按 UTF-8 字节计数。
- Web 在文件读取后分别检查 preview 输入和含 `requestId` 的 confirm 输入；切换默认校区时也要重新检查。
- Hono 对全部 `/rpc/*` 与 `/api-reference/*` 应用相同 body limit，因此超限文案必须保持通用。
- `packages/db` 解析器可用 `Buffer.byteLength(content, "utf8")` 设置独立内容上限，但它不得比 schema 可达内容更严格。

### 4. Validation & Error Matrix

| 条件 | 责任层 | 结果 |
| --- | --- | --- |
| Web 计算的 envelope 大于上限 | Web | 不发请求，toast 显示共享超限消息 |
| 绕过 Web 但 schema 输入 envelope 大于上限 | API Zod | `BAD_REQUEST`，问题附着 `content` |
| 原始 HTTP body 大于上限 | Hono | `413` 与共享超限消息，不能进入 router |
| repository 直调且 CSV 内容 UTF-8 字节超防线 | DB | `IMPORT_LIMIT_EXCEEDED` |

### 5. Good / Base / Bad Cases

- Good：ASCII 内容、中文内容与包含引号/反斜杠/换行的内容均以 `getLeadImportRpcBodyBytes` 判定。
- Base：请求体恰好等于 `LEAD_IMPORT_RPC_BODY_LIMIT_BYTES` 时可穿过 body limit，继续由可信来源或业务校验处理。
- Bad：只比较 `File.size`、`content.length`，或为 preview 复用未含 `requestId` 的 confirm 估算。

### 6. Tests Required

- 契约测试：preview 和 confirm 的恰好上限、超 1 byte、UTF-8 与 JSON 转义字符。
- repository 集成测试：500,000 与 500,001 UTF-8 内容字节。
- HTTP 测试：`app.fetch` 断言上限内不返回 413、上限外返回 413；无需启动端口。
- 修改 transport 时：同步更新唯一 helper 与上述 HTTP 测试，不能在消费者里重算 envelope。

### 7. Wrong vs Correct

#### Wrong

```ts
if (file.size > 500_000 || content.length > 500_000) return;
```

#### Correct

```ts
if (getLeadImportRpcBodyBytes(input) > LEAD_IMPORT_RPC_BODY_LIMIT_BYTES) {
	toast.error(LEAD_IMPORT_REQUEST_TOO_LARGE_MESSAGE);
	return;
}
```
