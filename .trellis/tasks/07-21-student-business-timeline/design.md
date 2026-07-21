# 学员业务时间线设计

## 边界与数据流

```
既有不可变业务事实 + 新增学员状态事件
  → DB 时间线投影（机构、校区、角色裁剪；确定游标）
  → training.students.timeline oRPC 契约
  → 学员中心时间线面板
  → 受权限保护的财务/教务深链接
```

- 不建立资金、课时或报名的镜像表。时间线是只读投影，来源记录仍是唯一业务事实。
- 投影聚合报名创建、报名生命周期、账单开立、收款、续费、转课、退款、考勤、课消和新增的学员状态变更。
- 考勤与课消 `occurredAt` 固定取关联课次的 `startsAt`；其他事件取其领域发生时间（如 `receivedAt`、`refundedAt`、`issuedAt`、`effectiveAt`）。摘要可额外包含实际登记时间。

## 数据与排序

- 新增 `student_status_event`：`organizationId`、`studentId`、`campusId`、`beforeStatus`、`afterStatus`、`operatorUserId`、`occurredAt`、`id`；为 `(organizationId, studentId, occurredAt, id)` 建索引。
- `updateStudentRecord` 在同一事务内、仅在状态实际改变时写入状态事件；旧数据不回填。状态事件写入失败使档案更新整体回滚。
- `listStudentTimelineRecords` 用统一的 `UNION ALL` 投影取得事件。每项具有 `id`（`<kind>:<source UUID>`）、`kind`、`occurredAt`、`source`、摘要数据、可空操作人、可空导航目标。
- 全局排序为 `occurredAt DESC, kindRank DESC, sourceId DESC`。游标编码三元组，下一页查询用相同元组的严格“小于”条件，保证同一时间的并发事件不会重复、丢失或随机变位。
- 每页最多 50 项，默认 20 项；不额外建事件镜像或复制金额、余额、联系方式、退款原因和支付参考号。

## 授权与隐私

- 时间线入口沿用 `studentProcedure`，因此教师与财务角色不能通过新端点获得学员档案或联系人；查询仍在 DB 层以机构和学员所属校区范围复核。
- `owner`、`admin`、`campus_manager` 可见完整投影；`consultant` 仅见招生/报名与教学事件，财务事件（账单、收款、续费、转课、退款）完全不返回，不能从事件 ID 或链接目标推断隐藏资源。
- 每个财务、课次深链接的目标页继续通过已有 `financeProcedure` 或 `academicManagementProcedure` 查询，URL 参数只用于定位，绝不替代服务端权限校验。

## 契约与 UI

- 在 `packages/api/src/contracts/training.ts` 定义带判别 `kind` 的事件 schema、游标输入/输出和来源目标；Router 新增 `training.students.timeline`。
- API repository 负责 DB 记录到 UI 文案字段的受控映射；不把 `before`/`after` 审计 JSON 透传给 Web。
- 学员中心在档案编辑入口旁增加“业务时间线”详情面板，使用 `useInfiniteQuery`，分别呈现初始加载、空、错误重试、加载更多与移动端单列状态。
- 财务路由支持 `invoiceId` 搜索参数并打开对应账单详情；教务路由支持 `tab=lessons&lessonId`，加载并定位/高亮相应课次，必要时显示只读课次详情。来源链接仅在 API 返回目标时渲染。

## 兼容、发布与回滚

- 迁移为新增表和索引，不修改既有金额、课消或报名数据；旧学员不会获得伪造状态历史。
- 若需回滚应用，可保留新增状态事件表，不影响既有读写；新 API/前端入口移除后没有业务事实丢失。
