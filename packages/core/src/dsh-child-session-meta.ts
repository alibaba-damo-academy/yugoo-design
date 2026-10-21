/** Metadata for plugin-owned children that do not inherit a seeded transcript. */
import type { Agent } from '@deepseek-ai/dsh-agent'
import { childSessionMeta } from '@deepseek-ai/dsh-subagent'

/**
 * Older hosts take a numeric seed length; newer hosts take an isSeeded boolean.
 * Both plugin callers create fresh, unseeded sessions. Retain the host's own
 * cwd/preset/lineage fields, and normalize only its advertised seeding field.
 * Do not introduce isSeeded into legacy headers, which reject unknown fields.
 */
export function normalizeUnseededChildSessionMeta(
  meta: ReturnType<typeof childSessionMeta>,
): ReturnType<typeof childSessionMeta> {
  if (meta === null || typeof meta !== 'object' || Array.isArray(meta)) {
    throw new Error('design: host child metadata must be an object')
  }
  const fields = meta as unknown as Record<string, unknown>
  if (Object.hasOwn(fields, 'seedLength')) {
    throw new Error('design: unseeded child metadata must not contain seedLength')
  }
  if (!Object.hasOwn(fields, 'isSeeded')) return { ...meta }
  if (fields.isSeeded !== false && fields.isSeeded !== 0) {
    throw new Error('design: host child metadata does not describe an unseeded session')
  }
  const normalized = { ...meta, isSeeded: false }
  return normalized
}

export function designUnseededChildSessionMeta(parent: Agent, depth: number) {
  // Zero is accepted by both implementations at runtime. Normalize the result
  // before it reaches Session validation, rather than guessing a host version.
  // Their declaration files also differ; keep this scalar compatibility bridge
  // local, rather than weakening Agent/create types or casting the whole helper.
  return normalizeUnseededChildSessionMeta(childSessionMeta(
    parent, depth, 0 as unknown as Parameters<typeof childSessionMeta>[2],
  ))
}
