/**
 * SpeakEasy TTS Proxy — Vercel serverless function
 *
 * Proxies text-to-speech requests to cloud providers:
 *   - edge: Microsoft Edge TTS (free, no account, per-request auth)
 *   - google: Google Cloud Text-to-Speech (generous free tier, needs API key)
 *
 * GET  /api/tts?action=voices&provider=edge
 * POST /api/tts  body: { provider, voice, text, rate?, pitch?, key? }
 */

/* ── Hardcoded Edge neural English voices ── */
const EDGE_VOICES = [
  { name: "en-US-AriaNeural", label: "Aria (US female)", lang: "en-US", quality: "neural" },
  { name: "en-US-JennyNeural", label: "Jenny (US female)", lang: "en-US", quality: "neural" },
  { name: "en-US-GuyNeural", label: "Guy (US male)", lang: "en-US", quality: "neural" },
  { name: "en-US-AnaNeural", label: "Ana (US female, child)", lang: "en-US", quality: "neural" },
  { name: "en-US-MichelleNeural", label: "Michelle (US female)", lang: "en-US", quality: "neural" },
  { name: "en-US-EricNeural", label: "Eric (US male)", lang: "en-US", quality: "neural" },
  { name: "en-US-ChristopherNeural", label: "Christopher (US male)", lang: "en-US", quality: "neural" },
  { name: "en-US-DavisNeural", label: "Davis (US male)", lang: "en-US", quality: "neural" },
  { name: "en-US-JaneNeural", label: "Jane (US female)", lang: "en-US", quality: "neural" },
  { name: "en-US-JasonNeural", label: "Jason (US male)", lang: "en-US", quality: "neural" },
  { name: "en-US-NancyNeural", label: "Nancy (US female)", lang: "en-US", quality: "neural" },
  { name: "en-US-SaraNeural", label: "Sara (US female)", lang: "en-US", quality: "neural" },
  { name: "en-US-TonyNeural", label: "Tony (US male)", lang: "en-US", quality: "neural" },
  { name: "en-GB-SoniaNeural", label: "Sonia (UK female)", lang: "en-GB", quality: "neural" },
  { name: "en-GB-RyanNeural", label: "Ryan (UK male)", lang: "en-GB", quality: "neural" },
  { name: "en-GB-LibbyNeural", label: "Libby (UK female)", lang: "en-GB", quality: "neural" },
  { name: "en-GB-MaisieNeural", label: "Maisie (UK female)", lang: "en-GB", quality: "neural" },
  { name: "en-AU-NatashaNeural", label: "Natasha (AU female)", lang: "en-AU", quality: "neural" },
  { name: "en-AU-WilliamNeural", label: "William (AU male)", lang: "en-AU", quality: "neural" },
  { name: "en-IN-NeerjaNeural", label: "Neerja (IN female)", lang: "en-IN", quality: "neural" },
  { name: "en-IN-PrabhatNeural", label: "Prabhat (IN male)", lang: "en-IN", quality: "neural" },
];

