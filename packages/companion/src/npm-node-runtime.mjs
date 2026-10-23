/** Select an existing Node installation. This module never installs or removes it. */
import assert from 'node:assert/strict'
import { execFile } from 'node:child_process'
import { createHash } from 'node:crypto'
import { createReadStream } from 'node:fs'
import { realpath, stat } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { promisify } from 'node:util'

const exec = promisify(execFile)
export const MIN_NODE_VERSION = '22.19.0'
const observationScript = 'process.stdout.write(JSON.stringify({version:process.versions.node,platform:process.platform,arch:process.arch,executable:process.execPath,electron:process.versions.electron||null}))'

export function assertNodeVersion(version) {
  const match = /^v?(\d+)\.(\d+)\.(\d+)$/.exec(version ?? '')
  assert.ok(match, 'A stable Node version is required')
  const numbers = match.slice(1).map(Number)
  assert.ok(numbers.every(Number.isSafeInteger), 'Invalid Node version')
  const [major, minor] = numbers
  assert.ok(major > 22 || major === 22 && minor >= 19, `Node >=${MIN_NODE_VERSION} is required; found ${version}`)
  return match.slice(1).map(Number).join('.')
}

/** Reject deployment-owned locations both before and after resolving aliases. */
export function assertNodeExecutablePath(executable, { platform = process.platform, environment = process.env } = {}) {
  const paths = platform === 'win32' ? path.win32 : path.posix
  assert.ok(typeof executable === 'string' && paths.isAbsolute(executable) && !/[\r\n\0]/.test(executable)
    && (platform !== 'win32' || /^(?:[a-z]:[\\/]|\\\\[^\\]+\\[^\\]+)/i.test(executable)), 'An absolute Node executable path is required')
  const normalized = paths.normalize(executable), parts = normalized.toLowerCase().split(/[\\/]/)
  assert.ok(!parts.some(part => part === 'node_modules' || part.endsWith('preview') || ['.qwenworkcn', '.workbuddy', '.codebuddy', '.loongsuite-pilot'].includes(part)),
    'Select a user/system Node installation, not a plugin, application cache or Preview runtime')
  assert.ok(!parts.includes('resources'),
    'An application-private Node runtime cannot be used as a shared prerequisite')
  const temporaryRoots = [environment.TEMP, environment.TMP, environment.TMPDIR,
    ...(platform === process.platform ? [tmpdir()] : [])].filter(value => typeof value === 'string' && paths.isAbsolute(value))
  for (const root of temporaryRoots) {
    const relative = paths.relative(root, normalized)
    assert.ok(relative === '..' || relative.startsWith('..' + paths.sep) || paths.isAbsolute(relative),
      'A temporary Node runtime cannot be retained by a host registration')
  }
  return normalized
}

async function hashFile(file) {
  const hash = createHash('sha256')
  for await (const bytes of createReadStream(file)) hash.update(bytes)
  return hash.digest('hex')
}
function unchanged(before, after) {
  for (const field of ['dev', 'ino', 'size', 'mtimeMs']) assert.equal(after[field], before[field], 'Node executable changed during verification')
}

export async function inspectNodeRuntime(executable, { environment = process.env, platform = process.platform, arch = process.arch, allowShim = true } = {}) {
  assert.equal(platform, process.platform, 'Node must be verified on its actual operating system')
  assertNodeExecutablePath(executable, { platform, environment })
  const selected = await realpath(executable)
  assertNodeExecutablePath(selected, { platform, environment })
  const before = await stat(selected)
  assert.ok(before.isFile(), 'Node executable must be a regular file')
  // Diagnostics must not inherit a preload or accidentally turn Electron into Node.
  const env = { ...environment }
  for (const key of Object.keys(env)) if (['NODE_OPTIONS', 'NODE_PATH', 'ELECTRON_RUN_AS_NODE'].includes(key.toUpperCase())) delete env[key]
  const { stdout } = await exec(selected, ['--input-type=commonjs', '--eval', observationScript],
    { env, timeout: 10000, maxBuffer: 64 * 1024, windowsHide: true })
  const observed = JSON.parse(stdout)
  assert.ok(!observed.electron, 'Select standalone Node; a host Electron executable has a separate lifecycle')
  const version = assertNodeVersion(observed.version)
  assert.equal(observed.platform, platform, 'Node operating system mismatch')
  assert.equal(observed.arch, arch, 'Node architecture mismatch')
  const actual = await realpath(observed.executable)
  if (actual !== selected) {
    // Version managers may expose an executable shim. Pin the actual versioned
    // Node it launched, never the shim whose target can change after installation.
    assert.ok(allowShim, 'Node reported a different executable')
    const resolved = await inspectNodeRuntime(actual, { environment, platform, arch, allowShim: false })
    unchanged(before, await stat(selected))
    return resolved
  }
  const sha256 = await hashFile(selected)
  unchanged(before, await stat(selected))
  return { executable: selected, sha256, version, platform, arch, verified: true, ownership: 'external' }
}

