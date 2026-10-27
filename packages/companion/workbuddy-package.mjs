/** WorkBuddy bounded preview suite; not a final distributable installer. */
import { mkdir, writeFile, copyFile } from 'node:fs/promises'
import { join, win32 } from 'node:path'
import { resolveBrowserAccess } from './src/browser-access.mjs'

export const WORKBUDDY_TEST_VERSION = '0.3.30'
export const WORKBUDDY_TEST_MARKET = 'yugoo-design'
export const WORKBUDDY_TEST_PLUGIN = 'yugoo-design'

function validateMarketName(name) {
  if (typeof name !== 'string' || !/^[a-z0-9][a-z0-9._-]{0,127}$/.test(name)) throw Error('Exact WorkBuddy market name required.')
}

function validateWindowsPaths(...paths) {
  for (const value of paths) {
    if (typeof value !== 'string' || !win32.isAbsolute(value) || /[\r\n\0]/.test(value)) throw Error('Exact Windows Node and shared runtime paths required.')
  }
}
function workBuddyMcp({ nodeExecutable, runtimeRoot }) {
  validateWindowsPaths(nodeExecutable, runtimeRoot)
  return { mcpServers: { 'design-system-workbuddy-probe': {
    command: nodeExecutable, args: [win32.join(runtimeRoot, 'scripts/design.mjs'), 'mcp'],
  } } }
}

/** Optional separate imports for environments without suite access; no native Hooks. */
export async function packageWorkBuddySkillConnector(target, options) {
  const mcp = workBuddyMcp(options)
  await mkdir(target)
  const skill = join(target, 'design-system-readiness')
  await mkdir(skill)
  await writeFile(join(target, 'mcp.json'), JSON.stringify(mcp, null, 2) + '\n', { flag: 'wx' })
  await writeFile(join(skill, 'SKILL.md'), `---
name: design-system-readiness
description: Check the YuGoo WorkBuddy MCP connection when the user requests a readiness test.
description_zh: 用户要求接入检查时，实际验证设计系统 MCP 工具是否可用。
description_en: Verify the Design System MCP catalog without creating a project.
version: 0.1.0
author: Yugoo Design contributors
disable-model-invocation: true
---

On the user's explicit readiness-test request, call the connected MCP tool
design_list_panel_components once with {"name":"question_workspace"}. Report
whether the actual tool succeeded and the returned component name. If the tool
is absent, report that; do not substitute shell execution or fabricated results.

Do not create projects, start a Panel or agents, edit files/settings, or read
transcripts. This Skill and separately imported connector do not install Hooks,
establish native identity, or prove original-session input/save notifications.
Do not request or expose tokens. Stop after reporting the MCP result.
`, { flag: 'wx' })
  return { target, skill, connector: join(target, 'mcp.json'), scope: 'skill-and-mcp-discovery-only' }
}

