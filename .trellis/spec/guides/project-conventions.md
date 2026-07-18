# Easy Training 项目级工程约束

## 技术边界

- 这是一个 pnpm workspace + Turborepo 的全栈 TypeScript monorepo。
- `apps/web` 负责 React 19、TanStack Router/Query 与用户交互；`apps/server` 只负责 Hono HTTP 入口和中间件装配。
- `packages/api` 负责 oRPC 契约、过程授权和业务编排；`packages/db` 负责 Drizzle schema、migration 和持久化实现。
- `packages/auth`、`packages/env`、`packages/ui` 分别承载认证、环境变量边界和共享 UI，不把这些职责复制进应用目录。
- 优先复用 workspace 内已有契约、repository、工具函数和 UI 组件，不新增平行实现，不主动增加依赖。

## 类型与错误处理

- TypeScript 强类型优先；避免 `any`、非必要断言和非空断言，外部输入使用 Zod 或既有契约收窄。
- 网络错误、业务错误、权限错误和空结果必须保持可区分，不能静默吞掉失败。
- 修改公开 API 时同步检查输入/输出 schema、router、repository、Web 调用方和测试。

## 安全与数据约束

- 认证不等于授权。所有资源权限和机构隔离必须在服务端执行，前端判断只能用于交互呈现。
- 不接受客户端提供的任意机构 ID 作为查询边界；服务端必须从当前会话和机构成员关系解析有效机构上下文。
- 不记录密码、Cookie、Token、认证密钥、完整连接串或学员隐私数据。
- 财务金额统一使用整数“分”；时间存储使用带时区时间戳，业务自然日和界面展示按 `Asia/Shanghai` 处理。

## 改动策略

- 只做当前任务所需的最小闭环，不做无关重构，不随意改变公开导出、文件名或包依赖方向。
- 数据库变更必须考虑旧数据、nullable/default、约束、索引、并发写入和回滚路径；不手写或执行破坏性 migration。
- 用户改动和无关脏文件必须保留；Trellis session 不得自动提交，所有 Git 提交由用户明确确认。

## 验证基线

按风险和影响范围执行以下已有命令，不得声称未执行的验证已通过：

```bash
pnpm check-types
pnpm test:integration
pnpm check
pnpm build
```

- 小范围改动可先运行受影响 workspace 的检查，再运行必要的全仓检查。
- 权限、机构隔离、财务写入和 migration 改动优先补集成测试。
- 前端交互改动除类型与 lint 外，应尽量在浏览器中检查加载、错误、空状态和移动端表现。
