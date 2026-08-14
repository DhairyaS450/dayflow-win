// Daily (standup) view — spec §2. Gated behind 5 analyzed hours; on Windows the
// macOS notification-permission step is treated as granted (intro → provider).

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useStore } from '../../state/store'
import { api } from '../../lib/api'
import { addDays, dayStart, logicalDayString } from '../../lib/time'
import {
  DAILY_PROVIDER_SETTING_KEY,
  DAILY_PROVIDERS,
  DAILY_REQUIRED_BATCHES,
  DAILY_UNLOCKED_SETTING_KEY,
  computeDailyWorkflow,
  dailyDateTitle,
  decodeStandupPayload,
  encodeStandupPayload,
  highlightsTitleFor,
  makeDefaultDraft,
  makeInsufficientHistoryDraft,
  makeNoProviderDraft,
  makeRecapPrompt,
  parseRecapResponse,
  providerAvailability,
  providerCanGenerate,
  providerMeta,
  standupClipboardText,
  tasksTitleFor,
  uid,
  type DailyRecapProviderId,
  type DailyStandupDraft,
  type ProviderAvailabilityMap
} from './dailyModel'
import DailyLock from './DailyLock'
import WorkflowSection from './WorkflowSection'
import ActionRow, { type RegenState } from './ActionRow'
import StandupSection from './StandupSection'
import GoalSection from './GoalSection'
import leftArrow from '../../assets/images/LeftArrow.png'
import rightArrow from '../../assets/images/RightArrow.png'
import './DailyView.css'

/** Canonical content string used to detect pristine (unedited) placeholder drafts. */
function canon(d: DailyStandupDraft): string {
  return JSON.stringify([
    d.highlightsTitle,
    d.highlights.map((i) => i.text),
    d.tasksTitle,
    d.tasks.map((i) => i.text),
    d.blockersTitle,
    d.blockersBody
  ])
}