/* ── Hardcoded Google Cloud TTS English voices ── */
const GOOGLE_VOICES = [
  // Chirp 3 HD (newest, best quality — free tier: 1M chars/month)
  { name: "en-US-Chirp3-HD-Aoede", label: "Aoede (US female, Chirp 3 HD)", lang: "en-US", quality: "neural" },
  { name: "en-US-Chirp3-HD-Charon", label: "Charon (US male, Chirp 3 HD)", lang: "en-US", quality: "neural" },
  { name: "en-US-Chirp3-HD-Kore", label: "Kore (US female, Chirp 3 HD)", lang: "en-US", quality: "neural" },
  { name: "en-US-Chirp3-HD-Puck", label: "Puck (US male, Chirp 3 HD)", lang: "en-US", quality: "neural" },
  { name: "en-US-Chirp3-HD-Leda", label: "Leda (US female, Chirp 3 HD)", lang: "en-US", quality: "neural" },
  // WaveNet (very good — free tier: 1M chars/month)
  { name: "en-US-Wavenet-A", label: "Wavenet A (US female)", lang: "en-US", quality: "neural" },
  { name: "en-US-Wavenet-B", label: "Wavenet B (US male)", lang: "en-US", quality: "neural" },
  { name: "en-US-Wavenet-C", label: "Wavenet C (US female)", lang: "en-US", quality: "neural" },
  { name: "en-US-Wavenet-D", label: "Wavenet D (US male)", lang: "en-US", quality: "neural" },
  { name: "en-US-Wavenet-E", label: "Wavenet E (US female)", lang: "en-US", quality: "neural" },
  { name: "en-US-Wavenet-F", label: "Wavenet F (US female)", lang: "en-US", quality: "neural" },
  { name: "en-US-Wavenet-G", label: "Wavenet G (US female)", lang: "en-US", quality: "neural" },
  { name: "en-US-Wavenet-H", label: "Wavenet H (US female)", lang: "en-US", quality: "neural" },
  { name: "en-US-Wavenet-I", label: "Wavenet I (US male)", lang: "en-US", quality: "neural" },
  { name: "en-US-Wavenet-J", label: "Wavenet J (US male)", lang: "en-US", quality: "neural" },
  { name: "en-GB-Wavenet-A", label: "Wavenet A (UK female)", lang: "en-GB", quality: "neural" },
  { name: "en-GB-Wavenet-B", label: "Wavenet B (UK male)", lang: "en-GB", quality: "neural" },
  { name: "en-GB-Wavenet-C", label: "Wavenet C (UK female)", lang: "en-GB", quality: "neural" },
  { name: "en-GB-Wavenet-D", label: "Wavenet D (UK male)", lang: "en-GB", quality: "neural" },
  { name: "en-AU-Wavenet-A", label: "Wavenet A (AU female)", lang: "en-AU", quality: "neural" },
  { name: "en-AU-Wavenet-B", label: "Wavenet B (AU male)", lang: "en-AU", quality: "neural" },
  // Standard (more robotic but large free tier: 4M chars/month)
  { name: "en-US-Standard-A", label: "Standard A (US female)", lang: "en-US", quality: "standard" },
  { name: "en-US-Standard-B", label: "Standard B (US male)", lang: "en-US", quality: "standard" },
  { name: "en-US-Standard-C", label: "Standard C (US female)", lang: "en-US", quality: "standard" },
  { name: "en-US-Standard-D", label: "Standard D (US male)", lang: "en-US", quality: "standard" },
  { name: "en-US-Standard-E", label: "Standard E (US female)", lang: "en-US", quality: "standard" },
  { name: "en-US-Standard-G", label: "Standard G (US female)", lang: "en-US", quality: "standard" },
  { name: "en-US-Standard-H", label: "Standard H (US female)", lang: "en-US", quality: "standard" },
  { name: "en-GB-Standard-A", label: "Standard A (UK female)", lang: "en-GB", quality: "standard" },
  { name: "en-GB-Standard-C", label: "Standard C (UK female)", lang: "en-GB", quality: "standard" },
  { name: "en-GB-Standard-D", label: "Standard D (UK male)", lang: "en-GB", quality: "standard" },
];

/* ── Helpers ── */
function escapeXml(s) {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&apos;");
}

function json(res, data, status) {
  res.status(status || 200).setHeader("Content-Type", "application/json").send(JSON.stringify(data));
}

/* ── Edge TTS ── */
async function getEdgeToken() {
  const r = await fetch("https://edge.microsoft.com/translate/auth", {
    headers: { "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Edge/131.0.0.0" },
  });
  if (!r.ok) throw new Error(`Edge token failed: ${r.status}`);
  return r.text();
}

function synthesizeEdge(req, res) {
  const { voice, text, rate, pitch } = req.body || {};
  if (!text) return json(res, { error: "Missing 'text' field" }, 400);

  const v = voice || "en-US-AriaNeural";
  const prosodyRate = rate != null ? (rate >= 0 ? `+${Math.round(rate * 100)}%` : `${Math.round(rate * 100)}%`) : "+0%";
  const prosodyPitch = pitch != null ? (pitch >= 0 ? `+${Math.round(pitch)}Hz` : `${Math.round(pitch)}Hz`) : "+0Hz";

  const ssml =
    `<speak version="1.0" xmlns="http://www.w3.org/2001/10/synthesis" xmlns:mstts="https://www.w3.org/2001/mstts" xml:lang="${v.slice(0, 5)}"><voice name="${v}"><prosody rate="${prosodyRate}" pitch="${prosodyPitch}">${escapeXml(text)}</prosody></voice></speak>`;

  getEdgeToken()
    .then(function (token) {
      return fetch(
        `https://speech.platform.bing.com/consumer/speech/synthesize/readaloud/edge/v1?TrustedClientToken=${encodeURIComponent(token)}`,
        {
          method: "POST",
          headers: {
            "Content-Type": "application/ssml+xml",
            "X-Microsoft-OutputFormat": "audio-24khz-48kbitrate-mono-mp3",
            "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Edge/131.0.0.0",
          },
          body: ssml,
        }
      );
    })
    .then(async function (ttsRes) {
      if (!ttsRes.ok) {
        const errText = await ttsRes.text().catch(function () { return ""; });
        throw new Error(`Edge TTS failed: ${ttsRes.status} ${errText.slice(0, 200)}`);
      }
      return ttsRes.arrayBuffer();
    })
    .then(function (buf) {
      // Strip any non-MP3 prefix (Edge sometimes prepends headers like "Path:audio\r\n")
      const data = new Uint8Array(buf);
      let start = 0;
      for (let i = 0; i < Math.min(data.length - 2, 256); i++) {
        if (data[i] === 0xff && (data[i + 1] & 0xe0) === 0xe0) { start = i; break; }
        if (i < data.length - 3 && data[i] === 0x49 && data[i + 1] === 0x44 && data[i + 2] === 0x33) { start = i; break; } // "ID3"
      }
      const clean = start > 0 ? data.slice(start) : data;
      res.setHeader("Content-Type", "audio/mpeg");
      res.setHeader("Content-Length", clean.length);
      res.send(Buffer.from(clean));
    })
    .catch(function (err) {
      json(res, { error: err.message || "Edge TTS error" }, 502);
    });
}

