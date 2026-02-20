/**
 * Polish News Fetcher for SpeakMate
 *
 * Fetches headlines from Polish news portals via RSS feeds,
 * filters out politics, caches results for 24h.
 * Tutors use these headlines as conversation starters.
 */

import * as fs from "fs";
import * as path from "path";

// ============================================================
// Types
// ============================================================

interface NewsItem {
  title: string;   // Polish headline
  source: string;  // Portal name
  url: string;     // Link to article
  category: string; // feed category
  fetchedAt: string; // ISO date
}

interface NewsCache {
  items: NewsItem[];
  lastFetched: string; // ISO timestamp
}

// ============================================================
// Constants
// ============================================================

const DATA_DIR = path.join(import.meta.dir, "../../data");
const CACHE_PATH = path.join(DATA_DIR, "news-cache.json");
const CACHE_TTL = 24 * 60 * 60 * 1000; // 24 hours
const FETCH_TIMEOUT = 10_000; // 10 seconds per feed
const MAX_ITEMS_PER_FEED = 5;
const MAX_TOTAL_ITEMS = 40;

/**
 * RSS feeds from Polish portals — selected for non-political content.
 * Culture, science, tech, lifestyle, sports, entertainment.
 */
const FEEDS = [
  // Sport (verified ✅)
  { name: "Onet Sport", url: "https://sport.onet.pl/.feed", category: "sport" },
  { name: "Przegląd Sportowy", url: "https://przegladsportowy.onet.pl/.feed", category: "sport" },
  // Tech / science (verified ✅)
  { name: "Chip.pl", url: "https://www.chip.pl/feed", category: "tech" },
  { name: "Benchmark", url: "https://www.benchmark.pl/rss/aktualnosci.xml", category: "tech" },
  { name: "National Geographic PL", url: "https://www.national-geographic.pl/feed", category: "science" },
  // Lifestyle
  { name: "Onet Kobieta", url: "https://kobieta.onet.pl/.feed", category: "lifestyle" },
  { name: "Onet Podróże", url: "https://podroze.onet.pl/.feed", category: "lifestyle" },
  // Culture / books / art (verified ✅)
  { name: "Onet Kultura", url: "https://kultura.onet.pl/.feed", category: "culture" },
  { name: "Przekrój", url: "https://przekroj.org/feed", category: "culture" },
  // Business / general
  { name: "Business Insider PL", url: "https://businessinsider.com.pl/.feed", category: "general" },
];

/**
 * Politics keyword filter — AGGRESSIVE.
 * Headlines containing any of these words (case-insensitive) are rejected.
 * Using stem prefixes where possible to catch all forms (e.g. "polityk" matches
 * "polityka", "polityczny", "politycy", "politykow", etc.)
 */
const POLITICS_FILTER: string[] = [
  // Core political terms
  "polityk", "polity", "sejm", "senat", "parlament",
  "rząd", "rzad", "premier", "prezydent", "wicepremier",
  "minister", "ministerstw", "ustawa", "ustawodaw",
  "partia", "parti", "wybor", "koalicj", "opozycj",
  "głosowani", "glosowani", "referendum",
  "mandat", "poseł", "posel", "posłow", "poslow",
  "senator", "senack",
  "komisja śledcza", "komisja sledcza",
  "trybunał", "trybunal", "prokuratur", "prokurator",

  // Polish political parties and figures
  "kaczyński", "kaczynski", "kaczyńsk",
  "tusk", "morawiecki", "duda",
  "lewica", "konfederacj", "platforma",
  "\\bpis\\b", "\\bpo\\b", "\\bko\\b",
  "prawo i sprawiedliw", "obywatelsk",
  "hołownia", "holownia", "trzaskowski",
  "ziobro", "sasin", "kempa", "kukiz",
  "nowoczesna", "wiosna", "razem",

  // Government / legislature
  "sondaż", "sondaz", "sejmow", "senack",
  "ratyfikacj", "interpelacj", "wotum",
  "marszałek", "marszalek", "kancelari",
  "rada ministr", "expose", "exposé",
  "dymisj", "rekonstrkcj", "gabinet",

  // Courts / law (political context)
  "sąd najwyższy", "sad najwyzszy",
  "trybunał konstytucyj", "trybunal konstytucyj",
  "krajowa rada sądow", "krajowa rada sadow",
  "izba dyscyplinarn",

  // EU politics
  "europarlament", "europose",
  "bruksela", "komisja europejsk",

  // General political vocabulary
  "dyplomacj", "ambasad", "konsulat",
  "sankcj", "embargo",
  "protestu", "demonstracj", "manifestacj",
  "strajk", "związek zawodow", "zwiazek zawodow",
];

