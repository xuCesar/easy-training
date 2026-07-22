# P2 运营任务与提醒技术设计

## 边界与复用

- 在现有 `operation_task` 事实表基础上做 additive migration，新增版本、状态历史和持久提醒记录；不改变工作台现有读取语义。
- DB repository 负责机构/校区范围、版本乐观锁、状态迁移、关联资源校验和事务；API contracts/router 只负责输入输出与服务端上下文编排。
- 使用现有组织成员、通知和审计能力；提醒消费者采用 PostgreSQL 租约与幂等键，不引入队列或外部通知渠道。

## 状态与授权

```text
pending --complete--> completed
pending --cancel----> cancelled
completed --reopen--> pending
```

- `overdue` 只由 `pending + dueAt < now` 派生。
- 个人任务：创建人、负责人可在规则内维护；管理角色可在机构/已授权校区范围维护。
- 关联实体和被分配成员必须使用同一服务端 scope 再次验证，不能信任客户端 module/entity/campus 输入。

## 一致性与提醒

- 每次写操作必须在单个事务内检查 `version`、更新任务、追加 history、失效旧提醒并创建新版本提醒。
- reminder 唯一键：`taskId + version + type`；消费者以租约领取、投递通知后标记成功，失败保留可重试记录。
- 完成、取消、重派或改期会失效旧版本待执行提醒；中央审计只记录动作和实体标识，不复制任务说明。

## API 形状

- `training.operations.tasks.list/create/update/claim/complete/reopen/cancel`。
- 每个写请求都带 `version`；冲突返回可识别的业务错误，不执行部分更新。
- Reminder worker 是服务端内部命令，不开放给浏览器调用。

## 回滚

- 停止消费者并隐藏写入口即可回退行为；任务、历史和已发送通知保留，避免抹除业务事实。
