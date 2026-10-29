import * as db from '../core/db';
import { errorInfo, fromInfo, rateLimitDelay, retryDelay, TrackerError } from '../core/errors';
import { appendPage, emptyProgress, makeSnapshot, summarize } from '../core/scan';
import { DEFAULT_SETTINGS, type Account, type ActionResult, type AppState, type BatchJob, type BridgeOperation, type Command, type ConnectionIssue, type ListPage, type RelationOverride, type Reply, type ScanJob, type Settings, type Snapshot, type SnapshotMeta } from '../core/types';

const WAKE = 'ig-tracker-work';
let working = false;
let timer: ReturnType<typeof setTimeout> | undefined;
let commandQueue: Promise<unknown> = Promise.resolve();

async function notify() {
  await chrome.storage.local.set({ revision: Date.now() + Math.random() });
}

async function settings(): Promise<Settings> {
  return { ...DEFAULT_SETTINGS, ...(await db.get<{ value: Settings }>('settings', 'preferences'))?.value };
}

async function activeId(): Promise<string | null> {
  return (await db.get<{ value: string }>('settings', 'active'))?.value ?? null;
}

async function bridge<T>(tabId: number, operation: BridgeOperation): Promise<T> {
  // Establish the bridge before sending an operation. Never resend a mutation when
  // the response channel disappears: it might already have reached Instagram.
  try {
    const ping = await chrome.tabs.sendMessage(tabId, { type: 'IG_TRACKER_PING' });
    if (!ping?.ok) throw new Error();
  } catch {
    try {
      const tab = await chrome.tabs.get(tabId);
      if (!tab.url?.startsWith('https://www.instagram.com/')) throw new Error();
      await chrome.scripting.executeScript({ target: { tabId }, files: ['content.js'] });
    } catch {
      throw new TrackerError('TAB', 'No se puede acceder a la pestaña de Instagram. Ábrela, inicia sesión y reanuda el proceso.');
    }
  }
  let reply: Reply<T>;
  try { reply = await chrome.tabs.sendMessage(tabId, { type: 'IG_TRACKER_BRIDGE', operation }); }
  catch {
    throw new TrackerError(operation.op === 'action' ? 'UNKNOWN_ACTION' : 'TAB', operation.op === 'action'
      ? 'La pestaña se ha interrumpido antes de confirmar la acción. Comprueba el resultado en Instagram; no se repetirá automáticamente.'
      : 'La pestaña de Instagram no ha respondido. Recárgala y vuelve a intentarlo.');
  }
  if (!reply || typeof reply.ok !== 'boolean') throw new TrackerError('TAB', 'La pestaña de Instagram no ha respondido. Recárgala y vuelve a intentarlo.');
  if (!reply.ok) throw fromInfo(reply.error);
  return reply.data;
}

async function findAccount(expected?: string): Promise<{ tabId: number; account: Account }> {
  const previousIssue = (await db.get<{ value: ConnectionIssue | null }>('settings', 'connection-issue'))?.value;
  if (previousIssue?.code === 'RATE_LIMIT' && previousIssue.retryAt && previousIssue.retryAt > Date.now()) {
    throw new TrackerError('RATE_LIMIT', `Instagram ha pedido esperar. Podrás volver a intentarlo en ${Math.ceil((previousIssue.retryAt - Date.now()) / 1000)} s. No se ha enviado otra consulta.`, 429, previousIssue.retryAt - Date.now(), previousIssue.endpoint);
  }
  const tabs = await chrome.tabs.query({ url: 'https://www.instagram.com/*' });
  if (!tabs.length) {
    await chrome.tabs.create({ url: 'https://www.instagram.com/' });
    throw new TrackerError('TAB', 'Se ha abierto Instagram. Inicia sesión y pulsa «Conectar Instagram» de nuevo.');
  }
  let lastError: unknown;
  for (const tab of tabs.sort((a, b) => Number(b.active) - Number(a.active))) {
    if (tab.id === undefined) continue;
    try {
      const account = await bridge<Account>(tab.id, { op: 'session', accountId: expected });
      if (previousIssue) { await db.put('settings', { id: 'connection-issue', value: null }); await notify(); }
      return { tabId: tab.id, account };
    } catch (error) {
      lastError = error;
      // All tabs share this session. Retrying every open tab on a 429 multiplies
      // the blocked requests instead of discovering another account.
      if (['RATE_LIMIT', 'LOGIN', 'CHALLENGE', 'BLOCKED'].includes(errorInfo(error).code)) break;
    }
  }
  const info = errorInfo(lastError ?? new TrackerError('TAB', 'No hay ninguna pestaña de Instagram disponible.'));
  const issue: ConnectionIssue = { ...info, occurredAt: Date.now(),
    ...(info.code === 'RATE_LIMIT' ? { retryAt: Date.now() + rateLimitDelay(0, info.retryAfterMs),
      message: 'Instagram ha limitado la consulta de tu perfil (HTTP 429). Esta comprobación no ha iniciado ni reanudado el proceso.' } : {}) };
  await db.put('settings', { id: 'connection-issue', value: issue });
  await notify();
  throw fromInfo(issue);
}

