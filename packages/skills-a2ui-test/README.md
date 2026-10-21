# A2UI 独立测试 Kit

这是 opt-in 的测试内容包，Kit ID 为 `a2ui_test@1.0`。它不修改已有 Kit，也没有预定义 `panel.yaml`。三个 Bundle 均使用 `presentation.mode: auto`：`probe_questions` 测问题清单，`probe_records` 测普通记录集合，`probe_report` 测嵌套 JSON 与 Markdown 产物。生成的 UI 是项目派生缓存，设计文件仍是事实。

从仓库根目录运行 `pnpm --dir packages/skills-a2ui-test test` 验证内容。若要在本机 DSH 试用，先把整个 `packages/skills-a2ui-test` 目录复制到 `$DSH_HOME/design-system/kits/a2ui_test`（默认 DSH_HOME 为 `~/.dsh`）；目录发现器只接受实际目录，不接受符号链接。随后在**新建测试项目**里选择 `a2ui_test`，可依次要求 Agent “用团队会议安排生成 2 个待答问题”、“生成一条待办记录并让我修改优先级”和“生成一份结构化摘要与 Markdown 报告”。分别在 Panel 中填写、保存并重开，确认原有答案和记录保持不变，报告产物可读。不要在生产项目上切换到这个测试 Kit。

本包不随现有 DSH dogfood 默认安装；复制是显式的本机测试步骤。移除本地测试副本不会删除设计项目，但已有项目的 Kit pin 可能进入只读恢复模式。真实模型输出质量、运行中 DSH 浏览器闭环及其他 CLI 宿主需要分别验收。
