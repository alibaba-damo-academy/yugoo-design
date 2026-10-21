/** Explicit local staging, preparation and approved sync; no Git writes or publication. */
import { readFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { inspectPublicSync, stagePublicSnapshot } from './public-snapshot-stage.mjs'
import { preparePublicSync } from './public-sync-prepare.mjs'
import { verifyPreparedPublicSync } from './public-sync-receipt.mjs'
import { applyPreparedPublicSync } from './public-sync-apply.mjs'

export async function runPublicExport(args) {
  const [command, ...pairs] = args
  const expected = command === 'stage' ? ['source', 'revision', 'policy', 'destination']
    : command === 'inspect' ? ['stage', 'target']
      : command === 'prepare' ? ['stage', 'target', 'preparation', 'stage-sha256', 'target-sha256']
        : command === 'verify' ? ['preparation', 'receipt-sha256']
          : command === 'apply' ? ['preparation', 'receipt-sha256', 'stage-sha256', 'target-sha256'] : undefined
  const optional = command === 'stage' ? ['public-documents', 'public-source-config'] : []
  if (!expected || pairs.length % 2 !== 0 || pairs.length < expected.length * 2
    || pairs.length > (expected.length + optional.length) * 2) throw new Error('Invalid export arguments')
  const options = Object.create(null)
  for (let index = 0; index < pairs.length; index += 2) {
    const name = pairs[index].slice(2)
    if (!pairs[index].startsWith('--') || ![...expected, ...optional].includes(name)
      || Object.hasOwn(options, name) || !pairs[index + 1] || pairs[index + 1].startsWith('--')) {
      throw new Error('Invalid export arguments')
    }
    options[name] = pairs[index + 1]
  }
  if (expected.some(name => !Object.hasOwn(options, name))) throw new Error('Invalid export arguments')
  for (const key of optional) if (Object.hasOwn(options, key) && !['true', 'false'].includes(options[key])) throw new Error('Invalid export arguments')
  if (command === 'inspect') return inspectPublicSync({ stageRoot: options.stage, targetRoot: options.target })
  for (const key of expected.filter(key => key.endsWith('-sha256'))) {
    if (!/^[a-f0-9]{64}$/u.test(options[key])) throw new Error('Exact inspected SHA-256 fences required')
  }
  if (command === 'verify') return verifyPreparedPublicSync({ preparationRoot: options.preparation, preparedSha256: options['receipt-sha256'] })
  if (command === 'apply') return applyPreparedPublicSync({ preparationRoot: options.preparation,
    preparedSha256: options['receipt-sha256'], expectedStageManifestSha256: options['stage-sha256'],
    expectedTargetStateSha256: options['target-sha256'] })
  if (command === 'prepare') {
    const plan = await inspectPublicSync({ stageRoot: options.stage, targetRoot: options.target })
    if (!plan.applicable) return plan
    if (plan.stageManifestSha256 !== options['stage-sha256'] || plan.targetStateSha256 !== options['target-sha256']) throw new Error('Inspected sync inputs changed')
    return preparePublicSync({ approvedPlan: plan, preparationRoot: options.preparation })
  }
  const policy = JSON.parse(await readFile(resolve(options.policy), 'utf8'))
  return stagePublicSnapshot({ source: resolve(options.source), revision: options.revision,
    policy, destination: resolve(options.destination), publicDocuments: options['public-documents'] === 'true',
    publicSourceConfig: options['public-source-config'] === 'true' })
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  try {
    const result = await runPublicExport(process.argv.slice(2))
    console.log(JSON.stringify(result, null, 2))
    if (result.applicable === false) process.exitCode = 2
  } catch {
    // Raw Git/JSON/filesystem errors can contain private paths or source bytes.
    console.error('Public export failed. Commands: stage --source DIR --revision FULL_COMMIT --policy FILE --destination NEW_DIR [--public-documents true|false] [--public-source-config true|false]; inspect --stage DIR --target DIR; prepare --stage DIR --target DIR --preparation NEW_DIR --stage-sha256 HASH --target-sha256 HASH; verify --preparation DIR --receipt-sha256 HASH; apply --preparation DIR --receipt-sha256 HASH --stage-sha256 HASH --target-sha256 HASH. Failed staging or preparation may leave an incomplete new directory. Failed apply may leave partial target changes, backups, journal and locks: retain evidence and inspect before explicit recovery; do not blindly retry or remove locks. Git writes and publication are never performed.')
    process.exitCode = 1
  }
}