async function state(): Promise<AppState> {
  const id = await activeId();
  const history = id ? (await db.all<SnapshotMeta>('history', id)).sort((a, b) => b.completedAt - a.completedAt) : [];
  const fullHistory = history.filter(item => item.mode === 'full');
  const load = async (meta?: SnapshotMeta) => meta ? await db.get<Snapshot>('snapshots', meta.id) ?? null : null;
  const [accounts, latest, previous, full, previousFull, scan, batch, overrides, preferences] = await Promise.all([
    db.all<Account>('accounts'), load(history[0]), load(history[1]), load(fullHistory[0]), load(fullHistory[1]),
    db.get<ScanJob>('jobs', 'scan'), db.get<BatchJob>('jobs', 'batch'),
    id ? db.all<RelationOverride>('relations', id) : Promise.resolve([]), settings(),
  ]);
  const connectionIssue = (await db.get<{ value: ConnectionIssue | null }>('settings', 'connection-issue'))?.value ?? null;
  return { accounts, activeId: id, history, latest, previous, full, previousFull, scan: summarize(scan), batch: batch ?? null, overrides, settings: preferences, connectionIssue };
}

async function schedule() {
  if (timer) clearTimeout(timer);
  const jobs = await db.all<ScanJob | BatchJob>('jobs');
  const running = jobs.filter(job => job.status === 'running');
  if (!running.length) { await chrome.alarms.clear(WAKE); return; }
  await chrome.alarms.create(WAKE, { periodInMinutes: 0.5 });
  const delay = Math.max(0, Math.min(...running.map(job => job.dueAt)) - Date.now());
  timer = setTimeout(() => { void pump(); }, Math.min(delay, 20_000));
}

async function scanStep(job: ScanJob) {
  try {
    if (job.phase === 'verify') {
      const account = await bridge<Account>(job.tabId, { op: 'session', accountId: job.accountId, refresh: true });
      const snapshot = makeSnapshot(job, { followers: account.followerCount, following: account.followingCount });
      await db.completeScan(snapshot, job.runId);
      await db.put('accounts', account);
      await notify();
      return;
    }
    const page = await bridge<ListPage>(job.tabId, { op: 'list', accountId: job.accountId, kind: job.phase, cursor: job[job.phase].cursor, count: job.pageSize });
    await db.update<ScanJob>('jobs', 'scan', current => {
      if (!current || current.runId !== job.runId || current.status === 'cancelled') return current;
      // Save an in-flight page even when the user pauses; never restart a completed cursor.
      const progress = appendPage(current[job.phase as 'followers' | 'following'], page);
      const interval = current.interval;
      const next = { ...current, [job.phase]: progress, updatedAt: Date.now(), requests: current.requests + 1, retries: 0,
        dueAt: Date.now() + interval, interval, error: '', errorCode: undefined };
      if (progress.done) next.phase = job.phase === 'followers' && job.mode === 'full' ? 'following' : 'verify';
      return next;
    });
    await notify();
  } catch (error) {
    const info = errorInfo(error);
    await db.update<ScanJob>('jobs', 'scan', current => {
      if (!current || current.runId !== job.runId || current.status === 'cancelled') return current;
      if ((info.code === 'RATE_LIMIT' || info.code === 'NETWORK') && current.retries < 4) {
        const wait = info.code === 'RATE_LIMIT' ? rateLimitDelay(current.retries, info.retryAfterMs) : retryDelay(current.retries, info.retryAfterMs);
        return { ...current, requests: current.requests + 1, retries: current.retries + 1, dueAt: Date.now() + wait,
          interval: Math.min(10_000, Math.max(1000, current.interval * 2)), error: `${info.message} El avance de este escaneo se conserva.`, errorCode: info.code, updatedAt: Date.now() };
      }
      // A rejected larger page size is retried once with Instagram's conservative default.
      if (info.code === 'REJECTED' && info.status === 400 && current.pageSize > 50) {
        return { ...current, pageSize: 50, dueAt: Date.now() + 1000, error: 'Instagram requiere páginas de 50 cuentas. Continuando con ese tamaño.', updatedAt: Date.now() };
      }
      return { ...current, status: 'paused', error: info.message, errorCode: info.code,
        ...(info.code === 'RATE_LIMIT' ? { dueAt: Date.now() + rateLimitDelay(current.retries, info.retryAfterMs) } : {}), updatedAt: Date.now() };
    });
    await notify();
  }
}

