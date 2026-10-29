import { test as base, chromium, expect, type BrowserContext, type Page } from '@playwright/test';
import path from 'node:path';
import type { AppState, Command, Reply } from '../../src/core/types';
import packageInfo from '../../package.json' with { type: 'json' };

const { version } = packageInfo;

interface Model {
  followers: number[];
  following: number[];
  followRequests: number[];
  accountId: string;
  pageSize: number;
  pageCalls: string[];
  actionCalls: string[];
  rateLimit: boolean;
  repeatCursor: boolean;
  partial: boolean;
  uncertainAction: boolean;
  actionGate?: Promise<void>;
  actionNoChange?: boolean;
  actionStatus?: number;
  actionMissingRelation?: boolean;
  actionHtml?: boolean;
  actionGraphqlErrors?: boolean;
  actionPrefix?: boolean;
  actionUpdateField?: boolean;
  rejectProfileQuery?: boolean;
  sessionEmbedded?: boolean;
  webBootstrap?: boolean;
  sessionRateLimit?: boolean;
  sessionRetryAfter?: string;
  sessionCalls: string[];
  missingCounts?: boolean;
  rejectLargePages?: boolean;
  requestedCounts: number[];
  gate?: Promise<void>;
}

const rawUser = (id: number) => ({ pk: String(id), username: `persona${id}`, full_name: `Persona ${id}`, profile_pic_url: '', is_private: id % 3 === 0, is_verified: false });
const test = base.extend<{ extensionContext: BrowserContext; panel: Page; instagram: Page; model: Model }>({
  model: async ({}, use) => {
    await use({ followers: Array.from({ length: 135 }, (_, i) => 1000 + i), following: Array.from({ length: 80 }, (_, i) => 1050 + i), followRequests: [], accountId: '42', pageSize: 60, pageCalls: [], actionCalls: [], rateLimit: false, repeatCursor: false, partial: false, uncertainAction: false, requestedCounts: [], sessionCalls: [], webBootstrap: true });
  },
  extensionContext: async ({ model }, use) => {
    const extension = path.resolve('dist');
    const context = await chromium.launchPersistentContext('', { channel: 'chromium', headless: true, viewport: { width: 1536, height: 1024 }, args: [`--disable-extensions-except=${extension}`, `--load-extension=${extension}`] });
    await context.route('https://www.instagram.com/**', async route => {
      const url = new URL(route.request().url());
      const respond = (data: unknown, status = 200, headers?: Record<string, string>) => route.fulfill({ contentType: 'application/json', status, body: JSON.stringify(data), headers });
      const sessionUser = { ...rawUser(Number(model.accountId)), username: 'cuenta_prueba', ...(model.missingCounts ? {} : { follower_count: model.followers.length, following_count: model.following.length }) };
      if (url.pathname === '/') {
        const profile = model.sessionEmbedded ? `<script type="application/json">${JSON.stringify({ data: { viewedProfile: { ...sessionUser, pk: '99', username: 'perfil_ajeno' }, currentUser: sessionUser } })}</script>` : '';
        const bootstrap = model.webBootstrap ? '<script type="application/json" id="__eqmc">{"f":"simulated-dtsg-fixture","l":"simulated-lsd-fixture","client_revision":123456}</script>' : '';
        return route.fulfill({ contentType: 'text/html', body: `<!doctype html><html lang="es"><title>Instagram simulado</title><body><h1>Sesión simulada para pruebas locales</h1>${profile}${bootstrap}</body></html>` });
      }
      const payload = new URLSearchParams(route.request().postData() ?? '');
      const webUnfollow = url.pathname === '/api/graphql' && payload.get('fb_api_req_friendly_name') === 'usePolarisUnfollowMutation';
      const webFollow = url.pathname === '/api/graphql' && payload.get('fb_api_req_friendly_name') === 'usePolarisFollowMutation';
      const webFriendship = webFollow || webUnfollow;
      if (webFriendship || /\/friendships\/(create|destroy|remove_follower)\//.test(url.pathname)) {
        model.actionCalls.push(url.pathname);
        expect(route.request().method()).toBe('POST');
        let id: number;
        if (webFriendship) {
          const variables = JSON.parse(payload.get('variables') ?? '{}');
          id = Number(variables.target_user_id);
          expect(variables.container_module).toBe('profile');
          expect(payload.get('doc_id')).toBe(webFollow ? '26508036048874888' : '27789106940691111');
          expect(payload.get('av')).toBe(model.accountId);
          expect(payload.get('fb_dtsg')).toBe('simulated-dtsg-fixture');
          expect(payload.get('lsd')).toBe('simulated-lsd-fixture');
          expect(payload.get('__rev')).toBe('123456');
          expect(payload.get('jazoest')).toMatch(/^2\d+$/);
          expect(route.request().headers()['x-fb-friendly-name']).toBe(webFollow ? 'usePolarisFollowMutation' : 'usePolarisUnfollowMutation');
          expect(route.request().headers()['x-fb-lsd']).toBe('simulated-lsd-fixture');
          expect(route.request().headers()['x-csrftoken']).toBe('simulated-not-a-secret');
        } else {
          id = Number(url.pathname.split('/').filter(Boolean).at(-1));
          expect(payload.get('user_id')).toBe(String(id));
        }
        // Both old friendship routes returned HTTP 200 HTML in the user's
        // session. A JSON mock must not hide these integration failures.
        if (/\/(?:create|destroy)\//.test(url.pathname) || model.actionHtml) return route.fulfill({ contentType: 'text/html', status: 200, body: '<!doctype html><html><body>private-response-marker</body></html>' });
        if (model.actionGate) await model.actionGate;
        if (model.uncertainAction) return route.abort('failed');
        if (model.actionStatus) return respond({ status: 'fail' }, model.actionStatus);
        const field = webFollow ? 'xdt_create_friendship' : model.actionUpdateField ? 'xdt_instagram_api__v1__friendships__unfollow__update' : 'xdt_destroy_friendship';
        if (model.actionMissingRelation) return respond({ data: { [field]: {} } });
        if (model.actionGraphqlErrors) return respond({ data: { [field]: { friendship_status: { following: webFollow } } }, errors: [{ message: 'private-response-marker' }] });
        if (!model.actionNoChange) {
          if (webFollow && !model.following.includes(id)) {
            if (rawUser(id).is_private) { if (!model.followRequests.includes(id)) model.followRequests.push(id); }
            else model.following.push(id);
          }
          if (webUnfollow) { model.following = model.following.filter(item => item !== id); model.followRequests = model.followRequests.filter(item => item !== id); }
          if (url.pathname.includes('/remove_follower/')) model.followers = model.followers.filter(item => item !== id);
        }
        const relation = { friendship_status: { following: model.following.includes(id), outgoing_request: model.followRequests.includes(id) } };
        const data = webFriendship ? { data: { [field]: relation } } : { status: 'ok', ...relation };
        if (model.actionPrefix) return route.fulfill({ contentType: 'application/json', body: `for (;;);${JSON.stringify(data)}` });
        return respond(data);
      }
      if (url.pathname.includes('current_user') || url.pathname.includes('web_profile_info') || /\/users\/\d+\/info\//.test(url.pathname) || url.pathname === '/api/graphql') {
        model.sessionCalls.push(url.pathname);
        // The endpoint which triggered the original connection bug must never be used.
        if (url.pathname.includes('current_user') || model.sessionRateLimit) return respond({ status: 'fail' }, 429, model.sessionRetryAfter ? { 'Retry-After': model.sessionRetryAfter } : undefined);
        if (url.pathname === '/api/graphql') {
          const payload = new URLSearchParams(route.request().postData() ?? '');
          expect(route.request().method()).toBe('POST');
          expect(payload.get('fb_api_req_friendly_name')).toBe('PolarisProfilePageContentQuery');
          expect(JSON.parse(payload.get('variables') ?? '{}').id).toBe(model.accountId);
          if (model.rejectProfileQuery) return respond({ status: 'fail' }, 400);
        }
        const user = sessionUser;
        return respond({ status: 'ok', user, data: { user } });
      }
      if (/\/friendships\/\d+\/(followers|following)\//.test(url.pathname)) {
        const kind = url.pathname.includes('/followers/') ? 'followers' : 'following';
        const cursor = Number(url.searchParams.get('max_id') || 0);
        const count = Number(url.searchParams.get('count'));
        model.requestedCounts.push(count);
        if (model.rejectLargePages && count > 50) return respond({ status: 'fail' }, 400);
        model.pageCalls.push(`${kind}:${cursor}`);
        if (model.gate) await model.gate;
        if (model.rateLimit) { model.rateLimit = false; return respond({ status: 'fail' }, 429, { 'Retry-After': '1' }); }
        const all = model[kind];
        const users = all.slice(cursor, cursor + model.pageSize).map(rawUser);
        const hasMore = !model.partial && cursor + model.pageSize < all.length;
        return respond({ status: 'ok', users, has_more: hasMore, next_max_id: hasMore ? model.repeatCursor && cursor > 0 ? String(cursor) : String(cursor + model.pageSize) : '' });
      }
      // Never send an unmatched test request to live Instagram.
      return route.abort('blockedbyclient');
    });
    await context.addCookies([{ name: 'ds_user_id', value: '42', domain: '.instagram.com', path: '/', secure: true }, { name: 'csrftoken', value: 'simulated-not-a-secret', domain: '.instagram.com', path: '/', secure: true }]);
    await use(context);
    await context.close();
  },
  instagram: async ({ extensionContext }, use) => { const page = await extensionContext.newPage(); await page.goto('https://www.instagram.com/'); await use(page); },
  panel: async ({ extensionContext, instagram }, use) => {
    void instagram;
    const worker = extensionContext.serviceWorkers()[0] ?? await extensionContext.waitForEvent('serviceworker');
    const id = worker.url().split('/')[2];
    const page = await extensionContext.newPage();
    await page.goto(`chrome-extension://${id}/index.html`);
    await expect(page.getByRole('heading', { name: 'Tu comunidad, de un vistazo' })).toBeVisible();
    await use(page);
  },
});

async function command<T = unknown>(page: Page, command: Command): Promise<Reply<T>> {
  return page.evaluate(async input => await chrome.runtime.sendMessage(input), command);
}
async function state(page: Page): Promise<AppState> {
  const result = await command<AppState>(page, { type: 'STATE' });
  if (!result?.ok) throw new Error(JSON.stringify(result));
  return result.data;
}
async function connect(page: Page) {
  expect((await command(page, { type: 'CONNECT' })).ok).toBe(true);
}
async function scan(page: Page, mode: 'full' | 'followers' = 'full') {
  expect((await command(page, { type: 'START_SCAN', mode })).ok).toBe(true);
  await expect.poll(async () => (await state(page)).scan?.status, { timeout: 20000 }).toBe('completed');
}

test('extensión MV3 real: escaneo, histórico, sin cuota 50, acciones confirmadas y cuenta separada', async ({ panel, model, extensionContext }) => {
  const errors: string[] = [];
  panel.on('pageerror', error => errors.push(error.message));
  await panel.getByRole('button', { name: 'Conectar mi Instagram' }).click();
  await expect(panel.getByText('@cuenta_prueba', { exact: true }).first()).toBeVisible();
  await panel.getByRole('button', { name: 'Nuevo escaneo' }).click();
  await panel.getByRole('button', { name: 'Iniciar escaneo' }).click();
  await expect.poll(async () => (await state(panel)).scan?.status).toBe('completed');
  let data = await state(panel);
  expect(data.latest?.followers).toHaveLength(135); expect(data.latest?.following).toHaveLength(80);
  expect(model.pageCalls).toEqual(['followers:0', 'followers:60', 'followers:120', 'following:0', 'following:60']);
  model.followers = model.followers.filter(id => id >= 1060); model.followers.push(2000, 2001);
  await scan(panel);
  await panel.getByRole('navigation').getByRole('button', { name: 'Seguidores perdidos' }).click();
  await expect(panel.getByRole('heading', { name: 'Seguidores perdidos', exact: true, level: 1 })).toBeVisible();
  await expect(panel.getByText('60', { exact: true }).last()).toBeVisible();
  await panel.getByRole('button', { name: 'Exportar', exact: true }).click();
  const downloaded = panel.waitForEvent('download');
  await panel.getByRole('button', { name: 'Descargar CSV' }).click();
  const download = await downloaded;
  const stream = await download.createReadStream();
  let text = ''; for await (const chunk of stream!) text += chunk.toString();
  expect(text.split('\r\n')).toHaveLength(61);
  const user = data.latest!.followers[0];
  expect((await command(panel, { type: 'START_BATCH', action: 'follow', users: [user] })).ok).toBe(true);
  await expect.poll(async () => (await state(panel)).batch?.status).toBe('completed');
  data = await state(panel);
  expect(data.batch?.items[0].status).toBe('succeeded'); expect(data.overrides[0].following).toBe(true);
  expect(model.actionCalls).toHaveLength(1);
  // Changing sessions cannot leak historical data or start a scan in the wrong account.
  model.accountId = '77';
  await extensionContext.addCookies([{ name: 'ds_user_id', value: '77', domain: '.instagram.com', path: '/', secure: true }]);
  const wrong = await command(panel, { type: 'START_SCAN', mode: 'full' });
  expect(wrong.ok).toBe(false); if (!wrong.ok) expect(wrong.error.code).toBe('ACCOUNT_CHANGED');
  await connect(panel);
  data = await state(panel);
  expect(data.accounts).toHaveLength(2); expect(data.history).toHaveLength(0); expect(data.latest).toBeNull();
  expect((await command(panel, { type: 'SELECT_ACCOUNT', accountId: '42' })).ok).toBe(true);
  expect((await state(panel)).history).toHaveLength(2);
  expect(errors).toEqual([]);
});

test('pausar y recargar conserva cursores; cancelar nunca crea una captura', async ({ panel, model }) => {
  await connect(panel);
  let release!: () => void;
  model.gate = new Promise<void>(resolve => { release = resolve; });
  await command(panel, { type: 'START_SCAN', mode: 'full' });
  await expect.poll(() => model.pageCalls.length).toBe(1);
  await command(panel, { type: 'SCAN_CONTROL', action: 'pause' });
  release(); model.gate = undefined;
  await expect.poll(async () => (await state(panel)).scan?.followers).toBe(60);
  await panel.reload();
  expect((await state(panel)).scan?.status).toBe('paused');
  expect((await command(panel, { type: 'SCAN_CONTROL', action: 'resume' })).ok).toBe(true);
  await expect.poll(async () => (await state(panel)).scan?.status).toBe('completed');
  expect(model.pageCalls.filter(call => call === 'followers:0')).toHaveLength(1);
  model.gate = new Promise<void>(resolve => { release = resolve; });
  await command(panel, { type: 'START_SCAN', mode: 'followers' });
  await expect.poll(() => model.pageCalls.length).toBe(6);
  await command(panel, { type: 'SCAN_CONTROL', action: 'cancel' });
  release(); model.gate = undefined;
  await expect.poll(async () => (await state(panel)).scan?.status).toBe('cancelled');
  expect((await state(panel)).history).toHaveLength(1);
});

test('429 recuperable y captura truncada no sustituye referencia válida', async ({ panel, model }) => {
  await connect(panel); model.rateLimit = true;
  await scan(panel);
  expect(model.pageCalls.filter(call => call === 'followers:0')).toHaveLength(2);
  model.partial = true;
  await command(panel, { type: 'START_SCAN', mode: 'full' });
  await expect.poll(async () => (await state(panel)).scan?.status).toBe('paused');
  const data = await state(panel);
  expect(data.scan?.errorCode).toBe('COUNT_MISMATCH'); expect(data.history).toHaveLength(1);
  expect(data.latest?.followers).toHaveLength(135);
});

test('cursor repetido pausa sin historial ni falsos unfollows', async ({ panel, model }) => {
  await connect(panel); model.repeatCursor = true;
  await command(panel, { type: 'START_SCAN', mode: 'followers' });
  await expect.poll(async () => (await state(panel)).scan?.status).toBe('paused');
  const data = await state(panel);
  expect(data.scan?.errorCode).toBe('CURSOR'); expect(data.history).toHaveLength(0);
});

test('una acción incierta no se reintenta; solo se procesan las pendientes', async ({ panel, model }) => {
  await connect(panel); await scan(panel);
  const users = (await state(panel)).latest!.followers.slice(0, 2);
  model.uncertainAction = true;
  await command(panel, { type: 'START_BATCH', action: 'unfollow', users });
  await expect.poll(async () => (await state(panel)).batch?.status).toBe('paused');
  expect((await state(panel)).batch?.items[0].status).toBe('unknown');
  model.uncertainAction = false;
  await command(panel, { type: 'BATCH_CONTROL', action: 'resume' });
  await expect.poll(async () => (await state(panel)).batch?.status).toBe('completed');
  const data = await state(panel);
  expect(model.actionCalls).toHaveLength(2);
  expect(data.batch?.items[0].status).toBe('unknown'); expect(data.batch?.items[1].status).toBe('succeeded');
});

test('reinicio del service worker conserva el cursor y recupera acciones interrumpidas como inciertas', async ({ panel, model, extensionContext }) => {
  await connect(panel);
  let release!: () => void;
  model.gate = new Promise<void>(resolve => { release = resolve; });
  await command(panel, { type: 'START_SCAN', mode: 'full' });
  await expect.poll(() => model.pageCalls.length).toBe(1);
  await command(panel, { type: 'SCAN_CONTROL', action: 'pause' });
  release(); model.gate = undefined;
  await expect.poll(async () => (await state(panel)).scan?.followers).toBe(60);
  const cdp = await extensionContext.newCDPSession(panel);
  const stopWorker = async () => {
    const { targetInfos } = await cdp.send('Target.getTargets');
    const worker = targetInfos.find(item => item.type === 'service_worker' && item.url.includes('background.js'));
    expect(worker).toBeDefined();
    await cdp.send('Target.closeTarget', { targetId: worker!.targetId });
  };
  await stopWorker();
  expect((await state(panel)).scan?.followers).toBe(60);
  await command(panel, { type: 'SCAN_CONTROL', action: 'resume' });
  await expect.poll(async () => (await state(panel)).scan?.status).toBe('completed');
  expect(model.pageCalls.filter(call => call === 'followers:0')).toHaveLength(1);
  const users = (await state(panel)).latest!.followers.slice(0, 2);
  // Simulate a crash after a mutation was marked as sent but before its result was persisted.
  await panel.evaluate(async selected => {
    const database = await new Promise<IDBDatabase>((resolve, reject) => {
      const r = indexedDB.open('ig-tracker-v1', 1); r.onsuccess = () => resolve(r.result); r.onerror = () => reject(r.error);
    });
    await new Promise<void>((resolve, reject) => {
      const tx = database.transaction('jobs', 'readwrite');
      tx.objectStore('jobs').put({ id: 'batch', runId: 'simulated-crash', accountId: '42', tabId: 1, action: 'follow', status: 'running',
        items: selected.map((user, i) => ({ user, status: i === 0 ? 'sending' : 'pending' })), startedAt: Date.now(), updatedAt: Date.now(), dueAt: Date.now(), error: '' });
      tx.oncomplete = () => resolve(); tx.onerror = () => reject(tx.error);
    });
    database.close();
  }, users);
  await stopWorker();
  const recovered = await state(panel);
  expect(recovered.batch?.status).toBe('paused');
  expect(recovered.batch?.items[0].status).toBe('unknown');
  expect(recovered.batch?.items[1].status).toBe('pending');
  expect(model.actionCalls).toHaveLength(0);
});

test('alternativa de sesión y tamaño 50 cuando Instagram rechaza páginas grandes', async ({ panel, instagram, model }) => {
  model.webBootstrap = true; model.rejectProfileQuery = true; model.rejectLargePages = true;
  await instagram.reload();
  await connect(panel); await scan(panel);
  const data = await state(panel);
  expect(data.latest?.followers).toHaveLength(135);
  expect(model.requestedCounts[0]).toBe(100);
  expect(model.requestedCounts.slice(1).every(count => count === 50)).toBe(true);
  expect(model.sessionCalls).toContain('/api/graphql');
  expect(model.sessionCalls).toContain('/api/v1/users/42/info/');
  expect(model.sessionCalls.some(endpoint => endpoint.includes('current_user'))).toBe(false);
});

test('sin recuentos verificables no se registra una captura', async ({ panel, model }) => {
  model.missingCounts = true;
  await connect(panel);
  await command(panel, { type: 'START_SCAN', mode: 'followers' });
  await expect.poll(async () => (await state(panel)).scan?.status).toBe('paused');
  const data = await state(panel);
  expect(data.scan?.errorCode).toBe('COUNT_UNAVAILABLE');
  expect(data.latest).toBeNull(); expect(data.history).toHaveLength(0);
});

test('no permite comandos de control desde el origen web de Instagram', async ({ panel, extensionContext, model }) => {
  await connect(panel);
  const worker = extensionContext.serviceWorkers()[0];
  await worker.evaluate(async () => {
    const tabs = await chrome.tabs.query({ url: 'https://www.instagram.com/*' });
    await chrome.scripting.executeScript({ target: { tabId: tabs[0].id! }, func: async () => {
      return await chrome.runtime.sendMessage({ type: 'START_SCAN', mode: 'full' });
    } });
  });
  expect((await state(panel)).scan).toBeNull();
  expect(model.pageCalls).toHaveLength(0); expect(model.actionCalls).toHaveLength(0);
});

test('recuento cero válido y las tres acciones mantienen sus resultados separados', async ({ panel, model }) => {
  model.followers = []; model.following = [];
  await connect(panel); await scan(panel);
  expect((await state(panel)).latest?.followers).toEqual([]);
  const user = { id: '1234', username: 'persona1234', fullName: 'Persona 1234', avatar: '', isPrivate: false, isVerified: false };
  for (const action of ['follow', 'unfollow', 'removeFollower'] as const) {
    expect((await command(panel, { type: 'START_BATCH', action, users: [user], accountId: '42' })).ok).toBe(true);
    await expect.poll(async () => (await state(panel)).batch?.status).toBe('completed');
  }
  const data = await state(panel);
  expect(data.overrides[0].following).toBe(false); expect(data.overrides[0].follower).toBe(false);
  expect(data.overrides[0].followingAt).toBeDefined(); expect(data.overrides[0].followerAt).toBeDefined();
  expect(model.actionCalls).toHaveLength(3);
  expect(data.latest?.following).toEqual([]);
});

test('dejar de seguir desde la fila muestra progreso, quita la cuenta y no duplica acciones', async ({ panel, model }) => {
  model.following.push(...Array.from({ length: 30 }, (_, i) => 2000 + i));
  await connect(panel); await scan(panel);
  await panel.getByRole('navigation').getByRole('button', { name: 'No te siguen de vuelta' }).click();
  const row = panel.locator('tbody tr').filter({ hasText: '@persona2023' });
  await expect(row.getByRole('button')).toHaveCount(1);
  await expect(panel.getByRole('button', { name: /Eliminar a .* de tus seguidores/ })).toHaveCount(0);
  let release!: () => void;
  model.actionGate = new Promise<void>(resolve => { release = resolve; });
  try {
    await row.getByRole('button', { name: 'Dejar de seguir', exact: true }).click();
    await expect(panel.getByRole('dialog')).toContainText('@persona2023');
    await panel.getByRole('button', { name: 'Confirmar acción' }).click();
    await expect(panel.getByRole('dialog')).toHaveCount(0);
    await expect(row.getByRole('button', { name: 'Dejando de seguir…' })).toBeDisabled();
    await expect(panel.getByRole('region', { name: 'Estado de acciones' })).toBeInViewport();
    await expect.poll(() => model.actionCalls.length).toBe(1);
    await panel.screenshot({ path: 'test-results/unfollow-progreso.png' });
  } finally { release(); model.actionGate = undefined; }
  await expect.poll(async () => (await state(panel)).batch?.status).toBe('completed');
  await expect(row).toHaveCount(0);
  await expect(panel.getByRole('status').filter({ hasText: '1 acción confirmada por Instagram.' })).toBeVisible();
  await expect(panel.locator('tbody tr').first().getByRole('button', { name: 'Dejar de seguir', exact: true })).toBeEnabled();
  expect(model.following).not.toContain(2023);
  expect(model.actionCalls).toEqual(['/api/graphql']);
  const data = await state(panel);
  expect(data.overrides.find(item => item.userId === '2023')?.following).toBe(false);
  expect(data.latest?.following?.some(user => user.id === '2023')).toBe(true);
});

for (const scenario of ['unchanged', 'missing', 'network', 'http', 'html', 'graphql'] as const) {
  test(`unfollow ${scenario}: error visible y botones desbloqueados, sin éxito ni reintento falso`, async ({ panel, model }) => {
    model.following.push(2000);
    await connect(panel); await scan(panel);
    model.actionNoChange = scenario === 'unchanged';
    model.actionMissingRelation = scenario === 'missing';
    model.uncertainAction = scenario === 'network';
    model.actionStatus = scenario === 'http' ? 403 : undefined;
    model.actionHtml = scenario === 'html';
    model.actionGraphqlErrors = scenario === 'graphql';
    await panel.getByRole('navigation').getByRole('button', { name: 'No te siguen de vuelta' }).click();
    const row = panel.locator('tbody tr').filter({ hasText: '@persona2000' });
    await row.getByRole('button', { name: 'Dejar de seguir', exact: true }).click();
    await panel.getByRole('button', { name: 'Confirmar acción' }).click();
    await expect.poll(async () => (await state(panel)).batch?.status).toBe('completed');
    const data = await state(panel);
    const uncertain = ['network', 'missing', 'html', 'graphql'].includes(scenario);
    expect(data.batch?.items[0].status).toBe(uncertain ? 'unknown' : 'failed');
    expect(data.overrides).toHaveLength(0);
    await expect(row.getByRole('button', { name: 'Dejar de seguir', exact: true })).toBeEnabled();
    await expect(row.locator('.row-action-message')).toContainText(uncertain ? 'Resultado incierto' : 'No confirmado');
    await expect(panel.getByRole('alert')).toContainText('1 acción sin confirmar');
    const progress = panel.getByRole('region', { name: 'Estado de acciones' });
    await expect(progress).toContainText('Lote finalizado con acciones sin confirmar');
    if (scenario === 'http') {
      await expect(progress).toContainText('/api/graphql');
      await expect(progress).toContainText('HTTP 403');
      await panel.screenshot({ path: 'test-results/unfollow-error.png' });
    }
    if (scenario === 'html') {
      await expect(progress).toContainText('página HTML');
      await expect(progress).toContainText('HTTP 200');
    }
    await expect(panel.locator('body')).not.toContainText('private-response-marker');
    await panel.reload();
    expect((await state(panel)).batch?.status).toBe('completed');
    await command(panel, { type: 'BATCH_CONTROL', action: 'resume' });
    expect(model.actionCalls).toHaveLength(1);
    expect(model.following).toContain(2000);
  });
}

test('un lote fallido con pendientes muestra cancelar y libera las acciones al cancelarlo', async ({ panel, model }) => {
  model.following.push(2000, 2001);
  await connect(panel); await scan(panel);
  model.actionNoChange = true;
  await panel.getByRole('navigation').getByRole('button', { name: 'No te siguen de vuelta' }).click();
  await panel.getByRole('checkbox', { name: 'Seleccionar página actual' }).check();
  await expect(panel.getByRole('button', { name: 'Eliminar seguidores', exact: true })).toHaveCount(0);
  await panel.locator('.selection-actions').getByRole('button', { name: 'Dejar de seguir', exact: true }).click();
  await panel.getByRole('button', { name: 'Confirmar acción' }).click();
  await expect.poll(async () => (await state(panel)).batch?.status).toBe('paused');
  const progress = panel.getByRole('region', { name: 'Estado de acciones' });
  await expect(progress).toBeInViewport();
  await expect(progress).toContainText('1 pendiente');
  await expect(panel.locator('tbody tr').last().getByRole('button')).toHaveText('En cola…');
  await expect(panel.locator('tbody tr').first().getByRole('button')).toBeDisabled();
  await panel.screenshot({ path: 'test-results/lote-en-pausa.png' });
  await progress.getByRole('button', { name: 'Cancelar lote', exact: true }).click();
  await expect(progress).toHaveCount(0);
  await expect(panel.locator('tbody tr').first().getByRole('button', { name: 'Dejar de seguir', exact: true })).toBeEnabled();
  await expect(panel.locator('tbody tr').last().getByRole('button', { name: 'Dejar de seguir', exact: true })).toBeEnabled();
  expect(model.actionCalls).toHaveLength(1);
});

test('unfollow web admite JSON protegido y la variante de respuesta update sin usar REST', async ({ panel, model }) => {
  model.following.push(2000);
  model.actionPrefix = true; model.actionUpdateField = true;
  await connect(panel); await scan(panel);
  const user = (await state(panel)).latest!.following!.find(user => user.id === '2000')!;
  expect((await command(panel, { type: 'START_BATCH', action: 'unfollow', users: [user] })).ok).toBe(true);
  await expect.poll(async () => (await state(panel)).batch?.status).toBe('completed');
  const data = await state(panel);
  expect(data.batch?.items[0].status).toBe('succeeded');
  expect(data.overrides.find(item => item.userId === '2000')?.following).toBe(false);
  expect(model.following).not.toContain(2000);
  expect(model.actionCalls).toEqual(['/api/graphql']);
});

test('sin tokens web se pide recargar Instagram y no se envía ninguna mutación', async ({ panel, instagram, model }) => {
  model.webBootstrap = false;
  model.following.push(2000);
  await instagram.reload();
  await connect(panel); await scan(panel);
  const user = (await state(panel)).latest!.following!.find(user => user.id === '2000')!;
  expect((await command(panel, { type: 'START_BATCH', action: 'unfollow', users: [user] })).ok).toBe(true);
  await expect.poll(async () => (await state(panel)).batch?.status).toBe('completed');
  const data = await state(panel);
  expect(data.batch?.items[0].status).toBe('failed');
  expect(data.batch?.error).toContain('Recarga la pestaña de Instagram');
  expect(data.batch?.error).toContain('No se ha enviado el unfollow');
  expect(data.overrides).toHaveLength(0);
  expect(model.actionCalls).toHaveLength(0);
  expect(model.following).toContain(2000);
});

test('seguir una cuenta pública desde la fila confirma la relación y no usa create REST', async ({ panel, model }) => {
  await connect(panel); await scan(panel);
  await panel.getByRole('navigation').getByRole('button', { name: 'No sigues de vuelta' }).click();
  const row = panel.locator('tbody tr').filter({ hasText: '@persona1000' });
  let release!: () => void;
  model.actionGate = new Promise<void>(resolve => { release = resolve; });
  try {
    await row.getByRole('button', { name: 'Seguir', exact: true }).click();
    await expect(panel.getByRole('dialog')).toContainText('Seguir cuentas');
    await panel.getByRole('button', { name: 'Confirmar acción' }).click();
    await expect(row.getByRole('button', { name: 'Siguiendo…', exact: true })).toBeDisabled();
    await expect.poll(() => model.actionCalls.length).toBe(1);
  } finally { release(); model.actionGate = undefined; }
  await expect.poll(async () => (await state(panel)).batch?.status).toBe('completed');
  await expect(row).toHaveCount(0);
  const data = await state(panel);
  expect(data.overrides.find(item => item.userId === '1000')).toMatchObject({ following: true, requested: false });
  expect(data.latest?.following?.some(user => user.id === '1000')).toBe(false);
  expect(model.following).toContain(1000);
  expect(model.actionCalls).toEqual(['/api/graphql']);
});

test('seguir una cuenta privada muestra Solicitud enviada sin afirmar que ya la sigues', async ({ panel, model }) => {
  await connect(panel); await scan(panel);
  await panel.getByRole('navigation').getByRole('button', { name: 'No sigues de vuelta' }).click();
  const row = panel.locator('tbody tr').filter({ hasText: '@persona1002' });
  await row.getByRole('button', { name: 'Seguir', exact: true }).click();
  await panel.getByRole('button', { name: 'Confirmar acción' }).click();
  await expect.poll(async () => (await state(panel)).batch?.status).toBe('completed');
  await expect(row.locator('.relation-tag')).toHaveText('Solicitud enviada');
  await expect(row.getByRole('button', { name: 'Solicitado', exact: true })).toBeDisabled();
  const data = await state(panel);
  expect(data.overrides.find(item => item.userId === '1002')).toMatchObject({ following: false, requested: true });
  expect(data.batch?.items[0].message).toBe('Solicitud enviada');
  expect(model.following).not.toContain(1002);
  expect(model.followRequests).toContain(1002);
  expect(model.actionCalls).toEqual(['/api/graphql']);
  await panel.screenshot({ path: 'test-results/seguir-solicitud-privada.png' });
  await panel.reload();
  await panel.getByRole('navigation').getByRole('button', { name: 'No sigues de vuelta' }).click();
  await expect(row.getByRole('button', { name: 'Solicitado', exact: true })).toBeDisabled();
  expect(model.actionCalls).toHaveLength(1);
});

for (const scenario of ['unchanged', 'missing', 'network', 'http', 'html', 'graphql'] as const) {
  test(`follow ${scenario}: sin éxito falso ni repetición, con error visible`, async ({ panel, model }) => {
    await connect(panel); await scan(panel);
    model.actionNoChange = scenario === 'unchanged';
    model.actionMissingRelation = scenario === 'missing';
    model.uncertainAction = scenario === 'network';
    model.actionStatus = scenario === 'http' ? 403 : undefined;
    model.actionHtml = scenario === 'html';
    model.actionGraphqlErrors = scenario === 'graphql';
    await panel.getByRole('navigation').getByRole('button', { name: 'No sigues de vuelta' }).click();
    const row = panel.locator('tbody tr').filter({ hasText: '@persona1000' });
    await row.getByRole('button', { name: 'Seguir', exact: true }).click();
    await panel.getByRole('button', { name: 'Confirmar acción' }).click();
    await expect.poll(async () => (await state(panel)).batch?.status).toBe('completed');
    const data = await state(panel);
    const uncertain = ['missing', 'network', 'html', 'graphql'].includes(scenario);
    expect(data.batch?.items[0].status).toBe(uncertain ? 'unknown' : 'failed');
    expect(data.overrides).toHaveLength(0);
    await expect(row.getByRole('button', { name: 'Seguir', exact: true })).toBeEnabled();
    await expect(row.locator('.row-action-message')).toContainText(uncertain ? 'Resultado incierto' : 'No confirmado');
    await expect(panel.getByRole('alert')).toContainText('1 acción sin confirmar');
    await expect(panel.locator('body')).not.toContainText('private-response-marker');
    if (scenario === 'html') {
      await expect(panel.getByRole('region', { name: 'Estado de acciones' })).toContainText('página HTML');
      expect(data.batch?.failure?.status).toBe(200);
    }
    await panel.reload();
    await command(panel, { type: 'BATCH_CONTROL', action: 'resume' });
    expect(model.actionCalls).toEqual(['/api/graphql']);
    expect(model.following).not.toContain(1000);
    expect(model.followRequests).not.toContain(1000);
  });
}

test('seguir sin tokens web no envía la acción ni prueba create REST', async ({ panel, instagram, model }) => {
  model.webBootstrap = false;
  await instagram.reload();
  await connect(panel); await scan(panel);
  const user = (await state(panel)).latest!.followers.find(user => user.id === '1000')!;
  expect((await command(panel, { type: 'START_BATCH', action: 'follow', users: [user] })).ok).toBe(true);
  await expect.poll(async () => (await state(panel)).batch?.status).toBe('completed');
  expect((await state(panel)).batch?.error).toContain('No se ha enviado la solicitud de seguimiento');
  expect(model.actionCalls).toHaveLength(0);
  expect(model.following).not.toContain(1000);
});

test('la versión de la marca y del pie coincide con Chrome y con package.json', async ({ panel }) => {
  expect(await panel.evaluate(() => chrome.runtime.getManifest().version)).toBe(version);
  await expect(panel.locator('.brand-version')).toHaveText(`v${version}`);
  await expect(panel.locator('.app-footer .version')).toHaveText(`v${version}`);
  await expect(panel.getByText('Tu comunidad, más clara', { exact: true })).toHaveCount(0);
});

test('eliminar un seguidor solo se ofrece en las filas que realmente te siguen', async ({ panel }) => {
  await connect(panel); await scan(panel);
  await panel.getByRole('navigation').getByRole('button', { name: 'Seguidores mutuos' }).click();
  const row = panel.locator('tbody tr').filter({ hasText: '@persona1050' });
  const remove = row.getByRole('button', { name: 'Eliminar a persona1050 de tus seguidores' });
  await expect(remove).toBeVisible();
  await expect(remove).toHaveAttribute('title', 'Eliminar de tus seguidores (no deja de seguir la cuenta)');
  await remove.click();
  await expect(panel.getByRole('dialog')).toContainText('Eliminar seguidores');
  await panel.getByRole('button', { name: 'Confirmar acción' }).click();
  await expect.poll(async () => (await state(panel)).batch?.status).toBe('completed');
  await expect(row).toHaveCount(0);
  expect((await state(panel)).overrides[0].follower).toBe(false);
  expect((await state(panel)).overrides[0].following).toBeUndefined();
});

test('actualizar recupera un lote antiguo pausado sin pendientes sin repetir la acción', async ({ panel, model, extensionContext }) => {
  model.following.push(2000);
  await connect(panel); await scan(panel);
  const user = (await state(panel)).latest!.following!.find(user => user.id === '2000')!;
  await panel.evaluate(async user => {
    const database = await new Promise<IDBDatabase>(resolve => { const request = indexedDB.open('ig-tracker-v1'); request.onsuccess = () => resolve(request.result); });
    await new Promise<void>((resolve, reject) => {
      const tx = database.transaction('jobs', 'readwrite');
      tx.objectStore('jobs').put({ id: 'batch', runId: 'legacy-paused', accountId: '42', tabId: 1, action: 'unfollow', status: 'paused',
        items: [{ user, status: 'unknown', message: 'Resultado no confirmado' }], startedAt: Date.now(), updatedAt: Date.now(), dueAt: Date.now(), error: 'Resultado no confirmado' });
      tx.oncomplete = () => resolve(); tx.onerror = () => reject(tx.error);
    }); database.close();
  }, user);
  const cdp = await extensionContext.newCDPSession(panel);
  const { targetInfos } = await cdp.send('Target.getTargets');
  const worker = targetInfos.find(target => target.type === 'service_worker' && target.url.includes('background.js'))!;
  await cdp.send('Target.closeTarget', { targetId: worker.targetId });
  await panel.reload();
  await expect.poll(async () => (await state(panel)).batch?.status).toBe('completed');
  await panel.getByRole('navigation').getByRole('button', { name: 'No te siguen de vuelta' }).click();
  await expect(panel.locator('tbody tr').getByRole('button', { name: 'Dejar de seguir', exact: true })).toBeEnabled();
  await expect(panel.locator('.row-action-message')).toContainText('Resultado incierto');
  expect(model.actionCalls).toHaveLength(0);
});

test('conexión desde el perfil de la sesión ya cargado, sin peticiones de identificación', async ({ panel, instagram, model }) => {
  model.sessionEmbedded = true; model.webBootstrap = true;
  await instagram.reload();
  await connect(panel);
  expect(model.sessionCalls).toEqual([]);
  expect((await state(panel)).accounts[0].username).toBe('cuenta_prueba');
  // DOM still says 135. Verification must request fresh counts, not reuse bootstrap data.
  model.followers = [7001, 7002, 7003];
  await scan(panel);
  expect((await state(panel)).latest?.followers).toHaveLength(3);
  expect(model.sessionCalls).toEqual(['/api/graphql']);
});

test('429 antes del escaneo: diagnóstico persistente, espera y sin repetir en otras pestañas', async ({ panel, instagram, extensionContext, model }) => {
  model.webBootstrap = true; model.sessionRateLimit = true; model.sessionRetryAfter = '120';
  await instagram.reload();
  const otherTab = await extensionContext.newPage(); await otherTab.goto('https://www.instagram.com/');
  await panel.getByRole('button', { name: 'Conectar mi Instagram' }).click();
  const problem = panel.getByRole('region', { name: 'Problema de conexión con Instagram' });
  await expect(problem).toBeVisible();
  await expect(problem).toContainText('HTTP 429');
  await expect(problem).toContainText('/api/graphql');
  await expect(problem.getByRole('button', { name: 'Volver a intentar' })).toBeDisabled();
  expect((await state(panel)).scan).toBeNull();
  expect(model.pageCalls).toHaveLength(0); expect(model.sessionCalls).toHaveLength(1);
  expect(model.sessionCalls).toEqual(['/api/graphql']);
  const repeated = await command(panel, { type: 'CONNECT' }); expect(repeated.ok).toBe(false);
  expect(model.sessionCalls).toHaveLength(1);
  await panel.reload();
  await expect(problem).toBeVisible();
  await expect(problem).not.toContainText('Se ha guardado el avance');
  await panel.screenshot({ path: 'test-results/conexion-limitada.png', fullPage: true });
  // Expire the server wait locally instead of making the test wait two minutes.
  await panel.evaluate(async () => {
    const database = await new Promise<IDBDatabase>(resolve => { const r = indexedDB.open('ig-tracker-v1'); r.onsuccess = () => resolve(r.result); });
    await new Promise<void>((resolve, reject) => {
      const tx = database.transaction('settings', 'readwrite');
      const source = tx.objectStore('settings'); const r = source.get('connection-issue');
      r.onsuccess = () => source.put({ ...r.result, value: { ...r.result.value, retryAt: Date.now() - 1 } });
      tx.oncomplete = () => resolve(); tx.onerror = () => reject(tx.error);
    }); database.close();
  });
  model.sessionRateLimit = false;
  await panel.reload();
  await problem.getByRole('button', { name: 'Volver a intentar' }).click();
  await expect(problem).toHaveCount(0);
  expect((await state(panel)).accounts[0].id).toBe('42');
  expect(model.sessionCalls).toHaveLength(2);
});

test('429 sin Retry-After muestra una espera mínima y no reintenta la conexión automáticamente', async ({ panel, model }) => {
  model.sessionRateLimit = true;
  const reply = await command(panel, { type: 'CONNECT' });
  expect(reply.ok).toBe(false);
  const data = await state(panel);
  expect(data.connectionIssue?.retryAt! - data.connectionIssue?.occurredAt!).toBeGreaterThanOrEqual(60_000);
  expect(model.sessionCalls).toHaveLength(1);
  expect(data.scan).toBeNull();
});

test('429 de una consulta web de lectura conserva el avance y muestra el próximo reintento', async ({ panel, instagram, model }) => {
  model.sessionEmbedded = true; model.webBootstrap = true;
  await instagram.reload(); await connect(panel);
  model.sessionRateLimit = true; model.sessionRetryAfter = '2';
  await command(panel, { type: 'START_SCAN', mode: 'followers' });
  await expect.poll(async () => (await state(panel)).scan?.errorCode).toBe('RATE_LIMIT');
  await expect(panel.getByText('En espera por un límite de Instagram')).toBeVisible();
  const waiting = await state(panel);
  expect(waiting.scan?.followers).toBe(135); expect(waiting.latest).toBeNull();
  expect(waiting.scan?.phase).toBe('verify');
  model.sessionRateLimit = false;
  await expect.poll(async () => (await state(panel)).scan?.status).toBe('completed');
  expect((await state(panel)).latest?.followers).toHaveLength(135);
  expect(model.pageCalls).toHaveLength(3);
});
