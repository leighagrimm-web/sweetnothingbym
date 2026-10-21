/*
 * Sweet Nothings by M - Apps Script backend (bound to the Google Sheet).
 * Paste this whole file into Extensions > Apps Script > Code.gs. See apps-script/README.md.
 */

/* ============================== Api ============================== */

/*
 * Public web app (Execute as: me, Access: Anyone).
 *
 *   GET  ?action=config             live settings for the website
 *   GET  ?action=config&preview=1   the admin's unsaved draft (Draft tab), if there is one
 *   POST {"action":"submitOrder", ...}
 *   POST {"action":"sendMessage", ...}
 *
 * The site POSTs with Content-Type text/plain and a JSON string body so the browser skips the CORS preflight.
 */

function doGet(e) {
  const p = (e && e.parameter) || {};
  try {
    if (p.action === 'config') {
      const live = getConfig_();
      if (p.preview === '1') {
        const draft = getDraft_();
        return json_({ ok: true, preview: true, hasDraft: !!draft, config: publicConfig_(Object.assign({}, live, draft || {})) });
      }
      return json_({ ok: true, config: publicConfig_(live) });
    }
    if (p.action === 'ping') return json_({ ok: true, time: new Date().toISOString() });
    return json_({ ok: false, error: 'Unknown action.' });
  } catch (err) {
    console.error('doGet failed', err && err.stack || err);
    return json_({ ok: false, error: 'Something went wrong on our end.' });
  }
}

function doPost(e) {
  let body;
  try { body = JSON.parse((e && e.postData && e.postData.contents) || '{}'); } catch (err) { return json_({ ok: false, error: 'Bad request.' }); }
  try {
    // Spam trap: a hidden "website" field people never see. Bots fill it in; pretend it worked.
    if (body.website) return json_({ ok: true, ignored: true });
    if (body.action === 'submitOrder') return json_(submitOrder_(body));
    if (body.action === 'sendMessage') return json_(sendMessage_(body));
    return json_({ ok: false, error: 'Unknown action.' });
  } catch (err) {
    console.error('doPost failed', body && body.action, err && err.stack || err);
    return json_({ ok: false, error: 'Something went wrong on our end.' });
  }
}

function json_(x) {
  return ContentService.createTextOutput(JSON.stringify(x)).setMimeType(ContentService.MimeType.JSON);
}


/* ============================== Schema ============================== */

/*
 * Sheet schema + one-time setup.
 *
 * Run setupSheet() once from the Apps Script editor (it also asks for permissions).
 * It is safe to run again: it only creates tabs, headers and starter rows that are missing,
 * and never overwrites anything already in the Sheet.
 */

// Starter settings. Mirrors SN_DEFAULTS in the site's config.js (the site falls back to those if the API is down).
// type: how the value is read back (number | bool | text | date | json). Private settings are never sent to the website.
const SETTINGS_SPEC = [
  ['acceptingOrders', true, 'bool', 'TRUE to take orders. FALSE shows "not taking orders right now" on the order page.'],
  ['leadDays', 8, 'number', 'Minimum days between ordering and the date needed.'],
  ['maxOrdersPerDay', 3, 'number', 'Most orders per day (shown in admin).'],
  ['minQty', 12, 'number', 'Minimum cookies per item.'],
  ['maxDesigns', 6, 'number', 'Most custom designs a customer can pick.'],
  ['customBasePrice', 5, 'number', 'Custom cookies "starting at" price per cookie.'],
  ['customNote', 'Pricing may vary based on the complexity of the design and the number of different designs.', 'text', 'Note shown with custom cookies.'],
  ['miniPerDozen', 24, 'number', 'Mini Artisan price per dozen.'],
  ['largePerDozen', 36, 'number', 'Large Artisan price per dozen.'],
  ['flavorsPerDozen', 4, 'number', 'Most artisan flavors per dozen.'],
  ['specialText', 'Pumpkin Spice is back in the artisan lineup through the end of the month.', 'text', 'Monthly special message (leave blank for none).'],
  ['specialUntil', '2026-10-31', 'date', 'Last day to show the special (YYYY-MM-DD).'],
  ['taxRate', 2.25, 'number', 'Grocery tax percent, on cookies only (not drop-off).'],
  ['pickupCity', 'Rosemont, IL', 'text', 'Shown on the website.'],
  ['pickupAddress', '[Street address], Rosemont, IL', 'text', 'PRIVATE. Only sent in the confirmation email for pickup orders.'],
  ['pickupInstructions', '[Pickup instructions, e.g. pickup window, where to park, which door]', 'text', 'PRIVATE. Shown with the address in the confirmation email for pickup orders.'],
  ['instagram', 'https://www.instagram.com/sweet_nothings_by_m/', 'text', 'Instagram link.'],
  ['instagramHandle', '@sweet_nothings_by_m', 'text', 'Instagram name shown on the site.'],
  ['images', '{"custom":"","mini":"","large":""}', 'json', 'Menu photo paths (advanced).'],
  ['ownerEmail', '', 'text', 'PRIVATE. Where "new order" and "new message" alerts go. Blank = the Google account that runs this.'],
  ['replyToEmail', '', 'text', 'PRIVATE. Where customer replies go. Blank = ownerEmail.'],
  ['senderName', 'Sweet Nothings by M', 'text', 'PRIVATE. Name shown as the email sender.'],
  ['siteUrl', 'https://leighagrimm-web.github.io/sweetnothingbym/', 'text', 'PRIVATE. Website address, used for the logo and links in emails. End with /'],
  ['environment', 'UAT', 'text', 'PRIVATE. UAT or PROD. UAT adds [TEST] to email subjects.']
];
const PRIVATE_SETTINGS = ['pickupAddress', 'pickupInstructions','ownerEmail', 'replyToEmail', 'senderName', 'siteUrl', 'environment'];

const STARTER_FLAVORS = [
  ['cc', 'Chocolate Chip', true, false],
  ['ff', 'Funfetti', true, false],
  ['sd', 'Snickerdoodle', true, false],
  ['dc', 'Double Chocolate', true, false],
  ['ps', 'Pumpkin Spice', true, true],
  ['ls', 'Lemon Sugar', false, false]
];
const STARTER_ZONES = [
  ['60018', 'Rosemont / Des Plaines', 5],
  ['60016', 'Des Plaines', 5],
  ['60068', 'Park Ridge', 5],
  ['60656', 'Chicago (O’Hare)', 5],
  ['60007', 'Elk Grove Village', 10],
  ['60056', 'Mount Prospect', 10],
  ['60004', 'Arlington Heights', 10]
];
const STARTER_BLOCKED = [['2026-11-26', 'Thanksgiving'], ['2026-11-27', ''], ['2026-12-24', 'Christmas Eve'], ['2026-12-25', 'Christmas'], ['2026-12-26', '']];
const STARTER_FAQ = [
  ['What ingredients do you use?', 'I bake everything from scratch with [real butter, pure vanilla, unbleached flour, cane sugar, farm eggs]. Custom cookies are a [vanilla sugar cookie] decorated with [royal icing]. [Add any brands or sourcing you want to mention.]'],
  ['Can you make allergen-friendly cookies?', 'Yes! I’ve made [gluten-free, dairy-free and nut-free] cookies before. Just mention any allergies or dietary needs when you order (there’s a spot for it at checkout), or send me a message first. Please note my kitchen is not allergen-free, so I can’t guarantee against cross-contact for severe allergies.'],
  ['How far ahead should I order?', 'Please order at least 8 days before you need your cookies. Larger custom orders and busy seasons (holidays, graduation, wedding season) book up fast, so earlier is better.'],
  ['How does ordering work?', 'Choose your cookies and send your order request. You’ll get an email right away, but it’s not a final order yet. I’ll review the details and send a second email with your confirmation, final price and a QuickBooks invoice. Your date is reserved once the invoice is paid.'],
  ['How much do custom cookies cost?', 'Custom cookies start at $5 per cookie with a 1 dozen minimum. Pricing may vary based on the complexity of the design and the number of different designs. You’ll see an estimate when you order, and I’ll confirm the final price before you pay.'],
  ['Do you deliver?', 'Pickup is free in Rosemont, IL (exact address is in your confirmation). Local drop-off is available to nearby ZIP codes for $5–$10. You’ll see the fee for your ZIP at checkout.'],
  ['How do I pay?', 'Once I approve your order, you’ll get a QuickBooks invoice by email. You can pay securely by card or bank transfer.'],
  ['How should I store my cookies?', '[Cookies stay fresh for about X days at room temperature in an airtight container. Decorated cookies can be frozen for up to X months. Keep them out of direct sunlight and away from heat.]']
];

