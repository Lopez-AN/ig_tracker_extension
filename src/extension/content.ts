import { errorInfo, TrackerError } from '../core/errors';
import { instagramActionResult } from '../core/instagram-action';
import { instagramResponse } from '../core/instagram-response';
import { instagramFriendshipRequest, instagramFriendshipResult } from '../core/instagram-friendship';
import { findEmbeddedInstagramProfile, instagramAccount, normalizeInstagramUser } from '../core/instagram-profile';
import type { Account, ActionResult, BridgeOperation, ListPage, Reply } from '../core/types';

// This bridge only accepts messages from our extension, never from the web page.
// Instagram credentials remain in Instagram's own origin and are never persisted.
const cookie = (name: string) => document.cookie.split('; ').find(part => part.startsWith(`${name}=`))?.slice(name.length + 1) ?? '';
const idPattern = /^\d{1,30}$/;
type Raw = Record<string, any>;

function sessionId(): string {
  const id = cookie('ds_user_id');
  return idPattern.test(id) ? id : '';
}

function guard(accountId?: string) {
  if (/^\/accounts\/login|^\/challenge|^\/accounts\/suspended/.test(location.pathname)) {
    throw new TrackerError('LOGIN', 'Completa el inicio de sesión o la verificación en la pestaña de Instagram.');
  }
  const id = sessionId();
  if (accountId && id && accountId !== id) {
    throw new TrackerError('ACCOUNT_CHANGED', 'Has cambiado de cuenta en Instagram. Conecta esa cuenta o vuelve a la cuenta del escaneo antes de continuar.');
  }
}

interface RequestOptions { readOnly?: boolean; headers?: Record<string, string> }

async function request(path: string, method = 'GET', body?: URLSearchParams, options: RequestOptions = {}): Promise<Raw> {
  try { return await performRequest(path, method, body, options); }
  catch (error) {
    if (error instanceof TrackerError) error.endpoint = path.split('?')[0].replace(/\/\d+(?=\/|$)/g, '/:id');
    throw error;
  }
}

async function performRequest(path: string, method: string, body: URLSearchParams | undefined, options: RequestOptions): Promise<Raw> {
  const mutates = method !== 'GET' && !options.readOnly;
  const headers: Record<string, string> = {
    'X-IG-App-ID': '936619743392459', 'X-Requested-With': 'XMLHttpRequest',
    'X-CSRFToken': decodeURIComponent(cookie('csrftoken')), 'X-ASBD-ID': '129477',
    ...options.headers,
  };
  if (body) headers['Content-Type'] = 'application/x-www-form-urlencoded';
  let response: Response;
  try {
    response = await fetch(new URL(path, 'https://www.instagram.com'), { method, headers, body, credentials: 'include', cache: 'no-store', signal: AbortSignal.timeout(20_000), redirect: 'follow' });
  } catch {
    throw new TrackerError(!mutates ? 'NETWORK' : 'UNKNOWN_ACTION', !mutates
      ? 'No se pudo conectar con Instagram. Comprueba la conexión e inténtalo de nuevo.'
      : 'No se pudo confirmar el resultado. Compruébalo en Instagram antes de repetir la acción.');
  }
  const after = response.headers.get('retry-after');
  const parsedAfter = after ? (/^\d+$/.test(after) ? Number(after) * 1000 : Math.max(0, Date.parse(after) - Date.now())) : NaN;
  const retryAfterMs = Number.isFinite(parsedAfter) ? parsedAfter : undefined;
  if (response.status === 429) throw new TrackerError('RATE_LIMIT', 'Instagram ha limitado esta consulta (HTTP 429). Espera antes de volver a intentarlo.', 429, retryAfterMs);
  if (response.status === 401 || /\/accounts\/login/.test(response.url)) throw new TrackerError('LOGIN', 'Tu sesión de Instagram ha caducado. Vuelve a iniciar sesión.', response.status);
  if (/\/(?:challenge|checkpoint)(?:\/|\?|$)/.test(response.url)) throw new TrackerError('CHALLENGE', 'Instagram necesita que completes una verificación en su pestaña.', response.status);
  let data: Raw;
  let text: string;
  try { text = await response.text(); } catch {
    throw new TrackerError(mutates ? 'UNKNOWN_ACTION' : 'NETWORK', 'No se pudo leer la respuesta de Instagram. Comprueba el resultado antes de volver a intentarlo.', response.status);
  }
  data = instagramResponse(text, mutates, response.status);
  if (data.challenge_required || data.checkpoint_url || data.message === 'challenge_required') throw new TrackerError('CHALLENGE', 'Instagram necesita que completes una verificación en su pestaña.', response.status);
  if (data.message === 'login_required') throw new TrackerError('LOGIN', 'Inicia sesión en Instagram para continuar.', response.status);
  if (data.spam || data.feedback_required || data.message === 'feedback_required') throw new TrackerError('BLOCKED', 'Instagram ha restringido temporalmente las solicitudes. Revisa su pestaña y vuelve a intentarlo más tarde.', response.status);
  if (!response.ok || data.status === 'fail') {
    const code = mutates && response.status >= 500 ? 'UNKNOWN_ACTION' : response.status >= 500 ? 'NETWORK' : 'REJECTED';
    throw new TrackerError(code, mutates ? 'Instagram no ha confirmado la acción. Revisa la cuenta antes de repetirla.' : `Instagram ha rechazado la consulta (${response.status}). Comprueba tu sesión.`, response.status);
  }
  return data;
}

