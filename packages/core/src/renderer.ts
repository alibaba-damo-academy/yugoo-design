/** Generic Design-state rendering for declarative and runtime-contributed Bundles. */
import { parse } from "yaml"
import type { DesignDriverId, DesignRuntimeDriver } from "./runtime-drivers.ts"
import type { DesignBundleAuthorityId } from "./types.ts"

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}

/** Skill metadata needed by the declarative renderer fallback. */
export interface DesignStateSkill {
  readonly name: string
  /** Trusted Bundle authority used to resolve executable rendering contributions. */
  readonly authority: DesignBundleAuthorityId
  readonly metadata?: Record<string, unknown>
}

/** One scalar field emitted by the shared declarative summary renderer. */
export interface RendererField {
  readonly source: string
  readonly title: string
}

/** One record or scalar collection emitted by the shared declarative renderer. */
export interface RendererCollection extends RendererField {
  readonly order?: string
  readonly title_fields?: readonly string[]
  /** Scalar record fields appended as `path=value` cells. */
  readonly fields?: readonly string[]
  readonly limit?: number
}

/** Machine-readable frontmatter required by a declarative renderer.md. */
export interface DeclarativeRendererManifest {
  readonly version: 1
  readonly renderer: 'pilot-design/v2'
  readonly fields?: readonly RendererField[]
  readonly collections?: readonly RendererCollection[]
}

function nonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.trim() !== ''
}

const UNSAFE_PATH_SEGMENTS = new Set(['__proto__', 'constructor', 'prototype'])

function safeDottedPath(value: unknown): value is string {
  return nonEmptyString(value) && value === value.trim()
    && value.split('.').every((segment) => segment !== '' && segment === segment.trim() && !UNSAFE_PATH_SEGMENTS.has(segment))
}

/** Parse the machine-readable YAML frontmatter of a declarative renderer.md. */
export function parseDeclarativeRendererManifest(text: string): DeclarativeRendererManifest {
  if (!text.startsWith('---')) throw new Error('renderer.md: declarative renderer requires YAML frontmatter')
  const frontmatter = text.match(/^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/)
  if (frontmatter === null) throw new Error('renderer.md: unterminated YAML frontmatter')
  const value = parse(frontmatter[1] as string)
  if (!isRecord(value)) throw new Error('renderer.md invalid:\n- frontmatter must be an object')
  return validateRendererManifest(value, 'renderer.md')
}

/** Compile the optional skill.yaml summary without author-facing runtime constants. */
export function parseDeclarativeSummary(value: unknown): DeclarativeRendererManifest {
  if (!isRecord(value)) throw new Error('skill.yaml summary must be an object')
  for (const key of Object.keys(value)) {
    if (key !== 'fields' && key !== 'collections') throw new Error(`skill.yaml summary: unknown key ${JSON.stringify(key)}`)
  }
  return validateRendererManifest({ ...value, version: 1, renderer: 'pilot-design/v2' }, 'skill.yaml summary')
}

