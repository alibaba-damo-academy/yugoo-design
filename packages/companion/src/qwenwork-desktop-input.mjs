/** Experimental, explicitly enabled desktop user-input transport. No model client. */
import { realpath } from 'node:fs/promises'
import { join, win32, posix } from 'node:path'
import { homedir } from 'node:os'
import { randomUUID } from 'node:crypto'
import { qwenworkProcess } from './qwenwork-connection.mjs'
import { createWindowsProcessInspector } from './windows-native-platform.mjs'
import { createQwenWorkHookConnection } from './qwenwork-hook-transport.mjs'
import { readNativePrivateFile } from './native-hook-transport.mjs'

/** Browser user actions need a user-input transport, not an event receipt. */
export function resolveQwenWorkInputMode({ host = 'codex', qwenworkDesktop, qwenworkEventsOnly } = {}) {
  if (host !== 'qwenwork') {
    if (qwenworkDesktop !== undefined || qwenworkEventsOnly !== undefined) throw Error('QwenWork input options are QwenWork-only.')
    return undefined
  }
  if (qwenworkDesktop !== undefined && qwenworkDesktop !== true) throw Error('Use explicit qwenworkEventsOnly for event-only delivery; desktop input cannot silently be disabled.')
  if (qwenworkEventsOnly !== undefined && typeof qwenworkEventsOnly !== 'boolean') throw Error('qwenworkEventsOnly must be boolean.')
  if (qwenworkDesktop && qwenworkEventsOnly) throw Error('Choose desktop input or events-only, not both.')
  return qwenworkEventsOnly === true ? 'events-only' : 'desktop'
}

export async function createQwenWorkPanelConnection(options, {
  desktop = createQwenWorkDesktopInput, hooks = createQwenWorkHookConnection,
} = {}) {
  const inputMode = resolveQwenWorkInputMode({ ...options, host: 'qwenwork' })
  const binding = { sessionId: options.sessionId, nativeCwd: options.nativeCwd, transcriptPath: options.transcriptPath }
  const openEvents = () => hooks({ ...binding, timeoutMs: 30000 })
  if (inputMode === 'events-only') return { ...await openEvents(), inputMode }
  let connection
  try { connection = await desktop(binding) }
  catch (error) {
    throw new Error('QwenWork 用户消息通道不可用，面板未启动。请检查已授权的桌面控制设置与当前会话绑定；不会自动改用 Hook 通知。原因：' + error.message, { cause: error })
  }
  let events
  return { ...connection, inputMode, async sendEvent(text) {
    events ??= await openEvents()
    return events.send(text)
  } }
}

export async function createDesktopInputConnection({ sessionId, nativeCwd, request, verifyBinding }) {
  const binding = await verifyBinding()
  const status = await request('desktop.status', {})
  if (status.protocol !== 'qwenwork.desktop.v1' || !status.authenticated || !status.features?.task_execution) throw Error('QwenWork desktop input is unavailable.')
  const inspect = async () => {
    if (await verifyBinding() !== binding) throw Error('QwenWork desktop binding changed; reopen the Panel.')
    const value = await request('session.get', { session_id: binding })
    if (value.session?.session_id !== binding || value.session.workspace !== nativeCwd) throw Error('QwenWork desktop session/workspace mismatch.')
    return value
  }
  await inspect()
  return { host: 'qwenwork', threadId: sessionId, async send(text) {
    if (typeof text !== 'string' || !text.trim() || text.length > 64000) throw Error('QwenWork input must contain 1–64000 characters.')
    const current = await inspect()
    if (current.task && !current.task.terminal) return { accepted: false, status: 'busy' }
    const requestId = randomUUID()
    let result
    try { result = await request('task.submit', { session_id: binding, request_id: requestId, prompt: text }) }
    catch (error) {
      if (error.code === 'SESSION_BUSY') return { accepted: false, status: 'busy' }
      // Never fall back to Hooks after a possibly accepted input, or resend it.
      throw Object.assign(Error('QwenWork 用户消息提交未确认；请核对原会话，不要重复发送。'), { requestId })
    }
    if (result.task_id !== requestId || result.session_id !== binding || !['starting','running','completed'].includes(result.status)) throw Error('QwenWork did not confirm user-input acceptance; inspect the original conversation.')
    return { accepted: true, status: 'user_input_accepted', taskId: requestId }
  } }
}

