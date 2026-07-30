"use strict";

/* ── Config ── */
const cfg = {
  apiKey: localStorage.getItem("speakeasy_key") || sessionStorage.getItem("speakeasy_key") || "",
  rememberKey: localStorage.getItem("speakeasy_remember") !== "0",
  model: (function(m){ return (!m||/^gemini-(1|2)\./.test(m))?"gemini-3.5-flash":m; })(localStorage.getItem("speakeasy_model")),
  tts: localStorage.getItem("speakeasy_tts") !== "0",
  audio: localStorage.getItem("speakeasy_audio") !== "0",
  whisper: localStorage.getItem("speakeasy_whisper") !== "0",
  whisperModel: localStorage.getItem("speakeasy_whisperModel") || "Xenova/whisper-base.en",
  voice: localStorage.getItem("speakeasy_voice") || "",
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
"You run inside a browser voice tool. After each SPOKEN response you receive a block titled [MEASURED DELIVERY METRICS] computed from the user's real microphone audio: words-per-minute, pauses, energy drop at the end of speaking, pitch variety (monotone vs dynamic), uptalk, and an approximate verbal-crutch count. Base your Score section on these real numbers and cite specific values or moments. If the metrics include a 'Precise fillers (on-device Whisper)' line, treat those filler counts as accurate and cite them. If instead they say 'Approx verbal crutches', exact 'um'/'uh' may be undercounted, so if pauses are many or long, treat them as likely hesitation and say so. If a response is marked '[typed - no audio]', estimate delivery and label those two scores '(estimated)'.",
"",
"COACHING PRIORITIES (in order every session): 1) Filler words - flag 'um','uh','like','you know','sort of','basically' or equivalent crutches. 2) Pacing - rushing or stalling; anchor to the moment. Ideal pace ~110-150 wpm; over ~170 rushing, under ~95 dragging; factor long pauses. 3) Clarity - does the point land within the first two sentences? 4) Confidence and vocal presence - hedging language and weak qualifiers, plus the audio metrics for dropped energy at sentence ends, monotone delivery, and uptalk.",
"",
"FEEDBACK STYLE: Balanced - acknowledge what worked before what needs fixing. Never pad with empty praise. Be specific.",
"",
"MODES: COACH MODE (default) - give a prompt, then after their answer deliver the debrief, then ask retry-or-new. ROLEPLAY MODE (user activates) - adopt the requested persona; stay in character until the user says 'break' or 'coach mode', then immediately deliver the debrief. Never blend modes without the user's command.",
"",
"SESSION DEBRIEF FORMAT (after every response, in either mode) - you MUST use exactly these score labels so the tool can track them:",
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
"Begin by introducing yourself in two sentences, then ask which mode they want and what context they are practising for (interview, presentation, or everyday conversation)."
].join("\n");

