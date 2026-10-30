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

## How this skill runs

Research has a planned handoff. The first Producer run uses project-scoped
`list` and `read` tools to inspect `research/research.json`, the owned
findings/conclusion artifacts relevant to its active rounds, and related
upstream evidence. With no prior round it creates and persists the initial plan,
lets the polling panel read that current file immediately, and calls
`design_publish({action:"handoff"})` once for the declared user-continue pause. After
the user starts that exact plan, the Producer owns the complete research run.
Treat pending directions as independent unless one explicitly depends on
evidence produced by another. When the current independent dependency frontier
contains two or more directions and `design_delegate_frontier` is available, the
Producer submits that complete ordered frontier in one call. The Host atomically
validates and claims every id/path before starting any Worker, applies its own
bounded concurrency, and returns every item in request order after all have
settled. Use `design_delegate` for one direction, or as the compatibility
fallback when the frontier tool is unavailable; sibling single calls are emitted
together without awaiting one before dispatching the next. The frontier, rather
than a fixed Worker count, determines the batch. Dependent directions run in a
later frontier, and the conclusion runs only after every direction has accepted
findings or a settled Host attempt. When delegation is unavailable, or when a
Worker fails, is cancelled, or was not started, the Producer researches that
direction itself. This remains foreground work:
`run_design_skill` and the calling main-Agent turn stay pending until the
Producer settles.

All Producer mutations use `write` or `edit` against the current Bundle-owned
working copy. They never use host filesystem or shell access.

- **Plan.** Maintain the complete plan state in `research/research.json`: rounds
  with directions (`title` + `research_points`) and deterministic direct
  artifact paths for new work. Preserve explicit source limits, allowed source
  types, product scope and exclusions in the affected direction's existing
  `research_points`, alongside its questions, so the saved plan retains the
  complete brief across confirmation, delegation and serial takeover. Do not
  invent a limit when the user supplied none. The Producer updates its working copy and calls
  `design_publish({action:"handoff"})` to enter the independently configured gate,
  and the runtime presents `开始调研` / `Start Research`; the user may revise
  the plan before starting it.
- **Execute.** After confirmation, the Producer handles pending directions and
  the round conclusion:
  1. Partition pending directions by evidence dependency. For an independent
     frontier of two or more directions, call `design_delegate_frontier` once
     with a new invocation-local `batch_id` and the complete ordered `items`
     list. Reuse that id only for the exact same ordered items; changed work uses
     a new id. When only one direction is pending, or when the frontier tool is
     unavailable, use `design_delegate`; emit independent fallback calls together
     without waiting between dispatches. Never include the dependent round
     conclusion in a direction frontier. Do not write transient
     queued/working state or execution ids into Design JSON. The Host records
     Producer and Worker attempts at their real lifecycle boundaries; the panel
     polls those events and their native session logs for status and rolling
     trace. For serial work, search with `web_search` (and `web_fetch` when
     available) per the brief below.
  2. Bind every delegated task to its stable `artifact_file`. The Worker writes
     and repairs only that exact pre-bound artifact path, then returns a receipt
     containing the path, digest, byte count, and attempt. Read the landed
     Markdown, then update only that direction with its
     `findings_file`, digest, and source URLs. Do not rewrite
     bytes already proven by the receipt. Serial work uses the Producer's normal
     write tools and the same validation contract.
     Each `design_delegate_frontier.items[]` entry or single `design_delegate`
     call uses `artifact_kind: "research_direction"`,
     `artifact_id` equal to the round-scoped stable ID
     `"{round_id}/{direction_id}"` (for example `"R-002/D-001"`), `artifact_file` equal to
     that direction's exact findings path, and a complete `prompt` containing
     the direction brief, research points, trusted-source policy, and findings
     contract. These explicit arguments are the runtime/panel binding; there is
     no parallel task declaration in `skill.yaml`. A frontier call is all-settled:
     integrate every `completed` receipt, then take over each `failed`,
     `cancelled`, or `not_started` item serially. Do not ask the Host to retry it.
  3. After all directions, read the working-copy findings and author the round's conclusion
     HTML, verify that every external citation occurs in the settled direction
     findings and uses a descriptive source title, then write
     `research/{round_id}/conclusion.html` and the matching `conclusion_file` in
     the same WorkingCopy. Call `design_validate({outcome:"complete"})`, repair
     every diagnostic in that same WorkingCopy, and then call
     `design_publish({action:"complete"})`.

  A delegated Worker has no general Design Files mutation authority. It can
  write and repair only the artifact path pre-bound in its task; it never
  writes canonical JSON. Available read-only tools can inspect relevant source
  evidence when the brief has a material gap. The foreground Producer preserves settled directions,
  integrates the returned receipts, runs Bundle validation over the complete
  round, and decides whether more work is required.
  A failed or unavailable delegation is a reason for the Producer to
  take over that direction, not a reason to abandon the round or persist an
  attempt status. If the Producer's own evidence attempt also fails, leave the
  direction without a findings ref and name the gap in the partial conclusion.
  Cancellation leaves unfinished work resumable.

  Focus binds serial Producer execution to an artifact; it is not authored
  Design state or artifact-acceptance evidence.
  Do not call it for a task passed to `design_delegate` or
  `design_delegate_frontier`; delegated activity is observed automatically.
  Before serial conclusion authoring, call
  `design_focus_artifact` with `artifact_kind: "research_conclusion"`,
  `artifact_id` equal to the stable round ID, and `artifact_file` equal to the
  exact conclusion path. When taking over a failed direction, focus it with the
  same kind, round-scoped ID, and file that would have been passed to
  `design_delegate`.

