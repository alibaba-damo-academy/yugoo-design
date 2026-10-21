/**
 * The structured `report_design_clarity` tool: the sole clarity assessment
 * authority, replacing the retired hidden XML/Markdown pipeline.
 *
 * The main Agent reports or corrects an assessment through an ordinary tool;
 * the host resolves the selected Kit and preserves only actual call metadata, persisting it as
 * the project clarity.json authority with a DesignJournal audit fact, and
 * emits the ordinary logged `tool/result`.
 * The tool never writes Design Files,
 * never selects a Bundle, and never asks questions.
 */
import type { Context } from '@deepseek-ai/cordis'
import { projectKitContentHash } from './project-content.ts'
import { defineTool } from '@deepseek-ai/dsh-tools'
import {
  DESIGN_CLARITY_META_KIND,
  DESIGN_CLARITY_META_VERSION,
  DESIGN_CLARITY_TEXT_LIMITS,
  designClarityDigest,
} from './design-clarity-report.ts'
import { nodeFs, requireAgent } from './service-tools.ts'
import type { DesignClarityDigest, DesignClarityDimensionInput, DesignClarityReportedPayload } from './types.ts'
import type DesignService from './design-service.ts'

/** Dimension parameter spec shared by U, S, and T. */
const DIMENSION_PARAMETER = {
  type: 'object',
  additionalProperties: false,
  required: true,
  properties: {
    score: { type: 'integer', required: true, description: 'Evidence-based integer from 0 to 100.' },
    evidence: { type: 'string', required: true, description: 'Concrete evidence from the session that supports the score. Prefer a few sentences; ordinary long explanations are preserved. Safety ceiling: 64 KiB UTF-8.' },
  },
} as const

/** Output value: the complete validated report with host-filled identity. */
const RESULT_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  properties: {
    digest: { type: 'string', required: true },
    turn: { type: 'integer' },
    callId: { type: 'string' },
    kit: { type: 'string', required: true },
    version: { type: 'string', required: true },
    origin: { type: 'string', required: true },
    scopeDigest: { type: 'string' },
    kitContentHash: { type: 'string', required: true },
    summary: { type: 'string', required: true },
    u: {
      type: 'object',
      additionalProperties: false,
      required: true,
      properties: {
        score: { type: 'integer', required: true },
        evidence: { type: 'string', required: true },
      },
    },
    s: {
      type: 'object',
      additionalProperties: false,
      required: true,
      properties: {
        score: { type: 'integer', required: true },
        evidence: { type: 'string', required: true },
      },
    },
    t: {
      type: 'object',
      additionalProperties: false,
      required: true,
      properties: {
        score: { type: 'integer', required: true },
        evidence: { type: 'string', required: true },
      },
    },
    nextGap: { type: 'string' },
  },
} as const

function boundedText(field: string, value: string, maxBytes: number): void {
  if (value.trim() === '') throw new Error(`report_design_clarity ${field}: must be non-empty text`)
  if (Buffer.byteLength(value, 'utf8') > maxBytes) {
    throw new Error(`report_design_clarity ${field}: exceeds ${maxBytes} UTF-8 bytes`)
  }
}

function validateDimension(field: string, dimension: DesignClarityDimensionInput): void {
  if (!Number.isInteger(dimension.score) || dimension.score < 0 || dimension.score > 100) {
    throw new Error(`report_design_clarity ${field}.score: expected an integer from 0 to 100`)
  }
  boundedText(`${field}.evidence`, dimension.evidence, DESIGN_CLARITY_TEXT_LIMITS.evidenceMaxBytes)
}

/**
 * Register the ordinary `report_design_clarity` tool without native-log claims.
 * @param ctx - composing DSH context carrying the public Tool registry.
 * @param design - the design seam owning Kit resolution and the journal.
 */
