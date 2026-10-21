# Native Design execution

The native Host owns spawning, concurrency, messages, cancellation and permissions. The
companion owns Design Files, Panels and the existing validation/Git/journal path.
Do not invoke a second model client, CLI process or app-server to simulate children;
for example, a second `codex exec`/`resume` is not native Codex delegation.
If native delegation is unavailable, report the limitation rather than claim
fanout succeeded. The Producer may perform the scoped artifact work itself.

## Common bridge

`serve` prints a private `connection` file path. Keep it inside the local task
context; do not print its contents or include its token in a shared artifact.
Prefer the plugin's MCP tools. Pass `connection` as that exact file path on each
call; no temporary request file or shell process is needed. Do not infer the
calling child's identity from the connection, which belongs to the main session.

| Existing operation | MCP tool |
| --- | --- |

| `prepareBundle` | `design_prepare_bundle` |
| `registerNativeRun` | `design_register_run` |
| `finishNativeRun` | `design_finish_run` |
| `focusArtifact` | `design_focus_artifact` |
| `prepareReview`, `bindReviewRun`, `submitReview` | `design_prepare_review`, `design_bind_review`, `design_submit_review` |
| `prepareReviews`, `readReview`, `bindReviewRuns` | `design_prepare_reviews`, `design_read_review`, `design_bind_reviews` |
| `claimReviewAction`, `settleReviewAction` | `design_claim_action`, `design_settle_action` |
| `mainContext`, `reportMainClarity` | `design_main_context`, `report_design_clarity` |
| `readReviewPolicy`, `updateReviewPolicy` | `design_read_review_policy`, `design_update_review_policy` |

### Main U/S/T after saved output

After meaningful saved output, `design_main_context` returns the saved
project/Kit/Git `input`, shared rubric, current assessment and KAG status.
Reuse useful current reasoning, or assess the evidence against the agreed
conversation scope and call `report_design_clarity`. New intent or corrected
reasoning can justify another report on the same checkpoint. Reports require
current project/Kit/Design evidence, not native transcript, turn or call-id proof.
An identical current report is reused. If Design evidence or Kit changed, read
fresh context and reassess; never relabel old reasoning.

Scores, reasons and their journal are project records tracked by Git. Reporting
does not alter Design Files or require a second evaluator/background GRA. Missing
or failed assessment never blocks authorized work. U/S/T guides evidence gaps,
not mandatory stages. Knowledge and GRA advice are independent; pending indexing
or unavailable background capability does not gate saving or ordinary design.

### Serial artifact focus

Before the main Agent or an existing native Producer begins work on one
artifact, call `design_focus_artifact` with the exact connection and either
`invocationId` from `design_begin_main_bundle` or the Producer's registered
`runId`. Supply `artifact_kind`, `artifact_id` and `artifact_file` together.
Keep the stable ID/path/kind identical when returning to the same target. For
example, after starting a Research main invocation:

```json
{
  "connection": "/exact/private/connection.json",
  "invocationId": "<invocationId returned by design_begin_main_bundle>",
  "artifact_kind": "direction",
  "artifact_id": "R-001/D-001",
  "artifact_file": "research/R-001/D-001.md"
}
```

Replace the illustrative connection and invocation values with actual returned
values. For Producer execution, replace `invocationId` with its actual `runId`;
never register the main Agent as a Producer. The generic Companion CLI `call`
operation exposes the same bridge method `focusArtifact` with camel-case
`artifactKind`, `artifactId`, `artifactFile`. This only associates observed native
activity; it creates no artifact, attempt, agent or acceptance receipt. Canonical
Bundle JSON, other Bundle paths, settled invocations and Worker owners are rejected.

Workspace `artifactActivities` carries the actual native executor and a
`logTarget`. Pass its `artifactId` and optional main `invocationId` with the
actual `runId` to `readExecutionLog`. Only rows after focus and before the next
target switch or Bundle settlement are returned. Returning to a target aggregates
its separate segments. Earlier main conversation history is not artifact work.
Rows already evicted by the bounded native observer are marked truncated;
unavailable or invalid native logs produce unavailable activity, never completion.
Native status and published artifact availability remain independent facts.


