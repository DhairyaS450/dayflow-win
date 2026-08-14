// Chat view — Gemini function-calling chat over Dayflow activity data.
// Spec: docs/specs/ui-weekly-chat.md §3 (Chat sections).

import { useEffect, useRef, useState } from 'react'
import { api } from '../../lib/api'
import { useChatStore, type ChatMessage, type WorkStage } from './chatStore'
import Markdown from './Markdown'
import ChartBlock, { splitChartSegments } from './ChartBlock'
import './ChatView.css'

const CHAT_REQUIRED_BATCHES = 40 // 10h × four 15-min batches/hour

// Welcome prompts — verbatim (spec §3.3).
const WELCOME_PROMPTS: { icon: PromptIcon; text: string }[] = [
  { icon: 'doc', text: 'Generate standup notes for yesterday' },
  { icon: 'check', text: 'What did I get done last week?' },
  { icon: 'bubble', text: 'When was I most focused this week' },
  { icon: 'sparkles', text: 'Compare this week to last week' }
]

type PromptIcon = 'doc' | 'check' | 'bubble' | 'sparkles'

// ---------- Small inline icons (SF Symbol substitutes) ----------

function Icon(props: { name: string; size?: number; color?: string }): React.JSX.Element {
  const s = props.size ?? 12
  const c = props.color ?? 'currentColor'
  const common = {
    width: s,
    height: s,
    viewBox: '0 0 24 24',
    fill: 'none',
    stroke: c,
    strokeWidth: 2.4,
    strokeLinecap: 'round' as const,
    strokeLinejoin: 'round' as const
  }
  switch (props.name) {
    case 'doc':
      return (
        <svg {...common}>
          <path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8z" />
          <path d="M14 3v5h5" />
          <path d="M9 13h6M9 17h6" />
        </svg>
      )
    case 'check':
      return (
        <svg {...common}>
          <circle cx="12" cy="12" r="9" />
          <path d="M8.5 12.2l2.4 2.4 4.6-5" />
        </svg>
      )
    case 'bubble':
      return (
        <svg {...common}>
          <path d="M21 12a8 8 0 0 1-8 8H4l2.3-2.9A8 8 0 1 1 21 12z" />
          <path d="M12 8.5v3.5" />
          <path d="M12 15.4v.2" />
        </svg>
      )
    case 'sparkles':
      return (
        <svg {...common}>
          <path d="M12 4l1.7 4.3L18 10l-4.3 1.7L12 16l-1.7-4.3L6 10l4.3-1.7z" />
          <path d="M19 16l.8 2.2L22 19l-2.2.8L19 22l-.8-2.2L16 19l2.2-.8z" />
        </svg>
      )
    case 'arrow-up':
      return (
        <svg {...common}>
          <path d="M12 19V5" />
          <path d="M6 11l6-6 6 6" />
        </svg>
      )
    case 'arrow-up-right':
      return (
        <svg {...common}>
          <path d="M7 17L17 7" />
          <path d="M9 7h8v8" />
        </svg>
      )
    case 'check-fill':
      return (
        <svg {...common}>
          <circle cx="12" cy="12" r="9" fill={c} stroke="none" />
          <path d="M8.5 12.2l2.4 2.4 4.6-5" stroke="#ffffff" />
        </svg>
      )
    case 'x-fill':
      return (
        <svg {...common}>
          <circle cx="12" cy="12" r="9" fill={c} stroke="none" />
          <path d="M9 9l6 6M15 9l-6 6" stroke="#ffffff" />
        </svg>
      )
    case 'bolt':
      return (
        <svg {...common}>
          <circle cx="12" cy="12" r="9" />
          <path d="M12.8 7.5L9.5 12.6h3l-1.3 3.9 3.9-5.4h-3z" />
        </svg>
      )
    case 'copy':
      return (
        <svg {...common}>
          <rect x="9" y="9" width="11" height="11" rx="2" />
          <path d="M5 15V5a2 2 0 0 1 2-2h10" />
        </svg>
      )
    default:
      return <svg {...common} />
  }
}

// ---------- Gate helpers ----------

