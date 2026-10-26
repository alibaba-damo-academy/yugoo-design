/**
 * dsh-design-core — the Design System capability seam for dsh.
 *
 * Service package: default-exports the `DesignService` class, which the Loader
 * mounts as `ctx.design`. The seam carries plugin-owned conversation bindings,
 * project-pinned Mindsets, the Bundle catalog, design-state context, Design
 * discovery and execution, and the validation.yaml rule engine. Bundle
 * SKILL.md bodies remain internal inputs to `run_design_skill` execution.
 */
export {
  default,
  type DesignServiceConfig,
  type DesignWorkspaceChange,
  type DesignWorkspaceChangeListener,
  type DesignAdvisoryActionClaimRequest,
  type DesignAdvisoryActionClaimResult,
} from './design-service.ts'
export { DESIGN_CORE_CLARITY_RUBRIC_PROMPT, DESIGN_CORE_PROGRESSION_PROMPT, renderDesignSkillCatalog } from './design-core-prompt.ts'
export { designFileToolDenial, type DesignFileToolPolicyInput } from './design-file-tool-policy.ts'
export { GitVersioning, GitBlobSizeLimitError, collectGitStdout, type GitCommitReceipt, type GitHistoryEntry, type SpawnFn } from './git.ts'
export { readDesignGit, designGitReadArguments, DESIGN_GIT_READ_ACTIONS, DESIGN_GIT_READ_DESCRIPTION,
  type DesignGitReadArguments, type DesignGitReadPorts } from './design-git-read.ts'
