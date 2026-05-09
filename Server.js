/**
 * TCGWatch Backend Server
 * Node.js + Express stock monitoring server
 * Checks Pokémon TCG & MTG product pages for stock availability
 */

const express = require("express");
const cors = require("cors");
const axios = require("axios");
const cheerio = require("cheerio");

const app = express();
app.use(cors());
app.use(express.json());

// ─── Retailer Detection Rules ─────────────────────────────────────────────────
// Each retailer has selectors / keywords used to detect in-stock status
const RETAILER_RULES = {
  "pokemoncenter.com": {
    name: "Pokémon Center",
    outOfStockSelectors: [
      '[data-testid="add-to-cart-button"][disabled]',
      ".product-detail__sold-out",
      '[class*="sold-out"]',
    ],
    inStockSelectors: [
      '[data-testid="add-to-cart-button"]:not([disabled])',
      'button[class*="add-to-cart"]:not([disabled])',
    ],
    outOfStockText: ["sold out", "out of stock", "notify me when available"],
    inStockText: ["add to cart", "add to bag"],
  },
  "target.com": {
    name: "Target",
    outOfStockSelectors: ['[data-test="orderPickupButton"][disabled]'],
    inStockSelectors: ['[data-test="shippingButton"]:not([disabled])'],
    outOfStockText: ["out of stock", "sold out", "not available"],
    inStockText: ["add to cart", "ship it"],
  },
  "walmart.com": {
    name: "Walmart",
    outOfStockSelectors: ['[class*="out-of-stock"]'],
    inStockSelectors: ['[class*="add-to-cart"]:not([disabled])'],
    outOfStockText: ["out of stock", "sold out"],
    inStockText: ["add to cart"],
  },
  "bestbuy.com": {
    name: "Best Buy",
    outOfStockSelectors: [".btn-disabled.add-to-cart-button", '[class*="sold-out"]'],
    inStockSelectors: [".add-to-cart-button:not(.btn-disabled)"],
    outOfStockText: ["sold out", "coming soon", "check stores"],
    inStockText: ["add to cart"],
  },
  "gamestop.com": {
    name: "GameStop",
    outOfStockSelectors: ['[class*="not-eligible"]', '[id*="availability-msg"]'],
    inStockSelectors: ['[id="add-to-cart"]:not([disabled])'],
    outOfStockText: ["not available", "out of stock", "sold out"],
    inStockText: ["add to cart"],
  },
  "amazon.com": {
    name: "Amazon",
    outOfStockSelectors: ['#outOfStock', '[class*="out-of-stock"]'],
    inStockSelectors: ['#add-to-cart-button:not([disabled])'],
    outOfStockText: ["currently unavailable", "out of stock"],
    inStockText: ["add to cart", "buy now"],
  },
  "tcgplayer.com": {
    name: "TCGPlayer",
    outOfStockSelectors: ['[class*="out-of-stock"]', '[class*="sold-out"]'],
    inStockSelectors: ['[class*="add-to-cart"]:not([disabled])'],
    outOfStockText: ["out of stock", "sold out"],
    inStockText: ["add to cart", "buy now"],
  },
  "cardkingdom.com": {
    name: "Card Kingdom",
    outOfStockSelectors: ['[class*="out-of-stock"]', 'button[disabled][class*="add"]'],
    inStockSelectors: ['button.addToCart:not([disabled])'],
    outOfStockText: ["out of stock", "sold out"],
    inStockText: ["add to cart"],
  },
  "starcitygames.com": {
    name: "Star City Games",
    outOfStockSelectors: ['[class*="out-of-stock"]'],
    inStockSelectors: ['[class*="add-to-cart"]:not([disabled])'],
    outOfStockText: ["out of stock", "sold out"],
    inStockText: ["add to cart"],
  },
  "channelfireball.com": {
    name: "Channel Fireball",
    outOfStockSelectors: ['[class*="sold-out"]', '[class*="out-of-stock"]'],
    inStockSelectors: ['[class*="add-to-cart"]:not([disabled])'],
    outOfStockText: ["sold out", "out of stock"],
    inStockText: ["add to cart"],
  },
};

// ─── Rotating User-Agents ─────────────────────────────────────────────────────
const USER_AGENTS = [
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:125.0) Gecko/20100101 Firefox/125.0",
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 14_4_1) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.4.1 Safari/605.1.15",
];

function randomUA() {
  return USER_AGENTS[Math.floor(Math.random() * USER_AGENTS.length)];
}

function getRules(url) {
  try {
    const hostname = new URL(url).hostname.replace("www.", "");
    return Object.entries(RETAILER_RULES).find(([key]) => hostname.includes(key))?.[1] || null;
  } catch {
    return null;
  }
}