export async function packageWorkBuddyProbe(target, { nodeExecutable, runtimeRoot, browserAccess = 'local', version = WORKBUDDY_TEST_VERSION, marketName = WORKBUDDY_TEST_MARKET }) {
  if (typeof version !== 'string' || !/^(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)$/.test(version)) throw Error('Exact WorkBuddy suite release version required.')
  validateMarketName(marketName)
  resolveBrowserAccess(browserAccess)
  const mcp = workBuddyMcp({ nodeExecutable, runtimeRoot })
  mcp.mcpServers['design-system-workbuddy-ui'] = { command: nodeExecutable, args: ['${CODEBUDDY_PLUGIN_ROOT}/scripts/workbuddy-ui-probes.mjs'] }
  // Fail on an existing target; never overwrite a host installation or another probe.
  await mkdir(target)
  for (const name of ['.codebuddy-plugin', 'hooks', 'scripts', 'skills/design-system-readiness', 'skills/yugoo']) await mkdir(join(target, name), { recursive: true })
  const json = (path, value) => writeFile(join(target, path), JSON.stringify(value, null, 2) + '\n', { flag: 'wx' })
  await json('.codebuddy-plugin/plugin.json', { name: WORKBUDDY_TEST_PLUGIN, version,
    description: 'WorkBuddy shared Design Panel preview and bounded diagnostics. No host or model launcher.',
    skills: './skills/', mcpServers: './.mcp.json', hooks: './hooks/hooks.json' })
  await json('.mcp.json', mcp)
  await json('scripts/workbuddy-package-runtime.json', { runtimeRoot, browserAccess })
  // WorkBuddy's CodeBuddy-based Hook documentation specifies Git Bash on Windows.
  // Do not copy QwenWork's PowerShell command or its asyncRewake extension.
  const quote = value => "'" + value.replaceAll("'", "'\\''") + "'"
  const command = `${quote(nodeExecutable.replaceAll('\\', '/'))} "\${CODEBUDDY_PLUGIN_ROOT}/scripts/workbuddy-context-probe.mjs"`
  await json('hooks/hooks.json', { hooks: Object.fromEntries(['SessionStart', 'PostToolUse'].map(event => [event,
    [{ ...(event === 'PostToolUse' ? { matcher: '*' } : {}), hooks: [{ type: 'command', command, timeout: 10 }] }],
  ])) })
  for (const file of ['browser-access.mjs', 'workbuddy-context-probe.mjs', 'workbuddy-message-probe.mjs', 'workbuddy-mcp-relay.mjs', 'workbuddy-relay-probe.mjs', 'workbuddy-relay-service.mjs', 'workbuddy-ui-probes.mjs', 'workbuddy-panel-mcp.mjs']) await copyFile(new URL(`./src/${file}`, import.meta.url), join(target, 'scripts', file))
  await writeFile(join(target, 'skills/design-system-readiness/SKILL.md'), `---
name: design-system-readiness
description: Verify the installed YuGoo WorkBuddy test connector and native identity without starting design work.
---

When the user asks for this readiness check, call the connected MCP tool
design_list_panel_components with {"name":"question_workspace"} once. Report
whether the real tool succeeded and whether the current context contains
YUGOO_WORKBUDDY_IDENTITY_PROBE. Report missing capabilities honestly.

This is a discovery probe, not the design workflow. Do not create a project,
invoke design_command, start a Companion, launch an agent, modify settings, or
use CLI/file reading as a substitute for a missing MCP tool. Hook identity is
routing evidence only, not user authorization or a verified runtime binding.
For a separately requested UI transport test, call the explicitly requested
message or relay probe from the design-system-workbuddy-ui MCP server, then wait
for the user's click. These probes do not enable Design writes or production
WorkBuddy serve. Never answer ACK on behalf of the user or repeat a timed-out send.
Do not read transcript contents or reveal connection tokens.
`, { flag: 'wx' })
  await copyFile(new URL('./hosts/workbuddy/design-SKILL.md', import.meta.url), join(target, 'skills/yugoo/SKILL.md'))
  await copyFile(new URL('./plugin/design-system/skills/design-panel/native-execution.md', import.meta.url), join(target, 'skills/yugoo/native-execution.md'))
  await writeFile(join(target, 'README.md'), `# Yugoo Design for WorkBuddy

Acquire the exact yugoo-design npm version in a persistent user-owned
directory, then run its install --host workbuddy command with the verified Node
path, preparation destination and --suite-version ${version}. Use Node
>=22.19.0 for the updated package; check the acquired exact version's
engines.node because older packages retain their original requirements.
Import the emitted nativeImport.market directory through WorkBuddy's native
marketplace importer, then enable its yugoo-design suite and MCP connection.
This preparation uses the ${marketName} market. A fresh installation needs no
previous test market or preparation receipt. Current suite version: ${version}.

For an existing owned preparation, use --previous-receipt with a new exact npm
version and greater suite version. The verified receipt retains that market's
original name and directory. Refresh that same market, then update the suite
from the Installed page. Never enable duplicate Yugoo Design Hooks/MCP copies.
Existing project roots and conversation identity are unchanged.
The market browse list hides already installed suites; an empty list does not mean
the suite was removed. Do not uninstall or add a new market for each update.
Use the yugoo Skill for authorized
project work, or design-system-readiness for a read-only connection check. No new model process or host launcher is supplied.
Main U/S/T uses design_main_context and report_design_clarity after saved output.
Workers remain unavailable. Background GRA requires a real native background descriptor newer
than this exact Companion connection and ready status; otherwise requests remain
pending. A public background parameter or old session receipt is not capability
proof. If background execution is unavailable or occupies the main conversation,
offer turning off automatic GRA while retaining manual checks, or a user-confirmed
one-time synchronous check here. Only the explicit manual executionMode=foreground
path may do so, without pretending to prove background readiness. The installed
native-execution.md retains the full shared protocol.

The suite points to the acquired npm package's shared runtime and an explicit
Node executable. Preparation does not register or activate the native plugin;
verify the actually loaded version and original-conversation delivery separately.
Optional open-panel view: pass view="panel-only" for the host-side design workspace. The Agent passes nativePreview.arguments unchanged to present_files once to open the actual local HTTP page automatically. Manual address copying and browser Skill discovery are not prerequisites. The host may hide the address bar for local URLs; this does not block page opening. Use the copy-address recovery only if the tool is unavailable or navigation fails. The browser-access URL may appear in authorized native navigation records; the separate message-relay key stays in widget metadata. The original widget automatically connects once its metadata and host channel are ready; no binding click is required. In panel-only, "其他打开方式" contains the optional "在系统浏览器打开" full-view button; no click is needed for the embedded page. Full view and explicit connection recovery retain a direct action. This package selects local browser access at startup, so refresh/back need neither a bearer URL nor browser storage; tool and relay credentials remain separate. The widget has no view dropdown; choose layout at entry. Changing layout does not reopen the service or rebind a conversation. Visible native rendering and consumed save notifications require separate acceptance.

Keep the market source, Node and runtime in a persistent user-owned directory,
outside Temp. A market refresh does not restore a deleted runtime. Update through
WorkBuddy's normal plugin manager; never rewrite its installed cache by hand.
Remove this single plugin through WorkBuddy to undo installation. Its
Hook only emits bounded context; it writes no project, identity or config files.
`, { flag: 'wx' })
  return { target, name: WORKBUDDY_TEST_PLUGIN, version, scope: 'serial-producer-preview' }
}

