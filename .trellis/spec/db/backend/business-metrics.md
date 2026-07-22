# 经营指标契约

## 1. Scope / Trigger

- 适用于招生结案与 30 天线索 cohort、到课与补课、不可变课消、续费机会，以及后续 T6 经营对比和 T7 报表。
- 指标读取必须复用 `packages/api/src/repositories/business-metrics.ts` 的定义注册表，不扩展实时 `training.snapshot`，也不在 Web、下钻或导出中复制公式。

## 2. Signatures

- API 输入：`BusinessMetricQueryInput`，只允许预设范围或上海自然日期 `{ preset: "custom", from, to }`。
- 领域入口：`getBusinessMetricSales/Attendance/Consumption/Renewal(scope, input, now?)`。
- DB 入口：`getBusinessMetric*Record({ organizationId/campusAccess/identity, from, to, asOf? })`。
- oRPC：`training.analytics.sales | attendance | consumption | renewal | drilldown`；下钻输入固定 `kind`、最大 50 条和 `(occurredAt,id)` 游标。

## 3. Contracts

- 响应固定包含 `contractVersion`、`definitionVersion`、`timezone=Asia/Shanghai`、`asOf`、主范围、对比范围、粒度和 `dataQuality`。
- 范围左闭右开；滚动范围比较紧邻的等长前序区间，自然周期比较上一周期的相同已过时长。
- 比率返回 `available(value/numerator/denominator)` 或 `notApplicable(reason)`；无分母、未成熟 cohort、样本不足和事实覆盖缺失不能伪装为 0%。
- 销售使用结案时归属和校区；教学使用课次发生时校区和教师；消课按 `lesson.startsAt` 的上海业务日；续费机会观察窗为 30 个有效日，冻结期间暂停。
- PostgreSQL `sql<Date>` 只是 TypeScript 提示，原生 `date_trunc ... at time zone` 在运行时可能返回字符串。API 边界必须使用 `new Date(value).toISOString()` 显式序列化，不能直接调用 `value.toISOString()`。
- 下钻必须重新执行相同的 organization/campus/consultant/teacher 范围；顾问归属标签只返回“本人”，不能借校区基准暴露其他顾问姓名。

## 4. Validation & Error Matrix

| 条件 | 结果 |
| --- | --- |
| 自定义结束日期不晚于开始日期或跨度超过两年 | `BAD_REQUEST` |
| finance 读取 T5；consultant 读取教学/续费；teacher 读取销售/续费 | `FORBIDDEN` |
| 比率分母为 0 | `notApplicable/noDenominator` |
| 顾问校区基准少于 5 个有效结案周期 | `notApplicable/insufficientSample` |
| 对比续费 cohort 仍有未成熟机会 | `notApplicable/immatureCohort` |
| 旧报名缺少购买周期或线索里程碑 | 返回数据质量计数，不从当前快照猜测历史 |

## 5. Good / Base / Bad Cases

- Good：线索流失后重开并由另一顾问成交，两个周期分别按结案快照计数；直接报名独立统计，不合成线索。
- Base：补课成员从主到课率排除，`fulfilled/scheduled/needs_reschedule` 共同构成补课完成率分母。
- Bad：按 `consumedAt` 归属业务日期、用当前负责人/校区改写历史，或看到 conversion 关联就忽略冻结时长和 30 日边界。

## 6. Tests Required

- 固定 PostgreSQL fixture 断言多结案周期、跳阶段、直接报名和顾问基准 4/5 样本边界。
- 断言正常/补课混合考勤、上海日桶、超过课次结束 24 小时的晚录计数。
- 断言续费成功、过期、冻结暂停、提前续费、缺失购买周期和剩余观察天数。
- 覆盖 organizationId、校区、顾问本人、教师本人和 finance 明确无权；契约结果必须经过 Zod schema parse。
- Web 至少验证桌面和 390px、自定义范围、加载/空/错误/无权/样本不足/未成熟且无横向溢出。

## 7. Wrong vs Correct

### Wrong

```ts
const bucketStart = row.bucketStart.toISOString();
const conversionRate = converted / closed;
```

这会在 PostgreSQL 返回原生字符串时运行时报错，并把无分母结果变成 `NaN`。

### Correct

```ts
const bucketStart = new Date(row.bucketStart).toISOString();
const conversionRate = ratio(converted, closed);
```

在 API 边界完成时间序列化，并由统一 ratio helper 保留不可计算原因。

## Scenario: 财务回款、cohort、账龄与受控下钻

