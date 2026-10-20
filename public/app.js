const toggle = document.querySelector('#notify-toggle');
const statusLine = document.querySelector('#status');
const metaLine = document.querySelector('#meta');
const list = document.querySelector('#list');
const count = document.querySelector('#count');
const categoriesEl = document.querySelector('#categories');
const categoryNote = document.querySelector('#category-note');
const refreshButton = document.querySelector('#refresh');
const testButton = document.querySelector('#test');

const relative = new Intl.RelativeTimeFormat(undefined, { numeric: 'auto' });
const pushSupported = 'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window;

let latest = null;
let busy = false;
let deviceSubscribed = false;

function timeAgo(iso) {
  if (!iso) return '';
  const diff = Date.now() - Date.parse(iso);
  if (!Number.isFinite(diff)) return '';
  const minutes = Math.round(diff / 60000);
  if (Math.abs(minutes) < 1) return 'just now';
  if (Math.abs(minutes) < 60) return relative.format(-minutes, 'minute');
  const hours = Math.round(minutes / 60);
  if (Math.abs(hours) < 24) return relative.format(-hours, 'hour');
  const days = Math.round(hours / 24);
  if (Math.abs(days) < 7) return relative.format(-days, 'day');
  return new Date(iso).toLocaleDateString(undefined, { day: 'numeric', month: 'short' });
}

function setStatus(text, kind = '') {
  statusLine.textContent = text;
  statusLine.dataset.kind = kind;
}

function setBusy(value) {
  busy = value;
  toggle.disabled = value || !pushSupported;
  refreshButton.disabled = value;
  testButton.disabled = value;
  categoriesEl.querySelectorAll('input').forEach((input) => {
    input.disabled = value;
  });
}

function urlBase64ToUint8Array(base64) {
  const padding = '='.repeat((4 - (base64.length % 4)) % 4);
  const normalized = (base64 + padding).replace(/-/g, '+').replace(/_/g, '/');
  const raw = atob(normalized);
  const bytes = new Uint8Array(raw.length);
  for (let index = 0; index < raw.length; index += 1) bytes[index] = raw.charCodeAt(index);
  return bytes;
}

function serviceWorkerReady(timeoutMs = 4000) {
  return Promise.race([
    navigator.serviceWorker.ready,
    new Promise((_, reject) => setTimeout(() => reject(new Error('Service worker did not start')), timeoutMs)),
  ]);
}

async function currentSubscription() {
  if (!pushSupported) return null;
  try {
    const registration = await serviceWorkerReady();
    return await registration.pushManager.getSubscription();
  } catch {
    return null;
  }
}

async function subscribeDevice() {
  if (!pushSupported) throw new Error('This browser does not support push notifications');
  if (Notification.permission === 'denied') {
    throw new Error('Notifications are blocked for this site. Allow them in Chrome site settings.');
  }
  if (Notification.permission !== 'granted') {
    const permission = await Notification.requestPermission();
    if (permission !== 'granted') throw new Error('Notification permission was not granted');
  }
  const registration = await serviceWorkerReady();
  let subscription = await registration.pushManager.getSubscription();
  if (!subscription) {
    const keyResponse = await fetch('/api/push/key', { cache: 'no-store' });
    if (!keyResponse.ok) throw new Error('Could not load the push key');
    const { publicKey } = await keyResponse.json();
    subscription = await registration.pushManager.subscribe({
      userVisibleOnly: true,
      applicationServerKey: urlBase64ToUint8Array(publicKey),
    });
  }
  const response = await fetch('/api/push/subscribe', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ subscription: subscription.toJSON() }),
  });
  if (!response.ok) {
    const data = await response.json().catch(() => ({}));
    throw new Error(data.error || `Could not save the subscription (HTTP ${response.status})`);
  }
}

async function unsubscribeDevice() {
  const subscription = await currentSubscription();
  if (!subscription) return;
  await fetch('/api/push/unsubscribe', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ endpoint: subscription.endpoint }),
  });
  await subscription.unsubscribe();
}

function renderMeta(data) {
  const parts = [];
  if (data.lastCheck) parts.push(`Checked ${timeAgo(data.lastCheck)}`);
  parts.push(`every ${Math.max(1, Math.round(data.intervalSeconds / 60))} min`);
  if (data.pushDevices) parts.push(`${data.pushDevices} device${data.pushDevices === 1 ? '' : 's'}`);
  if (data.notifiedCount) parts.push(`${data.notifiedCount} sent`);
  metaLine.textContent = parts.join(' · ');
  if (data.lastError) metaLine.textContent += ` · Error: ${data.lastError}`;
}