/* ── State ── */
let history = [], busy = false, lastMeasured = null;
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
  d.innerHTML='<div class="who">'+(who==="speakeasy"?"SpeakEasy":"You")+'</div>'+mdLite(text);
  logEl.appendChild(d); logEl.scrollTop=logEl.scrollHeight;
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
  if(/google/.test(n)) s+=50;
  if(/online/.test(n)) s+=40;
  if(/(aria|jenny|guy|libby|sonia|ryan|emma|michelle|ava|andrew)/.test(n)) s+=20;
  if(/microsoft/.test(n)) s+=15;
  if(v.localService===false) s+=10;
  if(v.lang==="en-US") s+=6; else if(v.lang==="en-GB") s+=5;
  return s;
}
function loadVoices(){
  voices = window.speechSynthesis ? speechSynthesis.getVoices() : [];
  const en=voices.filter(v=>v.lang&&v.lang.toLowerCase().startsWith("en")).sort((a,b)=>voiceScore(b)-voiceScore(a));
  if(!cfg.voice && en.length) cfg.voice=en[0].name;
  const sel=$("voiceSel"); sel.innerHTML="";
  en.forEach((v,i)=>{ const o=document.createElement("option"); o.value=v.name;
    const tag=voiceScore(v)>=100?" (natural)":(i===0?" (recommended)":"");
    o.textContent=v.name+" ("+v.lang+")"+tag;
    if(v.name===cfg.voice) o.selected=true; sel.appendChild(o); });
}
if(window.speechSynthesis){ loadVoices(); speechSynthesis.onvoiceschanged=loadVoices; }
function speak(text){
  if(!cfg.tts||!window.speechSynthesis) return;
  speechSynthesis.cancel();
  const clean=text.replace(/\*\*/g,"").replace(/[#*_`>-]/g," ").replace(/\s+/g," ").trim();
  const u=new SpeechSynthesisUtterance(clean);
  const v=voices.find(x=>x.name===cfg.voice); if(v) u.voice=v;
  u.rate=1.02; speechSynthesis.speak(u);
}

/* ── Gemini ── */
async function callGemini(){
  if(!cfg.apiKey){ showBanner("Add your Gemini API key in Settings to begin.",true); return null; }
  const url="https://generativelanguage.googleapis.com/v1beta/models/"+encodeURIComponent(cfg.model)+":generateContent";
  const body={ system_instruction:{parts:[{text:SPEAKEASY_PROMPT}]},
    contents:history.map(h=>({role:h.role,parts:[{text:h.text}]})),
    generationConfig:{temperature:0.75,maxOutputTokens:900} };
  let res;
  try{ res=await fetch(url,{method:"POST",headers:{"Content-Type":"application/json","x-goog-api-key":cfg.apiKey},body:JSON.stringify(body)}); }
  catch(e){ showBanner("Network error reaching Gemini. If you opened this file directly, try the local-server method in Settings. ("+e.message+")",true); return null; }
  if(!res.ok){
    let d=""; try{ const j=await res.json(); d=j.error&&j.error.message?j.error.message:JSON.stringify(j); }catch(e){ d=res.statusText; }
    if(res.status===429) showBanner("Gemini free-tier limit hit (429). Free Flash caps requests-per-minute, tokens-per-minute, and requests-per-day; tripping any one triggers this. Wait a minute, or switch model in Settings. "+d,true);
    else if(res.status===400&&/API key/i.test(d)) showBanner("Invalid API key. Re-check it in Settings. "+d,true);
    else showBanner("Gemini error "+res.status+": "+d,true);
    return null;
  }
  hideBanner();
  const data=await res.json(); const cand=data.candidates&&data.candidates[0];
  if(!cand){ const b=data.promptFeedback&&data.promptFeedback.blockReason; showBanner("SpeakEasy returned no answer"+(b?" (blocked: "+b+")":"")+". Try rephrasing.",true); return null; }
  const parts=cand.content&&cand.content.parts?cand.content.parts:[];
  return parts.map(p=>p.text||"").join("").trim()||"(empty response)";
}

async function speakeasyTurn(){
  if(busy) return; busy=true; setBusy(true); setStatus("thinking…");
  const text=await callGemini(); setStatus("");
  if(text){
    history.push({role:"model",text}); addMsg("speakeasy",text); speak(text);
    const sc=parseScores(text);
    if(sc){ recordProgress(sc); sessionLog.push({q:lastQuestionText,a:lastAnswer,debrief:text,m:lastMeasured}); $("drawer").classList.add("open"); switchTab("turn"); }
    lastQuestionText=text;
  }
  busy=false; setBusy(false);
}
function setBusy(b){ ["startBtn","micBtn","newBtn","retryBtn","sendBtn","typeInput"].forEach(id=>{$(id).disabled=b;}); if(!b) enableAfterStart(); }
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
  await sendUserTurn(transcript, transcript+"\n\n"+metricsToText(m));
}
$("micBtn").addEventListener("click",()=>{ recognizing?stopSpeaking():startSpeaking(); });

/* ── Buttons ── */
function enableAfterStart(){ if(!history.length) return; ["micBtn","newBtn","retryBtn","sendBtn","typeInput","reportBtn"].forEach(id=>{$(id).disabled=false;}); $("startBtn").disabled=true; }
$("startBtn").addEventListener("click",async()=>{ if(!cfg.apiKey){ showOnboard(true); return; } $("startBtn").disabled=true; sessionLog=[]; lastQuestionText=""; lastAnswer=""; history=[{role:"user",text:"[BEGIN SESSION]"+practiceContext()}]; await speakeasyTurn(); enableAfterStart(); });
$("newBtn").addEventListener("click",async()=>{ if(busy) return; await sendUserTurn("(new prompt, please)","Give me a new prompt/question to respond to."); });
$("retryBtn").addEventListener("click",async()=>{ if(busy) return; await sendUserTurn("(I'll retry the same one)","Let me retry the same prompt. Give me the same one again."); });
$("sendBtn").addEventListener("click",sendTyped);
$("typeInput").addEventListener("keydown",(e)=>{ if(e.key==="Enter") sendTyped(); });
async function sendTyped(){ const v=$("typeInput").value.trim(); if(!v||busy) return; $("typeInput").value=""; const m=computeMetrics(v,null); lastMeasured=m; renderMetrics(m); renderTranscript(null,m); await sendUserTurn(v, v+"\n\n"+metricsToText(m)); }

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
function showOnboard(s){ $("onboard").classList.toggle("show", !!s); }

/* ── Settings ── */
function applyCfg(){
  $("apiKey").value=cfg.apiKey; $("model").value=cfg.model; $("ttsOn").checked=cfg.tts; $("audioOn").checked=cfg.audio;
  $("whisperOn").checked=cfg.whisper; $("whisperModel").value=cfg.whisperModel; $("rememberKey").checked=cfg.rememberKey;
  $("roleInput").value=cfg.role; $("seniorityInput").value=cfg.seniority; $("jdInput").value=cfg.jd;
  $("goalFillers").value=cfg.goalFillers; $("paceMin").value=cfg.paceMin; $("paceMax").value=cfg.paceMax;
}
$("saveBtn").addEventListener("click",()=>{
  cfg.model=$("model").value; cfg.tts=$("ttsOn").checked; cfg.audio=$("audioOn").checked; cfg.voice=$("voiceSel").value;
  const prevWM=cfg.whisperModel; cfg.whisper=$("whisperOn").checked; cfg.whisperModel=$("whisperModel").value; if(cfg.whisperModel!==prevWM) asrPipe=null;
  storeKey($("apiKey").value.trim(), $("rememberKey").checked);
  localStorage.setItem("speakeasy_model",cfg.model);
  localStorage.setItem("speakeasy_tts",cfg.tts?"1":"0"); localStorage.setItem("speakeasy_audio",cfg.audio?"1":"0"); localStorage.setItem("speakeasy_voice",cfg.voice);
  localStorage.setItem("speakeasy_whisper",cfg.whisper?"1":"0"); localStorage.setItem("speakeasy_whisperModel",cfg.whisperModel);
  cfg.goalFillers=Math.max(0,+$("goalFillers").value||3); cfg.paceMin=+$("paceMin").value||110; cfg.paceMax=+$("paceMax").value||150;
  localStorage.setItem("speakeasy_goalFillers",cfg.goalFillers); localStorage.setItem("speakeasy_paceMin",cfg.paceMin); localStorage.setItem("speakeasy_paceMax",cfg.paceMax);
  setStatus("settings saved."); if(cfg.apiKey) hideBanner(); $("settingsModal").classList.remove("show");
});
$("testBtn").addEventListener("click",async()=>{ const el=$("testMsg"); el.className="testmsg"; el.textContent="testing..."; const r=await testKey($("apiKey").value.trim()); el.className="testmsg "+(r.ok?"ok":"bad"); el.textContent=r.msg; });
$("clearKey").addEventListener("click",(e)=>{ e.preventDefault(); clearKey(); $("apiKey").value=""; const el=$("testMsg"); el.className="testmsg"; el.textContent="Key cleared from this browser."; });
$("saveSetupBtn").addEventListener("click",()=>{
  cfg.role=$("roleInput").value.trim(); cfg.seniority=$("seniorityInput").value.trim(); cfg.jd=$("jdInput").value.trim();
  localStorage.setItem("speakeasy_role",cfg.role); localStorage.setItem("speakeasy_seniority",cfg.seniority); localStorage.setItem("speakeasy_jd",cfg.jd);
  setStatus("practice setup saved (applies on your next new session).");
});

/* ── Onboarding modal ── */
$("obTest").addEventListener("click",async()=>{ const el=$("obMsg"); el.className="testmsg"; el.textContent="testing..."; const r=await testKey($("obKey").value.trim()); el.className="testmsg "+(r.ok?"ok":"bad"); el.textContent=r.msg; });
$("obStart").addEventListener("click",()=>{ const key=$("obKey").value.trim(); if(!key){ const el=$("obMsg"); el.className="testmsg bad"; el.textContent="Paste your key first."; return; } storeKey(key, $("obRemember").checked); applyCfg(); showOnboard(false); hideBanner(); setStatus("ready"); });
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
$("drawerHandle").addEventListener("click",()=>$("drawer").classList.toggle("open"));
$("settingsBtn").addEventListener("click",()=>{ applyCfg(); $("settingsModal").classList.add("show"); });
$("settingsClose").addEventListener("click",()=>$("settingsModal").classList.remove("show"));
$("settingsModal").addEventListener("click",(e)=>{ if(e.target===$("settingsModal")) $("settingsModal").classList.remove("show"); });

/* ── Init ── */
initIcons(); applyCfg(); renderProgress(); initWave(); setStatus("");
if(!SR) showBanner("This tool needs <b>Google Chrome</b> (or Edge) on desktop for speech recognition.",true);
else if(!cfg.apiKey) showOnboard(true);