### 1. Scope / Trigger

- 适用于 `training.analytics.financial`、`financialDrilldown` 和
  `financialAgingDrilldown`，以及所有读取 `invoice_metric_fact` 的 DB 查询。
- 财务角色为 owner、admin、campus_manager、finance；consultant 与 teacher 必须返回 `FORBIDDEN`。

### 2. Signatures

- DB：`getFinancialReceiptRecord`、`getFinancialCohortRecord`、`getFinancialAgingRecord`、`getFinancialReceiptEventPage`、`getFinancialAgingInvoicePage`。
- API：`getBusinessMetricFinancial(scope, input, asOf?)`。
- API 下钻：输入最多 50 条，游标为 `{ occurredAt, id }`；事件类型为 payment、reversal、refund，账龄下钻使用账单 issuedAt 作为 occurredAt。

### 3. Contracts

- 财务结果固定 `contractVersion=1`、`definitionVersion=2026-07-23`、`timezone=Asia/Shanghai`，金额全部为整数分。
- 净回款按资金事实自身发生时间计入：payment 为正，payment reversal 与已批准 refund 为负；退款申请未生成 refund 事实前不参与指标。
- cohort 只筛范围内 issuedAt，`issuedAt + 30 天 <= asOf` 才成熟；观察窗后资金不回写 cohort，分母按观察截止前 adjustment 链重放。
- 账龄快照为 `min(range.to, asOf)`；条款使用截止前最后 adjustment 重放，结算为 payment 减 reversal，refund 不重新制造应收；异常不裁剪为零。
- 所有查询必须同时限制 organizationId 与账单发生时 `invoice_metric_fact.campusId`；下钻响应只返回事实 ID、金额、发生时间、账龄桶和 `/finance/invoices/:invoiceId` 深链接，不返回联系人、备注或退款原因。
- 全机构视图可返回未归属/缺失计数；受限校区视图将定量缺口置零，只返回 `scopeCoverageIncomplete` 布尔值。

### 4. Validation & Error Matrix

| 条件 | 结果 |
| --- | --- |
| 非财务角色读取 summary 或下钻 | `FORBIDDEN` |
| 范围超过两年、日期逆序、游标 UUID/时间非法或 limit > 50 | `BAD_REQUEST` |
| 资金早于 issuedAt、cohort 净分子小于 0 或大于分母 | 计 chronology/settlement anomaly，并排除正式比率 |
| adjustment 链缺首版本、断裂、重复或末端版本不一致 | 计 adjustment-chain anomaly，不使用当前投影补造历史 |
| 查询内部失败 | `INTERNAL_SERVER_ERROR`，不得暴露 SQL 或机构规模 |

### 5. Good / Base / Bad Cases

- Good：跨日收款、冲正和批准退款分别落入自己的上海业务日桶；账龄在到期日当天仍为未到期。
- Base：无课程的手工账单仍计入总额，课程归属使用 `notApplicable`；历史无法证明校区的账单在全机构视图计入覆盖缺口。
- Bad：用学员当前校区、当前 invoice paidAmount 或退款后投影推断历史 cohort/账龄，或在受限校区响应返回机构级未归属金额。

### 6. Tests Required

- PostgreSQL 金值 fixture 覆盖跨日负桶、30 日成熟边界、窗口后资金、adjustment cutoff、五档账龄、部分/全额退款不重开应收。
- 覆盖 owner/admin 全机构、campus_manager/finance 授权校区、consultant/teacher 拒绝，以及跨机构和越权下钻。
- 每个公开结果必须经过 Zod schema parse；分页断言稳定 `(occurredAt,id)` 游标、最多 50 条和最小字段投影。
- 运行 `pnpm test:integration`、`pnpm check-types`、`pnpm check`、`pnpm build` 与 `git diff --check`；生产数据量 explain 是开放 reader 前门禁。

### 7. Wrong vs Correct

#### Wrong

```ts
const outstanding = invoice.amountInCents - invoice.paidAmountInCents;
const campusId = student.campusId;
```

这会把当前投影和当前学员校区错误地回写到历史快照。

#### Correct

```ts
const terms = replayInvoiceAdjustments(invoiceId, snapshotAt);
const outstanding = terms.amountInCents - paymentsBeforeCutoff + reversalsBeforeCutoff;
const campusId = invoiceMetricFact.campusId;
```

历史金额、校区和课程均从不可变事实及查询时点重放，异常通过数据质量字段暴露。
