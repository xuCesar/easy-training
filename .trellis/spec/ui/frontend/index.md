# 共享 UI 规范

- 先加载 [项目级工程约束](../../guides/project-conventions.md)。
- `packages/ui/src/components` 只放跨应用复用的基础组件，业务组合组件保留在 `apps/web/src/features`。
- 沿用现有 shadcn/ui、Tailwind CSS 和 `cn()` 合并 className；不引入第二套组件库或样式范式。
- 组件保持受控状态和可组合 API，向外暴露明确 TypeScript 类型，不使用 `any` 绕过第三方组件类型。
- 新增或修改表单、Dialog、Sheet、Dropdown 等组件时检查键盘操作、焦点、禁用/提交中状态、错误反馈和移动端表现。
