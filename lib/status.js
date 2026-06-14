'use strict';

const store = require('./store');
const { FIRMWARE } = require('./defaults');

/*
 * Generuje dynamiczny "status" systemu tak, aby strona Overview wyglądała
 * realistycznie. Wartości są deterministycznie wyliczane na bazie czasu
 * pracy i konfiguracji (bez prawdziwego sprzętu).
 */

function uptimeSeconds() {
  const s = store.getState();
  return Math.floor((Date.now() - s.bootTime) / 1000);
}

function formatUptime(sec) {
  const d = Math.floor(sec / 86400);
  const h = Math.floor((sec % 86400) / 3600);
  const m = Math.floor((sec % 3600) / 60);
  const s = sec % 60;
  const parts = [];
  if (d) parts.push(d + 'd');
  parts.push(String(h).padStart(2, '0') + 'h');
  parts.push(String(m).padStart(2, '0') + 'm');
  parts.push(String(s).padStart(2, '0') + 's');
  return parts.join(' ');
}

// Pseudolosowe, ale stabilne w krótkim oknie czasu (zmienia się co kilka sekund).
function jitter(base, amp, periodSec) {
  const t = Date.now() / 1000 / periodSec;
  return base + Math.round(Math.sin(t) * amp);
}

function memInfo() {
  const total = 128 * 1024 * 1024; // 128 MiB
  const free = jitter(74 * 1024 * 1024, 3 * 1024 * 1024, 11);
  const buffered = jitter(6 * 1024 * 1024, 1 * 1024 * 1024, 17);
  const cached = jitter(20 * 1024 * 1024, 2 * 1024 * 1024, 23);
  const available = free + buffered + cached;
  return { total, free, buffered, cached, available, used: total - free };
}

function loadAvg() {
  const a = (jitter(15, 12, 7) / 100).toFixed(2);
  const b = (jitter(11, 8, 31) / 100).toFixed(2);
  const c = (jitter(8, 5, 61) / 100).toFixed(2);
  return `${a}, ${b}, ${c}`;
}

// Deterministyczny MAC na bazie indeksu.
function fakeMac(seed) {
  const h = (n) => n.toString(16).padStart(2, '0');
  return ['9A', h((seed * 41) & 0xff), h((seed * 97 + 3) & 0xff),
          h((seed * 13 + 7) & 0xff), h((seed * 57 + 19) & 0xff), h((seed * 7 + 1) & 0xff)]
    .join(':').toUpperCase();
}

// Symulowane dzierżawy DHCP w obrębie skonfigurowanej puli LAN.
// Uwzględnia rezerwacje statyczne (config host) — zarezerwowane urządzenie
// zawsze otrzymuje swój adres i jest oznaczone jako "static".
function dhcpLeases() {
  const cfg = store.getRunning();
  const lanIf = cfg.network.interface.lan;
  const dhcpLan = cfg.dhcp.dhcp.lan;
  if (!dhcpLan || dhcpLan.ignore === '1') return [];

  const base = (lanIf.ipaddr || '192.168.1.1').split('.');
  const prefix = `${base[0]}.${base[1]}.${base[2]}.`;
  const leases = [];
  const usedIps = new Set();

  // 1) Rezerwacje statyczne — zawsze aktywne, czas dzierżawy nieskończony.
  const hosts = cfg.dhcp.host || {};
  const reservedMacs = new Set();
  Object.values(hosts).forEach((h) => {
    if (!h || !h.mac) return;
    const ip = h.ip && h.ip.indexOf('.') > -1 ? h.ip : (prefix + (h.ip || ''));
    leases.push({
      hostname: h.name || '*',
      ipaddr: ip,
      macaddr: (h.mac || '').toUpperCase(),
      static: true,
      remaining: -1,
      leasetime: -1
    });
    usedIps.add(ip);
    reservedMacs.add((h.mac || '').toLowerCase());
  });

  // 2) Dynamiczne dzierżawy z puli (omijają adresy oraz urządzenia z rezerwacją).
  const start = parseInt(dhcpLan.start || '100', 10);
  const names = ['laptop-anna', 'pc-biuro', 'android-jan', 'kamera-ip', 'drukarka-hp'];
  const count = Math.max(1, Math.min(names.length, 2 + (Math.floor(Date.now() / 30000) % 4)));
  let offset = 0;
  for (let i = 0; i < count; i++) {
    const mac = fakeMac(i + 1);
    if (reservedMacs.has(mac.toLowerCase())) continue; // to urządzenie ma już rezerwację statyczną
    let ip;
    do { ip = prefix + (start + offset); offset++; } while (usedIps.has(ip));
    usedIps.add(ip);
    leases.push({
      hostname: names[i],
      ipaddr: ip,
      macaddr: mac,
      static: false,
      leasetime: 43200,
      remaining: 43200 - ((Math.floor(Date.now() / 1000) % 43200)),
      duid: '00010001' + mac.replace(/:/g, '').toLowerCase()
    });
  }
  return leases;
}

