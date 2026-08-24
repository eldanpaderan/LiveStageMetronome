import { MetronomeEngine, MIN_BPM, MAX_BPM } from './engine.js';
import { listMeters, getMeter } from './meters.js';
import { listPatterns, getPattern } from './patterns.js';
import { Storage, makeSong } from './storage.js';

/* ============================== STATE ============================== */

const engine = new MetronomeEngine();

const state = {
  songs: Storage.loadSongs(),
  setlists: Storage.loadSetlists(),
  activeSetlistId: null,
  stageIndex: 0,
  editingSongId: null, // song being edited in the form overlay, null = new
  librarySearch: '',
};

let wakeLockSentinel = null;
let stageRunning = false;
let stageCountInActive = false;

/* ============================== UTIL ============================== */

const $ = (sel) => document.querySelector(sel);
const $$ = (sel) => Array.from(document.querySelectorAll(sel));

function persistSongs() { Storage.saveSongs(state.songs); }
function persistSetlists() { Storage.saveSetlists(state.setlists); }

function findSong(id) { return state.songs.find((s) => s.id === id); }
function findSetlist(id) { return state.setlists.find((s) => s.id === id); }

function fillSelectWithMeters(selectEl) {
  selectEl.innerHTML = '';
  listMeters().forEach((m) => {
    const opt = document.createElement('option');
    opt.value = m.id;
    opt.textContent = m.label;
    selectEl.appendChild(opt);
  });
}

function fillSelectWithPatterns(selectEl) {
  selectEl.innerHTML = '';
  listPatterns().forEach((p) => {
    const opt = document.createElement('option');
    opt.value = p.id;
    opt.textContent = p.label;
    selectEl.appendChild(opt);
  });
}

/* ============================== VIEW SWITCHING ============================== */

function switchView(name) {
  $$('.view').forEach((v) => v.classList.toggle('active', v.id === `view-${name}`));
  $$('.tab').forEach((t) => {
    const match = t.dataset.view === name;
    if (match) t.setAttribute('aria-current', 'page');
    else t.removeAttribute('aria-current');
  });
  // Leaving stage mode: stop stage transport so it doesn't run silently in the background.
  if (name !== 'stage' && stageRunning) {
    stopStageTransport();
  }
}

$$('.tab').forEach((btn) => btn.addEventListener('click', () => switchView(btn.dataset.view)));

/* ============================== BEAT RING RENDER ============================== */

function buildBeatRing(container, totalPulses) {
  container.innerHTML = '';
  for (let i = 0; i < totalPulses; i++) {
    const dot = document.createElement('span');
    dot.className = 'beat-dot';
    dot.dataset.index = String(i);
    container.appendChild(dot);
  }
}

function lightBeat(container, pulseIndex, isAccent) {
  const dots = container.querySelectorAll('.beat-dot');
  dots.forEach((d) => d.classList.remove('lit', 'accent'));
  const dot = dots[pulseIndex];
  if (dot) {
    dot.classList.add('lit');
    if (isAccent) dot.classList.add('accent');
  }
}

/* ============================== METRONOME VIEW ============================== */

const beatRingEl = $('#beatRing');
const bpmInput = $('#bpmInput');
const meterSelect = $('#meterSelect');
const patternSelect = $('#patternSelect');
const volumeSlider = $('#volumeSlider');
const startStopBtn = $('#startStopBtn');
const engineNotice = $('#engineNotice');

fillSelectWithMeters(meterSelect);
fillSelectWithPatterns(patternSelect);
meterSelect.value = engine.meterId;
patternSelect.value = engine.patternId;
buildBeatRing(beatRingEl, getMeter(engine.meterId).pulses.length);

function refreshBpmField() { bpmInput.value = String(engine.bpm); }

function showNotice(msg) {
  engineNotice.textContent = msg;
  if (msg) setTimeout(() => { if (engineNotice.textContent === msg) engineNotice.textContent = ''; }, 4000);
}

engine.onError = (msg) => showNotice(msg);
engine.onBeat = (pulseIndex, totalPulses, isAccent) => {
  lightBeat(beatRingEl, pulseIndex, isAccent);
  if (stageBeatRingEl.dataset.mirrored === '1') lightBeat(stageBeatRingEl, pulseIndex, isAccent);
};

