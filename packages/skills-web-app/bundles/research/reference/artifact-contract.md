# Research output contract

Shared by evidence gathering and restoration of existing research material. The installed schema and validation are authoritative; a repository with no research material does not require a new research round just for reconstruction. Preserve observations, interpretations and evidence limits; never invent sources or measurements.

## Files and binding

Canonical state: `research/research.json`. Findings: `research/{round_id}/{direction_id}-{title}.md`, referenced by that direction's `findings_file`. Conclusion: `research/{round_id}/conclusion.html`, referenced by that round's `conclusion_file`. No inline report HTML/Markdown in JSON. Preserve settled rounds and exact source URLs. The round stage describes the plan decision, not attempt state.

Use `artifact_kind: "research_direction"`, round-scoped `artifact_id: "{round_id}/{direction_id}"` and the exact findings file for delegation or serial focus. Conclusion focus uses `research_conclusion`, round ID and the exact conclusion file. Each author writes/repairs its artifact; the Producer reads findings for actual synthesis, updates the corresponding refs and sources, then validates and publishes the integrated round. A reference is accepted only after the file exists. There is no separate research script; use the ordinary Bundle validation.

## Findings Markdown

User-facing report, not a raw JSON payload:

- **Evidence-led presentation**: use a table for useful comparisons, a diagram for a meaningful relationship, or prose for a qualitative finding. No visual quota. Embed a source figure `![alt](absolute URL)` only when an opened source contains a genuinely relevant chart/diagram, not decoration.
- **TRUSTED SOURCES FIRST**: official sites, industry/analyst reports, established media, academic papers, gov/standards bodies, Statista-grade data. Avoid SEO farms, random forums, content mills.
- **Depth**: answer the research points without padding to a length or finding count. Every factual claim carries a verifiable inline Markdown source link; distinguish the report's interpretation from the cited observation.
- **Structure** (required sections, in this order — exactly ONE `# H1` heading):
  - `# {direction.title}`
  - `## 调研概述` — ≤ 150 characters, single paragraph overview
  - `## 核心发现` — titled findings explaining the observation, supporting source links, design implication and relevant limits. Place an illustrative figure with the finding it supports, not in a standalone gallery.
  - `## 关键数据` — retain this section for evidence summaries: real quantitative data when available, otherwise qualitative comparisons or an explicit quantitative evidence gap. A table is useful for comparable dimensions, not mandatory. Never invent statistics or replace missing measurement with an unsupported score.
  - `## 信息来源` — one line per cited source in the form
    `- [标题](https://full-url)`. Use exact genuine source URLs from the evidence; invented references are not permitted.
    Fewer real sources beats a padded list.
  - `## 调研结论` — concise synthesis of what the evidence supports, its applicability to the current question, and what remains unresolved
- **Completion signal**: report ends with the `## 调研结论` section


## Conclusion HTML

**Document shape:**
- Full `<!DOCTYPE html>` … `<html><head><meta charset><style>…</style></head><body>…</body></html>`. ALL CSS inline in one `<style>`. No external CSS/JS/fonts, no `<script>`, no network deps. Self-contained so it renders in a sandboxed iframe. Before publication, the executor rereads `conclusion.html` and checks these document requirements, including complete tag structure and the absence of Markdown code fences; repair truncated, fence-wrapped or unbalanced content in the same owned artifact before publishing. This is an Agent review duty: `design_validate` enforces the installed schema and declared rules, which do not inspect HTML structure, and this Bundle provides no HTML validator script. A renderable preview or successful structural validation does not establish that these document requirements were met.
- **Responsive, not fixed-width** — it renders in a narrow side-panel iframe (~600px). Fluid container (`max-width:960px` + `width:100%`), grids via `repeat(auto-fit,minmax(...))` so KPI/insight cards reflow (4→2→1); fluid type via `clamp()` (e.g. hero number `clamp(22px,5vw,32px)`). Add a `@media(max-width:700px)` that stacks multi-col grids to 1. Never hard-pin 4 columns + 32px text — it overflows the panel.
- Generous spacing, restrained palette (1 accent like #663AE8 + neutrals), modern sans, clear hierarchy. Rounded cards, soft borders, section dividers.
- **Font-size floor** — all normal text (titles, body, notes, captions, AND chart text: axis labels, ticks, legends) stays **12–16px**; never below 12px. Larger sizes ONLY for PPT-style graphic numerals (KPI hero numbers, big callout figures).

**Choose the presentation from the evidence.** Start with a title and the
question explored; present the useful findings, design implications and limits.
For quantitative evidence, use readable stat tiles or inline SVG charts where
comparison helps; keep units and context. For qualitative research, use concise
explanations, scenario comparisons or relationship diagrams. No required KPI,
chart, card count or prose-area ratio. Do not disguise qualitative judgments as
measured scores. Keep meaningful tradeoffs readable rather than compressing away
their conditions. Numbers and sources come only from accepted findings; expose
missing or conflicting evidence and distinguish recommendations from decisions.
