/**
 * validation.yaml rule engine. Evaluates a skill's declarative validation
 * contract (issue codes, messages, repair hints) in one of three scopes:
 * `state` (checkpoint on the persisted JSON), `completion` (terminal
 * deliverables, including disk-backed artifacts), and `candidate` (child-result
 * gates applied before Producer integration). Declarative primitives cover the common
 * shapes; Bundle-provided drivers carry procedural validation.
 */
import { parse } from 'yaml'
import type { ValidationIssue } from './validate-design.ts'
import { DesignDriverId, type DesignValidationDriver } from './runtime-drivers.ts'
import { requireDesignFileRelativePath } from './design-files.ts'
import { validateDesignSourceReferenceSubject, type DesignSourceReference } from './design-source-reference.ts'

/** One parsed validation rule. */
export interface ValidationRule {
  id: string
  scope: readonly string[]
  code: string
  message?: string
  artifact?: string
  repair_hint?: string
  applies_when?: {
    readonly metadata: Readonly<Record<string, unknown>>
  }
  check: Record<string, unknown>
}

/** A parsed validation.yaml document. */
export interface ValidationDoc {
  skill: string
  constants: Record<string, unknown>
  rules: readonly ValidationRule[]
}

/** Evaluation environment for one scope pass. */
export interface ValidationEnv {
  skill: string
  state: Record<string, unknown>
  /** Read one artifact relative to `design_files/`; absent in candidate scope. */
  artifactText?: (relPath: string) => Promise<string | undefined>
  /** Delegated result payload (candidate scope only). */
  candidate?: { content: string; metadata?: Record<string, unknown> }
}

function nonEmptyText(value: unknown): value is string {
  return typeof value === 'string' && value.trim() !== ''
}

/** Unicode-compatible case folding for user-visible uniqueness checks. */
function caseFold(value: string): string {
  return value.normalize('NFKC').toLowerCase().replaceAll('ß', 'ss').replaceAll('ς', 'σ')
}

function stringPair(value: unknown, left: string, right: string): boolean {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    && nonEmptyText((value as Record<string, unknown>)[left])
    && nonEmptyText((value as Record<string, unknown>)[right])
}

const LEAF_OPERATORS = ['non_empty_map', 'non_empty_list', 'non_empty_string', 'member_of_map', 'members_of_map', 'source_reference_map', 'fields_absent_when', 'exclusive_fields'] as const
const STRUCTURAL_OPERATORS = [
  'referenced_files',
  'required_files',
  'driver',
  'for_each_in_map',
  'for_each_in_order',
  'order_refs_map',
  'map_keys_match_field',
  'order_exactly_covers_map',
  'map_entries_have_unique_non_empty_string_list',
  'map_entries_have_unique_string_list',
  'acyclic_record_edges',
  'single_parent_record_edges',
] as const

function leafOperators(check: Record<string, unknown>): readonly (typeof LEAF_OPERATORS)[number][] {
  return LEAF_OPERATORS.filter((operator) => operator in check)
}

const UNSAFE_STATE_PATH_SEGMENTS = new Set(['__proto__', 'constructor', 'prototype'])

function assertStatePath(value: unknown, ruleId: string, operand: string): asserts value is string {
  if (!nonEmptyText(value)) {
    throw new Error(`validation.yaml: rule ${JSON.stringify(ruleId)} ${operand} must be a non-empty state path`)
  }
  const segments = value.split('.')
  if (value !== value.trim() || segments.some((segment) => segment === '' || segment !== segment.trim() || UNSAFE_STATE_PATH_SEGMENTS.has(segment))) {
    throw new Error(`validation.yaml: rule ${JSON.stringify(ruleId)} ${operand} must be a safe dotted state path`)
  }
}

function assertRootLeafPaths(check: Record<string, unknown>, ruleId: string): void {
  for (const operator of ['non_empty_map', 'non_empty_list', 'non_empty_string', 'source_reference_map'] as const) {
    if (operator in check) assertStatePath(check[operator], ruleId, operator)
  }
  for (const operator of ['member_of_map', 'members_of_map'] as const) if (operator in check) {
    assertMembershipSpec(check[operator], ruleId, operator)
    const spec = check[operator] as { value?: unknown; map?: unknown; item_field?: unknown }
    assertStatePath(spec.value, ruleId, `${operator}.value`)
    assertStatePath(spec.map, ruleId, `${operator}.map`)
    if (spec.item_field !== undefined) assertDirectFieldName(spec.item_field, ruleId, `${operator}.item_field`)
  }
}

