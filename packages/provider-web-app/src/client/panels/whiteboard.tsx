import { useEffect, useMemo, useRef, useState, type ReactElement } from 'react'
import { Excalidraw } from '@excalidraw/excalidraw'
import type { ExcalidrawInitialDataState, BinaryFiles, AppState } from '@excalidraw/excalidraw/types'
import type { OrderedExcalidrawElement } from '@excalidraw/excalidraw/element/types'
import '@excalidraw/excalidraw/index.css'
import { LoaderCircle, Pencil } from 'lucide-react'
import { Button } from '../ported/ui/button.tsx'
import { Input } from '../ported/ui/input.tsx'
import { NativeDesignPanelContent, NativeDesignPanelFrame } from '../ported/design/OfficialWebAppPanels/NativeDesignPanelFrame.tsx'
import { DesignPanelSidebar, DesignPanelNavItem, DesignPanelAddButton, EmptyPanel } from '../ported/design/OfficialWebAppPanels/panelPrimitives.tsx'
import { useTextArtifactContents } from './artifact-text-hydration.ts'
import type { SkillPanelProps } from './shared.ts'
import { emptyWhiteboardScene, loadWhiteboardImages, type WhiteboardDraft, type WhiteboardPanelDraft } from './whiteboard-scene.ts'
import { scenePath, validateScene } from '../../../../skills-web-app/bundles/whiteboard/scripts/scene.mjs'

function WhiteboardPlaceholder({ title, hint, loading = false, error = false }: {
  title: string; hint: string; loading?: boolean; error?: boolean
}): ReactElement {
  return <div role={error ? 'alert' : 'status'} className='flex h-full w-full items-center justify-center overflow-auto bg-[var(--ds-bg-gary-default)]'>
    <div className='flex max-w-md flex-col items-center gap-2 px-8 py-8 text-center'>
      <div aria-hidden='true' className='flex h-12 w-12 shrink-0 items-center justify-center rounded-full border border-dashed border-[#D9D5E8] bg-white text-[#A89BD8]'>
        {loading ? <LoaderCircle className='h-5 w-5 animate-spin' /> : <Pencil className='h-5 w-5' />}
      </div>
      <div className='text-sm font-medium text-[var(--ds-text-primary)]'>{title}</div>
      <div className='break-words text-xs leading-[18px] text-gray-500'>{hint}</div>
    </div>
  </div>
}

/** A mount represents one file version or one preserved local draft, never both. */
function Canvas({ scene, disabled, readImages, onChange }: {
  scene: WhiteboardDraft; disabled: boolean; readImages: SkillPanelProps['readBinaryArtifact']; onChange: (scene: WhiteboardDraft) => void
}): ReactElement {
  const [initial, setInitial] = useState<ExcalidrawInitialDataState>()
  const [missing, setMissing] = useState<string[]>([])
  const baseline = useRef<string>()
  const source = useRef(scene)
  const change = useRef(onChange)
  change.current = onChange
  useEffect(() => {
    let disposed = false
    void loadWhiteboardImages(source.current, readImages).then(result => {
      if (disposed) return
      const files = Object.fromEntries([...result.files, ...Object.values(source.current.pendingFiles ?? {})].map(f => [f.id, f]))
      setMissing(result.missing.filter(id => !source.current.pendingFiles?.[id]))
      setInitial({ elements: source.current.elements as ExcalidrawInitialDataState['elements'],
        appState: { ...source.current.appState, currentItemFontFamily: 2 }, files: files as BinaryFiles, scrollToContent: true })
    })
    return () => { disposed = true }
  }, [readImages])
  if (!initial) return <WhiteboardPlaceholder loading title='正在读取白板' hint='正在准备画布及图片资源。' />
  return <div style={{ height: '100%', minHeight: 360, position: 'relative' }}>
    {missing.length > 0 && <div role="alert">部分图片未能读取，原引用已保留：{missing.join(', ')}</div>}
    <Excalidraw initialData={initial} viewModeEnabled={disabled} langCode="zh-CN"
      handleKeyboardGlobally={false} validateEmbeddable={false}
      onLinkOpen={(_element: unknown, event: CustomEvent) => event.preventDefault()}
      UIOptions={{ canvasActions: { loadScene: false, saveToActiveFile: false, export: false } }}
      onChange={(elements: readonly OrderedExcalidrawElement[], appState: AppState, files: BinaryFiles) => {
        const durable = { elements, appState: { viewBackgroundColor: appState.viewBackgroundColor } }
        const serialized = JSON.stringify(durable)
        // Native restore is hydration, not an edit. Selection/pan/zoom never dirties the scene.
        if (baseline.current === undefined) { baseline.current = serialized; return }
        if (disabled || baseline.current === serialized) return
        baseline.current = serialized
        const pendingFiles = { ...source.current.pendingFiles }
        for (const [id, file] of Object.entries(files)) if (!source.current.files[id]) pendingFiles[id] = file
        change.current({ ...durable, files: source.current.files, pendingFiles })
      }} />
  </div>
}

