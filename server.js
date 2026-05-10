const http = require("http");
const https = require("https");
const url = require("url");

const PORT = process.env.PORT || 3001;

const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
  "Access-Control-Allow-Headers": "*",
  "Access-Control-Max-Age": "86400",
  "Content-Type": "application/json"
};

function checkStock(productUrl, callback) {
  try {
    const parsed = url.parse(productUrl);
    const options = {
      hostname: parsed.hostname,
      path: parsed.path || "/",
      method: "GET",
      headers: {
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/124.0.0.0 Safari/537.36",
        "Accept": "text/html",
        "Accept-Language": "en-US,en;q=0.9",
        "Accept-Encoding": "identity",
        "Connection": "close"
      },
      timeout: 12000
    };

    const req = https.request(options, function(res) {
      var data = "";
      res.setEncoding("utf8");
      res.on("data", function(chunk) {
        data += chunk;
        if (data.length > 500000) req.destroy();
      });
      res.on("end", function() {
        var text = data.toLowerCase();
        var outKeywords = ["sold out", "out of stock", "currently unavailable", "notify me when available"];
        var inKeywords = ["add to cart", "add to bag", "buy now", "in stock"];
        var hasOut = outKeywords.some(function(t) { return text.includes(t); });
        var hasIn = inKeywords.some(function(t) { return text.includes(t); });
        var inStock = null;
        if (hasOut && !hasIn) inStock = false;
        else if (hasIn && !hasOut) inStock = true;
        else if (hasIn && hasOut) inStock = false;
        callback({ success: true, inStock: inStock, statusCode: res.statusCode, checkedAt: new Date().toISOString() });
      });
    });

    req.on("error", function(e) {
      callback({ success: false, error: e.message, inStock: null, checkedAt: new Date().toISOString() });
    });

    req.on("timeout", function() {
      req.destroy();
      callback({ success: false, error: "Timed out", inStock: null, checkedAt: new Date().toISOString() });
    });

    req.end();
  } catch(e) {
    callback({ success: false, error: e.message, inStock: null, checkedAt: new Date().toISOString() });
  }
}

const server = http.createServer(function(req, res) {
  Object.keys(CORS_HEADERS).forEach(function(k) {
    res.setHeader(k, CORS_HEADERS[k]);
  });

  if (req.method === "OPTIONS") {
    res.writeHead(204);
    res.end();
    return;
  }

  if (req.method === "GET" && req.url === "/health") {
    res.writeHead(200);
    res.end(JSON.stringify({ status: "ok", uptime: process.uptime() }));
    return;
  }

  if (req.method === "POST" && req.url === "/check") {
    var body = "";
    req.on("data", function(chunk) { body += chunk; });
    req.on("end", function() {
      try {
        var parsed = JSON.parse(body);
        var productUrl = parsed.url;
        if (!productUrl) {
          res.writeHead(400);
          res.end(JSON.stringify({ error: "url required" }));
          return;
        }
        checkStock(productUrl, function(result) {
          res.writeHead(200);
          res.end(JSON.stringify(result));
        });
      } catch(e) {
        res.writeHead(400);
        res.end(JSON.stringify({ error: "Invalid JSON" }));
      }
    });
    return;
  }

  if (req.method === "POST" && req.url === "/check-batch") {
    var body = "";
    req.on("data", function(chunk) { body += chunk; });
    req.on("end", function() {
      try {
        var parsed = JSON.parse(body);
        var products = parsed.products;
        if (!Array.isArray(products)) {
          res.writeHead(400);
          res.end(JSON.stringify({ error: "products array required" }));
          return;
        }
        var results = {};
        var i = 0;
        function checkNext() {
          if (i >= products.length) {
            res.writeHead(200);
            res.end(JSON.stringify({ results: results, checkedAt: new Date().toISOString() }));
            return;
          }
          var item = products[i++];
          setTimeout(function() {
            checkStock(item.url, function(result) {
              results[item.id] = result;
              checkNext();
            });
          }, i === 1 ? 0 : 700);
        }
        checkNext();
      } catch(e) {
        res.writeHead(400);
        res.end(JSON.stringify({ error: "Invalid JSON" }));
      }
    });
    return;
  }

  res.writeHead(404);
  res.end(JSON.stringify({ error: "Not found" }));
});

server.listen(PORT, "0.0.0.0", function() {
  console.log("TCGWatch running on port " + PORT);
});