bpmInput.addEventListener('change', () => {
  const val = engine.setBpm(bpmInput.value);
  bpmInput.value = String(val);
  syncStageBpmDisplay();
});

$$('.bpm-step').forEach((btn) => {
  btn.addEventListener('click', () => {
    const step = Number(btn.dataset.step);
    engine.setBpm(engine.bpm + step);
    refreshBpmField();
    syncStageBpmDisplay();
  });
});

$('#bpmHalf').addEventListener('click', () => {
  engine.setBpm(Math.round(engine.bpm / 2));
  refreshBpmField();
  syncStageBpmDisplay();
});
$('#bpmDouble').addEventListener('click', () => {
  engine.setBpm(engine.bpm * 2);
  refreshBpmField();
  syncStageBpmDisplay();
});

meterSelect.addEventListener('change', () => {
  engine.setMeter(meterSelect.value);
  buildBeatRing(beatRingEl, getMeter(engine.meterId).pulses.length);
  buildBeatRing(stageBeatRingEl, getMeter(engine.meterId).pulses.length);
  syncStageMeterDisplay();
});

patternSelect.addEventListener('change', () => {
  engine.setPattern(patternSelect.value);
});

volumeSlider.addEventListener('input', () => {
  engine.setVolume(volumeSlider.value);
});

async function toggleTransport() {
  if (engine.isRunning) {
    engine.stop();
    setTransportUI(false);
  } else {
    await engine.start();
    setTransportUI(engine.isRunning);
  }
}

function setTransportUI(running) {
  startStopBtn.textContent = running ? 'STOP' : 'START';
  startStopBtn.classList.toggle('transport-btn--stop', running);
  startStopBtn.classList.toggle('transport-btn--start', !running);
  if (!running) {
    beatRingEl.querySelectorAll('.beat-dot').forEach((d) => d.classList.remove('lit', 'accent'));
  }
}

startStopBtn.addEventListener('click', toggleTransport);

/* -------- Tap tempo -------- */
let tapTimes = [];
$('#tapTempo').addEventListener('click', () => {
  const now = performance.now();
  if (tapTimes.length && now - tapTimes[tapTimes.length - 1] > 2000) {
    tapTimes = []; // gap too long — start a fresh tap sequence
  }
  tapTimes.push(now);
  if (tapTimes.length > 6) tapTimes.shift();

  if (tapTimes.length >= 2) {
    const intervals = [];
    for (let i = 1; i < tapTimes.length; i++) intervals.push(tapTimes[i] - tapTimes[i - 1]);
    const valid = intervals.filter((iv) => iv > 150 && iv < 2000); // ignore unreasonable gaps
    if (valid.length) {
      const avgMs = valid.reduce((a, b) => a + b, 0) / valid.length;
      const bpm = Math.round(60000 / avgMs);
      engine.setBpm(bpm);
      refreshBpmField();
      syncStageBpmDisplay();
    }
  }
});

/* ============================== LIBRARY VIEW ============================== */

const songListEl = $('#songList');
const songEmptyEl = $('#songEmpty');
const songSearchEl = $('#songSearch');
const songFormOverlay = $('#songFormOverlay');
const songForm = $('#songForm');
const songFormTitle = $('#songFormTitle');
const songTitleInput = $('#songTitle');
const songBpmInput = $('#songBpm');
const songMeterSelect = $('#songMeter');
const songPatternSelect = $('#songPattern');
const songCountInInput = $('#songCountIn');
const songNotesInput = $('#songNotes');

fillSelectWithMeters(songMeterSelect);
fillSelectWithPatterns(songPatternSelect);

function renderSongList() {
  const q = state.librarySearch.trim().toLowerCase();
  const filtered = state.songs
    .filter((s) => !q || s.title.toLowerCase().includes(q))
    .sort((a, b) => a.title.localeCompare(b.title));

  songListEl.innerHTML = '';
  filtered.forEach((song) => {
    const li = document.createElement('li');
    li.className = 'item-row';
    li.innerHTML = `
      <div class="item-main">
        <div class="item-title">${escapeHtml(song.title)}</div>
        <div class="item-sub">${song.bpm} BPM · ${song.meter} · ${getPattern(song.pattern).label}</div>
      </div>
      <div class="item-actions">
        <button class="icon-btn" data-action="load" aria-label="Load into metronome">▶</button>
        <button class="icon-btn" data-action="edit" aria-label="Edit song">✎</button>
        <button class="icon-btn icon-btn--danger" data-action="delete" aria-label="Delete song">✕</button>
      </div>`;
    li.querySelector('[data-action="load"]').addEventListener('click', () => loadSongIntoEngine(song));
    li.querySelector('[data-action="edit"]').addEventListener('click', () => openSongForm(song.id));
    li.querySelector('[data-action="delete"]').addEventListener('click', () => deleteSong(song.id));
    songListEl.appendChild(li);
  });
  songEmptyEl.classList.toggle('visible', filtered.length === 0);
}