/* ── Google Cloud TTS ── */
async function synthesizeGoogle(req, res) {
  const { voice, text, rate, pitch, key } = req.body || {};
  if (!text) return json(res, { error: "Missing 'text' field" }, 400);
  if (!key) return json(res, { error: "Google API key required — add it in Settings > Voice" }, 400);

  const v = voice || "en-US-Chirp3-HD-Aoede";
  const body = {
    input: { text: text },
    voice: { languageCode: v.slice(0, 5), name: v },
    audioConfig: {
      audioEncoding: "MP3",
      speakingRate: typeof rate === "number" ? Math.max(0.25, Math.min(4.0, 1.0 + rate)) : 1.0,
      pitch: typeof pitch === "number" ? Math.max(-20, Math.min(20, pitch)) : 0.0,
    },
  };

  try {
    const r = await fetch(`https://texttospeech.googleapis.com/v1/text:synthesize?key=${encodeURIComponent(key)}`, {
      method: "POST",
      headers: { "Content-Type": "application/json; charset=utf-8" },
      body: JSON.stringify(body),
    });

    if (!r.ok) {
      const err = await r.json().catch(function () { return {}; });
      const msg = err.error ? err.error.message || err.error.status : r.statusText;
      if (r.status === 403 || r.status === 400) {
        return json(res, { error: `Google TTS: ${msg} (check your key in Settings or verify billing is enabled)` }, r.status);
      }
      if (r.status === 429) {
        return json(res, { error: "Google TTS quota exhausted — free tier resets monthly. Using browser voice instead." }, 429);
      }
      return json(res, { error: `Google TTS: ${msg}` }, r.status);
    }

    const data = await r.json();
    if (!data.audioContent) return json(res, { error: "No audio returned from Google TTS" }, 502);

    res.setHeader("Content-Type", "audio/mpeg");
    res.send(Buffer.from(data.audioContent, "base64"));
  } catch (err) {
    json(res, { error: err.message || "Google TTS error" }, 502);
  }
}

/* ── Main handler ── */
export default function handler(req, res) {
  // CORS
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");

  if (req.method === "OPTIONS") return res.status(204).end();

  try {
    const url = new URL(req.url, `http://${req.headers.host || "localhost"}`);
    const action = url.searchParams.get("action");
    const provider = url.searchParams.get("provider");

    // ── GET /api/tts?action=voices&provider=edge ──
    if (req.method === "GET" && action === "voices") {
      if (provider === "edge") return json(res, EDGE_VOICES);
      if (provider === "google") return json(res, GOOGLE_VOICES);
      // Return all cloud voices
      if (!provider || provider === "all") {
        return json(res, {
          edge: EDGE_VOICES,
          google: GOOGLE_VOICES,
        });
      }
      return json(res, { error: "Unknown provider. Use 'edge' or 'google'." }, 400);
    }

    // ── POST /api/tts ──
    if (req.method === "POST") {
      if (!req.body) {
        // Parse body for serverless environments that don't auto-parse
        let raw = "";
        req.on("data", function (chunk) { raw += chunk; });
        req.on("end", function () {
          try { req.body = JSON.parse(raw); } catch (e) { req.body = {}; }
          routeSynthesize(req, res);
        });
        return;
      }
      return routeSynthesize(req, res);
    }

    return json(res, { error: "Method not allowed" }, 405);
  } catch (err) {
    return json(res, { error: err.message || "Internal error" }, 500);
  }
}

function routeSynthesize(req, res) {
  const p = (req.body || {}).provider;
  if (p === "edge") return synthesizeEdge(req, res);
  if (p === "google") return synthesizeGoogle(req, res);
  return json(res, { error: "Missing or unknown 'provider'. Use 'edge' or 'google'." }, 400);
}