Parameters below are unchanged apart from the additional `connection` path.
Use `design_status` for a compact execution/clarity/handoff read when needed,
not as a polling loop. Keep large artifacts in files with native filesystem tools.
Ordinary status returns one assessment at `services.ust.assessment` and one
review list. Its Host protocol keeps current readiness, launch and optional
bootstrap fields; use `design_status` with `details: true` only when the complete
Host-specific protocol or workspace is needed. This option starts no work.
Preparation retains the complete Bundle method and shared execution instructions
once, plus structured ownership paths and validation argv. Settlement returns
commit/acceptance, recovery and necessary follow-up, not another copy of the
canonical files. Read those files only when the task needs evidence not already
available. A successful tool receipt need not be rechecked with a shell read.

If MCP tools are unavailable in this host/session, report that limitation and
use the existing CLI fallback: write a small request JSON outside `design_files`, then call:

```sh
node /absolute/plugin-root/scripts/design.mjs call \
  --connection /absolute/connection.json --request /absolute/request.json
```

Requests have `{ "method": "operation", "params": { ... } }` shape. This local
bridge does not dispatch agents. Use native spawning tools for that operation.
`call` uses the same compact model responses; `--full-response` explicitly reads
the original API response for diagnosis. It does not retry an operation. A
definite parameter rejection may be corrected; uncertain delivery of a write,
launch or notification is not permission to replay it through another transport.
The common operations below are available only while this companion is running.

## Producer

`prepareBundle` also returns shared `cooperationMethod`, `workerMethod` and
`knowledgeMethod` guidance. Apply cooperationMethod and knowledgeMethod in the
Bundle executor, whether main or Producer. Forward workerMethod and
knowledgeMethod along with a bounded task/evidence brief to native Workers.
Source locators and relevant excerpts avoid blanket rereads; exact assets and
validator inputs remain file-backed. Query KAG only when useful to the task,
passing actual returned pins to children; missing capability/pins fall back to
source files without blocking. These fields do not change native permissions.

Execution placement comes from `prepareBundle.execution.mode`: `subagent`
(also the default for older manifests) creates a native Producer; `main` runs
the same Bundle method in this conversation. Worker fanout is a separate Bundle
decision, not a consequence of this mode. Do not silently substitute a mode when
the host cannot support it.

For `main`, call `beginMainBundle` (`design_begin_main_bundle`) with the skill.
Keep its exact `invocationId`; this is a Bundle invocation, **not** a native run
ID. Read the returned method/resources yourself, maintain canonical JSON and
perform the same validation. Call `finishMainBundle`
(`design_finish_main_bundle`) with that invocation ID and the same scope/outcome
described below. Correct validation failures here before retrying settlement.
Cancel/wait for any Workers before settling; a new main Bundle cannot start until
the current one is settled. Never register the main Agent as a Producer child.
Completing the Bundle does not end the main conversation. A focused main artifact
uses its actual conversation observer and bounded target segments; no Producer
rolling log or attempt is fabricated. Real Workers retain ordinary status and logs.

The following child-registration steps apply to `subagent` mode:

1. Request `prepareBundle` with `{ "skill": "page_design" }` (the selected
   Bundle name, not a fixed Page default). Read the returned Bundle method,
   referenced artifact contract and the applicable Mindset. Pass a bounded user
   task, exact returned resource paths and the same project context to a native
   Producer child. The parent owns registration; the child does not scan sessions
   or rediscover the installed Bundle. A not-yet-created output directory is normal.
2. Register that child using `registerNativeRun`: `role: "producer"`, `skill`,
   `artifactId` (Bundle name for its root), and exact native `runId`. For `host=codex` only,
   an exact `launchCallId` or uniquely recorded `agentPath` from native spawn can
   be supplied instead. The adapter resolves paths inside the bound host session
   storage; do not search or print session metadata. Parent defaults to the main
   conversation; a Worker of a Producer must supply its real Producer parent ID.
   Explicit `transcriptPath` (and Qoder `taskPath`) remain supported. Native
   metadata must prove the parent/child relationship and the native cwd supplied
   to `serve --host-cwd` (not necessarily the Design Project root). Never
   select a newest log or fabricate IDs. If metadata is not yet written,
   register after it becomes available; don't respawn a duplicate child.
3. The Producer maintains canonical JSON, preserves user edits and coordinates
   artifacts. Workers can write distinct artifacts; only the Producer edits
   the shared JSON. Producer takeover remains available. A missing reference
   means planned, not completed; do not insert execution statuses into JSON.