function assertSingleLeaf(check: Record<string, unknown>, ruleId: string, rootPaths: boolean): void {
  const operators = leafOperators(check)
  if (operators.length !== 1) {
    throw new Error(`validation.yaml: rule ${JSON.stringify(ruleId)} check must contain exactly one leaf operator`)
  }
  if ('exclusive_fields' in check) {
    const spec = check.exclusive_fields
    if (!isRecord(spec)) throw new Error(`validation.yaml: rule ${JSON.stringify(ruleId)} exclusive_fields needs an object`)
    assertOnlySpecKeys(spec, ruleId, 'exclusive_fields', new Set(['fields', 'allow_empty']))
    if (!Array.isArray(spec.fields) || spec.fields.length < 2 || new Set(spec.fields).size !== spec.fields.length
      || (spec.allow_empty !== undefined && typeof spec.allow_empty !== 'boolean'))
      throw new Error(`validation.yaml: rule ${JSON.stringify(ruleId)} exclusive_fields needs distinct fields and optional boolean allow_empty`)
    for (const field of spec.fields) assertDirectFieldName(field, ruleId, 'exclusive_fields')
    return
  }
  if ('fields_absent_when' in check) {
    const spec = check.fields_absent_when
    if (!isRecord(spec)) throw new Error(`validation.yaml: rule ${JSON.stringify(ruleId)} fields_absent_when needs an object`)
    assertOnlySpecKeys(spec, ruleId, 'fields_absent_when', new Set(['field', 'equals', 'fields']))
    assertDirectFieldName(spec.field, ruleId, 'fields_absent_when')
    if (!nonEmptyText(spec.equals) || !Array.isArray(spec.fields) || spec.fields.length === 0) throw new Error(`validation.yaml: rule ${JSON.stringify(ruleId)} fields_absent_when needs equals and fields`)
    for (const field of spec.fields) assertDirectFieldName(field, ruleId, 'fields_absent_when')
    return
  }
  if (rootPaths) {
    assertRootLeafPaths(check, ruleId)
    return
  }
  const operator = operators[0] as (typeof LEAF_OPERATORS)[number]
  if (operator === 'member_of_map' || operator === 'members_of_map') {
    assertMembershipSpec(check[operator], ruleId, operator)
    if (!stringPair(check[operator], 'value', 'map')) {
      throw new Error(`validation.yaml: rule ${JSON.stringify(ruleId)} member_of_map needs non-empty value and map field names`)
    }
    const spec = check[operator] as { value: string; map: string; item_field?: unknown }
    assertStatePath(spec.value, ruleId, `${operator}.value`)
    assertStatePath(spec.map, ruleId, `${operator}.map`)
    if (spec.item_field !== undefined) assertDirectFieldName(spec.item_field, ruleId, 'members_of_map.item_field')
    if (spec.value !== spec.value.trim() || spec.map !== spec.map.trim()) {
      throw new Error(`validation.yaml: rule ${JSON.stringify(ruleId)} member_of_map field names must not contain surrounding whitespace`)
    }
    return
  }
  if (!nonEmptyText(check[operator]) || check[operator] !== String(check[operator]).trim()) {
    throw new Error(`validation.yaml: rule ${JSON.stringify(ruleId)} ${operator} must be a non-empty entry field name`)
  }
}

function assertOnlyOperators(check: Record<string, unknown>, ruleId: string, allowed: ReadonlySet<string>): void {
  const unsupported = Object.keys(check).filter((operator) => !allowed.has(operator))
  if (unsupported.length > 0) {
    throw new Error(`validation.yaml: rule ${JSON.stringify(ruleId)} check contains unsupported operator ${JSON.stringify(unsupported[0])}`)
  }
}

function assertMembershipSpec(value: unknown, ruleId: string, operator: string): void {
  assertOnlySpecKeys(value, ruleId, operator, new Set(operator === 'members_of_map'
    ? ['value', 'map', 'item_field', 'min_entries', 'order_field'] : ['value', 'map', 'allow_empty']))
  if (!isRecord(value)) return
  if (value.allow_empty !== undefined && typeof value.allow_empty !== 'boolean') throw new Error(`validation.yaml: ${ruleId} allow_empty must be boolean`)
  if (value.min_entries !== undefined && (typeof value.item_field !== 'string' || !Number.isSafeInteger(value.min_entries) || Number(value.min_entries) < 0))
    throw new Error(`validation.yaml: ${ruleId} min_entries requires item_field and a nonnegative integer`)
  if (value.order_field !== undefined) {
    if (typeof value.item_field !== 'string') throw new Error(`validation.yaml: ${ruleId} order_field requires item_field`)
    assertDirectFieldName(value.order_field, ruleId, operator)
  }
}

function assertOnlySpecKeys(
  value: unknown,
  ruleId: string,
  operator: string,
  allowed: ReadonlySet<string>,
): void {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return
  const unsupported = Object.keys(value).filter((key) => !allowed.has(key))
  if (unsupported.length > 0) {
    throw new Error(`validation.yaml: rule ${JSON.stringify(ruleId)} ${operator} contains unsupported key ${JSON.stringify(unsupported[0])}`)
  }
}

