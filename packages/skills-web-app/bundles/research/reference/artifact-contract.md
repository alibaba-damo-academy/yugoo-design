# Research output contract

## Record IDs

For new rounds prefer `R-001`, `R-002`, and so on; new directions prefer `D-001`, `D-002`, within their round. Delegation still uses the actual `round_id/direction_id`; a title change does not rename an existing artifact.

Existing IDs, including older formats, remain valid: keep them and their exact references when renaming, reordering, restoring or revising. Names and titles remain readable content, separate from identity.

Shared by evidence gathering and restoration of existing research material. The installed schema and validation are authoritative; a repository with no research material does not require a new research round just for reconstruction. Preserve observations, interpretations and evidence limits; never invent sources or measurements.

## Files and binding

Canonical state: `research/research.json`. Findings: `research/{round_id}/{direction_id}-{title}.md`, referenced by that direction's `findings_file`. Conclusion: `research/{round_id}/conclusion.html`, referenced by that round's `conclusion_file`. No inline report HTML/Markdown in JSON. Preserve settled rounds and exact source URLs. The round stage describes the plan decision, not attempt state.

The Panel edits the round's `topic` and each direction's `title` and
`research_points` in this same canonical state, including before reports exist.
Each research point is one complete string and can contain multiple lines.
Global Save preserves the revised plan; existing report files and their refs
remain intact. Re-read the saved plan for the next research/revision and assess
whether existing findings still answer it. Details/Content Preview provides the
plan and report views without creating a second plan document.

Use `artifact_kind: "research_direction"`, round-scoped `artifact_id: "{round_id}/{direction_id}"` and the exact findings file for delegation or serial focus. Conclusion focus uses `research_conclusion`, round ID and the exact conclusion file. Each author writes/repairs its artifact; the executor reads findings for actual synthesis, updates the corresponding refs and sources, then validates and publishes the integrated round. A reference is accepted only after the file exists. Ordinary Bundle validation remains the state/publication authority; the read-only file check below does not transform or publish state.

## Host call for the source-set check

After integrating accepted findings and the conclusion, call `run_skill_script`
with file-input arguments. This example has one accepted direction and a user
who explicitly capped the whole round at **four cited documents**:

```json
{
  "path": "research.mjs",
  "args": ["validate-round-file"],
  "input_file": "research/research.json",
  "input_files": [
    "research/R-001/D-001-findings.md",
    "research/R-001/conclusion.html"
  ],
  "input_context": { "maxSources": 4 }
}
```

