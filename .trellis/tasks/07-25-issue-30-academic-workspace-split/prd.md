# Issue 30 教务工作区渐进拆分

## Goal

将 `academic-workspace.tsx` 的面板、编辑器和对话框按现有 feature 边界拆分，降低单文件维护成本，同时保持 URL、ORPC 合同、tab 门控查询、cursor 分页和用户可见行为不变。

## Confirmed Facts

- `academic-workspace.tsx` 共 2,591 行，已经含有 `ClassesPanel`、`LessonsPanel`、`CoursesPanel`、`TeachersPanel`、编辑器、取消课次、成员和考勤对话框等独立职责。
- #43 已实现按 tab 门控查询及班级/课次 cursor 分页；容器必须继续保留这些查询编排逻辑。
- 独立工作流已有同目录组件模式，如 `bulk-reschedule-dialog.tsx`、`makeup-lesson-dialog.tsx` 与 `schedule-rules-dialog.tsx`。

## Requirements

- 将稳定面板和编辑器移至 `apps/web/src/features/training/academic/` 下的职责明确模块，使用显式 props，不引入新状态管理或依赖。
- `AcademicWorkspace` 保留路由输入、组织上下文、tab 查询门控、分页、mutation 刷新和跨面板目标状态。
- 保持导出的 `AcademicWorkspace`、ORPC 路径、query key、URL search 参数、校区权限与可见文案不变。

## Acceptance Criteria

- [ ] AC1：工作区容器显著缩小，面板与编辑器有单一文件边界。
- [ ] AC2：班级/课次的 tab 门控与 cursor 分页保持原语义。
- [ ] AC3：类型检查、Biome 检查、Web 构建通过；无公开 API 变更。

## Out of Scope

- 读取错误态、危险对话框 pending 守卫、requestId 生命周期及无障碍修复（由第三子任务承担）。
- 修改排课、补课、考勤或权限业务规则。
