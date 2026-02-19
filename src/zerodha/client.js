import { KiteConnect } from "kiteconnect";
import config from "../config/index.js";

/**
 * Zerodha Kite Connect client wrapper.
 * Handles session (login URL / access token) and exposes order & market APIs.
 */
class ZerodhaClient {
  constructor() {
    this.kc = new KiteConnect({
      api_key: config.kite.apiKey,
    });
    if (config.kite.accessToken) {
      this.kc.setAccessToken(config.kite.accessToken);
    }
    this.apiSecret = config.kite.apiSecret;
    this.redirectUrl = config.kite.redirectUrl;
  }

  /** Get login URL for user to authenticate and get request_token */
  getLoginURL() {
    return this.kc.getLoginURL();
  }

  /**
   * Generate session from request_token (from redirect query after login).
   * @param {string} requestToken - request_token from callback URL
   * @returns {Promise<{ access_token: string }>}
   */
  async generateSession(requestToken) {
    const res = await this.kc.generateSession(requestToken, this.apiSecret);
    if (res?.access_token) {
      this.kc.setAccessToken(res.access_token);
    }
    return res;
  }

  /** Set access token (e.g. after loading from env or DB) */
  setAccessToken(token) {
    this.kc.setAccessToken(token);
  }

  /** Check if client has an access token */
  hasAccessToken() {
    return !!config.kite.accessToken || !!this.kc.access_token;
  }

  _variety() {
    return "regular";
  }

  // --- Orders ---

  /**
   * Place a regular order.
   * @param {object} params - { tradingsymbol, exchange, transaction_type, quantity, product, order_type, price?, trigger_price?, validity? }
   */
  async placeOrder(params) {
    return this.kc.placeOrder(this._variety(), params);
  }

  /** Get all orders for the day */
  async getOrders() {
    return this.kc.getOrders();
  }

  /** Get order history for an order_id */
  async getOrderHistory(orderId) {
    return this.kc.getOrderHistory(orderId);
  }

  /** Modify an open/pending order */
  async modifyOrder(orderId, params) {
    return this.kc.modifyOrder(this._variety(), orderId, params);
  }

  /** Cancel an order */
  async cancelOrder(orderId) {
    return this.kc.cancelOrder(this._variety(), orderId);
  }

  /** Get trades for the day */
  async getTrades() {
    return this.kc.getTrades();
  }

  // --- Portfolio & positions ---

  async getPositions() {
    return this.kc.getPositions();
  }

  async getHoldings() {
    return this.kc.getHoldings();
  }

  // --- Margins ---

  async getMargins(segment) {
    return this.kc.getMargins(segment);
  }

  async getOrderMargins(params) {
    return this.kc.orderMargins(params);
  }

  // --- Market data ---

  /** Get quote for one or more instruments. Format: "EXCHANGE:TRADINGSYMBOL" */
  async getQuote(instruments) {
    const list = Array.isArray(instruments) ? instruments : [instruments];
    return this.kc.getQuote(list);
  }

  /** Get LTP for one or more instruments. Format: "EXCHANGE:TRADINGSYMBOL" */
  async getLTP(instruments) {
    const list = Array.isArray(instruments) ? instruments : [instruments];
    return this.kc.getLTP(list);
  }

  /** Get instruments for an exchange (NSE, BSE, NFO, etc.) */
  async getInstruments(exchange) {
    return this.kc.getInstruments(exchange);
  }

  /** Get user profile */
  async getProfile() {
    return this.kc.getProfile();
  }
}

export default ZerodhaClient;