- **Tool adaptation.** `web_search` availability depends on the host's web seam
  configuration; `web_fetch` is off by default. The host's native web tools
  return URLs, so findings carry ordinary Markdown links copied exactly from those
  tool results. When live evidence cannot be retrieved, leave the direction
  unaccepted and keep the evidence gap open. Do not turn model knowledge or an
  authentication-error report into findings, and never invent a URL.

Revising a plan (e.g. "focus on X", add/remove/reorder directions) is the same
verb: run this skill again and persist the **full** updated plan. First compare
the requested change with the current canonical state and owned artifacts.
Prefer a targeted edit: preserve every unchanged `findings_file`, accepted
round, source, and direct reference. Clear only an affected direction's
`findings_file` when it must be researched again, and clear that round's
`conclusion_file` so the Producer synthesizes the updated evidence. Regenerate
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

### Honor the user's evidence bounds

The user's source limit is an acceptance condition for the requested output,
separate from the Host's tool/time/token budget. Carry the complete current
constraint into every Worker brief. Before serial research or taking over a
failed Worker, reread the saved direction and apply the same constraint; a failed
attempt does not permit a larger source set or broader product scope.

For a limit on report sources, count distinct cited document URLs across the
findings and its `信息来源` section, not domains, repeated citations or search
result counts. For example, “at most two first-party sources per direction”
permits at most two distinct first-party document URLs in that direction's
findings and matching `source_urls`. It does not mean two websites with unlimited
pages, nor two new sources in addition to retained ones. A limit on pages opened
or tool calls instead applies before retrieval; follow the user's actual wording.

Before integrating a Worker receipt or publishing serial findings, inspect the
landed report against the current direction's questions and bounds. If it exceeds
the source limit, keep the strongest permitted evidence and revise or qualify
every claim that depended on a removed source. Update inline links, the source
list and `source_urls` together; trimming only JSON or the bibliography does not
repair an over-budget report. Regenerate the affected round conclusion from the
accepted findings without adding external sources. If the permitted evidence
cannot support the requested answer, keep that limitation explicit rather than
silently adding a source. Report the actual per-direction source counts and any
unmet bound in the handoff. Ordinary Bundle validation does not mechanically
interpret these free-text constraints; passing it never waives this review.

Apply the same evidence standard to every statement, including headings,
table cells, chart labels and recommendation reasons:
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
Host execution events, never Agent-authored JSON or Git. The Producer owns canonical JSON and publication;
optional Workers write and validate only their pre-bound artifact file, then
return its receipt.

### ⚠ Hard rules — read FIRST

**HR-1 (no premature handoff)**: Do NOT emit any next-skill / build suggestion (`function_modules`, `flow_design`, `直接开发`, etc.) until the current round has a readable `conclusion_file` produced from its current direction set.

