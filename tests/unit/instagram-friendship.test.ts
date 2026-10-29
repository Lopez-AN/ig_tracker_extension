import { describe, expect, it } from 'vitest';
import { instagramFriendshipRequest, instagramFriendshipResult } from '../../src/core/instagram-friendship';

const tokens = { dtsg: 'fixture-dtsg', lsd: 'fixture-lsd', revision: '123456' };
const relation = { friendship_status: { following: false, outgoing_request: false } };

describe('contrato web de unfollow', () => {
  it('usa una única mutación Polaris con el ID destino y los tokens del origen', () => {
    const request = instagramFriendshipRequest('unfollow', '42', '1234', tokens);
    expect(request.path).toBe('/api/graphql');
    expect(request.body.get('doc_id')).toBe('27789106940691111');
    expect(request.body.get('fb_api_req_friendly_name')).toBe('usePolarisUnfollowMutation');
    expect(request.body.get('av')).toBe('42');
    expect(request.body.get('fb_dtsg')).toBe(tokens.dtsg);
    expect(request.body.get('lsd')).toBe(tokens.lsd);
    expect(request.body.get('jazoest')).toBe(`2${[...tokens.dtsg].reduce((sum, char) => sum + char.charCodeAt(0), 0)}`);
    expect(request.body.get('__rev')).toBe('123456');
    expect(request.headers['X-FB-Friendly-Name']).toBe('usePolarisUnfollowMutation');
    expect(JSON.parse(request.body.get('variables')!)).toEqual({ target_user_id: '1234', container_module: 'profile', nav_chain: 'PolarisProfilePostsTabRoot:profilePage:1:via_cold_start' });
  });
  it.each([{ dtsg: '', lsd: 'fixture' }, { dtsg: 'fixture', lsd: '' }])('no prepara una mutación sin todos los tokens', missing => {
    expect(() => instagramFriendshipRequest('unfollow', '42', '1234', missing)).toThrow('No se ha enviado el unfollow');
  });
  it.each([['42', '42'], ['x', '1234'], ['42', '../1234']])('rechaza IDs inválidos o la propia cuenta', (accountId, targetId) => {
    expect(() => instagramFriendshipRequest('unfollow', accountId, targetId, tokens)).toThrow('no es válido');
  });
  it('no inventa revisiones del cliente si la página no las publica', () => {
    expect(instagramFriendshipRequest('unfollow', '42', '1234', { ...tokens, revision: '' }).body.has('__rev')).toBe(false);
  });
  it.each(['xdt_destroy_friendship', 'xdt_instagram_api__v1__friendships__unfollow__update'])('reconoce la relación de %s', field => {
    expect(instagramFriendshipResult('unfollow', { data: { [field]: relation } })).toEqual({ following: false, requested: false });
  });
  it('no busca relaciones en campos ajenos a la mutación', () => {
    expect(() => instagramFriendshipResult('unfollow', { data: { other_user: relation } })).toThrow('no ha confirmado la relación');
  });
  it('no confirma una respuesta con errores aunque haya datos parciales', () => {
    expect(() => instagramFriendshipResult('unfollow', { data: { xdt_destroy_friendship: relation }, errors: [{ message: 'private-marker' }] })).toThrow('ha devuelto errores');
    try { instagramFriendshipResult('unfollow', { errors: [{ message: 'private-marker' }] }); } catch (error) {
      expect((error as Error).message).not.toContain('private-marker');
    }
  });
  it('mantiene el rechazo de un unfollow sin efecto', () => {
    expect(() => instagramFriendshipResult('unfollow', { data: { xdt_destroy_friendship: { friendship_status: { following: true } } } })).toThrow('todavía indica que sigues');
  });
  it('no convierte status ok sin relación en éxito', () => {
    expect(() => instagramFriendshipResult('unfollow', { status: 'ok' })).toThrow('no ha confirmado la relación');
  });
});

describe('contrato web de seguir y solicitar seguimiento', () => {
  it('usa el documento y nombre propios de follow, sin cambiar el transporte de unfollow', () => {
    const request = instagramFriendshipRequest('follow', '42', '1234', tokens);
    expect(request.path).toBe('/api/graphql');
    expect(request.body.get('doc_id')).toBe('26508036048874888');
    expect(request.body.get('fb_api_req_friendly_name')).toBe('usePolarisFollowMutation');
    expect(request.headers['X-FB-Friendly-Name']).toBe('usePolarisFollowMutation');
    expect(request.body.get('fb_dtsg')).toBe(tokens.dtsg);
    expect(JSON.parse(request.body.get('variables')!).target_user_id).toBe('1234');
  });
  it('confirma una cuenta pública como seguimiento efectivo', () => {
    expect(instagramFriendshipResult('follow', { data: { xdt_create_friendship: { friendship_status: { following: true, outgoing_request: false } } } })).toEqual({ following: true, requested: false });
  });
  it('una cuenta privada puede confirmar solo una solicitud pendiente', () => {
    expect(instagramFriendshipResult('follow', { data: { xdt_create_friendship: { friendship_status: { following: false, outgoing_request: true } } } })).toEqual({ following: false, requested: true });
  });
  it('rechaza un follow sin efecto', () => {
    expect(() => instagramFriendshipResult('follow', { data: { xdt_create_friendship: relation } })).toThrow('ni que haya una solicitud');
  });
  it('no acepta respuestas de unfollow como confirmación de follow', () => {
    expect(() => instagramFriendshipResult('follow', { data: { xdt_destroy_friendship: relation } })).toThrow('no ha confirmado la relación');
  });
  it('no prepara un follow sin datos de sesión web', () => {
    expect(() => instagramFriendshipRequest('follow', '42', '1234', { dtsg: '', lsd: '' })).toThrow('No se ha enviado la solicitud de seguimiento');
  });
  it('no acepta datos parciales cuando GraphQL devuelve errores', () => {
    expect(() => instagramFriendshipResult('follow', { data: { xdt_create_friendship: { friendship_status: { following: true } } }, errors: [{ message: 'private-marker' }] })).toThrow('ha devuelto errores');
  });
});
