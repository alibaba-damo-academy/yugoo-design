# 编写 validation.yaml

先确定哪个真实消费者会因数据、引用或文件不一致而失败，再写规则。`schema.yaml`
负责形状、类型、required 和枚举；`validation.yaml` 负责适用阶段的语义约束。
不要把备注、字数、图表数量、风格偏好或猜测的完整度变成硬门槛。领域质量仍按
Bundle 方法和用户目标审查。保留已有约束，不能用 `rules: []` 绕过报错。

安装版 Studio 从材料资源索引读取本文与下面的源示例，不需要开发检出。
校验语义以当前 Core 为准；本文说明已实现的声明格式，不注册算子或驱动。
在 Studio 中通过当前宿主的完整文件 prepare/编译入口核对定义及预览；准备成功
不等于这些领域数据规则已在所有 scope 执行，更不等于保存或发布成功。

## 一个可直接解析的完整例子

以下 `example_notes` 和 N1 都是合成示例。改成自己的运行时 `name` 和实际字段；
`skill` 必须与 `skill.yaml.name`、`SKILL.md` frontmatter 的 `name` 一致。
每条规则必须包含非空 `id`、非空 `scope` 数组、非空 `code` 和非空 `check` 对象。
`id` 在同一文件中唯一。`message`、`repair_hint` 和诊断用的 `artifact` 可选。
多个约束写成多条规则；不要套 `all`、`and`、`op`、`rule` 或内层 `check`。

```yaml
skill: example_notes
rules:
  - id: note_id_matches_key
    scope: [state]
    code: example_notes.id_mismatch
    message: "Note {key}: mapping key must equal id."
    repair_hint: "Preserve the note ID and make its key identical."
    check: { map_keys_match_field: { map: notes, field: id } }
  - id: order_covers_notes
    scope: [state]
    code: example_notes.invalid_order
    message: "Note {key}: order must cover each note exactly once."
    check: { order_exactly_covers_map: { order: note_order, map: notes } }
  - id: role_reference
    scope: [state]
    code: example_notes.unknown_role
    message: "Note {key}: role_id must identify an existing role."
    check:
      for_each_in_map: notes
      member_of_map: { value: role_id, map: roles }
  - id: notes_present
    scope: [completion]
    code: example_notes.empty
    message: "Completion requires at least one meaningful note."
    check: { non_empty_map: notes }
  - id: note_text
    scope: [completion]
    code: example_notes.empty_text
    message: "Note {key}: supply the actual note text before completing."
    check:
      for_each_in_map: notes
      non_empty_string: text
```

合法数据：以下内容通过这份规则的 `state` 和 `completion` 检查。

```json
{"roles":{"reader":{}},"notes":{"N1":{"id":"N1","role_id":"reader","text":"Keep the supplied observation."}},"note_order":["N1"]}
```

待补充草稿：`state` 通过，`completion` 返回 `example_notes.empty_text`。
不通过完成检查不授权把未知内容编造为事实；补充真实文本后再检查。

```json
{"roles":{"reader":{}},"notes":{"N1":{"id":"N1","role_id":"reader","text":""}},"note_order":["N1"]}
```

坏引用：`state` 返回 `example_notes.unknown_role`。修正真实引用，不删除规则。

```json
{"roles":{"reader":{}},"notes":{"N1":{"id":"N1","role_id":"missing","text":"Keep the supplied observation."}},"note_order":["N1"]}
```

这些规则不替代 schema。特别是 for-each 不会替代 map/记录的类型与必填字段检查；
可选引用未填写时，成员关系检查不会自动把它变成必填。

## 作用域和字段位置

- `scope: [state]` 检查工作状态；不要把合法的待补充草稿误判为坏数据。
- `scope: [completion]` 检查本次完成所必需的事实。确需两阶段都检查时写
  `[state, completion]`，不是字符串 `state` 或 `scope: all`。
- `scope: [candidate]` 面向委派结果门槛。可选 `applies_when` 只允许
  `metadata`，且只用于 candidate 规则；不能用它编造通用 `if/then` 规则。
  candidate 没有磁盘 artifact reader，不能声称已核对未读到的文件。
- 根检查使用点分 state 路径，如 `design.notes`；不使用 JSON Pointer、`$` 前缀
  或任意表达式。路径的每段必须非空，不能是 `__proto__`、`constructor`、`prototype`。
- `for_each_in_map: notes` 的值是 state 路径字符串，**不是** `{path, rule}` 对象。
  叶子算子与它并列，检查每条记录的直接字段，如上例的 `text`、`role_id`。
- `for_each_in_order: {order: note_order, map: notes}` 同样只与一个叶子算子并列。
  它按 order 检查对应记录；另用 `order_exactly_covers_map` 核对顺序覆盖关系。
- 成员关系中的 `map` 总是从完整 state 根查找，如 `roles`，不是当前记录的子 map。

## 当前可用的检查形状

每个 `check` 只有一个顶层算子；for-each 是例外，它必须同时带且只带一个叶子算子。
同一记录要检查名称和用途时，分别写两条规则，不把两个叶子塞进一个 `check`。

