import { lazy, Suspense, useEffect, useRef, useState } from 'react'
import { sidebarIcon } from './sidebar-icon.tsx'
import { browserRandomUuid } from './browser-uuid.ts'
import type { ComponentNode, PanelManifest } from './dsl.ts'
import { applyPanelUpdatesToDraft, fieldIsVisible, fieldsForSection, fieldValuesOf, pathGet, recordsAtPath, sectionBindingOf, type DesignData } from './record-state.ts'
import type { RenderOptions } from './interpreter.ts'
import { PanelEditableTitle, PanelWorkspace, PanelWorkspaceTree, PanelWorkspaceTreeItem, PanelWorkspaceTreeAdd } from './panel-workspace.tsx'
import { usePanelI18n } from './panel-i18n.tsx'
import { PanelContentState } from './panel-content-state.tsx'
import { emptyCanvasScene, parseCanvasScene } from './canvas-scene.ts'
import { confinedEditableArtifact, discardTextArtifactRecordEdits, PANEL_TEXT_ARTIFACTS_KEY, stageTextArtifact, type PendingTextArtifact } from './text-artifact-edit.ts'
const Surface = lazy(() => import('./excalidraw-surface.tsx'))

export function CanvasWorkspace({ node, manifest, data, options }: { node: ComponentNode; manifest: PanelManifest; data: DesignData; options?: RenderOptions }) {
  const { t } = usePanelI18n(), config = node.canvas!, binding = sectionBindingOf(manifest, node.source!)
  const records = recordsAtPath(data, binding.recordsPath), order = binding.orderPath ? pathGet(data, binding.orderPath) : undefined
  const ids = [...new Set([...(Array.isArray(order) ? order.filter((id): id is string => typeof id === 'string' && Object.hasOwn(records, id)) : []), ...Object.keys(records)])]
  const [choice, select] = useState(''), [retry, setRetry] = useState(0)
  const selected = ids.includes(choice) ? choice : ids[0], record = selected ? fieldValuesOf(records[selected]!, binding.fieldsPath) : undefined
  const file = record?.[config.file_field], scope = { skill: options?.skill ?? '', assetsDirectory: config.asset_directory }
  const valid = typeof file === 'string' && confinedEditableArtifact(file, scope.skill) && file === `${scope.skill}/${config.scene_directory}/${selected}.json`
  const knownAbsent = valid && options?.artifactFiles !== undefined && options.artifactFiles[file] === undefined
  const fileKey = JSON.stringify([file, valid ? options?.artifactFiles?.[file] : undefined, retry])
  const pendingList = (data as unknown as Record<string, unknown>)[PANEL_TEXT_ARTIFACTS_KEY]
  const pending = Array.isArray(pendingList) ? (pendingList as PendingTextArtifact[]).find(item => item.path === file && item.binding.record === selected) : undefined
  const [loaded, setLoaded] = useState<{ key: string; content?: string; pending?: boolean; error?: string }>()
  useEffect(() => {
    let gone = false
    if (!valid || !options?.readArtifact) return
    void options.readArtifact(file).then(result => {
      if (!result.found) {
        if (knownAbsent) { if (!gone) setLoaded({ key: fileKey, pending: true }); return }
        throw Error(t('canvasUnavailable'))
      }
      if (!gone) setLoaded({ key: fileKey, content: result.content })
    }).catch(reason => { if (!gone) setLoaded({ key: fileKey, error: String(reason) }) })
    return () => { gone = true }
  }, [fileKey, options?.readArtifact, knownAbsent])
  let scene, error = loaded?.key === fileKey ? loaded.error : undefined
  const content = pending?.content ?? (loaded?.key === fileKey ? loaded.content : undefined)
  try { if (content !== undefined) scene = parseCanvasScene(content, scope) } catch (reason) { error = String(reason) }
  // Local edits pin a canvas to its original file generation. External refreshes
  // do not destroy undo or silently replace an unsaved scene.
  const imageVersion = JSON.stringify(Object.values(scene?.files ?? {}).filter(image => options?.artifactFiles?.[image.path] !== undefined)
    .map(image => [image.path, options?.artifactFiles?.[image.path]]))
  const version = JSON.stringify([fileKey, imageVersion])
  const identity = useRef({ selected, base: pending?.baseVersion ?? version, pending: !!pending, epoch: 0 })
  if (identity.current.selected !== selected) identity.current = { selected, base: pending?.baseVersion ?? version, pending: !!pending, epoch: identity.current.epoch + 1 }
  else if (identity.current.pending && !pending) identity.current = { selected, base: version, pending: false, epoch: identity.current.epoch + 1 }
  else if (!pending) identity.current.base = version
  identity.current.pending = !!pending
  const baseVersion = identity.current.base
  const editable = !!options?.editable && !!options.onPanelUpdate && !!options.onStageArtifact && !!options.registerBeforeSave
  const titleField = fieldsForSection(manifest.fields, node.source!).find(field => field.key === config.label_field)
  const titleEditable = editable && !!options?.onEdit && !!titleField
    && ['text', 'textarea'].includes(titleField.control) && !titleField.readonly && fieldIsVisible(titleField, record ?? {})
  const update = (values: Record<string, unknown>) => { if (editable) options?.onPanelUpdate?.(values) }
  const add = () => {
    if (!editable) return
    const id = `scene-${browserRandomUuid()}`, path = `${scope.skill}/${config.scene_directory}/${id}.json`
    const value = { [config.id_field]: id, [config.label_field]: config.new_title, [config.file_field]: path }
    const updates = { [binding.recordsPath]: { ...records, [id]: value }, ...(binding.orderPath ? { [binding.orderPath]: [...ids, id] } : {}) }
    const next = stageTextArtifact(applyPanelUpdatesToDraft(data, updates), scope.skill, {
      path, baseVersion: 'new', content: JSON.stringify(emptyCanvasScene()), binding: { recordsPath: binding.recordsPath, record: id, field: config.file_field },
    })
    update({ ...updates, [PANEL_TEXT_ARTIFACTS_KEY]: next[PANEL_TEXT_ARTIFACTS_KEY] })
    select(id)
  }
  const move = (delta: number) => {
    const next = [...ids], index = next.indexOf(selected!), target = index + delta
    if (!binding.orderPath || target < 0 || target >= next.length) return
    ;[next[index], next[target]] = [next[target]!, next[index]!]
    update({ [binding.orderPath]: next })
  }
  return <PanelWorkspace guidance={node.guidance} autoSaveId={`canvas:${manifest.panel_kind}:${node.id}`} sidebar={<PanelWorkspaceTree icon={sidebarIcon(node.sidebar_icon)} title={node.title ?? t('canvas')}>
    {ids.map(id => <PanelWorkspaceTreeItem key={id} selected={selected === id} onSelect={() => select(id)}>{String(fieldValuesOf(records[id]!, binding.fieldsPath)[config.label_field] || id)}</PanelWorkspaceTreeItem>)}
    <PanelWorkspaceTreeAdd disabled={!editable} onAdd={add}>{t('canvasAdd')}</PanelWorkspaceTreeAdd>
  </PanelWorkspaceTree>}><div className="dsh-canvas-workspace">
    {selected && record ? <>
      <header className="dsh-canvas-heading"><PanelEditableTitle aria-label={t('canvasTitle')} aria-required={titleField?.required || undefined}
        value={String(record[config.label_field] ?? '')} disabled={!titleEditable}
        onChange={event => { if (titleEditable) options?.onEdit?.({ section: node.source!, record: selected, field: config.label_field, value: event.target.value }) }} />
        <button type="button" disabled={!editable || ids.indexOf(selected) === 0} onClick={() => move(-1)}>{t('canvasUp')}</button>
        <button type="button" disabled={!editable || ids.indexOf(selected) === ids.length - 1} onClick={() => move(1)}>{t('canvasDown')}</button>
        <button type="button" className="dsh-canvas-delete" disabled={!editable} onClick={() => {
          if (!window.confirm(t('canvasDeleteConfirm'))) return
          const next = { ...records }; delete next[selected]
          update({ [binding.recordsPath]: next, ...(binding.orderPath ? { [binding.orderPath]: ids.filter(id => id !== selected) } : {}),
            ...(pendingList === undefined ? {} : { [PANEL_TEXT_ARTIFACTS_KEY]: discardTextArtifactRecordEdits(pendingList, binding.recordsPath, selected) }) })
        }}>{t('canvasDelete')}</button>
      </header>
      {pending && identity.current.base !== 'new' && identity.current.base !== version ? <p role="alert">{t('canvasChanged')}</p> : null}
      <div className="dsh-canvas-stage">{valid && scene ? <Suspense fallback={<PanelContentState state="loading" message={t('canvasLoading')} kind="canvas" />}>
        <Surface key={`${selected}:${identity.current.base}:${identity.current.epoch}`} scene={scene} scope={scope} assets={pending?.assets}
          disabled={!editable} readImages={options?.readBinaryArtifact} register={options?.registerBeforeSave ?? (() => () => {})}
          onChange={edit => options?.onStageArtifact?.({ ...edit, baseVersion, path: file, binding: { recordsPath: binding.recordsPath, record: selected, field: config.file_field } })} />
      </Suspense> : <div className="dsh-diagram-placeholder"><PanelContentState kind="canvas"
        state={error || !valid ? 'error' : knownAbsent || loaded?.key === fileKey && loaded.pending ? 'empty' : !options?.readArtifact ? 'unavailable' : 'loading'}
        message={error ?? (!valid || !options?.readArtifact ? t('canvasUnavailable') : knownAbsent || loaded?.key === fileKey && loaded.pending ? t('canvasPending') : t('canvasLoading'))}>
        {error ? <button type="button" onClick={() => setRetry(value => value + 1)}>{t('retry')}</button> : null}
        </PanelContentState></div>}</div>
    </> : <PanelContentState state="empty" message={t('canvasEmpty')} kind="canvas" />}
  </div></PanelWorkspace>
}
