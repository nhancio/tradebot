/**
 * One-time login helper: prints login URL and, if run with request_token in env,
 * generates session and prints access_token to set in .env
 *
 * Usage:
 *   node src/scripts/login.js
 *     → prints login URL; open it, login, copy request_token from redirect URL
 *   KITE_REQUEST_TOKEN=xyz node src/scripts/login.js
 *     → exchanges request_token for access_token and prints it
 */

import ZerodhaClient from "../zerodha/client.js";

const requestToken = process.env.KITE_REQUEST_TOKEN;

const client = new ZerodhaClient();

if (!client.apiSecret) {
  console.error("Set KITE_API_SECRET in .env");
  process.exit(1);
}

if (requestToken) {
  try {
    const res = await client.generateSession(requestToken);
    console.log("Access token (add to .env as KITE_ACCESS_TOKEN=):");
    console.log(res.access_token);
  } catch (err) {
    console.error("Session generation failed:", err.message || err);
    process.exit(1);
  }
} else {
  console.log("Open this URL in browser, login, then copy request_token from redirect URL:");
  console.log(client.getLoginURL());
  console.log("\nThen run: KITE_REQUEST_TOKEN=<request_token> node src/scripts/login.js");
}
