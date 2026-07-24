# Quality Guidelines

> Code quality standards for backend development.

---

## Overview

<!--
Document your project's quality standards here.

Questions to answer:
- What patterns are forbidden?
- What linting rules do you enforce?
- What are your testing requirements?
- What code review standards apply?
-->

(To be filled by the team)

## Scenario: 多维经营对比查询

### 1. Scope / Trigger

- 当分析页需要按校区、课程、教师或班级比较经营指标时，必须使用统一的 `training.analytics.comparison` 过程。
- 该过程跨越数据库聚合、API 契约、角色授权和 Web 标签请求，属于跨层只读查询。

### 2. Signatures

- API：`training.analytics.comparison(input: BusinessMetricComparisonInput) -> BusinessMetricComparisonResult`
- 输入：`range`、`dimension`（`campus | course | teacher | class`）、`sortBy`、`sortDirection`。
- 数据库：仓储接收服务端解析的 `organizationId`、`campusAccess` 和可选 `teacherUserId`，不得从 input 接受租户边界。

### 3. Contracts

- 响应必须带 `contractVersion`、`definitionVersion`、`timezone`、当前区间与对比区间。
- 每行同时返回 `current` 与 `comparison`；比例使用 `available/notApplicable` 判别联合，不能用 0 代替无分母。
- 维度无法关联的财务事实归入 `未关联课程 / 其他业务`（课程维度）或数据质量计数，并保留负数净回款。
- Web 只在角色可见标签激活时发起请求；教师/顾问的财务字段由服务端裁剪，不能依赖前端隐藏。

### 4. Validation & Error Matrix

- 未认证：由 `organizationProcedure` 返回认证错误。
- 无组织成员关系或越权校区：服务端范围裁剪；不能通过 dimension 或排序参数扩大范围。
- finance：只能访问财务标签，comparison 过程返回 `FORBIDDEN`。
- consultant：仅允许脱敏校区基准；teacher：仅允许本人教师和班级维度。
- 数据库异常：返回统一的“暂时无法加载经营对比”内部错误，不泄露 SQL 或连接信息。

### 5. Good/Base/Bad Cases

- Good：机构管理员按校区排序，得到全部授权行及当前/对比期服务端指标。
- Base：空机构返回合法 envelope 与空行；没有容量时返回“暂不可计算”，而不是 0%。
- Bad：在 React 中重新按明细累加、把无分母比例写成 0%、或把隐藏对象数量用于排名。

### 6. Tests Required

- 空机构：所有四个维度 SQL 可执行，返回合法 schema 和空行。
- 金值：校区课次数、净回款、负数回款及对比期结果与不可变事实一致。
- 权限：finance/consultant/teacher 的过程和标签范围分别断言；校区范围不能看到其他校区。
- 前端：标签切换不触发无权请求，390px 核心指标不依赖横向滚动。

### 7. Wrong vs Correct

#### Wrong

```ts
// 前端取得明细后自行按课程求和，并用 0 表示无分母
const rate = denominator === 0 ? 0 : numerator / denominator;
```

#### Correct

```ts
// 统一服务端过程返回已授权的 current/comparison 与判别联合
const result = await orpc.training.analytics.comparison.query({
	input: { range, dimension: "course", sortBy: "lessonCount", sortDirection: "desc" },
});
```

---

## Forbidden Patterns

<!-- Patterns that should never be used and why -->

(To be filled by the team)

---

## Required Patterns

<!-- Patterns that must always be used -->

(To be filled by the team)

---

## Testing Requirements

<!-- What level of testing is expected -->

(To be filled by the team)

---

## Code Review Checklist

<!-- What reviewers should check -->

(To be filled by the team)