export {
  DESIGN_FILES_UNBORN_REVISION,
  DesignWriteSettlementError,
  DesignFilesStore,
  type DesignWriteEvent,
  type DesignWriteOptions,
  type DesignWriteResult,
  type DesignPublishedExecution,
  type FsLike,
  type SchemaValidator,
  type SchemaValidation,
} from './design-files.ts'
export {
  resolveConfinedFilePath,
  readConfinedText,
  writeConfinedText,
  type ConfinedTextFs,
} from './confined-fs.ts'
export { compileSchema, parseSchemaYaml, validatorFromSchemaYaml, type SchemaSpec } from './schema.ts'
export { diagnoseKnowledgeDeclarations, type KnowledgeDeclarationDiagnostic } from './knowledge-declaration-diagnostics.ts'
export { designProjectRecordsRoot, DESIGN_PROJECT_RECORDS_DIRECTORY, isDesignProjectAuxiliaryPath } from './design-project-record-paths.ts'
export { commitDesignProjectRecords } from './design-project-records.ts'
export {
  DESIGN_KNOWLEDGE_RECORDS_PATH,
  DESIGN_KNOWLEDGE_RECORDS_MAX_BYTES,
  DESIGN_KNOWLEDGE_RECORDS_CACHE_KEY,
  readDesignKnowledgeRecords,
  saveDesignKnowledgeRecords,
  restoreDesignKnowledgeRecords,
  type DesignKnowledgeProjectRecords,
} from './design-knowledge-records.ts'
export { resolveAutoPanel, assertResolvedAutoPanelSave, retainResolvedAutoPanel } from './auto-panel-resolution.ts'
export { autoPanelGenerationPrompt, publishAutoPanelComponents } from './auto-panel-generation.ts'
export {
  validateSkillDesign,
  type DesignValidationScope,
  type DesignValidationCandidate,
  type ValidationIssue,
  type ValidateDesignOptions,
} from './validate-design.ts'
export {
  publishDesignWorkingCopy,
  validateDesignWorkingCopy,
  type DesignCompletionFinalizer,
  type DesignWorkingCopyPublication,
  type DesignWorkingCopyValidation,
  type DesignIntegrationValidator,
  type DesignValidationPhases,
  type DesignWorkerCandidateValidator,
} from './design-validation-phases.ts'
export {
  createProducerProjectWorkspace,
  ProducerWorkingCopyValidationError,
  ProducerProjectWorkspace,
  type ProducerBundleWorkingCopy,
  type ProducerCanonicalPublishedMatch,
  type ProducerProjectWorkspaceOptions,
  type ProducerProjectWorkspaceStore,
  type ProducerPublicationMode,
  type ProducerPublicationReceipt,
} from './producer-project-workspace.ts'
export {
  createDshProducerSkillAgentRuntime,
  runDshProducerAgent,
  type DshProducerAgentReceipt,
  type DshProducerAgentRequest,
  type DshProducerSkillAgentRuntime,
} from './dsh-producer-agent.ts'
export {
  assertSafeDesignProducerInheritedTools,
  registerDshProducerDesignTools,
  type DesignProducerFinishReceipt,
  type DesignProducerArtifactActivityPort,
  type DesignProducerPauseHandoff,
  type DesignProducerSkillResourcePort,
  type DesignProducerToolController,
  type ProducerProjectEditReceipt,
  type ProducerProjectFile,
  type ProducerProjectPublicationMode,
  type ProducerProjectPublicationReceipt,
  type ProducerProjectRestorePreview,
  type ProducerProjectWorkspacePort,
} from './dsh-producer-design-tools.ts'
export {
  createDshDesignDelegation,
  DESIGN_DELEGATE_TOOL,
  DESIGN_DELEGATE_FRONTIER_TOOL,
  type DshDesignDelegationOptions,
  type DshProducerDesignDelegation,
} from './dsh-producer-delegation.ts'
export { parseDesignChange, parseKitSelection, type DesignJournalValue, type DesignKitPin } from './design-journal-payloads.ts'
export {
  DESIGN_CLARITY_TEXT_LIMITS,
  parseDesignClarityInput,
  designClarityDigest,
  designClarityInputMatches,
  type DesignClarityInputIdentity,
  parseDesignClarityReported,
} from './design-clarity-report.ts'
export { DESIGN_CLARITY_OUTPUT_SCHEMA } from './design-clarity-schema.ts'
export { designClarityScopeDigest, renderDesignClarityKitContext, renderDesignClarityUserContext } from './design-clarity-context.ts'
export { currentAdvisoryEntries, resolveMaxSuggestions, DEFAULT_MAX_SUGGESTIONS } from './advisory-inbox-policy.ts'
export {
  DESIGN_CLARITY_AUTHORITY_FILE,
  DESIGN_CLARITY_AUTHORITY_SCHEMA_VERSION,
  parseDesignClarityAuthority,
  readDesignClarityAuthority,
  writeDesignClarityAuthority,
  type DesignClarityAuthority,
} from './design-clarity-authority.ts'
export {
  deriveDesignContinuation,
  deriveDesignMustEditHandoff,
  type DesignContinuationAliases,
  type DesignContinuationDerivationInput,
  type DesignContinuationDescriptor,
  type DesignContinuationLabel,
  type DesignMustEditHandoffDescriptor,
} from './design-continuation.ts'
export { parseValidationYaml, evaluateValidationRules, type ValidationDoc, type ValidationRule, type ValidationEnv } from './validation-rules.ts'
export { applyPanelEdit, buildPanelSaveNote, parsePanelArtifacts, type PanelEdit, type PanelSaveResult } from './panel-save.ts'
export { projectWorktreeDesign, type WorktreeProjection } from './panel-worktree.ts'
export {
  DESIGN_PROJECT_FORMAT_VERSION,
  DesignKnowledgeProviderId,
  DesignProjectId,
  DesignProjectManager,
  nodeDesignProjectFs,
  nodeDesignProjectSpawn,
  parseDesignProjectJson,
  parseDesignProjectMetadata,
  type CreateDesignProjectInput,
  type DesignProject,
  type DesignProjectDependencies,
  type DesignProjectFs,
  type DesignProjectKitPin,
  type DesignProjectKnowledgePin,
  type DesignProjectMetadata,
  type DesignProjectStatus,
} from './design-project.ts'
export { defaultDesignProjectsRoot } from './design-project-paths.ts'
export {
  DESIGN_PROJECT_REGISTRY_VERSION,
  DesignProjectRegistry,
  type MigratedDesignProject,
  type DesignProjectReconstructionSource,
  type DesignProjectMigrationBasis,
  type DesignProjectMigrationSource,
  type DesignProjectRegistryOptions,
  type DesignProjectRegistrySnapshot,
  type RegisteredDesignProject,
  type RegisteredDesignProjectStatus,
} from './design-project-registry.ts'
export {
  CONVERSATION_DESIGN_BINDING_SCHEMA_VERSION,
  ConversationDesignBindingRevisionMismatchError,
  ConversationDesignBindingStore,
  DesignConversationId,
  DesignHostInstanceId,
  DesignHostKind,
  conversationDesignBindingKey,
  type ConversationDesignBinding,
  type ConversationDesignBindingKey,
  type ConversationDesignBindingStoreOptions,
} from './conversation-design-binding-store.ts'
export {
  GroundAssertionId,
  GroundAssertionParseError,
  findGroundAssertionConflicts,
  groundAssertionCandidateDigest,
  groundAssertionClaimDigest,
  parseGroundAssertion,
  parseGroundAssertionCandidate,
  parseTrustedGroundAssertionDocument,
  projectLegacyGround,
  promoteGroundAssertionCandidate,
  retainGroundAssertionCandidate,
  validateGroundAssertionSet,
  verifyTrustedGroundAuthorityEvent,
  type GroundAssertion,
  type GroundAssertionAuthority,
  type GroundAssertionCandidate,
  type GroundAssertionConflict,
  type GroundAssertionDocument,
  type GroundAssertionKind,
  type GroundAssertionLifecycle,
  type GroundAuthorityEvidenceRef,
  type GroundDelegationPolicyScope,
  type GroundJsonValue,
  type GroundLegacyProjection,
  type GroundProducedByRef,
  type GroundSemanticClaim,
  type GroundSourceAnchor,
  type GroundVerifiedAuthorityEvidence,
} from './ground-assertions.ts'
export {
  ACCEPTED_ASSERTION_SCHEMA_VERSION,
  AcceptedAssertionCheckpointMismatchError,
  AcceptedAssertionLockReleaseError,
  AcceptedAssertionLockTimeoutError,
  AcceptedAssertionProjectMismatchError,
  AcceptedAssertionRepository,
  AcceptedAssertionStaleRevisionError,
  type AcceptedAssertionEntry,
  type AcceptedAssertionOrigin,
  type AcceptedAssertionPin,
  type AcceptedAssertionRead,
  type AcceptedAssertionRecord,
  type AcceptedAssertionRepositoryLimits,
  type AcceptedPromotionRecord,
  type AcceptedRetentionRecord,
  type AssertionMappingProvenance,
  type PromotionDecision,
  type PromotionDisposition,
} from './accepted-assertions.ts'
export {
  impactAdvisoryKnowledge,
  readAdvisoryDesignKnowledge,
  sameAdvisoryDesignKnowledge,
  traceAdvisoryKnowledge,
  type AdvisoryDesignKnowledge,
  type AdvisoryKnowledgeReadPort,
  type AdvisoryKnowledgeSelection,
} from './advisory-knowledge.ts'
export {
  GroundingPinMismatchError,
  KIT_GROUNDING_DECLARATION_SCHEMA_VERSION,
  compileKitGrounding,
  parseKitGroundingDeclaration,
  projectBundleGroundCandidates,
  requireGroundingPinMatch,
  type AssertionMapping,
  type BundleGroundProjection,
  type BundleGroundingDeclaration,
  type BundleGroundingProjectionInput,
  type CompiledBundleGrounding,
  type CompiledKitGrounding,
  type EntityCondition,
  type EntityMapping,
  type GroundRelation,
  type GroundRelationshipCandidate,
  type GroundRelationshipTarget,
  type KitGroundingAssertionKind,
  type KitGroundingDeclaration,
  type ProjectedGroundAssertion,
  type RelationshipMapping,
} from './kit-grounding-mapping.ts'
export {
  projectDesignGraph,
  type DesignGraphEdge,
  type DesignGraphNode,
  type DesignGraphNodeDomain,
  type DesignGraphProjection,
  type DesignGraphProjectionInput,
  type RationalePromotionReference,
} from './design-graph-projection.ts'
export {
  DesignKnowledgeEntityId,
  DesignKnowledgeCheckpointConflictError,
  DesignKnowledgeMutationId,
  DesignKnowledgeMutationConflictError,
  DesignKnowledgeProposalId,
  DesignKnowledgeProposalDigest,
  DesignKnowledgeRelationId,
  DesignKnowledgeRevision,
  DesignKnowledgeRevisionConflictError,
  assertDesignKnowledgeDecisionAuthority,
  designKnowledgeProposalDigest,
  type DesignKnowledgeArchive,
  type DesignKnowledgeArchivedProposal,
  type DesignKnowledgeDecision,
  type DesignKnowledgeDelta,
  type DesignKnowledgeDeltaEntity,
  type DesignKnowledgeDeltaRelation,
  type DesignKnowledgeEntity,
  type DesignKnowledgeEvidence,
  type DesignKnowledgeImpactRequest,
  type DesignKnowledgeImportReport,
  type DesignKnowledgeLifecycle,
  type DesignKnowledgeMutationResult,
  type DesignKnowledgePin,
  type DesignKnowledgeProposal,
  type DesignKnowledgeProposalBatch,
  type DesignKnowledgeProposalBatchResult,
  type DesignKnowledgeProvenance,
  type DesignKnowledgeProposalReceipt,
  type DesignKnowledgeProposedEntity,
  type DesignKnowledgeProposedRelation,
  type DesignKnowledgeQuery,
  type DesignKnowledgeQueryResult,
  type DesignKnowledgeRelation,
  type DesignKnowledgeService,
  type DesignKnowledgeTraceRequest,
  type DesignKnowledgeTraceResult,
  type DesignKnowledgeValue,
} from './design-knowledge.ts'
export { projectDesignKnowledgeDecisions } from './design-knowledge-journal.ts'
export { DesignKnowledgeDecisionJournal } from './design-knowledge-decision-journal.ts'
export {
  materializeDesignKnowledgeJournal,
  type DesignKnowledgeMaterializationResult,
} from './design-knowledge-materializer.ts'
export {
  DesignKnowledgeLeaseId,
  DesignKnowledgeManager,
  type DesignKnowledgeAdministration,
  type DesignKnowledgeProjectLocation,
} from './design-knowledge-manager.ts'
export {
  DesignProjectKnowledgeLifecycle,
  type DesignProjectKnowledgeLifecycleOptions,
  type DesignProjectKnowledgeMaterializer,
  type DesignProjectKnowledgeRuntime,
} from './design-project-knowledge-lifecycle.ts'
export {
  parseDesignCommand,
  runDesignProjectCommand,
  type DesignConversationSelection,
  type DesignProjectCommandContext,
  type DesignProjectCommandResult,
  type DesignProjectConversationPort,
  type DesignProjectInvocation,
  type DesignProjectMigrationRecord,
  type DesignProjectSelectionLifecycle,
  type DesignProjectSelectionPreparation,
  type DesignProjectPort,
  type DesignProjectPortStatus,
  type DesignProjectRecord,
  type DesignProjectSnapshot,
  type DesignProjectVerb,
} from './design-project-adapter.ts'
export {
  DesignAdvisoryId,
  DesignAdvisoryProfileId,
  parseDesignAdvisory,
  renderDesignAdvisoryReminder,
  deliverDesignAdvisory,
  type DesignAdvisory,
  type DesignAdvisoryV1,
  type DesignAdvisoryV2,
  type DesignAdvisoryActionSpec,
  type DesignAdvisoryBundleActionTarget,
  type DesignAdvisoryItem,
  type DesignAdvisoryInputPin,
  type DesignAdvisoryDecision,
  type AdvisoryDeliveryPort,
  type HumanAttentionPort,
} from './design-advisory.ts'
export {
  DSH_ADVISORY_DELIVERY,
  publishDshDesignAdvisory,
  renderDshDesignAdvisorySetReminder,
  type AdvisoryPublishPort,
} from './dsh-advisory.ts'
export {
  UNAVAILABLE_ADVISORY_RUNTIME_STATUS,
  type DesignAdvisoryRuntimePhase,
  type DesignAdvisoryRuntimeStatus,
  type DesignAdvisoryRuntimeStatusProvider,
} from './advisory-runtime-status.ts'
export {
  analyzeDshDesignAdvisory,
  runDshDesignAdvisory,
  type AdvisorySubagentPort,
  type DshAdvisoryAnalysisOutcome,
  type DshAdvisoryRunRequest,
  type DshAdvisoryRunOutcome,
} from './dsh-advisory-runner.ts'
export {
  parseDesignAdvisoryDecision,
  parseSessionDesignAdvisories,
  applyAdvisoryInboxEvent,
  deriveAdvisoryStaleness,
  DESIGN_ADVISORY_SOURCE_KIND,
  type DesignAdvisoryCurrency,
  type DesignAdvisoryDecisionPayload,
  type SessionDesignAdvisory,
} from './design-advisory-events.ts'
export {
  DESIGN_JOURNAL_SCHEMA_VERSION,
  parseDesignJournalFact,
  parseDesignJournalRecord,
  parseDesignJournalExecutionHandoffConsumption,
  parseDesignAdvisoryActionTarget,
  parseDesignJournalAdvisoryActionEntry,
  parseDesignJournalAdvisorySelection,
  type DesignAdvisorySelectionKind,
  type DesignJournalAdvisorySelection,
  type DesignJournalAdvisorySelectionEntry,
  deriveAdvisoryExecutionStatus,
  applyDesignJournalRecord,
  foldDesignJournal,
  parseAdvisoryReviewCompletion,
  type DesignJournalFact,
  type DesignJournalRecord,
  type DesignJournalAdvisoryDecision,
  type DesignJournalAdvisoryEntry,
  type DesignAdvisoryActionState,
  type DesignAdvisoryExecutionAggregate,
  type DesignAdvisoryActionTarget,
  type DesignJournalAdvisoryActionReceipt,
  type DesignJournalAdvisoryAccepted,
  type DesignJournalAdvisoryActionAttempt,
  type DesignJournalAdvisoryActionEntry,
  type DesignJournalExecutionHandoffConsumption,
  type DesignJournalKnowledgeDecision,
  type DesignJournalKnowledgeDecisionEntry,
  type DesignJournalClarityEntry,
  type DesignJournalChangeEntry,
  type DesignJournalAdvisoryReviewCompletion,
  type DesignJournalAdvisoryReviewCompletionEntry,
  type DesignJournalSnapshot,
} from './design-journal.ts'
export { DesignExecutionHandoffJournal } from './design-execution-handoff-journal.ts'
export { pendingMustEditAuthority, pendingMustEditAuthorityForSave, type PendingMustEditAuthority } from './design-execution-handoff-authority.ts'
export {
  deriveDesignKnowledgeStatus,
  deriveReviewStatuses,
  hasDueReview,
  renderDesignKnowledgeStatusReminder,
  type DesignKnowledgeState,
  type DesignKnowledgeRunPhase,
  type DesignKnowledgeLatestComplete,
  type DesignKnowledgeRecoveryStatus,
  type DesignKnowledgeFailure,
  type DesignKnowledgeStatusSnapshot,
  type DesignKnowledgeStatusInput,
  type DesignReviewFreshness,
  type DesignAdvisoryProfileRuntimeStatus,
  type DesignReviewProfileStatusSnapshot,
  type DesignReviewJournalFacts,
  type DesignOrchestrationResult,
  type DesignOrchestrationTarget,
} from './design-knowledge-status.ts'
export { registerKnowledgeOrchestrationTools } from './dsh-knowledge-orchestration-tools.ts'
export {
  DESIGN_KNOWLEDGE_FAILURE_KEY,
  readDesignKnowledgeFailure,
  writeDesignKnowledgeFailure,
  clearDesignKnowledgeFailure,
  type DesignKnowledgeFailureRecord,
} from './design-knowledge-refresh.ts'
export {
  DesignJournalStorage,
  type DesignJournalStorageLimits,
  type DesignJournalRead,
  type DesignJournalMutation,
  type DesignJournalMutator,
  type DesignJournalSubscriber,
} from './design-journal-storage.ts'
export {
  DesignAdvisoryJournal,
  type ResolvedDesignAdvisoryAction,
  type DesignAdvisorySelectionRequest,
  type DesignAdvisoryActionClaim,
} from './design-advisory-journal.ts'
export {
  DesignJournalRegistry,
  type DesignJournalRootResolver,
  type DesignAdvisoryJournalListener,
  type DesignJournalRegistrySubscriber,
} from './design-journal-registry.ts'
export {
  loadDesignKit,
  loadDesignBundle,
  composeDesignKitBundles,
  resolveDesignKitPackage,
  createDirectoryBundleResolver,
  parseKitMounts,
  type DesignBundleContent,
  type DesignBundlePin,
  type DesignBundleMount,
  type DesignKitLocation,
  type DesignKitLoadOptions,
  parseDesignExecutionPolicy,
  parseFrontmatter,
  parseMindsetSkillNames,
  type KitFsLike,
  type KitResourceContent,
} from './kit-loader.ts'
export { DesignContentStore, contentNodeFs } from './content-store.ts'
export { composeProjectKit, projectBundleOverrides, projectKitContentHash, sameProjectContentPin,
  compareContentVersions, latestInstalledKit, groupContentVersions } from './project-content.ts'
