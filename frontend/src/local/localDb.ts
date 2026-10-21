import { CapacitorSQLite, SQLiteConnection } from '@capacitor-community/sqlite'
import type { SQLiteDBConnection } from '@capacitor-community/sqlite'

export type LocalRow = Record<string, unknown> & { id?: number }

const DB_NAME = 'chuji_local'
const connection = new SQLiteConnection(CapacitorSQLite)
let dbPromise: Promise<SQLiteDBConnection> | null = null

function database(): Promise<SQLiteDBConnection> {
  if (!dbPromise) {
    dbPromise = (async () => {
      const secretStatus = await connection.isSecretStored()
      if (!secretStatus.result) {
        const secretBytes = crypto.getRandomValues(new Uint8Array(32))
        const passphrase = Array.from(secretBytes, (byte) => byte.toString(16).padStart(2, '0')).join('')
        await connection.setEncryptionSecret(passphrase)
      }
      const db = await connection.createConnection(DB_NAME, true, 'secret', 1, false)
      await db.open()
      await db.execute(`
        CREATE TABLE IF NOT EXISTS local_entities (
          entity TEXT NOT NULL,
          id INTEGER NOT NULL,
          payload TEXT NOT NULL,
          PRIMARY KEY (entity, id)
        );
        CREATE TABLE IF NOT EXISTS local_sequences (
          entity TEXT PRIMARY KEY,
          value INTEGER NOT NULL
        );
        CREATE TABLE IF NOT EXISTS local_meta (
          key TEXT PRIMARY KEY,
          value TEXT NOT NULL
        );
      `)
      return db
    })().catch((error: unknown) => {
      dbPromise = null
      throw error
    })
  }
  return dbPromise
}

export async function listRows<T extends LocalRow = LocalRow>(entity: string): Promise<T[]> {
  const db = await database()
  const result = await db.query('SELECT payload FROM local_entities WHERE entity = ? ORDER BY id DESC', [entity])
  return (result.values ?? []).map((row) => JSON.parse(String(row.payload)) as T)
}

export async function getRow<T extends LocalRow = LocalRow>(entity: string, id: number): Promise<T | null> {
  const db = await database()
  const result = await db.query('SELECT payload FROM local_entities WHERE entity = ? AND id = ?', [entity, id])
  const payload = result.values?.[0]?.payload
  return payload === undefined ? null : JSON.parse(String(payload)) as T
}

export async function saveRow<T extends LocalRow = LocalRow>(entity: string, value: T): Promise<T> {
  const db = await database()
  let id = Number(value.id || 0)
  if (!id) {
    const sequence = await db.query('SELECT value FROM local_sequences WHERE entity = ?', [entity])
    id = Number(sequence.values?.[0]?.value ?? 0) + 1
    await db.run(
      'INSERT INTO local_sequences(entity, value) VALUES(?, ?) ON CONFLICT(entity) DO UPDATE SET value = excluded.value',
      [entity, id],
    )
  }
  const saved = { ...value, id } as T
  await db.run(
    'INSERT INTO local_entities(entity, id, payload) VALUES(?, ?, ?) ON CONFLICT(entity, id) DO UPDATE SET payload = excluded.payload',
    [entity, id, JSON.stringify(saved)],
  )
  return saved
}

export async function deleteRow(entity: string, id: number): Promise<void> {
  const db = await database()
  await db.run('DELETE FROM local_entities WHERE entity = ? AND id = ?', [entity, id])
}

export async function getMeta(key: string): Promise<string | null> {
  const db = await database()
  const result = await db.query('SELECT value FROM local_meta WHERE key = ?', [key])
  const value = result.values?.[0]?.value
  return value === undefined ? null : String(value)
}

export async function setMeta(key: string, value: string): Promise<void> {
  const db = await database()
  await db.run(
    'INSERT INTO local_meta(key, value) VALUES(?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value',
    [key, value],
  )
}

export async function replaceAllRows(data: Record<string, unknown[]>, options: { preserveBackups?: boolean } = {}): Promise<void> {
  const db = await database()
  await db.beginTransaction()
  try {
    if (options.preserveBackups) {
      await db.execute("DELETE FROM local_entities WHERE entity != 'backups'; DELETE FROM local_sequences WHERE entity != 'backups';")
    } else {
      await db.execute('DELETE FROM local_entities; DELETE FROM local_sequences;')
    }
    for (const [entity, rawRows] of Object.entries(data)) {
      let maxId = 0
      for (const raw of rawRows) {
        if (!raw || typeof raw !== 'object') continue
        const row = raw as LocalRow
        const id = Number(row.id || 0)
        if (!id) continue
        maxId = Math.max(maxId, id)
        await db.run('INSERT INTO local_entities(entity, id, payload) VALUES(?, ?, ?)', [entity, id, JSON.stringify(row)])
      }
      if (maxId) await db.run('INSERT INTO local_sequences(entity, value) VALUES(?, ?)', [entity, maxId])
    }
    await db.commitTransaction()
  } catch (error) {
    await db.rollbackTransaction()
    throw error
  }
}

export async function exportAllRows(): Promise<Record<string, LocalRow[]>> {
  const db = await database()
  const result = await db.query('SELECT DISTINCT entity FROM local_entities ORDER BY entity')
  const data: Record<string, LocalRow[]> = {}
  for (const row of result.values ?? []) {
    const entity = String(row.entity)
    data[entity] = await listRows(entity)
  }
  return data
}