function validateRendererManifest(value: Record<string, unknown>, source: string): DeclarativeRendererManifest {
  const manifest = value
  const errors: string[] = []
  if (manifest.version !== 1) errors.push(`unsupported version ${String(manifest.version)}`)
  if (manifest.renderer !== 'pilot-design/v2') errors.push(`unknown renderer ${JSON.stringify(manifest.renderer)}`)
  const checkFields = (value: unknown, key: 'fields' | 'collections'): void => {
    if (value === undefined) return
    if (!Array.isArray(value)) {
      errors.push(`${key} must be a list`)
      return
    }
    value.forEach((raw, index) => {
      if (!isRecord(raw) || !safeDottedPath(raw.source) || !nonEmptyString(raw.title)) {
        errors.push(`${key}[${index}] needs a safe dotted source and non-empty title`)
        return
      }
      if (key === 'collections') {
        if (raw.order !== undefined && !safeDottedPath(raw.order)) errors.push(`${key}[${index}].order must be a safe dotted path`)
        if (raw.title_fields !== undefined && (!Array.isArray(raw.title_fields) || raw.title_fields.length === 0 || raw.title_fields.some((entry) => !safeDottedPath(entry)))) {
          errors.push(`${key}[${index}].title_fields must be a safe dotted path list`)
        }
        if (raw.fields !== undefined && (!Array.isArray(raw.fields) || raw.fields.length === 0 || raw.fields.some((entry) => !safeDottedPath(entry)))) {
          errors.push(`${key}[${index}].fields must be a safe dotted path list`)
        }
        if (raw.limit !== undefined && (!Number.isInteger(raw.limit) || Number(raw.limit) <= 0 || Number(raw.limit) > 100)) {
          errors.push(`${key}[${index}].limit must be an integer from 1 to 100`)
        }
      }
    })
  }
  checkFields(manifest.fields, 'fields')
  checkFields(manifest.collections, 'collections')
  const entryCount = (Array.isArray(manifest.fields) ? manifest.fields.length : 0)
    + (Array.isArray(manifest.collections) ? manifest.collections.length : 0)
  if (entryCount === 0) {
    errors.push('at least one fields or collections entry is required')
  }
  if (errors.length > 0) throw new Error(`${source} invalid:\n- ${errors.join('\n- ')}`)
  return manifest as unknown as DeclarativeRendererManifest
}

function recordTitle(id: string, value: Record<string, unknown>, titleFields: readonly string[]): string {
  for (const key of titleFields) {
    const candidate = valueAt(value, key)
    const text = printable(candidate)
    if (text !== '') return text
  }
  return id
}

function valueAt(root: Record<string, unknown>, path: string): unknown {
  let current: unknown = root
  for (const segment of path.split('.')) {
    if (!isRecord(current)) return undefined
    if (UNSAFE_PATH_SEGMENTS.has(segment) || !Object.hasOwn(current, segment)) return undefined
    current = current[segment]
  }
  return current
}

function printable(value: unknown): string {
  if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') return safeCell(String(value))
  if (value === null) return 'null'
  return ''
}

function safeCell(value: string): string {
  const line = value.replace(/\s+/g, ' ').trim()
  return line.length <= 240 ? line : `${line.slice(0, 237)}...`
}

/**
 * Render a content-authored skill without adding a skill-specific core dispatch.
 * The projection follows the shared upstream renderer and uses panel sections
 * as the authoritative record collections for a declarative Bundle.
 * @param state - persisted Design File value.
 * @param skill - loaded Bundle metadata.
 * @returns compact model-facing summary lines.
 */
export function renderDeclarativeState(state: Record<string, unknown>, skill: DesignStateSkill): string[] {
  const lines: string[] = []
  const manifest = skill.metadata?.rendererManifest as DeclarativeRendererManifest | undefined
  if (manifest === undefined) return lines
  for (const field of manifest.fields ?? []) {
    const value = valueAt(state, field.source)
    if (value !== undefined && printable(value) !== '') lines.push(`- ${field.title}: ${printable(value)}`)
  }
  for (const collection of manifest.collections ?? []) {
    const value = valueAt(state, collection.source)
    const rawEntries = isRecord(value)
      ? Object.entries(value)
      : Array.isArray(value) ? value.map((entry, index) => [String(index), entry] as const) : []
    if (rawEntries.length === 0) {
      if (value !== undefined && !isRecord(value) && !Array.isArray(value)) lines.push(`- ${collection.title}: ${printable(value)}`)
      continue
    }
    const byId = new Map(rawEntries)
    const orderValue = collection.order === undefined ? undefined : valueAt(state, collection.order)
    const requestedIds = Array.isArray(orderValue) ? orderValue.map(String) : []
    const orderedIds = [...new Set([...requestedIds.filter((id) => byId.has(id)), ...rawEntries.map(([id]) => id)])]
    lines.push(`- ${collection.title}: ${rawEntries.length}`)
    for (const id of orderedIds.slice(0, Math.min(collection.limit ?? 20, 100))) {
      const record = byId.get(id)
      if (record === undefined) continue
      const label = isRecord(record)
        ? recordTitle(id, record, collection.title_fields ?? ['title', 'name', 'label', 'summary'])
        : printable(record)
      const cells = isRecord(record)
        ? (collection.fields ?? []).flatMap((field) => {
          const value = printable(valueAt(record, field))
          return value === '' ? [] : [`${field}=${value}`]
        })
        : []
      lines.push(`  - ${id}: ${label}${cells.length === 0 ? '' : ` | ${cells.join(' | ')}`}`)
    }
  }
  return lines
}

