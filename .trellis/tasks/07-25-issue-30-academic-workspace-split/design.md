# 教务工作区渐进拆分设计

## 边界

`AcademicWorkspace` 继续持有页面级 query/mutation 编排和跨工作流状态。提取组件只接收数据、加载/错误状态和回调，不直接创建平行 ORPC 查询。

先提取无跨面板状态的展示面板与通用表单字段；随后提取课程、教师、班级和课次编辑器。对话框已有独立组件的继续复用，不改变打开/关闭状态所有权。

## 兼容性

不改动 `/_auth/academic`，不改 search schema，不改变 query keys、`enabled` 条件、page size 或失效策略。此提交的 diff 应主要是移动、导入和 props 显式化。