export function qwenWorkUserDataRoot({ platform=process.platform, environment=process.env, home=homedir() }={}) {
  if (platform === 'win32' && typeof environment.APPDATA === 'string' && win32.isAbsolute(environment.APPDATA)) return win32.join(environment.APPDATA, 'QwenWorkCN')
  if (platform === 'darwin' && typeof home === 'string' && posix.isAbsolute(home)) return posix.join(home, 'Library/Application Support/QwenWorkCN')
  throw Error('Native Windows or macOS QwenWork user-data path required.')
}

export async function createQwenWorkDesktopInput(options, {
  platform=process.platform, environment=process.env, home=homedir(), canonical=realpath,
  readPrivate=readNativePrivateFile, inspectProcess=qwenworkProcess,
  createInspector=createWindowsProcessInspector, fetchRequest=fetch,
  openDatabase=async path=>{ const {DatabaseSync}=await import('node:sqlite'); return new DatabaseSync(path,{readOnly:true}) },
}={}) {
  const root = qwenWorkUserDataRoot({platform,environment,home})
  if (!/^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i.test(options.sessionId ?? '')) throw Error('Exact QwenWork session UUID required.')
  const endpointFile = join(root, 'cli-control/endpoint.json')
  let endpoint
  try { endpoint = JSON.parse(await readPrivate(endpointFile)) }
  catch (error) {
    if (error.code === 'ENOENT') throw Error('QwenWork desktop control endpoint is unavailable; enable only through authorized host setup, or explicitly select --qwenwork-events-only.',{cause:error})
    throw error
  }
  if (endpoint.protocol !== 'qwenwork.desktop.v1' || !/^[a-f0-9]{32}$/.test(endpoint.instance_id) || !Number.isInteger(endpoint.port) || endpoint.port < 1 || endpoint.port > 65535) throw Error('Invalid QwenWork desktop endpoint.')
  const tokenFile = join(root, 'cli-control', endpoint.instance_id, 'token')
  const token = await readPrivate(tokenFile)
  if (!/^[a-f0-9]{64}$/.test(token)) throw Error('Invalid QwenWork desktop credential.')
  const nativeCwd = await canonical(options.nativeCwd)
  const transcriptPath = await canonical(options.transcriptPath)
  const bindingFile = join(home, '.local/state/design-system/qwenwork-hooks', options.sessionId, 'binding.json')
  const original = JSON.parse(await readPrivate(bindingFile))
  const inspector = platform === 'win32' ? createInspector() : {close(){}}
  const verifyBinding = async () => {
    const current = JSON.parse(await readPrivate(bindingFile))
    const processInfo = await inspectProcess(original.pid, {platform,...(inspector.snapshot?{snapshot:inspector.snapshot}:{})})
    if (!processInfo.supported || processInfo.procStart !== original.procStart || current.pid !== original.pid || current.procStart !== original.procStart || current.cwd !== nativeCwd || current.transcriptPath !== transcriptPath || original.cwd !== nativeCwd || original.transcriptPath !== transcriptPath) throw Error('QwenWork native identity changed; reopen the Panel.')
    const db = await openDatabase(join(root, 'data/agents.db'))
    try {
      db.exec('PRAGMA query_only=ON')
      const rows = db.prepare('SELECT id FROM sub_chats WHERE session_id=?').all(options.sessionId)
      if (rows.length !== 1 || typeof rows[0].id !== 'string') throw Error('Unique QwenWork original-session mapping required.')
      return rows[0].id
    } finally { db.close() }
  }
  const request = async (method, params) => {
    const current = JSON.parse(await readPrivate(endpointFile))
    if (current.protocol !== endpoint.protocol || current.instance_id !== endpoint.instance_id || current.port !== endpoint.port || await readPrivate(tokenFile) !== token) throw Error('QwenWork desktop instance changed; reopen the Panel.')
    const response = await fetchRequest(`http://127.0.0.1:${endpoint.port}/v1/control`, { method: 'POST', redirect: 'error',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify({ schema_version: 'qwenwork.desktop-request.v1', method, params }), signal: AbortSignal.timeout(20000) })
    if (response.headers.get('x-qwenwork-instance') !== endpoint.instance_id) throw Error('QwenWork desktop response instance mismatch.')
    const body = await response.json()
    if (!response.ok || body.schema_version !== 'qwenwork.response.v1' || body.ok !== true) throw Object.assign(Error('QwenWork desktop request rejected.'), { code: body.error?.code })
    return body.data
  }
  try {
    const connection = await createDesktopInputConnection({ sessionId: options.sessionId, nativeCwd, request, verifyBinding })
    return { ...connection, close: () => inspector.close() }
  } catch (error) { inspector.close(); throw error }
}
