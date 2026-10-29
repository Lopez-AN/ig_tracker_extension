import type { RelationOverride, Snapshot, User } from './types';

export type Metric = 'lost' | 'new' | 'newFollowing' | 'notFollowingBack' | 'notFollowedBack' | 'mutual' | 'followers' | 'following';
export type Metrics = Record<Metric, User[]>;

export function calculateMetrics(latest: Snapshot | null, previous: Snapshot | null, full: Snapshot | null, previousFull: Snapshot | null, overrides: RelationOverride[] = []): Metrics {
  const result: Metrics = { lost: [], new: [], newFollowing: [], notFollowingBack: [], notFollowedBack: [], mutual: [], followers: [], following: [] };
  if (!latest) return result;
  const followers = new Map(latest.followers.map(user => [user.id, user]));
  // Historical deltas are deliberately computed before applying current action overrides.
  if (previous && previous.accountId === latest.accountId) {
    const old = new Map(previous.followers.map(user => [user.id, user]));
    result.lost = previous.followers.filter(user => !followers.has(user.id));
    result.new = latest.followers.filter(user => !old.has(user.id));
  }
  if (full && previousFull && full.accountId === previousFull.accountId) {
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
    result.notFollowingBack = result.followers.filter(user => !following.has(user.id));
    result.notFollowedBack = result.following.filter(user => !followers.has(user.id));
    result.mutual = result.followers.filter(user => following.has(user.id));
  }
  return result;
}
