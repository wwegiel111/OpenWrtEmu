'use strict';

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { buildDefaultConfig, DEFAULT_CREDENTIALS } = require('./defaults');

const DATA_DIR = path.join(__dirname, '..', 'data');
const STATE_FILE = path.join(DATA_DIR, 'state.json');

/*
 * Magazyn stanu emulatora.
 *  - running : konfiguracja aktualnie "działająca" w systemie
 *  - staged  : kopia robocza edytowana przez formularze (jak w LuCI)
 *  - changes : licznik niezapisanych zmian (badge "Unsaved Changes")
 *  - auth    : dane logowania (zmienialne w System > Administration)
 *  - bootTime: znacznik startu (do liczenia uptime)
 */
let state = null;

function deepClone(obj) {
  return JSON.parse(JSON.stringify(obj));
}

function freshState() {
  const cfg = buildDefaultConfig();
  return {
    running: cfg,
    staged: deepClone(cfg),
    changes: [],
    auth: { ...DEFAULT_CREDENTIALS },
    bootTime: Date.now(),
    resetCount: 0
  };
}

function ensureDataDir() {
  if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
}

function load() {
  ensureDataDir();
  try {
    if (fs.existsSync(STATE_FILE)) {
      const raw = fs.readFileSync(STATE_FILE, 'utf8');
      state = JSON.parse(raw);
      // Na nowo licz uptime od startu procesu, ale zachowaj konfigurację.
      state.bootTime = Date.now();
      if (!state.staged) state.staged = deepClone(state.running);
      if (!Array.isArray(state.changes)) state.changes = [];
    } else {
      state = freshState();
      persist();
    }
  } catch (e) {
    console.error('[store] Nie udało się wczytać stanu, tworzę nowy:', e.message);
    state = freshState();
    persist();
  }
  return state;
}

function persist() {
  ensureDataDir();
  fs.writeFileSync(STATE_FILE, JSON.stringify(state, null, 2), 'utf8');
}

function getState() {
  if (!state) load();
  return state;
}

/* ---- Konfiguracja ---- */

function getStaged() {
  return getState().staged;
}

function getRunning() {
  return getState().running;
}

// Zapisuje (stage) całą sekcję konfiguracji (np. 'network', 'wireless').
// Rejestruje wpis w liczniku zmian. NIE stosuje jeszcze zmian (jak "Save" w LuCI).
function stageSection(configName, data) {
  const s = getState();
  s.staged[configName] = data;
  const label = configName;
  if (!s.changes.includes(label)) s.changes.push(label);
  persist();
  return s.staged[configName];
}

// Stosuje wszystkie zmiany (running = staged) — odpowiednik "Save & Apply".
function apply() {
  const s = getState();
  s.running = deepClone(s.staged);
  s.changes = [];
  persist();
  return s.running;
}

// Odrzuca niezapisane zmiany (staged = running) — odpowiednik "Revert".
function revert() {
  const s = getState();
  s.staged = deepClone(s.running);
  s.changes = [];
  persist();
  return s.staged;
}

function changeCount() {
  return getState().changes.length;
}

// Pełny reset do ustawień fabrycznych.
function factoryReset() {
  const prev = getState();
  const count = (prev.resetCount || 0) + 1;
  state = freshState();
  state.resetCount = count;
  persist();
  return state;
}

/* ---- Autoryzacja ---- */

function checkCredentials(username, password) {
  const a = getState().auth;
  if (username !== a.username) return false;
  // Akceptuj zapisane hasło; dla świeżego systemu (puste hasło) akceptuj też "admin".
  if (a.password === '') return password === '' || password === 'admin';
  return password === a.password;
}

function setPassword(newPassword) {
  getState().auth.password = newPassword;
  persist();
}

/* ---- Pomocnicze ---- */

function genToken() {
  return crypto.randomBytes(24).toString('hex');
}

module.exports = {
  load,
  getState,
  getStaged,
  getRunning,
  stageSection,
  apply,
  revert,
  changeCount,
  factoryReset,
  checkCredentials,
  setPassword,
  genToken,
  deepClone
};