function escapeHtml(str) {
  const div = document.createElement('div');
  div.textContent = str;
  return div.innerHTML;
}

function loadSongIntoEngine(song) {
  engine.setBpm(song.bpm);
  engine.setMeter(song.meter);
  engine.setPattern(song.pattern);
  meterSelect.value = engine.meterId;
  patternSelect.value = engine.patternId;
  refreshBpmField();
  buildBeatRing(beatRingEl, getMeter(engine.meterId).pulses.length);
  switchView('metronome');
}

function openSongForm(songId) {
  state.editingSongId = songId || null;
  const song = songId ? findSong(songId) : null;
  songFormTitle.textContent = song ? 'Edit Song' : 'New Song';
  songTitleInput.value = song ? song.title : '';
  songBpmInput.value = song ? song.bpm : 120;
  songMeterSelect.value = song ? song.meter : '4/4';
  songPatternSelect.value = song ? song.pattern : 'quarter';
  songCountInInput.checked = song ? !!song.countIn : false;
  songNotesInput.value = song ? song.notes || '' : '';
  songFormOverlay.classList.remove('hidden');
  songTitleInput.focus();
}

function closeSongForm() {
  songFormOverlay.classList.add('hidden');
  state.editingSongId = null;
}

$('#newSongBtn').addEventListener('click', () => openSongForm(null));
$('#songCancelBtn').addEventListener('click', closeSongForm);

songForm.addEventListener('submit', (e) => {
  e.preventDefault();
  const data = {
    title: songTitleInput.value,
    bpm: songBpmInput.value,
    meter: songMeterSelect.value,
    pattern: songPatternSelect.value,
    countIn: songCountInInput.checked,
    notes: songNotesInput.value,
  };
  if (state.editingSongId) {
    const song = findSong(state.editingSongId);
    if (song) {
      const updated = makeSong(data);
      Object.assign(song, { ...updated, id: song.id, createdAt: song.createdAt });
    }
  } else {
    state.songs.push(makeSong(data));
  }
  persistSongs();
  renderSongList();
  refreshSetlistSongsView();
  closeSongForm();
});

function deleteSong(id) {
  if (!confirm('Delete this song? This cannot be undone.')) return;
  state.songs = state.songs.filter((s) => s.id !== id);
  state.setlists.forEach((sl) => { sl.songIds = sl.songIds.filter((sid) => sid !== id); });
  persistSongs();
  persistSetlists();
  renderSongList();
  refreshSetlistSongsView();
  renderStageSong();
}

songSearchEl.addEventListener('input', () => {
  state.librarySearch = songSearchEl.value;
  renderSongList();
});

/* ============================== SETLISTS VIEW ============================== */

const setlistSelect = $('#setlistSelect');
const setlistToolbar = $('#setlistToolbar');
const setlistSongsEl = $('#setlistSongs');
const setlistEmptyEl = $('#setlistEmpty');
const addSongsOverlay = $('#addSongsOverlay');
const addSongsList = $('#addSongsList');

let currentSetlistViewId = null;

function renderSetlistSelect() {
  const prev = setlistSelect.value;
  setlistSelect.innerHTML = '';
  if (state.setlists.length === 0) {
    const opt = document.createElement('option');
    opt.textContent = 'No setlists yet';
    opt.value = '';
    setlistSelect.appendChild(opt);
  }
  state.setlists.forEach((sl) => {
    const opt = document.createElement('option');
    opt.value = sl.id;
    opt.textContent = sl.name;
    setlistSelect.appendChild(opt);
  });
  if (state.setlists.find((s) => s.id === prev)) setlistSelect.value = prev;
  currentSetlistViewId = setlistSelect.value || null;
  refreshSetlistSongsView();
}

