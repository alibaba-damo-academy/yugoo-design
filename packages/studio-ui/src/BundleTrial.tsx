import { useEffect, useMemo, useRef, useState, useSyncExternalStore, type ReactElement } from 'react'
import { createPortal } from 'react-dom'
import { LoadingIndicator } from './LoadingIndicator.tsx'
import { StudioTrialController, checkStudioTrialConnection, localTrialUrl, trialActive, trialBlocksNewRun, type StudioTrialClient, type StudioTrialSource } from './trial-controller.ts'

const controllers = new WeakMap<StudioTrialClient, Map<string, StudioTrialController>>()
let panelActionSequence = 0
function controllerFor(client: StudioTrialClient, source: StudioTrialSource): StudioTrialController {
  let entries = controllers.get(client)
  if (!entries) { entries = new Map(); controllers.set(client, entries) }
  const key = JSON.stringify(source)
  let controller = entries.get(key)
  if (!controller) { controller = new StudioTrialController(client, source); entries.set(key, controller) }
  return controller
}

/** Host-owned execution; the editor holds only the next run's input. */
export function BundleTrial({ client, source, locale, disabled = false, target, onOpen, visible = true, launchRef, onDirtyChange }: {
  client: StudioTrialClient; source: StudioTrialSource; locale: 'zh' | 'en'; disabled?: boolean; target?: HTMLElement | null; onOpen?: () => void; visible?: boolean; launchRef?: { current: (() => void) | undefined }; onDirtyChange?: (dirty: boolean) => void
}): ReactElement {
  const key = JSON.stringify(source)
  const controller = useMemo(() => controllerFor(client, source), [client, key])
  const state = useSyncExternalStore(controller.subscribe, controller.getSnapshot, controller.getSnapshot)
  const [open, setOpen] = useState(false), [task, setTask] = useState('')
  const frame = useRef<HTMLIFrameElement>(null)
  const [connectionSlow, setConnectionSlow] = useState(false)
  const [hostState, setHostState] = useState<'idle' | 'checking' | 'available' | 'unavailable' | 'unknown'>('idle')
  const checkingHost = useRef(false), launchGeneration = useRef(0)
  useEffect(() => { ++launchGeneration.current; setHostState('idle'); return () => { ++launchGeneration.current } }, [controller])
  const [controls, setControls] = useState<{ dirty: boolean; saving: boolean; saveDisabled: boolean; retractDisabled: boolean; error?: string }>()
  const notifyDirty = useRef(onDirtyChange)
  notifyDirty.current = onDirtyChange
  useEffect(() => { notifyDirty.current?.(controls?.dirty ?? false) }, [controls?.dirty])
  useEffect(() => () => notifyDirty.current?.(false), [])
  const edited = useRef(false), selected = useRef<string>(), recovery = useRef<Promise<void>>()
  const zh = locale === 'zh', record = state.record, active = trialActive(record)
  const outputLocale = zh ? 'zh-CN' : 'en-US'
  const blocked = state.history?.some(trialBlocksNewRun) ?? false
  useEffect(() => { recovery.current = controller.recover() }, [controller])
  useEffect(() => { if (target !== undefined && visible) setOpen(true) }, [target, visible])
  useEffect(() => {
    if (!active) return
    const timer = setInterval(() => { void controller.refresh() }, 2500)
    return () => clearInterval(timer)
  }, [controller, active])
  useEffect(() => {
    if (selected.current !== record?.id) { selected.current = record?.id; edited.current = false }
    if (!edited.current) setTask(record?.task ?? '')
  }, [record?.id, record?.task])
  const labels = zh
    ? { preparing: '准备中', queued: '排队中', running: '运行中', waiting: '可体验', completed: '已完成', failed: '失败', stopped: '已停止', unknown: '待确认' }
    : { preparing: 'Preparing', queued: 'Queued', running: 'Running', waiting: 'Ready to try', completed: 'Completed', failed: 'Failed', stopped: 'Stopped', unknown: 'Unconfirmed' }
  const panelUrl = record && localTrialUrl(client.panelUrl?.(record))
  const sendAction = (action: 'save' | 'retract' | 'read-state') => {
    if (!panelUrl || !record) return
    // Correlation/deduplication only; authentication is the exact window, origin and trial binding.
    frame.current?.contentWindow?.postMessage({ type: 'yugoo-design:trial-panel-action', trialId: record.id, requestId: `${Date.now()}-${++panelActionSequence}`, action }, new URL(panelUrl).origin)
  }
  useEffect(() => {
    setControls(undefined)
    setConnectionSlow(false)
    if (!panelUrl || !record) return
    const timeout = setTimeout(() => setConnectionSlow(true), 8000)
    const receive = (event: MessageEvent) => {
      if (event.source !== frame.current?.contentWindow || event.origin !== new URL(panelUrl).origin) return
      const data = event.data
      if (!data || data.type !== 'yugoo-design:trial-panel-state' || data.trialId !== record.id
        || !['dirty', 'saving', 'saveDisabled', 'retractDisabled'].every(key => typeof data[key] === 'boolean')
        || (data.error !== undefined && (typeof data.error !== 'string' || data.error.length > 16000))) return
      setControls({ dirty: data.dirty, saving: data.saving, saveDisabled: data.saveDisabled, retractDisabled: data.retractDisabled, error: data.error })
    }
    window.addEventListener('message', receive)
    sendAction('read-state')
    return () => { clearTimeout(timeout); window.removeEventListener('message', receive) }
  }, [panelUrl, record?.id])
  const changed = !!record?.task && task !== record.task
  const run = async (manual = false, inspectOnly = false) => {
    if (disabled || checkingHost.current || (!inspectOnly && blocked)) return
    if (manual && controls?.dirty && !window.confirm(zh ? '面板有未保存修改，放弃并再次运行？' : 'Discard unsaved Panel edits and run again?')) return
    checkingHost.current = true; setHostState('checking')
    const generation = launchGeneration.current
    try {
      const status = await checkStudioTrialConnection(client)
      await recovery.current
      if (generation !== launchGeneration.current) return
      setHostState(status)
      if (status === 'available' && !inspectOnly) {
        if (manual) await controller.start(task, outputLocale)
        else await controller.startExample(outputLocale)
      }
    } catch { if (generation === launchGeneration.current) setHostState('unavailable') }
    finally { checkingHost.current = false }
  }
  const launch = () => { setOpen(true); onOpen?.(); void run(false, !!state.record) }
  useEffect(() => { if (launchRef) launchRef.current = launch; return () => { if (launchRef) launchRef.current = undefined } }, [controller, client, onOpen, launchRef, outputLocale, state.busy, state.record, blocked])
  const workspace = <div className="ygd-studio-trial-workspace" hidden={!visible}>
      <div className="ygd-studio-trial-workarea with-input">
        <aside className="ygd-studio-trial-input">
          <header className="ygd-studio-trial-input-heading"><h3>{zh ? '测试输入' : 'Test Input'}</h3>
            {record && <span className="ygd-studio-trial-status" data-state={record.status} role="status">{labels[record.status]}</span>}
          </header>
          {record?.task ? <>
              <textarea aria-label={zh ? '测试输入' : 'Test input'} rows={12} maxLength={16000} value={task} disabled={blocked || state.busy} onChange={event => { edited.current = true; setTask(event.currentTarget.value) }} />
            {changed && <details><summary>{zh ? '查看本次结果实际使用的输入' : 'Input used for this result'}</summary><pre>{record.task}</pre></details>}
            <button type="button" className="ygd-studio-btn-primary" title={zh ? '使用当前输入开始新的独立试运行' : 'Start a new isolated trial with this input'} disabled={disabled || blocked || state.busy || hostState === 'checking' || !task.trim() || controls?.saving} onClick={() => void run(true)}>{zh ? '再次运行' : 'Run again'}</button>
          </> : <>
            {hostState === 'checking' || active || state.busy ? <LoadingIndicator label={hostState === 'checking' ? zh ? '正在检查宿主连接' : 'Checking host connection' : zh ? '正在准备测试输入' : 'Preparing test input'} /> : <p className="ygd-studio-trial-hint">{zh ? '测试输入将由宿主 Agent 准备，运行后可在这里修改。' : 'The host Agent prepares the first input. You can edit it after the run.'}</p>}
            {!record && !state.busy && ['unavailable', 'unknown'].includes(hostState) && <button type="button" className="ygd-studio-btn-primary" disabled={disabled} onClick={() => void run()}>{zh ? '重新检查并运行' : 'Reconnect and run'}</button>}
          </>}
          {panelUrl && ['unavailable', 'unknown'].includes(hostState) && <p role="alert">{zh ? '无法确认宿主 Agent 连接，暂不能再次运行。' : 'The host Agent connection could not be verified. A new run is unavailable.'}</p>}
          {panelUrl && !controls && connectionSlow && <p role="status">{zh ? '尚未连接到面板。' : 'Panel not connected.'} <button type="button" className="ygd-studio-btn-link" onClick={() => { if (frame.current) frame.current.src = panelUrl }}>{zh ? '重新连接' : 'Reconnect'}</button></p>}
          {active && <button type="button" className="ygd-studio-btn-link" disabled={state.busy} onClick={() => void controller.stop()}>{zh ? '停止试运行' : 'Stop trial'}</button>}
          {state.error && <p role="alert">{state.error}</p>}
        </aside>
        <section className="ygd-studio-trial-result">
          {panelUrl ? <iframe ref={frame} onLoad={() => sendAction('read-state')} key={record!.id} title={zh ? '试运行真实面板' : 'Live Trial Panel'} src={panelUrl} referrerPolicy="no-referrer" /> : hostState === 'checking' || active || state.busy ? <LoadingIndicator label={hostState === 'checking' ? zh ? '正在检查宿主连接' : 'Checking host connection' : zh ? '正在准备试运行面板' : 'Preparing trial panel'} /> : <p className="ygd-studio-trial-availability" role={['unavailable', 'unknown'].includes(hostState) ? 'alert' : 'status'}>{hostState === 'unavailable' ? zh ? '未连接宿主 Agent，试运行暂不可用。请先在宿主中打开设计项目。' : 'The host Agent is not connected. Open this Design Project in the host to use trial runs.' : hostState === 'unknown' ? zh ? '尚无法确认宿主 Agent 的连接，试运行未启动。请检查宿主后重试。' : 'The host Agent connection could not be verified. No trial was started. Check the host and try again.' : zh ? '运行后将在这里显示真实面板。' : 'The live panel will appear here after a run.'}</p>}
      {panelUrl && <footer className="ygd-studio-trial-save">
        {controls?.error && <p role="alert">{controls.error}</p>}
        <button type="button" className="ygd-studio-btn-secondary" disabled={!controls || controls.retractDisabled || controls.saving} onClick={() => sendAction('retract')}>{zh ? '撤销编辑' : 'Undo edits'}</button>
        <button type="button" className="ygd-studio-btn-primary" title={zh ? '仅演示保存后的界面变化，不回传 Agent；刷新恢复原始结果。' : 'Demonstrates the saved UI without notifying the Agent; refresh to restore the original result.'} disabled={!controls || controls.saveDisabled || controls.saving} onClick={() => sendAction('save')}>{controls?.saving ? (zh ? '演示中…' : 'Applying…') : (zh ? '演示保存效果' : 'Demonstrate save')}</button>
      </footer>}
        </section>
      </div>
    </div>
  // A supplied launch control owns the single visible entry in the preview toolbar.
  if (launchRef) return <>{(open || visible) && target ? createPortal(workspace, target) : null}</>
  return <section className="ygd-studio-trial" aria-label={zh ? 'Bundle 试运行' : 'Bundle trial'}>
    <button type="button" className="ygd-studio-btn-primary" disabled={disabled || state.busy} aria-expanded={open && visible}
      onClick={launch}>{zh ? '试运行' : 'Trial run'}</button>
    {(open || (target !== undefined && visible)) && (target === undefined ? workspace : target ? createPortal(workspace, target) : null)}
  </section>
}
