import { useState } from 'react'
import { api } from '../../lib/api'
import { EyeIcon } from './ui'
import type { ProviderChoice } from './ProviderChoiceStep'

// Provider setup flow (LLMProviderSetupView port): sidebar of sub-steps +
// content column. Gemini path stores the API key in the credential vault;
// Local path persists llmLocalEngine/BaseURL/ModelId settings.

type LocalEngine = 'ollama' | 'lmstudio' | 'custom'

interface SetupStepDef {
  id: string
  title: string
}

const GEMINI_STEPS: SetupStepDef[] = [
  { id: 'getkey', title: 'Get API key' },
  { id: 'enterkey', title: 'Enter API key' },
  { id: 'verify', title: 'Test connection' },
  { id: 'complete', title: 'Complete' }
]

const LOCAL_STEPS: SetupStepDef[] = [
  { id: 'intro', title: 'Before you begin' },
  { id: 'choose', title: 'Choose engine' },
  { id: 'model', title: 'Install model' },
  { id: 'test', title: 'Test connection' },
  { id: 'complete', title: 'Complete' }
]

const ENGINE_DEFAULTS: Record<LocalEngine, { baseURL: string; modelId: string }> = {
  ollama: { baseURL: 'http://localhost:11434', modelId: 'qwen3-vl:4b' },
  lmstudio: { baseURL: 'http://localhost:1234', modelId: 'Qwen3-VL-4B-Instruct' },
  custom: { baseURL: 'http://localhost:11434', modelId: 'qwen3-vl:4b' }
}

interface TestState {
  status: 'idle' | 'testing' | 'ok' | 'failed'
  message: string
}

const IDLE_TEST: TestState = { status: 'idle', message: '' }

function isGeminiKeyValid(key: string): boolean {
  const k = key.trim()
  return k.startsWith('AIza') && k.length > 30
}

