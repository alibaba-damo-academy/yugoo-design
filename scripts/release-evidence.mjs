/** Local-only evidence lifecycle for the physical-distribution gate. */
import { spawnSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { constants as osConstants, tmpdir } from 'node:os'
import { dirname, isAbsolute, join, relative, resolve, sep } from 'node:path'
import { lstatSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, realpathSync, renameSync, rmSync, writeFileSync } from 'node:fs'

const phases = new Set(['initializing', 'pack', 'prepare-consumer', 'install', 'prepare-verifier', 'verify', 'finalize'])
class EvidenceError extends Error {
  constructor(category) {
    super(`Release evidence failure: ${category}`)
    this.category = category
  }
}
const categoryOf = error => error instanceof EvidenceError ? error.category : error instanceof AggregateError ? categoryOf(error.errors[0]) : 'unknown_error'
const sha256 = path => createHash('sha256').update(readFileSync(path)).digest('hex')
const inside = (parent, child) => {
  const path = relative(parent, child)
  return path === '' || (!isAbsolute(path) && path !== '..' && !path.startsWith(`..${sep}`))
}

export function parseEvidenceDirectory(args) {
  if (args.length === 0) return undefined
  if (args.length !== 2 || args[0] !== '--evidence-dir' || !isAbsolute(args[1]) || /[\0\r\n]/u.test(args[1])) {
    throw new EvidenceError('invalid_arguments')
  }
  return resolve(args[1])
}

function createRoot(directory, workspace) {
  if (!directory) return mkdtempSync(join(tmpdir(), 'dsh-design-release-gate-'))
  // Canonicalize the existing parent, but never follow or reuse the target.
  const parent = realpathSync(dirname(directory))
  const target = join(parent, relative(dirname(directory), directory))
  const source = realpathSync(workspace)
  if (inside(source, target) || inside(target, source)) throw new EvidenceError('workspace_overlap')
  mkdirSync(target, { mode: 0o700 }) // EEXIST also rejects files and dangling symlinks.
  return target
}

function metadata(workspace, scriptPath, pnpm, runner) {
  const query = (command, args) => {
    try {
      const result = runner(command, args, { cwd: workspace, encoding: 'utf8', timeout: 5000, maxBuffer: 64 * 1024 })
      return result.status === 0 && !result.error && !result.signal && typeof result.stdout === 'string' ? result.stdout : undefined
    } catch { return undefined }
  }
  const head = query('git', ['rev-parse', 'HEAD'])?.trim()
  const status = query('git', ['status', '--porcelain=v1', '-z', '--untracked-files=normal'])
  const version = query(pnpm, ['--version'])?.trim()
  let scriptSha256 = 'unknown'
  try { scriptSha256 = sha256(scriptPath) } catch { /* Missing metadata never means clean. */ }
  return {
    candidate: { head: /^(?:[a-f0-9]{40}|[a-f0-9]{64})$/u.test(head ?? '') ? head : 'unknown', dirty: status === undefined ? 'unknown' : status.length > 0 },
    scriptSha256,
    runtime: { node: process.version, pnpm: /^\d+\.\d+\.\d+(?:[-+][0-9A-Za-z.-]+)*$/u.test(version ?? '') ? version : 'unknown', platform: process.platform, arch: process.arch },
  }
}

function artifacts(root) {
  const directory = join(root, 'tarballs')
  let info
  try { info = lstatSync(directory) } catch (error) { if (error.code === 'ENOENT') return []; throw new EvidenceError('artifact_read_error') }
  if (!info.isDirectory() || info.isSymbolicLink()) throw new EvidenceError('unsafe_artifact')
  return readdirSync(directory).filter(name => name.endsWith('.tgz')).sort().map(name => {
    if (!/^[a-zA-Z0-9_.+-]+\.tgz$/u.test(name)) throw new EvidenceError('unsafe_artifact')
    const file = join(directory, name)
    const stat = lstatSync(file)
    if (!stat.isFile() || stat.isSymbolicLink()) throw new EvidenceError('unsafe_artifact')
    return { path: `tarballs/${name}`, bytes: stat.size, sha256: sha256(file) }
  })
}

/** runner injection is for small offline tests; production uses spawnSync. */
export async function withReleaseEvidence({ args = [], workspace, scriptPath, pnpm, runner = spawnSync, report = path => console.error(`Local evidence (not reviewed for publication): ${path}`) }, action) {
  const directory = parseEvidenceDirectory(args)
  const root = createRoot(directory, workspace)
  const retained = directory !== undefined
  const record = {
    schemaVersion: 1, gate: 'physical-overrides', publicationStatus: 'local-unreviewed',
    status: 'running', phase: 'initializing', startedAt: new Date().toISOString(),
    steps: [], artifacts: [], artifactsStatus: 'pending',
  }
  let serial = 0
  const persist = () => {
    if (!retained) return
    try {
      const temporary = join(root, `evidence-${serial++}.tmp`)
      writeFileSync(temporary, `${JSON.stringify(record, null, 2)}\n`, { flag: 'wx', mode: 0o600 })
      renameSync(temporary, join(root, 'evidence.json'))
    } catch { throw new EvidenceError('evidence_write_error') }
  }
  const phase = value => {
    if (!phases.has(value)) throw new EvidenceError('invalid_phase')
    record.phase = value
    persist()
  }
  const persistStep = failure => {
    try { persist() }
    catch (writeError) {
      if (failure) throw new AggregateError([failure, writeError], 'Release command failed; evidence could not be saved.')
      throw writeError
    }
  }
  const run = (value, command, commandArgs, options = {}) => {
    phase(value)
    const step = { phase: value, status: 'running', startedAt: new Date().toISOString() }
    record.steps.push(step)
    persist() // An interrupted process leaves running, never a fabricated pass.
    let result
    try { result = runner(command, commandArgs, { cwd: workspace, encoding: 'utf8', ...options }) }
    catch {
      Object.assign(step, { status: 'failed', endedAt: new Date().toISOString(), exitCode: null, signal: null, errorCategory: 'spawn_error' })
      const failure = new EvidenceError('spawn_error')
      persistStep(failure)
      throw failure
    }
    const failed = result.error || result.signal || result.status !== 0
    step.status = failed ? 'failed' : 'passed'
    step.endedAt = new Date().toISOString()
    step.exitCode = Number.isInteger(result.status) ? result.status : null
    step.signal = result.signal ? (Object.hasOwn(osConstants.signals, result.signal) ? result.signal : 'unknown') : null
    if (failed) {
      step.errorCategory = result.error?.code === 'ENOBUFS' ? 'output_buffer_limit' : result.error ? 'spawn_error' : result.signal ? 'signal' : 'nonzero_exit'
    }
    const failure = failed ? new EvidenceError(step.errorCategory) : undefined
    persistStep(failure)
    if (failed) {
      if (retained) throw failure
      const output = [result.stdout, result.stderr].filter(Boolean).join('\n').trim()
      throw new Error(`Release physical-distribution gate failed: ${command} ${commandArgs.join(' ')}\n${output}`)
    }
    return result.stdout
  }
  try {
    if (retained) {
      writeFileSync(join(root, 'LOCAL-EVIDENCE.txt'), 'Local evidence only. Not reviewed for publication.\nDo not automatically export this staging directory or its artifacts.\n', { flag: 'wx', mode: 0o600 })
      // Persist the initial state before invoking even metadata subprocesses.
      Object.assign(record, { candidate: { head: 'unknown', dirty: 'unknown' }, scriptSha256: 'unknown' })
      persist()
      Object.assign(record, metadata(workspace, scriptPath, pnpm, runner))
      persist()
    }
    await action({ temporaryRoot: root, run, phase })
    if (retained) {
      phase('finalize')
      record.artifacts = artifacts(root)
      record.artifactsStatus = 'complete'
      record.status = 'passed'
      record.endedAt = new Date().toISOString()
      persist()
    }
  } catch (error) {
    if (retained) {
      record.status = 'failed'
      record.endedAt = new Date().toISOString()
      record.failure = { category: categoryOf(error) }
      try { record.artifacts = artifacts(root); record.artifactsStatus = 'complete' }
      catch { record.artifactsStatus = 'incomplete'; record.artifactError = 'artifact_read_error' }
      try { persist() }
      catch (writeError) { throw new AggregateError([error, writeError], 'Release gate failed; evidence could not be finalized.') }
    }
    throw error
  } finally {
    if (retained) report(root)
    else rmSync(root, { recursive: true, force: true })
  }
}
