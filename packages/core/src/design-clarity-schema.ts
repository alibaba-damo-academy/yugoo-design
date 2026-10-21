/** Same compact model output schema for native and DSH clarity evaluators. */
const dimension = Object.freeze({ type: 'object', additionalProperties: false,
  required: ['score', 'evidence'], properties: { score: { type: 'integer' }, evidence: { type: 'string' } } })
export const DESIGN_CLARITY_OUTPUT_SCHEMA = Object.freeze({
  type: 'object', additionalProperties: false, required: ['summary', 'u', 's', 't'],
  properties: { summary: { type: 'string' }, u: dimension, s: dimension, t: dimension, nextGap: { type: 'string' } },
})
