/**
 * Order agents – equity, futures, options.
 * Each agent validates inputs and calls Zerodha client to place orders.
 */

export { placeEquityOrder } from "./equityAgent.js";
export { placeFuturesOrder } from "./futuresAgent.js";
export { placeOptionsOrder } from "./optionsAgent.js";
