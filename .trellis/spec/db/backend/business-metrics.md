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
