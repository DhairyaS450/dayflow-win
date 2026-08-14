# Dayflow AI Provider Subsystem — Windows/TypeScript Porting Spec

> Extracted from the MIT-licensed Dayflow macOS app (`Copyright (c) 2025 Jerry Liu`, MIT License —
> permission granted to use, copy, modify, merge, publish, distribute). Source read from
> `Dayflow/Dayflow/Dayflow/Core/AI/*`, `Core/Security/KeychainManager.swift`,
> `Utilities/GeminiAPIHelper.swift`, plus supporting model files. All prompt texts below are
> verbatim copies from that source. The implementer is NOT expected to read the Swift source;
> this document is the contract.

---

## Table of contents

1. [Shared data types](#1-shared-data-types)
2. [Provider selection & persistence](#2-provider-selection--persistence)
3. [LLMService orchestration](#3-llmservice-orchestration)
4. [LLMLogger (per-call logging)](#4-llmlogger)
5. [Output-language preference](#5-output-language-preference)
6. [GeminiDirectProvider](#6-geminidirectprovider)
7. [Gemini prompt preference system (user-overridable blocks)](#7-gemini-prompt-preferences)
8. [GemmaBackupProvider (automatic Gemini→Gemma fallback)](#8-gemmabackupprovider)
9. [OllamaProvider / LocalEngine (Ollama, LM Studio, Custom)](#9-ollamaprovider--localengine)
10. [DayflowBackendProvider (proprietary hosted backend)](#10-dayflowbackendprovider)
11. [Daily Recap: generator, models, scheduler](#11-daily-recap)
12. [Keychain / secret storage](#12-keychain--secret-storage)
13. [GeminiAPIHelper (connection test)](#13-geminiapihelper)
14. [Dashboard chat (Gemini function calling)](#14-dashboard-chat)
15. [UserDefaults key registry](#15-userdefaults-key-registry)
16. [Analytics event registry](#16-analytics-event-registry)
17. [Porting notes & surprises](#17-porting-notes--surprises)

---

## 1. Shared data types

All the types below are plain data. On Windows, model them as TypeScript interfaces. Field names
matter — several are serialized to JSON for prompts, storage, and the Dayflow backend API.

### 1.1 Observation

One transcribed segment of screen activity. Stored in SQLite (`observations` table).

```ts
interface Observation {
  id: number | null;          // Int64 DB id, null before insert
  batchId: number;            // Int64 — 0 before save; set on insert
  startTs: number;            // Unix seconds
  endTs: number;              // Unix seconds
  observation: string;        // Natural-language description of what happened
  metadata: string | null;
  llmModel: string | null;    // e.g. "gemini-3.5-flash", "qwen3-vl:4b", "gemma-4-31b-it"
  createdAt: Date | null;
}
```

### 1.2 ActivityCardData

The card the LLM produces. Times are **human clock strings**, not timestamps.

```ts
interface AppSites {
  primary?: string | null;    // canonical domain, lowercase, no protocol: "docs.google.com"
  secondary?: string | null;
}

interface Distraction {
  id: string;                 // UUID; when decoding, generate a new UUID if missing
  startTime: string;          // "1:15 AM" (h:mm a)
  endTime: string;
  title: string;
  summary: string;
  videoSummaryURL?: string | null;
}

interface ActivityCardData {
  startTime: string;          // "1:12 AM" — h:mm a, en_US_POSIX, local timezone
  endTime: string;
  category: string;           // must match a user category label exactly (normalized post-hoc)
  subcategory: string;
  title: string;
  summary: string;
  detailedSummary: string;
  distractions?: Distraction[] | null;
  appSites?: AppSites | null;
}
```

### 1.3 TimelineCard / TimelineCardShell (storage side)

```ts
interface TimelineCard extends ActivityCardData /* with renamed time fields */ {
  recordId: number | null;
  batchId: number | null;
  startTimestamp: string;     // same clock-string format as ActivityCardData.startTime
  endTimestamp: string;
  day: string;                // "YYYY-MM-DD" logical day (4 AM boundary)
  videoSummaryURL: string | null;
  otherVideoSummaryURLs: string[] | null;
  isBackupGenerated: boolean | null;
}

// Shell used when inserting cards (no video URL yet):
interface TimelineCardShell {
  startTimestamp: string; endTimestamp: string;
  category: string; subcategory: string;
  title: string; summary: string; detailedSummary: string;
  distractions: Distraction[] | null;
  appSites: AppSites | null;
  isBackupGenerated: boolean | null;   // set true when card came from any backup path
  idleMetadata?: unknown | null;
}
```

### 1.4 LLMCall (lightweight in-memory log of one logical operation)

```ts
interface LLMCall {
  timestamp: Date | null;     // when the operation started
  latency: number | null;     // seconds
  input: string | null;       // prompt or description
  output: string | null;      // raw model response or description
}
```

### 1.5 LLMCategoryDescriptor

```ts
interface LLMCategoryDescriptor {
  id: string;                 // UUID
  name: string;
  colorHex: string;
  description: string | null;
  isSystem: boolean;
  isIdle: boolean;            // exactly one idle category expected
}
```

Loaded via `CategoryStore.descriptorsForLLM()` (user-configured categories).

### 1.6 Screenshot

```ts
interface Screenshot {
  id: number;
  capturedAt: number;         // Unix seconds
  filePath: string;
  fileSize: number | null;
  idleSecondsAtCapture: number | null;
  isDeleted: boolean;
}
```

`ScreenshotConfig.interval`: `UserDefaults "screenshotIntervalSeconds"` if > 0 else **10.0
seconds**. This value is the *compression factor* used to expand Gemini video timestamps.

### 1.7 ActivityGenerationContext

Input to phase 2 (card generation):

```ts
interface ActivityGenerationContext {
  batchObservations: Observation[];    // observations of the *current* batch only
  existingCards: ActivityCardData[];   // cards overlapping the 45-min lookback window
  currentTime: Date;                   // batch end time; prevents future timestamps
  categories: LLMCategoryDescriptor[];
}
```

### 1.8 BatchingConfig

```ts
const BatchingConfig = {
  targetDuration: 15 * 60,        // 15-minute analysis batches
  maxGap: 2 * 60,                 // split batches if gap exceeds 2 minutes
  cardLookbackDuration: 45 * 60,  // build cards with a 45-minute lookback window
};
```

### 1.9 ChatStreamEvent (rich chat streaming)

```ts
type ChatStreamEvent =
  | { kind: "sessionStarted"; id: string }
  | { kind: "thinking"; text: string }
  | { kind: "toolStart"; command: string }
  | { kind: "toolEnd"; output: string; exitCode: number | null }
  | { kind: "textDelta"; text: string }
  | { kind: "complete"; text: string }
  | { kind: "error"; message: string };
```

### 1.10 Dashboard chat request types

```ts
type DashboardChatProvider = "gemini" | "codex" | "claude"; // default "gemini"

interface DashboardChatTurn { role: "user" | "assistant"; content: string; }
// Gemini role mapping: user -> "user", assistant -> "model"

interface DashboardChatRequest {
  provider: DashboardChatProvider;
  prompt: string;
  sessionId: string | null;         // only used by CLI providers
  systemInstruction: string | null; // only used by gemini
  history: DashboardChatTurn[];
}
```

### 1.11 LLMCallDBRecord (persisted per HTTP attempt — `llm_calls` table)

```ts
interface LLMCallDBRecord {
  batchId: number | null;
  callGroupId: string | null;   // UUID grouping retries of one logical op
  attempt: number;              // 1-based
  provider: string;             // "gemini" | "gemma" | "ollama" | "lmstudio" | "custom" | ...
  model: string | null;
  operation: string;            // "transcribe", "generate_activity_cards", ...
  status: "success" | "failure";
  latencyMs: number | null;
  httpStatus: number | null;
  requestMethod: string | null;
  requestURL: string | null;    // sanitized (see §4)
  requestHeadersJSON: string | null;  // sanitized
  requestBody: string | null;   // truncated at 64 KiB
  responseHeadersJSON: string | null;
  responseBody: string | null;  // truncated at 64 KiB
  errorDomain: string | null;
  errorCode: number | null;
  errorMessage: string | null;
}
```

---

## 2. Provider selection & persistence

### 2.1 LLMProviderType (main timeline provider)

Persisted as JSON under UserDefaults key `llmProviderType`; a canonical string id is mirrored to
`selectedLLMProvider` (`"gemini" | "dayflow" | "ollama" | "chatgpt_claude"`).

```ts
type LLMProviderType =
  | { kind: "geminiDirect" }
  | { kind: "dayflowBackend"; endpoint: string }  // default "https://web-production-f3361.up.railway.app"
  | { kind: "ollamaLocal"; endpoint: string }     // default "http://localhost:11434"
  | { kind: "chatGPTClaude" };                    // drives external codex/claude CLI (out of scope here)
```

Load order: decode JSON from `llmProviderType`; if absent, migrate from legacy string in
`selectedLLMProvider` (`"gemini"→gemini`, `"dayflow"→dayflow`, `"ollama"→ollama` reading endpoint
from `llmLocalBaseURL`, `"chatgpt"`/`"claude"`→chatGPTClaude also seeding `chatCLIPreferredTool`
to `"codex"`/`"claude"` respectively, `"chatgpt_claude"`→chatGPTClaude); default `geminiDirect`.
Persist migrated value back.

### 2.2 LLMProviderID (identity for routing/analytics)

`"gemini" | "dayflow" | "ollama" | "chatgpt_claude"`; `analyticsName` is same except
chatGPTClaude → `"chat_cli"`. `providerLabel(chatTool)`: gemini→`"gemini"`, dayflow→`"dayflow"`,
ollama→`"local"`, chatGPTClaude→`"claude"` if tool is claude else `"chatgpt"`.

### 2.3 Backup provider preferences

- `llmBackupProviderId` (UserDefaults, string raw value of LLMProviderID) — the user-configured
  timeline *backup provider*. Cleared = none.
- `llmBackupChatCLITool` — `"codex" | "claude"`, only meaningful when backup is chatgpt_claude.

The backup provider is ignored if it equals the primary provider id.

---

## 3. LLMService orchestration

`LLMService` is a singleton implementing:

```ts
interface LLMServicing {
  processBatch(batchId: number,
               progressHandler?: (step: "transcribing" | "generatingCards") => void)
    : Promise<{ cards: ActivityCardData[]; cardIds: number[] }>;  // callback style in Swift
  generateText(prompt: string): Promise<string>;
  generateTextStreaming(prompt: string): AsyncIterable<string>;
  generateChatStreaming(request: DashboardChatRequest): AsyncIterable<ChatStreamEvent>;
  batchingConfig: BatchingConfig;   // always the standard config above
}
```

### 3.1 Provider factories

- **Gemini**: read API key from secret store key `"gemini"`; if missing/empty → error
  `"No LLM provider configured. Please configure in settings."` (domain `LLMService`, code 1).
  Constructed with `GeminiModelPreference.load()`. Also constructs a `GemmaBackupProvider` with
  the *same* API key (silent internal fallback, see §8).
- **Dayflow**: requires a session token from `DayflowAuthManager.storedSessionToken()`
  (OS keychain, see §12). Missing → same "no provider" error. Endpoint resolution order:
  1. UserDefaults `dayflowBackendURLOverride` (trimmed, non-empty)
  2. app bundle config value `DayflowBackendURL` (Info.plist analog)
  3. endpoint saved inside the persisted provider enum
  4. default `https://web-production-f3361.up.railway.app`
- **Ollama/local**: endpoint = UserDefaults `llmLocalBaseURL` or `http://localhost:11434`.
  Never fails to construct.
- **ChatCLI**: wraps `codex`/`claude` CLI; tool = override, else UserDefaults
  `chatCLIPreferredTool` (`"claude"` → claude, anything else → codex).

### 3.2 processBatch — the two-phase flow

Input: `batchId`. Batches live in SQLite with `(id, start_ts, end_ts, status)`.

```
1.  Look up batch; missing → error LLMService#2 "Batch not found".
2.  primary = LLMProviderID.from(currentProviderType)
    backup  = configured backup provider (if any, and != primary)
    capture analytics "analysis_batch_started"
    { batch_id, total_duration_seconds, llm_provider, llm_provider_label }
3.  Build primary provider context (throws → catch block). Build backup context best-effort;
    if configured but construction failed, capture "llm_timeline_backup_unavailable".
4.  Mark batch status = "processing".
5.  screenshots = StorageManager.screenshotsForBatch(batchId)
    empty → error LLMService#3 "No screenshots in batch".
6.  PHASE 1 — TRANSCRIBE
    progressHandler("transcribing")
    (observations, transcribeLog) =
        executeWithProviderBackup("transcribe", work = ctx.transcribeScreenshots(
            screenshots, batchStartDate, batchId))
    Save observations for the batch.
    If observations is empty:
        capture "transcription_returned_empty"
        { batch_id, provider, provider_label, transcribe_latency_ms }
        mark batch "analyzed"; SUCCEED with { cards: [], cardIds: [] }.  // no card phase
7.  PHASE 2 — GENERATE CARDS (sliding window)
    currentTime      = batch end time
    windowStartTime  = currentTime - 45 min (cardLookbackDuration)
    recentObservations = fetchObservationsByTimeRange(windowStartTime, currentTime)
    existingCards      = fetchTimelineCardsByTimeRange(windowStartTime, currentTime)
                         mapped to ActivityCardData
    context = { batchObservations: observations, existingCards, currentTime, categories }
    progressHandler("generatingCards")
    (cards, _) = executeWithProviderBackup("generate_cards", work =
        ctx.generateActivityCards(recentObservations, context, batchId))
    // NOTE: first arg passed to the provider is recentObservations (whole 45-min window),
    // while context.batchObservations is only the new batch's observations.
    isBackupGenerated = usedProviderBackup || gemmaFallbackState.usedGemmaForCardGeneration
8.  Replace cards in [windowStartTime, currentTime] with the new set
    (replaceTimelineCardsInRange returns inserted card ids + orphaned timelapse video paths;
     delete those video files from disk).
9.  Mark batch "analyzed"; WAL checkpoint (passive).
    capture "analysis_batch_completed" { batch_id, cards_generated,
      processing_duration_seconds, llm_provider, llm_provider_label,
      effective_llm_provider, used_provider_backup }
10. SUCCEED with { cards, cardIds }.
```

**Failure path** (any thrown error):

```
- capture "analysis_batch_failed" { batch_id, error_message, processing_duration_seconds,
    llm_provider, llm_provider_label, backup_provider, backup_provider_label, backup_configured }
- Emit a "timeline failure toast" (throttled to once per logical day, key
  "timelineFailureToastLastShownDay" storing the 4AM-boundary day string). Message:
    * rate-limited AND no backup configured:
      "Dayflow hit a rate limit and no backup provider is configured. Add a backup in
       Settings > Providers to avoid interruptions."
    * else by phase:
      transcribing   → "Dayflow couldn't transcribe this batch. Check Settings > Providers and
                        configure a backup provider."
      generatingCards→ "Dayflow couldn't generate timeline cards for this batch. Check Settings >
                        Providers and configure a backup provider."
      unknown        → "Dayflow couldn't finish this batch. Check Settings > Providers and
                        configure a backup provider."
  Also capture "llm_timeline_failure_toast_shown".
- Mark batch status "failed" with reason = error message.
- Create an ERROR CARD replacing all cards in [batchStart, batchEnd]:
    category "System", subcategory "Error", title "Processing failed",
    summary  "Failed to process {duration} minutes of recording from {start} to {end}.
              {humanError} Your recording is safe and can be reprocessed."
    detailedSummary "Error details: {error}\n\nThis recording batch (ID: {batchId}) failed during
              AI processing. The original video files are preserved and can be reprocessed by
              retrying from Settings. Common causes include network issues, API rate limits, or
              temporary service outages."
  (delete orphaned timelapses as in the happy path)
- Rethrow / fail the completion.
```

Rate-limit detection (`isRateLimitError`): NSError domain `GeminiError`/`GeminiProvider` with code
429 or 403, or message containing (case-insensitive) `quota` / `rate limit` /
`too many requests`; or any error message containing `rate limit`, `too many requests`,
`quota exceeded`, `quota`, `you've hit your limit`.

### 3.3 executeWithProviderBackup (primary → configured backup)

Generic wrapper used for both phases:

```
try work(activeContext)                       // activeContext starts as primary; after a backup
                                              // success it STAYS backup for subsequent phases
catch err:
  if activeContext is not primary, or no backupContext: rethrow
  capture "llm_timeline_fallback_attempted" { operation, batch_id, primary_provider,
    primary_provider_label, backup_provider, backup_provider_label, error_domain, error_code,
    error_message }
  try work(backupContext):
    capture "llm_timeline_fallback_succeeded" (same props) ; return with usedProviderBackup=true
  catch backupErr:
    capture "llm_timeline_fallback_failed" (same props + backup_error_domain/code/message)
    rethrow backupErr
```

### 3.4 Gemini→Gemma silent fallback (inside the gemini batch provider)

When the primary provider is Gemini, its `BatchProviderActions` wrap a mutable
`GemmaFallbackState { preferGemma: bool; usedGemmaForCardGeneration: bool }`:

- If `preferGemma` already true → call GemmaBackupProvider directly.
- Else call Gemini; on ANY error (after Gemini's internal retries are exhausted), set
  `preferGemma = true`, capture `"llm_fallback_used"` `{ provider:"gemini",
  provider_label:"gemini", fallback_provider:"gemma", fallback_provider_label:"gemma",
  operation:"transcribe"|"generate_cards", error_domain, error_code, error_message, batch_id }`,
  and retry the same operation with Gemma.
- Card generation via Gemma sets `usedGemmaForCardGeneration = true` (marks cards
  `isBackupGenerated`).

This is distinct from and layered *inside* the §3.3 provider backup: order is
Gemini → Gemma → configured backup provider.

### 3.5 Text generation

`generateText(prompt)` dispatches to the current provider's `generateText`. Streaming: only the
ChatCLI provider has native streaming; other providers are wrapped in a single-yield stream.
`DayflowBackendProvider.generateText` always throws
`"Text generation is not yet supported with Dayflow Backend. Please configure Gemini, Ollama, or
ChatGPT/Claude CLI in Settings."`.

### 3.6 Human-readable error mapping (for the error card)

Map errors to friendly text (used inside the error-card summary). Key rules:

| Domain | Code | Message |
|---|---|---|
| LLMService | 1 | "No AI provider is configured. Please set one up in Settings." |
| LLMService | 2 | "The recording batch couldn't be found." |
| LLMService | 3 | "No video recordings found in this time period." |
| LLMService | 4/5/6 | video prep failures |
| GeminiError/GeminiProvider | 1 | "Failed to upload the video to Gemini." |
| ″ | 2 | "Gemini took too long to process the video." |
| ″ | 3, 5 | "Failed to parse Gemini's response." |
| ″ | 4 | "Failed to start video upload to Gemini." |
| ″ | 6 | "Invalid video file." |
| ″ | 7, 9 | "Gemini returned an unexpected response format." |
| ″ | 8, 10 | "Failed to connect to Gemini after multiple attempts." |
| ″ | 100 | "The AI generated timestamps beyond the video duration." |
| ″ | 101 | "The AI couldn't identify any activities in the video." |
| ″ | 400 | "Invalid API key. Please check your Gemini API key in Settings." |
| ″ | 401 | "Unauthorized. Your Gemini API key may be invalid or expired." |
| ″ | 403 | "Access forbidden. Check your Gemini API permissions." |
| ″ | 429 | "Rate limited. Too many requests to Gemini. Please wait a few minutes." |
| ″ | 503 | long message pointing at Google AI Studio status page |
| ″ | 500–599 | "Gemini service error. The service may be temporarily down." |
| OllamaProvider | 1/2/4/8-13 | local-AI-specific messages ("Failed to connect to local AI model", "The local AI returned an unexpected response", etc.) |

Before the code switch, if domain is GeminiError with 4xx/5xx, sniff the message for
`api key not found` / `rate limit`/`quota` / `unauthorized` / `timeout` and use the matching
friendly string. Fallback layer: substring checks on the error description (`rate limit`/`429`,
`network`/`connection`, `api key`/`unauthorized`/`401`, `503`, `timeout`, `no observations`,
`exceed`/`duration`, `no llm provider`/`not configured`, `failed to upload`,
`invalid response`/`json`, `failed after`+`attempts`), else "An unexpected error occurred."

---

## 4. LLMLogger

Central best-effort logger. Never throws; writes one `LLMCallDBRecord` row per HTTP attempt and
mirrors an analytics event `"llm_api_call"`.

- `logSuccess(ctx, http, finishedAt)` → status "success"; analytics props
  `{ provider, model|"unknown", latency_ms, outcome:"success", operation, batch_id?, group_id? }`
  plus token usage bubbled from pseudo-headers `x-usage-input`, `x-usage-cached-input`,
  `x-usage-output` if present.
- `logFailure(ctx, http?, finishedAt, errorDomain?, errorCode?, errorMessage?)` → status
  "failure"; adds `error_code`, `error_message`, `response_body` (utf8) to analytics.
- **Body cap**: request/response bodies stored max **64 KiB**; larger bodies stored as
  `"<truncated llm body: original_bytes=N, stored_prefix_bytes=65536>\n{prefix}"`.
- **Sanitization**: query params named (case-insensitive) `key, api_key, apiKey, access_token,
  token, authorization, x-goog-api-key, x-api-key` are replaced with `<redacted>`; headers
  `authorization, proxy-authorization, x-api-key, x-goog-api-key` are dropped entirely.
- Header dicts serialized as sorted-key JSON strings.

`LLMCallContext` fields: batchId?, callGroupId? (UUID per logical operation, shared across
retries), attempt (1-based), provider, model?, operation, requestMethod?, requestURL?,
requestHeaders?, requestBody?, startedAt.

---

## 5. Output-language preference

UserDefaults key `llmOutputLanguageOverride` (string). Normalization: trim; empty or
case-insensitive `"english"` → null (no instruction).

`languageInstruction(forJSON)` when a language L is set:

- verbatim clause (both variants):
  `If any rule requires an exact English phrase (e.g., "Scattered apps and sites"), keep it verbatim.`
- forJSON=true:
  `The user only speaks {L}. Respond in {L}, but keep JSON keys in English exactly as specified. {verbatimClause}`
- forJSON=false:
  `The user only speaks {L}. Respond in {L}. {verbatimClause}`

Injected into: Gemini card prompt (JSON), Ollama summary prompt (JSON), Ollama title prompt
(plain), Ollama merge prompt (JSON), Daily recap prompt (JSON, under a `## Language` heading),
and sent to the Dayflow backend as `preferred_output_language`.

---

## 6. GeminiDirectProvider

### 6.1 Constants

- File upload endpoint: `https://generativelanguage.googleapis.com/upload/v1beta/files`
- Generate endpoint per model:
  `https://generativelanguage.googleapis.com/v1beta/models/{model}:generateContent`
- Auth: API key as query param `?key={apiKey}` (no auth header).
- Capacity error codes triggering **model fallback**: `{403, 404, 429, 503}`.
- All generateContent requests: `Content-Type: application/json`, timeout **120 s**.

### 6.2 Models & fallback order (GeminiModelPreference)

```ts
type GeminiModel = "gemini-3.5-flash" | "gemini-3.1-flash-lite";
```

Preference persisted as JSON under UserDefaults key `geminiSelectedModel_v3` (the `_v3` bump
intentionally hard-reset earlier users). Default primary: `gemini-3.5-flash`.

Ordered model list:
- primary flash35 → `["gemini-3.5-flash", "gemini-3.1-flash-lite"]`
- primary flashLite31 → `["gemini-3.1-flash-lite"]` (no fallback)

`ModelRunState` walks this list: start at index 0; `advance()` moves to the next model (returns
the from/to pair) or returns null at the end. On an error with domain `GeminiError` and a
capacity code, advance the model and retry **without consuming a backoff delay**; capture
analytics `"llm_model_fallback"` `{ provider:"gemini", operation, from_model, to_model, reason,
batch_id? }` where reason is `rate_limit_429 | model_unavailable_404 | service_unavailable_503 |
forbidden_quota_403 | http_{code}`.

### 6.3 Retry strategy classification (shared by transcribe/cards/text)

```
classifyError(err):
  DecodingError (JSON decode)                     → immediate
  URLError timedOut/connectionLost/cannotConnect/
           cannotFindHost/notConnectedToInternet  → shortBackoff
  other URLError                                  → noRetry
  GeminiError 429                                 → longBackoff
  GeminiError 500..599                            → shortBackoff
  GeminiError 401, 403                            → noRetry
  GeminiError 7, 9, 10 (parse codes)              → immediate
  GeminiError other 400..499                      → noRetry
  GeminiError other                               → shortBackoff
  anything else                                   → shortBackoff

delayForStrategy(strategy, attempt /*0-based*/):
  immediate      → 0 s
  shortBackoff   → 2^attempt * 2   (2 s, 4 s, 8 s)
  longBackoff    → min(3, attempt+1) seconds  (1 s, 2 s, 3 s)
                   // NOTE: source comment claims "30s, 60s, 120s" but the code returns 1–3 s.
                   // Port the CODE behavior; see §17.
  enhancedPrompt → 1 s
  noRetry        → 0 (and do not retry)
```

### 6.4 File upload (resumable) — `uploadAndAwait`

Used before transcription. Overall structure: up to **3 full cycles** of
(upload with up to 3 attempts) + (processing poll up to 3 minutes).

**uploadResumable(data, mimeType):**

1. `POST {fileEndpoint}?key={apiKey}` with headers:
   - `X-Goog-Upload-Protocol: resumable`
   - `X-Goog-Upload-Command: start`
   - `X-Goog-Upload-Raw-Size: {byteLength}`
   - `X-Goog-Upload-Header-Content-Type: {mimeType}`
   - `Content-Type: application/json`
   Body: `{"file": {"display_name": "dayflow_video"}}`
2. Read response header `X-Goog-Upload-URL` (missing → GeminiError#4 "No upload URL in
   response").
3. `PUT {uploadURL}` with headers `X-Goog-Upload-Command: upload, finalize` and
   `X-Goog-Upload-Offset: 0`; body = raw video bytes. (Single-shot; no chunking.)
4. Parse response JSON `{ file: { uri } }` → return `uri`. Parse failure → GeminiError#5.

**Upload retry policy**: retry only on network-transport errors (connection lost, timed out,
DNS failure, cannot connect, offline) with exponential backoff `2^attempt` seconds (2, 4, 8);
other errors break out of the upload loop for that cycle.

**Processing poll (`getFileStatus`)**: `GET {fileURI}?key={apiKey}` → JSON `{ state }`. Poll
every **2 s** until `state == "ACTIVE"` or **3 min** timeout (GeminiError#2 "File processing
timeout"), then start the next full cycle. All cycles exhausted → last error or GeminiError#3.

(There is also a simple non-resumable `uploadSimple` — POST body direct with
`Content-Type: {mimeType}` — kept as dead code; port optional.)

### 6.5 Phase 1 — transcription

**Screenshot compositing** (`transcribeScreenshots`):

1. Sort screenshots by `capturedAt`.
2. `realDuration = last.capturedAt - first.capturedAt` (seconds).
3. Composite ALL screenshots into a **compressed-timeline video**: 1 fps, each screenshot = 1 s
   of video, so `videoDuration = screenshotCount` seconds. Encoding options: max output height
   **720**, frame stride 1, average bitrate **1,200,000 bps**, codec **H.264**, keyframe
   interval **10 s**. (On Windows: ffmpeg image2 sequence → mp4.)
4. `compressionFactor = ScreenshotConfig.interval` (default 10 → 10× compression).
5. Upload the mp4 (`video/mp4`) via §6.4 and transcribe.

**Transcription prompt** (verbatim; `{durationString}` = compressed video duration formatted
`MM:SS`, injected in two places):

```
Screen Recording Transcription (Reconstruct Mode)
Watch this screen recording and create an activity log detailed enough that someone could reconstruct the session.
CRITICAL: This video is exactly {durationString} long. ALL timestamps must be within 00:00 to {durationString}. No gaps.
Identifying the active app: On macOS, the app name is always shown in the top-left corner of the screen, right next to the Apple () menu. Check this FIRST to identify which app is being used. Do NOT guess — read the actual name from the menu bar. If you can't read it clearly, describe it generically (e.g., "code editor," "browser," "messaging app") rather than guessing a specific product name. Common code editors like Cursor, VS Code, Xcode, and Zed all look similar but have different names in the menu bar.
For each segment, ask yourself:
"What EXACTLY did they do? What SPECIFIC things can I see?"
Capture:
- Exact app/site names visible (check menu bar for app name)
- Exact file names, URLs, page titles
- Exact usernames, search queries, messages
- Exact numbers, stats, prices shown
Bad: "Checked email"
Good: "Gmail: Read email from boss@company.com 'RE: Budget approval' - replied 'Looks good'"
Bad: "Browsing Twitter"
Good: "Twitter/X: Scrolled feed - viewed posts by @pmarca about AI, @sama thread on GPT-5 (12 tweets)"
Bad: "Working on code"
Good: "Editing StorageManager.swift in [exact app name from menu bar] - fixed type error on line 47, changed String to String?"
Segments:
- 3-8 segments total
- You may use 1 segment only if the user appears idle for most of the recording
- Group by GOAL not app (IDE + Terminal + Browser for the same task = 1 segment)
- Do not create gaps; cover the full timeline
Return ONLY JSON in this format:
[
{
"startTimestamp": "MM:SS",
"endTimestamp": "MM:SS",
"description": "1-3 sentences with specific details"
}
]
```

> Windows port note: rewrite the macOS menu-bar paragraph for Windows (title bar / taskbar), but
> keep the rest intact.

**Request body**:

```json
{
  "contents": [{ "parts": [
    { "file_data": { "mime_type": "video/mp4", "file_uri": "<uploaded uri>" } },
    { "text": "<prompt>" }
  ]}],
  "generationConfig": {
    "temperature": 0.3,
    "maxOutputTokens": 65536,
    "mediaResolution": "MEDIA_RESOLUTION_HIGH",
    "responseMimeType": "application/json",
    "responseSchema": {
      "type": "ARRAY",
      "items": {
        "type": "OBJECT",
        "properties": {
          "startTimestamp": { "type": "STRING" },
          "endTimestamp":   { "type": "STRING" },
          "description":    { "type": "STRING" }
        },
        "required": ["startTimestamp", "endTimestamp", "description"],
        "propertyOrdering": ["startTimestamp", "endTimestamp", "description"]
      }
    }
  }
}
```

**Response handling** (per attempt): non-HTTP → GeminiError#9. HTTP ≥ 400: special-case **503
salvage** — Gemini sometimes streams a valid JSON payload before dying with 503; scan body for
the first balanced JSON object, and if it contains `candidates[0].content.parts[0].text`, treat
as success. Otherwise parse `error.message` from body if present and throw
`GeminiError#{httpStatus}`. On 2xx: extract `candidates[0].content.parts[0].text`; missing
pieces → GeminiError#7. Every attempt logged via LLMLogger (operation `"transcribe"`).

**Outer retry loop** (`maxRetries = 3`, callGroupId = fresh UUID):

1. Call request with current model. Parse the returned text as `VideoTranscriptChunk[]`.
2. Validate each chunk: parse `MM:SS` (or `HH:MM:SS`) timestamps; reject the whole attempt if
   any chunk lies outside `[-10 s, videoDuration + 10 s]` (compressed time, 10 s tolerance) →
   analytics `captureValidationFailure(provider:"gemini", operation:"transcribe",
   validationType:"timestamp_exceeds_duration", …)` and throw GeminiError#100.
3. Convert: `realStart = compressedStartSeconds * compressionFactor`;
   `observation.startTs = batchStartTime + realStart` (unix), same for end;
   `observation.observation = chunk.description`; `llmModel = model used`.
4. Zero observations after filtering → validationType `"empty_observations"`, GeminiError#101.
5. On error: model-fallback if capacity code (§6.2), else classify & backoff (§6.3); rethrow if
   `noRetry` or attempts exhausted.

Returns `(observations, LLMCall{input: prompt, output: raw response})`.

### 6.6 Phase 2 — activity cards

**Inputs → prompt assembly**:

- `transcriptText`: each observation of the 45-min window as
  `[{h:mm a start} - {h:mm a end}]: {observation}` joined with `\n`.
- `existingCardsString`: existing cards pretty-printed JSON (ActivityCardData array).
- `promptSections`: user-overridable blocks (§7).
- `languageBlock`: §5 instruction (JSON variant) prefixed by two newlines, or empty.

**Base prompt** (verbatim; `\(x)` denotes injection points):

````
# Timeline Card Generation

You're writing someone's personal work journal. You'll get raw activity logs — screenshots, app switches, URLs — and your job is to turn them into timeline cards that help this person remember what they actually did.

The test: when they scan their timeline tomorrow morning, each card should make them go "oh right, that."

Write as if you ARE the person jotting down notes about their day. Not an analyst writing a report. Not a manager filing a status update.

---

## Card Structure

Each card covers one cohesive chunk of activity, roughly 15–60 minutes.

- Minimum 10 minutes per card. If something would be shorter, fold it into the neighboring card that makes the most sense.
- Maximum 60 minutes. If a card runs longer, split it where the focus naturally shifts.
- No gaps or overlaps between cards. If there's a real gap in the source data, preserve it. Otherwise, cards should meet cleanly.

**When to start a new card:**
1. What's the main thing happening right now?
2. Does the next chunk of activity continue that same thing? → Keep extending.
3. Is there a brief unrelated detour (<5 min)? → Log it as a distraction, keep the card going.
4. Has the focus genuinely shifted for 10+ minutes? → New card.

**When to merge with a previous card:**
1. Is the previous card's main activity the same as what's happening now? (same PR, same feature, same codebase, same article) → Merge.
2. Did the person just take a 2–5 minute break (X, messages, YouTube) and come back to the same thing? → That's a distraction, not a new card. Merge.
3. Are two adjacent cards both "scrolling X with occasional work check-ins"? → Merge. The vibe didn't change.
4. Only start a new card if the CORE INTENT changed for 10+ minutes.

DEFAULT TO MERGING. Two 15-minute cards about the same work stream should almost never exist. If you're unsure whether to merge or split, merge.

---

\(promptSections.title)

---

\(promptSections.summary)

---

\(promptSections.detailedSummary)

\(languageBlock)

---

## Category

\(categoriesSection(from: context.categories))

---

## Distractions

A distraction is a brief (<5 min) unrelated interruption inside a card. Checking X for 2 minutes while debugging is a distraction. Spending 15 minutes on X is not a distraction — it's either part of the card's theme or it's a new card.

Don't label related sub-tasks as distractions. Googling an error message while debugging isn't a distraction, it's part of debugging.

---

## App Sites

Identify the main app or website for each card.

- primary: the main app used in the card (canonical domain, lowercase, no protocol).
- secondary: another meaningful app used, or the enclosing app (e.g., browser). Omit if there isn't a clear one.

Be specific: docs.google.com not google.com, mail.google.com not google.com.

Common mappings:
- Figma → figma.com
- Notion → notion.so
- Google Docs → docs.google.com
- Gmail → mail.google.com
- VS Code → code.visualstudio.com
- Xcode → developer.apple.com/xcode
- Twitter/X → x.com
- Zoom → zoom.us
- ChatGPT → chatgpt.com

---

## Continuity Rules

Your output cards must cover the same total time range as the previous cards plus any new observations. Think of previous cards as a draft you're revising and extending, not locked history.

- Don't drop time segments that were previously covered.
- If new observations extend beyond the previous range, add cards to cover the new time.
- Preserve genuine gaps in the source data.

Before generating output, review the previous cards and ask:
- Could any two adjacent previous cards be the same activity session?
- Does your first new card continue the last previous card's work?
If yes to either, merge them in your output.

INPUTS:
Previous cards: \(existingCardsString)
New observations: \(transcriptText)
Return ONLY a JSON array with this EXACT structure:

        [
          {
            "startTime": "1:12 AM",
            "endTime": "1:30 AM",
            "category": "",
            "subcategory": "",
            "title": "",
            "summary": "",
            "detailedSummary": "",
            "distractions": [
              {
                "startTime": "1:15 AM",
                "endTime": "1:18 AM",
                "title": "",
                "summary": ""
              }
            ],
            "appSites": {
              "primary": "",
              "secondary": "
            }
          }
        ]
````

(The unbalanced quote after `"secondary": "` is present in the source; harmless since
responseSchema governs output. Reproduce or fix at your discretion.)

**categoriesSection(descriptors)** builder:

- Empty list → `USER CATEGORIES: No categories configured. Use consistent labels based on the
  activity story.`
- Else lines:
  - `USER CATEGORIES (choose exactly one label):`
  - `{i}. "{name}" — {description}` for each (description omitted when blank; idle category
    with blank description gets `Use when the user is idle for most of this period.`)
  - If an idle category exists: `Only use "{idleName}" when the user is idle for more than half
    of the timeframe. Otherwise pick the closest non-idle label.`
  - `Return the category exactly as written. Allowed values: [{"A", "B", ...}].`

**Request body**: `contents: [{parts: [{text: prompt}]}]`, generationConfig
`{ temperature: 0.3, maxOutputTokens: 65536, responseMimeType: "application/json",
responseSchema: cardSchema }` where:

```json
cardSchema = {
  "type": "ARRAY",
  "items": {
    "type": "OBJECT",
    "properties": {
      "startTime": {"type": "STRING"}, "endTime": {"type": "STRING"},
      "category": {"type": "STRING"}, "subcategory": {"type": "STRING"},
      "title": {"type": "STRING"}, "summary": {"type": "STRING"},
      "detailedSummary": {"type": "STRING"},
      "distractions": {"type": "ARRAY", "items": {
        "type": "OBJECT",
        "properties": {
          "startTime": {"type": "STRING"}, "endTime": {"type": "STRING"},
          "title": {"type": "STRING"}, "summary": {"type": "STRING"}},
        "required": ["startTime", "endTime", "title", "summary"],
        "propertyOrdering": ["startTime", "endTime", "title", "summary"]}},
      "appSites": {
        "type": "OBJECT",
        "properties": {"primary": {"type": "STRING"}, "secondary": {"type": "STRING"}},
        "required": [],
        "propertyOrdering": ["primary", "secondary"]}
    },
    "required": ["startTime","endTime","category","subcategory","title","summary","detailedSummary"],
    "propertyOrdering": ["startTime","endTime","category","subcategory","title","summary",
                          "detailedSummary","distractions","appSites"]
  }
}
```

**Outer loop** (`maxRetries = 4`):

1. Request (operation `"generate_activity_cards"`) → parse JSON array of cards (distractions and
   appSites optional per item).
2. `normalizeCards`: category matched case-insensitively (trimmed) against descriptor names; the
   literal labels `idle` / `idle time` map to the idle category; otherwise fall back to the
   FIRST descriptor's name.
3. **Validation A — time coverage** (only if existingCards non-empty): convert every card's
   times to minutes-from-midnight (handles both `h:mm a` and `MM:SS`; +24 h on rollover), merge
   overlapping/adjacent input ranges (adjacency slack 1 min), drop output cards shorter than
   0.1 min, then walk each merged input range verifying it is covered by output ranges with
   **3-minute flexibility** at boundaries (safety cap 10,000 iterations; forced ≥0.01-min
   progress). Uncovered spans longer than 3 min → invalid, error text
   `Missing coverage for time segments: {list}` plus a dump of input/output cards
   (`📥 INPUT CARDS:` / `📤 OUTPUT CARDS:` numbered lists).
4. **Validation B — durations**: every card except the last must be ≥ 10 minutes; error
   `Card {n} '{title}' is only {x.x} minutes long`.
5. On validation failure: capture `captureValidationFailure` (validationType `time_coverage` /
   `duration`) and retry with an **enhanced prompt** =

   ```
   {basePrompt}

   PREVIOUS ATTEMPT FAILED - CRITICAL REQUIREMENTS NOT MET:

   {error blocks}

   Please fix these issues and ensure your output meets all requirements.
   ```

   where the error blocks are:

   ```
   TIME COVERAGE ERROR:
   {coverageError}

   You MUST ensure your output cards collectively cover ALL time periods from the input cards. Do not drop any time segments.
   ```
   and/or
   ```
   DURATION ERROR:
   {durationError}

   REMINDER: All cards except the last one must be at least 10 minutes long. Please merge short activities into longer, more meaningful cards that tell a coherent story.
   ```
   Sleep 1 s between validation retries.
6. On thrown errors: model fallback for capacity codes; else classify & backoff; on
   non-validation errors reset to the base prompt. All 4 attempts exhausted → GeminiError#999.

### 6.7 generateText (plain)

`generationConfig { temperature: 0.7, maxOutputTokens: 8192 (default param) }`, body
`contents:[{parts:[{text: prompt}]}]`. Retry loop maxRetries 4 with model fallback + classify /
backoff. Returns trimmed `candidates[0].content.parts[0].text`. HTTP ≥ 400 → GeminiError with
parsed `error.message`; parse failure → GeminiError#7.

### 6.8 Debug logging helpers

`truncate(text, max=2000)`: clipping is DISABLED unless UserDefaults bool `geminiDebugClipLogs`
is set (defaults to full payloads). `logGeminiFailure(context, attempt?, response?, data?,
error?)` prints status, request id header (`X-Goog-Request-Id` / `x-request-id`), content type,
error object breakdown, body snippet. `logCallDuration(op, seconds, status?)` prints
`⏱️ [Gemini] {op} {s}s status={code}`.

---

## 7. Gemini prompt preferences

Users may override the three card-prompt sections. Stored as JSON
(`{titleBlock?, summaryBlock?, detailedBlock?}`) under UserDefaults key
`geminiPromptOverrides`. Composition rule: a non-blank override string *fully replaces* the
default block; blank/absent → default.

### 7.1 Default title block (verbatim)

```
Titles
Each title is a memory trigger. Be specific enough that it could only describe one situation.
"Bug fixes" could be anything. "Fixed the infinite scroll crash on search results" can only be one thing.
"Gaming session" could be any day. "League ARAM — Thresh and Jinx" is a specific session.

Use honest verbs
The verb matters. Pick the one that describes what actually happened, not the one that sounds most professional.
If someone was browsing a product page and picking options, they were "speccing out" a purchase — not "configuring" it (that implies they already own it). If someone scheduled a meeting, they "scheduled" it — not "coordinated" it. If someone was scrolling a feed, they were "scrolling" — not "catching up on industry news."
The wrong verb changes the memory. Get it right even if it sounds less impressive.

Accuracy over polish
Don't compress what happened into a technical-sounding phrase that loses the meaning. If the actual bug was "the notification wasn't showing up after regeneration," say that — don't abstract it into "verification pipeline error" because it sounds more engineered.
The title's job is to be TRUE and SPECIFIC, not to sound smart. When in doubt, describe the actual problem or action in plain language.

Titles can be longer
A title that's a few words longer but triggers a real memory beats a short vague one every time. Don't trim useful detail for brevity. Aim for roughly 5–15 words — but if word 12 is the one that makes you remember, keep it.

Banned words
These are corporate filler. No human writes them in a journal:
"research," "coordination," "management," "administration," "workflow," "sync," "alignment," "exploration," "investigation," "project development," "social chat," "various," "multiple," "several," "deep dive," "rabbit hole"
Don't just avoid these exact words — avoid the energy. "Analyzing" is just "research" in a lab coat. "Refining" is just "working on" trying to sound important. "Coordinated" is "scheduled" wearing a tie. If you wouldn't say it out loud to a friend, it's too formal.

Examples

BAD: "Debugging issues" → GOOD: "Tracked down the Stripe webhook timeout"
BAD: "Housing search and social media browsing" → GOOD: "Found a 2BR on Elm Street on Zillow"
BAD: "Meeting coordination" → GOOD: "Scheduled coffee with Priya for Thursday"
BAD: "Tech news and social media browsing" → GOOD: "Reading about the new Pixel launch on X"
BAD: "Gaming session and social chat" → GOOD: "Overwatch ranked — hit Diamond with Sara"
BAD: "Subscription management" → GOOD: "Downgraded my Spotify to free tier"
BAD: "Project development and code review" → GOOD: "Reviewed Jake's auth PR"
BAD: "Financial research and subscription management" → GOOD: "Talked to Marcus about REIT picks"

Multiple activities
Just describe what happened naturally. Use commas, "and," "+," "between" — whatever reads well. Vary the structure so titles don't all sound the same.

"Fixing the login redirect between YouTube and Reddit breaks"
"Texted Priya about Saturday, caught up on NFL draft news"
"Postgres migration + updated the Terraform config"
"Poking at the CORS bug (mostly distracted)"

If one activity is clearly the main thing, just name that one. The rest goes in the summary.

Final check

Could this title describe 100 different situations? → Too vague, add the specific detail.
Would a human actually write this? → If it sounds corporate, rewrite it.
Will this bring back a specific memory? → If not, name the concrete thing.
Is the verb honest? → Does it describe what actually happened, or a fancier version of it?
```

### 7.2 Default summary block (verbatim)

```
## Summary

2-3 sentences max. First person without "I". Just state what happened.

Good:
- "Refactored the auth module in React, added OAuth support. Hit CORS issues with the backend API."
- "Designed landing page mockups in Figma. Exported assets and started building it in Next.js."
- "Searched flights to Tokyo, coordinated dates with Evan and Anthony over Messages. Looked at Shibuya apartments on Blueground."

Bad:
- "Kicked off the morning by diving into design work before transitioning to development tasks." (filler, vague)
- "Started with refactoring before moving on to debugging some issues." (wordy, no specifics)
- "The session involved multiple context switches between different parts of the application." (says nothing)

Never use:
- "kicked off", "dove into", "started with", "began by"
- Third person ("The session", "The work")
- Mental states or assumptions about why the person did something
```

### 7.3 Default detailed-summary block (verbatim)

```
## Detailed Summary

This is the "show me exactly what happened" view. Every app, every switch, every action.

Format each line as:
[H:MM AM/PM] - [H:MM AM/PM]: [specific action] [in app/tool] [on what]

Include:
- Specific file/document names when visible
- Page titles, tabs, search queries
- Actions: opened, edited, scrolled, searched, replied, watched
- Content context: what topic, what section, who you messaged

Good example:
"7:00 AM - 7:08 AM: edited "Q4 Launch Plan" in Notion, added timeline section
7:08 AM - 7:10 AM: replied to Mike in Slack #engineering
7:10 AM - 7:12 AM: scrolled X home feed
7:12 AM - 7:18 AM: back to Notion, wrote launch risks section
7:18 AM - 7:20 AM: searched Google "feature flag best practices"
7:20 AM - 7:25 AM: read LaunchDarkly docs
7:25 AM - 7:30 AM: added feature flag notes to Notion doc"

Bad example:
"7:00 AM - 7:30 AM writing Notion doc
7:30 AM - 7:35 AM: Slack
7:35 AM - 8:00 AM coding"
(Too coarse — what doc? which Slack channel? coding what?)

The goal: someone could reconstruct exactly what you did just from the detailed summary.
```

---

## 8. GemmaBackupProvider

Silent fallback when Gemini fails (§3.4). Same API key. Uses **inline base64 images** instead of
the Files API.

### 8.1 Constants

- Base URL: `https://generativelanguage.googleapis.com/v1beta/models`
- Default model: **`gemma-4-31b-it`**
- Endpoint: `{base}/{model}:generateContent?key={apiKey}`, POST, JSON, timeout 120 s.
- `screenshotInterval` constant 10 s (used for raw-frame fallback durations).
- No retry inside `callGenerateContent` (single attempt per call; retries live in callers).
- Every call logged via LLMLogger with provider `"gemma"`; request body logging is disabled for
  image-bearing calls (`logRequestBody:false` for describe_frames).

### 8.2 Transcription flow

1. Sort screenshots; duration = last − first captured.
2. Sample `min(15, count)` evenly (stride = `count / targetSamples`, min 1).
3. Load each screenshot: downscale so max(w, h) ≤ **1280 px**, JPEG quality **0.7**, base64.
4. **Describe frames** — one call with prompt + all images inline
   (`{"inline_data": {"mime_type": "image/jpeg", "data": base64}}` parts, temperature 0.2,
   maxOutputTokens 2048, operation `gemma.describe_frames`). On ANY failure, retry in
   **batches of 5** frames.
5. Map returned `{frames:[{index, description}]}` back by 1-based index within the request;
   drop empties (if all empty, emit placeholders with empty descriptions).
6. **Segmentation**: if total duration > 20 min, split frame descriptions at the midpoint and
   run segmentation on each half (second half timestamps rebased to 0, then re-offset), each
   with `targetSegments = 1`. Else single call with targetSegments 1.
7. Segment call: operation `gemma.segment_frames`, temperature 0.2, maxOutputTokens 2048,
   maxAttempts 2. Convert segments to observations (timestamp tolerance **5 s**, gap warning
   > 60 s, `llmModel = model`). Observation count must EQUAL targetSegments else error; coverage
   `< 0.8` throws SegmentCoverageError. On exhaustion (either error type) → fall back to
   **1 observation per frame description** (each spanning `screenshotInterval`, clamped by next
   frame and video duration; +timeOffset).

**Frame description prompt** (verbatim; `{frameCount}` injected):

```
You are a precise activity logger analyzing screenshots from a screen recording. For each screenshot, describe EXACTLY what the user is doing with hyper-specific detail.

REQUIRED DETAILS FOR EACH FRAME:
1. EXACT APP/SITE: Name the specific application (e.g., "VS Code", "Xcode", "Safari on twitter.com", "Terminal running npm")
2. SPECIFIC ACTION: What is the user actively doing? (e.g., "typing code", "reading article", "scrolling feed", "debugging error", "running command")
3. VISIBLE CONTENT: What specific content is shown? (e.g., "Swift function called fetchUserData", "PostHog dashboard showing DAU chart", "Google search for 'tokyo restaurants'")
4. UI STATE: Any relevant UI details (e.g., "error dialog visible", "loading spinner", "dropdown menu open", "cursor in search bar")

BAD (too vague): "User is using a code editor"
GOOD (specific): "VS Code with Swift file AuthManager.swift open, cursor on line 45 inside fetchToken() function, yellow warning on line 42"

BAD: "User is browsing the web"
GOOD: "Safari on tabelog.com restaurant page for 'Haidilao Shibuya', scrolling through reviews section, 4.2 star rating visible"

Output ONLY valid JSON:
{
  "frames": [
    {"index": 1, "description": "Hyper-specific description"},
    {"index": 2, "description": "Hyper-specific description"}
  ]
}

Analyze these {frameCount} screenshots with maximum specificity:
```

**Segment prompt** (verbatim; `{durationString}` MM:SS, `{targetSegments}`, `{framesText}` =
lines `- MM:SS: description`):

```
Create an activity log from {durationString} of screen recording.

Frame descriptions:
{framesText}

TARGET: Create EXACTLY {targetSegments} segment(s). Not more, not less.

MERGING RULES (CRITICAL):
- Same app + same activity = ONE segment (even if 10+ minutes)
- Same game session = ONE segment (don't split by in-game events)
- Same video = ONE segment (don't split by video timestamps)
- Same conversation = ONE segment (don't split by messages)
- Quick app switches serving same goal = ONE segment

FORBIDDEN SEGMENTS:
- "Transition" or "Shifted focus" segments (just end previous, start next)
- Segments under 2 minutes (merge with adjacent)
- Segments describing nothing specific

DESCRIPTION FORMAT:
"[App]: [Specific task] - [key details: files, URLs, names, outcomes]"

GOOD: "YouTube: Watching 'Ninja CREAMi: Pacojet Killer?' review by Chris Young, evaluating ice cream makers"
GOOD: "Kingdom Two Crowns: Playing snowy biome campaign, building settlement, survived multiple nights (+100 coins rewards)"
BAD: "Transition: Shifted from YouTube to restaurant search" (FORBIDDEN)
BAD: "YouTube: Watching video" then "YouTube: Continued watching" (should be ONE segment)

Output JSON only:
{"segments": [{"start": "00:00", "end": "MM:SS", "description": "..."}]}
```

### 8.3 Card generation flow

If observations span > 20 min, split at midpoint into two slices and generate a card for each;
else one card. For each slice, `appendCard`:

1. `generateSummary` (below) then `generateTitle` from that summary.
2. Build card: times = `h:mm a` of first obs start / last obs end; category normalized (same
   rule as Gemini §6.6 step 2); subcategory `""`; detailedSummary `""`; distractions null.
3. Merge-with-previous heuristics (identical to Ollama §9.6): skip merge if previous card
   already ≥ 40 min; skip if gap > 5 min; skip if combined span > 60 min; else ask the model
   `checkShouldMerge`; if merge approved AND merged span ≤ 60 min, replace last card with the
   LLM-merged card, else append.

**Summary prompt** (verbatim; observations as `[{start} - {end}]: {text}` lines; category lines
`{i}. "{name}" — {desc}` with idle default `Use when the user is idle for most of the period.`;
`{allowedValues}` = quoted names comma-joined). Call params: temperature 0.3, maxOutputTokens
1024, operation `gemma.generate_summary`, maxAttempts 3 with appended failure line
`PREVIOUS ATTEMPT FAILED — Respond with ONLY the JSON object described above. Ensure it contains
apps, people, main_task, summary, category, and app_sites.`:

```
First extract key information, then summarize.

Observations:
{observationsText}

Step 1 - Extract from the text:
- Apps/sites used: (list exact names)
- People mentioned: (list names)
- Main task: (one phrase)
- Secondary activities: (brief list)

Step 2 - Choose EXACTLY ONE category from the list below. Use the label exactly as written.
{categoryLines}
Allowed values: [{allowedValues}]

Step 3 - Identify appSites from the observations.
Rules:
- primary: canonical domain/product path of the main app used
- secondary: another meaningful app or enclosing app (like browser)
- Format: lower-case, no protocol, no query or fragments
- Be specific (docs.google.com over google.com)
- If unknown, use null

Step 4 - Write 2-3 sentence summary focusing on main task, using extracted names. first person, without "I".

Return JSON:
{
  "apps": ["app1", "app2"],
  "people": ["person1"],
  "main_task": "what they primarily did",
  "summary": "2-3 sentence summary using exact names",
  "category": "one of the allowed values above",
  "app_sites": {"primary": "domain.com", "secondary": "domain.com"}
}
```

**Title prompt** (verbatim; `{summary}` injected; temperature 0.3, maxOutputTokens 256,
operation `gemma.generate_title`, maxAttempts 3 with
`PREVIOUS ATTEMPT FAILED — Respond with ONLY the JSON object described above.`):

```
Create a title for the given summary

SUMMARY: "{summary}"

TITLE GUIDELINES
Core principle: If you read this title next week, would you know what you actually did?
Be specific, but concise:
Every title needs concrete details. Name the actual thing—the show, the person, the feature, the file, the game. But keep it scannable—aim for roughly 5-10 words. Extra details belong in the summary.

Bad: "Watched videos" → Good: "The Office bloopers on YouTube"
Bad: "Worked on UI" → Good: "Fixed navbar overlap on mobile"
Bad: "Had a call" → Good: "Call with James about venue options"
Bad: "Did research" → Good: "Comparing gyms near the new apartment"
Bad: "Debugged issues" → Good: "Tracked down Stripe webhook failures"
Bad: "Played games" → Good: "Civilization VI — finally beat Deity difficulty"
Bad: "Browsed YouTube" → Good: "Veritasium video on turbulence"
Bad: "Chatted with team" → Good: "Slack debate about monorepo vs multirepo"
Bad: "Made a reservation" → Good: "Booked Nobu for Saturday 7pm"
Bad: "Coded" → Good: "Built CSV export for transactions"

Don't overload the title:
If you're using em-dashes, parentheses, or listing 3+ things—you're probably cramming summary content into the title.

Bad: "Apartment hunting — Zillow listings in Brooklyn, StreetEasy saved searches, and broker fee research"
Good: "Apartment hunting in Brooklyn"
Bad: "Weekly metrics review — signups, churn rate, MRR growth, and cohort retention"
Good: "Weekly metrics review"
Bad: "Call with Mom — talked about Dad's birthday, her knee surgery, and Aunt Linda's visit"
Good: "Call with Mom"

Avoid vague words:
These words hide what actually happened:

"worked on" → doing what to it?
"looked at" → reviewing? debugging? reading?
"handled" → fixed? ignored? escalated?
"dealt with" → means nothing
"various" / "some" / "multiple" → name them or pick the main one
"deep dive" / "rabbit hole" → just say what you researched
"sync" / "aligned" / "circled back" → say what you discussed or decided
"browsing" / "iterations" / "analytics" → what specifically?

Avoid repetitive structure:
Don't start every title with a verb. Mix it up naturally:

"Fixed the infinite scroll bug on search results"
"Breaking Bad rewatch — season 3 finale"
"Call with recruiter about the Stripe role"
"AWS cost spike investigation"
"Planning the bachelor party itinerary"
"Stardew Valley — finished the community center"
"iPhone vs Pixel camera comparison for Mom"
"Morning coffee + Hacker News catch-up"

If several titles in a row start with "Fixed... Debugged... Built... Reviewed..." — vary the structure.
Use "and" sparingly:
Don't use "and" to connect unrelated things. Pick the main activity for the title; the rest goes in the summary.

Bad: "Fixed bug and replied to emails" → Good: "Fixed pagination crash" (emails in summary)
Bad: "YouTube then coded" → Good: "Built the settings modal" (YouTube is a distraction)
Bad: "Read articles, watched TikTok, checked Discord" → Good: "Scattered browsing" (it was scattered, just say that)

"And" is okay when both parts serve the same goal:

OK: "Designed and prototyped the onboarding flow"
OK: "Researched and booked the Airbnb in Lisbon"
OK: "Drafted and sent the investor update"

When it's genuinely scattered:
If there was no main focus—just bouncing between tabs—don't force a fake throughline:

"YouTube and Twitter browsing"
"Scattered browsing break"
"Catching up on Reddit and Discord"

Before finalizing: would this title help you remember what you actually did?

Return JSON:
{"title": "single-activity title"}
```

**Merge-check prompt** (verbatim; temperature 0.2, max 256, operation `gemma.merge_check`,
maxAttempts 3; merge requires `combine == true && confidence >= 0.85`):

```
Are these two activities part of the SAME task or DIFFERENT tasks?

PREVIOUS ({prev.startTime} - {prev.endTime}):
{prev.title}

NEXT ({new.startTime} - {new.endTime}):
{new.title}

SAME TASK (combine=true, confidence 0.85+):
- Continuing the exact same work
- Same project AND same type of work
- Would naturally be one story

DIFFERENT TASKS (combine=false):
- Different projects
- Different mental modes (coding vs browsing vs gaming)
- Context switch happened

Return JSON:
{"combine": true/false, "confidence": 0.0-1.0, "reason": "why"}
```

**Merge-cards prompt** (verbatim; temperature 0.2, max 512, operation `gemma.merge_cards`,
maxAttempts 3). Result card: start = prev.start, end = new.end, category = prev.category,
subcategory "", detailedSummary "", distractions = prev.distractions, appSites =
prev.appSites ?? new.appSites:

```
Combine these two cards into one.

CARD 1 ({prev.startTime} - {prev.endTime}): {prev.title}
{prev.summary}

CARD 2 ({new.startTime} - {new.endTime}): {new.title}
{new.summary}

Create ONE title and summary for the full period.
Title: 5-8 words, main throughline, past tense verb
Summary: 2-3 sentences

Return JSON:
{"title": "merged title", "summary": "merged summary"}
```

JSON parsing everywhere is lenient: direct decode, else extract substring between first `{` and
last `}` and decode that.

---

## 9. OllamaProvider / LocalEngine

One provider class serves three engines, all speaking the **OpenAI-compatible
chat-completions API**:

```ts
type LocalEngine = "ollama" | "lmstudio" | "custom";
// default base URLs: ollama http://localhost:11434, lmstudio http://localhost:1234,
// custom http://localhost:11434
```

### 9.1 Configuration (UserDefaults)

- `llmLocalEngine`: `"ollama" | "lmstudio" | "custom"` (default ollama).
- `llmLocalBaseURL`: base URL (may already contain `/v1` or the full
  `/v1/chat/completions` path).
- `llmLocalModelId`: model id; fallback default = recommended preset's id for the engine.
- `llmLocalAPIKey`: only for `custom` engine.
- Auth header: LM Studio → always `Authorization: Bearer lm-studio`; custom with a key →
  `Authorization: Bearer {key}`; ollama → none.

### 9.2 Endpoint normalization (`LocalEndpointUtilities.chatCompletionsURL`)

Given the base URL: collapse duplicate `/`, strip trailing `/`; if path is empty or `/` →
`/v1/chat/completions`; if path already ends with `/v1/chat/completions` → keep; if ends with
`/v1` → append `/chat/completions`; otherwise append `/v1/chat/completions`. (Supports e.g.
`https://openrouter.ai/api/v1`.)

### 9.3 Model presets

```ts
type LocalModelPreset = "qwen3_vl_4b" (recommended) | "qwen25_vl_3b";
// model ids:
//  qwen3_vl_4b:  ollama/custom "qwen3-vl:4b",   lmstudio "Qwen3-VL-4B-Instruct"
//  qwen25_vl_3b: ollama/custom "qwen2.5vl:3b",  lmstudio "qwen2.5-vl-3b-instruct"
// pull commands: "ollama pull qwen3-vl:4b" / "ollama pull qwen2.5vl:3b"
// LM Studio download URLs:
//  https://model.lmstudio.ai/download/lmstudio-community/Qwen3-VL-4B-Instruct-GGUF
//  https://model.lmstudio.ai/download/lmstudio-community/Qwen2.5-VL-3B-Instruct-GGUF
```

Preset persisted under `llmLocalModelPreset`; upgrade-banner dismissal under
`llmLocalModelUpgradeDismissed`.

### 9.4 Chat API mechanics

Request shape (`POST {chatCompletionsURL}`, JSON, timeout **60 s**):

```json
{
  "model": "<savedModelId>",
  "messages": [
    {"role": "system", "content": [{"type": "text", "text": "..."}]},   // text-only calls
    {"role": "user", "content": [
        {"type": "text", "text": "<prompt>"},
        {"type": "image_url", "image_url": {"url": "data:image/jpeg;base64,<b64>"}}  // vision calls
    ]}
  ],
  "temperature": 0.7,
  "max_tokens": 4000,
  "stream": false
}
```

Response: `{ choices: [{ message: { content: string } }] }`.

Retry: `maxRetries` attempts (default 3; **1** for describe_frame) with backoff
`2^attempt * 2` s (2, 4, 8). Non-200 → NSError OllamaProvider#4 with body text. Every attempt
LLMLogger-logged with provider = actual engine string (`ollama`/`lmstudio`/`custom`); for
`describe_frame` the request body is NOT persisted (avoids base64 blobs in SQLite).

Text-only helper (`callTextAPI`) sets system prompt:
- expectJSON → `You are a helpful assistant. Always respond with valid JSON.`
- else → `You are a helpful assistant.`
temperature 0.7, max_tokens 4000 (8192 for daily recap via param).

### 9.5 Transcription (phase 1)

1. Sort screenshots; sample ~**15** evenly spaced (stride = `count / 15`, min 1).
2. `durationSeconds` = last sampled − first sampled captured time.
3. For each sampled screenshot: load & downscale to max height **720 px** (JPEG quality
   **0.85**; if already ≤ 720 px tall, send file bytes as-is), base64, and call
   **describe_frame** with the image (1 attempt, failures skip the frame):

   Frame-description prompt (verbatim):

   ```
   Describe what you see on this computer screen in 1-2 sentences.
   Focus on: what application/site is open, what the user is doing, and any relevant details visible.
   Be specific and factual.

   GOOD EXAMPLES:
   ✓ "VS Code open with index.js file, writing a React component for user authentication."
   ✓ "Gmail compose window writing email to client@company.com about project timeline."
   ✓ "Slack conversation in #engineering channel discussing API rate limiting issues."

   BAD EXAMPLES:
   ✗ "User is coding" (too vague)
   ✗ "Looking at a website" (doesn't identify which site)
   ✗ "Working on computer" (completely non-specific)
   ```

4. If zero descriptions → OllamaProvider#11
   `"Failed to describe any screenshots. Please check that Ollama/LMStudio is running."`
5. **Segment merge** (`segment_video_activity`, expectJSON, maxAttempts 2). Prompt (verbatim;
   `{n}` frame count, `{durationString}` MM:SS, `{formattedDescriptions}` lines
   `[MM:SS] description`):

   ```
   You have {n} snapshots from a {durationString} screen recording.

   CRITICAL TASK: Group these snapshots into EXACTLY 2-5 coherent segments that collectively explain {durationString} of activity. Brief interruptions (< 2 minutes) should be absorbed into the surrounding segment.

   <thinking>
   Draft how you'll group the snapshots before you answer. Decide where the natural breaks occur and ensure the full video is covered.
   </thinking>

   Here are the snapshots (timestamp → description):
   {formattedDescriptions}

   Respond with a JSON object using this exact shape:
   {
     "reasoning": "Use this space to think through how you're going to construct the segments",
     "segments": [
       {
         "startTimestamp": "MM:SS",
         "endTimestamp": "MM:SS",
         "description": "Natural language summary of what happened"
       }
     ]
   }

   HARD REQUIREMENTS:
   - "segments" MUST contain between 2 and 5 items.
   - Every timestamp must stay within 00:00 and {durationString}.
   - Segments should cover at least 80% of the video (ideally 100%) without inventing events.
   - Merge small gaps instead of creating tiny standalone segments.
   - Never output additional text outside the JSON object.
   ```

   Lenient decode: object with `segments`, bare array, or extracted `{...}` / `[...]`
   substrings.
6. Convert segments → observations: timestamp tolerance **30 s** (out-of-range segments are
   skipped with a log, not fatal); warn on gaps > 60 s; empty → OllamaProvider#11
   (`"Screenshots failed to process - check Ollama/LMStudio logs or report a bug."`); more than
   **5** observations → OllamaProvider#13; coverage = Σsegment/duration, warn if > 1.2.
7. Coverage `< 0.8` → SegmentCoverageError; retry once with appended block:

   ```
   PREVIOUS ATTEMPT FAILED — Your segments only covered {p}% of the {durationString} video.
   Merge adjacent snapshots or extend segment boundaries so the segments cover at least 80% of the runtime without inventing events.
   ```
   (other errors get the generic appended block:
   `PREVIOUS ATTEMPT FAILED — The response was invalid (error: {msg}). Respond with ONLY the JSON
   object described above. Ensure it contains a "reasoning" string and a "segments" array with
   2-5 items covering at least 80% of the video.`)
   Analytics on coverage failure: `captureValidationFailure(provider:"ollama",
   operation:"segment_video_activity", validationType:"coverage", …)`.
8. Retries exhausted → **fallback**: one observation per frame description (start = frame
   timestamp, end = min(start + screenshotInterval, next frame, duration)). If even frame
   descriptions are empty → OllamaProvider#11 with the "local AI is currently down…consider
   switching to Gemini" message.

### 9.6 Card generation (phase 2) — multi-step

Uses `context.batchObservations` (NOT the sliding-window observations). Observations text is
pre-processed by `stripUserReferences`: remove `The user` / `A user` (case-insensitive) to fight
third-person leakage.

1. **generateSummary** (`generate_summary`, expectJSON, maxAttempts 3, enhanced retry appends
   `PREVIOUS ATTEMPT FAILED — The response was invalid (error: {msg}). Respond with ONLY the
   JSON object described above. Ensure it contains "reasoning", "summary", "category", and
   "app_sites" fields.`). Prompt (verbatim; `{observationsText}` = `[{start} - {end}]: {text}`
   joined by blank lines; `{summaryBlock}` = §9.8 or user override; `{categoriesSection}` =
   `- "{name}" — {desc}` lines; `{allowedValues}` quoted names comma-joined; `{languageBlock}`
   per §5):

   ```
   You are analyzing someone's computer activity from the last 15 minutes.

   Activity periods:
   {observationsText}

     Create a summary that captures what happened during this time period.

   {summaryBlock}

   CATEGORIES:
   Choose exactly one:
   {categoriesSection}

   APP SITES (Website Logos)
   Identify the main app or website used for this period. Output the canonical DOMAIN, not the app name.
   - primary: canonical domain of the main app/website used.
   - secondary: another meaningful app used, if relevant.
   - Format: lower-case, no protocol, no query or fragments.
   - Use product subdomains/paths when canonical (e.g., docs.google.com).
   - If you cannot determine a secondary, omit it.
   - Do not invent brands; rely on evidence from observations.

     REASONING:
     Explain your thinking process:
     1. What were the main activities and how much time was spent on each?
     2. Was this primarily work-related, personal, or brief distractions?
     3. Which category best fits based on the MAJORITY of time and focus?
     4. How did you structure the summary to capture the most important activities?

   {languageBlock}

   Return JSON:
   {
     "reasoning": "Your step-by-step thinking process",
     "summary": "Your 2-3 sentence summary",
     "category": "{allowedValues}",
     "app_sites": {"primary": "domain.com", "secondary": "domain.com"}
   }
   ```

2. **generateTitle** (`generate_title`, plain text, maxAttempts 3). Prompt = titleBlock (§9.8
   or override) + languageBlock (non-JSON) + `OBSERVATIONS:` + `- {observation}` lines. Response
   normalization: first line, strip wrapping quotes, strip leading `title:` prefix. Empty →
   retry with appended `PREVIOUS ATTEMPT FAILED — … Respond with ONLY the title text on a single
   line. Do not include JSON or quotes.`
3. Build initial card (start/end from first/last observation, subcategory "", detailedSummary
   "", distractions null, appSites from summary response after trimming/nulling empties;
   category normalized as in §6.6).
4. Merge-with-last-existing-card decision tree:
   - last existing card duration **≥ 40 min** → append (no merge attempt);
   - gap between last card end and new card start **> 5 min** → append;
   - combined span **> 60 min** → append;
   - else **checkShouldMerge** (`evaluate_card_merge`, expectJSON, maxAttempts 3). Prompt
     (verbatim):

     ```
     Decide if two consecutive activity cards should be merged.

     Previous activity ({prev.startTime} - {prev.endTime}):
     Title: {prev.title}
     Summary: {prev.summary}

     New activity ({new.startTime} - {new.endTime}):
     Title: {new.title}
     Summary: {new.summary}

     Merge ONLY if they clearly describe the same ongoing task or intent.
     - Tool/app switches are allowed if they support the same goal (e.g., doc writing + research).
     - Do NOT merge if there’s a context switch to a different intent (social feed, chat, video, gaming, email, shopping, unrelated reading).
     - If unsure, do NOT merge.

     Return JSON only:
     {"combine": true/false, "reason": "1 short sentence explaining the decision"}

     EXAMPLES (5):

     1) MERGE
     Prev: "Drafted onboarding doc in Google Docs. Looked up API details in the Stripe docs."
     New:  "Continued the onboarding doc, then cross-checked examples in Stripe docs."
     → {"combine": true, "reason": "Same intent: onboarding doc + supporting research."}

     2) MERGE
     Prev: "Analyzed retention curves in Claude. Adjusted questions for clarity."
     New:  "Kept refining retention metrics in Claude and Notion."
     → {"combine": true, "reason": "Same intent: retention analysis across tools."}

     3) MERGE
     Prev: "Fixed React auth bug in VS Code. Ran local tests."
     New:  "Validated the auth fix in Postman and added notes to the PR."
     → {"combine": true, "reason": "Same task: auth fix and verification."}

     4) DON'T MERGE
     Prev: "Reviewed VC blog post on trohan.com."
     New:  "Watched League of Legends stream and chatted on Messenger."
     → {"combine": false, "reason": "Different intent: research vs entertainment/chat."}

     5) DON'T MERGE
     Prev: "Drafted email reply about product launch."
     New:  "Scrolled X.com and watched a YouTube clip."
     → {"combine": false, "reason": "Context switch to social/video."}
     ```

   - if merge approved → **mergeTwoCards** (`merge_cards`, expectJSON, maxAttempts 3); if the
     merged card would exceed 60 min, append the new card instead of using the merge.
     Merged card fields: start = prev.start, end = new.end (chronological — never re-parse
     times, avoids midnight bugs); category/subcategory/detailedSummary/distractions from prev;
     appSites = prev ?? new. Merge prompt (verbatim, note `{languageInstructionJSON}` = §5 JSON
     instruction or empty):

     ```
     Create a single activity card that covers both time periods.

     Activity 1 ({prev.startTime} - {prev.endTime}):
     Title: {prev.title}
     Summary: {prev.summary}

     Activity 2 ({new.startTime} - {new.endTime}):
     Title: {new.title}
     Summary: {new.summary}

     Create a unified title and summary that covers the entire period from {prev.startTime} to {new.endTime}.
     Title rules (use ONLY the titles and summaries above):
     - 5-10 words, natural and specific, single line
     - Choose the dominant activity (most time), not necessarily the first
     - Ignore brief interruptions (<3 minutes) mentioned in the summaries
     - Include a second activity only if both take ~5+ minutes
     - If 3+ unrelated activities appear, output exactly: "Scattered apps and sites"
     - Prefer proper nouns/topics (Bookface, Claude, League of Legends, Paul Graham, etc.)
     - Never use: worked on, looked at, handled, various, some, multiple, browsing, browse, multitasking, tabs, brief, quick, short
     - Do NOT use the word "browsing"; use "scrolling" or "reading" instead
     - Avoid long lists; no more than one conjunction
     - In the JSON below, the "title" field must contain only the title text (no extra labels or quotes)
     Summary: Two sentences max, first-person perspective without using the word I. Retell how the work flowed from the first card into the second with concrete verbs (debugged, reviewed, watched) and name the stand-out tools/topics once each. Skip laundry lists, filler like “various tasks,” and bullet points.
     Avoid the words social, media, platform, platforms, interaction, interactions, various, engaged, blend, activity, activities.
     Do not refer to the user; write from the user’s perspective.

     {languageInstructionJSON}

       GOOD EXAMPLES:
       Card 1: Customer interviews wrap-up + Card 2: Insights deck synthesis
       Merged Title: Shaped customer story for insights deck
       Merged Summary: Logged interview quotes into Airtable. Highlighted the strongest themes and molded them into the insights deck outline.

       Card 1: QA-ing mobile release + Card 2: Answering support tickets
       Merged Title: Balanced mobile QA while clearing support
       Merged Summary: Ran through the iOS smoke checklist in TestFlight. Hopped into Help Scout to close the urgent tickets.

       BAD EXAMPLES:
       ✗ Title: Coding, gaming, and Swift fixes with AI tools and Dayflow (comma list trying to cover everything)
       ✗ Title: Busy afternoon session (too vague)
       ✗ Summary: Worked on several things across platforms (generic, missing specifics)
       ✗ Summary that omits a named site/app/topic from the inputs
       ✗ Summary longer than three sentences or formatted as bullet points

     Return JSON:
     {
       "title": "Merged title",
       "summary": "Merged summary"
     }
     ```

5. Return `context.existingCards` with the new/merged card appended/replaced, plus a combined
   `LLMCall` log (input `"Two-pass activity card generation"`, output = step logs joined with
   `\n\n---\n\n`).

`generateText(prompt, maxTokens=4000)`: plain callTextAPI, operation `generate_text`.

### 9.7 Ollama error code registry (used by human-error mapping §3.6)

1 invalid duration; 2 frame processing; 4 connection/API failure; 8/9/10 unexpected response;
11 no activities / local AI down; 12 not enough analyzed / parse fails; 13 too many segments;
14 merge parse; 15 invalid endpoint URL; 16 no observations for cards.

### 9.8 Ollama default prompt blocks (user-overridable, key `ollamaPromptOverrides`)

Same override mechanics as §7 (JSON `{summaryBlock?, titleBlock?}`; non-blank replaces default).

**Default summaryBlock** (verbatim):

```
        SUMMARY GUIDELINES:
        - Write in first person without using "I" (like a personal journal entry)
        - 2-3 sentences maximum
        - Include specific details (app names, search topics, etc.)
        - Natural, conversational tone

        GOOD EXAMPLES:
        "Managed Mac system preferences focusing on software updates and accessibility settings. Browsed Chrome searching for iPhone wireless charging info while
        checking Twitter and Slack messages."

        "Configured GitHub Actions pipeline for automated testing. Quick Slack check interrupted focus, then back to debugging deployment issues."

        "Researched React performance optimization techniques in Chrome, reading articles about useMemo patterns. Switched between documentation tabs and took notes in
         Notion about component re-rendering."

        "Updated Xcode project dependencies and resolved build errors in SwiftUI views. Tested app on simulator while responding to client messages about timeline
        changes."

        "Browsed Instagram and TikTok while listening to Spotify playlist. Responded to personal messages on WhatsApp about weekend plans."

        "Researched vacation destinations on travel websites and compared flight prices. Checked weather forecasts for different cities while reading travel reviews."

        BAD EXAMPLES:
        - "The user did various computer activities" (too vague, wrong perspective, never say the user)
        - "I was working on my computer doing different tasks" (uses "I", not specific)
        - "Spent time on multiple applications and websites" (generic, no details)
```

**Default titleBlock** (verbatim):

```
      Write one activity title for a 15-minute window using ONLY the observations.
      Rules:
      - 5-10 words, natural and specific, single line
      - Choose the dominant activity (most time), not necessarily the first
      - Ignore brief interruptions (<3 minutes)
      - Include a second activity only if both take ~5+ minutes
      - If 3+ unrelated activities appear, output exactly: "Scattered apps and sites"
      - Prefer proper nouns/topics (Bookface, Claude, League of Legends, Paul Graham, etc.)
      - Never use: worked on, looked at, handled, various, some, multiple, browsing, browse, multitasking, tabs, brief, quick, short
      - Do NOT use the word "browsing"; use "scrolling" or "reading" instead
      - Avoid long lists; no more than one conjunction
      - Return only the title text (no quotes, no JSON)
```

---

## 10. DayflowBackendProvider

Thin HTTP client for Dayflow's **proprietary hosted backend** (prompting/model logic lives
server-side — nothing to port beyond the wire protocol). Consider skipping on Windows unless
you have backend access; document below is complete for the client side.

- Default endpoint `https://web-production-f3361.up.railway.app` (resolution order in §3.1).
- All requests: `POST`, `Content-Type: application/json`, `Accept: application/json`,
  `Authorization: Bearer {token}`.
- Auth tokens:
  * transcribe / generate-cards: **DayflowAuthManager session token** (OS keychain, §12).
  * daily generation: **legacy PostHog distinct-id** via `AnalyticsService.backendAuthToken()`
    — intentionally NOT the session token (source comment: "Daily intentionally uses the legacy
    PostHog distinct-id token contract").

### 10.1 `POST /v1/dayflow/transcribe`

Request:

```json
{
  "screenshots": [{ "captured_at": 1712345678, "image_base64": "<jpeg b64>" }, ...],
  "batch_start_time": "2025-01-15T18:00:00.000Z",   // ISO8601 w/ fractional seconds
  "batch_id": 42
}
```

Screenshots downscaled to max height 720 px, JPEG 0.85, sorted ascending by capture time.
Response:

```json
{
  "observations": [{ "start_ts": ..., "end_ts": ..., "observation": "...",
                     "metadata": null, "llm_model": "...", "batch_id": 42 }],
  "provider": "…", "model": "…",
  "log": { "timestamp": "ISO8601", "latency_seconds": 1.2, "input": "…", "output": "…" }
}
```

Non-2xx → error `"Transcription failed ({status}): {body}"`. Analytics
`backend_transcription_request_{started,succeeded,failed}`.

### 10.2 `POST /v1/dayflow/generate-cards`

Request:

```json
{
  "observations": [{ "start_ts": ..., "end_ts": ..., "observation": "...",
                     "metadata": null, "llm_model": null, "batch_id": 42 }],
  "existing_cards": [ /* ActivityCardData[], camelCase field names as in §1.2 */ ],
  "categories": [{ "name": "...", "description": "...", "is_idle": false }],
  "batch_id": 42,
  "preferred_output_language": "Spanish" | null,
  "timezone": "America/New_York"
}
```

Response: `{ "cards": ActivityCardData[], "provider", "model", "log": {…} }`. Analytics
`activity_card_generation_request_{started,succeeded,failed}`.

### 10.3 `POST /v1/daily`

Request (see §11 for how texts are built):

```json
{
  "day": "2025-01-15",
  "cards_text": "…", "observations_text": "…",
  "prior_daily_text": "…", "preferences_text": "{\"blockers_title\":…}",
  "preferred_output_language": null
}
```

Response: `{ "day": "...", "highlights": [..], "unfinished": [..], "blockers": [..] }`.
Analytics `daily_generation_request_{started,succeeded,failed}`.

### 10.4 `generateText` — unsupported (always throws; see §3.5).

---

## 11. Daily Recap

### 11.1 Provider enum (`dailyRecapProvider_v1`)

`"dayflow" | "local" | "gemini" | "chatgpt" | "claude" | "none"`. First-run migration: if
`isDailyUnlocked` → dayflow; else map from main provider (geminiDirect→gemini,
dayflowBackend→dayflow, ollamaLocal→local, chatGPTClaude→claude/chatgpt by
`chatCLIPreferredTool`). Display metadata: gemini = "Gemini 3.5 Flash"
(model `gemini-3.5-flash`), chatgpt = "GPT-5.4" (codex CLI, model `gpt-5.4`), claude =
"Claude Opus" (claude CLI, model `opus`), local = current local model id.

Availability checks: dayflow always available; local requires `ollamaSetupComplete` flag OR
both `llmLocalBaseURL`+`llmLocalModelId` set; gemini requires stored key; chatgpt/claude require
the respective CLI on PATH (login-shell probe).

### 11.2 What it generates

A `DailyStandupDraft` stored as a JSON blob keyed by logical day (`daily_standups` table):

```ts
interface DailyStandupDraft {
  highlightsTitle: string;              // "Yesterday's highlights"
  highlights: { id: string; text: string }[];
  tasksTitle: string;                   // "Today's tasks"
  tasks: { id: string; text: string }[];
  blockersTitle: string;                // "Blockers"
  blockersBody: string;                 // newline-joined
  generation?: {
    provider: DailyRecapProvider;
    runtime: string;                    // "dayflow_backend"|"local_llm"|"gemini_direct"|"chat_cli"|"disabled"
    modelOrTool?: string;
    sourceDay?: string;                 // which day's data was summarized
    generatedAt?: Date;
  };
}
```

Placeholder drafts exist for: not generated, today-not-generated, insufficient history, and
no-provider-selected states (exact strings in DailyRecapModels; e.g.
`"Daily data has not been generated yet. If this is unexpected, please report a bug."`,
`"Today's daily recap will be generated tomorrow morning."`,
`"Not enough captured activity in the previous 3 days to generate a standup."`,
`"No Daily provider is selected. Click the gear button above, then choose a provider to turn
recap generation back on."`).

### 11.3 Generation paths

- **dayflow**: builds `cards_text`, `observations_text`, `prior_daily_text` (up to 3 prior
  standup JSON payloads, each rendered `Day {day}:\n{payloadJSON}` joined by blank lines),
  `preferences_text` (sorted-key JSON of the three section titles) and calls `POST /v1/daily`.
  Maps `highlights→highlights`, `unfinished→tasks`, `blockers→blockersBody` (each normalized:
  trimmed, deduped, empties dropped). Empty everything → `emptyGeneratedContent` error.
- **gemini**: `GeminiDirectProvider` (preference forced to primary flash35),
  `generateText(prompt, maxOutputTokens: 8192)`.
- **local**: `OllamaProvider.generateText(prompt, maxTokens: 8192)`.
- **chatgpt**: codex CLI, model `gpt-5.4`, tools disabled.
- **claude**: claude CLI, model `opus`, tools disabled.
- **none**: throws `noProviderSelected`.

All non-dayflow paths share one prompt and one output contract:

`makeLocalPrompt(day, cards)` =

```
{localPrompt}

You only have timeline cards for this day. The log is incomplete by nature, so prefer omission over guessing.

Activity log:

{cardsText}

{languageSection}

## Output format

Return ONLY valid JSON, no markdown fences, no preamble. Use this exact schema:

{
  "done": ["first bullet", "second bullet", "..."],
  "next": "one sentence or null"
}

Return exactly one JSON object and nothing before or after it.
```

`{languageSection}` = `## Language\n\n{instruction}` when set (§5, JSON variant), else empty.

`cardsText` format:

```
Timeline activities for {day}:

1. {h:mmam} - {h:mmpm}: {title-or-summary}
   {summary if different}
2. …
```
(empty → `No timeline activities were recorded for {day}.`)

`observations_text` (dayflow only) similar: `Observations for {day}:` then
`{h:mmam} - {h:mmpm}: {text}` lines.

**localPrompt** (verbatim):

```
# Daily Recap Prompt

You are the person whose activity log this is, writing a quick end-of-day recap for yourself.
Your future self doesn't need a diary. You need the 3-5 things that actually moved the needle today so you can look back and know what happened.

Read the log, find the real accomplishments, and write them up the way you'd tell a friend: "here's what I actually got done today."

## Selection rules

- Put 0 to 5 items in "done" based on evidence quality.
- Do NOT pad to reach 5. If only two things were genuinely meaningful, return two.
- If nothing high-confidence exists, return an empty "done" array.

## What counts as an accomplishment

An accomplishment is something that has a clear before and after. You finished it, decided it, figured it out, or made something real. Anything where the state of the world changed because of what you did.

Examples across roles:
- A founder closed a conversation, sent a launch, locked in a positioning decision.
- A student finished a problem set, nailed down a thesis argument, submitted an application.
- A designer shipped a comp, got approval on a flow, resolved a UX question with evidence.
- An engineer fixed a bug, landed a feature, unblocked a dependency.

Not accomplishments: browsing, reading without a takeaway, meetings that ended without a decision, half-started tasks with no checkpoint.

## Writing rules

- Each item: one sentence, 8-20 words max. If it's over 20, split or trim.
- Lead with what changed or what you decided, not the process of getting there.
- Write like a real person. Plain, direct, no filler.
- Banned words: leverage, surface, actionable, facilitate, optimize (unless literally about an optimizer), deep-dive, synergy, align (unless about visual alignment).
- If something sounds like a consultant or a report generator wrote it, rewrite it in your own words.
- Use only evidence from the log. Do not invent or assume details.
- Name concrete things: the pricing page, the midterm essay, the onboarding flow, the partner deal. Not vague categories.
- Include a number when it adds real signal (a metric, count, %, dollar amount, word count). If the log has a useful number, use it. Don't force one in.
- If a useful number from the log matters, include it in the bullet.

## What to skip

- Browsing, entertainment, social media scrolling, side distractions.
- Low-signal process noise: "build succeeded," "synced files," "opened app."
- Tool and workflow internals your future self won't care about: file names, class names, git/PR activity, IDE details, batch IDs.
- Don't mention AI tools by name (Claude, ChatGPT, Cursor, Copilot) unless the work was explicitly about that tool. The accomplishment is the output, not the tool.
- No em dashes. No hype. No self-praise.

## Tomorrow / next section

- Include "next" (exactly 1 item) only when the log shows a specific task that was clearly started but unfinished, or a concrete next step explicitly discussed or planned during the day.
- Do not speculate. If nothing in the log points to a specific carryover task, set "next" to null.
- The bar: could you point to a specific moment in the log where this next step was set up? If not, leave it out.

## Examples

Good bullets:
- "Fixed the webhook retry bug that was dropping ~12% of partner callbacks."
- "Finished the pricing page FAQ and got sign-off from Lisa."
- "Narrowed the signup drop-off to the email verification step, 41% abandon rate."
- "Submitted the constitutional law essay, 2,800 words."
- "Locked in the 'automatic work journal' positioning after testing five alternatives."
- "Got verbal yes from the Acme partnership, sending the agreement tomorrow."
- "Finalized the onboarding flow redesign, down from 7 screens to 4."

Bad bullets and why:
- "Updated AuthService.swift and pushed three commits." -> Implementation details nobody needs.
- "Surfaced conversion leakage insights and drafted actionable recommendations." -> Consultant-speak. What did you actually find?
- "Spent a focused session analyzing churn patterns to derive strategic retention insights." -> Describes the process, not the result. What did the analysis show?
- "Did some research on competitors." -> Too vague. What did you learn? What did you decide?
- "Had a productive brainstorm with the team." -> What came out of it?
```

**Response parsing** (`parseLocalResponse`):
1. Trim; if it contains `---END_THINKING---` keep only text after it; strip markdown code
   fences (leading ```` ``` ```` line and trailing `\n``` `).
2. Extract the first balanced `{...}` (string/escape aware); fall back to the whole cleaned
   text.
3. JSON parse; failure → `invalidJSONResponse` (error message embeds the raw output).
4. `done`: array (or scalar) → trimmed, deduped, "null" strings dropped, capped at **5**.
   `next`: null/NSNull → null; array → first usable; scalar → trimmed.
5. Must contain key `done` or `next` else `invalidResponseShape`.
6. `done` → highlights bullets; `next` → single tasks bullet (or empty); blockersBody = "".
   No content at all → `emptyGeneratedContent`.

### 11.4 DailyRecapScheduler

Background timer service:

- Check interval: every **5 minutes** (+ an immediate check on start). Re-entrancy guarded.
- Preconditions per check: UserDefaults `isDailyUnlocked` true; local hour ≥ **4**
  (recaps generate after 4 AM); no standup already stored for the current **logical day**
  (day boundary at 4 AM local).
- **Source day selection**: walk back 1..**3** days before the target day's start; skip days
  already consumed (any stored standup whose `generation.sourceDay` matches); require
  ≥ **180 minutes** of timeline activity that day; first hit wins. None → skip silently.
- Inputs: timeline cards for the source day; observations + up to **3** prior standups +
  preferences ONLY when provider is dayflow (`usesDayflowInputs`); section titles hard-coded
  "Yesterday's highlights" / "Today's tasks" / "Blockers".
- Provider gating: `canGenerate` false → analytics skip event reason `no_provider_selected`;
  availability false → reason `provider_unavailable`.
- On success: encode draft JSON, save keyed by the **target** day, verify readback (failure
  reason `db_save_verification_failed`), capture `daily_auto_generation_succeeded`, and
  schedule a "daily recap ready" OS notification.
- On failure: capture `daily_auto_generation_failed` with `failure_reason:"api_error"` +
  error details (message capped at 500 chars).
- Analytics event names: `daily_auto_generation_check_started`,
  `daily_auto_generation_check_skipped`, `daily_auto_generation_payload_built`,
  `daily_auto_generation_succeeded`, `daily_auto_generation_failed`; all carry
  `daily_provider`, `daily_provider_label`, `daily_runtime`, `daily_model_or_tool`, `trigger`
  (`startup`/`interval`), `target_day`, `source_day`.

---

## 12. Keychain / secret storage

macOS Keychain generic passwords; on Windows use Credential Manager or DPAPI-encrypted store
with equivalent identifiers.

**KeychainManager** (API keys):
- Service: `com.teleportlabs.dayflow.apikeys.{provider}`; Account: `{provider}`.
- Known provider ids: **`"gemini"`** (the only one referenced by the AI layer; the API supports
  arbitrary ids like `"dayflow"`).
- Accessibility: when-unlocked. `store` deletes-then-adds; `delete` succeeds if not found;
  `exists` = retrieve != null. Thread-safe via a serial queue.
- ⚠️ The Swift implementation logs the key's length and **first 8 characters** to console on
  every retrieve — do NOT replicate that on Windows.

**DayflowAuthManager session token** (used as Bearer token for backend transcribe/cards):
- Service: `com.teleportlabs.dayflow.auth`; Account: `session_token`.

**Daily generation token**: PostHog analytics distinct-id (not keychain-based) — see §10.

---

## 13. GeminiAPIHelper

Connection tester used by settings UI.

- `POST https://generativelanguage.googleapis.com/v1beta/models/gemini-3.5-flash:generateContent?key={apiKey}`
- Body: `contents:[{parts:[{text:"Please respond with exactly: Hi from Gemini!"}]}]`,
  generationConfig `{ temperature: 0.1, maxOutputTokens: 100 }`.
- Empty key → `invalidAPIKey`. 401/403 → `invalidAPIKey` (or `apiError(message)` when the body
  has `error.message`). Other non-200 → `networkError(message | "Status code: N")`. Success =
  return `candidates[0].content.parts[0].text`. Logs through LLMLogger with operation
  `test_connection`.

---

## 14. Dashboard chat

Rich chat over the user's timeline data. `LLMService.generateChatStreaming` routes: provider
`gemini` → GeminiDirectProvider function-calling loop (below); `codex`/`claude` → CLI
provider (out of scope). Missing Gemini key yields an error event + throw
(`"Gemini is not configured. Add your Gemini API key in Settings > Providers."`, code 1101).

### 14.1 Constants

- Model: **`gemini-3.1-flash-lite`** (fixed).
- Endpoints: `…/models/{model}:generateContent` and `…/models/{model}:streamGenerateContent`
  (`?alt=sse&key=…` for streaming). Timeout 180 s.
- Max tool rounds: **20** (exceeding → error code 901 `"The assistant exceeded the maximum
  tool-call rounds. Please try a narrower query."`).
- Timeline payload soft limit: **800,000 bytes** (when exceeded, `detailedSummary` fields are
  stripped from the tool response and `truncated:true` set).

### 14.2 Request body

```json
{
  "contents": [ { "role": "user"|"model", "parts": [ {"text": …} | functionCall/functionResponse parts ] } ],
  "tools": [ { "functionDeclarations": [ …see 14.3… ] } ],
  "toolConfig": { "functionCallingConfig": { "mode": "AUTO" } },
  "generationConfig": {
    "temperature": 0.2,
    "maxOutputTokens": 8192,
    "thinkingConfig": { "thinkingLevel": "medium" }   // omitted on fallback, see 14.5
  },
  "systemInstruction": { "parts": [ {"text": "<system instruction>"} ] }   // when non-blank
}
```

History mapping: user→`"user"`, assistant→`"model"`; each turn one text part.

### 14.3 Tool declarations (verbatim descriptions)

```json
[
  { "name": "fetchTimeline",
    "description": "Fetch timeline cards for a single day or date range. Returns structured JSON cards including day, time range, title, summary, category, and optional detailed summaries.",
    "parameters": { "type": "OBJECT", "properties": {
      "date":      {"type": "STRING", "description": "Single day in YYYY-MM-DD format."},
      "startDate": {"type": "STRING", "description": "Range start date in YYYY-MM-DD."},
      "endDate":   {"type": "STRING", "description": "Range end date in YYYY-MM-DD."},
      "includeDetailedSummary": {"type": "BOOLEAN", "description": "When true (default), include detailedSummary. Set false for very large windows."},
      "limit":     {"type": "NUMBER", "description": "Optional row cap. If omitted, returns all matching rows."}}}},
  { "name": "fetchObservations",
    "description": "Fetch raw observations for a single day or date range. Returns structured JSON grouped by day, with each day's observations ordered chronologically.",
    "parameters": { "type": "OBJECT", "properties": {
      "date":      {"type": "STRING", "description": "Single day in YYYY-MM-DD format."},
      "startDate": {"type": "STRING", "description": "Range start date in YYYY-MM-DD."},
      "endDate":   {"type": "STRING", "description": "Range end date in YYYY-MM-DD."},
      "limit":     {"type": "NUMBER", "description": "Optional row cap. If omitted, returns all matching rows."}}}}
]
```

### 14.4 Tool execution semantics (local, against SQLite)

- Args validation: either `{date}` OR `{startDate, endDate}` — never both
  (`"Provide either {date} OR {startDate, endDate}."`); dates `yyyy-MM-dd`
  (`"Invalid date format '{v}'. Use YYYY-MM-DD."`); `startDate <= endDate`
  (`"startDate must be less than or equal to endDate."`). Day bounds run **4 AM → next-day
  4 AM local**.
- `fetchTimeline` response object: `{ request:{mode,date,startDate,endDate,
  includeDetailedSummary,limit}, summary, itemCount, truncated, items:[{day,startTime,endTime,
  title,summary,category,subcategory,distractionsCount,appSites?,detailedSummary?}] }`.
  Summary text: `Fetched N timeline card(s) for {display date}.` +
  ` Detailed summaries were omitted due to payload size.` when truncated. Display date formats:
  single `EEE, MMM d`; range `MMM d to MMM d`.
- `fetchObservations` response: `{ request:{…,limit}, summary, dayCount, itemCount,
  truncated:false, items:[{day, observations:[{startTime,endTime,observation}]}] }` grouped by
  4 AM-boundary day, times `h:mm a`. Summary
  `Fetched N observation(s) for {dates} across D day(s).`
- Unknown tool → `{ summary:"Unknown tool '{name}'.", error:{code:"unknown_tool", …} }`;
  validation failures → `{ summary: msg, error:{code:"validation_error", message} }`.
- Arg coercion helpers accept strings/numbers/bools loosely (`"true"/"1"/"yes"` etc.); limits
  must be positive ints.

### 14.5 Loop & streaming

```
contents = history
rounds = 0
while rounds < 20:
  turn = runTurnWithFallback(contents)
  if turn has no functionCalls: yield complete(turn.text); return
  rounds++
  contents.push({role:"model", parts: turn.modelFunctionCallParts})  // VERBATIM parts —
      // preserves fields like thought_signature that must be replayed
  for each call: yield toolStart("{name} {argsJSON}") ; result = execute(call);
      yield toolEnd(result.summary, exitCode = result.error?1:0);
      responseParts.push({functionResponse:{name, response: result}})
  contents.push({role:"user", parts: responseParts})
throw code 901
```

`runTurnWithFallback`: try SSE stream (attempt 1, thinkingConfig on) → on failure, if the error
message mentions thinkingConfig/thinkingLevel/generationConfig/invalid-enum (and domain matches
or code 400) drop thinkingConfig → try SSE again → on failure fall back to non-streaming
generateContent.

SSE handling: accumulate `data:` lines until a blank line, then parse the joined payload; the
payload may be a JSON object, JSON array, line-delimited JSON, or concatenated objects (a
brace-matching extractor handles the last case); `[DONE]` ignored. For each chunk object with
`candidates[0].content.parts`: text parts are aggregated; delta = suffix after the previously
seen candidate text (or the whole text if not a prefix-extension); yield `textDelta` only while
no function calls seen. Function-call parts are deduped by fingerprint
`{name}|{sortedArgsJSON}`; `args` may arrive as an object or a JSON string.

---

## 15. UserDefaults key registry

| Key | Meaning |
|---|---|
| `llmProviderType` | JSON-encoded LLMProviderType |
| `selectedLLMProvider` | canonical id mirror / legacy migration source |
| `llmLocalBaseURL` | local engine base URL |
| `llmLocalEngine` | `ollama`/`lmstudio`/`custom` |
| `llmLocalModelId` | local model id |
| `llmLocalAPIKey` | custom-engine bearer key (plain UserDefaults!) |
| `llmLocalModelPreset` / `llmLocalModelUpgradeDismissed` | preset tracking |
| `ollamaSetupComplete` | local onboarding done |
| `chatCLIPreferredTool` | `codex`/`claude` |
| `llmBackupProviderId` / `llmBackupChatCLITool` | timeline backup provider |
| `geminiSelectedModel_v3` | JSON GeminiModelPreference |
| `geminiPromptOverrides` | JSON prompt block overrides (§7) |
| `ollamaPromptOverrides` | JSON prompt block overrides (§9.8) |
| `llmOutputLanguageOverride` | output language (§5) |
| `geminiDebugClipLogs` | opt-IN debug log clipping |
| `timelineFailureToastLastShownDay` | toast throttle day string |
| `dayflowBackendURLOverride` | backend endpoint override |
| `dailyRecapProvider_v1` | daily recap provider |
| `isDailyUnlocked` | daily recap feature gate |
| `screenshotIntervalSeconds` | capture interval (default 10) |

## 16. Analytics event registry

`analysis_batch_started|completed|failed`, `transcription_returned_empty`,
`llm_api_call` (per HTTP attempt), `llm_model_fallback`, `llm_fallback_used` (gemma),
`llm_timeline_fallback_attempted|succeeded|failed`, `llm_timeline_backup_unavailable`,
`llm_timeline_failure_toast_shown`, `captureValidationFailure` helper (provider, operation,
validationType, attempt, model, batchId, errorDetail), `backend_transcription_request_*`,
`activity_card_generation_request_*`, `daily_generation_request_*`,
`daily_auto_generation_*`.

---

## 17. Porting notes & surprises

1. **Gemini never sees raw video from disk** — screenshots are composited into a 1 fps
   "compressed timeline" mp4 (1 screenshot = 1 s; 720p H.264 ~1.2 Mbps, 10 s keyframes), and
   the model's MM:SS timestamps are multiplied by the screenshot interval (default ×10) to
   recover real time. Use ffmpeg on Windows.
2. **longBackoff comment vs code**: the source comments say rate-limit backoff is
   "30s, 60s, 120s" but `delayForStrategy` actually returns `min(3, attempt+1)` seconds
   (1s/2s/3s). This spec mandates the code behavior; revisit if you want true long backoff.
3. **Ollama merge cap comment vs code**: comment says "Don't even try to merge if the last card
   is already 25+ minutes" but the code checks `>= 40` minutes. Code wins.
4. **Forward-looking model names**: `gemini-3.5-flash`, `gemini-3.1-flash-lite`,
   `gemma-4-31b-it`, `gpt-5.4`, claude `opus` — copy them as config values, not hard-coded
   truths.
5. **HTTP 503 salvage**: Gemini sometimes streams a complete JSON payload then closes with 503;
   the transcribe path extracts the first balanced JSON object from the error body and treats a
   valid candidate as success. Worth porting — it materially reduces failed batches.
6. **Three-layer fallback** for the timeline pipeline when primary = Gemini:
   model fallback (flash → flash-lite on 403/404/429/503) → provider-internal Gemma fallback
   (sticky per batch, marks cards backup-generated) → user-configured backup provider (also
   sticky for the rest of the batch).
7. **Two different auth tokens for the same backend**: transcribe/cards use the keychain session
   token; `/v1/daily` deliberately uses the PostHog distinct-id ("legacy contract").
8. **Empty transcription is a success**: 0 observations marks the batch analyzed and skips card
   generation entirely — don't treat it as an error.
9. **Card phase input asymmetry**: providers receive the full 45-minute sliding-window
   observations as the first argument, but `context.batchObservations` only contains the new
   batch. Gemini uses the window observations; Ollama/Gemma use `context.batchObservations`.
   Preserve this asymmetry.
10. **Prompt override system**: users can wholesale replace the Gemini title/summary/detailed
    blocks and Ollama title/summary blocks via UserDefaults JSON — port it, it's a first-class
    settings feature.
11. **Keychain logging leak**: the macOS code prints the first 8 chars of the API key on every
    retrieve. Don't replicate.
12. **The trailing `"secondary": "` in the Gemini card prompt's example JSON is malformed** in
    the original source (missing closing quote). Harmless due to structured output; keep or fix.
13. **A 4th provider exists** (`chatGPTClaude` driving `codex`/`claude` CLI subprocesses with
    JSONL streaming, PTY allocation, session resume) — deliberately excluded from this spec's
    deep-dive but referenced by routing, daily recap ("gpt-5.4"/"opus"), and dashboard chat.
14. **`stripUserReferences`** hack in OllamaProvider (removes "The user"/"A user" from
    observations before summarization) exists to stop third-person leakage — keep it until
    observation prompts are fixed.
15. **All wall-clock strings** use `h:mm a` with the POSIX/en-US locale and the *local*
    timezone; logical days run 4 AM → 4 AM. Keep formatting locale-pinned or card time math
    (which re-parses these strings) will break.
