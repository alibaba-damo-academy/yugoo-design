/** Explicit local export recovery commands; no automatic choice, Git or publication. */
import { isAbsolute, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { inspectPublicSyncRecovery } from './public-sync-recovery-plan.mjs'
import { inspectPublicSyncRollback, rollbackSettledPublicSync } from './public-sync-rollback.mjs'
import { inspectPublicSyncDirectoryRecovery } from './public-sync-directory-recovery.mjs'
import { inspectPublicSyncDirectoryRollback, rollbackRecordedPublicSyncDirectories,
  inspectStoppedPublicSyncDirectoryRollback, resumeStoppedPublicSyncDirectoryRollback } from './public-sync-directory-rollback.mjs'
import { inspectPublicSyncRollbackCompletion, finalizePublicSyncRollback } from './public-sync-rollback-completion.mjs'
import { inspectPublicSyncRollbackRelease, resumePublicSyncRollbackRelease } from './public-sync-rollback-release.mjs'
import { inspectPublicSyncInterruption, settleStoppedPublicSyncForward, settleStoppedPublicSyncRestore,
  inspectPublicSyncSettlementResume, resumeStoppedPublicSyncSettlement, takeoverStoppedPublicSyncSettlement } from './public-sync-interruption.mjs'
import { inspectStoppedPublicSyncResumeLease } from './public-sync-resume-lease.mjs'

const base = ['journal', 'header-sha256']
const settled = [...base, 'tail-sha256']
const directory = [...settled, 'directory-plan-sha256']
const resume = [...settled, 'evidence', 'intent-sha256']
const release = [...directory, 'completion-sha256']
const commands = {
  'inspect-files': { keys: base, run: inspectPublicSyncRecovery },
  'inspect-rollback': { keys: settled, run: inspectPublicSyncRollback },
  'rollback-files': { keys: [...settled, 'plan-sha256'], run: rollbackSettledPublicSync },
  'inspect-directories': { keys: [...base, 'directory-plan-sha256'], run: input =>
    inspectPublicSyncDirectoryRecovery({ ...input, expectedPlanSha256: input.expectedDirectoryPlanSha256 }) },
  'inspect-directory-rollback': { keys: directory, run: input =>
    inspectPublicSyncDirectoryRollback({ ...input, expectedPlanSha256: input.expectedDirectoryPlanSha256 }) },
  'rollback-directories': { keys: [...directory, 'plan-sha256'], run: rollbackRecordedPublicSyncDirectories },
  'inspect-directory-rollback-resume': { keys: directory, run: inspectStoppedPublicSyncDirectoryRollback },
  'resume-directory-rollback': { keys: [...directory, 'plan-sha256', 'executor-stopped'], run: resumeStoppedPublicSyncDirectoryRollback },
  'inspect-finalize-rollback': { keys: directory, run: inspectPublicSyncRollbackCompletion },
  'finalize-rollback': { keys: [...directory, 'plan-sha256'], run: finalizePublicSyncRollback },
  'inspect-rollback-release': { keys: release, run: inspectPublicSyncRollbackRelease },
  'resume-rollback-release': { keys: [...release, 'plan-sha256', 'executor-stopped'], run: input =>
    resumePublicSyncRollbackRelease({ ...input, executorStopped: input.executorStoppedAcknowledged }) },
  'inspect-interruption': { keys: settled, run: inspectPublicSyncInterruption },
  'settle-forward': { keys: [...settled, 'plan-sha256', 'executor-stopped', 'not-applied-rollback-only'], run: settleStoppedPublicSyncForward },
  'settle-restore': { keys: [...settled, 'plan-sha256', 'executor-stopped'], run: settleStoppedPublicSyncRestore },
  'inspect-settlement-resume': { keys: resume, run: inspectPublicSyncSettlementResume },
  'inspect-resume-lease': { keys: resume, run: inspectStoppedPublicSyncResumeLease },
  'takeover-stopped-resume': { keys: [...resume, 'stopped-resume-plan-sha256', 'executor-stopped'], run: takeoverStoppedPublicSyncSettlement },
  'resume-settlement': { keys: [...resume, 'resume-plan-sha256', 'executor-stopped'], run: resumeStoppedPublicSyncSettlement },
}
const fields = {
  journal: 'journalRoot', 'header-sha256': 'headerSha256', 'tail-sha256': 'expectedTailSha256',
  'plan-sha256': 'expectedPlanSha256', 'directory-plan-sha256': 'expectedDirectoryPlanSha256',
  'completion-sha256': 'expectedCompletionSha256',
  evidence: 'evidenceRoot', 'intent-sha256': 'expectedIntentSha256', 'resume-plan-sha256': 'expectedResumePlanSha256',
  'stopped-resume-plan-sha256': 'expectedStoppedResumePlanSha256',
  'executor-stopped': 'executorStoppedAcknowledged', 'not-applied-rollback-only': 'notAppliedRollbackOnlyAcknowledged',
}

export async function runPublicExportRecovery(args) {
  if (args.length === 1 && args[0] === '--help') return {
    commands: Object.fromEntries(Object.entries(commands).map(([name, route]) => [name, route.keys.map(key => `--${key}`)])),
    instructions: 'Inspect first and pass the exact reported hashes. Settlement requires all relevant executors stopped. Unsupported states refuse rather than deleting locks.',
    targetUpdated: false, executorLivenessProven: false, publicationReady: false,
  }
  const [command, ...pairs] = args, route = commands[command]
  if (!Object.hasOwn(commands, command) || !route || pairs.length !== route.keys.length * 2) throw new Error('Invalid recovery arguments')
  const input = Object.create(null), seen = new Set()
  for (let index = 0; index < pairs.length; index += 2) {
    const option = pairs[index], value = pairs[index + 1], name = option?.slice(2)
    if (!option?.startsWith('--') || !route.keys.includes(name) || seen.has(name)
      || !value || value.startsWith('--')) throw new Error('Invalid recovery arguments')
    seen.add(name)
    if (name.endsWith('-sha256')) {
      if (!/^[a-f0-9]{64}$/u.test(value)) throw new Error('Exact inspected SHA-256 required')
    } else if (name === 'journal' || name === 'evidence') {
      if (!isAbsolute(value)) throw new Error('Explicit absolute recovery evidence path required')
    } else if (name === 'executor-stopped') {
      if (value !== 'yes') throw new Error('Executor quiescence must be explicitly acknowledged')
    } else if (!['yes', 'no'].includes(value)) throw new Error('Explicit rollback-only decision required')
    input[fields[name]] = name === 'executor-stopped' || name === 'not-applied-rollback-only' ? value === 'yes' : value
  }
  // Neither an evidence path nor this acknowledgement proves process liveness.
  // The operator must stop all relevant executors before a settlement command.
  return route.run(input)
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  try {
    const result = await runPublicExportRecovery(process.argv.slice(2))
    console.log(JSON.stringify(result, null, 2))
    if (result.applicable === false || result.conflicts?.length) process.exitCode = 2
  } catch {
    console.error('Public export recovery failed. Retain target, backups, journal and locks. Use an explicit inspect command and its exact hashes; mutation commands never choose or approve recovery automatically. Settlement requires all executors stopped, not a PID/age guess. Unsupported or re-interrupted states remain blocked; do not delete locks or blindly retry. No Git writes or publication are performed.')
    process.exitCode = 1
  }
}
