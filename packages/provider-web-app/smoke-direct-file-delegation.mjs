#!/usr/bin/env node
// Compatibility entrypoint: generic direct-file delegation is exercised by Core.
import { spawnSync } from 'node:child_process'

const result = spawnSync('pnpm', ['--dir', '../core', 'test:execution-delegation'], {
  cwd: import.meta.dirname,
  stdio: 'inherit',
})
if (result.status !== 0) process.exit(result.status ?? 1)
console.log('WEB APP DIRECT FILE DELEGATION CONTRACT OK')