async function batchStep(job: BatchJob) {
  const index = job.items.findIndex(item => item.status === 'pending');
  if (index === -1) {
    await db.update<BatchJob>('jobs', 'batch', current => current?.runId === job.runId ? { ...current, status: 'completed', updatedAt: Date.now() } : current);
    await notify(); return;
  }
  const claimed = await db.update<BatchJob>('jobs', 'batch', current => {
    if (!current || current.runId !== job.runId || current.status !== 'running') return current;
    return { ...current, items: current.items.map((item, i) => i === index ? { ...item, status: 'sending' } : item), updatedAt: Date.now() };
  });
  if (!claimed || claimed.status !== 'running' || claimed.items[index].status !== 'sending') return;
  const user = claimed.items[index].user;
  try {
    const result = await bridge<ActionResult>(job.tabId, { op: 'action', accountId: job.accountId, action: job.action, targetId: user.id });
    const confirmedAt = Date.now();
    await db.update<RelationOverride>('relations', `${job.accountId}:${user.id}`, old => ({ ...old, ...result,
      ...(typeof result.following === 'boolean' ? { followingAt: confirmedAt } : {}),
      ...(typeof result.follower === 'boolean' ? { followerAt: confirmedAt } : {}),
      id: `${job.accountId}:${user.id}`, accountId: job.accountId, userId: user.id, user, updatedAt: confirmedAt }));
    const preferences = await settings();
    await db.update<BatchJob>('jobs', 'batch', current => {
      if (current?.runId !== job.runId) return current;
      const items = current.items.map((item, i) => i === index ? { ...item, status: 'succeeded' as const, message: result.requested ? 'Solicitud enviada' : 'Confirmado por Instagram' } : item);
      return { ...current, items,
        status: current.status === 'running' && !items.some(item => item.status === 'pending') ? 'completed' : current.status,
        dueAt: Date.now() + preferences.actionIntervalMs, updatedAt: Date.now(), error: '', failure: undefined };
    });
  } catch (error) {
    const info = errorInfo(error);
    await db.update<BatchJob>('jobs', 'batch', current => {
      if (current?.runId !== job.runId) return current;
      const items = current.items.map((item, i) => i === index ? { ...item, status: info.code === 'UNKNOWN_ACTION' || info.code === 'ACCOUNT_CHANGED' ? 'unknown' as const : 'failed' as const, message: info.message } : item);
      return { ...current, items,
        status: current.status === 'cancelled' ? 'cancelled' : items.some(item => item.status === 'pending') ? 'paused' : 'completed',
        error: info.message, failure: info, updatedAt: Date.now() };
    });
  }
  await notify();
}

async function recoverUncertainBatch() {
  await db.update<BatchJob>('jobs', 'batch', current => {
    if (!current) return current;
    const pending = current.items.some(item => item.status === 'pending');
    if (!current.items.some(item => item.status === 'sending')) {
      return current.status === 'paused' && !pending ? { ...current, status: 'completed', updatedAt: Date.now() } : current;
    }
    return { ...current, status: current.status === 'cancelled' ? 'cancelled' : pending ? 'paused' : 'completed', error: 'Se interrumpió una acción. Comprueba su resultado en Instagram; no se repetirá automáticamente.',
      items: current.items.map(item => item.status === 'sending' ? { ...item, status: 'unknown', message: 'Resultado no confirmado tras una interrupción' } : item), updatedAt: Date.now() };
  });
}

async function pump() {
  if (working) return;
  working = true;
  try {
    const scan = await db.get<ScanJob>('jobs', 'scan');
    const batch = await db.get<BatchJob>('jobs', 'batch');
    if (scan?.status === 'running' && scan.dueAt <= Date.now()) await scanStep(scan);
    else if (batch?.status === 'running' && batch.dueAt <= Date.now()) await batchStep(batch);
  } catch (error) {
    // Persist actionable failures rather than silently losing a running job.
    const info = errorInfo(error);
    for (const id of ['scan', 'batch']) await db.update<ScanJob | BatchJob>('jobs', id, job => job?.status === 'running' ? { ...job, status: 'paused', error: info.message, updatedAt: Date.now() } : job);
    await notify();
  } finally { working = false; await schedule(); }
}

