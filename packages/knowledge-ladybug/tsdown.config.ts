import { withNormalBuildEvidence } from '../../scripts/normal-build-module-evidence.mjs'
import { defineConfig } from 'tsdown'
import { fileURLToPath } from 'node:url'
import { prepareLadybugLicenseMaterials, copyLadybugLicenseMaterials, LADYBUG_MATERIAL_DIRECTORY } from '../../scripts/companion-bundled-license.mjs'

const packageRoot = fileURLToPath(new URL('./', import.meta.url))
const sourceRoot = fileURLToPath(new URL('../../', import.meta.url))

export default withNormalBuildEvidence('dsh-release-knowledge-ladybug', defineConfig({
  entry: ['src/index.ts', 'src/dsh-plugin.ts', 'src/embedding-worker.mjs', 'src/semantic-index.ts'],
  external: [/^@deepseek-ai\/cordis/, /^dsh-design-core/, /^@ladybugdb\/wasm-core/, /^proper-lockfile/, /^@huggingface\/transformers/, /^undici/],
  outDir: 'lib',
  format: ['esm'],
  platform: 'node',
  target: 'es2024',
  fixedExtension: false,
  dts: true,
  clean: true,
  hooks: {
    'build:done': async () => {
      const materials = await prepareLadybugLicenseMaterials(sourceRoot)
      await copyLadybugLicenseMaterials(materials, packageRoot, `lib/third-party/${LADYBUG_MATERIAL_DIRECTORY}`)
    },
  },
}))