function assertJsonCondition(value: unknown, path: string, ancestors = new WeakSet<object>()): void {
  if (value === null || typeof value === 'string' || typeof value === 'boolean') return
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) throw new Error(`validation.yaml: ${path} must contain finite JSON values`)
    return
  }
  if (typeof value !== 'object') throw new Error(`validation.yaml: ${path} must contain JSON values`)
  if (ancestors.has(value)) throw new Error(`validation.yaml: ${path} must not contain cycles`)
  ancestors.add(value)
  if (Array.isArray(value)) {
    value.forEach((entry, index) => assertJsonCondition(entry, `${path}[${index}]`, ancestors))
  } else {
    for (const [key, entry] of Object.entries(value as Record<string, unknown>)) {
      if (UNSAFE_STATE_PATH_SEGMENTS.has(key)) throw new Error(`validation.yaml: ${path} contains unsafe key ${JSON.stringify(key)}`)
      assertJsonCondition(entry, `${path}.${key}`, ancestors)
    }
  }
  ancestors.delete(value)
}

function parseAppliesWhen(value: unknown, ruleId: string, scopes: readonly string[]): ValidationRule['applies_when'] {
  const path = `rule ${JSON.stringify(ruleId)} applies_when`
  if (!isRecord(value)) throw new Error(`validation.yaml: ${path} must be an object`)
  const unsupported = Object.keys(value).filter((key) => key !== 'metadata')
  if (unsupported.length > 0) {
    throw new Error(`validation.yaml: ${path} contains unsupported key ${JSON.stringify(unsupported[0])}`)
  }
  if (!isRecord(value.metadata) || Object.keys(value.metadata).length === 0) {
    throw new Error(`validation.yaml: ${path}.metadata must be a non-empty object`)
  }
  if (scopes.some((scope) => scope !== 'candidate')) {
    throw new Error(`validation.yaml: ${path} is only valid for candidate rules`)
  }
  assertJsonCondition(value.metadata, `${path}.metadata`)
  return { metadata: value.metadata }
}

function assertDirectFieldName(value: unknown, ruleId: string, operator: string): asserts value is string {
  if (!nonEmptyText(value) || value !== value.trim() || value.includes('.') || UNSAFE_STATE_PATH_SEGMENTS.has(value)) {
    throw new Error(`validation.yaml: rule ${JSON.stringify(ruleId)} ${operator}.field must be a non-empty direct field name`)
  }
}

function assertMapFieldSpec(value: unknown, ruleId: string, operator: string): void {
  assertOnlySpecKeys(value, ruleId, operator, new Set(['map', 'field']))
  if (!stringPair(value, 'map', 'field')) {
    throw new Error(`validation.yaml: rule ${JSON.stringify(ruleId)} ${operator} needs non-empty map path and field name`)
  }
  const spec = value as { map: string; field: string }
  assertStatePath(spec.map, ruleId, `${operator}.map`)
  assertDirectFieldName(spec.field, ruleId, operator)
}

function assertOrderMapSpec(value: unknown, ruleId: string, operator: string): void {
  assertOnlySpecKeys(value, ruleId, operator, new Set(['order', 'map']))
  if (!stringPair(value, 'order', 'map')) {
    throw new Error(`validation.yaml: rule ${JSON.stringify(ruleId)} ${operator} needs non-empty order and map paths`)
  }
  const spec = value as { order: string; map: string }
  assertStatePath(spec.order, ruleId, `${operator}.order`)
  assertStatePath(spec.map, ruleId, `${operator}.map`)
}

