'use strict';
/* =========================================================================
   OPERACIÓN TIFÓN — motor de juego
   Módulos: utilidades, guardado, UI (menú/briefing/resultado), motor de
   render, y cuatro modos de juego: cañonero, kamikaze, antiaéreo, mensajero.
   ========================================================================= */

/* ---------------------------- Utilidades -------------------------------- */
const rand = (a,b)=> a + Math.random()*(b-a);
const randi = (a,b)=> Math.floor(rand(a,b+1));
const clamp = (v,a,b)=> Math.max(a, Math.min(b,v));
const lerp = (a,b,t)=> a+(b-a)*t;
const dist = (x1,y1,x2,y2)=> Math.hypot(x2-x1,y2-y1);
const deg2rad = d => d*Math.PI/180;
const choice = arr => arr[Math.floor(Math.random()*arr.length)];

/* Beep sencillo vía WebAudio, sin dependencias externas */
let audioCtx = null;
let AUDIO_MUTED = false;
try{ AUDIO_MUTED = localStorage.getItem('operacion_tifon_muted')==='1'; }catch(e){}
function getAudioCtx(){
  if(!audioCtx) audioCtx = new (window.AudioContext||window.webkitAudioContext)();
  return audioCtx;
}
function beep(freq=440, dur=0.08, type='square', vol=0.06, delay=0){
  if(AUDIO_MUTED) return;
  try{
    const ac = getAudioCtx();
    const t0 = ac.currentTime + delay;
    const osc = ac.createOscillator();
    const gain = ac.createGain();
    osc.type = type; osc.frequency.setValueAtTime(freq, t0);
    gain.gain.setValueAtTime(vol, t0);
    gain.gain.exponentialRampToValueAtTime(0.0001, t0+dur);
    osc.connect(gain).connect(ac.destination);
    osc.start(t0); osc.stop(t0+dur+0.02);
  }catch(e){ /* audio no disponible, seguir sin sonido */ }
}
const SFX = {
  fire:()=>beep(180,0.09,'sawtooth',0.07),
  hit:()=>beep(520,0.07,'square',0.05),
  explosion:()=>{beep(90,0.28,'sawtooth',0.09); beep(60,0.35,'square',0.06,0.03);},
  miss:()=>beep(140,0.15,'triangle',0.04),
  detect:()=>{beep(880,0.12,'square',0.06); beep(660,0.12,'square',0.05,0.12);},
  select:()=>beep(720,0.05,'square',0.04),
  win:()=>{beep(520,0.1,'square',0.06); beep(660,0.1,'square',0.06,0.1); beep(880,0.18,'square',0.07,0.2);},
  lose:()=>{beep(220,0.2,'sawtooth',0.07); beep(140,0.3,'sawtooth',0.07,0.15);},
  drop:()=>beep(300,0.1,'triangle',0.05),
};

/* -------------------- Ambiente sonoro (viento/olas) ---------------------- */
/* Ruido sintetizado en vivo (sin archivos externos) filtrado en pasa-bajos
   y modulado suavemente en volumen para imitar el rumor constante del mar
   y el viento. Se detiene y se recrea limpio al empezar/salir de cada misión. */
let ambientNodes = null;
function startAmbient(){
  if(AUDIO_MUTED) return;
  stopAmbient();
  try{
    const ac = getAudioCtx();
    const bufferSize = ac.sampleRate * 2;
    const buffer = ac.createBuffer(1, bufferSize, ac.sampleRate);
    const data = buffer.getChannelData(0);
    for(let i=0;i<bufferSize;i++) data[i] = (Math.random()*2-1)*0.6;
    const noise = ac.createBufferSource();
    noise.buffer = buffer; noise.loop = true;
    const filter = ac.createBiquadFilter();
    filter.type='lowpass'; filter.frequency.value=420;
    const gain = ac.createGain();
    gain.gain.value = 0.05;
    noise.connect(filter).connect(gain).connect(ac.destination);
    noise.start();
    // oleaje: sube y baja el volumen del rumor lentamente, como respiración del mar
    const lfo = ac.createOscillator(); lfo.frequency.value = 0.11;
    const lfoGain = ac.createGain(); lfoGain.gain.value = 0.022;
    lfo.connect(lfoGain).connect(gain.gain);
    lfo.start();
    ambientNodes = { noise, filter, gain, lfo };
  }catch(e){ /* sin ambiente si el navegador no lo soporta */ }
}
function stopAmbient(){
  if(!ambientNodes) return;
  try{ ambientNodes.noise.stop(); ambientNodes.lfo.stop(); }catch(e){}
  ambientNodes = null;
}
function setMuted(m){
  AUDIO_MUTED = m;
  try{ localStorage.setItem('operacion_tifon_muted', m?'1':'0'); }catch(e){}
  if(m) stopAmbient();
}

/* --------------------- Locución de radio militar -------------------------- */
/* Usa el sintetizador de voz nativo del navegador (sin archivos de audio) para
   dar avisos breves en momentos clave: inicio de misión, daño crítico, resultado. */
function radioSay(text){
  if(AUDIO_MUTED) return;
  try{
    if(!window.speechSynthesis || !window.SpeechSynthesisUtterance) return;
    window.speechSynthesis.cancel();
    const u = new SpeechSynthesisUtterance(text);
    u.lang = 'es-ES'; u.rate = 1.05; u.pitch = 0.75; u.volume = 0.75;
    window.speechSynthesis.speak(u);
  }catch(e){ /* sin voz disponible, seguir sin locución */ }
}

/* --------------------- Motor de avión (tono según velocidad) -------------- */
/* No es un Doppler físico real (la "cámara" viaja con el avión), pero da la
   sensación de aceleración/desaceleración: el tono sube con la velocidad. */
let engineNode = null;
function startEngine(){
  if(AUDIO_MUTED) return;
  stopEngine();
  try{
    const ac = getAudioCtx();
    const osc = ac.createOscillator(); osc.type='sawtooth'; osc.frequency.value=85;
    const osc2 = ac.createOscillator(); osc2.type='square'; osc2.frequency.value=43;
    const filter = ac.createBiquadFilter(); filter.type='lowpass'; filter.frequency.value=420;
    const gain = ac.createGain(); gain.gain.value=0.022;
    osc.connect(filter); osc2.connect(filter); filter.connect(gain).connect(ac.destination);
    osc.start(); osc2.start();
    engineNode = { osc, osc2, gain, filter };
  }catch(e){ /* sin motor si el navegador no lo soporta */ }
}
function updateEngineFreq(speedFactor){
  if(!engineNode) return;
  try{
    const ac = getAudioCtx();
    const f = 78 + clamp(speedFactor,0,1)*95;
    engineNode.osc.frequency.setTargetAtTime(f, ac.currentTime, 0.09);
    engineNode.osc2.frequency.setTargetAtTime(f*0.5, ac.currentTime, 0.09);
  }catch(e){}
}
function stopEngine(){
  if(!engineNode) return;
  try{ engineNode.osc.stop(); engineNode.osc2.stop(); }catch(e){}
  engineNode = null;
}


/* ------------------------------ Guardado --------------------------------- */
const SAVE_KEY = 'operacion_tifon_save_v1';
const MODES = ['canonero','kamikaze','antiaereo','mensajero'];
const LEVELS_PER_MODE = 6;

const MODE_META = {
  canonero:  { title:'CAÑONERO NAVAL',  short:'Cañonero',  color:'--radar', icon:'canonero',
    desc:'Calcula ángulo, potencia y arma. Hunde a la flota enemiga sin ser detectado.' },
  kamikaze:  { title:'ESCUADRÓN KAMIKAZE', short:'Kamikaze', color:'--rust', icon:'kamikaze',
    desc:'Esquiva el fuego antiaéreo y estrella tu avión contra el objetivo señalado.' },
  antiaereo: { title:'FUEGO ANTIAÉREO', short:'Antiaéreo', color:'--amber', icon:'antiaereo',
    desc:'Defiende el portaaviones derribando a los aviones enemigos en cada oleada.' },
  mensajero: { title:'PILOTO MENSAJERO', short:'Mensajero', color:'--steel', icon:'mensajero',
    desc:'Vuela bajo y entrega los mensajes en zona amiga sin que caigan en manos enemigas.' },
};

/* ---------------------------- Modo Campaña -------------------------------- */
/* Narrativa ficticia que encadena los 4 roles en una sola historia: la
   Escuadra Fénix, en la Operación Tifón, Pacífico 1944 (nombres y lugares
   inventados). Cada capítulo usa el motor de un modo existente en un nivel
   concreto, con texto de misión antes y después. */
const CAMPAIGN = [
  { mode:'canonero', level:1, title:'Capítulo 1 — El amanecer de Tifón',
    brief:'Los radares costeros detectan siluetas en el horizonte al amanecer. La Escuadra Fénix necesita que la batería costera abra fuego antes de que la flota enemiga se acerque a la bahía.',
    debrief:'El primer contacto ha sido repelido. Pero los informes de inteligencia hablan de una flota mucho mayor moviéndose hacia el Atolón Vela...' },
  { mode:'antiaereo', level:1, title:'Capítulo 2 — Primera oleada',
    brief:'Como represalia, oleadas de cazas enemigos se dirigen hacia el portaaviones Fénix. Las baterías antiaéreas son la última línea de defensa.',
    debrief:'El cielo vuelve a estar despejado, por ahora. Pero los vigías han avistado algo peor asomando entre las nubes: aviones que no giran para volver a casa.' },
  { mode:'kamikaze', level:1, title:'Capítulo 3 — Represalia',
    brief:'Es momento de llevar la guerra a su origen. Un piloto de la Fénix debe abrirse paso entre el fuego enemigo y alcanzar su portaaviones.',
    debrief:'El golpe ha dejado a la flota enemiga tambaleándose. Pero la guerra de señales apenas comienza: hay órdenes urgentes que deben llegar a la costa antes del amanecer.' },
  { mode:'mensajero', level:1, title:'Capítulo 4 — Órdenes urgentes',
    brief:'Sin radio segura, solo queda un mensajero volando bajo, entregando órdenes en mano antes de que caigan en manos equivocadas.',
    debrief:'El mensaje llegó a tiempo. La Escuadra Fénix reagrupa fuerzas — pero la calma no durará: los informes hablan de una flota reconstituida acercándose al Estrecho de Tifón.' },
  { mode:'canonero', level:3, title:'Capítulo 5 — El Estrecho de Tifón',
    brief:'La flota enemiga, reforzada, intenta cruzar el estrecho bajo cobertura de niebla. La costa no puede permitirlo.',
    debrief:'El estrecho vuelve a ser terreno amigo. Pero en represalia, el cielo se llena de motores enemigos.' },
  { mode:'antiaereo', level:3, title:'Capítulo 6 — Cielos en llamas',
    brief:'La mayor oleada aérea de la campaña hasta ahora se dirige hacia la Fénix. Cada avión derribado es un minuto más de vida para la flota.',
    debrief:'El portaaviones resiste, maltrecho pero a flote. Es momento de devolver el golpe directamente a su origen.' },
  { mode:'kamikaze', level:3, title:'Capítulo 7 — Objetivo: portaaviones',
    brief:'Las defensas enemigas están en máxima alerta. Solo un piloto decidido puede atravesar la cortina de fuego y alcanzar el corazón de la flota.',
    debrief:'El impacto se sintió hasta la costa. La flota enemiga se retira, herida — pero antes de que termine todo, alguien debe advertir a los aliados de lo que viene.' },
  { mode:'mensajero', level:3, title:'Capítulo 8 — Comunicaciones vitales',
    brief:'Con las líneas de radio comprometidas, la única forma segura de coordinar el golpe final es un vuelo de entrega bajo fuego enemigo.',
    debrief:'El mensaje llega a la Escuadra Fénix: todo está listo para el asalto final al Atolón Vela.' },
  { mode:'canonero', level:5, title:'Capítulo 9 — El cerco se cierra',
    brief:'Lo que queda de la flota enemiga intenta romper el cerco antes de que sea demasiado tarde. No debe escapar ni un solo barco.',
    debrief:'El cerco se mantiene. Pero el enemigo, acorralado, lanza todo lo que le queda contra el cielo.' },
  { mode:'antiaereo', level:5, title:'Capítulo 10 — Última línea de defensa',
    brief:'Es el ataque aéreo más desesperado de la campaña. Si el portaaviones cae ahora, todo el esfuerzo se pierde.',
    debrief:'La Fénix resiste, apenas. El enemigo solo tiene una carta más por jugar — y es la más peligrosa de todas.' },
  { mode:'kamikaze', level:5, title:'Capítulo 11 — La ofensiva final',
    brief:'El enemigo lanza su ataque más desesperado. Un último piloto de la Fénix debe responder de la misma forma: sin margen de error.',
    debrief:'El golpe final ha caído. El Atolón Vela queda en silencio. Solo falta una cosa: que el mundo se entere de que aquí, la guerra ha terminado.' },
  { mode:'mensajero', level:6, title:'Capítulo 12 — El mensaje que termina la guerra',
    brief:'El vuelo más importante de la campaña: entregar la noticia de la victoria antes de que la desinformación enemiga se adelante.',
    debrief:'Operación Tifón ha concluido con éxito. La Escuadra Fénix regresa a casa. Gracias por comandar cada misión, piloto.' },
];

const ACHIEVEMENTS = [
  { id:'precision',  title:'Francotirador',        desc:'Completa un nivel de Cañonero sin fallar un solo disparo.',                 icon:'🎯' },
  { id:'intacto',     title:'As Intacto',            desc:'Completa un nivel de Kamikaze sin perder nada de integridad.',              icon:'✈️' },
  { id:'muralla',     title:'Muralla de Acero',      desc:'Completa un nivel de Antiaéreo sin que el portaaviones pierda vida.',       icon:'🛡️' },
  { id:'impecable',   title:'Correo Impecable',      desc:'Completa un nivel de Mensajero sin perder ninguna vida.',                   icon:'✉️' },
  { id:'comandante',  title:'Comandante Supremo',    desc:'Consigue 3 estrellas en los 24 niveles de los 4 modos.',                    icon:'🎖️' },
  { id:'veterano',    title:'Veterano del Pacífico', desc:'Completa al menos una vez los 24 niveles.',                                 icon:'🏅' },
];

function defaultSave(){
  const s = {};
  MODES.forEach(m=>{
    s[m] = { unlocked:1, stars:{}, best:{} };
  });
  s.achievements = {};
  s.campaign = { unlocked:1 };
  return s;
}
let SAVE = loadSave();
function loadSave(){
  try{
    const raw = localStorage.getItem(SAVE_KEY);
    if(!raw) return defaultSave();
    const parsed = JSON.parse(raw);
    const d = defaultSave();
    MODES.forEach(m=>{ if(parsed[m]) d[m] = Object.assign(d[m], parsed[m]); });
    if(parsed.achievements) d.achievements = Object.assign(d.achievements, parsed.achievements);
    if(parsed.campaign) d.campaign = Object.assign(d.campaign, parsed.campaign);
    return d;
  }catch(e){ return defaultSave(); }
}
function persistSave(){
  try{ localStorage.setItem(SAVE_KEY, JSON.stringify(SAVE)); }catch(e){}
}
function reportResult(mode, level, stars, score){
  const m = SAVE[mode];
  if(stars > (m.stars[level]||0)) m.stars[level] = stars;
  if(score > (m.best[level]||0)) m.best[level] = score;
  if(stars>0 && level >= m.unlocked && m.unlocked <= LEVELS_PER_MODE) m.unlocked = Math.min(LEVELS_PER_MODE, level+1);
  persistSave();
}
/* Devuelve true si el logro era nuevo (no lo tenía ya desbloqueado). */
function unlockAchievement(id){
  if(!SAVE.achievements) SAVE.achievements = {};
  if(SAVE.achievements[id]) return false;
  SAVE.achievements[id] = true;
  persistSave();
  return true;
}
/* Revisa los logros "de conjunto" (que dependen de todo el progreso, no de
   una sola misión) y añade los recién desbloqueados a la lista dada. */
