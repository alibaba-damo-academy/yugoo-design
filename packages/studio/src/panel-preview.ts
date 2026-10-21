/** Definition-only Panel preview preparation; never writes or runs a Bundle. */
import { isAbsolute, resolve } from 'node:path'
import { compileSchema, type SchemaSpec, type DesignSkill } from 'dsh-design-core'
import { loadStudioKit, type StudioKitLoadOptions } from './load.ts'
import type { DesignBundleVersionPin, DesignKitVersionPin, StudioDiagnostic, StudioReadFs } from './types.ts'

/** One editor revision and its isolated sample, not a runtime publication. */
export interface StudioPanelPreviewRequest {
  readonly kit: DesignKitVersionPin
  readonly bundle: DesignBundleVersionPin
  readonly revision: number
  readonly panelSource: string
  readonly sampleSource: string
}

/** Runtime-interpreter input derived from a validated draft revision. */
export interface StudioPanelPreview {
  readonly revision: number
  /** Absent only for a real independently loaded Bundle preview. */
  readonly kit?: DesignKitVersionPin
  readonly bundle: DesignBundleVersionPin
  /** Loader-resolved YAML, including the installed Bundle's translations. */
  readonly panelYaml: string
  readonly sample: Readonly<Record<string, unknown>>
}

export interface StudioPanelPreviewResult {
  readonly preview?: StudioPanelPreview
  readonly diagnostics: readonly StudioDiagnostic[]
}

function failure(code: string, message: string): StudioPanelPreviewResult {
  return { diagnostics: [{ code, message }] }
}

/** Shared finalization over a real Core-compiled Bundle, with optional real Kit context. */
export function finalizeStudioPanelPreview(input: {
  readonly compiled: DesignSkill
  readonly bundle: DesignBundleVersionPin
  readonly kit?: DesignKitVersionPin
  readonly revision: number
  readonly sampleSource: string
}): StudioPanelPreviewResult {
  const { compiled, revision, sampleSource } = input
  const bundle = { ...input.bundle }, kit = input.kit === undefined ? undefined : { ...input.kit }
  if (!Number.isSafeInteger(revision) || revision < 0 || typeof sampleSource !== 'string') {
    return failure('preview.request', 'Select an exact Bundle, text sample JSON and a non-negative editor revision.')
  }
  if ((compiled.catalogName ?? compiled.name) !== bundle.name || String(compiled.version) !== bundle.version) {
    return failure('preview.bundle_pin', 'The source does not match the selected Bundle version.')
  }
  const panelYaml = compiled.metadata?.panelYaml
  if (typeof panelYaml !== 'string') return failure('preview.not_declarative', 'Only an existing declarative Panel can be previewed.')
  const schema = compiled.metadata?.schemaDocument as SchemaSpec | undefined
  if (schema === undefined) return failure('preview.definition', 'The loader did not produce a declarative Panel and schema.')
  if (new TextEncoder().encode(sampleSource).length > 262_144) return failure('preview.size', 'Sample JSON is limited to 256 KiB.')
  let sample: unknown
  try { sample = JSON.parse(sampleSource) }
  catch { return failure('preview.sample_json', 'The preview sample must be valid JSON.') }
  if (sample === null || typeof sample !== 'object' || Array.isArray(sample)) return failure('preview.sample_json', 'The preview sample must be a JSON object.')
  try {
    const errors = compileSchema(schema)(sample)
    if (errors.length > 0) return { diagnostics: errors.map(message => ({ code: 'preview.sample_schema', message })) }
    return { preview: { revision, ...(kit === undefined ? {} : { kit }), bundle, panelYaml, sample: sample as Record<string, unknown> }, diagnostics: [] }
  } catch (error) { return failure('preview.definition', error instanceof Error ? error.message : String(error)) }
}

/**
 * Compile one Panel edit against an exact, host-resolved Kit snapshot.
 *
 * The host must supply an immutable/read-confined source port and root for the
 * selected pin, not arbitrary browser paths or a mutable production project.
 * Only panel.yaml is overlaid. All schemas, methods, locales and renderer
 * contracts still come from that snapshot and pass through the runtime loader.
 * The returned sample is fresh JSON and can be edited in a sandboxed preview;
 * this function grants no artifact, filesystem, model or publication authority.
 * A preview consumer must discard a result if its editor revision has changed.
 */
export async function prepareStudioPanelPreview(
  source: StudioReadFs,
  kitRoot: string,
  request: StudioPanelPreviewRequest,
  loadOptions: StudioKitLoadOptions = {},
): Promise<StudioPanelPreviewResult> {
  // Capture caller-owned values before any await; one result belongs to one edit.
  const { panelSource, sampleSource, revision } = request
  const kitPin = { ...request.kit }
  const bundlePin = { ...request.bundle }
  if (!isAbsolute(kitRoot) || !/^[a-z][a-z0-9_]*$/.test(bundlePin.name)
    || !Number.isSafeInteger(revision) || revision < 0
    || typeof panelSource !== 'string' || typeof sampleSource !== 'string') {
    return failure('preview.request', 'Select an exact Bundle and a non-negative editor revision.')
  }
  if (new TextEncoder().encode(panelSource).length > 1_048_576
    || new TextEncoder().encode(sampleSource).length > 262_144) {
    return failure('preview.size', 'Panel source is limited to 1 MiB and sample JSON to 256 KiB.')
  }
  let sample: unknown
  try { sample = JSON.parse(sampleSource) }
  catch { return failure('preview.sample_json', 'The preview sample must be valid JSON.') }
  if (sample === null || typeof sample !== 'object' || Array.isArray(sample)) {
    return failure('preview.sample_json', 'The preview sample must be a JSON object.')
  }
  try {
    const base = await loadStudioKit(source, kitRoot, loadOptions)
    if (base.name !== kitPin.name || String(base.version) !== kitPin.version) {
      return failure('preview.kit_pin', 'The source does not match the selected Kit version.')
    }
    const bundle = base.skills.find(skill => (skill.catalogName ?? skill.name) === bundlePin.name)
    if (bundle === undefined || String(bundle.version) !== bundlePin.version) {
      return failure('preview.bundle_pin', 'The source does not match the selected Bundle version.')
    }
    if (typeof bundle.metadata?.panelYaml !== 'string') {
      return failure('preview.not_declarative', 'Only an existing declarative Panel can be edited in this preview.')
    }
    const panelPath = resolve(bundle.resourceRoot ?? resolve(kitRoot, 'skills', bundle.name), 'panel.yaml')
    const overlay: StudioReadFs = {
      readText: path => resolve(path) === panelPath ? Promise.resolve(panelSource) : source.readText(path),
      ...(source.readResource ? { readResource: (path: string) => resolve(path) === panelPath
        ? Promise.resolve({ kind: 'text' as const, content: panelSource }) : source.readResource!(path) } : {}),
      listDir: path => source.listDir(path),
      ...(source.isDirectory ? { isDirectory: (path: string) => source.isDirectory!(path) } : {}),
      ...(source.realPath ? { realPath: (path: string) => source.realPath!(path) } : {}),
    }
    const candidate = await loadStudioKit(overlay, kitRoot, loadOptions)
    const compiled = candidate.skills.find(skill => (skill.catalogName ?? skill.name) === bundlePin.name)
    if (compiled === undefined) return failure('preview.bundle_pin', 'The source does not match the selected Bundle version.')
    return finalizeStudioPanelPreview({ compiled, revision, kit: kitPin, bundle: bundlePin, sampleSource })
  } catch (error) {
    return failure('preview.definition', error instanceof Error ? error.message : String(error))
  }
}