function embeddedProfile(accountId: string): Raw | null {
  let remaining = 16_000_000;
  let found: Raw | null = null;
  for (const script of document.scripts) {
    const text = script.textContent?.trim();
    if (!text || text.length > remaining) continue;
    remaining -= text.length;
    const json = text.startsWith('{') || text.startsWith('[') ? text : text.match(/^window\._sharedData\s*=\s*([\s\S]+?);?$/)?.[1]?.replace(/;$/, '');
    if (!json) continue;
    try {
      const candidate = findEmbeddedInstagramProfile(JSON.parse(json), accountId);
      if (!candidate) continue;
      found = candidate;
      const account = instagramAccount(candidate, accountId);
      if (account.followerCount !== null && account.followingCount !== null) return candidate;
    } catch { /* Never evaluate page scripts or expose their raw contents. */ }
  }
  return found;
}

function webTokens(): { dtsg: string; lsd: string; revision: string } {
  let dtsg = '', lsd = '', revision = '';
  try {
    const eqmc = JSON.parse(document.getElementById('__eqmc')?.textContent ?? '{}');
    if (typeof eqmc.f === 'string') dtsg = eqmc.f;
    if (typeof eqmc.l === 'string') lsd = eqmc.l;
  } catch { /* Modern pages may publish these in separate bootstrap modules. */ }
  for (const script of document.scripts) {
    if (dtsg && lsd && revision) break;
    const text = script.textContent ?? '';
    dtsg ||= text.match(/"DTSGInitialData"\s*,\s*\[\s*\]\s*,\s*\{\s*"token"\s*:\s*"([^"\\]+)"/)?.[1] ?? '';
    lsd ||= text.match(/"LSD"\s*,\s*\[\s*\]\s*,\s*\{\s*"token"\s*:\s*"([^"\\]+)"/)?.[1] ?? '';
    revision ||= text.match(/"client_revision"\s*:\s*(\d+)/)?.[1] ?? '';
  }
  return { dtsg, lsd, revision };
}

async function webProfile(accountId: string): Promise<Raw> {
  const { dtsg, lsd } = webTokens();
  if (!dtsg) return (await request(`/api/v1/users/${accountId}/info/`)).user ?? {};
  // Read-only web query observed in InsTF 6.1.26. Kept in the adapter because
  // Instagram can change its document ID independently of the extension UI.
  const friendlyName = 'PolarisProfilePageContentQuery';
  const body = new URLSearchParams({
    fb_dtsg: dtsg, lsd, doc_id: '26672929172408668', fb_api_caller_class: 'RelayModern',
    fb_api_req_friendly_name: friendlyName, server_timestamps: 'true',
    variables: JSON.stringify({ id: accountId, enable_integrity_filters: true,
      __relay_internal__pv__PolarisCannesGuardianExperienceEnabledrelayprovider: true,
      __relay_internal__pv__PolarisCASB976ProfileEnabledrelayprovider: false,
      __relay_internal__pv__PolarisWebSchoolsEnabledrelayprovider: false,
      __relay_internal__pv__PolarisRepostsConsumptionEnabledrelayprovider: true }),
  });
  try {
    const data = await request('/api/graphql', 'POST', body, { readOnly: true,
      headers: { 'X-FB-Friendly-Name': friendlyName, 'X-FB-LSD': lsd, 'X-ASBD-ID': '359341' } });
    if (!data.data?.user) throw new TrackerError('FORMAT', 'Instagram no ha devuelto el perfil esperado.');
    instagramAccount(data.data.user, accountId);
    return data.data.user;
  } catch (error) {
    // A real limit, login requirement or challenge is never bypassed using a
    // different endpoint. Only unsupported query/format errors allow fallback.
    if (!(error instanceof TrackerError) || !(error.code === 'FORMAT' || (error.code === 'REJECTED' && [400, 404].includes(error.status ?? 0)))) throw error;
    return (await request(`/api/v1/users/${accountId}/info/`)).user ?? {};
  }
}

