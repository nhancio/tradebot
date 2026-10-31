import { useState } from 'react'
import { useChatStore, getBaseUrl } from '../../store/chatStore'

const POPULAR_SYMBOLS = ['RELIANCE', 'TCS', 'HDFCBANK', 'INFY', 'ICICIBANK', 'SBIN', 'TATAMOTORS', 'BAJFINANCE']

export default function TradeModal({ onClose }) {
  const { port, brokerStatus, addUserMessage, addResponse, addError } = useChatStore()
  const [side, setSide] = useState('BUY')
  const [symbol, setSymbol] = useState('RELIANCE')
  const [exchange, setExchange] = useState('NSE')
  const [product, setProduct] = useState('CNC')
  const [orderType, setOrderType] = useState('MARKET')
  const [quantity, setQuantity] = useState(10)
  const [price, setPrice] = useState('')
  const [broker, setBroker] = useState(brokerStatus?.broker || 'Groww / Zerodha (Auto)')
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState(null)

  const base = getBaseUrl(port)

  async function handleSubmit(e) {
    e.preventDefault()
    if (!symbol.trim()) {
      setError('Symbol is required')
      return
    }
    setSubmitting(true)
    setError(null)
    const cleanSym = symbol.trim().toUpperCase()
    const qty = Math.max(1, Number(quantity) || 1)
    const parsedPrice = orderType === 'LIMIT' && price ? parseFloat(price) : null

    addUserMessage(`${side} ${qty} ${cleanSym} (${exchange} · ${product} · ${orderType}${parsedPrice ? ` @ ₹${parsedPrice}` : ''})`)

    try {
      const res = await fetch(`${base}/skills/order/place`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          symbol: cleanSym,
          exchange,
          transaction_type: side,
          quantity: qty,
          order_type: orderType,
          product,
          price: parsedPrice,
          broker,
        }),
      })
      const json = await res.json()
      if (!res.ok) {
        throw new Error(json.detail || json.error || `HTTP ${res.status}`)
      }
      addResponse({ cardType: 'orders', data: json.data ?? json })
      onClose()
    } catch (err) {
      setError(err.message)
      addError(err.message)
    } finally {
      setSubmitting(false)
    }
  }

  const isBuy = side === 'BUY'

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/65" onClick={onClose}>
      <div
        className="w-[460px] bg-panel border border-border rounded-xl shadow-2xl overflow-hidden"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className={`flex items-center justify-between px-5 py-3.5 border-b border-border ${isBuy ? 'bg-green/10' : 'bg-red/10'}`}>
          <div className="flex items-center gap-2.5">
            <span className={`px-2 py-0.5 rounded text-[11px] font-bold font-ui ${isBuy ? 'bg-green text-surface' : 'bg-red text-white'}`}>
              {side}
            </span>
            <span className="text-text text-sm font-semibold font-ui">Place Order — Pulse AI</span>
          </div>
          <button onClick={onClose} className="text-muted hover:text-text text-lg leading-none cursor-pointer">&times;</button>
        </div>

        <form onSubmit={handleSubmit} className="p-5 space-y-4">
          {/* BUY / SELL toggle */}
          <div className="grid grid-cols-2 gap-2 p-1 bg-elevated rounded-lg border border-border">
            <button
              type="button"
              onClick={() => setSide('BUY')}
              className={`py-2 rounded-md text-xs font-bold font-ui transition-all cursor-pointer ${
                isBuy ? 'bg-green text-surface shadow' : 'text-muted hover:text-text'
              }`}
            >
              BUY (LONG)
            </button>
            <button
              type="button"
              onClick={() => setSide('SELL')}
              className={`py-2 rounded-md text-xs font-bold font-ui transition-all cursor-pointer ${
                !isBuy ? 'bg-red text-white shadow' : 'text-muted hover:text-text'
              }`}
            >
              SELL (SHORT / EXIT)
            </button>
          </div>

          {/* Broker route */}
          <div className="flex items-center justify-between text-[11px] font-ui bg-elevated border border-border rounded-lg px-3 py-2">
            <span className="text-muted">Execution Route:</span>
            <select
              value={broker}
              onChange={(e) => setBroker(e.target.value)}
              className="bg-transparent text-text font-semibold focus:outline-none cursor-pointer"
            >
              <option value="Groww" className="bg-panel">Groww Trade API</option>
              <option value="Zerodha" className="bg-panel">Zerodha Kite Connect</option>
              <option value="Paper" className="bg-panel">Pulse Paper Engine</option>
            </select>
          </div>

          {/* Symbol & Quick chips */}
          <div>
            <label className="text-muted text-[11px] font-ui block mb-1">Symbol (NSE / NFO / BSE)</label>
            <div className="flex gap-2">
              <input
                type="text"
                value={symbol}
                onChange={(e) => setSymbol(e.target.value.toUpperCase())}
                placeholder="e.g. RELIANCE, NIFTY24OCT25000CE"
                className="flex-1 bg-elevated border border-border rounded-lg px-3 py-2 text-text text-sm font-mono focus:outline-none focus:border-amber"
              />
              <select
                value={exchange}
                onChange={(e) => setExchange(e.target.value)}
                className="bg-elevated border border-border rounded-lg px-3 py-2 text-text text-xs font-mono focus:outline-none"
              >
                <option value="NSE">NSE</option>
                <option value="NFO">NFO</option>
                <option value="BSE">BSE</option>
              </select>
            </div>
            <div className="flex flex-wrap gap-1.5 mt-2">
              {POPULAR_SYMBOLS.map((sym) => (
                <button
                  key={sym}
                  type="button"
                  onClick={() => setSymbol(sym)}
                  className={`px-2 py-0.5 rounded text-[10px] font-mono border transition-colors cursor-pointer ${
                    symbol === sym ? 'border-amber text-amber bg-amber/10' : 'border-border text-muted hover:text-text'
                  }`}
                >
                  {sym}
                </button>
              ))}
            </div>
          </div>

          {/* Product & Order Type */}
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="text-muted text-[11px] font-ui block mb-1">Product</label>
              <select
                value={product}
                onChange={(e) => setProduct(e.target.value)}
                className="w-full bg-elevated border border-border rounded-lg px-3 py-2 text-text text-xs font-ui focus:outline-none"
              >
                <option value="CNC">CNC (Delivery / Cash)</option>
                <option value="MIS">MIS (Intraday)</option>
                <option value="NRML">NRML (F&amp;O Carryforward)</option>
              </select>
            </div>
            <div>
              <label className="text-muted text-[11px] font-ui block mb-1">Order Type</label>
              <select
                value={orderType}
                onChange={(e) => setOrderType(e.target.value)}
                className="w-full bg-elevated border border-border rounded-lg px-3 py-2 text-text text-xs font-ui focus:outline-none"
              >
                <option value="MARKET">MARKET</option>
                <option value="LIMIT">LIMIT</option>
              </select>
            </div>
          </div>

          {/* Quantity & Price */}
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="text-muted text-[11px] font-ui block mb-1">Quantity</label>
              <input
                type="number"
                min="1"
                value={quantity}
                onChange={(e) => setQuantity(e.target.value)}
                className="w-full bg-elevated border border-border rounded-lg px-3 py-2 text-text text-sm font-mono focus:outline-none focus:border-amber"
              />
            </div>
            <div>
              <label className="text-muted text-[11px] font-ui block mb-1">
                {orderType === 'LIMIT' ? 'Limit Price (₹)' : 'Price'}
              </label>
              <input
                type="number"
                step="0.05"
                disabled={orderType === 'MARKET'}
                value={orderType === 'MARKET' ? '' : price}
                onChange={(e) => setPrice(e.target.value)}
                placeholder={orderType === 'MARKET' ? 'Market Price' : '0.00'}
                className="w-full bg-elevated border border-border rounded-lg px-3 py-2 text-text text-sm font-mono placeholder:text-subtle disabled:opacity-50 focus:outline-none focus:border-amber"
              />
            </div>
          </div>

          {error && <p className="text-red text-xs font-ui">{error}</p>}

          {/* Submit */}
          <button
            type="submit"
            disabled={submitting}
            className={`w-full py-2.5 rounded-lg text-sm font-bold font-ui transition-all cursor-pointer disabled:opacity-50 ${
              isBuy
                ? 'bg-green text-surface hover:brightness-110'
                : 'bg-red text-white hover:brightness-110'
            }`}
          >
            {submitting ? 'Placing Order…' : `${side} ${quantity || 1} ${symbol || ''} (${orderType})`}
          </button>
        </form>
      </div>
    </div>
  )
}