function checkMetaAchievements(newlyUnlocked){
  let allThreeStars = true, allCompleted = true;
  MODES.forEach(m=>{
    for(let lv=1; lv<=LEVELS_PER_MODE; lv++){
      const s = SAVE[m].stars[lv] || 0;
      if(s<3) allThreeStars = false;
      if(s<1) allCompleted = false;
    }
  });
  if(allThreeStars && unlockAchievement('comandante')) newlyUnlocked.push('comandante');
  if(allCompleted && unlockAchievement('veterano')) newlyUnlocked.push('veterano');
}

/* --------------------------------- UI ------------------------------------ */
const $ = sel => document.querySelector(sel);
const screens = {
  menu: $('#screen-menu'),
  briefing: $('#screen-briefing'),
  campaign: $('#screen-campaign'),
  game: $('#screen-game'),
  result: $('#screen-result'),
};
function showScreen(name){
  Object.values(screens).forEach(s=>s.classList.add('hidden'));
  screens[name].classList.remove('hidden');
}

/* pequeños glifos SVG por modo, estilo trazo técnico (no marcas registradas) */
const ICONS = {
  canonero: `<svg viewBox="0 0 48 48" width="30" height="30"><circle cx="24" cy="24" r="20" fill="none" stroke="currentColor" stroke-width="1.5" opacity="0.5"/><line x1="24" y1="6" x2="24" y2="42" stroke="currentColor" stroke-width="1" opacity="0.35"/><line x1="6" y1="24" x2="42" y2="24" stroke="currentColor" stroke-width="1" opacity="0.35"/><circle cx="24" cy="24" r="3" fill="currentColor"/><path d="M24 24 L38 12" stroke="currentColor" stroke-width="2.5" stroke-linecap="round"/></svg>`,
  kamikaze: `<svg viewBox="0 0 48 48" width="30" height="30"><path d="M6 26 L24 22 L44 12 L38 24 L44 36 L24 26 L6 26 Z" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linejoin="round"/><circle cx="34" cy="18" r="6" fill="none" stroke="currentColor" stroke-width="1" opacity="0.4"/></svg>`,
  antiaereo: `<svg viewBox="0 0 48 48" width="30" height="30"><rect x="10" y="34" width="28" height="6" fill="none" stroke="currentColor" stroke-width="1.5"/><line x1="24" y1="34" x2="24" y2="20" stroke="currentColor" stroke-width="2"/><line x1="24" y1="20" x2="36" y2="8" stroke="currentColor" stroke-width="2.5" stroke-linecap="round"/><circle cx="36" cy="8" r="2" fill="currentColor"/></svg>`,
  mensajero: `<svg viewBox="0 0 48 48" width="30" height="30"><path d="M4 30 L24 10 L44 30 L24 24 Z" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linejoin="round"/><line x1="24" y1="24" x2="24" y2="40" stroke="currentColor" stroke-width="1.2" stroke-dasharray="2 2" opacity="0.6"/></svg>`,
};

function starRow(n, total=3){
  let out='';
  for(let i=1;i<=total;i++){
    out += `<span style="color:${i<=n?'var(--amber)':'var(--steel-dim)'}; font-size:15px;">★</span>`;
  }
  return out;
}

function renderMenu(){
  const totalStars = MODES.reduce((acc,m)=> acc + Object.values(SAVE[m].stars).reduce((a,b)=>a+b,0), 0);
  screens.menu.innerHTML = `
  <div style="flex:1; display:flex; flex-direction:column; align-items:center; justify-content:center; position:relative; padding:24px; gap:6px; overflow-y:auto;">
    <div class="label-eyebrow" style="margin-bottom:6px;">CUARTEL GENERAL — TEATRO DEL PACÍFICO, 1944</div>
    <h1 style="font-family:var(--font-display); font-weight:700; font-size:clamp(28px,5vw,52px); letter-spacing:0.04em; margin:0; color:var(--paper); text-transform:uppercase; text-shadow:0 0 30px rgba(57,224,122,0.15);">
      Operación <span style="color:var(--radar);">Tifón</span>
    </h1>
    <div style="font-family:var(--font-hud); font-size:12px; color:var(--paper-dim); letter-spacing:0.15em; margin-bottom:6px;">
      ESTRELLAS TOTALES: <span style="color:var(--amber);">${totalStars} / ${MODES.length*LEVELS_PER_MODE*3}</span>
    </div>

    <button id="btn-campaign" class="btn primary" style="padding:14px 32px; font-size:16px; margin-bottom:16px;">📖 MODO CAMPAÑA — Operación Tifón</button>

    <div class="label-eyebrow" style="margin-bottom:2px;">O ELIJA UNA MISIÓN SUELTA</div>
    <div id="radar-wrap" style="position:relative; width:min(50vh,380px); height:min(50vh,380px); border-radius:50%; border:1px solid var(--radar-dim); background:radial-gradient(circle, rgba(57,224,122,0.05), transparent 70%); margin:10px 0 22px;">
      <div style="position:absolute; inset:14%; border-radius:50%; border:1px solid var(--radar-dim); opacity:0.6;"></div>
      <div style="position:absolute; inset:32%; border-radius:50%; border:1px solid var(--radar-dim); opacity:0.5;"></div>
      <div style="position:absolute; inset:50%; border-radius:50%; border:1px solid var(--radar-dim); opacity:0.4;"></div>
      <div id="radar-sweep" style="position:absolute; inset:0; border-radius:50%; overflow:hidden; animation:sweep 4s linear infinite;">
        <div style="position:absolute; left:50%; top:50%; width:50%; height:2px; background:linear-gradient(90deg, var(--radar), transparent); transform-origin:left center;"></div>
        <div style="position:absolute; inset:0; background:conic-gradient(from 0deg, rgba(57,224,122,0.28), transparent 28%); border-radius:50%;"></div>
      </div>
      ${MODES.map((m,i)=>{
        const ang = [ -90, 0, 90, 180 ][i]; // N E S W
        const r = 42;
        const x = 50 + r*Math.cos(deg2rad(ang));
        const y = 50 + r*Math.sin(deg2rad(ang));
        const meta = MODE_META[m];
        const done = Object.values(SAVE[m].stars).reduce((a,b)=>a+b,0);
        return `<button class="mode-blip" data-mode="${m}" style="position:absolute; left:${x}%; top:${y}%; transform:translate(-50%,-50%); display:flex; flex-direction:column; align-items:center; gap:6px; background:transparent; border:none; padding:8px; z-index:5;">
          <span style="width:52px; height:52px; border-radius:50%; display:flex; align-items:center; justify-content:center; background:var(--navy-900); border:1.5px solid var(${meta.color}); color:var(${meta.color}); box-shadow:0 0 18px color-mix(in srgb, var(${meta.color}) 40%, transparent);">${ICONS[meta.icon]}</span>
          <span style="font-family:var(--font-display); font-size:12px; letter-spacing:0.08em; color:var(--paper); text-transform:uppercase; white-space:nowrap;">${meta.short}</span>
          <span style="font-family:var(--font-hud); font-size:10px; color:var(--amber);">${done}/${LEVELS_PER_MODE*3}★</span>
        </button>`;
      }).join('')}
      <div style="position:absolute; left:50%; top:50%; width:8px; height:8px; margin:-4px; border-radius:50%; background:var(--radar); box-shadow:0 0 12px var(--radar);"></div>
    </div>

    <div class="label-eyebrow" style="margin-bottom:2px;">CONDECORACIONES</div>
    <div style="display:flex; gap:16px; flex-wrap:wrap; justify-content:center; max-width:600px; margin-bottom:16px;">
      ${ACHIEVEMENTS.map(a=>{
        const unlocked = !!SAVE.achievements[a.id];
        return `<div title="${a.desc}" style="display:flex; flex-direction:column; align-items:center; gap:4px; width:76px; opacity:${unlocked?1:0.3};">
          <span style="font-size:22px; filter:${unlocked?'none':'grayscale(1)'};">${a.icon}</span>
          <span style="font-family:var(--font-hud); font-size:8px; text-align:center; letter-spacing:0.03em; color:${unlocked?'var(--amber)':'var(--paper-dim)'};">${a.title}</span>
        </div>`;
      }).join('')}
    </div>

    <div style="display:flex; gap:12px; flex-wrap:wrap; justify-content:center;">
      <button class="btn" id="btn-reset">REINICIAR PROGRESO</button>
    </div>
    <div style="position:absolute; bottom:14px; font-family:var(--font-hud); font-size:10px; color:var(--paper-dim); letter-spacing:0.1em;">TECLADO: FLECHAS / WASD · ESPACIO · P PARA PAUSA</div>
  </div>
  <style>
    @keyframes sweep{ from{transform:rotate(0deg);} to{transform:rotate(360deg);} }
    .mode-blip{ cursor:pointer; transition:transform .15s ease; }
    .mode-blip:hover{ transform:translate(-50%,-50%) scale(1.08); }
  </style>
  `;
  screens.menu.querySelectorAll('.mode-blip').forEach(btn=>{
    btn.addEventListener('click', ()=>{ SFX.select(); openBriefing(btn.dataset.mode); });
  });
  $('#btn-campaign').addEventListener('click', ()=>{ SFX.select(); renderCampaignHub(); showScreen('campaign'); });
  $('#btn-reset').addEventListener('click', ()=>{
    if(confirm('¿Borrar todo el progreso guardado?')){ SAVE = defaultSave(); persistSave(); renderMenu(); }
  });
}

let currentMode = null;
let currentLevel = 1;

function openBriefing(mode){
  currentMode = mode;
  const meta = MODE_META[mode];
  const save = SAVE[mode];
  screens.briefing.innerHTML = `
  <div style="flex:1; display:flex; flex-direction:column; padding:28px 34px; gap:16px; overflow:auto;">
    <div style="display:flex; align-items:center; gap:14px;">
      <button class="btn" id="btn-back">‹ VOLVER</button>
      <div class="hairline" style="flex:1;"></div>
    </div>
    <div style="display:flex; align-items:center; gap:16px;">
      <span style="width:56px; height:56px; border-radius:50%; display:flex; align-items:center; justify-content:center; background:var(--navy-800); border:1.5px solid var(${meta.color}); color:var(${meta.color});">${ICONS[meta.icon]}</span>
      <div>
        <div class="label-eyebrow">EXPEDIENTE DE MISIÓN</div>
        <h2 style="font-family:var(--font-display); text-transform:uppercase; margin:2px 0 4px; font-size:26px; letter-spacing:0.03em;">${meta.title}</h2>
        <div style="color:var(--paper-dim); font-size:14px; max-width:640px;">${meta.desc}</div>
      </div>
    </div>
    <div class="hairline"></div>
    <div class="label-eyebrow">SELECCIONE NIVEL</div>
    <div id="level-grid" style="display:grid; grid-template-columns:repeat(auto-fill, minmax(120px,1fr)); gap:12px; max-width:820px;">
      ${Array.from({length:LEVELS_PER_MODE},(_,i)=>i+1).map(lv=>{
        const locked = lv > save.unlocked;
        const stars = save.stars[lv]||0;
        const best = save.best[lv]||0;
        return `<button class="level-card" data-level="${lv}" ${locked?'disabled':''} style="background:var(--navy-800); border:1px solid ${locked?'var(--steel-dim)':'var(--steel)'}; padding:14px 10px; display:flex; flex-direction:column; align-items:center; gap:6px; color:var(--paper); opacity:${locked?0.4:1};">
          <div style="font-family:var(--font-display); font-size:22px;">${locked?'🔒':lv}</div>
          <div style="font-family:var(--font-hud); font-size:10px; letter-spacing:0.08em; color:var(--paper-dim);">${locked?'BLOQ.':'NIVEL '+lv}</div>
          ${!locked?`<div>${starRow(stars)}</div><div style="font-family:var(--font-hud); font-size:9px; color:var(--amber);">${best}</div>`:''}
        </button>`;
      }).join('')}
    </div>
    <div class="hairline"></div>
    <div id="instructions" style="font-family:var(--font-hud); font-size:12.5px; line-height:1.7; color:var(--paper-dim); max-width:760px; white-space:pre-line;"></div>
  </div>`;
  const instrText = {
    canonero: `CONTROLES — ↑/↓ ajusta el ÁNGULO · ←/→ ajusta la POTENCIA (o el CARRIL si usas torpedo)\n1 = MISIL   2 = TORPEDO   ESPACIO = DISPARAR\nEl misil traza una parábola: calcula ángulo y potencia para adelantarte al barco en movimiento. La mira punteada te muestra exactamente dónde caerá.\nHay VIENTO en cada nivel que desvía el misil en pleno vuelo (más cuanto más lejos dispares) — el torpedo, al ir bajo el agua, no le afecta.\nEl torpedo viaja recto por el carril seleccionado a la altura del barco.\nCada disparo fallido eleva el nivel de DETECCIÓN. Si llega al máximo, el enemigo contraataca.\nHunde los barcos requeridos antes de quedarte sin munición.`,
    kamikaze: `CONTROLES — FLECHAS / WASD mueve el avión en las 4 direcciones\nEsquiva el fuego antiaéreo (puntos rojos) de las escoltas Y del propio portaaviones, que dispara de forma constante.\nCuidado con los MISILES GUIADOS (más grandes, con estela): te persiguen girando hacia ti, no vuelan en línea recta. Rómpeles la puntería con giros bruscos.\nTu casco resiste varios impactos, marcados en la barra de integridad. Tu avión deja una estela de humo que se oscurece cuanto más dañado estás.\nColisiona con el retículo del portaaviones antes de quedarte sin casco o sin tiempo.`,
    antiaereo: `CONTROLES — FLECHAS / A·D mueve la torreta   ESPACIO / CLIC dispara\nDerriba a los aviones enemigos antes de que alcancen el portaaviones.\nLos aviones ya NO vuelan en línea recta: detectan tus disparos que se acercan y esquivan hacia un lado para evitarlos. Anticípate a su maniobra.\nCada avión que llega hasta el barco reduce su integridad. Protege el portaaviones durante todas las oleadas.`,
    mensajero: `CONTROLES — ↑/↓ controla la ALTITUD del avión   ESPACIO suelta el mensaje\nTu avión vuela SIEMPRE hacia adelante sin detenerse; solo controlas su altura y el momento de soltar.\nHay una ALTITUD MÍNIMA SEGURA (línea punteada): si vuelas por debajo de ella cerca de una patrulla enemiga, te dispararán misiles.\nCada mensaje cae en parábola según tu altitud y velocidad, y el VIENTO del nivel lo desvía mientras cae — compensa apuntando un poco antes o después según su dirección.\nBajar te da más precisión, pero te expone a los misiles — equilibra riesgo y puntería.\nSi el mensaje cae cerca de una patrulla, también es interceptado. Al llegar al borde derecho, el avión reinicia la pasada por la izquierda.\nEntrega todos los mensajes requeridos con la munición disponible.`,
  };
  $('#instructions').textContent = instrText[mode];
  $('#btn-back').addEventListener('click', ()=>{ SFX.select(); showScreen('menu'); renderMenu(); });
  screens.briefing.querySelectorAll('.level-card').forEach(btn=>{
    btn.addEventListener('click', ()=>{
      SFX.select();
      currentLevel = parseInt(btn.dataset.level,10);
      Engine.campaignChapter = null; // misión suelta: no forma parte de la Campaña
      startGame(mode, currentLevel);
    });
  });
  showScreen('briefing');
}

