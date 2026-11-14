# Server database

`infrastructure/db/schema.ts` lazily opens `DATA_DIR/plangent.db`, enables WAL
and foreign keys, and runs migrations. `closeDb()` releases it.
`inTransaction()` runs synchronous atomic work; nested calls use savepoints.

Ordered files live in `infrastructure/db/migrations/`; the runner is in
`001-schema.ts`. Preserve upgrades from existing databases and cover renamed
tables, removed legacy data and retained relationships.

SQL belongs in `infrastructure/db/repositories/<domain>/`. Core imports only
its own repositories. Expose explicit operations preserving conditions such as
updating only running work; wrap multi-write changes in transactions.
Repositories depend on database helpers and models, never core.

`server/tests/support/database.ts` supplies isolated databases.
`npm test` covers persistence/migrations; `npm run lint` rejects SQL and direct
database access in core. See [testing](testing.md).
