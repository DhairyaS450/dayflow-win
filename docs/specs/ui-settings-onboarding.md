# Dayflow — Settings, Onboarding & System UI Porting Spec (macOS SwiftUI → Windows Electron/React)

> Source: `C:\Coding\Dayflow\Dayflow\Dayflow\` (MIT-licensed macOS app).
> This spec is exhaustive — the implementer is NOT expected to read Swift source.
> All copy is verbatim unless marked otherwise. Coordinates/paddings are in points (treat 1pt = 1px @1x).
>
> Swift → CSS color note: `Color(red: 0.25, green: 0.17, blue: 0)` = `#402B00` (values are 0–1 fractions × 255, sRGB). Hex strings like `Color(hex: "492304")` are literal `#492304`.

---

## Table of contents

1. [Design tokens & shared components](#1-design-tokens--shared-components)
2. [Onboarding flow](#2-onboarding-flow)
3. [Provider setup flow (LLMProviderSetupView)](#3-provider-setup-flow)
4. [Settings](#4-settings)
5. [Status bar (tray) menu](#5-status-bar-tray-menu)
6. [Notifications](#6-notifications)
7. [Feature access requirements (gating)](#7-feature-access-requirements)
8. [Toasts & notices](#8-toasts--notices)
9. [What's New view](#9-whats-new-view)
10. [Bug report view](#10-bug-report-view)
11. [Preference-key appendix](#11-preference-key-appendix)
12. [Default prompt texts (verbatim)](#12-default-prompt-texts-verbatim)

---

## 1. Design tokens & shared components

### 1.1 Fonts

| Token | Font | Use |
|---|---|---|
| Serif display | `InstrumentSerif-Regular` | Big headings ("Choose a way to run Dayflow", "Settings", section titles in onboarding, plan price) |
| Body | `Figtree` (weights: regular, medium, semibold, bold; sometimes referenced as named variants `Figtree-Medium`, `Figtree-SemiBold`, `Figtree-Bold`) | Everything else |
| Mono | `SF Mono` (fallback: any monospace) | API-key input, terminal command blocks |
| Mono (system) | `system monospaced 11pt` | CLI debug log output |
| `Nunito` 12pt | Referral mini buttons (Copy / Send / Apply / Sign in) only |

### 1.2 Core palette

| Name | Value | Usage |
|---|---|---|
| Ink brown (primary accent) | `#402B00` (`rgb(0.25,0.17,0)`) — also written `#402C00` in some onboarding buttons | Primary filled buttons, active states, links, selected calendar day, progress fill |
| Dark brown text | `#492304` | Onboarding headings/labels/chips text |
| Warm orange heading | `#89380E` | Onboarding sub-questions ("What do you do for work?") |
| Brand orange | `#FF7506` / `#FF8904` / `#F96E00` (accents), `#FF8D40` (progress ring) | Selected-card glow, "Last step!" label, ring fill |
| Success green (onboarding) | `rgb(0.34, 1, 0.45)` = `#57FF73` | Check icons, key valid, sidebar completed check |
| Success green (badges) | `rgb(0.13, 0.7, 0.23)` = `#21B33B` | "Installed" pill text |
| Error red | `#E91515` | Invalid key, "Not installed" pill (bg `#FFD1D1`) |
| Failed orange-red | `rgb(0.91, 0.34, 0.16)` = `#E85729` | "Error" pill, orange badge text |
| Badge blue | `rgb(0.19, 0.39, 0.8)` = `#3063CC` | "NEW"/"PRO" badge text |
| Settings text | `black @ 90%` | Primary text |
| Settings secondary | `black @ 55%` | Secondary text |
| Settings meta | `black @ 40%` | Tertiary/metadata |
| Settings divider | `black @ 8%` | Hairline row dividers |
| Settings destructive | `rgb(0.76,0.19,0.19)` = `#C23030` | Errors, destructive confirm |
| Status good | `rgb(0.25,0.62,0.32)` = `#409E52` | Status dot green |
| Status warn | `rgb(0.86,0.6,0.1)` = `#DB991A` | Status dot amber |
| Status bad | = destructive | Status dot red |
| Onboarding chip border | `#E4D3C2` (idle), `#FFCCA7` (selected) | Role/answer chips |
| Onboarding chip shadow | `#AF7246 @ 15%` idle; `rgb(1,0.416,0) @ 50%` (selected glow) | |
| Card borders | `black @ 6%` (idle cards), `#E3DBD9` (category cards) | |
| Terminal block bg | `#F8F9FA`, border `black @ 8%` | |
| Toast surface | bg `#FFF8F2`, border `#F3D9C2`, warn icon `#C04A00`, record icon `#C7352D` | |

### 1.3 Backgrounds

- **Onboarding + entire app shell**: full-window image `OnboardingBackgroundv2` (warm cream paper texture, `aspectFill`). Everything renders directly on it — the "paper" IS the surface. Force light color scheme everywhere.
- **Settings**: same paper. Design principle (verbatim from source comments): *"The warm paper background IS the surface. No cards on top. Hierarchy from typography + opacity, not borders + backgrounds. One accent color (ink brown). Exactly three button treatments. Rows always read label-left, control-right."*

### 1.4 `DayflowSurfaceButton` (the universal onboarding button)

Generic content button, params: `background`, `foreground` (content rendered at 85% opacity of foreground), `borderColor`, `cornerRadius` (default 0), `horizontalPadding` (default 18), `verticalPadding` (default 12), `minWidth`, `showShadow` (default true), `showOverlayStroke` (default false), `isSecondaryStyle` (default false).

- Overlay stroke variants:
  - `isSecondaryStyle`: inset 0.75, stroke ink-brown `#402B00` 1.5px + hard shadows (`black 25% r0.25 y0.5`, `black 16% r0.5 y1`, `black 30% r6 y2`).
  - `showOverlayStroke` (used on dark primary buttons): inset 0.75, stroke `white @ 17%` 1.5px.
  - default: inset 0.5, stroke `borderColor` 1px (full opacity on hover).
- Non-secondary shadows: `black @ 6% r4 y2` + `black @ 4% r1 y1`; on hover `10% r8 y4` + `6% r2 y1`.
- Hover: brightness +0.02, scale 1.02, translateY(-1). Press: scale 0.985 for 80ms then fire action. Pointer cursor. Respect reduced-motion (disable scale/offset).
- **Primary style used throughout onboarding**: `background #402B00`, `foreground white`, `cornerRadius 8`, `showOverlayStroke: true`.

### 1.5 `BadgeView` (onboarding/provider cards)

Uppercase chip: Figtree 10pt (semibold for green, bold for orange/blue), kerning 0.5 (green) / 0.7 (others), padding 8×4, corner radius 2, background = white 69% + linear gradient wash from badge color (start `UnitPoint(1.15, 3.61)` → end `(0.02, 0)`), 0.5px stroke of badge color @30%, plus a 5-layer soft colored drop shadow (14%/12%/7%/2%/0% at increasing offsets).

- Green: text `#21B33B`, gradient from `#57FF73`.
- Orange: text `#E85729`, gradient from `rgb(1,0.49,0.34)`.
- Blue: text `#3063CC`, gradient from `rgb(0.34,0.56,1)`.

### 1.6 Selected-card treatment (provider cards)

- `SelectedCardBackground`: layered `#FCF2E3` + `white @ 69%` + horizontal gradient (clear → `#FF7506 @ 5%` at 0.7 → `#FF7506 @ 15%` at 1.0).
- `SelectedCardOverlay`: three stacked 1px inset strokes — `#EBE9E6`, `#FFEBC9`, then an angular (conic) gradient stroke cycling `#FFF1D3 50% → #FF8904 50% → #FF8904 35% → white → white 75% → white 50% → #FF8904 35% → #FFE0A5 → white → #FFF1D3 50%` (stops at 0, .03, .09, .17, .23, .25, .30, .52, .58, .80, .91, 1.0).
- `CardShadowModifier` (selected only): 3 warm brown shadows — `rgb(0.47,0.27,0.09) @ 21% r5 x4 y3`, `@18% r9.5 x14 y12`, `rgb(0.48,0.27,0.1) @ 11% r12.5 x32 y27`.
- Unselected card: `white @ 30%` bg, 1px `black @ 6%` inset stroke, radius 4.

### 1.7 `ProviderIconView`

40×40 logo container (104 wide for the ChatGPT+Claude pair). Assets: `DayflowLogo` (raw 40×40), `GeminiLogo`, `ChatGPTLogo`, `ClaudeLogo` — each in a 28×28 image inside a white-90% rounded box (radius 6, padding 6, black-5% 0.5px stroke, black-5% shadow r2 y2). Fallback: SF Symbol (e.g. `desktopcomputer` for Local) at 20pt medium on white-60% box radius 3.

### 1.8 Settings design-system components (`SettingsComponents.swift`)

- `SettingsStyle` tokens: `sectionSpacing = 44`, `rowVerticalPadding = 14`, plus colors in §1.2.
- **SettingsSection**: title (Figtree 17 semibold, text color) + optional subtitle (Figtree 12, secondary) + optional right-aligned trailing view; 14pt gap below header; content below. No container chrome.
- **SettingsRow**: label (Figtree 14 semibold) + optional subtitle (Figtree 12 secondary) left; trailing control right; vertical padding 14; 1px divider below (`showsDivider` default true).
- **SettingsPrimaryButton**: white Figtree 13 semibold text (+ optional 12pt semibold SF icon or small white spinner when loading), padding 18×9, ink fill radius 8 (40% opacity when disabled). Press: opacity .85 + scale .98.
- **SettingsSecondaryButton**: ink text Figtree 13 semibold (+ optional 11pt icon), padding 12×7, `black @ 5%` fill radius 7 (2% when disabled, text 40%).
- **SettingsLinkButton**: plain ink text Figtree 13 semibold + optional `arrow.up.right` glyph (11pt). For external navigation.
- **SettingsStatusDot**: 8px colored circle + Figtree 13 semibold label in the SAME color. States: good/idle/warn/bad (idle = black 50%).
- **SettingsToggle**: native switch scaled to 0.72, trailing-anchored, no label.
- **SettingsBadge**: uppercase Figtree 10 bold, kerning 0.6, padding 7×3, radius 4. Two tones only: accent (ink text on ink-10% fill) and neutral (secondary text on black-5% fill).
- **SettingsMetadata**: Figtree 13 secondary — all right-rail informational text.

### 1.9 `SunriseGlassPillToggleStyle` (decorative pill toggle — available but not used on the settings surface)

Track 64×32 capsule; ON gradient `rgb(1,0.85,0.72) → #FF7506` diagonal; OFF `#F0E9E6` flat. Overlays: white-inner-stroke (35%/45%) blend overlay, `#E5E5E5` 1px stroke @ 90%, top gloss (white 18%/12% band, blurred 2, offset up), ultra-thin material behind. Knob: 28px circle, radial white→white-65%, black-6% 0.75px border, 2px padding, slides leading↔trailing with spring (response .35, damping .82).

### 1.10 `ProgressRingView` (onboarding progress, bottom-left)

140×140 container. Segmented ring: diameter 76, stroke width 8, gap fraction 0.035 per segment, round caps. Track color `rgb(1, 200/255, 160/255) @ 30%`; fill + center label `#FF8D40`; label = `NN%` Figtree-Bold 16. Segment fills animate sequentially (stagger 0.07s) with a "squish" wind-up (scale .95, rotate −1.5°, 0.08s) and pop (scale 1.08), particle burst (6 particles, colors `#FF8D40 #FFB69B #FFCC66 #FFA060 #FFD4A8`) per segment, confetti burst at 100% (colors `#FF6B6B #FFD93D #6BCB77 #4D96FF #FF8D40 #C780FA #FF6B9D #45B7D1`). Percent counter animates with slight bounce (scale 1.05, 0.25s).

### 1.11 Misc shared components

- **`LogoBadgeView`**: plain image renderer, default 100×100.
- **`WrappingHStack`**: wraps `TimelineCategory` pills to rows given a width (estimates pill width ≈ `chars × 6 + 32`).
- **`TerminalCommandView`**: title (Figtree 16 semibold, black 90%) + subtitle (Figtree 14, black 60%) + command block: SF Mono 13 black-85%, selectable, padding 16×14 (plus 120 right reserve), bg `#F8F9FA` radius 8, 1px black-8% stroke; trailing overlay Copy button (DayflowSurfaceButton, white-93% bg, black-12% border, radius 6, padding 14×10, no shadow) with icon `doc.on.doc` → `checkmark` and label `Copy` → `Copied` (green `#57FF73` content when copied, resets after 2s). Copy fires analytics `terminal_command_copied {title}`.
- **Pointer cursor** on every interactive element (`pointingHandCursor()` is applied ubiquitously → CSS `cursor: pointer`).

---

## 2. Onboarding flow

Production flow lives in `OnboardingFlow.swift` and reuses "prototype" step views from `Prototype/OnboardingPrototypeFlow.swift`. Full-window, light scheme, background = `OnboardingBackgroundv2` image fill. Step transitions animate `easeInOut 0.5s` (opacity fades).

### 2.0 Step order & persistence

`OnboardingStep` enum (rawValue = index, persisted in `onboardingStep` UserDefaults key so the flow resumes after relaunch; schema version key `onboardingStepSchemaVersion`, current version 5 with v0→v5 migrations):

| # | case | analytics name | shows progress ring? | ring filled segments |
|---|---|---|---|---|
| 0 | introVideo | `intro_video` | no | 0 |
| 1 | roleSelection | `role_selection` | yes | 0 |
| 2 | downloadReason | `download_reason` | yes | 1 |
| 3 | referral | `referral` | yes | 2 |
| 4 | preferences | `preferences` | yes | 3 |
| 5 | llmSelection | `llm_selection` | **no** | 4 |
| 6 | llmSetup | `llm_setup` | yes | 5 |
| 7 | categories | `categories` | yes | 6 |
| 8 | categoryColors | `category_colors` | **no** | 7 |
| 9 | screen | `screen_recording` | yes | 8 |
| 10 | completion | `completion` | yes | 9 |

- Progress ring: `ProgressRingView(totalSegments: 9, filledSegments: …)` pinned bottom-left, non-interactive, opacity toggles with `easeInOut 0.3s`.
- `didOnboard` (bool, UserDefaults) gates onboarding vs main app.
- On completion: creates a sample onboarding card (`StorageManager.createOnboardingCard()`), sets `didOnboard=true`, resets `onboardingStep=0` and `onboardingHasPaidAI=""`, fires `onboarding_completed`, person property `onboarding_status: completed`.
- Branching summary:
  - `llmSelection` → if chosen provider is **Dayflow Pro** skip straight to `categories` (no llmSetup); otherwise → `llmSetup`.
  - Back from `categories` → `llmSetup`, or `llmSelection` if provider was `dayflow`.
  - Back from `categoryColors` → `categories`; back from `screen` → `categoryColors`.
  - After `screen` advances: if screen-capture permission already granted, recording auto-starts (analytics reason `onboarding`).
- Each step fires `onboarding_step_completed {step: <analyticsName>, …extras}` on advance and a `screen()` analytics call on appear (`onboarding_intro_video`, `onboarding_role_selection`, `onboarding_download_reason`, `onboarding_referral`, `onboarding_preferences`, `onboarding_llm_selection`, `onboarding_llm_setup`, `onboarding_categories`, `onboarding_screen_recording`, `onboarding_completion`). First appearance also fires `onboarding_started` once (guarded by `onboardingStarted` defaults key) and person property `onboarding_status: in_progress`.

### 2.1 Step 0 — Intro video (`OnboardingPrototypeVideoIntroStep`)

- Full-bleed black background; plays bundled video **`DayflowOnboarding.mp4`** (searched in bundle root then `Videos/` subdir; `.mov` fallback), muted, no controls, non-interactive (all clicks/keys swallowed).
- Auto-advance: watches playback; when within 0.3s of end (or `AVPlayerItemDidPlayToEndTime`, or playback failure, or missing asset) → pause on last frame, wait **2.0s**, then advance. A 0.1s timer force-resumes playback if the OS pauses it.
- Analytics: `onboarding_video_started {asset: "DayflowOnboarding.mp4"}`, `onboarding_video_completed {reason: "ended"|"playback_failed"|"missing_asset"}`.
- (Related: a separate launch video `DayflowAnimation.mp4` plays at 1.3× via `VideoLaunchView` before the app shell appears on cold start; same non-interactive plumbing.)

### 2.2 Step 1 — Role selection (`OnboardingPrototypeRoleSelectionStep`)

Layout: vertical, top spacer 39.

- Heading (serif 40, tracking −1.2, `#492304`, centered, max width 708, line spacing 0.2em):
  **"Help Dayflow understand your work patterns better."**
- Spacer 60, then centered stack (spacing 24):
  - **"What do you do for work?"** (Figtree 20, `#89380E`)
  - **"This will help Dayflow generate categories that are most helpful to you."** (Figtree 20, `#89380E`)
- Role chips in two rows (spacing 8): row 1 = first 4, row 2 = rest. Options (fixed order):
  `Software Engineer`, `Founder / Executive`, `Designer`, `Student`, `Product Manager`, `Data Scientist`, `Other`.
  Chip: Figtree 16 `#492304`, padding 20×8, capsule; unselected white-40% bg, border `#E4D3C2`, shadow `#AF7246 @15% r2`; selected `rgb(1,0.898,0.812) @ 40%` bg, border `#FFCCA7`, glow `rgb(1,0.416,0) @ 50% r3`.
- If `Other` selected, reveal (fade+slide, 0.25s): **"Please specify"** (Figtree 20, `#89380E`) + plain text field 353×34, white-40% bg radius 5, border `#E4D3C2`, shadow `#AF7246 @15% r2`.
- Bottom **Continue** button (DayflowSurfaceButton: Figtree 14 semibold, bg `#402C00`, white, radius 8, padding 59×12, minWidth 234, overlay stroke). Disabled (opacity 0.4, not clickable) until a role is resolved (Other requires non-empty text). Bottom spacer 60.
- On continue: stores role for category presets (`onboardingSelectedRole`), fires `onboarding_role_selected {role}`.

### 2.3 Step 2 — Download reason (`OnboardingPrototypeDownloadReasonStep`)

Top spacer 126; content max width 760, horizontal padding 24; spacing 22.

- **"What are you hoping to get out of Dayflow?"** (Figtree 20, `#89380E`)
- **"This helps personalize the experience for you."** (Figtree 16, `#89380E` @ 78%)
- Multi-select checklist (rows, spacing 8). Six concrete options are **shuffled** each run; `Other` always last. Row: leading icon `checkmark.circle.fill` (selected) / `circle` (17pt semibold, `#402C00`) + label Figtree 15 `#492304`; padding 14×10; radius 8; unselected white-42% bg + `#E4D3C2` border + `#AF7246 @12% r2` shadow; selected `#FFE5CF @ 48%` bg + `#FFCCA7` border + `rgb(1,0.416,0) @22% r3` glow.
  Options (verbatim, with analytics values):
  - "To keep an automatic log of what I worked on" (`automatic_log`)
  - "To have something to show for my work (standups, reviews, clients)" (`proof_of_work`)
  - "To find and cut distractions" (`cut_distractions`)
  - "To be more productive or focused" (`productive_focused`)
  - "I was already tracking this manually and wanted it automated" (`automated_manual_tracking`)
  - "I wanted a tracker that's open source and keeps my data private" (`open_source_private`)
  - "Other" (`other`)
- `Other` reveals text field placeholder **"Tell me more"** (Figtree 16, `#492304`, height 36, white-42% radius 5, `#E4D3C2` border) — fades in only when Other is checked; unchecking clears it.
- Continue button identical to step 1; enabled when ≥1 selected (and Other, if selected, has text). Fires `onboarding_download_reason {reasons:[…], other_detail?, surface:"onboarding_download_reason"}`.

### 2.4 Step 3 — Referral survey (`OnboardingPrototypeReferralStep` + `ReferralSurveyView`)

Top spacer 39.

- Heading (serif 40, tracking −1.2, `#492304`): **"One quick question"**
- Spacer 48; `ReferralSurveyView` (max width 720, padding 24) with prompt **"Where did you first hear about Dayflow?"** (Figtree 15 semibold, black 85%), submit button hidden (Continue at page bottom instead).
- Radio options in a 2-column grid (rows of 2, spacing 12/10). Six concrete options **shuffled**, `Other` last. Option row: radio icon `largecircle.fill.circle` / `circle` in ink brown; label Figtree 14 black-78%; padding 12×10 radius 8; selected bg `rgb(1,0.95,0.9)`, border ink @22% (vs white bg + ink @10% border unselected).
  Options (verbatim → analytics value; `requiresDetail` → detail placeholder):
  - "Hacker News" → `hacker_news`
  - "X / Twitter" → `x`
  - "Friend or colleague" → `friend`
  - "YouTube" → `youtube` — requires detail, placeholder **"Which channel?"**
  - "Newsletter or blog (which one?)" → `newsletter_blog` — requires detail, placeholder **"Which newsletter or blog?"**
  - "ChatGPT / Claude / AI" → `chatgpt_claude_ai`
  - "Other (please specify)" → `other` — requires detail, placeholder **"Where did you hear about Dayflow?"**
- Detail text field (rounded border style, Figtree 13, height 44) is invisible/disabled unless the selected option requires detail.
- (When `ReferralSurveyView` is used standalone with its own submit button it shows label "Submit" and optional thank-you row **"Thanks for letting me know!"** with `checkmark.circle.fill` in ink.)
- Continue button (same style as previous steps) enabled when option selected (+ detail if required). Fires `onboarding_referral {source, detail?, surface:"onboarding_referral"}`.

### 2.5 Step 4 — Preferences (`OnboardingPrototypePreferencesStep`)

Vertically centered stack (spacing 24):

- **"Do you have a paid ChatGPT or Claude account?"** (Figtree 20, `#89380E`, centered)
- Two capsule buttons **"Yes"** / **"No"** (Figtree 16 `#492304`, padding 20×8, white-40% bg, `#E4D3C2` border, `#AF7246 @15% r2` shadow). Clicking either immediately advances.
- Persists to `onboardingHasPaidAI` = "yes"/"no"; fires `onboarding_preferences {has_paid_ai}`.

### 2.6 Step 5 — Choose provider (`OnboardingPrototypeChooseProviderStep`)

Global scale factors: layoutScale `0.8` applied to all paddings/sizes; text additionally ×1.1 (so effective text ≈ 0.88× stated design values). Stated values below are pre-scale.

- Title: **"Choose a way to run Dayflow"** (serif 40, tracking −1.2, `#492304`, centered; top pad 25, bottom 30).
- **Recommended view (default)**: two tall cards side by side (spacing 20, horizontal padding 40, max height 432, radius 4).
  - Pair depends on the Step-4 answer: `hasPaidAI ? (Dayflow Pro, ChatGPT or Claude) : (Dayflow Pro, Google Gemini)`.
  - First card: badge **RECOMMENDED** (orange), highlighted (SelectedCardBackground/Overlay + CardShadow). Second card: white-30% card, badge text by provider: `chatgpt_claude` → **USE EXISTING ACCOUNT**, `gemini` → **FREE SETUP**, `local` → **MOST PRIVATE** (all green badge).
  - Tall card layout: centered icon (top pad 24, bottom 16) → centered title (Figtree 18 semibold, black 90%) → centered badge (bottom pad 24) → scrollable feature list (rows spacing 10, horizontal pad 24) → bottom **Select** button (full width, ink `#402B00`, white, radius 8, padding 24×12, overlay stroke; label Figtree 14 semibold "Select").
- **All-options view**: toggled by bottom pill; 2×2 grid of compact cards (spacing 12, height 205, padding 20×18): row1 = Dayflow Pro + ChatGPT or Claude; row2 = Google Gemini + Local AI. Compact card: icon + title inline (spacing 12), scrollable features (spacing 2), bottom-right Select button.
- Bottom toggle pill (hidden during Dayflow-Pro sign-in): **"See all options"** ↔ **"See recommendations only"** (Figtree 16, `#492304`, capsule white-40%, border `#E4D3C2`, shadow `#AF7246 @15%`; bottom pad 30). Animates 0.3s.
- **Feature row**: `checkmark` (pros, green `#57FF73`) or `xmark` (caveats, red `#E91515`) 12pt bold in 16pt-wide slot + Figtree 14 black-75% text.

Provider card content (verbatim):

| Provider | Icon | Pros (✓) | Caveats (✗) |
|---|---|---|---|
| **Dayflow Pro** | DayflowLogo | "Zero setup - just sign in and go" · "Try it for free - no credit card necessary." · "Sync across devices" · "Uses models with maximum intelligence for the best experience" | — |
| **ChatGPT or Claude** | ChatGPT+Claude pair | "Superior intelligence and reliability" · "Uses less than 1% of your daily limit" · "Perfect for ChatGPT Plus or Claude Pro paid subscribers" | "Requires installing Codex or Claude CLI" |
| **Google Gemini** | GeminiLogo | "Uses Gemini's free tier (no subscription needed)" · "Faster and more accurate than local models" · "Much easier setup compared to local models" | "Less advanced compared to ChatGPT and Claude" |
| **Local AI** | `desktopcomputer` symbol | "100% private - nothing leaves your computer" | "Significantly less intelligence" · "Not recommended for those new to running local LLMs" · "Requires 16GB+ of RAM, 4GB free disk space, M1 or later chip preferred" |

Selection mapping (display title → internal provider id, stored in `selectedLLMProvider`): Dayflow Pro → `dayflow`; ChatGPT or Claude → `chatgpt_claude`; Google Gemini → `gemini`; Local AI → `ollama`. Fires `llm_provider_selected {provider, local_engine?}` + person property `current_llm_provider`.

#### 2.6.1 Dayflow Pro sign-in panel (inline, replaces cards when Select on Dayflow Pro)

Panel: max width 620, white-42% bg radius 6, border `#E4D3C2`, shadow `#AF7246 @15% r8 y2`, padding 28×24. Header row: Dayflow icon + title **"Sign up / Sign in to Dayflow"** (Figtree 20 semibold `#492304`) + step subtitle + right **"Back"** capsule button (Figtree 13 semibold, white-45%, `#E4D3C2` border) that returns to cards & resets to email step. Selecting Dayflow Pro also signs out any existing session first.

Sub-steps (`DayflowProOnboardingStep`), each analytics-tracked (`dayflow_pro_onboarding_step_viewed`, screens `dayflow_pro_email` etc.):

1. **email** — subtitle: none. Field label **"Email"**; text field placeholder `you@example.com` (Figtree 14, white-72% bg radius 6, `#E4D3C2` border, height 42). Right-aligned primary button **"Send sign-in code"** (busy: "Sending..."), enabled when trimmed lowercase email contains `@` and `.` and no space. Primary button style: ink `#402C00` fill (disabled fill `#D8CCBD`), white Figtree 13 semibold, radius 8, padding 22×11, minWidth 150, overlay stroke. Secondary buttons: white-64% bg, `#492304` text, isSecondaryStyle, minWidth 116.
2. **code** — subtitle: **"Enter the code we sent to finish signing up/in."** Field label **"Code sent to {email}"**; placeholder `123456` (digits only, max 6, auto-normalized). Buttons: secondary **"Different email"**, secondary **"Resend code"** (busy "Sending..."), primary **"Continue"** (busy "Checking...") enabled with 6 digits. On success: refresh account, then route → active-Pro users continue straight through; users with an active referral reward → freeMonthActive; active trial reward → trialActive; else → referralCode.
3. **referralCode** — heading **"Do you have a referral code?"** (Figtree 13 semibold); body: **"If someone gave you a code, enter it here. Don't worry if you don't have a code, we'll gift you a free week of Dayflow Pro!"** Field label **"Referral code"** + gray tag **"Optional"**; placeholder `ABC123` (uppercased alphanumerics, max 6). Invalid-length inline error: **"Enter the 6-character code from your invite."** (`#B42318`). Buttons: primary **"Apply code"** (busy "Applying...", enabled at exactly 6 chars; failure shakes the field — 5 shakes, 7px travel, 0.32s linear) + secondary **"I don't have a code"** → trialOffer.
4. **freeMonthActive** — subtitle **"Your referral reward is ready."** Shows `ReferralPassCard` with message **"Your free month of Dayflow Pro is ready."**; heading **"Congrats, enjoy a free month of Dayflow Pro on us!"** (Figtree 16 semibold); body **"Your referral reward is active on this account."**; primary **"Continue with Dayflow Pro"**.
5. **trialOffer** — subtitle **"No referral code? Start with a free trial."** Card message **"7 days free. No credit card required."**; heading **"Try Dayflow Pro free for 7 days."**; body **"We want you to be able to try Dayflow for free, no credit card and no strings attached!"**; primary **"Start free trial"** (busy "Starting...") + secondary **"I have a code"** → referralCode.
6. **trialActive** — subtitle **"Your trial is ready."** Card message "7 days free. No credit card required."; heading **"Your Dayflow Pro trial is active."**; body **"No credit card needed. You can set up billing later if Dayflow is useful."**; primary **"Continue with Dayflow Pro"**.

Status/error line under the form: error text in `#B42318`, otherwise auth status text in `#89380E` (suppressed when it starts with "signed out", or "signed in" while on referralCode/trialOffer steps).

`ReferralPassCard` (shared with Settings): 283×161 card, bg image `ReferralCardBackground`, glossy shine overlays, white "Dayflow" serif-28 wordmark + white "Pro" tag (serif 12 on white-90% chip, orange `#FF790C` text) + message (Figtree 10 white, 2 lines, centered, width 158). 3D hover tilt (±12°/10°, perspective 0.65, lift −3px, glare follows cursor; disabled with reduce-motion), warm brown `#744D33` double shadow.

### 2.7 Step 6 — Provider setup → see [§3](#3-provider-setup-flow). Skipped entirely for `dayflow`.

### 2.8 Step 7 — Categories (`OnboardingCategoryStepView`)

Two-column layout (left 38% / right 55% of width minus 160, spacing 40, horizontal padding 80; top spacer 80).

Left column (spacing 16):
- **"Help Dayflow understand your workflow"** (serif 28, black; extra 24 bottom pad)
- **"Dayflow will organize your activities based on the categories you provide."** (Figtree 14 medium, `#5B5B5B`)
- **"Here are options tailored to your work to help you get started. Provide more personalized descriptions to help Dayflow better understand your actions."**
- **"You can customize or create new categories any time."**

Right column: scrollable stack (spacing 12, 5px padding to avoid shadow clipping) of category cards seeded from the role chosen in Step 1 (see §2.8.1). Card (read-only): 16×16 rounded-6 color swatch (white 1.5px ring + black-25% shadow) + name (Figtree 12 bold black) + (non-system only) trailing `pencil` (12pt, black 40%) and delete asset icon `CategoriesDelete` (16×16); padding 14×10; white bg radius 6; `#E3DBD9` 0.5px stroke; `#DCCDC1 @50% r3` shadow. Clicking a non-system card enters edit mode.
Edit mode card: swatch + plain TextField "Category name" (Figtree 12 bold) + green `checkmark.circle.fill` (`#4CAF50`, save) + delete icon + red `xmark.circle.fill` (`#F44336`, cancel); radius 4; glow shadow `#FCB278 r3`.
Delete confirmation (native alert): title **"Delete category?"**, message **"“{name}” will be removed from your onboarding categories."**, destructive **Delete** / **Cancel**.
Add button: **"+ Add category"** (Figtree 12 medium `#2B2B2B`, full width, padding 10×6, bg `#FFBA81 @30%` radius 4, border `#F3A462` 0.5px). Max 20 categories (45% opacity + disabled beyond). Adds "New Category" and enters edit mode.

Bottom-right buttons (spacing 15, bottom pad 40, right pad 80): **Back** (outlined: Figtree 12 medium tracking −0.48, `#B6B6B6` text + 1px `#B6B6B6` border, padding 40×12, radius 4) and **Next** (filled `#402B00`, white, same metrics). Next disabled at 45% opacity when no categories. On next: persists categories, fires `onboarding_categories_completed {category_count, renamed_count, added_count, color_changed_count, deleted_count}`.

#### 2.8.1 Role-based category presets (name / hex / description — verbatim)

Every preset also gets a hidden system "Idle" category appended. All presets share the last two entries:
- **Distraction** `#FF4721` — "Unfocused browsing and passive content consumption: social media feeds, random videos, idle scrolling, entertainment with no clear intent, and gaming"
- **Personal** `#ADE3E3` — "Intentional non-work activity with a purpose: messaging friends and family, managing finances, booking travel, errands, life admin, and hobbies"

| Role | Categories before Distraction/Personal |
|---|---|
| Software Engineer | **Coding / Debugging** `#6A7EFF` "Writing, refactoring, and fixing code in an IDE or terminal" · **Code Review** `#56CFEE` "Reviewing PRs, reading diffs, and leaving comments" · **Research** `#C787F7` "Reading docs, Stack Overflow, exploring tools and APIs, and writing design docs or technical specs" · **Communication** `#FFAE8C` "Meetings, standups, Slack, email, video calls, messaging, and syncs" |
| Founder / Executive | **Engineering / Product** `#6A7EFF` "Coding, design work, shipping features, and hands-on building" · **Research & Strategy** `#56CFEE` "Competitive research, positioning, long-form thinking, and investor prep" · **Data & Insights** `#C787F7` "Dashboards, retention data, funnels, and financials" · **Communication** `#FFAE8C` "Team syncs, investor calls, user demos, and hiring" |
| Designer | **Design** `#6A7EFF` "Prototyping, UI components, user flows, visual design, and handoff specs" · **Research** `#56CFEE` "Browsing patterns, competitive audits, user studies, and reviewing metrics" · **Communication** `#FFAE8C` "Design reviews, standups, critique sessions, and presenting concepts" |
| Student | **Studying** `#6A7EFF` "Lectures, reading, reviewing slides, flashcards, and course material" · **Assignments** `#56CFEE` "Papers, problem sets, coding projects, and lab reports" · **Communication** `#FFAE8C` "Study groups, office hours, group chats, and emailing professors" |
| Product Manager | **Specs & Planning** `#6A7EFF` "PRDs, roadmaps, backlog grooming, sprint planning, and tickets" · **Research & Analysis** `#56CFEE` "User research, metrics review, competitive analysis, and A/B tests" · **Communication** `#FFAE8C` "Standups, stakeholder syncs, design reviews, and engineering check-ins" |
| Data Scientist | **Analysis & Modeling** `#6A7EFF` "Notebooks, statistical analysis, ML training, and data exploration" · **Data Engineering** `#56CFEE` "SQL queries, pipelines, data cleaning, and ETL scripts" · **Research** `#C787F7` "Reading papers, docs, and exploring new methods and tools" · **Communication** `#FFAE8C` "Presenting findings, stakeholder syncs, and team discussions" |
| Other | **Work** `#6A7EFF` "Focused work tasks and professional responsibilities that do not fit a more specific category" · **Communication** `#FFAE8C` "Meetings, standups, Slack, email, video calls, messaging, and syncs" |

(App-default non-onboarding categories, for reference: Work `#B984FF`, Personal `#6AADFF`, Distraction `#FF5950`, Idle `#A0AEC0` (system).)

Analytics per action: `onboarding_category_added {total_count, surface:"onboarding"}`, `onboarding_category_renamed {category_name, previous_name, surface}`, `onboarding_category_deleted {category_name, remaining_count, surface}`.

### 2.9 Step 8 — Category colors (`OnboardingCategoryColorStepView`)

Embeds the shared `ColorOrganizerRoot` color-picking organizer (from `TimelineCardColorPicker.swift`) in `colorsOnly` mode, embedded presentation, analytics surface `"onboarding"`; min height 600; horizontal padding 40, vertical 60. Back → categories, dismiss/done → screen step. (The color organizer itself is part of the timeline spec — it lets the user assign colors to each category via swatch palette.) No progress ring on this step.

### 2.10 Step 9 — Screen recording permission (`ScreenRecordingPermissionView`) — macOS-specific

Layout: HStack (spacing 60), padding leading 105 / trailing 60 / top 30 / bottom 40. Bottom-right nav buttons overlay.

Left column (max width 374, spacing 10):
- **"Last step!"** (Figtree-Bold 16, `#F96E00`)
- **"Permission"** (serif 28, black)
- **"Dayflow can help understand your day."** (Figtree-Medium 14, `#5B5B5B`)
- Privacy box (padding 16, max width 351, white-30% bg radius 5, border `rgb(0.8,0.278,0) @15%`, shadow `rgb(0.725,0.608,0.482) @30% r4`):
  - shield icon + **"Dayflow is built to be private and secure."** (Figtree-Bold 14, `#89380E`)
  - **"Dayflow stores all recordings locally on your Mac, and can process everything privately on your device using local AI models."** (Figtree-Medium 14, `#89380E`)
  - **"You are always in control — you can pause or turn off Dayflow whenever you like."**
- State messaging:
  - granted: **"✓ Permission granted! Click Next to continue."** (green)
  - needsAction: **"Turn on Screen Recording for Dayflow, then quit and reopen the app to finish."** (orange)
- Action buttons by state:
  - notRequested: single button **"Open System Settings"** (spinner + "Checking..." while checking). Style: Figtree-SemiBold 12 tracking −0.48, `#492304` text, padding 12, radius 6, border `#FFBC80`, background = orange gradient (`rgb(1,0.773,0.341) @70%` at 0.73 → transparent) over white-69%.
  - needsAction: two buttons right-aligned — **"Open System Settings"** (same gradient style) and **"Quit & Reopen"** (plain white-69% + `#FFBC80` border).
- Right side: screenshot image asset `ScreenRecordingPermissions` (max width 486, bg `#FCFCFC`, radius 8, border `#F0F0F0`, soft shadow).

Bottom-right: **Back** (white bg, `#B6B6B6` text+border, radius 4, padding 40×12, secondary style) and **Next** (bg `#402B00`, or 30% opacity when not granted; disabled until granted).

Behavior (macOS): on appear, `CGPreflightScreenCaptureAccess()`; button click calls `CGRequestScreenCaptureAccess()` (fires `screen_permission_granted` / `screen_permission_denied`), else deep-links to `x-apple.systempreferences:com.apple.preference.security?Privacy_ScreenCapture` and shows quit-&-reopen guidance (macOS requires app restart after TCC grant). Re-checks on app-activate.
**Windows adaptation**: no OS permission gate for screen capture via Windows.Graphics.Capture/DXGI — replace with a simple confirmation/consent step, or Windows 10/11 graphics-capture consent if using WGC picker; keep the privacy box copy (swap "your Mac" → "your PC"); "Quit & Reopen" path is unnecessary.

### 2.11 Step 10 — Completion (`CompletionView`)

Centered stack (spacing 16, max width 720):
- `DayflowLogoMainApp` image (height 64)
- **"You are ready to go!"** (serif 36, black 90%)
- **"To get useful insights, let Dayflow run in the background for an hour or two to gather enough context, then check back in."** (Figtree 15, black 60%, centered)
- Button **"Launch Dayflow"** (Figtree 16 semibold, ink `#402B00`, white, radius 8, padding 40×14, minWidth 200, overlay stroke).

### 2.12 Legacy onboarding views (present in code, not in the current flow — port only if desired)

- `WelcomeView`: logo + serif-36 text + "Start" button + rising `OnboardingTimeline` image.
- `HowItWorksView`: serif-48 title **"How Dayflow Works"** + three `HowItWorksCard`s (icon 40×40, title Figtree 16 semibold, body Figtree 14; 580 wide, white-30% radius 5, black-6% border; staggered 1s spring entrances):
  1. `OnboardingHow` / **"Install and Forget"** / "Dayflow takes periodic screen captures to understand what you're working on, all stored privately on your device. You can toggle this whenever you like."
  2. `OnboardingSecurity` / **"Privacy by Default"** / "Dayflow can run entirely on local AI models, which means your data never leaves your computer. You can also find the source code below - please consider giving it a star on Github!"
  3. `OnboardingUnderstanding` / **"Understand your Day"** / "Knows the difference between YouTube tutorials and YouTube rabbit holes. Dayflow actually gets what you're working on."
  Buttons: Back / **"Star Dayflow on GitHub"** (GithubIcon, opens `https://github.com/jerryzliu/Dayflow`) / Next.
- `OnboardingLLMSelectionView`: older 3-card chooser (Local / Gemini / ChatGPT-Claude) with CLI auto-detect flipping badges (`RECOMMENDED`↔`NEW`) and footer copy: "You have Codex/Claude CLI installed! **We recommend using it for the best experience.** You can switch at any time in the settings." or "Not sure which to choose? **Bring your own keys is the easiest setup (30s).** You can switch at any time in the settings."

---

## 3. Provider setup flow

`LLMProviderSetupView(providerType:)` — used in onboarding step `llmSetup` AND as a modal sheet from Settings → Providers (sheet min 900×650). Light scheme.

### 3.1 Chrome

- Header row: left zone (250 wide) has **Back** button (chevron.left 12 semibold + "Back" Figtree 15 medium, black 70%, leading pad 36; press scale 0.97). Back exits to the previous surface on step 0, otherwise steps back.
- Title in content area (leading pad 40): Figtree 32 semibold black-90%. Titles: `ollama` → **"Use local AI"**; `chatgpt_claude` → **"Connect ChatGPT or Claude"**; else → **"Gemini"**.
- Body: sidebar (250 fixed) + content column (max width 500), leading offset 50, gap 40. Sidebar fades in 0.4s; content fades in 0.4s after 0.2s delay.

### 3.2 Sidebar (`SetupSidebarView`)

Vertical list (spacing 8, horizontal padding 20) on a subtle white-3% panel with a faint 1px angular-gradient border (stops of `#FFF1D3`/`#FF8904`/white at low opacities, overall 50% opacity).
Item: 20×20 indicator slot (completed & not current → green `checkmark.circle.fill` `#57FF73`; current → `chevron.right` `#492304`; else empty) + title Figtree 15 (semibold when selected, medium otherwise). Text `#492304` at 100%/70%/40% (selected/completed/inactive). Padding 16×12, radius 4.
Selected item background: orange gradient (`rgb(1,0.77,0.34)` → transparent, diagonal) under white-69%, blurred 4.6px, with `rgb(1,0.54,0.02) @50%` 1px border and a 5-layer gray drop-shadow stack; slides between items (matched geometry / FLIP animation, spring response .3 damping .9). Hover on non-selected: scale 1.02. Clicking any step navigates freely to it (navigating to a test step resets test state; leaving the API-key step persists the key first).

### 3.3 Continue button logic

- Non-last steps: primary ink button **"Next"** + chevron.right; when the current step is a test step (`information` titled "Testing" or "Test Connection") and the test hasn't passed, label becomes **"Test Required"** (no chevron) and the button is disabled at 50% opacity. `canContinue` is false when: API-key step with key ≤ 20 chars; CLI-detect step without an available selected tool; test steps (`id == "verify"`/`"test"`) until `testSuccessful`.
- Last step: button **"Complete Setup"** with `checkmark.circle.fill` — saves config and calls `onComplete`.

### 3.4 Steps per provider

#### Gemini (`default`)
| id | Sidebar title | Content |
|---|---|---|
| `getkey` | Get API key | Heading **"Get your Gemini API key"** (Figtree 24 semibold); sub **"allows you to run Dayflow for free. All you need is a Google account - no credit card required."** Numbered list: 1. "Visit Google AI Studio " + orange underlined "(aistudio.google.com)" (click opens `https://aistudio.google.com/app/apikey`); 2. "Click \"Get API key\" in the top right"; 3. "Create a new API key and copy it". Bottom-left button **"Open Google AI Studio"** (safari icon) + Next right. |
| `enterkey` | Enter API key | `APIKeyInputView` (see §3.5) with title **"Enter your API key:"**, subtitle **"Paste your Gemini API key below"**, placeholder `AIza...`; validation `hasPrefix("AIza") && count > 30`. Below: Keychain-save error banner if saving failed (⚠ icon + message **"Couldn't save your API key to Keychain. Please unlock Keychain and try again."**, red `#E91515` tinted box). Then model picker block: **"Choose your Gemini model. We recommend 3.5 Flash, with 3.1 Flash-Lite available as a fallback."** (Figtree 16 semibold) + segmented picker [`3.5 Flash` \| `3.1 Flash-Lite`] + caption = fallback summary: flash35 → **"Falls back to 3.1 Flash-Lite if needed"**, flashLite31 → **"Always uses 3.1 Flash-Lite"** (Figtree 13, black 55%). Changing model persists immediately (`gemini_model_selected {source:"onboarding_picker"}`) and resets test state. |
| `verify` | Test connection | Information heading **"Test Connection"**, body **"Click the button below to verify your API key works with Gemini"** + `TestConnectionView` (§3.6). |
| `complete` | Complete | **"All set!"** / **"Gemini is now configured and ready to use with Dayflow."** |

Saving: key → OS keychain under service key `gemini`; `GeminiModelPreference` saved (defaults key `geminiSelectedModel_v3`); `geminiSetupComplete=true` on finish.

#### Local (`ollama` provider id)
| id | Title | Content |
|---|---|---|
| `intro` | Before you begin | Info heading **"For experienced users"**; body: **"This path is recommended only if you're comfortable running LLMs locally and debugging technical issues. If terms like vLLM or API endpoint don't ring a bell, we recommend going back and picking ChatGPT, Claude, or Gemini. It's non-technical and takes about 30 seconds.\n\nFor local mode, Dayflow recommends Qwen3-VL 4B as the core vision-language model (Qwen2.5-VL 3B remains available if you need a smaller download)."** Plus extra line: "Advanced users can pick any **vision-capable** LLM, but we strongly recommend using Qwen3-VL 4B based on our internal benchmarks." |
| `choose` | Choose engine | Heading **"Choose your local AI engine"** (24 semibold); body **"For local use, LM Studio is the most reliable; Ollama has a known thinking bug in onboarding (can't turn thinking off) and performance is unreliable."** Button **"Download LM Studio"** (LM Studio logo fetched from lmstudio.ai, fallback `desktopcomputer` icon; selects LM Studio engine and opens `https://lmstudio.ai/`). Footnote: **"Already have a local server? Make sure it’s OpenAI-compatible. You can set a custom base URL in the next step."** |
| `model` | Install model | Heading **"Install Qwen3-VL 4B"**. If engine=ollama: body "After installing Ollama, run this in your terminal to download the model (≈5GB):" + TerminalCommandView(title "Run this command:", subtitle "Downloads Qwen3 Vision 4B for Ollama", command `ollama pull qwen3-vl:4b`). If engine=lmstudio: "After installing LM Studio, download the recommended model:" + button **"Download Qwen3-VL 4B in LM Studio"** (`arrow.down.circle.fill`; opens `https://model.lmstudio.ai/download/lmstudio-community/Qwen3-VL-4B-Instruct-GGUF`) + notes "This will open LM Studio and prompt you to download the model (≈3GB)." and "Once downloaded, turn on 'Local Server' in LM Studio (default http://localhost:1234)" + manual fallback: "Manual setup:" / "1. Open LM Studio → Models tab" / "2. Search for 'Qwen3-VL-4B' and install the Instruct variant". If engine=custom: heading "Use any OpenAI-compatible VLM" + "Make sure your server exposes the OpenAI Chat Completions API and has Qwen3-VL 4B (or Qwen2.5-VL 3B if you need the legacy model) installed." |
| `test` | Test connection | Info heading **"Test Connection"**, body **"Click the button below to verify your local server responds to a simple chat completion."** + engine picker: label **"Which tool are you using?"**, segmented [`LM Studio` \| `Custom model`] (max width 380) + `LocalLLMTestView` (§3.7; inputs shown only for Custom). Passing the test then clicking Next persists local settings immediately. |
| `complete` | Complete | **"All set!"** / **"Local AI is configured and ready to use with Dayflow."** |

Saving (also done on advancing past a successful test): persists provider `ollamaLocal(endpoint)`, keys `llmLocalModelId`, `llmLocalEngine`, `llmLocalBaseURL`, `llmLocalAPIKey` (removed when blank); syncs preset key `llmLocalModelPreset`; `ollamaSetupComplete=true` on finish.

Engine model defaults: LM Studio → `Qwen3-VL-4B-Instruct`; Ollama/custom → `qwen3-vl:4b` (legacy preset: `qwen2.5-vl-3b-instruct` / `qwen2.5vl:3b`). Default base URLs: Ollama `http://localhost:11434`, LM Studio `http://localhost:1234`, Custom `http://localhost:11434`.

#### ChatGPT / Claude (`chatgpt_claude`)
| id | Title | Content |
|---|---|---|
| `intro` | Before you begin | Info heading **"Install Codex CLI (ChatGPT) or Claude Code"**; body **"If you have a paid ChatGPT/Claude account, you can have Dayflow tap into your existing usage limits. Everything flows through your current account - no extra charges - and you can opt out of training for privacy. You only need one CLI installed and signed in on this Mac; we'll verify it automatically next."** |
| `detect` | Check installations | See §3.8. |
| `test` | Test connection | Info heading **"Test Connection"**, body **"Run a quick test to verify your CLI is working and signed in."** + `ChatCLITestView` (§3.9). |
| `complete` | Complete | **"All set!"** / **"ChatGPT and Claude tooling is ready. You can fine-tune which assistant to use anytime from Settings → AI Provider."** |

Saving: `chatCLIPreferredTool` = `codex`/`claude`; `chatgpt_claudeSetupComplete=true` on finish.

### 3.5 `APIKeyInputView`

Title Figtree 16 semibold; subtitle 14 black-60%. Input row: SF Mono 13 secure field (toggle eye/eye.slash button, black 40%) + validation icon (`checkmark.circle.fill` green `#57FF73` / `xmark.circle.fill` red `#E91515`, scale/opacity transition). Row: padding 16×12, white-80% bg radius 8, border: unfocused black-10% 1px; focused 2px in state color (valid green-60% / invalid red-60% / neutral `rgb(1,0.42,0.02) @60%`). Invalid message: **"API key should start with 'AIza' and be at least 30 characters"** (Figtree 12 red). Help row: `lock.shield.fill` (green-70%) + **"Your API key is encrypted and stored in your macOS Keychain - never uploaded anywhere"** (Figtree 12, black 50%). *(Windows: reword to "Windows Credential Manager"; store via credential vault.)*

### 3.6 Gemini `TestConnectionView`

`SettingsPrimaryButton` labeled **"Test connection"** (`bolt.fill`; testing: "Testing…" + spinner). Result line = `SettingsStatusDot`: success → good + **"Connection successful."**; failure → bad + error description. If no key stored: **"No API key found. Enter your API key first."**
Test request: `POST https://generativelanguage.googleapis.com/v1beta/models/gemini-3.5-flash:generateContent?key={apiKey}` with body `{contents:[{parts:[{text:"Please respond with exactly: Hi from Gemini!"}]}], generationConfig:{temperature:0.1, maxOutputTokens:100}}`. 401/403 → "Invalid or missing API key" (or server error message). Other non-200 → server `error.message` or "Status code: N" (as "Network error: …"). Analytics: `connection_test_started/succeeded/failed {provider:"gemini", error_code?}`.

### 3.7 `LocalLLMTestView`

Optional inputs (shown per context): **"Base URL"** (placeholder = engine default), **"Model ID"** (placeholder = engine default model), and for Custom engine **"API key (optional)"** secure field placeholder `sk-live-...` with caption **"Stored locally in UserDefaults and sent as a Bearer token for custom endpoints (LiteLLM, OpenRouter, etc.)"** (labels Figtree 12 semibold secondary; fields rounded-border style).
Button: `SettingsPrimaryButton` **"Test Local API"** (`bolt.fill`; "Testing…" while running; label overridable — upgrade sheet uses "Test upgrade").
Test: `POST {baseURL}/v1/chat/completions` with JSON (snake_case) `{model, messages:[{role:"user", content:[{type:"text", text:"What color is this image? Answer with a single word."},{type:"image_url", image_url:{url:"data:image/jpeg;base64,<1280×720 white JPEG>"}}]}], max_tokens:10}`; headers: `Content-Type: application/json`; LM Studio adds `Authorization: Bearer lm-studio`; Custom adds `Authorization: Bearer <key>` when set. Request timeout 35s.
Results: HTTP 200 → good dot **"Test successful."**; if round-trip > 30s → failure with **"It took longer than 30 seconds, so your machine doesn't appear powerful enough to run this model locally."**; transport error → its message; empty response → "No response"; non-200 → `HTTP {code}: {body}`. Failure also appends hint: **"If you get stuck here, you can go back and choose the ‘Bring your own key’ option — it only takes a minute to set up."** Invalid URL → "Invalid base URL".

### 3.8 CLI detection step (`ChatCLIDetectionStepView`)

Intro paragraph (Figtree 14 black-60%): **"Dayflow can talk to ChatGPT (via the Codex CLI) or Claude Code. You only need one installed and signed in on this Mac. After installing, run `codex auth` or `claude login` in Terminal to connect it to your account."**

Two status cards side by side (spacing 14; padding 14, white-60% bg radius 12, black-5% border): logo (`ChatGPTLogo` / `ClaudeLogo`, 30×30) + short name (**"ChatGPT"** / **"Claude"**, Figtree 15 semibold) + status pill (Figtree 11):
- checking/unknown: spinner + label ("Checking…"/"Not checked") on ink-12% capsule.
- installed: **"Installed"** — green `#21B33B` on green-17% capsule.
- notFound: **"Not installed"** — red `#E91515` on `#FFD1D1` capsule.
- failed: **"Error"** — `#E85729` on 18% capsule.
Below status (notFound/failed): outline button **"Install"** (or **"Setup guide"** when failed) with `arrow.down.circle.fill` — opens Codex `https://developers.openai.com/codex/cli/` or Claude `https://docs.anthropic.com/en/docs/claude-code/setup`.

Tip line (Figtree 12 black-50%): **"Tip: Once both are installed, you can choose which provider Dayflow uses from Settings → AI Provider."**

Selection box (padding 16, white-50% radius 12, black-5% border): label **"Choose which provider Dayflow should use"** (Figtree 13 semibold) + two radio buttons (`checkmark.circle.fill`/`circle`, ink; title = short name; caption **"Ready to use"** / **"Install to enable"**; selected: white-90% bg + ink-40% border; disabled at 50% opacity until that CLI is detected).

Bottom row: **"Re-check"** primary button (arrow.clockwise; "Checking…" + spinner while running) + Next (dimmed until an available tool is selected).

Detection mechanics (macOS): runs `<tool> --version` via the user's login shell (`/bin/zsh -l -i -c`), 10s timeout; exit 0 → installed with first line of stdout as version summary; exit 127 or "command not found" → notFound; else failed with stderr. Auto-runs once on step appear; auto-picks codex → claude if the stored preference isn't available. Analytics: `chat_cli_detection_checked`, `chat_cli_tool_selected` (rich props incl. availability booleans). **Windows**: run `where codex` / `codex --version` via cmd/powershell with PATH from the user shell.

### 3.9 CLI test (`ChatCLITestView`)

Caption: **"We'll ask your CLI a simple question to verify it's working and signed in."** (Figtree 12 secondary). Button `SettingsPrimaryButton` **"Test CLI"** (`bolt.fill`; disabled with no tool; hint **"Select ChatGPT or Claude above before running the test."**).
Test: runs the selected CLI headless with prompt **"What is 2+2? Answer with just the number."** (codex: reasoning effort low, tools disabled; cwd = temp dir). Pass = exit 0 AND combined output contains "4" → good dot **"Test successful."** (result message internally "CLI is working!").
Failures:
- Auth patterns in output (`invalid api key`, `please run /login`, `401 unauthorized`, `not logged in`, `codex auth`, `claude login`, `authentication required`, `unauthorized`) → **"Claude CLI is not signed in. Run 'claude login' in Terminal to authenticate."** / **"Codex CLI is not signed in. Run 'codex auth' in Terminal to authenticate."**
- Non-zero exit, empty stderr → **"Claude CLI returned an error. You may need to sign in — run 'claude login' in Terminal."** (or codex variant); with stderr → `CLI error: {first 150 chars}`.
- Exit 0 but empty stdout → **"CLI returned empty response. Make sure you're signed in."**
- Exit 0, wrong output → `Got: "{first 100 chars}" — expected '4'`.
- CLI missing → `{ChatGPT|Claude} CLI not found. Install it and run '{codex auth|claude login}' in Terminal.`
On failure show **"Copy logs"** link button + collapsible mono debug panel (max height 120, black-3% rounded box): Tool, Exit code, Shell path, Command executed, Environment overrides, `which -a` results ("Installations found:"), stdout, stderr. Analytics: `chat_cli_test_started/succeeded/failed {provider:"chatgpt_claude", tool, setup_step:"test", duration_ms, failure_reason…}`.

---

## 4. Settings

`SettingsView` — rendered inside the main app shell on the paper background, light scheme. Layout: HStack (spacing 32; trailing pad 40): left sidebar (width 160) + content column (max width 600; the Privacy tab instead uses max width 760 and NO outer scroll since it manages its own scrolling). Content column padding: top 24, trailing 16, bottom 24. Tab switch = pure opacity fade (0.18s easeOut); the sidebar pill slides via matched-geometry.

On open: fires `settings_opened`; loads stored auth session; refreshes providers/analytics/launch-at-login state. External events: notification `.openProvidersSettings` switches to Providers; `.openAccountSettings` switches to Account.

### 4.1 Sidebar

- Header: **"Settings"** (serif 22, black 90%; leading pad 10, bottom 18).
- Tabs (Figtree 13 semibold; selected black-90% on black-6% rounded-7 pill; unselected black-55%; row padding 8×10; press scale 0.98): **Account**, **Storage**, **Privacy**, **Providers**, **Export** (internal id `data`), **Other**.
- Footer (bottom): **"Dayflow v{CFBundleShortVersionString}"** (Figtree 11, black 40%) + link **"Release notes"** with `arrow.up.right` (Figtree 11 semibold, ink) → posts `.showWhatsNew` (opens What's New modal, §9).

### 4.2 Account tab (`SettingsAccountSection`)

Composition: if entitlement status == "active" → [Current plan card]; else → [Account section] + [Upgrade section]. Then always [Referral program card]. Auth error text (Figtree 11, destructive, selectable) at bottom when present.

**Account section** — title **"Account"**, subtitle **"Sign in once to keep Dayflow Pro and cloud features attached to this Mac."** One row: label **"Dayflow account"** (subtitle = signed-in identity when signed in). Trailing: status dot (good "Signed in" / warn "Signed out") + either secondary **"Sign out"** (`rectangle.portrait.and.arrow.right`) or primary **"Sign in"** (`person.crop.circle`) which opens the sign-in sheet.

**Sign-in sheet** (`DayflowSignInSheet`, width 430, white bg, padding 26):
- Step email: serif-30 **"Sign in to Dayflow"**; caption **"Enter your email and Dayflow will send a 6 digit code."**; rounded-border field `you@example.com`; primary **"Continue"** (arrow.right) + secondary **"Cancel"**.
- Step code: serif-30 **"Check your email"**; caption **"Enter the code sent to {email}."**; big code field placeholder `000000` (mono 30 semibold, tracking 8, centered, black-4% box, digits only max 6, auto-submits at 6); buttons primary **"Verify"** (checkmark) + secondary **"Resend"** + secondary **"Change email"**. Auto-dismiss 0.25s after successful sign-in.

**Upgrade section** — title **"Upgrade to Dayflow Pro"**, subtitle **"Pick a plan, then finish securely in Stripe Checkout."**
- Two `BillingPlanCard`s (min height 132, padding 14, radius 8; selected: ink-6% fill + ink-80% border; unselected white-55% + divider border):
  - **Monthly** — price **$20**/mo (price serif 38; cadence Figtree 13 semibold secondary) — note **"Flexible monthly billing."**
  - **Yearly** — **$15**/mo — note **"Billed yearly."** — accent badge **"2 MONTHS FREE"**. Yearly selected by default.
- `ProFeatureList` (green check circle 12pt + Figtree 12 rows): "Zero setup cloud AI for timeline generation" · "Daily and weekly reports without provider setup" · "Priority support" · "Processed securely and never used to train AI models".
- CTA row: primary **"Start 14-day trial"** (`creditcard`) when signed in, else **"Sign in to upgrade"** (`person.crop.circle`); caption **"Cancel any time. No-questions-asked refunds."** + link **"Privacy policy"** (`lock` icon) → `https://dayflow.so/privacy`.

**Current plan card** (`ActiveProCard`, white rounded-10 card, divider stroke, padding 18) — section titled **"Account"** / **"Manage your Dayflow account and subscription."**
- Icon: `DayflowLogo` 34×34 (gift.fill on ink-10% tile when entitlement source == "manual" i.e. gifted).
- Title **"Dayflow Pro"** (Figtree 22 bold) or **"Gifted Pro"**; accent badge **"ACTIVE"**/**"GIFTED"**; right status dot good **"Active"**.
- Description: **"Your Pro access is active on this Mac and attached to your Dayflow account."** / gifted: **"You have complimentary Dayflow Pro access. There is no billing to manage for this account."**
- Two info tiles (uppercase Figtree 10 bold label + Figtree 14 semibold value, white-45% box): **"SIGNED IN AS"** = email; **"RENEWS"** (gifted: **"ACCESS THROUGH"**; no date: **"STATUS"**) = formatted date or "Active".
- Bottom: ProFeatureList + secondary **"Sign out"** + primary **"Manage billing"** (`creditcard`, hidden for gifted; opens Stripe billing portal).

**Referral program card** (white rounded-8 card, padding 20):
- Header: **"Refer and earn rewards"** (Figtree 16 bold, `#333333`) + **"Give a month of Dayflow Pro and get 1 month for each person you refer."** (Figtree 12).
- Underlined tab bar (Figtree 12; selected bold with 2px `#333333` underline; divider `#DFDDDB`): **"Refer"**, **"Past referrals (N)"**, **"Apply referral"**.
- Panel (padding 20, bg `#F5F4F1` radius 8):
  - **Refer**: `ReferralPassCard` (default message **"Enjoy a free month of Dayflow Pro on us."**) + **"How it works"** (bold 12) steps: (icon point.3.connected.trianglepath.dotted) "Share your invite link" · (menu-bar mark icon) "They sign up and get a **free month of Dayflow Pro!**" · (sparkles) "You get **Dayflow Pro for a week** when they use Dayflow for 40 hours!". If signed in: **"Your invite link"** (link icon + URL text, truncating middle, white box) + mini button **"Copy"**/**"Copied"** (copy style: `#D7A585` text on `#FFF5EA`, border `#F7E4CE`); **"Send invites"** (envelope icon + email field placeholder `email@example.com`) + mini button **"Send"** (send style: white on `#402C00`). If signed out: **"Sign in to get your invite link"** (bold 12) + "Referral credits are tied to your Dayflow account so we can credit you when friends join." (11, `#72706D`) + mini **"Sign in"** button.
  - **Past referrals**: up to 8 invite rows — email (12 semibold) + status line: "Reward earned" / "X.X / 40 hours recorded" / "Invite sent"; right `SettingsBadge` of `invite.status` uppercased (accent when unlocked); `#DFDDDB` separators. Empty state box: **"No invites yet."**
  - **Apply referral**: **"Redeem a referral code"** (bold 12) + mono code field (`#` icon, placeholder `ABC123`, uppercase alnum max 6) + mini **"Apply"** button (enabled at exactly 6 chars).
- Copy button feedback resets after 1.5s.

### 4.3 Storage tab (`SettingsStorageTabView`)

**Section "Recording status"** — subtitle "Ensure Dayflow can capture your screen."
- Row **"Screen recording permission"** → status dot: good "Granted" / bad "Missing".
- Row **"Recorder"** (no divider) → good "Active" (permission + recording), idle "Idle", bad "Blocked".
- Below: primary **"Run status check"** ("Checking…" while running; also purges over-cap files) + metadata "Last checked {relative time}".

**Section "Disk usage"** — subtitle "Open folders or adjust per-type storage caps."
- Two usage rows: **"Recordings"** and **"Timelapses"** — each: label + metadata line "{size} · {percent}%" (percent omitted when Unlimited); trailing secondary **"Open"** (opens folder in file manager) + limit dropdown (current label + chevron.down, ink text on black-5% pill); below: linear progress bar (ink tint) when a cap is set; divider between rows.
- Limit options: **1 GB, 2 GB, 3 GB, 5 GB, 10 GB, 20 GB, Unlimited** (bytes: 1e9 … 2e10, nil).
- Lowering a cap prompts an alert: title **"Lower {Recordings|Timelapses} limit?"**, message **"Reducing the {category} limit to {label} will immediately delete the oldest {category} data to stay under the new cap."**, destructive **Confirm** / **Cancel**. Raising applies silently. Fires `storage_limit_changed {category, previous_limit_bytes, new_limit_bytes}`.
- Footer (Figtree 12, meta): **"Recording cap: {X} • Timelapse cap: {Y}. Lowering a cap immediately deletes the oldest files for that type. Timeline card text stays preserved. Please avoid deleting files manually so you do not remove Dayflow's database."**

### 4.4 Privacy tab (`SettingsRecordingPrivacyTabView`)

Single section **"Recording privacy"** — subtitle **"Choose apps Dayflow should hide from screenshots."**
- Search field: magnifier icon + placeholder **"Search installed apps"** (Figtree 13; black-4% rounded-8 box + divider stroke). Filters by app name or bundle id.
- **"Installed apps"** grid header + right metadata **"{N} shown"** (or **"Loading apps..."**). Scrollable adaptive grid (cells 82–96 wide, spacing 12/14) inside black-2.5% rounded panel. Empty search → **"No apps match your search."**
- App cell (82×88): 44×44 app icon; when blocked, a `lock.fill` badge (white on ink circle, white ring) bottom-right and ink-8% cell background + ink-colored name; name Figtree 11 semibold, 2 lines centered. Click toggles blocked. Cells are draggable (drag payload = bundle id).
- **"Blocked apps"** tray below divider: header + metadata **"{N} blocked"** + secondary **"Clear"** (disabled when empty). Horizontal scroller of blocked app cells (click removes). Empty placeholder: **"Drag apps here to hide them from recording"** (meta color). Tray = black-3.5% rounded panel; while a drag hovers: black-8% fill + ink-35% border. Drop adds the app.
- Persistence: `blockedApplicationIdentifiers` (normalized lowercase bundle ids). A default "secret apps" seed list is applied once from installed apps. Analytics on every save: `recording_privacy_rules_saved {blocked_app_count}`. Blocked apps' windows are masked out of captures (see `RecordingPrivacyPlaceholder` in the recording pipeline). **Windows**: use exe path/AppUserModelID instead of bundle ids.

### 4.5 Providers tab (`SettingsProvidersTabView`)

Top (conditional): **Local model upgrade banner** — the one dark surface (bg `rgb(0.16,0.11,0)` rounded 14, padding 20). Shown when current provider is local AND stored model is the legacy `qwen2.5` preset AND not dismissed. Content: sparkles icon tile; **"Upgrade to Qwen3-VL 4B"** (Figtree 16 semibold white); **"Upgrade to Qwen3VL for a big improvement in quality."** (13, white 80%); bullets (green-tinted check `rgb(0.76,1,0.74)`): "New, most powerful local VLM" · "Longer reasoning chains for complex sessions" · "Fits on most Apple Silicon machines (≈5GB VRAM)". Buttons: **"Keep Qwen2.5"** (white-12% pill; dismisses forever) + **"Upgrade now →"** (white pill, black text; opens upgrade sheet).
Transient status line (statusGood): e.g. **"Upgraded to Qwen3-VL 4B"** (4s) or **"Dayflow Pro is required for hosted cards and transcription."** / **"Manage Dayflow Pro from Account."**

**Section "Current configuration"** — subtitle "Active provider and runtime details."
- Row **"Primary provider"**: name + accent badge **"PRIMARY"**.
- Row **"Secondary provider"**: name + badge **"SECONDARY"**, or metadata **"Not configured"**.
- Provider-specific rows:
  - local: **"Engine"** (Ollama/LM Studio/Custom), **"Model"** (id or "Not configured"), **"Endpoint"** (base URL), **"API key"** ("Stored in UserDefaults" / "Not set").
  - gemini: **"Model preference"** (Gemini 3.5 Flash / Gemini 3.1 Flash-Lite), **"API key"** ("Stored safely in Keychain" / "Not set").
  - chatgpt_claude: **"CLI preference"** ("ChatGPT – Codex CLI" / "Claude Code CLI" / "Codex or Claude CLI").
  - dayflow: **"Status"** ("Dayflow Pro active" / "Requires Dayflow Pro").
- Buttons: secondary **"Edit configuration"** (opens the §3 setup flow as a modal for the primary provider) and, for local, secondary **"Manage local model"** (when on recommended model) / **"Upgrade local model"** (opens upgrade sheet).

**Section "Connection health"** — subtitle "Run a quick test for the primary provider."
- Label (Figtree 13 semibold): "Gemini API" / "Local API" / "ChatGPT CLI"/"Claude CLI" / "Dayflow Backend".
- Embedded tester: gemini → `TestConnectionView`; local → `LocalLLMTestView` (inputs shown only for Custom engine; completing a test persists base/model/key); chatgpt_claude → `ChatCLITestView`; dayflow → text **"Hosted cards and transcription run through your Dayflow account."**; default → "Dayflow Pro diagnostics coming soon".

**Section "Failover routing"** — subtitle "Choose primary and secondary providers."
Five rows (dividers between; padding vertical 14). Row = name (Figtree 14 semibold) + right badge (**PRIMARY** accent / **SECONDARY** / **CONFIGURED** / **NOT SET**) + summary (Figtree 12 secondary) + action buttons.

| id | Name | Summary |
|---|---|---|
| `dayflow` | Dayflow Pro | "Hosted cards & transcription • no API keys • requires Pro" |
| `claude` | Claude | "Uses Claude Code through your existing Claude plan" |
| `chatgpt` | ChatGPT | "Uses Codex CLI through your existing ChatGPT plan" |
| `gemini` | Gemini | "Gemini free tier • fast & accurate" |
| `ollama` | Local | "Private & offline • 16GB+ RAM • less intelligent" |

Actions per row: if Dayflow Pro row and user is not Pro → primary **"Upgrade account"** (`sparkles`; jumps to Account tab, fires `dayflow_backend_provider_paywall_opened`). Otherwise: **"Setup"** (only if not yet configured; opens setup modal), **"Edit configuration"** (not for dayflow row — that routes to Account), **"Set primary"** (hidden when already primary), and **"Set secondary"** / **"Unset secondary"**.
Rules: `claude`/`chatgpt` are display splits of the single `chatgpt_claude` provider (selecting one sets `chatCLIPreferredTool`); a provider can't be secondary if it canonically equals the primary; assigning the current secondary as primary swaps them; setting the primary as secondary (when a secondary exists) also swaps. Configured checks: gemini = key in keychain or `geminiSetupComplete`; local = `ollamaSetupComplete` or base+model set; chat = `chatgpt_claudeSetupComplete` or preferred tool set; dayflow = active Pro entitlement. After a setup modal completes it fulfills the pending role (primary/secondary/setup-only). Analytics: `provider_primary_updated`, `provider_secondary_updated`, `provider_backup_updated`, `provider_setup_completed`.

**Section "Gemini model preference"** (gemini only) — subtitle "Choose which Gemini model Dayflow should prioritize." Segmented picker [`Gemini 3.5 Flash` \| `Gemini 3.1 Flash-Lite`]; caption = fallback summary (§3.4); footnote **"Dayflow automatically downgrades if your chosen model is rate limited or unavailable."** (Figtree 11 meta). Persists on change (`gemini_model_selected {source:"settings"}`).

**Prompt customization section** (per provider; hidden for dayflow):
- gemini: title **"Gemini prompt customization"**, subtitle **"Override Dayflow's defaults to tailor card generation."**, intro **"Overrides apply only when their toggle is on. Unchecked sections fall back to Dayflow's defaults."** Blocks: **"Card titles"** ("Shape how card titles read and tweak the example list."), **"Card summaries"** ("Control tone and style for the summary field."), **"Detailed summaries"** ("Define the minute-by-minute breakdown format and examples.").
- local: title **"Local prompt customization"**, subtitle **"Adjust the prompts used for local timeline summaries."**, intro **"Customize the local model prompts for summary and title generation."** Blocks: **"Timeline summaries"** ("Control how the local model writes its 2-3 sentence card summaries.") and **"Card titles"** ("Adjust the tone and examples for local title generation.").
- chatgpt_claude: title **"ChatGPT / Claude prompt customization"**, same subtitle/intro/blocks as gemini.
- Block UI: native switch toggle (ink tint) with heading+description; below it a TextEditor (Figtree 12) in a white-70% rounded-7 box with black-12% border; placeholder = the default prompt text (meta color) when empty; disabled+dimmed (60% container opacity, 40% text) when toggle off; min height 140 enabled / 120 disabled.
- Bottom-right secondary **"Reset to Dayflow defaults"** (`arrow.counterclockwise`) — clears overrides and restores defaults.
- Persistence: JSON blobs `geminiPromptOverrides` / `ollamaPromptOverrides` / `chatCLIPromptOverrides`; an override applies only when its toggle is on and text non-empty. Default texts: §12.

**Local model upgrade sheet** (`LocalModelUpgradeSheet`, modal min 720×560, scrollable, padding 32):
- Header **"Upgrade to Qwen3-VL 4B"** (Figtree 22 semibold) + **"Follow the steps below, run a quick test, and Dayflow will switch you over automatically."** + close X.
- Highlight bullets (sparkle icons) = preset bullets above.
- **"Which local runtime are you using?"** + segmented [`Ollama` \| `LM Studio` \| `Custom`].
- Instruction card (white rounded-12, padding 20) per engine:
  - Ollama/Custom: **"Install via Ollama"** / **"Make sure you're on Ollama 0.12.10 or newer before pulling the model."** / numbered: "Open Terminal", "Run the pull command below (≈5GB download)", "Keep Ollama running in the background" / TerminalCommandView("Run this command:", "Downloads Qwen3-VL 4B for Ollama", `ollama pull qwen3-vl:4b`) / note **"Need to stay on Qwen2.5? Keep your current model selected and skip this upgrade."**
  - LM Studio: **"Install inside LM Studio"** / **"Make sure you're on 0.3.31. Use LM Studio's model browser to download the GGUF build."** / numbered: "Open LM Studio and click the Models tab", "Search for \"Qwen3-VL-4B-Instruct\"", "Download the Instruct variant, then start Local Server" / primary button **"Open download in LM Studio"** (`arrow.down.circle.fill`) / note **"Tip: enable \"Launch local server\" so Dayflow can talk to LM Studio at http://localhost:1234."**
- `LocalLLMTestView` with inputs shown, button **"Test upgrade"**; on first success auto-applies (persists engine/base/model/key, marks banner dismissed, shows "Upgraded to Qwen3-VL 4B", fires `local_model_upgraded`).
- Footnote **"Once the test succeeds, Dayflow updates your settings to Qwen3-VL 4B automatically."** + bottom-right secondary **"Close"**.

### 4.6 Export tab (`SettingsDataTabView`, sidebar label "Export")

**Section "Export your data"** — subtitle "Move your timeline into tools you already use."
- Date-range pills **"FROM"** → arrow.right → **"TO"**: pill = uppercase Figtree 11 label above a button showing `MMM d, yyyy` + chevron (ink text on black-5% rounded-7, min width 170). Clicking expands an inline calendar below (only one picker open at a time; expanding one collapses the other and the reprocess picker).
- Inline calendar (`DayflowCalendarGrid`): 290 wide, white-85% rounded-10 panel with black-10% border; month header `MMMM yyyy` (Figtree 14 semibold) + chevron nav buttons (24×24, black-4% boxes); weekday initials row; day grid — selected day = white text on 28px ink circle; today = ink text + ink-35% ring. Selecting a date closes the calendar.
- Explainer: **"Use Markdown exports to archive in Notion, share with teammates, or paste into ChatGPT / Claude / Gemini for deeper analysis."** (Figtree 12 secondary)
- Primary **"Export as Markdown"** (`square.and.arrow.down`; "Exporting…" while running; disabled when start > end with inline error **"Start must be on or before end."** in destructive red).
- Flow: builds per-day Markdown sections joined by `\n\n---\n\n`, opens a save dialog (default filename `Dayflow timeline {yyyy-MM-dd} to {yyyy-MM-dd}.md`, prompt "Export"). Success message: **"Saved {N} activit(y|ies) across {M} day(s) to {filename}"** (statusGood); cancel → **"Export canceled"**; write failure → "Couldn't save file: {error}". Fires `timeline_exported {start_day, end_day, day_count, activity_count, format:"markdown", file_extension}`.

**Section "Reprocess day"** — subtitle "Re-run analysis for every batch on one timeline day."
- Single **"DAY"** date pill + inline calendar (disabled while reprocessing); below, the normalized day string `yyyy-MM-dd` (meta).
- Copy: **"Clears existing cards and observations for that day, then runs analysis again from the original recordings."** + bold-ish warning **"Heads up: this can consume a large number of API calls."**
- Primary **"Reprocess day"** (`arrow.clockwise`; "Reprocessing…" while running) → confirm alert: title **"Reprocess day?"**, buttons Cancel / destructive **Reprocess**, message **"This will delete existing timeline cards for {yyyy-MM-dd} and re-run analysis. It can consume many API calls."**
- Progress line (secondary) streams status starting with **"Starting reprocess for {day}…"**, ending **"Reprocess completed."**; errors in destructive red.
- Note: "timeline day" uses a 4 AM logical-day boundary (dates before 4 AM belong to the previous day).

### 4.7 Other tab (`SettingsOtherTabView`)

**Section "App preferences"** — subtitle "General toggles and telemetry settings." Rows (label + optional subtitle + `SettingsToggle`):

| Label | Subtitle | Pref key | Default |
|---|---|---|---|
| "Launch Dayflow at login" | "Keeps the menu bar controller running right after you sign in so capture can resume instantly." | OS login-item (SMAppService) | off |
| "Share crash reports and anonymous usage data" | — | analytics opt-in (PostHog `setOptIn`) | on (opt-out model) |
| "Show Dock icon" | "When off, Dayflow runs as a menu bar-only app." | `showDockIcon` | true |
| "Show app/website icons in timeline" | "When off, timeline cards won't show app or website icons." | `showTimelineAppIcons` | true |
| "Show daily goal popups" | "When off, Dayflow won't automatically open goal setup or yesterday's review after 4am." | DayGoalPreferences.showDailyGoalPopups | true |
| "Save all timelapses to disk" (no divider) | "New and reprocessed timeline cards will pre-generate timelapse videos and store them on disk instead of building them on demand. Uses more storage and background processing." | TimelapsePreferences.saveAllTimelapsesToDisk | false |

Toggling Dock icon immediately switches app activation policy (menu-bar-only mode). *(Windows: map to "Show taskbar icon" / tray-only.)*

**Section "Output language override"** — subtitle **"The default language is English. You can specify any language here (examples: English, 简体中文, Español, 日本語, 한국어, Français)."** Controls: rounded-border text field placeholder **"English"** (max width 220) + secondary **"Save"** (becomes **"Saved"** with check, disabled, when field matches stored value) + secondary **"Reset"** (clears override). Stored via `LLMOutputLanguagePreferences.override`.

---

## 5. Status bar (tray) menu

`StatusBarController` + `StatusMenuView`.

- Tray icon: square status item; image `MenuBarOnIcon` when recording, `MenuBarOffIcon` when not (22×18). Icon swaps reactively with recording state. Click toggles a transient popover (content 220×200, animated).
- Popover content (`StatusMenuView`): vertical stack spacing 6, padding 9, min width 200 / max 210, frosted "regular material" background, radius 12.

States:
1. **Active (recording)** — "Pause section":
   - Header **"Pause Dayflow"** (system 12 medium, secondary).
   - Duration picker: 4 segments in one pill (bg primary-6%, radius 6, 0.5px primary-8% border; 16px-tall dividers at 30% between): **"15 Min"**, **"30 Min"**, **"1 Hour"**, **"∞"** (system 11 medium). Hover: white text on accent-color rounded-5 chip (0.15s ease). Click pauses for that duration (source `menuBar`).
2. **Paused / not recording** — "Paused section":
   - If a timed pause is running: countdown badge — **"Dayflow paused for "** + mono-digit bold time (e.g. `12:34`), white on accent color, full width, radius 6.
   - Menu row **"Resume Dayflow"** (icon `play.circle`, accent tint). Resumes pause or starts recording (reason `user_menu_bar`).

Then divider (0.75px, primary-7%), and rows (`MenuRow`: 17px icon slot + system 12 semibold label; hover bg primary-8% rounded-10; pointer cursor):
- **"Open Dayflow"** — icon = `DayflowLogo` asset (16×16). Restores dock icon per `showDockIcon`, unhides, shows main window, activates app.
- **"Open Recordings"** — no icon. Opens recordings folder in file manager.
- **"Check for Updates"** — no icon. Triggers Sparkle interactive update check (§5.1).
- divider
- **"Quit Completely"** — icon `power`, red accent. Sets allow-termination and quits.

All actions dismiss the popover first, then run on the next runloop tick.

### 5.1 Updater (`UpdaterManager`, Sparkle wrapper — Windows: use electron-updater/Squirrel equivalent)

Published state consumed by UI: `isChecking`, `statusText`, `updateAvailable`, `latestVersionString`. Status strings: **"Checking…"**, **"Update available: v{X}"**, **"Latest version"**, **"Update needs authorization"**, **"Update check failed"**. Background checks run silently; manual check ("Check for Updates") shows interactive UI. Errors requiring authorization fall back to the interactive flow. Feed parameters include analytics opt-in, anonymous id, version/build. Analytics: `sparkle_check_triggered {mode: manual|background}`, `sparkle_update_found/not_found`, `sparkle_update_error`, `sparkle_install_will_start`, `sparkle_install_immediate`, `sparkle_app_relaunching`, `sparkle_update_choice`, `sparkle_cycle_finished`.

---

## 6. Notifications

`NotificationService` (system notification center) — three families, all deep-link into the app on tap (restoring the main window; honoring `showDockIcon`):

1. **Journal reminders** (`journal.intentions.weekday.N` / `journal.reflections.weekday.N`, category `journal_reminder`): repeating calendar triggers per enabled weekday.
   - Intention: title **"Set your intentions"**, body **"Take a moment to plan your day with Dayflow."** Default 9:00 AM.
   - Reflection: title **"Time to reflect"**, body **"How did your day go? Capture your thoughts."** Default 5:00 PM.
   - Defaults: enabled=false until user opts in (`journalRemindersEnabled`); weekdays default Mon–Fri (`journalReminderWeekdays`, Calendar weekday ints 2–6); times in `journalIntentionHour/Minute`, `journalReflectionHour/Minute`. Tap → journal view + journal badge.
2. **Daily recap ready** (`daily.recap.{yyyy-MM-dd}`, category `daily_recap`): fired ~immediately (1s trigger) after yesterday's recap generates. Title **"Your daily recap for yesterday is ready"**, body **"Tap to open it in Daily view."**, default sound, userInfo `{day}`. Requests permission on demand if undetermined. Tap → Daily view for that day. Registers a pending Daily badge.
3. **Weekly unlock** (`weekly.unlock`, category `weekly_unlock`): scheduled for a future unlock date. Title **"Weekly view is ready"**, body **"Tap to open your weekly review."** Tap → Weekly view. Cancelable.

Foreground presentation: banners+sound (journal also badge). Permission request options: alert+sound+badge.

**Badges** (`NotificationBadgeManager`): dock/taskbar badge shows **"1"** whenever a journal reminder or daily recap is pending; cleared when the user visits the corresponding view. Sidebar indicators mirror `hasPendingJournalReminder` / `hasPendingDailyRecap`. Daily badge state persists across launches (`notificationBadge.pendingDailyReady|pendingDailyVisible|pendingDailyTargetDay`).

Analytics: `daily_auto_generation_notification_scheduled/skipped/failed/clicked`, `…_permission_prompt_result`.

---

## 7. Feature access requirements

`FeatureAccessRequirements` — usage-based gating (not payment-based): features unlock after enough 15-minute analysis batches have completed.

- `batchDurationMinutes = 15`.
- **Daily view**: requires **5 hours** of completed batches (20 batches).
- **Chat (dashboard chat)**: requires **10 hours** (40 batches).
- Progress text format (shown on locked screens): `"0h / 5h"`, `"45m / 5h"`, `"3h / 5h"`, `"3h 15m / 10h"` — i.e. `{h}h {m}m / {required}h` with zero-parts omitted.
- **Dayflow Pro** (paid, `entitlements.plan == "pro" && status == "active"`) gates: the `dayflow` hosted provider (primary or secondary routing; non-Pro users see "Upgrade account" and the paywall status message **"Dayflow Pro is required for hosted cards and transcription."**). Weekly view unlock uses batch counting as well (`countCompletedAnalysisBatchesForWeeklyAccess`, weekly unlock notification).

---

## 8. Toasts & notices

Both render as 360-wide floating cards anchored **bottom-trailing** of the main window: padding 14, bg `#FFF8F2`, radius 12, border `#F3D9C2` 1px, shadow black-12% r12 y6. Row: leading icon + message + small `xmark` dismiss (11 semibold, black 45%); below, a compact ink primary button.

### 8.1 Timeline failure toast (`TimelineFailureToastView`)

- Icon `exclamationmark.triangle.fill` (14pt, `#C04A00`). Message Figtree 13 black-82%.
- Button: **"Open Provider Settings"** (`gearshape` 12pt + Figtree 12 semibold; ink bg radius 8 padding 14×8, overlay stroke). Opens Settings → Providers (`.openProvidersSettings`) and dismisses.
- Trigger: emitted by the LLM pipeline when a batch fails after primary+fallback. **Throttled to once per logical day** (4 AM boundary; key `timelineFailureToastLastShownDay…`). Payload carries operation, providers, rate-limit flag, error domain/code, batch id (all also sent to analytics `llm_timeline_failure_toast_shown`; dismissal/opens tracked too).
- Message copy (verbatim):
  - rate-limited & no backup: **"Dayflow hit a rate limit and no backup provider is configured. Add a backup in Settings > Providers to avoid interruptions."**
  - transcribe failure: **"Dayflow couldn't transcribe this batch. Check Settings > Providers and configure a backup provider."**
  - card-generation failure: **"Dayflow couldn't generate timeline cards for this batch. Check Settings > Providers and configure a backup provider."**
  - unknown op: **"Dayflow couldn't finish this batch. Check Settings > Providers and configure a backup provider."**

### 8.2 Screen-recording permission notice (`ScreenRecordingPermissionNoticeView`)

- Icon `record.circle.fill` (15pt, `#C7352D`). Title **"Screen recording access needed"** (Figtree 13 semibold); body **"Dayflow cannot update your timeline until access is restored."** (Figtree 12, black 62%).
- Button **"Open System Settings"** (`gearshape`) → macOS Screen-Recording privacy pane. Dismissed state is remembered for the session; the notice auto-hides if permission returns (checked on app activation). Trigger: recorder detects revoked capture permission and posts `.showScreenRecordingPermissionNotice {reason}`. Analytics: `screen_permission_notice_clicked_settings`, `screen_permission_notice_dismissed`.
- **Windows**: only needed if using an OS capture path that can be revoked; otherwise repurpose for "capture failed" errors.

---

## 9. What's New view

`WhatsNewView` — modal card: width 780, max height 760, white rounded-16, big soft shadow (black 25% r40 y20), inner padding 44×36, scrollable, light scheme. Shown (a) automatically once per release when `lastSeenWhatsNewVersion` ≠ configured release and the configured version ≤ app version (fresh installs seed the key and skip), (b) manually via Settings footer "Release notes" (`.showWhatsNew`).

Content:
- Header: **"What's New in {version} 🎉"** (serif 32) + circular X close (13 semibold on black-5% circle; Esc works).
- Bullet list: 6px ink-60% dot + Figtree 15 black-75% text. Current configured release (version override "1.13.0", title "New Weekly View Now Available") bullets (verbatim):
  1. "We're experimenting with a new Weekly view that helps you understand your time at a higher level."
  2. "We haven't tested it with a huge variety of data, so please send in reports if something looks weird or off."
  3. "Lastly, it would be immensely helpful if you could offer some feedback on the new goals feature."
- **Goal survey block**: heading **"Has setting a daily goal been helpful?"** (Figtree 15 semibold) + caption **"A quick answer helps shape where goals go next."** Three equal-width option chips: **"Helpful"**, **"Not sure yet"**, **"Not helpful"** (Figtree 14; selected: ink-6% fill + ink-28% border + semibold; unselected white + black-10% border). Selecting immediately submits. Below: **"What would make goals better?"** + multiline editor placeholder **"More control, better reminders, clearer progress, something else..."** (white rounded-10 box, black-10% border, min height 78). Submit button **"Send feedback"** (`paperplane.fill`; "Saving..." while busy; ink, radius 8, padding 14×9). After success: inline label **"Saved."** with check icon. Error: **"Could not submit. Please try again."** Survey state persists per version in UserDefaults; posts JSON to `{backend}/v1/release-survey`.
- Optional preview intro text, preview images (rounded-12, hairline border, extend 36px into margins), and optional CTA block (bold title + description + calendar-icon ink button opening a URL).
- Dismissal marks version seen; analytics `whats_new_dismissed {version, provider_label}`, screen `whats_new`, `whats_new_cta_opened`.

---

## 10. Bug report view

`BugReportView` — full page (top padding 100, horizontal 48), centered stack spacing 36.

- **"Thanks for using Dayflow"** (serif 40, black 90%).
- Paragraph (Figtree 16, black 65%, centered, max width 520): **"Email works great if you want to drop a quick note, Discord if you want to join the community, and if you’d prefer to chat, find some time on my calendar - I’d love to dig into why Dayflow is or isn’t working well for you."**
- Group label **"REACH OUT"** (Figtree 14 medium, uppercase, tracking 0.75, black 55%). Three white pill buttons (white bg, black text, black-12% border, radius 18, padding 28×16, shadow):
  - `envelope.fill` **"Email"** → `mailto:jerry@dayflow.so?subject=Dayflow feedback`
  - `DiscordGlyph` **"Join Discord"** → `https://discord.gg/9YPAtctE6k`
  - `calendar.badge.clock` **"Calendar"** → `https://cal.com/jerry-liu/15min`
- Group label **"QUICK UTILITIES"**. Two white buttons (radius 14, padding ~20-22×14):
  - `doc.on.doc` **"Copy email"** → **"Copied!"** (5s reset) — copies `jerry@dayflow.so`.
  - `ladybug.fill` **"Copy debug logs"** → **"Preparing..."** → **"Copied!"** (5s reset) — assembles a debug log from the last 5 timeline cards, their batches' LLM calls (fallback: last 20 global calls), and last 5 analysis batches, and puts it on the clipboard.
- Analytics: `bug_report_email_tapped`, `bug_report_email_copied`, `bug_report_discord_tapped`, `bug_report_call_tapped`, `bug_report_debug_logs_copied {counts}`.

---

## 11. Preference-key appendix

| Key | Type | Default | Meaning |
|---|---|---|---|
| `didOnboard` | bool | false | Onboarding finished |
| `onboardingStep` | int | 0 | Resume step |
| `onboardingStepSchemaVersion` | int | 5 | Step migration version |
| `onboardingStarted` | bool | false | `onboarding_started` fired once |
| `onboardingHasPaidAI` | string | "" | "yes"/"no" from preferences step |
| `onboardingSelectedRole` | string | — | Role chip choice |
| `onboardingAppliedCategoryPreset` | string | — | Which preset was applied |
| `onboardingCategoriesCustomized` | bool | false | User edited preset categories |
| `selectedLLMProvider` | string | "gemini" | Display provider id (`gemini`/`ollama`/`chatgpt_claude`/`dayflow`) |
| `llmProviderType` | JSON | geminiDirect | Canonical provider type incl. endpoints (dayflow endpoint default `https://web-production-f3361.up.railway.app`; ollama default `http://localhost:11434`) |
| `geminiSelectedModel_v3` | JSON | `{primary:"gemini-3.5-flash"}` | Gemini model preference |
| Keychain service `gemini` | string | — | Gemini API key (→ Windows Credential Manager) |
| `geminiSetupComplete` / `ollamaSetupComplete` / `chatgpt_claudeSetupComplete` | bool | false | Setup-flow finished flags |
| `llmLocalEngine` | string | "ollama" | `ollama`/`lmstudio`/`custom` |
| `llmLocalBaseURL` | string | engine default | Local server base URL |
| `llmLocalModelId` | string | preset default | Local model id |
| `llmLocalAPIKey` | string | — | Optional bearer for custom endpoints (plain UserDefaults) |
| `llmLocalModelPreset` | string | — | `qwen3_vl_4b` / `qwen25_vl_3b` |
| `llmLocalModelUpgradeDismissed` | bool | false | Upgrade banner dismissed |
| `chatCLIPreferredTool` | string | — | `codex` / `claude` |
| Backup routing keys (`LLMProviderRoutingPreferences`) | — | none | Secondary provider + its CLI tool |
| `geminiPromptOverrides` / `ollamaPromptOverrides` / `chatCLIPromptOverrides` | JSON | empty | Prompt customization |
| `showDockIcon` | bool | true | Dock/taskbar icon |
| `showTimelineAppIcons` | bool | true | Timeline favicon display |
| DayGoal `showDailyGoalPopups` | bool | true | Auto goal popups |
| Timelapse `saveAllTimelapsesToDisk` | bool | false | Pre-generate timelapses |
| `LLMOutputLanguagePreferences.override` | string | "" | Output language override |
| Storage caps (`StoragePreferences.recordingsLimitBytes` / `timelapsesLimitBytes`) | int64 | see options | Per-type caps (Int64.max = unlimited) |
| `blockedApplicationIdentifiers` (RecordingPrivacyPreferences) | [string] | seeded secret apps | Privacy-blocked apps |
| `journalRemindersEnabled`, `journalIntentionHour/Minute` (9:00), `journalReflectionHour/Minute` (17:00), `journalReminderWeekdays` (Mon–Fri) | — | — | Journal reminders |
| `notificationBadge.pendingDailyReady/pendingDailyVisible/pendingDailyTargetDay` | — | — | Daily badge persistence |
| `lastSeenWhatsNewVersion` | string | seeded on first run | What's New gating |
| `whatsNewGoalSurveySubmittedVersion`, `whatsNewGoalHelpfulness_…`, `whatsNewGoalImprovement_…`, `whatsNewReleaseSurveyResponseID_…` | — | — | Release survey state |
| `timelineFailureToastLastShownDay` (approx name) | string | — | Toast day-throttle |

---

## 12. Default prompt texts (verbatim)

These are the placeholder/default contents of the prompt-customization editors (Settings → Providers). Store them as constants; they double as the effective prompt block when the override toggle is off.

### 12.1 `GeminiPromptDefaults.titleBlock`

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

### 12.2 `GeminiPromptDefaults.summaryBlock`

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

### 12.3 `GeminiPromptDefaults.detailedSummaryBlock`

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

### 12.4 `OllamaPromptDefaults.summaryBlock`

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

### 12.5 `OllamaPromptDefaults.titleBlock`

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

### 12.6 `ChatCLIPromptDefaults.titleBlock`

```
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
```

### 12.7 `ChatCLIPromptDefaults.summaryBlock`

```
SUMMARIES

2-3 sentences max. First person without "I". Just state what happened.

Good:
- "Refactored user auth module in React, added OAuth support. Hit CORS issues with the backend API."
- "Designed landing page mockups in Figma. Exported assets and started implementing in Next.js."
- "Searched flights to Tokyo, coordinated dates with Evan and Anthony over Messages. Looked at Shibuya apartments on Blueground."

Bad:
- "Kicked off the morning by diving into design work before transitioning to development tasks." (filler, vague)
- "Started with refactoring before moving on to debugging some issues." (wordy, no specifics)
- "The session involved multiple context switches between different parts of the application." (says nothing)

Never use:
- "kicked off", "dove into", "started with", "began by"
- Third person ("The session", "The work")
- Mental states or assumptions about intent
```

### 12.8 `ChatCLIPromptDefaults.detailedSummaryBlock`

```
DETAILED SUMMARY

Granular activity log. This is the "show me exactly what happened" view.

Format:
[H:MM AM/PM] - [H:MM AM/PM]: [specific action] [in app/tool] [on what]
Each line should be one sentence (~25 words max). Be concise but detailed.

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
7:30 AM - 7:35: AM Slack
7:35 AM - 8:00 AM coding"
(Too coarse — what doc? which Slack channel? coding what?)
```

---

## Assets referenced (need Windows equivalents/exports)

`OnboardingBackgroundv2` (paper background), `DayflowLogo`, `DayflowLogoMainApp`, `GeminiLogo`, `ChatGPTLogo`, `ClaudeLogo`, `ScreenRecordingPermissions` (screenshot), `ReferralCardBackground`, `MenuBarOnIcon`/`MenuBarOffIcon` (tray), `CategoriesDelete` (trash icon), `DiscordGlyph`, `GithubIcon`, `OnboardingTimeline`, `OnboardingHow`/`OnboardingSecurity`/`OnboardingUnderstanding` (legacy), videos `DayflowOnboarding.mp4` + `DayflowAnimation.mp4`. Fonts: Instrument Serif, Figtree, Nunito (all Google Fonts), plus a monospace stack.
