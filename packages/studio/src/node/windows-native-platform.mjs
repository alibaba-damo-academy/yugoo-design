/** Windows facts from native OS tools; no application IPC or model access. */
import { execFile, spawn } from 'node:child_process'
import { createInterface } from 'node:readline'
import { AsyncLocalStorage } from 'node:async_hooks'
import { promisify } from 'node:util'
import { win32 } from 'node:path'
import { readFile, realpath } from 'node:fs/promises'
import { createHash } from 'node:crypto'
const execute = promisify(execFile)
const inspectionScope = new AsyncLocalStorage()
// Explicit lifetime: nested operations reuse the interpreter, never its facts.
// No process is created until a scoped inspection actually needs one.
export async function withWindowsInspection(callback, { createInspector = createWindowsProcessInspector } = {}) {
  if (inspectionScope.getStore()) return callback()
  const scope = { inspector: undefined, createInspector, closed: false }
  try { return await inspectionScope.run(scope, callback) }
  finally { scope.closed = true; scope.inspector?.close() }
}
function scopedInspector() {
  const scope = inspectionScope.getStore()
  if (!scope) return undefined
  if (scope.closed) throw Error('Windows inspection scope has ended.')
  return scope.inspector ??= scope.createInspector()
}
export function windowsSystemTool(name) {
  const root = process.env.SystemRoot ?? 'C:\\Windows'
  if (!win32.isAbsolute(root)) throw Error('Windows system root must be absolute.')
  return win32.join(root, 'System32', ...name.split('/'))
}
export async function windowsPowerShell(script) {
  if (process.platform !== 'win32') throw Error('Windows native inspection requires Windows.')
  const { stdout } = await execute(windowsSystemTool('WindowsPowerShell/v1.0/powershell.exe'), ['-NoProfile', '-NonInteractive', '-EncodedCommand', Buffer.from("$ErrorActionPreference='Stop';" + script, 'utf16le').toString('base64')], { encoding: 'utf8', timeout: 15000, maxBuffer: 262144, windowsHide: true })
  return stdout.trim()
}
export const powerShellLiteral = value => "'" + String(value).replaceAll("'", "''") + "'"
let currentSid
export async function windowsCurrentSid() {
  if (process.platform !== 'win32') throw Error('Windows SID requires Windows.')
  if (currentSid) return currentSid
  const { stdout } = await execute(windowsSystemTool('whoami.exe'), ['/user', '/fo', 'csv', '/nh'], { encoding: 'utf8', timeout: 10000, windowsHide: true })
  const matches = stdout.match(/S-1-5-\d+(?:-\d+)+/g)
  if (matches?.length !== 1) throw Error('Cannot establish current Windows user SID.')
  currentSid = matches[0]
  return currentSid
}
export async function windowsProcess(pid) {
  if (!Number.isSafeInteger(pid) || pid < 2) throw Error('Invalid native PID.')
  const inspector = scopedInspector()
  if (inspector) return inspector.snapshot(pid)
  // ASCII JSON avoids PowerShell 5's locale-dependent stdout encoding. String
  // methods and primitive casts remain valid in ConstrainedLanguage mode.
  const raw = await windowsPowerShell(`$json = Get-CimInstance Win32_Process -Filter 'ProcessId=${pid}' | Select-Object ProcessId,ParentProcessId,@{Name='StartTicks';Expression={[string]$_.CreationDate.Ticks}},ExecutablePath,CommandLine | ConvertTo-Json -Compress; if ($json) { $escaped=''; foreach ($character in $json.ToCharArray()) { if ([int]$character -gt 127) { $escaped += '\\u' + ('{0:x4}' -f [int]$character) } else { $escaped += $character } }; $escaped }`)
  if (!raw) throw Error('Native Windows process has ended.')
  return windowsProcessValue(pid, JSON.parse(raw))
}
export async function windowsSecurityFacts(paths) {
  validateSecurityPaths(paths)
  const inspector = scopedInspector()
  if (inspector) return inspector.security(paths)
  return (await windowsPowerShell(`foreach ($entry in @(${paths.map(powerShellLiteral).join(',')})) { (Get-Item -Force -LiteralPath $entry).Attributes.value__; (Get-Acl -LiteralPath $entry).Sddl }`)).split(/\r?\n/)
}
function validateSecurityPaths(paths) {
  if (!Array.isArray(paths) || !paths.length || paths.length > 64 || paths.some(path =>
    typeof path !== 'string' || !/^(?:[a-zA-Z]:[\\/]|\\\\)/.test(path) || /[\x00-\x1f\x7f]/.test(path)) ||
    Buffer.byteLength(asciiJson(paths)) > 64000) throw Error('Invalid Windows security inspection paths.')
}
const asciiJson = value => JSON.stringify(value).replace(/[\u007f-\uffff]/g, char => '\\u' + char.charCodeAt(0).toString(16).padStart(4, '0'))
function windowsProcessValue(pid, value) {
  if (value.ProcessId !== pid || !/^\d{15,20}$/.test(value.StartTicks ?? '') || !Number.isSafeInteger(value.ParentProcessId) || !value.ExecutablePath || !value.CommandLine) throw Error('Incomplete native Windows process identity.')
  return { pid, parent: value.ParentProcessId, procStart: value.StartTicks, executable: value.ExecutablePath, commandLine: value.CommandLine }
}