/** "0h / 10h", "45m / 10h", "3h / 10h", "3h 45m / 10h" */
function chatProgressText(batches: number): string {
  const minutes = Math.min(batches, CHAT_REQUIRED_BATCHES) * 15
  const h = Math.floor(minutes / 60)
  const m = minutes % 60
  let left: string
  if (minutes === 0) left = '0h'
  else if (h === 0) left = `${m}m`
  else if (m === 0) left = `${h}h`
  else left = `${h}h ${m}m`
  return `${left} / 10h`
}

interface GateState {
  batches: number
  accepted: boolean
  hasKey: boolean
}

// ---------- Root ----------

export default function ChatView(): React.JSX.Element {
  const [gate, setGate] = useState<GateState | null>(null)

  useEffect(() => {
    let cancelled = false
    const load = async (): Promise<void> => {
      const [batches, accepted, hasGeminiKey, hasCli] = await Promise.all([
        api.batches.completedCount(),
        api.settings.get<boolean>('chatBetaAccepted', false),
        api.secrets.exists('gemini'),
        api.providers.claudeCliInstalled().catch(() => false)
      ])
      if (!cancelled) setGate({ batches, accepted, hasKey: hasGeminiKey || hasCli })
    }
    void load()
    return () => {
      cancelled = true
    }
  }, [])

  if (gate === null) return <div className="chat-root" />

  const unlocked = gate.accepted && gate.batches >= CHAT_REQUIRED_BATCHES
  if (!unlocked) {
    return (
      <ChatLockScreen
        batches={gate.batches}
        hasKey={gate.hasKey}
        onUnlock={() => {
          void api.settings.set('chatBetaAccepted', true)
          setGate({ ...gate, accepted: true })
        }}
      />
    )
  }
  return <ChatMain hasKey={gate.hasKey} />
}

// ---------- Beta lock screen (spec §3.1) ----------

function ChatLockScreen(props: {
  batches: number
  hasKey: boolean
  onUnlock: () => void
}): React.JSX.Element {
  const hoursOk = props.batches >= CHAT_REQUIRED_BATCHES
  const ready = hoursOk && props.hasKey
  const buttonLabel = !hoursOk
    ? 'Keep recording to unlock'
    : !props.hasKey
      ? 'Configure a runtime to continue'
      : 'Unlock Beta'

  return (
    <div className="chat-lock-root">
      <div className="chat-lock-title-row">
        <span className="chat-lock-title">Unlock Beta</span>
        <span className="chat-lock-badge">BETA</span>
      </div>
      <p className="chat-lock-sub">
        Chat lets you ask questions about your Dayflow activity and get summaries, comparisons, and
        insights.
      </p>
      <p className="chat-lock-feedback">
        Please send feedback if you see any bugs or weird behavior!
      </p>
      <div className="chat-lock-card">
        <div className="chat-lock-status-icon">
          {ready ? (
            <Icon name="check-fill" size={32} color="#34C759" />
          ) : (
            <Icon name="bolt" size={32} color="#F98D3D" />
          )}
        </div>
        {!hoursOk ? (
          <>
            <div className="chat-lock-status-title">10 hours of timeline data required</div>
            <div className="chat-lock-status-sub">
              Chat unlocks after Dayflow has analyzed enough activity. {chatProgressText(props.batches)}
            </div>
          </>
        ) : props.hasKey ? (
          <div className="chat-lock-status-title chat-lock-status-ready">
            Gemini key or CLI runtime detected
          </div>
        ) : (
          <>
            <div className="chat-lock-status-title">Gemini API key or CLI required</div>
            <div className="chat-lock-status-sub">
              Unlock chat by either adding a Gemini API key in Settings or installing Codex/Claude
              CLI.
            </div>
          </>
        )}
        <button
          type="button"
          className={`chat-lock-button ${ready ? 'enabled' : 'disabled'}`}
          disabled={!ready}
          onClick={props.onUnlock}
        >
          {buttonLabel}
        </button>
      </div>
      <div className="chat-lock-privacy">
        <span className="chat-lock-privacy-title">Privacy Note</span>
        <span className="chat-lock-privacy-body">
          During the beta, your questions are logged to help improve the product. Responses are not
          logged, so your privacy is maintained.
        </span>
      </div>
    </div>
  )
}

// ---------- Chat main ----------

