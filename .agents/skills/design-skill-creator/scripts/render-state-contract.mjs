/** Authoring-only projection. Writes nothing; schema.yaml remains authoritative. */
import { readFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { pathToFileURL } from 'node:url'

const cell = value => String(value).replaceAll('|', '\\|').replaceAll('\n', ' ')
export function renderStateContract(schema) {
  const rows = ['| 路径 | 类型 / 可用值 | 必需字段 / 约束 / 引用 |', '| --- | --- | --- |']
  function visit(node, path) {
    const type = node.values ? `${node.type}: ${JSON.stringify(node.values)}` : node.type
    const constraints = []
    if (node.required?.length) constraints.push(`必需: ${node.required.join(', ')}`)
    if (node.additional_properties === false) constraints.push('禁止额外字段')
    if (node.knowledge?.target) constraints.push(`记录 key → ${node.knowledge.target}`)
    rows.push(`| ${cell(path || '(root)')} | ${cell(type)} | ${cell(constraints.join('；'))} |`)
    for (const [key, child] of Object.entries(node.properties ?? {})) visit(child, `${path}/${key}`)
    if (node.value) visit(node.value, `${path}/*`)
    if (node.items) visit(node.items, `${path}/[]`)
  }
  visit(schema, '')
  return rows.join('\n')
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  if (process.argv.length !== 4) {
    console.error('Usage: node render-state-contract.mjs <repository-root> <schema.yaml>')
    process.exitCode = 2
  } else {
    const core = pathToFileURL(resolve(process.argv[2], 'packages/core/lib/index.js')).href
    const { parseSchemaYaml } = await import(core)
    console.log(renderStateContract(parseSchemaYaml(await readFile(resolve(process.argv[3]), 'utf8'))))
  }
}
