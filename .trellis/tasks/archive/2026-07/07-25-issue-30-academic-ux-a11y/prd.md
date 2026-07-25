# Issue 30 教务交互可靠性与无障碍

## Goal

让教务读取失败、危险写入提交、编辑重试和表单控件具备清晰、可恢复且可访问的交互语义，不改变业务规则或 ORPC 合同。

## Requirements

- 查询错误不得伪装为空态，提供重试入口。
- 危险 mutation 提交中禁止 Escape、遮罩、关闭按钮和 `onOpenChange` 关闭对话框。
- 编辑会话生成并复用 `requestId`；成功或关闭后才释放，下一会话使用新 ID。
- Select 与复选框具有明确可访问名称。

## Acceptance Criteria

- [x] 错误、加载、空态可区分并可重试。
- [x] 提交中无法关闭危险对话框，失败后恢复可操作。
- [x] 同一编辑会话重试使用相同 `requestId`。
- [x] 受影响控件具有关联标签或 `aria-label`。
