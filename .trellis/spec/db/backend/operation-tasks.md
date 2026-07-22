# 运营任务与提醒契约

## 1. Scope / Trigger

- 适用于运营任务的创建、派单、认领、改期、重派、完成、重开、取消、列表和站内提醒消费。
- 任务写入同时涉及机构成员权限、校区范围、乐观锁、不可变历史、中央审计和持久提醒，必须在 PostgreSQL 事务内完成。
- 后续把任务接入全局搜索、报表或其他后台执行器时，也必须保持本契约。

## 2. Signatures

- API：`training.operations.tasks.list/assignees/create/update/claim/complete/reopen/cancel`。
- 列表输入：`{ view, status?, campusId?, module?, dueAtFrom?, dueAtTo?, keyword?, cursor?, limit }`。
- 列表输出：`{ items: Array<OperationTask & { ownerName: string | null }>, nextCursor: string | null }`。
- 写操作输入：`{ id, expectedVersion }`；编辑额外携带 `data`。
- DB：`listOperationTasks`、`listOperationTaskAssignees`、`createOperationTask`、`updateOperationTask` 及各状态动作。
- 消费者：`processDueOperationTaskReminders({ now?, limit?, deliver? }) -> { delivered, retried, dead }`。

## 3. Contracts

- 状态只保存 `pending/completed/cancelled`；`overdue` 由 `pending && dueAt < now` 派生，不写入数据库。
- 写事务必须先取得机构 advisory lock，再重新读取操作者当前成员角色和校区范围；不得把 router 中的权限快照作为最终写权限。
- owner/admin 可管理全机构；campus_manager 只能管理授权校区且不能以 `campusId = null` 绕过；consultant/finance/teacher 只能维护本人任务。
- 模块权限固定为：consultant=`enrollment/student_service`、finance=`finance`、teacher=`academic`、管理角色=全部模块。列表、候选负责人、创建、认领和重派使用同一映射。
- 只有管理角色可以创建无负责人公共任务或给其他人派单。目标负责人必须仍属于当前机构，并同时具备任务模块和校区权限。
- 所有写动作检查 `expectedVersion`，原子增加版本并追加一条 history；陈旧版本不得产生任务、history、reminder 或 audit 的部分写入。
- 改期、提醒时间或负责人变化时，取消旧的 `pending/leased` 提醒并按新版本重建；完成和取消撤销所有未投递提醒。
- 列表按 `dueAt ASC, createdAt DESC, id ASC` 游标分页。游标只由服务端编码；非法游标返回 `INVALID_CURSOR`，不能回退到首页或扩大查询范围。
- UI 必须显示负责人姓名并提供状态、模块、校区、截止范围和关键词筛选。新建表单按角色限制模块；本人不能承接全机构任务时，默认选择首个可用校区。
- 提醒幂等键为 `operation-task:{taskId}:v{taskVersion}:{type}`。领取租约独立提交；通知与 `delivered` 状态在同一事务提交。
- 失败记录固定安全错误码和消息，30 秒起指数退避，最长 30 分钟；第 5 次失败进入 `dead`。不得把原始异常、连接串或任务说明写入 worker 日志。
- 中央审计仅保存模块、优先级、截止时间、负责人、状态和版本等白名单字段；任务标题、说明等自由文本只保存在任务或通知事实中。
- `relatedEntityType/relatedEntityId` 在开放客户端写入前必须增加实体归属、校区和领域权限校验；不能只校验 module 字符串。

## 4. Validation & Error Matrix

| 条件 | DB 错误 / 结果 | API 语义 |
| --- | --- | --- |
| 当前成员已移除或角色不允许 | `MEMBER_FORBIDDEN` | `FORBIDDEN` |
| 任务或负责人不在当前校区范围 | `CAMPUS_OUT_OF_SCOPE` | `FORBIDDEN` |
| 校区不存在、跨机构或已停用 | `CAMPUS_INVALID` | `CONFLICT` |
| 任务不存在或跨机构 | `TASK_NOT_FOUND` | `NOT_FOUND` |
| `expectedVersion` 陈旧 | `TASK_VERSION_CONFLICT` | `CONFLICT`，携带同名 reason |
| 非法状态迁移 | `TASK_STATE_CONFLICT` | `CONFLICT`，携带同名 reason |
| 游标无法解码或字段非法 | `INVALID_CURSOR` | `BAD_REQUEST` |
| 提醒投递短暂失败且尝试次数 < 5 | `pending` + 新 `availableAt` + 安全错误记录 | worker 记录 retry count |
| 提醒投递第 5 次失败 | `dead` + 安全错误记录 | worker 记录 dead count |

## 5. Good / Base / Bad Cases

- Good：财务人员只看到并创建财务任务；指定校区顾问创建任务时自动落到可用校区，服务端在事务内再次验证。
- Good：两个实例竞争同一到期提醒，只有一个取得租约；进程在通知提交后重启时，幂等键阻止重复通知。
- Base：只修改标题仍增加任务版本和 history，但不重建截止提醒；改期或重派才撤销并重建提醒。
- Base：公共任务认领前没有个人提醒，认领后按新版本为认领人创建提醒。
- Bad：前端隐藏越权选项但服务端不校验；或允许指定校区成员提交 `campusId = null`。
- Bad：把租约、通知和失败记录放进同一回滚事务，导致失败后 `attemptCount/lastError` 永远不落库。

## 6. Tests Required

- PostgreSQL 集成测试覆盖个人任务、公共任务、管理视图、模块裁剪、跨机构/校区拒绝和非法游标。
- 覆盖游标分页无重复无遗漏，并断言列表返回负责人姓名。
- 覆盖创建、改期、重派、完成、重开、取消的版本、history、reminder 和 audit 原子性；审计 JSON 不含任务说明。
- 覆盖陈旧版本和非法状态迁移零副作用。
- 并发两个消费者时同一提醒只产生一条通知；完成/取消后旧提醒不可再领取。
- 注入短暂失败，断言 `attemptCount`、退避时间、安全错误字段和重试成功；连续 5 次失败断言 `dead`。
- Web 在桌面和 390px 验证加载、错误、空状态、分页、筛选、新建、编辑和状态动作。

## 7. Wrong vs Correct

### Wrong

```ts
await db.transaction(async (tx) => {
	await claimReminder(tx);
	await deliverNotification(tx);
});
```

投递抛错会把租约和尝试次数一并回滚，系统无法退避、观察或进入死信。

### Correct

```ts
const claim = await claimReminderInTransaction();
try {
	await deliverAndMarkCompletedInTransaction(claim);
} catch {
	await recordRetryOrDeadLetter(claim);
}
```

租约先持久化，通知与成功状态保持原子，失败则独立记录安全错误和下一次可执行时间。