function ChatMain(props: { hasKey: boolean }): React.JSX.Element {
  const messages = useChatStore((s) => s.messages)
  const isProcessing = useChatStore((s) => s.isProcessing)
  const stage = useChatStore((s) => s.stage)
  const suggestions = useChatStore((s) => s.suggestions)
  const send = useChatStore((s) => s.send)
  const clear = useChatStore((s) => s.clear)
  const setDraft = useChatStore((s) => s.setDraft)

  const scrollRef = useRef<HTMLDivElement | null>(null)
  const inputRef = useRef<HTMLTextAreaElement | null>(null)

  useEffect(() => {
    const el = scrollRef.current
    if (el) el.scrollTo({ top: el.scrollHeight, behavior: 'smooth' })
  }, [messages, isProcessing, stage])

  return (
    <div className="chat-root">
      <div className="chat-header">
        {messages.length > 0 && (
          <button type="button" className="chat-clear" title="Clear chat" onClick={clear}>
            Clear
          </button>
        )}
      </div>
      <div className="chat-scroll" ref={scrollRef}>
        <div className="chat-messages">
          {messages.length === 0 && <WelcomeCard onPrompt={(p) => void send(p)} />}
          {messages.map((m) => (
            <MessageRow key={m.id} msg={m} />
          ))}
          {isProcessing && <WorkStatusCard stage={stage} />}
          {!isProcessing && suggestions.length > 0 && (
            <FollowUps
              items={suggestions}
              onPick={(s) => {
                setDraft(s)
                inputRef.current?.focus()
              }}
            />
          )}
        </div>
      </div>
      <Composer hasKey={props.hasKey} inputRef={inputRef} />
    </div>
  )
}

// ---------- Welcome card (spec §3.3) ----------

function WelcomeCard(props: { onPrompt: (text: string) => void }): React.JSX.Element {
  return (
    <div className="chat-welcome">
      <div className="chat-welcome-icon">
        <Icon name="bubble" size={18} color="#C9670D" />
      </div>
      <div className="chat-welcome-title">Ask about your Dayflow data</div>
      <div className="chat-welcome-sub">
        Ask questions, analyze your timeline, and generate charts/graphs.
      </div>
      <div className="chat-welcome-memory">
        I remember your response preferences, so feel free to teach me your style.
      </div>
      <div className="chat-welcome-try">Try one of these</div>
      <div className="chat-welcome-prompts">
        {WELCOME_PROMPTS.map((p, idx) => (
          <button
            key={p.text}
            type="button"
            className="chat-welcome-prompt"
            style={{ animationDelay: `${idx * 45}ms` }}
            onClick={() => props.onPrompt(p.text)}
          >
            <span className="chat-welcome-prompt-icon">
              <Icon name={p.icon} size={11} color="#C9670D" />
            </span>
            <span className="chat-welcome-prompt-text">{p.text}</span>
            <span className="chat-welcome-prompt-arrow">
              <Icon name="arrow-up-right" size={9} color="#D58A3D" />
            </span>
          </button>
        ))}
      </div>
    </div>
  )
}

// ---------- Message rows ----------

function MessageRow(props: { msg: ChatMessage }): React.JSX.Element {
  const { msg } = props
  if (msg.role === 'user') {
    return (
      <div className="chat-row chat-row-user">
        <div className="chat-bubble-user">{msg.content}</div>
      </div>
    )
  }
  if (msg.role === 'toolCall') {
    const state = msg.toolState ?? 'running'
    return (
      <div className="chat-row">
        <div className={`chat-tool ${state}`}>
          {state === 'running' && <span className="chat-tool-spinner" />}
          {state === 'completed' && <Icon name="check-fill" size={14} color="#34C759" />}
          {state === 'failed' && <Icon name="x-fill" size={14} color="#FF3B30" />}
          <span className="chat-tool-name">{msg.toolName}</span>
          <span className="chat-tool-text">{msg.content}</span>
        </div>
      </div>
    )
  }
  return <AssistantRow content={msg.content} />
}

