import { useEffect, useMemo, useRef, useSyncExternalStore, type ReactElement, type ReactNode } from 'react'
import type { DesignKitVersionPin, StudioKitDraftRecord } from 'dsh-design-studio'
import type { StudioKitAuthoring } from './KitDraftWorkbench.tsx'
import { MindsetInlineController } from './mindset-inline-controller.ts'

export interface MindsetInlineEditorProps {
  authoring: StudioKitAuthoring
  kit: DesignKitVersionPin
  installedSource: string
  /** Explicit saved-record selection, never an implicit latest-record lookup. */
  initialId?: string
  onRecord?: (record: StudioKitDraftRecord) => void
  locale?: 'zh' | 'en'
  /** Use this complete draft source in both the original page's raw and reading views. */
  onSource: (source: string) => void
  onDirtyChange: (dirty: boolean) => void
  /** Compose controls into the document's existing toolbar; never add another workbench. */
  renderContent?: (parts: { actions: ReactNode; editor: ReactNode; editing: boolean }) => ReactElement
}

const words = {
  zh: { edit: '编辑原文', cancel: '取消', save: '保存草稿', pending: '处理中…', unpublished: '未发布草稿', protected: '方法声明（保留原文，不可编辑）', body: 'Mindset 正文', hint: '只保存工作副本；不会修改已安装 Kit。Frontmatter 和 design_skills 原文保留。' },
  en: { edit: 'Edit source', cancel: 'Cancel', save: 'Save draft', pending: 'Working…', unpublished: 'Unpublished draft', protected: 'Method declaration (preserved, read-only)', body: 'Mindset body', hint: 'Saves a working copy, not the installed Kit. Frontmatter and design_skills remain byte-identical.' },
}

/** Embed in the selected Kit's Mindset page; no extra navigation/workbench. */
export function MindsetInlineEditor({ authoring, kit, installedSource, initialId, onRecord, locale = 'zh', onSource, onDirtyChange, renderContent }: MindsetInlineEditorProps): ReactElement {
  const callbacks = useRef({ onSource, onDirtyChange, onRecord })
  callbacks.current = { onSource, onDirtyChange, onRecord }
  const controller = useMemo(() => new MindsetInlineController(authoring.client, kit, installedSource, source => callbacks.current.onSource(source),
    { initialId, onRecord: record => callbacks.current.onRecord?.(record) }),
    [authoring.client, kit.name, kit.version, installedSource, initialId])
  const state = useSyncExternalStore(controller.subscribe, controller.getSnapshot, controller.getSnapshot)
  const t = words[locale]
  useEffect(() => { controller.activate(); return () => { controller.dispose(); callbacks.current.onDirtyChange(false) } }, [controller])
  useEffect(() => { if (initialId) void controller.begin() }, [controller, initialId])
  useEffect(() => { callbacks.current.onDirtyChange(state.dirty) }, [state.dirty, controller])
  useEffect(() => {
    const guard = (event: BeforeUnloadEvent) => { if (controller.getSnapshot().dirty) { event.preventDefault(); event.returnValue = '' } }
    window.addEventListener('beforeunload', guard)
    return () => window.removeEventListener('beforeunload', guard)
  }, [controller])
  const actions = <span className="ygd-studio-inline-actions">
      {state.editing ? <>
        <button type="button" disabled={state.busy} onClick={() => controller.cancel()}>{t.cancel}</button>
        <button type="button" disabled={state.busy || !state.dirty} onClick={() => void controller.save()}>{t.save}</button>
      </> : <button type="button" disabled={state.busy} onClick={() => void controller.begin()}>{t.edit}</button>}
      {state.busy && <span role="status">{t.pending}</span>}
    </span>
  const editor = <>
    {state.error && <p role="alert" className="ygd-studio-diagnostics">{state.error}</p>}
    {state.editing && <div className="ygd-studio-draft-sources">
      <p>{t.hint}</p>
      {state.segments.map((segment, index) => segment.protected
        ? <details key={index}><summary>{t.protected}</summary><pre>{segment.text}</pre></details>
        : <label key={index}>{t.body}<textarea rows={Math.min(18, Math.max(3, segment.text.split('\n').length))} spellCheck={false} disabled={state.busy} value={segment.text} onChange={event => controller.edit(index, event.target.value)} /></label>)}
    </div>}
  </>
  return renderContent ? renderContent({ actions, editor, editing: state.editing }) : <section className="ygd-studio-mindset-inline" aria-label="Mindset">{actions}{state.unpublished && <span role="status">{t.unpublished}</span>}{editor}</section>
}
