const CATEGORIES = [
  { id: 'india', label: 'India', url: 'https://www.thehindu.com/news/national/feeder/default.rss' },
  { id: 'world', label: 'World', url: 'https://www.thehindu.com/news/international/feeder/default.rss' },
  { id: 'business', label: 'Business', url: 'https://www.thehindu.com/business/feeder/default.rss' },
  { id: 'sport', label: 'Sport', url: 'https://www.thehindu.com/sport/feeder/default.rss' },
  { id: 'entertainment', label: 'Entertainment', url: 'https://www.thehindu.com/entertainment/feeder/default.rss' },
  { id: 'sci-tech', label: 'Sci-Tech', url: 'https://www.thehindu.com/sci-tech/feeder/default.rss' },
  { id: 'states', label: 'States', url: 'https://www.thehindu.com/news/states/feeder/default.rss' },
  { id: 'cities', label: 'Cities', url: 'https://www.thehindu.com/news/cities/feeder/default.rss' },
  { id: 'opinion', label: 'Opinion', url: 'https://www.thehindu.com/opinion/feeder/default.rss' },
  { id: 'todays-paper', label: "Today's Paper", url: 'https://www.thehindu.com/todays-paper/feeder/default.rss' },
  { id: 'top', label: 'Top News', url: 'https://www.thehindu.com/news/feeder/default.rss' },
];

const DEFAULT_CATEGORY_IDS = ['india', 'world', 'business', 'sport', 'entertainment', 'sci-tech'];
const byId = new Map(CATEGORIES.map((category) => [category.id, category]));

function getCategory(id) {
  return byId.get(id) || null;
}

function isCategoryId(id) {
  return byId.has(id);
}

function listCategories(enabledIds = []) {
  const enabled = new Set(enabledIds);
  return CATEGORIES.map((category) => ({
    id: category.id,
    label: category.label,
    enabled: enabled.has(category.id),
  }));
}

module.exports = { CATEGORIES, DEFAULT_CATEGORY_IDS, getCategory, isCategoryId, listCategories };
