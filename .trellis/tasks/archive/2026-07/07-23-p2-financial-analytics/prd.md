# P2 财务经营分析

## Goal

基于不可变资金事实交付净回款趋势、30 日开单 cohort 回款率和历史应收账龄，让 owner、admin、campus_manager 与 finance 在授权校区范围内直接判断回款质量和欠费结构，不依赖当前账单快照或人工 Excel 汇总。

## Background

- T5 已提供 `contractVersion=1`、上海时间范围、对比区间、粒度、不可用原因、数据质量和定义 registry，本任务必须复用该内核。
- `payment`、`paymentReversal`、批准后生成的 `refund` 与 `invoiceAdjustment` 是可重放事实；`invoice.paidAmountInCents/status/dueDate/amountInCents` 是当前投影，不能单独证明历史状态。
- 当前账单校区读取依赖 `student.campusId`，学员转校后会改变；财务历史必须保存账单发生时校区。课程维度也必须稳定关联，手工账单允许没有课程。
- 现有财务授权角色为 owner、admin、campus_manager、finance，并已提供服务端校区范围；consultant 与 teacher 无财务分析权限。

## Requirements

### R1. Common Contract and Scope

- 复用 T5 的上海时区、范围预设、自定义范围、左闭右开边界、对比范围、粒度、`contractVersion`、`definitionVersion`、比率和数据质量语义。
- 客户端只能提交时间范围、允许的维度/排序和受控游标；organizationId、campusIds、角色与身份全部由服务端当前机构上下文装配。
- owner/admin 读取全机构；campus_manager 与 finance 只读取授权校区；consultant、teacher 返回明确 `FORBIDDEN`，不能以空数据代替无权。
- owner/admin 的全机构视图可将无法证明校区的旧事实计入“未归属”及覆盖计数；校区受限角色只能读取已证明属于授权校区的事实，不返回机构级未归属数量/金额，只给非定量覆盖提示，避免推断其他校区规模。
- 财务指标加入统一定义 registry，供后续多维对比和 T7 报表复用；Web 或导出不得复制公式。
- `contractVersion` 继续为 1；既有 sales/attendance/consumption/renewal 保持原 definitionVersion，financial 使用独立 definitionVersion。不得为新增指标无条件提升全局 literal 使旧消费者解析失败。

### R2. Stable Invoice Attribution

- 所有新开账单在原事务保存发生时校区、可空课程和必要名称快照；线索转化、独立报名、续费、手工开单四类路径必须同事务成功或回滚。
- 手工账单没有关联报名/课程时归入“未关联课程 / 其他业务”，仍计入机构和校区总额。
- 课程归属必须区分 `linked`（明确课程）、`notApplicable`（合法无课程的其他业务）与 `unknown`（历史无法证明）；“其他业务”和“课程归属缺失”不得合并。
- 旧账单只从不可变报名、续费购买周期、手工开单等事实回填可证明的校区/课程归属；不得用学员当前校区或当前课程名称猜测历史。
- 无法证明归属、名称或资金明细的旧记录保持可空，并返回事实覆盖缺口；不能静默排除后仍宣称总额完整。

### R3. Net Receipt Trend

- 净回款按资金自己的发生时间进入上海业务日桶：`payment.receivedAt` 为正，`paymentReversal.reversedAt` 和批准后 `refund.refundedAt` 为负。
- 趋势点允许为负数；汇总返回收款、冲正、退款和净回款四个整数分金额，以及主范围与对比范围。
- 冲正和退款不得改写原收款所属日期；待审批、已拒绝或已取消退款申请不进入任何财务指标。
- 按校区过滤使用账单发生时归属，不使用学员当前校区或操作者校区。

### R4. 30-day Invoice Cohort Collection Rate

- cohort 为所选范围内 `issuedAt` 的账单，固定观察开具后 30 个自然日；只有 `issuedAt + 30 days <= asOf` 的账单进入成熟 cohort。
- 正式回款率分子为观察窗内有效净收款，分母为观察截止时点经不可变调整重建的应收金额；返回整数分分子/分母、成熟/未成熟账单数和最短剩余观察天数。
- 若资金事件早于账单开具、窗口净分子小于 0 或大于分母、或调整链无法完整重放，该账单计入 chronology/settlement/fact coverage 异常并从正式比率排除或返回不可用；不得静默裁剪为 0。
- 未满 30 日账单单列，不进入正式比率；观察窗后的收款、冲正、退款或调整不回写 30 日指标，但仍进入各自发生期间的净回款与查询截止时点账龄。
- 零金额账单不增加金额分母，单独返回数量且不因没有 payment 被误报为资金缺口；正金额账单缺少具体资金流水、无法历史重建时不使用当前已收投影补造，计入覆盖缺口。