// Website wording and photos Melissa can change. Mirrors pages/events/gallery in SN_DEFAULTS (config.js).
// Photo cells take a link to an image (a Google Drive file shared "Anyone with the link" works), a file in the
// website repo (e.g. photos/hero.jpg), or [bracket text] to show a placeholder box. Blank = no photo.
// In text cells, a blank line starts a new paragraph (in Sheets, Alt+Enter adds a line inside a cell).
const STARTER_PAGES = [
  ['homeTitle', 'Handmade cookies for life’s sweetest moments', 'Home page: big heading'],
  ['homeIntro', 'Hand-decorated custom sets for birthdays, showers and celebrations, plus small-batch artisan favorites by the dozen.', 'Home page: text under the heading'],
  ['homeHeroPhoto', '[Hero photo of her cookies]', 'Home page: main photo (photo link)'],
  ['photoCustom', '', 'Custom Cookies photo on the Home and Order pages (photo link)'],
  ['photoMini', '', 'Mini Artisan photo on the Home and Order pages (photo link)'],
  ['photoLarge', '', 'Large Artisan photo on the Home and Order pages (photo link)'],
  ['aboutTitle', 'Hi, I\'m Melissa', 'About page: big heading'],
  ['aboutIntro', 'Sweet Nothings by M bakes custom decorated and artisan cookies for the moments worth celebrating.', 'About page: text under the heading'],
  ['aboutPhoto', '[Photo of M in the kitchen]', 'About page: photo (photo link)'],
  ['aboutStoryHeading', 'The story', 'About page: first section heading'],
  ['aboutStory', '[A few sentences in M\'s own words: how she started baking, what she loves about making cookies for people, and what makes Sweet Nothings special.]\n\n[What customers can expect: how custom orders work, how far ahead to book, and pickup in Rosemont or local drop-off.]', 'About page: first section text'],
  ['aboutGoodToKnowHeading', 'Good to know', 'About page: second section heading'],
  ['aboutGoodToKnow', '[Allergen note, e.g. "Cookies are made in a kitchen that also handles nuts, dairy, eggs and wheat."]\n\n[Storage tips: how long cookies stay fresh and how to keep them.]', 'About page: second section text'],
  ['eventsTitle', 'Classes, pop-ups & seasonal specials', 'Special Events page: big heading'],
  ['eventsIntro', 'Limited-time cookies and cookie decorating classes. Follow along on Instagram for the latest dates.', 'Special Events page: text under the heading'],
  ['galleryTitle', 'Past creations', 'Gallery page: big heading'],
  ['galleryIntro', 'A peek at cookies made for birthdays, showers, weddings and more. See the newest work on Instagram.', 'Gallery page: text under the heading']
];
const EVENT_BUTTONS = ['Order now', 'Message me', 'Sign up', 'None'];
// Show, Photo, When, Title, Description, Price, Button, Sign-up link
const STARTER_EVENTS = [
  [true, '[Class photo]', '[Date] · [Time]', '[Cookie decorating class]', '[What attendees will make, what\'s included, location, and how many spots are available.]', '[$ per person]', 'Sign up', ''],
  [true, '[Seasonal cookie photo]', '[Available dates]', '[Seasonal special]', '[Holiday or seasonal box description. Specials can also be added to the artisan menu from the admin page.]', '', 'Order now', ''],
  [true, '[Event photo]', '', 'Planning something bigger?', 'For weddings, corporate gifts or large events, start an order and describe what you have in mind, or send me a message.', '', 'Message me', '']
];
// Show, Photo, Caption. The first 4 shown also appear under "Recent creations" on the home page.
const STARTER_GALLERY = ['Birthday', 'Baby shower', 'Wedding shower', 'Anniversary', 'Holiday', 'Party', 'Artisan box', 'Custom set']
  .map((l) => [true, '[' + l + ' cookie photo]', l + ' cookies']);

// Tab layout. text: columns kept as plain text (so Sheets doesn't turn ZIPs, phones or dates into numbers).
const TABS = {
  Settings: { headers: ['Setting', 'Value', 'What it means'], widths: [170, 380, 460], text: ['Setting', 'Value'] },
  Flavors: { headers: ['ID', 'Flavor', 'Show on menu', 'Special'], widths: [60, 220, 120, 90], text: ['ID'] },
  Zones: { headers: ['ZIP', 'Area', 'Fee'], widths: [80, 240, 80], text: ['ZIP'], money: ['Fee'] },
  BlockedDates: { headers: ['Date', 'Note'], widths: [120, 260], text: ['Date'] },
  FAQ: { headers: ['Question', 'Answer'], widths: [300, 700] },
  Pages: { headers: ['Key', 'Text', 'Where it shows'], widths: [170, 560, 380], text: ['Key', 'Text'] },
  Events: { headers: ['Show', 'Photo', 'When', 'Title', 'Description', 'Price', 'Button', 'Sign-up link'], widths: [60, 220, 160, 220, 420, 120, 110, 220], text: ['Photo', 'When', 'Price', 'Sign-up link'] },
  Gallery: { headers: ['Show', 'Photo', 'Caption'], widths: [60, 320, 260], text: ['Photo'] },
  Orders: {
    headers: ['Order', 'Received', 'Status', 'Name', 'Email', 'Phone', 'Occasion', 'Date needed', 'Pickup / drop-off',
      'Street', 'City', 'ZIP', 'Allergies', 'Subtotal', 'Tax', 'Tax rate', 'Drop-off fee', 'Estimated total',
      'Customer email', 'Owner alert', 'Invoice', 'Decline note', 'QuickBooks invoice', 'Pay link', 'Updated'],
    widths: [80, 150, 110, 150, 200, 120, 140, 110, 110, 180, 120, 70, 220, 80, 70, 70, 90, 100, 160, 160, 120, 160, 120, 160, 150],
    text: ['Order', 'Phone', 'Date needed', 'ZIP'], money: ['Subtotal', 'Tax', 'Drop-off fee', 'Estimated total'], datetime: ['Received', 'Updated']
  },
  OrderItems: {
    headers: ['Order', 'Line', 'Item', 'Kind', 'Qty', 'Designs', 'Flavors', 'Flavors (data)', 'Description', 'Photo', 'Unit price', 'Line total'],
    widths: [80, 50, 140, 70, 60, 70, 260, 160, 360, 160, 90, 90],
    text: ['Order'], money: ['Unit price', 'Line total']
  },
  Messages: {
    headers: ['ID', 'Received', 'Status', 'Topic', 'Name', 'Email', 'Phone', 'Order', 'Message', 'Photo', 'Source', 'Owner alert'],
    widths: [60, 150, 90, 170, 150, 200, 120, 80, 420, 160, 100, 160],
    text: ['Phone', 'Order'], datetime: ['Received']
  },
  Draft: { headers: ['Key', 'Value', 'Updated'], widths: [100, 600, 150], text: ['Key', 'Value'], datetime: ['Updated'] },
  Counters: { headers: ['Name', 'Value'], widths: [140, 100] }
};

