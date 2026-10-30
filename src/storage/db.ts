import {
  checkpointToJson,
  MAX_BACKUP_FILE_BYTES,
  newId,
  parseJson,
  SCHEMA_VERSION,
  validateBenchmark,
  validateCheckpoint,
  validateDriver,
  validateExperiment,
  type BenchmarkRecord,
  type CheckpointRecord,
  type DriverRecord,
  type ExperimentRecord,
} from './validation';

export const DB_NAME = 'autopilot-lab';
export const DB_VERSION = 2;

export interface Stores {
  drivers: DriverRecord;
  experiments: ExperimentRecord;
  checkpoints: CheckpointRecord;
  benchmarks: BenchmarkRecord;
}
export type StoreName = keyof Stores;

const VALIDATORS: { [K in StoreName]: (v: unknown) => Stores[K] } = {
  drivers: validateDriver,
  experiments: validateExperiment,
  checkpoints: validateCheckpoint,
  benchmarks: validateBenchmark,
};

/**
 * Migration strategy: each schema version adds what it needs inside `onupgradeneeded`, falling through
 * from the user's current version so any older database is upgraded step by step. Existing records are
 * never rewritten by a migration; records are validated (and repaired or skipped) when read instead.
 */
function migrate(db: IDBDatabase, tx: IDBTransaction, oldVersion: number): void {
  if (oldVersion < 1) {
    db.createObjectStore('drivers', { keyPath: 'id' });
    db.createObjectStore('experiments', { keyPath: 'id' });
    db.createObjectStore('checkpoints', { keyPath: 'id' });
  }
  if (oldVersion < 2) {
    db.createObjectStore('benchmarks', { keyPath: 'id' });
    tx.objectStore('checkpoints').createIndex('experimentId', 'experimentId');
  }
}

let dbPromise: Promise<IDBDatabase> | null = null;

export function openDb(): Promise<IDBDatabase> {
  if (dbPromise) return dbPromise;
  dbPromise = new Promise<IDBDatabase>((resolve, reject) => {
    if (typeof indexedDB === 'undefined') {
      reject(new Error('IndexedDB is not available in this browser; data cannot be saved.'));
      return;
    }
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = (e) => migrate(req.result, req.transaction!, e.oldVersion);
    req.onsuccess = () => {
      const db = req.result;
      db.onversionchange = () => {
        db.close();
        dbPromise = null;
      };
      resolve(db);
    };
    req.onerror = () =>
      reject(new Error(`Could not open the database: ${req.error?.message ?? 'unknown error'}`));
    req.onblocked = () =>
      reject(new Error('Database upgrade is blocked by another open tab. Close other tabs and reload.'));
  });
  dbPromise.catch(() => (dbPromise = null));
  return dbPromise;
}

/** Test helper: close and forget the cached connection. */
export async function closeDb(): Promise<void> {
  if (dbPromise) (await dbPromise.catch(() => null))?.close();
  dbPromise = null;
}

function request<T>(req: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(new Error(storageError(req.error)));
  });
}

function storageError(e: DOMException | null): string {
  if (e?.name === 'QuotaExceededError')
    return 'Storage is full. Delete old checkpoints or experiments and try again.';
  if (e?.name === 'ConstraintError') return 'A record with this id already exists; it was not overwritten.';
  return `Storage error: ${e?.message ?? 'unknown'}`;
}

async function store<K extends StoreName>(name: K, mode: IDBTransactionMode): Promise<IDBObjectStore> {
  const db = await openDb();
  return db.transaction(name, mode).objectStore(name);
}

export interface LoadResult<T> {
  items: T[];
  /** Records that failed validation (skipped, never silently deleted). */
  corrupt: string[];
}

export async function getAll<K extends StoreName>(name: K): Promise<LoadResult<Stores[K]>> {
  const raw = await request((await store(name, 'readonly')).getAll());
  const items: Stores[K][] = [];
  const corrupt: string[] = [];
  for (const r of raw as unknown[]) {
    try {
      items.push(VALIDATORS[name](r));
    } catch {
      corrupt.push(String((r as { id?: unknown })?.id ?? '?'));
    }
  }
  return { items, corrupt };
}

export async function get<K extends StoreName>(name: K, id: string): Promise<Stores[K] | null> {
  const r = await request((await store(name, 'readonly')).get(id));
  return r === undefined ? null : VALIDATORS[name](r);
}

/** Inserts a new record; fails rather than overwrite an existing id. */
export async function add<K extends StoreName>(name: K, record: Stores[K]): Promise<void> {
  await request((await store(name, 'readwrite')).add(record));
}

