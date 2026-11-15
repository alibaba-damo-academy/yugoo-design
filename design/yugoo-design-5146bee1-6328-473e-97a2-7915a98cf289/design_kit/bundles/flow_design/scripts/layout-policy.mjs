// Shared production default. Explicit environment overrides are reserved for
// isolated comparison/debug runs; no host-specific settings are required.
export function layoutPolicy(env=process.env) {
  const reading=env.BPMN_LAYOUT_READING!=='0';
  const preference=env.BPMN_LAYOUT_PREFERENCE||'balanced';
  if(reading&&!['alignment','balanced','routing'].includes(preference))throw new Error(`Unknown reading preference: ${preference}`);
  return {reading,preference,channels:env.BPMN_LAYOUT_CHANNELS==='1'||(reading&&env.BPMN_LAYOUT_CHANNELS!=='0'),
    boundedSearch:reading||env.BPMN_LAYOUT_EXPERIMENT_BUDGET==='1',report:env.BPMN_LAYOUT_READING_REPORT==='1'};
}
