/** Strict browser Remote descriptor for global read-only Studio management. */
import { z } from 'zod'
import type {
  StudioKitView, StudioBundleView, StudioWorkspaceView,
  StudioBundleMountView, StudioKitWorkspaceView, StudioBundleWorkspaceView,
} from 'dsh-design-studio'

/** Strict factory contract; the Host requires a parser, not a validator library. */
export interface StudioStrictCodec {
  readonly mode: 'strict'
  readonly typeSymbol: string
  readonly create: () => { parse(value: unknown): unknown }
}

/** Runtime descriptor fields consumed by DSH's Remote registry and page transport. */
export interface StudioRemoteDescriptor {
  readonly id: string
  readonly service: string
  readonly namespace: string
  readonly method: string
  readonly invocation: { readonly kind: 'direct' }
  readonly scope?: never
  readonly parameters: readonly {
    readonly name: string
    readonly wire: string
    readonly source: 'json'
    readonly acceptsUndefined?: true
    readonly codec: StudioStrictCodec
  }[]
  readonly result: StudioStrictCodec
}

/** Browser/Host contribution without leaking the validator library's types. */
export interface StudioRemoteContribution {
  readonly package: string
  readonly descriptors: readonly StudioRemoteDescriptor[]
}

const pin = z.object({ name: z.string(), version: z.string() }).strict()
const diagnostic = z.object({ code: z.string(), message: z.string(), subject: z.string().optional() }).strict()
const relationText = z.object({ zh: z.string(), en: z.string() }).strict()
// Check every owning read-model key, including optional copy, at compile time.
// Keep strict unknown-field rejection and the existing versioned wire behavior.
const kitView = z.object({
  name: z.string(), version: z.string(), description: z.string().optional(),
  displayDescription: relationText.optional(),
} satisfies Record<keyof StudioKitView, z.ZodType>).strict()
const bundleView = pin.extend({
  description: z.string(), title: relationText.optional(), displayDescription: relationText.optional(), usedBy: z.array(kitView),
} satisfies Record<Exclude<keyof StudioBundleView, 'name' | 'version'>, z.ZodType>).strict()
const workspace = z.object({
  query: z.string(), kits: z.array(kitView), bundles: z.array(bundleView),
} satisfies Record<keyof StudioWorkspaceView, z.ZodType>).strict()
const mountView = pin.extend({
  description: z.string(), title: relationText.optional(), displayDescription: relationText.optional(), mountedBy: z.array(kitView),
} satisfies Record<Exclude<keyof StudioBundleMountView, 'name' | 'version'>, z.ZodType>).strict()
const resourceView = z.object({ path: z.string(), bytes: z.number().int().nonnegative() }).strict()
const relationView = z.object({
  type: z.string(), meaning: z.string(), direction: z.enum(['forward', 'symmetric']), label: relationText, description: relationText,
  domain: z.array(z.string()).optional(), range: z.array(z.string()).optional(), inverse: z.string().optional(),
  cardinality: z.object({ from: z.enum(['one', 'many']), to: z.enum(['one', 'many']) }).strict().optional(),
  reasoning: z.object({ impact: z.boolean().optional(), causal: z.boolean().optional(), transitive: z.boolean().optional() }).strict().optional(),
  evidence: z.object({ minimum: z.enum(['explicit', 'inferred']) }).strict().optional(),
}).strict()
const relationVocabularyView = z.object({ schemaVersion: z.literal(1), pin: z.string(), relations: z.array(relationView) }).strict()
const kitWorkspaceView = z.object({
  name: z.string(),
  version: z.string(),
  description: z.string(),
  displayDescription: relationText.optional(),
  mindsetSource: z.string(),
  mounts: z.array(mountView),
  resources: z.array(resourceView),
  // Older DSH hosts legitimately omit this newly added read-only projection.
  // Keep the wire contract permissive and normalize it at the browser adapter
  // boundary so the shared Studio UI still receives its current shape.
  relationVocabulary: relationVocabularyView.optional(),
} satisfies Record<keyof StudioKitWorkspaceView, z.ZodType>).strict()
const kitWorkspaceResult = z.object({ workspace: kitWorkspaceView.optional(), diagnostics: z.array(diagnostic) }).strict()
const kitFilesResult = z.array(z.string())
const kitFileResult = z.object({ content: z.string() }).strict()
const bundleFileRef = z.object({ path: z.string(), bytes: z.number().int().nonnegative() }).strict()
const bundlePanelView = z.object({ kind: z.enum(['native', 'declarative']), renderer: z.string().optional() }).strict()
const bundleValidationSummary = z.object({ rules: z.number().int().nonnegative(), drivers: z.array(z.string()) }).strict()
const bundleWorkspaceView = z.object({
  name: z.string(),
  version: z.string(),
  kit: z.string().optional(),
  description: z.string(),
  displayDescription: relationText.optional(),
  files: z.array(bundleFileRef),
  manifest: z.record(z.string(), z.unknown()).optional(),
  schema: z.record(z.string(), z.unknown()).optional(),
  validation: bundleValidationSummary.optional(),
  panel: bundlePanelView.optional(),
} satisfies Record<keyof StudioBundleWorkspaceView, z.ZodType>).strict()
const bundleWorkspaceResult = z.object({ workspace: bundleWorkspaceView.optional(), diagnostics: z.array(diagnostic) }).strict()
const bundleFileView = z.object({ path: z.string(), content: z.string() }).strict()
const bundleFileResult = z.object({ file: bundleFileView.optional(), diagnostics: z.array(diagnostic) }).strict()

