import { useEffect, useRef, useState } from 'react'
import { useChatStore } from '../../store/chatStore'
import Message from './Message'

const WELCOME_ACTIONS = [
  { label: '☀️ Morning Brief', cmd: 'morning-brief' },
  { label: '📊 Analyze RELIANCE', cmd: 'analyze RELIANCE' },
  { label: '⚡ NIFTY GEX', cmd: 'gex NIFTY' },
  { label: '📈 Quote TCS', cmd: 'quote TCS' },
  { label: '💼 Holdings', cmd: 'holdings' },
  { label: '💰 Funds', cmd: 'funds' },
  { label: '🎯 Bullish NIFTY Strategy', cmd: 'strategy NIFTY bullish' },
  { label: '🔍 Scan Options', cmd: 'scan' },
]

export default function ChatArea({ onOpenBrokers, onOpenTrade }) {
  const messages     = useChatStore((s) => s.messages)
  const isLoading    = useChatStore((s) => s.isLoading)
  const sidecarError = useChatStore((s) => s.sidecarError)
  const port         = useChatStore((s) => s.port)
  const setDraft     = useChatStore((s) => s.setDraft)
  const bottomRef    = useRef(null)

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages])

  return (
    <div className="flex-1 overflow-y-auto px-6 py-4 space-y-4">

      {/* Welcome / status */}
      {messages.length === 0 && (
        <div className="flex flex-col items-center justify-center h-full gap-3 text-center max-w-2xl mx-auto">
          <svg className="w-12 h-12 text-emerald-400" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
            <polygon points="12 2 22 20 2 20" fill="rgba(0, 229, 153, 0.2)" stroke="#00e599"/>
            <line x1="12" y1="9" x2="12" y2="13" stroke="#00e599" strokeWidth="2"/>
            <circle cx="12" cy="16" r="1" fill="#00e599"/>
          </svg>
          <p className="text-text text-lg font-semibold font-ui">Pulse AI Trading Platform</p>
          {sidecarError ? (
            <p className="text-red text-sm max-w-sm font-ui">{sidecarError}</p>
          ) : port !== null ? (
            <>
              <p className="text-muted text-sm font-ui max-w-lg">
                AI-powered Indian equities &amp; options intelligence. Connect your <span className="text-text font-medium">Groww</span> or <span className="text-text font-medium">Zerodha</span> account to place trades directly, or run live analysis below.
              </p>
              <div className="flex flex-wrap items-center justify-center gap-2.5 mt-2">
                {onOpenTrade && (
                  <button
                    onClick={onOpenTrade}
                    className="px-4 py-2 rounded-lg bg-green text-surface font-ui font-semibold text-xs hover:brightness-110 transition-all cursor-pointer shadow"
                  >
                    ⚡ Place Buy / Sell Order
                  </button>
                )}
                {onOpenBrokers && (
                  <button
                    onClick={onOpenBrokers}
                    className="px-4 py-2 rounded-lg bg-elevated border border-border hover:border-amber/50 text-text font-ui font-semibold text-xs transition-all cursor-pointer"
                  >
                    🔗 Link Groww / Zerodha Account
                  </button>
                )}
              </div>
              <div className="flex flex-wrap justify-center gap-1.5 mt-3 max-w-xl">
                {WELCOME_ACTIONS.map((a) => (
                  <button
                    key={a.cmd}
                    onClick={() => setDraft(a.cmd)}
                    className="px-2.5 py-1 rounded-md bg-panel border border-border hover:border-amber/40 text-muted hover:text-text text-[11px] font-ui transition-all cursor-pointer"
                  >
                    {a.label}
                  </button>
                ))}
              </div>
            </>
          ) : (
            <p className="text-muted text-sm font-ui">Starting API server…</p>
          )}
        </div>
      )}

      {/* Message list */}
      {messages.map((msg) => (
        <Message key={msg.id} message={msg} />
      ))}

      {/* Loading indicator — hide when a streaming card is already showing live progress */}
      {isLoading && !messages.some(m => m.cardType === 'streaming_analysis') && (
        <ThinkingIndicator />
      )}

      <div ref={bottomRef} />
    </div>
  )
}

function ThinkingIndicator() {
  const [secs, setSecs] = useState(0)

  useEffect(() => {
    const t = setInterval(() => setSecs(s => s + 1), 1000)
    return () => clearInterval(t)
  }, [])

  const hint = secs > 15
    ? 'Running multi-agent analysis — this takes 30–90s…'
    : secs > 5
    ? 'Calling AI agents…'
    : 'Thinking…'

  return (
    <div className="flex items-center gap-3 bg-elevated border border-border rounded-xl px-4 py-3 max-w-sm">
      <span className="text-amber animate-pulse text-lg">◆</span>
      <div>
        <p className="text-text text-sm font-ui">{hint}</p>
        <p className="text-muted text-xs font-mono mt-0.5">{secs}s elapsed</p>
      </div>
    </div>
  )
}
