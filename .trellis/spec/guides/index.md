# 项目规范入口

开发前按任务范围加载以下规范，避免一次注入全部模板：

| 规范 | 使用时机 |
| --- | --- |
| [项目级工程约束](./project-conventions.md) | 所有编码、审查和数据库任务 |
| [跨层检查](./cross-layer-thinking-guide.md) | 同时影响 Web、API、认证或数据库 |
| [代码复用检查](./code-reuse-thinking-guide.md) | 新增组件、hook、工具函数或 repository 前 |

各 workspace 的 `index.md` 是包级入口。未被入口引用的 Trellis 占位文件不是当前项目规范，不应加入任务上下文。
