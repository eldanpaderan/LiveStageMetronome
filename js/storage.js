// storage.js
// localStorage-backed persistence for songs and setlists. All reads are
// defensively parsed so corrupted or hand-edited storage can never crash
// the app — we fall back to an empty, valid dataset and surface a warning.

const KEYS = {
  songs: 'stagemetronome.songs.v1',
  setlists: 'stagemetronome.setlists.v1',
};

function uid() {
  return 'id_' + Date.now().toString(36) + '_' + Math.random().toString(36).slice(2, 8);
}

function safeParse(raw, fallback) {
  if (!raw) return fallback;
  try {
    const parsed = JSON.parse(raw);
    return parsed;
  } catch {
    return fallback;
  }
}

function isValidSong(s) {
  return (
    s && typeof s === 'object' &&
    typeof s.id === 'string' &&
    typeof s.title === 'string' &&
    Number.isFinite(Number(s.bpm)) &&
    typeof s.meter === 'string' &&
    typeof s.pattern === 'string'
  );
}

function isValidSetlist(sl) {
  return (
    sl && typeof sl === 'object' &&
    typeof sl.id === 'string' &&
    typeof sl.name === 'string' &&
    Array.isArray(sl.songIds)
  );
}

export const Storage = {
  loadSongs() {
    const raw = localStorage.getItem(KEYS.songs);
    const parsed = safeParse(raw, []);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(isValidSong);
  },

  saveSongs(songs) {
    try {
      localStorage.setItem(KEYS.songs, JSON.stringify(songs));
      return true;
    } catch {
      return false;
    }
  },

  loadSetlists() {
    const raw = localStorage.getItem(KEYS.setlists);
    const parsed = safeParse(raw, []);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(isValidSetlist);
  },

  saveSetlists(setlists) {
    try {
      localStorage.setItem(KEYS.setlists, JSON.stringify(setlists));
      return true;
    } catch {
      return false;
    }
  },

  newSongId: uid,
  newSetlistId: uid,
};

export function makeSong({ title, bpm, meter, pattern, countIn, notes }) {
  return {
    id: uid(),
    title: (title || 'Untitled Song').trim(),
    bpm: Math.min(500, Math.max(10, Math.round(Number(bpm) || 120))),
    meter: meter || '4/4',
    pattern: pattern || 'quarter',
    countIn: !!countIn,
    notes: notes || '',
    createdAt: Date.now(),
  };
}
