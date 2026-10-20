const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const webpush = require('web-push');
const { fetchCategories } = require('./lib/feed');
const { load, save } = require('./lib/store');
const { listCategories, isCategoryId } = require('./lib/categories');
const { sendArticle, sendTest } = require('./lib/notify');

const HOST = process.env.HOST || '127.0.0.1';
const PORT = Number(process.env.PORT || 8788);
const POLL_MS = Math.max(60000, Number(process.env.HINDU_POLL_MS || 300000));
const PUBLIC_DIR = path.join(__dirname, 'public');
const DATA_DIR = path.join(__dirname, 'data');
const VAPID_FILE = path.join(DATA_DIR, 'vapid.json');
const SUBSCRIPTIONS_FILE = path.join(DATA_DIR, 'push.json');
const TERMUX_NOTIFY = process.env.HINDU_TERMUX_NOTIFY === '1';
const MAX_ITEMS = 100;

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.webmanifest': 'application/manifest+json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.md': 'text/markdown; charset=utf-8',
};

const cache = { items: [], title: 'The Hindu', checkedAt: null };
let polling = false;

function readJson(file, fallback) {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch {
    return fallback;
  }
}

function writeJson(file, value) {
  fs.mkdirSync(DATA_DIR, { recursive: true });
  fs.writeFileSync(file, JSON.stringify(value, null, 2));
}

function loadVapidKeys() {
  const saved = readJson(VAPID_FILE, null);
  if (saved && saved.publicKey && saved.privateKey) return saved;
  const keys = webpush.generateVAPIDKeys();
  writeJson(VAPID_FILE, keys);
  return keys;
}

function loadSubscriptions() {
  const saved = readJson(SUBSCRIPTIONS_FILE, []);
  return Array.isArray(saved) ? saved.filter((item) => item && item.endpoint) : [];
}

function saveSubscriptions(subscriptions) {
  writeJson(SUBSCRIPTIONS_FILE, subscriptions);
}

const vapid = loadVapidKeys();
webpush.setVapidDetails('mailto:alerts@localhost', vapid.publicKey, vapid.privateKey);

async function sendPush(payload) {
  const subscriptions = loadSubscriptions();
  const keep = [];
  let sent = 0;
  let failure = null;
  for (const subscription of subscriptions) {
    try {
      await webpush.sendNotification(subscription, JSON.stringify(payload), { TTL: 86400 });
      sent += 1;
      keep.push(subscription);
    } catch (error) {
      if (error.statusCode === 404 || error.statusCode === 410) continue;
      keep.push(subscription);
      failure = error.message;
    }
  }
  if (keep.length !== subscriptions.length) saveSubscriptions(keep);
  return { sent, failure };
}

function sendJson(response, status, payload) {
  const body = JSON.stringify(payload);
  response.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'cache-control': 'no-store',
    'content-length': Buffer.byteLength(body),
  });
  response.end(body);
}

function readBody(request) {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks = [];
    request.on('data', (chunk) => {
      size += chunk.length;
      if (size > 20000) {
        reject(new Error('Body too large'));
        request.destroy();
        return;
      }
      chunks.push(chunk);
    });
    request.on('end', () => {
      try {
        resolve(chunks.length ? JSON.parse(Buffer.concat(chunks).toString('utf8')) : {});
      } catch {
        reject(new Error('Invalid JSON'));
      }
    });
    request.on('error', reject);
  });
}