async function getAccount(expectedId?: string, refresh = false): Promise<Account> {
  guard(expectedId);
  const hint = sessionId();
  if (!hint) throw new TrackerError('LOGIN', 'No se ha encontrado una sesión activa. Abre Instagram, inicia sesión y recarga esa pestaña.');
  const embedded = refresh ? null : embeddedProfile(hint);
  const raw = embedded ?? await webProfile(hint);
  const account = instagramAccount(raw, hint);
  guard(account.id);
  return account;
}

async function operate(operation: BridgeOperation): Promise<Account | ListPage | ActionResult> {
  if (operation.op === 'session') return getAccount(operation.accountId, operation.refresh);
  if (!idPattern.test(operation.accountId)) throw new TrackerError('INPUT', 'La cuenta no es válida.');
  guard(operation.accountId);
  // Cookie is an origin-local identity hint. If unavailable, ask Instagram instead.
  if (!sessionId()) await getAccount(operation.accountId);
  if (operation.op === 'list') {
    if (!['followers', 'following'].includes(operation.kind) || ![50, 100, 200].includes(operation.count) || typeof operation.cursor !== 'string' || operation.cursor.length > 4000) {
      throw new TrackerError('INPUT', 'Los parámetros del escaneo no son válidos.');
    }
    const params = new URLSearchParams({ count: String(operation.count), search_surface: 'follow_list_page' });
    if (operation.cursor) params.set('max_id', operation.cursor);
    const data = await request(`/api/v1/friendships/${operation.accountId}/${operation.kind}/?${params}`);
    guard(operation.accountId);
    if (!Array.isArray(data.users) || data.special_empty_state) throw new TrackerError('INCOMPLETE', 'Instagram no está entregando esta lista completa. Inténtalo más tarde; no se registrarán pérdidas con estos datos.');
    const nextCursor = String(data.next_max_id ?? '');
    const hasMore = data.has_more ?? !!nextCursor;
    if (typeof hasMore !== 'boolean') throw new TrackerError('FORMAT', 'La paginación de Instagram tiene un formato no reconocido.');
    return { users: data.users.map(normalizeInstagramUser), nextCursor, hasMore };
  }
  if (!idPattern.test(operation.targetId) || !['follow', 'unfollow', 'removeFollower'].includes(operation.action) || operation.targetId === operation.accountId) {
    throw new TrackerError('INPUT', 'La acción o la cuenta de destino no es válida.');
  }
  if (operation.action === 'follow' || operation.action === 'unfollow') {
    if (!cookie('csrftoken')) throw new TrackerError('LOGIN', 'Recarga Instagram e inicia sesión antes de confirmar la acción. No se ha enviado la acción.');
    const query = instagramFriendshipRequest(operation.action, operation.accountId, operation.targetId, webTokens());
    const data = await request(query.path, 'POST', query.body, { headers: query.headers });
    guard(operation.accountId);
    try { return instagramFriendshipResult(operation.action, data); }
    catch (error) {
      if (error instanceof TrackerError) error.endpoint = query.path;
      throw error;
    }
  }
  const data = await request(`/api/v1/friendships/remove_follower/${operation.targetId}/`, 'POST', new URLSearchParams({ user_id: operation.targetId, container_module: 'profile' }));
  guard(operation.accountId);
  return instagramActionResult(operation.action, data);
}

const marker = '__igTrackerBridgeV2';
const scope = globalThis as typeof globalThis & { [marker]?: boolean };
if (!scope[marker]) {
  scope[marker] = true;
  chrome.runtime.onMessage.addListener((message, sender, respond: (reply: Reply) => void) => {
    if (sender.id !== chrome.runtime.id) return;
    if (message?.type === 'IG_TRACKER_PING') { respond({ ok: true, data: 'ready' }); return; }
    if (message?.type !== 'IG_TRACKER_BRIDGE' || !message.operation) return;
    operate(message.operation).then(data => respond({ ok: true, data })).catch(error => respond({ ok: false, error: errorInfo(error) }));
    return true;
  });
}
