/** Host-neutral validation phases owned by one complete Design Producer. */

/** Pure, repeatable validation of one worker candidate. */
export interface DesignWorkerCandidateValidator<TCandidate = unknown> {
  /**
   * Validate one candidate without persistence effects.
   * @param candidate - candidate submitted by the delegated worker.
   * @returns actionable diagnostics; empty accepts the candidate.
   */
  validate(candidate: TCandidate): readonly string[] | Promise<readonly string[]>
}

/** Pure, repeatable validation of one integrated Producer working copy. */
export interface DesignIntegrationValidator<TWorkingCopy = unknown, TContext = unknown> {
  /**
   * Validate a complete working copy against the supplied pinned context.
   * @param workingCopy - complete Producer working copy.
   * @param context - validation context selected by the Producer.
   * @returns actionable diagnostics; empty accepts the working copy.
   */
  validate(workingCopy: TWorkingCopy, context: TContext): readonly string[] | Promise<readonly string[]>
}

/** Trusted publication preparation, completion validation, and atomic commit. */
export interface DesignCompletionFinalizer<
  TWorkingCopy = unknown,
  TContext = unknown,
  TPrepared = TWorkingCopy,
  TReceipt = unknown,
> {
  /**
   * Materialize canonical state, deterministic artifacts, and host-owned fields.
   * This operation is pure and runs after integration validation.
   * @param workingCopy - complete Producer-authored working copy.
   * @param context - authoritative context pinned immediately before publication.
   * @returns the exact write that completion validation and commit will consume.
   */
  prepare(workingCopy: TWorkingCopy, context: TContext): TPrepared | Promise<TPrepared>
  /**
   * Validate the prepared canonical write against authoritative publish-time state.
   * @param prepared - trusted materialized write returned by `prepare`.
   * @param context - authoritative context pinned immediately before publication.
   * @returns actionable diagnostics; empty accepts the prepared write.
   */
  validate(prepared: TPrepared, context: TContext): readonly string[] | Promise<readonly string[]>
  /**
   * Recheck authoritative pins and atomically publish the accepted prepared write.
   * @param prepared - write accepted by completion validation.
   * @param context - authoritative publish-time context.
   * @returns host-owned publication receipt.
   */
  finalize(prepared: TPrepared, context: TContext): TReceipt | Promise<TReceipt>
}

/** Bundle-provided validation and publication hooks, independent of execution topology. */
export interface DesignValidationPhases<
  TCandidate = unknown,
  TWorkingCopy = unknown,
  TContext = unknown,
  TPrepared = TWorkingCopy,
  TReceipt = unknown,
> {
  readonly workerCandidate?: DesignWorkerCandidateValidator<TCandidate>
  readonly integration?: DesignIntegrationValidator<TWorkingCopy, TContext>
  readonly completion: DesignCompletionFinalizer<TWorkingCopy, TContext, TPrepared, TReceipt>
}

/** Result of a repeatable validation checkpoint. */
export type DesignWorkingCopyValidation =
  | { readonly kind: 'accepted' }
  | {
      readonly kind: 'rejected'
      readonly phase: 'integration' | 'completion'
      readonly diagnostics: readonly string[]
    }

/** Result of authoritative working-copy publication. */
export type DesignWorkingCopyPublication<TReceipt> =
  | { readonly kind: 'published'; readonly receipt: TReceipt }
  | Extract<DesignWorkingCopyValidation, { readonly kind: 'rejected' }>

function normalizedDiagnostics(diagnostics: readonly string[]): readonly string[] {
  return Object.freeze(diagnostics.map(diagnostic => diagnostic.trim()).filter(diagnostic => diagnostic !== ''))
}

async function validateIntegration<TWorkingCopy, TContext>(
  integration: DesignIntegrationValidator<TWorkingCopy, TContext> | undefined,
  workingCopy: TWorkingCopy,
  context: TContext,
): Promise<DesignWorkingCopyValidation> {
  if (integration === undefined) return Object.freeze({ kind: 'accepted' })
  const diagnostics = normalizedDiagnostics(await integration.validate(workingCopy, context))
  return diagnostics.length === 0
    ? Object.freeze({ kind: 'accepted' })
    : Object.freeze({ kind: 'rejected', phase: 'integration', diagnostics })
}

/**
 * Validate an integrated working copy without publication effects. Calls are repeatable.
 * @param phases - Bundle-provided validation phases.
 * @param workingCopy - complete Producer working copy.
 * @param context - current working-copy validation context.
 * @returns acceptance or integration diagnostics.
 */
export function validateDesignWorkingCopy<TWorkingCopy, TContext>(
  phases: Pick<DesignValidationPhases<unknown, TWorkingCopy, TContext, unknown, unknown>, 'integration'>,
  workingCopy: TWorkingCopy,
  context: TContext,
): Promise<DesignWorkingCopyValidation> {
  return validateIntegration(phases.integration, workingCopy, context)
}

/**
 * Revalidate a working copy against authoritative state and publish it atomically.
 * Integration validation always runs again at this boundary, followed by the
 * completion validator. The finalizer runs only after both accept.
 * @param phases - Bundle-provided validation and finalization phases.
 * @param workingCopy - complete Producer working copy.
 * @param context - authoritative publish-time context.
 * @returns a publication receipt or the rejecting validation phase.
 */
export async function publishDesignWorkingCopy<TWorkingCopy, TContext, TPrepared, TReceipt>(
  phases: DesignValidationPhases<unknown, TWorkingCopy, TContext, TPrepared, TReceipt>,
  workingCopy: TWorkingCopy,
  context: TContext,
): Promise<DesignWorkingCopyPublication<TReceipt>> {
  const integration = await validateIntegration(phases.integration, workingCopy, context)
  if (integration.kind === 'rejected') return integration
  const prepared = await phases.completion.prepare(workingCopy, context)
  const diagnostics = normalizedDiagnostics(await phases.completion.validate(prepared, context))
  if (diagnostics.length > 0) {
    return Object.freeze({ kind: 'rejected', phase: 'completion', diagnostics })
  }
  return Object.freeze({ kind: 'published', receipt: await phases.completion.finalize(prepared, context) })
}
