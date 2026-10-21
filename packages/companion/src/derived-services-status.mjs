/** Read models only. Existing Core authorities and mutation guards remain owners.
 * Host adapters supply observations, never their own UST/KAG/GRA policies.
 * No model, maintenance, review launch, persistence, retry or admission occurs here.
 */
export function derivedServicesStatus({ projectId, checkpoint, clarity, mainContext,
  knowledge, reviewPolicy, hostCapabilities, reviewDispatchOwner, reviews }) {
  const input = mainContext?.input
  const mainAvailable = mainContext?.available === true && input?.projectId === projectId
    && input.assessedCheckpoint === checkpoint
  const mainReason = mainContext?.available === true && !mainAvailable
    ? 'Design input changed while reading service status; read the latest context.'
    : mainContext?.error
  // Currentness and project/Kit/Design input come from the same capture.
  // Conversation intent is assessed by the Agent, not authenticated here.
  const current = mainAvailable ? mainContext.clarity : undefined
  const score = current?.assessment ?? clarity?.assessment ?? null
  const reassess = !mainAvailable || current?.needsReassessment !== false
  const executionAvailable = hostCapabilities?.backgroundReviews === true
  return {
    schemaVersion: 1, projectId, checkpoint,
    ust: {
      // A last accepted score may remain visible while reporting is unavailable;
      // it must not be promoted to a current score without current input pins.
      state: !mainAvailable ? 'unavailable' : score === null ? 'unknown' : reassess ? 'due' : 'current',
      assessment: score,
      explanation: current?.assessment ?? clarity?.explanation ?? null,
      needsReassessment: reassess,
      reporting: { available: mainAvailable,
        ...(mainAvailable ? { input } : { reasonCode: mainContext?.reasonCode ?? 'project-context-unavailable',
          ...(mainReason ? { reason: mainReason } : {}) }) },
    },
    // Preserve the shared publication-derived vocabulary, including failures,
    // warnings, last-good revision and enabled-vs-computed semantic distinction.
    kag: knowledge?.project === projectId ? knowledge
      : { state: 'unavailable', reasonCode: 'knowledge-status-unavailable',
        ...(knowledge?.error ? { reason: knowledge.error } : {}) },
    gra: {
      policy: reviewPolicy,
      execution: {
        available: executionAvailable,
        readiness: hostCapabilities?.backgroundReviewReadiness ?? (executionAvailable ? 'ready' : 'unverified'),
        mode: hostCapabilities?.backgroundReviewExecutionMode ?? (executionAvailable ? 'cooperative-background' : 'unavailable'),
        ...(hostCapabilities?.backgroundReviewObservedMode ? { observedMode: hostCapabilities.backgroundReviewObservedMode } : {}),
        ...(hostCapabilities?.backgroundReviewReasonCode ? { reasonCode: hostCapabilities.backgroundReviewReasonCode } : {}),
        ...(hostCapabilities?.backgroundReviewReason ? { reason: hostCapabilities.backgroundReviewReason } : {}),
        ...(hostCapabilities?.backgroundReviewDiagnostics ? { diagnostics: hostCapabilities.backgroundReviewDiagnostics } : {}),
      },
      // Capability, policy, request preparation and a verified running child are
      // separate facts. A ready adapter with policy off dispatches nothing.
      dispatchAllowed: executionAvailable && ['auto', 'continuous', 'every-publication'].includes(reviewPolicy?.mode),
      dispatchOwner: reviewDispatchOwner,
      reviews: reviews ?? [],
    },
  }
}
