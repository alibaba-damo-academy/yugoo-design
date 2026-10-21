# probe_questions 输出契约

Canonical state：`probe_questions/probe_questions.json`。`schema.yaml` 和 `validation.yaml` 是机器校验权威；本页是执行者可通过 Bundle 资源入口读取的字段说明。

根对象只含 `schema_version: 1` 和 `questions`。`questions` 是以稳定 key 索引的对象。每条问题必须有字符串 `prompt` 和 `answer`；未知答案用 `""`。可选 `kind` 为 `text` 或 `single`；单选题的 `choices` 是 `{value,label,recommended?}` 列表，`answer` 只能是其中一个 `value` 或空字符串。可选 `detail` 用于已选答案的补充，不是第二个文本题输入框。不能添加附件、状态审批字段或其它未声明属性。

系统生成的 A2UI 面板只允许编辑已有问题的 `answer` 和已声明的 `detail`；不能通过面板改 `prompt`、选项、问题 key 或 `schema_version`。问题结构的增删改由本 Bundle 的执行者按用户请求更新 canonical 文件，随后系统重新生成视图。

读取 [合法示例](state-example.json) 可见一个虚构的团队会议安排情境。示例只用于验证格式和 UI，不代表当前设计项目的事实。发布时确认每个非空答案确有用户依据；推荐选项不能自动填入答案。