4. On child completion or an intentional user handoff, call `finishNativeRun`
   with its `runId` and `scope: "completion"` or `scope: "state"` respectively.
   This reads files directly, runs shared validation, and uses the existing
   Bundle Git publication path. Fix actionable diagnostics in the generator.
   On failure/cancellation call it with `outcome: "failed"`/`"cancelled"` to
   audit existing facts; Git cadence does not depend on design success.
   In WorkBuddy's ordinary foreground path, the child returns after authoring
   and optional preflight; main settles its exact registered run after that
   return. Main never repairs the child's files. Validation rejection goes back
   to the same Producer before another finish. An accepted settlement closes
   that invocation; another revision needs a new attempt. Repeating the same
   settled scope/outcome returns its receipt, not a new publication. A committed
   recovery receipt retains its own specific recovery instruction.

Native terminal events, not this bridge call, drive execution indicators. Panel
content is read from files even before settlement. If the Producer forgot the
settlement call, the parent performs it once; don't rerun generation just to
obtain a publication tool call.

## Worker

For independent artifacts, follow the Bundle's delegation method. The native
parent is the Producer in `subagent` mode or the main Agent in `main` mode.
Give each Worker the artifact contract, its concrete task, existing shared
design inputs and exact `artifact_id`, `artifact_kind`, `artifact_file` from
the Bundle. No additional task schema is required in `skill.yaml`.

Register each actual child with `registerNativeRun`, `role: "worker"`, its
native `runId`, Producer `parentRunId`, exact native `transcriptPath`, `skill`,
`artifactId`, `artifactKind`, `artifactFile`. This maps native events/logs to the
correct entity and round. Do not reuse one child's identity for several files.
When the parent is the main Agent, supply its actual `parentRunId` and the exact
`invocationId` returned by `beginMainBundle` as well. Do not invent an intermediate
Producer. The main Agent then performs the same JSON integration duties below.

Workers write artifacts directly in `design_files`, use Bundle file-oriented
scripts for required layout/validation and repair diagnostics before returning.
Return only the path and compact validation result, not the complete HTML/XML.
The optional `finishNativeRun` call returns a compact file receipt. The Producer
updates canonical references as each Worker finishes, without waiting for the
remaining Workers. All workers must finish or be cancelled before the Producer
settles its Bundle. Do not hide failure by substituting another file.

## Mapping existing Bundle tool terminology

| Bundle operation | Native Host operation |
| --- | --- |
| `design_delegate` | Native child spawn, followed by exact run/target registration |
| `read_skill_resource` | Read the referenced file under returned Bundle resources |
| `list`, `read`, `write`, `edit` and worker artifact tools | Native filesystem tools on the same Design Files project |
| `run_skill_script` | Native shell, run the actual Bundle script with its documented file-path arguments; use Design Files as cwd |
| `design_validate` | Packaged `validate --project … --skill … --scope …` |
| `design_publish`, `design_finish` | `finishNativeRun` for a Producer, `finishMainBundle` for main execution; state scope preserves the same handoff |

These mappings adapt execution, not the Bundle's schema, generation method or
validation criteria. Native permissions remain authoritative. Never disable
approvals or install dependencies silently to make a task pass.

## GRA and U/S/T

### Shared Design KAG

All Bundles can use the same stored graph; it is not a required preliminary
workflow. When a task needs cross-file evidence, `design_knowledge_context`
returns availability, a bounded starting context and the shared reading method.
Use `design_query_knowledge` for more: preserve its exact `project`, `checkpoint`
and `revision` pins, select source files or original entity IDs, then traverse
one-hop `incidentTo` neighborhoods with `direction` and optional `relationTypes`.
Pagination must retain the same filters. Read the referenced files to verify
facts; similarity is a candidate, and isolation or partial search is not proof
of a missing design. If pins become stale, restart the bounded investigation
from a new context rather than mixing versions. Unavailable graph access does
not block normal source-file work or authorize repeated retries.

The packaged local embedding runtime uses cached model weights by default. If
weights are missing, file projection still works and semantic coverage reports
an error, not completion. With the user's agreement to download model weights,
start Companion with `--allow-embedding-download`; text remains local. Use
`--disable-embedding` for structural-only operation. Do not silently change to
a cloud embedding endpoint. Packages include native inference dependencies for
their recorded build platform/architecture, not every operating system.

