---
name: hazard_register
description: Maintain field-operation scenarios, bounded responses and explicit evidence limits in an editable hazard register.
---

# Hazard register

Use for a concrete field scenario, a hazard review or a targeted record change. It does not establish dispatch instructions, access permissions, compliance decisions or proof that a response was executed.

Read [the output contract](reference/artifact-contract.md) and [the synthetic example](reference/example.json) through the current Bundle's resource reader. Bundle-relative resource paths are `reference/artifact-contract.md` and `reference/example.json`; use the actual host-provided resource interface. These are resources, not project files or source-checkout paths.

The sole canonical file is `hazard_register/hazard_register.json` in the active Design Files. Read its complete current state before authoring; read relevant user evidence and saved diff before continuation. The main executor owns this file only. No Worker or generated artifact is needed.

For a first generation, identify the field activity, what could go wrong and the practical scope of a response. Use the two explicitly synthetic examples only when the user requests examples; never silently introduce them as their operating conditions. For each record, separate the scenario from the response, then state certainty and the actual basis in the evidence note. A proposal can be useful without being observed. An unknown restriction should say what needs checking and propose a bounded verification step without claiming permission. Ask only for evidence that would materially change the current response. Do not infer observation from a detailed scenario or a filled form.

Write complete state matching the contract. Use stable map keys equal to each record's id. Keep labels short and distinguish scenarios by meaning. Preserve IDs, unrelated records, user wording and certainty unless the request/evidence warrants a change. Locale changes must never rewrite any state. On a saved scenario edit, reconsider its response and note; do not replay the saved edit or change another owner. There are no artifacts to regenerate.

Use the host's supplied WorkingCopy validation/publication operations when available. DSH exposes `design_validate` and `design_publish({action:"complete"})`; other hosts must use their actual adapter contract, not invented tools. Repair diagnostics in this same working copy before publication. Completion requires a nonempty register and meaningful label, scenario, response and evidence note. The panel uses the shared selection, create and Save paths and `must_edit` handoff. Hand it back for review and editing according to the host's handoff lifecycle; a published proposal does not prove a user saved it or a response occurred.

Report records changed, evidence/uncertainty and actual validation/publication evidence. Explicitly distinguish static validation, saved user edits and real-world verification. Preserve unsupported unknowns rather than manufacturing certainty.