function envValue(environment, name, platform) {
  const key = platform === 'win32' ? Object.keys(environment).find(key => key.toLowerCase() === name.toLowerCase()) : name
  return key ? environment[key] : undefined
}

export function nodeRuntimeCandidates({ nodeExecutable, environment = process.env, platform = process.platform } = {}) {
  const paths = platform === 'win32' ? path.win32 : path.posix
  const explicit = nodeExecutable ?? envValue(environment, 'YUGOO_NODE_EXECUTABLE', platform)
  if (explicit !== undefined) return [{ executable: assertNodeExecutablePath(explicit, { platform, environment }), source: nodeExecutable !== undefined ? 'explicit' : 'environment' }]
  const candidates = [], seen = new Set()
  const add = (executable, source) => {
    const key = platform === 'win32' ? executable.toLowerCase() : executable
    if (!seen.has(key)) { seen.add(key); candidates.push({ executable, source }) }
  }
  for (let directory of (envValue(environment, 'PATH', platform) ?? '').split(platform === 'win32' ? ';' : ':')) {
    if (directory.startsWith('"') && directory.endsWith('"')) directory = directory.slice(1, -1)
    if (paths.isAbsolute(directory)) add(paths.join(directory, platform === 'win32' ? 'node.exe' : 'node'), 'path')
  }
  if (platform === 'win32') {
    for (const root of [envValue(environment, 'ProgramFiles', platform), envValue(environment, 'LOCALAPPDATA', platform)])
      if (typeof root === 'string' && paths.isAbsolute(root)) add(paths.join(root, 'nodejs', 'node.exe'), 'system-installation')
  }
  return candidates.slice(0, 128)
}

export async function resolveNodeRuntime({ nodeExecutable, environment = process.env, platform = process.platform, arch = process.arch,
  inspect = inspectNodeRuntime } = {}) {
  const candidates = nodeRuntimeCandidates({ nodeExecutable, environment, platform }), rejected = []
  for (const candidate of candidates) {
    try {
      assertNodeExecutablePath(candidate.executable, { platform, environment })
      const observed = await inspect(candidate.executable, { environment, platform, arch })
      assertNodeExecutablePath(observed.executable, { platform, environment })
      assertNodeVersion(observed.version)
      assert.equal(observed.platform, platform); assert.equal(observed.arch, arch)
      assert.equal(observed.verified, true)
      return { ...observed, source: candidate.source, ownership: 'external', installed: false, removal: 'not-owned-do-not-delete' }
    } catch (error) {
      rejected.push({ executable: candidate.executable, reason: error.message })
      // An explicit selection is an instruction, not permission to silently switch.
      if (candidate.source === 'explicit' || candidate.source === 'environment') throw error
    }
  }
  const error = new Error(`No reusable Node >=${MIN_NODE_VERSION} was found. Prepare Node once through your system or version manager, then use --node-executable or YUGOO_NODE_EXECUTABLE. Yugoo did not download a runtime or change PATH.`)
  error.code = 'YUGOO_NODE_REQUIRED'; error.rejected = rejected
  throw error
}

export async function verifyNodeRuntime(selection, options = {}) {
  assert.equal(selection?.verified, true, 'A verified Node selection is required')
  const current = await inspectNodeRuntime(selection.executable, options)
  for (const key of ['executable', 'sha256', 'version', 'platform', 'arch']) assert.equal(current[key], selection[key], `Selected Node ${key} changed`)
  return selection
}

/** Cross-platform archive preparation can retain an explicit locator, not verify it. */
export async function resolveDesktopNodeRuntime(nodeExecutable, { environment = process.env } = {}) {
  if (process.platform === 'win32') return resolveNodeRuntime({ nodeExecutable, environment })
  assert.ok(nodeExecutable, 'Cross-platform preparation requires --node-executable for the target Windows installation')
  return { executable: assertNodeExecutablePath(nodeExecutable, { platform: 'win32', environment }), source: 'explicit-cross-platform',
    verified: false, ownership: 'external', version: null, sha256: null, platform: 'win32', arch: null,
    installed: false, removal: 'not-owned-do-not-delete' }
}
