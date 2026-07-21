# 欠费处理工作流技术设计

## Architecture and Ownership

- 新增 `packages/db/src/repositories/arrears-workflow.ts`，负责周期、事件、筛选和自动迁移 helper。
- 新建账单、收款与冲正 repository 在原事务内调用 helper；状态不能由前端根据余额事后补写。
- API 保留 `training.finance.arrears` 命名，扩展 list/detail/transition；旧 `followUp` 入口迁移为事件追加命令。
- Web 将现有最多四条的跟进卡升级为可筛选列表和历史 Sheet/Dialog，仍位于财务工作区。

## Data Model

新增枚举：

- `arrears_status`: `pending | following_up | promised | paused | resolved`
- `arrears_event_type`: `cycle_started | status_changed | note_added | auto_resolved`

新增 `invoiceArrearsCycle` 当前投影：

- `organizationId`、`campusId`、`invoiceId`、`cycleNumber`
- `status`、`version`、`startedAt`、可空 `resolvedAt`
- 可空当前字段：`promisedPaymentDate`、`resumeDate`
- `createdAt`、`updatedAt`

约束：

- `(organizationId, invoiceId, cycleNumber)` 唯一。
- `(organizationId, invoiceId) WHERE resolvedAt IS NULL` 最多一个开放周期。
- 版本和周期号为正；`resolved` 与 `resolvedAt` 一致性使用 check 或 repository 强约束。

新增 `invoiceArrearsEvent` 不可变历史：

- `cycleId`、`eventType`、`fromStatus`、`toStatus`
- 可空 `promisedPaymentDate`、`resumeDate`、`reason`、`note`
- 可空 `operatorUserId` 与 `operatorName`；自动事件使用明确 `sourceType`、`sourceId`
- 可空人工 `requestId`、`createdAt`

约束：

- `(organizationId, requestId) WHERE requestId IS NOT NULL` 唯一。
- `(organizationId, sourceType, sourceId, eventType) WHERE sourceId IS NOT NULL` 防止自动事件重放。
- 状态专属字段由 contract 和 repository 双重校验。

## Lifecycle Helpers

- `startArrearsCycleIfNeeded(tx, { invoiceId, sourceType, sourceId, occurredAt })`
- `resolveArrearsCycleIfNeeded(tx, { invoiceId, sourceType, sourceId, occurredAt })`
- `transitionArrearsCycleRecord(input)`
- `addArrearsNoteRecord(input)`

资金写入始终先锁 invoice，再调用 helper；helper 按 cycleNumber 读取或锁开放周期，不反向先锁周期再锁账单。

自动规则：

- 新建应收大于已收且非退款：不存在开放周期时创建下一 `cycleNumber`、状态 `pending` 和 `cycle_started` 事件。
- 收款后未收为零：开放周期更新为 `resolved`，写 `auto_resolved`。
- 冲正后从已结清变为待收：创建下一周期并写 `cycle_started`；若本来就待收，只保留当前周期和状态。
- 自动重放通过来源资金事实 ID 去重；与原业务事务同成同败。

人工迁移：

- 仅允许从开放周期的非 resolved 状态转到 `following_up | promised | paused`。
- `promised` 要求上海自然日不早于当天；`paused` 要求原因，恢复日期可空但不得早于当天。
- 请求带 `expectedVersion`；更新当前投影并追加事件，版本加一。
- 备注作为 `note_added` 事件，不强制改变当前状态；从待跟进开始实际跟进时，UI 可在同一命令明确选择转为 `following_up`。

## Existing Data Migration

使用保守的 additive migration：

1. 为当前真实待收账单创建首轮周期；有历史 follow-up 的当前状态回填为 `following_up`，否则为 `pending`。
2. 为已无待收但存在历史 follow-up 的账单创建已解决首轮周期。
3. 将现有 `invoiceFollowUp` 逐条复制为 `note_added` 事件，沿用原 UUID、requestId、操作者、备注和时间，保证幂等和可核对。
4. 原 `invoiceFollowUp` 表首版保留为只读兼容数据，不再写入；新查询只读新事件，避免双写。
5. migration 后用数量与关键字段 SQL 断言无遗漏，再允许应用切换。

## API and Query Shape

- `arrears.list({ status? })`：只返回真实待收且开放周期存在的记录，包含当前状态、版本和最近事件。
- `arrears.detail({ invoiceId })`：返回所有周期与事件，按周期倒序、事件正序。
- `arrears.transition(input)`：状态迁移。
- `arrears.addNote(input)`：追加备注。

列表以账单未收事实为准；若数据异常出现待收无周期，返回可观测错误而不是静默伪造状态。实施期应补一致性检查测试。

## Web Flow

- 状态筛选包含全部、待跟进、跟进中、承诺付款、暂停追缴；已解决只在历史中显示。
- 列表显示学员、摘要、未收、到期日、当前状态、承诺/恢复日期和最近操作。
- 详情展示各轮次及不可变时间线；状态 Dialog 根据目标状态动态显示字段并提供字段级错误。
- 长期暂停记录可以单独筛选；不自动隐藏未设置恢复日期的记录。
- 并发版本冲突保留输入，提示刷新最新状态。

## Audit and Rollback

新增中央审计 action：`arrears_status_changed`。自动开始/解决可记录 `actorUserId = null`，人工变化记录操作者；自由文本不进入审计。

迁移保留旧 follow-up 表，便于回滚读取。应用回滚后新状态事件不会显示，因此回滚前应暂停状态写入；资金投影本身仍由账单字段保持兼容。
