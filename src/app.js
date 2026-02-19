#!/usr/bin/env node
/**
 * TradeBot – AI trading bot (Zerodha Kite Connect).
 * CLI: node src/app.js [command] [options]
 * Commands: orders | positions | margins | profile | login
 * Place order (for testing): node src/app.js order-equity RELIANCE BUY 1 MIS
 */

import ZerodhaClient from "./zerodha/client.js";
import { placeEquityOrder, placeFuturesOrder, placeOptionsOrder } from "./agents/index.js";

const client = new ZerodhaClient();
const args = process.argv.slice(2);
const cmd = args[0] || "help";

async function ensureAuth() {
  if (!client.hasAccessToken()) {
    console.error("Not authenticated. Run: node src/scripts/login.js");
    console.error("Then set KITE_ACCESS_TOKEN in .env");
    process.exit(1);
  }
}

async function main() {
  switch (cmd) {
    case "orders": {
      await ensureAuth();
      const orders = await client.getOrders();
      console.log(JSON.stringify(orders, null, 2));
      return;
    }
    case "positions": {
      await ensureAuth();
      const positions = await client.getPositions();
      console.log(JSON.stringify(positions, null, 2));
      return;
    }
    case "margins": {
      await ensureAuth();
      const margins = await client.getMargins();
      console.log(JSON.stringify(margins, null, 2));
      return;
    }
    case "profile": {
      await ensureAuth();
      const profile = await client.getProfile();
      console.log(JSON.stringify(profile, null, 2));
      return;
    }
    case "login": {
      console.log("Login URL:", client.getLoginURL());
      console.log("After login, run: KITE_REQUEST_TOKEN=<token> node src/scripts/login.js");
      return;
    }
    case "order-equity": {
      await ensureAuth();
      const [symbol, side, qty, product = "CNC"] = args.slice(1);
      if (!symbol || !side || !qty) {
        console.error("Usage: node src/app.js order-equity <symbol> <BUY|SELL> <qty> [CNC|MIS]");
        process.exit(1);
      }
      const orderId = await placeEquityOrder(client, {
        symbol,
        side: side.toUpperCase(),
        quantity: parseInt(qty, 10),
        product: product.toUpperCase(),
        orderType: "MARKET",
      });
      console.log("Order placed:", orderId);
      return;
    }
    case "order-futures": {
      await ensureAuth();
      const [symbol, side, qty, product = "NRML"] = args.slice(1);
      if (!symbol || !side || !qty) {
        console.error("Usage: node src/app.js order-futures <symbol> <BUY|SELL> <qty> [NRML|MIS]");
        process.exit(1);
      }
      const orderId = await placeFuturesOrder(client, {
        symbol,
        side: side.toUpperCase(),
        quantity: parseInt(qty, 10),
        product: product.toUpperCase(),
        orderType: "MARKET",
      });
      console.log("Order placed:", orderId);
      return;
    }
    case "order-options": {
      await ensureAuth();
      const [symbol, side, qty, product = "NRML"] = args.slice(1);
      if (!symbol || !side || !qty) {
        console.error("Usage: node src/app.js order-options <symbol> <BUY|SELL> <qty> [NRML|MIS]");
        process.exit(1);
      }
      const orderId = await placeOptionsOrder(client, {
        symbol,
        side: side.toUpperCase(),
        quantity: parseInt(qty, 10),
        product: product.toUpperCase(),
        orderType: "MARKET",
      });
      console.log("Order placed:", orderId);
      return;
    }
    case "help":
    default: {
      console.log(`
TradeBot – Zerodha Kite Connect

Commands:
  login              Print login URL
  orders             List today's orders
  positions          List positions
  margins            Get margin info
  profile            Get user profile

Place orders (use with caution; real money):
  order-equity       <symbol> <BUY|SELL> <qty> [CNC|MIS]
  order-futures      <symbol> <BUY|SELL> <qty> [NRML|MIS]
  order-options      <symbol> <BUY|SELL> <qty> [NRML|MIS]

Setup:
  1. Copy .env.example to .env and set KITE_API_KEY, KITE_API_SECRET
  2. node src/scripts/login.js → open URL, get request_token
  3. KITE_REQUEST_TOKEN=... node src/scripts/login.js → get access_token
  4. Set KITE_ACCESS_TOKEN in .env
`);
      return;
    }
  }
}

main().catch((err) => {
  console.error(err.message || err);
  process.exit(1);
});