**HR-2 (partial failure ≠ skip the round)**: If one or more directions cannot produce findings (searches return nothing usable, or the citation gate keeps rejecting the report after one fix attempt), the round still completes:
- Leave the direction without a findings ref; the Host attempt retains the failure diagnostic.
- Synthesize the round conclusion from directions that DID complete; name the
  missing direction gaps and write it to the WorkingCopy. The Panel derives the
  partial result from the conclusion plus missing findings; do not persist an
  execution-result stage.
- Do NOT silently retry the same direction endlessly in the same turn.
- Recovery options: continue with the partial conclusion, add a NEW direction in a later plan, or retry the unaccepted direction after clearing the round's `conclusion_file`.
- After a recovered direction completes, the same Producer run synthesizes a new conclusion from the now-current findings.

Use plain language for conclusions. A comparison need not assign a verdict
to every option: explain what is known and leave an unsupported dimension
undetermined. Use `支持` / `不支持` / `部分支持` only when the evidence actually
establishes support for the stated proposition, not as required matrix cells.

### Heavy content lives in files, never inline

Findings markdown and round conclusions are LONG. They never appear inline in
state. The Producer stores direct refs on their owning direction or round, and
the panel reads the selected direction/conclusion from its file on demand.

- **Findings** (per-direction): the assigned Worker or Producer writes validated findings to
  `research/{round_id}/{direction_id}-{title}.md`
  (e.g. `research/R-001/D-001-拼多多核心商业模式与增长策略.md`) as part of the owned artifact set.
- **Conclusion** (per-round): a self-contained HTML slide-deck authored from
  the completed findings. The assigned Worker or Producer writes and
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

**P2 — Continue digging (extend current round):** the user asks for MORE directions on the current topic. Read `current_round_id`, merge new directions into that round, and write the round with the FULL `direction_order` list (every id, existing + new). The Producer preserves every round and direction in the complete canonical working copy, validates it, and publishes it.

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

When the plan first lands with the direction list, stop and wait for the user.
End the turn with a short plan summary and the explicit next step: reply
`开始调研` to execute, or describe revisions first.

A free-form chat request to focus, add, remove, or reorder directions is a current instruction, not a reason to wait: write the revised plan (preserving the rest), then remain at plan review with the updated plan.

### Research owns all design-time web lookups

Any external-info need that exists to inform a design decision goes through
`research`, because the output belongs in the research panel's audit trail. A
small design sometimes warrants just a 1-direction round. Factual lookups that
do not feed design state (e.g. "今天日元汇率") are answered directly in chat —
plain `web_search` is fine there; no round needed.

## Canonical plan shape

Keep the plan small. **Per direction, author only these 3 fields** — the schema
defaults handle everything else:

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
`conclusion_file: null`. Publication fills these fields only after validating
and atomically persisting accepted output.

Preserve valid direct refs when revising unrelated plan text. When a direction
must be researched again, clear only its findings ref and its round conclusion
ref. Adding or removing a direction also clears
that round's conclusion ref. Git history provides artifact version history;
do not maintain integer artifact revisions in Design JSON.

### DO NOT author these fields

These are **managed by Producer publication and the execution turn** — the
schema supplies defaults, and the findings/conclusion settlements mutate them
as the round runs:

| Field | Default | Populated by |
|---|---|---|
| `source` | `"analysis"` | leave default unless the direction comes from `prerequisites` or the `user` |
| `source_urls` | `[]` | extracted from the settled findings' `信息来源` section |
| `created_at` / `updated_at` | `0` | store-level metadata |
| `epoch` | `0` | multi-run counter |
| `findings_file` / `conclusion_file` | `null` | Producer after validated artifact persistence |

**Schema discipline**: invented fields like `direction_name`, `is_selected`, `priority`, `estimated_hours` pollute downstream state and fail validation. Do not invent fields. The schema is exactly the output + managed tables above; nothing more.

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
3. Author the findings markdown below. When working serially, the Producer
   writes it directly to the owned working copy and validates the citation contract.
   When delegated, include the stable `artifact_file` in the task. The Worker
   writes and repairs that exact path; the Producer reads the file, checks the
   receipt, and updates the direction state.

