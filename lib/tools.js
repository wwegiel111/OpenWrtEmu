'use strict';

const store = require('./store');
const status = require('./status');
const { FIRMWARE } = require('./defaults');

/*
 * Symulacja narzędzi systemowych OpenWrt (diagnostyka + logi).
 * Wyniki są generowane tak, by przypominały realne wyjścia poleceń.
 */

function hash(str) {
  let h = 0;
  for (let i = 0; i < str.length; i++) { h = (h * 31 + str.charCodeAt(i)) & 0x7fffffff; }
  return h;
}
function fakePublicIp(seed) {
  const a = [142, 172, 104, 151, 188, 93][seed % 6];
  return `${a}.${(seed * 7) % 254}.${(seed * 13) % 254}.${(seed * 29) % 254}`;
}
function isValidHost(t) {
  if (!t) return false;
  if (/^(\d{1,3}\.){3}\d{1,3}$/.test(t)) return t.split('.').every((o) => +o <= 255);
  return /^[a-zA-Z0-9]([a-zA-Z0-9-]*[a-zA-Z0-9])?(\.[a-zA-Z0-9]([a-zA-Z0-9-]*[a-zA-Z0-9])?)+$/.test(t);
}
function routerIp() {
  const lan = store.getRunning().network.interface.lan;
  return lan.ipaddr || '192.168.1.1';
}

function ping(target, count) {
  count = Math.min(Math.max(parseInt(count, 10) || 5, 1), 10);
  if (!isValidHost(target)) return `ping: bad address '${target}'`;
  const seed = hash(target);
  const ip = /^\d/.test(target) ? target : fakePublicIp(seed);
  const lines = [`PING ${target} (${ip}): 56 data bytes`];
  let min = 999, max = 0, sum = 0, recv = 0;
  for (let i = 0; i < count; i++) {
    const lost = (seed + i) % 17 === 0; // sporadyczna strata pakietu
    if (lost) continue;
    const t = (8 + ((seed >> i) % 35) + Math.random() * 4);
    min = Math.min(min, t); max = Math.max(max, t); sum += t; recv++;
    lines.push(`64 bytes from ${ip}: seq=${i} ttl=${110 + (seed % 8)} time=${t.toFixed(1)} ms`);
  }
  const loss = Math.round(((count - recv) / count) * 100);
  lines.push('');
  lines.push(`--- ${target} ping statistics ---`);
  lines.push(`${count} packets transmitted, ${recv} packets received, ${loss}% packet loss`);
  if (recv) lines.push(`round-trip min/avg/max = ${min.toFixed(1)}/${(sum / recv).toFixed(1)}/${max.toFixed(1)} ms`);
  return lines.join('\n');
}

function traceroute(target) {
  if (!isValidHost(target)) return `traceroute: bad address '${target}'`;
  const seed = hash(target);
  const dst = /^\d/.test(target) ? target : fakePublicIp(seed);
  const lines = [`traceroute to ${target} (${dst}), 30 hops max, 38 byte packets`];
  const hops = [
    routerIp(),                       // brama lokalna (router)
    '10.64.0.1',                      // brama operatora
    '83.238.' + (seed % 254) + '.1',  // sieć ISP
    '195.187.' + (seed % 200) + '.5',
    '193.110.' + (seed % 180) + '.9',
    fakePublicIp(seed + 3),
    dst
  ];
  hops.forEach((h, i) => {
    const t1 = (1 + i * 3 + (seed % 5) + Math.random() * 2).toFixed(2);
    const t2 = (1 + i * 3 + (seed % 5) + Math.random() * 2).toFixed(2);
    const t3 = (1 + i * 3 + (seed % 5) + Math.random() * 2).toFixed(2);
    lines.push(`${String(i + 1).padStart(2)}  ${h}  ${t1} ms  ${t2} ms  ${t3} ms`);
  });
  return lines.join('\n');
}

function nslookup(target) {
  if (!isValidHost(target)) return `nslookup: can't resolve '${target}': Name or service not known`;
  const seed = hash(target);
  if (/^\d/.test(target)) {
    return `Server:\t\t${routerIp()}\nAddress:\t${routerIp()}#53\n\n${target}.in-addr.arpa\tname = host-${seed % 999}.example.net.`;
  }
  const ip4 = fakePublicIp(seed);
  return [
    `Server:\t\t${routerIp()}`,
    `Address:\t${routerIp()}#53`,
    '',
    `Name:\t${target}`,
    `Address: ${ip4}`,
    `Name:\t${target}`,
    `Address: 2a00:1450:401b:${(seed % 9999).toString(16)}::200e`
  ].join('\n');
}

