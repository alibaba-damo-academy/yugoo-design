/** Agent-facing orchestration of the existing native installers, not a registration authority. */
import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { lstat, readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { CODEX_DESKTOP_INSTALL_OPTIONS } from './npm-installer-codex-desktop.mjs'

export const AGENT_INSTALL_HOSTS = ['dsh', 'codex', 'codex-desktop', 'claude-code', 'qoder', 'qwenwork', 'workbuddy']
export const DESKTOP_INSTALL_OPTIONS = ['destination', 'node-executable', 'suite-version', 'npm-root-windows',
  'destination-windows', 'qwenwork-runtime', 'separate-mcp', 'previous-receipt']
const nativeOptions = {
  dsh: ['host', 'receipt-dir', 'dsh-config', 'profile', 'aggregate-selector', 'registry', 'previous-receipt'],
  codex: ['host', 'receipt-dir', 'codex-executable', 'user-root', 'disable-embedding', 'node-executable'],
  'claude-code': ['host', 'receipt-dir', 'claude-executable', 'user-root', 'disable-embedding', 'node-executable'],
  qoder: ['host', 'receipt-dir', 'qoder-executable', 'qoder-config-dir', 'node-executable'],
}

function argv(command, values, keys) {
  const args = [command]
  for (const key of keys) if (Object.hasOwn(values, key)) {
    args.push('--' + key)
    if (typeof values[key] !== 'boolean') args.push(values[key])
    else assert.equal(values[key], true, 'False CLI flags are not supported')
  }
  return args
}
function pending(host, status, missing, message) {
  return { schemaVersion: 1, kind: 'agent-installation', status, host: host ?? null,
    hostRegistered: false, usable: false, missing,
    installation: { host: host ?? null, acquisition: 'unverified', registration: 'not-performed',
      activation: 'not-performed', usability: 'unverified', nextActions: [{ action: 'supply-inputs', automatic: false, message }] } }
}
function activationActions(host, result, disableEmbedding) {
  const embedding = disableEmbedding ? [] : [{ action: 'prepare-local-embedding', automatic: true,
    command: ['prepare-embedding'],
    message: 'Use this acquired product\'s prepare-embedding to check the fixed model cache under the actual runtime user and operating system. Match the runtime\'s --embedding-cache and selected Node; a WSL cache is not a Windows runtime cache. Reuse complete files. If resources are missing or invalid, explain the model download and use --allow-download only when permitted; use --probe to verify CPU inference. DSH custom provider/model settings remain owned by DSH and must not be replaced with defaults. Report resource integrity, CPU inference and the real project\'s semantic status separately. Missing embeddings do not block basic design or available source-projection context.' }]
  const verify = { action: 'verify-native-session', automatic: true,
    message: 'In the intended native conversation, verify the actually loaded Yugoo Design version and tools; then open a project and verify Panel save/reopen and original-conversation receipt. Registration alone is not usability.' }
  if (host === 'codex-desktop') return [
    { action: 'activate-native-plugin', automatic: false, path: result.marketplacePath,
      message: 'Install or update this exact prepared local Yugoo Design source through Codex Desktop. If a normal restart is required, keep and return to the current conversation. Retain the exact npm version and previous owned source until the loaded version is verified.' }, ...embedding, verify]
  if (host === 'qwenwork') return [
    { action: 'import-expert-suite', automatic: false, path: result.nativeImport?.archive,
      message: 'Import this exact expert-suite ZIP through QwenWork. If bundled MCP is disabled by organization policy, use the emitted connector configuration and retain exactly one Yugoo Design connector.' },
    { action: 'activate-native-suite', automatic: false,
      message: 'Enable the imported suite; start a new native conversation if QwenWork requires it. Retain the acquired npm runtime and confirm the actually loaded suite version.' }, ...embedding, verify]
  if (host === 'workbuddy') return [
    { action: 'import-or-update-market', automatic: false, path: result.nativeImport?.market,
      message: 'Import this stable marketplace through WorkBuddy, or refresh the same market and update its existing Yugoo Design plugin. Preparation has not registered or activated it.' },
    { action: 'activate-native-plugin', automatic: false,
      message: 'Enable the plugin and start a new native conversation if WorkBuddy requires it; confirm the actually loaded suite version.' }, ...embedding, verify]
  return [{ action: 'activate-native-session', automatic: false,
    message: host === 'dsh'
      ? 'Use the selected existing DSH profile and the host-supported plugin activation/restart flow; verify runtime loading in a new native session.'
      : host === 'codex'
        ? 'Start a new Codex conversation normally in the intended workspace and invoke the installed yugoo Skill through the native Skill entry. Retain the registered npm runtime.'
        : 'Start a new native host conversation normally in the intended workspace and invoke /yugoo-design:yugoo. Retain the registered npm runtime; no --plugin-dir is needed.' }, ...embedding, verify]
}

/** Project only verified facts from the owning native/preparation receipt. */
export function installationResult(host, result, packageIdentity, { disableEmbedding = false } = {}) {
  const failed = result.status === 'failed-partial-state-retained'
  const desktop = host === 'qwenwork' || host === 'workbuddy' || host === 'codex-desktop'
  const registered = !desktop && !failed && (result.hostRegistered === true
    || host === 'dsh' && result.status === 'registered-config-parsed' && result.readback?.bundleRegistered === true)
  const identity = result.package ?? packageIdentity
  return { ...result, host, usable: false,
    installation: { host, package: identity ?? null,
      acquisition: identity?.name && identity?.version && (host !== 'dsh' || result.readback?.packageInstalled === true) ? 'available' : 'unverified',
      // This entry consumes an acquired installation; it never verifies a registry download.
      registryAcquisitionVerified: false,
      registration: failed ? 'failed-partial-state-retained' : registered ? 'verified' : 'not-performed',
      activation: failed ? 'not-performed' : 'required', usability: 'unverified',
      embedding: { status: disableEmbedding ? 'disabled' : 'unverified', blocksBasicDesign: false },
      nextActions: failed ? [{ action: 'inspect-retained-state', automatic: false, path: result.receiptFile,
        message: 'Inspect the owning receipt and retained DSH state before another operation. No automatic rollback or retry was attempted.' }]
        : activationActions(host, result, disableEmbedding) } }
}

export async function agentInstallation(values, { npmRoot, invoke, desktopPrepare, desktopReuse, codexDesktopPrepare,
  admittedCodexAdapter = false, platform = process.platform } = {}) {
  const host = values.host
  // Installed executables, PATH, host profiles and process names cannot identify this conversation.
  if (!host) return { ...pending(null, 'host-selection-required', ['host'],
    'Select the host of this conversation. If trusted native context identifies it, the current Agent should supply --host; otherwise ask one host-selection question.'), hosts: AGENT_INSTALL_HOSTS }
  if (host === 'codex-desktop') {
    for (const key of Object.keys(values)) assert.ok(CODEX_DESKTOP_INSTALL_OPTIONS.includes(key), 'Codex Desktop install accepts only its preparation options; unsupported --' + key)
    const missing = ['receipt-dir', 'destination'].filter(key => typeof values[key] !== 'string' || !values[key])
    if (missing.length) return pending(host, 'inputs-required', missing,
      'Select an external receipt directory and a new immutable source destination inside the intended user root. Native UI activation remains a separate step.')
    assert.equal(typeof codexDesktopPrepare, 'function', 'Owning Codex Desktop npm preparer required')
    return installationResult(host, await codexDesktopPrepare(values))
  }
  assert.ok(AGENT_INSTALL_HOSTS.includes(host), 'Explicit supported host required')
  const desktop = host === 'qwenwork' || host === 'workbuddy'
  const allowed = desktop ? ['host', ...DESKTOP_INSTALL_OPTIONS] : nativeOptions[host]
  for (const key of Object.keys(values)) assert.ok(allowed.includes(key), `${host} install accepts only ${allowed.map(k => '--' + k).join(', ')}; unsupported option --${key}`)
  const required = desktop ? ['destination', 'suite-version'] : ['receipt-dir']
  if (desktop && platform !== 'win32') required.push('node-executable')
  if (host === 'dsh') required.push('dsh-config', 'profile')
  if (host === 'codex' && !admittedCodexAdapter) required.push('codex-executable')
  if (host === 'claude-code') required.push('claude-executable')
  if (host === 'qwenwork') required.push('qwenwork-runtime')
  if (host === 'workbuddy') for (const key of ['qwenwork-runtime', 'separate-mcp'])
    assert.ok(!Object.hasOwn(values, key), `WorkBuddy install does not accept --${key}`)
  if (desktop && platform !== 'win32') required.push('npm-root-windows', 'destination-windows')
  const missing = required.filter(key => typeof values[key] !== 'string' || !values[key])
  if (missing.length) return pending(host, 'inputs-required', missing,
    `The current Agent should obtain verified values for ${missing.map(key => '--' + key).join(', ')}. Ask only for information or host actions it cannot obtain through supported native inspection. No installation was attempted.`)

  let plan
  try {
    if (desktop) {
      const path = join(npmRoot, 'package.json'), info = await lstat(path)
      assert.ok(info.isFile() && info.size <= 1024 * 1024, 'Expected bounded regular acquired package manifest')
      const manifest = JSON.parse(await readFile(path, 'utf8'))
      const args = argv('prepare-desktop', values, DESKTOP_INSTALL_OPTIONS).slice(1)
      args.push('--target', host, '--package-name', manifest.name, '--package-version', manifest.version)
      const reused = values['previous-receipt'] && await desktopReuse(args)
      return installationResult(host, reused || await desktopPrepare(args))
    }
    if (host === 'claude-code' || host === 'qoder')
      return installationResult(host, await invoke(argv('install', values, allowed)), undefined, { disableEmbedding: values['disable-embedding'] === true })
    // DSH's exclusive plan files are never overwritten. Each direct operation gets
    // its own receipt subdirectory; Codex keeps the stable directory needed by upgrades.
    const nativeValues = host === 'dsh' ? { ...values, 'receipt-dir': join(values['receipt-dir'], randomUUID()) } : values
    const dryArgs = argv('install', nativeValues, allowed)
    dryArgs.push('--dry-run')
    plan = await invoke(dryArgs)
    assert.ok(plan.planFile, 'The owning installer did not retain an installation plan')
    if (host === 'codex') {
      assert.equal(plan.applySupported, true, 'Codex native installation is not admitted by the owning adapter')
      const runtimeArgs = argv('check-runtime', values, ['host', 'receipt-dir', 'disable-embedding'])
      runtimeArgs.push('--plan', plan.planFile)
      const runtime = await invoke(runtimeArgs)
      if (!['load-verified', 'disabled'].includes(runtime.status)) return {
        ...pending(host, 'runtime-not-ready', [], 'Inspect the runtime receipt. No native apply was attempted; repair the reported prerequisites before re-running install.'),
        runtimeReceipt: runtime, planFile: plan.planFile }
      assert.ok(runtime.receiptFile, 'The owning runtime checker did not retain its receipt')
      const applyArgs = argv('install', values, allowed.filter(key => !['receipt-dir', 'disable-embedding', 'node-executable'].includes(key)))
      applyArgs.push('--apply', '--plan', plan.planFile, '--runtime-receipt', runtime.receiptFile)
      return installationResult(host, await invoke(applyArgs), plan.package, { disableEmbedding: values['disable-embedding'] === true })
    }
    const applyArgs = argv('install', nativeValues, allowed)
    applyArgs.push('--apply', '--plan', plan.planFile)
    return installationResult(host, await invoke(applyArgs), plan.package)
  } catch (error) {
    const receipt = error.receiptFile ?? error.receiptPath ?? null
    error.installation = { host, acquisition: 'unverified', registration: 'failed-or-unconfirmed',
      activation: 'not-performed', usability: 'unverified', receiptFile: receipt,
      planFile: plan?.planFile ?? null,
      nextActions: [{ action: receipt ? 'inspect-owned-receipt' : 'inspect-failure', automatic: false,
        message: host === 'codex' || host === 'claude-code'
          ? 'Inspect the failure and matching owned receipt; use the existing recover --host route only when that receipt requires recovery. Do not delete profiles, projects or unrelated plugins.'
          : 'Inspect retained state before retrying. This host has no general automatic rollback in this entry; use its supported update/recovery flow.' }] }
    throw error
  }
}