// Pre-compile filter patterns for performance.
// Some entries use \b word boundaries; the rest are plain substring matches.
const POLITICS_PATTERNS: RegExp[] = POLITICS_FILTER.map((term) => {
  if (term.includes("\\b")) {
    // Already has regex boundary markers
    return new RegExp(term, "i");
  }
  // Plain substring match — escaped for regex safety, case-insensitive
  return new RegExp(term.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "i");
});

// ============================================================
// Politics filter
// ============================================================

/**
 * Returns true if the headline is about politics.
 */
function isPolitics(title: string): boolean {
  const normalized = title
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, ""); // strip diacritics for fuzzy matching

  const titleLower = title.toLowerCase();

  for (const pattern of POLITICS_PATTERNS) {
    if (pattern.test(titleLower) || pattern.test(normalized)) {
      return true;
    }
  }
  return false;
}

// ============================================================
// Cache helpers
// ============================================================

function ensureDataDir(): void {
  if (!fs.existsSync(DATA_DIR)) {
    fs.mkdirSync(DATA_DIR, { recursive: true });
  }
}

function loadCache(): NewsCache | null {
  try {
    if (!fs.existsSync(CACHE_PATH)) return null;
    const raw = fs.readFileSync(CACHE_PATH, "utf-8");
    return JSON.parse(raw) as NewsCache;
  } catch (err) {
    console.error("[News] Failed to load cache:", err);
    return null;
  }
}

function saveCache(cache: NewsCache): void {
  try {
    ensureDataDir();
    fs.writeFileSync(CACHE_PATH, JSON.stringify(cache, null, 2), "utf-8");
  } catch (err) {
    console.error("[News] Failed to save cache:", err);
  }
}

// ============================================================
// RSS parsing (regex-based — no XML parser needed)
// ============================================================

interface RSSItem {
  title: string;
  link: string;
}

/**
 * Parse RSS XML using regex. Extracts <item> blocks, then <title> and <link>.
 * Works for standard RSS 2.0 and Atom feeds (with fallback patterns).
 */
function parseRSS(xml: string): RSSItem[] {
  const items: RSSItem[] = [];

  // Match <item>...</item> blocks (RSS 2.0)
  const itemPattern = /<item[\s>]([\s\S]*?)<\/item>/gi;
  let match: RegExpExecArray | null;

  while ((match = itemPattern.exec(xml)) !== null) {
    const block = match[1];

    // Extract title — handle CDATA: <title><![CDATA[...]]></title>
    const titleMatch = block.match(/<title[^>]*>(?:<!\[CDATA\[)?([\s\S]*?)(?:\]\]>)?<\/title>/i);
    // Extract link — plain text or CDATA
    const linkMatch = block.match(/<link[^>]*>(?:<!\[CDATA\[)?([\s\S]*?)(?:\]\]>)?<\/link>/i);

    if (titleMatch) {
      const title = titleMatch[1].trim().replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&#039;/g, "'").replace(/&apos;/g, "'");
      const link = linkMatch ? linkMatch[1].trim() : "";

      if (title && title.length > 5) {
        items.push({ title, link });
      }
    }
  }

  // Fallback: try Atom <entry>...</entry> blocks
  if (items.length === 0) {
    const entryPattern = /<entry[\s>]([\s\S]*?)<\/entry>/gi;
    while ((match = entryPattern.exec(xml)) !== null) {
      const block = match[1];
      const titleMatch = block.match(/<title[^>]*>(?:<!\[CDATA\[)?([\s\S]*?)(?:\]\]>)?<\/title>/i);
      const linkMatch = block.match(/<link[^>]*href=["']([^"']+)["']/i);

      if (titleMatch) {
        const title = titleMatch[1].trim().replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"');
        const link = linkMatch ? linkMatch[1].trim() : "";

        if (title && title.length > 5) {
          items.push({ title, link });
        }
      }
    }
  }

  return items;
}

// ============================================================
// Feed fetching
// ============================================================

interface FeedConfig {
  name: string;
  url: string;
  category: string;
}

async function fetchFeed(feed: FeedConfig): Promise<NewsItem[]> {
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), FETCH_TIMEOUT);

    const res = await fetch(feed.url, {
      signal: controller.signal,
      headers: {
        "User-Agent": "SpeakMate/1.0 (Language Tutor Bot; news fetcher)",
        Accept: "application/rss+xml, application/xml, text/xml, */*",
      },
    });

    clearTimeout(timeout);

    if (!res.ok) {
      console.warn(`[News] ${feed.name}: HTTP ${res.status}`);
      return [];
    }

    const xml = await res.text();
    const rssItems = parseRSS(xml);
    const now = new Date().toISOString();

    return rssItems.slice(0, MAX_ITEMS_PER_FEED).map((item) => ({
      title: item.title,
      source: feed.name,
      url: item.link,
      category: feed.category,
      fetchedAt: now,
    }));
  } catch (err: any) {
    if (err.name === "AbortError") {
      console.warn(`[News] ${feed.name}: timeout after ${FETCH_TIMEOUT / 1000}s`);
    } else {
      console.warn(`[News] ${feed.name}: ${err.message}`);
    }
    return [];
  }
}

