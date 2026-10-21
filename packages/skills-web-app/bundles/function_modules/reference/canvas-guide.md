# Function capability-map canvas guide

Read [the output contract](artifact-contract.md) for the complete function,
local specification, pinned-source and explicit-conversion methods. This guide
supplements those methods; examples are not evidence about the user's product.

## Purpose and evidence

Use the map to orient the user among product capabilities and their Epic groups,
not to describe Agent collaboration or implementation dependencies. In new design,
derive capabilities from user outcomes; in reconstruction, follow evidenced entries,
behavior and outcomes. During revision preserve saved decisions, rejected functions,
local details and references. Missing coverage is uncertainty, not an absent feature.

## Representation and canonical facts

The implemented `record_board` contains a read-only navigation mindmap as well as
the grouped cards. Each function is one canonical entity. `function_epic` is a
grouping label; the canvas projects group-to-function membership from it. Epic
nodes and connecting edges are display objects, not new persisted entities.
Do not add edge collections, graph coordinates, separate Epic records or duplicate
membership lists to the state. A group label is not an independently verified
business relationship. Keep stable function keys when labels change.

## Generation and layout responsibility

First identify user-facing functions at consistent granularity, then group them
by user purpose, then check the canvas and cards against the same facts. Retain
real administrative capabilities when administration is part of the product.
The current renderer lays out a horizontal mindmap; it owns temporary node
positions and routes. The Agent authors the function map, not view geometry.
Do not impose AI three-band anatomy or infer sequence from the map's positions.

## Interaction, uncertainty and density

The current map is navigation, not a draggable or connectable graph editor.
Use supported selection/detail affordances and the existing card/form save path;
viewing must not migrate state or erase optional details. Rejected functions remain
canonical records and use the existing filter/restore behavior, not deletion.
Unknown details can remain absent. Preserve readable group labels and node titles;
dense content needs navigation/zoom or filtering, not removal of evidenced functions.
Pinned references locate historical evidence; they do not establish approval.

## Examples and checks

The two bookkeeping functions in the output contract share one Epic label: expect
one projected group and two function nodes, not a second Epic JSON collection.
Negative cases: reorganizing by repository folders, fabricating a capability to
complete a journey, writing mindmap geometry into state, or dropping rejected and
optional detail records during overview editing. Validate actual schema/source
locations and compare retained state. Distinguish resource loading, rendered map
navigation, durable save/reopen and native generation; one does not prove another.
