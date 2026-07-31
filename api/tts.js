/**
 * SpeakEasy TTS Proxy — Vercel serverless function
 *
 * Proxies text-to-speech requests to Microsoft Edge TTS.
 * Edge TTS uses per-request anonymous tokens — no account, no API key, no quota.
 *
 * GET  /api/tts?action=voices&provider=edge
 * POST /api/tts  body: { provider: "edge", voice, text, rate?, pitch? }
 */

/* ── Edge TTS English neural voices ── */
const EDGE_VOICES = [
  { name: "en-US-AriaNeural", label: "Aria (US female)", lang: "en-US", quality: "neural" },
  { name: "en-US-JennyNeural", label: "Jenny (US female)", lang: "en-US", quality: "neural" },
  { name: "en-US-GuyNeural", label: "Guy (US male)", lang: "en-US", quality: "neural" },
  { name: "en-US-AnaNeural", label: "Ana (US female)", lang: "en-US", quality: "neural" },
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
  if (!r.ok) throw new Error("Edge token failed: " + r.status);
  return r.text();
}

function synthesizeEdge(req, res) {
  const { voice, text, rate, pitch } = req.body || {};
  if (!text) return json(res, { error: "Missing 'text' field" }, 400);

  const v = voice || "en-US-AriaNeural";
  const prosodyRate = rate != null ? (rate >= 0 ? "+" + Math.round(rate * 100) + "%" : Math.round(rate * 100) + "%") : "+0%";
  const prosodyPitch = pitch != null ? (pitch >= 0 ? "+" + Math.round(pitch) + "Hz" : Math.round(pitch) + "Hz") : "+0Hz";

  const ssml =
    '<speak version="1.0" xmlns="http://www.w3.org/2001/10/synthesis" xmlns:mstts="https://www.w3.org/2001/mstts" xml:lang="' + v.slice(0, 5) + '"><voice name="' + v + '"><prosody rate="' + prosodyRate + '" pitch="' + prosodyPitch + '">' + escapeXml(text) + '</prosody></voice></speak>';

  getEdgeToken()
    .then(function (token) {
      return fetch(
        "https://speech.platform.bing.com/consumer/speech/synthesize/readaloud/edge/v1?TrustedClientToken=" + encodeURIComponent(token),
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
        var errText = await ttsRes.text().catch(function () { return ""; });
        throw new Error("Edge TTS failed: " + ttsRes.status + " " + errText.slice(0, 200));
      }
      return ttsRes.arrayBuffer();
    })
    .then(function (buf) {
      // Strip any non-MP3 prefix (Edge sometimes prepends headers like "Path:audio\r\n")
      var data = new Uint8Array(buf);
      var start = 0;
      for (var i = 0; i < Math.min(data.length - 2, 256); i++) {
        if (data[i] === 0xff && (data[i + 1] & 0xe0) === 0xe0) { start = i; break; }
        if (i < data.length - 3 && data[i] === 0x49 && data[i + 1] === 0x44 && data[i + 2] === 0x33) { start = i; break; }
      }
      var clean = start > 0 ? data.slice(start) : data;
      res.setHeader("Content-Type", "audio/mpeg");
      res.setHeader("Content-Length", clean.length);
      res.send(Buffer.from(clean));
    })
    .catch(function (err) {
      json(res, { error: err.message || "Edge TTS error" }, 502);
    });
}

/* ── Main handler ── */
export default function handler(req, res) {
  // CORS headers (same-origin in production, but helps during local dev with different ports)
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");

  if (req.method === "OPTIONS") return res.status(204).end();

  try {
    var url = new URL(req.url, "http://" + (req.headers.host || "localhost"));
    var action = url.searchParams.get("action");
    var provider = url.searchParams.get("provider");

    // GET /api/tts?action=voices&provider=edge
    if (req.method === "GET" && action === "voices") {
      if (provider === "edge") return json(res, EDGE_VOICES);
      return json(res, { edge: EDGE_VOICES });
    }

    // POST /api/tts  body: { provider, voice, text, rate?, pitch? }
    if (req.method === "POST") {
      if (!req.body) {
        var raw = "";
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
  var p = (req.body || {}).provider;
  if (p === "edge") return synthesizeEdge(req, res);
  return json(res, { error: "Unknown provider '" + (p || "") + "'. Use 'edge'." }, 400);
}
