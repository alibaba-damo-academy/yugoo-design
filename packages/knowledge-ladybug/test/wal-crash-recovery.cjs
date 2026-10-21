// Standalone durability gate: node test/wal-crash-recovery.cjs
// LADYBUG_DRIVER may select a candidate absolute module path. Never opens project DBs.
const assert = require('node:assert/strict')
const fs = require('node:fs')
const { fork } = require('node:child_process')
const { tmpdir } = require('node:os')
const { join } = require('node:path')
const vector = Array.from({ length: 384 }, (_, i) => Math.fround(Math.sin(i * 1.731 + 0.23) / 20))
const driver = process.env.LADYBUG_DRIVER || '@ladybugdb/wasm-core/nodejs'

async function child(mode, kind, operation, file) {
  const lbug = require(driver)
  const db = new lbug.Database(file, 128 * 1024 * 1024, 2)
  const connection = new lbug.Connection(db)
  async function query(sql) {
    const result = await connection.query(sql)
    try {
      assert.equal(result.isSuccess(), true, await result.getErrorMessage())
      return await result.getAllObjects()
    } finally { await result.close() }
  }
  async function verify() {
    const rows = await query('MATCH (n:Test) RETURN n.id AS id, n.payload AS payload')
    assert.equal(rows.length, operation === 'batch' ? 4 : 1, 'Persisted row count')
    for (const row of rows) {
      const actual = kind === 'json' ? JSON.parse(row.payload) : Array.from(row.payload)
      assert.deepEqual(actual, vector, `Vector mismatch at ${row.id}`)
    }
    return rows.length
  }
  await connection.init()
  if (mode !== 'read') {
    const type = kind === 'json' ? 'STRING' : 'FLOAT[384]'
    const value = kind === 'json' ? `'${JSON.stringify(vector)}'` : `CAST([${vector}] AS FLOAT[384])`
    await query(`CREATE NODE TABLE Test(id STRING, payload ${type}, PRIMARY KEY(id))`)
    if (operation === 'update') {
      const initial = kind === 'json' ? "'[]'" : `CAST([${Array(384).fill(0)}] AS FLOAT[384])`
      await query(`CREATE (:Test {id:'0',payload:${initial}})`)
    }
    await query('CHECKPOINT') // Isolate committed data WAL from schema creation.
    if (operation === 'batch') await query(`UNWIND range(0,3) AS i CREATE (:Test {id:CAST(i AS STRING),payload:${value}})`)
    else if (operation === 'update') await query(`MATCH (n:Test) SET n.payload=${value}`)
    else await query(`CREATE (:Test {id:'0',payload:${value}})`)
    await verify()
    if (mode === 'crash') {
      process.send({ committed: true, verifiedBeforeExit: true })
      setInterval(() => {}, 1000) // Parent kills only this exact fixture process.
      return
    }
  }
  const rows = await verify()
  await connection.close()
  await db.close()
  await lbug.close()
  process.send({ verified: true, rows })
  process.exit(0)
}

function run(args) {
  return new Promise(resolve => {
    let message, stderr = '', timedOut = false
    const processChild = fork(__filename, args, { stdio: ['ignore', 'ignore', 'pipe', 'ipc'] })
    const timer = setTimeout(() => { timedOut = true; processChild.kill('SIGKILL') }, 60_000)
    processChild.stderr.on('data', data => { stderr = (stderr + data).slice(-4000) })
    processChild.on('message', value => {
      message = value
      if (value.committed) processChild.kill('SIGKILL')
    })
    processChild.on('exit', (code, signal) => {
      clearTimeout(timer)
      resolve({ code, signal, message, timedOut, stderr })
    })
  })
}

if (process.argv.length > 2) {
  child(...process.argv.slice(2)).catch(error => { console.error(error.stack); process.exit(1) })
} else {
  ;(async () => {
    const directory = fs.mkdtempSync(join(tmpdir(), 'ladybug-wal-gate-'))
    const results = []
    console.log(`Evidence directory: ${directory}`)
    for (const mode of ['crash', 'clean']) for (const kind of ['json', 'float']) for (const operation of ['insert', 'update', 'batch']) {
      const file = join(directory, `${mode}-${kind}-${operation}.lbdb`)
      const write = await run([mode, kind, operation, file])
      for (const suffix of ['', '.wal']) if (fs.existsSync(file + suffix)) fs.copyFileSync(file + suffix, file + '.preserved' + suffix)
      const read = await run(['read', kind, operation, file])
      const passed = !write.timedOut && (mode === 'crash'
        ? write.signal === 'SIGKILL' && write.message?.verifiedBeforeExit === true
        : write.code === 0 && write.message?.verified === true)
        && read.code === 0 && read.message?.verified === true
      const result = { mode, kind, operation, passed, write, read }
      results.push(result)
      console.log(`${passed ? 'PASS' : 'FAIL'} ${mode}/${kind}/${operation}`)
    }
    fs.writeFileSync(join(directory, 'results.json'), JSON.stringify({ driver, results }, null, 2))
    process.exitCode = results.every(result => result.passed) ? 0 : 1
  })().catch(error => { console.error(error); process.exitCode = 1 })
}