function setupSheet() {
  const ss = SpreadsheetApp.getActive();
  const created = {};
  Object.keys(TABS).forEach((name) => {
    let sh = ss.getSheetByName(name);
    if (!sh) { sh = ss.insertSheet(name); created[name] = true; }
    formatTab_(sh, TABS[name]);
  });

  if (created.Settings) {
    appendRows_(ss.getSheetByName('Settings'), SETTINGS_SPEC.map((s) => [s[0], String(s[1]), s[3]]));
  } else {
    // Add any settings introduced after the Sheet was first set up.
    const sh = ss.getSheetByName('Settings');
    const have = sh.getLastRow() > 1 ? sh.getRange(2, 1, sh.getLastRow() - 1, 1).getValues().map((r) => String(r[0])) : [];
    const missing = SETTINGS_SPEC.filter((s) => have.indexOf(s[0]) === -1);
    if (missing.length) appendRows_(sh, missing.map((s) => [s[0], String(s[1]), s[3]]));
  }
  if (created.Flavors) {
    const fl = ss.getSheetByName('Flavors');
    appendRows_(fl, STARTER_FLAVORS);
    fl.getRange(2, 3, STARTER_FLAVORS.length, 2).insertCheckboxes();
  }
  if (created.Zones) appendRows_(ss.getSheetByName('Zones'), STARTER_ZONES);
  if (created.BlockedDates) appendRows_(ss.getSheetByName('BlockedDates'), STARTER_BLOCKED);
  if (created.FAQ) appendRows_(ss.getSheetByName('FAQ'), STARTER_FAQ);
  if (created.Pages) appendRows_(ss.getSheetByName('Pages'), STARTER_PAGES);
  if (created.Events) {
    const ev = ss.getSheetByName('Events');
    appendRows_(ev, STARTER_EVENTS);
    ev.getRange(2, 1, 50, 1).insertCheckboxes();
    ev.getRange(2, 7, 50, 1).setDataValidation(SpreadsheetApp.newDataValidation().requireValueInList(EVENT_BUTTONS, true).build());
  }
  if (created.Gallery) {
    const gal = ss.getSheetByName('Gallery');
    appendRows_(gal, STARTER_GALLERY);
    gal.getRange(2, 1, 100, 1).insertCheckboxes();
  }
  if (created.Counters) appendRows_(ss.getSheetByName('Counters'), [['nextOrder', 1042], ['nextMessage', 1]]);

  // Remove the blank starter tab Google adds to new spreadsheets.
  const blank = ss.getSheetByName('Sheet1');
  if (blank && blank.getLastRow() === 0 && ss.getSheets().length > 1) ss.deleteSheet(blank);

  ss.setActiveSheet(ss.getSheetByName('Orders'));
  clearConfigCache_();
  return 'Sheet is ready. Created: ' + (Object.keys(created).join(', ') || 'nothing (all tabs already existed)');
}

function formatTab_(sh, spec) {
  const cols = spec.headers.length;
  const head = sh.getRange(1, 1, 1, cols);
  if (!String(sh.getRange(1, 1).getValue())) head.setValues([spec.headers]);
  head.setFontWeight('bold').setBackground('#F7E3DD').setFontColor('#1F2A44');
  sh.setFrozenRows(1);
  (spec.widths || []).forEach((w, i) => sh.setColumnWidth(i + 1, w));
  const maxRows = sh.getMaxRows() - 1;
  const col = (h) => spec.headers.indexOf(h) + 1;
  (spec.text || []).forEach((h) => sh.getRange(2, col(h), maxRows, 1).setNumberFormat('@'));
  (spec.money || []).forEach((h) => sh.getRange(2, col(h), maxRows, 1).setNumberFormat('$#,##0.00'));
  (spec.datetime || []).forEach((h) => sh.getRange(2, col(h), maxRows, 1).setNumberFormat('yyyy-mm-dd h:mm am/pm'));
  if (['Settings', 'FAQ', 'Pages', 'Events', 'Gallery'].indexOf(sh.getName()) !== -1) sh.getRange(1, 1, sh.getMaxRows(), cols).setWrap(true).setVerticalAlignment('top');
}

function appendRows_(sh, rows) {
  if (!rows.length) return;
  sh.getRange(sh.getLastRow() + 1, 1, rows.length, rows[0].length).setValues(rows);
}


/* ============================== Config ============================== */

/*
 * Reads shop settings from the Sheet into the same shape as SN_DEFAULTS in the site's config.js.
 * Cached for 10 minutes; any edit to the Sheet clears the cache (see onEdit).
 */

const CONFIG_CACHE_KEY = 'config_v1';

// Full settings, including private ones. Only for use inside the script.
function getConfig_() {
  const cache = CacheService.getScriptCache();
  const hit = cache.get(CONFIG_CACHE_KEY);
  if (hit) return JSON.parse(hit);
  const cfg = buildConfig_();
  try { cache.put(CONFIG_CACHE_KEY, JSON.stringify(cfg), 600); } catch (e) { /* too large to cache: fine */ }
  return cfg;
}

// Settings safe to send to the website.
function publicConfig_(cfg) {
  const out = {};
  Object.keys(cfg).forEach((k) => { if (PRIVATE_SETTINGS.indexOf(k) === -1) out[k] = cfg[k]; });
  return out;
}

function clearConfigCache_() { CacheService.getScriptCache().remove(CONFIG_CACHE_KEY); }

// Simple trigger: Melissa (or the admin) editing the Sheet makes the website pick up changes right away.
function onEdit() { clearConfigCache_(); }

