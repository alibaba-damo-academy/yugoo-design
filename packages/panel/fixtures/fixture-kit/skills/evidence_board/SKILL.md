---
name: evidence_board
description: |-
  - **Capability**: domain-neutral evidence records exercising the full declarative control set (text/textarea/number/select/radio/toggle/multi_select/record_select/record_multi_select/list/source_list/key_value/artifact_ref/rows), generic record lifecycle, and the residue envelope.
  - **Resolves**: declarative-basis acceptance gaps — control↔schema typing, record create/delete/reorder, residue add-region bootstrap, save/restore round trips.
  - **Candidate when**: the harness needs a product-domain-free kit to prove discovery, validation, injection, rendering, and persistence of pure-content bundles.
  - **Do not infer**: any product semantics — names and labels are placeholders by design.
  - **Output**: `evidence_board` panel — record form plus rowview workbench; no native renderer.
---

# Evidence Board

Fixture skill for the declarative basis acceptance. The panel is fully
declarative (panel.yaml); no native renderer is declared. Record ids are
non-integer-like strings so map insertion order survives JSON round-trips.