export function WhiteboardPanel(props: SkillPanelProps): ReactElement {
  const draft = props.draft as WhiteboardPanelDraft
  const state = draft?.boards && Array.isArray(draft.board_order) ? draft : { boards: {}, board_order: [] }
  const [selected, setSelected] = useState('')
  const id = state.boards[selected] ? selected : state.board_order[0]
  const board = state.boards[id]
  const entries = useMemo(() => state.board_order.map(key => ({ id: key, path: state.boards[key].artifact_file })), [state.boards, state.board_order])
  const contents = useTextArtifactContents(entries, props.readArtifact, props.originalState, props.artifactFiles)
  const pending = state._scenes?.[id]
  let scene: WhiteboardDraft | undefined, error = ''
  try {
    if (pending) scene = pending.scene
    else if (typeof contents[id] === 'string') scene = validateScene(JSON.parse(contents[id]!))
  } catch (e) { error = `场景不能读取：${String(e)}` }
  // Hash notifications can arrive before the asynchronous text read. Include
  // hydrated bytes too so a clean canvas mounts the new scene once it arrives.
  const fileKey = board ? JSON.stringify([props.artifactFiles?.[board.artifact_file], contents[id],
    Object.values(scene?.files ?? {}).map(file => props.artifactFiles?.[file.path])]) : 'new'
  const absent = board && props.artifactFiles !== undefined && props.artifactFiles[board.artifact_file] === undefined
  const update = (next: WhiteboardPanelDraft) => { if (!props.running) props.onChange(next) }
  const move = (delta: number) => {
    const order = [...state.board_order], from = order.indexOf(id), to = from + delta
    if (to < 0 || to >= order.length) return
    ;[order[from], order[to]] = [order[to], order[from]]
    update({ ...state, board_order: order })
  }
  return <NativeDesignPanelFrame autoSaveId="whiteboard-sidebar">
    <DesignPanelSidebar icon={<Pencil />} title={`自由白板 (${state.board_order.length})`}>
      {state.board_order.map(key => <DesignPanelNavItem key={key} selected={id === key} onClick={() => setSelected(key)}>{state.boards[key].title}</DesignPanelNavItem>)}
      <DesignPanelAddButton disabled={props.running} onClick={() => {
        const key = `board-${crypto.randomUUID()}`
        update({ ...state, boards: { ...state.boards, [key]: { id: key, title: '新主题', artifact_file: scenePath(key) } },
          board_order: [...state.board_order, key], _scenes: { ...state._scenes, [key]: { scene: emptyWhiteboardScene(), baseKey: 'new' } } })
        setSelected(key)
      }}>新建主题</DesignPanelAddButton>
    </DesignPanelSidebar>
    <NativeDesignPanelContent mode='workspace' className='flex flex-col'>
      {!board ? <EmptyPanel message='新建一个主题，开始共同绘制。' /> : <>
        <div style={{ display: 'flex', gap: 8, padding: 12, alignItems: 'center' }}>
          <Input aria-label="白板主题名称" style={{ flex: 1, minWidth: 0 }} value={board.title} disabled={props.running} onChange={e => update({ ...state, boards: { ...state.boards, [id]: { ...board, title: e.target.value } } })} />
          <Button variant="outline" size="sm" disabled={props.running || state.board_order.indexOf(id) === 0} onClick={() => move(-1)}>上移</Button>
          <Button variant="outline" size="sm" disabled={props.running || state.board_order.indexOf(id) === state.board_order.length - 1} onClick={() => move(1)}>下移</Button>
          <Button variant="ghost" size="sm" disabled={props.running} onClick={() => {
            if (!window.confirm(`删除主题“${board.title}”？保存后生效，历史文件不会被清除。`)) return
            const boards = { ...state.boards }, scenes = { ...state._scenes }
            delete boards[id]; delete scenes[id]
            update({ ...state, boards, board_order: state.board_order.filter(key => key !== id), _scenes: scenes })
          }}>删除主题</Button>
        </div>
        {pending && pending.baseKey !== 'new' && pending.baseKey !== fileKey && <p role="alert">文件已有更新，当前未保存草稿已保留。保存将使用你的草稿；可先取消编辑以读取最新文件。</p>}
        <div className='min-h-0 flex-1'>
          {error ? <WhiteboardPlaceholder error title='场景不能读取' hint={error} />
            : scene ? <Canvas key={`${id}:${pending?.baseKey ?? fileKey}`} scene={scene} disabled={!!props.running} readImages={props.readBinaryArtifact}
              onChange={next => update({ ...state, _scenes: { ...state._scenes, [id]: { scene: next, baseKey: pending?.baseKey ?? fileKey } } })} />
            : absent ? <WhiteboardPlaceholder title='白板场景尚未生成' hint='主题已创建，场景文件落盘后会自动显示。也可以在主对话中提出绘制要求。' />
            : contents[id] === null ? <WhiteboardPlaceholder title='白板场景暂不可用' hint='暂时无法读取场景文件，原引用已保留，未替换为空白画布。' />
            : <WhiteboardPlaceholder loading title='正在读取白板' hint='场景内容读取完成后会在这里显示。' />}
        </div>
      </>}
    </NativeDesignPanelContent>
  </NativeDesignPanelFrame>
}
