# Third-party notices — pilot/design_style skill

Full upstream license texts accompany this notice under `licenses/`:
`impeccable/LICENSE` (Apache-2.0), `taste-skill/LICENSE` (MIT), and
`lucide/LICENSE` (upstream ISC and retained constituent notices).
`licenses/SOURCE.md` records immutable retrieval references. These references
identify the supplied texts; they do not invent the historical revision of
the adapted guidance or icons.

The design-style knowledge and icon bundle is an authored synthesis informed by
the following open-source projects. No third-party exemplar or anti-pattern HTML
is shipped in the active bundle.

## impeccable / Anthropic frontend-design

- Source: <https://github.com/pbakaus/impeccable>
- Upstream source: <https://github.com/anthropics/skills/tree/main/skills/frontend-design>
- License: Apache License 2.0
- Copyright: 2025–2026 Paul Bakaus; 2025 Anthropic, PBC

The compact quality rubric and aesthetic seed guidance draw on their treatment
of color/contrast, typography, spatial rhythm, motion, interaction states, and
common generated-UI failure modes. The material is rewritten for AutoAgent's
canonical state, `DESIGN.md` / `tokens.css` projections, Chinese/Latin font
fallbacks, representative-preview workflow, and runtime-neutral tool boundary.

Apache License 2.0: <https://www.apache.org/licenses/LICENSE-2.0>

## taste-skill

- Source: <https://github.com/leonxlnx/taste-skill>
- License: MIT License
- Copyright: 2026 Leonxlnx

The pre-selection reasoning uses its design variance, motion intensity, and
visual density dials, plus its emphasis on rejecting generic generator reflexes.
React/Next.js/Tailwind-specific machinery and large effect catalogs are not
included.

## Lucide icons

- Source: <https://github.com/lucide-icons/lucide>
- License: ISC License

The SVGs under `assets/icons/` are derived from Lucide and adjusted to the
bundle's naming and sizing conventions.

## Current authored layout

- `reference/aesthetic_index.yaml` is a lightweight pre-selection index.
- `reference/aesthetics/<id>/DESIGN.md` is the maintained seed source.
- each sibling `tokens.css` is deterministically compiled from that seed.
- `reference/quality_rubric.md`, `post_check.md`, and `motion.md` are bounded
  phase-specific guidance.

The previous copied exemplar/anti-pattern HTML and adapted `_base.css` have been
removed from the active bundle; their provenance remains available in Git
history.
