# 学员领域基线调研

- `student` 当前只有单个监护人字段；线索转报名是唯一生产创建路径。
- `CampusAccess` 已在服务端按成员关系解析，并被线索、报名、财务和工作台使用。
- 学员中心导航为占位，未存在可复用的学员标签模型。
- 本期采用专用 `student_contact`、`student_tag` 和 `student_tag_assignment`，不复用课程标签。
- 现有 guardian 字段在迁移期保持兼容，并由主要联系人同事务回写。
