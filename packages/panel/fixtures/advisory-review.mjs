/**
 * Fixtures for the Advisory Review Card acceptance smoke: pending
 * human-review advisories shaped like the Design-owned review store
 * entries, plus non-rendering controls (accepted/terminal status, next-boundary
 * attention, duplicate id, stale input revision).
 */

/** One pending human-review advisory with an acceptance instruction. */
export const reflectionAdvisory = {
  id: 'advisory-reflection-1',
  profile: 'io.deepseek.design.advisory.reflection/v1',
  kind: 'suggestion',
  attention: 'human-review',
  summary: 'Flow design and business rules disagree about refund approval.',
  items: [
    {
      id: 'item-1',
      title: 'Contradicting refund paths',
      detail: 'flow_design routes refunds through approval; business_rules marks them automatic.',
      rationale: 'Both facets pin the same requirement revision.',
      references: ['design_files/flow_design.json', 'design_files/business_rules.json'],
    },
  ],
  acceptanceInstruction: 'Apply the reflection suggestion: reconcile the refund approval path across flow_design and business_rules.',
}

/** A second pending advisory used for list rendering. */
export const alignmentAdvisory = {
  id: 'advisory-alignment-1',
  profile: 'io.deepseek.design.advisory.alignment/v1',
  kind: 'reminder',
  attention: 'human-review',
  summary: 'Export format preference is still unknown.',
  items: [],
  acceptanceInstruction: 'Ask the user which export format the product should support, using the Kit question flow.',
}

/** Design-owned review entries as the card consumes them. */
export const advisoryEntries = [
  { advisory: reflectionAdvisory, status: 'pending', stale: false },
  { advisory: reflectionAdvisory, status: 'pending', stale: false },
  { advisory: alignmentAdvisory, status: 'pending', stale: false },
  { advisory: { ...alignmentAdvisory, id: 'advisory-accepted-1' }, status: 'accepted', stale: false },
  { advisory: { ...alignmentAdvisory, id: 'advisory-completed-1' }, status: 'completed', stale: false, acceptanceReceiptId: 'receipt-completed' },
  { advisory: { ...reflectionAdvisory, id: 'advisory-boundary-1', attention: 'next-boundary', acceptanceInstruction: undefined }, status: 'pending', stale: false },
  { advisory: { ...reflectionAdvisory, id: 'advisory-stale-1' }, status: 'pending', stale: true },
]
