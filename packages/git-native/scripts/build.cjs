'use strict'
const { spawnSync } = require('node:child_process')
const { mkdirSync, copyFileSync } = require('node:fs')
const { join, resolve } = require('node:path')
const root = resolve(__dirname, '..')
const target = process.argv[2]
const builds = {
  'x86_64-unknown-linux-gnu': { file: 'libyugoo_design_git_native.so', output: 'yugoo_git.linux-x64.node' },
  'x86_64-pc-windows-msvc': { file: 'yugoo_design_git_native.dll', output: 'yugoo_git.win32-x64.node' },
}
const build = builds[target]
if (!build) throw Error('Pass one declared target triple; unsupported targets never fall back to Git CLI.')
const cargoTarget = process.env.CARGO_TARGET_DIR
if (!cargoTarget) throw Error('Set CARGO_TARGET_DIR to an isolated development build directory.')
const result = spawnSync(process.env.CARGO ?? 'cargo', ['build', '--release', '--locked', '--target', target,
  '--manifest-path', join(root, 'native-source', 'Cargo.toml')], { stdio: 'inherit', env: {
  ...process.env, CARGO_BUILD_JOBS: process.env.CARGO_BUILD_JOBS ?? '2',
} })
if (result.error) throw result.error
if (result.status !== 0) process.exit(result.status ?? 1)
mkdirSync(join(root, 'native'), { recursive: true })
copyFileSync(join(cargoTarget, target, 'release', build.file), join(root, 'native', build.output))
console.log(`Built ${build.output}; record reviewed source and artifact hashes before packing.`)
