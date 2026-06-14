'use strict';

const App = (function () {
  const { el, clear, toast } = UI;

  // Struktura menu (odwzorowanie LuCI)
  const MENU = [
    { id: 'status', label: 'Status', sub: [
      { label: 'Przegląd', route: '#/admin/status/overview' }
    ]},
    { id: 'system', label: 'System', sub: [
      { label: 'System', route: '#/admin/system/system' },
      { label: 'Administracja', route: '#/admin/system/admin' },
      { label: 'Kopia zapasowa / Reset', route: '#/admin/system/flash' }
    ]},
    { id: 'network', label: 'Sieć', sub: [
      { label: 'Interfejsy', route: '#/admin/network/network' },
      { label: 'Sieć bezprzewodowa', route: '#/admin/network/wireless' },
      { label: 'DHCP i DNS', route: '#/admin/network/dhcp' },
      { label: 'Switch (VLAN)', route: '#/admin/network/vlan' }
    ]},
    { id: 'help', label: 'Pomoc', sub: [
      { label: 'Przygotowanie do egzaminu', route: '#/admin/help' }
    ]}
  ];

  const ROUTES = {
    '#/admin/status/overview': { section: 'status', render: Pages.statusOverview },
    '#/admin/network/network': { section: 'network', render: Pages.networkInterfaces },
    '#/admin/network/wireless': { section: 'network', render: Pages.networkWireless },
    '#/admin/network/dhcp': { section: 'network', render: Pages.networkDhcp },
    '#/admin/network/vlan': { section: 'network', render: Pages.networkVlan },
    '#/admin/system/system': { section: 'system', render: Pages.systemSystem },
    '#/admin/system/admin': { section: 'system', render: Pages.systemAdmin },
    '#/admin/system/flash': { section: 'system', render: Pages.systemFlash },
    '#/admin/uci/changes': { section: 'status', render: Pages.uciChanges },
    '#/admin/help': { section: 'help', render: Pages.help }
  };

  let currentSection = 'status';
  let autoRefreshTimer = null;

  /* ---------- Widoki ---------- */
  function showLogin() {
    document.getElementById('app-view').classList.add('hidden');
    document.getElementById('login-view').classList.remove('hidden');
    if (autoRefreshTimer) { clearInterval(autoRefreshTimer); autoRefreshTimer = null; }
    setTimeout(() => document.getElementById('login-password').focus(), 50);
  }
  function showApp() {
    document.getElementById('login-view').classList.add('hidden');
    document.getElementById('app-view').classList.remove('hidden');
    buildMainMenu();
    refreshChanges();
    loadFirmwareHeader();
    route();
  }

  function buildMainMenu() {
    const menu = document.getElementById('mainmenu');
    clear(menu);
    MENU.forEach((m) => {
      const a = el('a', { href: m.sub[0].route, text: m.label, 'data-section': m.id });
      menu.appendChild(a);
    });
    const logout = el('a', { href: '#', class: 'logout', text: 'Wyloguj' });
    logout.addEventListener('click', async (e) => { e.preventDefault(); await API.logout(); showLogin(); });
    menu.appendChild(logout);
  }

  function buildSubMenu(sectionId, activeRoute) {
    const sub = document.getElementById('submenu');
    clear(sub);
    const m = MENU.find((x) => x.id === sectionId);
    if (!m) return;
    sub.appendChild(el('div', { class: 'submenu-group', text: m.label }));
    m.sub.forEach((s) => {
      const a = el('a', { href: s.route, text: s.label });
      if (s.route === activeRoute) a.classList.add('active');
      sub.appendChild(a);
    });
  }

  function highlightMainMenu(sectionId) {
    document.querySelectorAll('#mainmenu a[data-section]').forEach((a) => {
      a.classList.toggle('active', a.getAttribute('data-section') === sectionId);
    });
  }

  /* ---------- Router ---------- */
  async function route() {
    let hash = location.hash || '#/admin/status/overview';
    let entry = ROUTES[hash];
    if (!entry) { hash = '#/admin/status/overview'; entry = ROUTES[hash]; location.hash = hash; }

    currentSection = entry.section;
    highlightMainMenu(entry.section);
    buildSubMenu(entry.section, hash);

    const content = document.getElementById('content');
    clear(content);
    content.appendChild(el('div', { class: 'page-descr', text: 'Ładowanie...' }));
    try {
      const node = await entry.render();
      clear(content);
      content.appendChild(node);
      window.scrollTo(0, 0);
    } catch (e) {
      if (e.status === 401) { showLogin(); return; }
      clear(content);
      content.appendChild(el('div', { class: 'note danger', text: 'Błąd ładowania strony: ' + e.message }));
      console.error(e);
    }
    // auto-odświeżanie tylko dla Overview
    if (autoRefreshTimer) { clearInterval(autoRefreshTimer); autoRefreshTimer = null; }
    if (hash === '#/admin/status/overview') {
      autoRefreshTimer = setInterval(() => { if (location.hash === '#/admin/status/overview') route(); }, 8000);
    }
  }

  function navigate(hash) {
    if (location.hash === hash) route();
    else location.hash = hash;
  }

  async function refreshChanges() {
    try {
      const s = await API.session();
      const ind = document.getElementById('changes-indicator');
      const cnt = document.getElementById('changes-count');
      cnt.textContent = s.changes;
      ind.classList.toggle('hidden', !s.changes);
    } catch (_) {}
  }

  async function loadFirmwareHeader() {
    try {
      const fw = await API.firmware();
      document.getElementById('hdr-model').textContent = fw.model;
      document.getElementById('footer-fw').textContent = fw.version;
      const ov = await API.statusOverview();
      document.getElementById('hdr-hostname').textContent = ov.hostname;
      document.getElementById('login-host').textContent = ov.hostname;
    } catch (_) {}
  }

  /* ---------- Logowanie ---------- */
  function initLogin() {
    const form = document.getElementById('login-form');
    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      const u = document.getElementById('login-username').value;
      const p = document.getElementById('login-password').value;
      const errBox = document.getElementById('login-error');
      errBox.classList.add('hidden');
      try {
        await API.login(u, p);
        document.getElementById('login-password').value = '';
        showApp();
        toast('Zalogowano pomyślnie.', 'ok');
      } catch (err) {
        errBox.textContent = err.message || 'Błąd logowania.';
        errBox.classList.remove('hidden');
      }
    });
  }

  /* ---------- Motyw ---------- */
  function initTheme() {
    const saved = localStorage.getItem('luci-theme') || 'dark';
    document.documentElement.setAttribute('data-theme', saved);
    document.getElementById('theme-toggle').addEventListener('click', () => {
      const cur = document.documentElement.getAttribute('data-theme');
      const next = cur === 'dark' ? 'light' : 'dark';
      document.documentElement.setAttribute('data-theme', next);
      localStorage.setItem('luci-theme', next);
    });
  }

  /* ---------- Start ---------- */
  async function boot() {
    initTheme();
    initLogin();
    window.addEventListener('hashchange', route);

    // Sprawdź istniejącą sesję
    try {
      await API.session();
      showApp();
    } catch (_) {
      showLogin();
    }
  }

  return { boot, navigate, route, refreshChanges, showLogin };
})();

window.App = App;
document.addEventListener('DOMContentLoaded', App.boot);
