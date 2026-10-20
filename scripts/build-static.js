const fs = require('fs');
const path = require('path');
const { CATEGORIES } = require('../lib/categories');
const { fetchCategoryFeed } = require('../lib/feed');

const OUT_DIR = path.join(__dirname, '..', 'docs');
const OUT_FILE = path.join(OUT_DIR, 'news.json');
const PER_CATEGORY = 40;
const MAX_ITEMS = 300;

function dedupe(items) {
  const seen = new Set();
  return items.filter((item) => {
    const key = item.id || item.link;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

async function main() {
  const results = await Promise.allSettled(CATEGORIES.map((category) => fetchCategoryFeed(category)));
  const errors = [];
  const items = [];
  const categories = [];

  results.forEach((result, index) => {
    const category = CATEGORIES[index];
    if (result.status === 'rejected') {
      errors.push(`${category.label}: ${result.reason.message}`);
      return;
    }
    const selected = result.value.slice(0, PER_CATEGORY);
    items.push(...selected);
    categories.push({ id: category.id, label: category.label, count: selected.length });
  });

  if (!items.length) throw new Error('All feeds failed');

  const unique = dedupe(items)
    .sort((a, b) => (Date.parse(b.publishedAt || 0) || 0) - (Date.parse(a.publishedAt || 0) || 0))
    .slice(0, MAX_ITEMS);

  const payload = {
    site: 'The Hindu',
    generatedAt: new Date().toISOString(),
    totalItems: unique.length,
    categories,
    errors,
    items: unique.map(({ id, title, link, categoryId, category, section, description, publishedAt }) => ({
      id,
      title,
      link,
      categoryId,
      category,
      section,
      description,
      publishedAt,
    })),
  };

  fs.mkdirSync(OUT_DIR, { recursive: true });
  fs.writeFileSync(OUT_FILE, JSON.stringify(payload));
  console.log(`Wrote ${unique.length} items from ${categories.length}/${CATEGORIES.length} categories to ${OUT_FILE}`);
  if (errors.length) console.warn(`Feed errors:\n- ${errors.join('\n- ')}`);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
