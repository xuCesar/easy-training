# 学员个人信息导出与删除(匿名化)技术方案

> 状态:设计稿 v0.2(2026-07-26,按代码盘点修订),#61 配套。实现前先经过此设计评审。

## 一、现状(2026-07-26 代码盘点)

**个人信息分布**(需导出/抹除的全部位置,file:line 见盘点记录):

| 位置 | 内容 | 对 student 的删除行为 |
| --- | --- | --- |
| `student` | 姓名、监护人姓名/电话(含归一化索引字段)、出生日期 | 主体 |
| `student_contact` | 联系人姓名、电话(含归一化)、关系 | cascade |
| `receipt_document.studentName` | 票据上的学员姓名快照(不可变票据) | FK restrict |
| `organization_audit_event.before/after` | 学员创建/更新等事件的字段快照 | 无级联,需单独处理 |
| `student_import_batch.errors`(jsonb) | 导入失败行可能含原始姓名/电话 | 无级联 |
| `student_merge.selection`(jsonb) | 查重合并的字段来源快照 | FK restrict |
| `operation_task.title/description` | 自由文本,可能含学员姓名 | FK restrict |
| `lead` / `lead_activity` / `lead_import_batch.errors` | 潜在学员/联系人姓名、电话、跟进内容 | 独立生命周期 |

**约束**:`invoice`、`enrollment`、`enrollment_registration`、`attendance`、
`receipt_document`、`manual_invoice_creation`、`student_merge` 对 `student.id`
均为默认 `onDelete`(restrict)——有业务历史的学员**无法物理删除**,
与财务法定留存要求一致。`student_contact` 及各 event 表为 cascade。

**学员状态机**:`active / trial / paused / graduated / at_risk`
(无"注销"态;`graduated` 为实际离读终态;查重合并用
`mergedIntoStudentId` 软删除)。

**既有能力**:
- 导出:`students.export`(CSV,按关键词/校区/状态/标签/负责人过滤,
  上限 5000 行,含姓名与主要联系人完整手机号,写 `student_exported` 审计);
  线索同样有含明文电话的导出。**无单学员完整档案导出**(不含考勤/财务明细)
- 删除:学员与线索均无删除 API;唯一硬删机制是查重合并的软删指针

## 二、设计决策

1. **删除 = 匿名化**(对有业务历史的学员)。物理删除仅允许无任何
   restrict 关联的"纯档案"学员——实现上先尝试物理删除,
   被 FK 拒绝则走匿名化,两条路径同一入口。
2. 匿名化不可逆、单事务完成、写 `student_anonymized` 审计事件
   (payload 仅含 studentId 与操作者,不含被抹除原值)。
3. 导出验收先复用现有 CSV 导出(关键词过滤到单学员);
   单学员完整档案导出(含报名/考勤/财务摘要)列为后续增强,不阻塞 #61。
4. 状态机不新增枚举值:匿名化学员保持既有状态并用
   `mergedIntoStudentId` 同款过滤思路——新增 `anonymizedAt` 时间戳列
   (一次迁移),列表/导出默认排除 `anonymizedAt IS NOT NULL`。

## 三、匿名化事务(anonymizeStudentRecord)

对目标 `studentId` 在单个事务内(先锁定机构,复用现有事务纪律):

1. `student`:`name` → `已注销学员-<8位随机码>`;`guardianName` → `''`;
   `guardianPhone`/`guardianPhoneNormalized` → `''`;`birthDate` → NULL;
   `anonymizedAt` → now()
2. `student_contact`:该学员全部行物理删除
3. `organization_audit_event`:`entityType='student' AND entityId=<id>` 的行
   **物理删除**——该表有 BEFORE UPDATE 触发器保证不可变,无法就地改写 payload;
   数据主体删除权优先于内部审计留存(审计另有 180 天保留策略),
   擦除动作以新的 `student_erased` 事件留痕
4. `receipt_document.studentName`:重写为匿名化姓名(金额、编号、时间不动)
5. `student_import_batch.errors`:含该学员电话/姓名的错误行按批次
   整体置 `[]`(试运行期批次少,可全量清理超过保留期的批次代替精准匹配)
6. `operation_task`:该学员关联任务的 `title`/`description` 追加人工复核清单
   (自由文本无法可靠自动抹除,列入操作 SOP 人工处理)
7. 指向该学员的 `lead`(convertedStudentId):`name`/`phone`/
   `phoneNormalized`/`note` 抹除,相关 `lead_activity.content` 置空
8. 写 `student_anonymized` 审计事件

电话归一化索引字段一并清空,保证匿名化后无法以电话反查。

## 四、API 形态

- `students.erase`:`organizationManagementProcedure`(owner/admin),
  输入 `{ studentId, confirmName }`(回填学员当前姓名二次确认);
  前置校验:无未结清 invoice(否则拒绝并提示先办结);
  行为:可物理删除则删除,否则匿名化;返回所走路径
- `leads.delete`:同权限层,单条删除;到期批量清理为后续定时任务

## 五、测试要求(实现时)

- 集成测试:匿名化后对 `student`、`student_contact`、
  `organization_audit_event`、`receipt_document`、`lead` 相关行做
  原姓名/电话字符串全表断言(零残留);invoice/payment 金额与
  enrollment 记录保持不变;列表与导出不再返回该学员
- 未结清费用拒绝路径;纯档案学员物理删除路径;审计事件不含原值

## 六、与保留策略的衔接

《数据保留与清理策略》的到期清理即批量调用本能力:
`graduated` 满 N 年 → erase;线索最后活动满期 → delete。
试运行期人工触发,数据量上升后定时化。