Replace the report paths with every populated current-round `findings_file`
and `conclusion_file`. **Omit `maxSources` when the user supplied no cited-source
cap**; four is an example, not a default. Otherwise use the user's actual cap.
Omit `output_file`: the check returns diagnostics and writes nothing.
`args` contains only the operation; do not add native `--design-files` or
`--input-file` options. The Host supplies the working-copy bytes from the file
arguments. See [check details and the separate native CLI](#check-the-current-rounds-source-sets).

## User bounds and evidence acceptance

For each material claim, first identify what would establish it, then read the
relevant source passage and determine what it actually covers. Preserve a short
supporting passage or precise section locator and material retrieval limits beside
the finding or source entry. A URL, search snippet, navigation-only page, error or
unread truncated response does not establish product behavior. Source authority
helps choose where to look; it does not establish every claim about that source's
product.

Compare the proposed claim with contrary passages and differences in context.
An absence claim needs evidence that rules out the capability within the stated
scope: silence on a page means unverified by that page, not absent from the
product. Distinguish observation, inference and recommendation at the point of
use. Keep the same qualification in the overview, comparison cells and conclusion;
a later limitations paragraph cannot repair an unsupported categorical claim.
Recommendations connect supported tradeoffs to this project's goal; they do not
establish demand or resolve an unanswered product decision.

For authorized research or revision, preserve explicit source limits, allowed
source types, product scope and exclusions in the affected direction's existing
`research_points`. They accompany the questions in every Worker brief and remain
binding when the executor takes over a failed Worker. Host runtime budgets do
not relax those output constraints, and no source limit is implied when none was
requested.

A report-source cap counts distinct cited document URLs, including inline
citations and the Sources section; repeated use of one URL counts once, while two
pages on one site count as two sources. The final source list and `source_urls`
must match the report's used sources. A retrieved search-result list is not the
report's accepted source set. If a figure uses a separate asset URL, retain its
link to the cited source document rather than treating an unexplained asset as
new evidence. An explicit limit on pages opened or tool calls applies to retrieval
instead; follow the user's stated unit and scope.

Before returning a report, its author checks the claims against the retrieved
passages and the final set of document URLs against the user's bounds. The
executor reads each new or changed report before accepting it. A receipt proves
file identity, not evidence quality: if only a receipt was returned, retrieve the
original passages needed to verify material conclusions. Report excerpts are
locators, not independent proof. Repair placeholders, malformed or invented
links, unsupported claims and source-count excess in the report itself; revise
claims, inline links, bibliography and `source_urls` together. If retrieval
evidence is unavailable, leave the affected finding unaccepted. If a direction
has no usable source passage within the allowed bounds, return the failure
reason without writing a findings file or diagnostic-only report; the findings
outline applies only to evidence-backed results. Do not replace missing evidence
with model knowledge or an authentication-error report.

### Landed Worker candidates

A successful Worker receipt records physical output, not evidence acceptance.
Complete publication requires this execution's successful artifacts to exist,
have exact canonical JSON references and pass normal validation. Historical
receipts need no readmission during later repair or restore.

Repair only from retrieved evidence within the authorized scope, then review and
validate. Prose edits alone do not establish acceptance or guarantee publication;
they do not rewrite the Host receipt. Describe changed final bytes using the
publication's actual provenance. If still unaccepted after one focused fix, do
not bind an unsupported report or omit a successful artifact to claim completion.
Report this execution as unfinished or failed; continue through ordinary Owner
repair or already-authorized restore later. Preserve attempt history and never
relabel a physical success receipt as a failed attempt.

### Synthesis and source consistency

Synthesize only accepted findings into the conclusion, preserving their limits
and source set. Before publication, check any integration changes against the
same evidence and report actual per-direction source counts and unmet bounds.
Insufficient bounded evidence is a gap, not permission to exceed the cap. Use
the existing report sections, not another artifact or canonical field. These
remain Agent review duties. Schema validation alone does not prove citation
membership; the explicit file check below checks internal source-set consistency,
not source support or evidence quality. Neither infers source limits from free text.

Restoring existing research preserves its observed sources and provenance;
report an apparent historical mismatch instead of deleting evidence to satisfy
a newly requested limit without an authorized revision.

## Check the current round's source sets

After integrating the accepted findings and authoring the conclusion, run
the [Host call above](#host-call-for-the-source-set-check). It checks only
`current_round_id`, not unrelated historical rounds. A plan with no report
references is valid; existing reports in a partial round are checked.

The separate native CLI below is for a native shell with no piped Host input.
Do not copy its options into `run_skill_script.args`: mixing both interfaces
fails as an input error rather than validating stale disk bytes instead of the
working copy.

```sh
node <Bundle-resources>/scripts/research.mjs validate-round-file \
  --design-files <Design-Files-root> --input-file research/research.json
```

The check compares each report's external document links with its Sources and
canonical `source_urls`; conclusion citations must be a subset of the accepted
findings' sources, not a copy of their entire union. Repeated citations and
sources shared across directions count once in the round total. Image assets,
local anchors and code examples are not document citations. Missing files or
unsupported citation syntax produce specific diagnostics rather than silently
establishing consistency.

Use explicit Markdown source links as specified below. The parser supports a
defined report-link subset, not every CommonMark extension or general HTML
conformance. Sources headings default to `Sources` or `信息来源`; for another
authored language pass the exact heading as `input_context.sourcesHeading`
(`--sources-heading` in the CLI), or identify the HTML heading with `id="sources"`.

Only when the user supplied a whole-round **cited-source** cap, pass that number
as `input_context.maxSources` (`--max-sources` in the CLI). The returned counts
are distinct cited URLs, not pages opened, searches made or claims verified.
Review other units, per-direction limits and source-type restrictions against
the confirmed brief; do not infer a numeric limit from `research_points`.

Read and repair diagnostics in the same owned files before ordinary validation
and publication. Preserve unaccepted-direction gaps and the existing partial
failure recovery. A successful result proves only the supplied files' checked
consistency at that moment. This is an explicit Agent-invoked check, not an
unavoidable publication gate or evidence that the original passages support
the report. It does not authorize rewriting historical sources.

## Findings Markdown

User-facing report using portable Markdown headings, lists, tables and links,
not a raw JSON payload. Do not use HTML badges or CSS classes: the findings view
displays them as text. Self-contained HTML belongs in the conclusion artifact.

- **Visual-first, evidence-led presentation**: make important comparisons, sequences and relationships easy to see through a useful table, process or relationship diagram. Qualitative evidence can support these forms without numerical data. Use concise prose for interpretation and limits, or when no meaningful visual relationship exists; no visual quota. Embed a source figure `![alt](absolute URL)` only when an opened source contains a genuinely relevant chart/diagram, not decoration.
- **TRUSTED SOURCES FIRST**: official sites, industry/analyst reports, established media, academic papers, gov/standards bodies, Statista-grade data. Avoid SEO farms, random forums, content mills.
- **Depth**: answer the research points without padding to a length or finding count. Every factual claim carries a verifiable inline Markdown source link; distinguish the report's interpretation from the cited observation.
- **Language**: use the user's requested report language for headings and prose;
  otherwise retain the active report/conversation language. Restoring an existing
  report preserves its language unless translation is requested. UI language does
  not translate saved reports, source titles or URLs.
- **Structure** (required semantic sections, in this order — exactly ONE `# H1` heading):
  - `# {direction.title}`
  - `## Research Overview` / `## 调研概述` — ≤ 150 characters, single paragraph overview
  - `## Key Findings` / `## 核心发现` — titled findings explaining the observation, supporting source links, design implication and relevant limits. Place an illustrative figure with the finding it supports, not in a standalone gallery.
  - `## Evidence Summary` / `## 关键数据` — retain this section for evidence summaries: real quantitative data when available, otherwise qualitative comparisons or an explicit quantitative evidence gap. A table is useful for comparable dimensions, not mandatory. Never invent statistics or replace missing measurement with an unsupported score.
  - `## Sources` / `## 信息来源` — one line per cited source in the form
    `- [Source title](https://full-url)`. Use exact genuine source URLs from the evidence; invented references are not permitted.
    Fewer real sources beats a padded list.
  - `## Research Conclusion` / `## 调研结论` — concise synthesis of what the evidence supports, its applicability to the current question, and what remains unresolved
  These are English/Chinese equivalents, not headings to combine in one report;
  use the corresponding meanings in another requested language.
- **Completion signal**: report ends with the Research Conclusion section in its authored language.


## Conclusion HTML

Start from [the conclusion template](conclusion-template.html) and read
[the synthetic example](conclusion-example.html) for qualitative visual organization,
not research facts. The template supplies the report reading shell; set `<html lang>` to the authored report language, and
replace the title/question placeholders and content comment
with this round's accepted evidence. Preserve its compact typography and rhythm.
The organization inside the shell follows the evidence, with no fixed card,
chart or finding count. Keep domain diagrams and cited evidence visually distinct
from document headings; the shell is not a product's UI or brand design.

**Document shape:**
- Full `<!DOCTYPE html>` … `<html><head><meta charset><style>…</style></head><body>…</body></html>`. ALL CSS inline in one `<style>`. No external CSS/JS/fonts, no `<script>`, no network deps. Self-contained so it renders in a sandboxed iframe. Before publication, the executor rereads `conclusion.html` and checks these document requirements, including complete tag structure and the absence of Markdown code fences; repair truncated, fence-wrapped or unbalanced content in the same owned artifact before publishing. This is an Agent review duty: `design_validate` enforces the installed schema and declared rules, which do not inspect HTML structure, and this Bundle provides no HTML validator script. A renderable preview or successful structural validation does not establish that these document requirements were met.
- **Responsive, not fixed-width** — it renders in a narrow side-panel iframe (~600px). Reuse the template's fluid container and narrow-screen rules. Evidence figures or useful comparison grids must reflow or remain reachable by local scrolling without changing the document reading scale. Do not hard-pin multi-column cards or enlarge ordinary text to fill the width.
- Use the report family's restrained palette, modern sans and compact reading rhythm: body 14px/1.65; one document H1 20px/1.4; H2 16px/1.5; H3/H4 14px with weight expressing hierarchy; auxiliary text 12px minimum. Use 24px before major sections, 16px before subsections and 8–12px within content. At narrow widths reduce the outer gutter and allow tables to scroll. Do not add hero-scale headings or large empty banners.
- **Reading scale** — normal content, notes, captions and chart labels stay 12–16px; the single document H1 is the 20px exception. Larger graphic numerals are appropriate only for genuine quantitative evidence, not qualitative judgments or decorative headings. Keep the same scale when revising a saved conclusion; do not silently rewrite its evidence or source links while changing presentation.

**Visual-first, with the clarity of a presentation and the reading flow of a report.**
Lead with the question and a concise answer. Organize the important findings
around what the reader needs to compare or understand: show qualitative mechanisms
with a process or relationship view, and alternatives with a useful comparison.
For genuine quantitative evidence, choose readable stat tiles or charts where
comparison helps; retain units and context. Supporting prose explains the
meaning and limits rather than repeating the visual. End with a short synthesis
and the consequential unknowns. No required KPI, chart, card count or prose-area
ratio; never invent statistics, causal links or decorative diagrams to fill space.
Keep material qualifications beside each claim, including in visuals. Numbers
and sources come only from accepted findings; distinguish recommendations from
decisions. Review whether a reader can scan the answer, follow the mechanism,
compare conditions and find the supporting evidence without assembling it from
long paragraphs.

A [synthetic reading example](conclusion-example.html) demonstrates this report's typography. It is illustrative content, not user evidence, a completed
Design task or proof of Agent execution.

### Compose a decision-led synthesis

Start with the reader's question, then choose the most consequential supported
answer. Give that answer a short, prominent reading block (`report-answer`), with
its scope, qualification and supporting source links nearby. It can be a partial
answer when evidence is incomplete. A generic introduction or a list of research
activities does not substitute for the answer.

Choose the form from the relationship the reader needs to understand:

| Reader's task | Useful expression | Preserve in the expression |
| --- | --- | --- |
| Compare alternatives or meanings | A comparison table with shared dimensions; emphasize the consequential difference, not every cell | Comparable scope, supported observations, local unknowns and sources; no invented scores or verdicts |
| Understand how a mechanism works | A process or relationship diagram with named actors/states and labeled conditions | Actual branches, exceptions and return targets when supported; distinguish a source mechanism from a proposed product behavior |
| Decide what might transfer to this project | An interpretation beside the relevant evidence and a conditional design suggestion | Why it helps this question, prerequisites, tradeoffs and which choice remains the user's |
| Judge numerical magnitude or change | A chart or compact quantitative comparison when it makes the difference easier to see | Real values, units, common scales, timeframe, population and sources |

Use semantic HTML and the shell's optional patterns to express these distinctions.
`report-label` can name the actual role of a block (for example, source
observation, interpretation or design suggestion); `report-grid` can place
related explanations together when width allows. Keep their grouping meaningful:
do not turn every paragraph into a card. Use `evidence-limit` beside the affected
claim and `design-suggestion` for a proposal. Distinguish them with words as well
as presentation. Use the shell's limited semantic accents: blue for the main
answer and `report-observation`, warm color for evidence limits, and gentle teal
for design suggestions. Keep explicit type labels; color helps locate the kind
of information, never its evidence strength, certainty or acceptance. The
template supplies these reading styles without prescribing
the number or order of blocks.

A diagram must carry information beyond the surrounding text. Name what its
nodes and arrows mean; label branches and return paths explicitly. The optional
`report-flow` is only a linear sequence, not a substitute for conditional logic.
Use inline SVG or semantic HTML for a richer relationship; give SVG a readable
title/description and preserve normal label sizes. Put a wide diagram in
`report-diagram`, a labeled, keyboard-reachable local scroll region, instead of
shrinking labels to fit. Do not rely on CSS-generated arrows to invent a link or
hide a loop. Keep captions, scope and precise source links with the visual.

End by connecting what the evidence clarified to the practical options and
consequential unknowns. Review the rendered reading path: can a reader locate the
answer, compare its basis, trace the relevant route and find the sources? If
the report includes a diagram, inspect it at the actual reading width: branch
labels must not cover nodes or paths, and each return route must visibly reach
its named target. If
everything has equal weight or the reader must rebuild a comparison from prose,
revise the organization. More badges, cards, charts or decoration do not resolve
that problem.

Restoration preserves an existing report's evidence, language and observed
meaning; this method is not permission to redesign it. For an authorized
presentation revision, retain source URLs, qualifications and decisions while
changing the organization. Recheck visual labels against the accepted findings
and confirm that a new arrow, emphasis or grouping has not implied a stronger
fact or an unapproved product rule.
