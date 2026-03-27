// ---- State ----
let bpm = 120;
let isRunning = false;
let audioCtx = null;
let schedulerTimer = null;
let nextNoteTime = 0.0;
let currentBeat = 0;       // beat within measure
let currentMeasureIdx = 0; // index into expanded sequence
let pendulumDir = 1;
let tapTimes = [];
let loopEnabled = true;
let mode = 'simple'; // 'simple' | 'sequence'

// Simple mode state
let simpleBeats = 4, simpleDenom = 4;

// Sequence mode: array of {beats, denom} (expanded, one entry per measure repetition)
let sequence = [{beats:4,denom:4},{beats:4,denom:4},{beats:3,denom:4},{beats:3,denom:4}];

// Raw sequence entries for editing: {beats, denom, reps}
let seqEntries = [{beats:4,denom:4,reps:2},{beats:3,denom:4,reps:2}];

// UI animation queue
let animQueue = [];
let animTimer = null;

// ---- Tempo names ----
const tempoNames = [
  [10,19,'Extremely Slow'],[20,39,'Larghissimo'],[40,59,'Largo'],[60,65,'Larghetto'],
  [66,75,'Adagio'],[76,107,'Andante'],[108,119,'Moderato'],
  [120,155,'Allegro'],[156,175,'Vivace'],[176,199,'Presto'],[200,300,'Prestissimo'],[301,400,'Hyper Presto']
];
function getTempoName(b){ for(let[lo,hi,n] of tempoNames) if(b>=lo&&b<=hi)return n; return ''; }

// ---- BPM ----
function changeBpm(d){ bpm=Math.min(400,Math.max(10,bpm+d)); updateBpmUI(); }
document.getElementById('bpmSlider').addEventListener('input',function(){bpm=parseInt(this.value);updateBpmUI();});
function updateBpmUI(){
  document.getElementById('bpmDisplay').textContent=bpm;
  document.getElementById('tempoName').textContent=getTempoName(bpm);
  const pct=((bpm-10)/390*100).toFixed(1);
  const sl=document.getElementById('bpmSlider');
  sl.style.setProperty('--val',pct+'%'); sl.value=bpm;
}

// ---- Mode ----
function setMode(m){
  mode=m;
  document.getElementById('modeSimple').classList.toggle('active',m==='simple');
  document.getElementById('modeSeq').classList.toggle('active',m==='sequence');
  document.getElementById('simplePanel').style.display=m==='simple'?'':'none';
  document.getElementById('seqPanel').style.display=m==='sequence'?'':'none';
  resetPlayback();
  buildBeatDots();
  updateMeasureDisplay();
}

// ---- Simple TS ----
function setSimpleTs(b,d){
  simpleBeats=b; simpleDenom=d;
  document.querySelectorAll('.ts-btn').forEach(btn=>{
    const active=btn.id==='tsbtn'+b+d;
    btn.style.background=active?'#2b6cb0':'#2d3748';
    btn.style.color=active?'#fff':'#a0aec0';
    btn.style.borderColor=active?'#63b3ed':'#4a5568';
  });
  if(isRunning){ resetPlayback(); }
  buildBeatDots(); updateMeasureDisplay();
}

// ---- Sequence ----
function expandSequence(){
  sequence=[];
  for(let e of seqEntries) for(let i=0;i<e.reps;i++) sequence.push({beats:e.beats,denom:e.denom});
}

function renderSeqList(){
  expandSequence();
  const list=document.getElementById('seqList');
  list.innerHTML='';
  if(seqEntries.length===0){
    list.innerHTML='<div style="color:#718096;font-size:0.8rem;padding:12px;">小節を追加してください</div>';
    return;
  }
  seqEntries.forEach((e,i)=>{
    const div=document.createElement('div');
    div.className='seq-item'; div.id='seqentry'+i;
    // Find if this entry covers currentMeasureIdx
    let start=0; for(let j=0;j<i;j++) start+=seqEntries[j].reps;
    if(isRunning && currentMeasureIdx>=start && currentMeasureIdx<start+e.reps) div.classList.add('current-measure');
    div.innerHTML=`
      <span class="seq-item-num">${i+1}</span>
      <div class="seq-item-label">
        <select onchange="updateEntry(${i},'ts',this.value)" style="background:#1a365d;border:1px solid #4a5568;color:#e2e8f0;border-radius:6px;padding:3px 6px;font-size:0.95rem;outline:none;cursor:pointer;">
          ${['2/4','3/4','4/4','5/4','6/4','7/4','3/8','5/8','6/8','7/8','9/8','11/8','12/8'].map(t=>
            `<option value="${t}"${t===e.beats+'/'+e.denom?' selected':''}>${t}</option>`
          ).join('')}
        </select>
      </div>
      <div class="seq-item-repeat">
        <span>×</span>
        <input type="number" value="${e.reps}" min="1" max="99" style="width:42px;background:#1a365d;border:1px solid #4a5568;color:#e2e8f0;border-radius:6px;padding:3px 5px;text-align:center;font-size:0.8rem;outline:none;" onchange="updateEntry(${i},'reps',this.value)">
        <span>小節</span>
      </div>
      <button class="del-btn" onclick="deleteEntry(${i})">✕</button>
    `;
    list.appendChild(div);
  });
  document.getElementById('seqStatus').textContent=sequence.length+'小節';
}

