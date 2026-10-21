import { defineConfig } from 'tsdown'

/**
 * Module specifiers the dsh web shell shares into the frozen module table.
 * The client bundle keeps these external and resolves them at runtime through
 * the injected `require`; everything else is inlined. Mirrors dsh's
 * packages/client/web/src/platform.ts PLATFORM_MODULES plus the runtime store
 * exemption.
 */
const PLATFORM_MODULES = [
  'react',
  'react/jsx-runtime',
  'react-dom',
  'react-dom/client',
  '@deepseek-ai/cordis',
  '@deepseek-ai/dsh-client-store',
  '@deepseek-ai/dsh-client-ui-slots',
  '@deepseek-ai/dsh-client-ui-primitives',
]

export default defineConfig([
  {
    entry: ['src/index.ts', 'src/design-source-reference.ts', 'src/panel-dsl.ts', 'src/kit-loader.ts', 'src/kit-loader-plugin.ts', 'src/panel-remote.ts', 'src/typert.host.ts', 'src/typert.remote-client.ts', 'src/dsh-advisory-plugin.ts', 'src/dsh-design-execution-plugin.ts', 'src/design-continuation.ts', 'src/experience-view.ts'],
    // Protocol-backed Service bindings, the declaration-merged session event
    // vocabulary, and the SessionStore class identity behind `ctx.sessions`
    // stay external. Strict `./typert` descriptors publish Host routes without
    // depending on the protocol module's private SRC marker table.
    // Keep the native backend's loader and platform addon in Node's
    // installed dependency tree. Never inline its .node lookup into a chunk.
    external: [/^@deepseek-ai\/dsh-typert-protocol/, /^@deepseek-ai\/dsh-session/, /^@deepseek-ai\/dsh-subprocess-local(?:\/|$)/, /^yugoo-design-git-native(?:\/|$)/],
    outDir: 'lib',
    format: ['esm'],
    platform: 'node',
    target: 'es2024',
    fixedExtension: false,
    dts: true,
    clean: true,
  },
  {
    entry: { 'dsh-git-worker': 'src/dsh-git-worker.ts', 'git-native-worker': 'src/git-native-worker.ts' },
    outDir: 'lib', format: ['esm'], platform: 'node', target: 'es2024',
    fixedExtension: false, dts: false, clean: false,
    external: [/^yugoo-design-git-native(?:\/|$)/],
    noExternal: [/^@deepseek-ai\/(?:dsh-subprocess(?:-local)?|dsh-http-proxy|cordis|cosmokit)(?:\/|$)/],
    outputOptions: { chunkFileNames: 'git-worker-private-[hash].js' },
  },
  // Browser client half: a closure-factory artifact mounting the designPanel
  // Remote descriptor (the dsh-api-remotes pattern). The bundle calls
  // window.__ModuleLoader__.load({ id, factory }) and resolves externals
  // through the injected require (loader module table).
  {
    entry: { client: 'src/client.ts' },
    outDir: 'lib',
    format: 'cjs',
    platform: 'browser',
    dts: false,
    sourcemap: true,
    clean: false,
    external: PLATFORM_MODULES,
    // tsdown auto-externalizes package dependencies; anything NOT in the
    // platform externals must be inlined, or the browser module table lookup
    // fails at load time (e.g. require("zod")). Mirrors dsh's clientBundle.
    noExternal: (id: string) => (PLATFORM_MODULES.includes(id) ? undefined : true),
    define: {
      'process.env.NODE_ENV': JSON.stringify(process.env.NODE_ENV ?? 'production'),
      'import.meta.env.MODE': JSON.stringify(process.env.NODE_ENV ?? 'production'),
      'import.meta.env': JSON.stringify({ MODE: process.env.NODE_ENV ?? 'production' }),
    },
    outputOptions: {
      entryFileNames: 'client.js',
      banner: `window.__ModuleLoader__.load({ id: ${JSON.stringify('dsh-design-core')}, factory: (require) => {`,
      footer: 'return module.exports; } });',
      intro: 'var module = { exports: {} }; var exports = module.exports;',
    },
  },
])
