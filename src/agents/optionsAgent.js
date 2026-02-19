/**
 * Options order agent – buy/sell options (CE/PE) on NFO.
 * Products: NRML, MIS.
 */

const EXCHANGE_NFO = "NFO";
const PRODUCT_NRML = "NRML";
const PRODUCT_MIS = "MIS";
const VALIDITY_DAY = "DAY";

/**
 * @param {import("../zerodha/client.js").default} client - Zerodha client
 * @param {object} opts
 * @param {string} opts.symbol - Option tradingsymbol (e.g. NIFTY24FEB24500CE, BANKNIFTY24FEB52000PE)
 * @param {"BUY"|"SELL"} opts.side
 * @param {number} opts.quantity - Lot size
 * @param {"NRML"|"MIS"} opts.product
 * @param {"MARKET"|"LIMIT"|"SL"|"SL-M"} opts.orderType
 * @param {number} [opts.price]
 * @param {number} [opts.triggerPrice]
 * @param {string} [opts.tag]
 */
export async function placeOptionsOrder(client, opts) {
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
    throw new Error("optionsAgent: symbol, side and quantity are required");
  }
  if (!["BUY", "SELL"].includes(side)) {
    throw new Error("optionsAgent: side must be BUY or SELL");
  }
  if (![PRODUCT_NRML, PRODUCT_MIS].includes(product)) {
    throw new Error("optionsAgent: product must be NRML or MIS");
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
