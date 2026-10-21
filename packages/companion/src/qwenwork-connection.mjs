/** QwenWork WorkerTransport uses a worker thread inside the desktop main process. */
import { readFile, realpath } from 'node:fs/promises'
import { createHash } from 'node:crypto'
import { createReadStream } from 'node:fs'
import { win32 } from 'node:path'
import { windowsCommandArgs, windowsProcess, withWindowsInspection } from './windows-native-platform.mjs'
async function fileHash(path) {
  const hash = createHash('sha256')
  for await (const chunk of createReadStream(path)) hash.update(chunk)
  return hash.digest('hex')
}
export async function readQwenWorkRuntimePins({ platform = process.platform, environment = process.env, read = readFile } = {}) {
  if (platform !== 'win32') throw Error('QwenWork adapter currently requires native Windows.')
  const configured = environment.YUGOO_QWENWORK_RUNTIME_CONFIG
  if (configured !== undefined && (typeof configured !== 'string' || !win32.isAbsolute(configured) || /[\r\n\0]/.test(configured))) throw Error('Exact absolute QwenWork runtime configuration required.')
  return JSON.parse(await read(configured ?? new URL('./qwenwork-runtime.json', import.meta.url), 'utf8'))
}
export function matchesQwenWorkMain(snapshot, pins) {
  const same = (a,b) => typeof a === 'string' && typeof b === 'string' && win32.normalize(a).toLowerCase() === win32.normalize(b).toLowerCase()
  const args = windowsCommandArgs(snapshot.commandLine)
  return win32.isAbsolute(pins.executable) && args.length === 1 && same(snapshot.executable,pins.executable) && same(args[0],pins.executable)
}
export async function inspectQwenWorkProcess(pid, pins, { snapshot=windowsProcess, canonical=realpath, bytes, initial }={}) {
  for (const k of ['executableSha256','workerSha256']) if (!/^[a-f0-9]{64}$/.test(pins[k]??'')) throw Error('Exact QwenWork runtime pins required.')
  if (!win32.isAbsolute(pins.worker)) throw Error('Exact QwenWork worker path required.')
  const before=initial ?? await snapshot(pid)
  if (!matchesQwenWorkMain(before,pins)) return {...before,supported:false}
  for (const [path,hash] of [[pins.executable,pins.executableSha256],[pins.worker,pins.workerSha256]]) {
    if (win32.normalize(await canonical(path)).toLowerCase() !== win32.normalize(path).toLowerCase()) throw Error('QwenWork runtime path resolves outside its pins.')
    const actual = bytes ? createHash('sha256').update(await bytes(path)).digest('hex') : await fileHash(path)
    if (actual!==hash) throw Error('QwenWork runtime bytes changed; refresh the verified installation pins.')
  }
  const after=await snapshot(pid)
  if (after.procStart!==before.procStart || after.parent!==before.parent || after.executable!==before.executable || after.commandLine!==before.commandLine) throw Error('QwenWork process changed during verification.')
  return {...after,supported:true}
}
export async function qwenworkProcess(pid, options) {return inspectQwenWorkProcess(pid,await readQwenWorkRuntimePins(),options)}
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
  return withWindowsInspection(() => findQwenWorkAncestor(process.ppid,(pid,initial)=>inspectQwenWorkProcess(pid,pins,{initial}),windowsProcess))
}