/* ------------------------------ Modo Campaña ------------------------------ */
function renderCampaignHub(){
  const unlockedUpTo = SAVE.campaign.unlocked;
  screens.campaign.innerHTML = `
  <div style="flex:1; display:flex; flex-direction:column; padding:26px 32px; gap:14px; overflow:auto;">
    <div style="display:flex; align-items:center; gap:14px;">
      <button class="btn" id="btn-campaign-back">‹ VOLVER</button>
      <div class="hairline" style="flex:1;"></div>
    </div>
    <div>
      <div class="label-eyebrow">MODO HISTORIA</div>
      <h2 style="font-family:var(--font-display); text-transform:uppercase; margin:2px 0 4px; font-size:26px; letter-spacing:0.03em; color:var(--radar);">Operación Tifón</h2>
      <div style="color:var(--paper-dim); font-size:13px; max-width:640px;">La Escuadra Fénix necesita cada rol para ganar la campaña: cañoneros, pilotos kamikaze, baterías antiaéreas y mensajeros. Los capítulos se juegan en orden.</div>
    </div>
    <div class="hairline"></div>
    <div style="display:flex; flex-direction:column; gap:10px; max-width:720px;">
      ${CAMPAIGN.map((ch,i)=>{
        const num = i+1;
        const locked = num > unlockedUpTo;
        const done = num < unlockedUpTo;
        const meta = MODE_META[ch.mode];
        return `<button class="chapter-card" data-idx="${i}" ${locked?'disabled':''} style="text-align:left; display:flex; align-items:center; gap:14px; background:var(--navy-800); border:1px solid ${locked?'var(--steel-dim)':'var(--steel)'}; padding:12px 16px; color:var(--paper); opacity:${locked?0.4:1};">
          <span style="width:38px; height:38px; flex:none; border-radius:50%; display:flex; align-items:center; justify-content:center; background:var(--navy-900); border:1.5px solid var(${meta.color}); color:var(${meta.color}); font-size:14px;">${ICONS[meta.icon]}</span>
          <span style="flex:1;">
            <div style="font-family:var(--font-display); font-size:14px; letter-spacing:0.02em;">${locked?'🔒 ':''}${ch.title}</div>
            <div style="font-family:var(--font-hud); font-size:10px; color:var(--paper-dim);">${meta.short} · NIVEL ${ch.level}</div>
          </span>
          ${done?`<span style="color:var(--radar); font-size:18px;">✓</span>`:''}
        </button>`;
      }).join('')}
    </div>
  </div>`;
  $('#btn-campaign-back').addEventListener('click', ()=>{ SFX.select(); showScreen('menu'); renderMenu(); });
  screens.campaign.querySelectorAll('.chapter-card').forEach(btn=>{
    btn.addEventListener('click', ()=>{ SFX.select(); openCampaignBriefing(parseInt(btn.dataset.idx,10)); });
  });
}

function openCampaignBriefing(idx){
  const ch = CAMPAIGN[idx];
  const meta = MODE_META[ch.mode];
  screens.campaign.innerHTML = `
  <div style="flex:1; display:flex; flex-direction:column; align-items:center; justify-content:center; gap:16px; padding:32px; text-align:center;">
    <div class="label-eyebrow">${meta.short.toUpperCase()} · NIVEL ${ch.level}</div>
    <h2 style="font-family:var(--font-display); text-transform:uppercase; font-size:28px; margin:0; max-width:600px; color:var(--radar);">${ch.title}</h2>
    <p style="font-family:var(--font-hud); font-size:13.5px; line-height:1.7; color:var(--paper-dim); max-width:560px;">${ch.brief}</p>
    <div style="display:flex; gap:12px; margin-top:10px;">
      <button class="btn" id="btn-chapter-back">‹ VOLVER A LA CAMPAÑA</button>
      <button class="btn primary" id="btn-chapter-start">COMENZAR MISIÓN</button>
    </div>
  </div>`;
  $('#btn-chapter-back').addEventListener('click', ()=>{ SFX.select(); renderCampaignHub(); });
  $('#btn-chapter-start').addEventListener('click', ()=>{ SFX.select(); startCampaignChapter(idx); });
  showScreen('campaign');
}

function startCampaignChapter(idx){
  Engine.campaignChapter = idx;
  const ch = CAMPAIGN[idx];
  startGame(ch.mode, ch.level);
}

function renderCampaignResult(idx, result){
  const ch = CAMPAIGN[idx];
  const meta = MODE_META[ch.mode];
  const isLast = idx === CAMPAIGN.length-1;
  screens.campaign.innerHTML = `
  <div style="flex:1; display:flex; flex-direction:column; align-items:center; justify-content:center; gap:14px; padding:28px; text-align:center;">
    <div class="label-eyebrow" style="color:${result.win?'var(--radar)':'var(--rust)'};">${result.win?'MISIÓN CUMPLIDA':'MISIÓN FALLIDA'}</div>
    <h2 style="font-family:var(--font-display); text-transform:uppercase; font-size:26px; margin:0; max-width:600px;">${ch.title}</h2>
    ${result.win?`<div style="font-size:22px;">${starRow(result.stars)}</div>`:''}
    <p style="font-family:var(--font-hud); font-size:13px; line-height:1.7; color:var(--paper-dim); max-width:560px;">
      ${result.win ? ch.debrief : 'La misión no salió como se esperaba. La Escuadra Fénix necesita que lo vuelvas a intentar antes de continuar la campaña.'}
    </p>
    ${result.win && isLast ? `<div style="margin-top:6px; padding:14px 22px; border:1px solid var(--amber); background:rgba(240,168,48,0.08);">
      <div class="label-eyebrow" style="color:var(--amber);">🏆 CAMPAÑA COMPLETADA</div>
    </div>` : ''}
    <div style="display:flex; gap:12px; margin-top:12px; flex-wrap:wrap; justify-content:center;">
      ${result.win
        ? (isLast
            ? `<button class="btn primary" id="btn-camp-menu">VOLVER AL MENÚ</button>`
            : `<button class="btn primary" id="btn-camp-next">CONTINUAR CAMPAÑA ›</button>`)
        : `<button class="btn primary" id="btn-camp-retry">REINTENTAR MISIÓN</button>`}
      <button class="btn" id="btn-camp-hub">MAPA DE CAPÍTULOS</button>
    </div>
  </div>`;
  const nextBtn = $('#btn-camp-next');
  if(nextBtn) nextBtn.addEventListener('click', ()=>{ SFX.select(); openCampaignBriefing(idx+1); });
  const retryBtn = $('#btn-camp-retry');
  if(retryBtn) retryBtn.addEventListener('click', ()=>{ SFX.select(); startCampaignChapter(idx); });
  const menuBtn = $('#btn-camp-menu');
  if(menuBtn) menuBtn.addEventListener('click', ()=>{ SFX.select(); showScreen('menu'); renderMenu(); });
  $('#btn-camp-hub').addEventListener('click', ()=>{ SFX.select(); renderCampaignHub(); });
  showScreen('campaign');
}
function renderResult({mode, level, win, stars, score, message, achievements}){
  const meta = MODE_META[mode];
  const hasNext = level < LEVELS_PER_MODE;
  const unlocked = (achievements||[]).map(id=> ACHIEVEMENTS.find(a=>a.id===id)).filter(Boolean);
  screens.result.innerHTML = `
  <div style="flex:1; display:flex; flex-direction:column; align-items:center; justify-content:center; gap:14px; padding:24px;">
    <div class="label-eyebrow" style="color:${win?'var(--radar)':'var(--rust)'};">${win?'MISIÓN CUMPLIDA':'MISIÓN FALLIDA'}</div>
    <h2 style="font-family:var(--font-display); text-transform:uppercase; font-size:34px; margin:0;">${meta.title} · NIVEL ${level}</h2>
    <div style="font-family:var(--font-hud); color:var(--paper-dim); max-width:560px; text-align:center;">${message}</div>
    ${win?`<div style="font-size:26px; margin-top:6px;">${starRow(stars)}</div>`:''}
    <div style="font-family:var(--font-hud); font-size:14px; color:var(--amber); margin-top:2px;">PUNTUACIÓN: ${score}</div>
    ${unlocked.length ? `<div style="margin-top:8px; padding:12px 20px; border:1px solid var(--amber); background:rgba(240,168,48,0.08); display:flex; flex-direction:column; gap:6px; align-items:center; animation:popin .35s ease;">
      <div class="label-eyebrow" style="color:var(--amber);">NUEVO RECONOCIMIENTO</div>
      ${unlocked.map(a=>`<div style="font-family:var(--font-display); font-size:15px; display:flex; gap:8px; align-items:center;"><span style="font-size:20px;">${a.icon}</span> ${a.title}</div>`).join('')}
    </div>` : ''}
    <div style="display:flex; gap:12px; margin-top:18px; flex-wrap:wrap; justify-content:center;">
      <button class="btn" id="btn-retry">REINTENTAR</button>
      ${win && hasNext ? '<button class="btn primary" id="btn-next">SIGUIENTE NIVEL</button>' : ''}
      <button class="btn" id="btn-menu">MAPA DE MISIONES</button>
    </div>
  </div>
  <style>@keyframes popin{from{transform:scale(0.85); opacity:0;} to{transform:scale(1); opacity:1;}}</style>`;
  $('#btn-retry').addEventListener('click', ()=>{ SFX.select(); startGame(mode, level); });
  $('#btn-menu').addEventListener('click', ()=>{ SFX.select(); showScreen('menu'); renderMenu(); });
  const nextBtn = $('#btn-next');
  if(nextBtn) nextBtn.addEventListener('click', ()=>{ SFX.select(); startGame(mode, level+1); });
  showScreen('result');
}

/* ------------------------------- Motor ------------------------------------ */
const canvas = $('#game-canvas');
const ctx = canvas.getContext('2d');
const hud = $('#hud');
const W = canvas.width, H = canvas.height;

const Input = { keys:{}, mouse:{x:W/2,y:H/2,down:false} };
window.addEventListener('keydown', e=>{
  Input.keys[e.code] = true;
  if(['ArrowUp','ArrowDown','ArrowLeft','ArrowRight','Space'].includes(e.code)) e.preventDefault();
  if((e.code === 'KeyP' || e.code === 'Escape') && Engine.running) togglePause();
  // mientras está en pausa, no dejamos que las teclas de juego (disparar, soltar, etc.) sigan actuando
  if(Engine.activeMode && Engine.activeMode.onKeyDown && Engine.running && !Engine.paused) Engine.activeMode.onKeyDown(e);
});
window.addEventListener('keyup', e=>{
  Input.keys[e.code] = false;
  if(Engine.activeMode && Engine.activeMode.onKeyUp) Engine.activeMode.onKeyUp(e);
});
function canvasPos(evt){
  const r = canvas.getBoundingClientRect();
  const cx = (evt.touches ? evt.touches[0].clientX : evt.clientX) - r.left;
  const cy = (evt.touches ? evt.touches[0].clientY : evt.clientY) - r.top;
  return { x: cx * (W / r.width), y: cy * (H / r.height) };
}
canvas.addEventListener('mousemove', e=>{ const p = canvasPos(e); Input.mouse.x=p.x; Input.mouse.y=p.y; });
canvas.addEventListener('mousedown', e=>{ Input.mouse.down=true; if(Engine.activeMode && Engine.activeMode.onClick) Engine.activeMode.onClick(Input.mouse); });
canvas.addEventListener('mouseup', ()=>{ Input.mouse.down=false; });
canvas.addEventListener('touchstart', e=>{ const p=canvasPos(e); Input.mouse.x=p.x; Input.mouse.y=p.y; Input.mouse.down=true; if(Engine.activeMode && Engine.activeMode.onClick) Engine.activeMode.onClick(Input.mouse); }, {passive:true});
canvas.addEventListener('touchmove', e=>{ const p=canvasPos(e); Input.mouse.x=p.x; Input.mouse.y=p.y; }, {passive:true});
canvas.addEventListener('touchend', ()=>{ Input.mouse.down=false; }, {passive:true});

const Engine = {
  running:false, paused:false, activeMode:null, lastT:0, mode:null, level:1,
  campaignChapter:null, // índice de capítulo si la partida actual es parte de la Campaña
};

const RADIO_START_LINES = {
  canonero: 'Cañonero listo. Localice y hunda a la flota enemiga.',
  kamikaze: 'Escuadrón kamikaze, despegue autorizado.',
  antiaereo: 'Baterías antiaéreas, defiendan el portaaviones.',
  mensajero: 'Piloto mensajero, entregue las órdenes con discreción.',
};
const ENGINE_MODES = ['kamikaze','mensajero'];
function startGame(mode, level){
  currentMode = mode; currentLevel = level;
  showScreen('game');
  $('#pause-overlay').classList.add('hidden');
  Engine.mode = mode; Engine.level = level; Engine.paused = false;
  const ModeClass = { canonero:CanoneroMode, kamikaze:KamikazeMode, antiaereo:AntiaereoMode, mensajero:MensajeroMode }[mode];
  Engine.activeMode = new ModeClass(level);
  Engine.activeMode.init();
  Engine.running = true;
  Engine.lastT = performance.now();
  setupToolbar();
  startAmbient();
  if(ENGINE_MODES.includes(mode)) startEngine();
  radioSay(RADIO_START_LINES[mode] || '');
  requestAnimationFrame(loop);
}
function endGame(result){
  Engine.running = false;
  stopEngine();
  const stars = result.stars||0;
  const newlyUnlocked = [];
  if(result.win){
    reportResult(currentMode, currentLevel, stars, result.score||0);
    if(result.achievementId && unlockAchievement(result.achievementId)) newlyUnlocked.push(result.achievementId);
  }
  checkMetaAchievements(newlyUnlocked);
  radioSay(result.win ? 'Misión cumplida.' : 'Misión fracasada.');

  // si esta misión formaba parte de la Campaña, mostramos el desenlace narrativo
  // en vez de la pantalla de resultado genérica, y desbloqueamos el siguiente capítulo
  if(Engine.campaignChapter != null){
    const chapterIdx = Engine.campaignChapter;
    if(result.win){
      const nextChapterNum = chapterIdx + 2; // capítulos son 1-indexados en el guardado
      if(nextChapterNum > SAVE.campaign.unlocked){
        SAVE.campaign.unlocked = Math.min(CAMPAIGN.length, nextChapterNum);
        persistSave();
      }
    }
    Engine.campaignChapter = null;
    renderCampaignResult(chapterIdx, { win:result.win, stars, score:result.score||0 });
    return;
  }
  renderResult({ mode:currentMode, level:currentLevel, win:result.win, stars, score:result.score||0, message:result.message||'', achievements:newlyUnlocked });
}
/* Barra de controles siempre visible durante la partida: pausar/reanudar, silenciar y salir.
   Se crea una sola vez y se reinicia visualmente al empezar cada misión. */
