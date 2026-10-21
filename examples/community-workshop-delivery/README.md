# Community workshop delivery Kit

A content-only teaching Kit for **yugoo-design**. It helps a community
workshop coordinator record material-delivery scenarios, possible responses,
and evidence limits for leather-working and gardening activities.

Identity: `community_workshop_delivery@0.1`. Its single Bundle is
`hazard_register@0.1`, with a declarative editable-record panel, English and
Chinese labels, main-agent execution, and a `must_edit` handoff.

This Kit was adapted from the independently authored
`field_operations@0.1` teaching Kit, distributed as `field-operations-shared`.
Its schema, validation rules, panel declaration, execution/presentation
policies, canonical shape, stable field keys, and certainty values are retained.
The methods, labels, output contract, and synthetic examples describe community
workshop deliveries. See [NOTICE](NOTICE) and [LICENSE](LICENSE).

## Copy or share

Copy this entire directory, including `mindset.md`, `skills/`, LICENSE, and
NOTICE, to a directory you own. To share a ZIP, archive the whole
`community-workshop-delivery/` directory. The recipient extracts it first;
the Kit directory is the extracted directory containing `mindset.md`.

Use the installed host adapter's existing Kit discovery/loading integration
to register that directory. For DSH discovery, configure an appropriate
discovery root containing this Kit directory as a direct child. Directory
loading is the supported content shape: sending or extracting a ZIP does not
register the Kit, and the directory loader does not accept the ZIP file itself.
No universal registration command, ZIP installer, or marketplace is provided
by this example.

For host integrations using the public API, load the directory with
`loadDesignKit(fs, absoluteKitDirectory, {sourceId: 'directory:' + absoluteKitDirectory})`
from `dsh-design-core/kit`, using the host's filesystem adapter. Confirm the
loaded Kit identity before selecting it for a project. Create a new project
for this example; do not overwrite another Kit or silently change an existing
project's pinned Kit.

## Try a small design task

After discovery, give the host Agent a request such as:

> Use the community_workshop_delivery Kit to draft two explicitly synthetic
> workshop material-delivery hazards. Read the hazard_register contract and
> example, keep uncertainty explicit, validate, and open its editable panel.
> Do not claim deliveries, bookings, or responses actually occurred.

Edit one short label in the panel, save through the shared Save action, and
continue the design conversation. Reopen the panel to view the saved result.
The Bundle method requires stable record IDs and preservation of unaffected
records and fields.

The readable output contract is
[`skills/hazard_register/reference/artifact-contract.md`](skills/hazard_register/reference/artifact-contract.md);
the synthetic teaching example is
[`skills/hazard_register/reference/example.json`](skills/hazard_register/reference/example.json).
Examples are not user facts. The Kit does not dispatch deliveries, verify
inventory, grant venue access, or produce a solved schedule.

## Verified scope

The content was authored by a native Agent and used in an installed DSH host:
Kit discovery, Bundle resource reads, generation, validation/publication,
panel editing, saving with continuation, and reopening were exercised.
A ZIP recipient repeated generation, editing, save continuation, and reopening
in a separate clean profile using the same installed package graph. In both
runs, the saved change affected only the first record's label; stable IDs and
unaffected fields were preserved. The recipient did not change the author's
Kit or project.

This public copy preserves all thirteen non-README files from that tested
content. Only this README was adjusted for public use. These results do not
establish a second-machine installation, every host's compatibility, full
GRA/KAG conformance, automatic marketplace/Git installation, or a published
npm release. Use the target host's current capabilities and installation
guidance; existing components need no new runtime build for this static copy.

## Contents and license

The directory contains fourteen files: this README, LICENSE, NOTICE,
`mindset.md`, and ten files under `skills/hazard_register/` (method, manifest,
schema, validation, panel, renderer, two locales, contract, and example).
All Kit content is distributed under Apache-2.0; retain LICENSE and NOTICE
when copying or sharing. Shared runtime components and their dependencies
are not included or relicensed by this Kit.
