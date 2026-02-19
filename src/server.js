/**
 * TradeBot UI server – serves the web UI and API for triggers.
 * Run: npm run ui
 */

import express from "express";
import path from "path";
import { fileURLToPath } from "url";
import ZerodhaClient from "./zerodha/client.js";
import { placeEquityOrder, placeFuturesOrder, placeOptionsOrder } from "./agents/index.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const client = new ZerodhaClient();
const app = express();
const PORT = process.env.PORT || 3000;

app.use(express.json());
app.use(express.static(path.join(__dirname, "public")));

function requireAuth(req, res, next) {
  if (!client.hasAccessToken()) {
    return res.status(401).json({ error: "Not authenticated. Set KITE_ACCESS_TOKEN in .env and restart." });
  }
  next();
}

// Auth info (no token required)
app.get("/api/auth", (req, res) => {
  res.json({
    ok: true,
    hasToken: client.hasAccessToken(),
    loginUrl: client.getLoginURL(),
  });
});

// Data endpoints (require auth)
app.get("/api/orders", requireAuth, async (req, res) => {
  try {
    const data = await client.getOrders();
    res.json({ ok: true, data });
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message || String(err) });
  }
});

app.get("/api/positions", requireAuth, async (req, res) => {
  try {
    const data = await client.getPositions();
    res.json({ ok: true, data });
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message || String(err) });
  }
});

app.get("/api/margins", requireAuth, async (req, res) => {
  try {
    const data = await client.getMargins();
    res.json({ ok: true, data });
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message || String(err) });
  }
});

app.get("/api/profile", requireAuth, async (req, res) => {
  try {
    const data = await client.getProfile();
    res.json({ ok: true, data });
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message || String(err) });
  }
});

// Place orders (require auth)
app.post("/api/order/equity", requireAuth, async (req, res) => {
  try {
    const orderId = await placeEquityOrder(client, {
      symbol: req.body.symbol,
      exchange: req.body.exchange || "NSE",
      side: req.body.side,
      quantity: Number(req.body.quantity),
      product: req.body.product || "CNC",
      orderType: req.body.orderType || "MARKET",
      price: req.body.price != null ? Number(req.body.price) : undefined,
      triggerPrice: req.body.triggerPrice != null ? Number(req.body.triggerPrice) : undefined,
      tag: req.body.tag,
    });
    res.json({ ok: true, orderId });
  } catch (err) {
    res.status(400).json({ ok: false, error: err.message || String(err) });
  }
});

app.post("/api/order/futures", requireAuth, async (req, res) => {
  try {
    const orderId = await placeFuturesOrder(client, {
      symbol: req.body.symbol,
      side: req.body.side,
      quantity: Number(req.body.quantity),
      product: req.body.product || "NRML",
      orderType: req.body.orderType || "MARKET",
      price: req.body.price != null ? Number(req.body.price) : undefined,
      triggerPrice: req.body.triggerPrice != null ? Number(req.body.triggerPrice) : undefined,
      tag: req.body.tag,
    });
    res.json({ ok: true, orderId });
  } catch (err) {
    res.status(400).json({ ok: false, error: err.message || String(err) });
  }
});

app.post("/api/order/options", requireAuth, async (req, res) => {
  try {
    const orderId = await placeOptionsOrder(client, {
      symbol: req.body.symbol,
      side: req.body.side,
      quantity: Number(req.body.quantity),
      product: req.body.product || "NRML",
      orderType: req.body.orderType || "MARKET",
      price: req.body.price != null ? Number(req.body.price) : undefined,
      triggerPrice: req.body.triggerPrice != null ? Number(req.body.triggerPrice) : undefined,
      tag: req.body.tag,
    });
    res.json({ ok: true, orderId });
  } catch (err) {
    res.status(400).json({ ok: false, error: err.message || String(err) });
  }
});

const MAX_PORT = PORT + 10;

function tryListen(port) {
  if (port > MAX_PORT) {
    console.error(`No free port between ${PORT} and ${MAX_PORT}. Kill the process using port ${PORT} or set PORT=3001 npm run ui`);
    process.exit(1);
  }
  const server = app.listen(port, () => {
    console.log(`TradeBot UI: http://localhost:${port}`);
    if (!client.hasAccessToken()) {
      console.log("No KITE_ACCESS_TOKEN set – data/order buttons will fail until you authenticate.");
    }
  });
  server.on("error", (err) => {
    if (err.code === "EADDRINUSE") {
      console.warn(`Port ${port} in use, trying ${port + 1}...`);
      tryListen(port + 1);
    } else {
      throw err;
    }
  });
}

tryListen(PORT);
