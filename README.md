# SpeakEasy: Voice Interview & Speaking Coach

A single-page, client-side speaking and interview coach. It gives you a prompt, listens to your spoken answer, measures your real delivery (pace, pauses, energy, pitch), detects fillers with on-device Whisper, and gives grounded coaching plus progress tracking over time.

Everything runs in the browser. Your audio never leaves your machine (Whisper runs locally via WebGPU/WASM). Only the text transcript is sent to Google's Gemini API for the coaching narration.

## Requirements

- Google Chrome or Edge on desktop (uses the Web Speech API, Web Audio API, and MediaRecorder).
- A free Gemini API key from https://aistudio.google.com/apikey (no credit card). Paste it into Settings inside the app; it is stored only in your browser's localStorage.

## Run locally

- Open `index.html` in Chrome, or serve it: `python -m http.server 8000` then visit `http://localhost:8000/`.
- The microphone and speech features need a secure context, so use `localhost` or the deployed HTTPS URL rather than opening the file directly if the mic misbehaves.

## Deploy (Vercel, git-based): do this on your personal machine and accounts

1. Create a new empty repo in your personal GitHub (private is fine).
2. In this folder, on your own PC:
   ```
   git init -b main
   git add .
   git commit -m "SpeakEasy voice coach"
   git remote add origin https://github.com/<you>/<repo>.git
   git push -u origin main
   ```
3. Go to https://vercel.com , sign in with your personal account, click "Add New Project", and import the GitHub repo. Set the project name to `speakeasy` so the URL becomes `speakeasy.vercel.app`. If that name is taken, use a close variant such as `speakeasy-coach` or `speakeasy-app`. No framework, no build step: it is static.
4. Every future `git push` auto-deploys.

## Security notes

- Never commit your API key. It is only ever pasted into the running page and lives in your browser. `.env` and `*.key` are gitignored as a safety net.
- Optional hardening: in Google Cloud Console, restrict the API key by HTTP referrer to your Vercel domain so an extracted key cannot be used elsewhere.

## Settings

- Model: current Gemini Flash options (default `gemini-3.5-flash`).
- Precise filler detection (on-device Whisper): first use downloads the model once, then it is cached.
- Real voice analysis (energy, pitch, pauses) and SpeakEasy speaking aloud can be toggled.
