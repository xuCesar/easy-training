# P1 技术设计：学员档案、家长联系人与标签

## Architecture

保持既有 `contracts -> API adapter/router -> DB repository` 分层，并新增独立 `students` 领域。所有 repository 接收由当前会话解析出的 `organizationId` 与 `CampusAccess`，不接受客户端的机构边界。

新增的 `studentProcedure` 仅允许 `owner`、`admin`、`campus_manager`、`consultant`。标签字典的管理过程额外要求 `owner` 或 `admin`。所有角色判定在 API 层完成，数据范围和写入安全在 DB transaction 中再次复核。

## Data Model

新增三张追加式表，不删除或放宽现有 `student` 字段：

- `student_contact`：`student_id`、姓名、手机号、可选关系称谓、`is_primary`、时间戳。为每位既有学员从 `guardian_name` / `guardian_phone` 回填一条主要联系人；对每个学员建立部分唯一索引，保证至多一条主要联系人。
- `student_tag`：`organization_id`、`name`、`name_normalized`、`is_active`、时间戳；`organization_id + name_normalized` 唯一。
- `student_tag_assignment`：`student_id`、`student_tag_id`、时间戳，以 `(student_id, student_tag_id)` 作为主键或唯一约束。

每次创建或更新联系人时以事务锁定学员及联系人，应用层保证至少一条且仅一条主要联系人。主要联系人变化同事务回写 `student.guardian_name` / `student.guardian_phone`；这样旧的转报名匹配与新联系人模型只有一个业务主数据来源。

标签停用只改变 `is_active`。读取档案时返回已关联的停用标签，写入标签关联时仅允许启用标签。标签属于机构，关联和读取始终通过学员的机构归属校验。

## Query And Write Rules

列表与详情对 `student.campus_id` 套用现有 `CampusAccess` SQL 谓词。详情一次读取学员、联系人和标签；列表返回主要联系人姓名与脱敏手机号，不返回完整联系人集合。

创建、更新基础档案、更新联系人、替换标签和更新状态都在事务中：锁定学员、验证其机构与可访问校区、验证校区仍启用，再执行变更。创建时也锁定并确认目标校区。学员校区本期不可更新。

联系人手机号只在详情和写入中完整存在；API 的列表结果、异常消息、审计快照和日志不得包含完整手机号。服务端不通过提前查询暴露手机号是否已存在。

## API Contract

在 `training.students` 下提供：

- `list`：分页、搜索、校区/状态/标签筛选；返回脱敏摘要。
- `get`：档案详情、完整联系人和当前标签。
- `create`：基础档案、至少一位主要联系人和初始标签。
- `update`：姓名、出生日期、状态、完整联系人列表和完整标签 ID 集合；不接受校区变更。
- `tags.list`：授权学员角色读取可用标签及必要的已停用历史标签。
- `tags.create`、`tags.update`、`tags.setActive`：仅 owner/admin 管理字典。

线索转报名不改变其请求契约。其创建新学员的同一事务会插入主要联系人，同时继续写入既有 guardian 字段；既有学员通过迁移联系人数据保持兼容。

## Web Experience

新增受保护 `/students` 路由并将侧栏“学员中心”指向该路由。页面采用现有 leads 页面模式，提供筛选、分页、空态、加载态、错误态和新建入口。

详情使用侧栏或对话框承载基础档案、联系人和标签编辑。主要联系人必须明确标识且提交前校验；结业状态使用确认提示。标签管理在 owner/admin 可见的设置入口或学员页面工具中提供，普通学员编辑角色只能选择启用标签。

## Migration And Rollback

迁移先创建表、索引与约束，再从非空 guardian 字段回填联系人；现有学员均保留原数据和读取行为。部署顺序为 migration 先行，应用后发。旧应用忽略新表，应用回滚不影响既有 guardian 字段；生产环境不删除已写入的联系人或标签数据作为常规回滚。

## Test Strategy

数据库集成测试覆盖：机构与校区范围、停用校区写入拒绝、主要联系人不变量、标签唯一与停用、手机号脱敏、转报名创建联系人及主联系人回写兼容。Web 验收覆盖授权入口、筛选、新建、编辑、错误态及桌面/移动端布局。