function updateEntry(i,field,val){
  if(field==='ts'){const[b,d]=val.split('/');seqEntries[i].beats=parseInt(b);seqEntries[i].denom=parseInt(d);}
  if(field==='reps'){seqEntries[i].reps=Math.max(1,parseInt(val)||1);}
  renderSeqList();
  if(isRunning) resetPlayback();
  buildBeatDots(); updateMeasureDisplay();
}

function deleteEntry(i){
  seqEntries.splice(i,1); renderSeqList();
  if(isRunning) resetPlayback();
  buildBeatDots(); updateMeasureDisplay();
}

function addMeasure(){
  const ts=document.getElementById('addTs').value;
  const reps=Math.max(1,parseInt(document.getElementById('addRep').value)||1);
  const[b,d]=ts.split('/');
  seqEntries.push({beats:parseInt(b),denom:parseInt(d),reps});
  document.getElementById('addRep').value=1;
  renderSeqList();
  if(isRunning) resetPlayback();
}

function clearSeq(){ seqEntries=[]; renderSeqList(); if(isRunning)resetPlayback(); buildBeatDots(); updateMeasureDisplay(); }

function loadPreset(name){
  const presets={
    odd:[{beats:5,denom:4,reps:1},{beats:7,denom:8,reps:1},{beats:4,denom:4,reps:1}],
    jazz:[{beats:4,denom:4,reps:2},{beats:3,denom:4,reps:2}],
    prog:[{beats:7,denom:8,reps:3},{beats:5,denom:8,reps:1}],
    waltz:[{beats:3,denom:4,reps:4}]
  };
  seqEntries=presets[name].map(e=>({...e}));
  renderSeqList();
  if(isRunning) resetPlayback();
  buildBeatDots(); updateMeasureDisplay();
}

function toggleLoop(){
  loopEnabled=!loopEnabled;
  document.getElementById('loopToggle').classList.toggle('on',loopEnabled);
  document.getElementById('loopVal').textContent=loopEnabled?'ON':'OFF';
}

// ---- Current measure info ----
function getCurrentTs(){
  if(mode==='simple') return {beats:simpleBeats,denom:simpleDenom};
  expandSequence();
  if(sequence.length===0) return {beats:4,denom:4};
  const idx=currentMeasureIdx % sequence.length;
  return sequence[idx];
}

// ---- Beat dots ----
function buildBeatDots(){
  const ts=getCurrentTs();
  const row=document.getElementById('beatRow');
  row.innerHTML='';
  for(let i=0;i<ts.beats;i++){
    const d=document.createElement('div');
    d.className='beat-dot'+(i===0?' accent':'');
    d.id='dot'+i; row.appendChild(d);
  }
}

function updateMeasureDisplay(){
  const ts=getCurrentTs();
  const mIdx=mode==='sequence'?currentMeasureIdx:0;
  const mTotal=mode==='sequence'?(sequence.length||1):1;
  document.getElementById('measureDisplay').textContent=(mIdx%mTotal)+1+' / '+mTotal;
  document.getElementById('measureTsDisplay').textContent=ts.beats+'/'+ts.denom;
}

// ---- Web Audio Scheduler ----
const SCHEDULE_AHEAD = 0.1;
const LOOK_AHEAD = 25.0;

function scheduleNote(time, beat, measureIdx, ts){
  const accent = beat === 0;
  if(!audioCtx) return;
  const osc = audioCtx.createOscillator();
  const gain = audioCtx.createGain();
  osc.connect(gain); gain.connect(audioCtx.destination);
  osc.frequency.value = accent ? 1800 : 900;
  gain.gain.setValueAtTime(accent ? 0.85 : 0.45, time);
  gain.gain.exponentialRampToValueAtTime(0.001, time + 0.05);
  osc.start(time); osc.stop(time + 0.06);

  // Queue visual update
  const delay = Math.max(0, (time - audioCtx.currentTime) * 1000);
  setTimeout(()=> animateBeat(beat, measureIdx, ts), delay);
}