function assertValidationCheck(check: Record<string, unknown>, ruleId: string): void {
  const structural = STRUCTURAL_OPERATORS.filter((operator) => operator in check)
  if (structural.length > 1) {
    throw new Error(`validation.yaml: rule ${JSON.stringify(ruleId)} check must contain exactly one top-level operator`)
  }
  for (const operator of ['acyclic_record_edges', 'single_parent_record_edges'] as const) {
    if (!(operator in check)) continue
    assertOnlyOperators(check, ruleId, new Set([operator]))
    const spec = check[operator]
    if (!isRecord(spec)) throw new Error(`validation.yaml: rule ${JSON.stringify(ruleId)} ${operator} needs an object`)
    assertOnlySpecKeys(spec, ruleId, operator, new Set(['map', 'source', 'target', 'where']))
    const fields = spec as Record<string, unknown>
    assertStatePath(fields.map, ruleId, `${operator}.map`)
    assertDirectFieldName(fields.source, ruleId, `${operator}.source`)
    assertDirectFieldName(fields.target, ruleId, `${operator}.target`)
    if (fields.where !== undefined) {
      if (!isRecord(fields.where)) throw new Error(`validation.yaml: rule ${JSON.stringify(ruleId)} ${operator}.where needs an object`)
      assertOnlySpecKeys(fields.where, ruleId, `${operator}.where`, new Set(['field', 'equals']))
      const where = fields.where as Record<string, unknown>
      assertDirectFieldName(where.field, ruleId, `${operator}.where`)
      if (!nonEmptyText(where.equals)) throw new Error(`validation.yaml: rule ${JSON.stringify(ruleId)} ${operator}.where.equals must be a non-empty string`)
    }
    return
  }
  for (const operator of ['referenced_files', 'required_files'] as const) {
    if (!(operator in check)) continue
    assertOnlyOperators(check, ruleId, new Set([operator]))
    const paths = check[operator]
    if (!Array.isArray(paths) || paths.length === 0) {
      throw new Error(`validation.yaml: rule ${ruleId} ${operator} needs a non-empty list`)
    }
    for (const path of paths) {
      if (operator === 'referenced_files') assertStatePath(path, ruleId, operator)
      else {
        if (typeof path !== 'string') throw new Error(`validation.yaml: rule ${ruleId} requires file paths`)
        requireDesignFileRelativePath(path)
      }
    }
    return
  }
  if (check.driver !== undefined) {
    if (!nonEmptyText(check.driver)) {
      throw new Error(`validation.yaml: rule ${JSON.stringify(ruleId)} driver must be a non-empty string`)
    }
    check.driver = DesignDriverId(check.driver, `validation.yaml: rule ${JSON.stringify(ruleId)} driver`)
    assertOnlyOperators(check, ruleId, new Set(['driver', 'options']))
    if (check.options !== undefined && (typeof check.options !== 'object' || check.options === null || Array.isArray(check.options))) {
      throw new Error(`validation.yaml: rule ${JSON.stringify(ruleId)} options must be an object`)
    }
    return
  }
  if ('for_each_in_map' in check) {
    assertOnlyOperators(check, ruleId, new Set(['for_each_in_map', ...LEAF_OPERATORS]))
    assertStatePath(check.for_each_in_map, ruleId, 'for_each_in_map')
    assertSingleLeaf(check, ruleId, false)
    return
  }
  if ('for_each_in_order' in check) {
    assertOnlyOperators(check, ruleId, new Set(['for_each_in_order', ...LEAF_OPERATORS]))
    assertOrderMapSpec(check.for_each_in_order, ruleId, 'for_each_in_order')
    assertSingleLeaf(check, ruleId, false)
    return
  }
  if ('order_refs_map' in check) {
    assertOnlyOperators(check, ruleId, new Set(['order_refs_map']))
    assertOrderMapSpec(check.order_refs_map, ruleId, 'order_refs_map')
    if (leafOperators(check).length > 0) {
      throw new Error(`validation.yaml: rule ${JSON.stringify(ruleId)} order_refs_map cannot contain a leaf operator`)
    }
    return
  }
  if ('map_keys_match_field' in check) {
    assertOnlyOperators(check, ruleId, new Set(['map_keys_match_field']))
    assertMapFieldSpec(check.map_keys_match_field, ruleId, 'map_keys_match_field')
    return
  }
  if ('order_exactly_covers_map' in check) {
    assertOnlyOperators(check, ruleId, new Set(['order_exactly_covers_map']))
    assertOrderMapSpec(check.order_exactly_covers_map, ruleId, 'order_exactly_covers_map')
    return
  }
  if ('map_entries_have_unique_non_empty_string_list' in check) {
    assertOnlyOperators(check, ruleId, new Set(['map_entries_have_unique_non_empty_string_list']))
    assertMapFieldSpec(
      check.map_entries_have_unique_non_empty_string_list,
      ruleId,
      'map_entries_have_unique_non_empty_string_list',
    )
    return
  }
  if ('map_entries_have_unique_string_list' in check) {
    assertOnlyOperators(check, ruleId, new Set(['map_entries_have_unique_string_list']))
    assertMapFieldSpec(
      check.map_entries_have_unique_string_list,
      ruleId,
      'map_entries_have_unique_string_list',
    )
    return
  }
  if (leafOperators(check).length > 0) {
    assertOnlyOperators(check, ruleId, new Set(LEAF_OPERATORS))
    assertSingleLeaf(check, ruleId, true)
    return
  }
  throw new Error(`validation.yaml: rule ${JSON.stringify(ruleId)} check has no supported operator`)
}

/**
 * Parse one validation.yaml document.
 * @param text - the validation.yaml source.
 * @returns the parsed rules document.
 * @throws when the document is malformed (fail loud at load).
 */