function setupToolbar(){
  const tb = $('#game-toolbar');
  tb.innerHTML = `
    <button id="tb-mute" class="btn" style="padding:6px 10px; font-size:12px;">${AUDIO_MUTED?'🔇':'🔊'}</button>
    <button id="tb-pause" class="btn" style="padding:6px 12px; font-size:12px;">⏸ PAUSA</button>
    <button id="tb-exit" class="btn danger" style="padding:6px 12px; font-size:12px;">✕ SALIR</button>
  `;
  $('#tb-mute').addEventListener('click', ()=>{
    setMuted(!AUDIO_MUTED);
    $('#tb-mute').textContent = AUDIO_MUTED?'🔇':'🔊';
    if(!AUDIO_MUTED && Engine.running){ startAmbient(); if(ENGINE_MODES.includes(currentMode)) startEngine(); }
  });
  $('#tb-pause').addEventListener('click', ()=>{ if(Engine.running) togglePause(); });
  $('#tb-exit').addEventListener('click', ()=> requestExit());
}
function exitToMenuNow(){
  Engine.running = false; Engine.paused = false; Engine.campaignChapter = null;
  stopAmbient(); stopEngine();
  $('#pause-overlay').classList.add('hidden');
  showScreen('menu'); renderMenu();
}
function requestExit(){
  if(!Engine.running && !Engine.paused) return;
  if(confirm('¿Salir de la misión actual? Se perderá el progreso de este intento.')) exitToMenuNow();
}
function togglePause(){
  Engine.paused = !Engine.paused;
  const ov = $('#pause-overlay');
  const tbBtn = $('#tb-pause');
  if(Engine.paused){
    if(tbBtn) tbBtn.textContent = '▶ REANUDAR';
    ov.classList.remove('hidden');
    ov.innerHTML = `<div style="font-family:var(--font-display); font-size:30px; letter-spacing:0.1em; color:var(--radar);">PAUSA</div>
      <div style="font-family:var(--font-hud); color:var(--paper-dim); font-size:12px;">Pulsa P, ESC, o el botón de abajo para continuar</div>
      <div style="display:flex; gap:12px;">
        <button class="btn primary" id="btn-resume">▶ REANUDAR</button>
        <button class="btn danger" id="btn-abort">✕ SALIR AL MENÚ</button>
      </div>`;
    $('#btn-resume').addEventListener('click', ()=> togglePause());
    $('#btn-abort').addEventListener('click', exitToMenuNow);
  } else {
    if(tbBtn) tbBtn.textContent = '⏸ PAUSA';
    ov.classList.add('hidden');
  }
}

function loop(t){
  if(!Engine.running) return;
  const dt = Math.min(0.05, (t - Engine.lastT)/1000);
  Engine.lastT = t;
  if(!Engine.paused){
    Engine.activeMode.update(dt);
    // aviso de radio por daños críticos (una sola vez por misión)
    if(Engine.running && typeof Engine.activeMode.getHealthFraction === 'function'){
      const hf = Engine.activeMode.getHealthFraction();
      if(hf!==null && hf<=0.34 && !Engine.activeMode._radioWarned){
        Engine.activeMode._radioWarned = true;
        radioSay('Alerta, daños críticos.');
      }
    }
    // tono de motor según la velocidad del avión, en los modos que vuelan
    if(Engine.running && typeof Engine.activeMode.getSpeedFraction === 'function'){
      updateEngineFreq(Engine.activeMode.getSpeedFraction());
    }
  }
  ctx.clearRect(0,0,W,H);
  Engine.activeMode.draw(ctx);
  requestAnimationFrame(loop);
}

/* ------------------------- Utilidades de dibujo --------------------------- */
/* Paletas de cielo/mar por momento del día — variedad visual determinista
   (nivel % 3) sin romper ninguna llamada existente: si no se pasa `phase`,
   las funciones se comportan exactamente igual que antes. */
const SKY_PALETTES = [
  { name:'DÍA',       skyTop:'#3c5770', skyBottom:'#8fa8b0', seaTop:'#123a52', seaBottom:'#04141e', celestial:'sun',  color:'#fbe9b0', glow:'rgba(251,233,176,0.30)' },
  { name:'ATARDECER', skyTop:'#3a2540', skyBottom:'#c96a3e', seaTop:'#5a2e2a', seaBottom:'#160f14', celestial:'sun',  color:'#ffab5e', glow:'rgba(255,150,70,0.38)' },
  { name:'NOCHE',     skyTop:'#040810', skyBottom:'#101c2a', seaTop:'#061826', seaBottom:'#020a12', celestial:'moon', color:'#d8e2ea', glow:'rgba(180,200,220,0.22)' },
];
function drawSky(ctx, topColor, botColor, h, phase){
  let top=topColor, bottom=botColor, pal=null;
  if(phase!=null){ pal = SKY_PALETTES[((phase%3)+3)%3]; top=pal.skyTop; bottom=pal.skyBottom; }
  const g = ctx.createLinearGradient(0,0,0,h);
  g.addColorStop(0, top); g.addColorStop(1, bottom);
  ctx.fillStyle = g; ctx.fillRect(0,0,W,h);
  if(pal){
    if(pal.celestial==='moon'){
      for(let i=0;i<26;i++){
        const sx=(i*137.5)%W, sy=(i*57)%(h*0.75)+6;
        ctx.globalAlpha = 0.3+((i*13)%40)/100;
        ctx.fillStyle='rgba(255,255,255,0.9)';
        ctx.fillRect(sx,sy,1.4,1.4);
      }
      ctx.globalAlpha=1;
    }
    const cx = W*0.82, cy = h*0.22, r = pal.celestial==='sun'?22:16;
    const glow = ctx.createRadialGradient(cx,cy,0,cx,cy,r*3.2);
    glow.addColorStop(0, pal.glow); glow.addColorStop(1,'rgba(0,0,0,0)');
    ctx.fillStyle=glow; ctx.beginPath(); ctx.arc(cx,cy,r*3.2,0,Math.PI*2); ctx.fill();
    ctx.fillStyle=pal.color; ctx.beginPath(); ctx.arc(cx,cy,r,0,Math.PI*2); ctx.fill();
  }
}
function drawSea(ctx, y0, y1, t, phase){
  let top='#0c3049', bottom='#031420';
  if(phase!=null){ const pal = SKY_PALETTES[((phase%3)+3)%3]; top=pal.seaTop; bottom=pal.seaBottom; }
  const g = ctx.createLinearGradient(0,y0,0,y1);
  g.addColorStop(0,top); g.addColorStop(1,bottom);
  ctx.fillStyle = g; ctx.fillRect(0,y0,W,y1-y0);
  ctx.strokeStyle = 'rgba(120,190,210,0.10)'; ctx.lineWidth=1;
  for(let i=0;i<14;i++){
    const yy = y0 + (i/14)*(y1-y0);
    const amp = 2 + (i/14)*3;
    ctx.beginPath();
    for(let x=0;x<=W;x+=20){
      const yy2 = yy + Math.sin((x*0.02) + t*1.4 + i)*amp;
      if(x===0) ctx.moveTo(x,yy2); else ctx.lineTo(x,yy2);
    }
    ctx.stroke();
  }
}
/* Buque de guerra visto de perfil (para cañonero y escoltas de kamikaze).
   Siempre se dibuja apoyado sobre su propia línea de flotación: el (x,y)
   que recibe ES la línea del agua, nunca "flota" por encima de ella. */
function drawShip(ctx, x, y, scale=1, hue='#7a8a94', dmg=0, rock=0){
  ctx.save(); ctx.translate(x,y); ctx.rotate(rock); ctx.scale(scale,scale);
  // estela / reflejo en el agua
  ctx.fillStyle='rgba(210,235,240,0.10)';
  ctx.beginPath(); ctx.ellipse(2,7,50,5,0,0,Math.PI*2); ctx.fill();
  // casco con degradado (más oscuro hacia la quilla)
  const hull = ctx.createLinearGradient(0,-4,0,15);
  hull.addColorStop(0, hue); hull.addColorStop(1,'rgba(10,14,18,0.55)');
  ctx.fillStyle = hull;
  ctx.beginPath();
  ctx.moveTo(-44,4);
  ctx.quadraticCurveTo(-49,11,-40,14);
  ctx.lineTo(42,14);
  ctx.quadraticCurveTo(49,10,44,2);
  ctx.lineTo(36,-2);
  ctx.lineTo(-32,-2);
  ctx.closePath();
  ctx.fill();
  // línea de cubierta
  ctx.strokeStyle='rgba(255,255,255,0.22)'; ctx.lineWidth=1;
  ctx.beginPath(); ctx.moveTo(-34,-2.5); ctx.lineTo(38,-2.5); ctx.stroke();
  // puente de mando
  ctx.fillStyle='#333f49';
  ctx.fillRect(-17,-19,24,17);
  ctx.fillStyle='#43525e';
  ctx.fillRect(-13,-27,13,9);
  ctx.strokeStyle='rgba(0,0,0,0.3)'; ctx.lineWidth=1;
  ctx.strokeRect(-17,-19,24,17);
  // mástil con antena
  ctx.strokeStyle='#232c34'; ctx.lineWidth=1.3;
  ctx.beginPath(); ctx.moveTo(-4,-27); ctx.lineTo(-4,-36); ctx.stroke();
  ctx.beginPath(); ctx.moveTo(-8,-32); ctx.lineTo(0,-32); ctx.stroke();
  // chimenea
  ctx.fillStyle='#2a343c';
  ctx.beginPath(); ctx.moveTo(9,-21); ctx.lineTo(16,-21); ctx.lineTo(15,-8); ctx.lineTo(10,-8); ctx.closePath(); ctx.fill();
  // pequeño cañón de cubierta a proa
  ctx.fillStyle='#232c34';
  ctx.fillRect(28,-6,7,4);
  // estela de espuma en la popa (da sensación de barco en movimiento)
  ctx.strokeStyle='rgba(220,240,245,0.28)'; ctx.lineWidth=1.6;
  ctx.beginPath();
  ctx.moveTo(-40,5); ctx.quadraticCurveTo(-62,10,-84,19);
  ctx.moveTo(-40,7); ctx.quadraticCurveTo(-60,3,-80,-4);
  ctx.stroke();
  if(dmg>0){ ctx.fillStyle=`rgba(255,90,50,${0.15+dmg*0.25})`; ctx.beginPath(); ctx.arc(0,-6,30,0,Math.PI*2); ctx.fill(); }
  ctx.restore();
}

/* Sombra proyectada de un avión sobre el mar/cubierta: se hace más grande y
   opaca cuanto más bajo vuela, y más pequeña y tenue cuanto más alto —
   ancla visualmente la sensación de altitud. */
function drawFlightShadow(ctx, x, groundY, heightAbove, maxHeight){
  const t = clamp(heightAbove/Math.max(1,maxHeight), 0, 1);
  const w = lerp(28, 9, t);
  const alpha = lerp(0.24, 0.04, t);
  ctx.fillStyle = `rgba(0,0,0,${alpha})`;
  ctx.beginPath(); ctx.ellipse(x, groundY, w, w*0.3, 0, 0, Math.PI*2); ctx.fill();
}

/* Resplandor cálido de una explosión reflejado sobre el agua, achatado como
   un reflejo real en la superficie (no un círculo perfecto). */
function drawWaterGlow(ctx, x, y, rx, alpha){
  const ry = rx*0.32;
  const g = ctx.createRadialGradient(x,y,0,x,y,rx);
  g.addColorStop(0, `rgba(255,205,130,${alpha})`);
  g.addColorStop(1, 'rgba(255,205,130,0)');
  ctx.fillStyle = g;
  ctx.beginPath(); ctx.ellipse(x,y,rx,ry,0,0,Math.PI*2); ctx.fill();
}

/* Fogonazo breve de disparo (cañón, torreta, batería antiaérea). */
function drawMuzzleFlash(ctx, x, y, p){
  const a = 1-p;
  ctx.fillStyle = `rgba(255,235,180,${a*0.9})`;
  ctx.beginPath(); ctx.arc(x,y,3+p*11,0,Math.PI*2); ctx.fill();
  ctx.strokeStyle = `rgba(255,225,150,${a*0.6})`; ctx.lineWidth=1.4;
  for(let i=0;i<4;i++){
    const a2 = (i/4)*Math.PI*2 + p*2;
    ctx.beginPath(); ctx.moveTo(x,y); ctx.lineTo(x+Math.cos(a2)*(6+p*10), y+Math.sin(a2)*(6+p*10)); ctx.stroke();
  }
}

/* Portaaviones visto de perfil (objetivo de Kamikaze) — cubierta de vuelo
   larga, isla lateral y un par de aviones estacionados para dar escala. */
function drawCarrierSide(ctx, x, y, scale=1, hue='#8a7a68', rock=0){
  ctx.save(); ctx.translate(x,y); ctx.rotate(rock); ctx.scale(scale,scale);
  ctx.fillStyle='rgba(210,235,240,0.08)';
  ctx.beginPath(); ctx.ellipse(4,28,112,7,0,0,Math.PI*2); ctx.fill();
  // casco
  const hull = ctx.createLinearGradient(0,4,0,26);
  hull.addColorStop(0,hue); hull.addColorStop(1,'rgba(10,14,18,0.55)');
  ctx.fillStyle = hull;
  ctx.beginPath();
  ctx.moveTo(-96,10); ctx.quadraticCurveTo(-104,20,-90,25);
  ctx.lineTo(92,25); ctx.quadraticCurveTo(106,17,98,7);
  ctx.lineTo(-88,7); ctx.closePath(); ctx.fill();
  // cubierta de vuelo
  ctx.fillStyle='#4c5762';
  ctx.beginPath();
  ctx.moveTo(-102,7); ctx.lineTo(100,7); ctx.lineTo(94,-4); ctx.lineTo(-98,-4); ctx.closePath();
  ctx.fill();
  ctx.strokeStyle='rgba(0,0,0,0.25)'; ctx.lineWidth=1;
  ctx.beginPath(); ctx.moveTo(-102,7); ctx.lineTo(100,7); ctx.stroke();
  // franja central de aterrizaje
  ctx.strokeStyle='rgba(240,200,90,0.65)'; ctx.lineWidth=1.6; ctx.setLineDash([7,6]);
  ctx.beginPath(); ctx.moveTo(-90,1); ctx.lineTo(84,1); ctx.stroke(); ctx.setLineDash([]);
  // isla de mando
  ctx.fillStyle='#37424c';
  ctx.fillRect(40,-28,17,28);
  ctx.fillStyle='#485561';
  ctx.fillRect(43,-37,11,10);
  ctx.strokeStyle='#232c34'; ctx.lineWidth=1.3;
  ctx.beginPath(); ctx.moveTo(48,-37); ctx.lineTo(48,-46); ctx.stroke();
  // aviones estacionados sobre cubierta
  drawPlane(ctx,-52,-8,0.05,0.55,'rgba(205,205,200,0.55)');
  drawPlane(ctx,-22,-8,-0.08,0.55,'rgba(205,205,200,0.55)');
  drawPlane(ctx,8,-8,0.1,0.55,'rgba(205,205,200,0.55)');
  // estela de espuma en la popa
  ctx.strokeStyle='rgba(220,240,245,0.24)'; ctx.lineWidth=2;
  ctx.beginPath();
  ctx.moveTo(-88,16); ctx.quadraticCurveTo(-130,26,-172,42);
  ctx.moveTo(-88,20); ctx.quadraticCurveTo(-126,14,-166,4);
  ctx.stroke();
  ctx.restore();
}

/* Portaaviones visto en planta desde arriba (base defendida en Antiaéreo),
   con disposición simétrica y ordenada: pista central con marcas de
   aparcamiento regulares y los aviones alineados en dos filas prolijas. */
