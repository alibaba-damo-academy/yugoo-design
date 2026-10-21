// Issue #771: replay a >4KB record in the same WASM worker, not a fresh process.
// Only newly created fixture databases are opened; user databases are never used.
const test = require('node:test')
const assert = require('node:assert/strict')
const { mkdtempSync, statSync } = require('node:fs')
const { tmpdir } = require('node:os')
const { join } = require('node:path')

test('large WAL records survive same-process reopen with closed and still-live original databases', { timeout: 30_000 }, async t => {
  const driver = process.env.LADYBUG_DRIVER || '@ladybugdb/wasm-core/nodejs'
  const lbug = require(driver)
  const directory = mkdtempSync(join(tmpdir(), 'ladybug-same-process-'))
  t.diagnostic(JSON.stringify({ driver: require.resolve(driver), version: await lbug.getVersion(), directory }))
  async function query(connection, sql) {
    const result = await connection.query(sql)
    try {
      assert.equal(await result.isSuccess(), true, await result.getErrorMessage())
      return await result.getAllObjects()
    } finally { await result.close() }
  }
  try {
    for (const keepOriginalAlive of [false, true]) {
      const file = join(directory, keepOriginalAlive ? 'original-alive.lbdb' : 'original-closed.lbdb')
      const payload = 'x'.repeat(5000)
      let original, connection, reopened, reader
      try {
        original = new lbug.Database(file, 64 * 1024 * 1024, 2, true, false, false)
        connection = new lbug.Connection(original)
        await connection.init()
        await query(connection, 'CALL force_checkpoint_on_close=false')
        await query(connection, 'CREATE NODE TABLE Test(id INT64, content STRING, PRIMARY KEY(id))')
        await query(connection, 'CHECKPOINT') // Schema only; do not checkpoint the large record.
        await query(connection, `CREATE (:Test {id:1,content:'${payload}'})`)
        const before = await query(connection, 'MATCH (n:Test) RETURN n.content AS content')
        assert.deepEqual(before.map(row => row.content), [payload])
        assert.ok(statSync(file + '.wal').size > 4096, 'fixture must exercise large-record WAL replay')
        if (!keepOriginalAlive) {
          await connection.close(); connection = undefined
          await original.close(); original = undefined
          assert.ok(statSync(file + '.wal').size > 4096, 'close must leave the WAL replay path intact')
        }
        // No lbug.close(), worker replacement, GC, or child process between opens.
        reopened = new lbug.Database(file, 64 * 1024 * 1024, 2, true, true, false)
        reader = new lbug.Connection(reopened)
        await reader.init()
        const after = await query(reader, 'MATCH (n:Test) RETURN n.content AS content')
        assert.deepEqual(after.map(row => row.content), [payload])
        t.diagnostic(JSON.stringify({ keepOriginalAlive, payloadBytes: payload.length, verified: true }))
      } finally {
        try {
          if (reader) await reader.close()
        } finally {
          try {
            if (reopened) await reopened.close()
          } finally {
            try {
              if (connection) await connection.close()
            } finally { if (original) await original.close() }
          }
        }
      }
    }
  } finally { await lbug.close() }
})
