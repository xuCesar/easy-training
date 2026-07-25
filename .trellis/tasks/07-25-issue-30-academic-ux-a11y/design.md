# 交互可靠性与无障碍设计

保持容器的 query/mutation 所有权。对话框以 mutation `isPending` 作为关闭守卫；请求 ID 以组件级 ref 固定一个打开会话。复用现有 `PanelState` 处理读取状态，并以显式 `aria-label` 或关联 `FieldLabel` 提供名称。
