/** Browses a host-supplied real catalog. No registry, runtime or filesystem here. */
import { useMemo, useState, type ReactElement } from 'react'
import { StudioFeedback } from './StudioFeedback.tsx'

export interface StudioComponentEntry {
  readonly id: string
  readonly title: string
  readonly description: string
  readonly category: 'layout' | 'data' | 'workspace'
  readonly generated: boolean
  readonly sourceBound: boolean
  readonly ownsWorkspace: boolean
  readonly previewLayout?: 'inline' | 'navigation' | 'workspace'
  /** Complete validated example, not an isolated binding-free fragment. */
  readonly panelYaml?: string
}
export interface StudioUiLibrary {
  readonly packageName: string
  readonly title: string
  readonly version: string
  readonly group: 'foundation' | 'controls' | 'visualization'
  readonly purpose: Readonly<{ zh: string; en: string }>
}
export interface StudioComponentDirectoryProps {
  readonly groups: readonly { readonly id: string; readonly title: string; readonly items: readonly { readonly id: string; readonly title: string; readonly secondary?: string }[] }[]
  readonly selected?: string
  readonly searching: boolean
  readonly onSelect: (id: string) => void
}
export interface StudioComponentLibrary {
  readonly entries: (locale: 'zh' | 'en') => readonly StudioComponentEntry[]
  readonly skillSource: string
  /** Read-only same-build dependency metadata, not a runtime component catalog. */
  readonly libraries?: readonly StudioUiLibrary[]
  /** Optional shared tree primitives supplied by the host, without UI-layer imports. */
  readonly renderDirectory?: (props: StudioComponentDirectoryProps) => ReactElement
  readonly renderExample: (id: string, options: { locale: 'zh' | 'en' }) => ReactElement
}

function FallbackDirectory(props: StudioComponentDirectoryProps): ReactElement {
  return <>{props.groups.map(group => <details className="ygd-studio-component-directory-group" key={`${group.id}:${props.searching}`} open><summary>{group.title}</summary>{group.items.map(item => <button className="ygd-studio-component-directory-item" type="button" key={item.id} data-component-id={item.id} aria-current={props.selected === item.id ? 'page' : undefined} onClick={() => props.onSelect(item.id)}><span>{item.title}</span>{item.secondary && <code>{item.secondary}</code>}</button>)}</details>)}</>
}

export function componentExtensionPrompt(skill: string, locale: 'zh' | 'en'): string {
  return (locale === 'zh'
    ? '请使用以下 design-component Skill，帮我扩展 Yugoo Design 组件库。先确认我想表达的信息、真实数据与交互；优先复用或组合已有组件。若确实需要新增组件，请在开发源码仓库完成注册、声明契约、共享渲染器、样例与回归测试。不要直接修改已安装插件，不要创建动态脚本加载器，不要自动发布。\n\n我的组件需求：\n[在这里描述需要表达的信息与交互]\n\n'
    : 'Use the following design-component Skill to extend the Yugoo Design component library. Clarify the information, real data and interactions first; prefer existing components or composition. If a new component is needed, implement its registration, declaration contract, shared renderer, examples and regression tests in the development source repository. Do not modify installed plugins, introduce dynamic script loading or publish automatically.\n\nMy component requirement:\n[Describe the information and interactions here]\n\n') + skill
}

