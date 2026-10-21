/** Validate actual Windows ACLs instead of treating Unix mode bits as proof. */
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { lstat, mkdir } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'
import { windowsCurrentSid, windowsPowerShell, powerShellLiteral, windowsSystemTool, windowsSecurityFacts } from './windows-native-platform.mjs'
const execute = promisify(execFile)
function daclOf(sddl) {
  const dacl = /D:([^]*?)(?=S:|$)/.exec(sddl)?.[1]
  if (!dacl) throw Error('Windows storage has no explicit DACL.')
  return [...dacl.matchAll(/\(([^()]*)\)/g)].map(match => match[1].split(';'))
}
/** Ancestors may grant read/execute, but must not let another user replace paths. */
export function validateAncestorSddl(sddl, sid) {
  // Windows Resource Protection's installer identity may own the volume root.
  // Never generalize this exception to arbitrary service SIDs.
  const trustedInstaller = 'S-1-5-80-956008885-3418522649-1831038044-1853292631-2271478464'
  const trusted = [sid, 'SY', 'BA', 'S-1-5-18', 'S-1-5-32-544', trustedInstaller]
  const owner = /^O:([^:]+?)(?=G:|D:|S:|$)/.exec(sddl)?.[1]
  if (!trusted.includes(owner)) throw Error('Windows storage ancestor has an untrusted owner.')
  for (const ace of daclOf(sddl)) {
    if (ace.length !== 6 || !['A', 'D'].includes(ace[0])) throw Error('Unsupported Windows ancestor ACE.')
    if (ace[0] === 'D' || ace[1].includes('IO') || trusted.includes(ace[5])) continue
    const rights = ace[2]
    // Inspect applicable Allow ACEs conservatively; this is not a Windows
    // token/group/Deny effective-access calculation. Child creation alone
    // cannot replace an existing protected directory.
    const symbols = { FA: 0x1f01ffn, FR: 0x120089n, FX: 0x1200a0n, FW: 0x120116n,
      GA: 0x1f01ffn, GR: 0x120089n, GX: 0x1200a0n, GW: 0x120116n,
      LC: 0x4n, RC: 0x20000n, SD: 0x10000n, WD: 0x40000n, WO: 0x80000n }
    let mask = 0n
    if (/^0x[0-9a-f]+$/i.test(rights)) mask = BigInt(rights)
    else {
      if (!rights || rights.length % 2) throw Error('Unsupported Windows ancestor rights.')
      for (let index = 0; index < rights.length; index += 2) {
        const value = symbols[rights.slice(index, index + 2)]
        if (value === undefined) throw Error('Unsupported Windows ancestor rights.')
        mask |= value
      }
    }
    if (mask & 0xd0040n) throw Error('Windows storage ancestor is replaceable by another principal.')
    // Extra conservative policy: reject foreign attribute/EA writes. This
    // does not assert these permissions alone prove a reparse-point attack.
    if (mask & 0x110n) throw Error('Windows storage ancestor allows untrusted attribute writes.')
    if (mask & ~0x1200afn) throw Error('Unsupported Windows ancestor rights.')
  }
}
export function validatePrivateSddl(sddl, sid, { protectedAcl = false } = {}) {
  if (typeof sddl !== 'string' || !/^S-1-5-\d+(?:-\d+)+$/.test(sid)) throw Error('Invalid Windows security identity.')
  const owner = /^O:([^:]+?)(?=G:|D:|S:|$)/.exec(sddl)?.[1]
  const dacl = /D:([^]*?)(?=S:|$)/.exec(sddl)?.[1]
  if (owner !== sid || !dacl || (protectedAcl && !/^P/.test(dacl))) throw Error('Windows private storage owner or inheritance mismatch.')
  const aces = [...dacl.matchAll(/\(([^()]*)\)/g)].map(match => match[1].split(';'))
  if (!aces.length || !aces.some(ace => ace[0] === 'A' && !ace[1].includes('IO') && ace[5] === sid && ace[2] === 'FA')) throw Error('Windows private storage lacks user access.')
  for (const ace of aces) {
    if (ace.length !== 6 || ace[0] !== 'A') throw Error('Unsupported Windows storage ACE.')
    if (ace[0] === 'A' && ![sid, 'SY', 'BA', 'S-1-5-18', 'S-1-5-32-544'].includes(ace[5])) throw Error('Windows storage allows another principal.')
  }
}
export async function assertWindowsPrivate(path, { directory = false, protectedAcl = directory } = {}) {
  const stat = await lstat(path)
  if (stat.isSymbolicLink() || (directory ? !stat.isDirectory() : !stat.isFile())) throw Error('Private storage must be a regular owned path.')
  // Collect target and ancestor facts in one native inspection. Repeated
  // PowerShell startup per ancestor policy can consume the whole Hook deadline.
  // Do not cache ACLs: each operation still validates current path permissions.
  const paths = []; let current = resolve(path)
  while (true) {
    paths.push(current)
    const parent = dirname(current); if (parent === current) break; current = parent
  }
  const facts = await windowsSecurityFacts(paths)
  if (facts.length !== paths.length * 2 || paths.some((_, i) => !/^\d+$/.test(facts[i * 2]) || (Number(facts[i * 2]) & 1024))) throw Error('Private storage uses a Windows reparse point or missing ancestor.')
  const sid = await windowsCurrentSid()
  validatePrivateSddl(facts[1], sid, { protectedAcl })
  for (let index = 1; index < paths.length; index++) validateAncestorSddl(facts[index * 2 + 1], sid)
  return stat
}
async function assertSafeAncestors(path, sid) {
  const ancestors = []; let current = path
  while (true) {
    ancestors.push(current)
    const parent = dirname(current); if (parent === current) break; current = parent
  }
  const facts = (await windowsPowerShell(`foreach ($entry in @(${ancestors.map(powerShellLiteral).join(',')})) { if (Test-Path -LiteralPath $entry) { (Get-Acl -LiteralPath $entry).Sddl } else { 'missing' } }`)).split(/\r?\n/)
  if (facts.length !== ancestors.length) throw Error('Incomplete Windows ancestor security facts.')
  for (const sddl of facts) if (sddl !== 'missing') validateAncestorSddl(sddl, sid)
}
async function assertNoReparse(path, allowMissing = false, includeSddl = false) {
  // Reject junctions/reparse points before creating anything through an alias.
  let current = resolve(path); const ancestors = []
  while (true) {
    ancestors.push(current)
    const parent = dirname(current); if (parent === current) break; current = parent
  }
  const suffix = includeSddl ? `; (Get-Acl -LiteralPath ${powerShellLiteral(path)}).Sddl` : ''
  const facts = (await windowsPowerShell(`foreach ($entry in @(${ancestors.map(powerShellLiteral).join(',')})) { if (Test-Path -LiteralPath $entry) { (Get-Item -Force -LiteralPath $entry).Attributes.value__ } else { 'missing' } }${suffix}`)).split(/\r?\n/)
  const sddl = includeSddl ? facts.pop() : undefined
  if (facts.length !== ancestors.length || facts.some(attributes => !(allowMissing && attributes === 'missing') && (!/^\d+$/.test(attributes) || (Number(attributes) & 1024)))) throw Error('Private storage uses a Windows reparse point or missing ancestor.')
  return sddl
}
export async function ensureWindowsPrivateDirectory(path) {
  // Never silently repair a pre-existing directory's permissions.
  await assertNoReparse(path, true)
  await assertSafeAncestors(dirname(resolve(path)), await windowsCurrentSid())
  await mkdir(dirname(path), { recursive: true })
  try { await mkdir(path) } catch (error) { if (error.code !== 'EEXIST') throw error; await assertWindowsPrivate(path, { directory: true }); return }
  const sid = await windowsCurrentSid()
  await execute(windowsSystemTool('icacls.exe'), [path, '/inheritance:r', '/grant:r', `*${sid}:(OI)(CI)F`], { encoding: 'utf8', timeout: 10000, windowsHide: true })
  await assertWindowsPrivate(path, { directory: true })
}
