# P0 CSV 请求契约统一：实施计划

1. 阅读 API/server/web/db 的相关规范与现有 oRPC transport，确认 envelope 形状和可复用导出位置。
2. 在 API 契约层实现共享的 UTF-8 body 计算、上限和稳定错误消息；替换 preview/confirm 的字符数校验。
3. 将 Hono app 装配抽离启动副作用，令 RPC body limit 复用共享上限；保持 CORS、可信 Origin、Auth、oRPC/OpenAPI 的顺序不变。
4. Web 导入页面在读取文件内容后，对 preview/confirm input 使用共享预检，并移除只看 `File.size` 的不一致判断。
5. 将 DB parser 的字符数防线改为 UTF-8 字节防线，保持现有领域错误映射。
6. 补共享契约、DB 导入和真实 Hono HTTP 回归测试：边界内、超 1 byte、中文、多转义字符、preview、confirm、413 不触达 router/DB。
7. 运行受影响测试，再运行 `pnpm check-types`、`pnpm check`、`pnpm build` 与 `pnpm test:integration`；审查 diff 中没有无关格式化或敏感日志。

## 风险文件

- `apps/server/src/index.ts`：装配顺序或启动副作用改错会影响所有 API 请求。
- `packages/api/src/contracts/training.ts`：公共输入契约改动须同步 Web 与 router。
- `apps/web/src/routes/_auth/leads.tsx`：不能破坏导入预览、重试或现有 toast 错误。
- `packages/db/src/repositories/operations.ts`：仅替换大小度量，不能改变 CSV 解析和幂等写入。

## 回滚点

- 本任务不含 schema 迁移；可独立回滚应用代码。
- 若 transport envelope 与假设不一致，停止扩大 body limit，先更新唯一 helper 与 HTTP 测试后再继续。
