import { describe, expect, it } from 'vitest';
import { calculateMetrics, metricWarning } from '../../src/core/analytics';
import type { RelationOverride, Snapshot, User } from '../../src/core/types';

const u = (id: string, username = `cuenta${id}`): User => ({ id, username, fullName: username, avatar: '', isPrivate: false, isVerified: false });
const snapshot = (followers: User[], following: User[] | null = [], time = 100, accountId = '42'): Snapshot => ({ id: String(time), accountId, startedAt: time, completedAt: time + 1, followers, following, mode: following ? 'full' : 'followers', requests: 2 });

describe('comparaciones por identificador', () => {
  it('no inventa datos sin una captura', () => {
    expect(Object.values(calculateMetrics(null, null, null, null)).every(list => list.length === 0)).toBe(true);
  });
  it('la primera referencia no declara nuevos ni perdidos', () => {
    const s = snapshot([u('1')]);
    const result = calculateMetrics(s, null, s, null);
    expect(result.new).toHaveLength(0); expect(result.lost).toHaveLength(0); expect(result.followers).toHaveLength(1);
  });
  it('identifica altas, bajas, relaciones y nuevos seguidos', () => {
    const old = snapshot([u('1'), u('2'), u('3')], [u('2'), u('5')], 10);
    const current = snapshot([u('2'), u('3'), u('4')], [u('3'), u('5'), u('6')]);
    const result = calculateMetrics(current, old, current, old);
    expect(result.lost.map(x => x.id)).toEqual(['1']);
    expect(result.new.map(x => x.id)).toEqual(['4']);
    expect(result.newFollowing.map(x => x.id)).toEqual(['3', '6']);
    expect(result.mutual.map(x => x.id)).toEqual(['3']);
    expect(result.notFollowingBack.map(x => x.id)).toEqual(['2', '4']);
    expect(result.notFollowedBack.map(x => x.id)).toEqual(['5', '6']);
  });
  it('un cambio de nombre no es un unfollow', () => {
    const old = snapshot([u('1', 'antes')], [], 10);
    const current = snapshot([u('1', 'despues')]);
    const result = calculateMetrics(current, old, current, old);
    expect(result.new).toEqual([]); expect(result.lost).toEqual([]);
    expect(result.followers[0].username).toBe('despues');
  });
  it('no compara deltas de cuentas diferentes', () => {
    const old = snapshot([u('1')], [], 10, '77');
    const current = snapshot([u('2')]);
    expect(calculateMetrics(current, old, current, old).lost).toEqual([]);
  });
  it('un escaneo rápido mantiene la fecha y lista de seguidos completa', () => {
    const full = snapshot([u('1')], [u('2')], 10);
    const quick = snapshot([u('1'), u('2')], null);
    const result = calculateMetrics(quick, full, full, null);
    expect(result.following.map(x => x.id)).toEqual(['2']);
    expect(result.mutual.map(x => x.id)).toEqual(['2']);
  });
  it('las acciones actuales no alteran las pérdidas históricas', () => {
    const old = snapshot([u('1'), u('2')], [u('1')], 10);
    const current = snapshot([u('1'), u('2')], [u('1')]);
    const patch: RelationOverride = { id: '42:1', accountId: '42', userId: '1', user: u('1'), updatedAt: 200, follower: false, following: false };
    const result = calculateMetrics(current, old, current, old, [patch]);
    expect(result.lost).toEqual([]); expect(result.following).toHaveLength(0); expect(result.followers.map(x => x.id)).toEqual(['2']);
    expect(current.followers).toHaveLength(2);
  });
  it('ignora modificaciones antiguas o de otra cuenta', () => {
    const current = snapshot([u('1')], [u('1')]);
    const patches: RelationOverride[] = [
      { id: '42:1', accountId: '42', userId: '1', user: u('1'), updatedAt: 50, following: false },
      { id: '77:1', accountId: '77', userId: '1', user: u('1'), updatedAt: 200, follower: false },
    ];
    expect(calculateMetrics(current, null, current, null, patches).mutual).toHaveLength(1);
  });
  it('no aplica un límite de 50 resultados', () => {
    const old = snapshot(Array.from({ length: 200 }, (_, i) => u(String(i))), [], 10);
    const current = snapshot([]);
    expect(calculateMetrics(current, old, current, old).lost).toHaveLength(200);
  });
  it('una discrepancia de seguidores no inventa pérdidas ni cuentas que no te siguen', () => {
    const old = snapshot([u('1'), u('2')], [u('2')], 10);
    const current = snapshot([u('1'), u('3')], [u('2')]);
    current.countDiscrepancies = { followers: { actual: 2, expected: 3 } };
    const result = calculateMetrics(current, old, current, old);
    expect(result.lost).toEqual([]);
    expect(result.notFollowedBack).toEqual([]);
    expect(result.new.map(user => user.id)).toEqual(['3']);
    expect(result.followers).toHaveLength(2);
    expect(metricWarning('lost', current, old, current, old)).toContain('no coincide');
    expect(metricWarning('notFollowedBack', current, old, current, old)).not.toBeNull();
    expect(metricWarning('new', current, old, current, old)).toBeNull();
  });
  it('una discrepancia de seguidos no afirma que no sigues a alguien', () => {
    const old = snapshot([u('1'), u('2')], [u('1'), u('2')], 10);
    const current = snapshot([u('1'), u('2')], [u('1')]);
    current.countDiscrepancies = { following: { actual: 1, expected: 2 } };
    const result = calculateMetrics(current, old, current, old);
    expect(result.notFollowingBack).toEqual([]);
    expect(result.mutual.map(user => user.id)).toEqual(['1']);
    expect(metricWarning('notFollowingBack', current, old, current, old)).toContain('seguidos');
  });
  it('una cuenta ausente en una referencia no validada no se declara nueva', () => {
    const old = snapshot([u('1')], [u('1')], 10);
    old.countDiscrepancies = { followers: { actual: 1, expected: 2 }, following: { actual: 1, expected: 2 } };
    const current = snapshot([u('1'), u('2')], [u('1'), u('2')]);
    const result = calculateMetrics(current, old, current, old);
    expect(result.new).toEqual([]);
    expect(result.newFollowing).toEqual([]);
    expect(metricWarning('new', current, old, current, old)).not.toBeNull();
    expect(metricWarning('newFollowing', current, old, current, old)).not.toBeNull();
  });
  it('una acción posterior no rejuvenece una modificación antigua de otro campo', () => {
    const current = snapshot([u('1')], [], 100);
    const patch: RelationOverride = { id: '42:1', accountId: '42', userId: '1', user: u('1'), updatedAt: 200,
      following: true, followingAt: 50, follower: false, followerAt: 200 };
    const result = calculateMetrics(current, null, current, null, [patch]);
    expect(result.following).toHaveLength(0); expect(result.followers).toHaveLength(0);
  });
});
