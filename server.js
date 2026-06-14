'use strict';

const http = require('http');
const fs = require('fs');
const path = require('path');
const url = require('url');

const store = require('./lib/store');
const status = require('./lib/status');
const tools = require('./lib/tools');
const { FIRMWARE } = require('./lib/defaults');

const PORT = process.env.PORT || 3000;
const PUBLIC_DIR = path.join(__dirname, 'public');

store.load();

/* ---------- Sesje (w pamięci) ---------- */
const sessions = new Map(); // token -> { username, created }
const SESSION_TTL = 1000 * 60 * 60 * 8; // 8h

function newSession(username) {
  const token = store.genToken();
  sessions.set(token, { username, created: Date.now() });
  return token;
}
function getSession(token) {
  const s = sessions.get(token);
  if (!s) return null;
  if (Date.now() - s.created > SESSION_TTL) {
    sessions.delete(token);
    return null;
  }
  return s;
}
function parseCookies(req) {
  const header = req.headers.cookie || '';
  const out = {};
  header.split(';').forEach((p) => {
    const i = p.indexOf('=');
    if (i > -1) out[p.slice(0, i).trim()] = decodeURIComponent(p.slice(i + 1).trim());
  });
  return out;
}
function authToken(req) {
  const cookies = parseCookies(req);
  if (cookies.sysauth) return cookies.sysauth;
  const h = req.headers['authorization'];
  if (h && h.startsWith('Bearer ')) return h.slice(7);
  return null;
}
function requireAuth(req) {
  const token = authToken(req);
  if (!token) return null;
  return getSession(token);
}

/* ---------- Pomocnicze odpowiedzi ---------- */
function sendJson(res, code, obj, extraHeaders) {
  const body = JSON.stringify(obj);
  res.writeHead(code, Object.assign({
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store'
  }, extraHeaders || {}));
  res.end(body);
}
function readBody(req) {
  return new Promise((resolve) => {
    let data = '';
    req.on('data', (c) => {
      data += c;
      if (data.length > 1e6) req.destroy();
    });
    req.on('end', () => {
      if (!data) return resolve({});
      try { resolve(JSON.parse(data)); } catch { resolve({}); }
    });
  });
}

/* ---------- Statyczne pliki ---------- */
const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
  '.woff2': 'font/woff2'
};
function serveStatic(req, res, pathname) {
  let rel = pathname === '/' ? '/index.html' : pathname;
  rel = rel.replace(/\.\./g, '');
  const file = path.join(PUBLIC_DIR, rel);
  if (!file.startsWith(PUBLIC_DIR)) {
    res.writeHead(403); return res.end('Forbidden');
  }
  fs.readFile(file, (err, data) => {
    if (err) {
      // SPA fallback -> index.html (router hash i tak działa)
      if (path.extname(file) === '') {
        return fs.readFile(path.join(PUBLIC_DIR, 'index.html'), (e2, d2) => {
          if (e2) { res.writeHead(404); return res.end('Not found'); }
          res.writeHead(200, { 'Content-Type': MIME['.html'] });
          res.end(d2);
        });
      }
      res.writeHead(404); return res.end('Not found');
    }
    const ext = path.extname(file);
    res.writeHead(200, { 'Content-Type': MIME[ext] || 'application/octet-stream' });
    res.end(data);
  });
}

