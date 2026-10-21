/**
 * Cross-panel navigation guard smoke: unknown targets (uninstalled skills,
 * user:/upload: evidence markers) can never activate a tab; only currently
 * projected skills navigate.
 * Run: node scripts/smoke-nav-guard.mjs (after `pnpm run build`).
 */
import assert from 'node:assert/strict'

const { canNavigate } = await import('../packages/panel/lib/index.js')

const skills = ['smart_questions', 'function_modules', 'design_style']

// Projected skills navigate.
for (const skill of skills) assert.equal(canNavigate(skills, skill), true, `${skill} must navigate`)

// Unknown / non-skill targets no-op.
for (const target of ['user', 'upload', 'user:input-1', 'upload:file-2', 'business_rules', '', 'SMART_QUESTIONS']) {
  assert.equal(canNavigate(skills, target), false, `${JSON.stringify(target)} must not navigate`)
}

// Empty projection: nothing navigates.
assert.equal(canNavigate([], 'smart_questions'), false)

console.log('NAV GUARD OK')
