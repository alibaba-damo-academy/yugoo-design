import { join } from 'node:path'

/** One invocation-level translation of Bundle operations, not a second Bundle method. */
export function nativeExecutionContract({ host, mode, skill, projectRoot, designFiles, kitRoot, stateRoot, cliEntry, executable = process.execPath }) {
  if (!['main', 'subagent'].includes(mode)) throw new Error('Unsupported Bundle execution placement.')
  const directory = join(designFiles, skill)
  const canonicalFile = join(directory, `${skill}.json`)
  const finishTool = mode === 'main' ? 'design_finish_main_bundle' : 'design_finish_run'
  const identity = mode === 'main' ? 'invocationId returned by design_begin_main_bundle' : 'actual registered native runId, never a custom name'
  const callerSettles = host === 'workbuddy' && mode === 'subagent'
  const validation = cliEntry && kitRoot && stateRoot ? {
    executable,
    argv: [cliEntry, 'validate', '--project', projectRoot, '--kit', kitRoot, '--state-root', stateRoot,
      '--skill', skill, '--scope', 'completion'],
  } : undefined
  const instructions = [
    `# Native execution contract: ${host} / ${mode}`,
    'Pass this contract together with the complete Bundle method and referenced output contract to the actual executor. Read it before interpreting tool names in those domain documents.',
    'Bundle tool names describe operations. This Host mapping resolves their spelling only; it does not replace domain reasoning, schema, validation, ownership, permissions or handoff requirements.',
    `The ${mode === 'main' ? 'active main Bundle invocation' : 'bound foreground Producer'} owns only ${JSON.stringify(directory)}. Its canonical state is ${JSON.stringify(canonicalFile)}. Use the returned Design Files root, not the host cwd. Create the owned directory when needed.`,
    '- list / read_design_file / read: use the executor\'s native filesystem read/list tools for authorized project evidence. read_skill_resource: read the exact returned Bundle resource paths.',
    '- write / edit: use the executor\'s native filesystem write/edit tools for its Bundle-owned working files and declared artifacts. These are normal generation writes, not a user Panel save. A separate MCP Design File write/edit tool is not required. Workers may write only their separately assigned artifact; the caller must not repair a subagent Bundle in main.',
    '- run_skill_script: use the native command tool to run the actual referenced Bundle script with its documented literal argv and cwd. Do not install tools, alter permissions, or use shell Git as a substitute for Design publication.',
    '- design_validate: use the installed CLI validate command below when an independent preflight is needed. Its diagnostics return to the same executor for repair. There is no standalone MCP tool with this name.',
    validation
      ? `Validation command (native executable plus literal argv, not shell text): ${JSON.stringify(validation)}. For a declared pause, use --scope state; completion requires --scope completion.`
      : 'No complete separate CLI context was supplied by this caller. Do not guess an installed path, Kit or content store, or install one; the finish operation below still performs the full authoritative validation and returns repair diagnostics.',
    `- design_publish / design_finish: ${callerSettles ? 'after the Producer returns, main calls' : 'call'} ${finishTool} with the exact connection and ${identity}. It validates the on-disk canonical state and artifacts, then uses the shared checkpoint/Journal publication. Do not run Git commit yourself.`,
    ...(callerSettles ? ['For the ordinary WorkBuddy foreground path, the Producer authors/repairs its owned files and returns to main; main then calls design_finish_run for that same registered runId. Main does not edit the Producer files. If validation rejects, resume that Producer with the returned diagnostics and settle after its return. An already accepted finish is not repeated for new work; committed recovery follows its exact receipt. This caller settlement does not change the supported validation scopes or create a terminal-state permission gate.'] : []),
    'Use scope=completion,outcome=complete for completion; scope=state,outcome=pause only for the Bundle\'s declared human handoff. A successful native Agent return alone is not publication. Validation rejection means repair the same owned files and finish again, not switch placement or let main replace the Producer.',
    'Before authoring, verify the executor actually has the needed native filesystem capabilities. A native command tool is required only for a referenced script or a separate CLI preflight; authoritative finish validation is still available without that preflight. An absent DSH-named or MCP write tool is not evidence that native writes are unavailable. If a needed native capability is absent or denied, report the actual native tool names, error and Agent type/tool restrictions; do not bypass approval, use content-upgrade tools, switch hosts/models, or claim completion.',
    'Do not reapply user Panel saves. Read their already-persisted result through the existing exact-connection continuation. Keep native execution, durable publication, visible Panel rendering and original-session save consumption as separate evidence.',
  ].join('\n\n')
  return { host, mode, directory, canonicalFile, finishTool, ...(validation ? { validation } : {}), instructions }
}
