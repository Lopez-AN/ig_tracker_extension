import { TrackerError } from './errors';
import type { ActionKind, ActionResult } from './types';

export function instagramActionResult(action: ActionKind, data: Record<string, unknown>): ActionResult {
  if (action === 'removeFollower') {
    if (data.status !== 'ok') throw new TrackerError('UNKNOWN_ACTION', 'Instagram no ha confirmado la eliminación del seguidor.');
    return { follower: false };
  }
  const relation = data.friendship_status;
  if (!relation || typeof relation !== 'object' || !('following' in relation) || typeof relation.following !== 'boolean') {
    throw new TrackerError('UNKNOWN_ACTION', 'Instagram no ha confirmado la relación. Compruébala antes de repetir la acción.');
  }
  const requested = 'outgoing_request' in relation && relation.outgoing_request === true;
  if (action === 'unfollow' && (relation.following || requested)) {
    throw new TrackerError('REJECTED', 'Instagram todavía indica que sigues a esta cuenta o tienes una solicitud pendiente. No se ha confirmado que hayas dejado de seguirla.');
  }
  if (action === 'follow' && !relation.following && !requested) {
    throw new TrackerError('REJECTED', 'Instagram no ha confirmado que sigas a esta cuenta ni que haya una solicitud enviada.');
  }
  return { following: relation.following, requested };
}
