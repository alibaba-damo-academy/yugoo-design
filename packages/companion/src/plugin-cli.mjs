import { createQwenWorkTranscript } from './qwenwork-transcript.mjs'
/** Relocatable packaged entry: native Codex owns the conversation and tools. */
import { parseArgs } from 'node:util'
import { dirname, join, resolve } from 'node:path'
import { homedir } from 'node:os'
import { fileURLToPath } from 'node:url'
import { readFile } from 'node:fs/promises'
import { callCompanion } from './connection-file.mjs'
import { modelRequest, modelResponse } from './model-response.mjs'
import { notificationErrorResponse } from './notification-delivery.mjs'
import { openCompanionProject } from './project.mjs'
import { startCompanion } from './server.mjs'
import { startStandaloneCompanion } from './cli-lifecycle.mjs'
import { companionKnowledgeRuntimeUrl, loadCompanionKnowledgeRuntime } from './knowledge.mjs'
import { requireThreadId } from './codex-connection.mjs'
import { runCompanionCommand } from './project-commands.mjs'
import { startDesignMcp } from './mcp.mjs'
import { resolveCodexMainTranscript } from './native-run-resolution.mjs'
import { createClaudeTranscript } from './claude-transcript.mjs'
import { validateSkillDesign } from '../../core/lib/index.js'

const HELP = `Design System companion (Codex / Qoder CLI / Claude Code)
  node scripts/design.mjs command --input "new My Project" --host codex --thread EXACT_NATIVE_SESSION_ID
  node scripts/design.mjs inspect --project /absolute/project
  node scripts/design.mjs validate --project /absolute/project --skill smart_questions [--scope completion]
  node scripts/design.mjs serve --host codex|qoder|claude-code|qwenwork --project /absolute/project --thread EXACT_NATIVE_SESSION_UUID [--host-cwd /native/working/directory] [--transcript /absolute/native.jsonl] [--port 0]
  Codex serve optionally accepts --codex-remote unix:///absolute/private/socket to bind notifications to that explicit app-server.
  Mac Codex desktop instead accepts --codex-desktop; its separate bridge must be launched directly by the host.
  Add --codex-desktop-native-bundles only for the current Host's native attached Producer/Worker route; each actual run is verified independently.
  This explicit preview uses the current executor thread and supplied desktop pipe, with no CLI queue fallback.
  node scripts/design.mjs call --connection /absolute/connection.json --request /absolute/request.json [--full-response]
  node scripts/design.mjs mcp

QwenWork defaults to verified desktop user input and requires an already enabled
desktop control service. --qwenwork-desktop remains a compatible explicit alias.
--qwenwork-events-only explicitly selects Hook events without automatic user input;
it is never selected as a fallback after desktop failure.
Serve opens a local Panel server. --browser-access token|local selects browser
admission (default token for existing CLI entries). local opens a plain loopback
URL without browser storage or a bearer; tool connections remain authenticated.
Optional --background-reviews
enables service-owned Codex evaluations after saves (consumes CLI account quota).
Use --review-model MODEL to select the evaluator model explicitly. Without it,
the supported executor configuration determines the model; it is not inherited
from the interactive conversation. DSH is never launched.
It never picks the latest conversation, changes Kit pins, or installs dependencies.
Use an isolated project and dedicated native conversation for this preview.
Codex transcript is automatically resolved by exact thread UUID under CODEX_HOME/sessions.
Claude Code requires its SessionStart hook's exact transcript_path.
An explicit --transcript overrides lookup; either must match UUID and native cwd.
Native cwd defaults to the invoking process cwd, not the Design Project directory.
It shows native recorded messages, not live token streaming or process liveness.
KAG uses the packaged local database and cached local embedding model. Design text
is not uploaded. --allow-embedding-download permits fetching the pinned model
weights if absent; --disable-embedding keeps file structure/evidence only.
Use --embedding-cache /absolute/cache to select an explicit local model cache.
`