async function ensureIdle() {
  const jobs = await db.all<ScanJob | BatchJob>('jobs');
  if (working || jobs.some(job => job.status === 'running')) throw new TrackerError('BUSY', 'Pausa el proceso actual antes de iniciar otro.');
}

async function handle(command: Command): Promise<unknown> {
  switch (command.type) {
    case 'STATE': return state();
    case 'CONNECT': {
      const { account } = await findAccount();
      await db.put('accounts', account);
      await db.put('settings', { id: 'active', value: account.id });
      await notify(); return account;
    }
    case 'SELECT_ACCOUNT': {
      if (!await db.get('accounts', command.accountId)) throw new TrackerError('INPUT', 'La cuenta no está conectada.');
      await db.put('settings', { id: 'active', value: command.accountId }); await notify(); return;
    }
    case 'START_SCAN': {
      await ensureIdle();
      if (!['full', 'followers'].includes(command.mode)) throw new TrackerError('INPUT', 'Tipo de escaneo no válido.');
      const id = await activeId();
      if (!id) throw new TrackerError('LOGIN', 'Conecta tu cuenta de Instagram primero.');
      if (command.accountId && command.accountId !== id) throw new TrackerError('ACCOUNT_CHANGED', 'La cuenta seleccionada ha cambiado. Revisa la cuenta antes de iniciar el escaneo.');
      const old = await db.get<ScanJob>('jobs', 'scan');
      if (old?.status === 'paused') throw new TrackerError('PAUSED', 'Reanuda o cancela el escaneo pausado antes de empezar otro.');
      const { account, tabId } = await findAccount(id);
      const preferences = await settings();
      const job: ScanJob = { id: 'scan', runId: crypto.randomUUID(), accountId: id, tabId, mode: command.mode, status: 'running',
        startedAt: Date.now(), updatedAt: Date.now(), dueAt: Date.now(), error: '', requests: 0, retries: 0,
        interval: preferences.intervalMs, pageSize: preferences.pageSize, phase: 'followers', expectedFollowers: account.followerCount,
        expectedFollowing: account.followingCount, followers: emptyProgress(), following: emptyProgress() };
      await db.put('accounts', account); await db.put('jobs', job); await notify(); await schedule(); return;
    }
    case 'SCAN_CONTROL': {
      const job = await db.get<ScanJob>('jobs', 'scan');
      if (!job || !['paused', 'running'].includes(job.status)) return;
      let tabId = job.tabId;
      if (command.action === 'resume') {
        if (job.errorCode === 'RATE_LIMIT' && job.dueAt > Date.now()) throw new TrackerError('RATE_LIMIT', `Instagram ha pedido esperar. Reanuda en ${Math.ceil((job.dueAt - Date.now()) / 1000)} s.`, 429, job.dueAt - Date.now());
        await ensureIdle(); tabId = (await findAccount(job.accountId)).tabId;
      }
      if (!['pause', 'resume', 'cancel'].includes(command.action)) throw new TrackerError('INPUT', 'Control no válido.');
      await db.update<ScanJob>('jobs', 'scan', current => current?.runId === job.runId ? { ...current, tabId,
        status: command.action === 'resume' ? 'running' : command.action === 'pause' ? 'paused' : 'cancelled',
        error: command.action === 'resume' ? '' : current.error, dueAt: Date.now(), retries: 0, updatedAt: Date.now() } : current);
      await notify(); await schedule(); return;
    }
    case 'START_BATCH': {
      await ensureIdle();
      if (!['follow', 'unfollow', 'removeFollower'].includes(command.action) || !Array.isArray(command.users) || !command.users.length) throw new TrackerError('INPUT', 'Selecciona al menos una cuenta y una acción válida.');
      const old = await db.get<BatchJob>('jobs', 'batch');
      if (old?.status === 'paused') throw new TrackerError('PAUSED', 'Reanuda o cancela el lote pausado primero.');
      const id = await activeId();
      if (!id) throw new TrackerError('LOGIN', 'Conecta una cuenta antes de realizar acciones.');
      if (command.accountId && command.accountId !== id) throw new TrackerError('ACCOUNT_CHANGED', 'La cuenta seleccionada ha cambiado. Revisa y confirma de nuevo las acciones para esa cuenta.');
      const { tabId } = await findAccount(id);
      const users = [...new Map(command.users.map(user => [user.id, user])).values()];
      if (users.some(user => !/^\d{1,30}$/.test(user.id) || user.id === id || !/^[\w.]{1,40}$/.test(user.username))) throw new TrackerError('INPUT', 'La selección contiene una cuenta no válida.');
      const job: BatchJob = { id: 'batch', runId: crypto.randomUUID(), accountId: id, tabId, action: command.action, status: 'running',
        items: users.map(user => ({ user, status: 'pending' })), startedAt: Date.now(), updatedAt: Date.now(), dueAt: Date.now(), error: '' };
      await db.put('jobs', job); await notify(); await schedule(); return;
    }
    case 'BATCH_CONTROL': {
      const job = await db.get<BatchJob>('jobs', 'batch');
      if (!job || !['running', 'paused'].includes(job.status)) return;
      if (!['pause', 'resume', 'cancel'].includes(command.action)) throw new TrackerError('INPUT', 'Control no válido.');
      let tabId = job.tabId;
      if (command.action === 'resume') {
        await ensureIdle();
        // Older versions left single failed/uncertain actions paused indefinitely.
        // Finishing such a job must not contact Instagram or resend that action.
        if (!job.items.some(item => item.status === 'pending' || item.status === 'sending')) {
          await db.update<BatchJob>('jobs', 'batch', current => current?.runId === job.runId ? { ...current, status: 'completed', updatedAt: Date.now() } : current);
          await notify(); await schedule(); return;
        }
        tabId = (await findAccount(job.accountId)).tabId;
      }
      await db.update<BatchJob>('jobs', 'batch', current => current?.runId === job.runId ? { ...current, tabId,
        status: command.action === 'resume' ? 'running' : command.action === 'pause' ? 'paused' : 'cancelled', dueAt: Date.now(), error: command.action === 'pause' ? current.error : '', failure: command.action === 'pause' ? current.failure : undefined, updatedAt: Date.now() } : current);
      await notify(); await schedule(); return;
    }
    case 'SETTINGS': {
      const s = command.settings;
      if (![50, 100, 200].includes(s.pageSize) || !Number.isFinite(s.intervalMs) || s.intervalMs < 0 || s.intervalMs > 60000 || !Number.isFinite(s.actionIntervalMs) || s.actionIntervalMs < 1000 || s.actionIntervalMs > 60000 || ![25, 50, 100].includes(s.pageLength) || typeof s.showAvatars !== 'boolean') throw new TrackerError('INPUT', 'La configuración contiene valores no válidos.');
      await db.put('settings', { id: 'preferences', value: s }); await notify(); return;
    }
    case 'DELETE_SNAPSHOT': await db.deleteSnapshot(command.id); await notify(); return;
    case 'CLEAR_ACCOUNT': {
      await ensureIdle();
      await db.clearAccount(command.accountId);
      if (await activeId() === command.accountId) await db.put('settings', { id: 'active', value: null });
      await notify(); return;
    }
    default: throw new TrackerError('INPUT', 'Comando no reconocido.');
  }
}

