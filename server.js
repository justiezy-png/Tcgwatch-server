const http = require("http");
const https = require("https");
const url = require("url");

const PORT = process.env.PORT || 3001;

const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization",
  "Content-Type": "application/json",
};

function checkStock(productUrl, callback) {
  try {
    const parsed = url.parse(productUrl);
    const options = {
      hostname: parsed.hostname,
      path: parsed.path || "/",
      method: "GET",
      headers: {
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
        "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
        "Accept-Language": "en-US,en;q=0.9",
        "Accept-Encoding": "identity",
        "Connection": "close",
      },
      timeout: 12000,
    };

    const req = https.request(options, (res) => {
      let data = "";
      res.setEncoding("utf8");
      res.on("data", (chunk) => {
        data += chunk;
        if (data.length > 500000) req.destroy();
      });
      res.on("end", () => {
        const text = data.toLowerCase();
        const outKeywords = ["sold out", "out of stock", "currently unavailable", "notify me when available", "coming soon"];
        const inKeywords = ["add to cart", "add to bag", "buy now", "in stock", "add to basket"];
        const hasOut = outKeywords.some((t) => text.includes(t));
        const hasIn = inKeywords.some((t) => text.includes(t));
        let inStock = null;
        if (hasOut && !hasIn) inStock = false;
        else if (hasIn && !hasOut) inStock = true;
        else if (hasIn && hasOut) inStock = false;
        callback({ success: true, inStock, statusCode: res.statusCode, checkedAt: new Date().toISOString() });
      });
    });

    req.on("error", (e) => callback({ success: false, error: e.message, inStock: null, checkedAt: new Date().toISOString() }));
    req.on("timeout", () => { req.destroy(); callback({ success: false, error: "Timed out", inStock: null, checkedAt: new Date().toISOString() }); });
    req.end();
  } catch (e) {
    callback({ success: false, error: e.message, inStock: null, checkedAt: new Date().toISOString() });
  }
}

const server = http.createServer((req, res) => {
  Object.entries(CORS_HEADERS).forEach(([k, v]) => res.setHeader(k, v));

  if (req.method === "OPTIONS") { res.writeHead(204); res.end(); return; }

  if (req.method === "GET" && req.url === "/health") {
    res.writeHead(200);
    res.end(JSON.stringify({ status: "ok", uptime: process.uptime() }));
    return;
  }

  if (req.method === "POST" && req.url === "/check") {
    let body = "";
    req.on("data", (chunk) => { body += chunk; });
    req.on("end", () => {
      try {
        const { url: productUrl } = JSON.parse(body);
        if (!productUrl) { res.writeHead(400); res.end(JSON.stringify({ error: "url required" })); return; }
        checkStock(productUrl, (result) => { res.writeHead(200); res.end(JSON.stringify(result)); });
      } catch { res.writeHead(400); res.end(JSON.stringify({ error: "Invalid JSON" })); }
    });
    return;
  }

  if (req.method === "POST" && req.url === "/check-batch") {
    let body = "";
    req.on("data", (chunk) => { body += chunk; });
    req.on("end", () => {
      try {
        const { products } = JSON.parse(body);
        if (!Array.isArray(products)) { res.writeHead(400); res.end(JSON.stringify({ error: "products array required" })); return; }
        const results = {};
        let i = 0;
        function checkNext() {
          if (i >= products.length) { res.writeHead(200); res.end(JSON.stringify({ results, checkedAt: new Date().toISOString() })); return; }
          const { id, url: productUrl } = products[i++];
          setTimeout(() => { checkStock(productUrl, (result) => { results[id] = result; checkNext(); }); }, i === 1 ? 0 : 700);
        }
        checkNext();
      } catch { res.writeHead(400); res.end(JSON.stringify({ error: "Invalid JSON" })); }
    });
    return;
  }

  res.writeHead(404);
  res.end(JSON.stringify({ error: "Not found" }));
});

server.listen(PORT, "0.0.0.0", () => { console.log(`TCGWatch running on port ${PORT}`); });