GRA's existing result may include evidence-backed relationships or justified
retractions of its own prior relationships; it does not edit Design Files.
Use exact IDs and the supplied output schema. Empty results do not clear graph
state. A negative search conclusion belongs to that review's checked scope and
file revision, not an enduring “missing” fact; reassess after source changes.
Clarity reads evidence but does not maintain relationships. Service-managed
reviewers receive a fixed read replica and read-only query helper when available;
they must not contact the main session or use its MCP connection.

### GRA execution choice

First read this connection's `design_status.hostCapabilities`, `reviewDispatchOwner`
and `reviewPolicy`. Background capability and review capability are different.
If background execution is unavailable or keeps the main conversation occupied,
do not launch an automatic foreground
substitute or claim that a synchronous Agent call proves background execution.
When GRA is requested or useful pending work needs a decision, explain the limit
and offer: **turn off automatic GRA, keeping manual checks**, or **run this check
synchronously in the main conversation, temporarily occupying it**. Use the
Host's native question tool when available, otherwise ask in ordinary conversation.
Do not repeatedly ask on status reads or reinterpret silence as consent. Until
the user chooses, preserve requests and policy and continue authorized work.
Only change the existing review policy to `off` when the user chooses that option:
read it with `design_read_review_policy`, then pass the same policy fields with
`mode: "off"` to `design_update_review_policy`. Do not reset its other settings.
Manual GRA remains available while off, asynchronously when supported or through
the confirmed synchronous path below. Main U/S/T, KAG and Panel saving remain
independent; unavailable background execution must not gate them.
An asynchronous launch receipt alone does not prove that the Host can answer a
new main-conversation message while reviewers run. Use known current Host limits
or observed user behavior, not a guessed setting or a fabricated responsiveness
probe. The same choice applies across Hosts; do not equate this interaction limit
with failed review results or falsely relabel the actual native execution mode.

### Confirmed main-conversation GRA

After the user accepts the temporary interruption, call `design_recheck_reviews`
with a stable `requestId`, `executionMode: "foreground"` and the relevant
`userContext`. This authorizes this manual batch, not permanent automatic
synchronous review. Normally omit `profiles`: the default is grounding,
reflection and alignment, not a second U/S/T evaluator. A new user request needs
a new ID; retries of the same request keep the ID and execution mode unchanged.
For each returned request with `dispatch: true`, use `design_read_review` to read its exact prompt,
evidence pins and schema. Perform that bounded read-only assessment here, then
call `design_submit_review` with `{reviewId, result}` and the exact connection.
The manual foreground request does not need a `nativeRun`, a child bootstrap,
background readiness proof or a new model client. Do not bind a native child to
this request. Existing schema, freshness and advisory publication still apply;
an empty findings array is valid and suggestions are never auto-accepted. Reused
completed requests are not permission to repeat the assessment.
Do not relabel a background request or reuse its ID as foreground. Foreground
completion does not establish or change background readiness; record this as a
foreground check. On completion, return control to the user. Skip the background
launch procedure below for this batch.

### Background dispatch

The remaining native launch instructions require available background execution
and an exact `dispatch:true` reference. If it is unavailable, keep background
requests pending and use the user choice above rather than starting real reviews
as probes. Clarity remains a separate main-Agent assessment.

For WorkBuddy, read `design_status.hostCapabilities` immediately before any real
review dispatch. Its `backgroundReviewReadiness` must be `ready`; the public
`backgroundReviewProtocol` alone does not prove capability. WorkBuddy 5.8.3 can
silently execute `Agent(run_in_background=true)` synchronously when background
capability is disabled. Never use a real review prompt to test this. With
unverified readiness, keep reviews pending and explain the normal Host capability
gap. The protocol includes a content-free readiness bootstrap that may be run
explicitly; it returns immediately without reading files, using tools or
assessing Design. Read status again afterwards. Do not change private Host
settings or automatically repeat the probe. Only a native descriptor created
after this exact Companion connection opened proves readiness; an old descriptor
in the same session is insufficient after restart.

Once ready and given an exact prepared review reference, use the ordinary native
`Agent` tool with `run_in_background=true`. Bind its structured `subAgent.sessionId`
task ID and exact background descriptor to that review; never use a teammate name,
assistant text, synchronous `lastId` result or a guessed log. The adapter verifies
the actual parent call, session, cwd and child path. Spawn RPC completion proves
only launch, not review completion. WorkBuddy's `TaskOutput(task_id, block=false)`
structured `agent-output` receipt supplies native status. Externalized/missing
status or newer unbound child activity remains unknown. Do not follow paths in
tool text, busy-poll, wait for review completion or block the main user task.