async function openDashboard() {
  const url = chrome.runtime.getURL('index.html');
  const tabs = await chrome.tabs.query({ url });
  if (tabs[0]?.id !== undefined) await chrome.tabs.update(tabs[0].id, { active: true });
  else await chrome.tabs.create({ url });
}

chrome.action.onClicked.addListener(() => { void openDashboard(); });
chrome.alarms.onAlarm.addListener(alarm => { if (alarm.name === WAKE) void ready.then(pump); });
chrome.runtime.onStartup.addListener(() => { void ready.then(schedule); });
chrome.runtime.onInstalled.addListener(() => { void ready.then(schedule); });

const ready = recoverUncertainBatch();
chrome.runtime.onMessage.addListener((message: Command, sender, respond: (reply: Reply) => void) => {
  // Content scripts and web pages cannot instruct the worker to mutate relationships.
  if (sender.id !== chrome.runtime.id || !sender.url?.startsWith(chrome.runtime.getURL(''))) return;
  if (message?.type === 'STATE') {
    ready.then(() => handle(message)).then(data => respond({ ok: true, data })).catch(error => respond({ ok: false, error: errorInfo(error) }));
  } else {
    commandQueue = commandQueue.catch(() => {}).then(() => ready).then(() => handle(message));
    commandQueue.then(data => respond({ ok: true, data })).catch(error => respond({ ok: false, error: errorInfo(error) }));
  }
  return true;
});
void ready.then(schedule);
