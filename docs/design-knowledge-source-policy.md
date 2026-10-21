# Independent Design Knowledge sources

KAG models native independent Design Files and their independently authored artifacts. A PRD or Spec that compiles those sources is a delivery/readable document, not another set of design facts to model. “Native” describes source independence, not the old native Panel implementation.

Declare a compilation Bundle at the root of its schema:

```yaml
type: object
knowledge: { role: metadata, source_kind: derived }
```

`source_kind` is root-only and accepts `independent` or `derived`. Omission retains existing independent-source behavior. `role` retains its existing projection semantics; the declaration never changes authoritative JSON validation or publication permissions. The `derived` scope covers the Bundle's canonical JSON and owned artifact directory, including artifacts referenced from a different Bundle. Do not put independently owned artifacts inside a derived Bundle directory.

The shared Core graph reader, persisted file projection, referenced-artifact admission and semantic-generation identity apply this policy before modeling. DSH and Companion use that same path. Web App PRD assembly declares its derived scope; Spec in a code receiving repository is already outside Design Files. A future Design Bundle that owns an assembled Spec must declare `derived`; arbitrary filenames such as `spec.md`, `prd.html`, or business `requirements` do not determine eligibility.

Projection publication keys and generation identity are versioned. A normal subsequent projection retires only projection-owned derived entries and dependent relations from the current revision, retaining provider history and unchanged independent source identities. It does not erase user files, clear a knowledge database, or authorize a model rerun. Document viewing, source navigation, schema validation, editing and Git publication remain available independently of KAG admission.

Validation: `packages/core/test/design-knowledge-source-policy.test.mjs` covers derived JSON and HTML/Spec artifacts, ordinary requirements and independently owned artifacts, root-only declarations and unchanged writes, publication-key invalidation, actual PRD declaration, and normal revision retirement with retained original identities. These source tests are not an installed-package or user-project migration claim.
