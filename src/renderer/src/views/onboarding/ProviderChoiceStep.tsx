import { useState } from 'react'
import { FeatureRow } from './ui'
import geminiLogo from '../../assets/images/GeminiLogo.png'
import dayflowLogo from '../../assets/images/DayflowLogo.png'
import chatgptLogo from '../../assets/images/ChatGPTLogo.svg'
import claudeLogo from '../../assets/images/ClaudeLogo.png'

// Step: "Choose a way to run Dayflow". Two recommended cards (Gemini + Local)
// plus a "See all options" 2x2 grid. Dayflow Pro and ChatGPT/Claude are shown
// but marked "coming later" in the Windows port.

export type ProviderChoice = 'gemini' | 'ollama'

interface CardDef {
  id: string
  title: string
  badge: string
  badgeTone: 'green' | 'orange' | 'blue'
  pros: string[]
  caveats: string[]
  disabled?: boolean
}

const GEMINI_CARD: CardDef = {
  id: 'gemini',
  title: 'Google Gemini',
  badge: 'RECOMMENDED',
  badgeTone: 'orange',
  pros: [
    "Uses Gemini's free tier (no subscription needed)",
    'Faster and more accurate than local models',
    'Much easier setup compared to local models'
  ],
  caveats: ['Less advanced compared to ChatGPT and Claude']
}

const LOCAL_CARD: CardDef = {
  id: 'ollama',
  title: 'Local AI',
  badge: 'MOST PRIVATE',
  badgeTone: 'green',
  pros: ['100% private - nothing leaves your computer'],
  caveats: [
    'Significantly less intelligence',
    'Not recommended for those new to running local LLMs',
    'Requires 16GB+ of RAM and 4GB free disk space'
  ]
}

const DAYFLOW_CARD: CardDef = {
  id: 'dayflow',
  title: 'Dayflow Pro',
  badge: 'COMING LATER',
  badgeTone: 'blue',
  pros: [
    'Zero setup - just sign in and go',
    'Try it for free - no credit card necessary.',
    'Sync across devices',
    'Uses models with maximum intelligence for the best experience'
  ],
  caveats: [],
  disabled: true
}

const CHATGPT_CARD: CardDef = {
  id: 'chatgpt_claude',
  title: 'ChatGPT or Claude',
  badge: 'COMING LATER',
  badgeTone: 'blue',
  pros: [
    'Superior intelligence and reliability',
    'Uses less than 1% of your daily limit',
    'Perfect for ChatGPT Plus or Claude Pro paid subscribers'
  ],
  caveats: ['Requires installing Codex or Claude CLI'],
  disabled: true
}

function CardIcon(props: { id: string }): React.JSX.Element {
  if (props.id === 'gemini') {
    return (
      <span className="ob-provider-icon">
        <img src={geminiLogo} alt="" />
      </span>
    )
  }
  if (props.id === 'dayflow') {
    return <img className="ob-provider-icon-raw" src={dayflowLogo} alt="" />
  }
  if (props.id === 'chatgpt_claude') {
    return (
      <span className="ob-provider-icon-pair">
        <span className="ob-provider-icon">
          <img src={chatgptLogo} alt="" />
        </span>
        <span className="ob-provider-icon">
          <img src={claudeLogo} alt="" />
        </span>
      </span>
    )
  }
  // Local AI — monitor glyph
  return (
    <span className="ob-provider-icon local">
      <svg width="22" height="22" viewBox="0 0 24 24" fill="none" aria-hidden>
        <rect x="3" y="4" width="18" height="12" rx="1.5" stroke="#402B00" strokeWidth="1.8" />
        <path d="M9 20h6M12 16v4" stroke="#402B00" strokeWidth="1.8" strokeLinecap="round" />
      </svg>
    </span>
  )
}

function TallCard(props: {
  card: CardDef
  highlighted?: boolean
  onSelect: () => void
}): React.JSX.Element {
  const { card } = props
  return (
    <div className={`ob-tall-card${props.highlighted ? ' highlighted' : ''}`}>
      <div className="ob-tall-card-head">
        <CardIcon id={card.id} />
        <h3 className="ob-card-title">{card.title}</h3>
        <span className={`ob-badge ${card.badgeTone}`}>{card.badge}</span>
      </div>
      <div className="ob-card-features">
        {card.pros.map((p) => (
          <FeatureRow key={p} text={p} />
        ))}
        {card.caveats.map((c) => (
          <FeatureRow key={c} text={c} caveat />
        ))}
      </div>
      <button
        className="ob-primary-btn ob-card-select"
        disabled={card.disabled}
        onClick={props.onSelect}
      >
        {card.disabled ? 'Coming later' : 'Select'}
      </button>
    </div>
  )
}

function CompactCard(props: { card: CardDef; onSelect: () => void }): React.JSX.Element {
  const { card } = props
  return (
    <div className="ob-compact-card">
      <div className="ob-compact-head">
        <CardIcon id={card.id} />
        <h3 className="ob-card-title">{card.title}</h3>
        <span className={`ob-badge ${card.badgeTone}`}>{card.badge}</span>
      </div>
      <div className="ob-card-features compact">
        {card.pros.map((p) => (
          <FeatureRow key={p} text={p} />
        ))}
        {card.caveats.map((c) => (
          <FeatureRow key={c} text={c} caveat />
        ))}
      </div>
      <div className="ob-compact-select-row">
        <button
          className="ob-primary-btn ob-compact-select"
          disabled={card.disabled}
          onClick={props.onSelect}
        >
          {card.disabled ? 'Coming later' : 'Select'}
        </button>
      </div>
    </div>
  )
}

export default function ProviderChoiceStep(props: {
  onSelect: (provider: ProviderChoice) => void
}): React.JSX.Element {
  const [showAll, setShowAll] = useState(false)

  return (
    <div className="ob-step ob-provider-step">
      <h1 className="ob-serif-heading">Choose a way to run Dayflow</h1>
      {!showAll ? (
        <div className="ob-tall-cards">
          <TallCard card={GEMINI_CARD} highlighted onSelect={() => props.onSelect('gemini')} />
          <TallCard card={LOCAL_CARD} onSelect={() => props.onSelect('ollama')} />
        </div>
      ) : (
        <div className="ob-compact-grid">
          <CompactCard card={DAYFLOW_CARD} onSelect={() => undefined} />
          <CompactCard card={CHATGPT_CARD} onSelect={() => undefined} />
          <CompactCard card={GEMINI_CARD} onSelect={() => props.onSelect('gemini')} />
          <CompactCard card={LOCAL_CARD} onSelect={() => props.onSelect('ollama')} />
        </div>
      )}
      <div className="ob-step-spacer" />
      <button className="ob-chip ob-see-all" onClick={() => setShowAll((v) => !v)}>
        {showAll ? 'See recommendations only' : 'See all options'}
      </button>
    </div>
  )
}
