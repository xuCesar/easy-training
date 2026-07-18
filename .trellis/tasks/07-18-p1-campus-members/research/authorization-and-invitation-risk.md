# 授权与邀请风险调研

## 范围与方法

2026-07-18 对当前 oRPC 路由、Drizzle repository、Better Auth 配置与集成测试进行了只读追踪。本文件记录会改变 P1 实施方式的结论，不替代 `prd.md`、`design.md` 或 `implement.md`。

## 已确认的调用链

- `/rpc` 由 `apps/server/src/index.ts` 交给 `packages/api/src/routers/index.ts` 的 `appRouter`。
- `packages/api/src/index.ts` 的组织中间件从 `packages/db/src/repositories/organization.ts` 解析 session、机构 membership 与角色；现有上下文不含校区范围。
- 已公开的校区相关业务接口是线索、转报名、工作台和财务。它们的 repository 目前只按 `organizationId` 限制。
- 现有校区外键不表示校区启用状态；线索和转报名路径的校区存在性检查与实际写入事务分离。

## 影响的当前公开业务

| 模块 | 路由 | 需要的 P1 约束 |
| --- | --- | --- |
| 线索 | `training.leads.{list,create,update,followUp,history,export}` | 受限成员只能读取和修改其范围内的有校区记录；创建、改校区与导出要同时检查范围和启用状态。 |
| 转报名 | `training.leads.{conversionOptions,convert}` | 候选校区、学员和班级按范围过滤；最终事务再次确认范围和校区启用状态。 |
| 工作台 | `training.snapshot` | 指标、待跟进、课次和应收按访问范围聚合。 |
| 财务 | `training.finance.invoices.*` 与 `payments.create` | 通过 `invoice -> student.campusId` 限制列表、详情和收款。 |

没有发现教师、班级或排课的公开创建/编辑 API；它们在未来新增时必须复用本期的校区写入校验。

## 安全结论

1. 校区范围必须由服务端组织中间件解析为全机构、指定校区或无访问权三种状态，并显式传入每个 repository。客户端 `campusId` 只能缩小结果，不能扩大权限。
2. 校区停用与任何归属校区的写入必须在同一事务中锁定 campus 行并复核状态；仅在表单选项或 API 事务外预检查会产生竞态。
3. 成员角色调整、移除和最后 owner 校验必须以机构为粒度串行化。普通的 count-then-update/delete 在两个 owner 并发操作时会留下零 owner。
4. 成员移除后需要清理其指向该机构的 session `activeOrganizationId`，而非删除该用户所有 session，避免影响其其他机构。
5. 随机邀请 token 只以 SHA-256 hash 形式存储；原文只在创建响应中出现一次。链接用 fragment，领取用 POST body；审计和日志不写 token、hash、cookie 或完整邮箱。
6. 现有 Better Auth 没有邮箱验证发送能力，注册也不要求验证。因此“规范化邮箱一致”不是邮箱控制权证明。本期必须如实呈现这个限制；日后接入验证发送器时，领取条件增加 `emailVerified === true`，无需改变邀请码数据模型。

## 复用锚点

- 角色与机构过程：`packages/api/src/index.ts`、`packages/api/src/authorization/training.ts`
- 组织事务与会话选择：`packages/db/src/repositories/organization.ts`
- 行锁与跨资源写入：`packages/db/src/repositories/enrollment-conversion.ts`
- 幂等收款：`packages/db/src/repositories/finance.ts`
- 真实 appRouter 集成测试：`packages/db/tests/organization-context.integration.ts`
