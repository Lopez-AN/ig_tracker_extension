import { describe, expect, it } from 'vitest';
import { instagramActionResult } from '../../src/core/instagram-action';
import { TrackerError } from '../../src/core/errors';

const response = (following: boolean, outgoing_request = false) => ({ status: 'ok', friendship_status: { following, outgoing_request } });

describe('confirmación del resultado de acciones de Instagram', () => {
  it('confirma dejar de seguir solo cuando la relación ha terminado', () => {
    expect(instagramActionResult('unfollow', response(false))).toEqual({ following: false, requested: false });
  });
  it('no acepta como éxito un unfollow que sigue indicando following: true', () => {
    expect(() => instagramActionResult('unfollow', response(true))).toThrow('Instagram todavía indica que sigues');
    try { instagramActionResult('unfollow', response(true)); } catch (error) {
      expect(error).toBeInstanceOf(TrackerError);
      expect((error as TrackerError).code).toBe('REJECTED');
    }
  });
  it('no confirma un unfollow si queda una solicitud pendiente', () => {
    expect(() => instagramActionResult('unfollow', response(false, true))).toThrow('solicitud pendiente');
  });
  it('confirma seguir una cuenta pública', () => {
    expect(instagramActionResult('follow', response(true))).toEqual({ following: true, requested: false });
  });
  it('distingue la solicitud a una cuenta privada de un seguimiento confirmado', () => {
    expect(instagramActionResult('follow', response(false, true))).toEqual({ following: false, requested: true });
  });
  it('rechaza un follow sin seguimiento ni solicitud', () => {
    expect(() => instagramActionResult('follow', response(false))).toThrow('ni que haya una solicitud');
  });
  it.each([undefined, null, 'ok', {}, { following: 'false' }])('considera incierta una relación no reconocida: %j', friendship_status => {
    expect(() => instagramActionResult('unfollow', { status: 'ok', friendship_status })).toThrow('Compruébala antes de repetir');
  });
  it('no confunde eliminar un seguidor con dejar de seguirlo', () => {
    expect(instagramActionResult('removeFollower', { status: 'ok' })).toEqual({ follower: false });
    expect(() => instagramActionResult('removeFollower', { status: 'fail' })).toThrow('no ha confirmado la eliminación');
  });
});
