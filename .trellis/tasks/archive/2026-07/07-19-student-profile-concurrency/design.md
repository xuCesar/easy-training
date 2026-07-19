# 学员档案并发保护设计

## 范围与边界

学员是联系人、主要联系人、标签和 guardian 兼容字段的聚合根。更新仍使用现有的完整集合替换语义，但必须以 `student.updatedAt` 作为乐观并发令牌。

不新增版本列、索引或迁移：`updated_at` 已为带时区、非空字段，并由详情接口作为 ISO 8601 字符串返回。

## 契约

`training.students.update` 顶层新增必填字段 `expectedUpdatedAt`。它不属于可编辑的 `data`，值来自编辑弹窗初始详情请求的 `updatedAt`。创建接口和详情输出不变。

DB repository 接收已解析的 `Date`，避免传输层字符串进入持久化层。缺失或格式非法的版本令牌在 API 契约校验阶段失败。

## 写入顺序与原子性

`updateStudentRecord` 的单一 PostgreSQL 事务按以下顺序执行：

1. 锁定并重新计算当前成员的写权限。
2. 以机构和学员 ID 锁定 `student` 行，读取 `campusId` 和 `updatedAt`。
3. 完成校区权限与可写性校验，再比较 `expectedUpdatedAt`。
4. 仅版本匹配时校验联系人 ID、标签并执行联系人与标签替换。
5. 回写基础资料、guardian 兼容字段和严格递增的 `updatedAt`。

版本不匹配抛出 `STUDENT_VERSION_CONFLICT`。因为比较发生在任何聚合写入之前，事务回滚后联系人、主要联系人、标签及 guardian 都不会留下部分更新。版本使用 PostgreSQL `greatest(clock_timestamp(), updated_at + interval '1 millisecond')` 单调推进，避免连续更新同毫秒产生相同令牌。

权限或资源不存在校验优先于版本检查，避免越权用户通过冲突响应探测资源状态。

## 错误与交互

API 将 `STUDENT_VERSION_CONFLICT` 映射为 ORPC `CONFLICT`。前端依据结构化错误码判断冲突，保持弹窗和当前草稿不变，显示“刷新最新资料”操作。

刷新只更新版本令牌与服务端详情快照，不能自动重置草稿或自动重试。用户确认后再次保存，仍采用当前草稿作为完整替换内容；若期间再次发生更新，重复返回冲突。

## 兼容与发布

这是更新接口的必填字段扩展，仓库内 Web 与 API 同步发布。旧客户端会得到输入校验错误，不能通过 optional 字段绕过并发保护。

