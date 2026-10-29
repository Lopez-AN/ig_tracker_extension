import { TrackerError } from './errors';
import { instagramActionResult } from './instagram-action';
import type { ActionResult } from './types';

// Observed web contracts, not official APIs. Metadata: InsTF 6.1.26's public
// package and cobanov/instagram (October 2026). Document IDs can rotate.
type FriendshipAction = 'follow' | 'unfollow';
const mutations = {
  follow: { documentId: '26508036048874888', friendlyName: 'usePolarisFollowMutation', fields: ['xdt_create_friendship'] },
  unfollow: { documentId: '27789106940691111', friendlyName: 'usePolarisUnfollowMutation', fields: ['xdt_destroy_friendship', 'xdt_instagram_api__v1__friendships__unfollow__update'] },
};

export function instagramFriendshipRequest(action: FriendshipAction, accountId: string, targetId: string, tokens: { dtsg: string; lsd: string; revision?: string }) {
  if (!/^\d{1,30}$/.test(accountId) || !/^\d{1,30}$/.test(targetId) || accountId === targetId) {
    throw new TrackerError('INPUT', 'La cuenta o el destino de la acción no es válido.');
  }
  if (!tokens.dtsg || !tokens.lsd) {
    throw new TrackerError('TAB', `Recarga la pestaña de Instagram para cargar los datos de su sesión web y vuelve a confirmar la acción. No se ha enviado ${action === 'follow' ? 'la solicitud de seguimiento' : 'el unfollow'}.`);
  }
  const mutation = mutations[action];
  const body = new URLSearchParams({
    av: accountId, __d: 'www', __user: '0', __a: '1', __comet_req: '7',
    fb_dtsg: tokens.dtsg, lsd: tokens.lsd,
    jazoest: `2${[...tokens.dtsg].reduce((sum, char) => sum + char.charCodeAt(0), 0)}`,
    fb_api_caller_class: 'RelayModern', fb_api_req_friendly_name: mutation.friendlyName,
    server_timestamps: 'true', doc_id: mutation.documentId,
    variables: JSON.stringify({ target_user_id: targetId, container_module: 'profile', nav_chain: 'PolarisProfilePostsTabRoot:profilePage:1:via_cold_start' }),
  });
  if (tokens.revision && /^\d+$/.test(tokens.revision)) {
    body.set('__rev', tokens.revision);
    body.set('__spin_r', tokens.revision);
  }
  return { path: '/api/graphql', body, headers: {
    'X-FB-Friendly-Name': mutation.friendlyName, 'X-FB-LSD': tokens.lsd, 'X-ASBD-ID': '359341',
  } };
}

export function instagramFriendshipResult(action: FriendshipAction, response: Record<string, unknown>): ActionResult {
  if (Array.isArray(response.errors) && response.errors.length) {
    // Do not expose GraphQL messages: they can contain variables or session data.
    throw new TrackerError('UNKNOWN_ACTION', `Instagram ha devuelto errores al procesar ${action === 'follow' ? 'el seguimiento' : 'el unfollow'}. Revisa la relación en Instagram antes de repetir la acción.`);
  }
  const data = response.data;
  if (data && typeof data === 'object') {
    for (const field of mutations[action].fields) {
      const payload = (data as Record<string, unknown>)[field];
      if (payload && typeof payload === 'object' && !Array.isArray(payload)) {
        return instagramActionResult(action, payload as Record<string, unknown>);
      }
    }
  }
  throw new TrackerError('UNKNOWN_ACTION', `Instagram no ha confirmado la relación después ${action === 'follow' ? 'del seguimiento' : 'del unfollow'}. Compruébala antes de repetir la acción.`);
}
