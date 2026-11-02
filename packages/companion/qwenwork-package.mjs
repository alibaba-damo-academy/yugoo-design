/** Machine-specific native pins, supplied explicitly rather than guessed from sessions. */
import { readFile, writeFile } from 'node:fs/promises'
import { join, posix, win32 } from 'node:path'
const windowsAbsolute = value => typeof value === 'string' && /^(?:[a-z]:[\\/]|\\\\[^\\]+\\[^\\]+)/i.test(value)
export function qwenWorkNativeExecutionReference(shared) {
  return '# QwenWork native execution\n\nRead SKILL.md for exact native task descriptor and user authorization requirements. The shared reference below retains explicit host qualifiers: Codex-only launch references are not QwenWork parameters. For background execution, use the QwenWork contract, never another Host\'s receipt format. User-confirmed main-conversation GRA follows the shared manual foreground path and requires no background task descriptor.\n\n' + shared
}
export function validateQwenWorkRuntime(value) {
  const paths = value && windowsAbsolute(value.nodeExecutable ?? '') ? win32 : posix
  if (!value || !['executable', 'worker', 'nodeExecutable'].every(k => typeof value[k] === 'string' && paths.isAbsolute(value[k]) && !/[\r\n\0]/.test(value[k])
    && (paths === win32 ? windowsAbsolute(value[k]) : !windowsAbsolute(value[k])))) throw Error('QwenWork requires explicit Windows or POSIX executable, worker and Node paths on the same target.')
  for (const key of ['executableSha256', 'workerSha256']) if (!/^[a-f0-9]{64}$/.test(value[key] ?? '')) throw Error('QwenWork runtime hashes are required.')
  return value
}

/** Explicit connector import can be separate from the Skills/Hooks expert suite. */
export function qwenWorkConnectorConfiguration(runtimeRoot, runtime) {
  validateQwenWorkRuntime(runtime)
  const paths = windowsAbsolute(runtime.nodeExecutable) ? win32 : posix
  if (!paths.isAbsolute(runtimeRoot) || /[\r\n\0]/.test(runtimeRoot)
    || (paths === win32 ? !windowsAbsolute(runtimeRoot) : windowsAbsolute(runtimeRoot))) throw Error('Exact absolute runtime root on the same target required.')
  return { mcpServers: { 'design-system': {
    command: runtime.nodeExecutable,
    args: [paths.join(runtimeRoot, 'scripts/design.mjs'), 'mcp'],
  } } }
}
export async function configureQwenWorkPackage(target, runtime) {
  validateQwenWorkRuntime(runtime)
  await writeFile(join(target, 'scripts/qwenwork-runtime.json'), JSON.stringify(runtime, null, 2) + '\n', { flag: 'wx' })
  const hookPath = join(target, 'hooks/hooks.json')
  const hooks = JSON.parse(await readFile(hookPath, 'utf8'))
  const windows = windowsAbsolute(runtime.nodeExecutable)
  const shell = process.env.SHELL || '/bin/zsh'
  if (!windows && (!posix.isAbsolute(shell) || /[\r\n\0]/.test(shell))) throw Error('An absolute native POSIX Hook shell required.')
  const command = windows ? "& '" + runtime.nodeExecutable.replaceAll("'", "''") + "' "
    : "'" + runtime.nodeExecutable.replaceAll("'", "'\\''") + "' "
  for (const groups of Object.values(hooks.hooks)) for (const group of groups) for (const hook of group.hooks) {
    hook.command = hook.command.replace(/^& node /, command)
    if (!windows) {
      hook.shell = shell
      hook.command = hook.command.replaceAll('${env:CLAUDE_PLUGIN_ROOT}', '${CLAUDE_PLUGIN_ROOT}')
    }
  }
  await writeFile(hookPath, JSON.stringify(hooks, null, 2) + '\n')
  const path = join(target, '.mcp.json'), mcp = JSON.parse(await readFile(path, 'utf8'))
  mcp.mcpServers['design-system'].command = runtime.nodeExecutable
  await writeFile(path, JSON.stringify(mcp, null, 2) + '\n')
}

/** The desktop ZIP is limited to 50 MiB; install the shared runtime separately. */
export async function packageQwenWorkExpertKit(runtimeDirectory, target, runtimeRoot, { includeMcp = true } = {}) {
  const { cp, mkdir } = await import('node:fs/promises')
  if (typeof includeMcp !== 'boolean') throw Error('includeMcp must be a boolean.')
  const runtime = validateQwenWorkRuntime(JSON.parse(await readFile(join(runtimeDirectory,'scripts/qwenwork-runtime.json'),'utf8')))
  qwenWorkConnectorConfiguration(runtimeRoot, runtime)
  await mkdir(target)
  for (const name of ['.claude-plugin','hooks','skills','LICENSE','NOTICE','THIRD_PARTY_NOTICES.md']) await cp(join(runtimeDirectory,name),join(target,name),{recursive:true,errorOnExist:true,force:false})
  // Skills may reference the same-build authoring capsule; retain it in the thin suite.
  const authoring = join(runtimeDirectory, 'authoring')
  try { await cp(authoring, join(target, 'authoring'), { recursive: true, errorOnExist: true, force: false }) }
  catch (error) { if (error.code !== 'ENOENT' || error.path !== authoring) throw error }
  await mkdir(join(target,'scripts'))
  for (const name of ['qwenwork-runtime.json','qwenwork-context.mjs','qwenwork-notification.mjs','qwenwork-hook-transport.mjs','qwenwork-connection.mjs','native-hook-transport.mjs','windows-private-storage.mjs','windows-native-platform.mjs']) await cp(join(runtimeDirectory,'scripts',name),join(target,'scripts',name),{errorOnExist:true,force:false})
  await writeFile(join(target,'scripts/runtime-location.json'),JSON.stringify({runtimeRoot,nodeExecutable:runtime.nodeExecutable},null,2)+'\n',{flag:'wx'})
  if (includeMcp) await writeFile(join(target,'.mcp.json'),JSON.stringify(qwenWorkConnectorConfiguration(runtimeRoot, runtime),null,2)+'\n',{flag:'wx'})
  const skillPath=join(target,'skills/yugoo/SKILL.md')
  const skill=await readFile(skillPath,'utf8')
  await writeFile(skillPath,skill.replace('Resolve the plugin root relative to this skill (`../..`). Execute its packaged\nscript, not an arbitrary globally installed development copy:',
    'Read `../../scripts/runtime-location.json` relative to this skill. Its `runtimeRoot` is the exact Companion runtime; every `/absolute/plugin-root` placeholder below means that runtime root, not the expert suite directory. Use its `nodeExecutable` instead of assuming `node` is on PATH. Execute that packaged script:'))
  return target
}
