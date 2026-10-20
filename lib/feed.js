const { getCategory } = require('./categories');

const DEFAULT_FEED = process.env.HINDU_FEED || 'https://www.thehindu.com/news/feeder/default.rss';

const NAMED = {
  amp: '&',
  lt: '<',
  gt: '>',
  quot: '"',
  apos: "'",
  nbsp: ' ',
  mdash: '\u2014',
  ndash: '\u2013',
  hellip: '\u2026',
  rsquo: '\u2019',
  lsquo: '\u2018',
  rdquo: '\u201d',
  ldquo: '\u201c',
};

function decodeEntities(value) {
  return String(value || '')
    .replace(/&#(\d+);/g, (_, code) => String.fromCodePoint(Number(code)))
    .replace(/&#x([0-9a-f]+);/gi, (_, code) => String.fromCodePoint(parseInt(code, 16)))
    .replace(/&([a-z]+);/gi, (whole, name) => (name.toLowerCase() in NAMED ? NAMED[name.toLowerCase()] : whole));
}

function stripCdata(value) {
  return String(value || '').replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1');
}

function stripTags(value) {
  return String(value || '')
    .replace(/<br\s*\/?>/gi, ' ')
    .replace(/<[^>]+>/g, ' ');
}

function textOf(body, tag) {
  const match = body.match(new RegExp(`<${tag}(?:\\s[^>]*)?>([\\s\\S]*?)<\\/${tag}>`, 'i'));
  if (!match) return '';
  return decodeEntities(stripCdata(match[1])).replace(/\s+/g, ' ').trim();
}

function plainText(value) {
  return decodeEntities(stripTags(stripCdata(value))).replace(/\s+/g, ' ').trim();
}

function parseFeed(xml) {
  const channel = (xml.match(/<channel>([\s\S]*?)<\/channel>/i) || [])[1] || xml;
  const title = textOf(channel, 'title') || 'The Hindu';
  const items = [];
  const seen = new Set();

  for (const match of xml.matchAll(/<item(?:\s[^>]*)?>([\s\S]*?)<\/item>/gi)) {
    const body = match[1];
    const itemTitle = textOf(body, 'title');
    const link = textOf(body, 'link');
    if (!itemTitle || !link) continue;
    const id = textOf(body, 'guid') || link;
    if (seen.has(id)) continue;
    seen.add(id);
    const pubDate = textOf(body, 'pubDate');
    const parsed = Date.parse(pubDate);
    items.push({
      id,
      title: itemTitle,
      link,
      category: textOf(body, 'category'),
      description: plainText((body.match(/<description(?:\s[^>]*)?>([\s\S]*?)<\/description>/i) || [])[1] || '').slice(0, 400),
      publishedAt: Number.isFinite(parsed) ? new Date(parsed).toISOString() : null,
      publishedLabel: pubDate,
    });
  }

  items.sort((a, b) => (Date.parse(b.publishedAt || 0) || 0) - (Date.parse(a.publishedAt || 0) || 0));
  return { title, items };
}

async function fetchFeed(options = {}) {
  const url = options.url || DEFAULT_FEED;
  const response = await fetch(url, {
    signal: AbortSignal.timeout(options.timeout ?? 15000),
    headers: {
      accept: 'application/rss+xml, application/xml, text/xml',
      'user-agent': 'Mozilla/5.0 (Linux; Android 14) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126 Mobile Safari/537.36',
    },
  });
  if (!response.ok) throw new Error(`Feed request failed (${response.status})`);
  const xml = await response.text();
  const feed = parseFeed(xml);
  if (!feed.items.length) throw new Error('Feed returned no items');
  return feed;
}

async function fetchCategoryFeed(category) {
  const feed = await fetchFeed({ url: category.url });
  return feed.items.map((item) => ({
    ...item,
    categoryId: category.id,
    category: category.label,
    section: item.category,
  }));
}

async function fetchCategories(ids) {
  const selected = ids.map(getCategory).filter(Boolean);
  if (!selected.length) throw new Error('No categories selected');
  const results = await Promise.allSettled(selected.map(fetchCategoryFeed));
  const items = [];
  const errors = [];
  const succeeded = [];
  results.forEach((result, index) => {
    const category = selected[index];
    if (result.status === 'fulfilled') {
      items.push(...result.value);
      succeeded.push(category.id);
    } else {
      errors.push(`${category.label}: ${result.reason.message}`);
    }
  });
  const seen = new Set();
  const unique = items.filter((item) => {
    if (seen.has(item.id)) return false;
    seen.add(item.id);
    return true;
  });
  unique.sort((a, b) => (Date.parse(b.publishedAt || 0) || 0) - (Date.parse(a.publishedAt || 0) || 0));
  return { items: unique, errors, succeeded };
}

module.exports = { fetchFeed, fetchCategories, fetchCategoryFeed, parseFeed, decodeEntities, plainText, DEFAULT_FEED };
