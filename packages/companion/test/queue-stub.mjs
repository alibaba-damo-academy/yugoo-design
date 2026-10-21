#!/usr/bin/env node
// Test-only subprocess substitute. Never calls an installed Codex binary.
import { appendFileSync } from 'node:fs'
appendFileSync(process.env.COMPANION_TEST_QUEUE_FILE, JSON.stringify(process.argv.slice(2)) + '\n')
console.log('accepted by test stub')
