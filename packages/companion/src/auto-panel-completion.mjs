/** UI follow-up cannot turn a successful fact settlement into a failure. */
export async function finishWithAutoPanel({ method, params, nativeRuns, project }) {
  const result = await nativeRuns[method](params)
  const binding = method === 'finishMainBundle'
    ? nativeRuns.getMainInvocation(params.invocationId) : nativeRuns.getBinding(params.runId)
  if (!result.accepted || method === 'finishNativeRun' && binding.role !== 'producer'
    || ['failed', 'cancelled', 'no-progress'].includes(binding.settledOutcome)) return result
  const skill = project.installedKit.skills.find(item => item.name === binding.skill)
  if (skill?.metadata.skillManifest?.presentation?.mode !== 'auto') return result
  try {
    const autoTask = await project.prepareAutoPanel({ skill: binding.skill })
    return { ...result, autoTask, ...(autoTask.status === 'awaiting-agent' ? {
      autoPanelInstruction: 'Continue this normal Bundle task using the same native Agent: generate components from autoTask.prompt, then submit via design_submit_auto_panel with autoTask.requestId and this exact connection. If repair-required, repair once using its prompt. No new user turn or second model process is needed. Design publication already succeeded; UI errors only require UI repair.'
    } : {}) }
  } catch (error) {
    return { ...result, autoTask: { status: 'failed', skill: binding.skill,
      detail: String(error?.message ?? error).slice(0, 500) } }
  }
}