function buildConfig_() {
  const ss = SpreadsheetApp.getActive();
  const cfg = {};

  const types = {};
  SETTINGS_SPEC.forEach((s) => { types[s[0]] = s[2]; cfg[s[0]] = parseSetting_(String(s[1]), s[2]); });
  rows_(ss.getSheetByName('Settings')).forEach((r) => {
    const key = String(r[0]).trim();
    if (!key) return;
    cfg[key] = parseSetting_(r[1], types[key] || 'text');
  });
  if (!cfg.ownerEmail) cfg.ownerEmail = Session.getEffectiveUser().getEmail();
  if (!cfg.replyToEmail) cfg.replyToEmail = cfg.ownerEmail;

  cfg.flavors = rows_(ss.getSheetByName('Flavors'))
    .filter((r) => String(r[0]).trim() && String(r[1]).trim())
    .map((r) => ({ id: String(r[0]).trim(), name: String(r[1]).trim(), on: truthy_(r[2]), special: truthy_(r[3]) }));

  cfg.zones = rows_(ss.getSheetByName('Zones'))
    .filter((r) => String(r[0]).trim())
    .map((r) => ({ zip: String(r[0]).trim(), area: String(r[1]).trim(), fee: Number(r[2]) || 0 }));

  const today = todayISO_();
  cfg.blockedDates = rows_(ss.getSheetByName('BlockedDates'))
    .map((r) => toISODate_(r[0]))
    .filter((d) => d && d >= today)
    .sort();

  cfg.faqs = rows_(ss.getSheetByName('FAQ'))
    .filter((r) => String(r[0]).trim())
    .map((r) => ({ q: String(r[0]).trim(), a: String(r[1]).trim() }));

  // Website wording and photos. Rows Melissa deletes fall back to the starter text.
  cfg.pages = {};
  STARTER_PAGES.forEach((p) => { cfg.pages[p[0]] = p[1]; });
  rows_(ss.getSheetByName('Pages')).forEach((r) => {
    const key = String(r[0]).trim();
    if (key) cfg.pages[key] = String(r[1] == null ? '' : r[1]).trim();
  });
  // Menu photos come from the Pages tab when filled in (the older "images" setting still works otherwise).
  cfg.images = Object.assign({}, cfg.images || {});
  [['custom', 'photoCustom'], ['mini', 'photoMini'], ['large', 'photoLarge']].forEach(([k, p]) => { if (cfg.pages[p]) cfg.images[k] = cfg.pages[p]; });

  cfg.events = rows_(ss.getSheetByName('Events'))
    .filter((r) => truthy_(r[0]) && String(r[3]).trim())
    .map((r) => ({ photo: String(r[1]).trim(), when: String(r[2]).trim(), title: String(r[3]).trim(), desc: String(r[4]).trim(), price: String(r[5]).trim(), button: String(r[6]).trim() || 'None', link: String(r[7]).trim() }));

  cfg.gallery = rows_(ss.getSheetByName('Gallery'))
    .filter((r) => truthy_(r[0]) && String(r[1]).trim())
    .map((r) => ({ photo: String(r[1]).trim(), caption: String(r[2]).trim() }));

  return cfg;
}

// The admin's unsaved "Preview changes" draft (Draft tab, key "config"), or null.
function getDraft_() {
  const row = rows_(SpreadsheetApp.getActive().getSheetByName('Draft')).find((r) => String(r[0]) === 'config');
  if (!row || !String(row[1]).trim()) return null;
  try { return JSON.parse(row[1]); } catch (e) { return null; }
}

function parseSetting_(v, type) {
  if (type === 'number') { const n = Number(v); return isNaN(n) ? 0 : n; }
  if (type === 'bool') return truthy_(v);
  if (type === 'date') return toISODate_(v) || '';
  if (type === 'json') { try { return typeof v === 'string' ? JSON.parse(v) : v; } catch (e) { return {}; } }
  return v == null ? '' : String(v);
}

function rows_(sh) {
  if (!sh || sh.getLastRow() < 2) return [];
  return sh.getRange(2, 1, sh.getLastRow() - 1, sh.getLastColumn()).getValues();
}


/* ============================== Orders ============================== */

/*
 * submitOrder: re-checks every rule and re-prices every line from the Sheet's settings
 * (never trusts prices from the browser), assigns SN-####, saves the order, then sends
 * email #1 to the customer and the "New order to review" alert to the owner.
 */

const EVENT_TYPES = ['Birthday', 'Baby Shower', 'Wedding Shower', 'Anniversary', 'Party', 'Other'];
const MAX_ITEMS = 20;
const MAX_QTY = 2000;

function occasion_(o) { return o.eventType || 'Not specified'; }

function itemLabel_(kind) { return kind === 'custom' ? 'Custom Cookies' : kind === 'mini' ? 'Mini Artisan' : 'Large Artisan'; }

function submitOrder_(b) {
  const cfg = getConfig_();
  if (!cfg.acceptingOrders) return { ok: false, code: 'closed', error: 'Sorry, I’m not taking new orders right now.' };

  const v = validateOrder_(cfg, b);
  if (v.errors.length) return { ok: false, code: 'invalid', errors: v.errors };
  const o = v.order;

  if (rateLimited_('order', o.customer.email, 5)) {
    return { ok: false, code: 'rate', error: 'We’ve received several requests from this email in the last hour. Please try again later or send a message instead.' };
  }

  const ss = SpreadsheetApp.getActive();
  const orders = ss.getSheetByName('Orders');
  const lock = LockService.getScriptLock();
  lock.waitLock(20000);
  let row;
  try {
    o.number = 'SN-' + nextCounter_('nextOrder');
    o.createdAt = new Date();
    row = appendObject_(orders, {
      'Order': o.number, 'Received': o.createdAt, 'Status': 'Pending review',
      'Name': o.customer.name, 'Email': o.customer.email, 'Phone': o.customer.phone,
      'Occasion': o.eventType, 'Date needed': o.dateNeeded, 'Pickup / drop-off': o.fulfillment === 'delivery' ? 'Drop-off' : 'Pickup',
      'Street': o.address ? o.address.street : '', 'City': o.address ? o.address.city : '', 'ZIP': o.address ? o.address.zip : '',
      'Allergies': o.allergies, 'Subtotal': o.subtotal, 'Tax': o.tax, 'Tax rate': o.taxRate, 'Drop-off fee': o.deliveryFee,
      'Estimated total': o.total, 'Customer email': 'Sending…', 'Owner alert': 'Sending…', 'Updated': o.createdAt
    });
    const items = ss.getSheetByName('OrderItems');
    const lines = o.items.map((it, i) => [o.number, i + 1, itemLabel_(it.kind), it.kind, it.qty, it.kind === 'custom' ? it.designs : '',
      it.kind === 'custom' ? '' : it.summary, it.kind === 'custom' ? '' : JSON.stringify(it.fq), it.desc || '', it.photoName || '', it.unit, it.lineTotal].map(cell_));
    items.getRange(items.getLastRow() + 1, 1, lines.length, lines[0].length).setValues(lines);
    SpreadsheetApp.flush();
  } finally {
    lock.releaseLock();
  }

  setCell_(orders, row, 'Customer email', sendSafely_(() => sendOrderRequestEmail_(cfg, o)));
  setCell_(orders, row, 'Owner alert', sendSafely_(() => sendOwnerOrderAlert_(cfg, o)));

  return {
    ok: true,
    order: {
      number: o.number, status: 'Pending review', createdAt: o.createdAt.toISOString(),
      items: o.items, eventType: o.eventType, dateNeeded: o.dateNeeded, allergies: o.allergies,
      fulfillment: o.fulfillment, address: o.address, customer: o.customer,
      subtotal: o.subtotal, tax: o.tax, deliveryFee: o.deliveryFee, total: o.total, taxRate: o.taxRate
    }
  };
}

