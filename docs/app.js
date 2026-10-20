const list = document.querySelector('#list');
const count = document.querySelector('#count');
const categoriesEl = document.querySelector('#categories');
const categoryNote = document.querySelector('#category-note');
const metaLine = document.querySelector('#meta');
const refreshButton = document.querySelector('#refresh');
const moreButton = document.querySelector('#more');

const STORAGE_KEY = 'hindu-static-category';
const PAGE_SIZE = 60;
const relative = new Intl.RelativeTimeFormat(undefined, { numeric: 'auto' });

let data = null;
let active = localStorage.getItem(STORAGE_KEY) || 'all';
let shown = PAGE_SIZE;
let loading = false;

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

function categoryCounts() {
  const counts = new Map();
  for (const item of data.items) {
    counts.set(item.categoryId, (counts.get(item.categoryId) || 0) + 1);
  }
  return counts;
}

function selectCategory(id) {
  active = id;
  shown = PAGE_SIZE;
  localStorage.setItem(STORAGE_KEY, id);
  render();
}

function renderCategories() {
  const counts = categoryCounts();
  categoriesEl.replaceChildren();

  const allButton = document.createElement('button');
  allButton.type = 'button';
  allButton.className = `cat-chip${active === 'all' ? ' on' : ''}`;
  allButton.setAttribute('aria-pressed', String(active === 'all'));
  allButton.append(document.createTextNode('All'));
  const allCount = document.createElement('span');
  allCount.className = 'n';
  allCount.textContent = String(data.items.length);
  allButton.append(allCount);
  allButton.addEventListener('click', () => selectCategory('all'));
  categoriesEl.append(allButton);

  for (const category of data.categories) {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = `cat-chip${active === category.id ? ' on' : ''}`;
    button.setAttribute('aria-pressed', String(active === category.id));
    button.append(document.createTextNode(category.label));
    const badge = document.createElement('span');
    badge.className = 'n';
    badge.textContent = String(counts.get(category.id) || 0);
    button.append(badge);
    button.addEventListener('click', () => selectCategory(category.id));
    categoriesEl.append(button);
  }

  categoryNote.textContent = `${data.categories.length} categories`;
}

function renderItems() {
  const all = data.items;
  const items = active === 'all' ? all : all.filter((item) => item.categoryId === active);
  const visible = items.slice(0, shown);

  list.replaceChildren();
  count.textContent = items.length ? `${visible.length} of ${items.length}` : '';

  if (!items.length) {
    const empty = document.createElement('p');
    empty.className = 'empty';
    empty.textContent = 'No stories in this category yet.';
    list.append(empty);
    moreButton.hidden = true;
    return;
  }

  for (const item of visible) {
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
    when.textContent = timeAgo(item.publishedAt);
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

  moreButton.hidden = visible.length >= items.length;
}

function render() {
  if (!data) return;
  if (active !== 'all' && !data.categories.some((category) => category.id === active)) {
    active = 'all';
    localStorage.setItem(STORAGE_KEY, active);
  }
  const parts = [timeAgo(data.generatedAt) ? `Updated ${timeAgo(data.generatedAt)}` : 'Waiting for the first update'];
  parts.push(`${data.items.length} stories`);
  if (data.errors && data.errors.length) parts.push(`${data.errors.length} feed${data.errors.length === 1 ? '' : 's'} unavailable`);
  metaLine.textContent = parts.join(' · ');
  renderCategories();
  renderItems();
}

function renderError(error) {
  list.replaceChildren();
  const empty = document.createElement('p');
  empty.className = 'empty';
  empty.textContent = `Could not load the headlines (${error.message}).`;
  list.append(empty);
  count.textContent = '';
  metaLine.textContent = 'The static feed has not been generated yet.';
  moreButton.hidden = true;
}

async function load() {
  if (loading) return;
  loading = true;
  refreshButton.disabled = true;
  try {
    const response = await fetch(`./news.json?v=${Date.now()}`, { cache: 'no-store' });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    data = await response.json();
    render();
  } catch (error) {
    if (!data) {
      renderError(error);
    } else {
      metaLine.textContent = `Updated ${timeAgo(data.generatedAt)} · ${data.items.length} stories · refresh failed`;
    }
  } finally {
    loading = false;
    refreshButton.disabled = false;
  }
}

refreshButton.addEventListener('click', load);

moreButton.addEventListener('click', () => {
  shown += PAGE_SIZE;
  renderItems();
});

load();
setInterval(() => {
  if (document.visibilityState === 'visible') load();
}, 300000);
