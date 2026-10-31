import { TrackerError } from './errors';
import type { CountDiscrepancies, ListKind, ListPage, ListProgress, ScanJob, ScanSummary, Snapshot, SnapshotMeta } from './types';

export const emptyProgress = (): ListProgress => ({ users: [], cursor: '', cursors: [], done: false, pages: 0 });

export function appendPage(progress: ListProgress, page: ListPage): ListProgress {
  const known = new Map(progress.users.map(user => [user.id, user]));
  let added = 0;
  for (const user of page.users) {
    if (!known.has(user.id)) added++;
    known.set(user.id, user);
  }
  if (page.hasMore && (!page.nextCursor || page.nextCursor === progress.cursor || progress.cursors.includes(page.nextCursor))) {
    throw new TrackerError('CURSOR', 'Instagram ha repetido el cursor de paginación. Inicia un nuevo escaneo para obtener una lista completa.');
  }
  if (page.hasMore && added === 0) {
    throw new TrackerError('INCOMPLETE', 'Instagram ha devuelto una página sin cuentas nuevas. El escaneo se ha detenido para no registrar pérdidas incorrectas.');
  }
  // An entirely duplicated last page after earlier pages is not evidence of a complete list.
  if (!page.hasMore && page.users.length > 0 && added === 0 && progress.pages > 0) {
    throw new TrackerError('INCOMPLETE', 'La última página repite datos anteriores. Vuelve a escanear cuando Instagram entregue la lista completa.');
  }
  return {
    users: [...known.values()],
    cursor: page.nextCursor,
    cursors: [...progress.cursors, ...(page.nextCursor ? [page.nextCursor] : [])],
    done: !page.hasMore,
    pages: progress.pages + 1,
  };
}

export function summarize(job: ScanJob | null | undefined): ScanSummary | null {
  return job ? { ...job, followers: job.followers.users.length, following: job.following.users.length } : null;
}

export function isListValidated(snapshot: Pick<Snapshot, 'mode' | 'countDiscrepancies'> | null | undefined, kind: ListKind): boolean {
  // Older snapshots were only saved after exact count validation.
  return !!snapshot && (kind === 'followers' || snapshot.mode === 'full') && !snapshot.countDiscrepancies?.[kind];
}

export function comparisonReference(history: SnapshotMeta[], kind: ListKind): SnapshotMeta | undefined {
  // History is newest first; the first entry is the observation being compared.
  return history.slice(1).find(snapshot => isListValidated(snapshot, kind));
}

export function makeSnapshot(job: ScanJob, counts: { followers: number | null; following: number | null }, now = Date.now()): Snapshot {
  if (!job.followers.done || (job.mode === 'full' && !job.following.done)) {
    throw new TrackerError('INCOMPLETE', 'Faltan páginas por descargar. El historial solo admite escaneos completos.');
  }
  const countDiscrepancies: CountDiscrepancies = {};
  for (const kind of job.mode === 'full' ? ['followers', 'following'] as const : ['followers'] as const) {
    const actual = job[kind].users.length;
    const expected = counts[kind];
    if (expected === null || !Number.isSafeInteger(expected) || expected < 0) {
      throw new TrackerError('COUNT_UNAVAILABLE', `Instagram no ha proporcionado el recuento de ${kind === 'followers' ? 'seguidores' : 'seguidos'}. No se puede validar la captura. Inténtalo de nuevo más tarde.`);
    }
    if (actual !== expected) {
      // A finished traversal can differ slightly from the profile counter. Keep
      // those observations, but never treat the tolerance as proof of absence.
      const tolerance = Math.max(1, Math.min(5, Math.floor(expected * 0.01)));
      if (actual === 0 || expected === 0 || Math.abs(actual - expected) > tolerance) {
        throw new TrackerError('COUNT_MISMATCH', `La lista de ${kind === 'followers' ? 'seguidores' : 'seguidos'} contiene ${actual} cuentas, pero Instagram indica ${expected}. Cancela este escaneo e inicia otro; la diferencia es demasiado grande para guardar la captura.`);
      }
      countDiscrepancies[kind] = { actual, expected };
    }
  }
  return {
    id: job.runId, accountId: job.accountId, startedAt: job.startedAt, completedAt: now,
    mode: job.mode, followers: job.followers.users,
    following: job.mode === 'full' ? job.following.users : null, requests: job.requests,
    ...(Object.keys(countDiscrepancies).length ? { countDiscrepancies } : {}),
  };
}
