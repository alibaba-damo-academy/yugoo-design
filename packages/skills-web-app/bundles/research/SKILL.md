---
name: research
description: |-
  - **Capability**: external information gathering — market context, competitor analysis, business background, reference targets ("what is X").
  - **Resolves**: U gaps caused by uncertain external facts, reference products, domain conventions, regulations, or current landscape.
  - **Candidate when**: reliable external evidence would materially change a product decision and a confident answer would otherwise require guessing.
  - **Do not infer**: a named product, an unfamiliar word, or a request for a bounded draft does not by itself require a research round. Analysis explicitly requested as input to a later imitation/build does require research.
  - **Output**: `research` panel — sourced findings, their design implications and evidence limits, persisted to design state.
---

# Research

See the [record ID guidance](reference/artifact-contract.md#record-ids) for this Bundle's numbering suggestions and existing identity boundaries.

## How this skill runs

Research has a planned handoff. The active executor (main conversation or isolated Producer, as selected by
`execution.mode`) uses project-scoped
`list` and `read` tools to inspect `research/research.json`, the owned
findings/conclusion artifacts relevant to its active rounds, and related
upstream evidence. With no prior round it creates and persists the initial plan,
lets the polling panel read that current file immediately, and calls
`design_publish({action:"handoff"})` once for the declared user-continue pause. After
the user starts that exact plan, the executor owns the complete research run.
Treat pending directions as independent unless one explicitly depends on
evidence produced by another. When the current independent dependency frontier
contains two or more directions and `design_delegate_frontier` is available, the
executor submits that complete ordered frontier in one call. The Host atomically
validates and claims every id/path before starting any Worker, applies its own
bounded concurrency, and returns every item in request order after all have
settled. Use `design_delegate` for one direction, or as the compatibility
fallback when the frontier tool is unavailable; sibling single calls are emitted
together without awaiting one before dispatching the next. The frontier, rather
than a fixed Worker count, determines the batch. Dependent directions run in a
later frontier, and the conclusion runs only after every direction has accepted
findings or a settled Host attempt. When delegation is unavailable, or when a
Worker fails, is cancelled, or was not started, the executor researches that
direction itself. This remains attached foreground work. Main placement publishes explicitly
from the current conversation; subagent placement keeps the calling
`run_design_skill` pending until its executor settles.

All executor mutations use `write` or `edit` against the current Bundle-owned
working copy. They never use host filesystem or shell access.

- **Plan.** Maintain the complete plan state in `research/research.json`: rounds
  with directions (`title` + `research_points`) and deterministic direct
  artifact paths for new work. Preserve explicit source limits, allowed source
  types, product scope, exclusions and requested report language in the affected direction's existing
  `research_points`, alongside its questions, so the saved plan retains the
  complete brief across confirmation, delegation and serial takeover. Do not
  invent a limit when the user supplied none. The executor updates its working copy and calls
  `design_publish({action:"handoff"})` to enter the independently configured gate,
  and the runtime presents `开始调研` / `Start Research`; the user may revise
  the plan before starting it.
- **Execute.** After confirmation, the executor handles pending directions and
  the round conclusion:
  1. Partition pending directions by evidence dependency and plan the complete
     ordered frontier. Never include the dependent round conclusion in a
     direction frontier. Assemble the prompts in step 2 before dispatching.
     Do not write transient
     queued/working state or execution ids into Design JSON. The Host records
     executor and Worker attempts at their real lifecycle boundaries; the panel
     polls those events and their native session logs for status and rolling
     trace. For serial work, search with `web_search` (and `web_fetch` when
     available) per the brief below.
  2. Assemble each complete delegated `prompt` before calling the tool. Read
     `reference/artifact-contract.md` and copy **User bounds and evidence
     acceptance** and **Findings Markdown** (up to **Conclusion HTML**) into the
     assignment. These contain the evidence method and exact report outline;
     neither a remembered outline nor a resource path replaces that content.
     Keep conclusion-only instructions with the executor.

     > Question and research points: {current direction and relevant product context}.
     > Source/scope bounds and report language: {the user's complete constraint, or no supplied limit}.
     > Evidence method and output: {the two contract sections just read}.
     > No usable source passage: return the failure reason without writing a
     > findings file or diagnostic-only report. The report outline applies only to
     > evidence-backed results.
     > Owned findings file for evidence-backed results: {exact artifact_file}.

     Carry the interpretation and applicability guidance below into the relevant
     research points; this assignment does not replace those domain judgments.
     Each `design_delegate_frontier.items[]` entry or single `design_delegate`
     call uses `artifact_kind: "research_direction"`,
     `artifact_id` equal to the round-scoped stable ID
     `"{round_id}/{direction_id}"` (for example `"R-002/D-001"`), `artifact_file` equal to
     that direction's exact findings path, and the complete `prompt` assembled
     above. These explicit arguments are the runtime/panel binding; there is
     no parallel task declaration in `skill.yaml`.
     For an independent frontier of two or more directions, call
     `design_delegate_frontier` once with a new invocation-local `batch_id` and
     the complete ordered `items` list. Reuse that id only for the exact same
     ordered items; changed work uses a new id. When only one direction is
     pending, or when the frontier tool is unavailable, use `design_delegate`;
     emit independent fallback calls together without waiting between dispatches.
     A frontier call is all-settled:
     review every `completed` candidate before integration, then take over each `failed`,
     `cancelled`, or `not_started` item serially. Do not ask the Host to retry it.
     The Worker writes and repairs only its exact pre-bound artifact path, then
     returns a receipt containing the path, digest, byte count, and attempt.
     Before updating `findings_file` or source URLs, apply the contract's
     evidence acceptance to the landed report: read it, verify material claims
     against original passages, and reconcile its complete source set. The
     receipt proves bytes, not evidence quality; do not rewrite the file merely
     to reproduce receipt-proven bytes. Serial work uses the same evidence
     method, acceptance and validation with the executor's normal write tools.
  3. After all directions, read the working-copy findings and author the round's conclusion
     HTML, verify that every external citation occurs in the settled direction
     findings and uses a descriptive source title, then write
     `research/{round_id}/conclusion.html` and the matching `conclusion_file` in
     the same WorkingCopy. Run the read-only current-round file check described
     in [the output contract](reference/artifact-contract.md#check-the-current-rounds-source-sets)
     against those exact files. Repair its source-set diagnostics and compare
     its distinct citation counts with the user's applicable bounds; the check
     does not verify source truth or pages opened. Call `design_validate({outcome:"complete"})`, repair
     every diagnostic in that same WorkingCopy, and then call
     `design_publish({action:"complete"})`.

  A delegated Worker has no general Design Files mutation authority. It can
  write and repair only the artifact path pre-bound in its task; it never
  writes canonical JSON. Available read-only tools can inspect relevant source
  evidence when the brief has a material gap. The foreground executor preserves settled directions,
  integrates the returned receipts, runs Bundle validation over the complete
  round, and decides whether more work is required.
  A failed or unavailable delegation is a reason for the executor to
  take over that direction, not a reason to abandon the round or persist an
  attempt status. If the executor's own evidence attempt also fails, leave the
  direction without a findings ref and name the gap in the partial conclusion.
  Cancellation leaves unfinished work resumable.

  Focus binds serial executor execution to an artifact; it is not authored
  Design state or artifact-acceptance evidence.
  Do not call it for a task passed to `design_delegate` or
  `design_delegate_frontier`; delegated activity is observed automatically.
  Before serial conclusion authoring, call
  `design_focus_artifact` with `artifact_kind: "research_conclusion"`,
  `artifact_id` equal to the stable round ID, and `artifact_file` equal to the
  exact conclusion path. When taking over a failed direction, focus it with the
  same kind, round-scoped ID, and file that would have been passed to
  `design_delegate`.

- **Tool adaptation.** Use the search/fetch capabilities exposed by the current
  Host; do not assume a particular tool configuration. Findings carry ordinary
  Markdown links copied exactly from actual retrieval results. Distinguish retrieval failure from a Host-truncated result:
  navigation-only excerpts may omit the article body. Recover the relevant
  sections through available native tools or retained original results before
  declaring the evidence unavailable; avoid repeatedly fetching the same whole page.
  Findings use portable Markdown headings, lists, tables and links; do not use
  HTML badges or CSS classes, which their view displays as text. Self-contained
  HTML belongs only in the conclusion artifact.
  When live evidence cannot be retrieved, leave the direction
  unaccepted and keep the evidence gap open. Do not turn model knowledge or an
  authentication-error report into findings, and never invent a URL.

Revising a plan (e.g. "focus on X", add/remove/reorder directions) is the same
verb: run this skill again and persist the **full** updated plan. First compare
the requested change with the current canonical state and owned artifacts.
Prefer a targeted edit: preserve every unchanged `findings_file`, accepted
round, source, and direct reference. Clear only an affected direction's
`findings_file` when it must be researched again, and clear that round's
`conclusion_file` so the executor synthesizes the updated evidence. Regenerate
an entire round only when its topic or evidence basis materially changed.

## When to use

The deciding signal is normally knowledge confidence, not merely whether a user named a product. When the user explicitly asks to analyze a reference product as input to a later imitation/build, use research regardless of whether you already know that product, because the findings must persist as design evidence.

- A familiar, well-understood requirement that can be designed confidently does not need research; use the smallest suitable design skill or answer directly.
- Reference products (for example “类似 Notion” / “对标 X”), unfamiliar verticals, fast-changing best practice, and ambiguous niche workflows are common triggers when your knowledge is incomplete.
- When the value of research is genuinely borderline, clarify whether the user wants that depth rather than automatically opening a research round.
- Research is for design-informing external evidence, not implementation architecture or library selection.

## From evidence to design judgment

Before delegating, supply each direction with the relevant product question,
established scope, already-known findings and source locators, plus that
direction's complete research points and evidence contract. Do not require all
Workers to reread the entire project or sibling reports. Workers retrieve
missing context as needed and report contradictions to the executor. KAG may
locate related existing design evidence; it never replaces live external
retrieval or the Worker's own citation provenance. The executor still reads
accepted findings for actual cross-direction synthesis, beyond their receipts.

Frame each direction around what needs to be understood and why it matters to
the current product or requested exploration. Express this in the existing
`research_points`, not extra plan fields. Broad landscape research can discover
useful questions; it need not pretend the user has already chosen a solution.

For each material claim, identify what would establish it, read the relevant
original passage and check its scope and contrary evidence. Source priority
selects where to look; it does not prove everything about that product. Silence
on a page means unverified by that page, not absence from the product. A negative
capability claim needs evidence ruling it out within the stated scope. Keep a
short supporting passage or precise section locator beside the finding; a URL,
search snippet, error or unread truncation is not that evidence.

When revising research, cover the current user's requested reports and conclusion,
not just the caller's provisional diagnosis. Treat an assertion that another
report needs no changes as a hypothesis to verify, not prior acceptance. Preserve
supported observations; correct unsupported claims everywhere they occur,
including the overview, comparison cells and conclusion. A local citation fix
cannot establish the unchanged text's accuracy.

Reconcile the report's distinct cited document URLs, including inline citations,
with its bibliography and canonical `source_urls`, within the user's stated
source cap. Two pages on one site are two sources; repeated use of one URL is
one. A tool-call limit is a different bound. Do not invent either limit. Read
landed reports and the original passages supporting material conclusions before
accepting them; a successful file receipt or schema validation proves neither
source support nor evidence quality. Apply the same evidence strength when
synthesizing the round conclusion.

[User bounds and evidence acceptance](reference/artifact-contract.md#user-bounds-and-evidence-acceptance)
retains these requirements in the readable output contract for reconstruction and
delegated assignments. Worker self-check and executor acceptance are separate
responsibilities.

Distinguish observation, inference and recommendation throughout the report,
including headings, table cells, chart labels and recommendation reasons:
- An observation says only what the source establishes, within its context.
- An inference explains its basis and conditions where it appears. A known
  mechanism does not establish user success, comparative quality or measured
  cost; if evidence cannot support that comparison, say it is undetermined
  rather than supply a confident adjective or ranking.
- A recommendation connects supported tradeoffs to an explicit product goal.
  Where the user's priority is unknown, make the option conditional, not an
  assertion about what that user needs.

Presentation does not change the strength of evidence: a qualitative rating
needs support just as a number does. A general limitations paragraph cannot
qualify unsupported claims elsewhere. Look for meaningful counterevidence or
differences in audience, scale, workflow and incentives before recommending
adoption from another product. Several sites repeating one claim are not
independent support.

For a design-facing conclusion, connect relevant evidence to practical options:
what could be adopted, adapted or left out, why, and what remains uncertain.
Compare alternatives only where they illuminate a real choice; do not invent
competitors or numerical estimates to fill a matrix. Qualitative observations
can support a useful conclusion without market sizes or KPIs. A competitor
offering a feature is not proof of demand from this project's users.

Carry these interpretation and applicability requirements into delegated briefs
along with the findings contract. Neither research completion nor a recommended
option authorizes a downstream design change or settles an unanswered user
decision.

## Close-out evidence

Close only after the grounded conclusion is persisted and every missing direction is named as an evidence gap in that conclusion. Research can add verified external evidence and primarily improve U. It does not by itself define modules, workflows, acceptance criteria, or visual decisions; S/T evidence must come from concrete relationships or observable criteria supported by the saved design; producing a research report alone does not establish them. Report what the evidence clarified; completing a research round alone adds no clarity.

### Typical evidence guidance

- Identify which relevant external facts and source limitations the persisted conclusion makes clearer for the current intent and scope; assess this U evidence under the shared rubric, without a fixed increment.
- Assess S/T from the whole saved design: cite any concrete relationships or observable criteria supported by the findings, and do not treat research completion alone as evidence that modules, flows or acceptance criteria exist.
- A plan-only round, failed directions without a useful conclusion, or findings that reveal a new unresolved gap may leave scores unchanged or lower them.

## Output contract

The `research` panel holds one or more rounds, each with direction findings and a
grounded conclusion. Findings and conclusions are file-backed through direct
`findings_file` and `conclusion_file` references. Canonical records describe
planned or accepted results; queued/working/attempt failure comes from durable
Host execution events, never Agent-authored JSON or Git. The executor owns canonical JSON and publication;
optional Workers write and validate only their pre-bound artifact file, then
return its receipt.

### ⚠ Hard rules — read FIRST

**HR-1 (no premature handoff)**: Do NOT emit any next-skill / build suggestion (`function_modules`, `flow_design`, `直接开发`, etc.) until the current round has a readable `conclusion_file` produced from its current direction set.

**HR-2 (partial failure ≠ skip the round)**: If a direction has no accepted findings and no successful Worker receipt in the current execution, the round can still complete from its accepted evidence:
- Leave the direction without a findings ref; the Host attempt retains the failure diagnostic.
- Synthesize the round conclusion from directions that DID complete; name the
  missing direction gaps and write it to the WorkingCopy. The Panel derives the
  partial result from the conclusion plus missing findings; do not persist an
  execution-result stage.
- Do NOT silently retry the same direction endlessly in the same turn.
- Recovery options: continue with the partial conclusion, add a NEW direction in a later plan, or retry the unaccepted direction after clearing the round's `conclusion_file`.
- After a recovered direction completes, the same executor run synthesizes a new conclusion from the now-current findings.

A successful Worker receipt follows the
[landed-candidate boundary](reference/artifact-contract.md#landed-worker-candidates).
If the report remains unacceptable after one evidence-supported fix, report this
execution as unfinished or failed without complete publication. Continue through
ordinary Owner repair or already-authorized restore in a later execution,
preserving settled work and receipt history.

Use plain language for conclusions. A comparison need not assign a verdict
to every option: explain what is known and leave an unsupported dimension
undetermined. Use `支持` / `不支持` / `部分支持` only when the evidence actually
establishes support for the stated proposition, not as required matrix cells.

### Heavy content lives in files, never inline

Findings markdown and round conclusions are LONG. They never appear inline in
state. The executor stores direct refs on their owning direction or round, and
the panel reads the selected direction/conclusion from its file on demand.

- **Findings** (per-direction): the assigned Worker or executor writes validated findings to
  `research/{round_id}/{direction_id}-{title}.md`
  (e.g. `research/R-001/D-001-拼多多核心商业模式与增长策略.md`) as part of the owned artifact set.
- **Conclusion** (per-round): a self-contained visual research report authored from
  the completed findings. The assigned Worker or executor writes and
  validates it at `research/{round_id}/conclusion.html`.

To re-read these artifacts later (for example as downstream design context),
use the Host's revision-pinned Design Files access. Do not bypass the Design
projection with workspace filesystem or shell reads.

### Two plan patterns (decide which applies)

**P1 — New round (new topic):** the user's latest message is about a topic NOT covered by any existing round. Write the complete plan with the new round appended, preserving settled rounds.

```json
{
  "rounds": {
    "R-002": {
      "round_id": "R-002",
      "topic": "Linear feature analysis",
      "stage": "identified",
      "directions": {
        "D-001": {
          "direction_id": "D-001",
          "title": "Core workflow",
          "research_points": ["Primary user path", "Distinctive behavior"]
        }
      },
      "direction_order": ["D-001"],
      "conclusion_file": null
    }
  },
  "round_order": ["R-002"],
  "current_round_id": "R-002"
}
```

When prior rounds exist, preserve their complete objects and append the new ID
to `round_order`; the shortened example shows only the newly added round.

**P2 — Continue digging (extend current round):** the user asks for MORE directions on the current topic. Read `current_round_id`, merge new directions into that round, and write the round with the FULL `direction_order` list (every id, existing + new). The executor preserves every round and direction in the complete canonical working copy, validates it, and publishes it.

```json
{
  "rounds": {
    "R-001": {
      "round_id": "R-001",
      "topic": "Notion feature analysis",
      "stage": "identified",
      "directions": {
        "D-001": {
          "direction_id": "D-001",
          "title": "Core editor",
          "research_points": ["Editing model"]
        },
        "D-NEW-001": {
          "direction_id": "D-NEW-001",
          "title": "AI features",
          "research_points": ["User-visible AI workflows"]
        }
      },
      "direction_order": ["D-001", "D-NEW-001"],
      "conclusion_file": null
    }
  },
  "round_order": ["R-001"],
  "current_round_id": "R-001"
}
```

**Deciding P1 vs P2:** New round when the message is about a clearly different topic (`R-001` was "Notion"; user now says "research Linear"). Continue digging when it's the SAME subject but asks for more angles (`R-001` is "Notion"; user says "also look at Notion's AI features"). When in doubt, prefer P1 — a misjudged "new topic" is easy to recover; a misjudged "continue digging" pollutes a round's conclusion with unrelated directions.

### Plan review gate

When the plan first lands, publish the declared handoff and return a short
summary with the runtime-provided Start Research action. A request to focus,
add, remove or reorder directions revises the existing plan, preserving the
rest, then returns to that same review boundary.

### Research scope

Use this Bundle when the requested result is durable design research: preserve
its plan, findings and synthesis in the research panel. A single direction can
suffice. Users can refine the round topic, direction title and research points
in the Panel and save them before research or another revision. Read that saved
plan before executing; editing it does not rewrite an existing report or prove
that the report answers the revised questions. Ordinary factual answers or an accepted advisory's Host-research route
follow the current request and shared Host policy; they do not require a round
or authorize Design File writes.

## Canonical plan shape

A new plan needs direction identity, title and research points; file refs may
remain absent or null until accepted artifacts exist. For example:

```json
{
  "rounds": {
    "R-001": {
      "round_id": "R-001",
      "topic": "Research topic for this round (e.g. 'Notion feature analysis')",
      "stage": "identified",
      "directions": {
        "D-001": {
          "direction_id": "D-001",
          "title": "Direction title",
          "research_points": ["point1", "point2"]
        }
      },
      "direction_order": ["D-001"]
    }
  },
  "round_order": ["R-001"],
  "current_round_id": "R-001"
}
```

**Direction count: 1–7, sized to the topic.** Start with the smallest set of distinct, non-overlapping angles that can answer the design question. One tightly bounded question may need one direction; broader uncertainty may justify parallel directions. Never pad a round to reach a count.

**Sources**: prefer the trusted-source whitelist — load it with
`read_skill_resource(path="reference/trusted_sources.md")`
(官方/国际组织 > 权威数据财经 > 技术一手 > 降级) and apply it to every direction's searches.

### Direct artifact refs and revisions

On a new plan, each direction has `findings_file: null`; the round has `stage: "identified"` and
`conclusion_file: null`. The executor fills these refs only after their artifacts exist and pass
validation, then publishes the integrated state.

Preserve valid direct refs when revising unrelated plan text. When a direction
must be researched again, clear only its findings ref and its round conclusion
ref. Adding or removing a direction also clears
that round's conclusion ref. Git history provides artifact version history;
do not maintain integer artifact revisions in Design JSON.

### Populate only supported state

Preserve existing metadata. Do not invent timestamps, counters or execution
status, or assume publication manufactures Bundle fields. Omit optional metadata
on a new plan unless an actual source supplies it. `source` describes evidenced
origin (`analysis`, `user` or `prerequisites`), not execution progress.

After accepting a validated report, the executor records its exact `findings_file`
and reconciled `source_urls`; it sets `conclusion_file` after validating the
synthesis. These refs and source lists are executor-owned canonical fields,
not automatic side effects of a receipt. The output contract and schema define
legal fields; do not invent `direction_name`, `is_selected`, `priority` or
`estimated_hours`.

Before proposing directions, read the current research state. Do not re-propose a direction that already has accepted findings. Artifact refs are durable Design facts; execution status comes only from Host attempts. If the user asks for MORE on accepted research, explicitly clear the affected ref or propose a new direction. Never silently repeat accepted work.

### Domain Boundary Filter

Research covers EXTERNAL exploration — market / product / user / business / competitive / domain conventions. Things a non-engineer would ask about.

Research does NOT cover technical implementation — API choice, architecture, library selection, code patterns, infrastructure. Those belong to later development decisions, not the function-module capability map.

Quick test: if the direction asks "how do I build X" or "which library for Y", it's OUT of scope. If it asks "what does this market look like" or "who uses this and why", it's IN scope.

## Execution specs (Turn 2 — you run these)

The following describe what your execution turn produces for each direction and
for the round conclusion.

### Per-direction findings brief

Work one direction at a time; each report is self-contained and never mentions
sibling directions, round ordering, or counts.

For each direction:

1. Cover every `research_points` bullet from more than one useful search angle.
   Stop when credible retrieved evidence supports a useful answer, or when the
   Host's configured tool/time/token budget is exhausted. The Host owns those
   runtime limits; the user's evidence/output bounds still apply to both Worker
   and serial execution. This Skill Body does not promise a fixed number of search or fetch
   calls. If important evidence remains missing at the configured boundary,
   leave the gap explicit instead of extending the run indefinitely.
2. Open the most authoritative hits with `web_fetch` when available — search
   snippets alone are incomplete; ground claims in pages you actually opened.
3. Author the findings markdown below. When working serially, the executor
   writes it directly to the owned working copy and validates the citation contract.
   When delegated, include the stable `artifact_file` in the task. The Worker
   writes and repairs that exact path; the executor reads the file, checks the
   receipt, and updates the direction state.

For delegated work, assemble the prompt at **How this skill runs → Execute,
step 2**, using the confirmed direction and the installed evidence acceptance
and Findings Markdown sections as specified there. Keep the same evidence depth
for serial work.
Search depth must not depend on serial or delegated placement.

**Citations (Host-native Markdown links).** Copy exact URLs from successful
retrieval results into ordinary inline Markdown links, for example
`[Official source](https://example.com/report)`. Never mint an SRC token: the
Host has no run-scoped token resolver for this research execution. Tool
arguments and generated report text cannot self-prove a source. Check findings
links and image URLs against evidence actually retrieved for that direction,
using the shared contract's evidence acceptance before integration and
publication. A structural validation pass is not citation or factual verification.

Read [reference/artifact-contract.md](reference/artifact-contract.md) for the shared findings sections, citation representation, conclusion document shape and activity bindings. Include that reference in every delegated brief. Live research still uses the retrieval/evidence policy above.

**No live evidence means failure, not degraded findings.** If available retrieval
tools yield no usable source after the bounded attempts, leave
that direction without a findings file; the Host attempt retains the reason. A delegated
Worker failure is a tool failure, not an accepted artifact candidate. The
executor either takes over that direction or leaves it unaccepted after its own
bounded evidence attempt. Never replace missing
live evidence with model knowledge, a fabricated URL, or an authentication-error
report. Other accepted directions may still support a partial round conclusion.

### Round conclusion (HTML report)

After all directions are settled, read the accepted findings and author ONE
complete, self-contained HTML document — a visual research synthesis grounded
in the findings; never invent numbers/sources. Organize it around the question
and available evidence, not a mandatory market-report template. The executor writes it
to the round's owned conclusion path and validates it. Keep the canonical round
stage as the durable `confirmed` decision phase; the Panel derives
`researching`, `completed`, or `partial` from Host attempts and the accepted
findings/conclusion references.

Before writing a new conclusion, read the installed
`reference/conclusion-template.html` and `reference/conclusion-example.html`
with `read_skill_resource`. Use their reading shell and visual organization,
not the synthetic example's facts. For a revision, compare the existing shell
with that same resource and preserve unaffected evidence and source links.
Build the synthesis around the decision the research informs: state a bounded
answer, show the evidence relationship that makes it understandable, and explain
the applicable options and remaining unknowns. Choose comparable dimensions for
alternatives; show meaningful conditions, branches and return paths for a
mechanism rather than flattening it into a row of steps. A stack of findings,
identical cards or a table that merely repeats paragraphs is not synthesis.
Use [Conclusion HTML](reference/artifact-contract.md#conclusion-html) for the
construction method, semantic report patterns and document shape. Its content
remains grounded in accepted findings; completion does not authorize new product
decisions.

## Return findings to the caller

Report what the saved findings clarified and which consequential gaps remain.
They may support questions about user-specific choices, functions, flows or
visual work, or invalidate an earlier assumption. Name the relevant evidence
and affected owner rather than launching it. The caller and user choose the
next action through the shared interaction; research completion mandates no
consumer, selector tool or score change.