function AssistantRow(props: { content: string }): React.JSX.Element {
  const [copied, setCopied] = useState(false)
  const segments = splitChartSegments(props.content)
  return (
    <div className="chat-row chat-row-assistant">
      <div className="chat-assistant-col">
        <div className="chat-bubble-assistant">
          {segments.map((seg, idx) =>
            seg.kind === 'text' ? (
              <Markdown key={idx} text={seg.text} />
            ) : (
              <ChartBlock key={idx} type={seg.type} payload={seg.payload} raw={seg.raw} />
            )
          )}
        </div>
        <div className="chat-assistant-footer">
          <button
            type="button"
            className="chat-copy-btn"
            title="Copy answer"
            onClick={() => {
              void api.timeline.copyToClipboard(props.content)
              setCopied(true)
              window.setTimeout(() => setCopied(false), 1600)
            }}
          >
            <Icon name="copy" size={11} color="#8F8F8F" />
          </button>
          {copied && <span className="chat-thanks">Copied</span>}
        </div>
      </div>
    </div>
  )
}

// ---------- Work status (thinking indicator, spec §3.6 simplified) ----------

function WorkStatusCard(props: { stage: WorkStage }): React.JSX.Element {
  const label =
    props.stage === 'runningTools'
      ? 'Running tools'
      : props.stage === 'answering'
        ? 'Answering'
        : 'Thinking'
  return (
    <div className="chat-row">
      <div className="chat-status-card">
        <Icon name="sparkles" size={12} color="#F96E00" />
        <span className="chat-status-label">
          {label}
          <span className="chat-ellipsis" />
        </span>
      </div>
    </div>
  )
}

// ---------- Follow-up suggestions (spec §3.7) ----------

function FollowUps(props: {
  items: string[]
  onPick: (text: string) => void
}): React.JSX.Element {
  return (
    <div className="chat-followups">
      <div className="chat-followups-title">Follow up</div>
      <div className="chat-followups-chips">
        {props.items.map((s) => (
          <button key={s} type="button" className="chat-followup-chip" onClick={() => props.onPick(s)}>
            {s}
          </button>
        ))}
      </div>
    </div>
  )
}

// ---------- Composer (spec §3.4) ----------

function Composer(props: {
  hasKey: boolean
  inputRef: React.RefObject<HTMLTextAreaElement | null>
}): React.JSX.Element {
  const draft = useChatStore((s) => s.draft)
  const setDraft = useChatStore((s) => s.setDraft)
  const isProcessing = useChatStore((s) => s.isProcessing)
  const send = useChatStore((s) => s.send)
  const [focused, setFocused] = useState(false)

  const canSend = draft.trim().length > 0 && !isProcessing && props.hasKey

  const submit = (): void => {
    if (!canSend) return
    void send(draft)
    const el = props.inputRef.current
    if (el) el.style.height = 'auto'
  }

  const autoGrow = (el: HTMLTextAreaElement): void => {
    el.style.height = 'auto'
    el.style.height = `${Math.min(el.scrollHeight, 120)}px`
  }

  return (
    <div className="chat-composer-outer">
      <div className={`chat-composer ${focused ? 'focused' : ''}`}>
        <textarea
          ref={props.inputRef}
          className="chat-input"
          rows={1}
          placeholder="Ask about your Dayflow data..."
          value={draft}
          onChange={(e) => {
            setDraft(e.target.value)
            autoGrow(e.target)
          }}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !e.shiftKey) {
              e.preventDefault()
              submit()
            }
          }}
          onFocus={() => setFocused(true)}
          onBlur={() => setFocused(false)}
        />
        <div className="chat-composer-divider" />
        <div className="chat-composer-toolbar">
          <div className="chat-provider-toggle">
            <span className="chat-provider-pill selected">Gemini</span>
            {!props.hasKey && (
              <span className="chat-provider-hint">Add a Gemini API key in Settings to chat</span>
            )}
          </div>
          <div className="chat-composer-right">
            {isProcessing && (
              <span className="chat-answering-pill">
                <span className="chat-mini-spinner" />
                Answering
              </span>
            )}
            <button
              type="button"
              className="chat-send"
              disabled={!canSend}
              onClick={submit}
              title="Send"
            >
              {isProcessing ? (
                <span className="chat-send-spinner" />
              ) : (
                <Icon name="arrow-up" size={12} color="#ffffff" />
              )}
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}
