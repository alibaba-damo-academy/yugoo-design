/** Directory packages retain their installed closure; portable output declares external npm dependencies. */
import assert from 'node:assert/strict'
import { createRequire } from 'node:module'
import { createHash } from 'node:crypto'
import { dirname, isAbsolute, join, relative, resolve, sep } from 'node:path'
import { fileURLToPath } from 'node:url'
import { mkdir, readdir, lstat, realpath, readFile, cp, writeFile } from 'node:fs/promises'
import { build } from 'tsdown'
import { readOfficialDshJsonInput } from '../../scripts/official-dsh-json-input.mjs'
import { OFFICIAL_LADYBUG_VERSION, validateLadybugDependency } from '../../scripts/companion-ladybug-dependency.mjs'

const here = dirname(fileURLToPath(import.meta.url))
async function installedRoot(name, from) {
  const require=createRequire(join(from,'package.json'))
  for(const search of require.resolve.paths(name)??[]) {
    const candidate=join(search,name)
    try { if(JSON.parse(await readFile(join(candidate,'package.json'),'utf8')).name===name)return await realpath(candidate) } catch {}
  }
  throw new Error(`Installed dependency not found: ${name}`)
}
export async function packageKnowledge(target, { mode = 'directory', outputDirectory, runtimeDependencies, buildImpl = build } = {}) {
  assert.ok(['directory', 'portable'].includes(mode), 'Unknown knowledge output mode')
  assert.equal(typeof buildImpl, 'function', 'A build implementation is required')
  let destination
  let portableDependencies
  if (mode === 'portable') {
    assert.equal(target, undefined, 'Portable output uses only its explicit outputDirectory')
    assert.ok(typeof outputDirectory === 'string' && isAbsolute(outputDirectory), 'Portable output requires an absolute outputDirectory')
    // The manifest records the complete product installation closure, including
    // declared server-only trash and installer YAML. Snapshot before asynchronous reads.
    portableDependencies = Object.freeze({ ...runtimeDependencies })
    const hasTrash = Object.hasOwn(portableDependencies, 'trash')
    const hasYaml = Object.hasOwn(portableDependencies, 'yaml')
    assert.deepEqual(Object.keys(portableDependencies).sort(), ['@ladybugdb/wasm-core', '@huggingface/transformers', 'onnxruntime-common', 'undici', ...(hasTrash ? ['trash'] : []), ...(hasYaml ? ['yaml'] : [])].sort(), 'Explicit portable runtime dependency set required')
    for (const [name, version] of Object.entries({ '@huggingface/transformers': '3.8.1', 'onnxruntime-common': '1.21.0', undici: '8.10.2' })) {
      assert.equal(portableDependencies[name], version, `Unsupported portable dependency version: ${name}`)
    }
    validateLadybugDependency(portableDependencies['@ladybugdb/wasm-core'])
    if (hasTrash || hasYaml) {
      const template = JSON.parse(await readFile(join(here, '../../release/product-package-template.json'), 'utf8'))
      for (const name of ['trash', 'yaml']) if (Object.hasOwn(portableDependencies, name))
        assert.equal(portableDependencies[name], template.dependencies[name], `Unsupported portable dependency version: ${name}`)
    }
    destination = resolve(outputDirectory)
    assert.equal(await realpath(dirname(destination)), dirname(destination), 'Portable output parent must be canonical')
    const delta = relative(await realpath(join(here, '../..')), destination)
    assert.ok(delta === '..' || delta.startsWith(`..${sep}`) || isAbsolute(delta), 'Portable output must be outside the source workspace')
  } else {
    assert.equal(outputDirectory, undefined, 'Directory mode does not accept outputDirectory')
    assert.equal(runtimeDependencies, undefined, 'Directory mode retains its installed dependency closure')
    destination = join(target, 'knowledge')
  }
  const officialInputs = await readOfficialDshJsonInput()
  const entry=join(here,'src/core-entry.ts')
  await mkdir(destination, mode === 'portable' ? undefined : {recursive:true})
  await buildImpl({config:false,entry:{runtime:join(here,'src/knowledge-runtime-entry.ts')},outDir:destination,
    format:'esm',platform:'node',target:'node22',tsconfig:false,dts:false,clean:false,
    alias:{'dsh-design-core':entry},deps:{alwaysBundle:[/.*/],neverBundle:[/^@ladybugdb\/wasm-core/],onlyBundle:false},
    plugins:[{name:'knowledge-no-host-runtime',resolveId:officialInputs.resolveId}]})
  await buildImpl({config:false,entry:{'embedding-worker':join(here,'../knowledge-ladybug/src/embedding-worker.mjs')},outDir:destination,
    format:'esm',platform:'node',target:'node22',tsconfig:false,dts:false,clean:false,
    deps:{alwaysBundle:[/.*/],neverBundle:[/^@huggingface\/transformers/,/^undici/],onlyBundle:false}})
  // Companion owns terminal CLI semantics. Emit its dependency-facing adapter
  // beside the Knowledge closure so service scripts keep no external npm loads.
  // This separate entry does not import/open the provider or embedding worker.
  await buildImpl({config:false,entry:{'cli-lifecycle':join(here,'src/cli-lifecycle.mjs')},outDir:destination,
    format:'esm',platform:'node',target:'node22',tsconfig:false,dts:false,clean:false,failOnWarn:true,
    deps:{alwaysBundle:[/.*/],neverBundle:[/^@ladybugdb\/wasm-core/],onlyBundle:false}})
  // DesignSemanticIndex resolves this exact worker filename relative to runtime.mjs.
  await cp(join(destination,'embedding-worker.mjs'),join(destination,'embedding-worker.js'))
  await writeFile(join(destination,'package.json'),JSON.stringify({private:true,type:'module'}))
  if (mode === 'portable') {
    const assets = {}
    for (const name of (await readdir(destination)).sort()) {
      const info = await lstat(join(destination, name))
      assert.ok(info.isFile() && !info.isSymbolicLink(), 'Portable knowledge output must contain regular assets, no copied dependency directories')
      assets[name] = createHash('sha256').update(await readFile(join(destination, name))).digest('hex')
    }
    const manifest = { schemaVersion: 1, format: 'npm-external-dependencies',
      runtimeDependencies: portableDependencies, assets,
      officialInputs: officialInputs.authority,
      buildAdapter: buildImpl === build ? 'tsdown' : 'injected',
      copiedNodeModules: false, nativeDependenciesVerified: false, dependencyLicensesVerified: false,
      platformsVerified: [], modelIncluded: false, publishReady: false }
    await writeFile(join(destination, 'runtime-manifest.json'), JSON.stringify(manifest, null, 2) + '\n', { flag: 'wx' })
    return { destination, manifest }
  }
  const versions=new Map()
  async function copyPackage(name, from, parent=destination, ancestors=new Map()) {
    const root=await installedRoot(name,from)
    const manifest=JSON.parse(await readFile(join(root,'package.json'),'utf8'))
    if(ancestors.get(name)===manifest.version)return
    versions.set(`${name}@${manifest.version}`,manifest.version)
    const lineage=new Map(ancestors).set(name,manifest.version)
    const out=join(parent,'node_modules',name)
    await mkdir(out,{recursive:true})
    for(const child of await readdir(root)) {
      if(['node_modules','.git'].includes(child))continue
      if((await lstat(join(root,child))).isSymbolicLink())throw new Error(`Unexpected dependency symlink: ${name}/${child}`)
      await cp(join(root,child),join(out,child),{recursive:true,dereference:true})
    }
    for(const dependency of Object.keys(manifest.dependencies??{}))await copyPackage(dependency,root,out,lineage)
    for(const dependency of Object.keys(manifest.optionalDependencies??{})) {
      try { await installedRoot(dependency,root) } catch { continue }
      await copyPackage(dependency,root,out,lineage)
    }
    // The Node entry imports common directly although 3.8.1 declares it only
    // transitively. Copy the CPU runtime's matching version, not a hoisted one.
    if(name==='@huggingface/transformers') {
      const onnx=await installedRoot('onnxruntime-node',root)
      await copyPackage('onnxruntime-common',onnx,out,lineage)
    }
  }
  const source=join(here,'../knowledge-ladybug')
  for(const name of ['@ladybugdb/wasm-core','@huggingface/transformers','undici'])await copyPackage(name,source)
  // Directory output retains the exact selected npm package, including its licenses.
  const declared = JSON.parse(await readFile(join(source, 'package.json'), 'utf8')).dependencies['@ladybugdb/wasm-core']
  validateLadybugDependency(declared)
  const selected = declared === OFFICIAL_LADYBUG_VERSION
    ? { name: '@ladybugdb/wasm-core', version: declared }
    : { name: declared.slice(4, declared.lastIndexOf('@')), version: declared.slice(declared.lastIndexOf('@') + 1) }
  const copied = JSON.parse(await readFile(join(destination, 'node_modules/@ladybugdb/wasm-core/package.json'), 'utf8'))
  assert.equal(copied.name, selected.name, 'Copied Ladybug package must match the selected dependency')
  assert.equal(copied.version, selected.version, 'Copied Ladybug version must match the selected dependency')
  // WASM database is portable; local CPU inference dependencies are platform-specific.
  await writeFile(join(destination,'runtime-manifest.json'),JSON.stringify({schemaVersion:1,platform:process.platform,arch:process.arch,
    nodeMajor:Number(process.versions.node.split('.')[0]),dependencies:Object.fromEntries(versions),modelIncluded:false},null,2)+'\n')
}