function drawCarrierTop(ctx, x, y, w, hue='#5c6a72'){
  const h = w*0.32;
  ctx.save(); ctx.translate(x,y);
  ctx.fillStyle='rgba(210,235,240,0.08)';
  ctx.beginPath(); ctx.ellipse(0,h*0.9,w*0.54,7,0,0,Math.PI*2); ctx.fill();
  const hull = ctx.createLinearGradient(0,-h/2,0,h/2);
  hull.addColorStop(0,'#606e77'); hull.addColorStop(1,'#333f49');
  ctx.fillStyle = hull;
  ctx.beginPath();
  ctx.moveTo(-w/2+18,-h/2);
  ctx.quadraticCurveTo(-w/2-14,0,-w/2+18,h/2);
  ctx.lineTo(w/2-18,h/2);
  ctx.quadraticCurveTo(w/2+14,0,w/2-18,-h/2);
  ctx.closePath(); ctx.fill();
  ctx.strokeStyle='rgba(255,255,255,0.16)'; ctx.lineWidth=1.4; ctx.stroke();

  // pista central con marcas de aparcamiento regulares — aspecto ordenado
  ctx.strokeStyle='rgba(240,200,90,0.65)'; ctx.lineWidth=2;
  ctx.beginPath(); ctx.moveTo(-w/2+26,0); ctx.lineTo(w/2-26,0); ctx.stroke();
  ctx.strokeStyle='rgba(240,200,90,0.35)'; ctx.lineWidth=1.2;
  for(let i=-3;i<=3;i++){
    const xx = i*(w*0.11);
    ctx.beginPath(); ctx.moveTo(xx,-6); ctx.lineTo(xx,6); ctx.stroke();
  }

  // isla de mando, siempre al mismo costado (estribor)
  ctx.fillStyle='#2f3941';
  ctx.fillRect(w*0.30,-h/2-4,w*0.14,h+8);
  ctx.fillStyle='#414e59';
  ctx.fillRect(w*0.32,-h/2-10,w*0.10,7);
  ctx.strokeStyle='#1e262c'; ctx.lineWidth=1;
  ctx.strokeRect(w*0.30,-h/2-4,w*0.14,h+8);

  // aviones estacionados en dos filas perfectamente alineadas, lejos de la isla
  const rowY = h*0.30;
  const cols = [-w*0.36, -w*0.20, -w*0.04, w*0.12];
  cols.forEach(cx=>{
    drawPlane(ctx, cx, -rowY, 0, 0.55, 'rgba(222,222,216,0.6)');
    drawPlane(ctx, cx,  rowY, 0, 0.55, 'rgba(222,222,216,0.6)');
  });
  ctx.restore();
}

/* Avión de caza estilizado, silueta reconocible desde cualquier ángulo
   (fuselaje + alas en cruz + estabilizador + carlinga). El morro apunta
   siempre hacia +X local antes de rotar. */
function drawPlane(ctx, x, y, rot=0, scale=1, hue='#c8cfd6'){
  ctx.save(); ctx.translate(x,y); ctx.rotate(rot); ctx.scale(scale,scale);
  ctx.fillStyle = hue;
  // ala superior e inferior (en cruz respecto al fuselaje)
  ctx.beginPath();
  ctx.moveTo(2,-3); ctx.lineTo(-4,-19); ctx.lineTo(-10,-19); ctx.lineTo(-4,-2.2);
  ctx.closePath(); ctx.fill();
  ctx.beginPath();
  ctx.moveTo(2,3); ctx.lineTo(-4,19); ctx.lineTo(-10,19); ctx.lineTo(-4,2.2);
  ctx.closePath(); ctx.fill();
  // estabilizadores de cola
  ctx.beginPath();
  ctx.moveTo(-14,-1.6); ctx.lineTo(-19,-7); ctx.lineTo(-21,-7); ctx.lineTo(-16,-1.4);
  ctx.closePath(); ctx.fill();
  ctx.beginPath();
  ctx.moveTo(-14,1.6); ctx.lineTo(-19,7); ctx.lineTo(-21,7); ctx.lineTo(-16,1.4);
  ctx.closePath(); ctx.fill();
  // fuselaje principal
  ctx.beginPath();
  ctx.moveTo(20,0);
  ctx.quadraticCurveTo(11,-3.2, -5,-2.8);
  ctx.lineTo(-21,-1.7);
  ctx.lineTo(-21,1.7);
  ctx.lineTo(-5,2.8);
  ctx.quadraticCurveTo(11,3.2, 20,0);
  ctx.closePath(); ctx.fill();
  // línea de sombra dorsal (aleta vertical sugerida)
  ctx.strokeStyle='rgba(0,0,0,0.32)'; ctx.lineWidth=1.4;
  ctx.beginPath(); ctx.moveTo(-15,0); ctx.lineTo(-21,0); ctx.stroke();
  // carlinga
  ctx.fillStyle='rgba(120,195,225,0.9)';
  ctx.beginPath(); ctx.ellipse(7,0,4.2,1.7,0,0,Math.PI*2); ctx.fill();
  // punta de morro / hélice
  ctx.fillStyle='rgba(0,0,0,0.35)';
  ctx.beginPath(); ctx.arc(19,0,1.6,0,Math.PI*2); ctx.fill();
  ctx.restore();
}
function drawExplosion(ctx, x, y, p, size=1){
  // p: progreso 0..1
  const r = size*(10 + p*36);
  const g = ctx.createRadialGradient(x,y,0,x,y,r);
  g.addColorStop(0, `rgba(255,240,180,${1-p})`);
  g.addColorStop(0.4, `rgba(240,140,40,${(1-p)*0.9})`);
  g.addColorStop(1, `rgba(200,40,20,0)`);
  ctx.fillStyle = g;
  ctx.beginPath(); ctx.arc(x,y,r,0,Math.PI*2); ctx.fill();
}
function hudGauge(x,y,w,h,pct,color,bg='rgba(255,255,255,0.08)'){
  ctx.fillStyle = bg; ctx.fillRect(x,y,w,h);
  ctx.fillStyle = color; ctx.fillRect(x,y,w*clamp(pct,0,1),h);
  ctx.strokeStyle='rgba(255,255,255,0.25)'; ctx.lineWidth=1; ctx.strokeRect(x+0.5,y+0.5,w-1,h-1);
}
function hudText(txt,x,y,size=13,color='#e9e3d0',align='left'){
  ctx.font = `${size}px 'Share Tech Mono', monospace`;
  ctx.fillStyle = color; ctx.textAlign = align; ctx.textBaseline='top';
  ctx.fillText(txt,x,y);
}

/* ==========================================================================
   MODO 1 — CAÑONERO NAVAL
   ========================================================================== */