export { ProjectContentTransaction, assertProjectContentSettled,
  type ProjectContentAdoptionReceipt, type ProjectContentTransactionOptions } from './project-content-transaction.ts'
export { ProjectContentMigration, type NativeContentMigrationEvidence, type ProjectContentMigrationPorts } from './project-content-migration.ts'
export {
  parsePanelManifest,
  validatePanelManifest,
  PANEL_KINDS,
  COMPONENT_KINDS,
  CONTROL_KINDS,
  ROW_COLUMN_CONTROLS,
  SIDEBAR_ICONS,
  type SidebarIcon,
  type PanelKind,
  type ComponentKind,
  type ControlKind,
  type RowColumnControl,
  type PanelSectionRef,
  type FieldOption,
  type RowColumn,
  type PanelSection,
  type FormField,
  type FormRow,
  type FormGroup,
  type FormTabs,
  type EditorField,
  type ComponentNode,
  type PanelManifest,
} from './panel-dsl.ts'
export { skillAlias } from './skill-names.ts'
export { registerDesignStateContext } from './prompt.ts'
export { registerServiceTools, requireKitSkill } from './service-tools.ts'
export {
  assembleDesignState,
  renderGenericState,
  parseDeclarativeRendererManifest,
  renderDeclarativeState,
  type DesignStateSkill,
  type DeclarativeRendererManifest,
  type RendererCollection,
  type RendererField,
} from './renderer.ts'
export {
  DesignDriverId,
  DesignBundleContributionRegistry,
  type DesignRuntimeContext,
  type DesignProducerContribution,
  type DesignProducerToolObservation,
  type DesignProducerEvidenceRecord,
  type DesignProducerPublicationContext,
  type DesignProducerPublicationSources,
  type DesignProducerPublicationSnapshot,
  type PreparedDesignWrite,
  type PreparedDesignProducerPublication,
  type DesignRuntimeSkill,
  type DesignRuntimeDriver,
  type DesignValidationDriver,
  type DesignRuntimeContribution,
  type DesignValidationContribution,
  type DesignBundleContribution,
  type DesignBundleContributionIds,
} from './runtime-drivers.ts'
export {
  continueAfterDesignPanelEdit,
  DesignExecutionInvocationId,
  engageDesignExecution,
  resolveDesignExecutionInput,
  resumeDesignExecution,
  type DesignExecutionGate,
  type DesignExecutionInputResolution,
  type DesignExecutionPin,
  type DesignExecutionProducerInput,
  type DesignExecutionProducerPort,
  type DesignExecutionProducerRequest,
  type DesignExecutionProducerRunMode,
  type DesignExecutionProducerSettlement,
  type DesignPublicationFollowUp,
  type DesignExecutionRuntimePorts,
  type DesignExecutionSelection,
  type DesignExecutionTransition,
  type ResumeDesignExecutionCommand,
} from './design-execution-runtime.ts'
export {
  createDesignArtifactAttemptRegistry,
  type DesignArtifactAttemptRegistry,
} from './artifact-attempt-registry.ts'
export {
  deriveCurrentDesignExecutionGate,
  deriveDesignExecutionGate,
  type DesignExecutionAuthorityRecord,
  type DesignExecutionDerivationInput,
  type DesignExecutionStatePin,
} from './design-execution-derivation.ts'
export { designSchemaToObjectJsonSchema } from './design-schema-json.ts'
export {
  apply as registerRunDesignSkillTool,
  type RunDesignSkillPort,
  type RunDesignSkillResult,
} from './dsh-run-design-skill-tool.ts'
export {
  DesignSemanticCapabilityId,
  DESIGN_QUESTION_ROUND_CAPABILITY,
  semanticCapabilitiesOf,
  capabilityBinding,
  resolveSemanticCapability,
  type DesignCapabilityBinding,
} from './semantic-capabilities.ts'
export {
  reviewSupportOf,
  reviewCandidates,
  parseReviewSupport,
  type DesignReviewSupportProfile,
} from './review-support.ts'
export {
  OFFICIAL_GROUNDING_PROFILE,
  OFFICIAL_REFLECTION_PROFILE,
  OFFICIAL_ALIGNMENT_PROFILE,
  OFFICIAL_ADVISORY_PROFILES,
  officialAdvisoryProfile,
  type OfficialAdvisoryProfileId,
  type OfficialAdvisoryInput,
  type OfficialAdvisoryProfile,
  type GroundingProfileOutput,
  type ReflectionProfileOutput,
  type AlignmentProfileOutput,
} from './official-advisory-profiles.ts'
export {
  buildPinnedDesignArtifactInput,
  landedDesignArtifactSourceNames,
  publishTrustedDesignArtifacts,
  revalidateDesignArtifactDependencies,
  type DesignArtifactDependency,
  type DesignArtifactDependencyManifest,
  type DesignArtifactInputLimits,
  type DesignArtifactPublicationLimits,
  type PinnedDesignArtifactSource,
  type PreparedDesignArtifactInput,
  type TrustedDesignArtifactWrite,
} from './design-artifact-publication.ts'
export {
  DesignBundleVersion,
  deriveDesignBundleAuthorityId,
  DesignKitVersion,
  DesignResumeActionId,
  type DesignBilingualText,
  type DesignChangedPayload,
  type DesignClarityAssessment,
  type DesignClarityExplanation,
  type DesignClarityActivity,
  type DesignClarityDigest,
  type DesignClarityDimensionInput,
  type DesignClarityInput,
  type DesignClarityReportedPayload,
  type DesignClarityScores,
  type DesignExecutionPolicy,
  type DesignBundleAuthorityId,
  type DesignKit,
  type DesignKitSelectedPayload,
  type DesignResumeAction,
  type DesignSimpleHandoff,
  type DesignSkill,
} from './types.ts'
export type { SavedDesignAssessmentRequest, SavedDesignAssessmentAdmission } from './design-clarity-runtime.ts'
export {
  DESIGN_LOCALE_CONTEXT_CHARACTERS,
  designText,
  latestDirectHumanText,
  resolveConversationLocale,
  type DesignLocale,
} from './design-locale.ts'
export { reconstructionKnowledge } from './reconstruction-knowledge.ts'
export { DESIGN_ONTOLOGY_SCHEMA_VERSION, compileDesignOntologyContract, designOntologyCoverage, designOntologySchemaPointers,
  indexDesignOntologySchema, resolveDesignOntologyType,
  type CompiledDesignOntologyContract, type DesignOntologyTypeDefinition, type DesignOntologyPropertyShape,
  type DesignOntologyActionDefinition, type DesignOntologyIdentityPolicy, type DesignKnowledgeRecordKind,
  type DesignIdentityQuality, type DesignOntologyCoverage } from './design-ontology.ts'