export function parseValidationYaml(text: string): ValidationDoc {
  const doc = parse(text) as { skill?: unknown; constants?: unknown; rules?: unknown }
  if (typeof doc !== 'object' || doc === null || !Array.isArray(doc.rules)) {
    throw new Error('validation.yaml: expected a rules list')
  }
  if (typeof doc.skill !== 'string' || doc.skill.trim() === '') {
    throw new Error('validation.yaml: skill must be a non-empty string')
  }
  if (doc.constants !== undefined && (typeof doc.constants !== 'object' || doc.constants === null || Array.isArray(doc.constants))) {
    throw new Error('validation.yaml: constants must be an object')
  }
  const constants = typeof doc.constants === 'object' && doc.constants !== null
    ? doc.constants as Record<string, unknown>
    : {}
  const allowedScopes = new Set(['state', 'completion', 'candidate'])
  const ruleIds = new Set<string>()
  const rules = (doc.rules as unknown[]).map((raw, index) => {
    if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) {
      throw new Error(`validation.yaml: rules[${index}] must be an object`)
    }
    const rule = raw as Partial<ValidationRule>
    if (typeof rule.id !== 'string' || rule.id.trim() === '') {
      throw new Error(`validation.yaml: rules[${index}].id must be a non-empty string`)
    }
    if (ruleIds.has(rule.id)) throw new Error(`validation.yaml: duplicate rule id ${JSON.stringify(rule.id)}`)
    ruleIds.add(rule.id)
    if (!Array.isArray(rule.scope) || rule.scope.length === 0 || rule.scope.some((scope) => typeof scope !== 'string' || !allowedScopes.has(scope))) {
      throw new Error(`validation.yaml: rule ${JSON.stringify(rule.id)} scope must contain state, completion, or candidate`)
    }
    if (typeof rule.code !== 'string' || rule.code.trim() === '') {
      throw new Error(`validation.yaml: rule ${JSON.stringify(rule.id)} code must be a non-empty string`)
    }
    if (rule.message !== undefined && typeof rule.message !== 'string') {
      throw new Error(`validation.yaml: rule ${JSON.stringify(rule.id)} message must be a string`)
    }
    if (rule.artifact !== undefined && (typeof rule.artifact !== 'string' || rule.artifact.trim() === '')) {
      throw new Error(`validation.yaml: rule ${JSON.stringify(rule.id)} artifact must be a non-empty string`)
    }
    if (rule.repair_hint !== undefined && typeof rule.repair_hint !== 'string') {
      throw new Error(`validation.yaml: rule ${JSON.stringify(rule.id)} repair_hint must be a string`)
    }
    if (typeof rule.check !== 'object' || rule.check === null || Array.isArray(rule.check) || Object.keys(rule.check).length === 0) {
      throw new Error(`validation.yaml: rule ${JSON.stringify(rule.id)} check must be a non-empty object`)
    }
    assertValidationCheck(rule.check as Record<string, unknown>, rule.id)
    if (isRecord(rule.check.members_of_map) && rule.check.members_of_map.min_entries !== undefined
      && rule.scope.some(scope => scope !== 'completion')) {
      throw new Error(`validation.yaml: rule ${JSON.stringify(rule.id)} min_entries is a completion-only requirement`)
    }
    return {
      id: rule.id,
      scope: rule.scope as readonly string[],
      code: rule.code,
      ...(rule.message === undefined ? {} : { message: rule.message }),
      ...(rule.artifact === undefined ? {} : { artifact: rule.artifact }),
      ...(rule.repair_hint === undefined ? {} : { repair_hint: rule.repair_hint }),
      ...(rule.applies_when === undefined ? {} : {
        applies_when: parseAppliesWhen(rule.applies_when, rule.id, rule.scope as readonly string[]),
      }),
      check: rule.check as Record<string, unknown>,
    }
  })
  if (rules.length === 0) throw new Error('validation.yaml: rules must not be empty')
  return { skill: doc.skill, constants, rules }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function jsonConditionMatches(expected: unknown, actual: unknown): boolean {
  if (expected === null || typeof expected !== 'object') return Object.is(expected, actual)
  if (Array.isArray(expected)) {
    return Array.isArray(actual)
      && expected.length === actual.length
      && expected.every((entry, index) => jsonConditionMatches(entry, actual[index]))
  }
  if (!isRecord(actual)) return false
  const expectedRecord = expected as Record<string, unknown>
  const expectedKeys = Object.keys(expectedRecord)
  const actualKeys = Object.keys(actual)
  return expectedKeys.length === actualKeys.length
    && expectedKeys.every((key) => Object.hasOwn(actual, key) && jsonConditionMatches(expectedRecord[key], actual[key]))
}

function appliesToCandidate(rule: ValidationRule, candidate: ValidationEnv['candidate']): boolean {
  const expected = rule.applies_when?.metadata
  if (expected === undefined) return true
  const actual = candidate?.metadata
  if (actual === undefined) return false
  return Object.entries(expected).every(([key, value]) => (
    Object.hasOwn(actual, key) && jsonConditionMatches(value, actual[key])
  ))
}

function template(text: string, vars: Record<string, string>): string {
  return text.replace(/\{(\w+)\}/g, (whole, name: string) => vars[name] ?? whole)
}

/** Direct own-field accessor for one for-each entry. */
function entryField(subject: Record<string, unknown>, name: string): unknown {
  return Object.hasOwn(subject, name) ? subject[name] : undefined
}

/** Own-property-only dotted accessor for a path rooted at persisted state. */
function statePath(subject: Record<string, unknown>, path: string): unknown {
  let current: Record<string, unknown> = subject
  const segments = path.split('.')
  for (let index = 0; index < segments.length; index += 1) {
    const segment = segments[index] ?? ''
    if (UNSAFE_STATE_PATH_SEGMENTS.has(segment) || !Object.hasOwn(current, segment)) return undefined
    const value = current[segment]
    if (index === segments.length - 1) return value
    if (!isRecord(value)) return undefined
    current = value
  }
  return undefined
}

