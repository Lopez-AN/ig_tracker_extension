import { describe, expect, it } from 'vitest';
import { appendPage, emptyProgress, makeSnapshot, summarize } from '../../src/core/scan';
import { retryDelay } from '../../src/core/errors';
import type { ScanJob, User } from '../../src/core/types';

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
  it('publica una captura solo si ambas listas finalizaron y coinciden', () => {
    const s = makeSnapshot(job(), { followers: 2, following: 1 }, 500);
    expect(s.followers).toHaveLength(2); expect(s.completedAt).toBe(500); expect(s.id).toBe('test');
  });
  it('no publica datos incompletos', () => {
    const j = job(); j.followers.done = false;
    expect(() => makeSnapshot(j, { followers: 2, following: 1 })).toThrow('Faltan páginas');
  });
  it('no publica recuentos diferentes (ni por exceso ni por defecto)', () => {
    expect(() => makeSnapshot(job(), { followers: 3, following: 1 })).toThrow('contiene 2');
    expect(() => makeSnapshot(job(), { followers: 1, following: 1 })).toThrow('contiene 2');
  });
  it('un escaneo rápido no suplanta la lista de seguidos', () => {
    const j = job(); j.mode = 'followers'; j.following = emptyProgress();
    const s = makeSnapshot(j, { followers: 2, following: 8 });
    expect(s.following).toBeNull();
  });
  it('no inventa ceros ni valida capturas sin un recuento disponible', () => {
    expect(() => makeSnapshot(job(), { followers: null, following: null })).toThrow('No se puede validar');
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