// ─── Core Stock Check ─────────────────────────────────────────────────────────
async function checkStock(url) {
  const rules = getRules(url);

  try {
    const { data: html, status } = await axios.get(url, {
      timeout: 12000,
      headers: {
        "User-Agent": randomUA(),
        Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8",
        "Accept-Language": "en-US,en;q=0.9",
        "Accept-Encoding": "gzip, deflate, br",
        Connection: "keep-alive",
        "Upgrade-Insecure-Requests": "1",
        "Cache-Control": "no-cache",
        Pragma: "no-cache",
        Referer: "https://www.google.com/",
        DNT: "1",
      },
      maxRedirects: 5,
    });

    const $ = cheerio.load(html);
    const bodyText = $("body").text().toLowerCase();

    // Remove script/style tags for cleaner text analysis
    $("script, style, noscript").remove();
    const cleanText = $("body").text().toLowerCase().replace(/\s+/g, " ");

    let inStock = null;

    if (rules) {
      // Check out-of-stock selectors first (most reliable)
      for (const sel of rules.outOfStockSelectors) {
        if ($(sel).length > 0) {
          inStock = false;
          break;
        }
      }

      // Check in-stock selectors
      if (inStock === null) {
        for (const sel of rules.inStockSelectors) {
          if ($(sel).length > 0) {
            inStock = true;
            break;
          }
        }
      }

      // Fall back to text matching
      if (inStock === null) {
        const hasOosText = rules.outOfStockText.some((t) => cleanText.includes(t));
        const hasInStockText = rules.inStockText.some((t) => cleanText.includes(t));

        if (hasOosText && !hasInStockText) inStock = false;
        else if (hasInStockText && !hasOosText) inStock = true;
        else if (hasInStockText && hasOosText) {
          // Both present — try to figure out which is dominant
          const oosScore = rules.outOfStockText.reduce((acc, t) => acc + (cleanText.includes(t) ? 1 : 0), 0);
          const inScore = rules.inStockText.reduce((acc, t) => acc + (cleanText.includes(t) ? 1 : 0), 0);
          inStock = inScore > oosScore;
        }
      }
    } else {
      // Generic fallback for unknown retailers
      const oosKeywords = ["sold out", "out of stock", "currently unavailable", "notify me", "back in stock"];
      const inKeywords = ["add to cart", "add to bag", "buy now", "in stock"];
      const hasOos = oosKeywords.some((t) => cleanText.includes(t));
      const hasIn = inKeywords.some((t) => cleanText.includes(t));
      if (hasOos && !hasIn) inStock = false;
      else if (hasIn) inStock = true;
    }

    return {
      success: true,
      inStock: inStock === true ? true : inStock === false ? false : null,
      statusCode: status,
      retailer: rules?.name || "Unknown Retailer",
      checkedAt: new Date().toISOString(),
    };
  } catch (err) {
    const isBlocked =
      err.response?.status === 403 ||
      err.response?.status === 429 ||
      err.response?.status === 503;

    return {
      success: false,
      inStock: null,
      error: isBlocked
        ? `Blocked by retailer (${err.response?.status}). Try increasing check interval.`
        : err.message,
      statusCode: err.response?.status || null,
      retailer: rules?.name || "Unknown Retailer",
      checkedAt: new Date().toISOString(),
    };
  }
}

// ─── Routes ───────────────────────────────────────────────────────────────────

// Health check
app.get("/health", (req, res) => {
  res.json({ status: "ok", uptime: process.uptime() });
});

// Check a single product URL
app.post("/check", async (req, res) => {
  const { url } = req.body;
  if (!url) return res.status(400).json({ error: "url is required" });

  console.log(`[CHECK] ${url}`);
  const result = await checkStock(url);
  console.log(`[RESULT] ${url} → inStock=${result.inStock}, success=${result.success}`);
  res.json(result);
});

// Batch check multiple products
app.post("/check-batch", async (req, res) => {
  const { products } = req.body;
  if (!Array.isArray(products) || products.length === 0) {
    return res.status(400).json({ error: "products array is required" });
  }

  console.log(`[BATCH] Checking ${products.length} products…`);

  // Stagger requests to avoid rate limiting
  const results = {};
  for (let i = 0; i < products.length; i++) {
    const { id, url } = products[i];
    if (!url || !id) continue;
    if (i > 0) await new Promise((r) => setTimeout(r, 600 + Math.random() * 400));
    results[id] = await checkStock(url);
    console.log(`[BATCH ${i + 1}/${products.length}] id=${id} → inStock=${results[id].inStock}`);
  }

  res.json({ results, checkedAt: new Date().toISOString() });
});

// Supported retailers list
app.get("/retailers", (req, res) => {
  res.json({
    retailers: Object.entries(RETAILER_RULES).map(([domain, r]) => ({
      domain,
      name: r.name,
    })),
  });
});

// ─── Start ────────────────────────────────────────────────────────────────────
const PORT = process.env.PORT || 3001;
app.listen(PORT, () => {
  console.log(`\n🎴 TCGWatch server running on http://localhost:${PORT}`);
  console.log(`   POST /check        — single URL check`);
  console.log(`   POST /check-batch  — batch URL check`);
  console.log(`   GET  /retailers    — supported retailers\n`);
});
