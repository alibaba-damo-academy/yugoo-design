import { withNormalBuildEvidence } from '../../scripts/normal-build-module-evidence.mjs'
import { defineConfig } from 'tsdown'
import { normalBuildModuleEvidence } from '../../scripts/normal-build-module-evidence.mjs'

const PLATFORM_MODULES = [
  'react',
  'react/jsx-runtime',
  'react-dom',
  'react-dom/client',
  '@deepseek-ai/cordis',
  '@deepseek-ai/dsh-client-ui-settings/client',
  '@deepseek-ai/dsh-client-ui-slots',
]

export default withNormalBuildEvidence('dsh-release-studio-dsh', defineConfig([
  {
    entry: ['src/index.ts', 'src/client-adapter.tsx', 'src/page.ts', 'src/page-rpc.ts', 'src/page-path.ts', 'src/typert.host.ts', 'src/typert.remote-client.ts'],
    external: [/^@deepseek-ai\//, /^dsh-design-/, 'zod'],
    outDir: 'lib',
    format: ['esm'],
    platform: 'node',
    target: 'es2024',
    fixedExtension: false,
    dts: true,
    clean: true,
  },
  {
    entry: { client: 'src/client.tsx' },
    outDir: 'lib',
    format: 'cjs',
    platform: 'browser',
    dts: false,
    sourcemap: true,
    clean: false,
    external: PLATFORM_MODULES,
    noExternal: (id: string) => (PLATFORM_MODULES.includes(id) ? undefined : true),
    define: { 'process.env.NODE_ENV': JSON.stringify(process.env.NODE_ENV ?? 'production') },
    outputOptions: {
      entryFileNames: 'client.js',
      banner: `window.__ModuleLoader__.load({ id: ${JSON.stringify('dsh-design-studio-dsh')}, factory: (require) => {`,
      footer: 'return module.exports; } });',
      intro: 'var module = { exports: {} }; var exports = module.exports;',
    },
  },
  {
    entry: { 'page-client': 'src/page-client.tsx' },
    outDir: 'lib',
    format: 'esm',
    platform: 'browser',
    dts: false,
    sourcemap: false,
    clean: false,
    deps: { alwaysBundle: [/.*/], onlyBundle: false },
    failOnWarn: true,
    hooks: normalBuildModuleEvidence('studio-dsh-page'),
    plugins: [{
      name: 'studio-standalone-browser-closure',
      generateBundle(_options, bundle) {
        const chunks = Object.values(bundle).filter(output => output.type === 'chunk')
        if (chunks.length !== 1 || chunks[0].imports.length || chunks[0].dynamicImports.length) {
          throw new Error('Studio page must emit one self-contained browser module without external imports')
        }
      },
    }],
    define: { 'process.env.NODE_ENV': JSON.stringify('production') },
    outputOptions: { entryFileNames: 'page-client.js' },
  },
]))