// One owned interpreter, fresh CIM/ACL facts for every request. Stdin is data, never
// PowerShell source. Read-Host works with redirected pipes under CLM, but not
// with -NonInteractive; no profile or language/execution-policy changes.
export function createWindowsProcessInspector({ launch = spawn, timeoutMs = 15000 } = {}) {
  const script = `$ErrorActionPreference='Stop'; $ProgressPreference='SilentlyContinue';
while ($true) {
  $line=Read-Host
  if (!$line) { break }
  if ($line.Length -gt 65536) { exit 2 }
  try {
    if ($line -match '^([1-9][0-9]{0,8}):([1-9][0-9]{0,8})$') {
      $sequence=$Matches[1]; $target=$Matches[2]
      $value=Get-CimInstance Win32_Process -Filter ('ProcessId='+$target) | Select-Object ProcessId,ParentProcessId,@{Name='StartTicks';Expression={[string]$_.CreationDate.Ticks}},ExecutablePath,CommandLine
    } elseif ($line -match '^([1-9][0-9]{0,8}):security:(.+)$') {
      $sequence=$Matches[1]; $encodedPaths=$Matches[2]
      if (!$encodedPaths.StartsWith('[') -or !$encodedPaths.EndsWith(']')) { exit 2 }
      $paths=ConvertFrom-Json -InputObject $encodedPaths
      if ($paths.Count -lt 1 -or $paths.Count -gt 64) { exit 2 }
      $value=@(foreach ($entry in $paths) {
        if ($entry -isnot [string] -or $entry -match '[\\x00-\\x1f\\x7f]' -or $entry -notmatch '^(?:[a-zA-Z]:[\\\\/]|\\\\\\\\)') { exit 2 }
        @{path=$entry;attributes=[string](Get-Item -Force -LiteralPath $entry).Attributes.value__;sddl=(Get-Acl -LiteralPath $entry).Sddl}
      })
    } else { exit 2 }
    $json=@{sequence=$sequence;value=$value} | ConvertTo-Json -Compress -Depth 5
    $escaped=''; foreach ($character in $json.ToCharArray()) { if ([int]$character -gt 127) { $escaped += '\\u' + ('{0:x4}' -f [int]$character) } else { $escaped += $character } }
    'YUGOO_PROCESS:'+ $escaped
  } catch { exit 3 }
}`
  const child = launch(windowsSystemTool('WindowsPowerShell/v1.0/powershell.exe'),
    ['-NoLogo', '-NoProfile', '-EncodedCommand', Buffer.from(script, 'utf16le').toString('base64')],
    { windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'] })
  let failure, pending, sequence = 0, queued = 0, tail = Promise.resolve(), outputBytes = 0
  let lines
  const close = (error = Error('Windows process inspector closed.')) => {
    if (failure) return
    failure = error
    if (pending) { pending.reject(error); pending = undefined }
    lines?.close(); child.stdin.destroy(); child.kill()
    process.removeListener('exit', onExit)
  }
  const onExit = () => close()
  process.once('exit', onExit)
  child.once('error', () => close(Error('Windows process inspector could not start.')))
  child.once('exit', () => close(Error('Windows process inspector exited.')))
  child.stdin.on('error', () => close(Error('Windows process inspector pipe closed.')))
  for (const stream of [child.stdout, child.stderr]) stream.on('data', bytes => {
    outputBytes += bytes.length
    if (outputBytes > 262144) close(Error('Windows process inspector response exceeds limit.'))
  })
  // Account for the whole chunk before readline can parse or resolve a frame.
  lines = createInterface({ input: child.stdout })
  lines.on('line', line => {
    if (failure) return
    // Read-Host echoes its input on this native host. Nothing else is accepted.
    if (pending && line === pending.wire) return
    try {
      if (!pending || !line.startsWith('YUGOO_PROCESS:')) throw Error('Unexpected native inspection response.')
      const result = JSON.parse(line.slice(14))
      if (result.sequence !== String(pending.sequence)) throw Error('Native inspection response mismatch.')
      const value = pending.decode(result.value)
      const done = pending; pending = undefined; done.resolve(value)
    } catch (error) { close(error) }
  })
  function request(payload, decode) {
    if (failure) return Promise.reject(failure)
    if (queued >= 16) return Promise.reject(Error('Windows process inspection queue is full.'))
    queued++
    // The deadline includes time behind another caller, not 16 serial timeouts.
    const deadline = setTimeout(() => close(Error('Windows process inspection timed out.')), timeoutMs)
    const result = tail.then(() => {
      if (failure) throw failure
      if (++sequence > 999999999) { close(); throw failure }
      outputBytes = 0
      return new Promise((resolve, reject) => {
        pending = { sequence, wire: `${sequence}:${payload}`, decode, resolve, reject }
        child.stdin.write(pending.wire + '\n')
      })
    })
    tail = result.then(() => {}, () => {})
    return result.finally(() => { clearTimeout(deadline); queued-- })
  }
  return { close, snapshot(pid) {
    if (!Number.isSafeInteger(pid) || pid < 2 || pid > 999999999) return Promise.reject(Error('Invalid native PID.'))
    return request(String(pid), value => windowsProcessValue(pid, value ?? {}))
  }, security(paths) {
    try { validateSecurityPaths(paths) } catch (error) { return Promise.reject(error) }
    const requested = [...paths]
    return request('security:' + asciiJson(requested), value => {
      if (!Array.isArray(value) || value.length !== requested.length || value.some((fact, i) =>
        !fact || fact.path !== requested[i] || typeof fact.attributes !== 'string' || !/^\d+$/.test(fact.attributes) || typeof fact.sddl !== 'string' || !fact.sddl)) throw Error('Incomplete Windows security facts.')
      return value.flatMap(fact => [fact.attributes, fact.sddl])
    })
  } }
}
/** Parse the native CRT quoting contract used for Node/Electron worker argv. */
export function windowsCommandArgs(command) {
  const args = []; let index = 0
  while (index < command.length) {
    while (/\s/.test(command[index] ?? '') && index < command.length) index++
    if (index === command.length) break
    let value = '', quoted = false
    while (index < command.length && (quoted || !/\s/.test(command[index]))) {
      let slashes = 0
      while (command[index] === '\\') { slashes++; index++ }
      if (command[index] === '"') {
        value += '\\'.repeat(Math.floor(slashes / 2))
        if (slashes % 2) value += '"'
        else if (quoted && command[index + 1] === '"') { value += '"'; index++ }
        else quoted = !quoted
        index++
      } else { value += '\\'.repeat(slashes); if (index < command.length && (quoted || !/\s/.test(command[index]))) value += command[index++] }
    }
    if (quoted) throw Error('Malformed native Windows command line.')
    args.push(value)
  }
  return args
}
export function matchesWindowsWorker(snapshot, { executable, worker }) {
  if (!win32.isAbsolute(executable) || !win32.isAbsolute(worker)) throw Error('Exact absolute native runtime pins required.')
  const same = (left, right) => win32.normalize(left).toLowerCase() === win32.normalize(right).toLowerCase()
  const args = windowsCommandArgs(snapshot.commandLine)
  return args.length === 3 && same(snapshot.executable, executable) && same(args[0], executable) && same(args[1], worker) && args[2] === '--sdk'
}
export async function inspectWindowsWorker(pid, pins) {
  for (const key of ['executableSha256', 'workerSha256']) if (!/^[a-f0-9]{64}$/.test(pins[key] ?? '')) throw Error('Exact native runtime byte pins required.')
  const before = await windowsProcess(pid)
  if (!matchesWindowsWorker(before, pins)) return { ...before, supported: false }
  const [executable, worker] = await Promise.all([realpath(pins.executable), realpath(pins.worker)])
  if (!matchesWindowsWorker(before, { executable, worker })) throw Error('Native runtime path resolves outside its pins.')
  const hashes = await Promise.all([executable, worker].map(async path => createHash('sha256').update(await readFile(path)).digest('hex')))
  if (hashes[0] !== pins.executableSha256 || hashes[1] !== pins.workerSha256) throw Error('Native runtime bytes do not match pins.')
  const after = await windowsProcess(pid)
  if (after.procStart !== before.procStart || after.parent !== before.parent || after.commandLine !== before.commandLine || after.executable !== before.executable) throw Error('Native Windows process changed during verification.')
  return { ...after, supported: true }
}
