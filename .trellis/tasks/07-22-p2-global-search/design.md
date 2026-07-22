# P2 全局搜索与跨模块跳转技术设计

## Architecture and Ownership

- 新增 `packages/db/src/repositories/global-search.ts`，拥有各领域受限查询、角色分支、脱敏摘要和稳定排序；不调用已有分页 repository 后再拼装全量结果。
- 新增 `packages/api/src/repositories/global-search.ts`，负责把数据库投影映射成 API 判别联合；`packages/api/src/contracts/training.ts` 是输入、结果与类型化目标的唯一契约来源。
- `packages/api/src/routers/index.ts` 在 `organizationProcedure` 下暴露 `training.search.global`。具体可见类型由当前 `role`、`campusAccess`、`userId` 决定，不新增“全局搜索角色”绕过领域权限。
- 新增 `apps/web/src/features/training/global-search-dialog.tsx`，由认证布局统一挂载；业务路由只处理目标参数和现有详情组件，不复制搜索状态。
- 不修改数据库 schema、不新增包依赖；首期以现有 PostgreSQL 能力形成最小闭环。

## Result Contract

响应结构：

```ts
type GlobalSearchResult = {
  groups: Array<{
    kind: GlobalSearchKind;
    label: string;
    items: GlobalSearchItem[];
    hasMore: boolean;
  }>;
};
```

`GlobalSearchItem` 是按 `kind` 判别的联合，每个分支拥有对应目标：

- lead：`{ route: "leads"; leadId }`
- student：`{ route: "students"; studentId }`
- course：`{ route: "academicCourse"; courseId }`
- classGroup：`{ route: "academicClass"; classGroupId }`
- lesson：`{ route: "academicLesson" | "teacherLesson"; lessonId }`
- invoice：`{ route: "financeInvoice"; invoiceId }`
- receipt：`{ route: "financeReceipt"; invoiceId; receiptId }`

Web 使用穷尽 `switch` 将目标映射为 TanStack Router 导航；API 不返回任意 path/query 字符串。每组查询取 6 条以判断 `hasMore`，只返回前 5 条；最终总数有 35 条硬上限。

## Query and Ranking

- 通用文本按 trim 后原值生成 `contains` 与 `prefix` pattern；手机号额外复用现有规范化规则，但响应始终脱敏。
- 每个领域只连接生成标题和摘要所需的表，并在 SQL 内应用机构、校区、角色或 teacher binding 过滤。
- 排序使用 `CASE`：精确匹配、前缀匹配、包含匹配，再使用领域最近时间和 UUID/编号打破并列。
- 允许的分组按角色并行执行。consultant 不执行财务/教务查询，finance 不执行招生/学员查询，teacher 只执行本人课次查询。
- 课程本身是机构级目录，owner/admin/campus_manager 沿用现有 academic management 权限搜索本机构课程；班级和课次仍按校区范围过滤。

## Deep-Link Resolution

- `leads.tsx`、`students.tsx`、`academic.tsx`、`finance.tsx`、`teacher.tsx` 增加 Zod `validateSearch`；UUID 参数无效时由路由丢弃。
- 线索新增受权 `get` 查询；学员复用现有 `students.get`。页面获得目标后映射为现有列表 item/详情 props并打开现有组件。
- 教务现有列表查询增加受控目标 ID 查询路径，目标课次不受默认日期范围限制；课程和班级同理。返回仍由 academic management procedure 和 campus scope 保护。
- 教师工作台查询允许可选 `lessonId`，但 repository 必须同时匹配当前成员的 teacher binding 与 lesson.teacherId。
- 财务复用 invoice detail 和 receipt get；receipt 搜索结果携带所属 invoiceId，`FinanceWorkspace` 先确认账单详情，再把 `receiptId` 交给现有凭证 Dialog。
- 页面关闭目标或服务端返回不可见时用 replace navigation 移除参数；跨域不存在和无权统一使用目标领域既有 NOT_FOUND/FORBIDDEN 语义，不从搜索结果缓存恢复敏感详情。

## Web Interaction

- 认证布局保留一个 `open` 状态；桌面输入和移动 icon 都是 trigger。面板打开后聚焦搜索框，关闭后焦点回到触发元素。
- 使用 `useDeferredValue`/短延迟值驱动 TanStack Query；query key 包含 organizationId、sessionUserId、query，`enabled` 只在面板打开、机构 ready 且长度达标时为 true。
- 机构切换开始时关闭面板；现有 `queryClient.clear()` 保证旧机构缓存不复用。
- 使用现有 Dialog/Command 可组合基础组件；若仓库没有满足可访问性的 Command 组件，则在业务 feature 内实现最小 listbox/active descendant 逻辑，不新增组件库。
- 每组显示最多 5 条及“前往模块继续筛选”的受控入口；无权访问的模块不显示入口。

## Errors, Privacy and Observability

- 单个领域查询失败时整个 API 失败，避免展示不完整结果却误导为全局无命中；客户端提供重试。
- 日志只记录组织、角色、耗时、结果分组计数和错误类别，不记录 query、手机号、姓名或摘要。
- 搜索只读，不新增中央审计事件；目标页面的后续写操作继续使用原有领域审计。

## Compatibility and Rollback

- 所有 API 与路由参数为 additive；旧书签和现有模块筛选不受影响。
- 顶栏入口可独立回退为禁用状态，新增只读 API 和路由参数可保留；没有数据库回滚。
- 若某个目标页定位出现回归，可临时只关闭该 kind 的角色分支，不扩大其他查询权限。
