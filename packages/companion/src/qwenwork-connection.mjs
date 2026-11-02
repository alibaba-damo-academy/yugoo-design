/** QwenWork WorkerTransport uses a worker thread inside the desktop main process. */
import { readFile, realpath } from 'node:fs/promises'
import { createHash } from 'node:crypto'
import { createReadStream } from 'node:fs'
import { win32, posix } from 'node:path'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { windowsCommandArgs, windowsProcess, withWindowsInspection } from './windows-native-platform.mjs'
const execute = promisify(execFile)
function nativePaths(platform) {
  if (platform === 'win32') return win32
  if (platform === 'darwin') return posix
  throw Error('QwenWork adapter requires native Windows or macOS.')
}
const samePath = (a,b,platform) => typeof a === 'string' && typeof b === 'string' && (platform === 'win32'
  ? win32.normalize(a).toLowerCase() === win32.normalize(b).toLowerCase() : posix.normalize(a) === posix.normalize(b))

/** Inspect one PID using system tools. ps lstart is only a consistency check;
 * the desktop generation comes from the native application's AppKit launch date. */
export async function qwenWorkDarwinProcess(pid, { executable, run=execute, uid=process.getuid?.() }={}) {
  if (!Number.isSafeInteger(pid) || pid < 2) throw Error('Invalid native PID.')
  const options = { encoding:'utf8', timeout:15000, maxBuffer:262144, env:{...process.env, LC_ALL:'C', TZ:'UTC'} }
  const ps = async () => {
    const { stdout } = await run('/bin/ps', ['-ww','-p',String(pid),'-o','pid=,ppid=,uid=,lstart=,comm='], options)
    const match = stdout.match(/^\s*(\d+)\s+(\d+)\s+(\d+)\s+([A-Za-z]{3}\s+[A-Za-z]{3}\s+\d{1,2}\s+\d{2}:\d{2}:\d{2}\s+\d{4})\s+([^\r\n]+)\s*$/)
    if (!match || Number(match[1]) !== pid || Number(match[3]) !== uid) throw Error('Incomplete native macOS process identity.')
    return { pid, parent:Number(match[2]), uid:Number(match[3]), observedStart:match[4], executable:match[5].trim() }
  }
  const before = await ps()
  if (before.executable !== executable) return {...before, procStart:undefined, commandLine:''}
  const { stdout:args } = await run('/bin/ps', ['-ww','-p',String(pid),'-o','args='], options)
  const commandLine = args.trim()
  // The same executable also runs Chrome's native-messaging-host/host.js.
  // It is not the desktop main process and carries no application generation.
  if (commandLine !== executable) return {...before, procStart:undefined, commandLine}
  const script = `ObjC.import('AppKit'); var a=$.NSRunningApplication.runningApplicationWithProcessIdentifier(${pid}); if(a.isNil()) throw Error('Native macOS application unavailable'); if(a.executableURL.isNil() || a.launchDate.isNil()) throw Error('Native macOS application identity unavailable'); JSON.stringify({pid:Number(a.processIdentifier),executable:ObjC.unwrap(a.executableURL.path),start:Number(a.launchDate.timeIntervalSince1970),terminated:Boolean(a.terminated)})`
  let app
  try {
    const { stdout } = await run('/usr/bin/osascript', ['-l','JavaScript','-e',script], options)
    app = JSON.parse(stdout)
  } catch (error) {
    throw Error('QwenWork macOS application identity is unobservable in this process context; native generation could not be verified.', {cause:error})
  }
  if (app.pid !== pid || app.executable !== executable || !Number.isFinite(app.start) || app.start <= 0 || app.terminated !== false) throw Error('QwenWork macOS application identity unavailable.')
  const after = await ps()
  if (JSON.stringify(after) !== JSON.stringify(before)) throw Error('QwenWork process changed during verification.')
  return {...after, procStart:`appkit:${app.start}`, commandLine}
}
async function fileHash(path) {
  const hash = createHash('sha256')
  for await (const chunk of createReadStream(path)) hash.update(chunk)
  return hash.digest('hex')
}
export async function readQwenWorkRuntimePins({ platform = process.platform, environment = process.env, read = readFile } = {}) {
  const paths = nativePaths(platform)
  const configured = environment.YUGOO_QWENWORK_RUNTIME_CONFIG
  if (configured !== undefined && (typeof configured !== 'string' || !paths.isAbsolute(configured) || /[\r\n\0]/.test(configured))) throw Error('Exact absolute QwenWork runtime configuration required.')
  return JSON.parse(await read(configured ?? new URL('./qwenwork-runtime.json', import.meta.url), 'utf8'))
}
export function matchesQwenWorkMain(snapshot, pins, { platform=process.platform }={}) {
  const paths = nativePaths(platform)
  if (platform === 'darwin') return paths.isAbsolute(pins.executable) && samePath(snapshot.executable,pins.executable,platform) && snapshot.commandLine === pins.executable && /^appkit:[0-9]+(?:\.[0-9]+)?$/.test(snapshot.procStart ?? '')
  const args = windowsCommandArgs(snapshot.commandLine)
  return paths.isAbsolute(pins.executable) && args.length === 1 && samePath(snapshot.executable,pins.executable,platform) && samePath(args[0],pins.executable,platform)
}
export async function inspectQwenWorkProcess(pid, pins, { platform=process.platform, snapshot=platform==='darwin' ? pid=>qwenWorkDarwinProcess(pid,{executable:pins.executable}) : windowsProcess, canonical=realpath, bytes, initial }={}) {
  const paths = nativePaths(platform)
  for (const k of ['executableSha256','workerSha256']) if (!/^[a-f0-9]{64}$/.test(pins[k]??'')) throw Error('Exact QwenWork runtime pins required.')
  if (!paths.isAbsolute(pins.worker)) throw Error('Exact QwenWork worker path required.')
  const before=initial ?? await snapshot(pid)
  if (!matchesQwenWorkMain(before,pins,{platform})) return {...before,supported:false}
  for (const [path,hash] of [[pins.executable,pins.executableSha256],[pins.worker,pins.workerSha256]]) {
    if (!samePath(await canonical(path),path,platform)) throw Error('QwenWork runtime path resolves outside its pins.')
    const actual = bytes ? createHash('sha256').update(await bytes(path)).digest('hex') : await fileHash(path)
    if (actual!==hash) throw Error('QwenWork runtime bytes changed; refresh the verified installation pins.')
  }
  const after=await snapshot(pid)
  if (after.procStart!==before.procStart || after.parent!==before.parent || after.executable!==before.executable || after.commandLine!==before.commandLine) throw Error('QwenWork process changed during verification.')
  return {...after,supported:true}
}
export async function qwenworkProcess(pid, options={}) {return inspectQwenWorkProcess(pid,await readQwenWorkRuntimePins({platform:options.platform??process.platform}),options)}
export async function findQwenWorkAncestor(startPid, inspect, snapshot) {
  const seen=new Set()
  for(let pid=startPid;Number.isSafeInteger(pid)&&pid>1&&seen.size<10;){
    if(seen.has(pid))throw Error('Native process ancestry loop.')
    seen.add(pid)
    const current=await snapshot(pid),verified=await inspect(pid,current)
    if(verified.supported)return {pid,procStart:verified.procStart}
    pid=current.parent
  }
  throw Error('Hook is not under the pinned QwenWork desktop process.')
}
export async function nativeQwenWorkHookProcess(){
  const pins=await readQwenWorkRuntimePins()
  if (process.platform === 'darwin') return findQwenWorkAncestor(process.ppid,(pid,initial)=>inspectQwenWorkProcess(pid,pins,{initial}),pid=>qwenWorkDarwinProcess(pid,{executable:pins.executable}))
  return withWindowsInspection(() => findQwenWorkAncestor(process.ppid,(pid,initial)=>inspectQwenWorkProcess(pid,pins,{initial}),windowsProcess))
}