QwenWork has a separate native background contract. Read its current
`hostCapabilities.backgroundReviewReadiness` and `backgroundReviewProtocol`;
only `ready` permits background review dispatch. An explicitly requested content-free
bootstrap may establish readiness after this exact connection opened, but never
repeat it automatically or change Host settings. Its structured parent
`tool_result` must contain `isAsync: true` and `status: "async_launched"`, matched
to that exact native Agent call and the Host's task descriptor. A textual Agent
ID, synchronous fallback or older task is insufficient. Each actual review must
independently satisfy this proof when bound; bootstrap success is not a review
launch. Bind the actual native `agentId` as `runId`, plus its exact `taskPath` and
child `transcriptPath`. The QwenWork adapter observes native task status and
child evidence; do not copy WorkBuddy's version-1 descriptor or `TaskOutput`
contract, infer completion from the Agent RPC, busy-poll or wait in the foreground.
Unknown/unreadable native evidence remains unavailable. The installed-version
contract and limitations live in the QwenWork integration entry.

When `design_status` reports `reviewDispatchOwner: "companion"`, or preparation
returns `dispatchOwner: "companion"`, the service owns background review execution.
Do not prepare, spawn, bind, follow up, or wait for reviewer children. Continue the
user's design work; review results appear in the existing background area,
advisory queue and clarity score. The native-child instructions below apply only
when the main Agent owns dispatch. Enabling `serve --background-reviews` is an
explicit account-quota decision, not something to enable silently during setup.

Successful Panel saves and Bundle publications automatically admit KAG maintenance;
graph reads and Worker drafts do not trigger it. `design_status` also exposes the
project `reviewPolicy`: auto combines Agent initiative with a publication rule
after a configurable quiet window (default 30 seconds), continuous checks the
latest published checkpoint every configured N minutes even without file changes,
and off forbids autonomous GRA but still permits an
explicit human `design_recheck_reviews` request in either supported mode. Change
this policy only for an explicit user choice. Clarity is independent. In native-dispatch mode the rule queues a notice
with exact prepared review IDs; it does not itself spawn native children. Queue
acceptance is not execution, and uncertain delivery must not be blindly replayed.

Save/finish responses and `design_status` expose the same derived `reviews`
summary. It is a read-only reminder. `due` means evidence or
observed editing scope needs review; `prepared` means a request exists but is not
bound. Inspect/reuse it rather than blindly spawning a duplicate. `running` is
not a result; `unsubmitted`, `failed`, `interrupted` and `unavailable` require
inspection, not a claim that review passed or an automatic retry loop. Do not
poll in the main conversation or wait for reviews before continuing user work.

For useful Agent initiative in auto mode, use one
`prepareReviews` call, normally omitting `profiles`; it bypasses the rule's wait
and reuses current work. Do not mechanically call it after every save. In off
mode use `design_recheck_reviews` only for an explicit human request, with one
stable requestId across retries, without changing the policy. The service
considers the three GRA profiles, reusing current requests without dispatching
duplicates. Main U/S/T does not require another clarity reviewer. A paraphrased
context does not create a new default review. Explicit `profiles` remain for a
user-requested scoped reassessment or diagnostics, not arbitrary omission and
later catch-up rounds. These remain independent reviews, not one merged review.
Only entries with `dispatch:true` authorize a new launch in this batch. Reused
prepared requests require inspection of any prior launch before recovery; do not
spawn duplicates after an uncertain response. A batch shares preparation context,
not an immutable file snapshot: `revisionChanged:true` means do not dispatch it.
An explicit publication-rule notice is different: its exact requests deliberately
pin immutable historical Git commits. Read only that checkpoint, not live files;
historical results cannot become current advice, Clarity, or KAG observations.
WorkBuddy requests also pin committed evidence for Agent-initiated preparation;
follow each exact request's checkpoint and `design_git_read` pagination contract.
Pass `userContext` with the current user request, relevant requests to simplify
or defer, and concrete work still being edited. Do not invent user preferences.
Observed running targets are not exclusions: an Agent can still be alive after
settlement or resume after a pause. Review saved evidence and avoid judging
in-progress output as complete. Report any coverage limitation separately to the
parent; when that editing scope clears, check for a follow-up review even if the
file revision did not change.
The response supplies short request references. Reviewers use `readReview` with
their exact `reviewId` and `connection` to obtain the full prompt and schema;
the parent need not read or rewrite them. Native reviewer requests supply KAG
query pins rather than preloading graph contents; use the existing pinned
knowledge query and source-file readers for the evidence actually needed.
The reviewer starts from the project file directory and its profile's question,
selects relevant sources and follows references as needed. Complete each source
page it relies on, preserving the request's pins; reading every project file,
all Git history or every graph node is not a submission prerequisite. KAG is an
optional discovery aid, and findings must be verified against the pinned Design
Files. Disclose a meaningful coverage limitation rather than claiming an
exhaustive review. The reviewer does not repeat the Producer/Worker setup,
Host-readiness checks or task-list bookkeeping before investigating.
Binding returns a compact status receipt, not the review materials. Do not dump
Design Files into the parent.