// Returns { errors: [...short phrases for "Still needed: ..."], order }
function validateOrder_(cfg, b) {
  const errors = [];
  const flavorsById = {};
  cfg.flavors.forEach((f) => { if (f.on) flavorsById[f.id] = f; });

  const rawItems = Array.isArray(b.items) ? b.items.slice(0, MAX_ITEMS) : [];
  if (!rawItems.length) errors.push('at least one item in your bag');
  const items = [];
  rawItems.forEach((raw) => {
    const kind = String(raw && raw.kind);
    const label = itemLabel_(kind);
    if (kind === 'custom') {
      const qty = Math.floor(Number(raw.qty));
      const designs = Math.floor(Number(raw.designs));
      const desc = clean_(raw.desc, 3000);
      if (!(qty >= cfg.minQty && qty <= MAX_QTY)) errors.push(label + ': at least ' + cfg.minQty + ' cookies');
      if (!(designs >= 1 && designs <= cfg.maxDesigns)) errors.push(label + ': 1 to ' + cfg.maxDesigns + ' designs');
      if (!desc) errors.push(label + ': a description of your cookies');
      const unit = Number(cfg.customBasePrice) || 0;
      items.push({
        kind, qty, designs, desc, photoName: clean_(raw.photoName, 200), unit: round2_(unit), lineTotal: round2_(qty * unit),
        summary: designs + ' design' + (designs > 1 ? 's' : '') + ' · estimated at ' + money_(unit) + ' each' + (raw.photoName ? ' · photo attached' : '')
      });
    } else if (kind === 'mini' || kind === 'large') {
      const fq = {};
      let qty = 0;
      Object.keys(raw.fq || {}).forEach((id) => {
        const n = Math.floor(Number(raw.fq[id]));
        if (!(n > 0)) return;
        if (!flavorsById[id]) { errors.push(label + ': a flavor that’s no longer available was removed. Please review your flavors'); return; }
        fq[id] = n;
        qty += n;
      });
      const used = Object.keys(fq).length;
      const max = cfg.flavorsPerDozen * Math.max(1, Math.floor(qty / 12));
      if (qty < cfg.minQty || qty > MAX_QTY) errors.push(label + ': at least ' + cfg.minQty + ' cookies');
      else if (used > max) errors.push(label + ': up to ' + max + ' flavors for ' + qty + ' cookies');
      const unit = (kind === 'mini' ? cfg.miniPerDozen : cfg.largePerDozen) / 12;
      items.push({
        kind, qty, fq, unit: round2_(unit), lineTotal: round2_(qty * unit),
        flavorNames: Object.keys(fq).reduce((a, id) => { a[id] = flavorsById[id].name; return a; }, {}),
        summary: Object.keys(fq).map((id) => fq[id] + ' ' + flavorsById[id].name).join(', ')
      });
    } else {
      errors.push('a valid item');
    }
  });

  // The occasion is required for custom cookies (it shapes the design) and optional for artisan-only orders.
  let eventType = clean_(b.eventType, 40);
  const eventOther = clean_(b.eventOther, 120);
  const needsOccasion = items.some((it) => it.kind === 'custom');
  if (eventType || needsOccasion) {
    if (EVENT_TYPES.indexOf(eventType) === -1) errors.push('event type');
    else if (eventType === 'Other') { if (!eventOther) errors.push('the occasion'); else eventType = 'Other: ' + eventOther; }
  }

  const dateNeeded = toISODate_(b.dateNeeded);
  const minISO = addDaysISO_(todayISO_(), Number(cfg.leadDays) || 0);
  if (!dateNeeded) errors.push('date needed');
  else if (dateNeeded < minISO) errors.push('a date at least ' + cfg.leadDays + ' days out');
  else if (cfg.blockedDates.indexOf(dateNeeded) !== -1) errors.push('a different date (that day is booked)');

  const fulfillment = b.fulfillment === 'delivery' ? 'delivery' : 'pickup';
  let address = null, deliveryFee = 0;
  if (fulfillment === 'delivery') {
    const a = b.address || {};
    address = { street: clean_(a.street, 200), city: clean_(a.city, 80), zip: clean_(a.zip, 5).replace(/\D/g, '') };
    if (!address.street || !address.city) errors.push('drop-off address');
    const zone = cfg.zones.find((z) => z.zip === address.zip);
    if (!zone) errors.push('a ZIP in our drop-off area');
    else deliveryFee = Number(zone.fee) || 0;
  }

  const c = b.customer || {};
  const customer = { name: clean_(c.name, 120), email: clean_(c.email, 200), phone: formatPhone_(clean_(c.phone, 40)) };
  if (!customer.name) errors.push('name');
  if (!validEmail_(customer.email)) errors.push('a valid email');
  if (!customer.phone) errors.push('a 10-digit phone number');

  const subtotal = round2_(items.reduce((a, it) => a + it.lineTotal, 0));
  const tax = Math.round(subtotal * Number(cfg.taxRate)) / 100;
  const total = round2_(subtotal + tax + deliveryFee);

  return {
    errors: errors.filter((e, i) => errors.indexOf(e) === i),
    order: { items, eventType, dateNeeded, allergies: clean_(b.allergies, 1000), fulfillment, address, customer, subtotal, tax, deliveryFee, total, taxRate: Number(cfg.taxRate) }
  };
}

// Runs a send and returns a short status for the Sheet ("Sent 10/19 2:14 PM" or "FAILED: ...").
function sendSafely_(fn) {
  try {
    fn();
    return 'Sent ' + Utilities.formatDate(new Date(), tz_(), 'M/d h:mm a');
  } catch (err) {
    console.error('Email failed', err && err.stack || err);
    return 'FAILED: ' + String(err && err.message || err).slice(0, 200);
  }
}


/* ============================== Messages ============================== */

/*
 * sendMessage: Contact page form and the site-wide "Message me" pop-out.
 * Saves to the Messages tab and emails the owner with reply-to set to the customer.
 */

const MESSAGE_TOPICS = ['General question', 'Custom design idea', 'Allergies or dietary needs', 'An existing order', 'Special events or classes', 'Other', 'Quick message'];

function sendMessage_(b) {
  const m = {
    name: clean_(b.name, 120),
    email: clean_(b.email, 200),
    phone: clean_(b.phone, 40),
    topic: clean_(b.topic, 60),
    orderNumber: clean_(b.orderNumber, 20),
    message: clean_(b.message, 5000),
    photoName: clean_(b.photoName, 200),
    source: b.source === 'quick' ? 'Message me' : 'Contact page'
  };
  // The "Message me" button can set its own topic (e.g. "Special events or classes"); anything unexpected becomes "Other".
  if (MESSAGE_TOPICS.indexOf(m.topic) === -1) m.topic = m.topic ? 'Other' : 'Quick message';

  const errors = [];
  if (!validEmail_(m.email)) errors.push('a valid email');
  if (!m.message) errors.push('a message');
  if (m.phone) { m.phone = formatPhone_(m.phone); if (!m.phone) errors.push('a 10-digit phone number (or leave it blank)'); }
  if (errors.length) return { ok: false, code: 'invalid', errors };
  if (rateLimited_('msg', m.email, 10)) return { ok: false, code: 'rate', error: 'You’ve sent several messages in the last hour. Please try again a little later.' };

  const cfg = getConfig_();
  const sh = SpreadsheetApp.getActive().getSheetByName('Messages');
  const lock = LockService.getScriptLock();
  lock.waitLock(20000);
  let row;
  try {
    m.id = nextCounter_('nextMessage');
    m.createdAt = new Date();
    row = appendObject_(sh, {
      'ID': m.id, 'Received': m.createdAt, 'Status': 'New', 'Topic': m.topic, 'Name': m.name, 'Email': m.email,
      'Phone': m.phone, 'Order': m.orderNumber, 'Message': m.message, 'Photo': m.photoName, 'Source': m.source, 'Owner alert': 'Sending…'
    });
    SpreadsheetApp.flush();
  } finally {
    lock.releaseLock();
  }
  setCell_(sh, row, 'Owner alert', sendSafely_(() => sendOwnerMessageAlert_(cfg, m)));
  return { ok: true, id: m.id };
}


