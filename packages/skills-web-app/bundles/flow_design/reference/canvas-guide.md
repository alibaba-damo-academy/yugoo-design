# BPMN process canvas

Shared design/reconstruction entry. Preserve the complete [flow output
contract](artifact-contract.md) and [BPMN authoring contract](bpmn_authoring.md).
They remain the exact format, lane grammar, node semantics, example and file
validation/layout authorities. This guide is an index, not a parallel BPMN spec.

## Sources and semantics

`flow_design/flow_design.json` owns the plan/order and accepted BPMN file refs;
each bound `flow_design/<process_id>.bpmn` owns that diagram. Use established
triggers, supplied role names and product behavior, not invented automation.
Processes/lane participants/tasks/events/gateways/flows retain BPMN meanings.
For reconstruction preserve observed policy and exceptions; ordinary design
uses the existing SKILL's product-boundary and process-granularity methods.

## Layout, routing, labels and missing evidence

Use the installed Bundle's structure-validation → layout → final-validation
pipeline by file path. The layout script produces BPMN DI; never hand-author a
second layout or patch truncated output. Lane labels use actual supplied names;
the built-in System ID and the exact lane/stakeholder name follow the contract.
Ports/bindings and routing remain BPMN/layout behavior, not the AI midpoint rule.
Review readable node/condition labels and real branch/return meaning; valid DI
does not prove readability or correct process semantics. Missing sources stay
unknown; a plan path is not an accepted file. Do not invent a task merely for
lane balance or treat dense real flows as permission to remove branches.

## Interaction, saving and acceptance

The `diagram_workspace` reads the canonical descriptor and exact BPMN artifact;
describe only the installed editor's supported actions. Serial authors/Workers
validate/repair their own bound file; the owning executor integrates the accepted
ref and uses existing publication. XML never becomes an inline JSON graph.
Read the existing complete example in `bpmn_authoring.md`; no new sample authority.
Check invalid XML, bad role/lane/endpoint semantics and missing/final-DI failure
through the actual validators. With an available view inspect one meaningful
branch/return and resize/readable zoom; report parser/layout, rendered review,
save/reopen and native execution separately. Do not claim process execution.
