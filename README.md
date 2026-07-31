# SpeakEasy: Voice Interview & Speaking Coach

A single-page, client-side voice coaching studio. It asks you interview questions, listens to your spoken answers, measures your real delivery, detects fillers with on-device Whisper, and gives grounded AI coaching with progress tracking over time.

Everything runs in the browser. Audio never leaves your machine (Whisper runs locally via WebGPU or WASM). Only the transcript text is sent to the AI provider for coaching feedback.

---

## Features

### Three practice modes
- **Coach** — AI asks tailored questions (optionally based on your target role + job description), then scores your delivery on filler words, pacing, clarity, and confidence. Adds a STAR structure score for behavioural questions.
- **Roleplay** — AI adopts a persona (e.g. "a skeptical hiring manager for a PM role"). You stay in character until you say "break," then you get a full coaching debrief.
- **Drill** — On-device metrics only. No AI calls. Unlimited use. Two sub-modes:
  - **Random topics** — Serves a random non-technical prompt from a bank of 177 topics across five categories (Impromptu, Storytelling, Opinion, Explain, Persuasive). You answer and get voice metrics. Press "New prompt" for another topic. All prompts are accessible to any audience — no technical knowledge assumed.
  - **Free practice** — No topics served. Just press the mic, speak, and see your filler count, pace, energy, and pitch after each recording. Great for filler-word drills, warming up, or practising a talk you already know.

### Real voice metrics (no server needed)
Captured from your microphone in real time:
- Speaking pace (wpm) with a pace-over-time sparkline
- Energy drop at sentence ends (trailing off detection)
- Pitch variety (monotone vs dynamic) with mean Hz
- Uptalk detection at phrase endings
- Pause count and longest pause duration
- Hedging word analysis ("I think", "maybe", "just", etc.)
- Sentence length and vocabulary variety

### On-device Whisper filler detection
- Precisely counts vocalised fillers (um, uh, er) and discourse crutches (like, you know, I mean, sort of, basically, etc.)
- Word-level timed transcript with fillers colour-highlighted — click any word to replay that moment
- "Play all fillers" button to hear every crutch in sequence
- Runs entirely on your machine via Hugging Face Transformers.js (WebGPU if available, else CPU)

### AI coaching (Gemini or OpenRouter)
- Detailed debrief after every answer: what landed, what to fix with quoted excerpts and suggested rephrases, and a single focus for next time
- Option to use any free OpenRouter model (Llama, Qwen, Mistral, Gemma, etc.) — browse live from Settings
- Provider switching: if one provider hits its daily cap the app offers to switch to the other

### Progress tracking
- Score trends over time across all four dimensions (plus STAR structure)
- Session averages, trend direction, and auto-detected focus area
- Goal tracking: filler count and pace targets with hit-rate over recent sessions

### Session reports
- Printable session summary with every question, answer, metrics, and debrief
- One-click print from the report button

### Other
- SpeakEasy reads prompts and feedback aloud (browser TTS with voice selection)
- Keyboard shortcut: press **Space** to toggle the microphone (when a session is active)
- Dark console design system with live waveform visualisation
- Resizable two-pane layout (conversation | metrics)
- Usage tracker with per-provider daily caps so you stay within free-tier limits

---

## Requirements

- **Google Chrome or Edge** on desktop (uses Web Speech API, Web Audio API, MediaRecorder, and WebGPU).
- A free API key from **one** of:
  - [Google AI Studio](https://aistudio.google.com/apikey) — Gemini free tier (~20 requests/day, no credit card)
  - [OpenRouter](https://openrouter.ai/keys) — free tier (~50 requests/day across many models, no credit card; 1000/day after a one-time $10 credit)
- Keys are stored only in your browser's localStorage / sessionStorage. They are never sent anywhere except to the provider you choose.

---

## Run locally

Serve the folder over HTTPS (the microphone and speech APIs need a secure context):

```
python -m http.server 8000
```

Then visit `http://localhost:8000/`.

Opening `index.html` directly from disk may work for basic browsing but the mic features need `localhost` or HTTPS.

---

## Deploy (Vercel)

1. Push this repo to your personal GitHub.
2. On [vercel.com](https://vercel.com), import the repo as a new project.
3. No framework, no build step — it is pure static HTML/CSS/JS. Vercel serves it as-is.
4. Every `git push` auto-deploys.

The included `vercel.json` sets security headers (Referrer-Policy, X-Content-Type-Options).

---

## Security

- **No API key is ever stored in any file.** Keys are entered into the running page and live only in your browser's `localStorage` or `sessionStorage`.
- `.env`, `*.key`, and screenshot files are gitignored as a safety net.
- The `index.html` Content-Security-Policy header restricts scripts, styles, and connections to the minimum needed origins.
- The on-device Whisper model downloads once from Hugging Face and runs entirely on your machine — your audio never leaves your browser.
- Recommended: in Google Cloud Console, restrict your Gemini API key by HTTP referrer to your Vercel domain so a leaked key cannot be reused elsewhere.

---

## Files

| File | Purpose |
|------|---------|
| `index.html` | Full application — UI, styles (CSS-in-HTML), and markup |
| `app.js` | All client-side logic — AI calls, voice recording, metrics, Whisper, progress tracking |
| `vercel.json` | Vercel deployment config (security headers) |
| `.gitignore` | Keeps dev artefacts out of the repo |

---

## Settings reference

- **Provider** — Gemini or OpenRouter
- **API key** — pasted in Settings or the onboarding screen; test button verifies it
- **Model** — Gemini Flash options (2.5, 3.1, 3.5) or any OpenRouter free-tier model
- **Voice & analysis** — TTS on/off, voice selection, real audio analysis toggle, on-device Whisper toggle with model choice (base.en ~145 MB or tiny.en ~40 MB)
- **Goals** — max fillers per answer, target pace range (wpm)
- **Practice setup** — target role, seniority, and job description for tailored questions
- **Daily caps** — configurable per-provider request limits to match your free-tier quotas