function refreshSetlistSongsView() {
  const setlist = currentSetlistViewId ? findSetlist(currentSetlistViewId) : null;
  setlistToolbar.classList.toggle('hidden', !setlist);
  setlistSongsEl.innerHTML = '';

  if (!setlist) {
    setlistEmptyEl.classList.add('visible');
    setlistEmptyEl.textContent = state.setlists.length
      ? 'Select a setlist above.'
      : "Create a setlist, then add songs from your library.";
    return;
  }

  const songs = setlist.songIds.map(findSong).filter(Boolean);
  setlistEmptyEl.classList.toggle('visible', songs.length === 0);
  setlistEmptyEl.textContent = 'No songs in this setlist yet. Tap "+ Add Songs".';

  songs.forEach((song, idx) => {
    const li = document.createElement('li');
    li.className = 'item-row';
    li.draggable = true;
    li.dataset.songId = song.id;
    li.innerHTML = `
      <div class="reorder-controls">
        <button data-action="up" aria-label="Move up" ${idx === 0 ? 'disabled' : ''}>▲</button>
        <button data-action="down" aria-label="Move down" ${idx === songs.length - 1 ? 'disabled' : ''}>▼</button>
      </div>
      <div class="item-main">
        <div class="item-title">${idx + 1}. ${escapeHtml(song.title)}</div>
        <div class="item-sub">${song.bpm} BPM · ${song.meter}</div>
      </div>
      <div class="item-actions">
        <button class="icon-btn icon-btn--danger" data-action="remove" aria-label="Remove from setlist">✕</button>
      </div>`;
    li.querySelector('[data-action="up"]').addEventListener('click', () => moveSongInSetlist(setlist, idx, idx - 1));
    li.querySelector('[data-action="down"]').addEventListener('click', () => moveSongInSetlist(setlist, idx, idx + 1));
    li.querySelector('[data-action="remove"]').addEventListener('click', () => {
      setlist.songIds = setlist.songIds.filter((id) => id !== song.id);
      persistSetlists();
      refreshSetlistSongsView();
    });
    attachDragHandlers(li, setlist);
    setlistSongsEl.appendChild(li);
  });
}

function moveSongInSetlist(setlist, from, to) {
  if (to < 0 || to >= setlist.songIds.length) return;
  const arr = setlist.songIds;
  [arr[from], arr[to]] = [arr[to], arr[from]];
  persistSetlists();
  refreshSetlistSongsView();
}

function attachDragHandlers(li, setlist) {
  li.addEventListener('dragstart', (e) => {
    e.dataTransfer.setData('text/plain', li.dataset.songId);
    li.classList.add('dragging');
  });
  li.addEventListener('dragend', () => li.classList.remove('dragging'));
  li.addEventListener('dragover', (e) => e.preventDefault());
  li.addEventListener('drop', (e) => {
    e.preventDefault();
    const draggedId = e.dataTransfer.getData('text/plain');
    const targetId = li.dataset.songId;
    if (draggedId === targetId) return;
    const arr = setlist.songIds;
    const from = arr.indexOf(draggedId);
    const to = arr.indexOf(targetId);
    if (from === -1 || to === -1) return;
    arr.splice(from, 1);
    arr.splice(to, 0, draggedId);
    persistSetlists();
    refreshSetlistSongsView();
  });
}

setlistSelect.addEventListener('change', () => {
  currentSetlistViewId = setlistSelect.value || null;
  refreshSetlistSongsView();
});

$('#newSetlistBtn').addEventListener('click', () => {
  const name = prompt('Setlist name:');
  if (!name || !name.trim()) return;
  const setlist = { id: Storage.newSetlistId(), name: name.trim(), songIds: [] };
  state.setlists.push(setlist);
  persistSetlists();
  renderSetlistSelect();
  setlistSelect.value = setlist.id;
  currentSetlistViewId = setlist.id;
  refreshSetlistSongsView();
});

$('#renameSetlistBtn').addEventListener('click', () => {
  const setlist = findSetlist(currentSetlistViewId);
  if (!setlist) return;
  const name = prompt('Rename setlist:', setlist.name);
  if (!name || !name.trim()) return;
  setlist.name = name.trim();
  persistSetlists();
  renderSetlistSelect();
  setlistSelect.value = setlist.id;
  renderStageSetlistName();
});

