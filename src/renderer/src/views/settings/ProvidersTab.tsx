import { useEffect, useState } from 'react'
import { api } from '../../lib/api'
import {
  Section,
  Row,
  PrimaryButton,
  SecondaryButton,
  StatusDot,
  Badge,
  Metadata,
  Toggle,
  Segmented
} from './SettingsUI'
import {
  GEMINI_TITLE_DEFAULT,
  GEMINI_SUMMARY_DEFAULT,
  GEMINI_DETAILED_DEFAULT,
  OLLAMA_SUMMARY_DEFAULT,
  OLLAMA_TITLE_DEFAULT
} from './promptDefaults'

// Settings → Providers: current provider, switching, Gemini key + test,
// local engine config + test, and prompt-override editors.

type ProviderId = 'gemini' | 'ollama' | 'chatgpt_claude'
type LocalEngine = 'ollama' | 'lmstudio' | 'custom'

const ENGINE_DEFAULTS: Record<LocalEngine, { baseURL: string; modelId: string }> = {
  ollama: { baseURL: 'http://localhost:11434', modelId: 'qwen3-vl:4b' },
  lmstudio: { baseURL: 'http://localhost:1234', modelId: 'Qwen3-VL-4B-Instruct' },
  custom: { baseURL: 'http://localhost:11434', modelId: 'qwen3-vl:4b' }
}

const ENGINE_LABELS: Record<LocalEngine, string> = {
  ollama: 'Ollama',
  lmstudio: 'LM Studio',
  custom: 'Custom'
}

interface TestState {
  status: 'idle' | 'testing' | 'ok' | 'failed'
  message: string
}

const IDLE_TEST: TestState = { status: 'idle', message: '' }

interface GeminiOverrides {
  titleBlock?: string
  summaryBlock?: string
  detailedBlock?: string
}

interface OllamaOverrides {
  summaryBlock?: string
  titleBlock?: string
}

function TestResult(props: { state: TestState }): React.JSX.Element | null {
  if (props.state.status === 'ok') return <StatusDot state="good" label={props.state.message} />
  if (props.state.status === 'failed') return <StatusDot state="bad" label={props.state.message} />
  return null
}

// ---------- Prompt override block ----------

function PromptBlock(props: {
  heading: string
  description: string
  value: string | undefined
  defaultText: string
  onChange: (value: string | undefined) => void
}): React.JSX.Element {
  const [enabled, setEnabled] = useState<boolean>(
    () => props.value !== undefined && props.value.trim().length > 0
  )
  const [text, setText] = useState<string>(props.value ?? '')

  const commit = (nextEnabled: boolean, nextText: string): void => {
    props.onChange(nextEnabled && nextText.trim().length > 0 ? nextText : undefined)
  }

  return (
    <div className={`st-prompt-block${enabled ? '' : ' disabled'}`}>
      <div className="st-prompt-head">
        <div className="st-prompt-titles">
          <span className="st-prompt-heading">{props.heading}</span>
          <span className="st-prompt-desc">{props.description}</span>
        </div>
        <Toggle
          checked={enabled}
          onChange={(v) => {
            setEnabled(v)
            commit(v, text)
          }}
        />
      </div>
      <textarea
        className="st-prompt-editor"
        value={text}
        placeholder={props.defaultText}
        disabled={!enabled}
        onChange={(e) => setText(e.target.value)}
        onBlur={() => commit(enabled, text)}
        spellCheck={false}
      />
    </div>
  )
}

