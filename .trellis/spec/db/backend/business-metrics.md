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

## Scenario: 教师与班级资源利用

### 1. Scope / Trigger

- 适用于 `training.analytics.resource`、`getResourceUtilizationRecord` 与教师、班级容量历史写入。

### 2. Signatures

- 教师/班级维护输入可选 `capacityEffectiveFrom: YYYY-MM-DD`；DB 读取入口为 `getResourceUtilizationRecord({ scope, from, to, asOf })`。

### 3. Contracts

- 容量历史按上海业务日生效；同一资源和日期幂等更新。
- `teacher.weeklyCapacityHours`、`classGroup.capacity` 是“今天已生效的最新版本”投影。补录过去版本或未来版本不得覆盖该投影。
- 课次上座率分子仅计 `present`、`late`；缺勤和请假不属于实际到场。

### 4. Validation & Error Matrix

| 条件 | 结果 |
| --- | --- |
| 当前投影容量低于 active 学员数 | `CLASS_CAPACITY_TOO_LOW` |
| 仅补录过去的较低容量、当前投影仍足够 | 允许保存历史版本 |
| 容量历史缺失 | 返回 `notApplicable` 与数据质量计数 |

### 5. Good / Base / Bad Cases

- Good：补录一年前的容量 10，今天生效的容量仍为 20，班级当前容量不变化。
- Base：同日再次保存容量，更新同一历史版本。
- Bad：以过去的输入容量直接覆盖当前班级容量，导致报名校验和经营面板同时失真。

### 6. Tests Required

- PostgreSQL 集成测试覆盖教师与班级的历史补录不覆盖当前投影，且班级已有 active 学员时仍可补录过去容量。
- 使用独立 mock 机构运行两年 `EXPLAIN (ANALYZE, BUFFERS)`；全机构和单校区均需记录执行时间与索引命中情况。

### 7. Wrong vs Correct

#### Wrong

```ts
await tx.update(classGroup).set({ capacity: input.capacity });
```

#### Correct

```ts
const projectedCapacity = await currentClassGroupCapacity(tx, organizationId, classGroupId);
await tx.update(classGroup).set({ capacity: projectedCapacity ?? input.capacity });
```

## Scenario: 个人保存筛选与受控即时 CSV

### 1. Scope / Trigger

- 适用于 `training.analytics.savedFilters.*` 与 `training.analytics.export`，以及 `analytics_saved_filter` 的持久化。

### 2. Signatures

- DB：`list/create/update/deleteAnalyticsSavedFilter` 与 `recordAnalyticsExport`；所有操作传入服务端解析的 `organizationId`、`userId`。
- API：配置固定为 `overview | comparison | resourceFinance`；comparison 额外包含受限维度与排序。

### 3. Contracts

- 保存记录仅存经 Zod 校验的配置，不存 SQL、结果、权限快照或对象范围；列表与变更必须同时按机构和成员过滤。
- 导出每次重新按当前角色和校区范围执行指标过程；CSV 为 UTF-8 BOM，所有单元格使用 `quoteCsv`，不输出当前角色不可见的金额列。
- 同步导出自定义范围最长 366 天、对比最多 1,000 行、响应最大 1 MiB；成功审计仅记录 `reportKind` 与 `rowCount`。

### 4. Validation & Error Matrix

| 条件 | 结果 |
| --- | --- |
| 跨成员或跨机构读取、更新、删除保存记录 | `NOT_FOUND`，不推断记录存在 |
| 同成员同标签筛选重名 | `CONFLICT` |
| 当前角色不再可访问标签或维度 | `FORBIDDEN` |
| 自定义导出范围超 366 天、行数或响应超限 | `BAD_REQUEST`，不生成空文件或后台任务 |

### 5. Good / Base / Bad Cases

- Good：成员保存校区对比，导出时按其当前校区范围重新查询，导出的排序与页面一致。
- Base：教师导出资源摘要时财务列为“不适用”；财务人员仅导出资源与财务可见摘要。
- Bad：将 React 缓存的行、完整筛选 JSON 或 CSV 内容写入审计，或以保存筛选恢复已撤销的权限。

### 6. Tests Required

- PostgreSQL 集成测试覆盖成员/机构隔离、重名冲突、CSV BOM 与公式转义、角色列裁剪、366 天限制及最小导出审计。
- 页面验证保存、应用、重命名更新、删除、导出，以及桌面和 390px 的加载/错误/无权状态。

### 7. Wrong vs Correct

#### Wrong

```ts
return { csv: buildCsvFromReactCache(savedFilter.rows) };
```

#### Correct

```ts
const result = await getBusinessMetricComparison(currentScope, config);
const csv = toProtectedCsv(result.rows);
await recordAnalyticsExport({ organizationId, userId, reportKind, rowCount: result.rows.length });
```