| 算子 | 完整的 check 形状或参数 |
| --- | --- |
| `non_empty_map` | `{ non_empty_map: notes }` |
| `non_empty_list` | `{ non_empty_list: note_order }` |
| `non_empty_string` | `{ non_empty_string: title }`；文本不能只含空白 |
| `data_table` | `{ data_table: matrix }`；使用已有列/行与单元格类型契约 |
| `member_of_map` | `{ member_of_map: { value: selected_role, map: roles } }`；可选 `allow_empty: true` 接受空字符串 |
| `members_of_map` | `{ members_of_map: { value: role_ids, map: roles } }`；value 是 ID 数组 |
| `source_reference_map` | `{ source_reference_map: references }`；结构化源引用可选，填写后须合法，不是普通 URL 列表 |
| `fields_absent_when` | `{ fields_absent_when: { field: kind, equals: generalization, fields: [source_count, target_count] } }`；直接字段的条件性缺省 |
| `exclusive_fields` | `{ exclusive_fields: { fields: [node_id, group_id], allow_empty: true } }`；互斥的直接字符串字段 |
| `for_each_in_map` | `{ for_each_in_map: notes, non_empty_string: text }` |
| `for_each_in_order` | `{ for_each_in_order: { order: note_order, map: notes }, non_empty_string: text }` |
| `order_refs_map` | `{ order_refs_map: { order: selected_ids, map: notes } }`；只检查已列 ID 存在，不代替完整覆盖 |
| `map_keys_match_field` | `{ map_keys_match_field: { map: notes, field: id } }` |
| `order_exactly_covers_map` | `{ order_exactly_covers_map: { order: note_order, map: notes } }`；不漏项、不重复、无未知 ID |
| `map_entries_have_unique_string_list` | `{ map_entries_have_unique_string_list: { map: pages, field: function_refs } }`；每条列表可空，项须为非空字符串且不重复 |
| `map_entries_have_unique_non_empty_string_list` | 同上，算子名称换为本项；每条列表还须非空 |
| `acyclic_record_edges` | `{ acyclic_record_edges: { map: relations, source: source, target: target, where: { field: kind, equals: generalization } } }`；`where` 可省 |
| `single_parent_record_edges` | 参数与上项相同；一个 source 不能有多条父边，重复父边也不允许 |
| `referenced_files` | `{ referenced_files: ["pages.*.artifact_file"] }`；选取 state 中已填写的文件引用 |
| `required_files` | `{ required_files: ["example_notes/summary.html"] }`；固定 Design Files 相对路径 |
| `driver` | `{ driver: "registered-contribution-id", options: {} }`；只能使用当前宿主已注册并授权给此 Bundle 的可信驱动，不能从示例猜一个 id |

`members_of_map` 也支持引用记录 map：
`{ value: grants, map: roles, item_field: role_id, order_field: grant_order, min_entries: 1 }`。
`item_field` 指每条引用记录的直接 ID 字段；`order_field` 指拥有者记录中的顺序字段。
`min_entries` 只能用于 completion，必须同时有 `item_field`；在 state 中允许未完成
引用，不用 completion 的最小数量要求堵住编辑。字段是否必填仍由实际 schema/规则决定。

文件检查仅用于真实产物消费者：`referenced_files` 忽略缺失、null 和空字符串引用；
非空引用必须是受限的 Design Files 相对路径，文件须可读且非空。若完成时必须填写
引用，再另写 `non_empty_string` 完成规则；固定产物用 `required_files`。只有 canonical
JSON 的 Bundle 不必增加产物规则。缺少 artifact reader 是诊断，不是校验成功。

## 复用成熟源文件与处理报错

以下 YAML 和 schema 按源字节装入安装材料，不是另一份手写规则权威；只借用形状，
保留目标 Bundle 自己的字段、ID、用途和约束，不照抄别人的业务必填要求。

- [Function Modules 规则](../../../../packages/skills-web-app/bundles/function_modules/validation.yaml)
  与[对应 schema](../../../../packages/skills-web-app/bundles/function_modules/schema.yaml)、[合成预览数据](../../../../packages/skills-web-app/bundles/function_modules/reference/preview.json)：非空集合和可选结构化源引用。
- [Business Data 规则](../../../../packages/skills-web-app/bundles/business_data/validation.yaml)
  与[对应 schema](../../../../packages/skills-web-app/bundles/business_data/schema.yaml)、[合成预览数据](../../../../packages/skills-web-app/bundles/business_data/reference/preview.json)：记录顺序、键/ID、引用与继承图约束。
- [Page Design 规则](../../../../packages/skills-web-app/bundles/page_design/validation.yaml)
  与[对应 schema](../../../../packages/skills-web-app/bundles/page_design/schema.yaml)：显式文件引用、记录与顺序关系。

遇到 `expected a rules list`、`rules must not be empty`、缺 `code` 或
`check has no supported operator` 时，先核完整文件的元数据和上述形状，再用实际
宿主 prepare 返回的定位信息修复。同一份完整提案要保留仍然有效的其他文件与约束，
不要靠空规则、删除引用检查或把所有字段改为可选来获得成功提示。
加载/编译通过之后，再按真实 schema 和相关 scope 检查非空正例、坏引用及待补充草稿；
这些机械结果不等于真实 Agent 生成、耐久保存、模型消费或安装验收通过。

Manifest 从[完整起点](../assets/skill.template.yaml)开始：`title` 和 `label` **都必需**，
各自包含非空 `zh`、`en`。本文不能替代 Bundle 的专业方法和可读输出契约。
