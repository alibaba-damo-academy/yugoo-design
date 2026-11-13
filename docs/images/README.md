# 图片与产品标识 / Images and product mark

语构设计系统（Yugoo Design）的 [SVG 标识](yugoo-design-icon.svg)沿用[官网](https://yugoo.org/)的 Y 形标识，以紫色 `#7C5AF6` 配暖白色 `#FAF7F1`。[256 × 256 PNG](yugoo-design-icon.png)由该 SVG 原样渲染，供需要位图的插件目录使用。

The [SVG mark](yugoo-design-icon.svg) reuses the Y mark from the [Yugoo Design website](https://yugoo.org/), with purple `#7C5AF6` on warm ivory `#FAF7F1`. The [256 × 256 PNG](yugoo-design-icon.png) renders the SVG unchanged for plugin catalogs that require a bitmap.

## 产品界面 / Product interface

中文和英文 README 分别使用独立示例项目的对应语言界面与设计内容。以下图片保留真实对话和设计面板的协作上下文，使用虚构的客户反馈业务数据。普通工作区按对话 30% / Panel 70% 采图；Studio 的固定导航之外采用相同比例。

The Chinese and English READMEs use the matching interface language and design content from separate example projects. These captures preserve the actual conversation-and-Panel workspace with fictional client-feedback data. The conversation and Panel use a 30% / 70% split, excluding Studio's fixed navigation.

| 内容 / Content | 中文 | English |
| --- | --- | --- |
| 智能提问与 U/S/T 入口 / Smart Questions and U/S/T entry | [PNG](readme-questions.zh.png) | [PNG](readme-questions.en.png) |
| 流程全图与分支近看 / Complete process and decision branches | [GIF](readme-flow.zh.gif) | [GIF](readme-flow.en.gif) |
| 待处理设计建议与处置动作 / Pending advisory and response actions | [PNG](readme-advisories.zh.png) | [PNG](readme-advisories.en.png) |
| 关联邻域与来源 / Connected records and source evidence | [PNG](readme-relationships.zh.png) | [PNG](readme-relationships.en.png) |
| 调研、视觉风格与页面地图 / Research, visual style and page map | [GIF](readme-exploration.zh.gif) | [GIF](readme-exploration.en.gif) |
| 页面原型预览 / Page prototype preview | [PNG](readme-prototype.zh.png) | [PNG](readme-prototype.en.png) |
| 整合 PRD 的目录与阅读 / Assembled PRD navigation and reading | [PNG](readme-prd.zh.png) | [PNG](readme-prd.en.png) |
| Studio 对话与挂载管理 / Studio conversation and Bundle mounting | [PNG](readme-studio.zh.png) | [PNG](readme-studio.en.png) |

GIF 由同一项目的真实截图轮播组成，没有重画界面或业务图。待处理建议、临时内容和待重新评估提示保留其实际状态；截图不代表用户已经接受设计或完成开发。

GIFs cycle through actual captures from the same project; neither the interface nor its diagrams are redrawn. Pending advice, provisional content and reassessment notices retain their actual state. A screenshot does not mean that the design has been accepted or implemented.

[场景体验示例 / Scenario example](readme-scene.png)保留中文业务情境、原定范围和影响判断，与正式页面原型有不同用途。[问题编辑与 U/S/T 依据](readme-smart-questions.gif)、[建议、规则与来源追踪](readme-design-advice.gif)及 [Mindset 阅读与套件浏览](readme-studio.gif)提供更完整的中文交互演示；界面细节可能与当前版本不同。

The [scenario example](readme-scene.png) retains the Chinese business situation, agreed scope and impact assessment, a different purpose from formal page prototypes. Longer Chinese demonstrations cover [question editing and U/S/T reasoning](readme-smart-questions.gif), [advice, rules and source tracing](readme-design-advice.gif), and [Mindset reading and Kit browsing](readme-studio.gif); interface details may differ from the current version.

## 原生插件目录 / Native plugin catalog

原生插件目录的 [`screenshots.json`](../../packages/dsh/screenshots.json)选取以下真实 DeepSeek Harness（DSH）工作区截图，保留对话与设计面板（Design Panel）的协作上下文。索引引用固定公开提交中的原图：

The native plugin's [`screenshots.json`](../../packages/dsh/screenshots.json) selects these actual DeepSeek Harness (DSH) workspace captures, preserving the collaboration context between the conversation and Design Panels. The index references the original images at a fixed public commit:

| 图片 / Image | 内容 / Content |
| --- | --- |
| [readme-flow.png](readme-flow.png) | 对话旁的业务流程与泳道 / Business process and swimlanes beside the conversation |
| [readme-scene.png](readme-scene.png) | 合成案例的场景体验与影响判断 / Scenario exploration and impact assessment for a synthetic example |
| [readme-design-advice.png](readme-design-advice.png) | 待处理的一致性建议与对应业务规则 / A pending consistency suggestion beside its business rule |

此固定目录索引中的三张截图使用中文界面和合成示例，展示对话与设计面板的协作方式。安装步骤和宿主兼容范围见[宿主指南](../wiki/hosts.md)。

The three images in this fixed catalog index use Chinese UI and synthetic examples to show how conversations and Design Panels work together. See the [host guide](../wiki/hosts.md) for installation steps and host compatibility.

[Studio 挂载管理（中文）](studio-mount-management.zh.png)与 [English](studio-mount-management.en.png) 用于[使用指南](../wiki/usage.md#6-studio查看定制和检验套件)的 Studio 章节，展示对话区旁的备选与已挂载 Bundle、导航和保存入口，帮助读者找到套件定制的操作位置。

The [Chinese](studio-mount-management.zh.png) and [English](studio-mount-management.en.png) Studio mount-management captures illustrate the [usage guide](../wiki/usage.en.md#6-studio-inspect-customize-and-check-kits): available and mounted Bundles beside the conversation area, with navigation and Save controls to help readers find where to customize a Kit.
