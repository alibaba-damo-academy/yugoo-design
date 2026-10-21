# business_data output contract

For canvas generation or revision, read [the canvas guide](canvas-guide.md).
It supplements the existing methods and output contract; it applies to both
new design and reconstruction without replacing domain-specific rules.

## Source-to-business-object judgment

For new design, derive information from the lasting business things required by
the agreed scenarios, not a generic database template. For reconstruction,
trace how the product creates, identifies, reads and changes those things.
Tables, DTOs, caches and joins are implementation evidence, not a one-to-one
business object list. Translate only supported user-meaningful information;
a technical join does not by itself establish composition or inheritance.

Verify field requirements against relevant behavior and conditions, not only
a nullable column or a sample record. An enum does not prove every state is
reachable. Check both directions of a relationship before assigning quantities;
one observed example does not establish a maximum. Preserve evidence limits in
existing descriptions or the handoff, without adding provenance/status fields
outside the schema. When a required representation cannot faithfully express
the source, report that limitation rather than inventing a value.

For revisions, distinguish a source implementation change from a requested
design change. Preserve unaffected saved vocabulary and IDs; explain conflicts
with user decisions instead of silently importing a new database-shaped model.
Check the result against a concrete source-backed usage situation, separately
from schema validation.

Canonical state is `business_data/business_data.json`. This contract is shared
by ordinary design, saved-panel continuation and reconstruction. Read it through
the installed Bundle resource root. Schema and validation are authoritative;
examples are hypothetical, never user evidence.

## Meaning and ownership

A business object is a lasting, user-recognisable type of thing, not a database
table, screen, action or report. Fields describe the information needed to
recognize or use an instance. States name situations, not transitions.
Relationships describe connections between those object types; they are not
another collection of business objects. Workflow behavior, permission,
calculation and storage design remain with their existing owners.

Walk an established usage situation. Can the reader distinguish the intended
instance when display names repeat or change? Use evidenced business information;
do not invent foreign keys, audit columns or technical timestamps.
For an association, explain what connects the instances, quantity in both
directions when known, and any evidenced ownership/deletion implications.
Missing evidence remains a named open decision.

## Existing state

Keep `schema_version: 3`; `web_app` and this Bundle remain version 1.0.
`objects` is keyed by stable ID. `object_order` contains every object key once.
Each object has `id`, `name`, `description`, `fields`, `field_order`,
`states`, `state_order`. Keys equal nested IDs. Field/state order lists
cover their own maps exactly once.

Fields: `id`, `name`, `meaning`, `value_type`, `requirement`,
`required_when`, `example`, `options`. Value types are `text`,
`long_text`, `number`, `amount`, `date`, `date_time`, `single_choice`,
`multiple_choice`, `yes_no`, `file`, `other`. Requirements are
`optional`, `always`, `conditional`. Only conditional requirements use
a nonempty `required_when`. Choice fields use unique visible `options`;
other fields use `[]`. States contain only `id`, `name`, `meaning`.

No approval flags, initial/terminal flags, technical storage or arbitrary keys.

## Optional relationships

`relations` is an optional stable-key map. Existing v3 files without it remain
valid and need no migration. Omit it or use `{}` when no relations are known.
There is no `relation_order`: relations are not a sequence, and views derive a
deterministic display by stable ID. Do not introduce order as a second fact.

Each closed relation record has:

| Field | Meaning |
| --- | --- |
| `id` | Equals its map key; rename does not change it. |
| `kind` | `association` or `generalization`. |
| `name` | User-readable relationship verb, such as 引用 or 是一种. |
| `source` | Stable ID of an existing object in this same file. |
| `target` | Stable ID of an existing object in this same file. |
| `description` | Optional plain-language meaning, constraints and uncertainty. |
| `source_count` | Association only: number of source instances for one target. |
| `target_count` | Association only: number of target instances for one source. |

Association quantities use `1` (exactly one), `0..1` (none or one),
`1..*` (one or more), `0..*` (none or more). A missing quantity means
undecided; do not store an empty string, a UI label, or a fabricated default.
For “project references paper”, `target_count` describes papers per project;
`source_count` describes projects per paper. The panel renders Chinese
sentences rather than symbols. A same-type association can be valid
(e.g. task depends on task); do not apply inheritance restrictions to it.

Generalization connects subtype `source` to parent `target` and contains
no quantity fields. It means “an experimental project is a kind of project”.
It does not mean “a project contains an experimental project”, a concrete
instance belonging to a class, or provenance “generated from”.
Self-inheritance and any inheritance cycle are invalid. Multiple parents are
permitted; a diamond is not a cycle. Store coherent evidence, not an OWL
reasoner or an unbounded relation inventory.

Inherited definitions, fields and states remain at their parent. A subtype
stores its own additions and may have no local fields; never copy parent
fields just to satisfy a field-count check. The form displays local fields
and links to parent definitions. It does not compute a merged effective-field
schema. If multiple parents define conflicting information or requirements,
report the conflict and obtain a product decision; do not silently choose
one or overwrite definitions. Downstream rule/access/PRD consumers continue
to read explicitly declared records and relationships; they must not assume
a computed inheritance closure or generate duplicate field IDs.

## Editing and consumers

Form and canvas share this one canonical file. Renaming keeps stable endpoints.
Removing an object removes all incident relationships in the same state edit;
removing an edge preserves the endpoint objects. Preserve unaffected fields,
states, quantities, names and relations on partial revisions. Splitting or
merging a type requires deliberate repair of its endpoints.
A panel save already persisted the edits: never replay that diff.

Canvas coordinates, hover state, selection, collapsed branches and viewport
are presentation state and never written into Design Files. The canvas shows
object summaries and relationships. Node hover offers details that return to
the selected object's existing form, revealing its parent branches. Line
Chevron toggles and controls reuse the native Panel style.

Reference annotations on `source`/`target` let the existing KAG projection
resolve exact endpoints. Relation names, descriptions and quantities remain
source evidence for GRA. An identifier/reference edge alone does not declare
a new business inference; read the owning relation. The native generic
summary reports collection counts; read canonical records for substantive
reasoning. PRD assembly explains declared relationships in ordinary language,
including unknown quantities, instead of inferring unsupported inheritance.

## Example and checks

Read [the complete example](example.json): Project, Experimental Project and
Paper, including inheritance and a many-to-many association. It is not a
proposal for the user's scope.

Validate shape, map-key identity, object order, endpoint resolution, absence
of quantities on inheritance, and inheritance cycles through the Host's
actual checkpoint. At completion every present relation has a nonempty name.
Root objects should have the grounded information needed by current usage;
subtypes may inherit it without local copies. Professional self-checks:
distinct meanings; field/state names and meanings; visible unique options;
conditional requirements; exact local orders; no unsupported relations.
Preserve intentional unknowns instead of manufacturing a complete ontology.
