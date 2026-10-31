import 'fake-indexeddb/auto';
import { beforeEach, describe, expect, it } from 'vitest';
import * as db from '../../src/core/db';
import { emptyProgress } from '../../src/core/scan';
import type { Account, ScanJob, Snapshot, SnapshotMeta } from '../../src/core/types';

const snapshot: Snapshot = { id: 'run-test', accountId: 'accountA', startedAt: 100, completedAt: 200, mode: 'full', followers: [], following: [], requests: 2 };
const job: ScanJob = { id: 'scan', runId: snapshot.id, accountId: 'accountA', tabId: 1, mode: 'full', status: 'running', startedAt: 100, updatedAt: 100, dueAt: 100, error: '', requests: 2, retries: 0, interval: 250, pageSize: 100, phase: 'verify', expectedFollowers: 0, expectedFollowing: 0, followers: { ...emptyProgress(), done: true }, following: { ...emptyProgress(), done: true } };

beforeEach(async () => {
  const database = await db.openDB();
  await new Promise<void>((resolve, reject) => {
    const tx = database.transaction([...database.objectStoreNames], 'readwrite');
    for (const name of database.objectStoreNames) tx.objectStore(name).clear();
    tx.oncomplete = () => resolve(); tx.onerror = () => reject(tx.error);
  });
});

describe('persistencia transaccional', () => {
  it('guarda captura, metadatos y trabajo completado juntos', async () => {
    await db.put('jobs', job);
    expect(await db.completeScan(snapshot, job.runId)).toBe(true);
    expect((await db.get<ScanJob>('jobs', 'scan'))?.status).toBe('completed');
    expect((await db.all<SnapshotMeta>('history', 'accountA'))[0].followers).toBe(0);
    expect(await db.get('snapshots', snapshot.id)).toEqual(snapshot);
  });
  it('conserva las discrepancias en la captura y sus metadatos al finalizar', async () => {
    await db.put('jobs', job);
    const observation = { ...snapshot, countDiscrepancies: { followers: { actual: 808, expected: 809 } } };
    expect(await db.completeScan(observation, job.runId)).toBe(true);
    expect((await db.get<Snapshot>('snapshots', snapshot.id))?.countDiscrepancies).toEqual(observation.countDiscrepancies);
    expect((await db.get<SnapshotMeta>('history', snapshot.id))?.countDiscrepancies).toEqual(observation.countDiscrepancies);
  });
  it('no completa un trabajo cancelado o sustituido', async () => {
    await db.put('jobs', { ...job, status: 'cancelled' });
    expect(await db.completeScan(snapshot, job.runId)).toBe(false);
    await db.put('jobs', { ...job, runId: 'otro-trabajo' });
    expect(await db.completeScan(snapshot, job.runId)).toBe(false);
    expect(await db.all('history')).toEqual([]);
  });
  it('no completa si se pausa durante la verificación final', async () => {
    await db.put('jobs', { ...job, status: 'paused' });
    expect(await db.completeScan(snapshot, job.runId)).toBe(false);
  });
  it('las actualizaciones concurrentes no pierden incrementos', async () => {
    await db.put('jobs', job);
    await Promise.all(Array.from({ length: 15 }, () => db.update<ScanJob>('jobs', 'scan', current => ({ ...current!, requests: current!.requests + 1 }))));
    expect((await db.get<ScanJob>('jobs', 'scan'))?.requests).toBe(17);
  });
  it('borrar una cuenta no afecta a otras', async () => {
    await db.put('accounts', { id: 'accountA' } as Account); await db.put('accounts', { id: 'accountB' } as Account);
    await db.put('jobs', job); await db.completeScan(snapshot, job.runId);
    await db.put('snapshots', { ...snapshot, id: 'run-b', accountId: 'accountB' });
    await db.put('history', { ...snapshot, id: 'run-b', accountId: 'accountB', followers: 0, following: 0 });
    await db.clearAccount('accountA');
    expect(await db.get('accounts', 'accountA')).toBeUndefined();
    expect(await db.get('accounts', 'accountB')).toBeDefined();
    expect(await db.get('snapshots', snapshot.id)).toBeUndefined();
    expect(await db.get('snapshots', 'run-b')).toBeDefined();
    expect(await db.all('jobs')).toHaveLength(0);
  });
  it('borrar una captura borra sus metadatos', async () => {
    await db.put('jobs', job); await db.completeScan(snapshot, job.runId);
    await db.deleteSnapshot(snapshot.id);
    expect(await db.all('history')).toHaveLength(0); expect(await db.all('snapshots')).toHaveLength(0);
  });
});