function animateBeat(beat, measureIdx, ts){
  if(!isRunning) return;
  // Rebuild dots if ts changed
  const curTs = getCurrentTs();
  const dotCount = document.querySelectorAll('.beat-dot').length;
  if(dotCount !== ts.beats){
    buildBeatDots();
  }
  document.querySelectorAll('.beat-dot').forEach(d=>d.classList.remove('active'));
  const dot=document.getElementById('dot'+beat);
  if(dot) dot.classList.add('active');

  // Pendulum
  const pend=document.getElementById('pendulum');
  pend.classList.remove('swing-left','swing-right');
  void pend.offsetWidth;
  pend.classList.add(pendulumDir>0?'swing-right':'swing-left');
  if(beat===ts.beats-1) pendulumDir*=-1;

  // Measure display
  document.getElementById('measureDisplay').textContent=(measureIdx % Math.max(1,sequence.length||1))+1+' / '+Math.max(1,sequence.length||1);
  document.getElementById('measureTsDisplay').textContent=ts.beats+'/'+ts.denom;

  // Highlight seq entry
  if(mode==='sequence'){
    document.querySelectorAll('.seq-item').forEach(el=>el.classList.remove('current-measure'));
    let start=0,entryIdx=0;
    const mi=measureIdx%(sequence.length||1);
    for(let j=0;j<seqEntries.length;j++){
      if(mi>=start && mi<start+seqEntries[j].reps){entryIdx=j;break;}
      start+=seqEntries[j].reps;
    }
    const el=document.getElementById('seqentry'+entryIdx);
    if(el) el.classList.add('current-measure');
  }
}

function scheduler(){
  if(!isRunning) return;
  while(nextNoteTime < audioCtx.currentTime + SCHEDULE_AHEAD){
    const ts = mode==='simple'
      ? {beats:simpleBeats,denom:simpleDenom}
      : (sequence.length>0 ? sequence[currentMeasureIdx % sequence.length] : {beats:4,denom:4});

    scheduleNote(nextNoteTime, currentBeat, currentMeasureIdx, ts);

    // Advance
    const secondsPerBeat = 60.0 / bpm;
    // For 8th-note denominators, each beat = half a quarter note
    const mul = (ts.denom===8) ? 0.5 : 1.0;
    nextNoteTime += secondsPerBeat * mul;

    currentBeat++;
    if(currentBeat >= ts.beats){
      currentBeat=0;
      currentMeasureIdx++;
      if(mode==='sequence' && sequence.length>0 && currentMeasureIdx>=sequence.length){
        if(loopEnabled){ currentMeasureIdx=0; }
        else { stopMetronome(); return; }
      }
    }
  }
  schedulerTimer = setTimeout(scheduler, LOOK_AHEAD);
}

function resetPlayback(){
  currentBeat=0; currentMeasureIdx=0; pendulumDir=1;
  if(mode==='sequence') expandSequence();
  buildBeatDots(); updateMeasureDisplay();
}

function stopMetronome(){
  isRunning=false;
  clearTimeout(schedulerTimer);
  const btn=document.getElementById('startBtn');
  btn.textContent='▶ スタート'; btn.classList.remove('running');
  document.querySelectorAll('.beat-dot').forEach(d=>d.classList.remove('active'));
  document.getElementById('pendulum').classList.remove('swing-left','swing-right');
  document.querySelectorAll('.seq-item').forEach(el=>el.classList.remove('current-measure'));
  resetPlayback();
}

function toggleMetronome(){
  if(isRunning){ stopMetronome(); return; }
  if(!audioCtx) audioCtx=new(window.AudioContext||window.webkitAudioContext)();
  if(audioCtx.state==='suspended') audioCtx.resume();
  if(mode==='sequence') expandSequence();
  if(mode==='sequence' && sequence.length===0){ alert('小節を追加してください'); return; }
  isRunning=true;
  currentBeat=0; currentMeasureIdx=0; pendulumDir=1;
  nextNoteTime=audioCtx.currentTime+0.05;
  const btn=document.getElementById('startBtn');
  btn.textContent='⏹ ストップ'; btn.classList.add('running');
  buildBeatDots(); updateMeasureDisplay();
  scheduler();
}

// ---- Tap tempo ----
function tapTempo(){
  const now=Date.now(); tapTimes.push(now);
  if(tapTimes.length>8) tapTimes.shift();
  if(tapTimes.length>=2){
    const diffs=[]; for(let i=1;i<tapTimes.length;i++) diffs.push(tapTimes[i]-tapTimes[i-1]);
    bpm=Math.min(400,Math.max(10,Math.round(60000/(diffs.reduce((a,b)=>a+b,0)/diffs.length))));
    updateBpmUI();
  }
  clearTimeout(window._tapClear);
  window._tapClear=setTimeout(()=>tapTimes=[],3000);
}

// ---- Init ----
renderSeqList();
buildBeatDots();
updateBpmUI();
updateMeasureDisplay();