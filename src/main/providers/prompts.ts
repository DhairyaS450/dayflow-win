// Prompt builders — ported from the MIT-licensed Dayflow macOS app.
// The macOS menu-bar guidance is adapted for Windows per the porting spec.

import { settings } from '../lib/settings'
import type { TimelineCategory } from '../../shared/types'

export interface GeminiPromptOverrides {
  titleBlock?: string
  summaryBlock?: string
  detailedBlock?: string
}

export interface OllamaPromptOverrides {
  summaryBlock?: string
  titleBlock?: string
}

// ---------- Output language ----------

export function outputLanguage(): string | null {
  const v = settings.get<string>('llmOutputLanguageOverride', '').trim()
  if (!v || v.toLowerCase() === 'english') return null
  return v
}

const VERBATIM_CLAUSE =
  'If any rule requires an exact English phrase (e.g., "Scattered apps and sites"), keep it verbatim.'

export function languageInstruction(forJSON: boolean): string {
  const lang = outputLanguage()
  if (!lang) return ''
  if (forJSON) {
    return `The user only speaks ${lang}. Respond in ${lang}, but keep JSON keys in English exactly as specified. ${VERBATIM_CLAUSE}`
  }
  return `The user only speaks ${lang}. Respond in ${lang}. ${VERBATIM_CLAUSE}`
}

// ---------- Transcription prompt (Gemini) ----------

export function transcriptionPrompt(durationString: string): string {
  return `Screen Recording Transcription (Reconstruct Mode)
Watch this screen recording and create an activity log detailed enough that someone could reconstruct the session.
CRITICAL: This video is exactly ${durationString} long. ALL timestamps must be within 00:00 to ${durationString}. No gaps.
Identifying the active app: On Windows, the app name is usually shown in the window's title bar and on its taskbar button. Check this FIRST to identify which app is being used. Do NOT guess — read the actual name from the title bar. If you can't read it clearly, describe it generically (e.g., "code editor," "browser," "messaging app") rather than guessing a specific product name. Common code editors like Cursor, VS Code, and Visual Studio all look similar but have different names in the title bar.
For each segment, ask yourself:
"What EXACTLY did they do? What SPECIFIC things can I see?"
Capture:
- Exact app/site names visible (check the title bar for the app name)
- Exact file names, URLs, page titles
- Exact usernames, search queries, messages
- Exact numbers, stats, prices shown
Bad: "Checked email"
Good: "Gmail: Read email from boss@company.com 'RE: Budget approval' - replied 'Looks good'"
Bad: "Browsing Twitter"
Good: "Twitter/X: Scrolled feed - viewed posts by @pmarca about AI, @sama thread on GPT-5 (12 tweets)"
Bad: "Working on code"
Good: "Editing StorageManager.ts in [exact app name from title bar] - fixed type error on line 47, changed string to string | null"
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
]`
}

// ---------- Card generation prompt (Gemini) ----------

const DEFAULT_TITLE_BLOCK = `Titles
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
Is the verb honest? → Does it describe what actually happened, or a fancier version of it?`

const DEFAULT_SUMMARY_BLOCK = `## Summary

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
- Mental states or assumptions about why the person did something`

const DEFAULT_DETAILED_BLOCK = `## Detailed Summary

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

The goal: someone could reconstruct exactly what you did just from the detailed summary.`

export function geminiPromptBlocks(): { title: string; summary: string; detailed: string } {
  const overrides = settings.get<GeminiPromptOverrides>('geminiPromptOverrides', {})
  const pick = (override: string | undefined, fallback: string): string => {
    const v = override?.trim()
    return v && v.length > 0 ? override! : fallback
  }
  return {
    title: pick(overrides.titleBlock, DEFAULT_TITLE_BLOCK),
    summary: pick(overrides.summaryBlock, DEFAULT_SUMMARY_BLOCK),
    detailed: pick(overrides.detailedBlock, DEFAULT_DETAILED_BLOCK)
  }
}