export default function DailyView(): React.JSX.Element {
  const selectedDay = useStore((s) => s.selectedDay)
  const setSelectedDay = useStore((s) => s.setSelectedDay)
  const cards = useStore((s) => s.cards)
  const categories = useStore((s) => s.categories)

  const [unlocked, setUnlocked] = useState<boolean | null>(null)
  const [completed, setCompleted] = useState(0)
  const [lockStep, setLockStep] = useState<'intro' | 'provider'>('intro')
  const [provider, setProviderState] = useState<DailyRecapProviderId>('none')
  const [providerLoaded, setProviderLoaded] = useState(false)
  const [availability, setAvailability] = useState<ProviderAvailabilityMap | null>(null)
  const [availabilityLoading, setAvailabilityLoading] = useState(false)
  const [draft, setDraft] = useState<DailyStandupDraft | null>(null)
  const [hasEntry, setHasEntry] = useState(false)
  const [regenState, setRegenState] = useState<RegenState>('idle')
  const [refreshTick, setRefreshTick] = useState(0)

  const requestSeq = useRef(0)
  const saveTimer = useRef<number | null>(null)
  const loadedDayRef = useRef<string | null>(null)
  const lastPayloadRef = useRef<string | null>(null)
  const pristineRef = useRef<string | null>(null)
  const draftRef = useRef<DailyStandupDraft | null>(null)
  const hasEntryRef = useRef(false)
  const selectedDayRef = useRef(selectedDay)
  const mainProviderRef = useRef<string | null>(null)

  useEffect(() => {
    draftRef.current = draft
  }, [draft])
  useEffect(() => {
    hasEntryRef.current = hasEntry
  }, [hasEntry])
  useEffect(() => {
    // Day changed: cancel any in-flight regeneration feedback.
    selectedDayRef.current = selectedDay
    setRegenState('idle')
  }, [selectedDay])

  const refreshCompleted = useCallback(async (): Promise<void> => {
    try {
      setCompleted(await api.batches.completedCount())
    } catch {
      /* ignore */
    }
  }, [])

  const refreshAvailability = useCallback(async (): Promise<void> => {
    setAvailabilityLoading(true)
    const winUnavailable = { isAvailable: false, detail: 'Not available in the Windows port yet.' }
    const map: ProviderAvailabilityMap = {
      dayflow: winUnavailable,
      claude: winUnavailable,
      chatgpt: winUnavailable,
      none: { isAvailable: true, detail: providerMeta('none').pickerSubtitle }
    }
    try {
      const hasGemini = await api.secrets.exists('gemini')
      map.gemini = hasGemini
        ? { isAvailable: true, detail: providerMeta('gemini').pickerSubtitle }
        : { isAvailable: false, detail: 'Add a Gemini API key in Settings to use this provider.' }
    } catch {
      map.gemini = {
        isAvailable: false,
        detail: 'Add a Gemini API key in Settings to use this provider.'
      }
    }
    try {
      const local = await api.providers.testLocal()
      map.local = local.ok
        ? { isAvailable: true, detail: providerMeta('local').pickerSubtitle }
        : { isAvailable: false, detail: local.message || 'Local server is not reachable.' }
    } catch {
      map.local = { isAvailable: false, detail: 'Local server is not reachable.' }
    }
    setAvailability(map)
    setAvailabilityLoading(false)
  }, [])

  // Initial load: persisted flags, provider, batch count, availability.
  useEffect(() => {
    let cancelled = false
    void (async () => {
      const [u, p, main] = await Promise.all([
        api.settings.get<boolean>(DAILY_UNLOCKED_SETTING_KEY, false),
        api.settings.get<string>(DAILY_PROVIDER_SETTING_KEY, ''),
        api.providers.current().catch(() => '')
      ])
      if (cancelled) return
      mainProviderRef.current = main || null
      const known = DAILY_PROVIDERS.map((x) => x.id) as string[]
      const prov: DailyRecapProviderId = known.includes(p)
        ? (p as DailyRecapProviderId)
        : main === 'gemini'
          ? 'gemini'
          : main === 'ollama'
            ? 'local'
            : 'none'
      setProviderState(prov)
      setProviderLoaded(true)
      setUnlocked(u)
    })()
    void refreshCompleted()
    void refreshAvailability()
    const t = window.setInterval(() => void refreshCompleted(), 30_000)
    return () => {
      cancelled = true
      window.clearInterval(t)
    }
  }, [refreshCompleted, refreshAvailability])

  useEffect(() => {
    if (unlocked === false) setLockStep('intro')
  }, [unlocked])

  useEffect(() => {
    const off = api.on('timeline:changed', () => setRefreshTick((t) => t + 1))
    return off
  }, [])

  const workflow = useMemo(() => computeDailyWorkflow(cards, categories), [cards, categories])

  // ----- Standup source-day resolution (§2.8.4) -----

  const minutesForDay = useCallback(async (day: string): Promise<number> => {
    const start = dayStart(day)
    const end = new Date(start.getTime() + 24 * 3600 * 1000)
    return api.timeline.minutesTracked(
      Math.floor(start.getTime() / 1000),
      Math.floor(end.getTime() / 1000)
    )
  }, [])

  const resolveSourceDay = useCallback(
    async (targetDay: string): Promise<string | null> => {
      const consumed = new Set<string>()
      try {
        const recents = await api.standup.recent(60, targetDay)
        for (const e of recents) {
          const d = decodeStandupPayload(e.payloadJSON)
          const sd = d?.generation?.sourceDay
          if (sd) consumed.add(sd)
        }
      } catch {
        /* ignore */
      }
      for (let i = 1; i <= 3; i++) {
        const candidate = addDays(targetDay, -i)
        if (consumed.has(candidate)) continue
        try {
          if ((await minutesForDay(candidate)) >= 120) return candidate
        } catch {
          /* ignore */
        }
      }
      return null
    },
    [minutesForDay]
  )

  // ----- Draft loading (§2.8.3) -----

  useEffect(() => {
    if (unlocked !== true || !providerLoaded) return
    const seq = ++requestSeq.current
    const day = selectedDay
    void (async () => {
      const source = await resolveSourceDay(day)
      const entry = await api.standup.fetch(day)
      if (seq !== requestSeq.current || selectedDayRef.current !== day) return
      setHasEntry(entry !== null)
      const incoming = entry?.payloadJSON ?? null
      if (incoming !== null) {
        if (loadedDayRef.current === day && incoming === lastPayloadRef.current) return
        const decoded = decodeStandupPayload(incoming) ?? makeDefaultDraft()
        setDraft(decoded)
        loadedDayRef.current = day
        lastPayloadRef.current = incoming
        pristineRef.current = null
        return
      }
      const placeholder =
        provider === 'none'
          ? makeNoProviderDraft()
          : source === null
            ? makeInsufficientHistoryDraft()
            : makeDefaultDraft()
      if (
        loadedDayRef.current === day &&
        lastPayloadRef.current === null &&
        pristineRef.current !== null &&
        canon(placeholder) === pristineRef.current
      ) {
        return
      }
      setDraft(placeholder)
      loadedDayRef.current = day
      lastPayloadRef.current = null
      pristineRef.current = canon(placeholder)
    })()
  }, [selectedDay, provider, providerLoaded, unlocked, refreshTick, resolveSourceDay])

  // ----- Draft editing + debounced persistence -----

  const onDraftChange = useCallback(
    (d: DailyStandupDraft): void => {
      setDraft(d)
      draftRef.current = d
      if (saveTimer.current !== null) window.clearTimeout(saveTimer.current)
      const day = selectedDay
      saveTimer.current = window.setTimeout(() => {
        // Never persist pristine placeholder drafts (§2.8.3).
        if (!hasEntryRef.current && pristineRef.current !== null && canon(d) === pristineRef.current)
          return
        const payload = encodeStandupPayload(d)
        lastPayloadRef.current = payload
        pristineRef.current = null
        void api.standup.save(day, payload).then(() => setHasEntry(true))
      }, 250)
    },
    [selectedDay]
  )

  // ----- Regeneration (§2.8.6) -----

  const transientRegenState = useCallback((s: RegenState): void => {
    setRegenState(s)
    window.setTimeout(() => setRegenState((cur) => (cur === s ? 'idle' : cur)), 2000)
  }, [])

  const regenerate = useCallback((): void => {
    if (regenState === 'regenerating') return
    const prov = provider
    if (!providerCanGenerate(prov)) {
      const nd = makeNoProviderDraft()
      setDraft(nd)
      loadedDayRef.current = selectedDayRef.current
      lastPayloadRef.current = null
      pristineRef.current = canon(nd)
      return
    }
    setRegenState('regenerating')
    const target = selectedDayRef.current
    void (async () => {
      try {
        const source = await resolveSourceDay(target)
        if (!source) {
          transientRegenState('noData')
          return
        }
        const srcCards = await api.timeline.cardsForDay(source)
        if (srcCards.length === 0) {
          transientRegenState('noData')
          return
        }
        const prompt = makeRecapPrompt(source, srcCards)
        const raw = await api.providers.generateText(prompt, 8192)
        const parsed = parseRecapResponse(raw)
        if (!parsed || (parsed.done.length === 0 && parsed.next === null)) {
          setRegenState('idle')
          return
        }
        const prevBlockersTitle = draftRef.current?.blockersTitle.trim()
        const newDraft: DailyStandupDraft = {
          highlightsTitle: highlightsTitleFor(source),
          highlights: parsed.done.map((t) => ({ id: uid(), text: t })),
          tasksTitle: tasksTitleFor(target),
          tasks: parsed.next !== null ? [{ id: uid(), text: parsed.next }] : [],
          blockersTitle: prevBlockersTitle ? draftRef.current!.blockersTitle : 'Blockers',
          blockersBody: '',
          generation: {
            provider: prov,
            runtime: 'app',
            modelOrTool: mainProviderRef.current ?? undefined,
            sourceDay: source,
            generatedAt: new Date().toISOString()
          }
        }
        const payload = encodeStandupPayload(newDraft)
        await api.standup.save(target, payload)
        if (selectedDayRef.current === target) {
          setDraft(newDraft)
          setHasEntry(true)
          loadedDayRef.current = target
          lastPayloadRef.current = payload
          pristineRef.current = null
          transientRegenState('regenerated')
        } else {
          setRegenState('idle')
        }
      } catch {
        setRegenState('idle')
      }
    })()
  }, [provider, regenState, resolveSourceDay, transientRegenState])

  const copyStandup = useCallback(async (): Promise<void> => {
    const d = draftRef.current
    if (d) await api.timeline.copyToClipboard(standupClipboardText(d))
  }, [])

  const selectProvider = useCallback((id: DailyRecapProviderId): void => {
    setProviderState(id)
    void api.settings.set(DAILY_PROVIDER_SETTING_KEY, id)
    setRegenState('idle')
    loadedDayRef.current = null // force draft reload for the new provider
    setRefreshTick((t) => t + 1)
  }, [])

  const continueToDaily = useCallback((): void => {
    void api.settings.set(DAILY_UNLOCKED_SETTING_KEY, true)
    setUnlocked(true)
    setSelectedDay(logicalDayString())
    loadedDayRef.current = null
    if (providerCanGenerate(provider) && providerAvailability(provider, availability).isAvailable) {
      window.setTimeout(() => regenerate(), 400)
    }
  }, [provider, availability, regenerate, setSelectedDay])

  // ----- Render -----

  if (unlocked === null || !providerLoaded) {
    return <div className="daily-root" />
  }

  const locked = !(completed >= DAILY_REQUIRED_BATCHES && unlocked)
  if (locked) {
    return (
      <DailyLock
        completedBatches={completed}
        step={lockStep}
        provider={provider}
        availability={availability}
        availabilityLoading={availabilityLoading}
        onGranted={() => {
          setLockStep('provider')
          void refreshAvailability()
        }}
        onSelectProvider={selectProvider}
        onContinue={continueToDaily}
      />
    )
  }

  const today = logicalDayString()
  const canForward = selectedDay < today

  return (
    <div className="daily-root">
      <div className="daily-content">
        <div className="daily-topcontrols">
          <button
            className="daily-nav"
            onClick={() => setSelectedDay(addDays(selectedDay, -1))}
            aria-label="Previous day"
          >
            <img src={leftArrow} alt="" width={26.4} height={26.4} />
          </button>
          <span className="daily-title">{dailyDateTitle(selectedDay)}</span>
          <button
            className="daily-nav"
            disabled={!canForward}
            onClick={() => setSelectedDay(addDays(selectedDay, 1))}
            aria-label="Next day"
          >
            <img src={rightArrow} alt="" width={26.4} height={26.4} />
          </button>
        </div>
        <WorkflowSection day={selectedDay} workflow={workflow} />
        <ActionRow
          hasEntry={hasEntry}
          provider={provider}
          availability={availability}
          availabilityLoading={availabilityLoading}
          regenState={regenState}
          onCopy={copyStandup}
          onRegenerate={regenerate}
          onSelectProvider={selectProvider}
          onRefreshAvailability={() => void refreshAvailability()}
        />
        {draft && <StandupSection day={selectedDay} draft={draft} onChange={onDraftChange} />}
        <GoalSection day={selectedDay} cards={cards} categories={categories} />
      </div>
    </div>
  )
}
