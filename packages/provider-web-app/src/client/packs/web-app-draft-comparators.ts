/** Draft equality rules owned by the official Web App native client pack. */
import { isRecord } from '../types.ts'

/** Stable JSON of one value with the given keys kept in declaration order. */
function pickJson(record: Record<string, unknown>, keys: readonly string[]): string {
  const picked: Record<string, unknown> = {}
  for (const key of keys) picked[key] = record[key]
  return JSON.stringify(picked)
}

function mapSubsetEqual(
  a: Record<string, unknown>,
  b: Record<string, unknown>,
  mapKey: string,
  keys: readonly string[],
): boolean {
  const left = isRecord(a[mapKey]) ? a[mapKey] : {}
  const right = isRecord(b[mapKey]) ? b[mapKey] : {}
  const ids = new Set([...Object.keys(left), ...Object.keys(right)])
  for (const id of ids) {
    const entryA = isRecord(left[id]) ? left[id] : {}
    const entryB = isRecord(right[id]) ? right[id] : {}
    if (pickJson(entryA, keys) !== pickJson(entryB, keys)) return false
  }
  return true
}

function questionsEqual(a: unknown, b: unknown): boolean {
  return isRecord(a) && isRecord(b)
    && mapSubsetEqual(a, b, 'questions', ['answer', 'detail', 'multimodal_answer', 'rejected'])
}

function functionsEqual(a: unknown, b: unknown): boolean {
  if (!isRecord(a) || !isRecord(b)) return false
  // Function cards contain canonical data only, no hydrated runtime progress.
  // A visible-field allowlist would silently ignore edits to nested details,
  // provenance, reasons, or group labels when deciding whether Save is enabled.
  const canonical = (value: unknown): string | undefined => JSON.stringify(value, (_key, entry) => isRecord(entry)
    ? Object.fromEntries(Object.entries(entry).sort(([left], [right]) => left.localeCompare(right))) : entry)
  return canonical(a.functions ?? {}) === canonical(b.functions ?? {})
}

/** Flow drafts count transient Modeler XML as a local edit but ignore live status. */
function flowEqual(a: unknown, b: unknown): boolean {
  if (!isRecord(a) || !isRecord(b)) return false
  const strip = (value: Record<string, unknown>): unknown => {
    const processes = isRecord(value.processes) ? value.processes : {}
    const cleaned: Record<string, unknown> = {}
    for (const [id, process] of Object.entries(processes)) {
      if (!isRecord(process)) continue
      const entry = { ...process }
      delete entry.bpmn_file
      delete entry.bpmn_generated
      delete entry.bpmn_last_error
      delete entry.generation_status
      cleaned[id] = entry
    }
    return {
      topic: value.topic,
      epoch: value.epoch,
      roles: value.roles,
      process_order: value.process_order,
      processes: cleaned,
    }
  }
  return JSON.stringify(strip(a)) === JSON.stringify(strip(b))
}

/** Design Style notes and generated preview metadata do not count as edits. */
function designStyleEqual(a: unknown, b: unknown): boolean {
  if (!isRecord(a) || !isRecord(b)) return false
  const strip = (value: Record<string, unknown>): unknown => {
    const config = isRecord(value.config) ? { ...value.config } : {}
    delete config.notes
    delete config.preview_page
    return { config }
  }
  return JSON.stringify(strip(a)) === JSON.stringify(strip(b))
}

/** Page drafts ignore Host materialization/progress and hydrated preview fields. */
function pagesEqual(a: unknown, b: unknown): boolean {
  if (!isRecord(a) || !isRecord(b)) return false
  const strip = (value: Record<string, unknown>): unknown => {
    const pages = isRecord(value.pages) ? value.pages : {}
    const cleaned: Record<string, unknown> = {}
    for (const [id, page] of Object.entries(pages)) {
      if (!isRecord(page)) {
        cleaned[id] = page
        continue
      }
      const entry = { ...page }
      delete entry.html
      delete entry.generation_status
      delete entry.artifact_file
      delete entry.generation_error
      delete entry.evidence_digest
      cleaned[id] = entry
    }
    const result: Record<string, unknown> = { ...value, pages: cleaned }
    delete result.stage
    delete result.style_theme
    delete result.style_epoch
    return result
  }
  return JSON.stringify(strip(a)) === JSON.stringify(strip(b))
}

/** Renderer-keyed equality rules consumed by the registry and focused smoke. */
export const WEB_APP_DRAFT_COMPARATORS: Readonly<Record<string, (a: unknown, b: unknown) => boolean>> = {
  'io.deepseek.design.web-app.smart-questions/v1': questionsEqual,
  'io.deepseek.design.web-app.function-modules/v1': functionsEqual,
  'io.deepseek.design.web-app.flow-design/v1': flowEqual,
  'io.deepseek.design.web-app.design-style/v1': designStyleEqual,
  'io.deepseek.design.web-app.page-design/v1': pagesEqual,
}