export function categoriesSection(categories: TimelineCategory[]): string {
  if (categories.length === 0) {
    return 'USER CATEGORIES: No categories configured. Use consistent labels based on the activity story.'
  }
  const lines: string[] = ['USER CATEGORIES (choose exactly one label):']
  categories.forEach((c, i) => {
    const desc =
      c.details?.trim() ||
      (c.isIdle ? 'Use when the user is idle for most of this period.' : '')
    lines.push(desc ? `${i + 1}. "${c.name}" — ${desc}` : `${i + 1}. "${c.name}"`)
  })
  const idle = categories.find((c) => c.isIdle)
  if (idle) {
    lines.push(
      `Only use "${idle.name}" when the user is idle for more than half of the timeframe. Otherwise pick the closest non-idle label.`
    )
  }
  lines.push(
    `Return the category exactly as written. Allowed values: [${categories.map((c) => `"${c.name}"`).join(', ')}].`
  )
  return lines.join('\n')
}

export function cardGenerationPrompt(
  existingCardsString: string,
  transcriptText: string,
  categories: TimelineCategory[]
): string {
  const blocks = geminiPromptBlocks()
  const lang = languageInstruction(true)
  const languageBlock = lang ? `\n\n${lang}` : ''
  return `# Timeline Card Generation

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

${blocks.title}

---

${blocks.summary}

---

${blocks.detailed}
${languageBlock}

---

## Category

${categoriesSection(categories)}

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
Previous cards: ${existingCardsString}
New observations: ${transcriptText}
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
              "secondary": ""
            }
          }
        ]`
}

// ---------- Ollama (local) prompt blocks ----------

const OLLAMA_DEFAULT_SUMMARY_BLOCK = `        SUMMARY GUIDELINES:
        - Write in first person without using "I" (like a personal journal entry)
        - 2-3 sentences maximum
        - Include specific details (app names, search topics, etc.)
        - Natural, conversational tone

        GOOD EXAMPLES:
        "Managed system preferences focusing on software updates and accessibility settings. Browsed Chrome searching for iPhone wireless charging info while
        checking Twitter and Slack messages."

        "Configured GitHub Actions pipeline for automated testing. Quick Slack check interrupted focus, then back to debugging deployment issues."

        "Researched React performance optimization techniques in Chrome, reading articles about useMemo patterns. Switched between documentation tabs and took notes in
         Notion about component re-rendering."

        "Updated project dependencies and resolved build errors. Tested the app while responding to client messages about timeline changes."

        "Browsed Instagram and TikTok while listening to Spotify playlist. Responded to personal messages on WhatsApp about weekend plans."

        "Researched vacation destinations on travel websites and compared flight prices. Checked weather forecasts for different cities while reading travel reviews."

        BAD EXAMPLES:
        - "The user did various computer activities" (too vague, wrong perspective, never say the user)
        - "I was working on my computer doing different tasks" (uses "I", not specific)
        - "Spent time on multiple applications and websites" (generic, no details)`

const OLLAMA_DEFAULT_TITLE_BLOCK = `      Write one activity title for a 15-minute window using ONLY the observations.
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
      - Return only the title text (no quotes, no JSON)`

export function ollamaPromptBlocks(): { summary: string; title: string } {
  const overrides = settings.get<OllamaPromptOverrides>('ollamaPromptOverrides', {})
  const pick = (override: string | undefined, fallback: string): string => {
    const v = override?.trim()
    return v && v.length > 0 ? override! : fallback
  }
  return {
    summary: pick(overrides.summaryBlock, OLLAMA_DEFAULT_SUMMARY_BLOCK),
    title: pick(overrides.titleBlock, OLLAMA_DEFAULT_TITLE_BLOCK)
  }
}

export function ollamaFrameDescriptionPrompt(): string {
  return `Describe what you see on this computer screen in 1-2 sentences.
Focus on: what application/site is open, what the user is doing, and any relevant details visible.
Be specific and factual.

GOOD EXAMPLES:
✓ "VS Code open with index.js file, writing a React component for user authentication."
✓ "Gmail compose window writing email to client@company.com about project timeline."
✓ "Slack conversation in #engineering channel discussing API rate limiting issues."

BAD EXAMPLES:
✗ "User is coding" (too vague)
✗ "Looking at a website" (doesn't identify which site)
✗ "Working on computer" (completely non-specific)`
}