/**
 * Fetch all feeds in parallel, filter politics, deduplicate.
 */
async function fetchAllFeeds(): Promise<NewsItem[]> {
  console.log(`[News] Fetching ${FEEDS.length} RSS feeds...`);

  const results = await Promise.allSettled(FEEDS.map((feed) => fetchFeed(feed)));

  let allItems: NewsItem[] = [];
  let feedsOk = 0;

  for (const result of results) {
    if (result.status === "fulfilled" && result.value.length > 0) {
      feedsOk++;
      allItems.push(...result.value);
    }
  }

  console.log(`[News] ${feedsOk}/${FEEDS.length} feeds OK, ${allItems.length} raw items`);

  // Filter politics
  const beforeFilter = allItems.length;
  allItems = allItems.filter((item) => !isPolitics(item.title));
  console.log(`[News] Politics filter: ${beforeFilter} -> ${allItems.length} items`);

  // Deduplicate by title similarity (exact lowercase match)
  const seen = new Set<string>();
  allItems = allItems.filter((item) => {
    const key = item.title.toLowerCase().trim();
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });

  // Cap total items
  if (allItems.length > MAX_TOTAL_ITEMS) {
    allItems = allItems.slice(0, MAX_TOTAL_ITEMS);
  }

  console.log(`[News] Final: ${allItems.length} headlines cached`);
  return allItems;
}

// ============================================================
// Public API
// ============================================================

/**
 * Get news items (cache-aware). Returns cached data if <24h old,
 * otherwise fetches fresh.
 */
export async function getNews(): Promise<NewsItem[]> {
  const cache = loadCache();
  if (cache && Date.now() - new Date(cache.lastFetched).getTime() < CACHE_TTL) {
    return cache.items;
  }

  // Fetch fresh
  try {
    const items = await fetchAllFeeds();
    saveCache({ items, lastFetched: new Date().toISOString() });
    return items;
  } catch (err) {
    console.error("[News] fetchAllFeeds failed:", err);
    // Return stale cache if available
    return cache?.items || [];
  }
}

/**
 * Force-refresh news cache. Returns the number of headlines fetched.
 */
export async function refreshNews(): Promise<number> {
  const items = await fetchAllFeeds();
  saveCache({ items, lastFetched: new Date().toISOString() });
  return items.length;
}

/**
 * Agent → preferred news categories mapping.
 * Each tutor gets headlines matching their specialty.
 */
const AGENT_CATEGORIES: Record<string, string[]> = {
  general:    ["general", "lifestyle", "tech", "science", "entertainment", "culture", "sport"],
  youth:      ["entertainment", "lifestyle", "general", "sport"],
  chemist:    ["tech", "science"],  // Dr. Chen — science & tech only
  dating:     ["entertainment", "lifestyle", "general", "culture"],
  artist:     ["culture"],  // Luna — ONLY culture: books, art, exhibitions
  brasileiro: ["general", "lifestyle", "entertainment", "sport", "culture"],
};

/**
 * Format news items as a context block for injection into tutor system prompts.
 * Filters headlines by agent specialty. Returns up to 12 headlines.
 *
 * @param items — all cached news items
 * @param agentId — tutor ID (to filter by category)
 */
export function getNewsContext(items: NewsItem[], agentId?: string): string {
  if (!items || items.length === 0) return "";

  // Filter by agent's preferred categories
  const cats = agentId ? (AGENT_CATEGORIES[agentId] || Object.values(AGENT_CATEGORIES)[0]) : undefined;
  let filtered = cats ? items.filter((n) => cats.includes(n.category)) : items;

  const selected = filtered.slice(0, 12);
  if (selected.length === 0) return "";

  const lines = selected.map((n) => `- ${n.title} (${n.source})`);

  const isArtist = agentId === "artist";
  const instruction = isArtist
    ? "These are cultural news from Poland — new books, exhibitions, art events. Weave them naturally into intellectual conversation."
    : "Pick 1-2 headlines naturally when the student seems unsure what to talk about, or weave them into the conversation as cultural context.";

  return [
    "",
    "",
    "## Today's Polish News (use as conversation topics — discuss in the student's target language):",
    ...lines,
    "",
    instruction,
    "",
  ].join("\n");
}