/** Evaluate one leaf check against one subject; returns true on failure. */
function leafFails(
  check: Record<string, unknown>,
  subject: Record<string, unknown>,
  readField: (subject: Record<string, unknown>, name: string) => unknown,
  state: Record<string, unknown> = subject,
): boolean {
  if ('exclusive_fields' in check) {
    const spec = check.exclusive_fields as { fields: string[]; allow_empty?: boolean }
    const values = spec.fields.map(field => readField(subject, field))
    // Only absent/empty text is an unfinished reference. Other values are not
    // coerced into an identity; whitespace is not normalized into a valid ID.
    if (values.some(value => value !== undefined && typeof value !== 'string')) return true
    const present = values.filter(value => typeof value === 'string' && value.length > 0)
    return present.length > 1 || (spec.allow_empty !== true && (present.length !== 1 || !nonEmptyText(present[0])))
  }
  if ('fields_absent_when' in check) {
    const spec = check.fields_absent_when as {field: string; equals: string; fields: string[]}
    return readField(subject,spec.field) === spec.equals && spec.fields.some(field => Object.hasOwn(subject,field))
  }
  if ('source_reference_map' in check) {
    const references = readField(subject, String(check.source_reference_map))
    if (references === undefined) return false // optional evidence is not a completeness gate
    if (!isRecord(references)) return true
    for (const reference of Object.values(references)) {
      if (!isRecord(reference)) return true
      try { validateDesignSourceReferenceSubject(reference as unknown as DesignSourceReference, subject) }
      catch { return true }
    }
    return false
  }
  if ('non_empty_map' in check) {
    const value = readField(subject, String(check.non_empty_map))
    return !isRecord(value) || Object.keys(value).length === 0
  }
  if ('non_empty_list' in check) {
    const value = readField(subject, String(check.non_empty_list))
    return !Array.isArray(value) || value.length === 0
  }
  if ('non_empty_string' in check) {
    const value = readField(subject, String(check.non_empty_string))
    return typeof value !== 'string' || value.trim() === ''
  }
  for (const operator of ['member_of_map', 'members_of_map'] as const) if (operator in check) {
    const spec = check[operator] as { value?: unknown; map?: unknown; item_field?: string; allow_empty?: boolean; min_entries?: number; order_field?: string }
    const value = readField(subject, String(spec.value ?? ''))
    if (value === null || value === undefined) {
      if ((spec.min_entries ?? 0) > 0) return true
      const order = spec.order_field ? readField(subject, spec.order_field) : undefined
      return order !== undefined && (!Array.isArray(order) || order.length > 0)
    }
    if (operator === 'member_of_map' && value === '' && spec.allow_empty === true) return false
    const map = statePath(state, String(spec.map ?? ''))
    if (operator === 'members_of_map' && spec.item_field !== undefined) {
      if (!isRecord(value)) return true
      const entries = Object.values(value)
      if (entries.length < (spec.min_entries ?? 0)) return true
      if (spec.order_field) {
        const order = readField(subject, spec.order_field)
        if (order === undefined) { if ((spec.min_entries ?? 0) > 0) return true }
        else if (!Array.isArray(order) || order.some(id => typeof id !== 'string' || !Object.hasOwn(value, id))
          || new Set(order).size !== order.length || ((spec.min_entries ?? 0) > 0 && order.length !== entries.length)) return true
      }
      return entries.some(item => {
        if (!isRecord(item)) return true
        const id = item[spec.item_field!]
        if ((spec.min_entries ?? 0) > 0 && !nonEmptyText(id)) return true
        return id !== undefined && id !== '' && (typeof id !== 'string' || !isRecord(map) || !Object.hasOwn(map, id))
      })
    }
    if (operator === 'members_of_map') return !Array.isArray(value) || value.some(id =>
      typeof id !== 'string' || !isRecord(map) || !Object.hasOwn(map, id))
    return !isRecord(map) || !Object.hasOwn(map, String(value))
  }
  return false
}

/**
 * Run one rule's check tree against the state root.
 * @returns the failing entry keys, or a field-naming diagnostic when a
 * required order or map field is absent or malformed.
 */
