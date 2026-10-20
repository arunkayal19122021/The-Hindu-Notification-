const fs = require('node:fs');
const path = require('node:path');
const { DEFAULT_CATEGORY_IDS, isCategoryId } = require('./categories');

const DATA_DIR = path.join(__dirname, '..', 'data');
const STATE_FILE = path.join(DATA_DIR, 'state.json');
const MAX_SEEN = 5000;

const defaults = {
  enabled: false,
  categories: DEFAULT_CATEGORY_IDS,
  pendingPrime: [],
  seen: [],
  lastCheck: null,
  lastError: null,
  lastNotification: null,
  notifiedCount: 0,
};

function normalize(parsed) {
  const state = { ...defaults, ...parsed };
  state.seen = Array.isArray(parsed.seen) ? parsed.seen : [];
  const needsCategories = !Array.isArray(parsed.categories);
  state.categories = needsCategories
    ? [...DEFAULT_CATEGORY_IDS]
    : parsed.categories.filter(isCategoryId);
  if (!state.categories.length) state.categories = [...DEFAULT_CATEGORY_IDS];
  const pending = Array.isArray(parsed.pendingPrime) ? parsed.pendingPrime : [];
  state.pendingPrime = needsCategories
    ? [...state.categories]
    : pending.filter((id) => state.categories.includes(id));
  return state;
}

function load() {
  try {
    return normalize(JSON.parse(fs.readFileSync(STATE_FILE, 'utf8')));
  } catch {
    return normalize({});
  }
}

function save(state) {
  state.categories = state.categories.filter(isCategoryId);
  state.pendingPrime = [...new Set(state.pendingPrime)].filter((id) => state.categories.includes(id));
  state.seen = [...new Set(state.seen)].slice(-MAX_SEEN);
  fs.mkdirSync(DATA_DIR, { recursive: true });
  const temporary = `${STATE_FILE}.tmp`;
  fs.writeFileSync(temporary, JSON.stringify(state, null, 2));
  fs.renameSync(temporary, STATE_FILE);
  return state;
}

module.exports = { load, save, STATE_FILE };
