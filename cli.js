#!/usr/bin/env node
const PORT = process.env.PORT || 8788;
const BASE = `http://127.0.0.1:${PORT}`;
const command = (process.argv[2] || 'status').toLowerCase();
const argument = process.argv[3];

async function api(pathname, options) {
  try {
    const response = await fetch(`${BASE}${pathname}`, { cache: 'no-store', ...options });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(data.error || `HTTP ${response.status}`);
    return data;
  } catch (error) {
    if (error.cause && error.cause.code === 'ECONNREFUSED') {
      throw new Error('Alert service is not running. Start it with: ~/hindu-alerts/start.sh');
    }
    throw error;
  }
}

function ago(iso) {
  if (!iso) return 'never';
  const diff = Date.now() - Date.parse(iso);
  if (!Number.isFinite(diff)) return iso;
  const minutes = Math.round(diff / 60000);
  if (minutes < 1) return 'just now';
  if (minutes < 60) return `${minutes} min ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours} hr ago`;
  return `${Math.round(hours / 24)} day(s) ago`;
}

async function main() {
  if (command === 'on' || command === 'off') {
    const data = await api('/api/settings', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ enabled: command === 'on' }),
    });
    console.log(`Notifications ${data.enabled ? 'enabled' : 'disabled'}.`);
    if (data.enabled && !data.pushDevices) {
      console.log('No devices connected yet. Open the web app and turn on notifications to receive alerts.');
    }
    return;
  }

  if (command === 'toggle') {
    const current = await api('/api/news');
    const data = await api('/api/settings', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ enabled: !current.enabled }),
    });
    console.log(`Notifications ${data.enabled ? 'enabled' : 'disabled'}.`);
    if (data.enabled) {
      const news = await api('/api/news');
      if (!news.pushDevices) console.log('No devices connected yet. Open the web app and turn on notifications.');
    }
    return;
  }

  if (command === 'test') {
    await api('/api/test', { method: 'POST' });
    console.log('Test notification sent.');
    return;
  }

  if (command === 'latest') {
    const limit = Math.max(1, Number(argument) || 5);
    const data = await api('/api/news?refresh=1');
    const enabled = data.enabled ? 'on' : 'off';
    console.log(`Notifications ${enabled} · checked ${ago(data.lastCheck)}${data.lastError ? ` · error: ${data.lastError}` : ''}\n`);
    for (const item of (data.items || []).slice(0, limit)) {
      console.log(`${item.category ? `[${item.category}] ` : ''}${item.title}`);
      console.log(`  ${item.link}`);
    }
    if (!data.items || !data.items.length) console.log('No stories found.');
    return;
  }

  if (command === 'categories') {
    const data = await api('/api/news');
    for (const category of data.categories || []) {
      console.log(`${category.enabled ? '[x]' : '[ ]'} ${category.id.padEnd(12)} ${category.label}`);
    }
    return;
  }

  if (command === 'category') {
    if (!argument) throw new Error('Usage: hindu-alerts category <id>');
    const data = await api('/api/news');
    const current = data.categories || [];
    const target = current.find((category) => category.id === argument);
    if (!target) {
      throw new Error(`Unknown category "${argument}". Options: ${current.map((category) => category.id).join(', ')}`);
    }
    const enabled = current.filter((category) => category.enabled).map((category) => category.id);
    const next = target.enabled ? enabled.filter((id) => id !== argument) : [...enabled, argument];
    if (!next.length) throw new Error('Keep at least one category on');
    await api('/api/categories', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ categories: next }),
    });
    await api('/api/news?refresh=1');
    console.log(`${target.label} ${target.enabled ? 'off' : 'on'}.`);
    return;
  }

  if (command === 'open') {
    console.log(`Opening ${BASE}`);
    const { spawnSync } = require('node:child_process');
    spawnSync('termux-open-url', [BASE], { stdio: 'ignore' });
    return;
  }

  if (command !== 'status') {
    console.error('Usage: hindu-alerts [on|off|toggle|status|test|latest [n]|categories|category <id>|open]');
    process.exitCode = 1;
    return;
  }

  const data = await api('/api/news');
  console.log(`Notifications: ${data.enabled ? 'on' : 'off'}`);
  console.log(`Feed: ${data.feedTitle}`);
  console.log(`Last check: ${ago(data.lastCheck)}`);
  console.log(`Interval: ${Math.round(data.intervalSeconds / 60)} min`);
  const enabledCategories = (data.categories || []).filter((category) => category.enabled).map((category) => category.label);
  console.log(`Categories: ${enabledCategories.join(', ')}`);
  console.log(`Stories loaded: ${(data.items || []).length}${data.totalItems > data.items.length ? ` of ${data.totalItems}` : ''}`);
  console.log(`Devices connected: ${data.pushDevices || 0}`);
  console.log(`Notifications sent: ${data.notifiedCount || 0}`);
  if (data.lastNotification) console.log(`Last alert: ${data.lastNotification.title} (${ago(data.lastNotification.at)})`);
  if (data.lastError) console.log(`Last error: ${data.lastError}`);
  console.log(`Web UI: ${BASE}`);
}

main().catch((error) => {
  console.error(error.message);
  process.exitCode = 1;
});
