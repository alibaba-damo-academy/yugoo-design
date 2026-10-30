import { defineConfig } from 'tsdown'
import { readOfficialDshJsonInput } from '../../scripts/official-dsh-json-input.mjs'
import { companionPackagedKnowledge, PACKAGED_KNOWLEDGE_IMPORT, PACKAGED_CLI_LIFECYCLE_IMPORT } from '../../scripts/companion-packaged-knowledge.mjs'
import { normalBuildModuleEvidence } from '../../scripts/normal-build-module-evidence.mjs'
import { COMPANION_NATIVE_GIT_IMPORT } from '../../scripts/companion-native-git.mjs'

const officialInputs = await readOfficialDshJsonInput()

export default defineConfig({
  entry: { 'codex-desktop-marketplace': 'src/codex-desktop-marketplace.mjs', 'codex-desktop-bridge': 'src/codex-desktop-bridge.mjs', 'workbuddy-panel-service':'src/workbuddy-panel-service.mjs', design: 'src/plugin-cli.mjs', 'knowledge-snapshot-query':'src/knowledge-snapshot-query.mjs', 'git-native-worker': '../core/src/git-native-worker.ts', 'git-runtime-check': 'src/git-runtime-check.mjs' },
  outDir: 'dist-server', format: 'esm', platform: 'node', target: 'node22',
  tsconfig: false, dts: false, clean: true, failOnWarn: true,
  // Portable servers use ws' supported JS masking and Node UTF-8 fallback;
  // optional native accelerators must not become undeclared runtime loads.
  define: { 'process.env.WS_NO_BUFFER_UTIL': '"1"', 'process.env.WS_NO_UTF_8_VALIDATE': '"1"' },
  hooks: normalBuildModuleEvidence('server'),
  outputOptions: { entryFileNames: chunk => chunk.name === 'git-native-worker' ? '[name].js' : '[name].mjs' },
  deps: { alwaysBundle: [/.*/], onlyBundle: false },
  alias: {
    'dsh-design-core': new URL('./src/core-entry.ts', import.meta.url).pathname,
    '../../core/lib/index.js': new URL('./src/core-entry.ts', import.meta.url).pathname,
    '../../core/lib/kit-loader.js': new URL('./src/core-entry.ts', import.meta.url).pathname,
  },
  plugins: [companionPackagedKnowledge(), {
    name: 'companion-system-trash',
    // Keep the dependency's platform executables and import.meta.url together.
    resolveId(id) { if (id === 'trash') return { id, external: true } },
  }, {
    name: 'companion-native-git-binding',
    // Keep the binding's own __dirname/native lookup intact. Core's worker
    // and its JS imports are built from source; only the addon stays external.
    resolveId(id) { if (id === 'yugoo-design-git-native') return { id: COMPANION_NATIVE_GIT_IMPORT, external: true } },
  }, {
    name: 'companion-no-host-runtime',
    // Only the hash-verified pure JSON helper is selected, never the session runtime.
    resolveId: officialInputs.resolveId,
    generateBundle(_options, bundle) {
      for (const output of Object.values(bundle)) {
        if (output.type !== 'chunk') continue
        for (const path of [...output.imports, ...output.dynamicImports]) {
          if (!path.startsWith('node:') && !bundle[path] && ![PACKAGED_KNOWLEDGE_IMPORT, PACKAGED_CLI_LIFECYCLE_IMPORT, COMPANION_NATIVE_GIT_IMPORT, 'trash'].includes(path)) throw new Error(`Unbundled companion dependency: ${path}`)
        }
      }
    },
  }],
})
