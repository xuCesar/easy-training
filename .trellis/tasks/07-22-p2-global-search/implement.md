# P2 全局搜索与跨模块跳转实施计划

## Scope Guard

- 首期只实现七类已确认对象和类型化站内跳转；不接入尚未完成的任务、附件或全文内容。
- 不新增依赖、数据库迁移、全文索引、搜索历史或前端权限过滤。
- 复用现有领域详情和工作台组件，不建设第二套业务详情页。

## Implementation Checklist

1. API 契约与授权矩阵 ✅
   - 在 `packages/api/src/contracts/training.ts` 定义查询输入、七类判别联合、分组结果与类型化 target。
   - 在 `packages/api/src/authorization/training.ts` 维护搜索 kind 与既有领域角色的一致映射，避免散落角色字符串。
2. DB 查询 ✅
   - 新增 `packages/db/src/repositories/global-search.ts`，按角色只执行允许的领域查询。
   - 每个查询带 organization/campus/teacher 边界、稳定排序和 6 条内部上限；复用手机号规范化与脱敏 helper。
   - 收款凭证同时返回 receiptId 与所属 invoiceId；教师课次严格匹配 teacher binding。
3. API repository/router ✅
   - 新增 `packages/api/src/repositories/global-search.ts` 做日期序列化和判别联合映射。
   - 在 `packages/api/src/routers/index.ts` 增加 `training.search.global`，传入服务端 context 的 role、userId 和 campusAccess。
4. 可刷新深链接（进行中）
   - 为 leads/students/academic/finance/teacher 路由补 Zod search 参数。
   - 为线索增加单条受权读取；为教务列表和教师工作台补按目标 ID 的受权加载路径。
   - 复用现有详情、时间线、教务定位、账单详情和凭证 Dialog；关闭或目标失效时清理 URL。
5. 顶栏搜索 UI（基础面板已完成；键盘结果导航、焦点返回与机构切换主动关闭待补）
   - 新增 `global-search-dialog.tsx`，实现桌面/移动 trigger、快捷键、焦点管理、延迟请求和分组结果。
   - 完整呈现输入提示、加载、空、错误重试和 `hasMore`；使用穷尽 target 映射导航。
   - 机构切换时关闭并清理搜索状态。
6. 测试与文档（契约规范已补；集成与浏览器测试待补）
   - 增加 PostgreSQL 集成测试和 API 契约断言，覆盖五类角色、跨租户/校区、结果上限、稳定排序与脱敏。
   - 补路由/组件关键行为测试；记录新增深链接参数。

## Required Tests

- owner/admin 全类型、campus_manager 授权校区、consultant 仅线索/学员、finance 仅账单/凭证、teacher 仅本人课次。
- 同名、前缀、包含、联系人手机号、凭证编号和每组 6 条以上数据时的排序与 `hasMore`。
- 跨机构、越权校区、其他教师、合并学员、不可见财务记录均不返回；电话和摘要无敏感泄露。
- 目标在当前分页、筛选或日期范围之外仍能通过 URL 加载；刷新、后退、关闭和无权/不存在目标行为正确。
- 机构切换期间不发旧机构请求且旧缓存不闪现；API 失败显示重试而不是空态。
- `⌘K`/`Ctrl+K`、Esc、方向键、Enter、焦点返回及 390px 无横向溢出。

## Validation Commands

```bash
pnpm --filter web check-types
pnpm --filter server exec tsx --test ../../packages/db/tests/global-search.integration.ts
pnpm check-types
pnpm check
pnpm build
```

浏览器验证需在认证态分别检查 owner/admin、campus_manager、consultant、finance、teacher，并覆盖桌面与 390px 视口。

## Review Gates and Rollback

- Gate 1：服务端返回前已完成角色、机构、校区和教师本人过滤，前端没有隐藏式授权。
- Gate 2：结果契约是穷尽判别联合，任意 URL 不来自服务端数据或用户输入。
- Gate 3：所有深链接可刷新且目标页再次鉴权，不依赖内存中的搜索结果。
- Gate 4：查询有硬上限、无 N+1、常规数据 p95 达到 500ms 目标，日志不含查询词或隐私。
- 回滚只需关闭顶栏入口和 API 路由；无 schema 或业务事实需要删除。