export function ComponentLibrary({ library, locale }: { library: StudioComponentLibrary; locale: 'zh' | 'en' }): ReactElement {
  const zh = locale === 'zh'
  const entries = useMemo(() => library.entries(locale), [library, locale])
  const [selected, setSelected] = useState(entries[0]?.id)
  const [query, setQuery] = useState('')
  const [catalog, setCatalog] = useState<'components' | 'libraries'>('components')
  const libraries = library.libraries ?? []
  const [selectedLibrary, setSelectedLibrary] = useState(libraries[0]?.packageName)
  const [tab, setTab] = useState<'preview' | 'declaration'>('preview')
  const [notice, setNotice] = useState(''), [error, setError] = useState('')
  const filtered = entries.filter(entry => `${entry.id} ${entry.title} ${entry.description}`.toLowerCase().includes(query.trim().toLowerCase()))
  const entry = entries.find(value => value.id === selected)
  const dependency = libraries.find(value => value.packageName === selectedLibrary)
  const filteredLibraries = libraries.filter(value => `${value.title} ${value.packageName} ${value.version} ${value.purpose[locale]}`.toLowerCase().includes(query.trim().toLowerCase()))
  const groups = { layout: zh ? '布局与展示' : 'Layout and Display', data: zh ? '数据交互' : 'Data Interaction', workspace: zh ? '完整工作区' : 'Workspaces' }
  const libraryGroups = { foundation: zh ? '界面基础' : 'UI Foundations', controls: zh ? '交互控件' : 'Interaction Controls', visualization: zh ? '绘图与可视化' : 'Drawing and Visualization' }
  const switchCatalog = (next: 'components' | 'libraries') => { setCatalog(next); setQuery(''); setNotice(''); setError('') }
  const directory: StudioComponentDirectoryProps = {
    groups: catalog === 'components'
      ? (Object.keys(groups) as Array<keyof typeof groups>).map(id => ({ id, title: groups[id], items: filtered.filter(value => value.category === id).map(value => ({ id: value.id, title: value.title })) })).filter(group => group.items.length > 0)
      : (Object.keys(libraryGroups) as Array<keyof typeof libraryGroups>).map(id => ({ id, title: libraryGroups[id], items: filteredLibraries.filter(value => value.group === id).map(value => ({ id: value.packageName, title: value.title, secondary: value.packageName })) })).filter(group => group.items.length > 0),
    selected: catalog === 'components' ? selected : selectedLibrary, searching: query.trim().length > 0,
    onSelect: id => { catalog === 'components' ? setSelected(id) : setSelectedLibrary(id); setNotice(''); setError('') },
  }
  const copy = async (value: string) => {
    setError(''); setNotice('')
    try { await navigator.clipboard.writeText(value); setNotice(zh ? '已复制' : 'Copied') }
    catch { setError(zh ? '无法访问剪贴板，请在声明或指引中手动复制。' : 'Clipboard unavailable. Copy manually from the declaration or guide.') }
  }
  return <main className="ygd-studio-main ygd-studio-components">
    <header className="ygd-studio-content-header">
      <div className="ygd-studio-header-title-group"><h1 className="ygd-studio-page-title">{zh ? '面板组件库' : 'Panel Component Library'}</h1><span className="ygd-studio-subtitle">{catalog === 'components' ? `${entries.length} ${zh ? '个已注册组件' : 'registered components'}` : `${libraries.length} ${zh ? '个主要 UI 依赖' : 'primary UI dependencies'}`}</span></div>
      <button className="ygd-studio-btn-primary" type="button" onClick={() => void copy(componentExtensionPrompt(library.skillSource, locale))}>{zh ? '复制组件扩展指引' : 'Copy extension guide'}</button>
    </header>
    <div className="ygd-studio-component-browser">
      <aside className="ygd-studio-component-directory" aria-label={zh ? '组件目录' : 'Component catalog'}>
        {libraries.length > 0 && <div className="ygd-studio-component-catalog-tabs" role="tablist" aria-label={zh ? '目录类型' : 'Catalog type'}>{(['components', 'libraries'] as const).map(value => <button key={value} id={`catalog-${value}`} type="button" role="tab" tabIndex={catalog === value ? 0 : -1} aria-selected={catalog === value} aria-controls="component-library-catalog" onClick={() => switchCatalog(value)} onKeyDown={event => {
          if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return
          event.preventDefault()
          const next = event.key === 'Home' ? 'components' : event.key === 'End' ? 'libraries' : catalog === 'components' ? 'libraries' : 'components'
          switchCatalog(next)
          event.currentTarget.parentElement?.querySelector<HTMLButtonElement>(`#catalog-${next}`)?.focus()
        }}>{value === 'components' ? (zh ? '共享组件' : 'Components') : (zh ? '第三方库' : 'Third-party')}</button>)}</div>}
        <input className="ygd-studio-search-input" type="search" aria-label={catalog === 'components' ? (zh ? '搜索组件' : 'Search components') : (zh ? '搜索第三方库' : 'Search libraries')} placeholder={catalog === 'components' ? (zh ? '搜索组件…' : 'Search components…') : (zh ? '搜索第三方库…' : 'Search libraries…')} value={query} onChange={event => setQuery(event.currentTarget.value)} />
        <div className="ygd-studio-component-list" id="component-library-catalog" role={libraries.length > 0 ? 'tabpanel' : undefined} aria-labelledby={libraries.length > 0 ? `catalog-${catalog}` : undefined}>
          {directory.groups.length > 0 ? library.renderDirectory?.(directory) ?? <FallbackDirectory {...directory} /> : <p>{catalog === 'components' ? (zh ? '没有匹配的组件。' : 'No matching components.') : (zh ? '没有匹配的第三方库。' : 'No matching libraries.')}</p>}
        </div>
      </aside>
      {catalog === 'libraries' ? <section className="ygd-studio-component-detail" aria-label={zh ? '第三方库信息' : 'Third-party library information'}>{dependency ? <>
        <header className="ygd-studio-component-heading"><div><h2>{dependency.title}</h2><span className="ygd-studio-component-library-version">{dependency.version}</span></div></header>
        <div className="ygd-studio-component-library-info"><p>{dependency.purpose[locale]}</p><dl><div><dt>{zh ? '包名' : 'Package'}</dt><dd><code>{dependency.packageName}</code></dd></div><div><dt>{zh ? '构建版本' : 'Build version'}</dt><dd>{dependency.version}</dd></div><div><dt>{zh ? '使用范围' : 'Usage'}</dt><dd>{libraryGroups[dependency.group]}</dd></div></dl><p className="ygd-studio-component-library-note">{zh ? '这里列出主要 UI 库，不是全部间接依赖清单。版本来自当前构建；这些库不等同于 DSL 组件，也不会在此安装或更新。' : 'This view lists primary UI libraries, not all transitive dependencies. Versions come from the current build; these libraries are not DSL components. This view does not install or update them.'}</p></div>
      </> : <p>{zh ? '此宿主没有提供第三方库信息。' : 'This host supplies no library information.'}</p>}</section> : entry ? <section className="ygd-studio-component-detail" aria-label={entry.title}>
        <header className="ygd-studio-component-heading"><div><h2>{entry.title}</h2>{tab === 'declaration' && <code>{entry.id}</code>}</div><span className="ygd-studio-component-support">{entry.generated ? (zh ? 'DSL · AI 生成可用' : 'DSL · AI generation supported') : (zh ? 'DSL 可用' : 'DSL supported')}</span></header>
        <div className="ygd-studio-component-toolbar"><div className="ygd-studio-component-tabs" role="tablist" aria-label={zh ? '组件内容' : 'Component content'}>
          {(['preview', 'declaration'] as const).map(value => <button id={`component-${value}`} key={value} type="button" role="tab" tabIndex={tab === value ? 0 : -1} aria-selected={tab === value} aria-controls="component-content" onClick={() => setTab(value)} onKeyDown={event => {
            if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return
            event.preventDefault()
            const next = event.key === 'Home' ? 'preview' : event.key === 'End' ? 'declaration' : tab === 'preview' ? 'declaration' : 'preview'
            setTab(next)
            event.currentTarget.parentElement?.querySelector<HTMLButtonElement>(`#component-${next}`)?.focus()
          }}>{value === 'preview' ? (zh ? '组件预览' : 'Component Preview') : (zh ? '声明与用法' : 'Declaration and Usage')}</button>)}
        </div><div className="ygd-studio-component-actions">{entry.panelYaml && <button className="ygd-studio-btn-secondary" type="button" onClick={() => void copy(entry.panelYaml!)}>{zh ? '复制声明' : 'Copy declaration'}</button>}</div></div>
        {error && <StudioFeedback feedbackId={`clipboard:${error}`} tone="error" locale={locale} title={zh ? '未能复制内容' : 'Could not copy content'} message={error}
          actions={[{ label: zh ? '查看声明' : 'View declaration', onClick: () => setTab('declaration') }]} />}
        {notice && <StudioFeedback feedbackId={`clipboard:${notice}`} tone="success" locale={locale} title={notice} />}
        <section id="component-content" role="tabpanel" aria-labelledby={`component-${tab}`} className="ygd-studio-component-content">
          {tab === 'preview' && entry.panelYaml ? <>
            <div className={`ygd-studio-component-preview ygd-studio-component-preview-${entry.previewLayout ?? 'inline'}`} aria-label={zh ? '固定样例预览' : 'Fixed example preview'} key={`${entry.id}:${locale}`}><div className="ygd-studio-component-stage">{library.renderExample(entry.id, { locale })}</div></div>
          </> : tab === 'preview' ? <div className="ygd-studio-component-unavailable"><h3>{zh ? '需要完整工作区或宿主数据' : 'Requires workspace or host data'}</h3><p>{zh ? '此组件已注册，但暂未提供独立交互样例。请查看声明与用法，通过同版本作者工具核对绑定。' : 'This registered component has no standalone example yet. Review its usage and query the matching authoring tool for bindings.'}</p><button className="ygd-studio-btn-secondary" type="button" onClick={() => setTab('declaration')}>{zh ? '查看用法' : 'View usage'}</button></div>
            : <div className="ygd-studio-component-doc"><p>{entry.description}</p><p>{zh ? '用途和参数以已安装的同版本组件契约为准；下面的查询不运行模型、不创建项目。' : 'Use the component contract from the same installed version. These queries do not run a model or create a project.'}</p><pre>{JSON.stringify({ name: entry.id, reference: 'contract' }, null, 2)}</pre><p><code>design_list_panel_components</code></p>{entry.panelYaml && <><h3>{zh ? '完整示例声明' : 'Complete Example Declaration'}</h3><pre tabIndex={0}>{entry.panelYaml}</pre></>}<details><summary>{zh ? '组件扩展 Skill（可手动复制）' : 'Component Extension Skill (Copy Manually)'}</summary><pre tabIndex={0}>{library.skillSource}</pre></details></div>}
        </section>
      </section> : <p>{zh ? '该宿主没有提供组件目录。' : 'This host supplies no component catalog.'}</p>}
    </div>
  </main>
}
