/** Trusted catalog adapter; fixed examples grant only navigation and fixture reads. */
import { Component, useMemo, useState, type ReactElement, type ReactNode } from 'react'
import { PANEL_COMPONENT_CATALOG, type ComponentKind } from '../../panel/src/dsl.ts'
import { createPanelComponentExample, panelComponentCategory, panelComponentTitle } from '../../panel/src/component-examples.ts'
import { DslPanel } from '../../panel/src/client/panels/dsl-panel.tsx'
import type { StudioComponentLibrary, StudioComponentDirectoryProps } from '../../studio-ui/src/ComponentLibrary.tsx'
import { PanelWorkspaceTreeGroup, PanelWorkspaceTreeItem } from '../../panel/src/panel-workspace.tsx'
import componentSkill from '../plugin/design-system/skills/design-component/SKILL.md?raw'
import { studioUiLibraries } from './ui-library-information.ts'

class ExampleBoundary extends Component<{ children: ReactNode; locale: 'zh' | 'en' }, { failed: boolean }> {
  state = { failed: false }
  static getDerivedStateFromError() { return { failed: true } }
  render() { return this.state.failed ? <p role="alert">{this.props.locale === 'zh' ? '该组件示例未能渲染，请查看声明与用法。' : 'This example could not render. Review its declaration and usage.'}</p> : this.props.children }
}

function ComponentExample({ id, locale }: { id: string; locale: 'zh' | 'en' }): ReactElement {
  const example = useMemo(() => Object.hasOwn(PANEL_COMPONENT_CATALOG, id) ? createPanelComponentExample(id as ComponentKind, locale) : undefined, [id, locale])
  if (!example) return <p>{locale === 'zh' ? '此组件暂未提供独立示例。' : 'No standalone example for this component.'}</p>
  const artifacts = example.artifacts
  // Documentation-only transcript; this adapter never consults a Host or project.
  const fixtureRun = 'component-example-static-transcript'
  return <ExampleBoundary locale={locale}><DslPanel skill="component_example" panelYaml={example.panelYaml} draft={example.sample} originalState={example.sample}
    readOnly={true} onChange={() => { /* Documentation has no data-write port. */ }} allowAttachments={false} locale={locale}
    executionAttempts={example.logEntries ? [{ projectId: 'component-example', skill: 'component_example', invocationId: fixtureRun, artifactId: '', attemptId: fixtureRun, runId: fixtureRun, role: 'producer', phase: 'completed', sequence: 1, timestamp: 1791676802000 }] : undefined}
    readExecutionLog={example.logEntries ? async (runId, afterSeq) => ({ found: runId === fixtureRun, revision: 'static-example-1', reset: afterSeq === undefined,
      entries: runId === fixtureRun ? example.logEntries!.filter(entry => afterSeq === undefined || entry.seq > afterSeq) : [] }) : undefined}
    artifactFiles={Object.fromEntries(Object.keys(artifacts).map(path => [path, 'static-example-1']))}
    readArtifact={async path => Object.hasOwn(artifacts, path) ? { found: true, content: artifacts[path]! } : { found: false, content: '' }}
    readBinaryArtifact={async () => ({ found: false, mediaType: 'image/png', base64: '', byteLength: 0 })} />
  </ExampleBoundary>
}

function ComponentDirectory(props: StudioComponentDirectoryProps): ReactElement {
  const [collapsed, setCollapsed] = useState<Record<string, boolean>>({})
  return <div className="ygd-studio-component-tree dsh-panel-workspace-tree"><div className="dsh-panel-workspace-tree-body">{props.groups.map(group => <PanelWorkspaceTreeGroup key={group.id} label={group.title} expanded={props.searching || !collapsed[group.id]} onToggle={() => setCollapsed(value => ({ ...value, [group.id]: !value[group.id] }))}>
    {group.items.map(item => <div className="dsh-panel-workspace-tree-branch" key={item.id} data-directory-item={item.id}><PanelWorkspaceTreeItem selected={props.selected === item.id} onSelect={() => props.onSelect(item.id)} ariaLabel={item.title}><span>{item.title}{item.secondary && <code>{item.secondary}</code>}</span></PanelWorkspaceTreeItem></div>)}
  </PanelWorkspaceTreeGroup>)}</div></div>
}

export const studioComponentLibrary: StudioComponentLibrary = {
  entries: locale => Object.entries(PANEL_COMPONENT_CATALOG).map(([id, metadata]) => {
    const entry = metadata as { description: string; sourceBound?: boolean; ownsWorkspace?: boolean; autoOrder?: number }
    const example = createPanelComponentExample(id as ComponentKind, locale)
    return { id, title: panelComponentTitle(id as ComponentKind, locale), description: entry.description,
      category: panelComponentCategory(id as ComponentKind), generated: entry.autoOrder !== undefined,
      sourceBound: entry.sourceBound === true, ownsWorkspace: entry.ownsWorkspace === true,
      panelYaml: example?.panelYaml, previewLayout: example?.previewLayout }
  }),
  skillSource: componentSkill,
  libraries: studioUiLibraries,
  renderDirectory: props => <ComponentDirectory {...props} />,
  renderExample: (id, options) => <ComponentExample id={id} {...options} />,
}
