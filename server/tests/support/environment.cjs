const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')

// Each test worker gets a fallback directory before static service imports run.
// Suites can still choose their own directory before loading application code.
const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'plangent-test-worker-'))
process.env.PLANGENT_DATA_DIR = directory
process.once('exit', () => {
  const schema = require.cache[path.resolve('server/infrastructure/db/schema.ts')]
  schema?.exports.closeDb?.()
  fs.rmSync(directory, { recursive: true, force: true })
})