### R5. Historical Accounts-receivable Aging

- 应收账龄快照时点为 `min(所选范围结束时点, asOf)`；对比范围使用自己的结束时点，支持真实历史月末比较。
- 只纳入快照时点前已开具的账单，并使用截至该时点最后一条调整重建金额与到期日；不能直接读取当前金额或当前到期日。
- 有效结算金额固定为截至快照的收款减冲正；退款只影响净现金流，永不减少结算金额或重新制造应收，因此部分/全额退款都不需要额外账龄特判。
- 未收余额按上海业务日期进入：未到期、逾期 1–30、31–60、61–90、90 天以上五档；每档返回金额和账单数，总额可与档位之和核对。
- 发现异常负余额、超额结算、调整链断裂或旧账单缺少可重放资金明细时返回数据质量计数，不把异常裁剪成看似正常的零值。

### R6. Controlled Drill-down and Errors

- 提供受控财务事件与应收账单下钻，使用稳定 `(occurredAt,id)` 或等价复合游标、最大 50 条，并在每次查询重新执行机构/校区/角色范围。
- 下钻只返回核对所需的账单/资金事实 ID、类型、金额、发生时间、账龄档位和授权深链接，不返回联系人、备注、退款原因或其他不必要隐私。
- 深链接进入既有财务详情后再次鉴权；无效范围/游标为 `BAD_REQUEST`，无权为 `FORBIDDEN`，内部查询失败统一为不泄露 SQL 的系统错误。

### R7. Compatibility, Performance, and Rollout

- 只做 additive schema/migration；旧财务页面和 `invoice` 当前投影行为保持兼容，不改变任何收款、冲正、退款或账单调整业务规则。
- 发布顺序固定为：仅建表 → 部署所有开单 writer → 记录高水位并幂等 backfill/catch-up → reconciliation/shadow query → 开放 reader。回滚 reader 时保留事实 writer，并设置 writer 版本下限，禁止恢复不写事实的开单版本。
- 查询范围最长两年；在本地固定 fixture 与部署前真实数据量执行 `EXPLAIN (ANALYZE, BUFFERS)`，只依据真实计划增加索引，不在本任务引入缓存、物化视图或预聚合。

## Acceptance Criteria

- [ ] 四类开单路径同事务保存发生时校区/课程归属；旧数据只回填可证明事实，缺口被明确计数。
- [ ] 净回款在跨日收款、部分/全额冲正、批准退款及负数日桶场景下按各自发生时间正确计算，主/对比范围可核对。
- [ ] 30 日开单 cohort 只使用成熟账单和窗口内不可变事实，正确处理未成熟、零金额、窗口后资金与调整事件。
- [ ] 历史账龄在金额/到期日调整、部分收款、冲正、部分/全额退款及历史截止日场景下重建正确，五档金额与总额守恒。
- [ ] owner/admin、campus_manager、finance 的机构/校区范围正确；consultant、teacher 及越权下钻明确拒绝且不泄露财务规模。
- [ ] 固定 PostgreSQL 金值测试、迁移/双写回滚、Zod 契约解析、两年范围 explain、`pnpm test:integration`、类型检查、Biome 和构建通过。

## Dependencies and Out of Scope

- 依赖 T5 指标时间内核/registry，以及现有 payment、payment reversal、approved refund、invoice adjustment 和财务校区授权。
- 本子任务交付财务事实、查询契约和受控下钻；`/analytics` 标签与最终可视化由后续 `07-23-p2-management-comparison-ui` 集成。
- 不包含总账、会计凭证、税务口径、利润、预算、工资/提成、预测、自动催收、导出或定时报表。

## Rollout and Rollback

- additive migration 上线后先启用归属双写和 shadow read；事实覆盖与金值核对通过后，后续 UI 子任务才能开放财务标签。
- 回滚只关闭财务 reader/下钻，保留账单归属事实和 writer；禁止删除历史归属或回退到继续制造数据断层的写入版本。
