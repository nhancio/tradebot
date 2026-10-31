import { useEffect, useState } from 'react'
import { useChatStore, getBaseUrl } from './store/chatStore'
import { useMarketClock } from './hooks/useMarketClock'
import Sidebar from './components/Sidebar'
import BrokerPanel from './components/Sidebar/BrokerPanel'
import SettingsPanel from './components/Sidebar/SettingsPanel'
import TradeModal from './components/Sidebar/TradeModal'
import ChatArea from './components/Chat/ChatArea'
import InputBar from './components/Input/InputBar'
import SetupScreen from './components/SetupScreen'
import OnboardingWizard from './components/Onboarding/OnboardingWizard'

function useTheme() {
  const [theme, setThemeState] = useState(() => {
    try { return localStorage.getItem('vt-theme') || 'system' } catch { return 'system' }
  })

  useEffect(() => {
    const root = document.documentElement
    root.classList.remove('dark', 'light')
    if (theme === 'dark') root.classList.add('dark')
    else if (theme === 'light') root.classList.add('light')
    // 'system' — no class, CSS @media handles it
    try { localStorage.setItem('vt-theme', theme) } catch {}
  }, [theme])

  const cycle = () => setThemeState((t) => t === 'system' ? 'light' : t === 'light' ? 'dark' : 'system')
  return { theme, cycle }
}

