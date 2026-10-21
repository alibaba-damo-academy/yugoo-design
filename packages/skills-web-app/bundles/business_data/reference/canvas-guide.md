# Business object relationship canvas

This is the shared design/reconstruction reading entry, not a new data model.
Read [the output contract](artifact-contract.md) for complete field meaning,
association quantities, subtype inheritance, examples and validation. Ordinary
design also follows the existing Bundle SKILL; reconstruction preserves source
facts rather than applying new modeling preferences.

## Facts and meaning

`business_data/business_data.json` owns objects and named relationships. Stable
object/relation IDs bind the graph and form. Nodes are durable business types,
not pages, actions, database tables or concrete instances. Association and
generalization are distinct. Subtype source points to parent target; composition,
instance membership and provenance are not inheritance. Preserve quantities and
unknowns; parent fields remain at the parent, not copied onto child records.

## Layout, routing and unknowns

The declaration uses the shared `relation_graph`, with object summaries and
selection returning to the original object form. Placement/grouping is a view,
not a new business fact. Coordinates, viewport and collapsed branches are not
saved here. The installed renderer owns layout, ports and label avoidance;
do not generate private diagram coordinates or apply AI's three-layer layout.
Readable association/generalization labels and their direction must follow the
actual relationship. Genuine density is not evidence that a relation is wrong.
Missing/conflicting facts stay explicit; never infer quantities or effective
multiple-inheritance conflict resolution from visual proximity.

## Interaction, saving and examples

Use the existing same-source editor/atomic save path. Renaming preserves IDs;
removing a relation preserves objects; removing an object repairs its incident
relations in the same state edit. Do not reapply an accepted Panel diff.
Read [the existing synthetic example](example.json), not a second preview.
Check association versus inheritance, both quantity directions, unresolved
endpoints, cycles/self-inheritance and allowed multiple-parent diamonds.
Review labels, resize/long text/narrow canvas and selected-record identity with
a real view when available; report schema, rendering and save/reopen separately.
No existing example or written rule establishes actual rendered acceptance.
