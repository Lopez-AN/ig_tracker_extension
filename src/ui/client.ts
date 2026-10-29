import type { Command, Reply } from '../core/types';
import { fromInfo, TrackerError } from '../core/errors';

export const isExtension = typeof chrome !== 'undefined' && !!chrome.runtime?.id;

export async function send<T = void>(command: Command): Promise<T> {
  if (!isExtension) throw new TrackerError('PREVIEW', 'Esta es una vista previa. Instala la extensión para conectar con Instagram.');
  let reply: Reply<T>;
  try { reply = await chrome.runtime.sendMessage(command); }
  catch { throw new TrackerError('WORKER', 'Se ha perdido la conexión con la extensión. Recarga el panel; el avance guardado se conserva.'); }
  if (!reply) throw new TrackerError('WORKER', 'La extensión no ha respondido. Recarga esta página.');
  if (!reply.ok) throw fromInfo(reply.error);
  return reply.data;
}