async function poll() {
  if (polling) return;
  polling = true;
  const state = load();
  const firstRun = state.seen.length === 0;
  const pending = new Set(state.pendingPrime);
  const subscriptions = loadSubscriptions();
  let notifyError = null;
  try {
    const feed = await fetchCategories(state.categories);
    if (!feed.succeeded.length) {
      throw new Error(feed.errors.join('; ') || 'All category feeds failed');
    }
    cache.items = feed.items;
    cache.title = 'The Hindu';
    const seen = new Set(state.seen);
    const fresh = feed.items.filter((item) => !seen.has(item.id));
    if (firstRun) {
      for (const item of feed.items) state.seen.push(item.id);
    } else {
      for (const item of fresh.slice().reverse()) {
        const shouldPrime = pending.has(item.categoryId);
        if (state.enabled && !shouldPrime) {
          try {
            let delivered = 0;
            if (subscriptions.length) {
              const result = await sendPush({
                id: item.id,
                title: `The Hindu \u00b7 ${item.category}`,
                body: item.title,
                url: item.link,
                category: item.category,
                publishedAt: item.publishedAt,
              });
              delivered = result.sent;
              if (result.failure) notifyError = result.failure;
            } else if (TERMUX_NOTIFY) {
              sendArticle(item);
              delivered = 1;
            }
            if (delivered) {
              state.notifiedCount += 1;
              state.lastNotification = { id: item.id, title: item.title, at: new Date().toISOString() };
            }
          } catch (error) {
            notifyError = error.message;
          }
        }
        state.seen.push(item.id);
      }
    }
    state.pendingPrime = state.pendingPrime.filter((id) => !feed.succeeded.includes(id));
    state.lastCheck = new Date().toISOString();
    state.lastError = notifyError || (feed.errors.length ? `Feed issue: ${feed.errors.join('; ')}` : null);
    save(state);
    cache.checkedAt = state.lastCheck;
  } catch (error) {
    state.lastError = error.message;
    state.lastCheck = new Date().toISOString();
    save(state);
    cache.checkedAt = state.lastCheck;
  } finally {
    polling = false;
  }
}

const PER_CATEGORY_ITEMS = 20;

function visibleItems() {
  const counts = new Map();
  const items = [];
  for (const item of cache.items) {
    const used = counts.get(item.categoryId) || 0;
    if (used >= PER_CATEGORY_ITEMS) continue;
    counts.set(item.categoryId, used + 1);
    items.push(item);
    if (items.length >= MAX_ITEMS) break;
  }
  return items;
}

function publicState() {
  const state = load();
  return {
    enabled: state.enabled,
    categories: listCategories(state.categories),
    pendingPrime: state.pendingPrime,
    items: visibleItems(),
    totalItems: cache.items.length,
    feedTitle: cache.title,
    lastCheck: state.lastCheck,
    lastError: state.lastError,
    lastNotification: state.lastNotification,
    notifiedCount: state.notifiedCount,
    intervalSeconds: Math.round(POLL_MS / 1000),
    pushDevices: loadSubscriptions().length,
  };
}

function serveStatic(response, pathname) {
  let relative = decodeURIComponent(pathname);
  if (relative === '/' || relative === '/index.html') relative = '/index.html';
  const file = path.join(PUBLIC_DIR, relative);
  if (file !== PUBLIC_DIR && !file.startsWith(PUBLIC_DIR + path.sep)) {
    sendJson(response, 403, { error: 'Forbidden' });
    return;
  }
  fs.readFile(file, (error, buffer) => {
    if (error) {
      response.writeHead(404, { 'content-type': 'text/plain; charset=utf-8' });
      response.end('Not found');
      return;
    }
    response.writeHead(200, {
      'content-type': MIME[path.extname(file)] || 'application/octet-stream',
      'cache-control': 'no-store',
      'service-worker-allowed': '/',
    });
    response.end(buffer);
  });
}