/**
 * Render bounded top-level facts for a Bundle without an interactive panel.
 * @param state - persisted Design File value.
 * @returns deterministic model-facing summary lines.
 */
export function renderGenericState(state: Record<string, unknown>): string[] {
  return Object.entries(state).sort(([left], [right]) => left.localeCompare(right)).slice(0, 50).flatMap(([key, value]) => {
    const label = safeCell(key)
    const scalar = printable(value)
    if (scalar !== '') return [`- ${label}: ${scalar}`]
    if (Array.isArray(value)) return [`- ${label}: ${value.length} items`]
    if (isRecord(value)) return [`- ${label}: ${Object.keys(value).length} records`]
    return []
  })
}

function runtimeDriver(skill: DesignStateSkill): DesignDriverId | undefined {
  const manifest = skill.metadata?.skillManifest
  const runtime = isRecord(manifest) && isRecord(manifest.runtime) ? manifest.runtime : undefined
  return typeof runtime?.driver === 'string' ? runtime.driver as DesignDriverId : undefined
}

function presentationMode(skill: DesignStateSkill): 'native' | 'declarative' | 'auto' | 'none' {
  const manifest = skill.metadata?.skillManifest
  const presentation = isRecord(manifest) && isRecord(manifest.presentation) ? manifest.presentation : undefined
  if (presentation?.mode === 'native' || presentation?.mode === 'declarative' || presentation?.mode === 'auto' || presentation?.mode === 'none') {
    return presentation.mode
  }
  throw new Error(`design state: skill ${JSON.stringify(skill.name)} has no valid presentation mode`)
}

/** One skill's latest state as read from the Design Files store. */
export interface DesignStateInput {
  /** Skill name (must match a kit skill). */
  skill: string
  /** The skill's persisted state (undefined when absent). */
  state: unknown
}

/**
 * Assemble the full design_state document for the active kit.
 * @param skills - the kit's skills in display order (skill.yaml `order`).
 * @param states - each skill's persisted state.
 * @param resolveRuntime - trusted runtime resolver for Bundles that declare server behavior.
 * @returns the joined `<design_state>` markdown; empty string hides the section.
 */
export function assembleDesignState(
  skills: readonly DesignStateSkill[],
  states: readonly DesignStateInput[],
  resolveRuntime?: (skill: DesignStateSkill, id: DesignDriverId) => DesignRuntimeDriver,
): string {
  const bySkill = new Map(states.map((input) => [input.skill, input.state]))
  const sections: string[] = []
  for (const skill of skills) {
    const state = bySkill.get(skill.name)
    if (!isRecord(state)) continue
    const mode = presentationMode(skill)
    const driverId = runtimeDriver(skill)
    if (driverId !== undefined && resolveRuntime === undefined) {
      throw new Error(`design state: runtime driver ${JSON.stringify(driverId)} for ${JSON.stringify(skill.name)} has no trusted resolver`)
    }
    const lines = driverId !== undefined
      ? [...(resolveRuntime as (skill: DesignStateSkill, id: DesignDriverId) => DesignRuntimeDriver)(skill, driverId).renderState(state, skill)]
      : mode === 'declarative' ? renderDeclarativeState(state, skill) : renderGenericState(state)
    if (lines.length === 0) continue
    sections.push(`### ${skill.name}\n${lines.join('\n')}`)
  }
  return sections.join('\n')
}