function renderCategories(categories) {
  categoriesEl.replaceChildren();
  const active = categories.filter((category) => category.enabled).length;
  categoryNote.textContent = `${active} of ${categories.length} on`;
  for (const category of categories) {
    const label = document.createElement('label');
    label.className = `cat-chip${category.enabled ? ' on' : ''}`;
    const input = document.createElement('input');
    input.type = 'checkbox';
    input.checked = category.enabled;
    input.disabled = busy;
    input.addEventListener('change', () => {
      const next = categories
        .filter((item) => (item.id === category.id ? input.checked : item.enabled))
        .map((item) => item.id);
      if (!next.length) {
        input.checked = true;
        label.classList.add('on');
        setStatus('Keep at least one category on', 'error');
        return;
      }
      saveCategories(next);
    });
    const text = document.createElement('span');
    text.textContent = category.label;
    label.append(input, text);
    categoriesEl.append(label);
  }
}

async function saveCategories(ids) {
  setBusy(true);
  setStatus('Updating categories…');
  try {
    const response = await fetch('/api/categories', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ categories: ids }),
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(data.error || `HTTP ${response.status}`);
    await load(true);
  } catch (error) {
    setStatus(error.message, 'error');
    await load();
  } finally {
    setBusy(false);
  }
}

function renderItems(items, totalItems) {
  list.replaceChildren();
  const total = totalItems || items.length;
  count.textContent = items.length ? `${items.length}${total > items.length ? ` of ${total}` : ''} stories` : '';
  if (!items.length) {
    const empty = document.createElement('p');
    empty.className = 'empty';
    empty.textContent = 'No stories loaded yet. Tap Refresh.';
    list.append(empty);
    return;
  }
  for (const item of items) {
    const card = document.createElement('article');
    card.className = 'story';

    const top = document.createElement('div');
    top.className = 'story-top';
    if (item.category) {
      const chip = document.createElement('span');
      chip.className = 'chip';
      chip.textContent = item.category;
      top.append(chip);
    }
    const when = document.createElement('span');
    when.className = 'when';
    when.textContent = timeAgo(item.publishedAt || item.publishedLabel);
    top.append(when);

    const link = document.createElement('a');
    link.className = 'story-title';
    link.href = item.link;
    link.target = '_blank';
    link.rel = 'noopener noreferrer';
    link.textContent = item.title;

    card.append(top, link);
    if (item.description) {
      const text = document.createElement('p');
      text.className = 'story-text';
      text.textContent = item.description;
      card.append(text);
    }
    list.append(card);
  }
}

function renderStatus(data) {
  if (!pushSupported) {
    setStatus('This browser cannot show push notifications. Open the app in Chrome.', 'error');
    return;
  }
  if (deviceSubscribed) {
    setStatus('Notifications are on for this device', 'on');
    return;
  }
  if (data.enabled && data.pushDevices > 0) {
    setStatus(`Notifications are on for ${data.pushDevices} other device${data.pushDevices === 1 ? '' : 's'}`, 'on');
    return;
  }
  setStatus('Notifications are off', 'off');
}

async function render(data) {
  latest = data;
  const subscription = await currentSubscription();
  deviceSubscribed = Boolean(subscription);
  toggle.checked = deviceSubscribed;
  renderCategories(data.categories || []);
  renderMeta(data);
  renderItems(data.items || [], data.totalItems);
  renderStatus(data);
}

async function load(refresh = false) {
  try {
    const response = await fetch(`/api/news${refresh ? '?refresh=1' : ''}`, { cache: 'no-store' });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    await render(await response.json());
  } catch (error) {
    setStatus(`Cannot reach the alert service (${error.message})`, 'error');
  }
}

toggle.addEventListener('change', async () => {
  setBusy(true);
  try {
    if (toggle.checked) {
      await subscribeDevice();
      deviceSubscribed = true;
      setStatus('Notifications are on for this device', 'on');
    } else {
      await unsubscribeDevice();
      deviceSubscribed = false;
      setStatus('Notifications are off for this device', 'off');
    }
    await load();
  } catch (error) {
    toggle.checked = !toggle.checked;
    setStatus(error.message, 'error');
  } finally {
    setBusy(false);
  }
});

refreshButton.addEventListener('click', async () => {
  setBusy(true);
  setStatus('Checking for news…');
  await load(true);
  setBusy(false);
});

testButton.addEventListener('click', async () => {
  setBusy(true);
  try {
    const response = await fetch('/api/test', { method: 'POST' });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(data.error || `HTTP ${response.status}`);
    setStatus(`Test notification sent to ${data.sent} device${data.sent === 1 ? '' : 's'}`, 'on');
  } catch (error) {
    setStatus(error.message, 'error');
  } finally {
    setBusy(false);
  }
});

async function start() {
  if (pushSupported) {
    try {
      await navigator.serviceWorker.register('/sw.js');
    } catch {
      /* the toggle will report a clear error if push cannot work */
    }
  }
  await load();
  setBusy(false);
}

start();
setInterval(() => {
  if (!busy && document.visibilityState === 'visible') load();
}, 120000);