class CanoneroMode{
  constructor(level){ this.level = level; }
  init(){
    const n = this.level;
    this.cfg = {
      targetKills: 3 + n,
      maxShots: 9 + Math.ceil(n/2)*2,
      shipSpeedBase: 26 + n*5,
      spawnEvery: Math.max(1.9 - n*0.12, 0.85),
      detectionPenaltyMiss: 16 + n,
      detectionDecay: 7,
      counterDamage: 1,
    };
    // Carriles = distancia hacia el mar. Lejano (arriba, pequeño) a cercano (abajo, grande).
    this.lanes = [ {y:330, scale:0.55, name:'LEJANO'}, {y:410, scale:0.78, name:'MEDIO'}, {y:500, scale:1.05, name:'CERCANO'} ];
    this.gunX = 70; this.gunY = 560;
    this.angle = 35; this.power = 60; this.lane = 1; this.weapon = 'missile';
    this.ships = []; this.projectiles = []; this.particles = []; this.wrecks = [];
    this.spawnTimer = 0.6; this.fireCooldown = 0;
    this.kills = 0; this.shotsUsed = 0; this.detection = 0;
    this.lives = 3; this.t = 0; this.flashTimer = 0; this.message='';
    // viento del nivel: desvía el misil (no el torpedo, que va bajo el agua)
    this.wind = rand(-1,1) * (9 + this.level*3.5);
    this.phase = this.level % 3; // día / atardecer / noche, según el nivel
    this.ended = false;
  }
  spawnShip(){
    const lane = randi(0, this.lanes.length-1);
    const L = this.lanes[lane];
    this.ships.push({
      lane, x: W + 60, y: L.y, scale: L.scale,
      speed: this.cfg.shipSpeedBase * (0.7+lane*0.25),
      dir: -1, hp: 1, hue: choice(['#7a8a94','#8a7a6c','#6c8a7a']),
    });
  }
  /* El ÁNGULO decide el CARRIL (a qué distancia de la costa cae el disparo) y
     la POTENCIA decide qué tan lejos a lo largo de la costa llega (posición X),
     igual para el misil y para la mira de previsualización — así lo que ves
     antes de disparar es exactamente donde va a explotar. */
  aimedLane(){
    if(this.angle < 35) return 2;      // ángulo bajo, disparo raso -> carril cercano
    if(this.angle < 60) return 1;      // carril medio
    return 0;                          // ángulo alto, disparo largo -> carril lejano
  }
  aimedTargetX(){
    const base = this.gunX + lerp(150, 640, (this.power-25)/75);
    const flight = this.missileFlightTime(base);
    // el viento desvía el misil en vuelo, proporcional a cuánto tiempo pasa en el aire
    return clamp(base + this.wind*flight, this.gunX+60, W-10);
  }
  missileFlightTime(targetX){
    return clamp((targetX-this.gunX)/430, 0.5, 1.85);
  }
  onKeyDown(e){
    if(e.code==='Digit1'){ this.weapon='missile'; SFX.select(); }
    if(e.code==='Digit2'){ this.weapon='torpedo'; SFX.select(); }
    if(this.weapon==='torpedo'){
      if(e.code==='ArrowUp'){ this.lane = clamp(this.lane-1,0,2); SFX.select(); }
      if(e.code==='ArrowDown'){ this.lane = clamp(this.lane+1,0,2); SFX.select(); }
    }
    if(e.code==='Space'){ this.fire(); }
  }
  fire(){
    if(this.ended || this.fireCooldown>0 || this.shotsUsed>=this.cfg.maxShots) return;
    this.fireCooldown = 0.55; this.shotsUsed++;
    SFX.fire();
    // fogonazo en la boca del cañón, apuntando en la dirección actual
    const rad = deg2rad(this.angle);
    this.particles.push({ x:this.gunX+48*Math.cos(rad), y:this.gunY-48*Math.sin(rad), t:0, dur:0.09, flash:true });
    if(this.weapon==='missile'){
      const lane = this.aimedLane();
      const targetX = this.aimedTargetX();
      const flight = this.missileFlightTime(targetX);
      this.projectiles.push({ type:'missile', x0:this.gunX, y0:this.gunY, lane, targetX, flight, elapsed:0, hit:false });
    } else {
      const L = this.lanes[this.lane];
      const speed = 130 + this.power*3.2;
      this.projectiles.push({ type:'torpedo', x:this.gunX, y:L.y+10, lane:this.lane, speed });
    }
  }
  update(dt){
    if(this.ended) return;
    this.t += dt;
    this.fireCooldown = Math.max(0, this.fireCooldown-dt);
    this.detection = Math.max(0, this.detection - this.cfg.detectionDecay*dt);
    this.flashTimer = Math.max(0, this.flashTimer-dt);

    if(Input.keys['ArrowUp']) this.angle = clamp(this.angle + 55*dt, 5, 82);
    if(Input.keys['ArrowDown']) this.angle = clamp(this.angle - 55*dt, 5, 82);
    if(this.weapon==='missile'){
      if(Input.keys['ArrowRight']) this.power = clamp(this.power + 45*dt, 25, 100);
      if(Input.keys['ArrowLeft']) this.power = clamp(this.power - 45*dt, 25, 100);
    } else {
      if(Input.keys['ArrowRight']) this.power = clamp(this.power + 45*dt, 25, 100);
      if(Input.keys['ArrowLeft']) this.power = clamp(this.power - 45*dt, 25, 100);
    }

    // spawn barcos
    this.spawnTimer -= dt;
    if(this.spawnTimer<=0){ this.spawnShip(); this.spawnTimer = this.cfg.spawnEvery + rand(-0.2,0.3); }

    // mover barcos
    this.ships.forEach(s=>{ s.x -= s.speed*dt; });
    // barco que llega demasiado cerca sin ser hundido -> detectado
    this.ships = this.ships.filter(s=>{
      if(s.x < this.gunX + 40){ this.detection += 26; SFX.detect(); return false; }
      return true;
    });

    // proyectiles
    this.projectiles.forEach(p=>{
      if(p.type==='missile'){
        p.elapsed += dt;
        if(!p.hit && p.elapsed>=p.flight){
          p.hit = true;
          const laneY = this.lanes[p.lane].y;
          const hitShip = this.ships.find(s=> s.lane===p.lane && Math.abs(s.x-p.targetX) < 34*s.scale+14);
          if(hitShip){ this.destroyShip(hitShip); }
          else { this.detection += this.cfg.detectionPenaltyMiss; SFX.miss(); this.particles.push({x:p.targetX,y:laneY,t:0,dur:0.4,splash:true}); }
        }
      } else {
        p.x += p.speed*dt;
        const laneY = this.lanes[p.lane].y;
        const hitShip = this.ships.find(s=> s.lane===p.lane && Math.abs(s.x-p.x)<30*s.scale);
        if(hitShip){ this.destroyShip(hitShip); p.dead=true; }
        else if(p.x > W+20){ p.dead=true; this.detection += this.cfg.detectionPenaltyMiss; SFX.miss(); }
      }
    });
    this.projectiles = this.projectiles.filter(p=> !p.dead && !(p.hit));

    this.particles.forEach(pt=> pt.t += dt);
    this.particles = this.particles.filter(pt=> pt.t < pt.dur);

    // hundimiento progresivo: los barcos hundidos siguen ardiendo y bajando
    // durante un par de segundos antes de desaparecer del todo
    this.wrecks.forEach(w=>{
      w.t += dt;
      w.smokeT -= dt;
      if(w.smokeT<=0){
        w.smokeT = 0.11;
        this.particles.push({x:w.x+rand(-10,10), y:w.y-14-w.t*14, t:0, dur:1.0, smoke:true});
      }
    });
    this.wrecks = this.wrecks.filter(w=> w.t < w.dur);

    if(this.detection >= 100){
      this.detection = 45; this.lives -= this.cfg.counterDamage; this.flashTimer = 0.4;
      SFX.detect();
      if(this.lives<=0){ this.finish(false, 'La flota enemiga te localizó y respondió al fuego. Sin más recursos, la misión fracasa.'); return; }
    }
    if(this.kills >= this.cfg.targetKills){ this.finish(true); return; }
    if(this.shotsUsed >= this.cfg.maxShots && this.projectiles.length===0){
      this.finish(false, 'Te quedaste sin munición antes de completar los hundimientos requeridos.');
    }
  }
  destroyShip(ship){
    ship.dead = true; this.kills++; SFX.explosion();
    this.particles.push({x:ship.x, y:ship.y-6, t:0, dur:0.6, boom:true});
    this.ships = this.ships.filter(s=>s!==ship);
    // el casco queda ardiendo y hundiéndose progresivamente en vez de desaparecer al instante
    this.wrecks.push({ x:ship.x, y:ship.y, scale:ship.scale, hue:ship.hue, t:0, dur:2.4, smokeT:0.1 });
  }
  finish(win, msg){
    if(this.ended) return; this.ended = true;
    if(win) SFX.win(); else SFX.lose();
    const accuracy = this.kills / Math.max(1,this.shotsUsed);
    let stars = 1;
    if(win){
      if(accuracy>0.75 && this.lives===3) stars=3;
      else if(accuracy>0.5 || this.lives>=2) stars=2;
    }
    const score = this.kills*250 + Math.round(accuracy*300) + this.lives*100;
    const achievementId = (win && this.shotsUsed>0 && this.kills===this.shotsUsed) ? 'precision' : null;
    endGame({ win, stars, score, achievementId, message: msg || `Flota enemiga neutralizada: ${this.kills} bajas. Precisión ${(accuracy*100).toFixed(0)}%.` });
  }
  draw(ctx){
    drawSky(ctx,'#0a1d2e','#123049', 300, this.phase);
    drawSea(ctx, 300, H, this.t, this.phase);
    // horizonte
    ctx.strokeStyle='rgba(255,255,255,0.08)'; ctx.beginPath(); ctx.moveTo(0,300); ctx.lineTo(W,300); ctx.stroke();
    // líneas guía de los tres carriles, para que se entienda el "mapa" de distancias
    this.lanes.forEach((L,i)=>{
      ctx.strokeStyle = i===((this.weapon==='missile')?this.aimedLane():this.lane) ? 'rgba(57,224,122,0.28)' : 'rgba(255,255,255,0.05)';
      ctx.setLineDash([4,6]);
      ctx.beginPath(); ctx.moveTo(0,L.y+ L.scale*14); ctx.lineTo(W,L.y+L.scale*14); ctx.stroke();
      ctx.setLineDash([]);
    });

    // restos hundiéndose: se inclinan, se hunden y arden antes de desaparecer del todo
    this.wrecks.forEach(w=>{
      const p = w.t/w.dur;
      ctx.save();
      ctx.globalAlpha = 1-p;
      ctx.translate(w.x, w.y + lerp(0,26,p));
      ctx.rotate(lerp(0,0.55,Math.min(p*2,1)));
      drawShip(ctx, 0,0, w.scale, w.hue, 0.75);
      ctx.restore();
    });
    this.ships.forEach(s=> drawShip(ctx, s.x, s.y, s.scale, s.hue, 0, Math.sin(this.t*1.5+s.x*0.03)*0.028));
    this.particles.forEach(pt=>{
      const p = pt.t/pt.dur;
      if(pt.boom){ drawWaterGlow(ctx, pt.x, pt.y+16, 46*(1-p), (1-p)*0.5); drawExplosion(ctx, pt.x, pt.y, p, 1.1); }
      if(pt.splash){ ctx.strokeStyle=`rgba(200,230,240,${1-p})`; ctx.lineWidth=2; ctx.beginPath(); ctx.arc(pt.x,pt.y,10+p*22,0,Math.PI*2); ctx.stroke(); }
      if(pt.smoke){ ctx.fillStyle=`rgba(35,35,35,${(1-p)*0.5})`; ctx.beginPath(); ctx.arc(pt.x,pt.y,4+p*14,0,Math.PI*2); ctx.fill(); }
      if(pt.flash) drawMuzzleFlash(ctx, pt.x, pt.y, p);
    });

    // cañón
    ctx.save(); ctx.translate(this.gunX,this.gunY);
    ctx.fillStyle='#2a3138'; ctx.beginPath(); ctx.arc(0,0,20,Math.PI,0); ctx.fill();
    ctx.save(); ctx.rotate(-deg2rad(this.angle));
    ctx.fillStyle='#4a5560'; ctx.fillRect(0,-4,48,8);
    ctx.restore(); ctx.restore();

    // ---- MIRA EN VIVO: exactamente dónde caerá el próximo disparo ----
    if(!this.ended && this.fireCooldown<=0){
      let previewLane, previewX;
      if(this.weapon==='missile'){ previewLane = this.aimedLane(); previewX = this.aimedTargetX(); }
      else { previewLane = this.lane; previewX = W-10; }
      const laneY = this.lanes[previewLane].y;
      ctx.strokeStyle='rgba(240,208,128,0.55)'; ctx.lineWidth=1.4; ctx.setLineDash([5,5]);
      ctx.beginPath();
      if(this.weapon==='missile'){
        // arco punteado de previsualización, igual a la trayectoria real
        ctx.moveTo(this.gunX,this.gunY);
        for(let f=0; f<=1; f+=0.08){
          const x = lerp(this.gunX, previewX, f);
          const straightY = lerp(this.gunY, laneY, f);
          const y = straightY - Math.sin(f*Math.PI)*90;
          ctx.lineTo(x,y);
        }
      } else {
        ctx.moveTo(this.gunX, laneY+10); ctx.lineTo(previewX, laneY+10);
      }
      ctx.stroke(); ctx.setLineDash([]);
      const pulse = 8 + Math.sin(this.t*6)*3;
      ctx.strokeStyle='#f0d080'; ctx.lineWidth=2;
      ctx.beginPath(); ctx.arc(previewX, laneY, pulse, 0, Math.PI*2); ctx.stroke();
      ctx.beginPath(); ctx.moveTo(previewX-12,laneY); ctx.lineTo(previewX+12,laneY); ctx.moveTo(previewX,laneY-12); ctx.lineTo(previewX,laneY+12); ctx.stroke();
    }

    // trayectoria de misiles/torpedos en vuelo
    this.projectiles.forEach(p=>{
      if(p.type==='missile' && !p.hit){
        const laneY = this.lanes[p.lane].y;
        const frac = clamp(p.elapsed/p.flight,0,1);
        const x = lerp(p.x0, p.targetX, frac);
        const straightY = lerp(p.y0, laneY, frac);
        const y = straightY - Math.sin(frac*Math.PI)*90;
        ctx.fillStyle='#f0d080'; ctx.beginPath(); ctx.arc(x,y,4,0,Math.PI*2); ctx.fill();
        ctx.strokeStyle='rgba(240,208,128,0.35)'; ctx.lineWidth=2;
        ctx.beginPath();
        for(let f=0; f<=frac; f+=0.1){
          const xx = lerp(p.x0,p.targetX,f);
          const yy = lerp(p.y0,laneY,f) - Math.sin(f*Math.PI)*90;
          if(f===0) ctx.moveTo(xx,yy); else ctx.lineTo(xx,yy);
        }
        ctx.stroke();
      } else if(p.type==='torpedo'){
        ctx.fillStyle='#7fd7e0'; ctx.beginPath(); ctx.ellipse(p.x, this.lanes[p.lane].y+10, 8,3,0,0,Math.PI*2); ctx.fill();
      }
    });

    if(this.flashTimer>0){ ctx.fillStyle=`rgba(200,40,20,${this.flashTimer*0.5})`; ctx.fillRect(0,0,W,H); }

    // ---- HUD ----
    hudText('CAÑONERO NAVAL', 16, 12, 14, '#39e07a');
    hudText(`NIVEL ${this.level} · ${SKY_PALETTES[this.phase].name}`, 16, 30, 11, '#9c9782');
    hudText(`HUNDIDOS ${this.kills}/${this.cfg.targetKills}`, W-16, 12, 13, '#e9e3d0', 'right');
    hudText(`MUNICIÓN ${this.cfg.maxShots-this.shotsUsed}`, W-16, 30, 12, '#e9e3d0', 'right');
    hudText(`VIENTO ${this.wind>=0?'→':'←'} ${Math.abs(this.wind).toFixed(0)} (afecta al misil)`, W-16, 48, 10, '#7fd7e0', 'right');
    for(let i=0;i<3;i++){ ctx.fillStyle = i<this.lives ? '#39e07a' : 'rgba(255,255,255,0.15)'; ctx.beginPath(); ctx.arc(W-16-i*18,68,5,0,Math.PI*2); ctx.fill(); }

    hudText('DETECCIÓN', 16, H-58, 11, '#f0a830');
    hudGauge(16, H-42, 200, 12, this.detection/100, this.detection>70?'#d1462f':'#f0a830');

    hudText(`ARMA: ${this.weapon==='missile'?'MISIL (1)':'TORPEDO (2)'}`, 16, H-112, 12, '#e9e3d0');
    if(this.weapon==='missile'){
      hudText(`ÁNGULO ${this.angle.toFixed(0)}° → CARRIL ${this.lanes[this.aimedLane()].name}`, 16, H-94, 11, '#f0d080');
      hudText(`POTENCIA ${this.power.toFixed(0)} → ALCANCE X`, 16, H-78, 11, '#9c9782');
    } else {
      hudText(`CARRIL SELECCIONADO: ${this.lanes[this.lane].name} (↑/↓)`, 16, H-94, 11, '#7fd7e0');
      hudText(`VELOCIDAD ${this.power.toFixed(0)} (←/→)`, 16, H-78, 11, '#9c9782');
    }

    hudText('↑↓ ÁNGULO/CARRIL · ←→ POTENCIA · 1/2 ARMA · ESPACIO DISPARAR · MIRA PUNTEADA = DÓNDE CAERÁ', W/2, H-16, 10, '#6a7580', 'center');
  }
  getHealthFraction(){ return this.lives/3; }
  onKeyUp(){}
}

/* ==========================================================================
   MODO 2 — ESCUADRÓN KAMIKAZE
   ========================================================================== */
