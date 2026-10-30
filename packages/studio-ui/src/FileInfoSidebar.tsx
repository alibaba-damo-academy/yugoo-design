import { type ReactElement } from 'react'
import { renderStudioMarkdown } from './markdown.tsx'

type Text = Readonly<{ zh: string; en: string }>
/** System-owned file roles, not per-Kit annotations or inferred descriptions. */
const FILE_ROLES: Readonly<Record<string, Text>> = {
  'mindset.md': { zh: '设计心智：描述领域设计方法、判断原则，以及如何选择和协同使用技能包。', en: 'Design mindset: domain methods, judgment principles, and guidance for selecting and coordinating bundles.' },
  'kit.yaml': { zh: '挂载清单：声明此设计套件引用的技能包及其顺序。', en: 'Mount manifest: bundles referenced by this kit and their order.' },
  'relations.yaml': { zh: '关系词汇：定义此设计套件扩展的知识关联类型，不是项目设计内容。', en: 'Relationship vocabulary: kit-specific knowledge relationship types, not project design content.' },
  'SKILL.md': { zh: '技能方法：描述适用场景、设计方法、证据要求与交付规范。', en: 'Skill method: applicability, domain methods, evidence and delivery rules.' },
  'skill.yaml': { zh: '技能包声明：定义身份、展示名称、执行策略、面板模式及可选摘要规则。', en: 'Bundle manifest: identity, display names, execution policy, panel mode and optional summary rules.' },
  'schema.yaml': { zh: '数据结构：定义设计内容的字段、类型及结构约束。', en: 'Data schema: fields, types and structural constraints for the design content.' },
  'validation.yaml': { zh: '校验规则：检查设计内容及交付结果是否满足要求。', en: 'Validation rules: checks on design content and delivery requirements.' },
  'panel.yaml': { zh: '面板声明：将设计数据映射为可视化界面和编辑交互。', en: 'Panel declaration: maps design data to visual views and editing interactions.' },
  'renderer.md': { zh: '旧版摘要声明：供遗留内容迁移使用；新技能包的摘要规则放在 skill.yaml.summary 中。', en: 'Legacy summary declaration: retained for migration. New bundles use skill.yaml.summary.' },
  'reference/artifact-contract.md': { zh: '输出契约：供 Agent 阅读的数据含义、引用、产物及交付约束。', en: 'Output contract: Agent-readable data semantics, references, artifacts and delivery constraints.' },
  'reference/canvas-guide.md': { zh: '画布方法：说明此技能包的图形表达、布局、生成与检查方式。', en: 'Canvas method: this bundle’s visual expression, layout, generation and checks.' },
  'reference/cooperation-guide.md': { zh: '协作指南：说明与其他技能包需要对齐或补充的信息及事实边界。', en: 'Cooperation guide: information to align or supplement across bundles, with fact ownership boundaries.' },
  'reference/runtime-guide.md': { zh: '运行指南：记录此技能包特有的执行、环境或工具使用要求。', en: 'Runtime guide: bundle-specific execution, environment or tool requirements.' },
  'reference/example.json': { zh: '输出示例：演示合法的设计数据，不代表用户已确认的需求。', en: 'Output example: valid design data, not confirmed user requirements.' },
  'reference/preview.json': { zh: '预览样例：用于展示面板交互，不写入真实项目。', en: 'Preview sample: demonstrates panel interactions without writing to a real project.' },
  'locales/zh-CN.json': { zh: '中文界面文案：提供技能包的中文标签、提示和展示简介，不翻译原始设计内容。', en: 'Chinese UI copy: bundle labels, guidance and display descriptions; not translations of authored design content.' },
  'locales/en-US.json': { zh: '英文界面文案：提供技能包的英文标签、提示和展示简介，不翻译原始设计内容。', en: 'English UI copy: bundle labels, guidance and display descriptions; not translations of authored design content.' },
}

export function standardFileDescription(path: string | undefined, locale: 'zh' | 'en'): string | undefined {
  return path === undefined ? undefined : FILE_ROLES[path.replaceAll('\\', '/')]?.[locale]
}

export function FileName({ path, locale }: { path?: string; locale: 'zh' | 'en' }): ReactElement | null {
  if (!path) return null
  const role = standardFileDescription(path, locale)
  return <strong className="ygd-studio-document-name" title={role} aria-description={role}>{path}</strong>
}

/** Read-only display copy stays outside the byte-exact source. */
export function FileInfoSidebar({ kind, description, locale }: { kind: 'kit' | 'bundle'; description?: string; locale: 'zh' | 'en' }): ReactElement | null {
  if (!description?.trim()) return null
  const zh = locale === 'zh'
  return <aside className="ygd-studio-file-info" aria-label={zh ? '文件说明' : 'File Information'}>
    <section><h3>{zh ? (kind === 'kit' ? '设计套件简介' : '技能包简介') : (kind === 'kit' ? 'About This Kit' : 'About This Bundle')}</h3>
      {renderStudioMarkdown(description)}</section>
  </aside>
}
