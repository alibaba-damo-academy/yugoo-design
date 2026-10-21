# probe_report 输出契约

Canonical JSON 位于 `probe_report/probe_report.json`，只含 `schema_version: 1` 和 `report`。`report` 必有 `title`、`summary` 字符串与 `status: draft | reviewed`；可选 `findings` 字符串数组。状态由用户事实或明确的草稿判断支持，不能把生成 UI 当成 reviewed。

可选 Markdown 产物位于 `probe_report/report.md`，由执行者按当前 JSON 写入，不存入 JSON 字段。自动面板从同 Bundle 文件清单发现它并提供可读预览；面板保存仍只修改 canonical JSON。若 JSON 修改影响 Markdown，执行者负责同步；生成器不会反向编辑文件。[JSON 示例](state-example.json)与[报告示例](report-example.md)都是虚构测试内容，不得复制成用户事实。
