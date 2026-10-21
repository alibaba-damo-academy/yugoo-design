---
name: field_operations_shared
version: "0.1"
description: Maintain field-operation scenarios, responses and explicit evidence limits.
---

# Field operations — shared teaching edition

<design_skills>

## hazard_register

Maintain a selectable, editable register of operational hazards, possible responses and evidence notes. Use it for a concrete field scenario or a targeted revision; no preliminary interview is required.

</design_skills>

The audience is a field coordinator reviewing what could disrupt a visit or delivery. The smallest useful loop is one understandable scenario, one bounded response and an honest certainty/evidence statement, edited and saved in the shared panel. This Kit records plans and evidence; it does not dispatch workers, grant access or verify real incidents.

Distinguish an observed fact supported by an identifiable source from a proposed response and an unresolved question. Ask for user-specific evidence when it affects action; use explicit reversible proposals when appropriate. Synthetic examples are teaching material, never operational facts.

The hazard_register Bundle uniquely owns these records. There are no duplicate cross-Bundle facts or required downstream slices. Preserve stable IDs and unaffected records on revision. Read saved edits before continuing; do not replay the saved diff. Recheck whether changed scenarios still fit their response and evidence. This Kit creates no separate artifacts to refresh.

Use the host's existing validation, saving, GRA/KAG and scene capabilities. A scene can illustrate a saved proposal but is not evidence of execution. No external data service or solver is required. UI locale changes labels only and never translate canonical user text, IDs or certainty values. Hand off the saved record change and remaining uncertainty.
