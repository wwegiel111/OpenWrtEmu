'use strict';

/* Pomocnicze funkcje budujące UI w stylu LuCI (CBI). */
const UI = (function () {

  function el(tag, attrs, children) {
    const e = document.createElement(tag);
    if (attrs) {
      for (const [k, v] of Object.entries(attrs)) {
        if (v == null) continue;
        if (k === 'class') e.className = v;
        else if (k === 'html') e.innerHTML = v;
        else if (k === 'text') e.textContent = v;
        else if (k.startsWith('on') && typeof v === 'function') e.addEventListener(k.slice(2), v);
        else if (k === 'value') e.value = v;
        else if (k === 'checked') { if (v) e.checked = true; }
        else e.setAttribute(k, v);
      }
    }
    if (children != null) {
      (Array.isArray(children) ? children : [children]).forEach((c) => {
        if (c == null) return;
        e.appendChild(typeof c === 'string' ? document.createTextNode(c) : c);
      });
    }
    return e;
  }

  function clear(node) { while (node.firstChild) node.removeChild(node.firstChild); }

  /* ---- Toast ---- */
  function toast(msg, type) {
    const cont = document.getElementById('toast-container');
    const t = el('div', { class: 'toast ' + (type || ''), text: msg });
    cont.appendChild(t);
    setTimeout(() => {
      t.style.transition = 'opacity .3s';
      t.style.opacity = '0';
      setTimeout(() => t.remove(), 300);
    }, type === 'err' ? 4500 : 2800);
  }

  /* ---- Modal ---- */
  function modal({ title, body, buttons }) {
    const overlay = document.getElementById('modal-overlay');
    const m = document.getElementById('modal');
    clear(m);
    m.appendChild(el('div', { class: 'modal-head', text: title }));
    const bodyEl = el('div', { class: 'modal-body' });
    if (typeof body === 'string') bodyEl.innerHTML = body;
    else bodyEl.appendChild(body);
    m.appendChild(bodyEl);
    const foot = el('div', { class: 'modal-foot' });
    (buttons || []).forEach((b) => {
      const btn = el('button', { class: 'btn ' + (b.class || ''), text: b.label });
      btn.addEventListener('click', () => { if (b.onClick) b.onClick(closeModal); });
      foot.appendChild(btn);
    });
    m.appendChild(foot);
    overlay.classList.remove('hidden');
    overlay.onclick = (e) => { if (e.target === overlay) closeModal(); };
  }
  function closeModal() {
    document.getElementById('modal-overlay').classList.add('hidden');
  }

  function confirmDialog(title, message, onYes, yesLabel, yesClass) {
    modal({
      title,
      body: '<p style="margin:0 0 6px">' + message + '</p>',
      buttons: [
        { label: 'Anuluj', class: '', onClick: (close) => close() },
        { label: yesLabel || 'Potwierdź', class: yesClass || 'btn-danger', onClick: (close) => { close(); onYes(); } }
      ]
    });
  }

  /* ---- Elementy formularza (CBI) ---- */

  // Pole tekstowe
  function valueRow(label, descr, inputEl, opts) {
    opts = opts || {};
    const row = el('div', { class: 'cbi-value' + (opts.required ? ' required' : '') });
    row.appendChild(el('label', { text: label }));
    const field = el('div', { class: 'cbi-value-field' });
    field.appendChild(inputEl);
    if (descr) field.appendChild(el('span', { class: 'descr', html: descr }));
    row.appendChild(field);
    return row;
  }

  function textInput(value, opts) {
    opts = opts || {};
    return el('input', {
      type: opts.password ? 'password' : (opts.number ? 'number' : 'text'),
      value: value == null ? '' : value,
      class: opts.cls || '',
      placeholder: opts.placeholder || '',
      'data-key': opts.key || ''
    });
  }

  function selectInput(value, options, opts) {
    opts = opts || {};
    const sel = el('select', { 'data-key': opts.key || '' });
    options.forEach((o) => {
      const val = typeof o === 'string' ? o : o.value;
      const lbl = typeof o === 'string' ? o : o.label;
      const optEl = el('option', { value: val, text: lbl });
      if (String(val) === String(value)) optEl.selected = true;
      sel.appendChild(optEl);
    });
    return sel;
  }

  function checkboxInput(checked, opts) {
    opts = opts || {};
    return el('input', { type: 'checkbox', checked: !!checked, 'data-key': opts.key || '' });
  }

  function panel(title, sub, bodyChildren, descr) {
    const p = el('div', { class: 'panel' });
    const head = el('div', { class: 'panel-head' });
    head.appendChild(el('span', { text: title }));
    if (sub) head.appendChild(el('span', { class: 'sub', text: sub }));
    p.appendChild(head);
    const body = el('div', { class: 'panel-body' });
    if (descr) body.appendChild(el('div', { class: 'panel-descr', html: descr }));
    (Array.isArray(bodyChildren) ? bodyChildren : [bodyChildren]).forEach((c) => { if (c) body.appendChild(c); });
    p.appendChild(body);
    return p;
  }

  function table(headers, rows) {
    const t = el('table', { class: 'tbl' });
    const thead = el('thead');
    const tr = el('tr');
    headers.forEach((h) => tr.appendChild(el('th', { text: h })));
    thead.appendChild(tr);
    t.appendChild(thead);
    const tbody = el('tbody');
    rows.forEach((r) => {
      const row = el('tr');
      r.forEach((c) => {
        const td = el('td');
        if (c instanceof Node) td.appendChild(c);
        else td.innerHTML = c == null ? '' : String(c);
        row.appendChild(td);
      });
      tbody.appendChild(row);
    });
    t.appendChild(tbody);
    return t;
  }

  function badge(text, type) { return el('span', { class: 'badge badge-' + type, text }); }

  // Wiersz przycisków zapisu (Save & Apply / Save / Reset) jak w LuCI
  function saveBar({ onSaveApply, onSave, onReset }) {
    const bar = el('div', { class: 'btn-row right' });
    if (onReset) {
      const b = el('button', { class: 'btn', text: 'Przywróć' });
      b.addEventListener('click', onReset); bar.appendChild(b);
    }
    if (onSave) {
      const b = el('button', { class: 'btn', text: 'Zapisz' });
      b.addEventListener('click', onSave); bar.appendChild(b);
    }
    if (onSaveApply) {
      const b = el('button', { class: 'btn btn-apply', text: 'Zapisz i zastosuj' });
      b.addEventListener('click', onSaveApply); bar.appendChild(b);
    }
    return bar;
  }

  /* ---- Walidacja ---- */
  const validate = {
    ipv4(v) {
      if (!/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.test(v)) return false;
      return v.split('.').every((o) => +o >= 0 && +o <= 255);
    },
    netmask(v) {
      if (!validate.ipv4(v)) return false;
      const bin = v.split('.').map((o) => (+o).toString(2).padStart(8, '0')).join('');
      return /^1*0*$/.test(bin);
    },
    cidr(v) { return /^\d{1,2}$/.test(v) && +v <= 32; },
    port(v) { return /^\d+$/.test(v) && +v >= 0 && +v <= 65535; },
    range(v, lo, hi) { return /^\d+$/.test(v) && +v >= lo && +v <= hi; },
    notEmpty(v) { return v != null && String(v).trim() !== ''; },
    mac(v) { return /^([0-9a-fA-F]{2}:){5}[0-9a-fA-F]{2}$/.test(v); }
  };

  function fmtBytes(n) {
    if (n == null) return '—';
    const u = ['B', 'KiB', 'MiB', 'GiB', 'TiB'];
    let i = 0; let v = n;
    while (v >= 1024 && i < u.length - 1) { v /= 1024; i++; }
    return v.toFixed(i ? 2 : 0) + ' ' + u[i];
  }
  function fmtDuration(sec) {
    if (sec == null) return '—';
    const d = Math.floor(sec / 86400);
    const h = Math.floor((sec % 86400) / 3600);
    const m = Math.floor((sec % 3600) / 60);
    const s = sec % 60;
    let out = '';
    if (d) out += d + 'd ';
    out += String(h).padStart(2, '0') + 'h ' + String(m).padStart(2, '0') + 'm ' + String(s).padStart(2, '0') + 's';
    return out;
  }

  return {
    el, clear, toast, modal, closeModal, confirmDialog,
    valueRow, textInput, selectInput, checkboxInput,
    panel, table, badge, saveBar, validate, fmtBytes, fmtDuration
  };
})();