function runCheck(check: Record<string, unknown>, subject: Record<string, unknown>): string[] {
  if ('single_parent_record_edges' in check) {
    const spec = check.single_parent_record_edges as { map: string; source: string; target: string; where?: { field: string; equals: string } }
    const map = statePath(subject, spec.map)
    if (!isRecord(map)) return [] // optional collection; shape validation owns malformed values
    const parents = new Map<string, string[]>()
    for (const [id, raw] of Object.entries(map)) {
      if (!isRecord(raw) || (spec.where && raw[spec.where.field] !== spec.where.equals)
        || typeof raw[spec.source] !== 'string' || typeof raw[spec.target] !== 'string') continue
      const source = raw[spec.source] as string
      const edges = parents.get(source) ?? []
      edges.push(id); parents.set(source, edges)
    }
    // Duplicate edges to the same parent are also invalid: one canonical edge
    // owns a source's parent, so edits cannot select between competing records.
    return [...parents.values()].filter(edges => edges.length > 1).flat()
  }
  if ('acyclic_record_edges' in check) {
    const spec = check.acyclic_record_edges as { map: string; source: string; target: string; where?: {field: string; equals: string} }
    const map = statePath(subject, spec.map)
    if (!isRecord(map)) return [] // optional collection; shape validation owns malformed values
    const edges = Object.entries(map).flatMap(([id, raw]) => {
      if (!isRecord(raw) || (spec.where && raw[spec.where.field] !== spec.where.equals)) return []
      const from = raw[spec.source], to = raw[spec.target]
      return typeof from === 'string' && typeof to === 'string' ? [{id, from, to}] : []
    })
    const adjacency = new Map<string, Set<string>>()
    for (const edge of edges) {
      const targets = adjacency.get(edge.from) ?? new Set<string>()
      targets.add(edge.to); adjacency.set(edge.from, targets)
    }
    const reachable = (from: string, target: string): boolean => {
      const pending = [from], seen = new Set<string>()
      while (pending.length) {
        const current = pending.pop()!
        if (current === target) return true
        if (seen.has(current)) continue
        seen.add(current)
        pending.push(...(adjacency.get(current) ?? []))
      }
      return false
    }
    return edges.filter(edge => reachable(edge.to, edge.from)).map(edge => edge.id)
  }
  if ('for_each_in_map' in check) {
    const map = statePath(subject, String(check.for_each_in_map))
    if (!isRecord(map)) return []
    return Object.entries(map)
      .filter(([, entry]) => isRecord(entry) && leafFails(check, entry as Record<string, unknown>, entryField, subject))
      .map(([entryKey]) => entryKey)
  }
  if ('for_each_in_order' in check) {
    const spec = check.for_each_in_order as { order?: unknown; map?: unknown }
    const order = statePath(subject, String(spec.order ?? ''))
    const map = statePath(subject, String(spec.map ?? ''))
    if (!Array.isArray(order) || !isRecord(map)) return []
    return order
      .filter((id) => {
        const entry = map[String(id)]
        return isRecord(entry) && leafFails(check, entry as Record<string, unknown>, entryField, subject)
      })
      .map(String)
  }
  if ('order_refs_map' in check) {
    const spec = check.order_refs_map as { order?: unknown; map?: unknown }
    const order = statePath(subject, String(spec.order ?? ''))
    const map = statePath(subject, String(spec.map ?? ''))
    if (!Array.isArray(order)) return []
    return order.filter((id) => !isRecord(map) || !Object.hasOwn(map, String(id))).map(String)
  }
  if ('map_keys_match_field' in check) {
    const spec = check.map_keys_match_field as { map?: unknown; field?: unknown }
    const map = statePath(subject, String(spec.map ?? ''))
    if (!isRecord(map)) return []
    const field = String(spec.field ?? '')
    return Object.entries(map)
      .filter(([key, entry]) => !isRecord(entry) || entryField(entry, field) !== key)
      .map(([key]) => key)
  }
  if ('order_exactly_covers_map' in check) {
    const spec = check.order_exactly_covers_map as { order?: unknown; map?: unknown }
    const order = statePath(subject, String(spec.order ?? ''))
    const map = statePath(subject, String(spec.map ?? ''))
    if (!Array.isArray(order)) {
      // A missing or non-list order covers nothing: name every map key so the
      // per-key diagnostic lists each unlisted entry, and state the field fault
      // itself when the map cannot supply keys.
      const keys = isRecord(map) ? Object.keys(map) : []
      return keys.length > 0 ? keys : [`(${String(spec.order ?? 'order')} is missing or not a list)`]
    }
    if (!isRecord(map)) return [`(${String(spec.map ?? 'map')} is missing or not a map)`]
    const failures = new Set<string>()
    const seen = new Set<string>()
    for (const rawId of order) {
      const id = String(rawId)
      if (typeof rawId !== 'string') {
        failures.add(id)
        continue
      }
      if (seen.has(id) || !Object.hasOwn(map, id)) failures.add(id)
      seen.add(id)
    }
    for (const id of Object.keys(map)) {
      if (!seen.has(id)) failures.add(id)
    }
    return [...failures]
  }
  if ('map_entries_have_unique_non_empty_string_list' in check) {
    const spec = check.map_entries_have_unique_non_empty_string_list as { map?: unknown; field?: unknown }
    const map = statePath(subject, String(spec.map ?? ''))
    if (!isRecord(map)) return []
    const field = String(spec.field ?? '')
    return Object.entries(map)
      .filter(([, entry]) => {
        if (!isRecord(entry)) return true
        const value = entryField(entry, field)
        if (!Array.isArray(value) || value.length === 0) return true
        const normalized = value.map((item) => typeof item === 'string' ? item.trim() : '')
        return normalized.some((item) => item === '') || new Set(normalized).size !== normalized.length
      })
      .map(([key]) => key)
  }
  if ('map_entries_have_unique_string_list' in check) {
    const spec = check.map_entries_have_unique_string_list as { map?: unknown; field?: unknown }
    const map = statePath(subject, String(spec.map ?? ''))
    if (!isRecord(map)) return []
    const field = String(spec.field ?? '')
    return Object.entries(map)
      .filter(([, entry]) => {
        if (!isRecord(entry)) return true
        const value = entryField(entry, field)
        if (!Array.isArray(value)) return true
        const normalized = value.map((item) => typeof item === 'string' ? item.trim() : '')
        return normalized.some((item) => item === '') || new Set(normalized).size !== normalized.length
      })
      .map(([key]) => key)
  }
  return leafFails(check, subject, statePath) ? [''] : []
}

 /**
 * Evaluate the rules of one scope against an environment.
 * @param doc - the parsed validation document.
 * @param env - the evaluation environment (state, artifacts, work item).
 * @param scope - `state`, `completion`, or `candidate`.
 * @param resolveDriver - trusted procedural driver resolver for official Kits.
 * @returns all issues raised by rules active in the scope.
 */