class KamikazeMode{
  constructor(level){ this.level = level; }
  init(){
    const n = this.level;
    this.seaY = H*0.66; // línea del mar: nada se dibuja "flotando" por encima de ella
    this.cfg = {
      hp: 3,
      timeLimit: 36 + n*2,
      flakSources: 2 + Math.min(n, 4),
      flakInterval: Math.max(1.15 - n*0.08, 0.5),
      flakSpeed: 155 + n*15,
      targetX: W-130, targetY: this.seaY - 24,
      targetR: 36,
      carrierFlakInterval: Math.max(0.85 - n*0.05, 0.4), // el portaaviones dispara SIEMPRE, de forma constante
      missileInterval: Math.max(3.6 - n*0.32, 1.7),      // cada cuánto se lanza un misil guiado
      missileSpeed: 120 + n*8,
      missileTurnRate: 1.6 + n*0.14, // qué tan rápido "gira" el misil para perseguir (radianes/seg)
      missileLife: 6.5,
    };
    this.plane = { x:90, y:this.seaY-120, vx:0, vy:0 };
    this.hp = this.cfg.hp;
    this.timeLeft = this.cfg.timeLimit;
    this.flak = []; this.missiles = []; this.particles = []; this.smoke = [];
    // las escoltas patrullan sobre el mar (línea de flotación = seaY), nunca "flotan" en el cielo
    this.escorts = Array.from({length:this.cfg.flakSources}, (_,i)=>{
      const baseX = W-300 - i*90 + rand(-20,20);
      return {
        x: baseX, y: this.seaY + rand(-5,5), baseY: this.seaY,
        driftMin: baseX-55, driftMax: baseX+55, driftDir: choice([-1,1]),
        driftSpeed: rand(16,28), cool: rand(0,1),
      };
    });
    // el portaaviones también dispara: es un defensor más, pero fijo y constante
    this.carrierCool = 0.6;
    this.missileCool = this.cfg.missileInterval * 0.5;
    this.phase = this.level % 3; // día / atardecer / noche
    this.smokeTimer = 0;
    this.t = 0; this.ended = false; this.shake = 0; this.hitFlash=0;
  }
  onKeyDown(){}
  onKeyUp(){}
  spawnFlakFrom(gunX, gunY, speed){
    const leadT = dist(gunX,gunY,this.plane.x,this.plane.y)/speed;
    const predX = clamp(this.plane.x + this.plane.vx*leadT*0.6, 20, W-20);
    const predY = clamp(this.plane.y + this.plane.vy*leadT*0.6, 20, this.seaY-10);
    const ang = Math.atan2(predY-gunY, predX-gunX) + rand(-0.09,0.09);
    this.flak.push({ x:gunX, y:gunY, vx:Math.cos(ang)*speed, vy:Math.sin(ang)*speed, life:2.2 });
    this.particles.push({ x:gunX, y:gunY, t:0, dur:0.07, flash:true });
  }
  update(dt){
    if(this.ended) return;
    this.t += dt; this.timeLeft -= dt;
    this.shake = Math.max(0,this.shake-dt*3); this.hitFlash = Math.max(0,this.hitFlash-dt*3);

    const accel = 420;
    let ax=0, ay=0;
    if(Input.keys['ArrowUp']||Input.keys['KeyW']) ay -= accel;
    if(Input.keys['ArrowDown']||Input.keys['KeyS']) ay += accel;
    if(Input.keys['ArrowLeft']||Input.keys['KeyA']) ax -= accel;
    if(Input.keys['ArrowRight']||Input.keys['KeyD']) ax += accel;
    this.plane.vx = clamp(this.plane.vx + ax*dt, -220,220) * 0.9;
    this.plane.vy = clamp(this.plane.vy + ay*dt, -220,220) * 0.9;
    this.plane.x = clamp(this.plane.x + this.plane.vx*dt, 24, W-24);
    // el avión nunca puede hundirse en el mar: techo de vuelo = justo sobre la línea del agua
    this.plane.y = clamp(this.plane.y + this.plane.vy*dt, 50, this.seaY-14);

    // estela de humo del motor, constante; se oscurece si el avión está dañado
    this.smokeTimer -= dt;
    if(this.smokeTimer<=0){
      this.smokeTimer = 0.045;
      const dmg = 1 - this.hp/this.cfg.hp;
      const back = -18 - (this.plane.vx*0.02);
      this.smoke.push({
        x: this.plane.x + back, y: this.plane.y + rand(-2,2),
        t:0, dur: 0.7+dmg*0.5, r: 3+rand(0,2), dmg,
      });
    }
    this.smoke.forEach(s=>{ s.t+=dt; s.x -= 14*dt; s.y -= 6*dt; });
    this.smoke = this.smoke.filter(s=> s.t<s.dur);

    // las naves de escolta patrullan de un lado a otro sobre el mar
    this.escorts.forEach(es=>{
      es.x += es.driftDir*es.driftSpeed*dt;
      if(es.x<es.driftMin||es.x>es.driftMax) es.driftDir*=-1;
      es.y = es.baseY + Math.sin(this.t*1.3+es.x*0.05)*3;
    });

    // fuego antiaéreo desde las escoltas, con predicción simple
    this.escorts.forEach(es=>{
      es.cool -= dt;
      if(es.cool<=0){
        es.cool = this.cfg.flakInterval + rand(-0.15,0.25);
        this.spawnFlakFrom(es.x, es.y-16, this.cfg.flakSpeed);
      }
    });
    // el portaaviones defiende constantemente desde su isla de mando
    this.carrierCool -= dt;
    if(this.carrierCool<=0){
      this.carrierCool = this.cfg.carrierFlakInterval + rand(-0.08,0.12);
      this.spawnFlakFrom(this.cfg.targetX+30, this.cfg.targetY-24, this.cfg.flakSpeed*1.05);
    }
    this.flak.forEach(f=>{ f.x += f.vx*dt; f.y += f.vy*dt; f.life -= dt; });
    this.flak = this.flak.filter(f=> f.life>0 && f.x>-20 && f.x<W+20 && f.y>-20 && f.y<H+20);

    // misiles guiados: persiguen al avión con un giro limitado, más difíciles de esquivar en línea recta
    this.missileCool -= dt;
    if(this.missileCool<=0){
      this.missileCool = this.cfg.missileInterval + rand(-0.3,0.3);
      const src = choice(this.escorts.length ? [...this.escorts, {x:this.cfg.targetX+30,y:this.cfg.targetY-24}] : [{x:this.cfg.targetX+30,y:this.cfg.targetY-24}]);
      const ang0 = Math.atan2(this.plane.y-(src.y-14), this.plane.x-src.x);
      this.missiles.push({ x:src.x, y:src.y-14, ang:ang0, life:this.cfg.missileLife, smokeT:0 });
    }
    this.missiles.forEach(m=>{
      const desiredAng = Math.atan2(this.plane.y-m.y, this.plane.x-m.x);
      let diff = desiredAng - m.ang;
      while(diff>Math.PI) diff -= Math.PI*2;
      while(diff<-Math.PI) diff += Math.PI*2;
      const maxTurn = this.cfg.missileTurnRate*dt;
      m.ang += clamp(diff, -maxTurn, maxTurn);
      m.x += Math.cos(m.ang)*this.cfg.missileSpeed*dt;
      m.y += Math.sin(m.ang)*this.cfg.missileSpeed*dt;
      m.life -= dt;
      m.smokeT -= dt;
      if(m.smokeT<=0){ m.smokeT=0.05; this.smoke.push({x:m.x,y:m.y,t:0,dur:0.4,r:2.2,dmg:0,white:true}); }
    });
    this.missiles = this.missiles.filter(m=> m.life>0 && m.x>-30&&m.x<W+30&&m.y>-30&&m.y<H+30);

    // colisiones avión-flak
    for(const f of this.flak){
      if(!f.dead && dist(f.x,f.y,this.plane.x,this.plane.y) < 14){
        f.dead = true; this.hp--; SFX.hit(); this.shake=1; this.hitFlash=1;
        this.particles.push({x:this.plane.x,y:this.plane.y,t:0,dur:0.35,boom:true,small:true});
        if(this.hp<=0){ this.finish(false,'Tu avión fue derribado por el fuego antiaéreo antes de alcanzar el objetivo.'); return; }
      }
    }
    this.flak = this.flak.filter(f=>!f.dead);
    // colisiones avión-misil guiado (más daño, ya que cuesta más esquivarlos)
    for(const m of this.missiles){
      if(!m.dead && dist(m.x,m.y,this.plane.x,this.plane.y) < 16){
        m.dead = true; this.hp -= 1; SFX.hit(); this.shake=1.4; this.hitFlash=1;
        this.particles.push({x:this.plane.x,y:this.plane.y,t:0,dur:0.5,boom:true});
        if(this.hp<=0){ this.finish(false,'Un misil guiado te alcanzó antes de llegar al objetivo.'); return; }
      }
    }
    this.missiles = this.missiles.filter(m=>!m.dead);

    this.particles.forEach(p=>p.t+=dt);
    this.particles = this.particles.filter(p=>p.t<p.dur);

    // impacto con el objetivo
    if(dist(this.plane.x,this.plane.y,this.cfg.targetX,this.cfg.targetY) < this.cfg.targetR){
      this.finish(true);
      return;
    }
    if(this.timeLeft<=0){ this.finish(false,'Se agotó el tiempo antes de alcanzar el portaaviones enemigo.'); return; }
  }
  finish(win, msg){
    if(this.ended) return; this.ended = true;
    if(win) SFX.win(); else SFX.lose();
    let stars=1;
    if(win){
      if(this.hp===this.cfg.hp && this.timeLeft>this.cfg.timeLimit*0.4) stars=3;
      else if(this.hp>=2 || this.timeLeft>this.cfg.timeLimit*0.15) stars=2;
    }
    const score = (win?800:0) + this.hp*150 + Math.round(this.timeLeft*8);
    const achievementId = (win && this.hp===this.cfg.hp) ? 'intacto' : null;
    endGame({ win, stars, score, achievementId, message: msg || `Impacto directo sobre el portaaviones. Casco restante: ${this.hp}/${this.cfg.hp}.` });
  }
  draw(ctx){
    let ox=0, oy=0;
    if(this.shake>0){ ox = rand(-1,1)*this.shake*6; oy = rand(-1,1)*this.shake*6; }
    ctx.save(); ctx.translate(ox,oy);
    drawSky(ctx,'#1a2230','#0d1520', H, this.phase);
    drawSea(ctx, this.seaY, H, this.t, this.phase);
    ctx.strokeStyle='rgba(255,255,255,0.06)'; ctx.beginPath(); ctx.moveTo(0,this.seaY); ctx.lineTo(W,this.seaY); ctx.stroke();

    // portaaviones objetivo, apoyado sobre la línea del mar (nunca "flotando" en el cielo)
    drawCarrierSide(ctx, this.cfg.targetX, this.seaY, 1.05, '#8a7060', Math.sin(this.t*1.1)*0.018);
    ctx.strokeStyle='rgba(209,70,47,0.7)'; ctx.lineWidth=2;
    ctx.beginPath(); ctx.arc(this.cfg.targetX,this.cfg.targetY,this.cfg.targetR,0,Math.PI*2); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(this.cfg.targetX-10,this.cfg.targetY); ctx.lineTo(this.cfg.targetX+10,this.cfg.targetY); ctx.moveTo(this.cfg.targetX,this.cfg.targetY-10); ctx.lineTo(this.cfg.targetX,this.cfg.targetY+10); ctx.stroke();

    this.escorts.forEach(es=> drawShip(ctx, es.x, es.y, 0.8, '#5c6a72', 0, Math.sin(this.t*1.6+es.x*0.04)*0.03));

    // humo del avión (estela) — se dibuja antes que el avión para que quede detrás
    this.smoke.forEach(s=>{
      const p = s.t/s.dur;
      const col = s.white ? `rgba(230,230,230,${(1-p)*0.55})` : `rgba(${60+s.dmg*20},${55+s.dmg*10},${50},${(1-p)*0.4})`;
      ctx.fillStyle = col;
      ctx.beginPath(); ctx.arc(s.x, s.y, s.r*(1+p*1.8), 0, Math.PI*2); ctx.fill();
    });

    this.flak.forEach(f=>{
      ctx.fillStyle='#f0603a'; ctx.beginPath(); ctx.arc(f.x,f.y,3.5,0,Math.PI*2); ctx.fill();
      ctx.strokeStyle='rgba(240,96,58,0.35)'; ctx.beginPath(); ctx.moveTo(f.x,f.y); ctx.lineTo(f.x-f.vx*0.03,f.y-f.vy*0.03); ctx.stroke();
    });
    // misiles guiados: cuerpo alargado en la dirección de vuelo + resplandor de motor
    this.missiles.forEach(m=>{
      ctx.save(); ctx.translate(m.x,m.y); ctx.rotate(m.ang);
      ctx.fillStyle='#e8e0d0'; ctx.beginPath(); ctx.moveTo(9,0); ctx.lineTo(-6,-3); ctx.lineTo(-6,3); ctx.closePath(); ctx.fill();
      ctx.fillStyle='rgba(240,168,48,0.8)'; ctx.beginPath(); ctx.arc(-7,0,3,0,Math.PI*2); ctx.fill();
      ctx.restore();
    });

    drawFlightShadow(ctx, this.plane.x, this.seaY, this.seaY-this.plane.y, this.seaY-60);
    drawPlane(ctx, this.plane.x, this.plane.y, this.plane.vx===0&&this.plane.vy===0?0:Math.atan2(this.plane.vy,this.plane.vx||60), 1.3, '#e0d0b0');

    this.particles.forEach(p=>{ if(p.flash) drawMuzzleFlash(ctx,p.x,p.y,p.t/p.dur); else drawExplosion(ctx,p.x,p.y,p.t/p.dur, p.small?0.4:1); });

    if(this.hitFlash>0){ ctx.fillStyle=`rgba(200,40,20,${this.hitFlash*0.35})`; ctx.fillRect(0,0,W,H); }
    ctx.restore();

    hudText('ESCUADRÓN KAMIKAZE', 16, 12, 14, '#d1462f');
    hudText(`NIVEL ${this.level} · ${SKY_PALETTES[this.phase].name}`, 16, 30, 11, '#9c9782');
    hudText(`TIEMPO ${Math.max(0,this.timeLeft).toFixed(1)}s`, W-16, 12, 13, '#e9e3d0', 'right');
    if(this.missiles.length>0) hudText('¡MISIL GUIADO EN VUELO!', W-16, 30, 11, '#f0603a', 'right');
    hudText('INTEGRIDAD', 16, H-42, 11, '#f0a830');
    hudGauge(16, H-26, 200, 12, this.hp/this.cfg.hp, '#d1462f');
    hudText('FLECHAS/WASD MUEVEN · IMPACTA CONTRA EL RETÍCULO ROJO', W/2, H-16, 10, '#6a7580', 'center');
  }
  getHealthFraction(){ return this.hp/this.cfg.hp; }
  getSpeedFraction(){ return clamp(Math.hypot(this.plane.vx,this.plane.vy)/220, 0, 1); }
}

/* ==========================================================================
   MODO 3 — FUEGO ANTIAÉREO
   ========================================================================== */
class AntiaereoMode{
  constructor(level){ this.level = level; }
  init(){
    const n = this.level;
    this.cfg = {
      waves: 3 + Math.min(Math.floor(n/2), 3),
      planesPerWave: 4 + n,
      planeSpeedBase: 60 + n*10,
      spawnGap: Math.max(0.85 - n*0.05, 0.35),
      carrierHP: 10,
      fireCooldown: 0.22,
    };
    this.turretX = W/2; this.turretY = H-40; this.aimAngle = -Math.PI/2;
    this.bullets = []; this.planes = []; this.particles = [];
    this.carrierHP = this.cfg.carrierHP;
    this.wave = 0; this.spawnedInWave = 0; this.spawnTimer = 0.4; this.waveDelay = 0;
    this.fireCd = 0; this.t = 0; this.ended = false; this.planesDowned = 0;
    this.phase = this.level % 3; // día / atardecer / noche
    this.startNextWave();
  }
  startNextWave(){
    this.wave++; this.spawnedInWave = 0; this.waveDelay = this.wave===1?0.6:1.8;
  }
  onKeyDown(e){ if(e.code==='Space') this.tryFire(); }
  onClick(){ this.tryFire(); }
  tryFire(){
    if(this.fireCd>0 || this.ended) return;
    this.fireCd = this.cfg.fireCooldown; SFX.fire();
    this.bullets.push({ x:this.turretX, y:this.turretY-18, vx:Math.cos(this.aimAngle)*520, vy:Math.sin(this.aimAngle)*520 });
    // fogonazo en la boca de la torreta, en la dirección de puntería
    const theta = this.aimAngle + Math.PI/2;
    this.particles.push({ x:this.turretX+40*Math.sin(theta), y:this.turretY-40*Math.cos(theta), t:0, dur:0.08, flash:true });
  }
  update(dt){
    if(this.ended) return;
    this.t += dt;
    this.fireCd = Math.max(0, this.fireCd-dt);

    // apuntar con mouse o flechas
    const targetAngle = Math.atan2(Input.mouse.y-(this.turretY-18), Input.mouse.x-this.turretX);
    if(Math.abs(Input.mouse.x-this._lastMouseX)>0.5 || Math.abs(Input.mouse.y-this._lastMouseY)>0.5){
      this.aimAngle = clamp(targetAngle, -Math.PI+0.15, -0.15);
    }
    this._lastMouseX = Input.mouse.x; this._lastMouseY = Input.mouse.y;
    const rotSpeed = 2.4;
    if(Input.keys['ArrowLeft']||Input.keys['KeyA']) this.aimAngle -= rotSpeed*dt;
    if(Input.keys['ArrowRight']||Input.keys['KeyD']) this.aimAngle += rotSpeed*dt;
    if(Input.keys['Space']) this.tryFire();
    this.aimAngle = clamp(this.aimAngle, -Math.PI+0.1, -0.1);

    // generar oleada
    if(this.waveDelay>0){ this.waveDelay -= dt; }
    else if(this.spawnedInWave < this.cfg.planesPerWave){
      this.spawnTimer -= dt;
      if(this.spawnTimer<=0){
        this.spawnTimer = this.cfg.spawnGap + rand(-0.1,0.15);
        this.spawnedInWave++;
        const x = rand(40,W-40);
        this.planes.push({
          x, y:-20, vy: this.cfg.planeSpeedBase*rand(0.85,1.2), vx: rand(-20,20),
          weave: rand(1.5,3), phase: rand(0,10), hp:1,
        });
      }
    }

    // mover balas
    this.bullets.forEach(b=>{ b.x+=b.vx*dt; b.y+=b.vy*dt; });
    this.bullets = this.bullets.filter(b=> b.x>-10&&b.x<W+10&&b.y>-10&&b.y<H+10);

    // mover aviones — esquivan activamente las balas del jugador cuando detectan
    // que van a impactarles, además de su tejido de vuelo habitual
    const evadeStrength = 60 + this.level*14; // en niveles altos, esquivan con más decisión
    this.planes.forEach(p=>{
      p.y += p.vy*dt;
      let evade = 0;
      for(const b of this.bullets){
        if(b.dead || b.vy>=0) continue; // sólo importa lo que sube hacia el avión
        const dtImpact = (p.y - b.y)/b.vy;
        if(dtImpact>0 && dtImpact<0.85){
          const predX = b.x + b.vx*dtImpact;
          const diff = p.x - predX;
          if(Math.abs(diff) < 60){
            evade += Math.sign(diff||(Math.random()<0.5?-1:1)) * (1 - Math.abs(diff)/60);
          }
        }
      }
      p.x += (Math.sin(this.t*p.weave+p.phase)*18 + evade*evadeStrength) * dt + p.vx*dt*0.2;
      p.x = clamp(p.x,20,W-20);
    });

    // colisiones bala-avion
    for(const b of this.bullets){
      for(const p of this.planes){
        if(!p.dead && !b.dead && dist(b.x,b.y,p.x,p.y)<16){
          b.dead=true; p.dead=true; this.planesDowned++; SFX.explosion();
          this.particles.push({x:p.x,y:p.y,t:0,dur:0.5});
        }
      }
    }
    this.bullets = this.bullets.filter(b=>!b.dead);
    // avion llega al portaaviones
    this.planes = this.planes.filter(p=>{
      if(p.dead) return false;
      if(p.y > H-60){
        this.carrierHP -= 1; SFX.hit();
        this.particles.push({x:p.x,y:H-50,t:0,dur:0.4});
        return false;
      }
      return true;
    });

    this.particles.forEach(pt=>pt.t+=dt);
    this.particles = this.particles.filter(pt=>pt.t<pt.dur);

    if(this.carrierHP<=0){ this.finish(false,'El portaaviones sufrió daños críticos y se pierde la misión.'); return; }

    const waveDone = this.spawnedInWave>=this.cfg.planesPerWave && this.planes.length===0;
    if(waveDone){
      if(this.wave>=this.cfg.waves){ this.finish(true); return; }
      this.startNextWave();
    }
  }
  finish(win,msg){
    if(this.ended) return; this.ended=true;
    if(win) SFX.win(); else SFX.lose();
    let stars=1;
    if(win){
      if(this.carrierHP===this.cfg.carrierHP) stars=3;
      else if(this.carrierHP>=this.cfg.carrierHP*0.6) stars=2;
    }
    const score = this.planesDowned*120 + this.carrierHP*80;
    const achievementId = (win && this.carrierHP===this.cfg.carrierHP) ? 'muralla' : null;
    endGame({ win, stars, score, achievementId, message: msg || `Oleadas repelidas: ${this.cfg.waves}. Aviones derribados: ${this.planesDowned}. Portaaviones al ${Math.round(this.carrierHP/this.cfg.carrierHP*100)}%.` });
  }
  draw(ctx){
    drawSky(ctx,'#152233','#0a121c', H-70, this.phase);
    drawSea(ctx, H-70, H, this.t, this.phase);
    // portaaviones defendido, visto en planta (los aviones caen verticalmente sobre él)
    drawCarrierTop(ctx, W/2, H-48, 320, '#5c6a72');

    this.planes.forEach(p=>{
      drawFlightShadow(ctx, p.x, H-52, (H-52)-p.y, H-52+40);
      drawPlane(ctx, p.x, p.y, Math.PI/2, 1.35, '#c9463a');
    });
    this.bullets.forEach(b=>{ ctx.fillStyle='#f0d080'; ctx.beginPath(); ctx.arc(b.x,b.y,3,0,Math.PI*2); ctx.fill(); });
    this.particles.forEach(p=>{ if(p.flash) drawMuzzleFlash(ctx,p.x,p.y,p.t/p.dur); else drawExplosion(ctx,p.x,p.y,p.t/p.dur,0.8); });

    // torreta
    ctx.save(); ctx.translate(this.turretX,this.turretY);
    ctx.fillStyle='#2a3138'; ctx.beginPath(); ctx.arc(0,0,16,Math.PI,0); ctx.fill();
    ctx.save(); ctx.rotate(this.aimAngle+Math.PI/2);
    ctx.fillStyle='#4a5560'; ctx.fillRect(-3,-40,6,40);
    ctx.restore(); ctx.restore();

    hudText('FUEGO ANTIAÉREO', 16, 12, 14, '#f0a830');
    hudText(`NIVEL ${this.level} · ${SKY_PALETTES[this.phase].name} · OLEADA ${Math.min(this.wave,this.cfg.waves)}/${this.cfg.waves}`, 16, 30, 11, '#9c9782');
    hudText(`DERRIBOS ${this.planesDowned}`, W-16, 12, 13, '#e9e3d0', 'right');
    hudText('PORTAAVIONES', 16, H-42, 11, '#39e07a');
    hudGauge(16, H-26, 200, 12, this.carrierHP/this.cfg.carrierHP, '#39e07a');
    hudText('APUNTA CON EL MOUSE O ←→ · ESPACIO/CLIC DISPARA', W/2, H-16, 10, '#6a7580', 'center');
  }
  getHealthFraction(){ return this.carrierHP/this.cfg.carrierHP; }
  onKeyUp(){}
}