export default function ProviderSetupStep(props: {
  provider: ProviderChoice
  onBack: () => void
  onComplete: () => void
}): React.JSX.Element {
  const isGemini = props.provider === 'gemini'
  const steps = isGemini ? GEMINI_STEPS : LOCAL_STEPS
  const [stepIndex, setStepIndex] = useState(0)

  // Gemini state
  const [apiKey, setApiKey] = useState('')
  const [showKey, setShowKey] = useState(false)
  const [gemTest, setGemTest] = useState<TestState>(IDLE_TEST)

  // Local state
  const [engine, setEngine] = useState<LocalEngine>('lmstudio')
  const [baseUrl, setBaseUrl] = useState('')
  const [modelId, setModelId] = useState('')
  const [localApiKey, setLocalApiKey] = useState('')
  const [localTest, setLocalTest] = useState<TestState>(IDLE_TEST)

  const [copied, setCopied] = useState(false)
  const [saving, setSaving] = useState(false)

  const step = steps[stepIndex]
  const isLast = stepIndex === steps.length - 1
  const isTestStep = step.id === 'verify' || step.id === 'test'
  const testState = isGemini ? gemTest : localTest
  const testPassed = testState.status === 'ok'

  const canContinue = ((): boolean => {
    if (step.id === 'enterkey') return isGeminiKeyValid(apiKey)
    if (isTestStep) return testPassed
    return true
  })()

  const persistLocalSettings = async (): Promise<void> => {
    await api.settings.set('llmLocalEngine', engine)
    await api.settings.set('llmLocalBaseURL', baseUrl.trim() || undefined)
    await api.settings.set('llmLocalModelId', modelId.trim() || undefined)
    await api.settings.set('llmLocalAPIKey', localApiKey.trim() || undefined)
  }

  const leaveStep = (from: SetupStepDef, to: SetupStepDef): void => {
    // Leaving the API-key step persists the key; navigating to a test step
    // resets its test state (per spec).
    if (from.id === 'enterkey' && isGeminiKeyValid(apiKey)) {
      void api.secrets.store('gemini', apiKey.trim())
    }
    if (to.id === 'verify') setGemTest(IDLE_TEST)
    if (to.id === 'test') setLocalTest(IDLE_TEST)
  }

  const goTo = (index: number): void => {
    if (index === stepIndex || index < 0 || index >= steps.length) return
    leaveStep(steps[stepIndex], steps[index])
    setStepIndex(index)
  }

  const handleBack = (): void => {
    if (stepIndex === 0) props.onBack()
    else goTo(stepIndex - 1)
  }

  const completeSetup = async (): Promise<void> => {
    if (saving) return
    setSaving(true)
    try {
      if (isGemini) {
        if (isGeminiKeyValid(apiKey)) await api.secrets.store('gemini', apiKey.trim())
        await api.settings.set('selectedLLMProvider', 'gemini')
        await api.settings.set('geminiSetupComplete', true)
      } else {
        await persistLocalSettings()
        await api.settings.set('selectedLLMProvider', 'ollama')
        await api.settings.set('ollamaSetupComplete', true)
      }
      props.onComplete()
    } finally {
      setSaving(false)
    }
  }

  const handleContinue = (): void => {
    if (isLast) {
      void completeSetup()
    } else {
      goTo(stepIndex + 1)
    }
  }

  const runGeminiTest = async (): Promise<void> => {
    const key = apiKey.trim()
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

  const runLocalTest = async (): Promise<void> => {
    setLocalTest({ status: 'testing', message: '' })
    try {
      await persistLocalSettings()
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

  const copyCommand = (): void => {
    void api.timeline.copyToClipboard('ollama pull qwen3-vl:4b')
    setCopied(true)
    window.setTimeout(() => setCopied(false), 2000)
  }

  const chooseEngine = (e: LocalEngine): void => {
    setEngine(e)
    setLocalTest(IDLE_TEST)
    void api.settings.set('llmLocalEngine', e)
  }

  const continueLabel = isLast
    ? saving
      ? 'Saving…'
      : '✓ Complete Setup'
    : isTestStep && !testPassed
      ? 'Test Required'
      : 'Next ›'

  const testResultLine = (state: TestState): React.JSX.Element | null => {
    if (state.status === 'ok' || state.status === 'failed') {
      return (
        <div className={`ob-status-line ${state.status === 'ok' ? 'good' : 'bad'}`}>
          <span className="ob-status-dot" />
          {state.message}
        </div>
      )
    }
    return null
  }

  // ---------- per-step content ----------

  const renderGeminiContent = (): React.JSX.Element => {
    switch (step.id) {
      case 'getkey':
        return (
          <div className="ob-setup-block">
            <h3 className="ob-setup-heading">Get your Gemini API key</h3>
            <p className="ob-setup-sub">
              allows you to run Dayflow for free. All you need is a Google account - no credit card
              required.
            </p>
            <ol className="ob-setup-list">
              <li>
                Visit Google AI Studio{' '}
                <button
                  className="ob-inline-link"
                  onClick={() =>
                    void api.app.openExternal('https://aistudio.google.com/app/apikey')
                  }
                >
                  (aistudio.google.com)
                </button>
              </li>
              <li>Click &quot;Get API key&quot; in the top right</li>
              <li>Create a new API key and copy it</li>
            </ol>
            <button
              className="ob-secondary-btn"
              onClick={() => void api.app.openExternal('https://aistudio.google.com/app/apikey')}
            >
              Open Google AI Studio
            </button>
          </div>
        )
      case 'enterkey': {
        const valid = isGeminiKeyValid(apiKey)
        const showInvalid = apiKey.trim().length > 0 && !valid
        return (
          <div className="ob-setup-block">
            <h3 className="ob-setup-heading">Enter your API key:</h3>
            <p className="ob-setup-sub">Paste your Gemini API key below</p>
            <div
              className={`ob-key-row${valid ? ' valid' : ''}${showInvalid ? ' invalid' : ''}`}
            >
              <input
                className="ob-key-input"
                type={showKey ? 'text' : 'password'}
                placeholder="AIza..."
                value={apiKey}
                onChange={(e) => {
                  setApiKey(e.target.value)
                  setGemTest(IDLE_TEST)
                }}
                spellCheck={false}
              />
              <button
                className="ob-eye-btn"
                onClick={() => setShowKey((v) => !v)}
                title={showKey ? 'Hide key' : 'Show key'}
              >
                <EyeIcon off={showKey} />
              </button>
              {apiKey.trim().length > 0 && (
                <span className={`ob-key-mark${valid ? ' valid' : ' invalid'}`}>
                  {valid ? '✓' : '✕'}
                </span>
              )}
            </div>
            {showInvalid && (
              <p className="ob-key-error">
                API key should start with &apos;AIza&apos; and be at least 30 characters
              </p>
            )}
            <p className="ob-key-help">
              Your API key is encrypted and stored in Windows Credential Manager - never uploaded
              anywhere
            </p>
          </div>
        )
      }
      case 'verify':
        return (
          <div className="ob-setup-block">
            <h3 className="ob-setup-heading">Test Connection</h3>
            <p className="ob-setup-sub">
              Click the button below to verify your API key works with Gemini
            </p>
            <button
              className="ob-primary-btn ob-test-btn"
              disabled={gemTest.status === 'testing'}
              onClick={() => void runGeminiTest()}
            >
              {gemTest.status === 'testing' ? 'Testing…' : 'Test connection'}
            </button>
            {testResultLine(gemTest)}
          </div>
        )
      default:
        return (
          <div className="ob-setup-block">
            <h3 className="ob-setup-heading">All set!</h3>
            <p className="ob-setup-sub">
              Gemini is now configured and ready to use with Dayflow.
            </p>
          </div>
        )
    }
  }

  const renderLocalContent = (): React.JSX.Element => {
    switch (step.id) {
      case 'intro':
        return (
          <div className="ob-setup-block">
            <h3 className="ob-setup-heading">For experienced users</h3>
            <p className="ob-setup-sub">
              This path is recommended only if you&apos;re comfortable running LLMs locally and
              debugging technical issues. If terms like vLLM or API endpoint don&apos;t ring a bell,
              we recommend going back and picking Gemini. It&apos;s non-technical and takes about 30
              seconds.
            </p>
            <p className="ob-setup-sub">
              For local mode, Dayflow recommends Qwen3-VL 4B as the core vision-language model
              (Qwen2.5-VL 3B remains available if you need a smaller download).
            </p>
            <p className="ob-setup-sub">
              Advanced users can pick any <strong>vision-capable</strong> LLM, but we strongly
              recommend using Qwen3-VL 4B based on our internal benchmarks.
            </p>
          </div>
        )
      case 'choose':
        return (
          <div className="ob-setup-block">
            <h3 className="ob-setup-heading">Choose your local AI engine</h3>
            <p className="ob-setup-sub">
              For local use, LM Studio is the most reliable; Ollama has a known thinking bug in
              onboarding (can&apos;t turn thinking off) and performance is unreliable.
            </p>
            <div className="ob-segmented">
              {(['lmstudio', 'ollama', 'custom'] as LocalEngine[]).map((e) => (
                <button
                  key={e}
                  className={`ob-segment${engine === e ? ' selected' : ''}`}
                  onClick={() => chooseEngine(e)}
                >
                  {e === 'lmstudio' ? 'LM Studio' : e === 'ollama' ? 'Ollama' : 'Custom'}
                </button>
              ))}
            </div>
            <button
              className="ob-secondary-btn"
              onClick={() => {
                chooseEngine('lmstudio')
                void api.app.openExternal('https://lmstudio.ai/')
              }}
            >
              Download LM Studio
            </button>
            <p className="ob-setup-footnote">
              Already have a local server? Make sure it&apos;s OpenAI-compatible. You can set a
              custom base URL in the next step.
            </p>
          </div>
        )
      case 'model':
        if (engine === 'ollama') {
          return (
            <div className="ob-setup-block">
              <h3 className="ob-setup-heading">Install Qwen3-VL 4B</h3>
              <p className="ob-setup-sub">
                After installing Ollama, run this in your terminal to download the model (≈5GB):
              </p>
              <div className="ob-terminal">
                <div className="ob-terminal-titles">
                  <span className="ob-terminal-title">Run this command:</span>
                  <span className="ob-terminal-sub">Downloads Qwen3 Vision 4B for Ollama</span>
                </div>
                <div className="ob-terminal-cmd-row">
                  <code className="ob-terminal-cmd selectable">ollama pull qwen3-vl:4b</code>
                  <button
                    className={`ob-copy-btn${copied ? ' copied' : ''}`}
                    onClick={copyCommand}
                  >
                    {copied ? '✓ Copied' : 'Copy'}
                  </button>
                </div>
              </div>
            </div>
          )
        }
        if (engine === 'lmstudio') {
          return (
            <div className="ob-setup-block">
              <h3 className="ob-setup-heading">Install Qwen3-VL 4B</h3>
              <p className="ob-setup-sub">
                After installing LM Studio, download the recommended model:
              </p>
              <button
                className="ob-secondary-btn"
                onClick={() =>
                  void api.app.openExternal(
                    'https://model.lmstudio.ai/download/lmstudio-community/Qwen3-VL-4B-Instruct-GGUF'
                  )
                }
              >
                Download Qwen3-VL 4B in LM Studio
              </button>
              <p className="ob-setup-footnote">
                This will open LM Studio and prompt you to download the model (≈3GB).
              </p>
              <p className="ob-setup-footnote">
                Once downloaded, turn on &apos;Local Server&apos; in LM Studio (default
                http://localhost:1234)
              </p>
              <p className="ob-setup-footnote">
                Manual setup:
                <br />
                1. Open LM Studio → Models tab
                <br />
                2. Search for &apos;Qwen3-VL-4B&apos; and install the Instruct variant
              </p>
            </div>
          )
        }
        return (
          <div className="ob-setup-block">
            <h3 className="ob-setup-heading">Use any OpenAI-compatible VLM</h3>
            <p className="ob-setup-sub">
              Make sure your server exposes the OpenAI Chat Completions API and has Qwen3-VL 4B (or
              Qwen2.5-VL 3B if you need the legacy model) installed.
            </p>
          </div>
        )
      case 'test':
        return (
          <div className="ob-setup-block">
            <h3 className="ob-setup-heading">Test Connection</h3>
            <p className="ob-setup-sub">
              Click the button below to verify your local server responds to a simple chat
              completion.
            </p>
            <label className="ob-field-label">Which tool are you using?</label>
            <div className="ob-segmented" style={{ maxWidth: 380 }}>
              {(['lmstudio', 'ollama', 'custom'] as LocalEngine[]).map((e) => (
                <button
                  key={e}
                  className={`ob-segment${engine === e ? ' selected' : ''}`}
                  onClick={() => chooseEngine(e)}
                >
                  {e === 'lmstudio' ? 'LM Studio' : e === 'ollama' ? 'Ollama' : 'Custom model'}
                </button>
              ))}
            </div>
            <label className="ob-field-label">Base URL</label>
            <input
              className="ob-text-field wide"
              placeholder={ENGINE_DEFAULTS[engine].baseURL}
              value={baseUrl}
              onChange={(e) => {
                setBaseUrl(e.target.value)
                setLocalTest(IDLE_TEST)
              }}
              spellCheck={false}
            />
            <label className="ob-field-label">Model ID</label>
            <input
              className="ob-text-field wide"
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
                <label className="ob-field-label">API key (optional)</label>
                <input
                  className="ob-text-field wide"
                  type="password"
                  placeholder="sk-live-..."
                  value={localApiKey}
                  onChange={(e) => setLocalApiKey(e.target.value)}
                  spellCheck={false}
                />
                <p className="ob-setup-footnote">
                  Stored locally in settings and sent as a Bearer token for custom endpoints
                  (LiteLLM, OpenRouter, etc.)
                </p>
              </>
            )}
            <button
              className="ob-primary-btn ob-test-btn"
              disabled={localTest.status === 'testing'}
              onClick={() => void runLocalTest()}
            >
              {localTest.status === 'testing' ? 'Testing…' : 'Test Local API'}
            </button>
            {testResultLine(localTest)}
          </div>
        )
      default:
        return (
          <div className="ob-setup-block">
            <h3 className="ob-setup-heading">All set!</h3>
            <p className="ob-setup-sub">
              Local AI is configured and ready to use with Dayflow.
            </p>
          </div>
        )
    }
  }

  return (
    <div className="ob-step ob-setup-step">
      <div className="ob-setup-chrome">
        <button className="ob-back-link" onClick={handleBack}>
          ‹ Back
        </button>
        <h2 className="ob-setup-title">{isGemini ? 'Gemini' : 'Use local AI'}</h2>
      </div>
      <div className="ob-setup-body">
        <nav className="ob-setup-sidebar">
          {steps.map((s, i) => {
            const state = i === stepIndex ? 'current' : i < stepIndex ? 'done' : 'todo'
            return (
              <button
                key={s.id}
                className={`ob-sidebar-item ${state}`}
                onClick={() => goTo(i)}
              >
                <span className="ob-sidebar-indicator">
                  {state === 'done' ? '✓' : state === 'current' ? '›' : ''}
                </span>
                {s.title}
              </button>
            )
          })}
        </nav>
        <div className="ob-setup-content">
          {isGemini ? renderGeminiContent() : renderLocalContent()}
          <div className="ob-setup-continue-row">
            <button
              className="ob-primary-btn"
              disabled={!canContinue || saving}
              onClick={handleContinue}
            >
              {continueLabel}
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}
