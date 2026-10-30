import { withNormalBuildEvidence } from '../../scripts/normal-build-module-evidence.mjs'
import { defineConfig } from 'tsdown'

export default withNormalBuildEvidence('dsh-release-studio', defineConfig({
  entry: ['src/index.ts', 'src/node.ts'],
  // The Design Core domain model stays external; the Studio consumes its
  // public Kit/Bundle loader and validation as the single authority.
  external: [/^dsh-design-core/, 'trash'],
  outDir: 'lib',
  format: ['esm'],
  platform: 'node',
  target: 'es2024',
  fixedExtension: false,
  dts: true,
  clean: true,
}))
