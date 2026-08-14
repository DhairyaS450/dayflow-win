// Session-scoped chat state (survives tab switches, cleared on app restart).

import { create } from 'zustand'
import { api } from '../../lib/api'

export type ToolState = 'running' | 'completed' | 'failed'

export interface ChatMessage {
  id: string
  role: 'user' | 'assistant' | 'toolCall'
  content: string
  toolName?: string
  toolState?: ToolState
}

export type WorkStage = 'thinking' | 'runningTools' | 'answering'

interface ChatEventPayload {
  requestId?: string
  type?: string
  stage?: string
  callId?: string
  name?: string
  command?: string
  summary?: string
  ok?: boolean
  message?: string
}

interface ChatSendResult {
  ok: boolean
  text?: string
  error?: string
}

interface ChatStore {
  messages: ChatMessage[]
  isProcessing: boolean
  stage: WorkStage
  suggestions: string[]
  recentSuggestions: string[]
  draft: string
  setDraft: (text: string) => void
  send: (text: string) => Promise<void>
  clear: () => void
}

let counter = 0
const nextId = (): string => `chat-${Date.now()}-${counter++}`

/**
 * Metadata parsing (spec §3.12): extract the trailing fenced `suggestions` block,
 * strip the fenced `memory` block and residual headings from the visible answer.
 */
export function parseMetadata(text: string): { cleaned: string; suggestions: string[] } {
  let cleaned = text.replace(/\r\n?/g, '\n')
  let suggestions: string[] = []

  const sugRe = /(?:^|\n)\s*(?:#{1,6}\s*Suggestions\s*\n+|Suggestions:\s*)?```suggestions\s*\n([\s\S]*?)\n?```/i
  const sm = cleaned.match(sugRe)
  if (sm) {
    try {
      const arr: unknown = JSON.parse(sm[1])
      if (Array.isArray(arr) && arr.every((x) => typeof x === 'string')) {
        suggestions = (arr as string[]).map((s) => s.trim()).filter((s) => s.length > 0)
      }
    } catch {
      /* invalid JSON — ignore */
    }
    cleaned = cleaned.replace(sm[0], '\n')
  }

  const memRe = /(?:^|\n)\s*(?:#{1,6}\s*Memory\s*\n+|Memory:\s*)?```memory\s*\n([\s\S]*?)\n?```/i
  const mm = cleaned.match(memRe)
  if (mm) cleaned = cleaned.replace(mm[0], '\n')

  // Residual "Suggestions"/"Memory" headings on their own line.
  cleaned = cleaned.replace(/^\s*(?:#{1,6}\s*)?(?:Suggestions|Memory):?\s*$/gim, '')

  return { cleaned: cleaned.trim(), suggestions }
}

export const useChatStore = create<ChatStore>((set, get) => ({
  messages: [],
  isProcessing: false,
  stage: 'thinking',
  suggestions: [],
  recentSuggestions: [],
  draft: '',

  setDraft: (text) => set({ draft: text }),

  clear: () => set({ messages: [], suggestions: [], isProcessing: false, draft: '' }),

  send: async (text) => {
    const trimmed = text.trim()
    if (!trimmed || get().isProcessing) return

    const requestId = `req-${Date.now()}-${counter++}`
    const history = get()
      .messages.filter((m) => m.role === 'user' || m.role === 'assistant')
      .map((m) => ({ role: m.role as 'user' | 'assistant', content: m.content }))
    history.push({ role: 'user', content: trimmed })

    set((s) => ({
      messages: [...s.messages, { id: nextId(), role: 'user', content: trimmed }],
      isProcessing: true,
      stage: 'thinking',
      suggestions: [],
      draft: ''
    }))

    const off = api.on('chat:event', (...args: unknown[]) => {
      const ev = args[0] as ChatEventPayload | undefined
      if (!ev || ev.requestId !== requestId) return
      if (
        ev.type === 'status' &&
        (ev.stage === 'thinking' || ev.stage === 'runningTools' || ev.stage === 'answering')
      ) {
        set({ stage: ev.stage })
      } else if (ev.type === 'toolStart' && ev.callId) {
        const name = ev.name ?? 'tool'
        set((s) => ({
          stage: 'runningTools',
          messages: [
            ...s.messages,
            {
              id: ev.callId as string,
              role: 'toolCall',
              toolName: name,
              content: `Running ${name}…`,
              toolState: 'running'
            }
          ]
        }))
      } else if (ev.type === 'toolEnd' && ev.callId) {
        set((s) => ({
          messages: s.messages.map((m) =>
            m.id === ev.callId
              ? {
                  ...m,
                  toolState: ev.ok === false ? 'failed' : 'completed',
                  content: ev.summary && ev.summary.length > 0 ? ev.summary : m.content
                }
              : m
          )
        }))
      }
    })

    try {
      const res = (await window.dayflow.invoke('chat:send', {
        requestId,
        history,
        recentSuggestions: get().recentSuggestions.slice(-9)
      })) as ChatSendResult

      if (res && res.ok && typeof res.text === 'string') {
        const { cleaned, suggestions } = parseMetadata(res.text)
        set((s) => {
          const merged = [...s.recentSuggestions]
          for (const sug of suggestions) {
            if (!merged.some((r) => r.toLowerCase() === sug.toLowerCase())) merged.push(sug)
          }
          return {
            messages: cleaned
              ? [...s.messages, { id: nextId(), role: 'assistant', content: cleaned }]
              : s.messages,
            suggestions,
            recentSuggestions: merged.slice(-12)
          }
        })
      } else {
        const message = res?.error ?? 'Unknown error'
        set((s) => ({
          messages: [
            ...s.messages,
            { id: nextId(), role: 'assistant', content: `I encountered an error: ${message}` }
          ]
        }))
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      set((s) => ({
        messages: [
          ...s.messages,
          { id: nextId(), role: 'assistant', content: `I encountered an error: ${message}` }
        ]
      }))
    } finally {
      off()
      set({ isProcessing: false })
    }
  }
}))