const server = http.createServer(async (request, response) => {
  let url;
  try {
    url = new URL(request.url, `http://${request.headers.host || 'localhost'}`);
  } catch {
    sendJson(response, 400, { error: 'Bad request' });
    return;
  }

  try {
    if (url.pathname === '/api/news') {
      if (request.method !== 'GET') {
        sendJson(response, 405, { error: 'Method not allowed' });
        return;
      }
      if (url.searchParams.get('refresh') === '1' || !cache.items.length) await poll();
      sendJson(response, 200, publicState());
      return;
    }

    if (url.pathname === '/api/categories') {
      if (request.method === 'GET') {
        const state = load();
        sendJson(response, 200, { categories: listCategories(state.categories) });
        return;
      }
      if (request.method !== 'POST') {
        sendJson(response, 405, { error: 'Method not allowed' });
        return;
      }
      const body = await readBody(request);
      if (!Array.isArray(body.categories)) {
        sendJson(response, 400, { error: 'categories must be an array' });
        return;
      }
      if (body.categories.some((id) => !isCategoryId(id))) {
        sendJson(response, 400, { error: 'Unknown category' });
        return;
      }
      const categories = [...new Set(body.categories)];
      if (!categories.length) {
        sendJson(response, 400, { error: 'Select at least one category' });
        return;
      }
      const state = load();
      const added = categories.filter((id) => !state.categories.includes(id));
      state.categories = categories;
      state.pendingPrime = [...new Set([...state.pendingPrime.filter((id) => categories.includes(id)), ...added])];
      save(state);
      sendJson(response, 200, {
        categories: listCategories(state.categories),
        pendingPrime: state.pendingPrime,
      });
      return;
    }

    if (url.pathname === '/api/settings') {
      if (request.method !== 'POST') {
        sendJson(response, 405, { error: 'Method not allowed' });
        return;
      }
      const body = await readBody(request);
      if (typeof body.enabled !== 'boolean') {
        sendJson(response, 400, { error: 'enabled must be a boolean' });
        return;
      }
      const state = load();
      state.enabled = body.enabled;
      save(state);
      sendJson(response, 200, { enabled: state.enabled, pushDevices: loadSubscriptions().length });
      return;
    }

    if (url.pathname === '/api/push/key') {
      if (request.method !== 'GET') {
        sendJson(response, 405, { error: 'Method not allowed' });
        return;
      }
      sendJson(response, 200, { publicKey: vapid.publicKey });
      return;
    }

    if (url.pathname === '/api/push/subscribe') {
      if (request.method !== 'POST') {
        sendJson(response, 405, { error: 'Method not allowed' });
        return;
      }
      const body = await readBody(request);
      const subscription = body.subscription;
      if (!subscription || typeof subscription.endpoint !== 'string' || !subscription.keys) {
        sendJson(response, 400, { error: 'A valid push subscription is required' });
        return;
      }
      const subscriptions = loadSubscriptions().filter((item) => item.endpoint !== subscription.endpoint);
      subscriptions.push(subscription);
      saveSubscriptions(subscriptions);
      const state = load();
      state.enabled = true;
      save(state);
      sendJson(response, 200, { ok: true, devices: subscriptions.length, enabled: true });
      return;
    }

    if (url.pathname === '/api/push/unsubscribe') {
      if (request.method !== 'POST') {
        sendJson(response, 405, { error: 'Method not allowed' });
        return;
      }
      const body = await readBody(request);
      if (typeof body.endpoint !== 'string') {
        sendJson(response, 400, { error: 'endpoint is required' });
        return;
      }
      const subscriptions = loadSubscriptions().filter((item) => item.endpoint !== body.endpoint);
      saveSubscriptions(subscriptions);
      const state = load();
      state.enabled = subscriptions.length > 0 || TERMUX_NOTIFY;
      save(state);
      sendJson(response, 200, { ok: true, devices: subscriptions.length, enabled: state.enabled });
      return;
    }

    if (url.pathname === '/api/test') {
      if (request.method !== 'POST') {
        sendJson(response, 405, { error: 'Method not allowed' });
        return;
      }
      if (!loadSubscriptions().length) {
        if (TERMUX_NOTIFY) {
          sendTest();
          sendJson(response, 200, { ok: true, channel: 'termux', sent: 1 });
          return;
        }
        sendJson(response, 409, { error: 'No devices connected. Turn on notifications in this app first.' });
        return;
      }
      const result = await sendPush({
        id: 'test',
        title: 'The Hindu alerts',
        body: 'Notifications are working. You will get breaking news here.',
        url: `http://localhost:${PORT}/`,
      });
      if (!result.sent) throw new Error(result.failure || 'Push delivery failed');
      sendJson(response, 200, { ok: true, channel: 'webpush', sent: result.sent });
      return;
    }

    if (url.pathname.startsWith('/api/')) {
      sendJson(response, 404, { error: 'Not found' });
      return;
    }

    serveStatic(response, url.pathname);
  } catch (error) {
    sendJson(response, 500, { error: (error && error.message) || 'Server error' });
  }
});

server.listen(PORT, HOST, () => {
  console.log(`The Hindu alerts running at http://localhost:${PORT}`);
  poll();
});

setInterval(poll, POLL_MS).unref();