function diag(tool, target, count) {
  switch (tool) {
    case 'ping': return ping(target, count);
    case 'traceroute': return traceroute(target);
    case 'nslookup': return nslookup(target);
    default: return 'Nieznane narzędzie diagnostyczne.';
  }
}

/* ---- Logi ---- */
function ts(offsetSec) {
  const d = new Date(Date.now() - offsetSec * 1000);
  const mon = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'][d.getMonth()];
  const time = d.toTimeString().slice(0, 8);
  return `${mon} ${String(d.getDate()).padStart(2, ' ')} ${time}`;
}

function syslog() {
  const cfg = store.getRunning();
  const host = cfg.system.system['@system[0]'].hostname || 'OpenWrt';
  const lan = cfg.network.interface.lan.ipaddr || '192.168.1.1';
  const ssid = cfg.wireless['wifi-iface'].default_radio0 ? cfg.wireless['wifi-iface'].default_radio0.ssid : 'OpenWrt';
  const up = status.uptimeSeconds();
  const leases = status.dhcpLeases();
  const lines = [];
  const add = (off, proc, msg) => lines.push(`${ts(up - off)} ${host} ${proc}: ${msg}`);
  add(0, 'procd', 'starting service instances');
  add(1, 'kernel', `br-lan: port 1(lan1) entered forwarding state`);
  add(2, 'netifd', `Interface 'lan' is now up`);
  add(2, 'netifd', `Interface 'lan' has IP address ${lan}`);
  add(3, 'dnsmasq[1842]', `started, version 2.90 cachesize 1000`);
  add(3, 'dnsmasq-dhcp[1842]', `DHCP, IP range ${lan.replace(/\.\d+$/, '.100')} -- ${lan.replace(/\.\d+$/, '.249')}, lease time 12h`);
  add(4, 'netifd', `Interface 'wan' is now up`);
  add(5, 'odhcpd[1620]', `Using a RA lifetime of 1800 seconds on br-lan`);
  add(6, 'hostapd', `wlan0: AP-ENABLED — SSID '${ssid}'`);
  leases.forEach((l, i) => {
    add(8 + i, 'dnsmasq-dhcp[1842]', `DHCPACK(br-lan) ${l.ipaddr} ${l.macaddr.toLowerCase()} ${l.hostname}${l.static ? ' (rezerwacja statyczna)' : ''}`);
  });
  add(20, 'dropbear[2011]', `Password auth succeeded for 'root' from ${lan.replace(/\.\d+$/, '.42')}:51234`);
  return lines.reverse().join('\n');
}

function dmesg() {
  const up = status.uptimeSeconds();
  const k = FIRMWARE.kernel;
  const lines = [
    `[    0.000000] Linux version ${k} (builder@buildhost) (mips-openwrt-linux-musl-gcc) #0 SMP`,
    `[    0.000000] SoC Type: MediaTek MT7621 ver:1 eco:3`,
    `[    0.000000] bootconsole [early0] enabled`,
    `[    0.000000] CPU0 revision is: 0001992f (MIPS 1004Kc)`,
    `[    0.000000] MIPS: machine is TP-Link Archer C6 v2`,
    `[    0.012000] Memory: 128MB DDR3 detected`,
    `[    0.534000] mtk_soc_eth 1e100000.ethernet eth0: mediatek frame engine at 0xbe100000, irq 5`,
    `[    0.621000] mt7530 mdio-bus:1f: configuring for fixed/rgmii link mode`,
    `[    1.204000] rt2880-pinmux pinctrl: pcie is already enabled`,
    `[    1.880000] mt7615e 0000:01:00.0: registered phy 0 (2.4 GHz)`,
    `[    1.902000] mt7615e 0000:02:00.0: registered phy 1 (5 GHz)`,
    `[    2.340000] jffs2: notice: (412) jffs2_build_xattr_subsystem: complete building xattr`,
    `[    2.560000] br-lan: port 1(lan1) entered blocking state`,
    `[    2.610000] mtk_soc_eth 1e100000.ethernet eth0: configuring for gmii/1000 link mode`,
    `[    ${(3.1 + up % 5).toFixed(6)}] device eth0.2 entered promiscuous mode`,
    `[    ${(3.4 + up % 5).toFixed(6)}] IPv6: ADDRCONF(NETDEV_CHANGE): br-lan: link becomes ready`
  ];
  return lines.join('\n');
}

module.exports = { diag, ping, traceroute, nslookup, syslog, dmesg };
