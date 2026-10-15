/* Owner admin page (prototype: saves to this browser). */
(function () {
  let cfg = SN.load();
  let dirty = false;
  let toastTimer = null;
  const $ = (s, r) => (r || document).querySelector(s);
  const $$ = (s, r) => Array.from((r || document).querySelectorAll(s));
  const esc = SN.esc;
  const money = SN.money;
  const STATUSES = ['New', 'Invoiced', 'Paid', 'Baking', 'Ready', 'Completed', 'Cancelled'];

  function markDirty() { dirty = true; $('#save-bar').classList.add('show'); }
  function toast(msg) {
    $('#toast-text').textContent = msg;
    $('#toast').classList.add('show');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => $('#toast').classList.remove('show'), 2600);
  }

  /* ---------- Simple fields (data-path) ---------- */
  function fillFields() {
    $$('[data-path]').forEach((el) => {
      const v = cfg[el.dataset.path];
      el.value = v == null ? '' : v;
    });
    const sw = $('#accepting');
    sw.setAttribute('aria-checked', String(!!cfg.acceptingOrders));
    $('#accepting-text').textContent = cfg.acceptingOrders ? 'Open' : 'Paused';
  }
  document.addEventListener('input', (e) => {
    const el = e.target;
    if (el.dataset.path) {
      let v = el.value;
      if (el.dataset.type === 'int') v = v === '' ? 0 : parseInt(v, 10);
      if (el.dataset.type === 'num') v = v === '' ? 0 : parseFloat(v);
      cfg[el.dataset.path] = v;
      markDirty();
      if (el.dataset.path === 'maxDesigns') checkTiers();
      return;
    }
    if (el.dataset.list) {
      const list = cfg[el.dataset.list];
      const i = Number(el.dataset.i);
      let v = el.value;
      if (el.dataset.type === 'num') v = v === '' ? 0 : parseFloat(v);
      if (el.dataset.type === 'int') v = v === '' ? 0 : parseInt(v, 10);
      if (el.dataset.key === 'zip') { v = v.replace(/\D/g, '').slice(0, 5); if (el.value !== v) el.value = v; }
      list[i][el.dataset.key] = v;
      markDirty();
      if (el.dataset.list === 'customTiers') checkTiers();
    }
  });
  $('#accepting').addEventListener('click', () => {
    cfg.acceptingOrders = !cfg.acceptingOrders;
    fillFields();
    markDirty();
  });

  /* ---------- Orders ---------- */
  function renderOrders() {
    const orders = SN.getOrders();
    const body = $('#orders-body');
    if (!orders.length) {
      body.innerHTML = '<tr class="empty-row"><td colspan="8">No orders yet. Place a test order on the <a href="index.html">order page</a> and it will show up here.</td></tr>';
      return;
    }
    body.innerHTML = orders.map((o, i) => {
      const items = o.items.map((it) => esc(it.qty + ' ' + SN.itemLabel(it.kind))).join('<br>');
      const ful = o.fulfillment === 'delivery' && o.address ? 'Drop-off · ' + esc(o.address.zip) : 'Pickup';
      return '<tr>' +
        '<td class="nowrap"><strong>' + esc(o.number) + '</strong><br><a href="email.html?o=' + encodeURIComponent(o.number) + '" target="_blank" rel="noopener" style="font-size:13px">View email</a></td>' +
        '<td>' + esc(o.customer.name) + '<br><span class="muted" style="font-size:13px">' + esc(o.customer.email) + '<br>' + esc(o.customer.phone) + '</span></td>' +
        '<td class="nowrap">' + esc(SN.prettyDate(o.dateNeeded, { month: 'short', day: 'numeric', year: 'numeric' })) + '</td>' +
        '<td>' + esc(o.eventType) + '</td>' +
        '<td class="nowrap">' + items + '</td>' +
        '<td class="nowrap">' + ful + '</td>' +
        '<td class="nowrap"><strong>' + money(o.total) + '</strong></td>' +
        '<td><label class="sr-only" for="st-' + i + '">Status for ' + esc(o.number) + '</label><select class="status" id="st-' + i + '" data-order="' + i + '">' +
          STATUSES.map((s) => '<option' + (s === o.status ? ' selected' : '') + '>' + s + '</option>').join('') + '</select></td>' +
        '</tr>';
    }).join('');
  }
  $('#orders-body').addEventListener('change', (e) => {
    const sel = e.target.closest('[data-order]');
    if (!sel) return;
    const orders = SN.getOrders();
    orders[Number(sel.dataset.order)].status = sel.value;
    SN.setOrders(orders);
    toast(orders[Number(sel.dataset.order)].number + ' marked ' + sel.value);
  });
  $('#clear-orders').addEventListener('click', () => {
    if (!confirm('Clear all demo orders from this browser?')) return;
    SN.setOrders([]);
    renderOrders();
    toast('Demo orders cleared');
  });

  /* ---------- Custom tiers ---------- */
  function renderTiers() {
    $('#tiers-body').innerHTML = cfg.customTiers.map((t, i) =>
      '<tr>' +
        '<td><label class="sr-only" for="tf-' + i + '">Designs from</label><input class="input" id="tf-' + i + '" type="number" min="1" style="max-width:110px" data-list="customTiers" data-i="' + i + '" data-key="from" data-type="int" value="' + t.from + '"></td>' +
        '<td><label class="sr-only" for="tt-' + i + '">Designs to</label><input class="input" id="tt-' + i + '" type="number" min="1" style="max-width:110px" data-list="customTiers" data-i="' + i + '" data-key="to" data-type="int" value="' + t.to + '"></td>' +
        '<td><div class="input-wrap" style="max-width:160px"><span>$</span><label class="sr-only" for="tp-' + i + '">Price per cookie</label><input id="tp-' + i + '" type="number" min="0" step="0.25" data-list="customTiers" data-i="' + i + '" data-key="price" data-type="num" value="' + t.price + '"></div></td>' +
        '<td><button type="button" class="icon-del" data-act="del-tier" data-i="' + i + '" aria-label="Delete tier ' + (i + 1) + '">' + SN_ICONS.trash + '</button></td>' +
      '</tr>').join('');
    checkTiers();
  }
  function checkTiers() {
    const warn = $('#tier-warn');
    const msgs = [];
    for (let n = 1; n <= cfg.maxDesigns; n++) {
      if (!cfg.customTiers.some((t) => n >= t.from && n <= t.to)) { msgs.push(n); }
    }
    if (msgs.length) {
      warn.hidden = false;
      warn.textContent = 'No price tier covers ' + msgs.join(', ') + ' design' + (msgs.length > 1 ? 's' : '') + '. Those will use the highest tier price until you add a tier.';
    } else warn.hidden = true;
  }

  /* ---------- Flavors ---------- */
  function renderFlavors() {
    $('#flavor-list').innerHTML = cfg.flavors.map((f, i) =>
      '<div class="flavor-row" style="flex-wrap:wrap">' +
        '<div style="flex:1 1 200px;min-width:0"><label class="sr-only" for="fn-' + i + '">Flavor name</label>' +
          '<input class="input" id="fn-' + i + '" type="text" data-list="flavors" data-i="' + i + '" data-key="name" value="' + esc(f.name) + '" style="max-width:320px' + (f.on ? '' : ';color:var(--muted)') + '">' +
          (f.special ? ' <span class="badge" style="margin-left:6px">SPECIAL</span>' : '') +
        '</div>' +
        '<div style="display:flex;align-items:center;gap:4px">' +
          '<button type="button" class="link-btn" data-act="special" data-i="' + i + '" style="padding:10px">' + (f.special ? 'Unmark special' : 'Make special') + '</button>' +
          '<button type="button" class="switch" role="switch" aria-checked="' + !!f.on + '" data-act="toggle-flavor" data-i="' + i + '" aria-label="Show ' + esc(f.name) + ' on the menu"><span class="track" aria-hidden="true"></span>' + (f.on ? 'Showing' : 'Hidden') + '</button>' +
          '<button type="button" class="icon-del" data-act="del-flavor" data-i="' + i + '" aria-label="Delete ' + esc(f.name) + '">' + SN_ICONS.trash + '</button>' +
        '</div>' +
      '</div>').join('') || '<p class="hint" style="padding:14px 0">No flavors yet. Add one below.</p>';
  }
  $('#add-flavor').addEventListener('submit', (e) => {
    e.preventDefault();
    const input = $('#new-flavor');
    const name = input.value.trim();
    if (!name) { input.focus(); return; }
    if (cfg.flavors.some((f) => f.name.toLowerCase() === name.toLowerCase())) { toast(name + ' is already on the list'); return; }
    cfg.flavors.push({ id: 'f' + Date.now().toString(36), name, on: true, special: false });
    input.value = '';
    renderFlavors();
    markDirty();
    toast(name + ' added. Save to put it on the menu.');
  });

  /* ---------- Blocked dates ---------- */
  function renderBlocked() {
    const list = cfg.blockedDates.slice().sort();
    $('#blocked').innerHTML = list.length ? list.map((d) =>
      '<span class="chip">' + esc(SN.prettyDate(d, { weekday: 'short', month: 'short', day: 'numeric', year: 'numeric' })) +
      '<button type="button" data-act="del-block" data-d="' + esc(d) + '" aria-label="Unblock ' + esc(d) + '">' + SN_ICONS.close + '</button></span>').join('')
      : '<span class="hint">No blocked dates.</span>';
  }
  $('#add-block').addEventListener('submit', (e) => {
    e.preventDefault();
    const v = $('#new-block').value;
    if (!v) return;
    if (!cfg.blockedDates.includes(v)) cfg.blockedDates.push(v);
    $('#new-block').value = '';
    renderBlocked();
    markDirty();
  });

  /* ---------- Zones ---------- */
  function renderZones() {
    $('#zones-body').innerHTML = cfg.zones.map((z, i) =>
      '<tr>' +
        '<td><label class="sr-only" for="zz-' + i + '">ZIP</label><input class="input" id="zz-' + i + '" type="text" inputmode="numeric" maxlength="5" style="max-width:110px" data-list="zones" data-i="' + i + '" data-key="zip" value="' + esc(z.zip) + '"></td>' +
        '<td><label class="sr-only" for="za-' + i + '">Area name</label><input class="input" id="za-' + i + '" type="text" data-list="zones" data-i="' + i + '" data-key="area" value="' + esc(z.area) + '"></td>' +
        '<td><div class="input-wrap" style="max-width:130px"><span>$</span><label class="sr-only" for="zf-' + i + '">Fee</label><input id="zf-' + i + '" type="number" min="0" step="1" data-list="zones" data-i="' + i + '" data-key="fee" data-type="num" value="' + z.fee + '"></div></td>' +
        '<td><button type="button" class="icon-del" data-act="del-zone" data-i="' + i + '" aria-label="Delete ZIP ' + esc(z.zip) + '">' + SN_ICONS.trash + '</button></td>' +
      '</tr>').join('') || '<tr class="empty-row"><td colspan="4">No drop-off zones. Customers will only see pickup.</td></tr>';
  }

  /* ---------- Clicks for list actions ---------- */
  document.addEventListener('click', (e) => {
    const b = e.target.closest('[data-act]');
    if (!b) return;
    const i = Number(b.dataset.i);
    switch (b.dataset.act) {
      case 'add-tier': {
        const last = cfg.customTiers[cfg.customTiers.length - 1];
        const from = last ? Number(last.to) + 1 : 1;
        cfg.customTiers.push({ from, to: from, price: last ? last.price : 5 });
        renderTiers(); break;
      }
      case 'del-tier': cfg.customTiers.splice(i, 1); renderTiers(); break;
      case 'special': cfg.flavors[i].special = !cfg.flavors[i].special; renderFlavors(); break;
      case 'toggle-flavor': cfg.flavors[i].on = !cfg.flavors[i].on; renderFlavors(); break;
      case 'del-flavor':
        if (!confirm('Delete ' + cfg.flavors[i].name + '? To take it off the menu for now, use Hidden instead.')) return;
        cfg.flavors.splice(i, 1); renderFlavors(); break;
      case 'del-block': cfg.blockedDates = cfg.blockedDates.filter((d) => d !== b.dataset.d); renderBlocked(); break;
      case 'add-zone': cfg.zones.push({ zip: '', area: '', fee: 5 }); renderZones(); $('#zz-' + (cfg.zones.length - 1)).focus(); break;
      case 'del-zone': cfg.zones.splice(i, 1); renderZones(); break;
      default: return;
    }
    markDirty();
  });

  /* ---------- Save / discard ---------- */
  function save() {
    cfg.zones = cfg.zones.filter((z) => /^\d{5}$/.test(z.zip));
    cfg.customTiers.sort((a, b) => a.from - b.from);
    if (SN.save(cfg)) {
      dirty = false;
      $('#save-bar').classList.remove('show');
      renderAll();
      toast('Saved. The order page now uses these settings.');
    } else {
      toast('Could not save in this browser.');
    }
  }
  $('#save-top').addEventListener('click', save);
  $('#save-bottom').addEventListener('click', save);
  $('#discard').addEventListener('click', () => {
    cfg = SN.load();
    dirty = false;
    $('#save-bar').classList.remove('show');
    renderAll();
    toast('Changes discarded');
  });
  $('#reset-defaults').addEventListener('click', () => {
    if (!confirm('Reset every setting back to the starting defaults?')) return;
    SN.reset();
    cfg = SN.load();
    dirty = false;
    $('#save-bar').classList.remove('show');
    renderAll();
    toast('Settings reset to defaults');
  });
  window.addEventListener('beforeunload', (e) => { if (dirty) { e.preventDefault(); e.returnValue = ''; } });

  function renderAll() {
    fillFields();
    renderOrders();
    renderTiers();
    renderFlavors();
    renderBlocked();
    renderZones();
  }
  renderAll();
})();
