import { TrackerError } from './errors';
import type { Account, User } from './types';

type Raw = Record<string, unknown>;
const record = (value: unknown): value is Raw => !!value && typeof value === 'object' && !Array.isArray(value);
const validId = /^\d{1,30}$/;

export function normalizeInstagramUser(raw: Raw): User {
  const key = raw.pk_id ?? raw.pk ?? raw.id;
  if (typeof key === 'number' && !Number.isSafeInteger(key)) throw new TrackerError('FORMAT', 'Instagram ha devuelto un identificador no válido.');
  const id = String(key ?? '');
  if (!validId.test(id) || typeof raw.username !== 'string' || !/^[\w.]{1,40}$/.test(raw.username)) {
    throw new TrackerError('FORMAT', 'Instagram ha cambiado el formato de los perfiles. No se guardará una lista incompleta.');
  }
  return {
    id, username: raw.username, fullName: typeof raw.full_name === 'string' ? raw.full_name : '',
    avatar: typeof raw.profile_pic_url === 'string' && raw.profile_pic_url.startsWith('https://') ? raw.profile_pic_url : '',
    isPrivate: raw.is_private === true, isVerified: raw.is_verified === true,
    ...(typeof raw.followed_by_viewer === 'boolean' ? { following: raw.followed_by_viewer } : {}),
  };
}

export function instagramAccount(raw: Raw, expectedId: string, now = Date.now()): Account {
  const user = normalizeInstagramUser(raw);
  if (user.id !== expectedId) throw new TrackerError('ACCOUNT_CHANGED', 'El perfil devuelto no coincide con tu sesión. Vuelve a conectar Instagram.');
  const followers = raw.follower_count ?? (record(raw.edge_followed_by) ? raw.edge_followed_by.count : undefined);
  const following = raw.following_count ?? (record(raw.edge_follow) ? raw.edge_follow.count : undefined);
  const count = (value: unknown): number | null => typeof value === 'number' && Number.isSafeInteger(value) && value >= 0 ? value : null;
  return { ...user, followerCount: count(followers), followingCount: count(following), connectedAt: now };
}

// Read only the profile matching the authenticated session, never the first user
// in a page (which may instead be a suggestion or the profile being visited).
export function findEmbeddedInstagramProfile(payload: unknown, accountId: string): Raw | null {
  const queue: unknown[] = [payload];
  let best: Raw | null = null;
  let bestScore = -1;
  for (let i = 0; i < queue.length && i < 40_000; i++) {
    const value = queue[i];
    if (!value || typeof value !== 'object') continue;
    if (record(value) && String(value.pk_id ?? value.pk ?? value.id ?? '') === accountId && typeof value.username === 'string') {
      try {
        const account = instagramAccount(value, accountId);
        const score = Number(account.followerCount !== null) + Number(account.followingCount !== null);
        if (score > bestScore) { best = value; bestScore = score; }
        if (score === 2) return best;
      } catch { /* A matching ID without a valid username is not a usable identity. */ }
    }
    if (queue.length < 40_000) {
      const children = Array.isArray(value) ? value : Object.values(value);
      for (const child of children) {
        if (queue.length >= 40_000) break;
        if (child && typeof child === 'object') queue.push(child);
      }
    }
  }
  return best;
}