const direct = { kind: 'direct' as const }
const json = (name: string, schema: z.ZodType, acceptsUndefined = false) => ({
  name, wire: name, source: 'json' as const,
  ...(acceptsUndefined ? { acceptsUndefined: true as const } : {}),
  codec: { mode: 'strict' as const, typeSymbol: `dsh-design-studio-dsh#${name}`, create: () => schema },
})
const result = (name: string, schema: z.ZodType) => ({ mode: 'strict' as const, typeSymbol: `dsh-design-studio-dsh#${name}`, create: () => schema })

/** The `studioManagement` namespace contribution mounted by the browser adapter. */
export const TYPERT_REMOTE: StudioRemoteContribution = {
  package: 'dsh-design-studio-dsh',
  descriptors: [
    {
      id: 'dsh-design-studio-dsh#studioManagement/workspace', service: 'studioManagement', namespace: 'studioManagement', method: 'workspace',
      invocation: direct, parameters: [json('query', z.string())], result: result('workspaceResult', workspace),
    },
    {
      id: 'dsh-design-studio-dsh#studioManagement/readKitWorkspace', service: 'studioManagement', namespace: 'studioManagement', method: 'readKitWorkspace',
      invocation: direct, parameters: [json('name', z.string()), json('version', z.string())], result: result('readKitWorkspaceResult', kitWorkspaceResult),
    },
    {
      id: 'dsh-design-studio-dsh#studioManagement/readKitFiles', service: 'studioManagement', namespace: 'studioManagement', method: 'readKitFiles',
      invocation: direct, parameters: [json('name', z.string()), json('version', z.string())], result: result('readKitFilesResult', kitFilesResult),
    },
    {
      id: 'dsh-design-studio-dsh#studioManagement/readKitFile', service: 'studioManagement', namespace: 'studioManagement', method: 'readKitFile',
      invocation: direct, parameters: [json('name', z.string()), json('version', z.string()), json('path', z.string())], result: result('readKitFileResult', kitFileResult),
    },
    {
      id: 'dsh-design-studio-dsh#studioManagement/readBundleWorkspace', service: 'studioManagement', namespace: 'studioManagement', method: 'readBundleWorkspace',
      invocation: direct, parameters: [json('name', z.string()), json('version', z.string().optional(), true)], result: result('readBundleWorkspaceResult', bundleWorkspaceResult),
    },
    {
      id: 'dsh-design-studio-dsh#studioManagement/readBundleFile', service: 'studioManagement', namespace: 'studioManagement', method: 'readBundleFile',
      invocation: direct, parameters: [json('name', z.string()), json('path', z.string()), json('version', z.string().optional(), true)], result: result('readBundleFileResult', bundleFileResult),
    },
  ],
}

export default TYPERT_REMOTE
