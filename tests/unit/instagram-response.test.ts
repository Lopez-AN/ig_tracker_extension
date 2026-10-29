import { describe, expect, it } from 'vitest';
import { TrackerError } from '../../src/core/errors';
import { instagramResponse } from '../../src/core/instagram-response';

describe('decodificación segura de respuestas de Instagram', () => {
  it('lee un objeto JSON sin exigir una cabecera de contenido concreta', () => {
    expect(instagramResponse('{"status":"ok"}', true, 200)).toEqual({ status: 'ok' });
  });
  it.each(['for (;;);', 'for(;;);', '\uFEFF  for ( ; ; ) ; \n'])('admite el prefijo anti-hijacking %j sin evaluarlo', prefix => {
    expect(instagramResponse(`${prefix}{"data":{}}`, true, 200)).toEqual({ data: {} });
  });
  it.each(['', 'null', '[]', '42', '{"data":', 'alert("must-not-run");{}'])('rechaza una respuesta no reconocida: %j', text => {
    expect(() => instagramResponse(text, true, 200)).toThrow(TrackerError);
  });
  it('reproduce HTTP 200 con HTML como resultado incierto, sin filtrar el cuerpo', () => {
    try {
      instagramResponse('<!doctype html><html><body>private-marker-session-data</body></html>', true, 200);
      expect.unreachable();
    } catch (error) {
      expect(error).toMatchObject({ code: 'UNKNOWN_ACTION', status: 200 });
      expect((error as Error).message).toContain('página HTML');
      expect((error as Error).message).not.toContain('private-marker');
    }
  });
  it('un HTML de lectura no se confunde con una mutación enviada', () => {
    try { instagramResponse('<html></html>', false, 200); expect.unreachable(); }
    catch (error) { expect(error).toMatchObject({ code: 'FORMAT', status: 200 }); }
  });
});
