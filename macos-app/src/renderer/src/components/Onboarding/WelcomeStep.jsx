export default function WelcomeStep({ onNext }) {
  return (
    <div className="flex flex-col items-center justify-center flex-1 gap-6 animate-fade-slide">
      <svg className="w-16 h-16 text-emerald-400" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
        <polygon points="12 2 22 20 2 20" fill="rgba(0, 229, 153, 0.2)" stroke="#00e599"/>
        <line x1="12" y1="9" x2="12" y2="13" stroke="#00e599" strokeWidth="2"/>
        <circle cx="12" cy="16" r="1" fill="#00e599"/>
      </svg>
      <h1 className="text-text text-2xl font-semibold font-ui tracking-wide">
        Welcome to Pulse AI
      </h1>
      <p className="text-muted text-sm font-ui max-w-md text-center leading-relaxed">
        Next-gen AI trading platform for Indian markets (NSE, BSE, F&amp;O).
        Connect Zerodha or Groww, analyze in real-time, and execute trades directly.
      </p>
      <button
        onClick={onNext}
        className="mt-4 px-8 py-2.5 bg-emerald-500 text-surface font-ui font-semibold text-sm rounded-lg
                   hover:brightness-110 transition-all active:scale-95"
      >
        Get Started
      </button>
    </div>
  )
}