/* ---------- API ---------- */
async function handleApi(req, res, pathname, query) {
  const method = req.method.toUpperCase();
  const seg = pathname.replace(/^\/api\/?/, '').split('/').filter(Boolean);

  // --- logowanie (bez autoryzacji) ---
  if (seg[0] === 'login' && method === 'POST') {
    const body = await readBody(req);
    const { username, password } = body;
    if (store.checkCredentials(username || '', password || '')) {
      const token = newSession(username);
      const cookie = `sysauth=${token}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${SESSION_TTL / 1000}`;
      return sendJson(res, 200, { ok: true, token, username }, { 'Set-Cookie': cookie });
    }
    return sendJson(res, 401, { ok: false, error: 'Nieprawidłowa nazwa użytkownika lub hasło.' });
  }

  if (seg[0] === 'firmware' && method === 'GET') {
    return sendJson(res, 200, FIRMWARE);
  }

  // --- od tego miejsca wymagana autoryzacja ---
  const session = requireAuth(req);
  if (!session) return sendJson(res, 401, { ok: false, error: 'Brak autoryzacji. Zaloguj się.' });

  if (seg[0] === 'logout' && method === 'POST') {
    const token = authToken(req);
    sessions.delete(token);
    const cookie = 'sysauth=; Path=/; HttpOnly; Max-Age=0';
    return sendJson(res, 200, { ok: true }, { 'Set-Cookie': cookie });
  }

  if (seg[0] === 'session' && method === 'GET') {
    return sendJson(res, 200, { ok: true, username: session.username, changes: store.changeCount() });
  }

  // --- status (dynamiczny) ---
  if (seg[0] === 'status') {
    if (seg[1] === 'overview') return sendJson(res, 200, status.overview());
    if (seg[1] === 'interfaces') return sendJson(res, 200, status.interfaceStatus());
    if (seg[1] === 'wireless') return sendJson(res, 200, status.wirelessStatus());
    if (seg[1] === 'leases') return sendJson(res, 200, status.dhcpLeases());
    if (!seg[1]) return sendJson(res, 200, {
      overview: status.overview(),
      interfaces: status.interfaceStatus(),
      wireless: status.wirelessStatus(),
      leases: status.dhcpLeases()
    });
  }

  // --- konfiguracja ---
  if (seg[0] === 'config') {
    // /api/config            -> cała staged
    // /api/config/:name      -> jedna sekcja (GET) / zapis (PUT)
    if (!seg[1]) {
      if (method === 'GET') {
        return sendJson(res, 200, { staged: store.getStaged(), changes: store.changeCount() });
      }
    } else {
      const name = seg[1];
      if (method === 'GET') {
        return sendJson(res, 200, store.getStaged()[name] || {});
      }
      if (method === 'PUT') {
        const body = await readBody(req);
        const saved = store.stageSection(name, body);
        return sendJson(res, 200, { ok: true, section: name, data: saved, changes: store.changeCount() });
      }
    }
  }

  // --- workflow zmian (Save & Apply / Revert) ---
  if (seg[0] === 'apply' && method === 'POST') {
    store.apply();
    return sendJson(res, 200, { ok: true, changes: 0, running: store.getRunning() });
  }
  if (seg[0] === 'revert' && method === 'POST') {
    store.revert();
    return sendJson(res, 200, { ok: true, changes: 0, staged: store.getStaged() });
  }
  if (seg[0] === 'changes' && method === 'GET') {
    return sendJson(res, 200, { changes: store.getState().changes, count: store.changeCount() });
  }

  // --- diagnostyka (ping / traceroute / nslookup) ---
  if (seg[0] === 'diag' && method === 'POST') {
    const body = await readBody(req);
    const out = tools.diag(body.tool, (body.target || '').trim(), body.count);
    return sendJson(res, 200, { ok: true, tool: body.tool, target: body.target, output: out });
  }

  // --- logi systemowe ---
  if (seg[0] === 'log' && method === 'GET') {
    if (seg[1] === 'kernel') return sendJson(res, 200, { type: 'kernel', output: tools.dmesg() });
    return sendJson(res, 200, { type: 'system', output: tools.syslog() });
  }

  // --- ponowne uruchomienie (reboot) ---
  if (seg[0] === 'reboot' && method === 'POST') {
    store.reboot();
    sessions.clear(); // po restarcie trzeba zalogować się ponownie (jak w LuCI)
    const cookie = 'sysauth=; Path=/; HttpOnly; Max-Age=0';
    return sendJson(res, 200, { ok: true, message: 'Urządzenie jest uruchamiane ponownie...' }, { 'Set-Cookie': cookie });
  }

  // --- reset fabryczny ---
  if (seg[0] === 'reset' && method === 'POST') {
    store.factoryReset();
    // unieważnij wszystkie sesje (jak po restarcie urządzenia)
    sessions.clear();
    const cookie = 'sysauth=; Path=/; HttpOnly; Max-Age=0';
    return sendJson(res, 200, { ok: true, message: 'Przywrócono ustawienia fabryczne.' }, { 'Set-Cookie': cookie });
  }

  // --- zmiana hasła ---
  if (seg[0] === 'password' && method === 'POST') {
    const body = await readBody(req);
    if (typeof body.password !== 'string' || body.password.length < 0) {
      return sendJson(res, 400, { ok: false, error: 'Nieprawidłowe hasło.' });
    }
    store.setPassword(body.password);
    return sendJson(res, 200, { ok: true, message: 'Hasło zostało zmienione.' });
  }

  // --- kopia zapasowa / przywracanie ---
  if (seg[0] === 'backup' && method === 'GET') {
    return sendJson(res, 200, {
      generated: new Date().toISOString(),
      firmware: FIRMWARE.version,
      config: store.getRunning(),
      auth: { username: store.getState().auth.username }
    }, { 'Content-Disposition': 'attachment; filename="backup-archer-c6.json"' });
  }
  if (seg[0] === 'restore' && method === 'POST') {
    const body = await readBody(req);
    if (!body || !body.config) return sendJson(res, 400, { ok: false, error: 'Nieprawidłowy plik kopii zapasowej.' });
    const s = store.getState();
    s.running = body.config;
    s.staged = store.deepClone(body.config);
    s.changes = [];
    return sendJson(res, 200, { ok: true, message: 'Konfiguracja została przywrócona z kopii zapasowej.' });
  }

  return sendJson(res, 404, { ok: false, error: 'Nieznany endpoint API: /' + seg.join('/') });
}

/* ---------- Serwer ---------- */
const server = http.createServer((req, res) => {
  const parsed = url.parse(req.url, true);
  const pathname = parsed.pathname;

  if (pathname.startsWith('/api/') || pathname === '/api') {
    handleApi(req, res, pathname, parsed.query).catch((e) => {
      console.error('[api] błąd:', e);
      sendJson(res, 500, { ok: false, error: 'Wewnętrzny błąd serwera.' });
    });
    return;
  }
  serveStatic(req, res, pathname);
});

const HOST = process.env.HOST || '0.0.0.0'; // 0.0.0.0 = nasłuch na wszystkich interfejsach (wymagane na Render/hostingach)
server.listen(PORT, HOST, () => {
  console.log('');
  console.log('  ╔══════════════════════════════════════════════════════════╗');
  console.log('  ║   Emulator OpenWrt / LuCI  —  TP-Link Archer C6           ║');
  console.log('  ║   ' + FIRMWARE.version.padEnd(54) + ' ║');
  console.log('  ╠══════════════════════════════════════════════════════════╣');
  console.log('  ║   Panel:  http://localhost:' + String(PORT).padEnd(31) + '║');
  console.log('  ║   Login:  root   Hasło: (puste) lub  admin                ║');
  console.log('  ╚══════════════════════════════════════════════════════════╝');
  console.log('');
});
