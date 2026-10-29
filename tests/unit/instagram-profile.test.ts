import { describe, expect, it } from 'vitest';
import { findEmbeddedInstagramProfile, instagramAccount, normalizeInstagramUser } from '../../src/core/instagram-profile';
import { errorInfo, fromInfo, rateLimitDelay } from '../../src/core/errors';

const own = { pk: '42', username: 'mi_cuenta', full_name: 'Mi cuenta', follower_count: 25, following_count: 12 };
describe('identidad de la sesión web', () => {
  it('elige la cuenta activa, no el perfil ajeno ni sugerencias', () => {
    const payload = { viewedProfile: { ...own, pk: '77', username: 'otra_persona' }, suggestions: [{ ...own, pk: '88' }], bootstrap: [[{ viewer: own }]] };
    expect(findEmbeddedInstagramProfile(payload, '42')).toEqual(own);
    expect(findEmbeddedInstagramProfile(payload, '99')).toBeNull();
  });
  it('prefiere el perfil con recuentos a una referencia parcial', () => {
    const partial = { pk: '42', username: 'mi_cuenta' };
    expect(findEmbeddedInstagramProfile([partial, { deeper: own }], '42')).toEqual(own);
  });
  it('admite los formatos REST y web sin convertir ausencias en cero', () => {
    expect(instagramAccount(own, '42').followerCount).toBe(25);
    const web = { id: '42', username: 'mi_cuenta', edge_followed_by: { count: 0 }, edge_follow: { count: 12 } };
    expect(instagramAccount(web, '42').followerCount).toBe(0);
    expect(instagramAccount({ id: '42', username: 'mi_cuenta' }, '42').followerCount).toBeNull();
  });
  it('rechaza perfiles ajenos aunque tengan un nombre parecido', () => {
    expect(() => instagramAccount({ ...own, pk: '77' }, '42')).toThrow('no coincide');
  });
  it('no persiste secretos incluidos en los datos de arranque', () => {
    const account = instagramAccount({ ...own, access_token: 'not-a-real-token', csrftoken: 'secret-fixture', private_data: { password: 'fixture' } }, '42');
    expect(JSON.stringify(account)).not.toContain('token'); expect(JSON.stringify(account)).not.toContain('fixture');
  });
  it('rechaza IDs numéricos que hayan perdido precisión y admite pk_id como cadena', () => {
    expect(() => normalizeInstagramUser({ ...own, pk: 999999999999999999 })).toThrow('identificador');
    expect(normalizeInstagramUser({ ...own, pk_id: '999999999999999999' }).id).toBe('999999999999999999');
  });
});

describe('límites previos al inicio del trabajo', () => {
  it('espera al menos un minuto si Instagram no dice cuánto esperar', () => {
    expect(rateLimitDelay(0)).toBe(60_000); expect(rateLimitDelay(1)).toBe(120_000);
    expect(rateLimitDelay(20)).toBe(900_000); expect(rateLimitDelay(0, NaN)).toBe(60_000);
  });
  it('respeta la espera del servidor y evita reintentos inmediatos', () => {
    expect(rateLimitDelay(0, 300_000)).toBe(300_000); expect(rateLimitDelay(0, 1000)).toBe(2000);
  });
  it('mantiene el endpoint sin añadir tokens ni parámetros al serializar errores', () => {
    const error = fromInfo({ code: 'RATE_LIMIT', message: 'Esperar', status: 429, retryAfterMs: 2000, endpoint: '/api/graphql' });
    expect(errorInfo(error).endpoint).toBe('/api/graphql');
  });
});
