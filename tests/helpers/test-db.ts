import { Database } from 'bun:sqlite'
import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'

class TestPreparedStatement {
  constructor(
    private readonly sqlite: Database,
    private readonly sql: string,
    private readonly bindings: unknown[] = [],
  ) {}

  bind(...bindings: unknown[]) {
    return new TestPreparedStatement(this.sqlite, this.sql, bindings)
  }

  async first<T>() {
    const row = this.sqlite.query(this.sql).get(...this.bindings) as T | null
    return row ?? null
  }

  async all<T>() {
    const rows = this.sqlite.query(this.sql).all(...this.bindings) as T[]
    return { results: rows }
  }

  async run() {
    this.sqlite.query(this.sql).run(...this.bindings)
    const row = this.sqlite.query('SELECT last_insert_rowid() AS id').get() as { id: number } | null
    return { meta: { last_row_id: Number(row?.id ?? 0) } }
  }
}

export function createTestD1Database() {
  const sqlite = new Database(':memory:')
  sqlite.exec('PRAGMA foreign_keys = ON;')
  const db = {
    prepare(sql: string) {
      return new TestPreparedStatement(sqlite, sql) as never
    },
    async batch(statements: Array<{ run: () => Promise<unknown> }>) {
      return await Promise.all(statements.map((statement) => statement.run()))
    },
    exec(sql: string) {
      sqlite.exec(sql)
    },
    sqlite,
  }

  const migrationsDir = join(import.meta.dir, '..', '..', 'migrations')
  const migrationFiles = readdirSync(migrationsDir)
    .filter((file) => file.endsWith('.sql'))
    .sort()

  for (const file of migrationFiles) {
    db.exec(readFileSync(join(migrationsDir, file), 'utf8'))
  }

  return db
}
