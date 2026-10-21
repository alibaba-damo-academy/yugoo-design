#!/usr/bin/env node
// Compatibility entrypoint: PRD preparation/validation is Bundle-owned.
import { spawnSync } from 'node:child_process'

const result = spawnSync(process.execPath, ['smoke-prd-script.mjs'], {
  cwd: new URL('../skills-web-app/', import.meta.url),
  stdio: 'inherit',
})
if (result.status !== 0) process.exit(result.status ?? 1)
console.log('WEB APP PRD BUNDLE PUBLICATION CONTRACT OK')