export async function evaluateValidationRules(
  doc: ValidationDoc,
  env: ValidationEnv,
  scope: 'state' | 'completion' | 'candidate',
  resolveDriver?: (id: DesignDriverId) => DesignValidationDriver,
): Promise<ValidationIssue[]> {
  const issues: ValidationIssue[] = []
  for (const rule of doc.rules) {
    if (!rule.scope.includes(scope)) continue
    if (scope === 'candidate' && !appliesToCandidate(rule, env.candidate)) continue
    if ('referenced_files' in rule.check || 'required_files' in rule.check) {
      const refs: Array<{ field: string; value: unknown }> = []
      const visit = (value: unknown, segments: readonly string[], field: string): void => {
        if (segments.length === 0) {
          if (value !== undefined && value !== null && value !== '') refs.push({ field, value })
          return
        }
        if (typeof value !== 'object' || value === null) return
        const [head, ...tail] = segments
        if (head === '*') {
          for (const [key, child] of Object.entries(value)) visit(child, tail, `${field}.${key}`)
        } else if (head !== undefined && Object.hasOwn(value, head)) {
          visit((value as Record<string, unknown>)[head], tail, field ? `${field}.${head}` : head)
        }
      }
      for (const path of (rule.check.referenced_files ?? []) as string[]) visit(env.state, path.split('.'), '')
      for (const path of (rule.check.required_files ?? []) as string[]) refs.push({ field: path, value: path })
      const reads = new Map<string, Promise<string | undefined>>()
      for (const { field, value } of refs) {
        let reason: string | undefined
        try {
          if (typeof value !== 'string' || value.trim() !== value || /^[a-z][a-z0-9+.-]*:/iu.test(value)) throw new Error('reference must be a relative file path')
          requireDesignFileRelativePath(value)
          if (env.artifactText === undefined) throw new Error('artifact reader unavailable; file integrity has not been verified')
          let read = reads.get(value)
          if (read === undefined) {
            read = env.artifactText(value)
            reads.set(value, read)
          }
          const content = await read
          if (content === undefined) reason = 'file is missing'
          else if (content.trim() === '') reason = 'file is empty'
        } catch (error) {
          reason = error instanceof Error ? error.message : String(error)
        }
        if (reason !== undefined) issues.push({
          code: rule.code,
          message: `${field}: ${String(value)} — ${reason}`,
          ...(typeof value === 'string' ? { artifact: value } : {}),
          repair_hint: rule.repair_hint ?? 'Write or repair this referenced file, or remove an obsolete optional reference, then validate again. Editing remains available.',
        })
      }
      continue
    }
    if ('driver' in rule.check) {
      const id = rule.check.driver as DesignDriverId
      if (resolveDriver === undefined) {
        throw new Error(`validation rule ${JSON.stringify(rule.id)} requires unavailable driver ${JSON.stringify(id)}`)
      }
      const messages = await resolveDriver(id).evaluate(
        env,
        (rule.check.options ?? {}) as Record<string, unknown>,
      )
      for (const message of messages) {
        issues.push({
          code: rule.code,
          message: rule.message !== undefined ? template(rule.message, { message }) : message,
          ...(rule.artifact === undefined ? {} : { artifact: rule.artifact }),
          ...(rule.repair_hint === undefined ? {} : { repair_hint: rule.repair_hint }),
        })
      }
      continue
    }
    const failures = runCheck(rule.check, env.state)
    for (const key of failures) {
      const vars: Record<string, string> = { pid: key, round_id: key, key }
      issues.push({
        code: rule.code,
        message: template(rule.message ?? 'check failed', vars),
        ...(rule.artifact === undefined ? {} : { artifact: rule.artifact }),
        ...(rule.repair_hint === undefined ? {} : { repair_hint: rule.repair_hint }),
      })
    }
  }
  return issues
}