export default function App() {
  const { setPort, setSidecarError, setBrokerStatuses } = useChatStore()
  const createSession = useChatStore((s) => s.createSession)
  const port = useChatStore((s) => s.port)
  const { theme, cycle: cycleTheme } = useTheme()

  // Setup phase state machine
  const [setupPhase, setSetupPhase] = useState('initializing')
  // 'initializing' | 'progress' | 'python_missing' | 'error' | 'onboarding' | 'ready'
  const [setupData, setSetupData] = useState(null)
  const [showBrokers, setShowBrokers] = useState(false)
  const [showSettings, setShowSettings] = useState(false)
  const [showTradeModal, setShowTradeModal] = useState(false)

  useEffect(() => {
    // Web mode — no Electron IPC, check if server or browser engine is ready
    if (window.__INDIA_TRADE_WEB__) {
      setPort(0) // Signal that API is available (web uses relative URLs)
      const checkReady = async () => {
        try {
          const res = await fetch('/api/onboarding/status')
          if (res.status === 401) {
            window.location.href = '/'
            return
          }
          const ct = res.headers?.get?.('content-type') || ''
          if (res.ok && ct.includes('application/json')) {
            const data = await res.json()
            if (data.onboarding_complete) {
              setSetupPhase('ready')
            } else {
              setSetupPhase('onboarding')
            }
            return
          }
        } catch {
          // Fallback gracefully in static web hosting mode
        }
        setSetupPhase('ready')
      }
      checkReady()
      return
    }

    // Setup progress events
    window.electronAPI?.onSetupProgress((data) => {
      setSetupPhase('progress')
      setSetupData(data)
    })

    // Python not found
    window.electronAPI?.onSetupPythonMissing((data) => {
      setSetupPhase('python_missing')
      setSetupData(data)
    })

    // Sidecar ready — check onboarding before showing main UI
    window.electronAPI?.onSidecarReady(async ({ port }) => {
      setPort(port)
      try {
        const res = await fetch(`${getBaseUrl(port)}/api/onboarding/status`)
        const data = await res.json()
        if (data.onboarding_complete) {
          setSetupPhase('ready')
        } else {
          setSetupPhase('onboarding')
        }
      } catch {
        setSetupPhase('ready')
      }
    })

    // Sidecar error — could be during setup or runtime
    window.electronAPI?.onSidecarError(({ message, details }) => {
      setSidecarError(message)
      if (setupPhase !== 'ready') {
        setSetupPhase('error')
        setSetupData({ message, details })
      }
    })

    // Check if port already set (HMR / reload)
    window.electronAPI?.getPort().then(async (port) => {
      if (port) {
        setPort(port)
        try {
          const res = await fetch(`${getBaseUrl(port)}/api/onboarding/status`)
          const data = await res.json()
          if (data.onboarding_complete) {
            setSetupPhase('ready')
          } else {
            setSetupPhase('onboarding')
          }
        } catch {
          setSetupPhase('ready')
        }
      }
    })
  }, [])

  // Poll /api/status every 8s once sidecar is up
  useEffect(() => {
    if (!port && port !== 0) return
    const statusUrl = `${getBaseUrl(port)}/api/status`
    const fetchStatus = () =>
      fetch(statusUrl)
        .then(r => r.json())
        .then(setBrokerStatuses)
        .catch(() => {})
    fetchStatus()
    const t = setInterval(fetchStatus, 8000)
    return () => clearInterval(t)
  }, [port])

  // Cmd+N / Ctrl+N — new session
  useEffect(() => {
    function onKeyDown(e) {
      if ((e.metaKey || e.ctrlKey) && e.key === 'n') {
        e.preventDefault()
        createSession()
      }
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [createSession])

  // Show onboarding wizard for first-launch setup
  if (setupPhase === 'onboarding') {
    return <OnboardingWizard port={port} onComplete={() => setSetupPhase('ready')} />
  }

  // Show setup screen until ready
  if (setupPhase !== 'ready') {
    return <SetupScreen phase={setupPhase} data={setupData} />
  }

  return (
    <div className="flex flex-col h-full bg-surface">

      {/* Title bar */}
      <div className="drag flex items-center h-[52px] bg-panel border-b border-border flex-shrink-0">
        <div className="w-[76px] flex-shrink-0" />
        <div className="flex-1 flex items-center justify-center gap-2 pointer-events-none">
          <svg className="w-4 h-4 text-emerald-400" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
            <polygon points="12 2 22 20 2 20" fill="rgba(0, 229, 153, 0.2)" stroke="#00e599"/>
          </svg>
          <span className="text-text text-[13px] font-semibold tracking-wide font-ui">
            Pulse AI
          </span>
        </div>
        <div className="no-drag flex items-center gap-2.5 pr-4">
          <button
            onClick={() => setShowTradeModal(true)}
            className="px-2.5 py-1 rounded-md bg-green/15 text-green border border-green/30 hover:bg-green/25 text-[11px] font-ui font-semibold transition-all cursor-pointer"
          >
            ⚡ Place Trade
          </button>
          <button
            onClick={() => setShowBrokers(true)}
            className="px-2.5 py-1 rounded-md bg-elevated text-text border border-border hover:border-amber/40 text-[11px] font-ui font-medium transition-all cursor-pointer"
          >
            🔗 Groww / Zerodha
          </button>
          <button
            onClick={() => setShowSettings(true)}
            className="px-2 py-1 rounded-md bg-elevated text-muted hover:text-text border border-border text-[11px] font-ui transition-all cursor-pointer"
            title="Settings"
          >
            ⚙
          </button>
          <MarketBadge />
          <ThemeToggle theme={theme} cycle={cycleTheme} />
          <StatusDot />
        </div>
      </div>

      {/* Main layout */}
      <div className="flex flex-1 overflow-hidden">
        <Sidebar
          onOpenBrokers={() => setShowBrokers(true)}
          onOpenSettings={() => setShowSettings(true)}
          onOpenTrade={() => setShowTradeModal(true)}
        />
        <div className="flex flex-col flex-1 overflow-hidden">
          <ChatArea
            onOpenBrokers={() => setShowBrokers(true)}
            onOpenTrade={() => setShowTradeModal(true)}
          />
          <InputBar />
        </div>
      </div>

      {showBrokers && <BrokerPanel onClose={() => setShowBrokers(false)} />}
      {showSettings && <SettingsPanel onClose={() => setShowSettings(false)} />}
      {showTradeModal && <TradeModal onClose={() => setShowTradeModal(false)} />}
    </div>
  )
}

function MarketBadge() {
  const { status, nifty } = useMarketClock()

  const cfg = {
    'open':       { dot: 'bg-green animate-pulse', label: 'Open',      text: 'text-green' },
    'pre-open':   { dot: 'bg-amber animate-pulse', label: 'Pre-open',  text: 'text-amber' },
    'post-close': { dot: 'bg-amber',               label: 'Post-close',text: 'text-amber' },
    'closed':     { dot: 'bg-subtle',              label: 'Closed',    text: 'text-subtle' },
  }[status] ?? { dot: 'bg-subtle', label: '', text: 'text-subtle' }

  return (
    <div className="flex items-center gap-1.5">
      <span className={`w-1.5 h-1.5 rounded-full ${cfg.dot}`} />
      <span className={`text-[11px] font-ui ${cfg.text}`}>
        {nifty ? `N ${nifty}` : cfg.label}
      </span>
    </div>
  )
}

function ThemeToggle({ theme, cycle }) {
  const icon = theme === 'dark' ? '🌙' : theme === 'light' ? '☀️' : '🖥'
  const label = theme === 'dark' ? 'Dark' : theme === 'light' ? 'Light' : 'Auto'
  return (
    <button
      onClick={cycle}
      className="flex items-center gap-1 text-[11px] text-muted font-ui hover:text-text transition-colors cursor-pointer"
      title={`Theme: ${label} (click to cycle)`}
    >
      <span className="text-[12px]">{icon}</span>
    </button>
  )
}

function StatusDot() {
  const { port, sidecarError, brokerStatus } = useChatStore()
  const connected = port !== null && !sidecarError

  return (
    <div className="flex items-center gap-2">
      <span className={`w-2 h-2 rounded-full transition-all ${
        connected ? 'bg-green shadow-[0_0_6px_rgba(82,224,122,0.5)]' : 'bg-subtle'
      }`} />
      <span className="text-muted text-[11px] font-ui">
        {sidecarError
          ? 'error'
          : connected
          ? (brokerStatus?.connected ? brokerStatus.broker : 'connected')
          : 'starting...'}
      </span>
    </div>
  )
}
