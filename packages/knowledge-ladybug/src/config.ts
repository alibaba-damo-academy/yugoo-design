import { isAbsolute, resolve } from 'node:path'

/** Deployment inputs for the private embedded Ladybug provider. */
export interface LadybugKnowledgeConfigInput {
  readonly databaseRoot: string
  readonly writerAttempts?: number
  readonly writerRetryMs?: number
  readonly projectLockRetries?: number
  readonly projectLockMinTimeoutMs?: number
  readonly projectLockStaleMs?: number
  readonly maxQueryLimit?: number
  readonly maxFilterValues?: number
  readonly maxTextBytes?: number
  readonly maxImpactDepth?: number
  readonly maxImpactSeeds?: number
  readonly maxArchiveRecords?: number
}

/** Fully validated deployment values used by the provider. */
export interface LadybugKnowledgeConfig {
  readonly databaseRoot: string
  readonly writerAttempts: number
  readonly writerRetryMs: number
  readonly projectLockRetries: number
  readonly projectLockMinTimeoutMs: number
  readonly projectLockStaleMs: number
  readonly maxQueryLimit: number
  readonly maxFilterValues: number
  readonly maxTextBytes: number
  readonly maxImpactDepth: number
  readonly maxImpactSeeds: number
  readonly maxArchiveRecords: number
}

function natural(value: number, name: string, allowZero = false): number {
  if (!Number.isSafeInteger(value) || value < (allowZero ? 0 : 1)) throw new TypeError(`Ladybug knowledge ${name} must be ${allowZero ? 'a non-negative' : 'a positive'} integer`)
  return value
}

/** Validate and resolve provider configuration before opening durable state. */
export function resolveLadybugKnowledgeConfig(input: LadybugKnowledgeConfigInput): LadybugKnowledgeConfig {
  if (input.databaseRoot.trim() === '') throw new TypeError('Ladybug knowledge databaseRoot must not be empty')
  const databaseRoot = isAbsolute(input.databaseRoot) ? input.databaseRoot : resolve(input.databaseRoot)
  const writerAttempts = natural(input.writerAttempts ?? 16, 'writerAttempts')
  const writerRetryMs = natural(input.writerRetryMs ?? 5, 'writerRetryMs', true)
  const projectLockRetries = natural(input.projectLockRetries ?? 8, 'projectLockRetries', true)
  const projectLockMinTimeoutMs = natural(input.projectLockMinTimeoutMs ?? 25, 'projectLockMinTimeoutMs')
  const projectLockStaleMs = natural(input.projectLockStaleMs ?? 10_000, 'projectLockStaleMs')
  const maxQueryLimit = natural(input.maxQueryLimit ?? 1_000, 'maxQueryLimit')
  const maxFilterValues = natural(input.maxFilterValues ?? 64, 'maxFilterValues')
  const maxTextBytes = natural(input.maxTextBytes ?? 16_384, 'maxTextBytes')
  const maxImpactDepth = natural(input.maxImpactDepth ?? 8, 'maxImpactDepth', true)
  const maxImpactSeeds = natural(input.maxImpactSeeds ?? 128, 'maxImpactSeeds')
  const maxArchiveRecords = natural(input.maxArchiveRecords ?? 100_000, 'maxArchiveRecords')
  if (projectLockStaleMs < 2_000) throw new TypeError('Ladybug knowledge projectLockStaleMs must be at least 2000')
  return Object.freeze({ databaseRoot, writerAttempts, writerRetryMs, projectLockRetries, projectLockMinTimeoutMs, projectLockStaleMs, maxQueryLimit, maxFilterValues, maxTextBytes, maxImpactDepth, maxImpactSeeds, maxArchiveRecords })
}
