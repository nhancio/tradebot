/**
 * Equity order agent – buy/sell stocks on NSE/BSE.
 * Products: CNC (delivery), MIS (intraday).
 */

const EXCHANGE_NSE = "NSE";
const EXCHANGE_BSE = "BSE";
const PRODUCT_CNC = "CNC";
const PRODUCT_MIS = "MIS";
const VALIDITY_DAY = "DAY";

/**
 * @param {import("../zerodha/client.js").default} client - Zerodha client
 * @param {object} opts
 * @param {string} opts.symbol - Tradingsymbol (e.g. RELIANCE, INFY)
 * @param {string} opts.exchange - NSE | BSE
 * @param {"BUY"|"SELL"} opts.side
 * @param {number} opts.quantity
 * @param {"CNC"|"MIS"} opts.product - CNC for delivery, MIS for intraday
 * @param {"MARKET"|"LIMIT"|"SL"|"SL-M"} opts.orderType
 * @param {number} [opts.price] - For LIMIT
 * @param {number} [opts.triggerPrice] - For SL, SL-M
 * @param {string} [opts.tag] - Optional tag (max 20 chars)
 */
export async function placeEquityOrder(client, opts) {
  const {
    symbol,
    exchange = EXCHANGE_NSE,
    side,
    quantity,
    product = PRODUCT_CNC,
    orderType = "MARKET",
    price,
    triggerPrice,
    tag,
  } = opts;

  if (!symbol || !side || !quantity) {
    throw new Error("equityAgent: symbol, side and quantity are required");
  }
  if (!["BUY", "SELL"].includes(side)) {
    throw new Error("equityAgent: side must be BUY or SELL");
  }
  if (![EXCHANGE_NSE, EXCHANGE_BSE].includes(exchange)) {
    throw new Error("equityAgent: exchange must be NSE or BSE");
  }
  if (![PRODUCT_CNC, PRODUCT_MIS].includes(product)) {
    throw new Error("equityAgent: product must be CNC or MIS");
  }

  const params = {
    tradingsymbol: String(symbol).toUpperCase(),
    exchange,
    transaction_type: side,
    quantity: Number(quantity),
    product,
    order_type: orderType,
    validity: VALIDITY_DAY,
  };

  if (orderType === "LIMIT" && price != null) {
    params.price = Number(price);
  }
  if ((orderType === "SL" || orderType === "SL-M") && triggerPrice != null) {
    params.trigger_price = Number(triggerPrice);
  }
  if (orderType === "SL" && price != null) {
    params.price = Number(price);
  }
  if (tag) {
    params.tag = String(tag).slice(0, 20);
  }

  return client.placeOrder(params);
}

export { EXCHANGE_NSE, EXCHANGE_BSE, PRODUCT_CNC, PRODUCT_MIS };
