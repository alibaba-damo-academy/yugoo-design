# Role inheritance canvas

Shared representation entry for design/reconstruction. Read [the output
contract](artifact-contract.md) for role/policy meaning, assignment, verification,
single-parent inheritance, deletion scope and supported uncertainty. Retain the
existing SKILL's permission methods; do not replace them with graph aesthetics.

## Facts and relationship semantics

`role_access/role_access.json` is the only role/policy/inheritance authority.
Nodes are permission sets, not job titles or workflow participants. Optional
inheritance edges point from child `source` to parent `target`, kind `inherits`.
Inherited policies retain their originating role, conditions and confirmation
steps; assignment is local. Neither proximity nor a parent edge grants broader
access, copies policies, or defines conflict precedence.

## Layout, ports, labels and unknowns

The current declaration uses the shared `relation_graph` and original-record
inspector. Its renderer owns geometry/ports/label avoidance; Bundle generation
does not persist another tree, coordinates, ancestor list or effective-policy
map. Flat saved data may have no edges and remains flat. Do not add an edge to
populate the canvas or adopt AI model/knowledge bands. Show the meaningful
inheritance direction and originating permissions. Missing coverage is unknown,
not proof of denial. Unsupported multiple-parent/multi-role behavior and an
unresolved local/inherited conflict must be reported, not flattened or guessed.

## Interaction, saving and review

Canvas/form edit the same roles and inheritance records. Removing an edge leaves
roles/policies intact. Removing a role removes its own local policies and
incident edges, preserving other records; parent edits can affect descendants.
Use the existing validated save path; already-saved diffs are not replayed.
Read [the existing synthetic chain](example.json), not authorization evidence.
Check stable IDs, one parent, self/cycle/dangling/duplicate edge negatives and
source-preserving inherited details. Inspect a real chain and flat view for
readable labels, selected identity, keyboard/resize/narrow-container behavior;
report rendering and durable save/reopen independently from schema checks.