Spawn independent native **background** review children from the main Agent.
Give each only its review ID, connection path and instructions to read its request
and submit its own structured result. Include that exact review ID literally in
the native Agent prompt. WorkBuddy and QwenWork verify both the current launch
boundary and this request assignment on first binding; an old task or READY
probe cannot become a new Reviewer, even when it belongs to the same session.
Exact already-bound historical evidence remains readable after reopening.
Launch independent children together when
the host supports it. Use one `bindReviewRuns` call with
`{bindings:[{reviewId,nativeRun},...]}` for the exact native launch results;
`nativeRun` can contain just the actual `runId` (or, for `host=codex` only, an exact launch reference
as above); the service fills paths and verifies native evidence. Do not send
reviewers to scan logs for their identity. Inspect per-entry errors: partial
success is possible, and successful bindings must not be relaunched. Never guess
the latest log path. The child reads the registered binding from `readReview`
before submission, eliminating a separate parent message carrying that binding.
It may read evidence while binding is pending. If still unbound when ready to
submit, report the pending binding and yield; do not poll or claim success.
If that same child has already yielded for binding (or ended without submitting),
after successful binding use one native follow-up/resume to tell it to read its
registered request and submit. Reuse the same child, not a new spawn. This is
recovery for an early finish, not a mandatory message for every running reviewer.
If the request is superseded or its revision changed, report that limitation;
do not present the old assessment as current. A reviewer
may handle another bounded profile or later revision with its own review ID and
schema; this does not reuse the previous result or grant editing authority.
Submit with `submitReview` params `{reviewId, nativeRun, result}`. The child may
read evidence while registration completes, but cannot publish before binding.
The single-review prepare/bind tools remain compatibility paths, not the default
multi-profile orchestration. Do not use them to reproduce separate preparation rounds for the default batch.
If a user save or message arrives during preparation, handle the user's work
first. Reconcile the existing requests at the next settled checkpoint, without
automatically completing the old batch or restarting it in the foreground.
Do not synchronously wait for GRA or treat review completion as a prerequisite
for foreground generation, user interaction, or a successful Bundle result.
Use native notifications for completion; no busy-loop polling or unbounded
self-respawning. A subsequent settled change can start the next bounded review.

The reviewers have no authority to edit Design Files or automatically accept
advice. Use `submitReview` for structured result publication, preserving the
exact review ID/native child binding returned by `readReview`; the service owns
identity and freshness validation, so the reviewer does not rediscover its
permissions or inspect session logs. Follow the returned result schema with
native JSON types: for example, `schemaVersion` is the number `1`, not `"1"`,
and array fields use `[...]` or `[]`, never `{ "item": [...] }`.

An explicit field validation rejection permits one correction of the identified
field against that schema and one retry of the same review. If it fails again,
or delivery/acceptance is uncertain, return the concrete diagnostic and known
submission status to the main conversation, then yield. Do not restart the
review, blindly replay an uncertain submission, scan sibling transcripts or
inspect Companion/Host implementation and internal state through shell commands
to repair the transport. A successful submission receipt, not a local result
file or the child's final prose, establishes completion. This is a bounded
reviewer recovery instruction, not permission for the main conversation to wait,
poll or submit the child's result on its behalf.
An accepted advisory with `knowledgeError` is already submitted. Report that
optional graph warning without resubmitting or withholding the accepted advice.
Do not force stale results onto newer project evidence. UI reads and polling
must never launch reviews. Native permission/cancellation remains with the Host.