export { materializeDesignFilesKnowledge } from './design-knowledge-projection.ts'
export { readCompleteDesignKnowledge } from './design-knowledge-snapshot.ts'
export { knowledgeSemanticInput, publishKnowledgeSemantic, storedKnowledgeGraph } from './design-knowledge-semantic.ts'
export {
  refreshDesignKnowledge,
  readDesignKnowledgePublication,
  readPublishedDesignKnowledge,
  advanceDesignKnowledgePublication,
  DESIGN_KNOWLEDGE_PUBLICATION_KEY,
  type DesignKnowledgeRefreshOptions,
  type DesignKnowledgePublication,
  type KnowledgeIndexCache,
} from './design-knowledge-refresh.ts'
export { DesignKnowledgeIndex } from './design-knowledge-index.ts'
export { KnowledgeReadProgress } from './knowledge-read-progress.ts'
export { readSourceDesignKnowledge } from './design-knowledge-projection.ts'
export { queryKnowledgeSnapshot, knowledgeQueryFilters, knowledgeReadResult, KNOWLEDGE_AGENTIC_GUIDANCE, type KnowledgeReadArguments, type KnowledgeReadResult } from './design-knowledge-query.ts'
export { DESIGN_EXECUTOR_EVIDENCE_GUIDANCE, DESIGN_WORKER_EVIDENCE_GUIDANCE, availableDesignKnowledgeTools } from './design-generation-guidance.ts'
export { knowledgeRelationReading, type KnowledgeRelationReading } from './design-knowledge-reading.ts'
export { CORE_DESIGN_RELATIONS, DESIGN_RELATION_VOCABULARY_SCHEMA_VERSION, compileDesignRelationVocabulary, designRelationEndpointIssue, parsePinnedDesignRelation, resolveDesignRelation, renderDesignRelationVocabulary,
  type CompiledDesignRelationVocabulary, type DesignRelationClassification, type DesignRelationDefinition, type DesignRelationDirection, type ResolvedDesignRelation } from './design-relation-vocabulary.ts'