export default function ProvidersTab(): React.JSX.Element {
  const [loaded, setLoaded] = useState(false)
  const [provider, setProvider] = useState<ProviderId>('gemini')

  // Gemini
  const [keyStored, setKeyStored] = useState(false)
  const [keyInput, setKeyInput] = useState('')
  const [showKey, setShowKey] = useState(false)
  const [keySaved, setKeySaved] = useState(false)
  const [gemTest, setGemTest] = useState<TestState>(IDLE_TEST)

  // Local
  const [engine, setEngine] = useState<LocalEngine>('ollama')
  const [claudeTest, setClaudeTest] = useState<TestState>(IDLE_TEST)
  const [baseUrl, setBaseUrl] = useState('')
  const [modelId, setModelId] = useState('')
  const [localKey, setLocalKey] = useState('')
  const [localTest, setLocalTest] = useState<TestState>(IDLE_TEST)
  const [localSaved, setLocalSaved] = useState(false)

  // Prompt overrides
  const [geminiOverrides, setGeminiOverrides] = useState<GeminiOverrides>({})
  const [ollamaOverrides, setOllamaOverrides] = useState<OllamaOverrides>({})
  const [overridesVersion, setOverridesVersion] = useState(0)

  useEffect(() => {
    void (async () => {
      const [current, stored, eng, base, model, lkey, gOv, oOv] = await Promise.all([
        api.providers.current(),
        api.secrets.exists('gemini'),
        api.settings.get<LocalEngine>('llmLocalEngine', 'ollama'),
        api.settings.get<string>('llmLocalBaseURL', ''),
        api.settings.get<string>('llmLocalModelId', ''),
        api.settings.get<string>('llmLocalAPIKey', ''),
        api.settings.get<GeminiOverrides>('geminiPromptOverrides', {}),
        api.settings.get<OllamaOverrides>('ollamaPromptOverrides', {})
      ])
      setProvider(
        current === 'ollama' ? 'ollama' : current === 'chatgpt_claude' ? 'chatgpt_claude' : 'gemini'
      )
      setKeyStored(stored)
      setEngine(eng)
      setBaseUrl(base)
      setModelId(model)
      setLocalKey(lkey)
      setGeminiOverrides(gOv ?? {})
      setOllamaOverrides(oOv ?? {})
      setOverridesVersion((v) => v + 1)
      setLoaded(true)
    })()
  }, [])

  const switchProvider = (id: ProviderId): void => {
    setProvider(id)
    void api.settings.set('selectedLLMProvider', id)
    if (id === 'chatgpt_claude') void api.settings.set('chatCLIPreferredTool', 'claude')
  }

  const keyValid = keyInput.trim().startsWith('AIza') && keyInput.trim().length > 30

  const saveGeminiKey = async (): Promise<void> => {
    if (!keyValid) return
    await api.secrets.store('gemini', keyInput.trim())
    setKeyStored(true)
    setKeySaved(true)
    window.setTimeout(() => setKeySaved(false), 2000)
  }

  const runGeminiTest = async (): Promise<void> => {
    const key = keyInput.trim()
    if (!key) {
      setGemTest({ status: 'failed', message: 'No API key found. Enter your API key first.' })
      return
    }
    setGemTest({ status: 'testing', message: '' })
    try {
      const res = await api.providers.testGemini(key)
      setGemTest(
        res.ok
          ? { status: 'ok', message: 'Connection successful.' }
          : { status: 'failed', message: res.message || 'Connection failed.' }
      )
    } catch (err) {
      setGemTest({ status: 'failed', message: err instanceof Error ? err.message : String(err) })
    }
  }

  const persistLocal = async (): Promise<void> => {
    await api.settings.set('llmLocalEngine', engine)
    await api.settings.set('llmLocalBaseURL', baseUrl.trim() || undefined)
    await api.settings.set('llmLocalModelId', modelId.trim() || undefined)
    await api.settings.set('llmLocalAPIKey', localKey.trim() || undefined)
  }

  const saveLocal = async (): Promise<void> => {
    await persistLocal()
    setLocalSaved(true)
    window.setTimeout(() => setLocalSaved(false), 2000)
  }

  const runLocalTest = async (): Promise<void> => {
    setLocalTest({ status: 'testing', message: '' })
    try {
      await persistLocal()
      const res = await api.providers.testLocal()
      setLocalTest(
        res.ok
          ? { status: 'ok', message: 'Test successful.' }
          : { status: 'failed', message: res.message || 'Test failed.' }
      )
    } catch (err) {
      setLocalTest({ status: 'failed', message: err instanceof Error ? err.message : String(err) })
    }
  }

  const updateGeminiOverrides = (patch: Partial<GeminiOverrides>): void => {
    setGeminiOverrides((prev) => {
      const next: GeminiOverrides = { ...prev, ...patch }
      for (const k of Object.keys(next) as (keyof GeminiOverrides)[]) {
        if (next[k] === undefined) delete next[k]
      }
      void api.settings.set('geminiPromptOverrides', next)
      return next
    })
  }

  const updateOllamaOverrides = (patch: Partial<OllamaOverrides>): void => {
    setOllamaOverrides((prev) => {
      const next: OllamaOverrides = { ...prev, ...patch }
      for (const k of Object.keys(next) as (keyof OllamaOverrides)[]) {
        if (next[k] === undefined) delete next[k]
      }
      void api.settings.set('ollamaPromptOverrides', next)
      return next
    })
  }

  const resetOverrides = (): void => {
    if (provider === 'gemini') {
      setGeminiOverrides({})
      void api.settings.set('geminiPromptOverrides', {})
    } else {
      setOllamaOverrides({})
      void api.settings.set('ollamaPromptOverrides', {})
    }
    setOverridesVersion((v) => v + 1)
  }

  if (!loaded) return <div />

  return (
    <div className="st-tab">
      <Section title="Current configuration" subtitle="Active provider and runtime details.">
        <Row label="Primary provider">
          <span className="st-value">
            {provider === 'gemini'
              ? 'Google Gemini'
              : provider === 'chatgpt_claude'
                ? 'Claude (subscription)'
                : 'Local AI'}
          </span>
          <Badge>PRIMARY</Badge>
        </Row>
        <Row
          label="Switch provider"
          subtitle="Which AI engine Dayflow uses to build your timeline."
          divider={provider !== 'ollama'}
        >
          <Segmented<ProviderId>
            options={[
              { value: 'gemini', label: 'Gemini' },
              { value: 'chatgpt_claude', label: 'Claude' },
              { value: 'ollama', label: 'Local' }
            ]}
            value={provider}
            onChange={switchProvider}
          />
        </Row>
        {provider === 'ollama' && (
          <>
            <Row label="Engine">
              <Metadata>{ENGINE_LABELS[engine]}</Metadata>
            </Row>
            <Row label="Model">
              <Metadata>{modelId.trim() || ENGINE_DEFAULTS[engine].modelId}</Metadata>
            </Row>
            <Row label="Endpoint" divider={false}>
              <Metadata>{baseUrl.trim() || ENGINE_DEFAULTS[engine].baseURL}</Metadata>
            </Row>
          </>
        )}
      </Section>

      <Section
        title="Gemini API key"
        subtitle="Stored in Windows Credential Manager — never uploaded anywhere."
      >
        <Row label="API key">
          {keyStored ? (
            <StatusDot state="good" label="Stored in Windows Credential Manager" />
          ) : (
            <StatusDot state="idle" label="Not set" />
          )}
        </Row>
        <div className="st-key-edit">
          <div className="st-key-row">
            <input
              className="st-key-input"
              type={showKey ? 'text' : 'password'}
              placeholder="AIza..."
              value={keyInput}
              onChange={(e) => {
                setKeyInput(e.target.value)
                setGemTest(IDLE_TEST)
              }}
              spellCheck={false}
            />
            <button className="st-key-eye" onClick={() => setShowKey((v) => !v)}>
              {showKey ? 'Hide' : 'Show'}
            </button>
          </div>
          <div className="st-inline-actions">
            <PrimaryButton
              label={keySaved ? 'Saved ✓' : 'Save key'}
              disabled={!keyValid}
              onClick={() => void saveGeminiKey()}
            />
            <SecondaryButton
              label={gemTest.status === 'testing' ? 'Testing…' : 'Test connection'}
              disabled={gemTest.status === 'testing'}
              onClick={() => void runGeminiTest()}
            />
            <TestResult state={gemTest} />
          </div>
          {keyInput.trim().length > 0 && !keyValid && (
            <p className="st-error-text">
              API key should start with &apos;AIza&apos; and be at least 30 characters
            </p>
          )}
        </div>
      </Section>

      <Section
        title="Claude subscription"
        subtitle="Runs through the Claude Code CLI signed in with your Claude account — no API key stored."
      >
        <Row label="How it works" subtitle="Install Claude Code, run `claude` once to sign in, then select Claude as your provider above.">
          <SecondaryButton
            label={claudeTest.status === 'testing' ? 'Testing…' : 'Test Claude CLI'}
            disabled={claudeTest.status === 'testing'}
            onClick={() =>
              void (async () => {
                setClaudeTest({ status: 'testing', message: '' })
                try {
                  const res = await api.providers.testClaudeCli()
                  setClaudeTest(
                    res.ok
                      ? { status: 'ok', message: 'Connected — subscription ready.' }
                      : { status: 'failed', message: res.message || 'Test failed.' }
                  )
                } catch (err) {
                  setClaudeTest({
                    status: 'failed',
                    message: err instanceof Error ? err.message : String(err)
                  })
                }
              })()
            }
          />
        </Row>
        <div className="st-inline-actions">
          <TestResult state={claudeTest} />
        </div>
      </Section>

      <Section
        title="Local engine"
        subtitle="Point Dayflow at an OpenAI-compatible local server (LM Studio, Ollama, or custom)."
      >
        <Row label="Engine">
          <Segmented<LocalEngine>
            options={[
              { value: 'ollama', label: 'Ollama' },
              { value: 'lmstudio', label: 'LM Studio' },
              { value: 'custom', label: 'Custom' }
            ]}
            value={engine}
            onChange={(e) => {
              setEngine(e)
              setLocalTest(IDLE_TEST)
            }}
          />
        </Row>
        <div className="st-field-grid">
          <label className="st-field-label">Base URL</label>
          <input
            className="st-field-input"
            placeholder={ENGINE_DEFAULTS[engine].baseURL}
            value={baseUrl}
            onChange={(e) => {
              setBaseUrl(e.target.value)
              setLocalTest(IDLE_TEST)
            }}
            spellCheck={false}
          />
          <label className="st-field-label">Model ID</label>
          <input
            className="st-field-input"
            placeholder={ENGINE_DEFAULTS[engine].modelId}
            value={modelId}
            onChange={(e) => {
              setModelId(e.target.value)
              setLocalTest(IDLE_TEST)
            }}
            spellCheck={false}
          />
          {engine === 'custom' && (
            <>
              <label className="st-field-label">API key (optional)</label>
              <input
                className="st-field-input"
                type="password"
                placeholder="sk-live-..."
                value={localKey}
                onChange={(e) => setLocalKey(e.target.value)}
                spellCheck={false}
              />
            </>
          )}
        </div>
        <div className="st-inline-actions">
          <PrimaryButton
            label={localSaved ? 'Saved ✓' : 'Save'}
            onClick={() => void saveLocal()}
          />
          <SecondaryButton
            label={localTest.status === 'testing' ? 'Testing…' : 'Test Local API'}
            disabled={localTest.status === 'testing'}
            onClick={() => void runLocalTest()}
          />
          <TestResult state={localTest} />
        </div>
      </Section>

      <Section
        title={
          provider === 'gemini' ? 'Gemini prompt customization' : 'Local prompt customization'
        }
        subtitle={
          provider === 'gemini'
            ? "Override Dayflow's defaults to tailor card generation."
            : 'Adjust the prompts used for local timeline summaries.'
        }
      >
        <p className="st-intro-text">
          {provider === 'gemini'
            ? "Overrides apply only when their toggle is on. Unchecked sections fall back to Dayflow's defaults."
            : 'Customize the local model prompts for summary and title generation.'}
        </p>
        {provider === 'gemini' ? (
          <div key={`g${overridesVersion}`} className="st-prompt-blocks">
            <PromptBlock
              heading="Card titles"
              description="Shape how card titles read and tweak the example list."
              value={geminiOverrides.titleBlock}
              defaultText={GEMINI_TITLE_DEFAULT}
              onChange={(v) => updateGeminiOverrides({ titleBlock: v })}
            />
            <PromptBlock
              heading="Card summaries"
              description="Control tone and style for the summary field."
              value={geminiOverrides.summaryBlock}
              defaultText={GEMINI_SUMMARY_DEFAULT}
              onChange={(v) => updateGeminiOverrides({ summaryBlock: v })}
            />
            <PromptBlock
              heading="Detailed summaries"
              description="Define the minute-by-minute breakdown format and examples."
              value={geminiOverrides.detailedBlock}
              defaultText={GEMINI_DETAILED_DEFAULT}
              onChange={(v) => updateGeminiOverrides({ detailedBlock: v })}
            />
          </div>
        ) : (
          <div key={`o${overridesVersion}`} className="st-prompt-blocks">
            <PromptBlock
              heading="Timeline summaries"
              description="Control how the local model writes its 2-3 sentence card summaries."
              value={ollamaOverrides.summaryBlock}
              defaultText={OLLAMA_SUMMARY_DEFAULT}
              onChange={(v) => updateOllamaOverrides({ summaryBlock: v })}
            />
            <PromptBlock
              heading="Card titles"
              description="Adjust the tone and examples for local title generation."
              value={ollamaOverrides.titleBlock}
              defaultText={OLLAMA_TITLE_DEFAULT}
              onChange={(v) => updateOllamaOverrides({ titleBlock: v })}
            />
          </div>
        )}
        <div className="st-reset-row">
          <SecondaryButton label="↺ Reset to Dayflow defaults" onClick={resetOverrides} />
        </div>
      </Section>
    </div>
  )
}