$('#deleteSetlistBtn').addEventListener('click', () => {
  const setlist = findSetlist(currentSetlistViewId);
  if (!setlist) return;
  if (!confirm(`Delete setlist "${setlist.name}"?`)) return;
  state.setlists = state.setlists.filter((s) => s.id !== setlist.id);
  if (state.activeSetlistId === setlist.id) {
    state.activeSetlistId = null;
    state.stageIndex = 0;
  }
  persistSetlists();
  renderSetlistSelect();
  renderStageSong();
});

$('#setActiveBtn').addEventListener('click', () => {
  const setlist = findSetlist(currentSetlistViewId);
  if (!setlist) return;
  state.activeSetlistId = setlist.id;
  state.stageIndex = 0;
  renderStageSong();
  switchView('stage');
});

$('#addSongsBtn').addEventListener('click', () => {
  const setlist = findSetlist(currentSetlistViewId);
  if (!setlist) return;
  addSongsList.innerHTML = '';
  state.songs.slice().sort((a, b) => a.title.localeCompare(b.title)).forEach((song) => {
    const already = setlist.songIds.includes(song.id);
    const li = document.createElement('li');
    li.className = 'item-row' + (already ? ' selected' : '');
    li.innerHTML = `
      <div class="item-main">
        <div class="item-title">${escapeHtml(song.title)}</div>
        <div class="item-sub">${song.bpm} BPM · ${song.meter}</div>
      </div>
      <div class="item-actions"><button class="icon-btn" data-action="toggle">${already ? '✓' : '+'}</button></div>`;
    li.querySelector('[data-action="toggle"]').addEventListener('click', () => {
      const idx = setlist.songIds.indexOf(song.id);
      if (idx === -1) setlist.songIds.push(song.id);
      else setlist.songIds.splice(idx, 1);
      persistSetlists();
      li.classList.toggle('selected');
      li.querySelector('[data-action="toggle"]').textContent = setlist.songIds.includes(song.id) ? '✓' : '+';
    });
    addSongsList.appendChild(li);
  });
  addSongsOverlay.classList.remove('hidden');
});

$('#addSongsDoneBtn').addEventListener('click', () => {
  addSongsOverlay.classList.add('hidden');
  refreshSetlistSongsView();
});

/* ============================== STAGE MODE ============================== */

const stageSetlistNameEl = $('#stageSetlistName');
const stageSongTitleEl = $('#stageSongTitle');
const stagePositionEl = $('#stagePosition');
const stageBpmEl = $('#stageBpm');
const stageMeterEl = $('#stageMeter');
const stageBeatRingEl = $('#stageBeatRing');
const stagePrevBtn = $('#stagePrevBtn');
const stageNextBtn = $('#stageNextBtn');
const stageStartStopBtn = $('#stageStartStopBtn');
const stageFullscreenBtn = $('#stageFullscreenBtn');
const stageCountInEl = $('#stageCountIn');
const stageCountInNumEl = $('#stageCountInNum');

stageBeatRingEl.dataset.mirrored = '1';
buildBeatRing(stageBeatRingEl, getMeter(engine.meterId).pulses.length);

function activeStageSetlist() {
  return state.activeSetlistId ? findSetlist(state.activeSetlistId) : null;
}

function activeStageSongs() {
  const setlist = activeStageSetlist();
  if (!setlist) return [];
  return setlist.songIds.map(findSong).filter(Boolean);
}

function renderStageSetlistName() {
  const setlist = activeStageSetlist();
  stageSetlistNameEl.textContent = setlist ? setlist.name : 'No setlist selected';
}

function renderStageSong() {
  renderStageSetlistName();
  const songs = activeStageSongs();
  if (!songs.length) {
    stageSongTitleEl.textContent = 'Select a setlist';
    stagePositionEl.textContent = '— / —';
    stageBpmEl.textContent = '—';
    stageMeterEl.textContent = '—';
    stagePrevBtn.disabled = true;
    stageNextBtn.disabled = true;
    return;
  }
  if (state.stageIndex >= songs.length) state.stageIndex = songs.length - 1;
  if (state.stageIndex < 0) state.stageIndex = 0;
  const song = songs[state.stageIndex];

  stageSongTitleEl.textContent = song.title;
  stagePositionEl.textContent = `${state.stageIndex + 1} / ${songs.length}`;
  stageBpmEl.textContent = String(song.bpm);
  stageMeterEl.textContent = song.meter;
  stagePrevBtn.disabled = state.stageIndex === 0;
  stageNextBtn.disabled = state.stageIndex === songs.length - 1;

  // Loading a song never auto-starts audio — avoids surprise sound on stage.
  if (stageRunning) stopStageTransport();
  engine.setBpm(song.bpm);
  engine.setMeter(song.meter);
  engine.setPattern(song.pattern);
  meterSelect.value = engine.meterId;
  patternSelect.value = engine.patternId;
  refreshBpmField();
  buildBeatRing(beatRingEl, getMeter(engine.meterId).pulses.length);
  buildBeatRing(stageBeatRingEl, getMeter(engine.meterId).pulses.length);
}