export function registerDesignClarityTool(ctx: Context, design: DesignService): void {
  ctx.tools.register(defineTool({
    name: 'report_design_clarity',
    description: 'Record the main Agent assessment of the selected project and saved Design commit. Score U (intent), S (structure), and T (observable checks) with evidence-based integers from 0 to 100. Explain the relevant user scope and evidence. Reassessment and correction are allowed, including in the same turn. The tool saves project records, not Design Files, and does not authenticate native execution or run another model.',
    parameters: {
      input: {
        type: 'object',
        additionalProperties: false,
        required: true,
        description: 'Copy the selected project, assessed saved Design commit and Kit content from current Design context. Obsolete Design evidence is rejected; conversational scope is explained in the assessment, not authenticated through native logs.',
        properties: {
          projectId: { type: 'string', required: true },
          selectionRevision: { type: 'integer' },
          assessedCheckpoint: { type: 'string', required: true },
          kitContentHash: { type: 'string', required: true },
          scopeDigest: { type: 'string' },
        },
      },
      summary: {
        type: 'string',
        required: true,
        description: 'Short plain-text summary of the current overall design clarity.',
      },
      u: { ...DIMENSION_PARAMETER, description: 'Intent clarity relative to the active Kit and agreed scope: relevant actors or beneficiaries, situations, intended outcomes and boundaries; do not infer a Web App checklist or treat model assumptions as user confirmation.' },
      s: { ...DIMENSION_PARAMETER, description: 'Structural clarity: coherent organization of relevant concepts, responsibilities, relationships, hierarchy and dependencies within the agreed scope.' },
      t: { ...DIMENSION_PARAMETER, description: 'Verifiability relative to the active Kit and agreed scope: observable checks for intended outcomes, boundaries and constraints; this need not mean executable software tests or software-specific acceptance criteria.' },
      nextGap: {
        type: 'string',
        description: 'Optional single most important remaining clarity gap.',
      },
    },
    output: {
      schema: RESULT_SCHEMA,
      render: (_args, value) => {
        const weighted = Math.round(value.u.score * 0.4 + value.s.score * 0.4 + value.t.score * 0.2)
        const lines = [
          `Design clarity recorded: weighted score ${weighted} (U=${value.u.score}, S=${value.s.score}, T=${value.t.score}).`,
          value.summary,
        ]
        if (value.nextGap !== undefined) lines.push(`Next gap: ${value.nextGap}`)
        return [{ type: 'text', text: lines.join('\n') }]
      },
      presentationMeta: (_args, value) => ({
        kind: DESIGN_CLARITY_META_KIND,
        v: DESIGN_CLARITY_META_VERSION,
        digest: value.digest,
        ...(value.turn === undefined ? {} : { turn: value.turn }),
        ...(value.callId === undefined ? {} : { callId: value.callId }),
        kit: value.kit,
        version: value.version,
        origin: value.origin,
        ...(value.scopeDigest === undefined ? {} : { scopeDigest: value.scopeDigest }),
        kitContentHash: value.kitContentHash,
        summary: value.summary,
        u: { score: value.u.score, evidence: value.u.evidence },
        s: { score: value.s.score, evidence: value.s.evidence },
        t: { score: value.t.score, evidence: value.t.evidence },
        ...(value.nextGap === undefined ? {} : { nextGap: value.nextGap }),
      }),
    },
    async execute(args, exec) {
      const agent = requireAgent(exec)
      if (agent.session.header.origin === 'subagent') {
        throw new Error('report_design_clarity is unavailable to subagents')
      }
      boundedText('summary', args.summary, DESIGN_CLARITY_TEXT_LIMITS.summaryMaxBytes)
      validateDimension('u', args.u)
      validateDimension('s', args.s)
      validateDimension('t', args.t)
      if (args.nextGap !== undefined) boundedText('nextGap', args.nextGap, DESIGN_CLARITY_TEXT_LIMITS.nextGapMaxBytes)
      const project = await design.selectedProjectForAgent(agent, exec.signal)
      if (project === undefined) throw new Error('report_design_clarity: no selected Design Project')
      const kit = design.requireKitForAgent(agent)
      const kitContentHash = projectKitContentHash(kit)
      const files = await design.designFilesForProject(agent, project.projectId, nodeFs, exec.signal)
      const assessedCheckpoint = await files.head(exec.signal)
      if (assessedCheckpoint === undefined) throw new Error('report_design_clarity: a committed Design checkpoint is required')
      if (!args.input || args.input.projectId !== project.projectId
        || args.input.kitContentHash !== kitContentHash
        || !await files.sameDesignEvidenceAt(args.input.assessedCheckpoint, assessedCheckpoint, exec.signal)) {
        throw new Error('report_design_clarity: assessed project, Kit or saved Design evidence is no longer current')
      }
      design.assertProjectSelection(agent, project.projectId, args.input.selectionRevision)
        const digest: DesignClarityDigest = designClarityDigest(
          {
            summary: args.summary,
            u: args.u,
            s: args.s,
            t: args.t,
            ...(args.nextGap === undefined ? {} : { nextGap: args.nextGap }),
          },
          kit.name,
          kit.version,
        )
        const report: DesignClarityReportedPayload = Object.freeze({
          origin: 'main-agent',
          kitContentHash,
          digest,
          ...(exec.callId === undefined ? {} : { callId: String(exec.callId) }),
          kit: kit.name,
          version: kit.version,
          summary: args.summary,
          u: Object.freeze({ ...args.u }),
          s: Object.freeze({ ...args.s }),
          t: Object.freeze({ ...args.t }),
          ...(args.nextGap === undefined ? {} : { nextGap: args.nextGap }),
        })
        await design.reportClarity(agent, report, { expectedProjectId: project.projectId,
          expectedSelectionRevision: args.input.selectionRevision, assessedCheckpoint: args.input.assessedCheckpoint, signal: exec.signal })
        return {
          digest: String(report.digest),
          ...(report.callId === undefined ? {} : { callId: report.callId }),
          kit: report.kit,
          version: String(report.version),
          origin: 'main-agent',
          kitContentHash,
          summary: report.summary,
          u: { score: report.u.score, evidence: report.u.evidence },
          s: { score: report.s.score, evidence: report.s.evidence },
          t: { score: report.t.score, evidence: report.t.evidence },
          ...(report.nextGap === undefined ? {} : { nextGap: report.nextGap }),
        }
    },
    presentCall(args) {
      return {
        card: 'generic',
        title: 'Report design clarity',
        kind: 'other',
        rawInput: args.summary,
      }
    },
  }))
}