export { knowledgeReviewSchema, knowledgeReviewGuidance, splitKnowledgeReviewResult, publishKnowledgeReview, KNOWLEDGE_REVIEW_GUIDANCE, type KnowledgeReviewObservation } from './design-knowledge-review.ts'
export { registerReconstructionKnowledgeTool } from './dsh-reconstruction-knowledge-tool.ts'
export * from './design-semantic.ts'
export type { DesignGraph, DesignGraphEdge as DesignFieldGraphEdge } from './design-graph.ts'
export { DEFAULT_DESIGN_REVIEW_POLICY, parseDesignReviewPolicy, readDesignReviewPolicy, writeDesignReviewPolicy, DesignReviewPublicationQueue, DesignContinuousReviewClock } from './design-review-policy.ts'
export { renderAdvisoryReviewMemory } from './advisory-review-memory.ts'
export { workspacePollResult, type WorkspacePollResult } from './workspace-poll.ts'
export type { DesignReviewMode, DesignReviewPolicy } from './design-review-policy.ts'
export { ProjectContentPanelGuard } from './project-content-guard.ts'
export { recordProjectContentAdoption } from './project-content-journal.ts'
export { ProjectContentCandidate } from './project-content-candidate.ts'
export { migrationDefinitionReadPlan } from './project-content-definition.ts'