/* ==========================================================================
   MODO 4 — PILOTO MENSAJERO
   ========================================================================== */
class MensajeroMode{
  constructor(level){ this.level = level; }
  init(){
    const n = this.level;
    this.seaY = H*0.56;
    this.cfg = {
      deliveries: 2 + Math.min(Math.floor(n/2),3),
      pods: 4 + Math.ceil(n/2),
      forwardSpeed: 145 + n*10,
      patrols: 1 + Math.min(n,4),
      zoneR: Math.max(46 - n*2, 26),
      dangerY: 50 + (this.seaY-50)*0.62, // por debajo de esta altura, las patrullas pueden alcanzarte con misiles
      missileRange: 250 + n*8,
      missileCooldown: Math.max(1.7 - n*0.09, 0.75),
      missileSpeed: 190 + n*10,
    };
    // el avión entra volando desde el borde izquierdo y nunca se detiene:
    // sólo se controla su altitud, igual que un vuelo real de entrega.
    this.plane = { x:-40, y:H*0.3, vy:0 };
    this.pods = []; this.particles = []; this.patrols = []; this.missiles = [];
    this.podsLeft = this.cfg.pods; this.delivered = 0; this.lives = 3;
    this.t = 0; this.ended = false; this.flash = 0;
    // viento del nivel: el avión (con instrumentos) vuela recto, pero el mensaje
    // en caída libre sí se desvía — hay que compensar al soltarlo
    this.wind = rand(-1,1) * (12 + this.level*2.5);
    this.phase = this.level % 3; // día / atardecer / noche
    this.spawnZone();
    this.patrols = Array.from({length:this.cfg.patrols},()=>({
      x: rand(200,W-100), y: H-70, dir: choice([-1,1]), speed: rand(30,60), missileCool: rand(0.3,1.4),
    }));
  }
  spawnZone(){
    this.zone = { x: rand(W*0.55, W-90), y: H-80, r: this.cfg.zoneR };
  }
  onKeyDown(e){ if(e.code==='Space') this.dropPod(); }
  dropPod(){
    if(this.ended || this.podsLeft<=0) return;
    this.podsLeft--; SFX.drop();
    this.pods.push({ x:this.plane.x, y:this.plane.y, vx:this.cfg.forwardSpeed, vy:20 });
  }
  update(dt){
    if(this.ended) return;
    this.t += dt;
    this.flash = Math.max(0,this.flash-dt*3);

    if(Input.keys['ArrowUp']||Input.keys['KeyW']) this.plane.vy -= 260*dt;
    if(Input.keys['ArrowDown']||Input.keys['KeyS']) this.plane.vy += 260*dt;
    this.plane.vy = clamp(this.plane.vy, -180,180) * 0.92;
    // techo de vuelo: siempre por encima del mar, nunca lo toca
    this.plane.y = clamp(this.plane.y + this.plane.vy*dt, 50, this.seaY-20);
    // vuelo continuo hacia adelante: el avión SIEMPRE avanza en X (pasadas de bombardeo repetidas)
    this.plane.x += this.cfg.forwardSpeed*dt;
    if(this.plane.x > W+40) this.plane.x = -40;

    const lowAltitude = this.plane.y > this.cfg.dangerY;

    this.patrols.forEach(p=>{
      p.x += p.dir*p.speed*dt;
      if(p.x<80||p.x>W-40) p.dir*=-1;
      // si vuelas demasiado bajo y cerca, la patrulla lanza un misil hacia ti
      p.missileCool -= dt;
      const inRange = Math.abs(this.plane.x-p.x) < this.cfg.missileRange;
      if(lowAltitude && inRange && p.missileCool<=0){
        p.missileCool = this.cfg.missileCooldown + rand(-0.15,0.25);
        const ang = Math.atan2(this.plane.y-(p.y-12), this.plane.x-p.x);
        this.missiles.push({ x:p.x, y:p.y-12, vx:Math.cos(ang)*this.cfg.missileSpeed, vy:Math.sin(ang)*this.cfg.missileSpeed, life:3.2 });
        SFX.miss();
      }
    });

    this.missiles.forEach(m=>{ m.x += m.vx*dt; m.y += m.vy*dt; m.life -= dt; });
    this.missiles = this.missiles.filter(m=> m.life>0 && m.x>-30 && m.x<W+30 && m.y>-30 && m.y<H+30);
    for(const m of this.missiles){
      if(!m.dead && dist(m.x,m.y,this.plane.x,this.plane.y) < 15){
        m.dead = true; this.lives--; this.flash=1; SFX.hit();
        this.particles.push({x:this.plane.x,y:this.plane.y,t:0,dur:0.45,boom:true});
        if(this.lives<=0){ this.finish(false,'Un misil de patrulla derribó tu avión por volar demasiado bajo cerca del enemigo.'); return; }
      }
    }
    this.missiles = this.missiles.filter(m=>!m.dead);

    this.pods.forEach(pod=>{
      pod.vy += 300*dt;
      // el viento desvía el mensaje mientras cae — el avión vuela recto, pero la carga no
      pod.vx += this.wind*dt;
      pod.x += pod.vx*dt; pod.y += pod.vy*dt;
    });
    this.pods = this.pods.filter(pod=>{
      if(pod.y >= H-92){
        const dz = dist(pod.x,pod.y,this.zone.x,this.zone.y);
        const nearPatrol = this.patrols.some(p=> dist(pod.x,pod.y,p.x,p.y) < 26);
        if(dz < this.zone.r && !nearPatrol){
          this.delivered++; SFX.win(); this.particles.push({x:pod.x,y:pod.y,t:0,dur:0.5,good:true});
          this.spawnZone();
        } else {
          this.lives--; this.flash=1; SFX.lose();
          this.particles.push({x:pod.x,y:pod.y,t:0,dur:0.5,good:false});
        }
        return false;
      }
      return true;
    });

    this.particles.forEach(p=>p.t+=dt);
    this.particles = this.particles.filter(p=>p.t<p.dur);

    if(this.lives<=0){ this.finish(false,'Demasiados mensajes cayeron en manos enemigas o tu avión fue derribado. La misión se cancela.'); return; }
    if(this.delivered>=this.cfg.deliveries){ this.finish(true); return; }
    if(this.podsLeft<=0 && this.pods.length===0){ this.finish(false,'Se agotaron los mensajes antes de completar todas las entregas.'); return; }
  }
  finish(win,msg){
    if(this.ended) return; this.ended=true;
    if(win) SFX.win(); else SFX.lose();
    const eff = this.delivered/Math.max(1,this.cfg.pods-this.podsLeft);
    let stars=1;
    if(win){
      if(this.lives===3 && eff>0.7) stars=3;
      else if(this.lives>=2) stars=2;
    }
    const score = this.delivered*300 + this.lives*100;
    const achievementId = (win && this.lives===3) ? 'impecable' : null;
    endGame({ win, stars, score, achievementId, message: msg || `Entregas completadas: ${this.delivered}/${this.cfg.deliveries}. Vidas restantes: ${this.lives}.` });
  }
  draw(ctx){
    drawSky(ctx,'#101c28','#08111a', H, this.phase);
    drawSea(ctx, this.seaY, H, this.t, this.phase);

    // línea de altitud mínima segura: por debajo de ella, las patrullas pueden dispararte
    const lowAltitude = this.plane.y > this.cfg.dangerY;
    ctx.strokeStyle = lowAltitude ? 'rgba(209,70,47,0.55)' : 'rgba(255,255,255,0.10)';
    ctx.lineWidth=1.5; ctx.setLineDash([6,6]);
    ctx.beginPath(); ctx.moveTo(0,this.cfg.dangerY); ctx.lineTo(W,this.cfg.dangerY); ctx.stroke(); ctx.setLineDash([]);
    hudText('ALTITUD MÍNIMA SEGURA', 8, this.cfg.dangerY-14, 9, lowAltitude?'#d1462f':'#6a7580');

    // zona de entrega amiga
    ctx.strokeStyle='rgba(57,224,122,0.8)'; ctx.lineWidth=2;
    ctx.beginPath(); ctx.arc(this.zone.x,this.zone.y,this.zone.r,0,Math.PI*2); ctx.stroke();
    ctx.fillStyle='rgba(57,224,122,0.12)'; ctx.fill();
    hudText('ZONA AMIGA', this.zone.x, this.zone.y-this.zone.r-16, 10, '#39e07a','center');

    this.patrols.forEach(p=>{
      drawShip(ctx, p.x, p.y, 0.6, '#8a3a30', 0, Math.sin(this.t*1.7+p.x*0.05)*0.032);
      ctx.strokeStyle='rgba(209,70,47,0.5)'; ctx.beginPath(); ctx.arc(p.x,p.y,this.cfg.missileRange>250?26:26,0,Math.PI*2); ctx.stroke();
    });

    // misiles de patrulla, con estela de humo
    this.missiles.forEach(m=>{
      const ang = Math.atan2(m.vy,m.vx);
      ctx.save(); ctx.translate(m.x,m.y); ctx.rotate(ang);
      ctx.fillStyle='#e8846a'; ctx.beginPath(); ctx.moveTo(8,0); ctx.lineTo(-5,-3); ctx.lineTo(-5,3); ctx.closePath(); ctx.fill();
      ctx.restore();
      ctx.fillStyle='rgba(230,150,120,0.28)'; ctx.beginPath(); ctx.arc(m.x-m.vx*0.02,m.y-m.vy*0.02,3,0,Math.PI*2); ctx.fill();
    });

    // estela de motor para reforzar la sensación de vuelo continuo hacia adelante
    ctx.strokeStyle='rgba(230,220,200,0.18)'; ctx.lineWidth=2;
    ctx.beginPath(); ctx.moveTo(this.plane.x-34, this.plane.y); ctx.lineTo(this.plane.x-14, this.plane.y); ctx.stroke();
    drawFlightShadow(ctx, this.plane.x, this.seaY, this.seaY-this.plane.y, this.seaY-60);
    drawPlane(ctx, this.plane.x, this.plane.y, Math.atan2(this.plane.vy, this.cfg.forwardSpeed), 1.3, '#d8cdb0');

    this.pods.forEach(pod=>{
      ctx.save(); ctx.translate(pod.x,pod.y);
      ctx.fillStyle='#e9c860'; ctx.fillRect(-4,-4,8,8);
      ctx.strokeStyle='rgba(233,200,96,0.4)'; ctx.beginPath(); ctx.moveTo(0,-16); ctx.lineTo(-6,-4); ctx.lineTo(6,-4); ctx.closePath(); ctx.stroke();
      ctx.restore();
    });
    this.particles.forEach(p=>{
      if(p.good) drawExplosion(ctx,p.x,p.y,p.t/p.dur,0.5);
      else if(p.boom) drawExplosion(ctx,p.x,p.y,p.t/p.dur,0.7);
      else { ctx.strokeStyle=`rgba(209,70,47,${1-p.t/p.dur})`; ctx.lineWidth=2; ctx.beginPath(); ctx.arc(p.x,p.y,6+((p.t/p.dur)*20),0,Math.PI*2); ctx.stroke(); }
    });

    if(this.flash>0){ ctx.fillStyle=`rgba(200,40,20,${this.flash*0.3})`; ctx.fillRect(0,0,W,H); }

    hudText('PILOTO MENSAJERO', 16, 12, 14, '#c8cfd6');
    hudText(`NIVEL ${this.level} · ${SKY_PALETTES[this.phase].name}`, 16, 30, 11, '#9c9782');
    hudText(`ENTREGAS ${this.delivered}/${this.cfg.deliveries}`, W-16, 12, 13, '#e9e3d0', 'right');
    hudText(`MENSAJES ${this.podsLeft}`, W-16, 30, 12, '#e9e3d0', 'right');
    hudText(`VIENTO ${this.wind>=0?'→':'←'} ${Math.abs(this.wind).toFixed(0)} (desvía la carga al caer)`, W-16, 48, 10, '#7fd7e0', 'right');
    for(let i=0;i<3;i++){ ctx.fillStyle = i<this.lives ? '#39e07a' : 'rgba(255,255,255,0.15)'; ctx.beginPath(); ctx.arc(W-16-i*18,68,5,0,Math.PI*2); ctx.fill(); }
    if(lowAltitude) hudText('¡ZONA DE PELIGRO — MISILES DE PATRULLA!', W-16, 82, 11, '#d1462f', 'right');
    hudText('↑↓ ALTITUD · ESPACIO SUELTA EL MENSAJE · MANTENTE SOBRE LA LÍNEA SEGURA', W/2, H-16, 10, '#6a7580', 'center');
  }
  getHealthFraction(){ return this.lives/3; }
  getSpeedFraction(){ return 0.55; }
  onKeyUp(){}
}

/* --------------------------------- Boot ----------------------------------- */
renderMenu();
showScreen('menu');

/* Gancho de depuración (no interfiere con el juego) */
window.__DEBUG__ = { Engine, Input, SAVE, startGame, openBriefing, endGame, ctx, CAMPAIGN, renderCampaignHub, openCampaignBriefing, startCampaignChapter, renderMenu, showScreen, unlockAchievement };
