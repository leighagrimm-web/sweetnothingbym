/*
 * Owner admin page. Runs inside the Apps Script admin web app (apps-script/Admin.html loads this file from the
 * website) and talks to the Sheet through google.script.run. Every server function checks the caller is the
 * Sheet's owner.
 */
(function () {
  const app = document.getElementById('admin-app');
  const siteUrl = (window.SN_ADMIN && window.SN_ADMIN.siteUrl) || '';
  const $ = (s, r) => (r || document).querySelector(s);
  const $$ = (s, r) => Array.from((r || document).querySelectorAll(s));
  const esc = SN.esc;
  const money = SN.money;

  let cfg = null;          // settings being edited
  let stamp = '';          // fingerprint of the Sheet's settings when loaded (to notice edits made in the Sheet)
  let orders = [];
  let messages = [];
  let dayCounts = {};
  let sheetUrl = '';
  let dirty = false;
  let busy = false;
  let showAllOrders = false;
  let toastTimer = null;

  // google.script.run as a promise.
  function server(name) {
    const args = Array.prototype.slice.call(arguments, 1);
    return new Promise((resolve, reject) => {
      google.script.run.withSuccessHandler(resolve).withFailureHandler(reject)[name].apply(null, args);
    });
  }
  function failed(err) {
    busy = false;
    toast('Something went wrong: ' + (err && err.message ? err.message : err) + '. Nothing was lost; please try again.', 6000);
  }

  /* ---------- Page shell (same layout as the prototype admin) ---------- */
  function shell() {
    const isProd = String(cfg.environment || '').toUpperCase() === 'PROD';
    app.innerHTML =
      (isProd ? '' : '<div class="proto-banner">Test admin: connected to the test Sheet. Emails go out with [TEST] in the subject.</div>') +
      '<header class="admin-header"><div class="wrap">' +
        '<span class="brand"><img src="' + esc(siteUrl) + 'logo.png" alt=""><span>Sweet Nothings · Admin</span></span>' +
        '<div class="row-gap" style="gap:8px">' +
          (sheetUrl ? '<a class="btn ghost small" href="' + esc(sheetUrl) + '" target="_blank" rel="noopener">Open the Sheet</a>' : '') +
          '<a class="btn ghost small" href="' + esc(siteUrl) + 'index.html" target="_blank" rel="noopener">View site</a>' +
        '</div>' +
      '</div></header>' +
      '<div class="wrap admin-layout">' +
        '<nav class="admin-nav" aria-label="Admin sections">' +
          TAB_GROUPS.map(([group, tabs]) => '<span class="admin-nav-group">' + group + '</span>' +
            tabs.map(([id, label]) => '<a href="#' + id + '" target="_self" data-tab="' + id + '">' + label + '<span class="nav-count" id="nav-count-' + id + '" hidden></span></a>').join('')).join('') +
        '</nav>' +
        '<main class="admin-main">' +
          '<div class="admin-title" id="settings-title"><div><h1>Shop settings</h1>' +
            '<p>Use <strong>Preview changes</strong> to see the site with your edits before anything goes live. Customers only see changes after you save.</p></div>' +
            '<div class="row-gap" style="gap:10px"><button type="button" class="btn ghost" data-preview>Preview changes</button><button type="button" class="btn" data-save>Save changes</button></div>' +
          '</div>' +
          sectionOrders() + sectionMessages() + sectionCustom() + sectionArtisan() + sectionRules() + sectionZones() + sectionFaq() +
          sectionPages() + sectionEvents() + sectionGallery() + sectionSettings() +
        '</main>' +
      '</div>' +
      '<div class="scrim" id="scrim"></div>' +
      '<aside class="panel review-panel" id="review" role="dialog" aria-modal="true" aria-labelledby="review-title" tabindex="-1"></aside>' +
      '<div class="save-bar" id="save-bar" role="region" aria-label="Unsaved changes"><div class="wrap"><span>You have unsaved changes.</span>' +
        '<div class="row-gap"><button type="button" class="btn ghost small" id="discard">Discard</button>' +
        '<button type="button" class="btn ghost small" data-preview>Preview changes</button>' +
        '<button type="button" class="btn small" data-save>Save changes</button></div></div></div>' +
      '<div class="toast" id="toast" role="status" aria-live="polite"><span id="toast-text"></span></div>';
    wire();
  }

  // Each tab shows one section. Orders and Messages are day-to-day; the rest are shop settings (saved together).
  const TAB_GROUPS = [
    ['Orders &amp; messages', [['orders', 'Orders'], ['messages', 'Messages']]],
    ['Shop settings', [['custom', 'Custom pricing'], ['artisan', 'Artisan &amp; flavors'], ['rules', 'Ordering rules'], ['zones', 'Drop-off zones'],
      ['faq', 'FAQ'], ['pages', 'Website pages'], ['events', 'Events'], ['gallery', 'Gallery'], ['settings', 'Tax &amp; contact']]]
  ];
  const TAB_IDS = TAB_GROUPS.reduce((a, g) => a.concat(g[1].map((t) => t[0])), []);

  function showTab() {
    const id = TAB_IDS.indexOf(location.hash.slice(1)) !== -1 ? location.hash.slice(1) : 'orders';
    $$('.admin-main > .panel-card').forEach((s) => { s.hidden = s.id !== id; });
    $('#settings-title').hidden = id === 'orders' || id === 'messages';
    $$('.admin-nav a').forEach((a) => { if (a.dataset.tab === id) a.setAttribute('aria-current', 'page'); else a.removeAttribute('aria-current'); });
    window.scrollTo(0, 0);
  }
  // Badge on a tab, e.g. "2 to review".
  function navCount(id, text) {
    const el = $('#nav-count-' + id);
    if (!el) return;
    el.textContent = text || '';
    el.hidden = !text;
  }

  const field = (id, label, input, hint) => '<div class="field"><label class="label" for="' + id + '">' + label + '</label>' + input + (hint ? '<p class="hint">' + hint + '</p>' : '') + '</div>';
  const numInput = (path, attrs, before, after, type) => '<div class="input-wrap">' + (before ? '<span>' + before + '</span>' : '') +
    '<input id="' + path + '" type="number" ' + attrs + ' data-path="' + path + '" data-type="' + (type || 'num') + '">' + (after ? '<span>' + after + '</span>' : '') + '</div>';
  const card = (id, title, sub, body) => '<section class="panel-card" id="' + id + '" aria-labelledby="' + id + '-h"><h2 id="' + id + '-h">' + title + '</h2>' + (sub ? '<p class="sub">' + sub + '</p>' : '') + body + '</section>';
  const PHOTO_HINT = 'Paste a Google Drive share link (in Drive: Share → General access → Anyone with the link → Copy link) or an image link. [Text in brackets] shows a placeholder box; blank shows no photo.';

  function sectionOrders() {
    return '<section class="panel-card" id="orders" aria-labelledby="orders-h">' +
      '<div style="display:flex;flex-wrap:wrap;justify-content:space-between;gap:12px;align-items:flex-start">' +
        '<div><h2 id="orders-h">Orders</h2><p class="sub">New requests come in as <strong>Pending review</strong>. Click <strong>Review</strong> to approve as-is or with changes, or decline. Approving emails the customer their confirmation.</p></div>' +
        '<button type="button" class="btn ghost small" id="orders-toggle"></button>' +
      '</div>' +
      '<div class="table-wrap"><table><thead><tr><th>Order</th><th>Customer</th><th>Needed by</th><th>Event</th><th>Cookies</th><th>Pickup / drop-off</th><th>Total</th><th>Status</th><th><span class="sr-only">Actions</span></th></tr></thead>' +
      '<tbody id="orders-body"></tbody></table></div></section>';
  }
  function sectionMessages() {
    return card('messages', 'Messages', 'From the Contact page and the "Message me" buttons. Each one also landed in your email inbox, so you can reply from there too.', '<div class="stack" id="msg-list"></div>');
  }
  function sectionCustom() {
    return card('custom', 'Custom cookie pricing', 'Customers see a starting price and an estimate. You set the final price when you approve each order.',
      '<div class="fields">' +
        field('customBasePrice', 'Starting price', numInput('customBasePrice', 'min="0" step="0.25"', '$', '/ cookie')) +
        field('minQty', 'Minimum order', numInput('minQty', 'min="1"', '', 'cookies', 'int')) +
        field('maxDesigns', 'Most designs a customer can pick', numInput('maxDesigns', 'min="1" max="24"', '', 'designs', 'int')) +
        '<div class="field" style="grid-column:1 / -1"><label class="label" for="customNote">Pricing note shown to customers</label><textarea class="input" id="customNote" rows="2" data-path="customNote"></textarea></div>' +
      '</div>');
  }
  function sectionArtisan() {
    return card('artisan', 'Artisan cookies &amp; flavors', 'Set prices, add new flavors, hide ones you\'re not baking, and mark a special.',
      '<div class="fields">' +
        field('miniPerDozen', 'Mini, per dozen', numInput('miniPerDozen', 'min="0" step="0.5"', '$')) +
        field('largePerDozen', 'Large, per dozen', numInput('largePerDozen', 'min="0" step="0.5"', '$')) +
        field('flavorsPerDozen', 'Flavors allowed per dozen', numInput('flavorsPerDozen', 'min="1" max="12"', '', 'flavors', 'int')) +
      '</div>' +
      '<h3 style="font-size:22px;margin:26px 0 6px">Flavors</h3><div id="flavor-list" style="border-top:1px solid var(--line)"></div>' +
      '<form id="add-flavor" style="display:flex;flex-wrap:wrap;gap:10px;margin-top:16px;align-items:flex-end">' +
        '<div class="field" style="flex:1 1 240px"><label class="label" for="new-flavor">Add a new flavor</label><input class="input" id="new-flavor" type="text" placeholder="e.g. Salted Caramel" autocomplete="off"></div>' +
        '<button type="submit" class="btn navy">+ Add flavor</button></form>' +
      '<p class="hint" style="margin-top:8px">New flavors show on both the Mini and Large Artisan menus. Hide a flavor to take it off the menu without deleting it.</p>' +
      '<h3 style="font-size:22px;margin:26px 0 12px">Special banner</h3>' +
      '<div class="fields">' +
        '<div class="field" style="grid-column:1 / -1"><label class="label" for="specialText">Banner text (leave blank to hide)</label><input class="input" id="specialText" type="text" data-path="specialText"></div>' +
        field('specialUntil', 'Show until', '<input class="input" id="specialUntil" type="date" data-path="specialUntil">') +
      '</div>');
  }
  function sectionRules() {
    return card('rules', 'Ordering rules', 'Control how far ahead customers must order, how many orders you take per day, and which days are closed.',
      '<div class="fields">' +
        field('leadDays', 'Minimum notice', numInput('leadDays', 'min="0" max="90"', '', 'days', 'int')) +
        field('maxOrdersPerDay', 'Max orders per day', numInput('maxOrdersPerDay', 'min="1"', '', 'orders', 'int'), 'Once a day has this many approved orders, customers can\'t pick it anymore.') +
        '<div class="field"><span class="label" id="accepting-label">Accepting orders</span><button type="button" class="switch" role="switch" id="accepting" aria-labelledby="accepting-label" aria-checked="true"><span class="track" aria-hidden="true"></span><span id="accepting-text">Open</span></button></div>' +
      '</div>' +
      '<span class="label" style="display:block;margin-top:20px">Busy days</span><div id="busy-days" style="margin-top:8px"></div>' +
      '<span class="label" style="display:block;margin-top:20px">Blocked dates</span><div class="row-gap" id="blocked" style="margin-top:8px"></div>' +
      '<form id="add-block" style="display:flex;flex-wrap:wrap;gap:10px;margin-top:12px;align-items:flex-end">' +
        '<div class="field"><label class="label" for="new-block">Block a date</label><input class="input" id="new-block" type="date"><p class="hint">Dates that have passed are removed automatically.</p></div>' +
        '<button type="submit" class="btn navy">+ Block date</button></form>');
  }
  function sectionZones() {
    return card('zones', 'Drop-off zones', 'Drop-off is offered only to these ZIP codes. Everyone else sees pickup.',
      '<div class="table-wrap"><table><thead><tr><th>ZIP</th><th>Area name</th><th>Fee</th><th><span class="sr-only">Delete</span></th></tr></thead><tbody id="zones-body"></tbody></table></div>' +
      '<button type="button" class="btn dashed" data-act="add-zone" style="margin-top:14px">+ Add a ZIP code</button>');
  }
  function sectionFaq() {
    return card('faq', 'FAQ', 'These show on the FAQ page in this order. Replace anything in [brackets] with your own details.',
      '<div class="stack" id="faq-editor"></div><button type="button" class="btn dashed" data-act="add-faq" style="margin-top:14px">+ Add a question</button>');
  }

  // Website wording (Pages tab), grouped by page.
  const PAGE_FIELDS = [
    ['Home page', [['homeTitle', 'Big heading'], ['homeIntro', 'Text under the heading', 'area'], ['homeHeroPhoto', 'Main photo', 'photo']]],
    ['Menu photos (Home and Order pages)', [['photoCustom', 'Custom Cookies photo', 'photo'], ['photoMini', 'Mini Artisan photo', 'photo'], ['photoLarge', 'Large Artisan photo', 'photo']]],
    ['About page', [['aboutTitle', 'Big heading'], ['aboutIntro', 'Text under the heading', 'area'], ['aboutPhoto', 'Photo', 'photo'],
      ['aboutStoryHeading', 'First section heading'], ['aboutStory', 'First section text', 'long'], ['aboutGoodToKnowHeading', 'Second section heading'], ['aboutGoodToKnow', 'Second section text', 'long']]],
    ['Special Events page', [['eventsTitle', 'Big heading'], ['eventsIntro', 'Text under the heading', 'area']]],
    ['Gallery page', [['galleryTitle', 'Big heading'], ['galleryIntro', 'Text under the heading', 'area']]]
  ];
  function sectionPages() {
    return card('pages', 'Website pages', 'Headings, text and photos on the Home, About, Special Events and Gallery pages. In longer text, leave a blank line to start a new paragraph.',
      PAGE_FIELDS.map(([group, fields]) => '<h3 style="font-size:22px;margin:22px 0 12px">' + esc(group) + '</h3><div class="stack">' +
        fields.map(([key, label, kind]) => {
          const id = 'pg-' + key;
          if (kind === 'photo') return photoField(id, label, 'data-page="' + key + '"');
          if (kind === 'area' || kind === 'long') return field(id, label, '<textarea class="input" id="' + id + '" rows="' + (kind === 'long' ? 6 : 2) + '" data-page="' + key + '"></textarea>');
          return field(id, label, '<input class="input" id="' + id + '" type="text" data-page="' + key + '">');
        }).join('') + '</div>').join(''));
  }
  function photoField(id, label, dataAttrs) {
    return '<div class="field"><label class="label" for="' + id + '">' + label + '</label>' +
      '<div style="display:flex;gap:12px;align-items:center"><span class="photo-thumb" data-thumb-for="' + id + '"></span>' +
      '<input class="input" id="' + id + '" type="text" placeholder="Photo link" ' + dataAttrs + ' style="flex:1;min-width:0"></div>' +
      '<p class="hint">' + PHOTO_HINT + '</p></div>';
  }
  function sectionEvents() {
    return card('events', 'Special Events', 'One card per event on the Special Events page, in this order. Hide a card to take it off the page without deleting it.',
      '<div class="stack" id="events-editor"></div><button type="button" class="btn dashed" data-act="add-event" style="margin-top:14px">+ Add an event</button>');
  }
  function sectionGallery() {
    return card('gallery', 'Gallery', 'Photos on the Gallery page, in this order. The first 4 showing also appear under "Recent creations" on the home page.',
      '<div id="gallery-editor" style="border-top:1px solid var(--line)"></div><button type="button" class="btn dashed" data-act="add-photo" style="margin-top:14px">+ Add a photo</button>' +
      '<p class="hint" style="margin-top:8px">' + PHOTO_HINT + '</p>');
  }
  function sectionSettings() {
    return card('settings', 'Tax &amp; contact', 'Who gets notified about new orders, and what customers see.',
      '<div class="fields">' +
        field('taxRate', 'Grocery tax', numInput('taxRate', 'min="0" step="0.01"', '', '%'), 'Applied to cookies, not the drop-off fee.') +
        field('ownerEmail', 'New-order alerts go to', '<input class="input" id="ownerEmail" type="email" data-path="ownerEmail" placeholder="Blank = your Google account">') +
        field('replyToEmail', 'Customer replies go to', '<input class="input" id="replyToEmail" type="email" data-path="replyToEmail" placeholder="Blank = same as alerts">') +
        field('pickupCity', 'Pickup area (shown on site)', '<input class="input" id="pickupCity" type="text" data-path="pickupCity">') +
        field('pickupAddress', 'Pickup address (only in the confirmation email)', '<input class="input" id="pickupAddress" type="text" data-path="pickupAddress">') +
        field('pickupInstructions', 'Pickup instructions (only in the confirmation email)', '<input class="input" id="pickupInstructions" type="text" data-path="pickupInstructions">') +
        field('instagram', 'Instagram link', '<input class="input" id="instagram" type="url" data-path="instagram">') +
        field('instagramHandle', 'Instagram handle', '<input class="input" id="instagramHandle" type="text" data-path="instagramHandle">') +
      '</div><p class="hint" style="margin-top:16px">Technical settings (website address, email sender name, test or live) are on the Sheet\'s Settings tab.</p>');
  }

  /* ---------- Helpers ---------- */
  function markDirty() { dirty = true; $('#save-bar').classList.add('show'); }
  function clearDirty() { dirty = false; $('#save-bar').classList.remove('show'); }
  function toast(msg, ms) {
    const t = $('#toast');
    if (!t) { alert(msg); return; }
    $('#toast-text').textContent = msg;
    t.classList.add('show');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => t.classList.remove('show'), ms || 3200);
  }
  const shortDate = (iso) => SN.prettyDate(iso, { weekday: 'short', month: 'short', day: 'numeric' });
  const max = () => Number(cfg.maxOrdersPerDay) || 0;

  /* ---------- Simple fields (data-path) and page text (data-page) ---------- */
  function fillFields() {
    $$('[data-path]').forEach((el) => { const v = cfg[el.dataset.path]; el.value = v == null ? '' : v; });
    $$('[data-page]').forEach((el) => { el.value = (cfg.pages || {})[el.dataset.page] || ''; thumb(el); });
    $('#accepting').setAttribute('aria-checked', String(!!cfg.acceptingOrders));
    $('#accepting-text').textContent = cfg.acceptingOrders ? 'Open' : 'Paused';
  }
  // Small preview next to a photo box.
  function thumb(input) {
    const t = $('[data-thumb-for="' + input.id + '"]');
    if (!t) return;
    const url = SN.photoUrl(input.value);
    t.innerHTML = url ? '<img src="' + esc(url) + '" alt="">' : '<span>' + (SN.photoPlaceholder(input.value) ? '[ ]' : '—') + '</span>';
  }

  function onInput(e) {
    const el = e.target;
    if (el.dataset.path) {
      let v = el.value;
      if (el.dataset.type === 'int') v = v === '' ? 0 : parseInt(v, 10);
      if (el.dataset.type === 'num') v = v === '' ? 0 : parseFloat(v);
      cfg[el.dataset.path] = v;
      markDirty();
      return;
    }
    if (el.dataset.page) { cfg.pages[el.dataset.page] = el.value; thumb(el); markDirty(); return; }
    if (el.dataset.list) {
      const list = cfg[el.dataset.list];
      let v = el.value;
      if (el.dataset.type === 'num') v = v === '' ? 0 : parseFloat(v);
      if (el.dataset.key === 'zip') { v = v.replace(/\D/g, '').slice(0, 5); if (el.value !== v) el.value = v; }
      list[Number(el.dataset.i)][el.dataset.key] = v;
      if (el.dataset.key === 'photo') thumb(el);
      if (el.dataset.list === 'events' && el.dataset.key === 'button') renderEvents();
      markDirty();
    }
  }

  /* ---------- Orders ---------- */
  const STATUS_STYLE = {
    'Pending review': 'background:#FDF0D5;color:#7A4B00', 'Invoice sent': 'background:#E4E9F3;color:#1F2A44', 'Paid': 'background:#DDEFE3;color:#1E5A35',
    'Baking': 'background:#F7E3DD;color:#8E3A2E', 'Ready': 'background:#DDEFE3;color:#1E5A35', 'Completed': 'background:#EDEDED;color:#3D4250', 'Declined': 'background:#EDEDED;color:#3D4250'
  };
  const AFTER_INVOICE = ['Invoice sent', 'Paid', 'Baking', 'Ready', 'Completed'];
  const badge = (st) => '<span class="status-badge" style="' + (STATUS_STYLE[st] || '') + '">' + esc(st) + '</span>';
  const isActive = (o) => ['Completed', 'Declined'].indexOf(o.status) === -1;

  function renderOrders() {
    const pending = orders.filter((o) => o.status === 'Pending review').length;
    $('#orders-h').innerHTML = 'Orders' + (pending ? ' <span class="count-pill">' + pending + ' to review</span>' : '');
    navCount('orders', pending ? pending + ' to review' : '');
    const list = showAllOrders ? orders : orders.filter(isActive);
    $('#orders-toggle').textContent = showAllOrders ? 'Hide completed & declined' : 'Show completed & declined (' + (orders.length - orders.filter(isActive).length) + ')';
    const body = $('#orders-body');
    if (!list.length) {
      body.innerHTML = '<tr class="empty-row"><td colspan="9">' + (orders.length ? 'No open orders.' : 'No orders yet. They\'ll show up here as soon as a customer sends a request.') + '</td></tr>';
      return;
    }
    body.innerHTML = list.map((o) => {
      const items = o.items.map((it) => esc(it.qty + ' ' + SN.itemLabel(it.kind))).join('<br>');
      const ful = o.fulfillment === 'delivery' && o.address ? 'Drop-off · ' + esc(o.address.zip) : 'Pickup';
      const total = o.invoice
        ? '<strong>' + money(o.invoice.total) + '</strong>' + (o.invoice.changed ? '<br><span class="muted" style="font-size:12px">was est. ' + money(o.total) + '</span>' : '')
        : money(o.total) + '<br><span class="muted" style="font-size:12px">estimate</span>';
      const status = AFTER_INVOICE.indexOf(o.status) !== -1
        ? '<label class="sr-only" for="st-' + esc(o.number) + '">Status for ' + esc(o.number) + '</label><select class="status" id="st-' + esc(o.number) + '" data-order="' + esc(o.number) + '">' +
            AFTER_INVOICE.map((s) => '<option' + (s === o.status ? ' selected' : '') + '>' + s + '</option>').join('') + '</select>'
        : badge(o.status);
      const action = '<button type="button" class="btn ' + (o.status === 'Pending review' ? '' : 'ghost ') + 'small" data-rv="open" data-n="' + esc(o.number) + '">' + (o.status === 'Pending review' ? 'Review' : 'View') + '</button>';
      return '<tr' + (o.status === 'Pending review' ? ' class="row-pending"' : '') + '>' +
        '<td class="nowrap"><strong>' + esc(o.number) + '</strong>' + (o.allergies ? '<br><span class="status-badge" style="background:#FBEDEA;color:#B23A2B">Allergy</span>' : '') + '</td>' +
        '<td>' + esc(o.customer.name) + '<br><span class="muted" style="font-size:13px">' + esc(o.customer.email) + '</span></td>' +
        '<td class="nowrap">' + esc(SN.prettyDate(o.dateNeeded, { month: 'short', day: 'numeric', year: 'numeric' })) + '</td>' +
        '<td>' + esc(o.eventType || '—') + '</td>' +
        '<td class="nowrap">' + items + '</td>' +
        '<td class="nowrap">' + ful + '</td>' +
        '<td class="nowrap">' + total + '</td>' +
        '<td>' + status + '</td>' +
        '<td>' + action + '</td></tr>';
    }).join('');
  }
  function onStatusChange(e) {
    const sel = e.target.closest('[data-order]');
    if (!sel) return;
    const o = orders.find((x) => x.number === sel.dataset.order);
    const prev = o.status;
    o.status = sel.value;
    server('adminSetStatus', o.number, sel.value).then((r) => {
      if (!r.ok) { o.status = prev; renderOrders(); toast(r.error); return; }
      toast(o.number + ' marked ' + o.status);
      refreshCounts();
    }).catch((err) => { o.status = prev; renderOrders(); failed(err); });
  }
  function refreshCounts() {
    server('adminLoad').then((d) => { dayCounts = d.dayCounts; renderBusyDays(); }).catch(() => {});
  }

  // "Sat, Nov 7: 2 approved, 1 pending (limit 3)"
  function dayLine(iso, excludePendingNumber) {
    const c = dayCounts[iso] || { approved: 0, pending: 0 };
    const pend = c.pending - (excludePendingNumber ? 1 : 0);
    return c.approved + ' approved' + (pend > 0 ? ', ' + pend + ' other pending' : '') + (max() ? ' (limit ' + max() + ' per day)' : '');
  }
  function renderBusyDays() {
    const today = SN.isoDate(new Date());
    const days = Object.keys(dayCounts).filter((d) => d >= today && (dayCounts[d].approved || dayCounts[d].pending)).sort();
    $('#busy-days').innerHTML = days.length ? '<div class="stack" style="gap:6px">' + days.map((d) => {
      const c = dayCounts[d];
      const full = max() && c.approved >= max();
      return '<div style="font-size:14px"><strong>' + esc(shortDate(d)) + '</strong> · ' + c.approved + ' approved' + (c.pending ? ', ' + c.pending + ' pending' : '') +
        (full ? ' · <span class="status-badge" style="background:#FBEDEA;color:#B23A2B">Full: customers can\'t pick this day</span>' : '') + '</div>';
    }).join('') + '</div>' : '<span class="hint">No upcoming orders yet.</span>';
  }

  /* ---------- Review / approve panel ---------- */
  let rv = null;        // { number, lines, fee, note, original, declining, declineNote }
  let rvOpener = null;

  function openReview(number, el) {
    const o = orders.find((x) => x.number === number);
    if (!o) return;
    const lines = o.invoice ? SN.clone(o.invoice.lines) : SN.linesFromOrder(cfg, o);
    const fee = o.invoice ? o.invoice.fee : (o.fulfillment === 'delivery' ? Number(o.deliveryFee) || 0 : 0);
    rv = { number, lines, fee, note: o.invoice ? o.invoice.note || '' : '', declining: false, declineNote: '' };
    rv.original = JSON.stringify({ lines: SN.linesFromOrder(cfg, o), fee: o.fulfillment === 'delivery' ? Number(o.deliveryFee) || 0 : 0 });
    rvOpener = el || document.activeElement;
    renderReview();
    $('#review').classList.add('open');
    $('#scrim').classList.add('open');
    document.body.classList.add('locked');
    setTimeout(() => { const c = $('[data-rv="close"]', $('#review')); (c || $('#review')).focus(); }, 60);
  }
  function closeReview() {
    $('#review').classList.remove('open');
    $('#scrim').classList.remove('open');
    document.body.classList.remove('locked');
    rv = null;
    if (rvOpener && document.body.contains(rvOpener)) rvOpener.focus();
  }
  function isChanged() {
    const clean = (ls) => ls.map((l) => ({ desc: l.desc, qty: Number(l.qty), unit: Math.round(Number(l.unit) * 100) / 100 }));
    const orig = JSON.parse(rv.original);
    return JSON.stringify(clean(rv.lines)) !== JSON.stringify(clean(orig.lines)) || Number(rv.fee) !== Number(orig.fee);
  }

  function requestHtml(o) {
    const it = o.items.map((x) =>
      '<div class="rv-item"><div style="display:flex;justify-content:space-between;gap:12px"><strong>' + x.qty + ' ' + esc(SN.itemLabel(x.kind)) + '</strong><span class="muted">est. ' + money(x.lineTotal) + '</span></div>' +
      '<div class="hint">' + esc(x.summary) + '</div>' +
      (x.desc ? '<div class="rv-quote">“' + esc(x.desc) + '”</div>' : '') +
      (x.photoName ? '<div class="hint" style="margin-top:4px">Inspiration photo: <strong>' + esc(x.photoName) + '</strong> <span class="muted">(photo uploads come in a later update)</span></div>' : '') +
      '</div>').join('');
    const where = o.fulfillment === 'delivery' && o.address
      ? 'Drop-off · ' + esc(o.address.street) + ', ' + esc(o.address.city) + ' ' + esc(o.address.zip)
      : 'Pickup in ' + esc(cfg.pickupCity);
    const c = dayCounts[o.dateNeeded] || { approved: 0, pending: 0 };
    const wouldBeOver = o.status === 'Pending review' && max() && c.approved >= max();
    return '<div class="rv-facts">' +
        '<div><div class="k">Customer</div><div class="v">' + esc(o.customer.name) + '</div><div class="hint">' + esc(o.customer.email) + '<br>' + esc(o.customer.phone) + '</div></div>' +
        '<div><div class="k">Needed by</div><div class="v">' + esc(SN.prettyDate(o.dateNeeded)) + '</div><div class="hint">' + esc(o.eventType || 'Occasion not specified') + '</div></div>' +
        '<div style="grid-column:1 / -1"><div class="k">That day so far</div><div class="v" style="font-weight:500' + (wouldBeOver ? ';color:var(--error)' : '') + '">' +
          esc(dayLine(o.dateNeeded, o.status === 'Pending review')) + (wouldBeOver ? '. Already at your limit.' : '') + '</div></div>' +
        '<div style="grid-column:1 / -1"><div class="k">Pickup / drop-off</div><div class="v">' + where + '</div></div>' +
        (o.allergies ? '<div style="grid-column:1 / -1"><div class="k" style="color:var(--error)">Allergies / dietary needs</div><div class="v">' + esc(o.allergies) + '</div></div>' : '') +
      '</div>' +
      '<h3 class="rv-h">What they asked for</h3>' + it +
      '<div class="hint" style="margin-top:8px">Estimate shown to customer: <strong>' + money(o.total) + '</strong></div>';
  }

  function renderReview() {
    const review = $('#review');
    const o = orders.find((x) => x.number === rv.number);
    const st = o.status;
    const head = '<div class="panel-head"><div><h2 id="review-title">' + (st === 'Pending review' ? 'Review ' : '') + esc(o.number) + '</h2><p>' + badge(st) + '</p></div>' +
      '<button type="button" class="x-btn" data-rv="close" aria-label="Close">' + SN_ICONS.close + '</button></div>';

    if (st !== 'Pending review') {
      let bodyHtml = requestHtml(o);
      let foot = '';
      if (o.invoice) {
        bodyHtml += '<h3 class="rv-h">Confirmed invoice</h3>' +
          o.invoice.lines.map((l) => '<div class="rv-line"><span>' + esc(l.desc) + ' <span class="muted">(' + l.qty + ' × ' + money(Number(l.unit)) + ')</span></span><span>' + money(l.qty * l.unit) + '</span></div>').join('') +
          '<div class="totals" style="margin-top:10px">' +
            '<div><span class="muted">Grocery tax (' + o.taxRate + '%)</span><span>' + money(o.invoice.tax) + '</span></div>' +
            (o.fulfillment === 'delivery' ? '<div><span class="muted">Drop-off</span><span>' + money(o.invoice.fee) + '</span></div>' : '') +
            '<div><strong>Invoice total</strong><strong>' + money(o.invoice.total) + '</strong></div>' +
          '</div>' +
          (o.invoice.note ? '<div class="rv-quote" style="margin-top:12px">Your note: “' + esc(o.invoice.note) + '”</div>' : '') +
          '<p class="hint" style="margin-top:12px">Approved ' + esc(new Date(o.invoice.sentAt).toLocaleString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })) +
            (o.invoice.changed ? ' with changes' : ' as requested') + '. Confirmation email to ' + esc(o.customer.email) + ': <strong>' + esc(o.invoice.emailStatus || '') + '</strong></p>';
        foot = '<button type="button" class="btn ghost block" data-rv="resend">Resend the confirmation email</button>';
      } else if (st === 'Declined') {
        bodyHtml += '<h3 class="rv-h">Declined</h3>' + (o.declineNote ? '<div class="rv-quote">“' + esc(o.declineNote) + '”</div>' : '<p class="hint">No note was included.</p>');
      }
      review.innerHTML = head + '<div class="panel-body">' + bodyHtml + '</div>' + (foot ? '<div class="panel-foot">' + foot + '</div>' : '');
      return;
    }

    const rows = rv.lines.map((l, j) =>
      '<div class="inv-row">' +
        '<div class="field inv-desc"><label class="sr-only" for="ld-' + j + '">Line ' + (j + 1) + ' description</label><input class="input" id="ld-' + j + '" type="text" data-inv="desc" data-j="' + j + '" value="' + esc(l.desc) + '"></div>' +
        '<div class="field inv-qty"><label class="label" for="lq-' + j + '">Qty</label><input class="input" id="lq-' + j + '" type="number" min="0" data-inv="qty" data-j="' + j + '" value="' + l.qty + '"></div>' +
        '<div class="field inv-unit"><label class="label" for="lu-' + j + '">Each</label><div class="input-wrap"><span>$</span><input id="lu-' + j + '" type="number" step="0.25" data-inv="unit" data-j="' + j + '" value="' + l.unit + '"></div></div>' +
        '<div class="inv-amt" data-amt="' + j + '"></div>' +
        '<button type="button" class="icon-del" data-rv="del-line" data-j="' + j + '" aria-label="Remove line ' + (j + 1) + '">' + SN_ICONS.trash + '</button>' +
      '</div>').join('');
    const body = requestHtml(o) +
      '<h3 class="rv-h">Invoice</h3>' +
      '<p class="hint" style="margin:-6px 0 10px">Starts from what they ordered. Change prices or quantities, or add a line for extras or a discount (use a negative price).</p>' +
      rows +
      '<button type="button" class="btn dashed small" data-rv="add-line" style="margin-top:6px">+ Add a line</button>' +
      (o.fulfillment === 'delivery'
        ? '<div class="field" style="margin-top:16px;max-width:200px"><label class="label" for="inv-fee">Drop-off fee</label><div class="input-wrap"><span>$</span><input id="inv-fee" type="number" min="0" step="1" data-inv="fee" value="' + rv.fee + '"></div></div>'
        : '') +
      '<div class="totals" style="margin-top:16px">' +
        '<div><span class="muted">Subtotal</span><span id="inv-sub"></span></div>' +
        '<div><span class="muted">Grocery tax (' + o.taxRate + '%)</span><span id="inv-tax"></span></div>' +
        (o.fulfillment === 'delivery' ? '<div><span class="muted">Drop-off</span><span id="inv-feeval"></span></div>' : '') +
      '</div>' +
      '<div class="field" style="margin-top:18px"><label class="label" for="inv-note">Note to the customer <span class="muted" style="font-weight:400" id="note-hint">(optional)</span></label>' +
        '<textarea class="input" id="inv-note" rows="3" data-inv="note" placeholder="e.g. Can’t wait to make these! I added $1 per cookie for the hand-painted details.">' + esc(rv.note) + '</textarea></div>';
    const foot = rv.declining
      ? '<div class="stack">' +
          '<div class="field"><label class="label" for="decline-note">Message to the customer</label><textarea class="input" id="decline-note" rows="3" data-inv="declineNote" placeholder="e.g. I’m fully booked that weekend, but I’d love to help with another date!">' + esc(rv.declineNote) + '</textarea></div>' +
          '<div class="row-gap"><button type="button" class="btn ghost small" data-rv="decline-cancel">Back</button><button type="button" class="btn navy small" data-rv="decline-send">Decline &amp; email customer</button></div>' +
        '</div>'
      : '<div class="grand"><strong>Invoice total</strong><strong id="inv-total"></strong></div>' +
        '<p class="hint" id="inv-diff" style="margin:-4px 0 12px"></p>' +
        '<p class="err" id="inv-err" hidden style="margin-bottom:10px"></p>' +
        '<button type="button" class="btn block" data-rv="approve" id="approve-btn"></button>' +
        '<div style="text-align:center;margin-top:8px"><button type="button" class="link-btn" data-rv="decline">Can’t take this order? Decline it</button></div>';
    review.innerHTML = head + '<div class="panel-body">' + body + '</div><div class="panel-foot">' + foot + '</div>';
    updateReviewTotals();
  }

  function updateReviewTotals() {
    if (!rv || rv.declining) return;
    const review = $('#review');
    const o = orders.find((x) => x.number === rv.number);
    if (o.status !== 'Pending review') return;
    const t = SN.invoiceTotals(rv.lines, rv.fee, o.taxRate);
    rv.lines.forEach((l, j) => { const el = $('[data-amt="' + j + '"]', review); if (el) el.textContent = money((Number(l.qty) || 0) * (Number(l.unit) || 0)); });
    $('#inv-sub').textContent = money(t.subtotal);
    $('#inv-tax').textContent = money(t.tax);
    if ($('#inv-feeval')) $('#inv-feeval').textContent = money(t.fee);
    $('#inv-total').textContent = money(t.total);
    const changed = isChanged();
    const diff = Math.round((t.total - o.total) * 100) / 100;
    $('#inv-diff').textContent = changed
      ? 'Changed from the ' + money(o.total) + ' estimate (' + (diff >= 0 ? '+' : '−') + money(Math.abs(diff)) + '). Add a note so they know why.'
      : 'Same as the estimate the customer saw.';
    $('#note-hint').textContent = changed ? '(recommended since the price changed)' : '(optional)';
    $('#approve-btn').textContent = (changed ? 'Approve with changes' : 'Approve') + ' & email confirmation · ' + money(t.total);
  }

  function onReviewInput(e) {
    const t = e.target;
    if (!rv || !t.dataset.inv) return;
    const k = t.dataset.inv;
    if (k === 'note') { rv.note = t.value; return; }
    if (k === 'declineNote') { rv.declineNote = t.value; return; }
    if (k === 'fee') { rv.fee = t.value === '' ? 0 : parseFloat(t.value); updateReviewTotals(); return; }
    rv.lines[Number(t.dataset.j)][k] = k === 'desc' ? t.value : (t.value === '' ? 0 : parseFloat(t.value));
    updateReviewTotals();
  }

  // Swap an updated order into the list and redraw.
  function replaceOrder(o, counts) {
    const i = orders.findIndex((x) => x.number === o.number);
    if (i !== -1) orders[i] = o;
    if (counts) dayCounts = counts;
    renderOrders();
    renderBusyDays();
    if (rv && rv.number === o.number) renderReview();
  }

  function onReviewClick(b) {
    const act = b.dataset.rv;
    if (act === 'open') { openReview(b.dataset.n, b); return; }
    if (!rv) return;
    const o = orders.find((x) => x.number === rv.number);
    switch (act) {
      case 'close': closeReview(); break;
      case 'add-line': rv.lines.push({ desc: '', qty: 1, unit: 0 }); renderReview(); $('#ld-' + (rv.lines.length - 1)).focus(); break;
      case 'del-line': rv.lines.splice(Number(b.dataset.j), 1); renderReview(); break;
      case 'decline': rv.declining = true; renderReview(); $('#decline-note').focus(); break;
      case 'decline-cancel': rv.declining = false; renderReview(); break;
      case 'decline-send':
        if (busy) return;
        busy = true; b.textContent = 'Sending…';
        server('adminDecline', o.number, rv.declineNote.trim()).then((r) => {
          busy = false;
          if (!r.ok) { toast(r.error); renderReview(); return; }
          rv.declining = false;
          replaceOrder(r.order, r.dayCounts);
          toast(o.number + ' declined. Email to customer: ' + r.emailStatus, 5000);
        }).catch(failed);
        break;
      case 'approve': {
        const err = $('#inv-err');
        const bad = rv.lines.find((l) => !String(l.desc).trim() || !(Number(l.qty) > 0));
        if (!rv.lines.length || bad) { err.hidden = false; err.textContent = 'Every invoice line needs a description and a quantity.'; return; }
        const t = SN.invoiceTotals(rv.lines, rv.fee, o.taxRate);
        if (t.total <= 0) { err.hidden = false; err.textContent = 'The invoice total has to be more than $0.'; return; }
        const c = dayCounts[o.dateNeeded] || { approved: 0 };
        if (max() && c.approved >= max() && !confirm(SN.prettyDate(o.dateNeeded) + ' already has ' + c.approved + ' approved orders (your limit is ' + max() + '). Approve this one anyway?')) return;
        if (busy) return;
        busy = true; b.textContent = 'Approving and sending…';
        server('adminApprove', o.number, { lines: rv.lines, fee: rv.fee, note: rv.note.trim() }).then((r) => {
          busy = false;
          if (!r.ok) { err.hidden = false; err.textContent = r.error; updateReviewTotals(); return; }
          replaceOrder(r.order, r.dayCounts);
          const sent = /^Sent/.test(r.order.invoice.emailStatus);
          toast(sent ? 'Approved! Confirmation emailed to ' + o.customer.email : 'Approved, but the email didn\'t send: ' + r.order.invoice.emailStatus, sent ? 3600 : 8000);
        }).catch(failed);
        break;
      }
      case 'resend':
        if (busy) return;
        busy = true; b.textContent = 'Sending…';
        server('adminResendConfirmation', o.number).then((r) => {
          busy = false;
          if (!r.ok) { toast(r.error); renderReview(); return; }
          replaceOrder(r.order, r.dayCounts);
          toast('Confirmation email: ' + r.order.invoice.emailStatus);
        }).catch(failed);
        break;
      default:
    }
  }

  /* ---------- Flavors, blocked dates, zones, FAQ ---------- */
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
  function renderBlocked() {
    const list = cfg.blockedDates.slice().sort();
    $('#blocked').innerHTML = list.length ? list.map((d) =>
      '<span class="chip">' + esc(SN.prettyDate(d, { weekday: 'short', month: 'short', day: 'numeric', year: 'numeric' })) +
      '<button type="button" data-act="del-block" data-d="' + esc(d) + '" aria-label="Unblock ' + esc(d) + '">' + SN_ICONS.close + '</button></span>').join('')
      : '<span class="hint">No blocked dates.</span>';
  }
  function renderZones() {
    $('#zones-body').innerHTML = cfg.zones.map((z, i) =>
      '<tr>' +
        '<td><label class="sr-only" for="zz-' + i + '">ZIP</label><input class="input" id="zz-' + i + '" type="text" inputmode="numeric" maxlength="5" style="max-width:110px" data-list="zones" data-i="' + i + '" data-key="zip" value="' + esc(z.zip) + '"></td>' +
        '<td><label class="sr-only" for="za-' + i + '">Area name</label><input class="input" id="za-' + i + '" type="text" data-list="zones" data-i="' + i + '" data-key="area" value="' + esc(z.area) + '"></td>' +
        '<td><div class="input-wrap" style="max-width:130px"><span>$</span><label class="sr-only" for="zf-' + i + '">Fee</label><input id="zf-' + i + '" type="number" min="0" step="1" data-list="zones" data-i="' + i + '" data-key="fee" data-type="num" value="' + z.fee + '"></div></td>' +
        '<td><button type="button" class="icon-del" data-act="del-zone" data-i="' + i + '" aria-label="Delete ZIP ' + esc(z.zip) + '">' + SN_ICONS.trash + '</button></td>' +
      '</tr>').join('') || '<tr class="empty-row"><td colspan="4">No drop-off zones. Customers will only see pickup.</td></tr>';
  }
  const UP = '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M6 15l6-6 6 6"/></svg>';
  const DOWN = '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M6 9l6 6 6-6"/></svg>';
  // Up / down / delete buttons for a reorderable list item.
  function moveButtons(list, i, n, label) {
    return '<span class="row-gap" style="gap:6px">' +
      '<button type="button" class="mini-btn" data-act="up" data-list="' + list + '" data-i="' + i + '" aria-label="Move ' + label + ' up"' + (i === 0 ? ' disabled' : '') + '>' + UP + '</button>' +
      '<button type="button" class="mini-btn" data-act="down" data-list="' + list + '" data-i="' + i + '" aria-label="Move ' + label + ' down"' + (i === n - 1 ? ' disabled' : '') + '>' + DOWN + '</button>' +
      '<button type="button" class="icon-del" data-act="del-item" data-list="' + list + '" data-i="' + i + '" aria-label="Delete ' + label + '">' + SN_ICONS.trash + '</button></span>';
  }
  function renderFaqs() {
    const n = cfg.faqs.length;
    $('#faq-editor').innerHTML = n ? cfg.faqs.map((f, i) =>
      '<div class="faq-edit"><div class="faq-edit-top"><span class="num">Question ' + (i + 1) + '</span>' + moveButtons('faqs', i, n, 'question ' + (i + 1)) + '</div>' +
        '<label class="sr-only" for="fq-' + i + '">Question ' + (i + 1) + '</label>' +
        '<input class="input" id="fq-' + i + '" type="text" placeholder="Question" data-list="faqs" data-i="' + i + '" data-key="q" value="' + esc(f.q) + '" style="font-weight:600">' +
        '<label class="sr-only" for="fa-' + i + '">Answer ' + (i + 1) + '</label>' +
        '<textarea class="input" id="fa-' + i + '" rows="3" placeholder="Answer" data-list="faqs" data-i="' + i + '" data-key="a">' + esc(f.a) + '</textarea>' +
      '</div>').join('') : '<p class="hint">No questions yet. Add one below.</p>';
  }

  /* ---------- Events and gallery ---------- */
  function renderEvents() {
    const n = cfg.events.length;
    $('#events-editor').innerHTML = n ? cfg.events.map((ev, i) => {
      const id = (k) => 'ev-' + k + '-' + i;
      const attrs = (k) => 'data-list="events" data-i="' + i + '" data-key="' + k + '"';
      return '<div class="faq-edit"' + (ev.show === false ? ' style="opacity:.7"' : '') + '>' +
        '<div class="faq-edit-top"><span class="num">Event ' + (i + 1) + '</span><span class="row-gap" style="gap:6px">' +
          '<button type="button" class="switch" role="switch" aria-checked="' + (ev.show !== false) + '" data-act="toggle-show" data-list="events" data-i="' + i + '" aria-label="Show event ' + (i + 1) + ' on the page"><span class="track" aria-hidden="true"></span>' + (ev.show !== false ? 'Showing' : 'Hidden') + '</button>' +
          moveButtons('events', i, n, 'event ' + (i + 1)) + '</span></div>' +
        field(id('title'), 'Title', '<input class="input" id="' + id('title') + '" type="text" ' + attrs('title') + ' value="' + esc(ev.title) + '" style="font-weight:600">') +
        '<div class="grid-2">' +
          field(id('when'), 'When (small text above the title)', '<input class="input" id="' + id('when') + '" type="text" ' + attrs('when') + ' value="' + esc(ev.when) + '" placeholder="e.g. Sat, Dec 6 · 2–4pm">') +
          field(id('price'), 'Price', '<input class="input" id="' + id('price') + '" type="text" ' + attrs('price') + ' value="' + esc(ev.price) + '" placeholder="e.g. $45 per person">') +
        '</div>' +
        field(id('desc'), 'Description', '<textarea class="input" id="' + id('desc') + '" rows="3" ' + attrs('desc') + '>' + esc(ev.desc) + '</textarea>') +
        photoField(id('photo'), 'Photo', attrs('photo') + ' value="' + esc(ev.photo) + '"') +
        '<div class="grid-2">' +
          field(id('button'), 'Button', '<select class="input" id="' + id('button') + '" ' + attrs('button') + '>' +
            ['Order now', 'Message me', 'Sign up', 'None'].map((b) => '<option' + (b === ev.button ? ' selected' : '') + '>' + b + '</option>').join('') + '</select>') +
          (ev.button === 'Sign up' ? field(id('link'), 'Sign-up link', '<input class="input" id="' + id('link') + '" type="url" ' + attrs('link') + ' value="' + esc(ev.link) + '" placeholder="https://…">', 'Blank shows "Sign-up details coming soon".') : '') +
        '</div>' +
      '</div>';
    }).join('') : '<p class="hint">No events yet. Add one below.</p>';
    $$('#events-editor [data-key="photo"]').forEach(thumb);
  }
  function renderGallery() {
    const n = cfg.gallery.length;
    $('#gallery-editor').innerHTML = n ? cfg.gallery.map((g, i) =>
      '<div class="flavor-row" style="flex-wrap:wrap;gap:10px' + (g.show === false ? ';opacity:.7' : '') + '">' +
        '<span class="photo-thumb" data-thumb-for="gp-' + i + '"></span>' +
        '<div style="flex:2 1 220px;min-width:0"><label class="sr-only" for="gp-' + i + '">Photo ' + (i + 1) + ' link</label><input class="input" id="gp-' + i + '" type="text" placeholder="Photo link" data-list="gallery" data-i="' + i + '" data-key="photo" value="' + esc(g.photo) + '"></div>' +
        '<div style="flex:1 1 160px;min-width:0"><label class="sr-only" for="gc-' + i + '">Photo ' + (i + 1) + ' caption</label><input class="input" id="gc-' + i + '" type="text" placeholder="Caption (for screen readers)" data-list="gallery" data-i="' + i + '" data-key="caption" value="' + esc(g.caption) + '"></div>' +
        '<div style="display:flex;align-items:center;gap:6px">' +
          '<button type="button" class="switch" role="switch" aria-checked="' + (g.show !== false) + '" data-act="toggle-show" data-list="gallery" data-i="' + i + '" aria-label="Show photo ' + (i + 1) + '"><span class="track" aria-hidden="true"></span>' + (g.show !== false ? 'Showing' : 'Hidden') + '</button>' +
          moveButtons('gallery', i, n, 'photo ' + (i + 1)) +
        '</div>' +
      '</div>').join('') : '<p class="hint" style="padding:14px 0">No photos yet. Add one below.</p>';
    $$('#gallery-editor [data-key="photo"]').forEach(thumb);
  }

  const RENDER_LIST = { faqs: () => renderFaqs(), events: () => renderEvents(), gallery: () => renderGallery() };

  function onListClick(b) {
    const i = Number(b.dataset.i);
    const list = b.dataset.list;
    switch (b.dataset.act) {
      case 'special': cfg.flavors[i].special = !cfg.flavors[i].special; renderFlavors(); break;
      case 'toggle-flavor': cfg.flavors[i].on = !cfg.flavors[i].on; renderFlavors(); break;
      case 'del-flavor':
        if (!confirm('Delete ' + cfg.flavors[i].name + '? To take it off the menu for now, use Hidden instead.')) return;
        cfg.flavors.splice(i, 1); renderFlavors(); break;
      case 'del-block': cfg.blockedDates = cfg.blockedDates.filter((d) => d !== b.dataset.d); renderBlocked(); break;
      case 'add-zone': cfg.zones.push({ zip: '', area: '', fee: 5 }); renderZones(); $('#zz-' + (cfg.zones.length - 1)).focus(); break;
      case 'del-zone': cfg.zones.splice(i, 1); renderZones(); break;
      case 'add-faq': cfg.faqs.push({ q: '', a: '' }); renderFaqs(); $('#fq-' + (cfg.faqs.length - 1)).focus(); break;
      case 'add-event': cfg.events.push({ show: true, photo: '', when: '', title: '', desc: '', price: '', button: 'Message me', link: '' }); renderEvents(); $('#ev-title-' + (cfg.events.length - 1)).focus(); break;
      case 'add-photo': cfg.gallery.push({ show: true, photo: '', caption: '' }); renderGallery(); $('#gp-' + (cfg.gallery.length - 1)).focus(); break;
      case 'toggle-show': cfg[list][i].show = cfg[list][i].show === false; RENDER_LIST[list](); break;
      case 'del-item': {
        const it = cfg[list][i];
        const filled = list === 'faqs' ? (it.q || it.a) : list === 'events' ? it.title : it.photo;
        if (filled && !confirm('Delete this ' + (list === 'faqs' ? 'question' : list === 'events' ? 'event' : 'photo') + '?')) return;
        cfg[list].splice(i, 1); RENDER_LIST[list](); break;
      }
      case 'up': case 'down': {
        const j = b.dataset.act === 'up' ? i - 1 : i + 1;
        if (j < 0 || j >= cfg[list].length) return;
        cfg[list].splice(j, 0, cfg[list].splice(i, 1)[0]);
        RENDER_LIST[list]();
        const again = $('[data-act="' + b.dataset.act + '"][data-list="' + list + '"][data-i="' + j + '"]');
        if (again && !again.disabled) again.focus();
        break;
      }
      default: return;
    }
    markDirty();
  }

  /* ---------- Messages ---------- */
  function renderMessages() {
    const unread = messages.filter((m) => m.status === 'New').length;
    $('#messages-h').innerHTML = 'Messages' + (unread ? ' <span class="count-pill">' + unread + ' new</span>' : '');
    navCount('messages', unread ? unread + ' new' : '');
    $('#msg-list').innerHTML = messages.length ? messages.map((m) => {
      const subject = encodeURIComponent('Re: your question for Sweet Nothings by M');
      const when = m.createdAt ? new Date(m.createdAt).toLocaleString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }) : '';
      return '<div class="msg' + (m.status === 'New' ? ' unread' : '') + '">' +
        '<div class="msg-top"><strong>' + esc(m.name || m.email) + ' <span class="muted" style="font-weight:400">· ' + esc(m.topic) + (m.orderNumber ? ' · ' + esc(m.orderNumber) : '') + '</span></strong>' +
          '<span class="muted" style="font-size:13px">' + esc(when) + (m.status === 'New' ? ' · <strong style="color:var(--coral-dark)">New</strong>' : ' · Replied') + '</span></div>' +
        '<div class="hint">' + esc(m.email) + (m.phone ? ' · ' + esc(m.phone) : '') + '</div>' +
        '<div class="msg-body">' + esc(m.message) + '</div>' +
        (m.photoName ? '<div class="hint">Photo attached: <strong>' + esc(m.photoName) + '</strong> <span class="muted">(photo uploads come in a later update)</span></div>' : '') +
        '<div class="row-gap" style="margin-top:6px;gap:8px">' +
          '<a class="btn small" href="mailto:' + esc(m.email) + '?subject=' + subject + '" data-msg="reply" data-id="' + m.id + '">Reply by email</a>' +
          '<button type="button" class="btn ghost small" data-msg="toggle" data-id="' + m.id + '">' + (m.status === 'New' ? 'Mark replied' : 'Mark as new') + '</button>' +
          '<button type="button" class="icon-del" data-msg="delete" data-id="' + m.id + '" aria-label="Delete message from ' + esc(m.name || m.email) + '">' + SN_ICONS.trash + '</button>' +
        '</div></div>';
    }).join('') : '<p class="hint">No messages yet.</p>';
  }
  function onMessageClick(b) {
    const m = messages.find((x) => String(x.id) === b.dataset.id);
    if (!m) return;
    if (b.dataset.msg === 'reply' || b.dataset.msg === 'toggle') {
      const next = b.dataset.msg === 'reply' ? 'Replied' : (m.status === 'New' ? 'Replied' : 'New');
      if (m.status === next) return;
      m.status = next;
      setTimeout(renderMessages, b.dataset.msg === 'reply' ? 300 : 0);
      server('adminSetMessageStatus', m.id, next).catch(failed);
      return;
    }
    if (b.dataset.msg === 'delete') {
      if (!confirm('Delete this message? It\'s also removed from the Sheet.')) return;
      messages = messages.filter((x) => x !== m);
      renderMessages();
      server('adminDeleteMessage', m.id).catch(failed);
    }
  }

  /* ---------- Save, preview, discard ---------- */
  function cleaned() {
    const c = SN.clone(cfg);
    c.zones = c.zones.filter((z) => /^\d{5}$/.test(z.zip));
    c.faqs = c.faqs.filter((f) => (f.q || '').trim() || (f.a || '').trim());
    c.events = c.events.filter((e) => (e.title || '').trim());
    c.gallery = c.gallery.filter((g) => (g.photo || '').trim());
    delete c.fullDates;
    delete c.images;
    return c;
  }
  function save(force) {
    if (busy) return;
    const c = cleaned();
    const badZip = cfg.zones.find((z) => z.zip && !/^\d{5}$/.test(z.zip));
    if (badZip && !confirm('ZIP "' + badZip.zip + '" isn\'t 5 digits and won\'t be saved. Save anyway?')) return;
    busy = true;
    $$('[data-save]').forEach((b) => { b.textContent = 'Saving…'; });
    server('adminSaveSettings', c, stamp, !!force).then((r) => {
      busy = false;
      $$('[data-save]').forEach((b) => { b.textContent = 'Save changes'; });
      if (r.conflict) {
        if (confirm('Someone changed the settings directly in the Google Sheet since you opened this page.\n\n' +
            'OK: save your version anyway (replaces those Sheet changes).\nCancel: keep editing. To see the Sheet\'s version, reload this page (your unsaved edits here would be lost).')) save(true);
        return;
      }
      cfg = r.config;
      stamp = r.stamp;
      clearDirty();
      renderSettings();
      toast('Saved. The website shows your changes now.');
    }).catch((err) => { $$('[data-save]').forEach((b) => { b.textContent = 'Save changes'; }); failed(err); });
  }
  // Preview changes: save the unsaved edits to the Sheet's Draft tab, then open the website in preview mode.
  function preview() {
    if (!siteUrl) { toast('Set siteUrl on the Sheet\'s Settings tab first.'); return; }
    const w = window.open('', '_blank');   // open now (not after the server call) so the browser doesn't block it
    if (w) w.document.write('<p style="font-family:sans-serif;padding:24px">Opening a preview with your unsaved changes…</p>');
    server('adminSaveDraft', cleaned()).then(() => {
      const url = siteUrl + 'index.html?preview=1';
      if (w) w.location.href = url; else window.open(url, '_blank');
    }).catch((err) => { if (w) w.close(); failed(err); });
  }
  function discard() {
    server('adminClearDraft').then(load).then(() => toast('Changes discarded')).catch(failed);
  }

  function renderSettings() {
    fillFields();
    renderFlavors();
    renderBlocked();
    renderZones();
    renderFaqs();
    renderEvents();
    renderGallery();
    renderBusyDays();
  }

  function wire() {
    document.addEventListener('input', (e) => {
      if (e.target.closest('#review')) { onReviewInput(e); return; }
      onInput(e);
    });
    document.addEventListener('change', (e) => {
      if (e.target.matches('#orders-body [data-order]')) onStatusChange(e);
    });
    document.addEventListener('click', (e) => {
      const rvb = e.target.closest('[data-rv]');
      if (rvb) { onReviewClick(rvb); return; }
      const mb = e.target.closest('[data-msg]');
      if (mb) { onMessageClick(mb); return; }
      const ab = e.target.closest('[data-act]');
      if (ab) { onListClick(ab); return; }
      if (e.target.closest('[data-save]')) { save(false); return; }
      if (e.target.closest('[data-preview]')) { preview(); return; }
    });
    $('#accepting').addEventListener('click', () => { cfg.acceptingOrders = !cfg.acceptingOrders; fillFields(); markDirty(); });
    $('#orders-toggle').addEventListener('click', () => { showAllOrders = !showAllOrders; renderOrders(); });
    $('#discard').addEventListener('click', discard);
    $('#scrim').addEventListener('click', closeReview);
    document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && rv) closeReview(); });
    $('#review').addEventListener('keydown', (e) => {
      if (e.key !== 'Tab') return;
      const f = $$('button:not([disabled]), [href], input, select, textarea', $('#review')).filter((el) => el.offsetParent !== null);
      if (!f.length) return;
      const first = f[0], last = f[f.length - 1];
      if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
      else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
    });
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
    $('#add-block').addEventListener('submit', (e) => {
      e.preventDefault();
      const v = $('#new-block').value;
      if (!v) return;
      if (cfg.blockedDates.indexOf(v) === -1) cfg.blockedDates.push(v);
      $('#new-block').value = '';
      renderBlocked();
      markDirty();
    });
    window.addEventListener('beforeunload', (e) => { if (dirty) { e.preventDefault(); e.returnValue = ''; } });
    window.addEventListener('hashchange', showTab);
    showTab();
  }

  /* ---------- Start ---------- */
  function load() {
    return server('adminLoad').then((d) => {
      cfg = d.config;
      stamp = d.stamp;
      orders = d.orders;
      messages = d.messages;
      dayCounts = d.dayCounts;
      sheetUrl = d.sheetUrl;
      if (!$('#save-bar')) shell();
      clearDirty();
      // Coming back from a preview? The unsaved edits are still in the Sheet's Draft tab.
      if (d.draft) {
        const merged = Object.assign(SN.clone(cfg), d.draft);
        if (JSON.stringify(merged) !== JSON.stringify(cfg)) {
          cfg = merged;
          markDirty();
          toast('Your unsaved changes are still here. Save or discard them when you’re ready.', 5000);
        }
      }
      renderSettings();
      renderOrders();
      renderMessages();
    });
  }
  load().catch((err) => {
    app.innerHTML = '<div class="wrap" style="padding:40px 0"><h1>Couldn\'t load the admin</h1><p class="muted">' + esc(err && err.message ? err.message : String(err)) + '</p><p><a class="btn" href="" target="_self">Try again</a></p></div>';
  });
})();
