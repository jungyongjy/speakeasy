"use strict";

/* ── Config ── */
const cfg = {
  apiKey: localStorage.getItem("speakeasy_key") || sessionStorage.getItem("speakeasy_key") || "",
  rememberKey: localStorage.getItem("speakeasy_remember") !== "0",
  model: (function(m){ return (!m||/^gemini-(1\.|2\.0)/.test(m)||m==="gemini-3-flash")?"gemini-2.5-flash":m; })(localStorage.getItem("speakeasy_model")),
  capGemini: +(localStorage.getItem("speakeasy_capGemini")||localStorage.getItem("speakeasy_dailyCap")||20),
  capOR: +(localStorage.getItem("speakeasy_capOR")||50),
  mode: localStorage.getItem("speakeasy_mode")||"coach",
  drillMode: localStorage.getItem("speakeasy_drillMode")||"topics",
  scenario: localStorage.getItem("speakeasy_scenario")||"",
  provider: localStorage.getItem("speakeasy_provider") || "gemini",
  orKey: localStorage.getItem("speakeasy_orKey") || sessionStorage.getItem("speakeasy_orKey") || "",
  orModel: localStorage.getItem("speakeasy_orModel") || "",
  tts: localStorage.getItem("speakeasy_tts") !== "0",
  audio: localStorage.getItem("speakeasy_audio") !== "0",
  whisper: localStorage.getItem("speakeasy_whisper") !== "0",
  whisperModel: localStorage.getItem("speakeasy_whisperModel") || "Xenova/whisper-base.en",
  voice: localStorage.getItem("speakeasy_voice") || "",
  ttsRate: parseFloat(localStorage.getItem("speakeasy_ttsRate") || "1.0"),
  theme: localStorage.getItem("speakeasy_theme") || "light",
  role: localStorage.getItem("speakeasy_role") || "",
  seniority: localStorage.getItem("speakeasy_seniority") || "",
  jd: localStorage.getItem("speakeasy_jd") || "",
  goalFillers: +(localStorage.getItem("speakeasy_goalFillers")||3),
  paceMin: +(localStorage.getItem("speakeasy_paceMin")||110),
  paceMax: +(localStorage.getItem("speakeasy_paceMax")||150)
};
const $ = (id) => document.getElementById(id);
const logEl = $("log"), statusEl = $("status"), statusMini = $("statusMini"), banner = $("setupBanner");

/* ── Theme (dark-only) ── */
function applyTheme(){ document.documentElement.setAttribute("data-theme","dark"); }
applyTheme();

/* ── SpeakEasy system prompt ── */
const SPEAKEASY_PROMPT = [
"You are SpeakEasy, a communications coach specialising in job interviews, public speaking, and everyday conversational confidence. You combine the direct, no-nonsense feedback style of a seasoned speech coach with the perceptiveness of someone who has helped hundreds of professionals find their voice.",
"",
"You run inside a browser voice tool. After each SPOKEN response you receive a block titled [MEASURED DELIVERY METRICS] computed from the user's real microphone audio: words-per-minute, pauses, energy drop at the end of speaking, pitch variety (monotone vs dynamic), uptalk, and an approximate verbal-crutch count. Base your Score section on these real numbers and cite specific values or moments. If the metrics include a 'Precise fillers (on-device Whisper)' line, treat those filler counts as accurate and cite them. If instead they say 'Approx verbal crutches', exact 'um'/'uh' may be undercounted, so if pauses are many or long, treat them as likely hesitation and say so. GRADING BOUNDARY: only a message that includes a [MEASURED DELIVERY METRICS] block is a practice answer to grade. A message tagged [COMMAND] is an instruction, never an answer (for example 'roleplay mode', 'coach mode', 'break', 'new prompt', 'retry', changing the role or topic, or any request directed at you): do what it asks, reply in one or two short sentences, and never output a Score section or any X/10 numbers for it. If a spoken message is clearly an instruction rather than an answer, treat it as a command too and do not grade it.",
"",
"COACHING PRIORITIES (in order every session): 1) Filler words - flag 'um','uh','like','you know','sort of','basically' or equivalent crutches. 2) Pacing - rushing or stalling; anchor to the moment. Ideal pace ~110-150 wpm; over ~170 rushing, under ~95 dragging; factor long pauses. 3) Clarity - does the point land within the first two sentences? 4) Confidence and vocal presence - hedging language and weak qualifiers, plus the audio metrics for dropped energy at sentence ends, monotone delivery, and uptalk.",
"",
"FEEDBACK STYLE: Balanced - acknowledge what worked before what needs fixing. Never pad with empty praise. Be specific.",
"",
"MODES: COACH MODE (default) - give a prompt, then after their answer deliver the debrief, then ask retry-or-new. ROLEPLAY MODE (user activates) - adopt the requested persona; stay in character until the user says 'break' or 'coach mode', then immediately deliver the debrief. Keep every in-character roleplay reply short and complete (2 to 4 sentences); never stop mid-sentence. Never blend modes without the user's command.",
"",
"SESSION DEBRIEF FORMAT (only after a spoken practice answer in coach mode, or when the user says 'break'/'coach mode' to end a roleplay; NEVER for a [COMMAND]) - you MUST use exactly these score labels so the tool can track them:",
"**Score**",
"- Filler words: X/10",
"- Pacing: X/10",
"- Clarity: X/10",
"- Confidence & presence: X/10",
"",
"**What landed**",
"[1-2 specific things that worked, with the exact moment or phrase.]",
"",
"**What to fix**",
"[Quoted excerpt -> suggested rephrase. 1-3 moments max.]",
"",
"**Focus for next session**",
"[One sentence. One thing only.]",
"",
"BEHAVIOURAL QUESTIONS: if the question asked for a specific past example (for example 'tell me about a time' or 'describe a situation'), append one extra score line immediately after 'Confidence & presence', worded exactly 'Structure (STAR): X/10', and in 'What to fix' note which of Situation, Task, Action, and Result were missing. Do not include this line for non-behavioural questions.",
"",
"CONSTRAINTS: Never give generic advice without anchoring it to a specific moment. Never invent feedback not grounded in what they said or the measured metrics. Never use em-dashes in any reply; use commas, colons, parentheses, or full stops instead. Keep debriefs under 200 words. Keep spoken prompts short and natural.",
"",
"You will receive a session-start message that states the mode (coach or roleplay) and any context. Do NOT introduce yourself and do NOT ask which mode they want: act on that message immediately. In coach mode the app itself shows each question to the user and then sends you their spoken answer with metrics for grading, so grade the answer against the question given. In roleplay mode, open and stay fully in character until the user ends, then deliver the debrief."
].join("\n");

/* ── State ── */
let history = [], busy = false, lastMeasured = null, lastUserWasCommand = false;
let provOverride = null, inSession = false, questionBank = [];
let lastPlayBuffer=null, playCtx=null, playingEl=null, lastWa=null;
let sessionLog=[], lastAnswer="", lastQuestionText="";

