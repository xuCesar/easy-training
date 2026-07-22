# 实施计划

## 1. 契约与历史重放内核

- [ ] 提取/复用 T5 envelope、ratio、范围解析和 registry 边界，定义 financial summary、signed trend、aging bucket、data quality 与 drilldown Zod 契约。
- [ ] 锁定 `contractVersion=1` 和 financial 独立 definitionVersion；既有四类版本保持不变，并补旧客户端兼容与全部公开财务指标 schema/gold fixture。
- [ ] 定义可注入 `asOf` 的 30 日窗口、历史 cutoff、上海到期日差与左闭右开边界测试。

## 2. 稳定账单归属事实

- [ ] 新增 additive `invoice_metric_fact` schema、campus/course 归属三态、复合机构外键和必要索引；第一阶段 migration 只建表/约束，生成并审查 SQL。
- [ ] 为 adjustment version 唯一索引先做存量重复预检；定义 `(createdAt,afterVersion,id)` 稳定排序与完整链校验。
- [ ] 接入线索转化、独立报名、续费、手工开单四类 writer，同事务写发生时校区/课程/名称快照；事实失败回滚原开单。
- [ ] writer 部署后记录 invoice 高水位，运行幂等 backfill/catch-up：只从稳定事实证明 linked/notApplicable，无法证明使用 unknown，绝不覆盖 native fact。
- [ ] 测试四类成功、失败、幂等/并发既有路径与跨机构一致性，证明旧页面投影无回归。

## 3. DB 聚合与下钻

- [ ] 实现共享 invoice terms cutoff replay，覆盖 adjustment 前、链中、链后、稳定排序、重复/分叉/断裂和末端投影不一致。
- [ ] 实现 signed payment/reversal/refund 事件流及上海日/周/月净回款趋势，允许负桶并返回各组成金额。
- [ ] 实现成熟 30 日开单 cohort，覆盖零金额、未成熟、窗口内外资金/调整、eventAt 早于 issuedAt、净分子越界和事实缺口；异常排除/不可用，不裁剪。
- [ ] 实现历史 aging snapshot，统一 `outstanding=terms-(payment-reversal)`，refund 只影响净回款；覆盖五档、部分收款、冲正、部分/全额退款、退款/结算矛盾、超额/负余额和总额守恒。
- [ ] 实现财务事件/应收账单受控下钻，稳定游标、最大 50、最小必要字段和同一查询内权限重验。
- [ ] 所有查询限制 organizationId 与 invoice fact campusId；最长两年本地 explain 后只补必要索引，记录生产真实量 explain 门禁。

## 4. API 授权与 registry

- [ ] 新增 financial repository/domain entry 并注册到 T5 definition registry；summary、comparison 和 drilldown 复用同一内核。
- [ ] owner/admin 全机构，campus_manager/finance 授权校区；consultant/teacher 明确 FORBIDDEN，客户端不能提交租户/校区/身份。
- [ ] 映射范围/游标参数错误、无权和内部错误；ISO 时间、整数分、不可用原因和数据质量通过契约解析。

## 5. 测试与质量门

- [ ] PostgreSQL 固定 fixture 覆盖跨日/负数净回款、30 日边界、历史 adjustment、五档 aging、退款不重开应收和归属缺口。
- [ ] 权限测试覆盖跨机构、全/选定/空校区、四种财务角色、consultant/teacher、越权 drilldown 与深链接标识；校区受限响应不得泄露机构级未归属数量或金额。
- [ ] 运行 migration 生成/应用、相关测试和全量 `pnpm test:integration`、`pnpm check-types`、`pnpm check`、`pnpm build`、`git diff --check`。

## 6. 发布与回滚审查

- [ ] 确认“建表→writer→高水位 backfill/catch-up→reconciliation→reader”顺序，四类 writer 失败回滚，并设置禁止无 writer 版本恢复流量的版本下限。
- [ ] 确认 shadow read、事实覆盖计数和本地 explain 结果；生产真实数据量 explain 保留为开放 reader 前门禁。
- [ ] 确认回滚只关闭 financial reader/drilldown，保留 additive schema、事实和 writer；不得删除历史事实。