GRA and U/S/T are distinct: U/S/T updates assessment; GRA contributes suggestions
to the shared advisory inbox. Only a real user acceptance dispatches a scoped
foreground action with the original exact action receipt. Queue acceptance is
not proof that the action started or completed.

For an accepted action in `main` mode, begin the exact target main Bundle and
claim it with `{receiptId, invocationId}` before editing. After file settlement,
use that same pair to settle the action; the main session need not end. A failed
claim grants no permission to execute the advisory.

For an accepted action in `subagent` mode, spawn the exact target Producer initially instructed to
wait before editing. Register its actual native identity, then call
`claimReviewAction` with `{receiptId, runId}`. Only after a successful claim send
the native Producer permission to begin this scoped action. After file settlement
via `finishNativeRun` and the native terminal event, call `settleReviewAction`
with `{receiptId, runId}`; the bridge derives the outcome, not the caller.
If claiming fails, cancel the waiting child and report the diagnostic. This is
workflow coordination, not a replacement for native host permissions.

## Return control to the user

After the foreground Bundle settles, honor any already requested next task.
Otherwise briefly explain the result and, when a user choice is needed, offer
the most relevant next steps through the host's native question tool if it is
available in the current mode. Do not wait for GRA; use available evidence and
report unavailable clarity honestly. Ask about consequential choices, not routine
bookkeeping, and retain the option to adjust or stop.

If the native question tool is unavailable in this session/mode, do not omit the
next-step choice: ask one concise question in the main conversation with concrete
options and a short recommendation, including adjusting or stopping where useful.
A recommendation sentence alone is not a choice handoff: finish with an actual
question the user can answer, such as “继续梳理核心流程，还是先调整这些功能？”.
Do not invent a native question event from that prose, enable experimental host
features, or change collaboration mode to force a question tool to appear.
Use the tools actually exposed by the current host; a tool name in this document
does not make it callable. Do not switch modes or launch another host to manufacture a question
tool. The companion's message queue is not a native-question answer channel;
never present a queued message as an answer to a pending native question.

## Development handoff and existing specs

When the user requests implementation or a development brief from a Design Project, use the selected project and the specified coding workspace; this is not a request to run another design Bundle. Confirm the actual project root, Kit pin and published design checkpoint with available host readers. Keep unpublished differences separate. Read only the records and artifacts relevant to the authorized task; KAG is a discovery aid, not a substitute for those originals, and unavailable or partial knowledge does not prevent reading the files.
Inspect the target repository's instructions and existing specs before proposing an output location. Recognize GitHub Spec Kit's specs/<feature>/spec.md, plan.md and tasks.md; OpenSpec's openspec/specs/<domain>/spec.md and openspec/changes/<change>/ proposal, spec deltas, design and tasks; and Kiro's .kiro/specs/<feature>/requirements.md, design.md and tasks.md. Preserve the actual repository's structure and responsibilities, including its current-spec versus proposed-change distinction. These paths are discovery hints, not permission to create every file or assume a framework is active. If several conventions coexist, follow the one governing this task; if none exists, propose an existing convention or an ordinary Markdown brief and resolve the location before writing. Do not install a framework or invent a Yugoo spec schema.
For the task-scoped brief, use ordinary Markdown links to the actual design source paths, relevant artifact paths and precise record IDs or JSON pointers, with the project, Kit pin and verified published checkpoint beside the links. Use relative links where the target workspace can resolve them; disclose external project paths instead of claiming they are portable. Do not invent a remote URL, copy all design artifacts, or treat a prototype, inference, score or unanswered field as a confirmed requirement. Organize the affected user behavior and scope, important exceptions and constraints, implementation tasks and observable acceptance criteria in the repository's existing requirement/design/task sections; keep design decisions, implementation proposals and unresolved product decisions distinct.
Produce the brief before coding when scope needs agreement. Existing user authorization carries forward; ask only about consequential unresolved scope or product decisions. Updating target specs or code requires that workspace's authorization, and this guidance grants none. Implement only the agreed slice and report checks actually run. For a design change, return the discrepancy to its owning Bundle's ordinary validation and publication route; after publication, update only affected spec links, tasks and acceptance criteria against the new checkpoint. Development specs and code do not write back to Design Files or silently become design authority. No second requirements store, automatic bidirectional synchronization or required full-project rewrite is introduced.
