const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')

// Each test worker gets a fallback directory before static service imports run.
// Suites can still choose their own directory before loading application code.
const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'plangent-test-worker-'))
process.env.PLANGENT_DATA_DIR = directory
// Command-runner fixtures clear their log folder. Keep each worker's OS temp
// separate so they cannot remove another worker's logs or the hosting app's
// run_command log while a full suite is executing through Plangent.
const temporary = path.join(directory, 'tmp')
fs.mkdirSync(temporary)
process.env.TEMP = temporary
process.env.TMP = temporary
process.env.TMPDIR = temporary
process.once('exit', () => {
  const schema = require.cache[path.resolve('server/infrastructure/db/schema.ts')]
  schema?.exports.closeDb?.()
  fs.rmSync(directory, { recursive: true, force: true })
})
