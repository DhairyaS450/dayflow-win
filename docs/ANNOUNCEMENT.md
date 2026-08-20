# Message drafts — Dayflow for Windows

Pick one, edit the voice to sound like you, and sanity-check the claims against
your own testing before sending.

---

## A. Discord community post (short)

> **Dayflow on Windows 👀**
>
> I really wanted Dayflow on my PC, so I built a Windows port of it — same MIT license, credits back to the original.
>
> It's a full rebuild in Electron rather than a wrapper: same screenshot-based pipeline (one frame every 10s, 15-minute analysis batches, 45-minute sliding window for card merging), same 4AM day boundary, same SQLite schema. Timeline (day + week), Daily standup, Weekly dashboards (donut / focus heatmap / treemap / sankey), Chat over your own activity, categories, tray + pause controls — all there.
>
> One thing I added: **you can run it on a Claude Pro/Max subscription** through the Claude Code CLI, so no API key needed. Gemini and local models (Ollama / LM Studio) work too.
>
> Repo: https://github.com/DhairyaS450/dayflow-win
> Installer: https://github.com/DhairyaS450/dayflow-win/releases/tag/v0.1.0
>
> Still rough in places (privacy app-blocking isn't enforced at capture yet, Journal isn't ported, no Dayflow Pro backend). Would love feedback from anyone who tries it — and happy to take direction from the Dayflow team on where this should live.

---

## B. DM to the founder (direct)

> Hey Jerry — big fan of Dayflow. I'm on Windows so I couldn't actually use it, and I ended up building a Windows port over the last week. Wanted to show you before doing anything more public with it.
>
> It's a genuine port, not a wrapper: Electron + React, but I worked from your Swift source and kept the behaviour rather than the appearance only — 10s screenshot capture, 15-min batches, the 45-min sliding window that rewrites recent cards, the 4AM day boundary, the same SQLite schema and card metadata format, your prompts (adapted where they mention the macOS menu bar). Timeline day/week, Daily standup, the Weekly dashboards, Chat with function-calling over the local DB, categories, tray, pause pill, deep links.
>
> MIT license preserved with your copyright, and the README credits the original throughout.
>
> Repo: https://github.com/DhairyaS450/dayflow-win
> Installer: https://github.com/DhairyaS450/dayflow-win/releases/tag/v0.1.0
>
> Two things you might find interesting:
> 1. I wired up the **Claude Code CLI as a provider**, so it runs on a Claude Pro/Max subscription with no API key — the CLI owns the login, the app never touches a credential. Works well: ~30s to transcribe a batch, ~30s to generate cards.
> 2. I wrote fairly detailed porting specs of the macOS behaviour while reverse-engineering it (pipeline timings, storage semantics, prompts, UI tokens) — they're in `docs/specs/` and might be useful to you regardless of what happens with the port.
>
> Known gaps I'd fix before calling it 1.0: privacy app-blocking isn't enforced at capture time on Windows yet, Journal isn't ported, and obviously no Dayflow Pro backend.
>
> Totally your call how you want to handle this — happy to keep it as a clearly-labelled community port, rename it, move it under your org, or take it down if you'd rather own the Windows story yourselves. Just let me know.

---

## C. One-liner (if you just want to drop a link)

> Built a Windows port of Dayflow — same pipeline and features, MIT, credits the original. Also runs on a Claude subscription via the Claude Code CLI (no API key). https://github.com/DhairyaS450/dayflow-win
