/**
 * Futures order agent – buy/sell futures on NFO.
 * Products: NRML (carry forward), MIS (intraday).
 */

const EXCHANGE_NFO = "NFO";
const PRODUCT_NRML = "NRML";
const PRODUCT_MIS = "MIS";
const VALIDITY_DAY = "DAY";

/**
 * @param {import("../zerodha/client.js").default} client - Zerodha client
 * @param {object} opts
 * @param {string} opts.symbol - Futures tradingsymbol (e.g. NIFTY24FEBFUT, BANKNIFTY24FEBFUT)
 * @param {"BUY"|"SELL"} opts.side
 * @param {number} opts.quantity - Lot size (e.g. 25 for NIFTY)
 * @param {"NRML"|"MIS"} opts.product
 * @param {"MARKET"|"LIMIT"|"SL"|"SL-M"} opts.orderType
 * @param {number} [opts.price]
 * @param {number} [opts.triggerPrice]
 * @param {string} [opts.tag]
 */
export async function placeFuturesOrder(client, opts) {
  const {
    symbol,
    side,
    quantity,
    product = PRODUCT_NRML,
    orderType = "MARKET",
    price,
    triggerPrice,
    tag,
  } = opts;

  if (!symbol || !side || !quantity) {
    throw new Error("futuresAgent: symbol, side and quantity are required");
  }
  if (!["BUY", "SELL"].includes(side)) {
    throw new Error("futuresAgent: side must be BUY or SELL");
  }
  if (![PRODUCT_NRML, PRODUCT_MIS].includes(product)) {
    throw new Error("futuresAgent: product must be NRML or MIS");
  }

  const params = {
    tradingsymbol: String(symbol).toUpperCase(),
    exchange: EXCHANGE_NFO,
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

export { EXCHANGE_NFO, PRODUCT_NRML, PRODUCT_MIS };
