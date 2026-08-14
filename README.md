# Dayflow for Windows

A Windows port of [Dayflow](https://github.com/JerryZLiu/Dayflow) (MIT), the private, automatic
work journal. Dayflow watches your screen locally, summarizes what you actually did with the AI
provider of your choice, and turns your day into a timeline, daily standup, weekly review, and a
journal you can chat with.

- **Local-first** — recordings and the database stay on your machine
- **Your AI, your choice** — Gemini API key, or fully local via Ollama / LM Studio
- **Automatic timeline** — activity cards with categories, summaries, and video review
- **Daily standup, weekly review, journal, chat** — same features as the Mac app

## Stack

Electron + React + TypeScript. Screen capture via `desktopCapturer`, storage via SQLite
(better-sqlite3), video handling via ffmpeg.

## Status

Working: screenshot capture pipeline (10 s interval, active-display tracking, idle detection,
pause/sleep handling), SQLite storage with the full upstream schema, 15-min analysis batching
with idle-batch shortcut and 45-min sliding-window card generation, Gemini + Ollama/LM Studio
providers, timeline (day + week), daily standup with recap generation, weekly analytics
(donut, heatmap, treemap, sankey), chat with function-calling over your activity data,
settings, onboarding, tray, deep links (`dayflow://`), launch-at-login, NSIS installer.

Known gaps vs the macOS app:
- Privacy app-blocking list is stored in Settings but not yet enforced at capture time
  (needs foreground-process detection on Windows)
- Journal view (hidden/access-code-gated upstream) not ported
- Dayflow Pro backend + ChatGPT/Claude CLI providers not available (shown as "coming later")
- Timeline review swipe overlay and feedback analytics not wired

## Development

```bash
npm install
npm run dev
```

## Package

```bash
npm run package
```

## Credits

Original app by [Jerry Liu](https://github.com/JerryZLiu/Dayflow), MIT license. Fonts
(Nunito, Figtree, Instrument Serif) under the SIL Open Font License.
