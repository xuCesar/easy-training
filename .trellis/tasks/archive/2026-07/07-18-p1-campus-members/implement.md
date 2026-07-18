# P1 实施计划：多校区与成员角色管理

## 实施顺序

1. **数据库与迁移**
   - 扩展 `packages/db/src/schema/training.ts`，增加校区状态、成员访问模式/范围、邀请及审计模型。
   - 生成并审查 Drizzle migration；为既有成员回填全机构模式，补充机构、邮箱、状态和时间线索引。
   - 在 `packages/db/src/repositories` 新增 campus/member/invitation/audit repository，并提取 `CampusAccess` SQL 谓词与“锁定并确认可写校区”工具。

2. **组织上下文与授权**
   - 扩展组织查询与 oRPC context，服务端解析 `CampusAccess`；更新角色集合和管理过程。
   - 将当前公开的线索、转报名、工作台和财务 repository 改为显式接收此上下文，所有读取、导出、聚合、详情和写入均受范围约束。
   - 对现有与新增写入在事务内锁定 campus，复核机构、范围和启用状态。

3. **校区、成员与邀请 API**
   - 在 `contracts/training.ts` 定义 Zod 输入/输出，在 router 编排，在 API repository 映射领域错误。
   - 实现校区 CRUD/启停与审计；成员列表、角色和范围替换、移除、最后 owner 保护与会话当前机构清理。
   - 实现邀请创建、撤销、重发、状态查询与领取。原始 token 只从创建/重发响应返回；fragment 链接由 Web 端构造。领取绝不通过 GET 消费 token。

4. **管理端与邀请领取体验**
   - 新增 settings 路由、校区与成员管理视图，以及公开邀请领取路由。
   - 使用现有 shadcn 风格组件、Tailwind 和 Lucide；提供加载、空、错误、无权、复制成功、提交中和危险操作确认状态。
   - 刷新受校区范围影响的 query，确保角色/范围/停用后页面不继续显示过期数据。

5. **测试、审查与文档**
   - 先补数据库/appRouter 集成测试，再补前端关键交互测试与浏览器验收。
   - 运行质量门禁、审查 migration 与日志敏感信息；必要时更新 API/DB/Web Trellis spec。
   - 在 README 或管理文档说明：本期没有邮件验证时，邮箱匹配不是邮箱控制权验证；严格验证需要配置可插拔发送器。

## 高风险检查点

- 不能让客户端 `campusId` 充当权限判断；它只能过滤已授权范围。
- 不以 middleware 开始时的成员快照替代写事务中的权限复核。
- 最后 owner 校验必须与成员改动在同一机构锁内完成。
- 邀请 token 不能出现在 URL query/path、日志、审计、错误信息或浏览器历史。
- 校区停用既要更新可选项，也要在提交事务内重检；历史读取不能被 `is_active` 意外过滤。
- 现有非 owner 成员必须迁移为全机构访问，防止上线后无意失权。

## 验证命令

按实现阶段执行，只有实际执行成功的结果才会报告为通过：

```bash
pnpm --filter @easy-training/db test
pnpm --filter @easy-training/api check-types
pnpm check-types
pnpm test:integration
pnpm check
pnpm build
```

前端完成后启动本地 Web 与 Server，使用真实浏览器检查桌面和移动端的校区管理、成员范围、邀请领取、无权和停用校区写入失败路径。

## 回滚点

- migration 发布后应用发布前：可停止在新 schema，旧应用继续运行。
- API 阶段：先保持既有 non-owner 的 `all` 访问模式，避免范围功能未完成时改变线上读取行为。
- Web 阶段：新 settings 路由可独立隐藏；不能以移除 schema 或审计表作为常规回滚方式。
