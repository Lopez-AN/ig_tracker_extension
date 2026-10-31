import { describe, expect, it } from 'vitest';
import { appendPage, comparisonReference, emptyProgress, isListValidated, makeSnapshot, summarize } from '../../src/core/scan';
import { retryDelay } from '../../src/core/errors';
import type { ScanJob, SnapshotMeta, User } from '../../src/core/types';

const u = (id: string): User => ({ id, username: `cuenta${id}`, fullName: '', avatar: '', isPrivate: false, isVerified: false });
function job(): ScanJob {
  return { id: 'scan', runId: 'test', accountId: '42', tabId: 1, mode: 'full', status: 'running', startedAt: 1, updatedAt: 1, dueAt: 1, error: '', requests: 3, retries: 0, interval: 250, pageSize: 100, phase: 'verify', expectedFollowers: 2, expectedFollowing: 1,
    followers: { ...emptyProgress(), done: true, users: [u('1'), u('2')] }, following: { ...emptyProgress(), done: true, users: [u('2')] } };
}

describe('paginación y finalización', () => {
  it('deduplica solapamientos conservando los perfiles actualizados', () => {
    const first = appendPage(emptyProgress(), { users: [u('1'), u('2')], nextCursor: 'b', hasMore: true });
    const last = appendPage(first, { users: [{ ...u('2'), fullName: 'Nuevo nombre' }, u('3')], nextCursor: '', hasMore: false });
    expect(last.users.map(x => x.id)).toEqual(['1', '2', '3']); expect(last.users[1].fullName).toBe('Nuevo nombre'); expect(last.done).toBe(true);
    expect(first.users).toHaveLength(2);
  });
  it('no usa el tamaño de página para inferir final de lista', () => {
    expect(appendPage(emptyProgress(), { users: [u('1')], nextCursor: 'b', hasMore: true }).done).toBe(false);
  });
  it('rechaza una página con más datos pero sin cursor', () => {
    expect(() => appendPage(emptyProgress(), { users: [u('1')], nextCursor: '', hasMore: true })).toThrow('cursor');
  });
  it('rechaza cursores repetidos y ciclos', () => {
    const one = appendPage(emptyProgress(), { users: [u('1')], nextCursor: 'b', hasMore: true });
    const two = appendPage(one, { users: [u('2')], nextCursor: 'c', hasMore: true });
    expect(() => appendPage(two, { users: [u('3')], nextCursor: 'b', hasMore: true })).toThrow('cursor');
  });
  it('rechaza páginas duplicadas aunque el cursor cambie', () => {
    const one = appendPage(emptyProgress(), { users: [u('1')], nextCursor: 'b', hasMore: true });
    expect(() => appendPage(one, { users: [u('1')], nextCursor: 'c', hasMore: true })).toThrow('cuentas nuevas');
    expect(() => appendPage(one, { users: [u('1')], nextCursor: '', hasMore: false })).toThrow('repite datos');
  });
  it('permite cuentas vacías y una página final vacía', () => {
    expect(appendPage(emptyProgress(), { users: [], nextCursor: '', hasMore: false }).done).toBe(true);
  });
  it('publica una captura validada si ambas listas finalizaron y coinciden', () => {
    const s = makeSnapshot(job(), { followers: 2, following: 1 }, 500);
    expect(s.followers).toHaveLength(2); expect(s.completedAt).toBe(500); expect(s.id).toBe('test');
  });
  it('no publica datos incompletos', () => {
    const j = job(); j.followers.done = false;
    expect(() => makeSnapshot(j, { followers: 2, following: 1 })).toThrow('Faltan páginas');
  });
  it('guarda diferencias pequeñas como observaciones no validadas, no como coincidencias', () => {
    for (const expected of [1, 3]) {
      const s = makeSnapshot(job(), { followers: expected, following: 1 });
      expect(s.countDiscrepancies).toEqual({ followers: { actual: 2, expected } });
      expect(isListValidated(s, 'followers')).toBe(false);
      expect(isListValidated(s, 'following')).toBe(true);
    }
  });
  it('reproduce 808 seguidores frente a los 809 del perfil sin bloquear ni inventar usuarios', () => {
    const j = job(); j.followers.users = Array.from({ length: 808 }, (_, i) => u(String(i)));
    const s = makeSnapshot(j, { followers: 809, following: 1 });
    expect(s.followers).toHaveLength(808);
    expect(s.countDiscrepancies?.followers).toEqual({ actual: 808, expected: 809 });
  });
  it('limita el margen al 1%, con mínimo 1 y máximo 5 cuentas', () => {
    const j = job(); j.followers.users = Array.from({ length: 98 }, (_, i) => u(String(i)));
    expect(() => makeSnapshot(j, { followers: 100, following: 1 })).toThrow('demasiado grande');
    j.followers.users = Array.from({ length: 995 }, (_, i) => u(String(i)));
    expect(makeSnapshot(j, { followers: 1000, following: 1 }).countDiscrepancies?.followers?.actual).toBe(995);
    j.followers.users.pop();
    expect(() => makeSnapshot(j, { followers: 1000, following: 1 })).toThrow('demasiado grande');
  });
  it('no admite diferencias con listas o recuentos vacíos', () => {
    expect(() => makeSnapshot(job(), { followers: 0, following: 1 })).toThrow('contiene 2');
    const j = job(); j.followers.users = [];
    expect(() => makeSnapshot(j, { followers: 1, following: 1 })).toThrow('contiene 0');
  });
  it('valida cada lista por separado y conserva las capturas antiguas como validadas', () => {
    const s = makeSnapshot(job(), { followers: 2, following: 2 });
    expect(s.countDiscrepancies).toEqual({ following: { actual: 1, expected: 2 } });
    expect(isListValidated(s, 'followers')).toBe(true);
    expect(isListValidated(s, 'following')).toBe(false);
    expect(isListValidated(makeSnapshot(job(), { followers: 2, following: 1 }), 'following')).toBe(true);
    expect(isListValidated({ mode: 'followers' }, 'following')).toBe(false);
    expect(isListValidated(null, 'followers')).toBe(false);
  });
  it('una diferencia pequeña no permite saltarse páginas pendientes', () => {
    const j = job(); j.followers.done = false;
    expect(() => makeSnapshot(j, { followers: 3, following: 1 })).toThrow('Faltan páginas');
  });
  it('elige la última referencia con el recuento de esa lista validado', () => {
    const s = makeSnapshot(job(), { followers: 2, following: 1 });
    const meta: SnapshotMeta = { ...s, followers: 2, following: 1 };
    const history = [{ ...meta, id: 'actual' }, { ...meta, id: 'observacion', countDiscrepancies: { followers: { actual: 2, expected: 3 } } }, { ...meta, id: 'referencia' }];
    expect(comparisonReference(history, 'followers')?.id).toBe('referencia');
    expect(comparisonReference(history, 'following')?.id).toBe('observacion');
    expect(comparisonReference(history.slice(0, 2), 'followers')).toBeUndefined();
  });
  it('un escaneo rápido no suplanta la lista de seguidos', () => {
    const j = job(); j.mode = 'followers'; j.following = emptyProgress();
    const s = makeSnapshot(j, { followers: 2, following: 8 });
    expect(s.following).toBeNull();
  });
  it('no inventa ceros ni valida capturas sin un recuento disponible', () => {
    for (const followers of [null, NaN, Infinity, -1, 2.5]) {
      expect(() => makeSnapshot(job(), { followers, following: 1 })).toThrow('No se puede validar');
    }
  });
  it('el resumen no transmite todos los perfiles en cada actualización', () => {
    expect(summarize(job())?.followers).toBe(2); expect(summarize(null)).toBeNull();
  });
});

describe('esperas ante límites de lectura', () => {
  it('aplica espera exponencial acotada', () => {
    expect([0, 1, 2, 3].map(n => retryDelay(n))).toEqual([2000, 4000, 8000, 16000]);
    expect(retryDelay(99)).toBe(120000);
  });
  it('respeta Retry-After aunque sea mayor que nuestra espera', () => {
    expect(retryDelay(0, 300000)).toBe(300000);
  });
  it('ignora cabeceras de espera malformadas', () => {
    expect(retryDelay(0, NaN)).toBe(2000); expect(retryDelay(0, Infinity)).toBe(2000);
  });
});