function syncStageBpmDisplay() { stageBpmEl.textContent = String(engine.bpm); }
function syncStageMeterDisplay() { stageMeterEl.textContent = engine.meterId; }

stagePrevBtn.addEventListener('click', () => {
  if (state.stageIndex > 0) { state.stageIndex -= 1; renderStageSong(); }
});
stageNextBtn.addEventListener('click', () => {
  const songs = activeStageSongs();
  if (state.stageIndex < songs.length - 1) { state.stageIndex += 1; renderStageSong(); }
});

async function startStageTransport() {
  const songs = activeStageSongs();
  const song = songs[state.stageIndex];
  if (!song) return;

  if (song.countIn) {
    stageCountInActive = true;
    stageCountInEl.classList.remove('hidden');
    const beats = getMeter(engine.meterId).pulses.length;
    await engine.countIn(
      beats,
      (remaining) => { stageCountInNumEl.textContent = String(remaining); },
      async () => {
        stageCountInEl.classList.add('hidden');
        stageCountInActive = false;
        await engine.start();
        stageRunning = engine.isRunning;
        setStageTransportUI(stageRunning);
        acquireWakeLock();
      }
    );
  } else {
    await engine.start();
    stageRunning = engine.isRunning;
    setStageTransportUI(stageRunning);
    acquireWakeLock();
  }
}

function stopStageTransport() {
  engine.stop();
  stageRunning = false;
  stageCountInActive = false;
  stageCountInEl.classList.add('hidden');
  setStageTransportUI(false);
  releaseWakeLock();
}

function setStageTransportUI(running) {
  stageStartStopBtn.textContent = running ? 'STOP' : 'START';
  stageStartStopBtn.classList.toggle('transport-btn--stop', running);
  stageStartStopBtn.classList.toggle('transport-btn--start', !running);
  setTransportUI(running); // keep metronome view's own button in sync too
  if (!running) stageBeatRingEl.querySelectorAll('.beat-dot').forEach((d) => d.classList.remove('lit', 'accent'));
}

stageStartStopBtn.addEventListener('click', () => {
  if (stageCountInActive) return;
  if (stageRunning) stopStageTransport();
  else startStageTransport();
});

/* -------- Fullscreen -------- */
stageFullscreenBtn.addEventListener('click', async () => {
  try {
    const stageEl = document.getElementById('view-stage');
    if (!document.fullscreenElement) {
      if (stageEl.requestFullscreen) await stageEl.requestFullscreen();
      else if (stageEl.webkitRequestFullscreen) stageEl.webkitRequestFullscreen();
      else showNotice('Fullscreen is not supported on this browser.');
    } else {
      if (document.exitFullscreen) await document.exitFullscreen();
    }
  } catch {
    showNotice('Fullscreen is not supported on this browser.');
  }
});

/* -------- Wake Lock -------- */
async function acquireWakeLock() {
  try {
    if ('wakeLock' in navigator) {
      wakeLockSentinel = await navigator.wakeLock.request('screen');
    }
  } catch {
    // Not supported or denied — fail silently, performance still works.
  }
}
function releaseWakeLock() {
  if (wakeLockSentinel) {
    wakeLockSentinel.release().catch(() => {});
    wakeLockSentinel = null;
  }
}
document.addEventListener('visibilitychange', async () => {
  if (document.visibilityState === 'visible' && stageRunning && !wakeLockSentinel) {
    await acquireWakeLock();
  }
});

/* ============================== INIT ============================== */

renderSongList();
renderSetlistSelect();
renderStageSong();
refreshBpmField();
switchView('metronome');