// Status interfejsów wyliczony z konfiguracji.
function interfaceStatus() {
  const cfg = store.getRunning();
  const ifs = cfg.network.interface;
  const out = [];

  const lan = ifs.lan;
  out.push({
    name: 'lan',
    up: true,
    proto: lan.proto,
    device: lan.device,
    ipv4: lan.proto === 'static' ? `${lan.ipaddr}/${maskToCidr(lan.netmask)}` : '—',
    ipv6: lan.ip6assign ? 'fdca:1234:5678::1/60' : '—',
    mac: '9A:00:00:00:00:01',
    uptime: uptimeSeconds(),
    rx: jitter(820, 400, 5) * 1024 * 1024,
    tx: jitter(410, 200, 6) * 1024 * 1024
  });

  const wan = ifs.wan;
  const wanUp = wan.proto !== 'none';
  out.push({
    name: 'wan',
    up: wanUp,
    proto: wan.proto,
    device: wan.device,
    ipv4: wan.proto === 'dhcp' ? '203.0.113.45/24'
        : wan.proto === 'static' ? `${wan.ipaddr || '0.0.0.0'}/${maskToCidr(wan.netmask || '255.255.255.0')}`
        : wan.proto === 'pppoe' ? '198.51.100.10/32'
        : '—',
    gateway: wan.proto === 'static' ? (wan.gateway || '—') : '203.0.113.1',
    dns: '1.1.1.1 8.8.8.8',
    mac: '9A:00:00:00:00:02',
    uptime: wanUp ? Math.max(0, uptimeSeconds() - 4) : 0,
    rx: jitter(2400, 800, 4) * 1024 * 1024,
    tx: jitter(560, 300, 7) * 1024 * 1024
  });

  return out;
}

function maskToCidr(mask) {
  if (!mask) return '24';
  return mask.split('.').reduce((acc, oct) => acc + ((parseInt(oct, 10).toString(2).match(/1/g) || []).length), 0);
}

// Status sieci bezprzewodowej (radio0 / radio1).
function wirelessStatus() {
  const cfg = store.getRunning();
  const radios = cfg.wireless['wifi-device'];
  const ifaces = cfg.wireless['wifi-iface'];
  const out = [];
  for (const [rid, radio] of Object.entries(radios)) {
    const myIfaces = Object.entries(ifaces).filter(([, v]) => v.device === rid);
    const channels = { '2g': radio.channel, '5g': radio.channel };
    out.push({
      radio: rid,
      band: radio.band,
      up: radio.disabled !== '1',
      channel: radio.channel,
      htmode: radio.htmode,
      country: radio.country,
      txpower: radio.band === '5g' ? 23 : 20,
      bitrate: radio.band === '5g' ? 866.7 : 300.0,
      ifaces: myIfaces.map(([iid, v]) => ({
        id: iid,
        ssid: v.ssid,
        mode: v.mode,
        encryption: v.encryption,
        disabled: v.disabled === '1',
        clients: v.disabled === '1' || radio.disabled === '1' ? 0
                 : (radio.band === '5g' ? jitter(3, 2, 13) : jitter(5, 3, 19))
      }))
    });
  }
  return out;
}

function overview() {
  const cfg = store.getRunning();
  const sys = cfg.system.system['@system[0]'];
  return {
    firmware: FIRMWARE,
    hostname: sys.hostname,
    model: FIRMWARE.model,
    architecture: FIRMWARE.cpu,
    firmwareVersion: FIRMWARE.version,
    kernelVersion: FIRMWARE.kernel,
    localTime: new Date().toString(),
    uptime: uptimeSeconds(),
    uptimeStr: formatUptime(uptimeSeconds()),
    loadavg: loadAvg(),
    memory: memInfo(),
    leasesCount: dhcpLeases().length
  };
}

module.exports = {
  overview,
  interfaceStatus,
  wirelessStatus,
  dhcpLeases,
  formatUptime,
  uptimeSeconds
};
