export type ListKind = 'followers' | 'following';
export type ActionKind = 'follow' | 'unfollow' | 'removeFollower';
export type ScanMode = 'full' | 'followers';
export type JobStatus = 'running' | 'paused' | 'completed' | 'cancelled';

export interface User {
  id: string;
  username: string;
  fullName: string;
  avatar: string;
  isPrivate: boolean;
  isVerified: boolean;
  following?: boolean;
  requested?: boolean;
}

export interface Account extends User {
  followerCount: number | null;
  followingCount: number | null;
  connectedAt: number;
}

export interface Snapshot {
  id: string;
  accountId: string;
  startedAt: number;
  completedAt: number;
  mode: ScanMode;
  followers: User[];
  following: User[] | null;
  requests: number;
}

export interface SnapshotMeta {
  id: string;
  accountId: string;
  startedAt: number;
  completedAt: number;
  mode: ScanMode;
  followers: number;
  following: number | null;
  requests: number;
}

export interface ListProgress {
  users: User[];
  cursor: string;
  cursors: string[];
  done: boolean;
  pages: number;
}

export interface ScanJob {
  id: 'scan';
  runId: string;
  accountId: string;
  tabId: number;
  mode: ScanMode;
  status: JobStatus;
  startedAt: number;
  updatedAt: number;
  completedAt?: number;
  dueAt: number;
  error: string;
  errorCode?: string;
  requests: number;
  retries: number;
  interval: number;
  pageSize: number;
  phase: ListKind | 'verify';
  expectedFollowers: number | null;
  expectedFollowing: number | null;
  followers: ListProgress;
  following: ListProgress;
}

export type ScanSummary = Omit<ScanJob, 'followers' | 'following'> & {
  followers: number;
  following: number;
};

export interface BatchItem {
  user: User;
  status: 'pending' | 'sending' | 'succeeded' | 'failed' | 'unknown';
  message?: string;
}

export interface BatchJob {
  id: 'batch';
  runId: string;
  accountId: string;
  tabId: number;
  action: ActionKind;
  status: JobStatus;
  items: BatchItem[];
  startedAt: number;
  updatedAt: number;
  dueAt: number;
  error: string;
  failure?: ErrorInfo;
}

export interface RelationOverride {
  id: string;
  accountId: string;
  userId: string;
  updatedAt: number;
  followingAt?: number;
  followerAt?: number;
  following?: boolean;
  requested?: boolean;
  follower?: boolean;
  user: User;
}

export interface Settings {
  pageSize: number;
  intervalMs: number;
  actionIntervalMs: number;
  pageLength: number;
  showAvatars: boolean;
}

export const DEFAULT_SETTINGS: Settings = {
  pageSize: 100,
  intervalMs: 250,
  actionIntervalMs: 1500,
  pageLength: 25,
  showAvatars: true,
};

export interface AppState {
  accounts: Account[];
  activeId: string | null;
  history: SnapshotMeta[];
  latest: Snapshot | null;
  previous: Snapshot | null;
  full: Snapshot | null;
  previousFull: Snapshot | null;
  scan: ScanSummary | null;
  batch: BatchJob | null;
  overrides: RelationOverride[];
  settings: Settings;
  connectionIssue?: ConnectionIssue | null;
}

export type BridgeOperation =
  | { op: 'session'; accountId?: string; refresh?: boolean }
  | { op: 'list'; accountId: string; kind: ListKind; cursor: string; count: number }
  | { op: 'action'; accountId: string; action: ActionKind; targetId: string };

export interface ListPage { users: User[]; nextCursor: string; hasMore: boolean }
export interface ActionResult { following?: boolean; requested?: boolean; follower?: boolean }
export interface ErrorInfo { code: string; message: string; status?: number; retryAfterMs?: number; endpoint?: string }
export interface ConnectionIssue extends ErrorInfo { occurredAt: number; retryAt?: number }
export type Reply<T = unknown> = { ok: true; data: T } | { ok: false; error: ErrorInfo };

export type Command =
  | { type: 'STATE' }
  | { type: 'CONNECT' }
  | { type: 'SELECT_ACCOUNT'; accountId: string }
  | { type: 'START_SCAN'; mode: ScanMode; accountId?: string }
  | { type: 'SCAN_CONTROL'; action: 'pause' | 'resume' | 'cancel' }
  | { type: 'START_BATCH'; action: ActionKind; users: User[]; accountId?: string }
  | { type: 'BATCH_CONTROL'; action: 'pause' | 'resume' | 'cancel' }
  | { type: 'SETTINGS'; settings: Settings }
  | { type: 'DELETE_SNAPSHOT'; id: string }
  | { type: 'CLEAR_ACCOUNT'; accountId: string };