/** Local marketplace consumed by Skills > Skill Market > Suites > Add Marketplace. */
export async function packageWorkBuddyProbeMarketplace(target, options) {
  // Validate inputs before creating the output. Existing directories are never reused.
  workBuddyMcp(options)
  resolveBrowserAccess(options.browserAccess === undefined ? 'local' : options.browserAccess)
  // Only the owning preparer supplies an existing market identity from its verified receipt.
  const marketName = options.marketName ?? WORKBUDDY_TEST_MARKET
  validateMarketName(marketName)
  await mkdir(target)
  await mkdir(join(target, '.codebuddy-plugin'))
  await mkdir(join(target, 'plugins'))
  const version = options.version ?? WORKBUDDY_TEST_VERSION
  if (typeof version !== 'string' || !/^(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)$/.test(version)) throw Error('Exact WorkBuddy suite release version required.')
  const source = `./plugins/${WORKBUDDY_TEST_PLUGIN}-${version}`
  const probe = await packageWorkBuddyProbe(join(target, source), { ...options, marketName })
  const manifest = {
    name: marketName,
    owner: { name: 'Yugoo Design contributors' },
    plugins: [{ name: probe.name, source,
      description: 'Shared Design Panel with main U/S/T, serial native Producers, GRA gated by current-service native background readiness, and user-confirmed one-time foreground GRA. Workers remain unavailable.',
      version: probe.version }],
  }
  await writeFile(join(target, '.codebuddy-plugin/marketplace.json'), JSON.stringify(manifest, null, 2) + '\n', { flag: 'wx' })
  return { target, name: manifest.name, plugin: probe.name, scope: probe.scope }
}
