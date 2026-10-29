import type { Account, BatchJob, ConnectionIssue, RelationOverride, ScanJob, Settings, Snapshot, SnapshotMeta } from './types';

export type Store = 'accounts' | 'snapshots' | 'history' | 'jobs' | 'settings' | 'relations';
export interface StoreTypes {
  accounts: Account;
  snapshots: Snapshot;
  history: SnapshotMeta;
  jobs: ScanJob | BatchJob;
  settings: { id: string; value: Settings | ConnectionIssue | string | null };
  relations: RelationOverride;
}

let connection: Promise<IDBDatabase> | undefined;
export function openDB(): Promise<IDBDatabase> {
  connection ??= new Promise((resolve, reject) => {
    const request = indexedDB.open('ig-tracker-v1', 1);
    request.onupgradeneeded = () => {
      const db = request.result;
      for (const name of ['accounts', 'snapshots', 'history', 'jobs', 'settings', 'relations'] as Store[]) {
        const store = db.createObjectStore(name, { keyPath: 'id' });
        if (['snapshots', 'history', 'relations'].includes(name)) store.createIndex('accountId', 'accountId');
      }
    };
    request.onsuccess = () => {
      request.result.onversionchange = () => { request.result.close(); connection = undefined; };
      resolve(request.result);
    };
    request.onerror = () => { connection = undefined; reject(request.error); };
  });
  return connection;
}

export async function get<T>(store: Store, id: string): Promise<T | undefined> {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const request = db.transaction(store).objectStore(store).get(id);
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

export async function all<T>(store: Store, accountId?: string): Promise<T[]> {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const source = db.transaction(store).objectStore(store);
    const request = accountId ? source.index('accountId').getAll(accountId) : source.getAll();
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

export async function put(store: Store, value: unknown): Promise<void> {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(store, 'readwrite');
    tx.objectStore(store).put(value);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error ?? new Error('No se pudo guardar el cambio.'));
  });
}

export async function update<T>(store: Store, id: string, change: (value: T | undefined) => T | undefined): Promise<T | undefined> {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(store, 'readwrite');
    const source = tx.objectStore(store);
    const request = source.get(id);
    let next: T | undefined;
    let failure: unknown;
    request.onsuccess = () => {
      try {
        next = change(request.result);
        if (next !== undefined) source.put(next);
      } catch (error) { failure = error; tx.abort(); }
    };
    tx.oncomplete = () => resolve(next);
    tx.onerror = () => reject(failure ?? tx.error);
    tx.onabort = () => reject(failure ?? tx.error ?? new Error('No se pudo guardar el cambio.'));
  });
}

export async function completeScan(snapshot: Snapshot, runId: string): Promise<boolean> {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(['jobs', 'snapshots', 'history'], 'readwrite');
    const jobs = tx.objectStore('jobs');
    const request = jobs.get('scan');
    let committed = false;
    request.onsuccess = () => {
      const job = request.result as ScanJob | undefined;
      if (!job || job.runId !== runId || job.status !== 'running') return;
      tx.objectStore('snapshots').put(snapshot);
      tx.objectStore('history').put({ ...snapshot, followers: snapshot.followers.length, following: snapshot.following?.length ?? null });
      jobs.put({ ...job, status: 'completed', completedAt: snapshot.completedAt, updatedAt: snapshot.completedAt, error: '', errorCode: undefined });
      committed = true;
    };
    tx.oncomplete = () => resolve(committed);
    tx.onabort = tx.onerror = () => reject(tx.error);
  });
}

export async function deleteSnapshot(id: string): Promise<void> {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(['snapshots', 'history'], 'readwrite');
    tx.objectStore('snapshots').delete(id);
    tx.objectStore('history').delete(id);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

export async function clearAccount(accountId: string): Promise<void> {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(['accounts', 'snapshots', 'history', 'relations', 'jobs'], 'readwrite');
    tx.objectStore('accounts').delete(accountId);
    for (const name of ['snapshots', 'history', 'relations']) {
      const request = tx.objectStore(name).index('accountId').openCursor(accountId);
      request.onsuccess = () => { const cursor = request.result; if (cursor) { cursor.delete(); cursor.continue(); } };
    }
    const request = tx.objectStore('jobs').openCursor();
    request.onsuccess = () => { const cursor = request.result; if (cursor) { if (cursor.value.accountId === accountId) cursor.delete(); cursor.continue(); } };
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}
