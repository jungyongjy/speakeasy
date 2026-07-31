/**
 * SpeakEasy TTS Proxy — Vercel serverless function
 *
 * Proxies text-to-speech requests to Microsoft Edge TTS.
 * Edge TTS uses per-request anonymous tokens — no account, no API key, no quota.
 * Internally uses WebSocket to Microsoft's speech platform.
 *
 * GET  /api/tts?action=voices&provider=edge
 * POST /api/tts  body: { provider: "edge", voice, text, rate?, pitch? }
 */

/* ── Edge TTS English neural voices ── */
var EDGE_VOICES = [
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

/* ── Edge TTS via WebSocket ── */
function synthesizeEdge(req, res) {
  var body = req.body || {};
  var text = body.text;
  if (!text) return json(res, { error: "Missing 'text' field" }, 400);

  var voice = body.voice || "en-US-AriaNeural";
  var rateVal = body.rate != null ? body.rate : 0;
  var prosodyRate = rateVal >= 0 ? "+" + Math.round(rateVal * 100) + "%" : Math.round(rateVal * 100) + "%";
  var pitchVal = body.pitch != null ? body.pitch : 0;
  var prosodyPitch = pitchVal >= 0 ? "+" + Math.round(pitchVal) + "Hz" : Math.round(pitchVal) + "Hz";

  // Step 1: Get auth token
  fetch("https://edge.microsoft.com/translate/auth", {
    headers: { "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Edge/131.0.0.0" },
  })
    .then(function (tokenRes) {
      if (!tokenRes.ok) throw new Error("Edge auth failed: " + tokenRes.status);
      return tokenRes.text();
    })
    .then(function (token) {
      return connectAndSynthesize(token, voice, prosodyRate, prosodyPitch, text, res);
    })
    .catch(function (err) {
      json(res, { error: err.message || "Edge TTS error" }, 502);
    });
}

function connectAndSynthesize(token, voice, prosodyRate, prosodyPitch, text, res) {
  return new Promise(function (resolve, reject) {
    var wsUrl = "wss://speech.platform.bing.com/consumer/speech/synthesize/readaloud/edge/v1?TrustedClientToken=" + encodeURIComponent(token);

    var ws;
    try {
      ws = new WebSocket(wsUrl);
    } catch (e) {
      return reject(new Error("WebSocket creation failed: " + e.message));
    }

    var audioChunks = [];
    var receivedAudio = false;
    var done = false;
    var timer = setTimeout(function () {
      if (!done) {
        done = true;
        try { ws.close(); } catch (e) { /* ignore */ }
        if (!receivedAudio) reject(new Error("Edge TTS timed out after 15s with no audio"));
      }
    }, 15000);

    ws.onopen = function () {
      // Send config
      var config = {
        context: {
          synthesis: {
            audio: {
              metadataoptions: { sentenceBoundaryEnabled: "false", wordBoundaryEnabled: "false" },
              outputFormat: "audio-24khz-48kbitrate-mono-mp3",
            },
          },
        },
      };
      ws.send(JSON.stringify(config));

      // Build and send SSML
      var ssml =
        "<speak version='1.0' xmlns='http://www.w3.org/2001/10/synthesis' xmlns:mstts='https://www.w3.org/2001/mstts' xml:lang='" +
        voice.slice(0, 5) +
        "'><voice name='" +
        voice +
        "'><prosody rate='" +
        prosodyRate +
        "' pitch='" +
        prosodyPitch +
        "'>" +
        escapeXml(text) +
        "</prosody></voice></speak>";
      ws.send(ssml);
    };

    ws.onmessage = function (event) {
      if (typeof event.data === "string") {
        // Text message — could be turn.start, turn.end, or error
        if (event.data.indexOf("turn.end") >= 0 || event.data.indexOf("Path:turn.end") >= 0) {
          done = true;
          clearTimeout(timer);
          try { ws.close(); } catch (e) { /* ignore */ }
        }
        return;
      }

      // Binary message — extract audio data
      if (event.data instanceof ArrayBuffer || event.data instanceof Buffer || ArrayBuffer.isView(event.data)) {
        var data;
        if (event.data instanceof ArrayBuffer) {
          data = new Uint8Array(event.data);
        } else if (ArrayBuffer.isView(event.data)) {
          data = new Uint8Array(event.data.buffer, event.data.byteOffset, event.data.byteLength);
        } else {
          data = new Uint8Array(event.data);
        }

        if (data.length < 2) return;

        // Parse binary frame header per edge-tts protocol:
        // [2 bytes BE: headers_length] [header bytes]
        // [2 bytes BE: stream_headers_length] [stream header bytes]
        // [2 bytes BE: path_length] [path bytes]
        // [...remaining: audio data]
        var pos = 0;
        var headerLen = ((data[pos] << 8) | data[pos + 1]) >>> 0;
        pos += 2 + headerLen;
        if (pos + 2 > data.length) return;
        var streamHeaderLen = ((data[pos] << 8) | data[pos + 1]) >>> 0;
        pos += 2 + streamHeaderLen;
        if (pos + 2 > data.length) return;
        var pathLen = ((data[pos] << 8) | data[pos + 1]) >>> 0;
        pos += 2 + pathLen;
        if (pos >= data.length) return;

        var audioData = data.slice(pos);
        if (audioData.length > 0) {
          audioChunks.push(audioData);
          receivedAudio = true;
        }
      }
    };

    ws.onerror = function (err) {
      if (!done) {
        done = true;
        clearTimeout(timer);
        reject(new Error("Edge TTS WebSocket error"));
      }
    };

    ws.onclose = function () {
      if (!done) {
        done = true;
        clearTimeout(timer);
        if (!receivedAudio) {
          reject(new Error("Edge TTS connection closed with no audio"));
        } else {
          // Send collected audio
          var totalLength = audioChunks.reduce(function (sum, chunk) { return sum + chunk.length; }, 0);
          var combined = new Uint8Array(totalLength);
          var offset = 0;
          audioChunks.forEach(function (chunk) {
            combined.set(chunk, offset);
            offset += chunk.length;
          });

          res.setHeader("Content-Type", "audio/mpeg");
          res.setHeader("Content-Length", combined.length);
          res.send(Buffer.from(combined));
          resolve();
        }
      }
    };
  });
}

/* ── Main handler ── */
export default function handler(req, res) {
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
      return json(res, EDGE_VOICES);
    }

    // POST /api/tts
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
