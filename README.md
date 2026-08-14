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
