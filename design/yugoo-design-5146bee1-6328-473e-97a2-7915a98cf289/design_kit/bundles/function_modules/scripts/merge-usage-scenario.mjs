import { readFileSync } from 'node:fs'
import { pathToFileURL } from 'node:url'

const isObject = value => value !== null && typeof value === 'object' && !Array.isArray(value)

/** Explicit, pure content conversion; callers own target validation/publication.
 * Never touches files, source revisions, IDs or a project's Kit pin. */
export function mergeUsageScenarios(state) {
  if (!isObject(state) || !isObject(state.functions)) throw new Error('Expected a complete function_modules state with a functions map')
  const next = structuredClone(state)
  for (const [id, record] of Object.entries(next.functions)) {
    if (!isObject(record)) throw new Error(`Function ${id} must be an object`)
    if (record.details === undefined) continue
    if (!isObject(record.details)) throw new Error(`Function ${id} details must be an object`)
    const details = record.details
    if (details.situation !== undefined && typeof details.situation !== 'string') throw new Error(`Function ${id} purpose/situation must be strings`)
    if (!Object.hasOwn(details, 'purpose')) continue
    if (typeof details.purpose !== 'string') {
      throw new Error(`Function ${id} purpose/situation must be strings`)
    }
    // Preserve original strings, including whitespace; do not summarize facts.
    details.situation = details.situation === undefined ? details.purpose : `${details.purpose}\n\n${details.situation}`
    delete details.purpose
    if (isObject(record.references)) for (const reference of Object.values(record.references)) {
      if (isObject(reference) && reference.subject_pointer === '/details/purpose') reference.subject_pointer = '/details/situation'
    }
  }
  return next
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    process.stdout.write(`${JSON.stringify(mergeUsageScenarios(JSON.parse(readFileSync(0, 'utf8'))), null, 2)}\n`)
  } catch (error) {
    process.stderr.write(`Usage-scenario conversion failed: ${error.message}\n`)
    process.exitCode = 1
  }
}
