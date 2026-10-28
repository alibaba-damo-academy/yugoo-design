import { parseArgs } from 'node:util'
import { isAbsolute, join } from 'node:path'
import { pathToFileURL } from 'node:url'

/** Installed product entry. Resolves only the acquired package's existing Knowledge runtime. */
export async function embeddingPreparationMain(args, { npmRoot, signal } = {}) {
  const { values, positionals } = parseArgs({ args, allowPositionals: true, options: {
    help: { type: 'boolean', short: 'h' }, 'embedding-cache': { type: 'string' },
    'allow-download': { type: 'boolean' }, probe: { type: 'boolean' },
  } })
  if (positionals.length) throw new Error('prepare-embedding does not accept a host or project.')
  if (values.help) return { schemaVersion: 1, kind: 'embedding-preparation-help', status: 'not-applicable',
    usage: 'yugoo-design prepare-embedding [--embedding-cache /absolute/cache] [--allow-download] [--probe]',
    options: { '--embedding-cache': 'Use the same absolute model cache as the target runtime; omission keeps the existing per-user default.',
      '--allow-download': 'Explicitly permit the existing pinned model downloader to prepare missing or invalid resources; default only checks.',
      '--probe': 'After verified resources, run one fixed text through the existing local CPU worker, offline. No project or host is required.' },
    results: { 'assets-ready': 'All fixed resources verified; CPU inference has not been checked.', ready: 'Fixed resources verified and actual CPU inference passed.', unavailable: 'Resources or inference unavailable; see reasonCode. Basic design and source facts are unchanged.' } }
  if (values['embedding-cache'] !== undefined && !isAbsolute(values['embedding-cache'])) throw new Error('--embedding-cache must be an absolute path.')
  try {
    const runtimeUrl = pathToFileURL(join(npmRoot, 'payload/shared/knowledge/runtime.mjs'))
    const { runStandaloneKnowledgeOperation } = await import(pathToFileURL(join(npmRoot, 'payload/shared/knowledge/cli-lifecycle.mjs')).href)
    return await runStandaloneKnowledgeOperation({ runtimeUrl, loadRuntime: () => import(runtimeUrl.href), run: runtime => {
      if (typeof runtime.prepareLocalEmbedding !== 'function') throw new Error('Missing embedding preparation entry')
      return runtime.prepareLocalEmbedding({ cacheDir: values['embedding-cache'], allowDownload: values['allow-download'] === true,
        probe: values.probe === true, signal })
    } })
  } catch {
    return { schemaVersion: 1, kind: 'embedding-preparation', status: 'unavailable', reasonCode: signal?.aborted ? 'cancelled' : 'runtime-unavailable',
      resources: { state: 'unavailable' }, inference: { state: 'not-run' }, semanticKagVerified: false,
      message: 'The installed Knowledge runtime could not run the embedding check. Check this package and its current-platform dependencies. Basic design and source facts are unchanged.' }
  }
}
