#!/usr/bin/env node
import assert from 'node:assert/strict'
import { WEB_APP_DRAFT_COMPARATORS } from './src/client/packs/web-app-draft-comparators.ts'

const equal = (renderer, a, b) => WEB_APP_DRAFT_COMPARATORS[renderer](a, b)

assert.equal(equal(
  'io.deepseek.design.web-app.smart-questions/v1',
  { questions: { q1: { prompt: 'Original', answer: '' } } },
  { questions: { q1: { prompt: 'Changed', answer: '' } } },
), true, 'question prompts are host-owned')
assert.equal(equal(
  'io.deepseek.design.web-app.smart-questions/v1',
  { questions: { q1: { prompt: 'Original', answer: '' } } },
  { questions: { q1: { prompt: 'Original', answer: 'edited' } } },
), false, 'question answers are user-owned')

assert.equal(equal(
  'io.deepseek.design.web-app.flow-design/v1',
  { processes: { p1: { title: 'Checkout', bpmn_file: 'a.bpmn', bpmn_generated: true, generation_status: 'running' } } },
  { processes: { p1: { title: 'Checkout', bpmn_file: 'b.bpmn', bpmn_generated: true, generation_status: 'completed', bpmn_xml: '<x/>' } } },
), true, 'flow materialization fields are host-owned')
assert.equal(equal(
  'io.deepseek.design.web-app.flow-design/v1',
  { processes: { p1: { title: 'Checkout' } } },
  { processes: { p1: { title: 'Refund' } } },
), false, 'flow content edits are user-owned')
assert.equal(equal(
  'io.deepseek.design.web-app.flow-design/v1',
  { processes: { p1: { title: 'Checkout', bpmn_last_error: 'first failure' } } },
  { processes: { p1: { title: 'Checkout', bpmn_last_error: 'second failure' } } },
), true, 'flow failure diagnostics are host-owned')

assert.equal(equal(
  'io.deepseek.design.web-app.design-style/v1',
  { config: { theme: 't', notes: 'old', preview_page: { html_file: 'a.html' } } },
  { config: { theme: 't', notes: 'new', preview_page: { html_file: 'b.html' } } },
), true, 'style notes and preview metadata are host-owned')
assert.equal(equal(
  'io.deepseek.design.web-app.design-style/v1',
  { config: { colors: { primary: '#000' } } },
  { config: { colors: { primary: '#fff' } } },
), false, 'style configuration edits are user-owned')

assert.equal(equal(
  'io.deepseek.design.web-app.function-modules/v1',
  { functions: { f1: { function_name: 'A', source: 'ai' } } },
  { functions: { f1: { function_name: 'A', source: 'user' } } },
), true, 'function source metadata is host-owned')

assert.equal(equal(
  'io.deepseek.design.web-app.page-design/v1',
  { pages: { p1: { name: 'Home', html: '<old />', generation_status: 'pending', artifact_file: '' } } },
  { pages: { p1: { name: 'Home', html: '<new />', generation_status: 'completed', artifact_file: 'page_design/pages/p1.html' } } },
), true, 'hydrated HTML and executor progress are not authored panel edits')
assert.equal(equal(
  'io.deepseek.design.web-app.page-design/v1',
  { pages: { p1: { name: 'Home' } } },
  { pages: { p1: { name: 'Dashboard' } } },
), false, 'page metadata edits are user-owned')
console.log('WEB APP DRAFT COMPARATORS OK')
