---
name: fixture_basis
version: "1.0"
description: >
  Domain-neutral calibration fixture for the declarative panel basis. It
  exists to exercise discovery, validation, injection, rendering, and
  save/restore without any product domain semantics.
---

# Fixture Basis Mindset

<design_skills>

This catalog is the domain-neutral acceptance fixture for the declarative
basis. Choose only from these installed names; the selected Bundle's
`SKILL.md` is loaded on demand.

## evidence_board

Typed evidence records exercising every declarative control, the generic
record lifecycle, and the residue envelope (read-only aggregation plus an
exclusive editable region).

## ref_board

Cross-panel record references resolved against evidence_board through
`options_from_panel`, with safe degradation when the source is absent.

</design_skills>