/* ── UI helpers ── */
function setStatus(t){ statusEl.textContent = t || ""; statusMini.textContent = t ? t.replace(/…/g,"").toLowerCase().slice(0,22) : (history.length?"active":"ready"); }
function showBanner(msg, isErr){ banner.style.display="block"; banner.className="banner"+(isErr?" err":""); banner.innerHTML=msg; }
function hideBanner(){ banner.style.display="none"; }
function mdLite(s){ return s.replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;").replace(/\*\*(.+?)\*\*/g,"<strong>$1</strong>"); }
function addMsg(who, text){
  const e=$("emptyState"); if(e) e.remove();
  const d=document.createElement("div"); d.className="msg "+(who==="speakeasy"?"speakeasy":"you");
  d.innerHTML='<div class="who">'+(who==="speakeasy"?"SpeakEasy":"You")+'</div><div class="body">'+mdLite(text)+'</div>';
  logEl.appendChild(d); logEl.scrollTop=logEl.scrollHeight;
  return d.querySelector(".body");
}
function usageObj(){ const day=new Date().toISOString().slice(0,10); let u; try{u=JSON.parse(localStorage.getItem("speakeasy_usage")||"{}");}catch(e){u={};} if(u.date!==day) u={date:day,gemini:0,openrouter:0}; if(typeof u.gemini!=="number")u.gemini=0; if(typeof u.openrouter!=="number")u.openrouter=0; return u; }
function capFor(prov){ return prov==="openrouter"?(cfg.capOR||50):(cfg.capGemini||20); }
function usedFor(prov){ return usageObj()[prov]||0; }
function usageLeft(prov){ return Math.max(0, capFor(prov)-usedFor(prov)); }
function keyFor(prov){ return prov==="openrouter"?cfg.orKey:cfg.apiKey; }
function bumpUsage(prov){ const u=usageObj(); u[prov]=(u[prov]||0)+1; localStorage.setItem("speakeasy_usage",JSON.stringify(u)); renderUsage(); }
function renderUsage(){ const el=$("usage"); if(!el) return; const u=usageObj(); const act=provOverride||cfg.provider;
  const seg=(p,label)=>{ const n=u[p]||0, cap=capFor(p); const col=n>=cap?"var(--c-danger)":(n>cap*0.8?"var(--c-amber)":"var(--c-ink-3)"); return '<span class="up'+(act===p?" act":"")+'" style="color:'+(act===p?"var(--c-accent)":col)+'">'+label+" "+n+"/"+cap+"</span>"; };
  el.innerHTML='<span class="usage-split">'+seg("gemini","Gemini")+seg("openrouter","OpenRouter")+"</span>";
  el.title="Requests today (local estimate on this device). Active provider highlighted. Gemini resets midnight Pacific; OpenRouter midnight UTC.";
}

/* ── Icons (inline SVG, no emoji) ── */
const ICONS={
  mic:'<rect x="9" y="3" width="6" height="11" rx="3"/><path d="M5 11a7 7 0 0 0 14 0"/><path d="M12 18v3"/><path d="M8.5 21h7"/>',
  stop:'<rect x="6" y="6" width="12" height="12" rx="2"/>',
  play:'<path d="M7 4.5v15l13-7.5z"/>',
  refresh:'<path d="M20 11a8 8 0 1 0-.9 4.5"/><path d="M20 4v6h-6"/>',
  plus:'<path d="M12 5v14"/><path d="M5 12h14"/>',
  report:'<path d="M14 3v5h5"/><path d="M15 3H7a1 1 0 0 0-1 1v16a1 1 0 0 0 1 1h11a1 1 0 0 0 1-1V8z"/><path d="M9 13h6"/><path d="M9 17h6"/>',
  send:'<path d="M22 2 11 13"/><path d="M22 2 15 22l-4-9-9-4z"/>'
};
function icon(name,cls){ return '<svg class="ic '+(cls||"")+'" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">'+(ICONS[name]||"")+'</svg>'; }
function setBtn(id,name,label){ const b=$(id); if(b) b.innerHTML=icon(name)+'<span>'+label+'</span>'; }
function initIcons(){ setBtn("startBtn","play","Start session"); setBtn("micBtn","mic","Speak"); setBtn("newBtn","plus","New prompt"); setBtn("retryBtn","refresh","Retry same"); setBtn("reportBtn","report","Report"); setBtn("sendBtn","send","Send"); }
function buildHeroWave(){ const el=$("heroWave"); if(!el) return;
  const hs=[3,6,10,16,9,20,13,26,17,30,20,34,22,30,18,26,14,20,10,15,8,12,6,9,5,7,4,6,10,16,9,20,13,26,17,22,12,8,5,3];
  const W=hs.length*6; let s='<svg viewBox="0 0 '+W+' 40" width="100%" height="40" preserveAspectRatio="none" role="img" aria-label="Waveform">';
  hs.forEach((h,i)=>{ s+='<rect x="'+(i*6)+'" y="'+((40-h)/2).toFixed(1)+'" width="3" height="'+h+'" rx="1.5" fill="var(--c-accent)" opacity="'+(0.22+0.55*(h/34)).toFixed(2)+'"/>'; });
  el.innerHTML=s+'</svg>';
}

/* ── TTS ── */
let voices=[];
function voiceScore(v){
  const n=(v.name||"").toLowerCase(); let s=0;
  if(/natural|neural/.test(n)) s+=100;
  if(/online/.test(n)) s+=40;
  if(/(aria|jenny|guy|libby|sonia|ryan|emma|michelle|ava|andrew)/.test(n)) s+=20;
  if(/microsoft/.test(n)) s+=15;
  if(v.localService===false) s+=10;
  if(v.lang==="en-US") s+=6; else if(v.lang==="en-GB") s+=5;
  return s;
}
function loadVoices(){
  voices = window.speechSynthesis ? speechSynthesis.getVoices() : [];
  renderVoiceSelect();
}
function renderVoiceSelect(){
  const en=voices.filter(function(v){ return v.lang&&v.lang.toLowerCase().startsWith("en"); }).sort(function(a,b){ return voiceScore(b)-voiceScore(a); });
  if(!cfg.voice && en.length) cfg.voice=en[0].name;
  const sel=$("voiceSel"); if(!sel) return; sel.innerHTML="";
  if(!en.length){ sel.innerHTML="<option>Loading voices…</option>"; return; }
  const hasCurrentVoice=en.some(function(v){ return v.name===cfg.voice; });
  if(!hasCurrentVoice && en.length) cfg.voice=en[0].name;
  en.forEach(function(v,i){ const o=document.createElement("option"); o.value=v.name;
    const isNeural=/natural|neural|online/.test((v.name||"").toLowerCase());
    const tag=isNeural?" (natural)":(i===0?" (recommended)":"");
    o.textContent=v.name+" ("+v.lang+")"+tag;
    if(v.name===cfg.voice) o.selected=true; sel.appendChild(o); });
}
if(window.speechSynthesis){ loadVoices(); speechSynthesis.onvoiceschanged=loadVoices; }
function speak(text){
  if(!cfg.tts) return;
  const clean=text.replace(/**/g,"").replace(/[#*_`>-]/g," ").replace(/s+/g," ").trim();
  if(!clean) return;
  if(!window.speechSynthesis) return;
  speechSynthesis.cancel();
  const u=new SpeechSynthesisUtterance(clean);
  const v=voices.find(function(x){ return x.name===cfg.voice; }); if(v) u.voice=v;
  u.rate=cfg.ttsRate||1.0; speechSynthesis.speak(u);
}

/* ── Gemini ── */
async function callGemini(onDelta, msgs){
  if(!cfg.apiKey){ showBanner("Add your Gemini API key in Settings to begin.",true); return null; }
  const url="https://generativelanguage.googleapis.com/v1beta/models/"+encodeURIComponent(cfg.model)+":streamGenerateContent?alt=sse";
  const body={ system_instruction:{parts:[{text:SPEAKEASY_PROMPT}]},
    contents:(msgs||history).map(h=>({role:h.role,parts:[{text:h.text}]})),
    generationConfig:{temperature:0.75,maxOutputTokens:2048} };
  let res;
  try{ res=await fetch(url,{method:"POST",headers:{"Content-Type":"application/json","x-goog-api-key":cfg.apiKey},body:JSON.stringify(body)}); }
  catch(e){ showBanner("Network error reaching Gemini. ("+e.message+")",true); return null; }
  if(!res.ok){
    let d=""; try{ const j=await res.json(); d=j.error&&j.error.message?j.error.message:JSON.stringify(j); }catch(e){ d=res.statusText; }
    if(res.status===429) showBanner("Gemini free-tier limit reached (429): requests-per-minute or per-day. Wait about a minute, or check the API meter in the top bar. "+d,true);
    else if(res.status===400&&/API key/i.test(d)) showBanner("Invalid API key. Re-check it in Settings. "+d,true);
    else showBanner("Gemini error "+res.status+": "+d,true);
    return null;
  }
  hideBanner(); bumpUsage("gemini");
  let full="", blocked="";
  try{
    const reader=res.body.getReader(), decoder=new TextDecoder(); let buf="";
    while(true){ const {done,value}=await reader.read(); if(done) break; buf+=decoder.decode(value,{stream:true});
      let nl; while((nl=buf.indexOf("\n"))>=0){ const line=buf.slice(0,nl).trim(); buf=buf.slice(nl+1);
        if(!line.startsWith("data:")) continue; const js=line.slice(5).trim(); if(!js||js==="[DONE]") continue;
        try{ const obj=JSON.parse(js); const cand=obj.candidates&&obj.candidates[0];
          if(cand&&cand.content&&cand.content.parts){ const t=cand.content.parts.map(p=>p.text||"").join(""); if(t){ full+=t; if(onDelta) onDelta(full); } }
          if(obj.promptFeedback&&obj.promptFeedback.blockReason) blocked=obj.promptFeedback.blockReason;
        }catch(e){}
      }
    }
  }catch(e){ if(!full){ showBanner("Streaming error: "+e.message,true); return null; } }
  full=full.trim();
  if(!full){ showBanner("SpeakEasy returned no answer"+(blocked?" (blocked: "+blocked+")":"")+". Try rephrasing.",true); return null; }
  return full;
}

/* ── OpenRouter (OpenAI-compatible) ── */
function activeKey(){ return cfg.provider==="openrouter"?cfg.orKey:cfg.apiKey; }
function callModel(onDelta, prov, msgs){ return prov==="openrouter"?callOpenRouter(onDelta,msgs):callGemini(onDelta,msgs); }
async function callOpenRouter(onDelta, msgs){
  if(!cfg.orKey){ showBanner("Add your OpenRouter API key in Settings to use OpenRouter.",true); return null; }
  if(!cfg.orModel){ showBanner("Pick an OpenRouter model in Settings (an id ending in :free stays free).",true); return null; }
  const url="https://openrouter.ai/api/v1/chat/completions";
  const wire=[{role:"system",content:SPEAKEASY_PROMPT}].concat((msgs||history).map(h=>({role:h.role==="model"?"assistant":"user",content:h.text})));
  const body={ model:cfg.orModel, messages:wire, stream:true, temperature:0.75, max_tokens:2048 };
  let res;
  try{ res=await fetch(url,{method:"POST",headers:{"Content-Type":"application/json","Authorization":"Bearer "+cfg.orKey,"X-Title":"SpeakEasy"},body:JSON.stringify(body)}); }
  catch(e){ showBanner("Network error reaching OpenRouter. ("+e.message+")",true); return null; }
  if(!res.ok){
    let d=""; try{ const j=await res.json(); d=j.error&&j.error.message?j.error.message:JSON.stringify(j); }catch(e){ d=res.statusText; }
    if(res.status===429) showBanner("OpenRouter rate limit (429). Free models allow ~20/min and 50/day (1000/day after a one-time $10 credit). Wait a moment or check the meter. "+d,true);
    else if(res.status===401) showBanner("OpenRouter key rejected (401). Re-check it in Settings. "+d,true);
    else if(res.status===402) showBanner("This model needs paid credits (402). Pick a model whose id ends in ':free', or add credits. "+d,true);
    else showBanner("OpenRouter error "+res.status+": "+d,true);
    return null;
  }
  hideBanner(); bumpUsage("openrouter");
  let full="";
  try{
    const reader=res.body.getReader(), decoder=new TextDecoder(); let buf="";
    while(true){ const {done,value}=await reader.read(); if(done) break; buf+=decoder.decode(value,{stream:true});
      let nl; while((nl=buf.indexOf("\n"))>=0){ const line=buf.slice(0,nl).trim(); buf=buf.slice(nl+1);
        if(!line.startsWith("data:")) continue; const js=line.slice(5).trim(); if(!js||js==="[DONE]") continue;
        try{ const obj=JSON.parse(js); const ch=obj.choices&&obj.choices[0];
          const t=ch&&ch.delta&&ch.delta.content?ch.delta.content:""; if(t){ full+=t; if(onDelta) onDelta(full); }
        }catch(e){}
      }
    }
  }catch(e){ if(!full){ showBanner("Streaming error: "+e.message,true); return null; } }
  full=full.trim();
  if(!full){ showBanner("The model returned no answer. Try another model or rephrase.",true); return null; }
  return full;
}
function storeORKey(key, remember){
  cfg.orKey=key;
  if(remember){ localStorage.setItem("speakeasy_orKey",key); sessionStorage.removeItem("speakeasy_orKey"); }
  else { sessionStorage.setItem("speakeasy_orKey",key); localStorage.removeItem("speakeasy_orKey"); }
}
async function testORKey(key){
  if(!key) return {ok:false,msg:"Paste a key first."};
  try{
    const r=await fetch("https://openrouter.ai/api/v1/key",{headers:{"Authorization":"Bearer "+key}});
    if(r.ok) return {ok:true,msg:"Key works. You are good to go."};
    let d="HTTP "+r.status; try{ const j=await r.json(); if(j.error&&j.error.message) d=j.error.message; }catch(e){}
    return {ok:false,msg:"Key rejected: "+d};
  }catch(e){ return {ok:false,msg:"Network error: "+e.message}; }
}
async function fetchORModels(){
  const dl=$("orModelList"); if(!dl||dl.dataset.loaded) return;
  try{
    const r=await fetch("https://openrouter.ai/api/v1/models"); if(!r.ok) return;
    const j=await r.json();
    const free=(j.data||[]).filter(m=>{ const id=m.id||""; if(!/:free$/.test(id)) return false;
      const a=m.architecture||{}; const outs=a.output_modalities||(a.modality?[a.modality]:null);
      if(outs && !outs.some(x=>/text/i.test(x))) return false;
      return true; });
    free.sort((a,b)=>(a.id||"").localeCompare(b.id||""));
    dl.innerHTML=free.slice(0,80).map(m=>'<option value="'+esc(m.id)+'">'+esc(m.name||m.id)+'</option>').join("");
    dl.dataset.loaded="1";
    const inp=$("orModel");
    if(inp && !inp.value && free.length){ const pref=free.find(m=>/(llama|qwen|mistral|gemma|glm|kimi|deepseek)/i.test(m.id)); inp.value=(pref||free[0]).id; }
  }catch(e){}
}
function updateProviderUI(){
  const p=$("provider")?$("provider").value:cfg.provider;
  const g=$("geminiFields"), o=$("orFields");
  if(g) g.style.display=(p==="openrouter")?"none":"";
  if(o) o.style.display=(p==="openrouter")?"":"none";
  if(p==="openrouter") fetchORModels();
}
/* pick a provider for the next call, asking before switching when the primary is spent */
async function gateProvider(){
  let p=provOverride||cfg.provider;
  if(!keyFor(p)){ const o=p==="gemini"?"openrouter":"gemini"; if(keyFor(o)){ p=o; provOverride=o; } else { showBanner("Add an API key in Settings to continue.",true); return null; } }
  if(usageLeft(p)>0) return p;
  const other=p==="gemini"?"openrouter":"gemini", nm=(x)=>x==="gemini"?"Gemini":"OpenRouter";
  if(keyFor(other)&&usageLeft(other)>0){
    if(confirm("You have used all "+capFor(p)+" "+nm(p)+" requests today (local estimate). Switch to "+nm(other)+" for the rest of this session?")){ provOverride=other; renderUsage(); return other; }
    showBanner("Paused: you are at your "+nm(p)+" daily limit. Switch provider in Settings or come back after it resets.",true); return null;
  }
  showBanner("Daily request limit reached. Gemini resets midnight Pacific, OpenRouter midnight UTC. Add or switch to another provider in Settings to keep going.",true);
  return null;
}
/* one call returns a batch of tailored questions, served locally afterward (0 calls) */
async function generateQuestions(){
  const prov=await gateProvider(); if(!prov) return [];
  const msg=[{role:"user",text:"Generate exactly 5 concise interview questions tailored to the context below. Output ONLY a numbered list from 1. to 5., one question per line. No preamble, no commentary, no scores, no markdown, no em-dashes."+practiceContext()}];
  const raw=await callModel(null, prov, msg);
  if(!raw) return [];
  return raw.split(/\n+/).map(l=>l.replace(/^[\s>*\-]*\d+[\).\]]?\s*/,"").replace(/^[\-\*]\s*/,"").trim()).filter(l=>l.length>6).slice(0,8);
}
/* local question set (no API) */
const LOCAL_QUESTIONS={
  general:["Walk me through your background in about ninety seconds.","Why are you interested in this role?","What are your greatest strengths, and how do they show up at work?","Where do you want to grow over the next few years?","Why are you looking to leave your current role?"],
  behavioral:["Tell me about a time you handled a difficult stakeholder. What did you do and what was the result?","Describe a situation where you missed a deadline. How did you handle it?","Give an example of a time you led a project without formal authority.","Tell me about a mistake you made at work and what you learned.","Describe a time you had to persuade someone who disagreed with you."],
  presentation:["Give a two minute overview of a project you are proud of.","Explain a complex idea from your field to someone outside it.","Pitch an idea you believe your team should invest in.","Summarise the most important trend affecting your industry.","Introduce yourself as if opening a conference talk."],
  /* non-technical drill topics — accessible to any audience */
  impromptu:["Describe your ideal weekend morning from start to finish.","If you could have dinner with any person, living or dead, who would it be and why?","What is a skill you would love to learn and why does it interest you?","Describe a place that makes you feel at peace.","What is the best piece of advice you have ever received?","If you could live anywhere in the world for a year, where would you go?","What does a perfect day look like to you?","Describe your favourite season and what you love about it.","If you could instantly master one thing, what would it be?","What is a small kindness someone did for you that you still remember?","What is a tradition from your childhood that you still think about?","If you had an extra hour every day, how would you spend it?","Describe a sound or smell that instantly takes you back to a memory.","What is something you have changed your mind about in the last few years?","If you could give your younger self one piece of advice, what would it be?","What is your favourite way to spend a rainy day?","Describe the last time you felt truly relaxed.","If you could swap lives with someone for a day, who would it be and why?","What is one thing that always makes you smile?","Describe a skill you picked up without trying very hard.","What is a belief you held strongly that turned out to be wrong?","If your life had a soundtrack, what song would play right now?","Describe the most interesting stranger you have ever met.","What is a gift you received that meant more than the giver realised?","If you could relive one day from the past year, which would you pick?","Describe your favourite corner of your home.","What is the best meal you have ever eaten?","If you could be remembered for one thing, what would you want it to be?","Describe a time you got completely absorbed in something and lost track of time.","What is a compliment you received that stuck with you?","If you could write a note to your future self, what would it say?","Describe the last time you tried something for the first time.","What is a rule you live by that most people would not expect?","What does home mean to you?","Describe a moment that changed the way you see someone.","What is the most useful thing you own that costs less than twenty dollars?","If you could send a one-minute voice message to the whole world, what would you say?","Describe a smell that instantly lifts your mood.","What is something you have never done but feel like you already know how to do?","If you were given a billboard in your hometown, what would you put on it?","Describe the last time you felt completely out of your depth.","What is a small daily ritual that grounds you?","If you could eliminate one minor annoyance from daily life, what would it be?","Describe a moment you wish you could have paused and stayed in longer.","What is something people assume about you that is not quite right?"],
  story:["Tell me about a time something did not go as planned.","Describe the funniest thing that has happened to you recently.","Tell me about a time you felt really proud of yourself.","Describe a moment when you had to be brave.","Tell me a story about a memorable meal you had.","Describe a time you got completely lost.","Tell me about the first time you tried something and failed.","Describe a moment when someone surprised you.","Tell me about a time you helped a stranger.","Describe the best decision you ever made on a whim.","Tell me about a time you laughed so hard you could not stop.","Describe a moment that felt like it was straight out of a movie.","Tell me about the last time you got caught in bad weather.","Describe a time you had to make a decision with no good options.","Tell me about a conversation that changed your perspective on something.","Describe a time you stood up for someone.","Tell me the story of how you met your closest friend.","Describe the most embarrassing moment you can laugh about now.","Tell me about a time you had to deliver bad news.","Describe a moment when you realised you were wrong about someone.","Tell me about the hardest thing you have ever had to say out loud.","Describe a time you broke a promise and what happened next.","Tell me about a moment when everything clicked into place.","Describe the longest wait of your life.","Tell me about a time you won something you did not expect to win.","Describe a moment when you felt completely, genuinely heard.","Tell me about the first time you felt like a grown-up.","Describe a time you got a second chance you did not deserve.","Tell me about an act of generosity you witnessed.","Describe a moment when you had to choose between two things you loved.","Tell me about the most impulsive thing you have ever done.","Describe a time you had to eat your words.","Tell me about a moment when silence said more than words ever could.","Describe the last time you felt truly lucky.","Tell me about a time you had to fake confidence.","Describe a moment when someone gave you exactly what you needed without you asking."],
  opinion:["What makes a good listener?","Is it better to be early or late? Defend your answer.","What is one thing about modern life that you think people will miss in fifty years?","Should people work to live or live to work?","What is more important: being liked or being respected?","Is it better to have a plan or to go with the flow?","What makes someone a good friend?","Do you think luck or hard work matters more? Why?","What is a common piece of advice you disagree with?","What does it mean to be successful?","Is it better to be busy or bored?","What is one habit everyone should have?","Is it better to be the best at one thing or good at many things?","What makes a house into a home?","Do you think people change, or do we just get better at seeing who they really are?","What is one thing schools should teach but do not?","Is honesty always the best policy?","What is more important in a leader: competence or empathy?","Do you think it is better to speak your mind or keep the peace?","What is one food everyone seems to love that you do not understand?","Is it better to give a gift someone asked for or to surprise them?","What does it mean to be a good neighbour?","Do you think confidence can be taught or is it something you are born with?","What is one thing you wish people took more seriously?","Is it better to be the smartest person in the room or the kindest?","What is a social norm you wish would disappear?","Do you think people need hardship to grow?","What is more important for happiness: freedom or security?","Is it better to under-think or over-think?","What makes an apology feel genuine?","Do you think dreams mean anything?","What is one thing you would make free for everyone if you could?","Is it better to be remembered or to make a difference without being known?","What is the most underrated form of generosity?","Do you think first impressions matter as much as people say?","What is a quality you value in others that you wish you had more of yourself?"],
  explain:["Explain how to make a cup of tea or coffee to someone who has never done it.","Describe how to wrap a gift neatly.","Explain how to plant something and help it grow.","Describe how to choose a good book when you do not know what to read.","Explain how to apologise and mean it.","Describe how to make a small room feel bigger.","Explain how to plan a surprise for someone.","Describe how to stay calm in a stressful moment.","Explain how to give constructive feedback to a friend.","Describe how to make a first impression that lasts.","Explain how to stay awake when you are exhausted but have to keep going.","Describe how to make someone feel welcome in your home.","Explain how to recover from saying the wrong thing.","Describe how to tell a joke well.","Explain how to remember someone's name after just meeting them.","Describe how to build a habit that sticks.","Explain how to split a bill fairly at a group dinner without it being awkward.","Describe how to give directions to someone who is lost.","Explain how to pick a film everyone in the room will enjoy.","Describe how to make a long wait feel shorter.","Explain how to start a conversation with someone you do not know.","Describe how to pack for a trip and not overpack.","Explain how to tell someone they have food stuck in their teeth without embarrassing them.","Describe how to keep cool when someone is being difficult.","Explain how to decide whether to keep or throw something with sentimental value.","Describe how to make a new colleague feel included.","Explain how to order at a restaurant when you cannot decide.","Describe how to create a morning routine you actually stick to.","Explain how to say no without feeling guilty.","Describe how to turn a bad day around."],
  persuasive:["Convince me to try a food I think I hate.","Convince me to take up your favourite hobby.","Persuade me to visit your hometown or favourite city.","Convince me that mornings are better than evenings.","Persuade me to spend less time on my phone.","Convince me to watch your favourite film without spoiling it.","Argue that pets make people happier.","Convince me that boredom is good for you.","Persuade me to learn a second language.","Argue that walking is the best form of exercise.","Convince me that being bored is a skill worth developing.","Persuade me to delete one app from my phone for a week.","Convince me that the best things in life really are free.","Argue that handwritten notes matter more than texts.","Persuade me that cooking at home is worth the effort.","Convince me to go outside when I would rather stay in.","Argue that saying no is a form of kindness.","Persuade me that it is never too late to start something new.","Convince me to spend a whole day without looking at a screen.","Argue that everyone should try living alone at least once.","Persuade me that taking the stairs is better than the lift.","Convince me to keep a journal for thirty days.","Argue that asking for help makes you stronger, not weaker.","Persuade me to learn something from someone half my age.","Convince me that the best stories come from getting things wrong.","Argue that silence is underrated.","Persuade me to give away something I love.","Convince me to start a conversation with a stranger tomorrow.","Argue that being average at something is still worth celebrating.","Persuade me to pick up the phone instead of sending a message."]
};
function shuffle(a){ for(let i=a.length-1;i>0;i--){ const j=Math.floor(Math.random()*(i+1)); [a[i],a[j]]=[a[j],a[i]]; } return a; }
function fillLocalBank(){
  if(cfg.mode==="drill" && cfg.drillMode==="topics"){
    const drillCats=["impromptu","story","opinion","explain","persuasive"];
    const pool=drillCats.flatMap(function(k){ return LOCAL_QUESTIONS[k]||[]; });
    questionBank=shuffle(pool.slice());
  } else {
    const pool=LOCAL_QUESTIONS.general.concat(LOCAL_QUESTIONS.behavioral,LOCAL_QUESTIONS.presentation);
    questionBank=shuffle(pool.slice());
  }
}
function nextQuestion(){ if(!questionBank.length) fillLocalBank(); return questionBank.shift(); }
function showQuestion(text){ if(!text) return; lastQuestionText=text; addMsg("speakeasy",text); if(cfg.tts) speak(text); }

function stripDebrief(t){
  if(!t) return t;
  const m=t.match(/\*\*\s*Score\s*\*\*|(?:^|\n)\s*Score\b/i);
  if(!m) return t;
  const i=m.index;
  const sep=t.indexOf("***", i);
  if(sep>=0) return (t.slice(0,i)+t.slice(sep+3)).replace(/\n{3,}/g,"\n\n").trim();
  return t.slice(0,i).trim();
}
async function speakeasyTurn(){
  if(busy) return; busy=true; setBusy(true); setStatus("thinking…");
  const prov=await gateProvider();
  if(!prov){ busy=false; setBusy(false); setStatus(""); return; }
  const cmd=lastUserWasCommand;
  const bodyEl=addMsg("speakeasy","");
  const raw=await callModel((t)=>{ bodyEl.innerHTML=mdLite(cmd?stripDebrief(t):t); logEl.scrollTop=logEl.scrollHeight; }, prov);
  setStatus("");
  if(raw){
    const text=cmd?stripDebrief(raw):raw;
    bodyEl.innerHTML=mdLite(text)||"..."; history.push({role:"model",text}); speak(text);
    if(!cmd){ const sc=parseScores(text); if(sc){ recordProgress(sc); sessionLog.push({q:lastQuestionText,a:lastAnswer,debrief:text,m:lastMeasured}); switchTab("turn"); } }
    lastQuestionText=text;
  } else { const msg=bodyEl.parentElement; if(msg&&msg.parentElement) msg.parentElement.removeChild(msg); }
  busy=false; setBusy(false);
}
function setBusy(b){ ["startBtn","micBtn","newBtn","retryBtn","sendBtn","typeInput","endBtn","copyBtn"].forEach(id=>{const el=$(id); if(el)el.disabled=b;}); if(!b) enableAfterStart(); }
async function sendUserTurn(display, sent){ lastAnswer=display; addMsg("you",display); history.push({role:"user",text:sent}); await speakeasyTurn(); }

/* ── Speech recognition + audio ── */
const SR=window.SpeechRecognition||window.webkitSpeechRecognition;
let recog=null, recognizing=false, finalTranscript="";
let audioCtx=null, analyser=null, micStream=null, sampleTimer=null, samples=[], recStartT=0;
let recorder=null, recChunks=[], recordedBlob=null;
const SAMPLE_MS=80;

function startRecognition(){
  finalTranscript="";
  if(!SR){ showBanner("Speech recognition needs Google Chrome (or Edge) on desktop.",true); return false; }
  recog=new SR(); recog.lang="en-US"; recog.continuous=true; recog.interimResults=true;
  recog.onresult=(e)=>{ let interim="";
    for(let i=e.resultIndex;i<e.results.length;i++){ const t=e.results[i][0].transcript;
      if(e.results[i].isFinal) finalTranscript+=t+" "; else interim+=t; }
    setStatus("listening… "+(finalTranscript+interim).slice(-60)); };
  recog.onerror=(e)=>{ if(e.error!=="no-speech") showBanner("Mic/recognition error: "+e.error,true); };
  recog.onend=()=>{ if(recognizing){ try{recog.start();}catch(e){} } };
  try{ recog.start(); }catch(e){}
  return true;
}
async function startAudio(){
  samples=[]; recordedBlob=null; recChunks=[]; recorder=null;
  if(!cfg.audio && !cfg.whisper) return;
  try{ micStream=await navigator.mediaDevices.getUserMedia({audio:true}); }
  catch(e){ micStream=null; showBanner("Voice analysis disabled (mic unavailable). Transcript coaching still works. "+e.message,false); return; }
  if(cfg.audio){
    audioCtx=new (window.AudioContext||window.webkitAudioContext)();
    const src=audioCtx.createMediaStreamSource(micStream);
    analyser=audioCtx.createAnalyser(); analyser.fftSize=2048; src.connect(analyser);
    const buf=new Float32Array(analyser.fftSize); recStartT=performance.now();
    sampleTimer=setInterval(()=>{ analyser.getFloatTimeDomainData(buf);
      let s=0; for(let i=0;i<buf.length;i++) s+=buf[i]*buf[i];
      samples.push({t:(performance.now()-recStartT)/1000, rms:Math.sqrt(s/buf.length), pitch:autoCorrelate(buf,audioCtx.sampleRate)}); }, SAMPLE_MS);
  }
  if(cfg.whisper && window.MediaRecorder){
    try{ recorder=new MediaRecorder(micStream); recorder.ondataavailable=(e)=>{ if(e.data&&e.data.size) recChunks.push(e.data); }; recorder.start(); }
    catch(e){ recorder=null; }
  }
}
function stopSampling(){ if(sampleTimer){clearInterval(sampleTimer);sampleTimer=null;} if(audioCtx){audioCtx.close();audioCtx=null;} }
function stopStream(){ if(micStream){micStream.getTracks().forEach(t=>t.stop());micStream=null;} }
function finalizeRecording(){
  return new Promise((resolve)=>{
    if(!recorder || recorder.state==="inactive"){ resolve(recordedBlob); return; }
    recorder.onstop=()=>{ recordedBlob=recChunks.length?new Blob(recChunks,{type:recChunks[0].type||"audio/webm"}):null; resolve(recordedBlob); };
    try{ recorder.stop(); }catch(e){ resolve(null); }
  });
}

function autoCorrelate(buf,sampleRate){
  let SIZE=buf.length,sum=0; for(let i=0;i<SIZE;i++) sum+=buf[i]*buf[i];
  if(Math.sqrt(sum/SIZE)<0.01) return -1;
  let r1=0,r2=SIZE-1; const thres=0.2;
  for(let i=0;i<SIZE/2;i++){ if(Math.abs(buf[i])<thres){r1=i;break;} }
  for(let i=1;i<SIZE/2;i++){ if(Math.abs(buf[SIZE-i])<thres){r2=SIZE-i;break;} }
  const b=buf.slice(r1,r2); SIZE=b.length; if(SIZE<8) return -1;
  const c=new Float32Array(SIZE);
  for(let i=0;i<SIZE;i++){ let s=0; for(let j=0;j<SIZE-i;j++) s+=b[j]*b[j+i]; c[i]=s; }
  let d=0; while(d<SIZE-1&&c[d]>c[d+1]) d++;
  let mv=-1,mp=-1; for(let i=d;i<SIZE;i++){ if(c[i]>mv){mv=c[i];mp=i;} }
  let T0=mp; if(T0<=0||T0>=SIZE-1) return -1;
  const x1=c[T0-1],x2=c[T0],x3=c[T0+1],a=(x1+x3-2*x2)/2,bb=(x3-x1)/2; if(a) T0=T0-bb/(2*a);
  const f=sampleRate/T0; return (f>50&&f<500)?f:-1;
}

/* ── Metrics ── */
function computeMetrics(transcript, wa){
  const words=(transcript.trim().match(/\b[\w']+\b/g)||[]); let wordCount=words.length;
  const pats=[["um",/\bum+\b/gi],["uh",/\buh+\b/gi],["er",/\ber+\b/gi],["like",/\blike\b/gi],["you know",/\byou know\b/gi],["sort of",/\bsort of\b/gi],["kind of",/\bkind of\b/gi],["basically",/\bbasically\b/gi],["I mean",/\bi mean\b/gi],["actually",/\bactually\b/gi],["literally",/\bliterally\b/gi]];
  let hits=[], total=0;
  pats.forEach(([l,re])=>{ const mm=transcript.match(re); if(mm&&mm.length){ hits.push(l+" x"+mm.length); total+=mm.length; } });
  const m={wordCount,crutchTotal:total,crutchHits:hits,hasAudio:false,whisper:false};
  m.content=analyzeContent(transcript);
  if(wa){ m.whisper=true; wordCount=wa.wordCount||wordCount; m.wordCount=wordCount; m.crutchTotal=wa.vocal+wa.disc; m.fillVocal=wa.vocal; m.fillDisc=wa.disc; m.overallWpm=wa.overallWpm; m.fastWpm=wa.fastWpm; m.dur=wa.dur; m.crutchHits=Object.keys(wa.marks).map(k=>k+" x"+wa.marks[k]); }
  if(cfg.audio&&samples.length>5){
    m.hasAudio=true; const thr=0.015, interval=SAMPLE_MS/1000;
    const vf=samples.map(s=>s.rms>thr);
    let start=0,end=vf.length-1; while(start<vf.length&&!vf[start])start++; while(end>=0&&!vf[end])end--;
    const voiced=samples.filter((s,i)=>vf[i]);
    const voicedTime=voiced.length*interval, totalTime=samples.length*interval;
    const pauses=[]; let run=0;
    for(let i=start;i<=end;i++){ if(!vf[i])run++; else{ if(run>0)pauses.push(run*interval); run=0; } }
    const longP=pauses.filter(p=>p>0.5); const longest=pauses.length?Math.max.apply(null,pauses):0;
    const wpm=voicedTime>0.5?Math.round(wordCount/(voicedTime/60)):0;
    const rmsL=voiced.map(s=>s.rms); const meanR=rmsL.reduce((a,b)=>a+b,0)/(rmsL.length||1);
    const tN=Math.max(3,Math.round(rmsL.length*0.25)); const tail=rmsL.slice(-tN);
    const tailM=tail.reduce((a,b)=>a+b,0)/(tail.length||1); const endDrop=meanR>0?Math.round((1-tailM/meanR)*100):0;
    const pitches=voiced.map(s=>s.pitch).filter(p=>p>50&&p<400);
    let pMean=0,pCV=0,pLabel="n/a",uptalk=false;
    if(pitches.length>6){ pMean=pitches.reduce((a,b)=>a+b,0)/pitches.length;
      const va=pitches.reduce((a,b)=>a+(b-pMean)*(b-pMean),0)/pitches.length; pCV=Math.sqrt(va)/pMean;
      pLabel=pCV>0.18?"dynamic":(pCV>=0.10?"moderate":"monotone-leaning");
      const lN=Math.max(4,Math.round(pitches.length*0.15)); const lM=pitches.slice(-lN).reduce((a,b)=>a+b,0)/lN;
      const prev=pitches.slice(0,-lN); const pM=prev.length?prev.reduce((a,b)=>a+b,0)/prev.length:lM; uptalk=lM>pM*1.12; }
    Object.assign(m,{wpm,voicedTime:+voicedTime.toFixed(1),totalTime:+totalTime.toFixed(1),pauseCount:longP.length,longestPause:+longest.toFixed(1),endDropPct:endDrop,pitchMean:Math.round(pMean),pitchCV:+pCV.toFixed(3),pitchLabel:pLabel,uptalk});
  }
  if(wa && !m.hasAudio) m.hasAudio=true;
  return m;
}
function metricsToText(m){
  if(m.hasAudio){
    const L=["Words spoken: "+m.wordCount];
    if(m.whisper){
      L.push("Speaking pace: "+(m.overallWpm||m.wpm)+" wpm overall; fastest stretch ~"+m.fastWpm+" wpm");
      L.push("Precise fillers (on-device Whisper): "+m.fillVocal+" vocalized (um/uh/er) + "+m.fillDisc+" discourse crutches"+(m.crutchHits.length?" ["+m.crutchHits.join(", ")+"]":""));
    } else {
      L.push("Speaking pace: "+m.wpm+" wpm (voiced "+m.voicedTime+"s of "+m.totalTime+"s total)");
      L.push("Approx verbal crutches: "+m.crutchTotal+(m.crutchHits.length?" ("+m.crutchHits.join(", ")+")":"")+" [note: um/uh often not transcribed]");
    }
    if(typeof m.pauseCount!=="undefined") L.push("Pauses over 0.5s: "+m.pauseCount+" (longest "+m.longestPause+"s)");
    if(typeof m.endDropPct!=="undefined") L.push("Energy in final quarter vs average: "+(m.endDropPct>0?"down ~"+m.endDropPct+"% (trailing off)":"steady/up ("+m.endDropPct+"%)"));
    if(m.pitchLabel&&m.pitchLabel!=="n/a") L.push("Pitch variety: "+m.pitchLabel+" (mean "+m.pitchMean+" Hz, variation "+m.pitchCV+")");
    if(typeof m.uptalk!=="undefined") L.push("Uptalk at ends: "+(m.uptalk?"yes":"no"));
    if(m.content) L.push("Language: "+m.content.hedges+" hedging words"+(m.content.hedgeList.length?" ("+m.content.hedgeList.join(", ")+")":"")+", avg sentence "+m.content.avgLen+" words, longest "+m.content.longest+", vocabulary variety "+m.content.variety+"%");
    return "[MEASURED DELIVERY METRICS]\n"+L.join("\n");
  }
  return "[typed - no audio]\nWords: "+m.wordCount+"; approx crutches: "+m.crutchTotal+(m.content?("\nLanguage: "+m.content.hedges+" hedging words, avg sentence "+m.content.avgLen+" words, vocabulary variety "+m.content.variety+"%"):"");
}
function meterHTML(label,val,pct,color){ return '<div class="meter"><div class="meter-top"><span class="m-label">'+label+'</span><span class="m-val">'+val+'</span></div><div class="track"><i style="width:'+Math.max(3,Math.min(100,pct))+'%;background:'+color+'"></i></div></div>'; }
function renderMetrics(m){
  const body=$("metricsBody");
  if(!m.hasAudio){ body.innerHTML='<div class="panel-note">'+(m.wordCount?"Typed response, no voice metrics this turn.":"No voice metrics yet.")+'</div>'+contentHTML(m); return; }
  const wpm=m.whisper?(m.overallWpm||m.wpm):m.wpm;
  const paceInBand=wpm>=cfg.paceMin&&wpm<=cfg.paceMax, paceLabel=wpm>170?"rushing":(wpm<95?"dragging":"good range");
  let h="";
  h+=meterHTML("Pace", wpm+" wpm · "+paceLabel, wpm/200*100, paceInBand?"var(--series-1)":"var(--c-amber)");
  const cLabel=m.whisper?(m.fillVocal+" um/uh · "+m.fillDisc+" other"):String(m.crutchTotal);
  const fillOk=m.crutchTotal<=cfg.goalFillers;
  h+=meterHTML("Fillers", cLabel, Math.min(100,m.crutchTotal*12), fillOk?"var(--series-1)":"var(--series-2)");
  if(typeof m.endDropPct!=="undefined"){
    const dropColor=m.endDropPct>25?"var(--series-2)":(m.endDropPct>10?"var(--c-amber)":"var(--c-green)");
    h+=meterHTML("Energy at ends", m.endDropPct>0?("-"+m.endDropPct+"%"):"steady", Math.abs(m.endDropPct)*2, dropColor);
  }
  if(m.pitchLabel&&m.pitchLabel!=="n/a"){
    const cvColor=m.pitchLabel==="dynamic"?"var(--c-green)":(m.pitchLabel==="moderate"?"var(--c-amber)":"var(--series-2)");
    h+=meterHTML("Pitch variety", m.pitchLabel, m.pitchCV/0.25*100, cvColor);
  }
  const ga=histAverages();
  h+='<div class="chips">'
    +'<span class="chip '+(fillOk?"good":"warn")+'">fillers '+m.crutchTotal+' / target &le;'+cfg.goalFillers+'</span>'
    +(ga.avgFill!=null?'<span class="chip">your avg '+ga.avgFill.toFixed(1)+'</span>':'')
    +'<span class="chip '+(paceInBand?"good":"warn")+'">pace '+wpm+' / '+cfg.paceMin+'-'+cfg.paceMax+'</span>'
    +(ga.avgWpm!=null?'<span class="chip">avg '+ga.avgWpm+'</span>':'')
    +'</div>';
  const chips=[];
  if(typeof m.pauseCount!=="undefined"){ chips.push('<span class="chip '+(m.pauseCount>3?"warn":"good")+'">'+m.pauseCount+' long pauses</span>'); chips.push('<span class="chip">longest '+m.longestPause+'s</span>'); }
  if(typeof m.uptalk!=="undefined") chips.push('<span class="chip '+(m.uptalk?"warn":"good")+'">'+(m.uptalk?"uptalk":"no uptalk")+'</span>');
  if(m.pitchMean) chips.push('<span class="chip">'+m.pitchMean+' Hz avg</span>');
  if(m.whisper) chips.push('<span class="chip good">whisper</span>');
  if(chips.length) h+='<div class="chips">'+chips.join("")+'</div>';
  if(m.crutchHits.length) h+='<div class="chips">'+m.crutchHits.map(c=>'<span class="chip warn">'+c+'</span>').join("")+'</div>';
  h+=contentHTML(m);
  body.innerHTML=h;
}
function esc(s){ return (s||"").replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;"); }
function analyzeContent(transcript){
  const t=(transcript||"").trim(); if(!t) return null;
  const words=t.toLowerCase().match(/\b[\w']+\b/g)||[]; const total=words.length; if(!total) return null;
  const variety=Math.round(new Set(words).size/total*100);
  const sents=t.split(/[.!?]+/).map(s=>(s.match(/\b[\w']+\b/g)||[]).length).filter(n=>n>0);
  const avgLen=sents.length?Math.round(sents.reduce((a,b)=>a+b,0)/sents.length):total;
  const longest=sents.length?Math.max.apply(null,sents):total;
  const hedgePats=[["I think",/\bi think\b/g],["I guess",/\bi guess\b/g],["maybe",/\bmaybe\b/g],["perhaps",/\bperhaps\b/g],["just",/\bjust\b/g],["probably",/\bprobably\b/g],["hopefully",/\bhopefully\b/g],["not sure",/\bnot sure\b/g],["might",/\bmight\b/g],["possibly",/\bpossibly\b/g],["I believe",/\bi believe\b/g],["a bit",/\ba bit\b/g],["a little",/\ba little\b/g],["kind of",/\bkind of\b/g],["sort of",/\bsort of\b/g]];
  const lc=" "+t.toLowerCase()+" "; let hedges=0; const hedgeList=[];
  hedgePats.forEach(([l,re])=>{ const mm=lc.match(re); if(mm&&mm.length){ hedges+=mm.length; hedgeList.push(l+" x"+mm.length); } });
  return {total,variety,avgLen,longest,sentences:sents.length,hedges,hedgeList};
}
function histAverages(){
  const r=loadProgress();
  const w=r.map(x=>x.wpm).filter(v=>typeof v==="number");
  const f=r.map(x=>x.crutches).filter(v=>typeof v==="number");
  return { avgWpm: w.length?Math.round(w.reduce((a,b)=>a+b,0)/w.length):null, avgFill: f.length?(f.reduce((a,b)=>a+b,0)/f.length):null };
}
function contentHTML(m){
  const c=m.content; if(!c) return "";
  let h='<div class="chart-head" style="margin-top:var(--sp-4)"><span class="label">Language</span></div>';
  h+=meterHTML("Hedging words", String(c.hedges), Math.min(100,c.hedges*14), c.hedges<=2?"var(--series-1)":"var(--c-amber)");
  h+='<div class="chips">'
    +'<span class="chip '+(c.avgLen>25?"warn":"good")+'">avg '+c.avgLen+' words/sentence</span>'
    +'<span class="chip '+(c.longest>40?"warn":"")+'">longest '+c.longest+'</span>'
    +'<span class="chip '+(c.variety<40?"warn":"good")+'">'+c.variety+'% word variety</span>'
    +'</div>';
  if(c.hedgeList.length) h+='<div class="chips">'+c.hedgeList.map(x=>'<span class="chip warn">'+x+'</span>').join("")+'</div>';
  return h;
}
function buildSpark(pace){
  if(!pace||!pace.length) return "";
  const W=320,H=72,padL=6,padR=6,padT=8,padB=10,pw=W-padL-padR,ph=H-padT-padB;
  const mx=Math.max(180,Math.max.apply(null,pace));
  const xf=(i)=>pace.length<=1?padL+pw/2:padL+(i/(pace.length-1))*pw;
  const yf=(v)=>padT+(1-v/mx)*ph;
  let s='<svg viewBox="0 0 '+W+' '+H+'" width="100%" style="display:block" role="img" aria-label="Pace over time">';
  s+='<rect x="'+padL+'" y="'+yf(150).toFixed(1)+'" width="'+pw+'" height="'+(yf(110)-yf(150)).toFixed(1)+'" fill="color-mix(in srgb,var(--c-green) 16%,transparent)"/>';
  const pts=pace.map((v,i)=>xf(i).toFixed(1)+","+yf(v).toFixed(1)).join(" ");
  s+='<polyline points="'+pts+'" fill="none" stroke="var(--series-1)" stroke-width="1.8" stroke-linejoin="round" stroke-linecap="round"/>';
  pace.forEach((v,i)=>{ s+='<circle cx="'+xf(i).toFixed(1)+'" cy="'+yf(v).toFixed(1)+'" r="2" fill="var(--series-1)"/>'; });
  s+='</svg>';
  return s;
}
function playSegment(t0,t1,el){
  if(lastPlayBuffer==null||t0==null) return;
  if(!playCtx) playCtx=new (window.AudioContext||window.webkitAudioContext)();
  if(playCtx.state==="suspended") playCtx.resume();
  const src=playCtx.createBufferSource(); src.buffer=lastPlayBuffer; src.connect(playCtx.destination);
  const dur=Math.max(0.25,(t1!=null?(t1-t0):0.4))+0.15;
  if(playingEl) playingEl.classList.remove("playing");
  if(el){ el.classList.add("playing"); playingEl=el; }
  try{ src.start(0, Math.max(0,t0), dur); }catch(e){}
  src.onended=()=>{ if(el){ el.classList.remove("playing"); if(playingEl===el) playingEl=null; } };
}
function playAllFillers(){
  if(!lastWa||lastPlayBuffer==null) return;
  const fills=lastWa.chunks.map((c,i)=>({c,i})).filter(o=>o.c.fill&&o.c.t0!=null);
  let k=0;
  const next=()=>{
    if(k>=fills.length){ if(playingEl){playingEl.classList.remove("playing");playingEl=null;} return; }
    const {c,i}=fills[k++]; const el=document.querySelector('#txBody .w[data-i="'+i+'"]');
    if(!playCtx) playCtx=new (window.AudioContext||window.webkitAudioContext)();
    if(playCtx.state==="suspended") playCtx.resume();
    const src=playCtx.createBufferSource(); src.buffer=lastPlayBuffer; src.connect(playCtx.destination);
    const dur=Math.max(0.25,(c.t1!=null?(c.t1-c.t0):0.4))+0.15;
    if(playingEl) playingEl.classList.remove("playing"); if(el){ el.classList.add("playing"); playingEl=el; }
    try{ src.start(0, Math.max(0,c.t0), dur); }catch(e){}
    src.onended=()=>{ if(el) el.classList.remove("playing"); setTimeout(next,200); };
  };
  next();
}
function renderTranscript(wa,m){
  const body=$("txBody"); lastWa=wa;
  if(!wa){ body.innerHTML='<div class="panel-note">'+(cfg.whisper?"No word-timed transcript for this turn.":"Turn on precise filler detection in Settings to see a word-timed transcript.")+'</div>'; return; }
  let h='<div class="kpi-row">';
  h+='<div class="kpi-tile"><div class="k-label">Um / uh / er</div><div class="k-val" style="color:'+(wa.vocal<=1?"var(--c-green)":"var(--series-2)")+'">'+wa.vocal+'</div></div>';
  h+='<div class="kpi-tile"><div class="k-label">Discourse</div><div class="k-val">'+wa.disc+'</div><div class="k-sub">like, you know</div></div>';
  h+='<div class="kpi-tile"><div class="k-label">Overall</div><div class="k-val">'+wa.overallWpm+'</div><div class="k-sub">wpm</div></div>';
  h+='</div>';
  h+='<div class="chart-head"><span class="label">Pace over time</span><span class="m-val" style="font-size:.7rem">peak '+wa.fastWpm+' wpm</span></div>';
  h+=buildSpark(wa.pace);
  h+='<div class="hint" style="margin-top:2px">Green band is the 110-150 wpm conversational zone.</div>';
  h+='<div class="chart-head" style="margin-top:var(--sp-4)"><span class="label">Transcript</span>'+((wa.vocal+wa.disc)>0?'<button class="linkbtn" id="playFillers">'+icon("play")+'play fillers</button>':'')+'</div>';
  h+='<div class="hint" style="margin-bottom:var(--sp-2)">Click any word to replay that moment.</div>';
  h+='<div class="tx-line">'+wa.chunks.map((c,i)=>'<span class="w'+(c.fill?(' f'+c.fill):'')+'" data-i="'+i+'">'+esc(c.raw).trim()+'</span>').join(" ")+'</div>';
  body.innerHTML=h;
  body.querySelectorAll('.tx-line .w').forEach(el=>{ el.addEventListener("click",()=>{ const c=wa.chunks[+el.getAttribute("data-i")]; if(c) playSegment(c.t0,c.t1,el); }); });
  const pf=$("playFillers"); if(pf) pf.addEventListener("click",playAllFillers);
}

/* ── Progress tracker ── */
function loadProgress(){ try{ return JSON.parse(localStorage.getItem("speakeasy_progress")||"[]"); }catch(e){ return []; } }
function saveProgress(r){ localStorage.setItem("speakeasy_progress", JSON.stringify(r.slice(-100))); }
function parseScores(t){
  const g=(re)=>{ const m=t.match(re); return m?parseFloat(m[1]):null; };
  const f=g(/filler[^\n:]*:\s*(\d+(?:\.\d+)?)\s*\/\s*10/i);
  const p=g(/pacing[^\n:]*:\s*(\d+(?:\.\d+)?)\s*\/\s*10/i);
  const c=g(/clarity[^\n:]*:\s*(\d+(?:\.\d+)?)\s*\/\s*10/i);
  const o=g(/confidence[^\n:]*:\s*(\d+(?:\.\d+)?)\s*\/\s*10/i);
  const st=g(/structure[^\n:]*:\s*(\d+(?:\.\d+)?)\s*\/\s*10/i);
  if(![f,p,c,o].every(v=>v!==null)) return null;
  const res={filler:f,pacing:p,clarity:c,confidence:o}; if(st!==null) res.structure=st; return res;
}
function recordProgress(scores){
  const r=loadProgress();
  r.push({t:new Date().toISOString(), scores, wpm:lastMeasured?(lastMeasured.overallWpm||lastMeasured.wpm||null):null, crutches:lastMeasured?lastMeasured.crutchTotal:null});
  saveProgress(r); renderProgress();
}
const CATS=[["clarity","Clarity","var(--series-1)"],["pacing","Pacing","var(--series-2)"],["confidence","Confidence","var(--series-4)"],["filler","Filler","var(--series-3)"]];
const CAT_STRUCT=["structure","Structure","var(--c-amber)"];
function renderProgress(){
  const body=$("progressBody"); const r=loadProgress();
  if(!r.length){ body.innerHTML='<div class="panel-note">Complete a coached response to start tracking your scores.</div>'; return; }
  const avg=(k)=>{ const v=r.map(x=>x.scores[k]).filter(n=>typeof n==="number"); return v.length?v.reduce((a,b)=>a+b,0)/v.length:null; };
  const overallEach=r.map(x=>(x.scores.filler+x.scores.pacing+x.scores.clarity+x.scores.confidence)/4);
  const overallAvg=overallEach.reduce((a,b)=>a+b,0)/overallEach.length;
  const hasStruct=r.some(x=>typeof x.scores.structure==="number");
  const series=hasStruct?CATS.concat([CAT_STRUCT]):CATS;
  const cavgs=series.map(([k,l,c])=>({k,l,c,v:avg(k)})).filter(o=>o.v!=null);
  const focus=CATS.map(([k,l,c])=>({k,l,c,v:avg(k)})).filter(o=>o.v!=null).sort((a,b)=>a.v-b.v)[0];
  let trend="n/a";
  if(r.length>=2){ const d=overallEach[overallEach.length-1]-overallEach[0]; trend=(d>=0?"▲ +":"▼ ")+d.toFixed(1); }
  let h="";
  h+='<div class="kpi-row">';
  h+='<div class="kpi-tile"><div class="k-label">Sessions</div><div class="k-val">'+r.length+'</div></div>';
  h+='<div class="kpi-tile"><div class="k-label">Avg overall</div><div class="k-val">'+overallAvg.toFixed(1)+'</div><div class="k-sub">of 10</div></div>';
  h+='<div class="kpi-tile"><div class="k-label">Trend</div><div class="k-val" style="color:'+(trend.startsWith("▲")?"var(--c-green)":(trend.startsWith("▼")?"var(--series-2)":"var(--c-ink)"))+'">'+trend+'</div></div>';
  h+='</div>';
  h+='<div class="chart-head"><span class="label">Scores over time</span><button class="linkbtn" id="clearProg">clear</button></div>';
  h+=buildChart(r, series);
  h+='<div class="legend">'+series.map(([k,l,c])=>'<span><i style="background:'+c+'"></i>'+l+'</span>').join("")+'</div>';
  h+='<div class="catbars">';
  cavgs.forEach(c=>{ h+='<div class="meter"><div class="meter-top"><span class="m-label">'+c.l+' avg</span><span class="m-val">'+c.v.toFixed(1)+'</span></div><div class="track"><i style="width:'+(c.v/10*100)+'%;background:'+c.c+'"></i></div></div>'; });
  h+='</div>';
  h+='<div class="hint" style="margin-top:var(--sp-3)">Focus area: <b style="color:var(--c-ink)">'+(focus?focus.l:"n/a")+'</b> (lowest average).</div>';
  const last5=r.slice(-5);
  const fillVals=last5.filter(x=>typeof x.crutches==="number");
  const paceVals=last5.filter(x=>typeof x.wpm==="number");
  const fillHits=fillVals.filter(x=>x.crutches<=cfg.goalFillers).length;
  const paceHits=paceVals.filter(x=>x.wpm>=cfg.paceMin&&x.wpm<=cfg.paceMax).length;
  h+='<div class="chart-head" style="margin-top:var(--sp-4)"><span class="label">Goals (last '+last5.length+')</span></div>';
  h+='<div class="chips">'
    +'<span class="chip '+(fillVals.length&&fillHits>=Math.ceil(fillVals.length/2)?"good":"warn")+'">fillers &le;'+cfg.goalFillers+': '+fillHits+'/'+fillVals.length+'</span>'
    +'<span class="chip '+(paceVals.length&&paceHits>=Math.ceil(paceVals.length/2)?"good":"warn")+'">pace '+cfg.paceMin+'-'+cfg.paceMax+': '+paceHits+'/'+paceVals.length+'</span>'
    +'</div>';
  body.innerHTML=h;
  $("clearProg").addEventListener("click",()=>{ if(confirm("Clear all tracked progress?")){ localStorage.removeItem("speakeasy_progress"); renderProgress(); } });
}
function buildChart(r, series){
  series=series||CATS;
  const W=340,H=170,padL=20,padR=10,padT=12,padB=20,pw=W-padL-padR,ph=H-padT-padB;
  const n=r.length;
  const xf=(i)=>n<=1?padL+pw/2:padL+(i/(n-1))*pw;
  const yf=(v)=>padT+(1-v/10)*ph;
  let g="";
  [0,5,10].forEach(v=>{ const y=yf(v); g+='<line x1="'+padL+'" y1="'+y+'" x2="'+(W-padR)+'" y2="'+y+'" stroke="var(--c-line)" stroke-width="1"/>'; g+='<text x="'+(padL-4)+'" y="'+(y+3)+'" text-anchor="end" font-family="var(--f-mono)" font-size="7" fill="var(--c-ink-3)">'+v+'</text>'; });
  let lines="";
  series.forEach(([k,l,c])=>{
    const pts=[]; r.forEach((x,i)=>{ const v=x.scores[k]; if(typeof v==="number") pts.push(xf(i).toFixed(1)+","+yf(v).toFixed(1)); });
    if(pts.length>1) lines+='<polyline points="'+pts.join(" ")+'" fill="none" stroke="'+c+'" stroke-width="1.8" stroke-linejoin="round" stroke-linecap="round"/>';
    r.forEach((x,i)=>{ const v=x.scores[k]; if(typeof v==="number") lines+='<circle cx="'+xf(i).toFixed(1)+'" cy="'+yf(v).toFixed(1)+'" r="2.4" fill="'+c+'"/>'; });
  });
  return '<svg viewBox="0 0 '+W+' '+H+'" width="100%" style="display:block" role="img" aria-label="Score trend chart">'+g+lines+'</svg>';
}

/* ── On-device Whisper analytics ── */
let asrPipe=null, asrLoading=false;
async function getASR(){
  if(asrPipe) return asrPipe;
  const mod=await import("https://cdn.jsdelivr.net/npm/@huggingface/transformers@4.2.0");
  const prog=(p)=>{ if(p&&p.status==="progress"&&typeof p.progress==="number") setStatus("loading speech model "+Math.round(p.progress)+"% (one time)"); };
  const opts={progress_callback:prog};
  if(navigator.gpu){
    try{ asrPipe=await mod.pipeline("automatic-speech-recognition", cfg.whisperModel, Object.assign({device:"webgpu"},opts)); return asrPipe; }
    catch(e){ /* fall through to CPU */ }
  }
  asrPipe=await mod.pipeline("automatic-speech-recognition", cfg.whisperModel, opts);
  return asrPipe;
}
async function decodeAudio(blob){
  const arr=await blob.arrayBuffer();
  const ac=new (window.AudioContext||window.webkitAudioContext)();
  const dec=await ac.decodeAudioData(arr); ac.close();
  const off=new OfflineAudioContext(1, Math.max(1,Math.ceil(dec.duration*16000)), 16000);
  const s=off.createBufferSource(); s.buffer=dec; s.connect(off.destination); s.start();
  const out=await off.startRendering();
  return {pcm:out.getChannelData(0), buffer:dec};
}
const FILL_VOCAL={um:1,umm:1,uhm:1,uh:1,uhh:1,er:1,err:1,erm:1,ah:1,ahh:1,hmm:1,mm:1,mmm:1};
const FILL_DISC={like:1,basically:1,actually:1,literally:1,right:1,okay:1,ok:1,yeah:1};
const FILL_BIGRAM={"you know":1,"i mean":1,"sort of":1,"kind of":1};
async function analyzeSpeech(blob){
  const dec=await decodeAudio(blob); const pcm=dec.pcm; lastPlayBuffer=dec.buffer;
  const pipe=await getASR();
  const out=await pipe(pcm,{return_timestamps:"word",chunk_length_s:30,stride_length_s:5});
  const chunks=(out.chunks||[]).map(c=>{ const raw=c.text||""; const w=raw.trim().toLowerCase().replace(/[^a-z']/g,"");
    const ts=c.timestamp||[]; return {raw,w,t0:ts[0]!=null?ts[0]:null,t1:ts[1]!=null?ts[1]:null,fill:0}; }).filter(c=>c.w.length||/\S/.test(c.raw));
  let vocal=0,disc=0; const marks={};
  chunks.forEach(c=>{ if(FILL_VOCAL[c.w]){ vocal++; marks[c.w]=(marks[c.w]||0)+1; c.fill=1; }
    else if(FILL_DISC[c.w]){ disc++; marks[c.w]=(marks[c.w]||0)+1; c.fill=2; } });
  for(let i=0;i<chunks.length-1;i++){ const pair=chunks[i].w+" "+chunks[i+1].w;
    if(FILL_BIGRAM[pair]){ disc++; marks[pair]=(marks[pair]||0)+1; if(!chunks[i].fill)chunks[i].fill=2; if(!chunks[i+1].fill)chunks[i+1].fill=2; } }
  const timed=chunks.filter(c=>c.t0!=null);
  const start=timed.length?timed[0].t0:0;
  const end=timed.length?(timed[timed.length-1].t1||timed[timed.length-1].t0):0;
  const dur=Math.max(0.5,end-start);
  const wordCount=chunks.filter(c=>c.w.length).length;
  const overallWpm=Math.round(wordCount/(dur/60));
  const binSec=Math.max(2.5,dur/12); const nb=Math.max(1,Math.ceil(dur/binSec)); const counts=new Array(nb).fill(0);
  timed.forEach(c=>{ if(!c.w.length) return; const bi=Math.min(nb-1,Math.floor((c.t0-start)/binSec)); counts[bi]++; });
  const pace=counts.map(n=>Math.round(n/(binSec/60)));
  let fastIdx=0; pace.forEach((v,i)=>{ if(v>pace[fastIdx]) fastIdx=i; });
  return {text:(out.text||"").trim(),chunks,vocal,disc,marks,wordCount,overallWpm,dur:+dur.toFixed(1),pace,fastWpm:pace[fastIdx]||0};
}

/* ── Mic flow ── */
async function startSpeaking(){
  if(busy) return; if(window.speechSynthesis) speechSynthesis.cancel();
  recognizing=true; $("micBtn").classList.add("rec"); $("micBtn").innerHTML=icon("stop")+'<span>Stop</span>'; $("wave").classList.add("rec"); startRec(); hideBanner();
  if(!startRecognition()){ recognizing=false; stopRec(); $("micBtn").classList.remove("rec"); $("micBtn").innerHTML=icon("mic")+'<span>Speak</span>'; $("wave").classList.remove("rec"); return; }
  await startAudio(); setStatus("listening… speak, then press Stop.");
}
async function stopSpeaking(){
  recognizing=false; stopRec(); $("micBtn").classList.remove("rec"); $("micBtn").innerHTML=icon("mic")+'<span>Speak</span>'; $("wave").classList.remove("rec");
  if(recog){ try{recog.stop();}catch(e){} }
  stopSampling();
  const blob=await finalizeRecording();
  stopStream();
  let transcript=finalTranscript.trim();
  let wa=null;
  if(cfg.whisper && blob){
    busy=true; setBusy(true);
    try{ setStatus("analysing speech on-device…"); wa=await analyzeSpeech(blob); if(wa.text&&wa.text.length>2) transcript=wa.text; }
    catch(e){ showBanner("Precise analysis unavailable this turn, using the basic transcript. ("+e.message+")",false); wa=null; }
    busy=false; setBusy(false);
  }
  if(!transcript){ setStatus("didn't catch anything, try again."); return; }
  const m=computeMetrics(transcript, wa); lastMeasured=m; renderMetrics(m); renderTranscript(wa,m);
  switchTab(wa?"tx":"turn"); setStatus("");
  if(cfg.mode==="drill"){ switchTab(wa?"tx":"turn"); setStatus("drill logged locally. No AI used."); return; }
  lastUserWasCommand=false;
  if(cfg.mode==="roleplay"){ await sendUserTurn(transcript, transcript+"\n\n"+metricsToText(m)); return; }
  await sendUserTurn(transcript, "Question I answered: "+lastQuestionText+"\n\nMy spoken answer: "+transcript+"\n\n"+metricsToText(m));
}
$("micBtn").addEventListener("click",()=>{ recognizing?stopSpeaking():startSpeaking(); });

/* ── Buttons ── */
function setInSession(on){ inSession=on; const app=document.querySelector(".app"); if(!app) return;
  app.classList.toggle("in-session",on);
  app.classList.toggle("mode-coach",on&&cfg.mode==="coach");
  app.classList.toggle("mode-roleplay",on&&cfg.mode==="roleplay");
  app.classList.toggle("mode-drill",on&&cfg.mode==="drill");
  updateCmdline();
}
function enableAfterStart(){ if(!inSession) return;
  ["micBtn","endBtn","reportBtn","copyBtn"].forEach(id=>{const el=$(id); if(el)el.disabled=false;});
  const rp=cfg.mode==="roleplay", drill=cfg.mode==="drill";
  const freeDrill=drill && cfg.drillMode==="free";
  $("newBtn").disabled=rp||freeDrill; $("retryBtn").disabled=freeDrill;
  $("typeInput").disabled=drill; $("sendBtn").disabled=drill;
}
$("startBtn").addEventListener("click",async()=>{
  if(cfg.mode!=="drill" && !activeKey()){ if(cfg.provider==="openrouter"){ applyCfg(); $("settingsModal").classList.add("show"); } else showOnboard(true); return; }
  localStorage.setItem("speakeasy_mode",cfg.mode);
  sessionLog=[]; lastQuestionText=""; lastAnswer=""; lastUserWasCommand=false; history=[]; questionBank=[]; provOverride=null;
  setInSession(true);
  if(cfg.mode==="drill"){
    localStorage.setItem("speakeasy_drillMode",cfg.drillMode);
    if(cfg.drillMode==="free"){ showQuestion("Free practice — press the mic and speak. Your fillers, pace, and voice metrics will appear here after each recording."); enableAfterStart(); setStatus("free practice: on-device metrics only."); return; }
    fillLocalBank(); showQuestion(nextQuestion()); enableAfterStart(); setStatus("drill mode: record for on-device metrics, no AI used."); return;
  }
  if(cfg.mode==="roleplay"){
    const scene=($("scenarioInput").value.trim())||cfg.scenario||"a realistic interviewer for the target role";
    cfg.scenario=scene; localStorage.setItem("speakeasy_scenario",scene);
    history=[{role:"user",text:"[SESSION START] Mode: ROLEPLAY. Persona and scene: "+scene+"."+practiceContext()+" Stay fully in character. Do not present yourself as an AI or a coach. Open the scene now with a short first line (2 to 4 sentences), then wait for my spoken reply. Do not output any Score."}];
    await speakeasyTurn(); enableAfterStart(); return;
  }
  /* coach */
  const tailored=!!(cfg.role||cfg.jd);
  if(tailored){ setBusy(true); setStatus("preparing tailored questions…"); const qs=await generateQuestions(); setBusy(false); setStatus(""); if(qs.length) questionBank=qs; else fillLocalBank(); }
  else { fillLocalBank(); }
  showQuestion(nextQuestion()); enableAfterStart();
});
$("newBtn").addEventListener("click",()=>{ if(busy||!inSession||cfg.mode==="roleplay") return; showQuestion(nextQuestion()); });
$("retryBtn").addEventListener("click",()=>{ if(busy||!inSession) return; if(cfg.mode==="roleplay"){ setStatus("keep the scene going: speak or type your reply."); return; } if(lastQuestionText){ addMsg("speakeasy",lastQuestionText); if(cfg.tts) speak(lastQuestionText); } });
$("endBtn").addEventListener("click",async()=>{
  if(busy||!inSession) return;
  if(cfg.mode==="roleplay"){ addMsg("you","(ending the roleplay, please debrief)"); history.push({role:"user",text:"[BREAK] End the roleplay now and deliver the full coaching debrief with the Score section, judging how I performed in character."}); lastUserWasCommand=false; await speakeasyTurn(); }
  setInSession(false); updateCmdline(); setStatus("session ended. pick a mode to start again."); if(window.speechSynthesis) speechSynthesis.cancel();
});
$("copyBtn").addEventListener("click",()=>{ const t=(lastWa&&lastWa.text)?lastWa.text:(lastAnswer||""); if(!t){ setStatus("no transcript yet."); return; } if(navigator.clipboard) navigator.clipboard.writeText(t).then(()=>setStatus("transcript copied."),()=>setStatus("copy failed.")); else setStatus("clipboard not available."); });
$("sendBtn").addEventListener("click",sendTyped);
$("typeInput").addEventListener("keydown",(e)=>{ if(e.key==="Enter") sendTyped(); });
async function sendTyped(){ const v=$("typeInput").value.trim(); if(!v||busy) return; $("typeInput").value="";
  if(cfg.mode==="roleplay"){ lastUserWasCommand=false; await sendUserTurn(v, v); return; }
  lastUserWasCommand=true; await sendUserTurn(v, v+"\n\n[COMMAND] This is an instruction, not a practice answer. Act on it, reply briefly, and do not output any Score."); }

/* ── Session report ── */
function repText(s){ return mdLite(s||"").replace(/\n/g,"<br>"); }
function buildReport(){
  const d=new Date().toLocaleString();
  let h='<div class="rep-head"><h1>SpeakEasy session report</h1><div class="rep-meta">'+esc(d)+(cfg.role?(" · "+esc(cfg.role)+(cfg.seniority?(" ("+esc(cfg.seniority)+")"):"")):"")+" · "+sessionLog.length+" answer(s)</div></div>";
  if(!sessionLog.length) return h+"<p>No answers recorded in this session yet.</p>";
  const sc=sessionLog.map(e=>parseScores(e.debrief)).filter(Boolean);
  if(sc.length){ const a=k=>(sc.reduce((x,y)=>x+(y[k]||0),0)/sc.length).toFixed(1);
    h+='<div class="rep-avg">Session averages: Filler '+a("filler")+", Pacing "+a("pacing")+", Clarity "+a("clarity")+", Confidence "+a("confidence")+"</div>"; }
  sessionLog.forEach((e,i)=>{
    h+='<div class="rep-item"><div class="rep-q">Q'+(i+1)+". "+esc((e.q||"").replace(/\*\*/g,""))+"</div>";
    if(e.a) h+='<div class="rep-a"><b>Your answer:</b> '+esc(e.a)+"</div>";
    if(e.m){ const mm=e.m; const p=[]; if(mm.overallWpm||mm.wpm) p.push((mm.overallWpm||mm.wpm)+" wpm"); p.push(mm.crutchTotal+" fillers"); if(mm.content) p.push(mm.content.hedges+" hedges, "+mm.content.variety+"% variety"); h+='<div class="rep-m">'+p.join(" · ")+"</div>"; }
    h+='<div class="rep-d">'+repText(e.debrief)+"</div></div>";
  });
  return h;
}
$("reportBtn").addEventListener("click",()=>{ if(!sessionLog.length){ setStatus("nothing to report yet, answer a prompt first."); return; } $("report").innerHTML=buildReport(); window.print(); });

/* ── Tabs ── */
function switchTab(which){
  const map={turn:["tabTurn","panelTurn"],tx:["tabTx","panelTx"],progress:["tabProgress","panelProgress"]};
  Object.keys(map).forEach(k=>{ const on=k===which; $(map[k][0]).setAttribute("aria-selected",on); $(map[k][1]).classList.toggle("active",on); });
}
$("tabTurn").addEventListener("click",()=>switchTab("turn"));
$("tabTx").addEventListener("click",()=>switchTab("tx"));
$("tabProgress").addEventListener("click",()=>{ switchTab("progress"); renderProgress(); });

/* ── Key storage, onboarding, practice context ── */
function storeKey(key, remember){
  cfg.apiKey=key; cfg.rememberKey=!!remember;
  if(remember){ localStorage.setItem("speakeasy_key",key); sessionStorage.removeItem("speakeasy_key"); localStorage.setItem("speakeasy_remember","1"); }
  else { sessionStorage.setItem("speakeasy_key",key); localStorage.removeItem("speakeasy_key"); localStorage.setItem("speakeasy_remember","0"); }
}
function clearKey(){ cfg.apiKey=""; localStorage.removeItem("speakeasy_key"); sessionStorage.removeItem("speakeasy_key"); }
async function testKey(key){
  if(!key) return {ok:false,msg:"Paste a key first."};
  try{
    const r=await fetch("https://generativelanguage.googleapis.com/v1beta/models",{headers:{"x-goog-api-key":key}});
    if(r.ok) return {ok:true,msg:"Key works. You are good to go."};
    let d="HTTP "+r.status; try{ const j=await r.json(); if(j.error&&j.error.message) d=j.error.message; }catch(e){}
    return {ok:false,msg:"Key rejected: "+d};
  }catch(e){ return {ok:false,msg:"Network error: "+e.message}; }
}
function practiceContext(){
  const parts=[];
  if(cfg.role) parts.push("Target role: "+cfg.role);
  if(cfg.seniority) parts.push("Seniority: "+cfg.seniority);
  if(cfg.jd) parts.push("Job description:\n"+cfg.jd.slice(0,4000));
  if(!parts.length) return "";
  return "\n\n[PRACTICE CONTEXT] The user is preparing for this specific role. Ask questions tailored to it and weight scoring toward its likely competencies.\n"+parts.join("\n");
}
function obHint(){ const p=$("obProvider")?$("obProvider").value:"gemini", h=$("obKeyHint"), k=$("obKey");
  if(p==="openrouter"){ if(h)h.innerHTML='Free OpenRouter key (no card): <a href="https://openrouter.ai/keys" target="_blank" rel="noopener">openrouter.ai/keys</a>'; if(k)k.placeholder="sk-or-..."; }
  else { if(h)h.innerHTML='Free Gemini key (no card): <a href="https://aistudio.google.com/apikey" target="_blank" rel="noopener">aistudio.google.com/apikey</a>'; if(k)k.placeholder="Paste your key"; }
}
function showOnboard(s){ if(s&&$("obProvider")){ $("obProvider").value=cfg.provider; obHint(); } $("onboard").classList.toggle("show", !!s); }

/* ── Settings ── */
function applyCfg(){
  $("apiKey").value=cfg.apiKey; $("model").value=cfg.model; $("ttsOn").checked=cfg.tts; $("audioOn").checked=cfg.audio; if($("ttsRate")) $("ttsRate").value=cfg.ttsRate;
  $("whisperOn").checked=cfg.whisper; $("whisperModel").value=cfg.whisperModel; $("rememberKey").checked=cfg.rememberKey;
  $("roleInput").value=cfg.role; $("seniorityInput").value=cfg.seniority; $("jdInput").value=cfg.jd;
  $("goalFillers").value=cfg.goalFillers; $("paceMin").value=cfg.paceMin; $("paceMax").value=cfg.paceMax;
  if($("capGemini")) $("capGemini").value=cfg.capGemini; if($("capOR")) $("capOR").value=cfg.capOR;
  if($("provider")) $("provider").value=cfg.provider; if($("orKey")) $("orKey").value=cfg.orKey; if($("orModel")) $("orModel").value=cfg.orModel;
  updateProviderUI(); updateTtsUI();
}
$("saveBtn").addEventListener("click",()=>{
  cfg.model=$("model").value; cfg.tts=$("ttsOn").checked; cfg.audio=$("audioOn").checked; cfg.voice=$("voiceSel").value; cfg.ttsRate=parseFloat($("ttsRate").value||"1.0");
  const prevWM=cfg.whisperModel; cfg.whisper=$("whisperOn").checked; cfg.whisperModel=$("whisperModel").value; if(cfg.whisperModel!==prevWM) asrPipe=null;
  storeKey($("apiKey").value.trim(), $("rememberKey").checked);
  cfg.provider=$("provider").value; localStorage.setItem("speakeasy_provider",cfg.provider);
  storeORKey($("orKey").value.trim(), $("rememberKey").checked);
  cfg.orModel=$("orModel").value.trim(); localStorage.setItem("speakeasy_orModel",cfg.orModel);
  localStorage.setItem("speakeasy_model",cfg.model);
  localStorage.setItem("speakeasy_tts",cfg.tts?"1":"0"); localStorage.setItem("speakeasy_audio",cfg.audio?"1":"0"); localStorage.setItem("speakeasy_voice",cfg.voice); localStorage.setItem("speakeasy_ttsRate",cfg.ttsRate);
  localStorage.setItem("speakeasy_whisper",cfg.whisper?"1":"0"); localStorage.setItem("speakeasy_whisperModel",cfg.whisperModel);
  cfg.goalFillers=Math.max(0,+$("goalFillers").value||3); cfg.paceMin=+$("paceMin").value||110; cfg.paceMax=+$("paceMax").value||150;
  cfg.capGemini=Math.max(1,+$("capGemini").value||20); localStorage.setItem("speakeasy_capGemini",cfg.capGemini);
  cfg.capOR=Math.max(1,+$("capOR").value||50); localStorage.setItem("speakeasy_capOR",cfg.capOR); renderUsage();
  localStorage.setItem("speakeasy_goalFillers",cfg.goalFillers); localStorage.setItem("speakeasy_paceMin",cfg.paceMin); localStorage.setItem("speakeasy_paceMax",cfg.paceMax);
  setStatus("settings saved."); if(cfg.apiKey) hideBanner(); $("settingsModal").classList.remove("show");
});
$("testBtn").addEventListener("click",async()=>{ const el=$("testMsg"); el.className="testmsg"; el.textContent="testing..."; const r=await testKey($("apiKey").value.trim()); el.className="testmsg "+(r.ok?"ok":"bad"); el.textContent=r.msg; });
if($("provider")) $("provider").addEventListener("change",updateProviderUI);
if($("orTestBtn")) $("orTestBtn").addEventListener("click",async()=>{ const el=$("orTestMsg"); el.className="testmsg"; el.textContent="testing..."; const r=await testORKey($("orKey").value.trim()); el.className="testmsg "+(r.ok?"ok":"bad"); el.textContent=r.msg; });
$("clearKey").addEventListener("click",(e)=>{ e.preventDefault(); clearKey(); $("apiKey").value=""; const el=$("testMsg"); el.className="testmsg"; el.textContent="Key cleared from this browser."; });
$("saveSetupBtn").addEventListener("click",()=>{
  cfg.role=$("roleInput").value.trim(); cfg.seniority=$("seniorityInput").value.trim(); cfg.jd=$("jdInput").value.trim();
  localStorage.setItem("speakeasy_role",cfg.role); localStorage.setItem("speakeasy_seniority",cfg.seniority); localStorage.setItem("speakeasy_jd",cfg.jd);
  setStatus("practice setup saved (applies on your next new session).");
});

/* ── Onboarding modal ── */
if($("obProvider")) $("obProvider").addEventListener("change",obHint);
$("obTest").addEventListener("click",async()=>{ const el=$("obMsg"); el.className="testmsg"; el.textContent="testing..."; const p=$("obProvider").value; const r=p==="openrouter"?await testORKey($("obKey").value.trim()):await testKey($("obKey").value.trim()); el.className="testmsg "+(r.ok?"ok":"bad"); el.textContent=r.msg; });
$("obStart").addEventListener("click",()=>{ const key=$("obKey").value.trim(); if(!key){ const el=$("obMsg"); el.className="testmsg bad"; el.textContent="Paste your key first."; return; } const p=$("obProvider").value; cfg.provider=p; localStorage.setItem("speakeasy_provider",p); if(p==="openrouter") storeORKey(key,$("obRemember").checked); else storeKey(key,$("obRemember").checked); applyCfg(); showOnboard(false); hideBanner(); setStatus("ready"); renderUsage(); });
$("onboard").addEventListener("click",(e)=>{ if(e.target===$("onboard")) showOnboard(false); });

/* ── Studio UI: live waveform, drawer, settings, REC timer ── */
let waveCanvas=null,waveCtx=null,waveFreq=null,waveT=0,reduceMotion=false;
function roundRect(c,x,y,w,h,r){ r=Math.min(r,w/2,h/2); c.beginPath(); c.moveTo(x+r,y); c.arcTo(x+w,y,x+w,y+h,r); c.arcTo(x+w,y+h,x,y+h,r); c.arcTo(x,y+h,x,y,r); c.arcTo(x,y,x+w,y,r); c.closePath(); }
function initWave(){
  waveCanvas=$("waveCanvas"); if(!waveCanvas) return;
  reduceMotion=window.matchMedia&&window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  const resize=()=>{ const dpr=window.devicePixelRatio||1, r=waveCanvas.getBoundingClientRect(); waveCanvas.width=Math.max(1,Math.round(r.width*dpr)); waveCanvas.height=Math.max(1,Math.round(r.height*dpr)); };
  resize(); window.addEventListener("resize",resize);
  waveCtx=waveCanvas.getContext("2d");
  const acc=(getComputedStyle(document.documentElement).getPropertyValue('--c-accent').trim())||'#C6FF3A';
  function draw(){ requestAnimationFrame(draw); if(!waveCtx) return;
    const W=waveCanvas.width,H=waveCanvas.height; waveCtx.clearRect(0,0,W,H);
    const bars=48, unit=W/bars, bw=unit*0.6, live=recognizing&&analyser;
    if(live){ if(!waveFreq||waveFreq.length!==analyser.frequencyBinCount) waveFreq=new Uint8Array(analyser.frequencyBinCount); analyser.getByteFrequencyData(waveFreq); }
    if(!reduceMotion) waveT+=0.09;
    for(let i=0;i<bars;i++){ let amp;
      if(live){ const idx=Math.floor(i/bars*(waveFreq.length*0.55)); amp=Math.pow((waveFreq[idx]||0)/255,0.8); }
      else { amp=reduceMotion?0.08:((Math.sin(i*0.5+waveT)*0.5+0.5)*0.14+0.04); }
      const h=Math.max(H*0.06, amp*H*0.9), x=i*unit+(unit-bw)/2, y=(H-h)/2;
      waveCtx.fillStyle=acc; waveCtx.globalAlpha=live?0.95:0.42; roundRect(waveCtx,x,y,bw,h,bw/2); waveCtx.fill();
    }
    waveCtx.globalAlpha=1;
  }
  requestAnimationFrame(draw);
}
let recTimer=null,recT0=0;
function startRec(){ const p=$("recPill"); if(p)p.classList.add("show"); recT0=Date.now(); const t=$("recTime"); if(recTimer)clearInterval(recTimer); recTimer=setInterval(()=>{ const s=Math.floor((Date.now()-recT0)/1000); if(t)t.textContent="REC "+String(Math.floor(s/60)).padStart(2,"0")+":"+String(s%60).padStart(2,"0"); },500); }
function stopRec(){ if(recTimer){clearInterval(recTimer);recTimer=null;} const p=$("recPill"); if(p)p.classList.remove("show"); }
/* draggable divider between conversation and controls */
function initDivider(){ const ws=$("workspace"), dv=$("divider"); if(!ws||!dv) return;
  const saved=parseInt(localStorage.getItem("speakeasy_ctrlW")||"",10); if(saved) ws.style.setProperty("--ctrl-w",saved+"px");
  let dragging=false;
  const move=(e)=>{ if(!dragging) return; const x=e.touches?e.touches[0].clientX:e.clientX; const r=ws.getBoundingClientRect(); let w=Math.round(r.right-x); w=Math.max(280,Math.min(600,w)); ws.style.setProperty("--ctrl-w",w+"px"); };
  const up=()=>{ if(!dragging) return; dragging=false; document.body.style.userSelect=""; const w=parseInt(getComputedStyle(ws).getPropertyValue("--ctrl-w"),10); if(w) localStorage.setItem("speakeasy_ctrlW",w); };
  dv.addEventListener("mousedown",(e)=>{ dragging=true; document.body.style.userSelect="none"; e.preventDefault(); });
  window.addEventListener("mousemove",move); window.addEventListener("mouseup",up);
  dv.addEventListener("touchstart",()=>{dragging=true;},{passive:true}); window.addEventListener("touchmove",move,{passive:true}); window.addEventListener("touchend",up);
}
function updateCmdline(){ const el=$("cmdText"); if(!el) return;
  if(!inSession){ el.textContent="ready — select a mode"; return; }
  let s="session --mode "+cfg.mode;
  if(cfg.mode==="roleplay" && cfg.scenario) s+=' --persona "'+cfg.scenario.slice(0,48)+'"';
  else if(cfg.role) s+=' --role "'+cfg.role.slice(0,48)+'"';
  el.textContent=s;
}
$("settingsBtn").addEventListener("click",()=>{ applyCfg(); $("settingsModal").classList.add("show"); });
$("settingsClose").addEventListener("click",()=>$("settingsModal").classList.remove("show"));
$("settingsModal").addEventListener("click",(e)=>{ if(e.target===$("settingsModal")) $("settingsModal").classList.remove("show"); });

/* ── TTS settings UI ── */
function updateTtsHint(){
  const hint=$("ttsHint"); if(!hint) return;
  const ua=navigator.userAgent;
  if(/Edg/.test(ua)){
    hint.innerHTML="You're on Microsoft Edge &mdash; natural neural voices appear in the dropdown above (marked <b>natural</b>).";
  } else {
    hint.innerHTML="<b>For natural AI voices, open SpeakEasy in Microsoft Edge.</b> It's free, built into Windows, and uses the same engine as Chrome. Your current browser only has robotic offline voices.";
  }
}
if($("ttsRate")) $("ttsRate").addEventListener("input",function(){ const rl=$("rateLabel"); if(rl) rl.textContent=parseFloat(this.value).toFixed(2)+"&times;"; });
$("settingsBtn").addEventListener("click",function(){ setTimeout(function(){ const c=document.querySelectorAll("#voiceSel option").length; const vc=$("voiceCount"); if(vc) vc.textContent="("+c+" voices)"; updateTtsHint(); },300); });
setTimeout(updateTtsHint,500);

/* ── Init ── */
/* ── Mode chips + keyboard shortcut ── */
function setMode(m){ cfg.mode=m; localStorage.setItem("speakeasy_mode",m);
  ["Coach","Roleplay","Drill"].forEach(function(x){ var el=$("mode"+x); if(el) el.classList.toggle("active", el.getAttribute("data-mode")===m); });
  var sc=$("scenarioInput"); if(sc) sc.style.display=(m==="roleplay")?"":"none";
  var ds=$("drillSub"); if(ds) ds.style.display=(m==="drill")?"":"none";
}
function setDrillMode(m){ cfg.drillMode=m; localStorage.setItem("speakeasy_drillMode",m);
  ["topics","free"].forEach(function(x){ var el=$("drill"+x.charAt(0).toUpperCase()+x.slice(1)); if(el) el.classList.toggle("active", x===m); });
}
[["modeCoach","coach"],["modeRoleplay","roleplay"],["modeDrill","drill"]].forEach(function(p){ var id=p[0],m=p[1]; var el=$(id); if(el) el.addEventListener("click",function(){ setMode(m); }); });
[["drillTopics","topics"],["drillFree","free"]].forEach(function(p){ var id=p[0],m=p[1]; var el=$(id); if(el) el.addEventListener("click",function(){ setDrillMode(m); }); });
document.addEventListener("keydown",(e)=>{ if(e.code!=="Space"||!inSession||busy) return; const t=e.target; if(t&&(t.tagName==="INPUT"||t.tagName==="TEXTAREA"||t.isContentEditable)) return; const mb=$("micBtn"); if(!mb||mb.disabled) return; e.preventDefault(); recognizing?stopSpeaking():startSpeaking(); });

initIcons(); applyCfg(); setMode(cfg.mode); setDrillMode(cfg.drillMode); renderProgress(); initWave(); renderUsage(); initDivider(); updateCmdline(); setStatus("");
if(!SR) showBanner("This tool needs <b>Google Chrome</b> (or Edge) on desktop for speech recognition.",true);
else if(!activeKey()) showOnboard(true);
