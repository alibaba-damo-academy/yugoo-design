# Hazard register output contract

Canonical: `hazard_register/hazard_register.json` in this project's Design Files. The executor owns only that canonical state; no external actions or separate artifacts are authorized by this contract. Read the adjacent [synthetic example](example.json) as a shape illustration, never user evidence.

The closed top-level object has required `schema_version` (number 1) and `hazards` (a stable-key map). Every map record is a closed object with exactly these required strings:

| Field | Meaning |
| --- | --- |
| id | Stable identity; equal to the map key. Preserve across renames. |
| label | Short readable title. |
| scenario | Concrete condition and its operational consequence, or explicitly hypothetical condition. |
| response | Bounded response or verification step; text is not execution. |
| certainty | Exactly `observed`, `proposed`, or `unknown`. |
| evidence_note | Source/basis and limits; explicitly identify synthetic material. |

`observed` requires an identifiable factual basis and relevant limits; `proposed` describes an unverified plan; `unknown` identifies unresolved facts and what evidence would settle them. Certainty is not approval or a probability. Schema enforces the exact enum, closed shape and required fields. Completion rules reject empty registers and blank label/scenario/response/evidence notes. Map-key/id equality and evidence quality are semantic checks performed by the executor; they are not claimed as automatic schema checks.

The shared panel generates IDs for additions using `create.id_field: id`, defaults certainty to `unknown`, and edits the remaining five fields. ID is stable identity rather than an editable label. UI translations apply only to labels/descriptions and enum display labels; stored enums, business text, keys and IDs remain unchanged. Save persists through the host's shared canonical Save contract; this Bundle grants no filesystem or external write permissions.

To revise, load saved state and its diff, preserve untouched records and IDs, and reconcile scenario/response/evidence together. Do not repeat a saved change. Validate the complete nonempty state using actual installed schema and completion rules, then hand off using the declared `main` / `must_edit` policy. Summary lists the six scalar fields directly from saved records. No cross-Bundle references or generated files require refreshing.
