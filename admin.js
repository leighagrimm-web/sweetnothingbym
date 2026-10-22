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
  let codes = [];
  let weekCounts = {};     // { monday: { custom: { approved, pending }, artisan: { approved, pending } } }
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
          sectionDashboard() + sectionOrders() + sectionMessages() + sectionCodes() + sectionPayments() + sectionCustom() + sectionArtisan() + sectionRules() + sectionZones() + sectionFaq() +
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
    ['Orders &amp; messages', [['dashboard', 'Dashboard'], ['orders', 'Orders'], ['messages', 'Messages'], ['codes', 'Promo &amp; gift codes'], ['payments', 'Payments']]],
    ['Shop settings', [['custom', 'Custom pricing'], ['artisan', 'Artisan &amp; flavors'], ['rules', 'Ordering rules'], ['zones', 'Drop-off zones'],
      ['faq', 'FAQ'], ['pages', 'Website pages'], ['events', 'Events'], ['gallery', 'Gallery'], ['settings', 'Tax &amp; contact']]]
  ];
  const TAB_IDS = TAB_GROUPS.reduce((a, g) => a.concat(g[1].map((t) => t[0])), []);

  function showTab() {
    const id = TAB_IDS.indexOf(location.hash.slice(1)) !== -1 ? location.hash.slice(1) : 'dashboard';
    $$('.admin-main > .panel-card').forEach((s) => { s.hidden = s.id !== id; });
    $('#settings-title').hidden = ['dashboard', 'orders', 'messages', 'codes', 'payments'].indexOf(id) !== -1;
    if (id === 'payments' && !payInfo) loadPayments();
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
        '<div><h2 id="orders-h">Orders</h2><p class="sub">Cookie requests come in as <strong>Pending review</strong>. Click <strong>Review</strong> to approve as-is or with changes, decline, message the customer, or change the date. Class bookings pay in Square at checkout: <strong>Awaiting payment</strong> while they pay, then <strong>Paid</strong> (or <strong>Expired</strong> if they don’t).</p></div>' +
        '<button type="button" class="btn ghost small" id="orders-toggle"></button>' +
      '</div>' +
      '<div class="table-wrap"><table class="orders-table"><thead><tr><th>Order &amp; order date</th><th>Customer</th><th>Date needed</th><th>Items</th><th>Total</th><th>Status</th></tr></thead>' +
      '<tbody id="orders-body"></tbody></table></div></section>';
  }
  function sectionMessages() {
    return card('messages', 'Messages', 'From the Contact page and the "Message me" buttons. Each one also landed in your email inbox, so you can reply from there too.', '<div class="stack" id="msg-list"></div>');
  }
  function sectionCodes() {
    return card('codes', 'Promo &amp; gift codes', 'Customers enter these at checkout. <strong>Percent off</strong> comes off before tax. A <strong>gift card</strong> is a dollar amount that keeps its remaining balance until it\'s used up. Codes save right away.',
      '<div class="table-wrap"><table><thead><tr><th>Code</th><th>Type</th><th>Value</th><th>Used</th><th>Expires</th><th>Active</th><th><span class="sr-only">Actions</span></th></tr></thead><tbody id="codes-body"></tbody></table></div>' +
      '<h3 style="font-size:22px;margin:26px 0 12px" id="code-form-h">Add a code</h3>' +
      '<form id="code-form" class="fields">' +
        field('cf-type', 'Type', '<select class="input" id="cf-type"><option>Percent off</option><option>Gift card</option></select>') +
        '<div class="field"><label class="label" for="cf-code">Code</label>' +
          '<input class="input" id="cf-code" type="text" autocomplete="off" placeholder="e.g. HOLIDAY10" style="text-transform:uppercase">' +
          '<p class="hint">Letters, numbers and dashes. <button type="button" class="link-btn" id="cf-generate" style="padding:0;font-size:inherit">Make one up for me</button></p></div>' +
        field('cf-amount', '<span id="cf-amount-label">Percent off</span>', '<div class="input-wrap"><span id="cf-amount-pre" hidden>$</span><input id="cf-amount" type="number" min="0" step="0.01"><span id="cf-amount-post">%</span></div>') +
        '<div class="field" id="cf-balance-wrap" hidden><label class="label" for="cf-balance">Balance left</label><div class="input-wrap"><span>$</span><input id="cf-balance" type="number" min="0" step="0.01"></div></div>' +
        field('cf-expires', 'Expires (optional)', '<input class="input" id="cf-expires" type="date">') +
        field('cf-max', 'Most uses (optional)', '<input class="input" id="cf-max" type="number" min="1" placeholder="No limit">') +
        '<div class="field" style="grid-column:1 / -1"><label class="label" for="cf-note">Note (just for you)</label><input class="input" id="cf-note" type="text" placeholder="e.g. Gift card for Jane, paid by cash"></div>' +
        '<div style="grid-column:1 / -1" class="row-gap"><button type="submit" class="btn" id="cf-save">Save code</button><button type="button" class="btn ghost" id="cf-cancel" hidden>Cancel</button>' +
          '<p class="err" id="cf-err" hidden></p></div>' +
      '</form>');
  }
  function sectionCustom() {
    return card('custom', 'Custom cookie pricing', 'Customers see a starting price and an estimate. You set the final price when you approve each order.',
      '<div class="fields">' +
        field('customBasePrice', 'Starting price', numInput('customBasePrice', 'min="0" step="0.25"', '$', '/ cookie')) +
        field('minQty', 'Minimum order', numInput('minQty', 'min="1"', '', 'cookies', 'int')) +
        field('maxDesigns', 'Most designs a customer can pick', numInput('maxDesigns', 'min="1" max="24"', '', 'designs', 'int')) +
        '<div class="field" style="grid-column:1 / -1"><label class="label" for="customNote">Pricing note shown to customers</label><textarea class="input" id="customNote" rows="2" data-path="customNote"></textarea></div>' +
        '<div class="field" style="grid-column:1 / -1"><label class="label" for="allergyNote">Allergy note (shown with an * on custom cookies and at checkout)</label><textarea class="input" id="allergyNote" rows="2" data-path="allergyNote"></textarea></div>' +
      '</div>');
  }
  function sectionArtisan() {
    return card('artisan', 'Artisan cookies &amp; flavors', 'Set prices, add new flavors, hide ones you\'re not baking, and mark a special.',
      '<div class="fields">' +
        field('miniPerDozen', 'Mini, per dozen', numInput('miniPerDozen', 'min="0" step="0.5"', '$')) +
        field('largePerDozen', 'Large, per dozen', numInput('largePerDozen', 'min="0" step="0.5"', '$')) +
      '</div>' +
      // Flavor limit on its own row, short labels so the boxes line up, with a plain-English summary underneath.
      '<h3 style="font-size:22px;margin:26px 0 12px">Flavor limit</h3>' +
      '<div class="fields">' +
        field('flavorsPerDozen', 'Smaller orders', numInput('flavorsPerDozen', 'min="1" max="12"', '', 'flavors', 'int')) +
        field('flavorsMax', 'Bigger orders', numInput('flavorsMax', 'min="1" max="12"', '', 'flavors', 'int')) +
        field('flavorsMaxAt', 'Bigger orders start at', numInput('flavorsMaxAt', 'min="12" step="12"', '', 'cookies', 'int')) +
      '</div>' +
      '<p class="hint" id="flavor-rule" style="margin-top:8px"></p>' +
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
    return card('rules', 'Ordering rules', 'How far ahead customers must order, how many cookies you take each week (Monday to Sunday), and which days are closed.',
      '<div class="fields">' +
        field('leadDays', 'Minimum notice', numInput('leadDays', 'min="0" max="90"', '', 'days', 'int')) +
        field('capCustomPerWeek', 'Custom cookies per week', numInput('capCustomPerWeek', 'min="0"', '', 'cookies', 'int'), '0 = no limit.') +
        field('capArtisanPerWeek', 'Artisan cookies per week', numInput('capArtisanPerWeek', 'min="0"', '', 'cookies', 'int'), 'Mini and Large together. 0 = no limit.') +
        '<div class="field"><span class="label" id="accepting-label">Accepting cookie orders</span><button type="button" class="switch" role="switch" id="accepting" aria-labelledby="accepting-label" aria-checked="true"><span class="track" aria-hidden="true"></span><span id="accepting-text">Open</span></button></div>' +
      '</div>' +
      '<p class="hint" style="margin-top:10px">Approved orders count toward a week. Once a week is full, customers can\'t pick any day that week for that kind of cookie.</p>' +
      '<span class="label" style="display:block;margin-top:20px">Upcoming weeks</span><div id="busy-days" style="margin-top:8px"></div>' +
      '<span class="label" style="display:block;margin-top:20px">Blocked dates</span><div class="stack" id="blocked" style="margin-top:8px;gap:8px"></div>' +
      '<form id="add-block" style="display:flex;flex-wrap:wrap;gap:10px;margin-top:12px;align-items:flex-end">' +
        '<div class="field"><label class="label" for="new-block">From</label><input class="input" id="new-block" type="date"></div>' +
        '<div class="field"><label class="label" for="new-block-end">To <span class="muted" style="font-weight:400">(optional)</span></label><input class="input" id="new-block-end" type="date"></div>' +
        '<div class="field" style="flex:1 1 180px"><label class="label" for="new-block-note">Note <span class="muted" style="font-weight:400">(optional)</span></label><input class="input" id="new-block-note" type="text" placeholder="e.g. Vacation"></div>' +
        '<button type="submit" class="btn navy">+ Block</button></form>' +
      '<p class="hint" style="margin-top:6px">Leave "To" blank to block just one day. Ranges that have ended are removed automatically.</p>');
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
  // Pages that can be taken out of the website's menu (Settings: showAbout etc.).
  const PAGE_SWITCHES = [['showAbout', 'About'], ['showEvents', 'Special Events'], ['showGallery', 'Gallery'], ['showFaq', 'FAQ']];
  function sectionPages() {
    return card('pages', 'Website pages', 'Headings, text and photos on the Home, About, Special Events and Gallery pages. In longer text, leave a blank line to start a new paragraph.',
      '<div class="maint-admin">' +
        '<div class="row-gap" style="gap:12px;align-items:center;justify-content:space-between;flex-wrap:wrap">' +
          '<div><h3 style="font-size:22px;margin:0 0 4px" id="maint-label">Maintenance mode</h3>' +
            '<p class="hint" style="margin:0">Visitors see a “back soon” page instead of the site, and orders and messages are turned away. Anyone with the password sees the whole site and can test it.</p></div>' +
          '<button type="button" class="switch" role="switch" data-act="toggle-maint" aria-labelledby="maint-label"><span class="track" aria-hidden="true"></span><span id="maint-state"></span></button>' +
        '</div>' +
        '<div class="fields" style="margin-top:14px">' +
          field('maintenancePassword', 'Password to get in', '<input class="input" id="maintenancePassword" type="text" autocomplete="off" data-path="maintenancePassword" placeholder="e.g. sprinkles2026">',
            'On the “back soon” page, click <strong>Have a password?</strong> and enter this. That browser then sees the site until you click “Lock this browser”.') +
          field('maintenanceTitle', 'Heading', '<input class="input" id="maintenanceTitle" type="text" data-path="maintenanceTitle">') +
          '<div class="field" style="grid-column:1 / -1"><label class="label" for="maintenanceMessage">Message</label><textarea class="input" id="maintenanceMessage" rows="2" data-path="maintenanceMessage"></textarea></div>' +
        '</div>' +
      '</div>' +
      '<h3 style="font-size:22px;margin:22px 0 6px">Pages in the menu</h3><p class="hint" style="margin:0 0 10px">A hidden page leaves the menu, and visiting it goes to the home page. Hide one while you work on it.</p>' +
      '<div class="row-gap" style="gap:18px;flex-wrap:wrap">' +
        PAGE_SWITCHES.map(([key, label]) => '<span class="row-gap" style="gap:8px;align-items:center"><strong>' + label + '</strong>' +
          '<button type="button" class="switch" role="switch" data-act="toggle-page" data-key="' + key + '" aria-label="Show ' + label + ' in the menu"><span class="track" aria-hidden="true"></span><span data-page-state="' + key + '"></span></button></span>').join('') +
      '</div>' +
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
    return card('events', 'Special Events', 'One card per event on the Special Events page, in this order. Anything left blank doesn\'t show. For a class people book and pay for at checkout, set the button to <strong>Add to bag</strong> and fill in a price; add <strong>Max attendees</strong> to show spots left. Hide a card to take it off the page without deleting it.',
      '<div class="fields" style="margin-bottom:18px">' +
        field('classHoldMinutes', 'Hold a class spot while they pay', numInput('classHoldMinutes', 'min="10" max="240" step="5"', '', 'minutes', 'int'), 'With Square connected, unpaid bookings expire after this and the spot opens up again.') +
      '</div>' +
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
        field('taxRate', 'Tax', numInput('taxRate', 'min="0" step="0.01"', '', '%'), 'Applied to cookies, not drop-off fees or classes.') +
        field('ownerEmail', 'New-order alerts go to', '<input class="input" id="ownerEmail" type="email" data-path="ownerEmail" placeholder="Blank = your Google account">') +
        field('replyToEmail', 'Customer replies go to', '<input class="input" id="replyToEmail" type="email" data-path="replyToEmail" placeholder="Blank = same as alerts">') +
        field('pickupCity', 'Pickup area (shown on site)', '<input class="input" id="pickupCity" type="text" data-path="pickupCity">') +
        field('pickupAddress', 'Pickup address (only in the confirmation email)', '<input class="input" id="pickupAddress" type="text" data-path="pickupAddress">') +
        field('pickupInstructions', 'Pickup instructions (only in the confirmation email)', '<input class="input" id="pickupInstructions" type="text" data-path="pickupInstructions">') +
        field('instagram', 'Instagram link', '<input class="input" id="instagram" type="url" data-path="instagram">') +
        field('instagramHandle', 'Instagram handle', '<input class="input" id="instagramHandle" type="text" data-path="instagramHandle">') +
        '<div class="field" style="grid-column:1 / -1"><label class="label" for="adminHelpers">Admin helpers (optional)</label>' +
          '<input class="input" id="adminHelpers" type="text" data-path="adminHelpers" placeholder="e.g. helper@gmail.com, another@gmail.com">' +
          '<p class="hint">Google emails of people who can also use this admin. Saving shares the Sheet and customer photos with them. Emails they send (approvals, messages) go out from your account within 5 minutes.</p></div>' +
      '</div><p class="hint" style="margin-top:16px">Technical settings (website address, email sender name, test or live) are on the Sheet\'s Settings tab.</p>');
  }

  /* ---------- Helpers ---------- */
  function markDirty() { dirty = true; $('#save-bar').classList.add('show'); }
  function clearDirty() { dirty = false; $('#save-bar').classList.remove('show'); }
  // "Are you sure?" in the admin's own style (the browser's confirm() shows a scary technical address on top).
  // ask({ title, points: [...], note, yes, no, danger }) resolves true for yes, false for no / Esc / clicking outside.
  function ask(o) {
    return new Promise((resolve) => {
      const wrap = document.createElement('div');
      wrap.className = 'ask-wrap';
      wrap.innerHTML =
        '<div class="ask-box" role="alertdialog" aria-modal="true" aria-labelledby="ask-t" aria-describedby="ask-b">' +
          '<h2 id="ask-t">' + esc(o.title) + '</h2>' +
          '<div id="ask-b">' +
            (o.text ? '<p>' + esc(o.text) + '</p>' : '') +
            (o.points && o.points.length ? '<ul>' + o.points.map((p) => '<li>' + esc(p) + '</li>').join('') + '</ul>' : '') +
            (o.note ? '<p class="hint">' + esc(o.note) + '</p>' : '') +
          '</div>' +
          '<div class="ask-actions"><button type="button" class="btn ghost" data-ask="no">' + esc(o.no || 'Cancel') + '</button>' +
            '<button type="button" class="btn' + (o.danger ? ' danger' : '') + '" data-ask="yes">' + esc(o.yes || 'OK') + '</button></div>' +
        '</div>';
      const back = document.activeElement;
      const done = (v) => {
        wrap.remove();
        document.removeEventListener('keydown', onKey, true);
        if (back && document.body.contains(back)) back.focus();
        resolve(v);
      };
      const onKey = (e) => {
        if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); done(false); return; }
        if (e.key === 'Tab') {   // keep focus on the two buttons
          e.preventDefault();
          const bs = $$('[data-ask]', wrap);
          bs[(bs.indexOf(document.activeElement) + 1) % bs.length].focus();
        }
      };
      wrap.addEventListener('click', (e) => {
        const b = e.target.closest('[data-ask]');
        if (b) done(b.dataset.ask === 'yes'); else if (e.target === wrap) done(false);
      });
      document.addEventListener('keydown', onKey, true);
      document.body.appendChild(wrap);
      $('[data-ask="' + (o.danger ? 'no' : 'yes') + '"]', wrap).focus();   // the safe choice has focus for anything destructive
    });
  }

  function toast(msg, ms) {
    const t = $('#toast');
    if (!t) { alert(msg); return; }
    $('#toast-text').textContent = msg;
    t.classList.add('show');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => t.classList.remove('show'), ms || 3200);
  }
  const shortDate = (iso) => SN.prettyDate(iso, { weekday: 'short', month: 'short', day: 'numeric' });
  const caps = () => ({ custom: Number(cfg.capCustomPerWeek) || 0, artisan: Number(cfg.capArtisanPerWeek) || 0 });
  const zeroWeek = () => ({ custom: { approved: 0, pending: 0 }, artisan: { approved: 0, pending: 0 } });
  // Cookies of each kind in an order: { custom, artisan }
  const orderQty = (o) => ({
    custom: o.items.filter((it) => it.kind === 'custom').reduce((a, it) => a + it.qty, 0),
    artisan: o.items.filter((it) => it.kind === 'mini' || it.kind === 'large').reduce((a, it) => a + it.qty, 0)
  });

  /* ---------- Simple fields (data-path) and page text (data-page) ---------- */
  function fillFields() {
    $$('[data-path]').forEach((el) => { const v = cfg[el.dataset.path]; el.value = v == null ? '' : v; });
    $$('[data-page]').forEach((el) => { el.value = (cfg.pages || {})[el.dataset.page] || ''; thumb(el); });
    renderFlavorRule();
    $('#accepting').setAttribute('aria-checked', String(!!cfg.acceptingOrders));
    $('#accepting-text').textContent = cfg.acceptingOrders ? 'Open' : 'Paused';
    PAGE_SWITCHES.forEach(([key]) => {
      const on = cfg[key] !== false;
      $('[data-act="toggle-page"][data-key="' + key + '"]').setAttribute('aria-checked', String(on));
      $('[data-page-state="' + key + '"]').textContent = on ? 'Showing' : 'Hidden';
    });
    const maint = cfg.maintenanceMode === true;
    $('[data-act="toggle-maint"]').setAttribute('aria-checked', String(maint));
    $('#maint-state').textContent = maint ? 'On: site closed' : 'Off';
    $('.maint-admin').classList.toggle('on', maint);
  }
  // "Customers can pick up to 4 flavors, or up to 6 once their order reaches 24 cookies (2 dozen)."
  function renderFlavorRule() {
    const at = Number(cfg.flavorsMaxAt) || 0;
    $('#flavor-rule').textContent = 'Customers can pick up to ' + (cfg.flavorsPerDozen || 0) + ' flavors, or up to ' + (cfg.flavorsMax || 0) +
      ' once their order reaches ' + at + ' cookies' + (at && at % 12 === 0 ? ' (' + at / 12 + ' dozen)' : '') + '.';
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
      if (/^flavors/.test(el.dataset.path)) renderFlavorRule();
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
    'Baking': 'background:#F7E3DD;color:#8E3A2E', 'Ready': 'background:#DDEFE3;color:#1E5A35', 'Completed': 'background:#EDEDED;color:#3D4250',
    'Declined': 'background:#EDEDED;color:#3D4250', 'Booked': 'background:#E4E9F3;color:#1F2A44', 'Cancelled': 'background:#EDEDED;color:#3D4250',
    'Awaiting payment': 'background:#FDF0D5;color:#7A4B00', 'Expired': 'background:#EDEDED;color:#3D4250'
  };
  // Statuses Melissa can pick from the list: cookie orders after approval; class bookings any time.
  // "Awaiting payment" (paying in Square) and "Expired" (didn't pay in time) are set automatically, so they're only
  // in the list while a booking is in them. Picking Booked or Paid from there confirms it and sends the emails.
  const AFTER_INVOICE = ['Invoice sent', 'Paid', 'Baking', 'Ready', 'Completed', 'Cancelled'];
  const CLASS_STATUSES = ['Booked', 'Paid', 'Completed', 'Cancelled'];
  const isClass = (o) => o.type === 'Class';
  const pickable = (o) => (isClass(o) ? (CLASS_STATUSES.indexOf(o.status) === -1 ? [o.status] : []).concat(CLASS_STATUSES) : AFTER_INVOICE.indexOf(o.status) !== -1 ? AFTER_INVOICE : null);
  const badge = (st) => '<span class="status-badge" style="' + (STATUS_STYLE[st] || '') + '">' + esc(st) + '</span>';
  const isActive = (o) => ['Completed', 'Declined', 'Cancelled', 'Expired'].indexOf(o.status) === -1;

  function renderOrders() {
    const pending = orders.filter((o) => o.status === 'Pending review').length;
    $('#orders-h').innerHTML = 'Orders' + (pending ? ' <span class="count-pill">' + pending + ' to review</span>' : '');
    navCount('orders', pending ? pending + ' to review' : '');
    const list = showAllOrders ? orders : orders.filter(isActive);
    $('#orders-toggle').textContent = showAllOrders ? 'Hide completed, declined & cancelled' : 'Show completed, declined & cancelled (' + (orders.length - orders.filter(isActive).length) + ')';
    const body = $('#orders-body');
    if (!list.length) {
      body.innerHTML = '<tr class="empty-row"><td colspan="6">' + (orders.length ? 'No open orders.' : 'No orders yet. They\'ll show up here as soon as a customer sends a request or books a class.') + '</td></tr>';
      return;
    }
    // Six columns with related details stacked, so the table fits a laptop screen without scrolling sideways.
    const small = (t) => '<br><span class="muted" style="font-size:13px">' + t + '</span>';
    body.innerHTML = list.map((o) => {
      const items = o.items.map((it) => esc(it.kind === 'class' ? it.qty + ' × ' + it.title : it.qty + ' ' + SN.itemLabel(it.kind))).join('<br>');
      const ful = isClass(o) ? 'Class' : o.fulfillment === 'delivery' && o.address ? 'Drop-off · ' + esc(o.address.zip) : 'Pickup';
      const total = o.invoice
        ? '<strong>' + money(o.invoice.total) + '</strong>' + (o.invoice.changed ? small('was est. ' + money(o.total)) : '')
        : money(o.total) + small(isClass(o) ? '' : 'estimate');
      const opts = pickable(o);
      const status = opts
        ? '<label class="sr-only" for="st-' + esc(o.number) + '">Status for ' + esc(o.number) + '</label><select class="status" id="st-' + esc(o.number) + '" data-order="' + esc(o.number) + '">' +
            opts.map((s) => '<option' + (s === o.status ? ' selected' : '') + '>' + s + '</option>').join('') + '</select>'
        : badge(o.status);
      const action = '<button type="button" class="btn ' + (o.status === 'Pending review' ? '' : 'ghost ') + 'small" data-rv="open" data-n="' + esc(o.number) + '">' + (o.status === 'Pending review' ? 'Review' : 'View') + '</button>';
      const at = o.createdAt ? new Date(o.createdAt) : null;
      const received = at ? { date: at.toLocaleDateString('en-US', { month: 'short', day: 'numeric' }), time: at.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' }) } : null;
      return '<tr' + (o.status === 'Pending review' ? ' class="row-pending"' : '') + '>' +
        '<td><div class="order-cell">' + action + '<div><strong>' + esc(o.number) + '</strong>' + (received ? '<br><span style="font-size:13px;white-space:nowrap">Ordered ' + esc(received.date) + '</span>' + small(esc(received.time)) : '') +
          (o.allergies ? '<br><span class="status-badge" style="background:#FBEDEA;color:#B23A2B;margin-top:4px">Allergy</span>' : '') + '</div></div></td>' +
        '<td class="wrap-any">' + esc(o.customer.name) + small(esc(o.customer.email)) + small(esc(isClass(o) ? 'Class' : o.eventType || 'Occasion not given')) + '</td>' +
        '<td class="nowrap">' + esc(o.dateNeeded ? SN.prettyDate(o.dateNeeded, { weekday: 'short', month: 'short', day: 'numeric' }) : '—') + small(ful) + '</td>' +
        '<td>' + items + '</td>' +
        '<td class="nowrap">' + total + '</td>' +
        '<td>' + status + '</td></tr>';
    }).join('');
  }
  // Newest first, by when the customer sent it.
  function sortOrders() { orders.sort((a, b) => (b.createdAt || '').localeCompare(a.createdAt || '') || b.number.localeCompare(a.number, undefined, { numeric: true })); }
  async function onStatusChange(e) {
    const sel = e.target.closest('[data-order]');
    if (!sel) return;
    const o = orders.find((x) => x.number === sel.dataset.order);
    const prev = o.status;
    if (prev === 'Cancelled' && !isClass(o)) { sel.value = prev; toast('A cancelled cookie order can’t be reopened (its invoice and gift card were undone). Ask the customer to order again.', 6000); return; }
    if (sel.value === 'Cancelled') {
      const inv = o.invoice || {};
      const gift = isClass(o) ? o.giftCredit : inv.credit;
      const points = [];
      if (isClass(o)) {
        points.push('Its class spots open up again on the website.');
        if (prev === 'Awaiting payment') points.push('Its Square payment link is closed, so it can’t be paid for later.');
      } else {
        points.push('Its cookies stop counting toward that week’s limit.');
        if (inv.qb && inv.qb.id) points.push('If QuickBooks invoice #' + inv.qb.docNumber + ' is unpaid, it’s voided so it can’t be paid.');
      }
      if (gift > 0) points.push('The ' + money(gift) + ' gift card amount goes back on ' + o.promoCode + '.');
      if (prev !== 'Awaiting payment' && prev !== 'Invoice sent' && prev !== 'Booked') {
        points.push(isClass(o) ? 'If they paid by card, refund it in Square (Transactions → the payment → Refund). The website can’t do that part.'
          : 'If they paid, refund it in QuickBooks (the invoice → Refund). The website can’t do that part.');
      }
      const ok = await ask({
        title: 'Cancel ' + o.number + '?', points, danger: true, yes: 'Cancel order', no: 'Keep it',
        note: (isClass(o) ? '' : 'This can’t be undone. ') + 'Let the customer know: Review → Message the customer.'
      });
      if (!ok) { sel.value = prev; return; }
    }
    o.status = sel.value;
    server('adminSetStatus', o.number, sel.value).then((r) => {
      if (!r.ok) { o.status = prev; renderOrders(); toast(r.error); return; }
      if (r.order) Object.assign(o, r.order);
      toast(o.number + ' marked ' + o.status + (r.note ? '. ' + r.note : ''), r.note ? 9000 : 3600);
      if (r.weekCounts) { weekCounts = r.weekCounts; renderBusyDays(); }
      renderDashboard();
      renderOrders();
    }).catch((err) => { o.status = prev; renderOrders(); failed(err); });
  }

  // "Week of Nov 2 · custom 40 of 50, artisan 12 of 75"
  const weekCell = (n, cap) => n + (cap ? ' of ' + cap : '');
  function renderBusyDays() {
    const c = caps();
    const thisWeek = SN.mondayOf(SN.isoDate(new Date()));
    const weeks = Object.keys(weekCounts).filter((w) => w >= thisWeek && ['custom', 'artisan'].some((k) => weekCounts[w][k].approved || weekCounts[w][k].pending)).sort();
    $('#busy-days').innerHTML = weeks.length ? '<div class="stack" style="gap:6px">' + weeks.map((w) => {
      const wc = weekCounts[w];
      const full = ['custom', 'artisan'].filter((k) => c[k] && wc[k].approved >= c[k]);
      const pend = (k) => (wc[k].pending ? ' (+' + wc[k].pending + ' pending)' : '');
      return '<div style="font-size:14px"><strong>Week of ' + esc(SN.prettyDate(w, { month: 'short', day: 'numeric' })) + '</strong> · ' +
        'custom ' + weekCell(wc.custom.approved, c.custom) + pend('custom') + ' · artisan ' + weekCell(wc.artisan.approved, c.artisan) + pend('artisan') +
        full.map((k) => ' <span class="status-badge" style="background:#FBEDEA;color:#B23A2B">Full: ' + k + ' (Mon ' + esc(shortDate(w).replace(/^\w+, /, '')) + ' – Sun ' + esc(shortDate(SN.isoDate(new Date(new Date(w + 'T12:00').getTime() + 6 * 864e5))).replace(/^\w+, /, '')) + ')</span>').join('') +
      '</div>';
    }).join('') + '</div>' : '<span class="hint">No upcoming cookie orders yet.</span>';
  }

  /* ---------- Dashboard: plan the week (Mon-Sun, by the date orders are needed) ---------- */
  // Confirmed = approved cookie orders and booked classes. Pending requests are shown, but always separately.
  let dashWeek = '';          // Monday of the week shown
  let dashRefreshed = null;   // when orders were last loaded from the Sheet
  const COUNTED = ['Invoice sent', 'Paid', 'Baking', 'Ready', 'Completed'];
  const isConfirmed = (o) => (isClass(o) ? ['Booked', 'Paid', 'Completed'].indexOf(o.status) !== -1 : COUNTED.indexOf(o.status) !== -1);
  const isPending = (o) => o.status === 'Pending review';
  const addDays = (iso, n) => { const d = new Date(iso + 'T12:00'); d.setDate(d.getDate() + n); return SN.isoDate(d); };
  const dayLabel = (iso, opts) => SN.prettyDate(iso, opts || { weekday: 'short', month: 'short', day: 'numeric' });

  function sectionDashboard() {
    return '<section class="panel-card" id="dashboard" aria-labelledby="dashboard-h"><div id="dash"></div></section>';
  }

  // Cookies, class spots and money in a set of orders.
  function tally(list) {
    const t = { orders: list.length, custom: 0, mini: 0, large: 0, spots: 0, money: 0 };
    list.forEach((o) => {
      o.items.forEach((it) => { if (it.kind === 'class') t.spots += it.qty; else t[it.kind] += it.qty; });
      t.money += o.invoice ? Number(o.invoice.total) || 0 : Number(o.total) || 0;
    });
    return t;
  }

  // What to bake: artisan cookies added up by size and flavor; custom orders listed one by one.
  function bakeList(list) {
    const names = {};
    (cfg.flavors || []).forEach((f) => { names[f.id] = f.name; });
    const art = { mini: {}, large: {} };
    const custom = [], classes = {};
    list.forEach((o) => o.items.forEach((it) => {
      if (it.kind === 'custom') custom.push({ o, it });
      else if (it.kind === 'class') { const k = it.title; classes[k] = classes[k] || { title: it.title, spots: 0, date: o.dateNeeded }; classes[k].spots += it.qty; }
      else Object.keys(it.fq || {}).forEach((id) => { const n = names[id] || (it.flavorNames || {})[id] || id; art[it.kind][n] = (art[it.kind][n] || 0) + it.fq[id]; });
    }));
    return { art, custom, classes: Object.keys(classes).map((k) => classes[k]) };
  }

  // Checks that the numbers on this page can be trusted. Each returns { ok, text, n } (n = order number to open).
  function dataChecks(week, weekConfirmed) {
    const out = [];
    const today = SN.isoDate(new Date());
    const open = orders.filter((o) => ['Declined', 'Cancelled', 'Completed'].indexOf(o.status) === -1);
    const live = orders.filter((o) => ['Declined', 'Cancelled'].indexOf(o.status) === -1);

    // 1. This week's approved cookie totals match the Sheet's own weekly count (worked out separately on the server).
    const mine = tally(weekConfirmed.filter((o) => !isClass(o)));
    const sheet = weekCounts[week] || zeroWeek();
    const same = mine.custom === sheet.custom.approved && mine.mini + mine.large === sheet.artisan.approved;
    out.push(same
      ? { ok: true, text: 'This week’s cookie totals match the Sheet’s weekly count (' + mine.custom + ' custom, ' + (mine.mini + mine.large) + ' artisan).' }
      : { ok: false, text: 'This week’s totals don’t match the Sheet’s weekly count (here: ' + mine.custom + ' custom, ' + (mine.mini + mine.large) + ' artisan; Sheet: ' + sheet.custom.approved + ' custom, ' + sheet.artisan.approved + ' artisan). Click Refresh; if it stays, check the OrderItems tab.' });

    // 2. Each order's items add up to its subtotal.
    const badSum = live.filter((o) => o.items.length && Math.abs(o.items.reduce((a, it) => a + (Number(it.lineTotal) || 0), 0) - (Number(o.subtotal) || 0)) > 0.01);
    out.push(badSum.length ? { ok: false, text: badSum.map((o) => o.number).join(', ') + ': items don’t add up to the order’s subtotal.', n: badSum[0].number } : { ok: true, text: 'Every order’s items add up to its subtotal.' });

    // 3. Orders missing a date or items.
    const missing = live.filter((o) => !o.items.length || (!isClass(o) && !o.dateNeeded));
    out.push(missing.length ? { ok: false, text: missing.map((o) => o.number).join(', ') + ': missing a date or items.', n: missing[0].number } : { ok: true, text: 'Every order has items and a date.' });

    // 4. Past their date but not marked Completed (or declined/cancelled).
    const pastDue = open.filter((o) => o.dateNeeded && o.dateNeeded < today);
    pastDue.forEach((o) => out.push({ ok: false, text: o.number + ' was needed ' + dayLabel(o.dateNeeded) + ' but is still ' + o.status + '.', n: o.number }));
    if (!pastDue.length) out.push({ ok: true, text: 'No past-due orders left open.' });

    // 5. Requests still waiting for review that are needed within 3 days.
    const soon = orders.filter((o) => isPending(o) && o.dateNeeded && o.dateNeeded >= today && o.dateNeeded <= addDays(today, 3));
    soon.forEach((o) => out.push({ ok: false, text: o.number + ' is needed ' + dayLabel(o.dateNeeded) + ' and still needs review.', n: o.number }));

    // 6. This week over the weekly caps.
    const c = caps();
    if (c.custom && mine.custom > c.custom) out.push({ ok: false, text: 'This week has ' + mine.custom + ' approved custom cookies, over your limit of ' + c.custom + '.' });
    if (c.artisan && mine.mini + mine.large > c.artisan) out.push({ ok: false, text: 'This week has ' + (mine.mini + mine.large) + ' approved artisan cookies, over your limit of ' + c.artisan + '.' });

    // 7. Orders on a blocked date.
    const blocked = (cfg.blockedRanges || []);
    const onBlocked = live.filter((o) => !isClass(o) && o.dateNeeded && blocked.some((r) => o.dateNeeded >= r.start && o.dateNeeded <= r.end));
    onBlocked.forEach((o) => out.push({ ok: false, text: o.number + ' is on a blocked date (' + dayLabel(o.dateNeeded) + ').', n: o.number }));

    // 8. Possible duplicates: same email, same date, same total.
    const seen = {}, dupes = [];
    live.forEach((o) => { const k = o.customer.email.toLowerCase() + '|' + o.dateNeeded + '|' + o.total; if (seen[k]) dupes.push([seen[k], o.number]); else seen[k] = o.number; });
    dupes.forEach(([a, b]) => out.push({ ok: false, text: a + ' and ' + b + ' look like the same order sent twice (same email, date and total).', n: b }));

    // 9. Classes booked past their max.
    (cfg.events || []).filter((e) => e.max !== '' && e.max != null && (e.booked || 0) > e.max)
      .forEach((e) => out.push({ ok: false, text: e.title + ' has ' + e.booked + ' spots booked but a max of ' + e.max + '.' }));

    if (!onBlocked.length && !dupes.length && !soon.length) out.push({ ok: true, text: 'No orders on blocked dates, no likely duplicates, nothing urgent waiting for review.' });
    return out;
  }

  function renderDashboard() {
    const box = $('#dash');
    if (!box) return;
    const today = SN.isoDate(new Date());
    if (!dashWeek) dashWeek = SN.mondayOf(today);
    const week = dashWeek, sunday = addDays(week, 6);
    const days = Array.from({ length: 7 }, (_, i) => addDays(week, i));
    const inWeek = orders.filter((o) => o.dateNeeded >= week && o.dateNeeded <= sunday && ['Declined', 'Cancelled'].indexOf(o.status) === -1);
    const conf = inWeek.filter(isConfirmed), pend = inWeek.filter(isPending);
    const tc = tally(conf), tp = tally(pend), c = caps();
    const waiting = orders.filter(isPending).length;
    const plus = (n) => (n ? '<span class="dash-pend">+' + n + ' pending</span>' : '');
    const tile = (label, value, sub) => '<div class="dash-tile"><div class="k">' + label + '</div><div class="v">' + value + '</div>' + (sub || '') + '</div>';
    const bake = bakeList(conf);
    const artRows = (size) => Object.keys(bake.art[size]).sort().map((n) => '<tr><td>' + esc(n) + '</td><td>' + bake.art[size][n] + '</td></tr>').join('');
    const sum = (obj) => Object.keys(obj).reduce((a, k) => a + obj[k], 0);
    const bakeTotals = { custom: bake.custom.reduce((a, x) => a + x.it.qty, 0), mini: sum(bake.art.mini), large: sum(bake.art.large) };
    bakeTotals.all = bakeTotals.custom + bakeTotals.mini + bakeTotals.large;
    const totalRow = (label, n) => '<tr class="dash-total"><td>' + esc(label) + '</td><td>' + n + '</td></tr>';
    const checks = dataChecks(week, conf);
    const problems = checks.filter((x) => !x.ok).length;

    box.innerHTML =
      '<div class="dash-head">' +
        '<div><h2 id="dashboard-h">Week of ' + esc(dayLabel(week, { month: 'long', day: 'numeric' })) + '</h2>' +
          '<p class="sub" style="margin:2px 0 0">' + esc(dayLabel(week)) + ' – ' + esc(dayLabel(sunday)) + ' · by the date orders are needed' +
          (dashRefreshed ? ' · updated ' + esc(dashRefreshed.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })) : '') + '</p></div>' +
        '<div class="row-gap dash-nav" style="gap:8px">' +
          '<button type="button" class="btn ghost small" data-dash="prev" aria-label="Previous week">‹ Previous</button>' +
          '<button type="button" class="btn ghost small" data-dash="today"' + (week === SN.mondayOf(today) ? ' aria-disabled="true"' : '') + '>This week</button>' +
          '<button type="button" class="btn ghost small" data-dash="next" aria-label="Next week">Next ›</button>' +
          '<button type="button" class="btn ghost small" data-dash="refresh">Refresh</button>' +
          '<button type="button" class="btn ghost small" data-dash="print">Print</button>' +
        '</div>' +
      '</div>' +
      (waiting ? '<div class="dash-alert">' + waiting + ' order' + (waiting > 1 ? 's are' : ' is') + ' waiting for review' +
        (tp.orders ? ' (' + tp.orders + ' this week)' : '') + '. Pending orders aren’t in the totals until you approve them. <a href="#orders" target="_self">Review them</a></div>' : '') +
      '<div class="dash-tiles">' +
        tile('Confirmed orders', tc.orders, plus(tp.orders)) +
        tile('Custom cookies', tc.custom + (c.custom ? '<span class="muted" style="font-size:16px"> / ' + c.custom + '</span>' : ''), plus(tp.custom)) +
        tile('Artisan cookies', (tc.mini + tc.large) + (c.artisan ? '<span class="muted" style="font-size:16px"> / ' + c.artisan + '</span>' : ''),
          '<div class="hint">' + tc.mini + ' mini · ' + tc.large + ' large</div>' + plus(tp.mini + tp.large)) +
        tile('Class spots', tc.spots, '') +
        tile('Confirmed sales', money(tc.money), tp.orders ? '<span class="dash-pend">+' + money(tp.money) + ' estimated pending</span>' : '') +
      '</div>' +
      '<div class="dash-cal">' + days.map((d) => {
        const list = inWeek.filter((o) => o.dateNeeded === d).sort((a, b) => Number(isPending(a)) - Number(isPending(b)));
        return '<div class="dash-day' + (d === today ? ' today' : '') + '"><div class="dash-day-h">' + esc(dayLabel(d)) + (d === today ? ' · today' : '') + '</div>' +
          (list.length ? list.map((o) => {
            const what = o.items.map((it) => it.kind === 'class' ? it.qty + ' × ' + it.title : it.qty + ' ' + (it.kind === 'custom' ? 'custom' : it.kind)).join(', ');
            const how = isClass(o) ? 'Class' : o.fulfillment === 'delivery' ? 'Drop-off' : 'Pickup';
            return '<button type="button" class="dash-order' + (isPending(o) ? ' pending' : '') + '" data-dash-open="' + esc(o.number) + '" style="border-left-color:' + ((STATUS_STYLE[o.status] || '').match(/color:([^;]+)/) || [, 'var(--navy)'])[1] + '">' +
              '<strong>' + esc(o.number) + '</strong> ' + esc((o.customer.name || '').split(' ')[0]) +
              '<span>' + esc(what) + '</span><span>' + esc(how) + ' · ' + esc(o.status) + (o.allergies ? ' · Allergy' : '') + '</span></button>';
          }).join('') : '<p class="hint" style="margin:6px 0 0">Nothing due</p>') +
        '</div>';
      }).join('') + '</div>' +
      '<div class="dash-cols">' +
        '<div><h3 class="rv-h">Bake list <span class="muted" style="font-size:14px;font-family:var(--sans);font-weight:400">(confirmed orders)</span></h3>' +
          // Every section is a table with counts on the right and its own total, then a total for all cookies.
          (bake.custom.length ? '<h4 class="dash-h4">Custom cookies</h4><table class="dash-table"><tbody>' + bake.custom.map(({ o, it }) =>
            '<tr><td><button type="button" class="link-btn" data-dash-open="' + esc(o.number) + '" style="padding:0">' + esc(o.number) + '</button> · ' + esc(dayLabel(o.dateNeeded)) +
              ' · ' + it.designs + ' design' + (it.designs > 1 ? 's' : '') + (it.desc ? '<div class="hint">“' + esc(it.desc.length > 140 ? it.desc.slice(0, 140) + '…' : it.desc) + '”</div>' : '') + '</td>' +
              '<td>' + it.qty + '</td></tr>').join('') +
            totalRow('Total custom', bakeTotals.custom) + '</tbody></table>' : '') +
          ['mini', 'large'].map((size) => artRows(size)
            ? '<h4 class="dash-h4">' + (size === 'mini' ? 'Mini' : 'Large') + ' artisan</h4><table class="dash-table"><tbody>' + artRows(size) +
              totalRow('Total ' + size, bakeTotals[size]) + '</tbody></table>' : '').join('') +
          (bakeTotals.all ? '<table class="dash-table dash-grand"><tbody>' + totalRow('Total cookies to bake', bakeTotals.all) + '</tbody></table>' : '') +
          (bake.classes.length ? '<h4 class="dash-h4">Classes</h4>' + bake.classes.map((k) => '<div class="dash-line">' + esc(k.title) + ' · ' + esc(dayLabel(k.date)) + ' · <strong>' + k.spots + '</strong> spots</div>').join('') : '') +
          (!conf.length ? '<p class="hint">No confirmed orders this week yet.</p>' : '') +
        '</div>' +
        '<div><h3 class="rv-h">Data checks <span class="muted" style="font-size:14px;font-family:var(--sans);font-weight:400">' +
            (problems ? problems + ' to look at' : 'all good') + '</span></h3>' +
          '<ul class="dash-checks">' + checks.map((x) => '<li class="' + (x.ok ? 'ok' : 'warn') + '"><span aria-hidden="true">' + (x.ok ? '✓' : '!') + '</span><span>' + esc(x.text) +
            (x.n ? ' <button type="button" class="link-btn" data-dash-open="' + esc(x.n) + '" style="padding:0">Open</button>' : '') + '</span></li>').join('') + '</ul>' +
        '</div>' +
      '</div>';
  }

  // Reload orders (not settings, so unsaved setting edits stay) and redraw.
  function refreshOrders() {
    return server('adminLoad').then((d) => {
      orders = d.orders;
      sortOrders();
      weekCounts = d.weekCounts || {};
      messages = d.messages;
      codes = d.codes || [];
      cfg.events = cfg.events.map((e) => { const fresh = (d.config.events || []).find((x) => x.id === e.id); return fresh ? Object.assign(e, { booked: fresh.booked, spotsLeft: fresh.spotsLeft }) : e; });
      dashRefreshed = new Date();
      renderOrders(); renderMessages(); renderCodes(); renderBusyDays(); renderDashboard();
      // An open order panel shows the fresh status and QuickBooks balance too (its typed text lives in rv, so it's kept).
      if (rv && orders.some((x) => x.number === rv.number)) renderReview();
    });
  }

  // Payments are marked Paid in the Sheet every 5 minutes, so an open admin reloads orders every 2 minutes, and when
  // Melissa comes back to the tab. Not while she's in an order panel or busy, so nothing she's typing moves.
  const AUTO_REFRESH_MS = 2 * 60000;
  function autoRefresh() {
    if (!dashRefreshed || document.hidden || busy || rv || Date.now() - (dashRefreshed ? dashRefreshed.getTime() : 0) < AUTO_REFRESH_MS - 5000) return;
    refreshOrders().catch(() => { /* try again next time */ });
  }
  setInterval(autoRefresh, AUTO_REFRESH_MS);
  document.addEventListener('visibilitychange', autoRefresh);

  function onDashClick(b) {
    if (b.dataset.dashOpen) { openReview(b.dataset.dashOpen, b); return; }
    const act = b.dataset.dash;
    if (act === 'prev') dashWeek = addDays(dashWeek, -7);
    if (act === 'next') dashWeek = addDays(dashWeek, 7);
    if (act === 'today') dashWeek = SN.mondayOf(SN.isoDate(new Date()));
    if (act === 'print') { window.print(); return; }
    if (act === 'refresh') { b.textContent = 'Refreshing…'; refreshOrders().then(() => toast('Orders refreshed from the Sheet')).catch(failed); return; }
    renderDashboard();
  }

  /* ---------- Review panel ---------- */
  let rv = null;        // { number, lines, fee, note, original, declining, declineNote, editingDate }
  let rvOpener = null;

  function openReview(number, el) {
    const o = orders.find((x) => x.number === number);
    if (!o) return;
    const lines = o.invoice ? SN.clone(o.invoice.lines) : SN.linesFromOrder(cfg, o);
    const fee = o.invoice ? o.invoice.fee : (o.fulfillment === 'delivery' ? Number(o.deliveryFee) || 0 : 0);
    rv = { number, lines, fee, note: o.invoice ? o.invoice.note || '' : '', declining: false, declineNote: '', editingDate: false, message: '' };
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

  // How the order's week looks against the weekly caps, and whether approving it would go over.
  function weekInfo(o) {
    if (isClass(o) || !o.dateNeeded) return { text: '', over: false };
    const wc = weekCounts[SN.mondayOf(o.dateNeeded)] || zeroWeek();
    const q = orderQty(o), c = caps();
    const pending = o.status === 'Pending review';
    const parts = [], over = [];
    ['custom', 'artisan'].forEach((k) => {
      if (!q[k] && !wc[k].approved) return;
      const otherPending = wc[k].pending - (pending ? q[k] : 0);
      parts.push(k + ': ' + weekCell(wc[k].approved, c[k]) + ' approved' + (otherPending > 0 ? ' (+' + otherPending + ' in other pending orders)' : ''));
      if (pending && c[k] && q[k] && wc[k].approved + q[k] > c[k]) over.push(k + ' would be at ' + (wc[k].approved + q[k]) + ' of ' + c[k]);
    });
    return { text: 'Week of ' + SN.prettyDate(SN.mondayOf(o.dateNeeded), { month: 'short', day: 'numeric' }) + ' · ' + (parts.join(' · ') || 'nothing else yet'), over: over.join(', ') };
  }

  // A customer's photo (order item or message). Saved privately in Drive, so the image is fetched through the
  // server (adminPhoto) by loadPhotos() after it's on the page; clicking opens it full size in Drive.
  const photoCache = {};
  function customerPhoto(x, label) {
    const photos = x.photos || [], names = x.photoNames || [];
    const html = photos.length
      ? '<div class="cust-photo"><span class="hint">' + label + (photos.length > 1 ? 's (' + photos.length + ')' : '') + '</span><div class="cust-photo-row">' +
          photos.map((p, i) => '<a href="' + esc(p.url) + '" target="_blank" rel="noopener" title="Open full size in Google Drive">' +
            '<img data-photo-id="' + esc(p.id) + '" alt="' + esc(label) + ' ' + (i + 1) + '"' + (photoCache[p.id] ? ' src="' + photoCache[p.id] + '"' : '') + '></a>').join('') +
        '</div></div>'
      : '';
    // Just file names: sent before photo uploads were turned on, or saving them failed.
    return html + (names.length ? '<div class="hint" style="margin-top:4px">' + label + (names.length > 1 ? 's' : '') + ': <strong>' + esc(names.join(', ')) + '</strong> <span class="muted">(not saved; ask them to email ' + (names.length > 1 ? 'them' : 'it') + ')</span></div>' : '');
  }
  function loadPhotos(root) {
    $$('img[data-photo-id]:not([src])', root).forEach((img) => {
      const id = img.dataset.photoId;
      const show = (src) => { $$('img[data-photo-id="' + id + '"]').forEach((el) => { el.src = src; }); };
      if (photoCache[id]) { show(photoCache[id]); return; }
      photoCache[id] = '';   // loading
      server('adminPhoto', id).then((src) => { photoCache[id] = src; show(src); })
        .catch(() => { delete photoCache[id]; img.alt = 'Photo couldn’t load: click to open it in Drive'; });
    });
  }

  function requestHtml(o) {
    const it = o.items.map((x) =>
      '<div class="rv-item"><div style="display:flex;justify-content:space-between;gap:12px"><strong>' + esc(SN.itemHeading(x)) + '</strong><span class="muted">' + (isClass(o) ? '' : 'est. ') + money(x.lineTotal) + '</span></div>' +
      '<div class="hint">' + esc(x.summary) + '</div>' +
      (x.desc ? '<div class="rv-quote">“' + esc(x.desc) + '”</div>' : '') +
      customerPhoto(x, 'Inspiration photo') +
      '</div>').join('');
    const where = isClass(o) ? 'Class booking'
      : o.fulfillment === 'delivery' && o.address ? 'Drop-off · ' + esc(o.address.street) + ', ' + esc(o.address.city) + ' ' + esc(o.address.zip)
      : 'Pickup in ' + esc(cfg.pickupCity);
    const wk = weekInfo(o);
    const dateBlock = isClass(o) ? esc(o.dateNeeded ? SN.prettyDate(o.dateNeeded) : '—')
      : rv.editingDate
        ? '<div class="stack" style="gap:8px;margin-top:4px">' +
            '<label class="sr-only" for="rv-date">New date</label><input class="input" id="rv-date" type="date" value="' + esc(o.dateNeeded) + '">' +
            '<label class="row-gap" style="gap:8px;font-weight:400;font-size:14px"><input type="checkbox" id="rv-date-notify" checked> Email the customer about the new date</label>' +
            '<textarea class="input" id="rv-date-note" rows="2" placeholder="Optional note to include, e.g. Thanks for being flexible!"></textarea>' +
            '<div class="row-gap" style="gap:8px"><button type="button" class="btn small" data-rv="date-save">Save date</button><button type="button" class="btn ghost small" data-rv="date-cancel">Cancel</button></div></div>'
        : esc(SN.prettyDate(o.dateNeeded)) + ' <button type="button" class="link-btn" data-rv="date-edit" style="margin-left:6px">Change date</button>';
    return '<div class="rv-facts">' +
        '<div><div class="k">Customer</div><div class="v">' + esc(o.customer.name) + '</div><div class="hint">' + esc(o.customer.email) + '<br>' + esc(o.customer.phone) + '</div></div>' +
        '<div><div class="k">' + (isClass(o) ? 'Class date' : 'Needed by') + '</div><div class="v">' + dateBlock + '</div>' +
          (isClass(o) ? '' : '<div class="hint">' + esc(o.eventType || 'Occasion not specified') + '</div>') + '</div>' +
        (wk.text ? '<div style="grid-column:1 / -1"><div class="k">That week so far</div><div class="v" style="font-weight:500' + (wk.over ? ';color:var(--error)' : '') + '">' +
          esc(wk.text) + (wk.over ? '. Approving puts it over your limit (' + esc(wk.over) + ').' : '') + '</div></div>' : '') +
        '<div style="grid-column:1 / -1"><div class="k">Pickup / drop-off</div><div class="v">' + where + '</div></div>' +
        (o.allergies ? '<div style="grid-column:1 / -1"><div class="k" style="color:var(--error)">Allergies / dietary needs</div><div class="v">' + esc(o.allergies) + '</div></div>' : '') +
        (o.promoCode ? '<div style="grid-column:1 / -1"><div class="k">Code used</div><div class="v">' + esc(o.promoCode) +
          (o.giftCredit && !o.invoice ? ' <span class="hint">(gift card: about ' + money(o.giftCredit) + ' comes off when you approve, from its balance at that time)</span>' : '') + '</div></div>' : '') +
      '</div>' +
      '<h3 class="rv-h">' + (isClass(o) ? 'Booked' : 'What they asked for') + '</h3>' + it +
      (isClass(o) ? '' : '<div class="hint" style="margin-top:8px">Estimate shown to customer: <strong>' + money(o.total) + '</strong></div>');
  }

  // Message the customer without approving or declining. Earlier messages are listed underneath.
  function messageHtml(o) {
    const log = o.messages || [];
    return '<h3 class="rv-h">Message the customer</h3>' +
      '<p class="hint" style="margin:-6px 0 8px">Emails ' + esc(o.customer.email) + ' with the subject "A message about your order ' + esc(o.number) + '" and a summary of the order. Replies come to your inbox.</p>' +
      '<label class="sr-only" for="rv-msg">Message</label><textarea class="input" id="rv-msg" rows="3" data-inv="message" placeholder="e.g. Quick question about the colors before I approve…">' + esc(rv.message) + '</textarea>' +
      '<div style="margin-top:8px"><button type="button" class="btn ghost small" data-rv="send-msg">Send message</button></div>' +
      (log.length ? '<div class="stack" style="gap:8px;margin-top:14px">' + log.slice().reverse().map((m) =>
        '<div class="rv-quote" style="white-space:pre-wrap">' + esc(m.text) + '<div class="hint" style="margin-top:4px;font-style:normal">' +
          esc(new Date(m.at).toLocaleString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })) + ' · ' + esc(m.emailStatus || '') + '</div></div>').join('') + '</div>' : '');
  }

  function invoiceSummary(o) {
    const inv = o.invoice;
    return '<h3 class="rv-h">' + (isClass(o) ? 'Invoice' : 'Confirmed invoice') + '</h3>' +
      inv.lines.map((l) => '<div class="rv-line"><span>' + esc(l.desc) + ' <span class="muted">(' + l.qty + ' × ' + money(Number(l.unit)) + ')</span></span><span>' + money(l.qty * l.unit) + '</span></div>').join('') +
      '<div class="totals" style="margin-top:10px">' +
        (isClass(o) ? '' : '<div><span class="muted">Tax (' + o.taxRate + '%)</span><span>' + money(inv.tax) + '</span></div>') +
        (o.fulfillment === 'delivery' ? '<div><span class="muted">Drop-off</span><span>' + money(inv.fee) + '</span></div>' : '') +
        (inv.credit ? '<div><span class="muted">Gift card ' + esc(o.promoCode) + '</span><span>−' + money(inv.credit) + '</span></div>' : '') +
        '<div><strong>' + (isClass(o) ? 'Total' : 'Invoice total') + '</strong><strong>' + money(inv.total) + '</strong></div>' +
      '</div>' +
      (inv.note ? '<div class="rv-quote" style="margin-top:12px">Your note: “' + esc(inv.note) + '”</div>' : '') +
      (isClass(o) ? '<p class="hint" style="margin-top:12px">Booked ' + esc(new Date(o.createdAt).toLocaleString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })) + '. Booking email: <strong>' + esc(o.emailStatus) + '</strong></p>'
        : '<p class="hint" style="margin-top:12px">Approved ' + esc(new Date(inv.sentAt).toLocaleString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })) +
          (inv.changed ? ' with changes' : ' as requested') + '. Confirmation email to ' + esc(o.customer.email) + ': <strong>' + esc(inv.emailStatus || '') + '</strong></p>') +
      paymentHtml(o);
  }

  // Where the money is: the QuickBooks invoice (cookies) or the Square checkout (classes).
  function paymentHtml(o) {
    const inv = o.invoice;
    if (isClass(o)) {
      if (!inv.square) return '';
      const sqMsg = {
        'Awaiting payment': 'Waiting for the customer to pay in Square. The spot is held ' + (Number(cfg.classHoldMinutes) || 30) + ' minutes from booking, then released.',
        'Expired': 'Not paid in time, so the spot was released. If they pay late, it’s confirmed automatically and you get a “late payment” email.',
        'Paid': 'Paid through Square.'
      }[o.status] || 'Square checkout for this booking: ' + o.status + '.';
      return '<h3 class="rv-h">Payment</h3><p class="hint">' + sqMsg + '</p>';
    }
    const qb = inv.qb;
    if (qb) {
      return '<h3 class="rv-h">QuickBooks</h3>' +
        '<p class="hint">Invoice <strong>#' + esc(qb.docNumber || qb.id) + '</strong>: ' + money(qb.total) + (qb.voided ? ', voided when the order was cancelled' : qb.balance > 0 ? ', ' + money(qb.balance) + ' still due' : ', paid in full') + '.' +
          (qb.env === 'sandbox' ? ' (Sandbox: test money.)' : '') + ' <a href="' + esc(qb.url) + '" target="_blank" rel="noopener">Open in QuickBooks</a>' +
          (qb.link ? ' · <a href="' + esc(qb.link) + '" target="_blank" rel="noopener">Customer pay page</a>' : '') + '</p>' +
        (inv.qbMismatch ? '<p class="err">QuickBooks worked out ' + money(qb.total) + ' but the site said ' + money(inv.total) + '. Check the sales tax settings in QuickBooks; the customer pays the QuickBooks amount.</p>' : '') +
        (!qb.link ? '<p class="hint">No online Pay button: QuickBooks Payments may not be turned on, so QuickBooks emailed the invoice' + (/^FAILED/.test(qb.sent || '') ? ' (that failed: ' + esc(qb.sent) + ')' : '') + '.</p>' : '');
    }
    if (inv.qbError) {
      return '<h3 class="rv-h">QuickBooks</h3><p class="err">The invoice wasn’t created: ' + esc(inv.qbError) + '</p>' +
        '<button type="button" class="btn ghost small" data-rv="retry-qb">Try QuickBooks again</button>';
    }
    return '';
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
        bodyHtml += invoiceSummary(o);
        if (!isClass(o)) foot = '<button type="button" class="btn ghost block" data-rv="resend">Resend the confirmation email</button>';
      } else if (st === 'Declined') {
        bodyHtml += '<h3 class="rv-h">Declined</h3>' + (o.declineNote ? '<div class="rv-quote">“' + esc(o.declineNote) + '”</div>' : '<p class="hint">No note was included.</p>');
      }
      bodyHtml += messageHtml(o);
      review.innerHTML = head + '<div class="panel-body">' + bodyHtml + '</div>' + (foot ? '<div class="panel-foot">' + foot + '</div>' : '');
      loadPhotos(review);
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
      '<p class="hint" style="margin:-6px 0 10px">Starts from what they ordered' + (o.discount ? ', with their promo code as a discount line' : '') + '. Change prices or quantities, or add a line for extras or a discount (use a negative price).</p>' +
      rows +
      '<button type="button" class="btn dashed small" data-rv="add-line" style="margin-top:6px">+ Add a line</button>' +
      (o.fulfillment === 'delivery'
        ? '<div class="field" style="margin-top:16px;max-width:200px"><label class="label" for="inv-fee">Drop-off fee</label><div class="input-wrap"><span>$</span><input id="inv-fee" type="number" min="0" step="1" data-inv="fee" value="' + rv.fee + '"></div></div>'
        : '') +
      '<div class="totals" style="margin-top:16px">' +
        '<div><span class="muted">Subtotal</span><span id="inv-sub"></span></div>' +
        '<div><span class="muted">Tax (' + o.taxRate + '%)</span><span id="inv-tax"></span></div>' +
        (o.fulfillment === 'delivery' ? '<div><span class="muted">Drop-off</span><span id="inv-feeval"></span></div>' : '') +
        (o.giftCredit ? '<div><span class="muted">Gift card ' + esc(o.promoCode) + ' (estimate)</span><span id="inv-gift"></span></div>' : '') +
      '</div>' +
      '<div class="field" style="margin-top:18px"><label class="label" for="inv-note">Note to the customer <span class="muted" style="font-weight:400" id="note-hint">(optional)</span></label>' +
        '<textarea class="input" id="inv-note" rows="3" data-inv="note" placeholder="e.g. Can’t wait to make these! I added $1 per cookie for the hand-painted details.">' + esc(rv.note) + '</textarea></div>' +
      messageHtml(o);
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
    loadPhotos(review);
    updateReviewTotals();
  }

  function updateReviewTotals() {
    if (!rv || rv.declining) return;
    const review = $('#review');
    const o = orders.find((x) => x.number === rv.number);
    if (o.status !== 'Pending review') return;
    const t = SN.invoiceTotals(rv.lines, rv.fee, o.taxRate, o.giftCredit);
    rv.lines.forEach((l, j) => { const el = $('[data-amt="' + j + '"]', review); if (el) el.textContent = money((Number(l.qty) || 0) * (Number(l.unit) || 0)); });
    $('#inv-sub').textContent = money(t.subtotal);
    $('#inv-tax').textContent = money(t.tax);
    if ($('#inv-feeval')) $('#inv-feeval').textContent = money(t.fee);
    if ($('#inv-gift')) $('#inv-gift').textContent = '−' + money(t.credit);
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
    if (k === 'message') { rv.message = t.value; return; }
    if (k === 'declineNote') { rv.declineNote = t.value; return; }
    if (k === 'fee') { rv.fee = t.value === '' ? 0 : parseFloat(t.value); updateReviewTotals(); return; }
    rv.lines[Number(t.dataset.j)][k] = k === 'desc' ? t.value : (t.value === '' ? 0 : parseFloat(t.value));
    updateReviewTotals();
  }

  // Swap an updated order into the list and redraw.
  function replaceOrder(o, counts) {
    const i = orders.findIndex((x) => x.number === o.number);
    if (i !== -1) orders[i] = o;
    if (counts) weekCounts = counts;
    renderOrders();
    renderBusyDays();
    renderDashboard();
    if (rv && rv.number === o.number) renderReview();
  }

  async function onReviewClick(b) {
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
      case 'date-edit': rv.editingDate = true; renderReview(); $('#rv-date').focus(); break;
      case 'date-cancel': rv.editingDate = false; renderReview(); break;
      case 'date-save': {
        const d = $('#rv-date').value;
        if (!d) { toast('Pick a date first.'); return; }
        if (d === o.dateNeeded) { rv.editingDate = false; renderReview(); return; }
        if ((cfg.blockedRanges || []).some((r) => d >= r.start && d <= r.end) && !(await ask({ title: 'That date is blocked', text: SN.prettyDate(d) + ' is in one of your blocked date ranges. Use it anyway?', yes: 'Use this date', no: 'Pick another' }))) return;
        if (busy) return;
        busy = true; b.textContent = 'Saving…';
        server('adminChangeDate', o.number, d, $('#rv-date-notify').checked, $('#rv-date-note').value.trim()).then((r) => {
          busy = false;
          if (!r.ok) { toast(r.error); renderReview(); return; }
          rv.editingDate = false;
          replaceOrder(r.order, r.weekCounts);
          toast('Date changed to ' + SN.prettyDate(d) + (r.emailStatus ? '. Email to customer: ' + r.emailStatus : '.'), 5000);
        }).catch(failed);
        break;
      }
      case 'send-msg': {
        const text = rv.message.trim();
        if (!text) { toast('Write a message first.'); $('#rv-msg').focus(); return; }
        if (busy) return;
        busy = true; b.textContent = 'Sending…';
        server('adminMessageCustomer', o.number, text).then((r) => {
          busy = false;
          if (!r.ok) { toast(r.error); renderReview(); return; }
          rv.message = '';
          replaceOrder(r.order);
          toast('Message to ' + o.customer.email + ': ' + r.emailStatus, 5000);
        }).catch(failed);
        break;
      }
      case 'decline-send':
        if (busy) return;
        busy = true; b.textContent = 'Sending…';
        server('adminDecline', o.number, rv.declineNote.trim()).then((r) => {
          busy = false;
          if (!r.ok) { toast(r.error); renderReview(); return; }
          rv.declining = false;
          replaceOrder(r.order, r.weekCounts);
          toast(o.number + ' declined. Email to customer: ' + r.emailStatus, 5000);
        }).catch(failed);
        break;
      case 'approve': {
        const err = $('#inv-err');
        const bad = rv.lines.find((l) => !String(l.desc).trim() || !(Number(l.qty) > 0));
        if (!rv.lines.length || bad) { err.hidden = false; err.textContent = 'Every invoice line needs a description and a quantity.'; return; }
        const t = SN.invoiceTotals(rv.lines, rv.fee, o.taxRate);
        if (t.total <= 0) { err.hidden = false; err.textContent = 'The invoice total has to be more than $0.'; return; }
        const wk = weekInfo(o);
        if (wk.over && !(await ask({ title: 'Over that week’s limit', text: 'Approving puts that week over your limit (' + wk.over + '). Approve anyway?', yes: 'Approve anyway', no: 'Not yet' }))) return;
        if (busy) return;
        busy = true; b.textContent = 'Approving and sending…';
        server('adminApprove', o.number, { lines: rv.lines, fee: rv.fee, note: rv.note.trim() }).then((r) => {
          busy = false;
          if (!r.ok) { err.hidden = false; err.textContent = r.error; updateReviewTotals(); return; }
          replaceOrder(r.order, r.weekCounts);
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
          replaceOrder(r.order, r.weekCounts);
          toast('Confirmation email: ' + r.order.invoice.emailStatus);
        }).catch(failed);
        break;
      case 'retry-qb':
        if (busy) return;
        busy = true; b.textContent = 'Sending to QuickBooks…';
        server('adminRetryInvoice', o.number).then((r) => {
          busy = false;
          if (r.order) replaceOrder(r.order, r.weekCounts);
          if (!r.ok) { toast(r.error, 8000); renderReview(); return; }
          toast('QuickBooks invoice created and the confirmation emailed again, with the Pay button');
        }).catch(failed);
        break;
      default:
    }
  }

  /* ---------- Payments: QuickBooks (cookie invoices) and Square (class checkout) ---------- */
  let payInfo = null;       // from adminPayments; loaded the first time the tab opens (it calls QuickBooks and Square)
  function sectionPayments() {
    return card('payments', 'Payments', 'Approving a cookie order creates its invoice in <strong>QuickBooks</strong>; the confirmation email has its Pay button. Class bookings pay at checkout through <strong>Square</strong>. Every 5 minutes the site checks both and marks orders <strong>Paid</strong>.',
      '<div id="pay-box"><p class="muted">Loading…</p></div>');
  }
  function loadPayments() {
    $('#pay-box').innerHTML = '<p class="muted">Checking QuickBooks and Square…</p>';
    return server('adminPayments').then((d) => { payInfo = d; renderPayments(); }).catch((err) => {
      $('#pay-box').innerHTML = '<p class="err">Couldn’t check payments: ' + esc(err && err.message ? err.message : err) + '</p><button type="button" class="btn ghost small" data-pay="refresh">Try again</button>';
    });
  }
  function renderPayments() {
    const p = payInfo;
    const when = (iso) => new Date(iso).toLocaleString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
    const env = (e) => '<span class="status-badge" style="' + (e === 'production' ? 'background:#DDEFE3;color:#1E5A35' : 'background:#FDF0D5;color:#7A4B00') + '">' + (e === 'production' ? 'Live' : 'Sandbox (test money)') + '</span>';
    const qb = p.qb;
    const qbBody = !qb.keys
      ? '<p class="muted">Not set up yet: add <code>QBO_CLIENT_ID</code> and <code>QBO_CLIENT_SECRET</code> in Apps Script → Project Settings → Script Properties.</p>'
      : qb.connected
        ? '<p>Connected to <strong>' + esc(qb.company || 'your company') + '</strong>.</p>' +
          (qb.items ? '<p class="hint">Invoice items are ready: Custom Cookies, Artisan Cookies, Drop-off Fee, Promo Discount, Gift Card Credit.</p>' : '<p class="hint">Invoice items aren’t set up yet.</p>') +
          '<div class="row-gap" style="gap:8px;margin-top:10px"><button type="button" class="btn ghost small" data-pay="items">' + (qb.items ? 'Re-check invoice items' : 'Set up invoice items') + '</button>' +
          '<button type="button" class="btn ghost small" data-pay="disconnect">Disconnect</button></div>'
        : '<p class="muted">' + (qb.error ? 'Not connected (' + esc(qb.error) + ').' : 'Not connected yet.') + '</p>' +
          '<div class="row-gap" style="gap:8px;margin-top:10px"><button type="button" class="btn small" data-pay="connect">Connect QuickBooks</button></div>' +
          (qb.idHint ? '<p class="hint">Client ID in use: <code>' + esc(qb.idHint) + '</code>, secret ' + qb.secretLength + ' characters. These should match the ' + (qb.env === 'production' ? 'Production' : 'Development') + ' keys on the Intuit app’s Keys &amp; credentials page.</p>' : '') +
          '<p class="hint">Opens Intuit’s sign-in in a new tab. Pick the company, approve, then come back and click Refresh. If Intuit says the redirect URI is wrong, add this one in the Intuit app’s Keys &amp; credentials: <code style="word-break:break-all">' + esc(p.callbackUrl) + '</code></p>';
    const sq = p.square;
    const sqBody = !sq.ready
      ? '<p class="muted">Not set up yet: add <code>SQUARE_ACCESS_TOKEN</code> and <code>SQUARE_LOCATION_ID</code> in Script Properties. Until then, class bookings are confirmed right away and you collect payment yourself.</p>'
      : sq.error
        ? '<p class="err">Square didn’t accept the keys: ' + esc(sq.error) + '</p>'
        : '<p>Connected' + (sq.location ? ' to <strong>' + esc(sq.location) + '</strong>' : '') + '. Class bookings go to Square checkout and hold the spot for ' + (Number(cfg.classHoldMinutes) || 30) + ' minutes.</p>';
    const lc = p.lastCheck;
    const last = lc
      ? 'Last check ' + when(lc.at) + ': ' + [lc.invoicesPaid.length ? lc.invoicesPaid.length + ' invoice' + (lc.invoicesPaid.length > 1 ? 's' : '') + ' paid' : '',
          lc.classesPaid.length ? lc.classesPaid.length + ' class booking' + (lc.classesPaid.length > 1 ? 's' : '') + ' paid' : '',
          lc.expired.length ? lc.expired.length + ' expired' : ''].filter(Boolean).join(', ').replace(/^$/, 'nothing new') + '.' +
        (lc.errors.length ? ' <span class="err">' + esc(lc.errors.join(' · ')) + '</span>' : '')
      : 'No check has run yet.';
    $('#pay-box').innerHTML =
      (p.setupNeeded ? '<p class="err" style="margin-bottom:14px"><strong>The Sheet needs updating:</strong> some tabs or columns from a recent update are missing, so parts of payments can’t save. In the Apps Script editor, run <strong>setupSheet</strong> once (it only adds what’s missing).</p>' : '') +
      '<div class="fields">' +
        '<div class="field"><h3 class="rv-h" style="margin-top:0">QuickBooks ' + (qb.keys ? env(qb.env) : '') + '</h3>' + qbBody + '</div>' +
        '<div class="field"><h3 class="rv-h" style="margin-top:0">Square ' + (sq.ready ? env(sq.env) : '') + '</h3>' + sqBody + '</div>' +
      '</div>' +
      '<h3 class="rv-h">Payment check</h3>' +
      '<p>' + (p.trigger ? 'Runs every 5 minutes.' : '<span class="err">Not scheduled. Click Check now to schedule it.</span>') + ' ' + last + '</p>' +
      '<div class="row-gap" style="gap:8px;margin-top:10px"><button type="button" class="btn ghost small" data-pay="check">Check now</button><button type="button" class="btn ghost small" data-pay="refresh">Refresh</button></div>';
  }
  async function onPayClick(b) {
    const act = b.dataset.pay;
    if (busy) return;
    if (act === 'refresh') { loadPayments(); return; }
    if (act === 'connect') {
      // Open the tab now (pop-up blockers allow it during the click), then point it at Intuit.
      const w = window.open('', '_blank');
      server('adminQbConnectUrl').then((url) => { if (w) w.location.href = url; else window.open(url, '_blank'); })
        .catch((err) => { if (w) w.close(); failed(err); });
      return;
    }
    if (act === 'disconnect' && !(await ask({ title: 'Disconnect QuickBooks?', text: 'Approved orders won’t get QuickBooks invoices until you connect again.', yes: 'Disconnect', no: 'Stay connected', danger: true }))) return;
    const fn = { items: 'adminQbSetupItems', disconnect: 'adminQbDisconnect', check: 'adminCheckPaymentsNow' }[act];
    if (!fn) return;
    busy = true;
    b.textContent = 'Working…';
    server(fn).then((r) => {
      busy = false;
      if (act === 'check') {
        if (!r.ok) toast(r.error);
        else toast('Checked: ' + (r.invoicesPaid.length + r.classesPaid.length) + ' newly paid, ' + r.expired.length + ' expired' + (r.errors.length ? '. Problems: ' + r.errors.join(' · ') : ''), r.errors.length ? 8000 : 3600);
        refreshOrders().catch((err) => toast('Checked, but the orders list didn’t reload (' + (err && err.message ? err.message : err) + '). Click Refresh on the Dashboard.', 8000));
      }
      if (act === 'items') toast('Invoice items are ready in QuickBooks');
      return loadPayments();
    }).catch(failed);
  }

  /* ---------- Promo & gift codes (saved right away, not with the other settings) ---------- */
  let editingCode = null;   // original code name while editing
  function renderCodes() {
    $('#codes-body').innerHTML = codes.length ? codes.map((c) =>
      '<tr' + (c.active ? '' : ' style="opacity:.6"') + '>' +
        '<td class="nowrap"><strong>' + esc(c.code) + '</strong>' + (c.note ? '<br><span class="muted" style="font-size:12px">' + esc(c.note) + '</span>' : '') + '</td>' +
        '<td>' + esc(c.type) + '</td>' +
        '<td class="nowrap">' + (c.type === 'Gift card' ? money(c.balance) + ' left<br><span class="muted" style="font-size:12px">of ' + money(c.amount) + '</span>' : c.amount + '% off') + '</td>' +
        '<td>' + c.uses + (c.maxUses ? ' of ' + c.maxUses : '') + '</td>' +
        '<td class="nowrap">' + (c.expires ? esc(SN.prettyDate(c.expires, { month: 'short', day: 'numeric', year: 'numeric' })) : '—') + '</td>' +
        '<td><button type="button" class="switch" role="switch" aria-checked="' + c.active + '" data-code-act="toggle" data-code="' + esc(c.code) + '" aria-label="' + esc(c.code) + ' active"><span class="track" aria-hidden="true"></span>' + (c.active ? 'On' : 'Off') + '</button></td>' +
        '<td class="nowrap"><button type="button" class="btn ghost small" data-code-act="edit" data-code="' + esc(c.code) + '">Edit</button> ' +
          '<button type="button" class="icon-del" data-code-act="delete" data-code="' + esc(c.code) + '" aria-label="Delete ' + esc(c.code) + '">' + SN_ICONS.trash + '</button></td>' +
      '</tr>').join('') : '<tr class="empty-row"><td colspan="7">No codes yet. Add one below.</td></tr>';
  }
  function codeFormType() {
    const gift = $('#cf-type').value === 'Gift card';
    $('#cf-amount-label').textContent = gift ? 'Gift card amount' : 'Percent off';
    $('#cf-amount-pre').hidden = !gift;
    $('#cf-amount-post').hidden = gift;
    $('#cf-balance-wrap').hidden = !(gift && editingCode);
  }
  function fillCodeForm(c) {
    editingCode = c ? c.code : null;
    $('#code-form-h').textContent = c ? 'Edit ' + c.code : 'Add a code';
    $('#cf-type').value = c ? c.type : 'Percent off';
    $('#cf-code').value = c ? c.code : '';
    $('#cf-amount').value = c ? c.amount : '';
    $('#cf-balance').value = c ? c.balance : '';
    $('#cf-expires').value = c ? c.expires : '';
    $('#cf-max').value = c && c.maxUses ? c.maxUses : '';
    $('#cf-note').value = c ? c.note : '';
    $('#cf-cancel').hidden = !c;
    $('#cf-err').hidden = true;
    codeFormType();
  }
  function saveCode(c, original) {
    if (busy) return Promise.resolve();
    busy = true;
    return server('adminSaveCode', c, original || '').then((r) => {
      busy = false;
      if (!r.ok) { $('#cf-err').textContent = r.error; $('#cf-err').hidden = false; toast(r.error); return; }
      codes = r.codes;
      renderCodes();
      return true;
    }).catch(failed);
  }
  async function onCodeClick(b) {
    const c = codes.find((x) => x.code === b.dataset.code);
    if (!c) return;
    if (b.dataset.codeAct === 'edit') { fillCodeForm(c); $('#code-form-h').scrollIntoView({ block: 'start' }); $('#cf-amount').focus(); }
    if (b.dataset.codeAct === 'toggle') saveCode(Object.assign({}, c, { active: !c.active }), c.code).then((ok) => { if (ok) toast(c.code + (c.active ? ' turned off' : ' turned on')); });
    if (b.dataset.codeAct === 'delete') {
      if (!(await ask({
        title: 'Delete ' + c.code + '?', danger: true, yes: 'Delete', no: 'Keep it',
        text: c.type === 'Gift card' && c.balance > 0 ? 'It still has ' + money(c.balance) + ' on it. To stop it working for now, turn it off instead.' : 'Customers won’t be able to use it anymore.'
      }))) return;
      server('adminDeleteCode', c.code).then((r) => { codes = r.codes; renderCodes(); if (editingCode === c.code) fillCodeForm(null); toast(c.code + ' deleted'); }).catch(failed);
    }
  }
  function onCodeSubmit(e) {
    e.preventDefault();
    const c = {
      code: $('#cf-code').value.trim().toUpperCase(), type: $('#cf-type').value, amount: $('#cf-amount').value,
      balance: $('#cf-balance').value, expires: $('#cf-expires').value, maxUses: $('#cf-max').value, note: $('#cf-note').value.trim(),
      active: editingCode ? (codes.find((x) => x.code === editingCode) || {}).active !== false : true
    };
    $('#cf-save').textContent = 'Saving…';
    saveCode(c, editingCode).then((ok) => {
      $('#cf-save').textContent = 'Save code';
      if (ok) { toast(c.code + ' saved'); fillCodeForm(null); }
    });
  }
  // A gift card code that's hard to guess, e.g. GIFT-7K3Q-M9XD
  function makeCode() {
    const abc = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
    const part = () => Array.from({ length: 4 }, () => abc[Math.floor(Math.random() * abc.length)]).join('');
    return ($('#cf-type').value === 'Gift card' ? 'GIFT-' : 'PROMO-') + part() + '-' + part();
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
  // Blocked ranges you set, plus (read-only) weeks that filled up from approved orders.
  function renderBlocked() {
    const fmt = (d) => SN.prettyDate(d, { weekday: 'short', month: 'short', day: 'numeric', year: 'numeric' });
    const mine = (cfg.blockedRanges || []).slice().sort((a, b) => (a.start < b.start ? -1 : 1));
    const c = caps();
    const thisWeek = SN.mondayOf(SN.isoDate(new Date()));
    const full = Object.keys(weekCounts).filter((w) => w >= thisWeek).sort().map((w) => ({
      w, kinds: ['custom', 'artisan'].filter((k) => c[k] && weekCounts[w][k].approved >= c[k])
    })).filter((x) => x.kinds.length);
    $('#blocked').innerHTML = (mine.map((r, i) =>
      '<div class="row-gap" style="gap:8px;align-items:center"><span class="chip">' + esc(fmt(r.start)) + (r.end && r.end !== r.start ? ' – ' + esc(fmt(r.end)) : '') +
        (r.note ? ' · ' + esc(r.note) : '') +
        '<button type="button" data-act="del-block" data-i="' + i + '" aria-label="Unblock ' + esc(r.start) + '">' + SN_ICONS.close + '</button></span></div>').join('') +
      full.map((x) => {
        const sun = new Date(x.w + 'T12:00'); sun.setDate(sun.getDate() + 6);
        return '<div class="row-gap" style="gap:8px;align-items:center"><span class="chip" style="background:#FBEDEA">' + esc(fmt(x.w)) + ' – ' + esc(fmt(SN.isoDate(sun))) +
          ' · Full: ' + x.kinds.join(' and ') + ' (automatic)</span></div>';
      }).join('')) || '<span class="hint">No blocked dates.</span>';
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
          field(id('date'), 'Date', '<input class="input" id="' + id('date') + '" type="date" ' + attrs('date') + ' value="' + esc(ev.date) + '">') +
          field(id('address'), 'Address', '<input class="input" id="' + id('address') + '" type="text" ' + attrs('address') + ' value="' + esc(ev.address) + '" placeholder="e.g. 123 Main St, Rosemont">') +
          field(id('start'), 'Start time', '<input class="input" id="' + id('start') + '" type="text" ' + attrs('start') + ' value="' + esc(ev.start) + '" placeholder="e.g. 2:00 PM">') +
          field(id('end'), 'End time', '<input class="input" id="' + id('end') + '" type="text" ' + attrs('end') + ' value="' + esc(ev.end) + '" placeholder="e.g. 4:00 PM">') +
          field(id('price'), 'Price per person', '<div class="input-wrap"><span>$</span><input id="' + id('price') + '" type="number" min="0" step="1" ' + attrs('price') + ' value="' + esc(ev.price) + '"></div>') +
          field(id('max'), 'Max attendees', '<input class="input" id="' + id('max') + '" type="number" min="1" ' + attrs('max') + ' value="' + esc(ev.max) + '" placeholder="No limit">',
            ev.button === 'Add to bag' && ev.max !== '' && ev.max != null ? (ev.booked || 0) + ' booked, ' + Math.max(0, ev.max - (ev.booked || 0)) + ' spots left' : (ev.booked ? ev.booked + ' booked' : '')) +
        '</div>' +
        field(id('when'), 'Small text above the title (optional)', '<input class="input" id="' + id('when') + '" type="text" ' + attrs('when') + ' value="' + esc(ev.when) + '" placeholder="e.g. Holiday special">', 'Leave blank to show the date and time there instead.') +
        field(id('desc'), 'Description', '<textarea class="input" id="' + id('desc') + '" rows="3" ' + attrs('desc') + '>' + esc(ev.desc) + '</textarea>') +
        photoField(id('photo'), 'Photo', attrs('photo') + ' value="' + esc(ev.photo) + '"') +
        field(id('button'), 'Button', '<select class="input" id="' + id('button') + '" ' + attrs('button') + '>' +
          ['Add to bag', 'Order now', 'Message me', 'None'].map((b) => '<option' + (b === ev.button ? ' selected' : '') + '>' + b + '</option>').join('') + '</select>',
          ev.button === 'Add to bag' ? (Number(ev.price) > 0 ? 'Customers book and pay at checkout; no approval needed.' : 'Add a price so customers can book it.') : '') +
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

  async function onListClick(b) {
    const i = Number(b.dataset.i);
    const list = b.dataset.list;
    switch (b.dataset.act) {
      case 'special': cfg.flavors[i].special = !cfg.flavors[i].special; renderFlavors(); break;
      case 'toggle-flavor': cfg.flavors[i].on = !cfg.flavors[i].on; renderFlavors(); break;
      case 'del-flavor':
        if (!(await ask({ title: 'Delete ' + cfg.flavors[i].name + '?', text: 'To take it off the menu for now, use Hidden instead.', yes: 'Delete', no: 'Keep it', danger: true }))) return;
        cfg.flavors.splice(i, 1); renderFlavors(); break;
      case 'del-block': cfg.blockedRanges.splice(i, 1); renderBlocked(); break;
      case 'toggle-page': cfg[b.dataset.key] = cfg[b.dataset.key] === false; fillFields(); break;
      case 'toggle-maint': cfg.maintenanceMode = !cfg.maintenanceMode; fillFields(); break;
      case 'add-zone': cfg.zones.push({ zip: '', area: '', fee: 5 }); renderZones(); $('#zz-' + (cfg.zones.length - 1)).focus(); break;
      case 'del-zone': cfg.zones.splice(i, 1); renderZones(); break;
      case 'add-faq': cfg.faqs.push({ q: '', a: '' }); renderFaqs(); $('#fq-' + (cfg.faqs.length - 1)).focus(); break;
      case 'add-event':
        cfg.events.push({ id: 'e' + Date.now().toString(36), show: true, photo: '', when: '', title: '', date: '', start: '', end: '', address: '', price: '', max: '', desc: '', button: 'Add to bag' });
        renderEvents(); $('#ev-title-' + (cfg.events.length - 1)).focus(); break;
      case 'add-photo': cfg.gallery.push({ show: true, photo: '', caption: '' }); renderGallery(); $('#gp-' + (cfg.gallery.length - 1)).focus(); break;
      case 'toggle-show': cfg[list][i].show = cfg[list][i].show === false; RENDER_LIST[list](); break;
      case 'del-item': {
        const it = cfg[list][i];
        const filled = list === 'faqs' ? (it.q || it.a) : list === 'events' ? it.title : it.photo;
        if (filled && !(await ask({ title: 'Delete this ' + (list === 'faqs' ? 'question' : list === 'events' ? 'event' : 'photo') + '?', text: 'It comes off the website when you save.', yes: 'Delete', no: 'Keep it', danger: true }))) return;
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
        customerPhoto(m, 'Their photo') +
        '<div class="row-gap" style="margin-top:6px;gap:8px">' +
          '<a class="btn small" href="mailto:' + esc(m.email) + '?subject=' + subject + '" data-msg="reply" data-id="' + m.id + '">Reply by email</a>' +
          '<button type="button" class="btn ghost small" data-msg="toggle" data-id="' + m.id + '">' + (m.status === 'New' ? 'Mark replied' : 'Mark as new') + '</button>' +
          '<button type="button" class="icon-del" data-msg="delete" data-id="' + m.id + '" aria-label="Delete message from ' + esc(m.name || m.email) + '">' + SN_ICONS.trash + '</button>' +
        '</div></div>';
    }).join('') : '<p class="hint">No messages yet.</p>';
    loadPhotos($('#msg-list'));
  }
  async function onMessageClick(b) {
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
      if (!(await ask({ title: 'Delete this message?', text: 'It’s also removed from the Sheet. (The copy in your email inbox stays.)', yes: 'Delete', no: 'Keep it', danger: true }))) return;
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
    c.events = c.events.filter((e) => (e.title || '').trim()).map((e) => { delete e.booked; delete e.spotsLeft; return e; });
    c.gallery = c.gallery.filter((g) => (g.photo || '').trim());
    delete c.weekCounts;   // booking counts come from orders, not settings
    delete c.images;
    return c;
  }
  async function save(force) {
    if (busy) return;
    const c = cleaned();
    if (cfg.maintenanceMode && !String(cfg.maintenancePassword || '').trim()) {
      location.hash = 'pages';
      toast('Maintenance mode needs a password, or no one (including you) could get into the site. Add one on the Website pages tab.', 7000);
      $('#maintenancePassword').focus();
      return;
    }
    const badZip = cfg.zones.find((z) => z.zip && !/^\d{5}$/.test(z.zip));
    if (badZip && !(await ask({ title: 'Check that ZIP code', text: 'ZIP “' + badZip.zip + '” isn’t 5 digits, so it won’t be saved. Save everything else anyway?', yes: 'Save anyway', no: 'Fix it first' }))) return;
    busy = true;
    $$('[data-save]').forEach((b) => { b.textContent = 'Saving…'; });
    server('adminSaveSettings', c, stamp, !!force).then((r) => {
      busy = false;
      $$('[data-save]').forEach((b) => { b.textContent = 'Save changes'; });
      if (r.conflict) {
        ask({
          title: 'The Sheet changed',
          text: 'Someone changed the settings directly in the Google Sheet since you opened this page.',
          points: ['Save mine: your version replaces those Sheet changes.', 'Keep editing: nothing is saved. To see the Sheet’s version, reload this page (your unsaved edits here would be lost).'],
          yes: 'Save mine', no: 'Keep editing'
        }).then((ok) => { if (ok) save(true); });
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
      const db = e.target.closest('[data-dash], [data-dash-open]');
      if (db) { onDashClick(db); return; }
      const pb = e.target.closest('[data-pay]');
      if (pb) { onPayClick(pb); return; }
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
      const start = $('#new-block').value;
      let end = $('#new-block-end').value;
      if (!start) { $('#new-block').focus(); return; }
      if (end && end < start) { toast('"To" is before "From". Pick a later end date.'); return; }
      if (!end) end = start;
      cfg.blockedRanges = (cfg.blockedRanges || []).concat([{ start, end, note: $('#new-block-note').value.trim() }]);
      $('#new-block').value = ''; $('#new-block-end').value = ''; $('#new-block-note').value = '';
      renderBlocked();
      markDirty();
    });
    // Promo & gift codes save straight to the Sheet.
    $('#codes-body').addEventListener('click', (e) => { const b = e.target.closest('[data-code-act]'); if (b) onCodeClick(b); });
    $('#code-form').addEventListener('submit', onCodeSubmit);
    $('#cf-type').addEventListener('change', codeFormType);
    $('#cf-generate').addEventListener('click', () => { $('#cf-code').value = makeCode(); });
    $('#cf-cancel').addEventListener('click', () => fillCodeForm(null));
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
      sortOrders();
      messages = d.messages;
      codes = d.codes || [];
      weekCounts = d.weekCounts || {};
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
      renderCodes();
      fillCodeForm(null);
      dashRefreshed = new Date();
      renderDashboard();
    });
  }
  load().catch((err) => {
    app.innerHTML = '<div class="wrap" style="padding:40px 0"><h1>Couldn\'t load the admin</h1><p class="muted">' + esc(err && err.message ? err.message : String(err)) + '</p><p><a class="btn" href="" target="_self">Try again</a></p></div>';
  });
})();
