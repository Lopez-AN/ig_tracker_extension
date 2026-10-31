import type { RelationOverride, Snapshot, User } from './types';
import { isListValidated } from './scan';

export type Metric = 'lost' | 'new' | 'newFollowing' | 'notFollowingBack' | 'notFollowedBack' | 'mutual' | 'followers' | 'following';
export type Metrics = Record<Metric, User[]>;

export function metricWarning(metric: Metric, latest: Snapshot | null, previous: Snapshot | null, full: Snapshot | null, previousFull: Snapshot | null): string | null {
  const source = metric === 'lost' || metric === 'notFollowedBack' ? latest
    : metric === 'new' ? previous : metric === 'newFollowing' ? previousFull : metric === 'notFollowingBack' ? full : null;
  const kind = metric === 'newFollowing' || metric === 'notFollowingBack' ? 'following' : 'followers';
  return source && !isListValidated(source, kind)
    ? `El recuento de ${kind === 'followers' ? 'seguidores' : 'seguidos'} no coincide. Esta lista no se puede confirmar hasta tener un escaneo con recuento coincidente.` : null;
}

export function calculateMetrics(latest: Snapshot | null, previous: Snapshot | null, full: Snapshot | null, previousFull: Snapshot | null, overrides: RelationOverride[] = []): Metrics {
  const result: Metrics = { lost: [], new: [], newFollowing: [], notFollowingBack: [], notFollowedBack: [], mutual: [], followers: [], following: [] };
  if (!latest) return result;
  const followers = new Map(latest.followers.map(user => [user.id, user]));
  // Historical deltas are deliberately computed before applying current action overrides.
  if (previous && previous.accountId === latest.accountId) {
    const old = new Map(previous.followers.map(user => [user.id, user]));
    if (!metricWarning('lost', latest, previous, full, previousFull)) result.lost = previous.followers.filter(user => !followers.has(user.id));
    if (!metricWarning('new', latest, previous, full, previousFull)) result.new = latest.followers.filter(user => !old.has(user.id));
  }
  if (full && previousFull && full.accountId === previousFull.accountId && !metricWarning('newFollowing', latest, previous, full, previousFull)) {
    const old = new Set(previousFull.following?.map(user => user.id));
    result.newFollowing = (full.following ?? []).filter(user => !old.has(user.id));
  }
  const following = new Map((full?.following ?? []).map(user => [user.id, user]));
  for (const patch of overrides.filter(item => item.accountId === latest.accountId)) {
    if ((patch.followerAt ?? patch.updatedAt) > latest.startedAt && patch.follower === false) followers.delete(patch.userId);
    if (full && (patch.followingAt ?? patch.updatedAt) > full.startedAt) {
      if (patch.following === true) following.set(patch.userId, patch.user);
      if (patch.following === false) following.delete(patch.userId);
    }
  }
  result.followers = [...followers.values()];
  result.following = [...following.values()];
  if (full) {
    if (!metricWarning('notFollowingBack', latest, previous, full, previousFull)) result.notFollowingBack = result.followers.filter(user => !following.has(user.id));
    if (!metricWarning('notFollowedBack', latest, previous, full, previousFull)) result.notFollowedBack = result.following.filter(user => !followers.has(user.id));
    result.mutual = result.followers.filter(user => following.has(user.id));
  }
  return result;
}
