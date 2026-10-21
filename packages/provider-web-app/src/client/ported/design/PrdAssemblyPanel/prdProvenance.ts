import type { PrdAiProvenance } from './prdAssemblyTypes.ts';

/** Counts shown by the permanent PRD provenance legend and active-chapter chip. */
export interface PrdProvenanceCounts {
  pendingAssumptions: number;
  sectionPendingAssumptions: number;
}

/** Count temporary completions, all of which remain pending confirmation. */
export function prdProvenanceCounts(
  provenance: readonly PrdAiProvenance[],
  sectionIds: readonly string[] = []
): PrdProvenanceCounts {
  const pendingIds = new Set(provenance.map(item => item.id));
  const visibleIds = new Set(sectionIds);
  return {
    pendingAssumptions: pendingIds.size,
    sectionPendingAssumptions: [...visibleIds].filter(id => pendingIds.has(id)).length,
  };
}