When delegating a direction, include this bounded-evidence policy, the user's
explicit source/scope constraints, all of that direction's `research_points`,
and the complete findings contract below in the
Worker prompt. Search depth must not depend on whether the Producer performs the
direction itself or delegates it.

**Citations (Host-native Markdown links).** Every factual claim carries an
inline Markdown link copied exactly from a `web_search` or `web_fetch` result,
for example `[Official source](https://example.com/report)`. Never mint an SRC
token: the host does not expose a run-scoped token resolver to this
research execution. Use the actual result of each successful retrieval tool as
source evidence; tool arguments, report fields, and generated prose cannot
self-prove a source. The Worker, or the executor doing serial research, must
check every findings link and Markdown image URL against the evidence retrieved
for that direction before writing. The executor rereads every new or changed
findings artifact and checks its citations against the accepted direction
evidence before publication; do not assume another Worker's retrieval proves
this report's claims. Repair placeholders, malformed links, missing source URLs,
and URLs absent from that evidence in the same owned artifact. If retrieval
evidence is unavailable, leave the affected finding unaccepted rather than
claiming that it was verified. These are Agent review responsibilities:
`design_validate` enforces the installed schema and declared validation rules,
not a mechanical per-Worker citation-membership ledger. Passing structural
validation does not establish that a source supports the report's claim.
If no retrieved source supports a claim, qualify or omit the claim.

Read [reference/artifact-contract.md](reference/artifact-contract.md) for the shared findings sections, citation representation, conclusion document shape and activity bindings. Include that reference in every delegated brief. Live research still uses the retrieval/evidence policy above.

**No live evidence means failure, not degraded findings.** If `web_search` is
unavailable or retrieves no usable source after the bounded attempts, leave
that direction without a findings file; the Host attempt retains the reason. A delegated
Delegation failure is a tool failure, not an accepted artifact candidate. The
Producer either takes over that direction or leaves it unaccepted after its own
bounded evidence attempt. Never replace missing
live evidence with model knowledge, a fabricated URL, or an authentication-error
report. Other accepted directions may still support a partial round conclusion.

### Round conclusion (HTML slide-deck)

After all directions are settled, read the accepted findings and author ONE
complete, self-contained HTML document — a readable research synthesis grounded
in the findings; never invent numbers/sources. Organize it around the question
and available evidence, not a mandatory market-report template. The Producer writes it
to the round's owned conclusion path and validates it. Keep the canonical round
stage as the durable `confirmed` decision phase; the Panel derives
`researching`, `completed`, or `partial` from Host attempts and the accepted
findings/conclusion references.

Use the conclusion document shape in the shared artifact contract. Its content remains grounded in accepted findings; completion does not authorize new product decisions.

## How research changes the design evidence

Research adds external evidence about markets, products, users, competitors, and domain conventions, so it typically improves U. It does not automatically create modules, processes, acceptance criteria, or visual decisions; its S/T effect remains potential until the persisted findings themselves support a score change or a later selected skill incorporates them into a concrete design artifact.

After a round, explain what the findings clarified and recommend the most suitable alternatives only when concrete gaps remain. Research does not force a consumer skill or a fixed handoff; the user may choose an additive design step, ask questions, revise the research, or proceed to development when readiness is sufficient.

Common follow-ups (illustrative — **not** an exhaustive whitelist; pick the best match for the current state, including skills not listed and including editing a previously-completed skill):

| Research findings suggest                                       | Likely next move                                                  |
|-----------------------------------------------------------------|-------------------------------------------------------------------|
| Domain still ambiguous; new clarification questions surfaced    | `smart_questions` — primarily adds U evidence                     |
| Concrete competitor features / product modes uncovered          | `function_modules` — primarily adds S evidence                    |
| Workflow / role / approval pattern from analogous products      | `flow_design` — primarily adds S evidence                         |
| Visual / brand / UX conventions from references                 | `design_style` — primarily adds S evidence                        |
| Findings INVALIDATE earlier assumptions in a completed skill    | Re-run that prior skill with the corrected state (not a new one)  |
| Two skills are equally plausible for the biggest gap            | Two `next_design_tool_skill` alternatives so the user picks       |

The Producer is **not limited to this table**. Use the current request, persisted findings, concrete gap, and each skill's typical Δ to form suitable alternatives.