/* ============================== Emails ============================== */

/*
 * Email templates. They match email.html on the site, but with inline styles because email apps
 * ignore stylesheets. Sent with MailApp from the account that deploys the script.
 */

const C = { navy: '#1F2A44', coral: '#C65A4B', coralDark: '#8E3A2E', blush: '#F7E3DD', ground: '#F5EEE9', line: '#EFE6E0', field: '#D6C7BE', muted: '#5E6577' };
const SERIF = "'Cormorant Garamond',Georgia,'Times New Roman',serif";
const SANS = "'DM Sans',Arial,Helvetica,sans-serif";

function subjectPrefix_(cfg) { return String(cfg.environment).toUpperCase() === 'PROD' ? '' : '[TEST] '; }

/* ---------- Email #1: request received (customer) ---------- */
function sendOrderRequestEmail_(cfg, o) {
  const first = (o.customer.name || '').split(' ')[0];
  const html = shell_(cfg, 'We got your order request' + (first ? ', ' + esc_(first) : '') + '!', o.number,
    notFinalBox_() + nextSteps_() + facts_(o, false) + itemsBlock_(o, 'What you requested') +
    totalsBlock_(o, 'Estimated total*') +
    p_('*Estimate only, not a final price. ' + (o.items.some((it) => it.kind === 'custom') ? esc_(cfg.customNote || '') + ' ' : '') + 'Your final price will be in your confirmation email.', 13) +
    p_('Questions or changes? Just reply to this email and mention your order number.', 14));
  const text = [
    'We got your order request' + (first ? ', ' + first : '') + '!', 'Order number ' + o.number, '',
    'NOT A FINAL ORDER: this email confirms we received your request. Your order is not confirmed yet, your date is not reserved, and the price below is an estimate. You haven’t been charged anything.', '',
    'What happens next:', '1. Request received (this email).', '2. I review your order, usually within 1–2 days.',
    '3. You get a second email with your confirmation, final price and a QuickBooks invoice.', '4. Pay the invoice to lock in your date.', '',
    'Needed by: ' + prettyDate_(o.dateNeeded), 'Occasion: ' + occasion_(o),
    o.address ? 'Drop-off to: ' + o.address.street + ', ' + o.address.city + ' ' + o.address.zip : 'Pickup: ' + cfg.pickupCity + ' (address sent once confirmed)',
    o.allergies ? 'Allergies / dietary needs: ' + o.allergies : '', '',
    itemsText_(o), '', totalsText_(o, 'Estimated total*'), '',
    'Questions or changes? Just reply to this email and mention your order number.'
  ].filter((l, i, a) => l !== '' || a[i - 1] !== '').join('\n');
  MailApp.sendEmail({
    to: o.customer.email,
    subject: subjectPrefix_(cfg) + 'Order request received (not yet confirmed) – Sweet Nothings ' + o.number,
    htmlBody: html, body: text, name: cfg.senderName, replyTo: cfg.replyToEmail
  });
}

/* ---------- Owner alert: new order to review ---------- */
function sendOwnerOrderAlert_(cfg, o) {
  const allergy = o.allergies
    ? '<div style="border:2px solid ' + C.coral + ';background:#FFF6F3;border-radius:12px;padding:14px 16px;font-size:15px;margin-bottom:18px"><strong style="color:' + C.coralDark + '">Allergies / dietary needs:</strong> ' + esc_(o.allergies) + '</div>'
    : '';
  const contact = '<div style="font-size:15px;margin-bottom:18px"><strong>' + esc_(o.customer.name) + '</strong><br>' +
    '<a href="mailto:' + esc_(o.customer.email) + '" style="color:' + C.navy + '">' + esc_(o.customer.email) + '</a><br>' + esc_(o.customer.phone) + '</div>';
  const html = shell_(cfg, 'New order to review', o.number,
    allergy + contact + facts_(o, true) + itemsBlock_(o, 'Request') + totalsBlock_(o, 'Estimated total') +
    button_(SpreadsheetApp.getActive().getUrl(), 'Open the orders sheet') +
    p_('Reply to this email to write to the customer. Review and approval move to the admin page in the next update.', 13));
  const text = [
    'New order to review: ' + o.number, '', o.customer.name, o.customer.email, o.customer.phone, '',
    o.allergies ? 'ALLERGIES / DIETARY NEEDS: ' + o.allergies + '\n' : '',
    'Needed by: ' + prettyDate_(o.dateNeeded), 'Occasion: ' + occasion_(o),
    o.address ? 'Drop-off to: ' + o.address.street + ', ' + o.address.city + ' ' + o.address.zip : 'Pickup',
    '', itemsText_(o), '', totalsText_(o, 'Estimated total'), '', 'Orders sheet: ' + SpreadsheetApp.getActive().getUrl()
  ].join('\n');
  MailApp.sendEmail({
    to: cfg.ownerEmail,
    subject: subjectPrefix_(cfg) + 'New order to review – ' + o.number + ' (' + (o.eventType ? o.eventType + ', ' : '') + prettyDate_(o.dateNeeded) + ')',
    htmlBody: html, body: text, name: cfg.senderName, replyTo: o.customer.email
  });
}