/** Updates a record the app owns (e.g. an experiment's growing history). */
export async function put<K extends StoreName>(name: K, record: Stores[K]): Promise<void> {
  await request((await store(name, 'readwrite')).put(record));
}

export async function remove(name: StoreName, id: string): Promise<void> {
  await request((await store(name, 'readwrite')).delete(id));
}

function txDone(tx: IDBTransaction): Promise<void> {
  return new Promise<void>((resolve, reject) => {
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(new Error(storageError(tx.error)));
    tx.onabort = () => reject(new Error(storageError(tx.error)));
  });
}

export async function clearAll(): Promise<void> {
  const db = await openDb();
  const names: StoreName[] = ['drivers', 'experiments', 'checkpoints', 'benchmarks'];
  const tx = db.transaction(names, 'readwrite');
  for (const n of names) tx.objectStore(n).clear();
  await txDone(tx);
}

/** Deletes records that fail validation (user-confirmed repair). */
export async function removeCorrupt(name: StoreName, ids: string[]): Promise<void> {
  for (const id of ids) await remove(name, id);
}

/** Replaces the single auto-checkpoint of an experiment. Manual checkpoints are never touched. */
export async function saveAutoCheckpoint(c: CheckpointRecord): Promise<void> {
  const db = await openDb();
  // Single transaction: the old auto-checkpoint is only removed if the new one is written.
  const tx = db.transaction('checkpoints', 'readwrite');
  const s = tx.objectStore('checkpoints');
  const cursorReq = s.index('experimentId').openCursor(IDBKeyRange.only(c.experimentId));
  cursorReq.onsuccess = () => {
    const cur = cursorReq.result;
    if (cur) {
      if ((cur.value as CheckpointRecord).kind === 'auto') cur.delete();
      cur.continue();
    } else s.add(c);
  };
  await txDone(tx);
}

// ---------- Backups ----------

export const BACKUP_FORMAT = 'autopilot-lab/backup';

export async function exportBackup(): Promise<string> {
  const [drivers, experiments, checkpoints, benchmarks] = await Promise.all([
    getAll('drivers'),
    getAll('experiments'),
    getAll('checkpoints'),
    getAll('benchmarks'),
  ]);
  return JSON.stringify({
    format: BACKUP_FORMAT,
    schemaVersion: SCHEMA_VERSION,
    exportedAt: new Date().toISOString(),
    drivers: drivers.items,
    experiments: experiments.items,
    checkpoints: checkpoints.items.map(checkpointToJson),
    benchmarks: benchmarks.items,
  });
}

export interface ImportSummary {
  imported: number;
  renamed: number;
  rejected: number;
}

/**
 * Imports a backup. Every record is validated; records whose id already exists are imported under a new
 * id (existing data is never overwritten). Invalid records are counted and skipped.
 */
export async function importBackup(raw: string): Promise<ImportSummary> {
  const data = parseJson(raw, MAX_BACKUP_FILE_BYTES) as Record<string, unknown> | null;
  if (!data || data.format !== BACKUP_FORMAT) throw new Error('This file is not an Autopilot Lab backup.');
  const summary: ImportSummary = { imported: 0, renamed: 0, rejected: 0 };
  const names: StoreName[] = ['drivers', 'experiments', 'checkpoints', 'benchmarks'];
  const idMap = new Map<string, string>();
  for (const name of names) {
    const list = data[name];
    if (!Array.isArray(list)) continue;
    const existing = new Set((await getAll(name)).items.map((r) => r.id));
    for (const raw of list) {
      let rec: Stores[StoreName];
      try {
        rec = VALIDATORS[name](raw);
      } catch {
        summary.rejected++;
        continue;
      }
      if (existing.has(rec.id)) {
        const fresh = newId();
        idMap.set(rec.id, fresh);
        rec = { ...rec, id: fresh };
        summary.renamed++;
      }
      if (name === 'checkpoints') {
        const c = rec as CheckpointRecord;
        c.experimentId = idMap.get(c.experimentId) ?? c.experimentId;
      }
      await add(name, rec as never);
      summary.imported++;
    }
  }
  return summary;
}

export async function storageEstimate(): Promise<{ usage: number; quota: number } | null> {
  if (typeof navigator === 'undefined' || !navigator.storage?.estimate) return null;
  const e = await navigator.storage.estimate();
  return { usage: e.usage ?? 0, quota: e.quota ?? 0 };
}
