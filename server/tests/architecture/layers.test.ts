import path from 'node:path'
import { RuleTester } from 'eslint'
const parser = require('@typescript-eslint/parser')
const rule = require('../../../scripts/eslint-server-layers.mjs').default

const file = (name: string) => path.resolve('server', name)
new RuleTester({ languageOptions: { parser } }).run('server-layers', rule, {
  valid: [
    { filename: file('api/example.ts'), code: "import { value } from '../core/example'" },
    { filename: file('core/tasks/example.ts'), code: "import { value } from '../../infrastructure/db/repositories/tasks'" },
    { filename: file('core/tasks/example.ts'), code: "import { getProject } from '../projects'" },
    { filename: file('core/agents/example.ts'), code: "import type { Task } from '../tasks'" },
    { filename: file('core/agents/example.ts'), code: "type Task = import('../tasks').Task" },
    { filename: file('core/tasks/example.ts'), code: "export { getProject } from '../projects'" },
    { filename: file('tests/tasks/example.test.ts'), code: "import { getDb } from '../../infrastructure/db/schema'" },
    { filename: file('infrastructure/example.ts'), code: "import type { Agent } from '../models'" },
    { filename: file('models/example.ts'), code: "export type { Agent } from '@contracts'" },
  ],
  invalid: [
    { filename: file('core/tasks/example.ts'), code: "import { getDb } from '../../infrastructure/db/schema'", errors: [{ messageId: 'boundary' }] },
    { filename: file('core/tasks/example.ts'), code: "import Database from 'better-sqlite3'", errors: [{ messageId: 'boundary' }] },
    { filename: file('core/tasks/example.ts'), code: "import { value } from '../../infrastructure/db/repositories/projects'", errors: [{ messageId: 'boundary' }] },
    { filename: file('core/tasks/example.ts'), code: "import { value } from '../projects/internal'", errors: [{ messageId: 'boundary' }] },
    { filename: file('core/tasks/example.ts'), code: "type Value = import('../projects/internal').Value", errors: [{ messageId: 'boundary' }] },
    { filename: file('core/tasks/example.ts'), code: "type Db = import('../../infrastructure/db/schema').Db", errors: [{ messageId: 'boundary' }] },
    { filename: file('core/tasks/example.test.ts'), code: "import { value } from '../projects/internal'", errors: [{ messageId: 'boundary' }] },
    { filename: file('core/projects/example.ts'), code: "import { getTask } from '../tasks'", errors: [{ messageId: 'boundary' }] },
    { filename: file('core/projects/example.ts'), code: "const tasks = import('../tasks')", errors: [{ messageId: 'boundary' }] },
    { filename: file('core/tasks/example.ts'), code: "const sql = 'SELECT * FROM tasks'", errors: [{ messageId: 'boundary' }] },
    { filename: file('core/tasks/example.ts'), code: 'const sql = `UPDATE tasks SET status=?`', errors: [{ messageId: 'boundary' }] },
    { filename: file('api/example.ts'), code: "import { value } from '../infrastructure/example'", errors: [{ messageId: 'boundary' }] },
    { filename: file('core/example.ts'), code: "export { value } from '../api/example'", errors: [{ messageId: 'boundary' }] },
    { filename: file('infrastructure/example.ts'), code: "import { value } from '../core/example'", errors: [{ messageId: 'boundary' }] },
    { filename: file('infrastructure/example.ts'), code: "const value = import('../api/example')", errors: [{ messageId: 'boundary' }] },
    { filename: file('infrastructure/example.ts'), code: "import value = require('../core/example')", errors: [{ messageId: 'boundary' }] },
    { filename: file('infrastructure/example.ts'), code: "const value = require('../core/example')", errors: [{ messageId: 'boundary' }] },
    { filename: file('models/example.ts'), code: "import fs from 'node:fs'", errors: [{ messageId: 'boundary' }] },
    { filename: file('models/example.ts'), code: "export * from './other'", errors: [{ messageId: 'boundary' }] },
  ],
})