/* ---------- Owner alert: new message ---------- */
function sendOwnerMessageAlert_(cfg, m) {
  const rows = [
    ['From', esc_(m.name || '(no name)') + '<br><a href="mailto:' + esc_(m.email) + '" style="color:' + C.navy + '">' + esc_(m.email) + '</a>' + (m.phone ? '<br>' + esc_(m.phone) : '')],
    ['Topic', esc_(m.topic)],
    m.orderNumber ? ['Order', esc_(m.orderNumber)] : null,
    m.photoName ? ['Photo', esc_(m.photoName) + ' <span style="color:' + C.muted + '">(photo uploads are coming in a later update)</span>'] : null,
    ['Sent from', esc_(m.source)]
  ].filter(Boolean);
  const html = shell_(cfg, 'New message', '',
    '<table role="presentation" cellpadding="0" cellspacing="0" width="100%" style="font-size:15px;margin-bottom:18px">' +
      rows.map((r) => '<tr><td style="padding:6px 12px 6px 0;color:' + C.muted + ';font-size:12px;text-transform:uppercase;letter-spacing:.06em;vertical-align:top;width:90px">' + r[0] + '</td><td style="padding:6px 0;font-weight:600">' + r[1] + '</td></tr>').join('') +
    '</table>' +
    '<div style="background:#FBF7F4;border-radius:12px;padding:14px 16px;font-size:15px;white-space:pre-wrap;margin-bottom:18px">' + esc_(m.message) + '</div>' +
    p_('Just hit Reply to answer ' + esc_(m.name ? m.name.split(' ')[0] : m.email) + '.', 14));
  MailApp.sendEmail({
    to: cfg.ownerEmail,
    subject: subjectPrefix_(cfg) + 'New message: ' + m.topic + ' – ' + (m.name || m.email),
    htmlBody: html,
    body: ['New message (' + m.source + ')', 'From: ' + (m.name ? m.name + ' ' : '') + '<' + m.email + '>' + (m.phone ? ' ' + m.phone : ''),
      'Topic: ' + m.topic, m.orderNumber ? 'Order: ' + m.orderNumber : '', m.photoName ? 'Photo: ' + m.photoName + ' (not saved yet)' : '', '', m.message].filter((l) => l !== null).join('\n'),
    name: cfg.senderName, replyTo: m.email
  });
}

/* ---------- Building blocks ---------- */
function shell_(cfg, title, number, inner) {
  const logo = cfg.siteUrl ? '<img src="' + esc_(cfg.siteUrl) + 'logo.png" width="110" height="110" alt="Sweet Nothings by M" style="display:block;margin:0 auto;width:110px;height:110px;border:0">' : '';
  return '<!doctype html><html><body style="margin:0;padding:0;background:' + C.ground + '">' +
    '<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:' + C.ground + '"><tr><td align="center" style="padding:32px 16px">' +
    '<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:640px;background:#FFFFFF;border-radius:16px;overflow:hidden;font-family:' + SANS + ';color:' + C.navy + ';line-height:1.5">' +
      '<tr><td align="center" style="padding:28px 28px 8px">' + logo +
        '<h1 style="margin:10px 0 0;font-family:' + SERIF + ';font-size:36px;font-weight:600;line-height:1.15;color:' + C.navy + '">' + title + '</h1>' +
        (number ? '<p style="margin:8px 0 0;color:' + C.muted + ';font-size:15px">Order number <strong style="color:' + C.navy + '">' + esc_(number) + '</strong></p>' : '') +
      '</td></tr>' +
      '<tr><td style="padding:20px 28px">' + inner + '</td></tr>' +
      '<tr><td align="center" style="background:' + C.navy + ';color:#FFFFFF;padding:18px;font-size:14px">Sweet Nothings by M · <a href="' + esc_(cfg.instagram) + '" style="color:#FFFFFF">' + esc_(cfg.instagramHandle) + '</a></td></tr>' +
    '</table></td></tr></table></body></html>';
}

function h2_(t) { return '<h2 style="margin:0 0 8px;font-family:' + SERIF + ';font-size:24px;font-weight:600;color:' + C.navy + '">' + t + '</h2>'; }
function p_(html, size) { return '<p style="margin:0 0 14px;font-size:' + (size || 15) + 'px;color:' + C.muted + '">' + html + '</p>'; }

function notFinalBox_() {
  return '<div style="border:2px solid ' + C.coral + ';background:#FFF6F3;border-radius:12px;padding:16px 18px;font-size:15px;margin-bottom:18px">' +
    '<span style="display:inline-block;background:' + C.coral + ';color:#FFFFFF;font-size:12px;font-weight:700;letter-spacing:.08em;text-transform:uppercase;padding:5px 10px;border-radius:999px">Not a final order</span>' +
    '<p style="margin:8px 0 0">This email confirms we <strong>received your request</strong>. Your order is <strong>not confirmed yet</strong>, your date is <strong>not reserved</strong>, and the price below is an <strong>estimate</strong>. You haven’t been charged anything.</p>' +
  '</div>';
}

function nextSteps_() {
  const steps = [
    ['Request received', 'That’s this email.'],
    ['I review your order', 'I’ll check the design, date and details, usually within 1–2 days.'],
    ['You get a second email: your confirmation', 'It includes the final price and a QuickBooks invoice. If anything changed from this estimate, I’ll explain why.'],
    ['Pay the invoice to lock in your date', 'Your order is final once it’s paid.']
  ];
  return '<div style="margin-bottom:18px">' + h2_('What happens next') +
    '<table role="presentation" cellpadding="0" cellspacing="0" width="100%">' +
    steps.map((s, i) => {
      const done = i === 0;
      const dot = '<div style="width:28px;height:28px;line-height:28px;border-radius:50%;text-align:center;font-weight:700;font-size:14px;' +
        (done ? 'background:' + C.navy + ';color:#FFFFFF' : 'background:' + C.ground + ';border:1px solid ' + C.field + ';line-height:26px;width:26px;height:26px') + '">' + (done ? '✓' : (i + 1)) + '</div>';
      return '<tr><td style="width:40px;vertical-align:top;padding:0 0 12px">' + dot + '</td><td style="vertical-align:top;padding:2px 0 12px;font-size:15px"><strong>' + s[0] + '</strong><br><span style="color:' + C.muted + ';font-size:14px">' + s[1] + '</span></td></tr>';
    }).join('') + '</table></div>';
}

function facts_(o, forOwner) {
  const where = o.fulfillment === 'delivery' && o.address
    ? ['Drop-off to', esc_(o.address.street) + ', ' + esc_(o.address.city) + ' ' + esc_(o.address.zip)]
    : ['Pickup', forOwner ? 'Pickup' : esc_(getConfig_().pickupCity) + ' (address sent once confirmed)'];
  const cell = (k, v) => '<td style="width:50%;vertical-align:top;padding:0 12px 14px 0"><div style="color:' + C.muted + ';font-size:12px;text-transform:uppercase;letter-spacing:.06em">' + k + '</div><div style="font-weight:600;margin-top:2px;font-size:14px">' + v + '</div></td>';
  return '<table role="presentation" cellpadding="0" cellspacing="0" width="100%" style="margin-bottom:4px">' +
    '<tr>' + cell('Needed by', esc_(prettyDate_(o.dateNeeded))) + cell('Occasion', esc_(occasion_(o))) + '</tr>' +
    '<tr>' + cell(where[0], where[1]) + cell('Contact', esc_(o.customer.name) + '<br>' + esc_(o.customer.phone)) + '</tr>' +
    (o.allergies && !forOwner ? '<tr><td colspan="2" style="padding:0 0 14px"><div style="color:' + C.muted + ';font-size:12px;text-transform:uppercase;letter-spacing:.06em">Allergies / dietary needs</div><div style="font-weight:600;margin-top:2px;font-size:14px">' + esc_(o.allergies) + '</div></td></tr>' : '') +
  '</table>';
}

