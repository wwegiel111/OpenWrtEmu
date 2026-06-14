'use strict';

/* Klient REST API emulatora. Token trzymamy w pamięci i w cookie (HttpOnly z serwera). */
const API = (function () {
  let token = sessionStorage.getItem('sysauth') || null;

  async function req(method, path, body) {
    const headers = { 'Content-Type': 'application/json' };
    if (token) headers['Authorization'] = 'Bearer ' + token;
    const res = await fetch('/api' + path, {
      method,
      headers,
      credentials: 'same-origin',
      body: body !== undefined ? JSON.stringify(body) : undefined
    });
    let data = null;
    try { data = await res.json(); } catch { data = null; }
    if (res.status === 401) {
      const err = new Error((data && data.error) || 'Brak autoryzacji');
      err.status = 401;
      throw err;
    }
    if (!res.ok) {
      const err = new Error((data && data.error) || ('Błąd HTTP ' + res.status));
      err.status = res.status;
      err.data = data;
      throw err;
    }
    return data;
  }

  return {
    get token() { return token; },
    async login(username, password) {
      const data = await req('POST', '/login', { username, password });
      token = data.token;
      sessionStorage.setItem('sysauth', token);
      return data;
    },
    async logout() {
      try { await req('POST', '/logout'); } catch (_) {}
      token = null;
      sessionStorage.removeItem('sysauth');
    },
    session() { return req('GET', '/session'); },
    firmware() { return req('GET', '/firmware'); },

    // status
    statusOverview() { return req('GET', '/status/overview'); },
    statusInterfaces() { return req('GET', '/status/interfaces'); },
    statusWireless() { return req('GET', '/status/wireless'); },
    statusLeases() { return req('GET', '/status/leases'); },

    // konfiguracja
    getConfig(section) { return req('GET', '/config/' + section); },
    saveConfig(section, data) { return req('PUT', '/config/' + section, data); },
    getAllConfig() { return req('GET', '/config'); },

    // workflow
    apply() { return req('POST', '/apply'); },
    revert() { return req('POST', '/revert'); },
    changes() { return req('GET', '/changes'); },

    // narzędzia / diagnostyka / logi
    diag(tool, target, count) { return req('POST', '/diag', { tool, target, count }); },
    log(type) { return req('GET', '/log/' + (type || 'system')); },
    reboot() { return req('POST', '/reboot'); },

    // system
    reset() { return req('POST', '/reset'); },
    setPassword(password) { return req('POST', '/password', { password }); },
    backup() { return req('GET', '/backup'); },
    restore(payload) { return req('POST', '/restore', payload); }
  };
})();
