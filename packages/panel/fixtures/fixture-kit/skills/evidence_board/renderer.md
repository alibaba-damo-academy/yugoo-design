---
version: 1
renderer: pilot-design/v2
fields:
  - { source: summary, title: 摘要 }
collections:
  - source: items
    title: 条目
    order: items_order
    title_fields: [name]
  - source: add.enhancements.records
    title: 增强项
    order: add.enhancements.record_order
    title_fields: [title]
---

# evidence_board design_state summary contract

- Emit the top-level `summary` scalar when non-empty.
- Emit the `items` collection count and each record id with its `name`,
  following `items_order`.
- Emit the residue add region (`add.enhancements.records`) count and each
  record id with its `title`, following `add.enhancements.record_order`;
  per-record field values are not summarized.