function itemsBlock_(o, heading) {
  return '<div style="border-top:1px solid ' + C.line + ';padding-top:14px;margin-bottom:18px">' + h2_(heading) +
    o.items.map((it) =>
      '<div style="padding:8px 0">' +
        '<table role="presentation" cellpadding="0" cellspacing="0" width="100%" style="font-size:15px"><tr><td><strong>' + it.qty + ' ' + esc_(itemLabel_(it.kind)) + '</strong></td><td align="right">' + (it.kind === 'custom' ? 'from ' : '') + money_(it.lineTotal) + '</td></tr></table>' +
        '<div style="color:' + C.muted + ';font-size:14px">' + esc_(it.summary) + '</div>' +
        (it.desc ? '<div style="font-size:14px;color:' + C.muted + ';background:#FBF7F4;border-radius:10px;padding:10px 12px;margin-top:6px"><strong style="color:' + C.navy + '">Description:</strong> ' + esc_(it.desc) + '</div>' : '') +
      '</div>').join('') +
  '</div>';
}

function totalsBlock_(o, totalLabel) {
  const row = (k, v) => '<tr><td style="padding:3px 0;color:' + C.muted + ';font-size:15px">' + k + '</td><td align="right" style="padding:3px 0;font-size:15px">' + v + '</td></tr>';
  const isDel = o.fulfillment === 'delivery';
  return '<table role="presentation" cellpadding="0" cellspacing="0" width="100%" style="border-top:1px solid ' + C.line + ';padding-top:14px;margin-bottom:10px">' +
    row('Subtotal', money_(o.subtotal)) +
    row('Grocery tax (' + o.taxRate + '%)', money_(o.tax)) +
    row(isDel ? 'Drop-off' : 'Pickup', isDel ? money_(o.deliveryFee) : 'Free') +
    '<tr><td style="border-top:1px solid ' + C.line + ';padding-top:10px"><strong>' + totalLabel + '</strong></td>' +
      '<td align="right" style="border-top:1px solid ' + C.line + ';padding-top:10px;font-family:' + SERIF + ';font-size:30px;font-weight:700">' + money_(o.total) + '</td></tr>' +
  '</table>';
}

function button_(href, label) {
  return '<div style="text-align:center;margin:8px 0 18px"><a href="' + esc_(href) + '" style="display:inline-block;background:' + C.coral + ';color:#FFFFFF;text-decoration:none;font-weight:700;padding:14px 26px;border-radius:999px;font-size:16px">' + esc_(label) + '</a></div>';
}

function itemsText_(o) {
  return o.items.map((it) => it.qty + ' ' + itemLabel_(it.kind) + ' – ' + (it.kind === 'custom' ? 'from ' : '') + money_(it.lineTotal) +
    '\n   ' + it.summary + (it.desc ? '\n   Description: ' + it.desc : '')).join('\n');
}

function totalsText_(o, totalLabel) {
  return 'Subtotal: ' + money_(o.subtotal) + '\nGrocery tax (' + o.taxRate + '%): ' + money_(o.tax) + '\n' +
    (o.fulfillment === 'delivery' ? 'Drop-off: ' + money_(o.deliveryFee) : 'Pickup: Free') + '\n' + totalLabel + ': ' + money_(o.total);
}


/* ============================== Util ============================== */

/* Small shared helpers. */

function truthy_(v) {
  if (typeof v === 'boolean') return v;
  return ['true', 'yes', 'y', '1', 'on'].indexOf(String(v).trim().toLowerCase()) !== -1;
}

function tz_() { return Session.getScriptTimeZone() || 'America/Chicago'; }

function todayISO_() { return Utilities.formatDate(new Date(), tz_(), 'yyyy-MM-dd'); }

// Accepts a Date, "2026-11-26" or "11/26/2026" and returns "2026-11-26" (or '' if it isn't a date).
function toISODate_(v) {
  if (v instanceof Date && !isNaN(v)) return Utilities.formatDate(v, tz_(), 'yyyy-MM-dd');
  const s = String(v == null ? '' : v).trim();
  let m = s.match(/^(\d{4})-(\d{1,2})-(\d{1,2})$/);
  if (m) return isoParts_(+m[1], +m[2], +m[3]);
  m = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  if (m) return isoParts_(+m[3], +m[1], +m[2]);
  return '';
}

function isoParts_(y, mo, d) {
  const dt = new Date(Date.UTC(y, mo - 1, d));
  if (dt.getUTCFullYear() !== y || dt.getUTCMonth() !== mo - 1 || dt.getUTCDate() !== d) return '';
  return dt.toISOString().slice(0, 10);
}

function addDaysISO_(iso, n) {
  const p = iso.split('-').map(Number);
  return new Date(Date.UTC(p[0], p[1] - 1, p[2] + n)).toISOString().slice(0, 10);
}

// "Saturday, November 7"
function prettyDate_(iso) {
  if (!iso) return '';
  const p = iso.split('-').map(Number);
  return Utilities.formatDate(new Date(Date.UTC(p[0], p[1] - 1, p[2], 12)), 'UTC', 'EEEE, MMMM d');
}

function round2_(n) { return Math.round(n * 100) / 100; }
function money_(n) { return '$' + round2_(Number(n) || 0).toFixed(2); }

function esc_(s) {
  return String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

// Trimmed text with a length cap.
function clean_(v, max) { return String(v == null ? '' : v).trim().slice(0, max || 500); }

// Stop customer text from being treated as a Sheets formula.
function cell_(v) { return typeof v === 'string' && /^[=+\-@]/.test(v) ? "'" + v : v; }

// Same checks as SN.validEmail / SN.phoneDigits in the site's config.js.
function validEmail_(s) { return /^[^\s@]+@[^\s@.]+(\.[^\s@.]+)*\.[A-Za-z]{2,}$/.test(s); }

// "847-555-0100" for a 10-digit US number (a leading country code 1 is dropped), or '' if it isn't one.
function formatPhone_(s) {
  let d = String(s || '').replace(/\D/g, '');
  if (d.length === 11 && d[0] === '1') d = d.slice(1);
  return d.length === 10 ? d.slice(0, 3) + '-' + d.slice(3, 6) + '-' + d.slice(6) : '';
}

// Append one row using the tab's header names as keys.
function appendObject_(sh, obj) {
  const headers = sh.getRange(1, 1, 1, sh.getLastColumn()).getValues()[0];
  sh.appendRow(headers.map((h) => (h in obj ? cell_(obj[h]) : '')));
  return sh.getLastRow();
}

function setCell_(sh, row, header, value) {
  const headers = sh.getRange(1, 1, 1, sh.getLastColumn()).getValues()[0];
  const c = headers.indexOf(header);
  if (c !== -1) sh.getRange(row, c + 1).setValue(cell_(value));
}

// Next number from the Counters tab. Call inside a script lock.
function nextCounter_(name) {
  const sh = SpreadsheetApp.getActive().getSheetByName('Counters');
  const vals = sh.getRange(2, 1, Math.max(1, sh.getLastRow() - 1), 2).getValues();
  const i = vals.findIndex((r) => r[0] === name);
  if (i === -1) throw new Error('Counter missing: ' + name);
  const n = Number(vals[i][1]);
  sh.getRange(i + 2, 2).setValue(n + 1);
  return n;
}

// Basic flood protection: at most `max` submissions per email address per hour.
function rateLimited_(kind, email, max) {
  const cache = CacheService.getScriptCache();
  const key = 'rl_' + kind + '_' + email.toLowerCase();
  const n = Number(cache.get(key) || 0);
  if (n >= max) return true;
  cache.put(key, String(n + 1), 3600);
  return false;
}
