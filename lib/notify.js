const { spawnSync } = require('node:child_process');

function notificationId(value) {
  let hash = 5381;
  const text = String(value || '');
  for (let index = 0; index < text.length; index += 1) {
    hash = ((hash << 5) + hash + text.charCodeAt(index)) >>> 0;
  }
  return hash % 2147483647;
}

function shellQuote(value) {
  return `"${String(value || '').replace(/(["\\$`])/g, '\\$1')}"`;
}

function send(title, content, options = {}) {
  const args = ['--title', title, '--content', content, '--priority', 'high', '--group', 'The Hindu'];
  const id = options.id ? notificationId(options.id) : 1;
  args.push('--id', String(id));
  if (options.url) {
    const action = `termux-open-url ${shellQuote(options.url)}`;
    args.push('--action', action, '--button1', 'Open', '--button1-action', action);
  }
  const result = spawnSync('termux-notification', args, { encoding: 'utf8', timeout: 15000 });
  if (result.error || result.status !== 0) {
    const detail = result.error ? result.error.message : (result.stderr || '').trim();
    throw new Error(detail || 'termux-notification failed');
  }
  return true;
}

function sendArticle(item) {
  const title = item.category ? `The Hindu \u00b7 ${item.category}` : 'The Hindu \u00b7 Breaking';
  const content = String(item.title || '').slice(0, 220);
  return send(title, content, { id: item.id, url: item.link });
}

function sendTest() {
  return send('The Hindu alerts', 'Notifications are working. You will receive breaking news here.', { id: 'test' });
}

module.exports = { send, sendArticle, sendTest, notificationId };
