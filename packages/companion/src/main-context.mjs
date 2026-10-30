/** Main-Agent U/S/T over project files and Git; no native log or model prerequisite. */
import { join } from 'node:path'
import * as core from '../../core/lib/index.js'

export function createCompanionMainContext({ project, reviews, knowledge }) {
  const projectId = project.project.metadata.id
  const projectRoot = project.project.root
  const root = core.designProjectRecordsRoot(projectRoot)
  const journal = new core.DesignJournalStorage(join(root, 'journal'), {}, { projectRoot })
  const owner = `project:${projectId}`
  const journalPath = `design_records/journal/${Buffer.from(owner).toString('base64url')}.jsonl`
  async function guardRecords() {
    for (const path of ['design_records/clarity.json', journalPath]) await core.resolveConfinedFilePath(projectRoot, path)
  }
  async function capture() {
    await project.requireWritable()
    const workspace = await project.readWorkspace()
    if (project.project.metadata.id !== projectId || !workspace.checkpoint) throw new Error('Main assessment requires this selected project and a committed checkpoint.')
    const kit = project.kit
    return { workspace, kit, input: { projectId, assessedCheckpoint: workspace.checkpoint,
      kitContentHash: core.projectKitContentHash(kit) } }
  }
  async function matches(input, captured) {
    return !!input && input.projectId === projectId && input.kitContentHash === captured.input.kitContentHash
      && typeof input.assessedCheckpoint === 'string' && /^[a-f0-9]{40}(?:[a-f0-9]{24})?$/.test(input.assessedCheckpoint)
      && await project.store.sameDesignEvidenceAt(input.assessedCheckpoint, captured.input.assessedCheckpoint)
  }
  async function assessmentState(captured, authority) {
    const current = !!authority && core.designClarityInputMatches(authority.report, { kit: captured.kit.name,
      version: captured.kit.version, ...captured.input })
      && await project.store.sameDesignEvidenceAt(authority.assessedCheckpoint, captured.input.assessedCheckpoint)
    return { assessment: authority?.report ?? null, assessedCheckpoint: authority?.assessedCheckpoint ?? null,
      needsReassessment: !current, state: current ? 'current' : authority ? 'due' : 'unknown' }
  }
  async function context({ includeKnowledge = true } = {}) {
    const captured = await capture()
    await guardRecords()
    const clarity = await assessmentState(captured, await core.readCommittedDesignClarityAuthority(projectRoot, projectId))
    const status = includeKnowledge && knowledge ? await knowledge.status().catch(() => ({ state: 'unavailable' })) : undefined
    return { project: projectId, checkpoint: captured.input.assessedCheckpoint, input: captured.input, clarity,
      ...(status ? { knowledge: status } : {}),
      method: [core.DESIGN_CORE_CLARITY_RUBRIC_PROMPT, core.renderDesignClarityKitContext(captured.kit, { contracts: 'resources' }),
        `Current design_clarity_input: ${JSON.stringify(captured.input)}`,
        clarity.needsReassessment
          ? 'Assess the saved Design evidence against the agreed scope in your conversation and report evidence-based U/S/T with report_design_clarity. Re-read design_main_context if the project, Kit or Design evidence changes. Reporting is an ordinary tool operation; missing or failed assessment does not block authorized Design work.'
          : 'Reuse this assessment when its reasoning still fits the agreed scope. New intent or corrected reasoning can justify another report on the same Design checkpoint. U/S/T guides evidence gaps, not mandatory stages; keep explicit user work first.',
        'KAG supports discovery. Verify source facts and preserve project/checkpoint/revision pins. Pending, stale or unavailable indexing never gates ordinary work.',
        'G/R/A is independent background advice. Use only actual native execution capability; never wait for reviews or manufacture a background handle.',
      ].filter(Boolean).join('\n\n') }
  }
  return {
    input: async () => (await capture()).input,
    context,
    async notification(saved) {
      const newer = saved?.commit && !await project.store.sameDesignEvidenceAt(saved.commit, await project.store.head())
      return [newer ? 'Newer Design evidence exists.' : 'The saved files are durable.',
        'Read design_main_context for the current saved evidence, assessment and report input.',
        core.DESIGN_PANEL_SAVE_ASSESSMENT_GUIDANCE,
        'Assessment, KAG and GRA do not block independently authorized Design work.',
      ].join(' ')
    },
    async report({ input, ...value }) {
      const assessment = core.parseDesignClarityInput(value)
      if (!input || Object.keys(input).some(key => !['projectId', 'assessedCheckpoint', 'kitContentHash'].includes(key))) throw new Error('Expected the project, Git checkpoint and Kit input from design_main_context.')
      if (typeof project.mutateAssessment !== 'function') throw new Error('Main assessment mutation lane is unavailable.')
      return reviews.mutateAssessment(() => project.mutateAssessment(async () => {
        const captured = await capture()
        if (!await matches(input, captured)) throw new Error('Clarity input is no longer current. Read design_main_context and assess the current project, Kit and Design evidence.')
        const digest = core.designClarityDigest(assessment, captured.kit.name, captured.kit.version)
        // Only an explicit report may settle a prior local publication failure.
        // Context/display must keep reading the last committed assessment.
        await guardRecords()
        const prior = await assessmentState(captured, await core.readDesignClarityAuthority(root, projectId))
        const replayed = !prior.needsReassessment && prior.assessment.digest === digest
        const report = replayed ? prior.assessment : core.parseDesignClarityReported({ ...assessment,
          kit: captured.kit.name, version: captured.kit.version, origin: 'main-agent', kitContentHash: input.kitContentHash, digest })
        const assessedCheckpoint = replayed ? prior.assessedCheckpoint : input.assessedCheckpoint
        await guardRecords()
        const audit = await journal.atomicMutate(owner, () => replayed ? undefined
          : { type: 'design/clarity-reported', data: { assessedCheckpoint, report } })
        const checked = await capture()
        if (!await matches(input, checked)) throw new Error('Main assessment became stale before authority promotion.')
        if (!replayed) await core.writeDesignClarityAuthority(root, { schemaVersion: 1, projectId, assessedCheckpoint, report }, { beforeReplace: () => {
          if (project.project.metadata.id !== projectId || core.projectKitContentHash(project.kit) !== input.kitContentHash) throw new Error('Project or Kit changed before assessment replacement.')
        } })
        const commit = await core.commitDesignProjectRecords({ projectRoot,
          paths: ['design_records/clarity.json', journalPath], expectedHead: checked.input.assessedCheckpoint,
          message: 'Record Design clarity assessment' })
        return { report, assessedCheckpoint, journalRevision: audit.read.revision, replayed, ...(commit ? { commit } : {}) }
      }))
    },
  }
}
