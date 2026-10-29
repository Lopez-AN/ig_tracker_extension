import { TrackerError } from './errors';

export function instagramResponse(text: string, mutates: boolean, status: number): Record<string, unknown> {
  // Meta sometimes prefixes JSON with a non-executable anti-hijacking guard.
  // Strip only that known prefix; never evaluate server responses or page code.
  const json = text.trim().replace(/^for\s*\(\s*;\s*;\s*\)\s*;\s*/, '');
  try {
    const data: unknown = JSON.parse(json);
    if (data && typeof data === 'object' && !Array.isArray(data)) return data as Record<string, unknown>;
  } catch { /* Only sanitized diagnostics may leave Instagram's origin. */ }
  const html = /^<(?:!doctype\s+html|html|head|body)\b/i.test(json);
  throw new TrackerError(mutates ? 'UNKNOWN_ACTION' : 'FORMAT', html
    ? `Instagram ha devuelto una página HTML en vez de ${mutates ? 'confirmar la acción' : 'los datos esperados'} (HTTP ${status}). Revisa la pestaña de Instagram${mutates ? ' antes de repetirla' : ''}.`
    : mutates ? 'Instagram no ha confirmado el resultado. Compruébalo antes de repetir la acción.' : 'Instagram ha devuelto una respuesta no reconocida. Revisa tu sesión.', status);
}