export function ollamaSegmentPrompt(
  frameCount: number,
  durationString: string,
  formattedDescriptions: string
): string {
  return `You have ${frameCount} snapshots from a ${durationString} screen recording.

CRITICAL TASK: Group these snapshots into EXACTLY 2-5 coherent segments that collectively explain ${durationString} of activity. Brief interruptions (< 2 minutes) should be absorbed into the surrounding segment.

<thinking>
Draft how you'll group the snapshots before you answer. Decide where the natural breaks occur and ensure the full video is covered.
</thinking>

Here are the snapshots (timestamp → description):
${formattedDescriptions}

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
- Every timestamp must stay within 00:00 and ${durationString}.
- Segments should cover at least 80% of the video (ideally 100%) without inventing events.
- Merge small gaps instead of creating tiny standalone segments.
- Never output additional text outside the JSON object.`
}

export function ollamaSummaryPrompt(
  observationsText: string,
  categories: TimelineCategory[]
): string {
  const blocks = ollamaPromptBlocks()
  const catLines = categories
    .map((c) => {
      const desc =
        c.details?.trim() || (c.isIdle ? 'Use when the user is idle for most of the period.' : '')
      return `- "${c.name}" — ${desc}`
    })
    .join('\n')
  const allowed = categories.map((c) => `"${c.name}"`).join(', ')
  const lang = languageInstruction(true)
  return `You are analyzing someone's computer activity from the last 15 minutes.

Activity periods:
${observationsText}

  Create a summary that captures what happened during this time period.

${blocks.summary}

CATEGORIES:
Choose exactly one:
${catLines}

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

${lang}

Return JSON:
{
  "reasoning": "Your step-by-step thinking process",
  "summary": "Your 2-3 sentence summary",
  "category": "${allowed}",
  "app_sites": {"primary": "domain.com", "secondary": "domain.com"}
}`
}

export function ollamaTitlePrompt(observations: string[]): string {
  const blocks = ollamaPromptBlocks()
  const lang = languageInstruction(false)
  return `${blocks.title}
${lang ? `\n${lang}\n` : ''}
OBSERVATIONS:
${observations.map((o) => `- ${o}`).join('\n')}`
}

export function ollamaMergeCheckPrompt(
  prev: { startTime: string; endTime: string; title: string; summary: string },
  next: { startTime: string; endTime: string; title: string; summary: string }
): string {
  return `Decide if two consecutive activity cards should be merged.

Previous activity (${prev.startTime} - ${prev.endTime}):
Title: ${prev.title}
Summary: ${prev.summary}

New activity (${next.startTime} - ${next.endTime}):
Title: ${next.title}
Summary: ${next.summary}

Merge ONLY if they clearly describe the same ongoing task or intent.
- Tool/app switches are allowed if they support the same goal (e.g., doc writing + research).
- Do NOT merge if there's a context switch to a different intent (social feed, chat, video, gaming, email, shopping, unrelated reading).
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
→ {"combine": false, "reason": "Context switch to social/video."}`
}

export function ollamaMergeCardsPrompt(
  prev: { startTime: string; endTime: string; title: string; summary: string },
  next: { startTime: string; endTime: string; title: string; summary: string }
): string {
  const lang = languageInstruction(true)
  return `Create a single activity card that covers both time periods.

Activity 1 (${prev.startTime} - ${prev.endTime}):
Title: ${prev.title}
Summary: ${prev.summary}

Activity 2 (${next.startTime} - ${next.endTime}):
Title: ${next.title}
Summary: ${next.summary}

Create a unified title and summary that covers the entire period from ${prev.startTime} to ${next.endTime}.
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
Summary: Two sentences max, first-person perspective without using the word I. Retell how the work flowed from the first card into the second with concrete verbs (debugged, reviewed, watched) and name the stand-out tools/topics once each. Skip laundry lists, filler like "various tasks," and bullet points.
Avoid the words social, media, platform, platforms, interaction, interactions, various, engaged, blend, activity, activities.
Do not refer to the user; write from the user's perspective.

${lang}

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
}`
}