export async function main(args = process.argv.slice(2)) {
  const { values, positionals } = parseArgs({ args, allowPositionals: true, options: {
    help: { type: 'boolean' }, project: { type: 'string' }, thread: { type: 'string' },
    kit: { type: 'string' }, skill: { type: 'string' }, scope: { type: 'string' },
    port: { type: 'string' }, 'state-root': { type: 'string' }, 'browser-access': { type: 'string' },
    transcript: { type: 'string' },
    'background-reviews': { type: 'boolean' }, 'review-model': { type: 'string' },
    'allow-embedding-download': { type: 'boolean' }, 'disable-embedding': { type: 'boolean' },
    'embedding-cache': { type: 'string' },
    connection: { type: 'string' }, request: { type: 'string' }, 'full-response': { type: 'boolean' },
    'codex-remote': { type: 'string' }, 'codex-desktop': { type: 'boolean' }, 'codex-desktop-native-bundles': { type: 'boolean' }, 'qwenwork-desktop': { type: 'boolean' }, 'qwenwork-events-only': { type: 'boolean' },
    input: { type: 'string' }, host: { type: 'string' }, 'projects-root': { type: 'string' }, 'host-cwd': { type: 'string' },
  } })
  if (values.help || !positionals.length) { console.log(HELP); return }
  const [command] = positionals
  if (positionals.length !== 1 || !['command', 'inspect', 'validate', 'serve', 'call', 'mcp'].includes(command)) throw new Error('Unknown command. Use --help.')
  if (command === 'mcp') {
    await startDesignMcp({ commandOptions: {
      ...(values['state-root'] ? { stateRoot: resolve(values['state-root']) } : {}),
      ...(values['projects-root'] ? { projectsRoot: resolve(values['projects-root']) } : {}),
      ...(values.kit ? { kitRoot: resolve(values.kit) } : {}),
    } })
    return
  }
  if (command === 'call') {
    if (!values.connection || !values.request) throw new Error('--connection and --request files are required.')
    const request = JSON.parse(await readFile(values.request, 'utf8'))
    const result = await callCompanion(values.connection, values['full-response'] ? request : modelRequest(request))
    console.log(JSON.stringify(modelResponse(request.method, result, { details: values['full-response'] === true }), null, 2))
    return
  }
  const pluginRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..')
  const stateRoot = values['state-root'] ? resolve(values['state-root']) : join(homedir(), '.local/state/design-system/companion')
  const kitRoot = values.kit ? resolve(values.kit) : join(pluginRoot, 'kits/web_app')
  if (command === 'command') {
    if (values.input === undefined) throw new Error('--input is required (use help for command help).')
    const result = await runCompanionCommand({ input: values.input, host: values.host ?? 'codex', threadId: values.thread,
      projectsRoot: values['projects-root'] ? resolve(values['projects-root']) : undefined, stateRoot, kitRoot })
    console.log(JSON.stringify(result, null, 2))
    if (result.kind === 'error') process.exitCode = 1
    return
  }
  if (!values.project) throw new Error('An explicit --project is required. Use command --input "new NAME" to create one.')
  const options = {
    projectRoot: resolve(values.project),
    kitRoot, stateRoot,
  }
  if (command === 'serve') {
    const port = values.port === undefined ? 0 : Number(values.port)
    if (!Number.isInteger(port) || port < 0 || port > 65535) throw new Error('Invalid port.')
    const host = values.host ?? 'codex'
    const nativeCwd = values['host-cwd'] ? resolve(values['host-cwd']) : process.cwd()
    const transcriptPath = host === 'codex' ? await resolveCodexMainTranscript({
      threadId: values.thread, nativeCwd,
      deferIncomplete: true,
      sessionsRoot: join(process.env.CODEX_HOME || join(homedir(), '.codex'), 'sessions'),
      transcriptPath: values.transcript ? resolve(values.transcript) : undefined,
    }) : values.transcript ? resolve(values.transcript) : undefined
    if (host === 'qwenwork') {
      if (!transcriptPath) throw Error('QwenWork requires the exact native Hook transcript_path.')
      const observation = await createQwenWorkTranscript({ path: transcriptPath, sessionId: values.thread, projectRoot: nativeCwd }).read()
      if (!observation.available) throw Error(observation.error ?? 'QwenWork native transcript unavailable.')
    }
    if (host === 'claude-code') {
      if (!transcriptPath) throw new Error('Claude Code requires the exact SessionStart transcript_path; reload the plugin in this session.')
      const observation = await createClaudeTranscript({ path: transcriptPath, sessionId: values.thread, projectRoot: nativeCwd }).read()
      if (!observation.available) throw new Error(observation.error ?? 'Claude Code main transcript is not ready.')
    }
    const server = await startStandaloneCompanion({ runtimeUrl: companionKnowledgeRuntimeUrl(), loadRuntime: loadCompanionKnowledgeRuntime,
      start: ({ loadRuntime }) => startCompanion({ ...options, host, threadId: requireThreadId(values.thread), port,
      knowledgeRuntime: loadRuntime,
      browserAccess: values['browser-access'],
      browserDefaultView: values['codex-desktop'] ? 'panel-only' : 'full',
      codexRemote: values['codex-remote'], codexDesktop: values['codex-desktop'], qwenworkDesktop: values['qwenwork-desktop'], qwenworkEventsOnly: values['qwenwork-events-only'],
      codexDesktopNativeBundles: values['codex-desktop-native-bundles'],
      statusEntryPath: join(pluginRoot, 'scripts/design.mjs'),
      backgroundReviews:values['background-reviews'],reviewModel:values['review-model'],
      embedding:{localOnly:!values['allow-embedding-download'],
        ...(values['embedding-cache']?{cacheDir:resolve(values['embedding-cache'])}:{}),
        ...(values['disable-embedding']?{provider:'disabled'}:{})},
      nativeCwd, transcriptPath,
      staticRoot: join(pluginRoot, 'web'), indexPath: join(pluginRoot, 'web/index.html'),
    }) })
    console.log(JSON.stringify({ url: server.url, browserAccess: server.browserAccess, connection: server.connectionPath, project: options.projectRoot, thread: values.thread,
      host, ...(server.inputMode ? { inputMode: server.inputMode } : {}),
      ...(values['codex-desktop'] ? { desktopBridge: {
        entry: join(pluginRoot, 'scripts/codex-desktop-bridge.mjs'),
        args: ['--connection', server.connectionPath], cwd: nativeCwd,
        launch: 'Directly through the current host command tool, using the selected desktop bundled Node; never spawn from Companion or MCP.',
      }, openPanel: { target: { type: 'browser', url: server.url + '?view=panel-only' }, placement: 'right' } } : {}),
      capabilities: ['live-files', 'panel-save', host === 'codex' ? values['codex-desktop'] ? 'codex-desktop-message-submission' : 'codex-queue' : server.inputMode === 'desktop' ? 'qwenwork-desktop-user-input' : `${host}-native-hooks`, ...(!values['codex-desktop'] || values['codex-desktop-native-bundles'] ? ['native-run-binding', 'worker-logs', 'background-review-results'] : []), ...(values['background-reviews'] ? ['managed-background-reviews'] : []), ...(transcriptPath ? ['recorded-conversation'] : [])],
      ...(server.inputMode === 'events-only' ? { inputWarning: 'Event-only mode: Hook receipt is not user-input acceptance; automatic conversation continuation is unavailable.' } : {}),
      unavailable: ['project-switching', ...(host !== 'codex' || values['codex-desktop'] ? ['managed-background-reviews'] : []), ...(values['codex-desktop'] && !values['codex-desktop-native-bundles'] ? ['native-subagents', 'native-workers'] : [])],
      ...(values['codex-desktop'] ? { requiresNativeVerification: ['background-reviews', ...(values['codex-desktop-native-bundles'] ? ['native-producer', 'nested-worker', 'main-worker'] : [])] } : {}),
      nativeAgentTools: 'Owned by the host session, not probed by Companion. Check the actual native tools; Companion does not spawn foreground agents.'
        + (host === 'qwenwork' ? ' QwenWork GRA availability is reported by the current design_status.hostCapabilities and reviewPolicy; startup alone does not verify native background execution.' : ''),
      ...(!transcriptPath ? {transcriptWarning:'No exact native transcript found. Recorded conversation is unavailable.'} : {}),
    }))
    return
  }
  // Read-only CLI operations have no conversation binding or notification path.
  const project = await openCompanionProject({ ...options, connection: {
    threadId: 'read-only-inspection', send: async () => { throw new Error('Read-only command has no Codex conversation.') },
  } })
  if (command === 'inspect') {
    const workspace = await project.readWorkspace()
    console.log(JSON.stringify({ project: project.project.metadata, designFiles: project.project.designFilesRoot,
      access: workspace.access, availableMindsets: (await project.listProjects()).mindsets,
      kitRoot: options.kitRoot, bundles: (workspace.access.writable ? project.kit.skills : []).map(skill => ({ name: skill.name, description: skill.description,
        directory: skill.resourceRoot ?? join(options.kitRoot, 'skills', skill.name), hasState: Object.hasOwn(workspace.design, skill.name) })),
      files: Object.keys(workspace.artifactFiles),
    }, null, 2))
    return
  }
  const skill = project.kit.skills.find(skill => skill.name === values.skill)
  if (!skill) throw new Error('--skill must name a Bundle in the project Kit.')
  if (values.scope !== undefined && !['state', 'completion'].includes(values.scope)) throw new Error('--scope must be state or completion.')
  const stateText = await project.store.readWorktreeText(`${skill.name}/${skill.name}.json`)
  if (stateText === undefined) throw new Error('Canonical Design JSON is missing.')
  const issues = await validateSkillDesign(skill, JSON.parse(stateText), {
    scopes: values.scope === 'completion' ? ['state', 'completion'] : ['state'],
    artifactText: path => project.store.readWorktreeText(path),
  })
  console.log(JSON.stringify({ valid: issues.length === 0, skill: skill.name, issues }, null, 2))
  if (issues.length) process.exitCode = 1
}

main().catch(error => {
  const receipt = notificationErrorResponse(error)
  console.error(receipt ? JSON.stringify(receipt) : error.message)
  process.exitCode = 1
})
