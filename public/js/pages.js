'use strict';

/* Renderery poszczególnych stron LuCI. Każda funkcja zwraca element DOM. */
const Pages = (function () {
  const { el, clear, toast, valueRow, textInput, selectInput, checkboxInput,
          panel, table, badge, saveBar, validate, fmtBytes, fmtDuration, confirmDialog, modal } = UI;

  // wspólny helper: pasek "Zapisz / Zapisz i zastosuj"
  async function saveSection(section, data, apply) {
    await API.saveConfig(section, data);
    if (apply) { await API.apply(); toast('Konfiguracja zapisana i zastosowana.', 'ok'); }
    else toast('Zapisano. Kliknij „Zapisz i zastosuj”, aby wdrożyć zmiany.', 'warn');
    if (window.App) window.App.refreshChanges();
  }

  function examTip(html) { return el('div', { class: 'exam-tip', html: '<b>💡 Wskazówka egzaminacyjna:</b> ' + html }); }
  function cliBox(text) { return el('div', { class: 'cli-box', text }); }

  /* =======================================================
     STATUS / OVERVIEW
     ======================================================= */
  async function statusOverview() {
    const root = el('div');
    root.appendChild(el('h2', { text: 'Status' }));
    root.appendChild(el('div', { class: 'page-descr', text: 'Przegląd stanu urządzenia TP-Link Archer C6.' }));

    const ov = await API.statusOverview();
    const ifs = await API.statusInterfaces();
    const wifi = await API.statusWireless();
    const leases = await API.statusLeases();

    // System
    const sysGrid = el('div', { class: 'kv-grid' });
    const sysRows = [
      ['Nazwa hosta', ov.hostname],
      ['Model', ov.model],
      ['Architektura', ov.architecture],
      ['Wersja firmware', ov.firmwareVersion],
      ['Wersja jądra', ov.kernelVersion],
      ['Czas lokalny', ov.localTime],
      ['Czas pracy (uptime)', ov.uptimeStr],
      ['Średnie obciążenie', ov.loadavg]
    ];
    sysRows.forEach(([k, v]) => {
      sysGrid.appendChild(el('div', { class: 'k', text: k }));
      sysGrid.appendChild(el('div', { class: 'v', text: v }));
    });
    root.appendChild(panel('System', null, sysGrid));

    // Pamięć
    const mem = ov.memory;
    const memBody = el('div');
    function gauge(label, used, total, free) {
      const pct = Math.round((used / total) * 100);
      const wrap = el('div', { class: 'gauge-wrap' });
      wrap.appendChild(el('div', { class: 'gauge-label', html: '<span>' + label + '</span><span>' + fmtBytes(free) + ' wolne / ' + fmtBytes(total) + '</span>' }));
      const g = el('div', { class: 'gauge' + (pct > 90 ? ' crit' : pct > 75 ? ' warn' : '') });
      g.appendChild(el('span', { style: 'width:' + pct + '%' }));
      g.appendChild(el('div', { class: 'gauge-text', text: pct + '% używane' }));
      wrap.appendChild(g);
      return wrap;
    }
    memBody.appendChild(gauge('Pamięć RAM', mem.used, mem.total, mem.free));
    memBody.appendChild(gauge('Buforowane', mem.buffered, mem.total, mem.total - mem.buffered));
    memBody.appendChild(gauge('Podręczne (cache)', mem.cached, mem.total, mem.total - mem.cached));
    root.appendChild(panel('Pamięć', null, memBody));

    // Sieć — status interfejsów
    const netBody = el('div');
    ifs.forEach((i) => {
      const card = el('div', { class: 'iface-card' });
      card.appendChild(el('div', { class: 'iface-icon', text: i.name === 'wan' ? '🌐' : '🖧' }));
      const info = el('div', { class: 'iface-info' });
      const nameRow = el('div');
      nameRow.appendChild(el('span', { class: 'iface-name', text: i.name.toUpperCase() }));
      nameRow.appendChild(document.createTextNode('  '));
      nameRow.appendChild(badge(i.up ? 'POŁĄCZONY' : 'WYŁĄCZONY', i.up ? 'up' : 'down'));
      info.appendChild(nameRow);
      const kv = el('div', { class: 'kv' });
      const add = (k, v) => { kv.appendChild(el('span', { class: 'k', text: k })); kv.appendChild(el('span', { class: 'v mono', text: v })); };
      add('Protokół', i.proto);
      add('Urządzenie', i.device);
      add('Adres IPv4', i.ipv4);
      if (i.gateway) add('Brama', i.gateway);
      if (i.dns) add('DNS', i.dns);
      add('MAC', i.mac);
      add('RX / TX', fmtBytes(i.rx) + ' / ' + fmtBytes(i.tx));
      info.appendChild(kv);
      card.appendChild(info);
      netBody.appendChild(card);
    });
    root.appendChild(panel('Sieć', null, netBody));

    // Wi-Fi
    const wifiRows = [];
    wifi.forEach((r) => {
      r.ifaces.forEach((f) => {
        wifiRows.push([
          el('span', { class: 'mono', text: r.radio + ' (' + (r.band === '5g' ? '5 GHz' : '2.4 GHz') + ')' }),
          f.ssid,
          r.up && !f.disabled ? badge('Włączone', 'up') : badge('Wyłączone', 'down'),
          'Kanał ' + r.channel + ' · ' + r.htmode,
          encLabel(f.encryption),
          String(f.clients) + ' klient(ów)'
        ]);
      });
    });
    root.appendChild(panel('Sieć bezprzewodowa', null,
      table(['Radio', 'SSID', 'Status', 'Kanał', 'Szyfrowanie', 'Klienci'], wifiRows)));

    // Dzierżawy DHCP
    const leaseRows = leases.map((l) => [
      l.hostname,
      el('span', { class: 'mono', text: l.ipaddr }),
      el('span', { class: 'mono', text: l.macaddr }),
      fmtDuration(l.remaining)
    ]);
    root.appendChild(panel('Aktywne dzierżawy DHCP', leases.length + ' urządzeń',
      leaseRows.length ? table(['Nazwa hosta', 'Adres IPv4', 'Adres MAC', 'Pozostały czas'], leaseRows)
                       : el('p', { class: 'panel-descr', text: 'Brak aktywnych dzierżaw.' })));

    return root;
  }

  function encLabel(enc) {
    const m = {
      none: 'Brak (otwarta)', psk: 'WPA-PSK', psk2: 'WPA2-PSK',
      'psk-mixed': 'WPA/WPA2-PSK mieszany', sae: 'WPA3-SAE', 'sae-mixed': 'WPA2/WPA3 mieszany',
      wep: 'WEP (przestarzałe)'
    };
    return m[enc] || enc;
  }

  /* =======================================================
     NETWORK / INTERFACES  (LAN, WAN)
     ======================================================= */
  async function networkInterfaces() {
    const root = el('div');
    root.appendChild(el('h2', { text: 'Interfejsy' }));
    root.appendChild(el('div', { class: 'cbi-map-descr', text: 'Konfiguracja interfejsów sieciowych. LAN to sieć lokalna routera, WAN to połączenie z Internetem (operatorem).' }));
    root.appendChild(examTip('Najczęstsze zadanie: ustaw adres IP interfejsu <b>LAN</b> (np. 192.168.1.1/24) oraz protokół interfejsu <b>WAN</b> (DHCP od operatora lub adres statyczny).'));

    const cfg = await API.getConfig('network');
    const ifsStatus = await API.statusInterfaces();
    const statusByName = {}; ifsStatus.forEach((s) => statusByName[s.name] = s);

    const rows = [];
    ['lan', 'wan', 'wan6'].forEach((name) => {
      const i = cfg.interface[name];
      if (!i) return;
      const st = statusByName[name];
      const editBtn = el('button', { class: 'btn btn-sm', text: 'Edytuj' });
      editBtn.addEventListener('click', () => editInterface(name));
      rows.push([
        el('span', { class: 'mono', html: '<b>' + name.toUpperCase() + '</b>' }),
        st ? (st.up ? badge('POŁĄCZONY', 'up') : badge('WYŁĄCZONY', 'down')) : badge('—', 'info'),
        i.proto,
        i.device,
        st ? (st.ipv4 || '—') : '—',
        editBtn
      ]);
    });
    root.appendChild(panel('Interfejsy', null,
      table(['Nazwa', 'Status', 'Protokół', 'Urządzenie', 'Adres IPv4', ''], rows)));

    // Kontener na edytor
    const editorHolder = el('div', { id: 'iface-editor' });
    root.appendChild(editorHolder);

    async function editInterface(name) {
      const i = JSON.parse(JSON.stringify(cfg.interface[name]));
      clear(editorHolder);
      const body = el('div');

      const protoSel = selectInput(i.proto, [
        { value: 'static', label: 'Statyczny adres' },
        { value: 'dhcp', label: 'Klient DHCP' },
        { value: 'pppoe', label: 'PPPoE' },
        { value: 'dhcpv6', label: 'Klient DHCPv6' },
        { value: 'none', label: 'Nieskonfigurowany (none)' }
      ]);

      const devInput = textInput(i.device);
      const dynFields = el('div');

      function renderDyn() {
        clear(dynFields);
        const p = protoSel.value;
        if (p === 'static') {
          const ip = textInput(i.ipaddr || '', { cls: 'short' });
          const mask = selectInput(i.netmask || '255.255.255.0', [
            '255.255.255.0', '255.255.0.0', '255.0.0.0', '255.255.255.128', '255.255.255.192', '255.255.255.240'
          ]);
          const gw = textInput(i.gateway || '', { cls: 'short' });
          const dns = textInput(i.dns || '', {});
          dynFields._ip = ip; dynFields._mask = mask; dynFields._gw = gw; dynFields._dns = dns;
          dynFields.appendChild(valueRow('Adres IPv4', 'Adres IP interfejsu, np. 192.168.1.1', ip, { required: true }));
          dynFields.appendChild(valueRow('Maska sieci IPv4', 'Maska podsieci, np. 255.255.255.0 (/24)', mask));
          dynFields.appendChild(valueRow('Brama IPv4', 'Adres bramy domyślnej (dla WAN)', gw));
          dynFields.appendChild(valueRow('Serwery DNS', 'Adresy DNS oddzielone spacją, np. 1.1.1.1 8.8.8.8', dns));
        } else if (p === 'pppoe') {
          const user = textInput(i.username || '');
          const pass = textInput(i.password || '', { password: true });
          dynFields._user = user; dynFields._pass = pass;
          dynFields.appendChild(valueRow('Nazwa użytkownika (PAP/CHAP)', 'Login od operatora', user, { required: true }));
          dynFields.appendChild(valueRow('Hasło (PAP/CHAP)', 'Hasło od operatora', pass, { required: true }));
        } else if (p === 'dhcp') {
          dynFields.appendChild(el('div', { class: 'note info', text: 'Adres IP, maska, brama i DNS zostaną pobrane automatycznie z serwera DHCP operatora.' }));
        } else if (p === 'dhcpv6') {
          dynFields.appendChild(el('div', { class: 'note info', text: 'Konfiguracja IPv6 zostanie pobrana automatycznie (DHCPv6 / RA).' }));
        } else {
          dynFields.appendChild(el('div', { class: 'note', text: 'Interfejs nieskonfigurowany (proto none).' }));
        }
      }
      protoSel.addEventListener('change', renderDyn);

      body.appendChild(valueRow('Protokół', 'Sposób uzyskania adresu IP dla interfejsu.', protoSel));
      body.appendChild(valueRow('Urządzenie', 'Urządzenie/most powiązany z interfejsem (np. br-lan, eth0.2).', devInput));
      body.appendChild(dynFields);
      renderDyn();

      const collect = () => {
        const p = protoSel.value;
        const out = { proto: p, device: devInput.value.trim() };
        if (name === 'lan') out.ip6assign = i.ip6assign || '60';
        if (p === 'static') {
          out.ipaddr = dynFields._ip.value.trim();
          out.netmask = dynFields._mask.value;
          if (dynFields._gw.value.trim()) out.gateway = dynFields._gw.value.trim();
          if (dynFields._dns.value.trim()) out.dns = dynFields._dns.value.trim();
        } else if (p === 'pppoe') {
          out.username = dynFields._user.value;
          out.password = dynFields._pass.value;
        }
        return out;
      };
      const valid = () => {
        const p = protoSel.value;
        if (!validate.notEmpty(devInput.value)) { toast('Pole „Urządzenie” nie może być puste.', 'err'); return false; }
        if (p === 'static') {
          if (!validate.ipv4(dynFields._ip.value)) { toast('Nieprawidłowy adres IPv4.', 'err'); return false; }
          if (!validate.netmask(dynFields._mask.value)) { toast('Nieprawidłowa maska sieci.', 'err'); return false; }
          if (dynFields._gw.value.trim() && !validate.ipv4(dynFields._gw.value)) { toast('Nieprawidłowy adres bramy.', 'err'); return false; }
        }
        if (p === 'pppoe' && !validate.notEmpty(dynFields._user.value)) { toast('Podaj nazwę użytkownika PPPoE.', 'err'); return false; }
        return true;
      };

      const doSave = async (apply) => {
        if (!valid()) return;
        cfg.interface[name] = collect();
        await saveSection('network', cfg, apply);
        App.navigate('#/admin/network/network'); // odśwież widok
      };

      body.appendChild(cliBox(
        'uci set network.' + name + '.proto=\'' + protoSel.value + '\'\n' +
        (protoSel.value === 'static'
          ? 'uci set network.' + name + '.ipaddr=\'' + (i.ipaddr || '192.168.1.1') + '\'\nuci set network.' + name + '.netmask=\'255.255.255.0\'\n'
          : '') +
        'uci commit network && /etc/init.d/network restart'
      ));

      body.appendChild(saveBar({
        onSaveApply: () => doSave(true),
        onSave: () => doSave(false),
        onReset: () => editInterface(name)
      }));

      editorHolder.appendChild(panel('Edycja interfejsu „' + name.toUpperCase() + '”', 'Ustawienia ogólne', body));
      editorHolder.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }

    return root;
  }

  /* =======================================================
     NETWORK / WIRELESS  (radio0 = 2.4G, radio1 = 5G)
     ======================================================= */
  async function networkWireless() {
    const root = el('div');
    root.appendChild(el('h2', { text: 'Sieć bezprzewodowa' }));
    root.appendChild(el('div', { class: 'cbi-map-descr', text: 'Konfiguracja modułów radiowych Archer C6: radio0 (2.4 GHz, 802.11b/g/n) oraz radio1 (5 GHz, 802.11ac).' }));
    root.appendChild(examTip('Typowe zadanie: ustaw <b>SSID</b> (nazwę sieci), wybierz szyfrowanie <b>WPA2-PSK (psk2)</b> i podaj klucz o długości min. 8 znaków. Możesz też zmienić kanał i ukryć SSID.'));

    const cfg = await API.getConfig('wireless');
    const wstat = await API.statusWireless();
    const statByRadio = {}; wstat.forEach((w) => statByRadio[w.radio] = w);

    const rows = [];
    Object.entries(cfg['wifi-device']).forEach(([rid, radio]) => {
      const ifaces = Object.entries(cfg['wifi-iface']).filter(([, v]) => v.device === rid);
      ifaces.forEach(([iid, ifc]) => {
        const enabled = radio.disabled !== '1' && ifc.disabled !== '1';
        const toggleBtn = el('button', { class: 'btn btn-sm ' + (enabled ? 'btn-danger' : 'btn-apply'), text: enabled ? 'Wyłącz' : 'Włącz' });
        toggleBtn.addEventListener('click', async () => {
          cfg['wifi-device'][rid].disabled = enabled ? '1' : '0';
          await saveSection('wireless', cfg, true);
          App.navigate('#/admin/network/wireless');
        });
        const editBtn = el('button', { class: 'btn btn-sm', text: 'Edytuj' });
        editBtn.addEventListener('click', () => editRadio(rid, iid));
        rows.push([
          el('span', { class: 'mono', html: '<b>' + rid + '</b><br><span style="color:var(--text-mut)">' + (radio.band === '5g' ? '5 GHz · 802.11ac' : '2.4 GHz · 802.11n') + '</span>' }),
          el('span', { html: '<b>' + ifc.ssid + '</b><br><span style="color:var(--text-mut);font-size:12px">' + ifc.mode.toUpperCase() + ' · ' + encLabel(ifc.encryption) + '</span>' }),
          enabled ? badge('Kanał ' + radio.channel + ' · ' + radio.htmode, 'up') : badge('Wyłączone', 'down'),
          el('span', { class: 'inline-group' }, [toggleBtn, editBtn])
        ]);
      });
    });
    root.appendChild(panel('Moduły radiowe', null,
      table(['Radio', 'SSID', 'Status', 'Akcje'], rows)));

    const editorHolder = el('div', { id: 'wifi-editor' });
    root.appendChild(editorHolder);

    function editRadio(rid, iid) {
      const radio = JSON.parse(JSON.stringify(cfg['wifi-device'][rid]));
      const ifc = JSON.parse(JSON.stringify(cfg['wifi-iface'][iid]));
      clear(editorHolder);

      // --- Konfiguracja urządzenia (radio) ---
      const devBody = el('div');
      const channels = radio.band === '5g'
        ? ['36', '40', '44', '48', '52', '56', '60', '64', '100', '104', '108', '112', '116', '132', '136', '140', '149', '153', '157', '161', '165']
        : ['1', '2', '3', '4', '5', '6', '7', '8', '9', '10', '11', '12', '13'];
      const chanSel = selectInput(radio.channel, [{ value: 'auto', label: 'auto' }].concat(channels.map((c) => ({ value: c, label: 'Kanał ' + c }))));
      const htOptions = radio.band === '5g'
        ? ['HT20', 'HT40', 'VHT20', 'VHT40', 'VHT80', 'VHT160']
        : ['HT20', 'HT40'];
      const htSel = selectInput(radio.htmode, htOptions);
      const countrySel = selectInput(radio.country, ['PL', 'DE', 'GB', 'US', 'FR', 'CZ', 'SK', '00']);
      const disabledChk = checkboxInput(radio.disabled !== '1');

      devBody.appendChild(valueRow('Pasmo', null, el('span', { class: 'mono', text: radio.band === '5g' ? '5 GHz (802.11ac)' : '2.4 GHz (802.11b/g/n)' })));
      devBody.appendChild(valueRow('Kanał', 'Kanał radiowy. „auto” pozwala routerowi wybrać najlepszy.', chanSel));
      devBody.appendChild(valueRow('Szerokość kanału', 'HT20 = 20 MHz, VHT80 = 80 MHz (większa przepustowość).', htSel));
      devBody.appendChild(valueRow('Kod kraju', 'Region regulacyjny (wpływa na dozwolone kanały i moc).', countrySel));
      devBody.appendChild(valueRow('Moduł włączony', 'Odznacz, aby wyłączyć całe radio.', disabledChk));
      editorHolder.appendChild(panel('Konfiguracja urządzenia — ' + rid, radio.band === '5g' ? '5 GHz' : '2.4 GHz', devBody));

      // --- Konfiguracja interfejsu (sieci) ---
      const ifBody = el('div');
      const ssidInput = textInput(ifc.ssid);
      const modeSel = selectInput(ifc.mode, [
        { value: 'ap', label: 'Punkt dostępowy (Access Point)' },
        { value: 'sta', label: 'Klient (Station)' },
        { value: 'adhoc', label: 'Ad-Hoc' }
      ]);
      const encSel = selectInput(ifc.encryption, [
        { value: 'none', label: 'Brak szyfrowania (otwarta)' },
        { value: 'psk2', label: 'WPA2-PSK' },
        { value: 'psk-mixed', label: 'WPA/WPA2-PSK (mieszany)' },
        { value: 'sae', label: 'WPA3-SAE' },
        { value: 'sae-mixed', label: 'WPA2/WPA3 (mieszany)' },
        { value: 'psk', label: 'WPA-PSK (przestarzałe)' }
      ]);
      const keyInput = textInput(ifc.key || '', { placeholder: 'min. 8 znaków' });
      const hiddenChk = checkboxInput(ifc.hidden === '1');
      const netSel = selectInput(ifc.network, ['lan', 'wan']);

      const keyRow = valueRow('Klucz / hasło', 'Hasło sieci Wi-Fi (WPA-PSK), minimum 8 znaków.', keyInput, { required: true });
      function syncKeyVisibility() { keyRow.style.display = encSel.value === 'none' ? 'none' : ''; }
      encSel.addEventListener('change', syncKeyVisibility);

      ifBody.appendChild(valueRow('Tryb', 'Access Point = router rozgłasza sieć.', modeSel));
      ifBody.appendChild(valueRow('SSID (nazwa sieci)', 'Widoczna nazwa sieci bezprzewodowej.', ssidInput, { required: true }));
      ifBody.appendChild(valueRow('Ukryj SSID', 'Sieć nie będzie rozgłaszana (trzeba wpisać nazwę ręcznie).', hiddenChk));
      ifBody.appendChild(valueRow('Sieć', 'Do której sieci (interfejsu) należy ten SSID.', netSel));
      ifBody.appendChild(valueRow('Szyfrowanie', 'Zalecane: WPA2-PSK lub WPA2/WPA3.', encSel));
      ifBody.appendChild(keyRow);
      syncKeyVisibility();

      const collect = () => {
        cfg['wifi-device'][rid] = Object.assign(radio, {
          channel: chanSel.value, htmode: htSel.value, country: countrySel.value,
          disabled: disabledChk.checked ? '0' : '1'
        });
        const enc = encSel.value;
        cfg['wifi-iface'][iid] = Object.assign(ifc, {
          ssid: ssidInput.value, mode: modeSel.value, encryption: enc,
          key: enc === 'none' ? '' : keyInput.value,
          hidden: hiddenChk.checked ? '1' : '0', network: netSel.value
        });
      };
      const valid = () => {
        if (!validate.notEmpty(ssidInput.value)) { toast('SSID nie może być pusty.', 'err'); return false; }
        if (encSel.value !== 'none' && keyInput.value.length < 8) { toast('Klucz Wi-Fi musi mieć min. 8 znaków.', 'err'); return false; }
        return true;
      };
      const doSave = async (apply) => {
        if (!valid()) return;
        collect();
        await saveSection('wireless', cfg, apply);
        App.navigate('#/admin/network/wireless');
      };

      ifBody.appendChild(cliBox(
        'uci set wireless.' + iid + '.ssid=\'' + ifc.ssid + '\'\n' +
        'uci set wireless.' + iid + '.encryption=\'' + encSel.value + '\'\n' +
        (encSel.value !== 'none' ? 'uci set wireless.' + iid + '.key=\'********\'\n' : '') +
        'uci set wireless.' + rid + '.channel=\'' + radio.channel + '\'\n' +
        'uci commit wireless && wifi reload'
      ));
      ifBody.appendChild(saveBar({
        onSaveApply: () => doSave(true),
        onSave: () => doSave(false),
        onReset: () => editRadio(rid, iid)
      }));
      editorHolder.appendChild(panel('Konfiguracja interfejsu — ' + ifc.ssid, 'SSID', ifBody));
      editorHolder.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }

    return root;
  }

  /* =======================================================
     NETWORK / DHCP and DNS
     ======================================================= */
  async function networkDhcp() {
    const root = el('div');
    root.appendChild(el('h2', { text: 'DHCP i DNS' }));
    root.appendChild(el('div', { class: 'cbi-map-descr', text: 'Wbudowany serwer Dnsmasq przydziela adresy IP (DHCP) i obsługuje zapytania DNS w sieci lokalnej.' }));
    root.appendChild(examTip('Najczęstsze zadanie: ustaw zakres puli DHCP dla LAN — pole <b>Start</b> (pierwszy adres), <b>Limit</b> (liczba adresów) oraz <b>Czas dzierżawy</b> (np. 12h). Pula 100–249 odpowiada Start=100, Limit=150.'));

    const cfg = await API.getConfig('dhcp');
    const dnsmasq = cfg.dnsmasq['@dnsmasq[0]'];
    const lan = cfg.dhcp.lan;

    // --- Serwer DHCP dla LAN ---
    const lanBody = el('div');
    const startInput = textInput(lan.start || '100', { cls: 'short' });
    const limitInput = textInput(lan.limit || '150', { cls: 'short' });
    const leaseInput = textInput(lan.leasetime || '12h', { cls: 'short' });
    const ignoreChk = checkboxInput(lan.ignore === '1');
    const dynamicChk = checkboxInput(lan.dynamicdhcp !== '0');

    lanBody.appendChild(valueRow('Wyłącz serwer DHCP', 'Zaznacz, aby router NIE rozdawał adresów w sieci LAN.', ignoreChk));
    lanBody.appendChild(valueRow('Start', 'Najniższy przydzielany adres (offset od adresu sieci). Np. 100 → 192.168.1.100.', startInput, { required: true }));
    lanBody.appendChild(valueRow('Limit', 'Maksymalna liczba przydzielanych adresów.', limitInput, { required: true }));
    lanBody.appendChild(valueRow('Czas dzierżawy', 'Czas ważności przydzielonego adresu, np. 12h, 30m, 1d.', leaseInput));
    lanBody.appendChild(valueRow('Dynamiczny DHCP', 'Przydzielaj adresy także klientom spoza skonfigurowanych dzierżaw statycznych.', dynamicChk));

    // pokaż wyliczony zakres
    const rangeNote = el('div', { class: 'note info' });
    function updateRange() {
      const s = parseInt(startInput.value, 10) || 100;
      const l = parseInt(limitInput.value, 10) || 150;
      rangeNote.textContent = 'Wyliczony zakres puli: 192.168.1.' + s + ' – 192.168.1.' + (s + l - 1) + ' (' + l + ' adresów).';
    }
    startInput.addEventListener('input', updateRange);
    limitInput.addEventListener('input', updateRange);
    updateRange();
    lanBody.appendChild(rangeNote);

    const collectLan = () => {
      cfg.dhcp.lan = Object.assign(cfg.dhcp.lan, {
        start: startInput.value.trim(), limit: limitInput.value.trim(),
        leasetime: leaseInput.value.trim() || '12h',
        ignore: ignoreChk.checked ? '1' : '0',
        dynamicdhcp: dynamicChk.checked ? '1' : '0'
      });
    };
    const validLan = () => {
      if (!validate.range(startInput.value, 1, 254)) { toast('„Start” musi być z zakresu 1–254.', 'err'); return false; }
      if (!validate.range(limitInput.value, 1, 253)) { toast('„Limit” musi być liczbą 1–253.', 'err'); return false; }
      if (!/^\d+[smhd]$/.test(leaseInput.value.trim())) { toast('Czas dzierżawy w formacie np. 12h, 30m, 1d.', 'err'); return false; }
      return true;
    };
    const saveLan = async (apply) => {
      if (!validLan()) return;
      collectLan();
      await saveSection('dhcp', cfg, apply);
    };
    lanBody.appendChild(cliBox(
      'uci set dhcp.lan.start=\'' + (lan.start || '100') + '\'\n' +
      'uci set dhcp.lan.limit=\'' + (lan.limit || '150') + '\'\n' +
      'uci set dhcp.lan.leasetime=\'' + (lan.leasetime || '12h') + '\'\n' +
      'uci commit dhcp && /etc/init.d/dnsmasq restart'
    ));
    lanBody.appendChild(saveBar({
      onSaveApply: () => saveLan(true),
      onSave: () => saveLan(false),
      onReset: () => App.navigate('#/admin/network/dhcp')
    }));
    root.appendChild(panel('Serwer DHCP — sieć LAN', 'interfejs lan', lanBody));

    // --- Ustawienia ogólne Dnsmasq / DNS ---
    const dnsBody = el('div');
    const domainInput = textInput(dnsmasq.domain || 'lan', { cls: 'short' });
    const localInput = textInput(dnsmasq.local || '/lan/', { cls: 'short' });
    const rebindChk = checkboxInput(dnsmasq.rebind_protection === '1');
    const authChk = checkboxInput(dnsmasq.authoritative === '1');
    dnsBody.appendChild(valueRow('Domena lokalna', 'Sufiks domeny dla hostów w sieci LAN.', domainInput));
    dnsBody.appendChild(valueRow('Serwer lokalny', 'Lokalne rozwiązywanie nazw, np. /lan/.', localInput));
    dnsBody.appendChild(valueRow('Ochrona przed rebind', 'Odrzucaj odpowiedzi DNS wskazujące adresy prywatne (ochrona DNS rebinding).', rebindChk));
    dnsBody.appendChild(valueRow('Serwer autorytatywny', 'Ten Dnsmasq jest jedynym serwerem DHCP w sieci.', authChk));
    const saveDns = async (apply) => {
      cfg.dnsmasq['@dnsmasq[0]'] = Object.assign(dnsmasq, {
        domain: domainInput.value.trim(), local: localInput.value.trim(),
        rebind_protection: rebindChk.checked ? '1' : '0',
        authoritative: authChk.checked ? '1' : '0'
      });
      await saveSection('dhcp', cfg, apply);
    };
    dnsBody.appendChild(saveBar({
      onSaveApply: () => saveDns(true),
      onSave: () => saveDns(false),
      onReset: () => App.navigate('#/admin/network/dhcp')
    }));
    root.appendChild(panel('Ustawienia ogólne — DNS i Dnsmasq', null, dnsBody));

    // --- Aktywne dzierżawy ---
    const leases = await API.statusLeases();
    const leaseRows = leases.map((l) => [
      l.hostname, el('span', { class: 'mono', text: l.ipaddr }),
      el('span', { class: 'mono', text: l.macaddr }), fmtDuration(l.remaining)
    ]);
    root.appendChild(panel('Aktywne dzierżawy DHCP', leases.length + ' urządzeń',
      leaseRows.length ? table(['Nazwa hosta', 'Adres IPv4', 'Adres MAC', 'Pozostały czas'], leaseRows)
                       : el('p', { class: 'panel-descr', text: 'Brak aktywnych dzierżaw.' })));

    return root;
  }

  /* =======================================================
     NETWORK / SWITCH (VLAN)
     ======================================================= */
  async function networkVlan() {
    const root = el('div');
    root.appendChild(el('h2', { text: 'Przełącznik (Switch / VLAN)' }));
    root.appendChild(el('div', { class: 'cbi-map-descr', text: 'Konfiguracja wewnętrznego przełącznika sprzętowego (switch0) routera Archer C6. Pozwala podzielić porty fizyczne na sieci VLAN.' }));
    root.appendChild(examTip('VLAN rozdziela ruch: <b>untagged (u)</b> — port należy do VLAN bez znacznika (zwykłe urządzenie), <b>tagged (t)</b> — ramki ze znacznikiem 802.1Q (łącze do CPU / innego switcha), <b>off</b> — port nie należy do VLAN. Port CPU zwykle jest <b>tagged</b> we wszystkich VLAN-ach.'));

    const cfg = await API.getConfig('network');
    if (!cfg.switch_vlan) cfg.switch_vlan = {};

    // Definicja portów Archer C6 (swconfig)
    const PORTS = [
      { id: 0, label: 'CPU (eth0)' },
      { id: 2, label: 'LAN 1' },
      { id: 3, label: 'LAN 2' },
      { id: 4, label: 'LAN 3' },
      { id: 5, label: 'LAN 4' },
      { id: 1, label: 'WAN' }
    ];

    function parsePorts(str) {
      const map = {}; // id -> 'u' | 't'
      (str || '').split(/\s+/).filter(Boolean).forEach((tok) => {
        const tagged = tok.endsWith('t');
        const id = parseInt(tok.replace('t', ''), 10);
        map[id] = tagged ? 't' : 'u';
      });
      return map;
    }
    function buildPorts(map) {
      // zachowaj kolejność rosnącą po id
      return Object.keys(map).map(Number).sort((a, b) => a - b)
        .map((id) => id + (map[id] === 't' ? 't' : '')).join(' ');
    }

    const swEnableChk = checkboxInput((cfg.switch.switch0 && cfg.switch.switch0.enable_vlan) === '1');

    // Tabela VLAN
    const tableWrap = el('div');
    function renderTable() {
      clear(tableWrap);
      const headers = ['VLAN ID'].concat(PORTS.map((p) => p.label)).concat(['']);
      const rows = [];
      const entries = Object.entries(cfg.switch_vlan);
      entries.forEach(([key, v]) => {
        const portMap = parsePorts(v.ports);
        const vlanInput = textInput(v.vlan, { cls: 'tiny' });
        vlanInput.addEventListener('change', () => { v.vlan = vlanInput.value.trim(); });
        const cells = [vlanInput];
        PORTS.forEach((p) => {
          const sel = selectInput(portMap[p.id] === 't' ? 'tagged' : portMap[p.id] === 'u' ? 'untagged' : 'off',
            [{ value: 'off', label: 'wyłączony' }, { value: 'untagged', label: 'untagged (u)' }, { value: 'tagged', label: 'tagged (t)' }]);
          sel.style.width = '130px';
          sel.addEventListener('change', () => {
            const pm = parsePorts(v.ports);
            if (sel.value === 'off') delete pm[p.id];
            else pm[p.id] = sel.value === 'tagged' ? 't' : 'u';
            v.ports = buildPorts(pm);
          });
          cells.push(sel);
        });
        const del = el('button', { class: 'btn btn-sm btn-danger', text: 'Usuń' });
        del.addEventListener('click', () => { delete cfg.switch_vlan[key]; renderTable(); });
        cells.push(del);
        rows.push(cells);
      });
      tableWrap.appendChild(table(headers, rows));

      const addBtn = el('button', { class: 'btn btn-sm', text: '+ Dodaj VLAN', style: 'margin-top:12px' });
      addBtn.addEventListener('click', () => {
        const ids = Object.values(cfg.switch_vlan).map((x) => parseInt(x.vlan, 10) || 0);
        const nextVlan = (Math.max(0, ...ids) + 1);
        const key = 'vlan' + nextVlan;
        cfg.switch_vlan[key] = { device: 'switch0', vlan: String(nextVlan), ports: '0t' };
        renderTable();
      });
      tableWrap.appendChild(addBtn);
    }
    renderTable();

    const body = el('div');
    body.appendChild(valueRow('Włącz obsługę VLAN', 'Aktywuje znaczniki 802.1Q na przełączniku switch0.', swEnableChk));
    body.appendChild(el('h3', { text: 'Tablica VLAN' }));
    body.appendChild(tableWrap);

    const save = async (apply) => {
      // walidacja VLAN ID
      const seen = new Set();
      for (const v of Object.values(cfg.switch_vlan)) {
        if (!validate.range(v.vlan, 1, 4094)) { toast('VLAN ID musi być z zakresu 1–4094.', 'err'); return; }
        if (seen.has(v.vlan)) { toast('Zduplikowany VLAN ID: ' + v.vlan, 'err'); return; }
        seen.add(v.vlan);
      }
      if (!cfg.switch.switch0) cfg.switch.switch0 = { name: 'switch0', reset: '1' };
      cfg.switch.switch0.enable_vlan = swEnableChk.checked ? '1' : '0';
      await saveSection('network', cfg, apply);
      App.navigate('#/admin/network/vlan');
    };

    body.appendChild(cliBox(
      'uci set network.@switch[0].enable_vlan=\'1\'\n' +
      'uci set network.@switch_vlan[0].vlan=\'1\'\n' +
      'uci set network.@switch_vlan[0].ports=\'0t 2 3 4 5\'   ' +
      '# LAN: CPU tagged, porty 2-5 untagged\n' +
      'uci commit network && /etc/init.d/network restart'
    ));
    body.appendChild(saveBar({
      onSaveApply: () => save(true),
      onSave: () => save(false),
      onReset: () => App.navigate('#/admin/network/vlan')
    }));

    root.appendChild(panel('VLAN — switch0', 'TP-Link Archer C6 · MT7621', body));
    return root;
  }

  /* =======================================================
     SYSTEM / SYSTEM (hostname, timezone)
     ======================================================= */
  async function systemSystem() {
    const root = el('div');
    root.appendChild(el('h2', { text: 'System' }));
    root.appendChild(el('div', { class: 'cbi-map-descr', text: 'Podstawowe ustawienia systemu: nazwa hosta i strefa czasowa.' }));

    const cfg = await API.getConfig('system');
    const sys = cfg.system['@system[0]'];

    const body = el('div');
    const hostInput = textInput(sys.hostname || 'OpenWrt');
    const tzSel = selectInput(sys.zonename || 'UTC', [
      'UTC', 'Europe/Warsaw', 'Europe/Berlin', 'Europe/London', 'Europe/Prague',
      'America/New_York', 'Asia/Tokyo'
    ]);
    body.appendChild(valueRow('Nazwa hosta', 'Nazwa identyfikująca router w sieci.', hostInput, { required: true }));
    body.appendChild(valueRow('Strefa czasowa', 'Wpływa na czas systemowy i logi.', tzSel));

    const save = async (apply) => {
      if (!validate.notEmpty(hostInput.value)) { toast('Nazwa hosta nie może być pusta.', 'err'); return; }
      cfg.system['@system[0]'] = Object.assign(sys, {
        hostname: hostInput.value.trim(),
        zonename: tzSel.value,
        timezone: tzSel.value === 'Europe/Warsaw' ? 'CET-1CEST,M3.5.0,M10.5.0/3' : 'UTC'
      });
      await saveSection('system', cfg, apply);
      if (apply) {
        document.getElementById('hdr-hostname').textContent = hostInput.value.trim();
        document.getElementById('login-host').textContent = hostInput.value.trim();
      }
    };
    body.appendChild(saveBar({
      onSaveApply: () => save(true),
      onSave: () => save(false),
      onReset: () => App.navigate('#/admin/system/system')
    }));
    root.appendChild(panel('Właściwości systemu', null, body));
    return root;
  }

  /* =======================================================
     SYSTEM / ADMINISTRATION (hasło)
     ======================================================= */
  async function systemAdmin() {
    const root = el('div');
    root.appendChild(el('h2', { text: 'Administracja' }));
    root.appendChild(el('div', { class: 'cbi-map-descr', text: 'Zmiana hasła administratora (użytkownik root).' }));

    const body = el('div');
    const p1 = textInput('', { password: true });
    const p2 = textInput('', { password: true });
    body.appendChild(valueRow('Nowe hasło', 'Hasło dostępu do panelu LuCI i SSH.', p1));
    body.appendChild(valueRow('Powtórz hasło', null, p2));
    const btn = el('button', { class: 'btn btn-apply', text: 'Zmień hasło' });
    btn.addEventListener('click', async () => {
      if (p1.value !== p2.value) { toast('Hasła nie są identyczne.', 'err'); return; }
      if (p1.value.length < 1) { toast('Podaj nowe hasło.', 'err'); return; }
      await API.setPassword(p1.value);
      toast('Hasło zostało zmienione.', 'ok');
      p1.value = ''; p2.value = '';
    });
    const bar = el('div', { class: 'btn-row right' }); bar.appendChild(btn);
    body.appendChild(bar);
    root.appendChild(panel('Hasło routera', 'użytkownik root', body));

    root.appendChild(el('div', { class: 'note info', html: 'Po resecie fabrycznym hasło wraca do pustego (login: <code>root</code> bez hasła lub <code>admin</code>).' }));
    return root;
  }

  /* =======================================================
     SYSTEM / BACKUP & FLASH (RESET)
     ======================================================= */
  async function systemFlash() {
    const root = el('div');
    root.appendChild(el('h2', { text: 'Kopia zapasowa / Reset' }));
    root.appendChild(el('div', { class: 'cbi-map-descr', text: 'Pobierz lub wgraj kopię konfiguracji, albo przywróć ustawienia fabryczne.' }));

    // Kopia zapasowa
    const backupBody = el('div');
    backupBody.appendChild(el('p', { class: 'panel-descr', text: 'Pobierz aktualną konfigurację jako plik JSON, aby później ją przywrócić.' }));
    const dlBtn = el('button', { class: 'btn btn-primary', text: '⤓ Pobierz kopię zapasową' });
    dlBtn.addEventListener('click', async () => {
      const data = await API.backup();
      const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const a = el('a', { href: url, download: 'backup-archer-c6.json' });
      document.body.appendChild(a); a.click(); a.remove();
      URL.revokeObjectURL(url);
      toast('Kopia zapasowa pobrana.', 'ok');
    });
    backupBody.appendChild(dlBtn);
    root.appendChild(panel('Pobierz kopię zapasową', null, backupBody));

    // Przywracanie
    const restoreBody = el('div');
    restoreBody.appendChild(el('p', { class: 'panel-descr', text: 'Wgraj wcześniej pobrany plik kopii zapasowej (.json), aby przywrócić konfigurację.' }));
    const fileInput = el('input', { type: 'file', accept: '.json,application/json' });
    const upBtn = el('button', { class: 'btn', text: 'Przywróć z pliku' });
    upBtn.addEventListener('click', () => {
      const f = fileInput.files && fileInput.files[0];
      if (!f) { toast('Wybierz plik kopii zapasowej.', 'err'); return; }
      const reader = new FileReader();
      reader.onload = async () => {
        try {
          const payload = JSON.parse(reader.result);
          await API.restore(payload);
          toast('Konfiguracja przywrócona. Trwa ponowne ładowanie...', 'ok');
          setTimeout(() => location.reload(), 1200);
        } catch (e) {
          toast('Nieprawidłowy plik kopii zapasowej.', 'err');
        }
      };
      reader.readAsText(f);
    });
    restoreBody.appendChild(el('div', { class: 'inline-group' }, [fileInput, upBtn]));
    root.appendChild(panel('Przywróć kopię zapasową', null, restoreBody));

    // RESET FABRYCZNY — kluczowa funkcja szkoleniowa
    const resetBody = el('div');
    resetBody.appendChild(el('div', { class: 'note danger', html: '<b>Uwaga:</b> reset przywróci WSZYSTKIE ustawienia do stanu fabrycznego Archer C6 (LAN 192.168.1.1, WAN=DHCP, Wi-Fi „OpenWrt”, hasło puste). Idealne do ćwiczeń — wykonuj przed każdym nowym zadaniem egzaminacyjnym.' }));
    const resetBtn = el('button', { class: 'btn btn-danger', text: '⟳ Przywróć ustawienia fabryczne' });
    resetBtn.addEventListener('click', () => {
      confirmDialog('Reset do ustawień fabrycznych',
        'Czy na pewno przywrócić ustawienia fabryczne? Cała konfiguracja zostanie utracona, a Ty zostaniesz wylogowany.',
        async () => {
          await API.reset();
          toast('Przywrócono ustawienia fabryczne. Wylogowywanie...', 'ok');
          setTimeout(() => { sessionStorage.removeItem('sysauth'); location.reload(); }, 1200);
        }, 'Tak, resetuj', 'btn-danger');
    });
    resetBody.appendChild(resetBtn);
    root.appendChild(panel('Przywróć ustawienia fabryczne', 'Reset konfiguracji', resetBody));

    return root;
  }

  /* =======================================================
     UCI / NIEZAPISANE ZMIANY
     ======================================================= */
  async function uciChanges() {
    const root = el('div');
    root.appendChild(el('h2', { text: 'Niezapisane zmiany' }));
    root.appendChild(el('div', { class: 'cbi-map-descr', text: 'Lista plików konfiguracyjnych zmienionych, lecz jeszcze niezastosowanych (jak w prawdziwym LuCI).' }));

    const ch = await API.changes();
    const body = el('div');
    if (!ch.count) {
      body.appendChild(el('div', { class: 'note ok', text: 'Brak niezapisanych zmian. Cała konfiguracja jest zastosowana.' }));
    } else {
      body.appendChild(el('div', { class: 'note warn', html: 'Oczekujące zmiany w plikach: <b>' + ch.changes.map((c) => '/etc/config/' + c).join(', ') + '</b>' }));
      const applyBtn = el('button', { class: 'btn btn-apply', text: 'Zapisz i zastosuj' });
      applyBtn.addEventListener('click', async () => { await API.apply(); toast('Zmiany zastosowane.', 'ok'); App.refreshChanges(); App.navigate('#/admin/uci/changes'); });
      const revertBtn = el('button', { class: 'btn btn-danger', text: 'Cofnij zmiany' });
      revertBtn.addEventListener('click', async () => { await API.revert(); toast('Zmiany cofnięte.', 'warn'); App.refreshChanges(); App.navigate('#/admin/uci/changes'); });
      const bar = el('div', { class: 'btn-row' }); bar.appendChild(applyBtn); bar.appendChild(revertBtn);
      body.appendChild(bar);
    }
    root.appendChild(panel('Zmiany konfiguracji', null, body));
    return root;
  }

  /* =======================================================
     POMOC / SAMOUCZEK EGZAMINACYJNY
     ======================================================= */
  async function help() {
    const root = el('div');
    root.appendChild(el('h2', { text: 'Pomoc — przygotowanie do egzaminu' }));
    root.appendChild(el('div', { class: 'cbi-map-descr', text: 'Skrót typowych zadań konfiguracyjnych OpenWrt na egzaminie zawodowym (INF.02 / EE.08).' }));

    const tasks = [
      ['Adres IP routera (LAN)', 'Sieć → Interfejsy → LAN → Edytuj → Protokół: Statyczny, Adres IPv4 + Maska.'],
      ['Połączenie z Internetem (WAN)', 'Sieć → Interfejsy → WAN → Edytuj → Protokół: Klient DHCP / Statyczny / PPPoE.'],
      ['Sieć Wi-Fi (SSID + hasło)', 'Sieć → Wi-Fi → Edytuj → SSID, Szyfrowanie WPA2-PSK, Klucz (min. 8 znaków).'],
      ['Serwer DHCP / zakres adresów', 'Sieć → DHCP i DNS → Start, Limit, Czas dzierżawy.'],
      ['VLAN na przełączniku', 'Sieć → Switch (VLAN) → dodaj VLAN, ustaw porty untagged/tagged.'],
      ['Zmiana hasła administratora', 'System → Administracja → Nowe hasło.'],
      ['Reset przed nowym zadaniem', 'System → Kopia zapasowa / Reset → Przywróć ustawienia fabryczne.']
    ];
    const rows = tasks.map((t) => [el('b', { text: t[0] }), t[1]]);
    root.appendChild(panel('Mapa typowych zadań', null, table(['Zadanie', 'Gdzie wykonać'], rows)));

    root.appendChild(panel('Najważniejsze polecenia UCI (CLI)', 'odpowiednik konfiguracji z GUI', cliBox(
      '# Wyświetl konfigurację\n' +
      'uci show network\n\n' +
      '# Ustaw adres LAN\n' +
      'uci set network.lan.ipaddr=\'192.168.1.1\'\n' +
      'uci set network.lan.netmask=\'255.255.255.0\'\n\n' +
      '# Ustaw Wi-Fi\n' +
      'uci set wireless.default_radio0.ssid=\'MojaSiec\'\n' +
      'uci set wireless.default_radio0.encryption=\'psk2\'\n' +
      'uci set wireless.default_radio0.key=\'tajnehaslo\'\n\n' +
      '# Zatwierdź i zastosuj\n' +
      'uci commit\n' +
      '/etc/init.d/network restart && wifi reload\n\n' +
      '# Reset fabryczny\n' +
      'firstboot && reboot'
    )));
    return root;
  }

  return {
    statusOverview, networkInterfaces, networkWireless, networkDhcp, networkVlan,
    systemSystem, systemAdmin, systemFlash, uciChanges, help
  };
})();
