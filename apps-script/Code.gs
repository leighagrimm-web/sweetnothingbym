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
 *
 * Admin web app: a second deployment of this same script (Execute as: User accessing the web app,
 * Access: Only myself), opened with no parameters. It serves Admin.html to the Sheet's owner only.
 */

function doGet(e) {
  const p = (e && e.parameter) || {};
  if (!p.action) return adminPage_();
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
    if (p.action === 'ics') {
      const ev = (getConfig_().events || []).find((x) => x.id === String(p.event || ''));
      const ics = ev ? classIcs_(getConfig_(), ev) : '';
      if (!ics) return json_({ ok: false, error: 'That class isn’t on the calendar.' });
      return ContentService.createTextOutput(ics).setMimeType(ContentService.MimeType.ICAL);
    }
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
    if (body.action === 'checkBypass') return json_(checkBypass_(body));
    // Maintenance mode: only people with the password can order or send messages. (A class payment already
    // under way can still be checked.)
    if (['submitOrder', 'sendMessage', 'checkCode'].indexOf(body.action) !== -1 && closedForMaintenance_(body)) {
      return json_({ ok: false, code: 'maintenance', error: 'The site is closed for a little while for updates. Please check back soon!' });
    }
    if (body.action === 'submitOrder') return json_(submitOrder_(body));
    if (body.action === 'sendMessage') return json_(sendMessage_(body));
    if (body.action === 'checkCode') return json_(checkCode_(body));
    if (body.action === 'checkClassPayment') return json_(checkClassPayment_(body));
    return json_({ ok: false, error: 'Unknown action.' });
  } catch (err) {
    console.error('doPost failed', body && body.action, err && err.stack || err);
    return json_({ ok: false, error: 'Something went wrong on our end.' });
  }
}

// True while maintenance mode is on and the request doesn't carry the maintenance password.
function closedForMaintenance_(body) {
  const cfg = getConfig_();
  if (!cfg.maintenanceMode) return false;
  const pw = String(cfg.maintenancePassword || '').trim();
  return !pw || String(body.bypass || '').trim() !== pw;
}

// The maintenance page's "Have a password?" box. Rate-limited so it can't be guessed quickly.
function checkBypass_(b) {
  if (rateLimited_('bypass', 'all', 30)) return { ok: false, error: 'Too many tries. Please wait an hour and try again.' };
  const pw = String(getConfig_().maintenancePassword || '').trim();
  return pw && String(b.password || '').trim() === pw ? { ok: true } : { ok: false, error: 'That password isn’t right.' };
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
  ['capCustomPerWeek', 50, 'number', 'Most custom cookies per week (Mon-Sun), counting approved orders. 0 = no limit.'],
  ['capArtisanPerWeek', 75, 'number', 'Most artisan cookies per week (Mon-Sun), counting approved orders. 0 = no limit.'],
  ['minQty', 12, 'number', 'Minimum cookies per item.'],
  ['maxDesigns', 6, 'number', 'Most custom designs a customer can pick.'],
  ['customBasePrice', 5, 'number', 'Custom cookies "starting at" price per cookie.'],
  ['customNote', 'Pricing may vary based on the complexity of the design and the number of different designs.', 'text', 'Note shown with custom cookies.'],
  ['allergyNote', 'Need allergy-friendly swaps, like gluten-free or dairy-free? Happy to help! Ingredient changes for allergies or dietary needs add an extra cost, which I\'ll include in your final price.', 'text', 'Shown with an asterisk on custom cookies and under "Allergies" at checkout.'],
  ['miniPerDozen', 24, 'number', 'Mini Artisan price per dozen.'],
  ['largePerDozen', 36, 'number', 'Large Artisan price per dozen.'],
  ['flavorsPerDozen', 4, 'number', 'Most artisan flavors for an order under flavorsMaxAt cookies.'],
  ['flavorsMax', 6, 'number', 'Most artisan flavors once an order reaches flavorsMaxAt cookies.'],
  ['flavorsMaxAt', 24, 'number', 'Cookie count where flavorsMax kicks in (24 = 2 dozen).'],
  ['specialText', 'Pumpkin Spice is back in the artisan lineup through the end of the month.', 'text', 'Monthly special message (leave blank for none).'],
  ['specialUntil', '2026-10-31', 'date', 'Last day to show the special (YYYY-MM-DD).'],
  ['showAbout', true, 'bool', 'Show the About page in the menu. FALSE hides it (visits go to the home page).'],
  ['showEvents', true, 'bool', 'Show the Special Events page in the menu.'],
  ['showGallery', true, 'bool', 'Show the Gallery page in the menu.'],
  ['showFaq', true, 'bool', 'Show the FAQ page in the menu.'],
  ['pickupCity', 'Rosemont, IL', 'text', 'Shown on the website.'],
  ['pickupAddress', '[Street address], Rosemont, IL', 'text', 'PRIVATE. Only sent in the confirmation email for pickup orders.'],
  ['pickupInstructions', '[Pickup instructions, e.g. pickup window, where to park, which door]', 'text', 'PRIVATE. Shown with the address in the confirmation email for pickup orders.'],
  ['ownerPhone', '', 'text', 'PRIVATE. Your cell, only in the pickup / drop-off time emails, so customers can reach you on the day.'],
  ['instagram', 'https://www.instagram.com/sweet_nothings_by_m/', 'text', 'Instagram link.'],
  ['instagramHandle', '@sweet_nothings_by_m', 'text', 'Instagram name shown on the site.'],
  ['images', '{"custom":"","mini":"","large":""}', 'json', 'Menu photo paths (advanced).'],
  ['homeItems', '[{"name":"Mini artisan","line":"","photo":"","link":"mini"},{"name":"Large artisan","line":"","photo":"","link":"large"},{"name":"Cookie kits","line":"At pop-ups and events","photo":"","link":"events"}]', 'json', 'Home page "What I make" short list (edit on the admin’s Website pages tab). link: custom, mini, large, order, events, contact or message.'],
  ['homeSlides', '[]', 'json', 'Home page: Custom cookies slideshow photos, in order (edit on the admin’s Website pages tab). Empty = the Custom Cookies menu photo.'],
  ['classHoldMinutes', 30, 'number', 'Minutes a class spot is held while the customer pays in Square. Unpaid after this, the booking expires and the spot opens up.'],
  ['maintenanceMode', false, 'bool', 'TRUE shows the "back soon" page to visitors and turns away orders and messages. People with maintenancePassword see the whole site.'],
  ['maintenanceTitle', 'Something sweet is in the oven', 'text', 'Heading on the maintenance page.'],
  ['maintenanceMessage', 'We’re mixing up a fresh batch of updates to the site. Check back soon, or follow along on Instagram in the meantime!', 'text', 'Message on the maintenance page.'],
  ['maintenancePassword', '', 'text', 'PRIVATE. Lets you (and anyone you give it to) see and test the site during maintenance.'],
  ['adminHelpers', '', 'text', 'PRIVATE. Google emails (comma-separated) of people who can use the admin besides the owner. Saving shares the Sheet and photos folder with them; their emails go out from the shop\'s account within 5 minutes.'],
  ['ownerEmail', '', 'text', 'PRIVATE. Where "new order" and "new message" alerts go. Blank = the Google account that runs this.'],
  ['replyToEmail', '', 'text', 'PRIVATE. Where customer replies go. Blank = ownerEmail.'],
  ['senderName', 'Sweet Nothings by M', 'text', 'PRIVATE. Name shown as the email sender.'],
  ['siteUrl', 'https://leighagrimm-web.github.io/sweetnothingbym/', 'text', 'PRIVATE. Website address, used for the logo and links in emails. End with /'],
  ['environment', 'UAT', 'text', 'PRIVATE. UAT or PROD. UAT adds [TEST] to email subjects.'],
  ['adminUrl', '', 'text', 'PRIVATE. Link to the admin page (the admin deployment\'s web app URL). Used in "New order to review" emails.']
];
const PRIVATE_SETTINGS = ['pickupAddress', 'pickupInstructions', 'ownerPhone', 'maintenancePassword', 'adminHelpers', 'ownerEmail', 'replyToEmail', 'senderName', 'siteUrl', 'environment', 'adminUrl'];

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
// Start, End (blank = just that day), Note
const STARTER_BLOCKED = [['2026-11-26', '2026-11-27', 'Thanksgiving'], ['2026-12-24', '2026-12-26', 'Christmas']];
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
  ['homeMakeIntro', 'Hand-decorated custom sets, small-batch artisan favorites, and kits to decorate at home.', 'Home page: line under "What I make"'],
  ['homeEventsLine', 'Decorating classes and pop-ups around the northwest suburbs', 'Home page: the classes and pop-ups line under "What I make" (links to Special Events)'],
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
// "Add to bag" = a class customers book and pay for at checkout (needs a price; no approval needed).
const EVENT_BUTTONS = ['Add to bag', 'Order now', 'Message me', 'None'];
// One object per Events row. Blank fields don't show on the website.
const STARTER_EVENTS = [
  { id: 'e1', show: true, title: '[Cookie decorating class]', date: '', start: '', end: '', address: '', price: '', max: '', desc: '[What attendees will make and what\'s included.]', photo: '[Class photo]', when: '', button: 'Add to bag' },
  { id: 'e2', show: true, title: '[Seasonal special]', date: '', start: '', end: '', address: '', price: '', max: '', desc: '[Holiday or seasonal box description. Specials can also be added to the artisan menu from the admin page.]', photo: '[Seasonal cookie photo]', when: '[Available dates]', button: 'Order now' },
  { id: 'e3', show: true, title: 'Planning something bigger?', date: '', start: '', end: '', address: '', price: '', max: '', desc: 'For weddings, corporate gifts or large events, start an order and describe what you have in mind, or send me a message.', photo: '[Event photo]', when: '', button: 'Message me' }
];
// Events tab column for each field above.
const EVENT_COLS = { id: 'ID', show: 'Show', title: 'Title', date: 'Date', start: 'Start time', end: 'End time', address: 'Address', price: 'Price', max: 'Max attendees', desc: 'Description', photo: 'Photo', when: 'When', button: 'Button',
  venue: 'Location', summary: 'Card line', flyer: 'Flyer' };
const CODE_TYPES = ['Percent off', 'Gift card'];
// Show, Photo, Caption. The first 4 shown also appear under "Recent creations" on the home page.
const STARTER_GALLERY = ['Birthday', 'Baby shower', 'Wedding shower', 'Anniversary', 'Holiday', 'Party', 'Artisan box', 'Custom set']
  .map((l) => [true, '[' + l + ' cookie photo]', l + ' cookies']);

// Tab layout. text: columns kept as plain text (so Sheets doesn't turn ZIPs, phones or dates into numbers).
const TABS = {
  Settings: { headers: ['Setting', 'Value', 'What it means'], widths: [170, 380, 460], text: ['Setting', 'Value'] },
  Flavors: { headers: ['ID', 'Flavor', 'Show on menu', 'Special'], widths: [60, 220, 120, 90], text: ['ID'] },
  Zones: { headers: ['ZIP', 'Area', 'Fee'], widths: [80, 240, 80], text: ['ZIP'], money: ['Fee'] },
  BlockedDates: { headers: ['Start', 'End', 'Note'], widths: [120, 120, 260], text: ['Start', 'End'] },
  FAQ: { headers: ['Question', 'Answer'], widths: [300, 700] },
  Pages: { headers: ['Key', 'Text', 'Where it shows'], widths: [170, 560, 380], text: ['Key', 'Text'] },
  Events: {
    // Location = the place's name; Card line = the short text on the card (the full Description shows in Details).
    headers: ['ID', 'Show', 'Title', 'Date', 'Start time', 'End time', 'Address', 'Price', 'Max attendees', 'Description', 'Photo', 'When', 'Button', 'Location', 'Card line', 'Flyer'],
    widths: [50, 60, 220, 110, 90, 90, 220, 80, 100, 360, 220, 160, 110, 200, 260, 220],
    text: ['ID', 'Date', 'Start time', 'End time', 'Photo', 'When', 'Flyer'], money: ['Price']
  },
  Gallery: { headers: ['Show', 'Photo', 'Caption'], widths: [60, 320, 260], text: ['Photo'] },
  Codes: {
    headers: ['Code', 'Type', 'Amount', 'Balance', 'Active', 'Expires', 'Max uses', 'Uses', 'Note', 'Created'],
    widths: [140, 110, 80, 90, 70, 110, 80, 60, 260, 150],
    text: ['Code', 'Expires'], money: ['Balance'], datetime: ['Created']
  },
  Orders: {
    headers: ['Order', 'Received', 'Status', 'Name', 'Email', 'Phone', 'Occasion', 'Date needed', 'Pickup / drop-off',
      'Street', 'City', 'ZIP', 'Allergies', 'Subtotal', 'Tax', 'Tax rate', 'Drop-off fee', 'Estimated total',
      'Customer email', 'Owner alert', 'Invoice', 'Decline note', 'QuickBooks invoice', 'Pay link', 'Updated',
      'Type', 'Promo code', 'Discount', 'Gift card credit', 'Messages log', 'Submission ID', 'Square order', 'Event time', 'Pickup window', 'Handoff date', 'Handoff time', 'Reminder sent'],
    widths: [80, 150, 110, 150, 200, 120, 140, 110, 110, 180, 120, 70, 220, 80, 70, 70, 90, 100, 160, 160, 120, 160, 120, 160, 150, 80, 110, 80, 100, 200, 120, 160, 100, 220, 110, 90, 150],
    text: ['Order', 'Phone', 'Date needed', 'ZIP', 'Promo code', 'Submission ID', 'Square order', 'QuickBooks invoice', 'Event time', 'Pickup window', 'Handoff date', 'Handoff time', 'Reminder sent'], money: ['Subtotal', 'Tax', 'Drop-off fee', 'Estimated total', 'Discount', 'Gift card credit'], datetime: ['Received', 'Updated']
  },
  OrderItems: {
    headers: ['Order', 'Line', 'Item', 'Kind', 'Qty', 'Designs', 'Flavors', 'Flavors (data)', 'Description', 'Photo', 'Unit price', 'Line total', 'Event ID'],
    widths: [80, 50, 140, 70, 60, 70, 260, 160, 360, 160, 90, 90, 70],
    text: ['Order', 'Event ID'], money: ['Unit price', 'Line total']
  },
  Messages: {
    headers: ['ID', 'Received', 'Status', 'Topic', 'Name', 'Email', 'Phone', 'Order', 'Message', 'Photo', 'Source', 'Owner alert', 'Replies'],
    widths: [60, 150, 90, 170, 150, 200, 120, 80, 420, 160, 100, 160, 300],
    text: ['Phone', 'Order', 'Replies'], datetime: ['Received']
  },
  Draft: { headers: ['Key', 'Value', 'Updated'], widths: [100, 600, 150], text: ['Key', 'Value'], datetime: ['Updated'] },
  Counters: { headers: ['Name', 'Value'], widths: [140, 100] },
  // Emails from admin helpers, waiting for the owner's 5-minute check to send them from the shop's account.
  Outbox: { headers: ['Queued', 'To', 'Subject', 'Email (data)'], widths: [150, 220, 360, 400], text: ['To', 'Subject', 'Email (data)'], datetime: ['Queued'] }
};

function setupSheet() {
  const ss = SpreadsheetApp.getActive();
  const created = {};
  // Older layouts, converted in place before anything else.
  migrateBlockedDates_(ss.getSheetByName('BlockedDates'));
  migrateEvents_(ss.getSheetByName('Events'));
  Object.keys(TABS).forEach((name) => {
    let sh = ss.getSheetByName(name);
    if (!sh) { sh = ss.insertSheet(name); created[name] = true; }
    formatTab_(sh, TABS[name]);
  });

  if (created.Settings) {
    appendRows_(ss.getSheetByName('Settings'), SETTINGS_SPEC.map((s) => [s[0], String(s[1]), s[3]]));
  } else {
    // Add settings introduced after the Sheet was first set up; drop ones no longer used.
    const sh = ss.getSheetByName('Settings');
    const have = sh.getLastRow() > 1 ? sh.getRange(2, 1, sh.getLastRow() - 1, 1).getValues().map((r) => String(r[0])) : [];
    const missing = SETTINGS_SPEC.filter((s) => have.indexOf(s[0]) === -1);
    if (missing.length) appendRows_(sh, missing.map((s) => [s[0], String(s[1]), s[3]]));
    ['maxOrdersPerDay', 'taxRate'].map((old) => have.indexOf(old)).filter((i) => i !== -1)
      .sort((a, b) => b - a).forEach((i) => sh.deleteRow(i + 2));   // bottom up, so earlier rows don't shift
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
  if (created.Events) writeEvents_(STARTER_EVENTS);
  if (created.Gallery) {
    const gal = ss.getSheetByName('Gallery');
    appendRows_(gal, STARTER_GALLERY);
    gal.getRange(2, 1, 100, 1).insertCheckboxes();
  }
  if (created.Counters) appendRows_(ss.getSheetByName('Counters'), [['nextOrder', 1042], ['nextMessage', 1]]);

  // Remove the blank starter tab Google adds to new spreadsheets.
  const blank = ss.getSheetByName('Sheet1');
  if (blank && blank.getLastRow() === 0 && ss.getSheets().length > 1) ss.deleteSheet(blank);

  // Checks QuickBooks and Square for payments every 5 minutes.
  ensurePaymentTrigger_();
  // Where customers' photos are saved, shared with any admin helpers.
  uploadFolder_();
  shareWithHelpers_();
  ss.getSheetByName('Outbox').hideSheet();

  ss.setActiveSheet(ss.getSheetByName('Orders'));
  clearConfigCache_();
  return 'Sheet is ready. Created: ' + (Object.keys(created).join(', ') || 'nothing (all tabs already existed)');
}

// Headers (adding any missing ones at the end, so older Sheets gain new columns), widths and number formats.
function formatTab_(sh, spec) {
  if (!String(sh.getRange(1, 1).getValue())) sh.getRange(1, 1, 1, spec.headers.length).setValues([spec.headers]);
  else {
    const have = sh.getRange(1, 1, 1, sh.getLastColumn()).getValues()[0].map(String);
    const missing = spec.headers.filter((h) => have.indexOf(h) === -1);
    if (missing.length) sh.getRange(1, have.length + 1, 1, missing.length).setValues([missing]);
  }
  const cols = sh.getLastColumn();
  sh.getRange(1, 1, 1, cols).setFontWeight('bold').setBackground('#F7E3DD').setFontColor('#1F2A44');
  sh.setFrozenRows(1);
  const map = headerMap_(sh);
  const maxRows = sh.getMaxRows() - 1;
  spec.headers.forEach((h, i) => { if (spec.widths && spec.widths[i]) sh.setColumnWidth(map[h], spec.widths[i]); });
  (spec.text || []).forEach((h) => sh.getRange(2, map[h], maxRows, 1).setNumberFormat('@'));
  (spec.money || []).forEach((h) => sh.getRange(2, map[h], maxRows, 1).setNumberFormat('$#,##0.00'));
  (spec.datetime || []).forEach((h) => sh.getRange(2, map[h], maxRows, 1).setNumberFormat('yyyy-mm-dd h:mm am/pm'));
  if (['Settings', 'FAQ', 'Pages', 'Events', 'Gallery', 'Codes'].indexOf(sh.getName()) !== -1) sh.getRange(1, 1, sh.getMaxRows(), cols).setWrap(true).setVerticalAlignment('top');
}

// { 'Header name': column number } for a tab.
function headerMap_(sh) {
  const map = {};
  if (!sh || sh.getLastColumn() < 1) return map;
  sh.getRange(1, 1, 1, sh.getLastColumn()).getValues()[0].forEach((h, i) => { if (h) map[String(h)] = i + 1; });
  return map;
}

// Rows below the header as objects keyed by header name.
function rowObjects_(sh) {
  if (!sh || sh.getLastRow() < 2) return [];
  const headers = sh.getRange(1, 1, 1, sh.getLastColumn()).getValues()[0].map(String);
  return rows_(sh).map((r) => { const o = {}; headers.forEach((h, i) => { if (h) o[h] = r[i]; }); return o; });
}

// BlockedDates used to be one date per row (Date, Note). Now it's ranges (Start, End, Note).
function migrateBlockedDates_(sh) {
  if (!sh || String(sh.getRange(1, 1).getValue()) !== 'Date') return;
  sh.insertColumnAfter(1);
  sh.getRange(1, 1, 1, 2).setValues([['Start', 'End']]);
}

// Events used to have Show, Photo, When, Title, Description, Price (text), Button, Sign-up link.
function migrateEvents_(sh) {
  if (!sh || headerMap_(sh)['Sign-up link'] === undefined) return;
  const old = rowObjects_(sh).filter((r) => String(r.Title).trim());
  const events = old.map((r, i) => ({
    id: 'e' + (i + 1), show: truthy_(r.Show), title: String(r.Title), date: '', start: '', end: '', address: '',
    price: (String(r.Price).match(/\d+(\.\d+)?/) || [''])[0], max: '', desc: String(r.Description || ''), photo: String(r.Photo || ''),
    when: String(r.When || ''), button: r.Button === 'Sign up' ? 'Add to bag' : String(r.Button || 'None')
  }));
  sh.clear();
  sh.getRange(1, 1, sh.getMaxRows(), sh.getMaxColumns()).clearDataValidations().setNumberFormat('General');   // old column formats don't carry over
  sh.getRange(1, 1, 1, TABS.Events.headers.length).setValues([TABS.Events.headers]);
  writeEvents_(events);
}

// Replace the Events tab rows with these events (objects shaped like STARTER_EVENTS).
function writeEvents_(events) {
  const sh = SpreadsheetApp.getActive().getSheetByName('Events');
  const map = headerMap_(sh);
  const width = sh.getLastColumn();
  const rows = events.map((ev) => {
    const row = new Array(width).fill('');
    Object.keys(EVENT_COLS).forEach((k) => {
      const col = map[EVENT_COLS[k]];
      if (!col) return;
      let v = ev[k];
      if (k === 'show') v = v !== false;
      else if (k === 'price' || k === 'max') v = v === '' || v == null || isNaN(Number(v)) ? '' : Number(v);
      else v = String(v == null ? '' : v);
      row[col - 1] = v;
    });
    return row;
  });
  replaceRows_(sh, rows, [map.Show]);
  if (rows.length && map.Button) {
    sh.getRange(2, map.Button, rows.length, 1).setDataValidation(SpreadsheetApp.newDataValidation().requireValueInList(EVENT_BUTTONS, true).build());
  }
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

// Settings safe to send to the website. Blocked ranges go out as a plain list of dates; weekLoads tells the
// site how many cookies each upcoming week already has, so it can explain when a week is full.
function publicConfig_(cfg) {
  const out = {};
  Object.keys(cfg).forEach((k) => { if (PRIVATE_SETTINGS.indexOf(k) === -1 && ['blockedRanges', 'weekCounts'].indexOf(k) === -1) out[k] = cfg[k]; });
  out.blockedDates = blockedDates_(cfg);
  out.weekLoads = {};
  Object.keys(cfg.weekCounts || {}).forEach((w) => { out.weekLoads[w] = { custom: cfg.weekCounts[w].custom.approved, artisan: cfg.weekCounts[w].artisan.approved }; });
  return out;
}

// Every date inside a blocked range, from today on (at most two years out).
function blockedDates_(cfg) {
  const today = todayISO_();
  const out = [];
  (cfg.blockedRanges || []).forEach((r) => {
    let d = r.start < today ? today : r.start;
    for (let n = 0; d <= r.end && n < 731; n++, d = addDaysISO_(d, 1)) if (out.indexOf(d) === -1) out.push(d);
  });
  return out.sort();
}

// Monday (yyyy-mm-dd) of the Mon-Sun week a date falls in.
function mondayOf_(iso) {
  const p = iso.split('-').map(Number);
  const dow = new Date(Date.UTC(p[0], p[1] - 1, p[2])).getUTCDay();   // 0 = Sunday
  return addDaysISO_(iso, -((dow + 6) % 7));
}

function clearConfigCache_() { CacheService.getScriptCache().remove(CONFIG_CACHE_KEY); }

// Simple trigger: Melissa (or the admin) editing the Sheet makes the website pick up changes right away.
function onEdit() { clearConfigCache_(); }

// admin: the admin page's copy, which keeps hidden events/gallery photos (with a show flag) and
// leaves ownerEmail / replyToEmail blank when they're blank in the Sheet.
function buildConfig_(admin) {
  const ss = SpreadsheetApp.getActive();
  const cfg = {};

  const types = {};
  SETTINGS_SPEC.forEach((s) => { types[s[0]] = s[2]; cfg[s[0]] = parseSetting_(String(s[1]), s[2]); });
  rows_(ss.getSheetByName('Settings')).forEach((r) => {
    const key = String(r[0]).trim();
    if (!key) return;
    cfg[key] = parseSetting_(r[1], types[key] || 'text');
  });
  if (!admin) {
    if (!cfg.ownerEmail) cfg.ownerEmail = Session.getEffectiveUser().getEmail();
    if (!cfg.replyToEmail) cfg.replyToEmail = cfg.ownerEmail;
  }

  cfg.flavors = rows_(ss.getSheetByName('Flavors'))
    .filter((r) => String(r[0]).trim() && String(r[1]).trim())
    .map((r) => ({ id: String(r[0]).trim(), name: String(r[1]).trim(), on: truthy_(r[2]), special: truthy_(r[3]) }));

  cfg.zones = rows_(ss.getSheetByName('Zones'))
    .filter((r) => String(r[0]).trim())
    .map((r) => ({ zip: String(r[0]).trim(), area: String(r[1]).trim(), fee: Number(r[2]) || 0 }));

  // Blocked ranges (End blank = just the Start day). Ranges that have ended are dropped.
  const today = todayISO_();
  cfg.blockedRanges = rowObjects_(ss.getSheetByName('BlockedDates'))
    .map((r) => {
      const start = toISODate_(r.Start);
      const end = toISODate_(r.End) || start;
      return { start, end: end < start ? start : end, note: String(r.Note || '').trim() };
    })
    .filter((r) => r.start && r.end >= today)
    .sort((a, b) => (a.start < b.start ? -1 : 1));

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

  // Events: classes ("Add to bag") show how many spots are left.
  const counts = bookingCounts_();
  cfg.events = rowObjects_(ss.getSheetByName('Events'))
    .filter((r) => (admin || truthy_(r.Show)) && String(r.Title || '').trim())
    .map((r, i) => {
      const num = (v) => (v === '' || v == null || isNaN(Number(v)) ? '' : Number(v));
      const ev = {
        id: String(r.ID || '').trim() || ('row' + (i + 2)), title: String(r.Title).trim(), date: toISODate_(r.Date),
        start: timeText_(r['Start time']), end: timeText_(r['End time']), address: String(r.Address || '').trim(),
        price: num(r.Price), max: num(r['Max attendees']), desc: String(r.Description || '').trim(), photo: String(r.Photo || '').trim(),
        when: String(r.When || '').trim(), button: EVENT_BUTTONS.indexOf(String(r.Button)) !== -1 ? String(r.Button) : 'None',
        venue: String(r.Location || '').trim(), summary: String(r['Card line'] || '').trim(), flyer: String(r.Flyer || '').trim()
      };
      ev.booked = counts.seats[ev.id] || 0;
      if (ev.max !== '') ev.spotsLeft = Math.max(0, ev.max - ev.booked);
      if (admin) ev.show = truthy_(r.Show);
      return ev;
    });

  cfg.gallery = rows_(ss.getSheetByName('Gallery'))
    .filter((r) => (admin || truthy_(r[0])) && String(r[1]).trim())
    .map((r) => {
      const g = { photo: String(r[1]).trim(), caption: String(r[2]).trim() };
      if (admin) g.show = truthy_(r[0]);
      return g;
    });

  // Cookies per upcoming week, for the weekly caps.
  cfg.weekCounts = {};
  const thisWeek = mondayOf_(today);
  Object.keys(counts.weeks).forEach((w) => { if (w >= thisWeek) cfg.weekCounts[w] = counts.weeks[w]; });

  // Whether class checkout goes on to Square (the site words the Book button and note to match).
  cfg.classesPayOnline = squareReady_();

  return cfg;
}

// Cookie orders count toward a week's cap once approved. Class bookings hold their spots until cancelled.
const COUNTED_STATUSES = ['Invoice sent', 'Paid', 'Baking', 'Ready', 'Completed'];
// Classes paid through Square start as "Awaiting payment" (spot held classHoldMinutes) and become "Paid" once Square
// says so; unpaid ones become "Expired". "Booked" = confirmed without online payment (Square not set up, or by hand).
const CLASS_STATUSES = ['Awaiting payment', 'Booked', 'Paid', 'Completed', 'Cancelled', 'Expired'];
const CLASS_HOLDS_SPOT = ['Awaiting payment', 'Booked', 'Paid', 'Completed'];

// From the Orders + OrderItems tabs:
//   weeks: { '2026-11-02': { custom: { approved, pending }, artisan: { approved, pending } } } (Monday of each week)
//   seats: { eventId: seats booked }
function bookingCounts_() {
  const ss = SpreadsheetApp.getActive();
  const orders = {};
  rowObjects_(ss.getSheetByName('Orders')).forEach((o) => {
    orders[String(o.Order).trim()] = { status: String(o.Status || '').trim(), date: toISODate_(o['Date needed']) };
  });
  const weeks = {}, seats = {};
  rowObjects_(ss.getSheetByName('OrderItems')).forEach((it) => {
    const o = orders[String(it.Order).trim()];
    if (!o) return;
    const kind = String(it.Kind), qty = Number(it.Qty) || 0;
    if (kind === 'class') {
      if (CLASS_HOLDS_SPOT.indexOf(o.status) !== -1) seats[String(it['Event ID'])] = (seats[String(it['Event ID'])] || 0) + qty;
      return;
    }
    if (!o.date) return;
    const w = mondayOf_(o.date);
    const type = kind === 'custom' ? 'custom' : 'artisan';
    weeks[w] = weeks[w] || { custom: { approved: 0, pending: 0 }, artisan: { approved: 0, pending: 0 } };
    if (COUNTED_STATUSES.indexOf(o.status) !== -1) weeks[w][type].approved += qty;
    else if (o.status === 'Pending review') weeks[w][type].pending += qty;
  });
  return { weeks, seats };
}

// A time cell as text, e.g. "2:00 PM" (Sheets may store times as dates).
function timeText_(v) {
  if (v instanceof Date && !isNaN(v)) return Utilities.formatDate(v, tz_(), 'h:mm a');
  return String(v == null ? '' : v).trim();
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

function itemLabel_(kind) { return kind === 'custom' ? 'Custom Cookies' : kind === 'mini' ? 'Mini Artisan' : kind === 'class' ? 'Class' : 'Large Artisan'; }

// admin: a phone order from the admin page (adminCreateOrder): no rate limit, no "taking orders" switch, rule
// warnings need confirmWarnings, classes are booked without Square, and no request / new-order emails go out.
function submitOrder_(b, admin) {
  // A retry of a checkout that already went through (e.g. the connection dropped before the reply arrived)
  // gets the original result back instead of creating a second order.
  const sid = clean_(b.submissionId, 60);
  const cache = CacheService.getScriptCache();
  if (sid) { const seen = cache.get('sub_' + sid); if (seen) return JSON.parse(seen); }

  const cfg = getConfig_();
  const hasCookies = (b.items || []).some((it) => it && it.kind !== 'class');
  if (hasCookies && !cfg.acceptingOrders && !admin) return { ok: false, code: 'closed', error: 'Sorry, I’m not taking new cookie orders right now.' };

  const v = validateOrder_(cfg, b, admin);
  if (v.errors.length) return { ok: false, code: 'invalid', errors: v.errors };
  if (admin && v.warnings.length && !b.confirmWarnings) return { ok: false, code: 'warn', warnings: v.warnings };

  if (!admin && rateLimited_('order', v.customer.email, 5)) {
    return { ok: false, code: 'rate', error: 'We’ve received several requests from this email in the last hour. Please try again later or send a message instead.' };
  }

  // Inspiration photos go to Drive before the lock (it's the slow part); renamed with the order number below.
  const photoFiles = [];
  if (v.cookie) {
    v.cookie.items.forEach((it) => {
      if (!it.photos) return;
      const r = savePhotos_(it.photos, 'Order photo – ' + v.customer.name);
      it.photoCell = r.cell;
      it.photos = r.saved;
      r.saved.forEach((s) => photoFiles.push(s.id));
    });
  }

  const lock = LockService.getScriptLock();
  lock.waitLock(20000);
  const placed = [];   // [{ order, row }]
  try {
    // Re-check class spots and the code's balance now that no one else can book at the same time.
    if (v.cls) {
      const seats = bookingCounts_().seats;
      for (const it of v.cls.items) {
        const ev = cfg.events.find((e) => e.id === it.eventId);
        if (ev && ev.max !== '' && (seats[it.eventId] || 0) + it.qty > ev.max) {
          const left = Math.max(0, ev.max - (seats[it.eventId] || 0));
          return { ok: false, code: 'invalid', errors: [left ? 'fewer spots in ' + ev.title + ' (only ' + left + ' left)' : ev.title + ' is now sold out. Please remove it'] };
        }
      }
    }
    const code = v.code ? lookupCode_(v.code.code) : null;
    if (v.code && !code) return { ok: false, code: 'invalid', errors: ['a valid promo or gift code (or remove it)'] };
    if (code && code.type === 'Gift card' && v.cls && v.cls.giftCredit > code.balance) {
      v.cls.giftCredit = round2_(code.balance);
      v.cls.total = round2_(v.cls.subtotal - v.cls.discount - v.cls.giftCredit);
    }

    const ss = SpreadsheetApp.getActive();
    const now = new Date();
    [v.cls, v.cookie].forEach((o) => {
      if (!o) return;
      o.number = 'SN-' + nextCounter_('nextOrder');
      o.createdAt = now;
      // Classes are paid at checkout through Square when it's set up (the spot is held until then); a class that's
      // free after a gift card, or with Square not set up, is booked right away.
      o.status = o.type === 'Class' ? (!admin && squareReady_() && o.total > 0 ? 'Awaiting payment' : 'Booked') : 'Pending review';
      if (o.type === 'Class') {
        o.invoice = { lines: startingLines_(o), fee: 0, subtotal: round2_(o.subtotal - o.discount), tax: 0, credit: o.giftCredit, total: o.total, note: '', changed: false, sentAt: now.toISOString() };
      }
      const row = appendObject_(ss.getSheetByName('Orders'), {
        'Order': o.number, 'Received': now, 'Status': o.status, 'Type': o.type,
        'Name': o.customer.name, 'Email': o.customer.email, 'Phone': o.customer.phone,
        'Occasion': o.eventType, 'Date needed': o.dateNeeded,
        'Pickup / drop-off': o.type === 'Class' ? 'Class' : o.fulfillment === 'delivery' ? 'Drop-off' : 'Pickup',
        'Street': o.address ? o.address.street : '', 'City': o.address ? o.address.city : '', 'ZIP': o.address ? o.address.zip : '',
        'Allergies': o.allergies, 'Event time': o.eventTime, 'Pickup window': o.pickupWindow, 'Subtotal': o.subtotal, 'Tax': o.tax, 'Tax rate': o.taxRate, 'Drop-off fee': o.deliveryFee,
        'Estimated total': o.total, 'Promo code': o.promoCode, 'Discount': o.discount, 'Gift card credit': o.giftCredit,
        'Invoice': o.invoice ? JSON.stringify(o.invoice) : '', 'Submission ID': admin ? 'phone' : sid,
        'Customer email': admin ? 'Not sent (phone order)' : 'Sending…', 'Owner alert': admin ? 'Phone order' : 'Sending…', 'Updated': now
      });
      appendObjects_(ss.getSheetByName('OrderItems'), o.items.map((it, i) => ({
        'Order': o.number, 'Line': i + 1, 'Item': itemLabel_(it.kind) + (it.kind === 'class' ? ': ' + it.title : ''), 'Kind': it.kind, 'Qty': it.qty,
        'Designs': it.kind === 'custom' ? it.designs : '', 'Flavors': it.kind === 'mini' || it.kind === 'large' ? it.summary : '',
        'Flavors (data)': it.fq ? JSON.stringify(it.fq) : '', 'Description': it.kind === 'class' ? it.summary : (it.desc || ''), 'Photo': it.photoCell || '',
        'Unit price': it.unit, 'Line total': it.lineTotal, 'Event ID': it.eventId || ''
      })));
      placed.push({ order: o, row });
    });
    // A percent code counts one use per checkout; a gift card is charged now for classes (cookie orders: when approved).
    if (code) useCode_(code, v.cls ? v.cls.giftCredit : 0);
    SpreadsheetApp.flush();
  } finally {
    lock.releaseLock();
  }
  clearConfigCache_();   // class spots changed
  photoFiles.forEach((id, i) => renamePhoto_(id, v.cookie.number + ' photo ' + (i + 1) + ' – ' + v.customer.name));

  const sh = SpreadsheetApp.getActive().getSheetByName('Orders');
  placed.forEach(({ order: o, row }) => {
    // Phone orders: nothing goes out now. A class booking can send its confirmation if Melissa ticked the box.
    if (admin) {
      if (o.type === 'Class' && b.sendClassEmail) setCell_(sh, row, 'Customer email', sendSafely_(() => sendClassBookingEmail_(cfg, o)));
      return;
    }
    if (o.status === 'Awaiting payment') {
      // Square checkout link. No emails yet: the confirmation and owner alert go out once the payment goes through.
      try {
        const link = squarePaymentLink_(cfg, o);
        o.payUrl = link.url;
        o.invoice.square = { linkId: link.id, orderId: link.orderId, url: link.url };
        setCell_(sh, row, 'Invoice', JSON.stringify(o.invoice));
        setCell_(sh, row, 'Square order', link.orderId);
        setCell_(sh, row, 'Pay link', link.url);
        setCell_(sh, row, 'Customer email', 'Waiting for payment');
        setCell_(sh, row, 'Owner alert', 'Waiting for payment');
        return;
      } catch (err) {
        // Square didn't answer: book it anyway and let Melissa collect payment another way.
        console.error('Square payment link failed', err && err.stack || err);
        o.status = 'Booked';
        setCell_(sh, row, 'Status', 'Booked');
        setCell_(sh, row, 'Pay link', 'FAILED: ' + String(err && err.message || err).slice(0, 200));
      }
    }
    const toCustomer = o.type === 'Class' ? () => sendClassBookingEmail_(cfg, o) : () => sendOrderRequestEmail_(cfg, o);
    const toOwner = o.type === 'Class' ? () => sendOwnerClassAlert_(cfg, o) : () => sendOwnerOrderAlert_(cfg, o);
    setCell_(sh, row, 'Customer email', sendSafely_(toCustomer));
    setCell_(sh, row, 'Owner alert', sendSafely_(toOwner));
  });

  const pub = (o) => ({
    number: o.number, type: o.type, status: o.status, createdAt: o.createdAt.toISOString(), items: o.items, eventType: o.eventType,
    dateNeeded: o.dateNeeded, allergies: o.allergies, eventTime: o.eventTime, pickupWindow: o.pickupWindow, fulfillment: o.fulfillment, address: o.address, customer: o.customer,
    subtotal: o.subtotal, discount: o.discount, promoCode: o.promoCode, tax: o.tax, deliveryFee: o.deliveryFee, giftCredit: o.giftCredit,
    total: o.total, taxRate: o.taxRate, payUrl: o.payUrl || ''
  });
  const orders = placed.map((p) => pub(p.order));
  const result = { ok: true, orders, order: orders.find((o) => o.type === 'Cookies') || orders[0] };
  if (sid) { try { cache.put('sub_' + sid, JSON.stringify(result), 21600); } catch (e) { /* too large: fine */ } }
  return result;
}

// Admin "Add phone order": the same order as the website checkout (see submitOrder_'s admin notes).
function adminCreateOrder(b) {
  requireOwner_();
  const r = submitOrder_(b || {}, true);
  if (r.ok) { clearConfigCache_(); r.weekCounts = weekCountsNow_(); }
  return r;
}

// Returns { errors: [...short phrases for "Still needed: ..."], warnings, customer, cookie, cls, code }.
// A checkout can hold cookies (sent for review) and classes (booked right away); each becomes its own order.
// admin (a phone order from the admin page): any date is fine (no lead time, blocked days or weekly limits), and the
// other shop rules become warnings Melissa can confirm (small quantities, extra flavors, out-of-area drop-off).
function validateOrder_(cfg, b, admin) {
  const errors = [];
  const warnings = [];
  const rule = (msg) => (admin ? warnings : errors).push(msg);
  const today = todayISO_();
  const flavorsById = {};
  cfg.flavors.forEach((f) => { if (f.on) flavorsById[f.id] = f; });

  const rawItems = Array.isArray(b.items) ? b.items.slice(0, MAX_ITEMS) : [];
  if (!rawItems.length) errors.push('at least one item in your bag');
  const cookies = [], classes = [];
  rawItems.forEach((raw) => {
    const kind = String(raw && raw.kind);
    const label = itemLabel_(kind);
    if (kind === 'custom') {
      const qty = Math.floor(Number(raw.qty));
      const designs = Math.floor(Number(raw.designs));
      const desc = clean_(raw.desc, 3000);
      if (!(qty >= 1 && qty <= MAX_QTY)) errors.push(label + ': a quantity');
      else if (qty < cfg.minQty) rule(label + ': at least ' + cfg.minQty + ' cookies');
      if (!(designs >= 1 && designs <= (admin ? 24 : cfg.maxDesigns))) errors.push(label + ': 1 to ' + cfg.maxDesigns + ' designs');
      else if (designs > cfg.maxDesigns) rule(label + ': more than ' + cfg.maxDesigns + ' designs');
      if (!desc) errors.push(label + ': a description of your cookies');
      const unit = Number(cfg.customBasePrice) || 0;
      cookies.push({
        kind, qty, designs, desc, photos: incomingPhotos_(raw), unit: round2_(unit), lineTotal: round2_(qty * unit),
        summary: designs + ' design' + (designs > 1 ? 's' : '') + ' · estimated at ' + money_(unit) + ' each' + photoCount_(incomingPhotos_(raw).length)
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
      const max = flavorLimit_(cfg, qty);
      if (!(qty >= 1) || qty > MAX_QTY) errors.push(label + ': pick some flavors');
      else if (qty < cfg.minQty) rule(label + ': at least ' + cfg.minQty + ' cookies');
      if (qty >= 1 && used > max) rule(label + ': up to ' + max + ' flavors for ' + qty + ' cookies');
      const unit = (kind === 'mini' ? cfg.miniPerDozen : cfg.largePerDozen) / 12;
      cookies.push({
        kind, qty, fq, unit: round2_(unit), lineTotal: round2_(qty * unit),
        flavorNames: Object.keys(fq).reduce((a, id) => { a[id] = flavorsById[id].name; return a; }, {}),
        summary: Object.keys(fq).map((id) => fq[id] + ' ' + flavorsById[id].name).join(', ')
      });
    } else if (kind === 'class') {
      const ev = cfg.events.find((e) => e.id === String(raw.eventId) && e.button === 'Add to bag' && Number(e.price) > 0);
      const qty = Math.floor(Number(raw.qty));
      if (!ev) { errors.push('a class that’s no longer available was in your bag. Please remove it'); return; }
      if (ev.date && ev.date < today) { errors.push(ev.title + ' has already happened. Please remove it'); return; }
      if (!(qty >= 1 && qty <= 20)) { errors.push(ev.title + ': 1 to 20 spots'); return; }
      if (ev.spotsLeft !== undefined && qty > ev.spotsLeft) {
        errors.push(ev.spotsLeft ? 'fewer spots in ' + ev.title + ' (only ' + ev.spotsLeft + ' left)' : ev.title + ' is sold out. Please remove it');
        return;
      }
      classes.push({ kind, eventId: ev.id, title: ev.title, date: ev.date, start: ev.start, end: ev.end, address: [ev.venue, ev.address].filter(Boolean).join(', '), qty, unit: round2_(ev.price), lineTotal: round2_(qty * ev.price), summary: classWhen_(ev) });
    } else {
      errors.push('a valid item');
    }
  });

  const c = b.customer || {};
  const customer = { name: clean_(c.name, 120), email: clean_(c.email, 200), phone: formatPhone_(clean_(c.phone, 40)) };
  if (!customer.name) errors.push('name');
  if (!validEmail_(customer.email)) errors.push('a valid email');
  if (!customer.phone) errors.push('a 10-digit phone number');

  let code = null;
  if (clean_(b.code, 40)) {
    code = lookupCode_(b.code);
    if (!code) errors.push('a valid promo or gift code (or remove it)');
  }
  const pct = code && code.type === 'Percent off' ? Math.min(100, Math.max(0, code.amount)) : 0;
  let giftLeft = code && code.type === 'Gift card' ? code.balance : 0;

  // Classes: no tax. A gift card is used on classes first, since they're paid now.
  let cls = null;
  if (classes.length) {
    const subtotal = round2_(classes.reduce((a, it) => a + it.lineTotal, 0));
    const discount = round2_(subtotal * pct / 100);
    const giftCredit = round2_(Math.min(giftLeft, subtotal - discount));
    giftLeft = round2_(giftLeft - giftCredit);
    cls = {
      type: 'Class', items: classes, eventType: '', dateNeeded: classes.map((it) => it.date).filter(Boolean).sort()[0] || '', allergies: '', eventTime: '', pickupWindow: '',
      fulfillment: 'class', address: null, customer, subtotal, discount, tax: 0, deliveryFee: 0, giftCredit,
      total: round2_(subtotal - discount - giftCredit), taxRate: 0, promoCode: code ? code.code : ''
    };
  }

  let cookie = null;
  if (cookies.length) {
    // The occasion is required for custom cookies (it shapes the design) and optional for artisan-only orders.
    let eventType = clean_(b.eventType, 40);
    const eventOther = clean_(b.eventOther, 120);
    if (eventType || cookies.some((it) => it.kind === 'custom')) {
      if (EVENT_TYPES.indexOf(eventType) === -1) errors.push('event type');
      else if (eventType === 'Other') { if (!eventOther) errors.push('the occasion'); else eventType = 'Other: ' + eventOther; }
    }

    const dateNeeded = toISODate_(b.dateNeeded);
    const minISO = addDaysISO_(today, Number(cfg.leadDays) || 0);
    if (!dateNeeded) errors.push('date needed');
    else if (admin) { /* phone orders can be any date: Melissa already agreed to it */ }
    else if (dateNeeded < minISO) errors.push('a date at least ' + cfg.leadDays + ' days out');
    else if (blockedDates_(cfg).indexOf(dateNeeded) !== -1) errors.push('a different date (that day is booked)');
    else weekCapErrors_(cfg, dateNeeded, cookies).forEach((e) => errors.push(e));

    const fulfillment = b.fulfillment === 'delivery' ? 'delivery' : 'pickup';
    let address = null, deliveryFee = 0;
    if (fulfillment === 'delivery') {
      const a = b.address || {};
      address = { street: clean_(a.street, 200), city: clean_(a.city, 80), zip: clean_(a.zip, 5).replace(/\D/g, '') };
      if (!address.street || !address.city) errors.push('drop-off address');
      const zone = cfg.zones.find((z) => z.zip === address.zip);
      const ownFee = admin && b.deliveryFee !== '' && b.deliveryFee != null && !isNaN(Number(b.deliveryFee)) ? Math.max(0, Number(b.deliveryFee)) : null;
      if (ownFee !== null) { deliveryFee = round2_(ownFee); if (!zone) warnings.push('a drop-off outside your zones (' + (address.zip || 'no ZIP') + ')'); }
      else if (!zone) errors.push(admin ? 'a drop-off fee (that ZIP isn’t in your zones)' : 'a ZIP in our drop-off area');
      else deliveryFee = Number(zone.fee) || 0;
    }

    // Tax is on the cookies after any percent discount; the drop-off fee isn't taxed. A gift card comes off last.
    const subtotal = round2_(cookies.reduce((a, it) => a + it.lineTotal, 0));
    const discount = round2_(subtotal * pct / 100);
    const tax = 0;   // sales tax is worked out by QuickBooks on the invoice (by address and item type)
    const beforeCredit = round2_(subtotal - discount + tax + deliveryFee);
    const giftCredit = round2_(Math.min(giftLeft, beforeCredit));
    cookie = {
      type: 'Cookies', items: cookies, eventType, dateNeeded, allergies: clean_(b.allergies, 1000), eventTime: clean_(b.eventTime, 60), pickupWindow: clean_(b.pickupWindow, 300), fulfillment, address, customer,
      subtotal, discount, tax, deliveryFee, giftCredit, total: round2_(beforeCredit - giftCredit), taxRate: 0, promoCode: code ? code.code : ''
    };
  }

  return { errors: errors.filter((e, i) => errors.indexOf(e) === i), warnings: warnings.filter((e, i) => warnings.indexOf(e) === i), customer, cookie, cls, code };
}

// Artisan flavor limit: flavorsPerDozen (4) below flavorsMaxAt cookies (24), then flavorsMax (6).
function flavorLimit_(cfg, qty) {
  return qty >= (Number(cfg.flavorsMaxAt) || 24) ? (Number(cfg.flavorsMax) || 6) : (Number(cfg.flavorsPerDozen) || 4);
}

// Weekly caps (Mon-Sun): would these cookies push the week past capCustomPerWeek / capArtisanPerWeek?
function weekCapErrors_(cfg, dateNeeded, cookies) {
  const errors = [];
  const week = (cfg.weekCounts || {})[mondayOf_(dateNeeded)] || { custom: { approved: 0 }, artisan: { approved: 0 } };
  [['custom', 'capCustomPerWeek', 'custom'], ['artisan', 'capArtisanPerWeek', 'artisan']].forEach(([type, key, word]) => {
    const cap = Number(cfg[key]) || 0;
    const qty = cookies.filter((it) => (type === 'custom') === (it.kind === 'custom')).reduce((a, it) => a + it.qty, 0);
    if (!cap || !qty) return;
    const left = Math.max(0, cap - week[type].approved);
    if (qty > left) errors.push(left ? 'a different week (that week only has room for ' + left + ' more ' + word + ' cookies)' : 'a different week (' + word + ' cookies are fully booked that week)');
  });
  return errors;
}

// "Sat, Dec 6 · 2:00 PM–4:00 PM"
function classWhen_(ev) {
  const day = ev.date ? Utilities.formatDate(new Date(ev.date + 'T12:00:00Z'), 'UTC', 'EEE, MMM d') : '';
  const time = ev.start ? ev.start + (ev.end ? '–' + ev.end : '') : '';
  return [day, time].filter(Boolean).join(' · ');
}

/* ----- Promo and gift codes (Codes tab) ----- */

// A usable code, or null. Percent off: active, not expired, under its use limit. Gift card: also has a balance.
function lookupCode_(raw) {
  const want = String(raw || '').trim().toUpperCase();
  if (!want) return null;
  const sh = SpreadsheetApp.getActive().getSheetByName('Codes');
  if (!sh) return null;
  const today = todayISO_();
  const rows = rowObjects_(sh);
  for (let i = 0; i < rows.length; i++) {
    const r = rows[i];
    if (String(r.Code || '').trim().toUpperCase() !== want) continue;
    const c = {
      code: String(r.Code).trim(), type: String(r.Type), amount: Number(r.Amount) || 0, balance: round2_(Number(r.Balance) || 0),
      active: truthy_(r.Active), expires: toISODate_(r.Expires), maxUses: Number(r['Max uses']) || 0, uses: Number(r.Uses) || 0, row: i + 2
    };
    if (!c.active || (c.expires && c.expires < today) || (c.maxUses && c.uses >= c.maxUses)) return null;
    if (c.type === 'Gift card' && c.balance <= 0) return null;
    if (c.type !== 'Gift card' && c.type !== 'Percent off') return null;
    return c;
  }
  return null;
}

// Record a use: +1 use, and for a gift card take `credit` off the balance. Call inside the script lock.
function useCode_(c, credit) {
  const sh = SpreadsheetApp.getActive().getSheetByName('Codes');
  const map = headerMap_(sh);
  sh.getRange(c.row, map.Uses).setValue((Number(sh.getRange(c.row, map.Uses).getValue()) || 0) + 1);
  if (c.type === 'Gift card' && credit > 0) {
    const bal = Number(sh.getRange(c.row, map.Balance).getValue()) || 0;
    sh.getRange(c.row, map.Balance).setValue(round2_(Math.max(0, bal - credit)));
  }
}

// Checkout's "Apply" button. Says what the code does without revealing anything about other codes.
function checkCode_(b) {
  if (rateLimited_('code', 'all', 300)) return { ok: false, error: 'Please try again in a little while.' };
  const c = lookupCode_(b.code);
  if (!c) return { ok: false, error: 'That code isn’t valid or has expired.' };
  return c.type === 'Gift card'
    ? { ok: true, code: c.code, type: 'gift', amount: c.balance }
    : { ok: true, code: c.code, type: 'percent', amount: c.amount };
}

// Append several rows using the tab's header names as keys.
function appendObjects_(sh, objs) {
  if (!objs.length) return;
  const headers = sh.getRange(1, 1, 1, sh.getLastColumn()).getValues()[0];
  const rows = objs.map((o) => headers.map((h) => (h in o ? cell_(o[h]) : '')));
  sh.getRange(sh.getLastRow() + 1, 1, rows.length, headers.length).setValues(rows);
}

// Runs a send and returns a short status for the Sheet ("Sent 10/19 2:14 PM" or "FAILED: ...").
function sendSafely_(fn) {
  try {
    mailQueued_ = false;
    fn();
    const when = Utilities.formatDate(new Date(), tz_(), 'M/d h:mm a');
    return mailQueued_ ? 'Queued ' + when + ' (sends from the shop’s email within 5 min)' : 'Sent ' + when;
  } catch (err) {
    console.error('Email failed', err && err.stack || err);
    return 'FAILED: ' + String(err && err.message || err).slice(0, 200);
  }
}


// Every email goes through here. Running as the shop's account it's sent now; from an admin helper it waits in
// the Outbox tab and the owner's 5-minute check (sendOutbox_) sends it, so customers always hear from the shop.
let mailQueued_ = false;
function sendMail_(msg) {
  if (runningAsOwner_()) { MailApp.sendEmail(msg); return; }
  appendObject_(SpreadsheetApp.getActive().getSheetByName('Outbox'), {
    'Queued': new Date(), 'To': msg.to, 'Subject': msg.subject, 'Email (data)': JSON.stringify(msg)
  });
  mailQueued_ = true;
}
// Called by checkPayments (only when it runs as the owner). Sent emails leave the Outbox; failures stay to retry.
function sendOutbox_() {
  if (!runningAsOwner_()) return 0;
  const sh = SpreadsheetApp.getActive().getSheetByName('Outbox');
  if (!sh || sh.getLastRow() < 2) return 0;
  const rows = rowObjects_(sh);
  let sent = 0;
  for (let i = rows.length - 1; i >= 0; i--) {   // bottom up, so deleting rows doesn't shift the ones still to do
    try {
      MailApp.sendEmail(JSON.parse(rows[i]['Email (data)']));
      sh.deleteRow(i + 2);
      sent++;
    } catch (err) { console.error('Outbox email failed', rows[i].Subject, err); }
  }
  return sent;
}


/* ============================== Messages ============================== */

/*
 * sendMessage: Contact page form and the site-wide "Message me" pop-out.
 * Saves to the Messages tab and emails the owner with reply-to set to the customer.
 */

const MESSAGE_TOPICS = ['General question', 'Custom design idea', 'Allergies or dietary needs', 'Rush order', 'An existing order', 'Special events or classes', 'Other', 'Quick message'];

function sendMessage_(b) {
  // A retry of a message that already went through (the reply got lost on the way back) gets the same answer
  // instead of saving it twice. Same idea as orders' submissionId.
  const sid = clean_(b.submissionId, 60);
  const cache = CacheService.getScriptCache();
  if (sid) { const seen = cache.get('msg_' + sid); if (seen) return JSON.parse(seen); }
  const result = sendMessageOnce_(b);
  if (sid && result.ok) cache.put('msg_' + sid, JSON.stringify(result), 21600);
  return result;
}

function sendMessageOnce_(b) {
  const m = {
    name: clean_(b.name, 120),
    email: clean_(b.email, 200),
    phone: clean_(b.phone, 40),
    topic: clean_(b.topic, 60),
    orderNumber: clean_(b.orderNumber, 20),
    message: clean_(b.message, 5000),
    photos: [], photoNames: [],
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

  const pics = savePhotos_(incomingPhotos_(b), 'Message photo – ' + (m.name || m.email));
  Object.assign(m, photosFromCell_(pics.cell));

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
      'Phone': m.phone, 'Order': m.orderNumber, 'Message': m.message, 'Photo': pics.cell, 'Source': m.source, 'Owner alert': 'Sending…'
    });
    SpreadsheetApp.flush();
  } finally {
    lock.releaseLock();
  }
  pics.saved.forEach((s, i) => renamePhoto_(s.id, 'Message ' + m.id + ' photo' + (pics.saved.length > 1 ? ' ' + (i + 1) : '') + ' – ' + (m.name || m.email)));
  setCell_(sh, row, 'Owner alert', sendSafely_(() => sendOwnerMessageAlert_(cfg, m)));
  return { ok: true, id: m.id };
}


/* ============================== Admin ============================== */

/*
 * The owner's admin page. Admin.html is a small loader: it pulls the page's look and logic (styles.css,
 * config.js, admin.js) from the website (siteUrl on the Settings tab), so admin changes ship with the site.
 * Every function below the page checks that the caller is the Sheet's owner before doing anything.
 */

function adminPage_() {
  if (!isOwner_()) {
    return HtmlService.createHtmlOutput('<p style="font-family:sans-serif;padding:24px">This page is only for the shop owner. ' +
      'Sign in to Google with the account that owns the Sweet Nothings Sheet, then open the admin link again.</p>').setTitle('Sweet Nothings admin');
  }
  const t = HtmlService.createTemplateFromFile('Admin');
  t.siteUrl = String(getConfig_().siteUrl || '');
  t.v = String(Date.now());
  return t.evaluate().setTitle('Admin · Sweet Nothings by M').addMetaTag('viewport', 'width=device-width, initial-scale=1');
}

// True only for the Google account that owns this Sheet (the email is blank for anonymous visitors).
// The Sheet's owner (the shop's Google account).
function ownerEmail_() {
  const owner = SpreadsheetApp.getActive().getOwner();
  return String(owner ? owner.getEmail() : Session.getEffectiveUser().getEmail()).toLowerCase();
}
// Emails on the Settings tab's adminHelpers list.
function adminHelpers_() {
  return String(getConfig_().adminHelpers || '').toLowerCase().split(/[\s,;]+/).filter((e) => /@/.test(e));
}
// The admin is for the owner and the people on adminHelpers.
function isOwner_() {
  const me = String(Session.getActiveUser().getEmail() || '').toLowerCase();
  if (!me) return false;
  return me === ownerEmail_() || adminHelpers_().indexOf(me) !== -1;
}
function requireOwner_() { if (!isOwner_()) throw new Error('Only the shop owner can do that.'); }
// True when this code runs as the shop's account (the website, the 5-minute check, or the owner in the admin);
// false for a helper using the admin, whose emails go through the Outbox instead (see sendMail_).
function runningAsOwner_() { return String(Session.getEffectiveUser().getEmail() || '').toLowerCase() === ownerEmail_(); }

// When the owner saves settings: helpers get edit access to the Sheet and can see customers' photos (the admin
// needs both, since it runs as whoever is using it). Removing someone from the list doesn't take access away.
function shareWithHelpers_() {
  if (!runningAsOwner_()) return;
  const helpers = adminHelpers_();
  if (!helpers.length) return;
  const ss = SpreadsheetApp.getActive();
  const editors = ss.getEditors().map((u) => u.getEmail().toLowerCase());
  helpers.filter((e) => editors.indexOf(e) === -1).forEach((e) => { try { ss.addEditor(e); } catch (err) { console.error('Share failed', e, err); } });
  try {
    const folder = uploadFolder_();
    const viewers = folder.getViewers().concat(folder.getEditors()).map((u) => u.getEmail().toLowerCase());
    helpers.filter((e) => viewers.indexOf(e) === -1).forEach((e) => { try { folder.addViewer(e); } catch (err) { console.error('Folder share failed', e, err); } });
  } catch (err) { console.error('Folder share failed', err); }
}

// Everything the admin page shows.
function adminLoad() {
  requireOwner_();
  const cfg = buildConfig_(true);
  const draft = getDraft_();
  return {
    config: cfg, stamp: settingsStamp_(cfg), draft: draft,
    orders: readOrders_(), messages: readMessages_(), weekCounts: cfg.weekCounts, codes: readCodes_(),
    sheetUrl: SpreadsheetApp.getActive().getUrl(), today: todayISO_()
  };
}

// Cookies per upcoming week (see bookingCounts_), for the admin after an order changes.
function weekCountsNow_() {
  const thisWeek = mondayOf_(todayISO_());
  const weeks = bookingCounts_().weeks;
  const out = {};
  Object.keys(weeks).forEach((w) => { if (w >= thisWeek) out[w] = weeks[w]; });
  return out;
}

// Fingerprint of the editable settings, to notice edits made in the Sheet while the admin page was open.
// Booking counts are left out: they change with orders, not edits.
function settingsStamp_(cfg) {
  const c = Object.assign({}, cfg);
  delete c.weekCounts;
  c.events = (c.events || []).map((e) => { const x = Object.assign({}, e); delete x.booked; delete x.spotsLeft; return x; });
  return Utilities.base64Encode(Utilities.computeDigest(Utilities.DigestAlgorithm.MD5, JSON.stringify(c), Utilities.Charset.UTF_8));
}

// Save settings. stamp is what adminLoad returned; if the Sheet changed since then, nothing is saved
// unless force is true.
function adminSaveSettings(c, stamp, force) {
  requireOwner_();
  const lock = LockService.getScriptLock();
  lock.waitLock(20000);
  try {
    const current = settingsStamp_(buildConfig_(true));
    if (!force && stamp && stamp !== current) return { ok: false, conflict: true };
    writeSettings_(c);
    clearDraft_();
    SpreadsheetApp.flush();
    clearConfigCache_();
    const fresh = buildConfig_(true);
    shareWithHelpers_();
    return { ok: true, config: fresh, stamp: settingsStamp_(fresh) };
  } finally {
    lock.releaseLock();
  }
}

function adminSaveDraft(c) {
  requireOwner_();
  const sh = SpreadsheetApp.getActive().getSheetByName('Draft');
  const rows = rows_(sh);
  const i = rows.findIndex((r) => String(r[0]) === 'config');
  const row = ['config', JSON.stringify(c), new Date()];
  if (i === -1) appendRows_(sh, [row]); else sh.getRange(i + 2, 1, 1, 3).setValues([row]);
  return { ok: true };
}
function adminClearDraft() { requireOwner_(); clearDraft_(); return { ok: true }; }
function clearDraft_() {
  const sh = SpreadsheetApp.getActive().getSheetByName('Draft');
  const i = rows_(sh).findIndex((r) => String(r[0]) === 'config');
  if (i !== -1) sh.getRange(i + 2, 2, 1, 2).clearContent();
}

function writeSettings_(c) {
  const ss = SpreadsheetApp.getActive();

  // Settings tab: one row per setting, matched by name.
  const st = ss.getSheetByName('Settings');
  const keys = rows_(st).map((r) => String(r[0]).trim());
  SETTINGS_SPEC.forEach(([key, , type, note]) => {
    if (key === 'images' || c[key] === undefined) return;   // menu photos are saved on the Pages tab
    const v = type === 'json' ? JSON.stringify(c[key]) : type === 'bool' ? (c[key] ? 'TRUE' : 'FALSE') : String(c[key] == null ? '' : c[key]);
    const i = keys.indexOf(key);
    if (i === -1) { appendRows_(st, [[key, cell_(v), note]]); keys.push(key); } else st.getRange(i + 2, 2).setValue(cell_(v));
  });

  replaceRows_(ss.getSheetByName('Flavors'), (c.flavors || []).map((f) => [f.id || ('f' + Date.now().toString(36)), f.name, !!f.on, !!f.special]), [3, 4]);
  replaceRows_(ss.getSheetByName('Zones'), (c.zones || []).filter((z) => /^\d{5}$/.test(z.zip)).map((z) => [z.zip, z.area, Number(z.fee) || 0]));

  // Blocked ranges (Start, End, Note); End blank = just the Start day. Columns matched by header.
  const bd = ss.getSheetByName('BlockedDates');
  const bm = headerMap_(bd);
  replaceRows_(bd, (c.blockedRanges || []).filter((r) => toISODate_(r.start)).map((r) => {
    const row = new Array(bd.getLastColumn()).fill('');
    const start = toISODate_(r.start), end = toISODate_(r.end);
    row[bm.Start - 1] = start;
    row[bm.End - 1] = end && end !== start ? end : '';
    row[bm.Note - 1] = r.note || '';
    return row;
  }));

  replaceRows_(ss.getSheetByName('FAQ'), (c.faqs || []).filter((f) => (f.q || '').trim() || (f.a || '').trim()).map((f) => [f.q, f.a]));

  // Pages tab: update each Text by key, keeping the "Where it shows" column.
  const pg = ss.getSheetByName('Pages');
  const pkeys = rows_(pg).map((r) => String(r[0]).trim());
  Object.keys(c.pages || {}).forEach((key) => {
    const i = pkeys.indexOf(key);
    if (i !== -1) { pg.getRange(i + 2, 2).setValue(cell_(String(c.pages[key] || ''))); return; }
    const starter = STARTER_PAGES.find((p) => p[0] === key);
    appendRows_(pg, [[key, cell_(String(c.pages[key] || '')), starter ? starter[2] : '']]);
    pkeys.push(key);
  });

  // Events keep their IDs (class bookings point at them); new ones get one.
  writeEvents_((c.events || []).filter((e) => (e.title || '').trim()).map((e) => Object.assign({}, e, {
    id: e.id && String(e.id).indexOf('row') !== 0 ? String(e.id) : 'e' + Utilities.getUuid().slice(0, 8),
    button: EVENT_BUTTONS.indexOf(e.button) !== -1 ? e.button : 'None'
  })));

  replaceRows_(ss.getSheetByName('Gallery'), (c.gallery || []).filter((g) => (g.photo || '').trim())
    .map((g) => [g.show !== false, g.photo, g.caption || '']), [1]);
}

// Replace a list tab's rows (below the header) with new ones. checkboxCols: 1-based columns to show as checkboxes.
function replaceRows_(sh, rows, checkboxCols) {
  const last = sh.getLastRow();
  if (last > 1) {
    const old = sh.getRange(2, 1, last - 1, sh.getLastColumn());
    old.clearDataValidations();
    old.clearContent();
  }
  if (!rows.length) return;
  // Checkbox columns need normal formatting: in a plain-text cell, TRUE is stored as text and the box shows unticked.
  (checkboxCols || []).forEach((col) => sh.getRange(2, col, rows.length, 1).setNumberFormat('General'));
  sh.getRange(2, 1, rows.length, rows[0].length).setValues(rows.map((r) => r.map(cell_)));
  (checkboxCols || []).forEach((col) => {
    const range = sh.getRange(2, col, rows.length, 1);
    range.insertCheckboxes();
    range.setValues(rows.map((r) => [r[col - 1] === true]));   // write the ticks again after making them checkboxes
  });
}

/* ----- Orders ----- */

function readOrders_() {
  const ss = SpreadsheetApp.getActive();
  const items = {};
  const ish = ss.getSheetByName('OrderItems');
  const ih = ish.getRange(1, 1, 1, ish.getLastColumn()).getValues()[0];
  rows_(ish).forEach((r) => {
    const g = (h) => r[ih.indexOf(h)];
    const num = String(g('Order')).trim();
    if (!num) return;
    const kind = String(g('Kind'));
    let fq = {};
    try { fq = JSON.parse(g('Flavors (data)') || '{}'); } catch (e) { /* ignore */ }
    const unit = Number(g('Unit price')) || 0;
    const designs = Number(g('Designs')) || 0;
    if (kind === 'class') {
      // Classes: the Item column is "Class: <title>" and Description holds the date and time.
      (items[num] = items[num] || []).push({
        kind, qty: Number(g('Qty')) || 0, eventId: String(g('Event ID') || ''), title: String(g('Item') || '').replace(/^Class: /, ''),
        unit, lineTotal: Number(g('Line total')) || 0, summary: String(g('Description') || '')
      });
      return;
    }
    const pics = photosFromCell_(g('Photo'));
    (items[num] = items[num] || []).push(Object.assign({
      kind, qty: Number(g('Qty')) || 0, designs, desc: String(g('Description') || ''), fq,
      unit, lineTotal: Number(g('Line total')) || 0,
      summary: kind === 'custom'
        ? designs + ' design' + (designs > 1 ? 's' : '') + ' · estimated at ' + money_(unit) + ' each' + photoCount_(pics.photos.length + pics.photoNames.length)
        : String(g('Flavors') || '')
    }, pics));
  });
  const sh = ss.getSheetByName('Orders');
  const h = sh.getRange(1, 1, 1, sh.getLastColumn()).getValues()[0];
  return rows_(sh).map((r) => orderFromRow_(h, r, items)).filter((o) => o.number).reverse();   // newest first
}

function orderFromRow_(h, r, items) {
  const g = (k) => r[h.indexOf(k)];
  const iso = (v) => (v instanceof Date ? v.toISOString() : String(v || ''));
  const how = String(g('Pickup / drop-off'));
  // Times (event time, agreed handoff time) go through timeText_: Sheets turns typed times like "2:00 PM" into time values.
  const delivery = how === 'Drop-off';
  const json = (k, fallback) => { try { return g(k) ? JSON.parse(g(k)) : fallback; } catch (e) { return fallback; } };
  const num = String(g('Order')).trim();
  return {
    number: num, type: String(g('Type') || '') || (how === 'Class' ? 'Class' : 'Cookies'),
    createdAt: iso(g('Received')), status: String(g('Status') || 'Pending review'),
    customer: { name: String(g('Name') || ''), email: String(g('Email') || ''), phone: String(g('Phone') || '') },
    eventType: String(g('Occasion') || ''), dateNeeded: toISODate_(g('Date needed')), allergies: String(g('Allergies') || ''), eventTime: timeText_(g('Event time')), pickupWindow: String(g('Pickup window') || ''),
    fulfillment: how === 'Class' ? 'class' : delivery ? 'delivery' : 'pickup',
    address: delivery ? { street: String(g('Street') || ''), city: String(g('City') || ''), zip: String(g('ZIP') || '') } : null,
    subtotal: Number(g('Subtotal')) || 0, tax: Number(g('Tax')) || 0, taxRate: Number(g('Tax rate')) || 0,
    deliveryFee: Number(g('Drop-off fee')) || 0, total: Number(g('Estimated total')) || 0,
    promoCode: String(g('Promo code') || ''), discount: Number(g('Discount')) || 0, giftCredit: Number(g('Gift card credit')) || 0,
    items: items[num] || [], invoice: json('Invoice', null), declineNote: String(g('Decline note') || ''),
    messages: json('Messages log', []),
    handoff: toISODate_(g('Handoff date')) ? { date: toISODate_(g('Handoff date')), time: timeText_(g('Handoff time')) } : null,
    reminderSent: String(g('Reminder sent') || ''),
    emailStatus: String(g('Customer email') || ''), updatedAt: iso(g('Updated')),
    byPhone: String(g('Submission ID') || '') === 'phone'
  };
}

// Row number (1-based) of an order on the Orders tab, or -1.
function findOrderRow_(sh, number) {
  const col = sh.getRange(2, 1, Math.max(1, sh.getLastRow() - 1), 1).getValues();
  const i = col.findIndex((r) => String(r[0]).trim() === number);
  return i === -1 ? -1 : i + 2;
}

function loadOrder_(number) {
  const o = readOrders_().find((x) => x.number === number);
  if (!o) throw new Error('Order ' + number + ' not found.');
  return o;
}

// The invoice lines an approval starts from (same wording as SN.linesFromOrder on the admin page).
// A percent promo code becomes its own discount line.
function startingLines_(o) {
  const lines = o.items.map((it) => ({
    desc: it.kind === 'class'
      ? 'Class: ' + it.title + (it.summary ? ' (' + it.summary + ')' : '')
      : it.qty + ' ' + itemLabel_(it.kind) + (it.summary ? ' (' + it.summary.replace(/ · estimated at .*?each/, '') + ')' : ''),
    qty: it.qty, unit: round2_(it.unit)
  }));
  if (o.discount) lines.push({ desc: 'Promo code ' + o.promoCode, qty: 1, unit: -round2_(o.discount) });
  return lines;
}

// Approve a pending order: save the final invoice, mark it "Invoice sent" and email the confirmation (email #2).
function adminApprove(number, inv) {
  requireOwner_();
  const lock = LockService.getScriptLock();
  lock.waitLock(20000);
  let o;
  try {
    o = loadOrder_(number);
    if (o.status !== 'Pending review') return { ok: false, error: number + ' is already ' + o.status + '.' };
    const lines = (inv.lines || []).map((l) => ({ desc: clean_(l.desc, 300), qty: Number(l.qty), unit: round2_(Number(l.unit)) }));
    if (!lines.length || lines.some((l) => !l.desc || !(l.qty > 0) || !isFinite(l.unit))) return { ok: false, error: 'Every invoice line needs a description and a quantity.' };
    const fee = o.fulfillment === 'delivery' ? Math.max(0, Number(inv.fee) || 0) : 0;
    const subtotal = round2_(lines.reduce((a, l) => a + l.qty * l.unit, 0));
    const tax = 0;   // QuickBooks adds sales tax to its invoice
    const beforeCredit = round2_(subtotal + tax + fee);
    if (beforeCredit <= 0) return { ok: false, error: 'The invoice total has to be more than $0.' };
    // A gift card comes off last, from its balance right now.
    let credit = 0;
    const gift = o.promoCode ? lookupCode_(o.promoCode) : null;
    if (gift && gift.type === 'Gift card') {
      credit = round2_(Math.min(gift.balance, beforeCredit));
      useCode_(gift, credit);
    }
    const total = round2_(beforeCredit - credit);
    const changed = JSON.stringify(lines) !== JSON.stringify(startingLines_(o)) || fee !== (o.fulfillment === 'delivery' ? o.deliveryFee : 0);
    o.invoice = { lines, fee, subtotal, tax, credit, total, note: clean_(inv.note, 2000), changed, sentAt: new Date().toISOString() };
    o.status = 'Invoice sent';
    const sh = SpreadsheetApp.getActive().getSheetByName('Orders');
    const row = findOrderRow_(sh, number);
    setCell_(sh, row, 'Status', o.status);
    setCell_(sh, row, 'Updated', new Date());
    SpreadsheetApp.flush();
  } finally {
    lock.releaseLock();
  }
  return finishApproval_(o);
}

// Create the QuickBooks invoice (once), then send (or resend) the confirmation email with its Pay link,
// and record how both went on the order. If QuickBooks fails, the approval still stands and admin offers Retry.
function finishApproval_(o) {
  const cfg = getConfig_();
  if (qbReady_() && !(o.invoice.qb && o.invoice.qb.id)) qbInvoiceForOrder_(cfg, o);
  o.invoice.emailStatus = sendSafely_(() => sendConfirmationEmail_(cfg, o));
  saveInvoice_(o);
  clearConfigCache_();   // the week may now be full
  return { ok: true, order: o, weekCounts: weekCountsNow_() };
}

// Write the invoice JSON (and the QuickBooks invoice number / pay link columns) back to the order's row.
function saveInvoice_(o) {
  const sh = SpreadsheetApp.getActive().getSheetByName('Orders');
  const row = findOrderRow_(sh, o.number);
  setCell_(sh, row, 'Invoice', JSON.stringify(o.invoice));
  const qb = o.invoice.qb || {};
  setCell_(sh, row, 'QuickBooks invoice', qb.docNumber ? '#' + qb.docNumber : o.invoice.qbError ? 'FAILED: ' + o.invoice.qbError : '');
  setCell_(sh, row, 'Pay link', qb.link || '');
}

// Admin "Retry" when QuickBooks didn't take the invoice the first time. On success the customer gets the
// confirmation email again, now with the Pay button.
function adminRetryInvoice(number) {
  requireOwner_();
  const o = loadOrder_(number);
  if (!o.invoice || o.type === 'Class') return { ok: false, error: number + ' has no approved invoice.' };
  if (o.invoice.qb && o.invoice.qb.id) return { ok: true, order: o };
  if (!qbReady_()) return { ok: false, error: 'QuickBooks isn’t connected. Connect it on the Payments tab first.' };
  qbInvoiceForOrder_(getConfig_(), o);
  if (o.invoice.qbError) { saveInvoice_(o); return { ok: false, error: 'QuickBooks said: ' + o.invoice.qbError, order: o }; }
  o.invoice.sentAt = new Date().toISOString();
  return finishApproval_(o);
}

function adminResendConfirmation(number) {
  requireOwner_();
  const o = loadOrder_(number);
  if (!o.invoice) return { ok: false, error: number + ' has not been approved yet.' };
  o.invoice.sentAt = new Date().toISOString();
  return finishApproval_(o);
}

function adminDecline(number, note) {
  requireOwner_();
  const o = loadOrder_(number);
  if (o.status !== 'Pending review') return { ok: false, error: number + ' is already ' + o.status + '.' };
  o.status = 'Declined';
  o.declineNote = clean_(note, 2000);
  const sh = SpreadsheetApp.getActive().getSheetByName('Orders');
  const row = findOrderRow_(sh, number);
  setCell_(sh, row, 'Status', 'Declined');
  setCell_(sh, row, 'Decline note', o.declineNote);
  setCell_(sh, row, 'Updated', new Date());
  const emailStatus = sendSafely_(() => sendDeclineEmail_(getConfig_(), o));
  clearConfigCache_();
  return { ok: true, order: o, emailStatus, weekCounts: weekCountsNow_() };
}

// Status changes: cookie orders after approval (Paid, Baking, Ready, Completed); classes Awaiting payment, Booked,
// Paid, Completed, Cancelled or Expired (cancelling or expiring frees the spots). The payment check sets "Paid" itself.
// Confirming a class by hand that was still waiting for payment sends its confirmation emails.
function adminSetStatus(number, status) {
  requireOwner_();
  const o = loadOrder_(number);
  const allowed = o.type === 'Class' ? CLASS_STATUSES : COUNTED_STATUSES.concat(['Cancelled']);
  if (allowed.indexOf(status) === -1) return { ok: false, error: 'Unknown status.' };
  let note = '';
  if (o.type !== 'Class') {
    if (!o.invoice) return { ok: false, error: number + ' hasn’t been approved yet. Use Review → Decline instead.' };
    if (o.status === 'Cancelled') return { ok: false, error: number + ' was cancelled, and its invoice and gift card were undone, so it can’t be reopened. Ask the customer to order again.' };
    // Cancelling an approved cookie order: the gift card amount goes back on the card, and an unpaid QuickBooks
    // invoice is voided so it can't be paid by mistake. Anything already paid is refunded by hand in QuickBooks.
    if (status === 'Cancelled') {
      if (o.invoice.credit > 0 && o.promoCode) refundGiftCard_(o.promoCode, o.invoice.credit);
      note = qbVoidForCancel_(o);
      o.invoice.cancelled = { at: new Date().toISOString(), note };
      saveInvoice_(o);
    }
  }
  if (o.type === 'Class' && ['Awaiting payment', 'Expired'].indexOf(o.status) !== -1 && ['Booked', 'Paid'].indexOf(status) !== -1) {
    confirmClass_(o, status);
    return { ok: true, weekCounts: weekCountsNow_() };
  }
  // Cancelling a class booking: any gift card amount goes back on the card (an expired hold already gave it back).
  // If it was still waiting on Square, its pay link is closed too, so a spot that's been given away can't be paid
  // for later. (Card payments on a paid booking are refunded by hand in Square.)
  if (o.type === 'Class' && status === 'Cancelled' && CLASS_HOLDS_SPOT.indexOf(o.status) !== -1) {
    const sq = (o.invoice && o.invoice.square) || {};
    if (o.status === 'Awaiting payment') {
      try { if (sq.linkId && squareReady_()) squareFetch_('delete', '/v2/online-checkout/payment-links/' + sq.linkId); } catch (e) { /* already gone */ }
    }
    if (o.giftCredit > 0 && o.promoCode) refundGiftCard_(o.promoCode, o.giftCredit);
  }
  const sh = SpreadsheetApp.getActive().getSheetByName('Orders');
  const row = findOrderRow_(sh, number);
  setCell_(sh, row, 'Status', status);
  setCell_(sh, row, 'Updated', new Date());
  clearConfigCache_();
  return { ok: true, weekCounts: weekCountsNow_(), note, order: note ? loadOrder_(number) : undefined };
}

// A cancelled cookie order's QuickBooks invoice: voided if nothing's been paid on it. Returns what happened, for admin.
function qbVoidForCancel_(o) {
  const qb = o.invoice.qb;
  if (!qb || !qb.id) return '';
  if (!qbReady_()) return 'QuickBooks isn’t connected, so void invoice #' + qb.docNumber + ' in QuickBooks yourself.';
  try {
    const cur = qbFetch_('get', '/invoice/' + qb.id).Invoice;
    if (Number(cur.Balance) < Number(cur.TotalAmt)) {
      return 'Invoice #' + qb.docNumber + ' has a payment on it, so it wasn’t voided. Refund the payment in QuickBooks.';
    }
    qbFetch_('post', '/invoice?operation=void', { Id: cur.Id, SyncToken: cur.SyncToken, sparse: true });
    qb.balance = 0;
    qb.voided = new Date().toISOString();
    return 'QuickBooks invoice #' + qb.docNumber + ' was voided, so it can’t be paid.';
  } catch (err) {
    return 'Couldn’t void invoice #' + qb.docNumber + ' (' + err.message + '). Void it in QuickBooks yourself.';
  }
}

// "Message customer" from Review: emails the customer with an order summary and keeps a copy on the order.
function adminMessageCustomer(number, text) {
  requireOwner_();
  const msg = clean_(text, 4000);
  if (!msg) return { ok: false, error: 'Write a message first.' };
  const o = loadOrder_(number);
  const emailStatus = sendSafely_(() => sendOrderMessageEmail_(getConfig_(), o, msg));
  o.messages = logOrderMessage_(o, msg, emailStatus);
  return { ok: true, order: o, emailStatus };
}

// Change the date an order is needed (e.g. after talking with the customer). Optionally email them about it.
function adminChangeDate(number, newDate, notify, note) {
  requireOwner_();
  const d = toISODate_(newDate);
  if (!d) return { ok: false, error: 'Pick a valid date.' };
  const o = loadOrder_(number);
  if (o.type === 'Class') return { ok: false, error: 'Class dates are set on the Events tab.' };
  const old = o.dateNeeded;
  const sh = SpreadsheetApp.getActive().getSheetByName('Orders');
  const row = findOrderRow_(sh, number);
  setCell_(sh, row, 'Date needed', d);
  setCell_(sh, row, 'Updated', new Date());
  o.dateNeeded = d;
  clearConfigCache_();
  let emailStatus = '';
  if (notify) {
    const msg = 'Your order’s date has changed from ' + prettyDate_(old) + ' to ' + prettyDate_(d) + '.' + (clean_(note, 2000) ? '\n\n' + clean_(note, 2000) : '');
    emailStatus = sendSafely_(() => sendOrderMessageEmail_(getConfig_(), o, msg));
    o.messages = logOrderMessage_(o, msg, emailStatus);
  }
  return { ok: true, order: o, emailStatus, weekCounts: weekCountsNow_() };
}

// The pickup / drop-off time Melissa agreed with the customer. Emailing it is optional; either way the customer
// gets a reminder the morning before (checkPayments), unless the time is already tomorrow or sooner.
function adminSetHandoff(number, date, time, notify, note) {
  requireOwner_();
  const d = toISODate_(date);
  const t = clean_(time, 20);
  if (!d || !t) return { ok: false, error: 'Pick a date and a time.' };
  const o = loadOrder_(number);
  if (o.type === 'Class') return { ok: false, error: 'Classes don’t have a pickup time.' };
  if (['Declined', 'Cancelled'].indexOf(o.status) !== -1) return { ok: false, error: number + ' is ' + o.status + '.' };
  const sh = SpreadsheetApp.getActive().getSheetByName('Orders');
  const row = findOrderRow_(sh, number);
  const tomorrow = Utilities.formatDate(new Date(Date.now() + 864e5), tz_(), 'yyyy-MM-dd');
  o.handoff = { date: d, time: t };
  o.reminderSent = d <= tomorrow ? 'Not needed (set the day before)' : '';
  setCell_(sh, row, 'Handoff date', d);
  setCell_(sh, row, 'Handoff time', t);
  setCell_(sh, row, 'Reminder sent', o.reminderSent);
  setCell_(sh, row, 'Updated', new Date());
  let emailStatus = '';
  if (notify) {
    emailStatus = sendSafely_(() => sendHandoffEmail_(getConfig_(), o, 'confirm', clean_(note, 2000)));
    o.messages = logOrderMessage_(o, handoffLabel_(o) + ' time confirmed: ' + handoffWhen_(o) + (clean_(note, 2000) ? '\n\n' + clean_(note, 2000) : ''), emailStatus);
  }
  return { ok: true, order: o, emailStatus };
}

// Morning-before reminders, from the 5-minute check: cookie orders with an agreed time tomorrow, sent once, after 8 AM.
function sendHandoffReminders_(sh, rows) {
  const now = new Date();
  if (Number(Utilities.formatDate(now, tz_(), 'H')) < 8) return [];
  const tomorrow = Utilities.formatDate(new Date(now.getTime() + 864e5), tz_(), 'yyyy-MM-dd');
  const sent = [];
  rows.filter((r) => String(r.Type || 'Cookies') !== 'Class' && toISODate_(r['Handoff date']) === tomorrow && !String(r['Reminder sent'] || '') &&
      ['Declined', 'Cancelled', 'Completed', 'Pending review'].indexOf(String(r.Status)) === -1)
    .forEach((r) => {
      const o = loadOrder_(String(r.Order));
      const status = sendSafely_(() => sendHandoffEmail_(getConfig_(), o, 'reminder', ''));
      setCell_(sh, r._row, 'Reminder sent', status);
      sent.push(o.number);
    });
  return sent;
}

function logOrderMessage_(o, text, emailStatus) {
  const log = (o.messages || []).concat([{ at: new Date().toISOString(), text, emailStatus }]);
  const sh = SpreadsheetApp.getActive().getSheetByName('Orders');
  setCell_(sh, findOrderRow_(sh, o.number), 'Messages log', JSON.stringify(log));
  return log;
}

/* ----- Codes tab ----- */

function readCodes_() {
  return rowObjects_(SpreadsheetApp.getActive().getSheetByName('Codes')).filter((r) => String(r.Code || '').trim()).map((r) => ({
    code: String(r.Code).trim(), type: String(r.Type || 'Percent off'), amount: Number(r.Amount) || 0, balance: Number(r.Balance) || 0,
    active: truthy_(r.Active), expires: toISODate_(r.Expires), maxUses: Number(r['Max uses']) || 0, uses: Number(r.Uses) || 0,
    note: String(r.Note || ''), created: r.Created instanceof Date ? r.Created.toISOString() : ''
  }));
}

// Add or update one code (matched by its original name). Uses aren't changed here; a gift card's balance is.
function adminSaveCode(c, originalCode) {
  requireOwner_();
  const code = clean_(c.code, 40).toUpperCase().replace(/\s+/g, '');
  if (!/^[A-Z0-9-]{3,40}$/.test(code)) return { ok: false, error: 'Codes use letters, numbers and dashes (3 or more).' };
  if (CODE_TYPES.indexOf(c.type) === -1) return { ok: false, error: 'Pick a code type.' };
  const amount = Number(c.amount);
  if (!(amount > 0) || (c.type === 'Percent off' && amount > 100)) return { ok: false, error: c.type === 'Percent off' ? 'Enter a percent from 1 to 100.' : 'Enter the gift card amount.' };
  const lock = LockService.getScriptLock();
  lock.waitLock(20000);
  try {
    const sh = SpreadsheetApp.getActive().getSheetByName('Codes');
    const map = headerMap_(sh);
    const rows = rowObjects_(sh);
    const find = (name) => rows.findIndex((r) => String(r.Code).trim().toUpperCase() === String(name || '').toUpperCase());
    const i = find(originalCode || code);
    const clash = find(code);
    if (clash !== -1 && clash !== i) return { ok: false, error: code + ' already exists.' };
    const values = {
      'Code': code, 'Type': c.type, 'Amount': amount, 'Active': c.active !== false, 'Expires': toISODate_(c.expires) || '',
      'Max uses': Number(c.maxUses) > 0 ? Number(c.maxUses) : '', 'Note': clean_(c.note, 300)
    };
    if (c.type === 'Gift card') values.Balance = i === -1 ? amount : round2_(Math.max(0, Number(c.balance) || 0));
    if (i === -1) {
      values.Uses = 0;
      values.Created = new Date();
      appendObject_(sh, values);
      sh.getRange(sh.getLastRow(), map.Active).insertCheckboxes();
      if (values.Active) sh.getRange(sh.getLastRow(), map.Active).check();
    } else {
      Object.keys(values).forEach((h) => { if (map[h]) sh.getRange(i + 2, map[h]).setValue(h === 'Active' ? values[h] : cell_(values[h])); });
    }
    return { ok: true, codes: readCodes_() };
  } finally {
    lock.releaseLock();
  }
}

function adminDeleteCode(code) {
  requireOwner_();
  const sh = SpreadsheetApp.getActive().getSheetByName('Codes');
  const i = rowObjects_(sh).findIndex((r) => String(r.Code).trim().toUpperCase() === String(code).toUpperCase());
  if (i !== -1) sh.deleteRow(i + 2);
  return { ok: true, codes: readCodes_() };
}

/* ----- Messages ----- */

function readMessages_() {
  const sh = SpreadsheetApp.getActive().getSheetByName('Messages');
  const h = sh.getRange(1, 1, 1, sh.getLastColumn()).getValues()[0];
  return rows_(sh).map((r) => {
    const g = (k) => r[h.indexOf(k)];
    const when = g('Received');
    return Object.assign({
      id: Number(g('ID')) || 0, createdAt: when instanceof Date ? when.toISOString() : String(when || ''), status: String(g('Status') || 'New'),
      topic: String(g('Topic') || ''), name: String(g('Name') || ''), email: String(g('Email') || ''), phone: String(g('Phone') || ''),
      orderNumber: String(g('Order') || ''), message: String(g('Message') || ''), source: String(g('Source') || ''),
      replies: (() => { try { return JSON.parse(g('Replies') || '[]'); } catch (e) { return []; } })()
    }, photosFromCell_(g('Photo')));
  }).filter((m) => m.id).reverse();
}

function messageRow_(sh, id) {
  const col = sh.getRange(2, 1, Math.max(1, sh.getLastRow() - 1), 1).getValues();
  const i = col.findIndex((r) => Number(r[0]) === Number(id));
  return i === -1 ? -1 : i + 2;
}

function adminSetMessageStatus(id, status) {
  requireOwner_();
  const sh = SpreadsheetApp.getActive().getSheetByName('Messages');
  const row = messageRow_(sh, id);
  if (row !== -1) setCell_(sh, row, 'Status', status === 'Replied' ? 'Replied' : 'New');
  return { ok: true };
}

// The Messages tab's "Send reply": emails the customer from the shop's account (quoting what they wrote), keeps a
// copy in the message's Replies column, and marks it Replied.
function adminReplyMessage(id, text) {
  requireOwner_();
  const reply = clean_(text, 4000);
  if (!reply) return { ok: false, error: 'Write your reply first.' };
  const m = readMessages_().find((x) => x.id === Number(id));
  if (!m) return { ok: false, error: 'That message was deleted.' };
  const emailStatus = sendSafely_(() => sendMessageReplyEmail_(getConfig_(), m, reply));
  if (/^FAILED/.test(emailStatus)) return { ok: false, error: 'The reply didn’t send: ' + emailStatus.replace(/^FAILED: /, '') };
  m.replies = (m.replies || []).concat([{ at: new Date().toISOString(), text: reply, emailStatus }]);
  m.status = 'Replied';
  const sh = SpreadsheetApp.getActive().getSheetByName('Messages');
  const row = messageRow_(sh, m.id);
  if (row !== -1) {
    setCell_(sh, row, 'Replies', JSON.stringify(m.replies));
    setCell_(sh, row, 'Status', 'Replied');
  }
  return { ok: true, message: m, emailStatus };
}

function adminDeleteMessage(id) {
  requireOwner_();
  const sh = SpreadsheetApp.getActive().getSheetByName('Messages');
  const row = messageRow_(sh, id);
  if (row !== -1) sh.deleteRow(row);
  return { ok: true };
}

/* ============================== Photos ============================== */

/*
 * Customers' inspiration photos (custom cookie orders and messages). The site shrinks them to a JPEG in the browser
 * and sends them as a data: URL; they're saved, private, in the "Sweet Nothings uploads" Drive folder of the account
 * that runs the script, and the Photo column holds the file's Drive link. Admin shows them via adminPhoto.
 */
const PHOTO_MAX_CHARS = 4000000;   // base64 characters (about 3 MB); the site sends ~1 MB

// Save one photo. Returns { id, url }, or null if it isn't a JPEG/PNG/WebP image or Drive refuses (the order still goes through).
function savePhoto_(data, label) {
  const m = /^data:image\/(jpeg|png|webp);base64,([A-Za-z0-9+/=]+)$/.exec(String(data || ''));
  if (!m || m[2].length > PHOTO_MAX_CHARS) return null;
  try {
    const bytes = Utilities.base64Decode(m[2]);
    const isImage = (bytes[0] === -1 && bytes[1] === -40) ||                       // JPEG FF D8
      (bytes[0] === -119 && bytes[1] === 80 && bytes[2] === 78 && bytes[3] === 71) || // PNG 89 50 4E 47
      (bytes[8] === 87 && bytes[9] === 69 && bytes[10] === 66 && bytes[11] === 80);   // WebP ....WEBP
    if (!isImage) return null;
    const ext = m[1] === 'jpeg' ? 'jpg' : m[1];
    const file = uploadFolder_().createFile(Utilities.newBlob(bytes, 'image/' + m[1], clean_(label, 150) + '.' + ext));
    return { id: file.getId(), url: file.getUrl() };
  } catch (err) {
    console.error('Photo save failed', err && err.stack || err);
    return null;
  }
}

const MAX_PHOTOS = 5;   // per custom cookie item or message

// The photos a page sent: [{ name, data }]. (Pages from before multiple photos sent photoName/photoData.)
function incomingPhotos_(raw) {
  const list = Array.isArray(raw && raw.photos) ? raw.photos : raw && raw.photoData ? [{ name: raw.photoName, data: raw.photoData }] : [];
  return list.slice(0, MAX_PHOTOS).map((p) => ({ name: clean_(p && p.name, 200), data: p && p.data }));
}
// Save a list of photos. cell: what goes in the Photo column, one Drive link per line (or the file name, if that one
// couldn't be saved). saved: [{ id, url }] in order.
function savePhotos_(list, label) {
  const saved = [], lines = [];
  list.forEach((p, i) => {
    const s = savePhoto_(p.data, label + (list.length > 1 ? ' ' + (i + 1) : ''));
    if (s) { saved.push(s); lines.push(s.url); } else if (p.name) lines.push(p.name);
  });
  return { saved, cell: lines.join('\n') };
}
// A Photo cell back into { photos: [{ id, url }], photoNames: [file names that weren't saved] }.
function photosFromCell_(v) {
  const photos = [], photoNames = [];
  String(v || '').split('\n').map((s) => s.trim()).filter(Boolean).forEach((s) => {
    const id = photoId_(s);
    if (id) photos.push({ id, url: s }); else photoNames.push(s);
  });
  return { photos, photoNames };
}
const photoCount_ = (n) => n ? ' · ' + n + ' photo' + (n > 1 ? 's' : '') + ' attached' : '';

function renamePhoto_(id, name) {
  try { const f = DriveApp.getFileById(id); f.setName(clean_(name, 150) + f.getName().replace(/^.*(\.\w+)$/, '$1')); } catch (e) { /* keep the first name */ }
}

// The Drive folder photos go in, made the first time (setupSheet makes it too, so Drive permission is asked for there).
function uploadFolder_() {
  const id = SCRIPT_PROPS().getProperty('UPLOAD_FOLDER_ID');
  if (id) { try { return DriveApp.getFolderById(id); } catch (e) { /* deleted: make a new one */ } }
  const folder = DriveApp.createFolder('Sweet Nothings uploads');
  folder.setDescription('Inspiration photos customers send with orders and messages. Created by the Sweet Nothings website.');
  SCRIPT_PROPS().setProperty('UPLOAD_FOLDER_ID', folder.getId());
  return folder;
}

// The Drive file ID in a Photo cell ('' for just a file name, from before uploads or when saving failed).
function photoId_(v) { const m = String(v || '').match(/\/d\/([\w-]{20,})/); return m ? m[1] : ''; }

// Admin: a photo as a data: URL (the admin page can't load private Drive images directly). Only files in the uploads folder.
function adminPhoto(id) {
  requireOwner_();
  const file = DriveApp.getFileById(String(id));
  const inFolder = file.getParents().hasNext() && file.getParents().next().getId() === SCRIPT_PROPS().getProperty('UPLOAD_FOLDER_ID');
  if (!inFolder) throw new Error('That isn’t a customer photo.');
  const blob = file.getBlob();
  return 'data:' + blob.getContentType() + ';base64,' + Utilities.base64Encode(blob.getBytes());
}

/* ----- Go-live: website photos into the shop's own Drive ----- */

// Run once in the LIVE Sheet, from the Apps Script editor, signed in as the shop's account (GO-LIVE.md step 3).
// The test Sheet's photo links (Pages, Events and Gallery tabs) point at files in the test account's Drive. This
// copies each one into a "Sweet Nothings website photos" folder in this account, shares the copy so the website can
// show it ("anyone with the link can view"), and points the Sheet at the copy. Safe to run again: photos this
// account already owns are left alone.
function copyWebsitePhotos() {
  const ss = SpreadsheetApp.getActive();
  const me = ownerEmail_();
  const folder = (() => {
    const id = SCRIPT_PROPS().getProperty('SITE_PHOTOS_FOLDER_ID');
    if (id) { try { return DriveApp.getFolderById(id); } catch (e) { /* deleted: make a new one */ } }
    const f = DriveApp.createFolder('Sweet Nothings website photos');
    f.setDescription('Photos shown on the website (Home, About, Events, Gallery). Each is shared "anyone with the link" so the site can show it.');
    SCRIPT_PROPS().setProperty('SITE_PHOTOS_FOLDER_ID', f.getId());
    return f;
  })();
  const copies = {};   // old file ID -> new link ('' = already ours)
  let copied = 0;
  const problems = [];
  ['Pages', 'Events', 'Gallery'].forEach((name) => {
    const sh = ss.getSheetByName(name);
    if (!sh || sh.getLastRow() < 2) return;
    const range = sh.getRange(2, 1, sh.getLastRow() - 1, sh.getLastColumn());
    const vals = range.getValues();
    let changed = false;
    vals.forEach((row, r) => row.forEach((v, c) => {
      const id = driveFileId_(v);
      if (!id) return;
      try {
        if (copies[id] === undefined) {
          const src = DriveApp.getFileById(id);
          const owner = src.getOwner();
          if (owner && owner.getEmail().toLowerCase() === me) { copies[id] = ''; return; }
          const copy = src.makeCopy(src.getName(), folder);
          copy.setSharing(DriveApp.Access.ANYONE_WITH_LINK, DriveApp.Permission.VIEW);
          copies[id] = 'https://drive.google.com/file/d/' + copy.getId() + '/view';
          copied++;
        }
        if (copies[id]) { vals[r][c] = copies[id]; changed = true; }
      } catch (err) {
        problems.push(name + ' tab, row ' + (r + 2) + ': ' + err.message);
      }
    }));
    if (changed) range.setValues(vals);
  });
  clearConfigCache_();
  const msg = 'Copied ' + copied + ' photo' + (copied === 1 ? '' : 's') + ' into "Sweet Nothings website photos" and updated the Sheet.' +
    (problems.length ? ' Couldn’t copy: ' + problems.join(' | ') + '. Make sure the test Sheet’s owner shared those photos ("anyone with the link") and run this again.' : '');
  console.log(msg);
  return msg;
}

// The file ID in a Google Drive link (share, open, uc or thumbnail form), or ''.
function driveFileId_(v) {
  const m = String(v || '').match(/drive\.google\.com\/(?:file\/d\/|open\?id=|uc\?(?:export=\w+&)?id=|thumbnail\?id=)([\w-]{10,})/);
  return m ? m[1] : '';
}

/* ============================== Payments ============================== */

/*
 * QuickBooks Online (cookie orders): approving an order creates and sends a QuickBooks invoice with a Pay button.
 * Square (classes): booking a class sends the customer to a Square checkout link; the spot is held meanwhile.
 * checkPayments() runs every 5 minutes (see setupSheet) and marks orders Paid, and releases unpaid class holds.
 *
 * Keys live in Script Properties (Project Settings), never in this file:
 *   QBO_CLIENT_ID, QBO_CLIENT_SECRET, QBO_ENV (sandbox | production)
 *   SQUARE_ACCESS_TOKEN, SQUARE_LOCATION_ID, SQUARE_ENV (sandbox | production)
 * The QuickBooks sign-in uses Google's OAuth2 library (Libraries: identifier OAuth2).
 */

const SCRIPT_PROPS = () => PropertiesService.getScriptProperties();

/* ----- QuickBooks ----- */

// A Script Property with any stray spaces, line breaks or quotes from copy-and-paste removed.
function prop_(key) { return String(SCRIPT_PROPS().getProperty(key) || '').replace(/[\s"']/g, ''); }
function qbEnv_() { return prop_('QBO_ENV').toLowerCase() === 'production' ? 'production' : 'sandbox'; }
function qbKeysSet_() { return !!(prop_('QBO_CLIENT_ID') && prop_('QBO_CLIENT_SECRET')); }
function qbReady_() { try { return qbKeysSet_() && !!SCRIPT_PROPS().getProperty('QBO_REALM_ID') && qbService_().hasAccess(); } catch (e) { return false; } }

function qbService_() {
  const p = SCRIPT_PROPS();
  const id = prop_('QBO_CLIENT_ID'), secret = prop_('QBO_CLIENT_SECRET');
  return OAuth2.createService('QuickBooks-' + qbEnv_())
    .setAuthorizationBaseUrl('https://appcenter.intuit.com/connect/oauth2')
    .setTokenUrl('https://oauth.platform.intuit.com/oauth2/v1/tokens/bearer')
    .setClientId(id)
    .setClientSecret(secret)
    .setScope('com.intuit.quickbooks.accounting')
    .setCallbackFunction('qbAuthCallback')
    .setPropertyStore(p)
    .setCache(CacheService.getScriptCache())
    .setTokenHeaders({ Authorization: 'Basic ' + Utilities.base64Encode(id + ':' + secret), Accept: 'application/json' })
    // Intuit wants the keys only in the Basic header above, not repeated in the form body.
    .setTokenPayloadHandler((payload) => { delete payload.client_id; delete payload.client_secret; return payload; });
}

// Intuit sends the owner back here after they approve the connection.
function qbAuthCallback(request) {
  const ok = qbService_().handleCallback(request);
  if (ok) {
    SCRIPT_PROPS().setProperty('QBO_REALM_ID', String(request.parameter.realmId || ''));
    try { qbItems_(true); } catch (e) { console.error('QuickBooks items setup failed', e); }
  }
  return HtmlService.createHtmlOutput('<div style="font-family:sans-serif;padding:32px;max-width:520px">' +
    (ok ? '<h2>QuickBooks is connected</h2><p>You can close this tab. Back in the admin, click <strong>Refresh</strong> on the Payments tab.</p>'
        : '<h2>QuickBooks wasn’t connected</h2><p>The sign-in was cancelled or didn’t finish. Close this tab and try <strong>Connect QuickBooks</strong> again.</p>') + '</div>');
}

function qbBase_() { return qbEnv_() === 'production' ? 'https://quickbooks.api.intuit.com' : 'https://sandbox-quickbooks.api.intuit.com'; }
function qbAppUrl_(invoiceId) { return (qbEnv_() === 'production' ? 'https://app.qbo.intuit.com' : 'https://app.sandbox.qbo.intuit.com') + '/app/invoice?txnId=' + invoiceId; }

// Call the QuickBooks API. Throws with QuickBooks' own message when it refuses.
function qbFetch_(method, path, body, contentType) {
  const realm = SCRIPT_PROPS().getProperty('QBO_REALM_ID');
  const url = qbBase_() + '/v3/company/' + realm + path + (path.indexOf('?') === -1 ? '?' : '&') + 'minorversion=75';
  const opts = { method, muteHttpExceptions: true, headers: { Authorization: 'Bearer ' + qbService_().getAccessToken(), Accept: 'application/json' } };
  if (body !== undefined) { opts.contentType = contentType || 'application/json'; opts.payload = typeof body === 'string' ? body : JSON.stringify(body); }
  const res = UrlFetchApp.fetch(url, opts);
  let data = {};
  try { data = JSON.parse(res.getContentText() || '{}'); } catch (e) { /* not JSON */ }
  if (res.getResponseCode() >= 300 || data.Fault) {
    const e = (data.Fault && data.Fault.Error && data.Fault.Error[0]) || {};
    const err = new Error((e.Message || 'HTTP ' + res.getResponseCode()) + (e.Detail ? ': ' + e.Detail : ''));
    err.code = e.code;
    throw err;
  }
  return data;
}
function qbQuery_(sql) { return (qbFetch_('get', '/query?query=' + encodeURIComponent(sql)).QueryResponse) || {}; }
function qbEsc_(s) { return String(s).replace(/\\/g, '\\\\').replace(/'/g, "\\'"); }

// The Products/Services invoices use. Created in QuickBooks the first time; their IDs are remembered per company.
// [key, name, taxable, description, QuickBooks type]. The cookies are products (NonInventory) because QuickBooks only
// lets products take a food sales tax category; give them the bakery one in QuickBooks (Sales tax categories).
const QB_ITEMS = [
  ['custom', 'Custom Cookies', true, 'Hand-decorated custom cookies', 'NonInventory'],
  ['artisan', 'Artisan Cookies', true, 'Mini and large artisan cookies', 'NonInventory'],
  ['dropoff', 'Drop-off Fee', false, 'Local drop-off', 'Service'],
  ['discount', 'Promo Discount', true, 'Promo code or price adjustment', 'Service'],
  ['gift', 'Gift Card Credit', false, 'Sweet Nothings gift card applied', 'Service']
];
function qbItems_(force) {
  const key = 'QBO_ITEMS_' + SCRIPT_PROPS().getProperty('QBO_REALM_ID');
  const saved = SCRIPT_PROPS().getProperty(key);
  if (saved && !force) return JSON.parse(saved);
  const accounts = (qbQuery_("select * from Account where AccountType = 'Income' maxresults 100").Account || []);
  const income = accounts.find((a) => /sales/i.test(a.Name)) || accounts[0];
  if (!income) throw new Error('No income account found in QuickBooks.');
  const map = {};
  // QuickBooks keeps product categories (folders like "artisan cookies") in the same list as products, and name
  // matching ignores case, so categories are skipped: an invoice line can't use a category. If a category already
  // has the name, the site's item gets " (website)" added (QuickBooks names must be unique across both).
  // Inactive items count too (QuickBooks' search hides them otherwise): an existing one is reused and switched back on.
  const findItem = (n) => {
    const it = (qbQuery_("select * from Item where Name = '" + qbEsc_(n) + "' and Active in (true, false)").Item || []).find((i) => i.Type !== 'Category');
    if (it && it.Active === false) qbFetch_('post', '/item', { Id: it.Id, SyncToken: it.SyncToken, sparse: true, Active: true });
    return it;
  };
  QB_ITEMS.forEach(([k, name, taxable, desc, type]) => {
    const create = (n) => qbFetch_('post', '/item', { Name: n, Type: type, Taxable: taxable, Description: desc, IncomeAccountRef: { value: income.Id } }).Item.Id;
    const found = findItem(name) || findItem(name + ' (website)');
    if (found) { map[k] = found.Id; return; }
    try {
      map[k] = create(name);
    } catch (e) {
      // The name is already used, here by a category. QuickBooks reports that as code 6240 ("Duplicate Name") or,
      // for categories, as a business validation error saying it "already exists".
      if (String(e.code) !== '6240' && !/already exists|duplicate name/i.test(e.message)) throw e;
      map[k] = create(name + ' (website)');
    }
  });
  SCRIPT_PROPS().setProperty(key, JSON.stringify(map));
  return map;
}

// Find the customer by email, or create them (with a billing email so the invoice can be paid online).
function qbCustomer_(c) {
  let found = null;
  try { found = (qbQuery_("select * from Customer where PrimaryEmailAddr = '" + qbEsc_(c.email) + "'").Customer || [])[0]; } catch (e) { /* not filterable here */ }
  if (!found) found = (qbQuery_("select * from Customer where DisplayName = '" + qbEsc_(c.name) + "'").Customer || [])[0];
  if (found) return found.Id;
  const parts = c.name.trim().split(/\s+/);
  const body = { DisplayName: c.name, GivenName: parts[0], FamilyName: parts.slice(1).join(' ') || undefined, PrimaryEmailAddr: { Address: c.email }, PrimaryPhone: c.phone ? { FreeFormNumber: c.phone } : undefined };
  try {
    return qbFetch_('post', '/customer', body).Customer.Id;
  } catch (e) {
    if (String(e.code) !== '6240') throw e;   // name already used (e.g. a vendor): make it unique
    body.DisplayName = c.name + ' (' + c.email + ')';
    return qbFetch_('post', '/customer', body).Customer.Id;
  }
}

// Create the QuickBooks invoice for an approved order, email it from QuickBooks, and save its number, total and pay link.
// Never throws: problems are kept on the order as invoice.qbError so admin can show Retry.
function qbInvoiceForOrder_(cfg, o) {
  try {
    const items = qbItems_();
    const inv = o.invoice;
    const line = (itemKey, desc, qty, unit, taxable) => ({
      DetailType: 'SalesItemLineDetail', Amount: round2_(qty * unit), Description: desc.slice(0, 4000),
      SalesItemLineDetail: { ItemRef: { value: items[itemKey] }, Qty: qty, UnitPrice: unit, TaxCodeRef: { value: taxable ? 'TAX' : 'NON' } }
    });
    const lines = inv.lines.map((l) => line(l.unit < 0 ? 'discount' : /artisan|mini|large/i.test(l.desc) ? 'artisan' : 'custom', l.desc, l.qty, l.unit, true));
    if (inv.fee) lines.push(line('dropoff', 'Drop-off fee', 1, inv.fee, false));
    if (inv.credit) lines.push(line('gift', 'Gift card ' + (o.promoCode || ''), 1, -inv.credit, false));
    const created = qbFetch_('post', '/invoice', {
      CustomerRef: { value: qbCustomer_(o.customer) },
      Line: lines,
      // No tax amount is sent: QuickBooks' automated sales tax works it out from the items' tax categories and the
      // address (her business address for pickup; the drop-off address below for drop-off orders).
      ShipAddr: o.fulfillment === 'delivery' && o.address
        ? { Line1: o.address.street, City: o.address.city, CountrySubDivisionCode: 'IL', PostalCode: o.address.zip, Country: 'US' }
        : undefined,
      BillEmail: { Address: o.customer.email },
      CustomerMemo: { value: ('Order ' + o.number + (inv.note ? ' – ' + inv.note : '')).slice(0, 1000) },
      PrivateNote: 'Website order ' + o.number,
      AllowOnlineCreditCardPayment: true,
      AllowOnlineACHPayment: true
    }).Invoice;
    // Read it back: QuickBooks' automated sales tax is added after the create call answers, so the first
    // TotalAmt can be the pre-tax amount. The read-back has the real total, tax and balance (and the pay link).
    let link = '';
    let saved = created;
    try {
      saved = qbFetch_('get', '/invoice/' + created.Id + '?include=invoiceLink').Invoice || created;
      link = saved.InvoiceLink || '';
    } catch (e) {
      try { saved = qbFetch_('get', '/invoice/' + created.Id).Invoice || created; } catch (e2) { /* keep the create answer */ }
    }
    // Our confirmation email carries the Pay button. Without a pay link, QuickBooks emails the invoice itself instead.
    let sent = '';
    if (!link) {
      try { qbFetch_('post', '/invoice/' + created.Id + '/send?sendTo=' + encodeURIComponent(o.customer.email), '', 'application/octet-stream'); sent = new Date().toISOString(); } catch (e) { sent = 'FAILED: ' + e.message; }
    }
    inv.qb = { id: created.Id, docNumber: saved.DocNumber || created.DocNumber, total: Number(saved.TotalAmt), tax: Number((saved.TxnTaxDetail || {}).TotalTax || 0), balance: Number(saved.Balance), link, sent, env: qbEnv_(), url: qbAppUrl_(created.Id) };
    // QuickBooks' total includes the sales tax it worked out; the site's own total is before tax.
    delete inv.qbError;
  } catch (err) {
    console.error('QuickBooks invoice failed', o.number, err && err.stack || err);
    o.invoice.qbError = String(err && err.message || err).slice(0, 300);
  }
}

/* ----- Square ----- */

function squareEnv_() { return prop_('SQUARE_ENV').toLowerCase() === 'production' ? 'production' : 'sandbox'; }
function squareReady_() { return !!(prop_('SQUARE_ACCESS_TOKEN') && prop_('SQUARE_LOCATION_ID')); }

function squareFetch_(method, path, body) {
  const base = squareEnv_() === 'production' ? 'https://connect.squareup.com' : 'https://connect.squareupsandbox.com';
  const opts = {
    method, muteHttpExceptions: true, contentType: 'application/json',
    headers: { Authorization: 'Bearer ' + prop_('SQUARE_ACCESS_TOKEN'), 'Square-Version': '2024-10-17' }
  };
  if (body !== undefined) opts.payload = JSON.stringify(body);
  const res = UrlFetchApp.fetch(base + path, opts);
  let data = {};
  try { data = JSON.parse(res.getContentText() || '{}'); } catch (e) { /* not JSON */ }
  if (res.getResponseCode() >= 300) throw new Error(((data.errors || [])[0] || {}).detail || 'Square HTTP ' + res.getResponseCode());
  return data;
}

// A Square checkout link for a class booking. Promo codes and gift cards come off as order-level discounts.
function squarePaymentLink_(cfg, o) {
  const cents = (n) => Math.round(Number(n) * 100);
  const discounts = [];
  if (o.discount) discounts.push({ uid: 'promo', name: 'Promo code ' + o.promoCode, type: 'FIXED_AMOUNT', amount_money: { amount: cents(o.discount), currency: 'USD' }, scope: 'ORDER' });
  if (o.giftCredit) discounts.push({ uid: 'gift', name: 'Gift card', type: 'FIXED_AMOUNT', amount_money: { amount: cents(o.giftCredit), currency: 'USD' }, scope: 'ORDER' });
  const data = squareFetch_('post', '/v2/online-checkout/payment-links', {
    idempotency_key: o.number + '-' + Utilities.getUuid().slice(0, 8),
    order: {
      location_id: prop_('SQUARE_LOCATION_ID'),
      reference_id: o.number,
      line_items: o.items.map((it) => ({ name: ('Class: ' + it.title).slice(0, 500), note: it.summary || undefined, quantity: String(it.qty), base_price_money: { amount: cents(it.unit), currency: 'USD' } })),
      discounts: discounts.length ? discounts : undefined
    },
    checkout_options: { redirect_url: String(cfg.siteUrl || '') + 'order.html?paid=' + encodeURIComponent(o.number), ask_for_shipping_address: false },
    pre_populated_data: { buyer_email: o.customer.email }
  });
  return { id: data.payment_link.id, url: data.payment_link.url, orderId: data.payment_link.order_id };
}

// True once Square has taken payment for the order.
function squareOrderPaid_(orderId) {
  const order = squareFetch_('get', '/v2/orders/' + encodeURIComponent(orderId)).order || {};
  return order.state !== 'CANCELED' && (order.tenders || []).length > 0;
}

/* ----- Confirming classes and checking payments ----- */

// A class booking is confirmed (paid, or booked by hand): set the status and send the confirmation + owner alert.
function confirmClass_(o, status, late) {
  const cfg = getConfig_();
  const sh = SpreadsheetApp.getActive().getSheetByName('Orders');
  const row = findOrderRow_(sh, o.number);
  o.status = status;
  setCell_(sh, row, 'Status', status);
  setCell_(sh, row, 'Updated', new Date());
  setCell_(sh, row, 'Customer email', sendSafely_(() => sendClassBookingEmail_(cfg, o)));
  setCell_(sh, row, 'Owner alert', sendSafely_(() => sendOwnerClassAlert_(cfg, o, late)));
  clearConfigCache_();
}

// Runs every 5 minutes (time-driven trigger), and from admin's "Check payments now".
//   QuickBooks: invoices with no balance left -> Paid (part-paid ones keep their balance on the order).
//   Square: class bookings paid -> Paid (+ confirmation emails); unpaid past the hold -> Expired (spot released).
function checkPayments() {
  const lock = LockService.getScriptLock();
  if (!lock.tryLock(1000)) return { ok: false, error: 'A payment check is already running.' };
  const summary = { invoicesPaid: [], classesPaid: [], expired: [], remindersSent: [], errors: [] };
  try {
    const cfg = getConfig_();
    const sh = SpreadsheetApp.getActive().getSheetByName('Orders');
    const rows = rowObjects_(sh).map((r, i) => Object.assign(r, { _row: i + 2 }));
    const json = (s) => { try { return JSON.parse(s || 'null'); } catch (e) { return null; } };

    if (qbReady_()) {
      const open = rows.filter((r) => r.Status === 'Invoice sent').map((r) => ({ r, inv: json(r.Invoice) })).filter((x) => x.inv && x.inv.qb && x.inv.qb.id);
      for (let i = 0; i < open.length; i += 30) {
        const batch = open.slice(i, i + 30);
        try {
          const found = qbQuery_('select * from Invoice where Id in (' + batch.map((x) => "'" + x.inv.qb.id + "'").join(',') + ')').Invoice || [];
          batch.forEach((x) => {
            const q = found.find((f) => f.Id === x.inv.qb.id);
            if (!q) return;
            // Total and tax too: QuickBooks may add its sales tax after the invoice is made, or Melissa may edit it there.
            x.inv.qb.total = Number(q.TotalAmt);
            if (q.TxnTaxDetail) x.inv.qb.tax = Number(q.TxnTaxDetail.TotalTax || 0);
            delete x.inv.qbMismatch;   // (older invoices compared against the site's own tax, which it no longer works out)
            x.inv.qb.balance = Number(q.Balance);
            x.inv.qb.checkedAt = new Date().toISOString();
            if (x.inv.qb.balance <= 0) {
              x.inv.qb.paidAt = new Date().toISOString();
              setCell_(sh, x.r._row, 'Status', 'Paid');
              setCell_(sh, x.r._row, 'Updated', new Date());
              summary.invoicesPaid.push(x.r.Order);
            }
            setCell_(sh, x.r._row, 'Invoice', JSON.stringify(x.inv));
          });
        } catch (e) { summary.errors.push('QuickBooks: ' + e.message); }
      }
    }

    // Class bookings waiting on Square. The Square order number comes from the "Square order" column, or the
    // booking's saved invoice details if that column is missing (a Sheet that hadn't run setupSheet since payments
    // were added). An unpaid hold always expires on time, even if Square can't be reached.
    {
      const hold = (Number(cfg.classHoldMinutes) || 30) * 60000;
      const now = Date.now();
      const age = (r) => now - new Date(r.Received).getTime();
      rows.filter((r) => r.Status === 'Awaiting payment' || (r.Status === 'Expired' && age(r) < 864e5))
        .forEach((r) => {
          try {
            const inv = json(r.Invoice) || {};
            const sqOrder = String(r['Square order'] || (inv.square && inv.square.orderId) || '');
            if (r.Status === 'Expired' && !sqOrder) return;
            if (sqOrder && squareReady_() && squareOrderPaid_(sqOrder)) {
              const late = r.Status === 'Expired';
              // Paid after the hold ran out: the gift card amount it gave back is used again.
              if (late && Number(r['Gift card credit']) > 0) { const g = lookupCode_(r['Promo code']); if (g) useCode_(g, Number(r['Gift card credit'])); }
              confirmClass_(loadOrder_(String(r.Order)), 'Paid', late);
              summary.classesPaid.push(r.Order);
            } else if (r.Status === 'Awaiting payment' && age(r) > hold) {
              try { if (inv.square && inv.square.linkId && squareReady_()) squareFetch_('delete', '/v2/online-checkout/payment-links/' + inv.square.linkId); } catch (e) { /* already gone */ }
              setCell_(sh, r._row, 'Status', 'Expired');
              setCell_(sh, r._row, 'Updated', new Date());
              if (Number(r['Gift card credit']) > 0) refundGiftCard_(r['Promo code'], Number(r['Gift card credit']));
              const ex = loadOrder_(String(r.Order));
              setCell_(sh, r._row, 'Customer email', sendSafely_(() => sendClassExpiredEmail_(cfg, ex)));
              summary.expired.push(r.Order);
            }
          } catch (e) { summary.errors.push('Square ' + r.Order + ': ' + e.message); }
        });
    }
    if (summary.classesPaid.length || summary.expired.length || summary.invoicesPaid.length) clearConfigCache_();
    // Emails an admin helper queued, sent now from the shop's account.
    try { summary.remindersSent = sendHandoffReminders_(sh, rows); } catch (e) { summary.errors.push('Reminders: ' + e.message); }
    try { summary.emailsSent = sendOutbox_(); } catch (e) { summary.errors.push('Outbox: ' + e.message); }
    SCRIPT_PROPS().setProperty('PAYMENTS_LAST_CHECK', JSON.stringify(Object.assign({ at: new Date().toISOString() }, summary)));
    return Object.assign({ ok: true }, summary);
  } finally {
    lock.releaseLock();
  }
}

// An expired class booking gives back the gift card amount it used.
function refundGiftCard_(code, amount) {
  const sh = SpreadsheetApp.getActive().getSheetByName('Codes');
  const map = headerMap_(sh);
  const c = rowObjects_(sh).findIndex((r) => String(r.Code).trim().toUpperCase() === String(code).trim().toUpperCase());
  if (c === -1) return;
  const row = c + 2;
  sh.getRange(row, map.Balance).setValue(round2_((Number(sh.getRange(row, map.Balance).getValue()) || 0) + amount));
  sh.getRange(row, map.Uses).setValue(Math.max(0, (Number(sh.getRange(row, map.Uses).getValue()) || 0) - 1));
}

// The page Square sends customers back to asks this: has my class payment gone through? (Checks Square right away.)
function checkClassPayment_(b) {
  if (rateLimited_('paycheck', 'all', 600)) return { ok: false, error: 'Please try again in a minute.' };
  const number = clean_(b.number, 20);
  let o;
  try { o = loadOrder_(number); } catch (e) { return { ok: false, error: 'We couldn’t find that booking.' }; }
  if (o.type !== 'Class') return { ok: false, error: 'We couldn’t find that booking.' };
  if (o.status === 'Awaiting payment' && o.invoice && o.invoice.square && squareReady_()) {
    try { if (squareOrderPaid_(o.invoice.square.orderId)) confirmClass_(o, 'Paid'); } catch (e) { console.error('Square check failed', e); }
  }
  return {
    ok: true, number: o.number, status: o.status, total: o.total,
    classes: o.items.map((it) => ({ title: it.title, summary: it.summary, qty: it.qty, eventId: it.eventId })),
    payUrl: o.status === 'Awaiting payment' && o.invoice && o.invoice.square ? o.invoice.square.url : '',
    holdMinutes: Number(getConfig_().classHoldMinutes) || 30
  };
}

// Make sure the 5-minute payment check is scheduled (called from setupSheet).
function ensurePaymentTrigger_() {
  if (!runningAsOwner_()) return;   // a helper's trigger would run (and send email) as the helper
  const has = ScriptApp.getProjectTriggers().some((t) => t.getHandlerFunction() === 'checkPayments');
  if (!has) ScriptApp.newTrigger('checkPayments').timeBased().everyMinutes(5).create();
}

/* ----- Admin: Payments tab ----- */

function adminPayments() {
  requireOwner_();
  const p = SCRIPT_PROPS();
  const out = {
    // Enough of the keys to compare against Intuit's page without showing them.
    qb: { keys: qbKeysSet_(), env: qbEnv_(), connected: false, company: '', items: null, error: '',
      idHint: prop_('QBO_CLIENT_ID') ? prop_('QBO_CLIENT_ID').slice(0, 4) + '…' + prop_('QBO_CLIENT_ID').slice(-4) + ' (' + prop_('QBO_CLIENT_ID').length + ' characters)' : '',
      secretLength: prop_('QBO_CLIENT_SECRET').length },
    square: { ready: squareReady_(), env: squareEnv_(), location: '', error: '' },
    lastCheck: JSON.parse(p.getProperty('PAYMENTS_LAST_CHECK') || 'null'),
    trigger: ScriptApp.getProjectTriggers().some((t) => t.getHandlerFunction() === 'checkPayments'),
    // Columns or tabs added by an update that setupSheet hasn't added to this Sheet yet.
    setupNeeded: Object.keys(TABS).some((name) => {
      const sh = SpreadsheetApp.getActive().getSheetByName(name);
      if (!sh) return true;
      const have = sh.getRange(1, 1, 1, Math.max(1, sh.getLastColumn())).getValues()[0].map(String);
      return TABS[name].headers.some((h) => have.indexOf(h) === -1);
    }),
    callbackUrl: 'https://script.google.com/macros/d/' + ScriptApp.getScriptId() + '/usercallback'
  };
  if (out.qb.keys && p.getProperty('QBO_REALM_ID')) {
    try {
      out.qb.connected = qbService_().hasAccess();
      if (out.qb.connected) {
        const info = qbFetch_('get', '/companyinfo/' + p.getProperty('QBO_REALM_ID')).CompanyInfo || {};
        out.qb.company = info.CompanyName || '';
        out.qb.items = JSON.parse(p.getProperty('QBO_ITEMS_' + p.getProperty('QBO_REALM_ID')) || 'null');
      }
    } catch (e) { out.qb.error = e.message; }
  }
  if (out.square.ready) {
    try { out.square.location = (squareFetch_('get', '/v2/locations/' + prop_('SQUARE_LOCATION_ID')).location || {}).name || ''; }
    catch (e) { out.square.error = e.message; }
  }
  return out;
}

// The Intuit sign-in page to connect QuickBooks (opened in a new tab).
function adminQbConnectUrl() {
  requireOwner_();
  if (!qbKeysSet_()) throw new Error('Add QBO_CLIENT_ID and QBO_CLIENT_SECRET in Script Properties first.');
  return qbService_().getAuthorizationUrl();
}
function adminQbDisconnect() {
  requireOwner_();
  qbService_().reset();
  SCRIPT_PROPS().deleteProperty('QBO_REALM_ID');
  return { ok: true };
}
function adminQbSetupItems() { requireOwner_(); return { ok: true, items: qbItems_(true) }; }
function adminCheckPaymentsNow() { requireOwner_(); ensurePaymentTrigger_(); return checkPayments(); }

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
    p_('*Estimate only, not a final price. ' + (o.items.some((it) => it.kind === 'custom') ? esc_(cfg.customNote || '') + ' ' : '') + 'Your final price, with sales tax, will be in your confirmation email.', 13) +
    p_('Questions or changes? Just reply to this email and mention your order number.', 14));
  const text = [
    'We got your order request' + (first ? ', ' + first : '') + '!', 'Order number ' + o.number, '',
    'NOT A FINAL ORDER: this email confirms we received your request. Your order is not confirmed yet, your date is not reserved, and the price below is an estimate. You haven’t been charged anything.', '',
    'What happens next:', '1. Request received (this email).', '2. I review your order, usually within 1–2 days.',
    '3. You get a second email with your confirmation, final price and a QuickBooks invoice.', '4. Pay the invoice to lock in your date.', '',
    'Needed by: ' + prettyDate_(o.dateNeeded) + (o.eventTime ? ' (event at ' + o.eventTime + ')' : ''), 'Occasion: ' + occasion_(o),
    o.pickupWindow ? windowLabel_(o) + ': ' + o.pickupWindow : '',
    o.address ? 'Drop-off to: ' + o.address.street + ', ' + o.address.city + ' ' + o.address.zip : 'Pickup: ' + cfg.pickupCity + ' (address sent once confirmed)',
    o.allergies ? 'Allergies / dietary needs: ' + o.allergies : '', '',
    itemsText_(o), '', totalsText_(o, 'Estimated total*'), '',
    'Questions or changes? Just reply to this email and mention your order number.'
  ].filter((l, i, a) => l !== '' || a[i - 1] !== '').join('\n');
  sendMail_({
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
    allergy + contact + facts_(o, true) + itemsBlock_(o, 'Request', true) + totalsBlock_(o, 'Estimated total') +
    (cfg.adminUrl ? button_(cfg.adminUrl, 'Review in admin') : button_(SpreadsheetApp.getActive().getUrl(), 'Open the orders sheet')) +
    p_('Approve or decline it in the admin page. Reply to this email to write to the customer.', 13));
  const text = [
    'New order to review: ' + o.number, '', o.customer.name, o.customer.email, o.customer.phone, '',
    o.allergies ? 'ALLERGIES / DIETARY NEEDS: ' + o.allergies + '\n' : '',
    'Needed by: ' + prettyDate_(o.dateNeeded) + (o.eventTime ? ' (event at ' + o.eventTime + ')' : ''), 'Occasion: ' + occasion_(o),
    o.pickupWindow ? windowLabel_(o) + ': ' + o.pickupWindow : '',
    o.address ? 'Drop-off to: ' + o.address.street + ', ' + o.address.city + ' ' + o.address.zip : 'Pickup',
    '', itemsText_(o, true), '', totalsText_(o, 'Estimated total'), '', cfg.adminUrl ? 'Review in admin: ' + cfg.adminUrl : 'Orders sheet: ' + SpreadsheetApp.getActive().getUrl()
  ].join('\n');
  sendMail_({
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
    m.photos.length ? ['Photo' + (m.photos.length > 1 ? 's' : ''), photoLinks_(m.photos, 'their photo')] : null,
    m.photoNames.length ? ['Not saved', esc_(m.photoNames.join(', ')) + ' <span style="color:' + C.muted + '">(couldn’t be saved; ask them to reply with ' + (m.photoNames.length > 1 ? 'them' : 'it') + ')</span>'] : null,
    ['Sent from', esc_(m.source)]
  ].filter(Boolean);
  const html = shell_(cfg, 'New message', '',
    '<table role="presentation" cellpadding="0" cellspacing="0" width="100%" style="font-size:15px;margin-bottom:18px">' +
      rows.map((r) => '<tr><td style="padding:6px 12px 6px 0;color:' + C.muted + ';font-size:12px;text-transform:uppercase;letter-spacing:.06em;vertical-align:top;width:90px">' + r[0] + '</td><td style="padding:6px 0;font-weight:600">' + r[1] + '</td></tr>').join('') +
    '</table>' +
    '<div style="background:#FBF7F4;border-radius:12px;padding:14px 16px;font-size:15px;white-space:pre-wrap;margin-bottom:18px">' + esc_(m.message) + '</div>' +
    p_('Just hit Reply to answer ' + esc_(m.name ? m.name.split(' ')[0] : m.email) + '.', 14));
  sendMail_({
    to: cfg.ownerEmail,
    subject: subjectPrefix_(cfg) + 'New message: ' + m.topic + ' – ' + (m.name || m.email),
    htmlBody: html,
    body: ['New message (' + m.source + ')', 'From: ' + (m.name ? m.name + ' ' : '') + '<' + m.email + '>' + (m.phone ? ' ' + m.phone : ''),
      'Topic: ' + m.topic, m.orderNumber ? 'Order: ' + m.orderNumber : '', m.photos.map((p, i) => 'Photo' + (m.photos.length > 1 ? ' ' + (i + 1) : '') + ': ' + p.url).join('\n'), m.photoNames.length ? 'Not saved: ' + m.photoNames.join(', ') : '', '', m.message].filter((l) => l !== null).join('\n'),
    name: cfg.senderName, replyTo: m.email
  });
}

/* ---------- Email #2: confirmed (customer), sent when Melissa approves ---------- */
function sendConfirmationEmail_(cfg, o) {
  const inv = o.invoice;
  const first = (o.customer.name || '').split(' ')[0];
  const isDel = o.fulfillment === 'delivery';
  const note = inv.note
    ? '<div style="font-size:15px;border-left:3px solid ' + C.coral + ';padding:4px 0 4px 14px;margin-bottom:18px"><em>“' + esc_(inv.note) + '”</em><br><span style="color:' + C.muted + ';font-size:13px">— Sweet Nothings</span></div>'
    : '';
  const pickup = isDel ? '' :
    '<div style="border:1px solid ' + C.line + ';border-radius:12px;padding:14px 18px;font-size:15px;margin-bottom:18px">' +
      '<div style="color:' + C.muted + ';font-size:12px;text-transform:uppercase;letter-spacing:.06em">Pickup address</div>' +
      '<div style="font-weight:600;margin-top:2px">' + esc_(cfg.pickupAddress) + '</div>' +
      (cfg.pickupInstructions ? '<div style="color:' + C.muted + ';margin-top:6px;font-size:14px">' + esc_(cfg.pickupInstructions) + '</div>' : '') +
    '</div>';
  const lines = '<div style="border-top:1px solid ' + C.line + ';padding-top:14px;margin-bottom:18px">' + h2_('Your invoice') +
    inv.lines.map((l) => '<table role="presentation" cellpadding="0" cellspacing="0" width="100%" style="font-size:15px;padding:6px 0"><tr>' +
      '<td>' + esc_(l.desc) + '<br><span style="color:' + C.muted + ';font-size:13px">' + l.qty + ' × ' + money_(l.unit) + '</span></td>' +
      '<td align="right" style="vertical-align:top">' + money_(l.qty * l.unit) + '</td></tr></table>').join('') + '</div>';
  // With a QuickBooks invoice, the email shows its amounts (sales tax included): that's what the customer pays.
  const qb = inv.qb || {};
  const t = invoiceTotals_(o);
  const due = t.total;
  const totals = totalsBlock_(t, 'Amount due') +
    (inv.changed ? p_('Your original estimate was ' + money_(o.total) + (o.tax ? '' : ' before tax') + '.', 13) : '');
  // The QuickBooks invoice's own Pay page. Without one (QuickBooks not connected, or online payments off), say how it'll come.
  const payNote = qb.link ? '' : qb.id ? 'Your invoice' + (qb.docNumber ? ' #' + qb.docNumber : '') + ' from QuickBooks is in a separate email.' : 'I’ll send your invoice to pay in a separate email.';
  const pay = qb.link
    ? button_(qb.link, 'Pay ' + money_(due) + ' securely') + p_('Card or bank transfer, through QuickBooks' + (qb.docNumber ? ' (invoice #' + qb.docNumber + ')' : '') + '.', 13)
    : p_(payNote, 14);
  const html = shell_(cfg, 'You’re confirmed' + (first ? ', ' + esc_(first) : '') + '!', o.number,
    '<div style="background:' + C.blush + ';border-radius:12px;padding:16px 18px;font-size:15px;margin-bottom:18px">' +
      (inv.changed ? 'I’ve reviewed your order and updated the price. ' : 'I’ve reviewed your order and it’s all set. ') + 'Pay the invoice below to lock in your date.</div>' +
    note + pickup + facts_(o, 'confirmed') + lines + totals + pay +
    p_('Questions or changes? Just reply to this email and mention your order number.', 14));
  const text = [
    'You’re confirmed' + (first ? ', ' + first : '') + '!', 'Order number ' + o.number, '',
    (inv.changed ? 'I’ve reviewed your order and updated the price.' : 'I’ve reviewed your order and it’s all set.') + ' Pay the invoice to lock in your date.',
    inv.note ? '\n"' + inv.note + '" — Sweet Nothings' : '', '',
    isDel ? 'Drop-off to: ' + o.address.street + ', ' + o.address.city + ' ' + o.address.zip : 'Pickup address: ' + cfg.pickupAddress + (cfg.pickupInstructions ? '\n' + cfg.pickupInstructions : ''),
    'Needed by: ' + prettyDate_(o.dateNeeded), '',
    inv.lines.map((l) => l.desc + ' – ' + l.qty + ' × ' + money_(l.unit) + ' = ' + money_(l.qty * l.unit)).join('\n'), '',
    totalsText_(t, 'Amount due'), '', qb.link ? 'Pay securely here: ' + qb.link : payNote, '', 'Questions or changes? Just reply to this email and mention your order number.'
  ].join('\n');
  sendMail_({
    to: o.customer.email,
    subject: subjectPrefix_(cfg) + 'Order confirmed – please pay your invoice – Sweet Nothings ' + o.number,
    htmlBody: html, body: text, name: cfg.senderName, replyTo: cfg.replyToEmail
  });
}

/* ---------- Declined (customer) ---------- */
function sendDeclineEmail_(cfg, o) {
  const first = (o.customer.name || '').split(' ')[0];
  const html = shell_(cfg, 'Thank you for thinking of us' + (first ? ', ' + esc_(first) : ''), o.number,
    '<div style="background:' + C.blush + ';border-radius:12px;padding:16px 18px;font-size:15px;margin-bottom:18px">Unfortunately I’m not able to take this order. You haven’t been charged anything.</div>' +
    (o.declineNote ? '<div style="font-size:15px;border-left:3px solid ' + C.coral + ';padding:4px 0 4px 14px;margin-bottom:18px"><em>“' + esc_(o.declineNote) + '”</em><br><span style="color:' + C.muted + ';font-size:13px">— Sweet Nothings</span></div>' : '') +
    p_('Questions? Just reply to this email and mention your order number.', 14));
  sendMail_({
    to: o.customer.email,
    subject: subjectPrefix_(cfg) + 'About your Sweet Nothings order request ' + o.number,
    htmlBody: html,
    body: 'Thank you for thinking of us' + (first ? ', ' + first : '') + '.\n\nUnfortunately I’m not able to take order ' + o.number + '. You haven’t been charged anything.' +
      (o.declineNote ? '\n\n"' + o.declineNote + '" — Sweet Nothings' : '') + '\n\nQuestions? Just reply to this email.',
    name: cfg.senderName, replyTo: cfg.replyToEmail
  });
}

/* ---------- Class booked (customer): confirmed right away, no review ---------- */
function sendClassBookingEmail_(cfg, o) {
  const first = (o.customer.name || '').split(' ')[0];
  const paid = o.status === 'Paid';
  const html = shell_(cfg, 'You’re booked' + (first ? ', ' + esc_(first) : '') + '!', o.number,
    '<div style="background:' + C.blush + ';border-radius:12px;padding:16px 18px;font-size:15px;margin-bottom:18px">Your spot' + (o.items.reduce((a, it) => a + it.qty, 0) > 1 ? 's are' : ' is') +
      ' saved. ' + classPayLine_(o) + '</div>' +
    classDetails_(o) + totalsBlock_(o, paid ? 'Paid' : 'Total') + classInfoBlock_(cfg, o) +
    p_('Questions or need to change your booking? Just reply to this email and mention your order number.', 14));
  sendMail_({
    to: o.customer.email,
    subject: subjectPrefix_(cfg) + 'You’re booked! – Sweet Nothings ' + o.number,
    htmlBody: html,
    body: ['You’re booked' + (first ? ', ' + first : '') + '!', 'Order number ' + o.number, '', classPayLine_(o), '',
      classText_(o), '', totalsText_(o, paid ? 'Paid' : 'Total'), '', classInfoText_(cfg, o), '', 'Questions? Just reply to this email.'].join('\n'),
    name: cfg.senderName, replyTo: cfg.replyToEmail
  });
}

// The hold ran out before Square got a payment: the spot was released and nothing was charged.
function sendClassExpiredEmail_(cfg, o) {
  const first = (o.customer.name || '').split(' ')[0];
  const mins = Number(cfg.classHoldMinutes) || 30;
  const line = 'Your payment didn’t come through within ' + mins + ' minutes, so your spot wasn’t held and you haven’t been charged anything.';
  const again = cfg.siteUrl ? cfg.siteUrl + 'events.html' : '';
  const html = shell_(cfg, 'Your class spot wasn’t held' + (first ? ', ' + esc_(first) : ''), o.number,
    '<div style="background:' + C.blush + ';border-radius:12px;padding:16px 18px;font-size:15px;margin-bottom:18px">' + esc_(line) + '</div>' +
    classDetails_(o) +
    p_('Still want to come? Spots may still be open, so you can book again.', 15) +
    (again ? button_(again, 'Book again') : '') +
    p_('If you did pay, or think something went wrong, just reply to this email and mention your order number.', 14));
  sendMail_({
    to: o.customer.email,
    subject: subjectPrefix_(cfg) + 'Your class spot wasn’t held – Sweet Nothings ' + o.number,
    htmlBody: html,
    body: [(first ? 'Hi ' + first + ',' : 'Hi,'), '', line, '', classText_(o), '',
      'Still want to come? Spots may still be open' + (again ? ': ' + again : '.'), '',
      'If you did pay, or think something went wrong, just reply to this email and mention your order number ' + o.number + '.'].join('\n'),
    name: cfg.senderName, replyTo: cfg.replyToEmail
  });
}

function classPayLine_(o) {
  if (o.status === 'Paid') return 'Your payment went through. Thank you!';
  if (!(o.total > 0)) return 'Nothing to pay. See you there!';
  return 'I’ll be in touch about payment.';
}

/* ---------- Owner alert: new class booking ---------- */
// late: paid in Square after the hold ran out (the spot may have been taken by then).
function sendOwnerClassAlert_(cfg, o, late) {
  const how = o.status === 'Paid' ? 'Paid online through Square.' : o.total > 0 ? 'Not paid online; collect payment another way.' : 'Nothing to pay.';
  const html = shell_(cfg, late ? 'Late class payment: check spots' : 'New class booking', o.number,
    (late ? '<div style="background:' + C.blush + ';border-radius:12px;padding:16px 18px;font-size:15px;margin-bottom:18px"><strong>Paid after the ' + (Number(cfg.classHoldMinutes) || 30) +
      '-minute hold ran out.</strong> The spot was released meanwhile, so the class may now be over capacity. Check the class and refund in Square if needed.</div>' : '') +
    '<div style="font-size:15px;margin-bottom:18px"><strong>' + esc_(o.customer.name) + '</strong><br>' +
      '<a href="mailto:' + esc_(o.customer.email) + '" style="color:' + C.navy + '">' + esc_(o.customer.email) + '</a><br>' + esc_(o.customer.phone) + '</div>' +
    classDetails_(o) + totalsBlock_(o, 'Total') +
    (cfg.adminUrl ? button_(cfg.adminUrl, 'Open admin') : '') +
    p_(how + ' Booked automatically; no review needed. Reply to this email to write to the customer.', 13));
  sendMail_({
    to: cfg.ownerEmail,
    subject: subjectPrefix_(cfg) + (late ? 'LATE class payment – ' : 'New class booking – ') + o.number + ' (' + o.items.map((it) => it.qty + ' × ' + it.title).join(', ') + ')',
    htmlBody: html,
    body: [(late ? 'LATE class payment (after the hold ran out; check spots): ' : 'New class booking: ') + o.number, how, o.customer.name, o.customer.email, o.customer.phone, '', classText_(o), '', totalsText_(o, 'Total')].join('\n'),
    name: cfg.senderName, replyTo: o.customer.email
  });
}

/* ---------- Class details and "Add to calendar" ---------- */
// "6:00 PM", "6pm", "18:00" -> [18, 0]; anything else -> null.
function clock24_(t) {
  const m = String(t || '').trim().match(/^(\d{1,2})(?::(\d{2}))?\s*([ap])?\.?m?\.?$/i);
  if (!m) return null;
  let h = Number(m[1]) % (m[3] ? 12 : 24);
  if (m[3] && /p/i.test(m[3])) h += 12;
  return [h, Number(m[2] || 0)];
}
// Local (Chicago) start and end for a class, as "20261119T180000". No end time: two hours after the start.
function classTimes_(ev) {
  if (!ev || !ev.date) return null;
  const s = clock24_(ev.start);
  if (!s) return null;
  const e = clock24_(ev.end) || [s[0] + 2, s[1]];
  const d = String(ev.date).replace(/-/g, '');
  const two = (n) => String(n).padStart(2, '0');
  return { start: d + 'T' + two(s[0]) + two(s[1]) + '00', end: d + 'T' + two(Math.min(e[0], 23)) + two(e[1]) + '00' };
}
function classPlace_(ev) { return [ev.venue, ev.address].filter(Boolean).join(', '); }
function googleCalUrl_(cfg, ev) {
  const t = classTimes_(ev);
  if (!t) return '';
  const details = [String(ev.desc || '').slice(0, 1200), cfg.siteUrl ? 'Details: ' + cfg.siteUrl + 'events.html' : ''].filter(Boolean).join('\n\n');
  return 'https://calendar.google.com/calendar/render?action=TEMPLATE&text=' + encodeURIComponent(ev.title) +
    '&dates=' + t.start + '/' + t.end + '&ctz=America/Chicago&details=' + encodeURIComponent(details) + '&location=' + encodeURIComponent(classPlace_(ev));
}
// A calendar file (Apple Calendar, Outlook), in Chicago time.
function classIcs_(cfg, ev) {
  const t = classTimes_(ev);
  if (!t) return '';
  const esc = (s) => String(s || '').replace(/\\/g, '\\\\').replace(/;/g, '\\;').replace(/,/g, '\\,').replace(/\r?\n/g, '\\n');
  return ['BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//Sweet Nothings by M//Classes//EN', 'CALSCALE:GREGORIAN', 'METHOD:PUBLISH',
    'BEGIN:VTIMEZONE', 'TZID:America/Chicago',
    'BEGIN:DAYLIGHT', 'TZOFFSETFROM:-0600', 'TZOFFSETTO:-0500', 'TZNAME:CDT', 'DTSTART:19700308T020000', 'RRULE:FREQ=YEARLY;BYMONTH=3;BYDAY=2SU', 'END:DAYLIGHT',
    'BEGIN:STANDARD', 'TZOFFSETFROM:-0500', 'TZOFFSETTO:-0600', 'TZNAME:CST', 'DTSTART:19701101T020000', 'RRULE:FREQ=YEARLY;BYMONTH=11;BYDAY=1SU', 'END:STANDARD',
    'END:VTIMEZONE',
    'BEGIN:VEVENT', 'UID:' + ev.id + '-' + t.start + '@sweetnothingsbym.com', 'DTSTAMP:' + Utilities.formatDate(new Date(), 'UTC', "yyyyMMdd'T'HHmmss'Z'"),
    'DTSTART;TZID=America/Chicago:' + t.start, 'DTEND;TZID=America/Chicago:' + t.end,
    'SUMMARY:' + esc(ev.title), 'LOCATION:' + esc(classPlace_(ev)),
    'DESCRIPTION:' + esc([String(ev.desc || '').slice(0, 1200), cfg.siteUrl ? 'Details: ' + cfg.siteUrl + 'events.html' : ''].filter(Boolean).join('\n\n')),
    'END:VEVENT', 'END:VCALENDAR'].join('\r\n');
}
// A Drive share link as an image address (like SN.photoUrl on the site), else ''.
function photoUrl_(v) {
  const s = String(v || '').trim();
  if (!s || s[0] === '[') return '';
  const m = s.match(/drive\.google\.com\/(?:file\/d\/|open\?id=|uc\?(?:export=\w+&)?id=)([\w-]{10,})/);
  if (m) return 'https://drive.google.com/thumbnail?id=' + m[1] + '&sz=w1600';
  return /^https?:\/\//.test(s) ? s : '';
}
// The full class info for the booking email: where (with a directions link), the description, the flyer and
// calendar buttons. Uses the class as it is on the Events tab now, so later edits (new address, flyer) show up.
function classInfoBlock_(cfg, o) {
  const seen = {};
  return o.items.map((it) => (cfg.events || []).find((e) => e.id === it.eventId)).filter((ev) => ev && !seen[ev.id] && (seen[ev.id] = true)).map((ev) => {
    const place = classPlace_(ev);
    const maps = ev.address ? 'https://www.google.com/maps/search/?api=1&query=' + encodeURIComponent(place) : '';
    const flyer = photoUrl_(ev.flyer);
    const gcal = googleCalUrl_(cfg, ev);
    const ics = cfg.siteUrl && classTimes_(ev) ? cfg.siteUrl + 'calendar.html?event=' + encodeURIComponent(ev.id) : '';
    const btn = (href, label) => '<a href="' + esc_(href) + '" style="display:inline-block;margin:0 8px 8px 0;padding:10px 16px;border-radius:999px;border:1px solid ' + C.navy + ';color:' + C.navy + ';text-decoration:none;font-weight:600;font-size:14px">' + label + '</a>';
    return '<div style="border-top:1px solid ' + C.line + ';padding-top:14px;margin-bottom:18px">' + h2_(esc_(ev.title)) +
      '<div style="font-size:15px;font-weight:600;margin-bottom:8px">' + esc_([prettyDate_(ev.date), [ev.start, ev.end].filter(Boolean).join('–')].filter(Boolean).join(' · ')) + '</div>' +
      (place ? '<div style="margin-bottom:12px;font-size:15px"><div style="color:' + C.muted + ';font-size:12px;text-transform:uppercase;letter-spacing:.06em">Where</div>' +
        (ev.venue ? '<div style="font-weight:600">' + esc_(ev.venue) + '</div>' : '') +
        (ev.address ? '<a href="' + esc_(maps) + '" style="color:' + C.navy + '">' + esc_(ev.address) + '</a><div style="color:' + C.muted + ';font-size:13px">Tap the address for directions.</div>' : '') + '</div>' : '') +
      (ev.desc ? '<div style="font-size:15px;white-space:pre-wrap;margin-bottom:12px">' + esc_(ev.desc) + '</div>' : '') +
      (flyer ? '<a href="' + esc_(flyer) + '"><img src="' + esc_(flyer) + '" alt="Flyer for ' + esc_(ev.title) + '" width="520" style="display:block;width:100%;max-width:520px;height:auto;border-radius:12px;border:1px solid ' + C.line + ';margin-bottom:6px"></a>' +
        '<div style="color:' + C.muted + ';font-size:13px;margin-bottom:12px">Tap the flyer to see it full size.</div>' : '') +
      (gcal || ics ? '<div style="margin-top:4px">' + (gcal ? btn(gcal, 'Add to Google Calendar') : '') + (ics ? btn(ics, 'Add to Apple / Outlook calendar') : '') + '</div>' : '') +
    '</div>';
  }).join('');
}
function classInfoText_(cfg, o) {
  const seen = {};
  return o.items.map((it) => (cfg.events || []).find((e) => e.id === it.eventId)).filter((ev) => ev && !seen[ev.id] && (seen[ev.id] = true)).map((ev) =>
    [ev.title, [prettyDate_(ev.date), [ev.start, ev.end].filter(Boolean).join('–')].filter(Boolean).join(' · '),
      classPlace_(ev) ? 'Where: ' + classPlace_(ev) : '', ev.desc || '', photoUrl_(ev.flyer) ? 'Flyer: ' + photoUrl_(ev.flyer) : '',
      googleCalUrl_(cfg, ev) ? 'Add to Google Calendar: ' + googleCalUrl_(cfg, ev) : '',
      cfg.siteUrl && classTimes_(ev) ? 'Add to Apple / Outlook calendar: ' + cfg.siteUrl + 'calendar.html?event=' + encodeURIComponent(ev.id) : ''].filter(Boolean).join('\n')).join('\n\n');
}
function classDetails_(o) {
  return '<div style="border-top:1px solid ' + C.line + ';padding-top:14px;margin-bottom:18px">' + h2_('Your class' + (o.items.length > 1 ? 'es' : '')) +
    o.items.map((it) =>
      '<div style="padding:8px 0;font-size:15px"><table role="presentation" cellpadding="0" cellspacing="0" width="100%"><tr><td><strong>' + esc_(it.title) + '</strong></td>' +
        '<td align="right">' + money_(it.lineTotal) + '</td></tr></table>' +
        '<div style="color:' + C.muted + ';font-size:14px">' + esc_([it.summary, it.address].filter(Boolean).join(' · ')) + '</div>' +
        '<div style="color:' + C.muted + ';font-size:14px">' + it.qty + ' spot' + (it.qty > 1 ? 's' : '') + ' × ' + money_(it.unit) + '</div></div>').join('') +
  '</div>';
}
function classText_(o) {
  return o.items.map((it) => it.title + ' – ' + it.qty + ' spot' + (it.qty > 1 ? 's' : '') + ' × ' + money_(it.unit) + ' = ' + money_(it.lineTotal) +
    '\n   ' + [it.summary, it.address].filter(Boolean).join(' · ')).join('\n');
}

/* ---------- "A message about your order" (customer), sent from Review ---------- */
// The greeting ("Hi Pat,") is typed into the admin's message box, where Melissa can see and change it.
function sendOrderMessageEmail_(cfg, o, text) {
  const inv = o.invoice;
  const totals = inv
    ? totalsBlock_(invoiceTotals_(o), o.type === 'Class' ? 'Total' : 'Amount due')
    : totalsBlock_(o, 'Estimated total');
  const html = shell_(cfg, 'A message about your order', o.number,
    '<div style="font-size:15px;white-space:pre-wrap;margin-bottom:18px;color:' + C.navy + '">' + esc_(text) + '</div>' +
    '<p style="margin:0 0 18px;font-size:15px">— Sweet Nothings</p>' +
    (o.type === 'Class' ? classDetails_(o) : facts_(o, 'message') + itemsBlock_(o, 'Your order')) + totals +
    p_('Just reply to this email to answer.', 14));
  sendMail_({
    to: o.customer.email,
    subject: subjectPrefix_(cfg) + 'A message about your order ' + o.number + ' – Sweet Nothings',
    htmlBody: html,
    body: text + '\n\n— Sweet Nothings\n\nYour order ' + o.number + ':\n' +
      (o.type === 'Class' ? classText_(o) : 'Needed by: ' + prettyDate_(o.dateNeeded) + '\n' + itemsText_(o)) + '\n\nJust reply to this email to answer.',
    name: cfg.senderName, replyTo: cfg.replyToEmail
  });
}

/* ---------- Pickup / drop-off time: confirmed, and the reminder the day before ---------- */
function handoffLabel_(o) { return o.fulfillment === 'delivery' ? 'Drop-off' : 'Pickup'; }
// "Fri, Nov 6 at 5:00 PM" (times saved as 17:00 from the admin's time box)
function handoffWhen_(o) {
  const t = String(o.handoff.time || '');
  const m = t.match(/^(\d{1,2}):(\d{2})$/);
  const time = m ? ((Number(m[1]) % 12) || 12) + ':' + m[2] + ' ' + (Number(m[1]) < 12 ? 'AM' : 'PM') : t;
  return prettyDate_(o.handoff.date) + ' at ' + time;
}
// kind: 'confirm' (Melissa set the time) or 'reminder' (the morning before). note: optional words from Melissa.
function sendHandoffEmail_(cfg, o, kind, note) {
  const label = handoffLabel_(o);
  const isDel = o.fulfillment === 'delivery' && o.address;
  const when = handoffWhen_(o);
  const place = isDel ? o.address.street + ', ' + o.address.city + ' ' + o.address.zip : cfg.pickupAddress;
  const title = kind === 'reminder' ? (isDel ? 'Your cookies arrive tomorrow' : 'See you tomorrow!') : 'Your ' + label.toLowerCase() + ' time is set';
  const intro = kind === 'reminder'
    ? 'Just a reminder about your ' + label.toLowerCase() + ' tomorrow.'
    : 'Thanks for working out a time with me! Here’s what we agreed.';
  const phone = cfg.ownerPhone
    ? '<p style="margin:0 0 18px;font-size:15px">Running late or need to change something? Text or call me at <a href="tel:' + esc_(String(cfg.ownerPhone).replace(/[^\d+]/g, '')) + '" style="color:' + C.navy + ';font-weight:600">' + esc_(cfg.ownerPhone) + '</a>.</p>'
    : '<p style="margin:0 0 18px;font-size:15px">Need to change something? Just reply to this email.</p>';
  const html = shell_(cfg, title, o.number,
    p_(intro, 15) +
    (note ? '<div style="font-size:15px;white-space:pre-wrap;margin-bottom:18px;color:' + C.navy + '">' + esc_(note) + '</div>' : '') +
    '<div style="background:' + C.blush + ';border-radius:12px;padding:16px 18px;margin-bottom:18px">' +
      '<div style="color:' + C.muted + ';font-size:12px;text-transform:uppercase;letter-spacing:.06em">' + label + '</div>' +
      '<div style="font-weight:700;font-size:18px;margin-top:2px">' + esc_(when) + '</div>' +
      (place ? '<div style="margin-top:8px;font-size:15px">' + esc_(place) + '</div>' : '') +
      (!isDel && cfg.pickupInstructions ? '<div style="color:' + C.muted + ';margin-top:6px;font-size:14px">' + esc_(cfg.pickupInstructions) + '</div>' : '') +
    '</div>' +
    phone + itemsBlock_(o, 'Your order') + p_('— Sweet Nothings', 15));
  const text = [intro, note || '', label + ': ' + when, place || '', !isDel && cfg.pickupInstructions ? cfg.pickupInstructions : '',
    cfg.ownerPhone ? 'Running late or need to change something? Text or call me at ' + cfg.ownerPhone + '.' : 'Need to change something? Just reply to this email.',
    '', 'Your order ' + o.number + ':', itemsText_(o), '', '— Sweet Nothings'].filter((l, i, a) => l !== '' || a[i - 1] !== '').join('\n');
  sendMail_({
    to: o.customer.email,
    subject: subjectPrefix_(cfg) + (kind === 'reminder' ? 'Reminder: ' + label.toLowerCase() + ' tomorrow, ' + when.replace(/^.* at /, '') : label + ' time confirmed: ' + when) + ' – Sweet Nothings ' + o.number,
    htmlBody: html, body: text, name: cfg.senderName, replyTo: cfg.replyToEmail
  });
}

/* ---------- Reply to a message (customer) ---------- */
function sendMessageReplyEmail_(cfg, m, text) {
  const when = m.createdAt ? Utilities.formatDate(new Date(m.createdAt), tz_(), 'MMM d') : '';
  const html = shell_(cfg, 'A reply from Sweet Nothings', '',
    '<div style="font-size:15px;white-space:pre-wrap;margin-bottom:18px;color:' + C.navy + '">' + esc_(text) + '</div>' +
    '<p style="margin:0 0 18px;font-size:15px">— Sweet Nothings</p>' +
    '<div style="border-left:3px solid ' + C.line + ';padding:4px 0 4px 14px;margin-bottom:18px;font-size:14px;color:' + C.muted + '">' +
      '<div style="font-size:12px;text-transform:uppercase;letter-spacing:.06em;margin-bottom:4px">You wrote' + (when ? ' on ' + esc_(when) : '') + '</div>' +
      '<div style="white-space:pre-wrap">' + esc_(m.message) + '</div></div>' +
    p_('Just reply to this email to answer.', 14));
  sendMail_({
    to: m.email,
    subject: subjectPrefix_(cfg) + 'Re: ' + (m.topic && m.topic !== 'Quick message' ? m.topic : 'your message') + ' – Sweet Nothings',
    htmlBody: html,
    body: text + '\n\n— Sweet Nothings\n\n' +
      'You wrote' + (when ? ' on ' + when : '') + ':\n' + m.message.split('\n').map((l) => '> ' + l).join('\n') + '\n\nJust reply to this email to answer.',
    name: cfg.senderName, replyTo: cfg.replyToEmail
  });
}

// "24 Custom Cookies", "12 Mini Artisan", or for a class "2 spots · Class: Holiday decorating"
function itemHeading_(it) {
  return it.kind === 'class' ? it.qty + ' spot' + (it.qty > 1 ? 's' : '') + ' · Class: ' + it.title : it.qty + ' ' + itemLabel_(it.kind);
}

/* ---------- Building blocks ---------- */
function shell_(cfg, title, number, inner) {
  const logo = cfg.siteUrl ? '<img src="' + esc_(cfg.siteUrl) + 'logo.png?v=2" width="110" height="110" alt="Sweet Nothings by M" style="display:block;margin:0 auto;width:110px;height:110px;border:0;border-radius:50%">' : '';
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

// "Best pickup window" or "Best drop-off window": when the customer said they can meet Melissa (she confirms the exact time).
function windowLabel_(o) { return o.fulfillment === 'delivery' ? 'Best drop-off window' : 'Best pickup window'; }

// forOwner: true for the owner alert; 'confirmed' for email #2 (the pickup address is shown above the facts there).
function facts_(o, forOwner) {
  const where = o.fulfillment === 'delivery' && o.address
    ? ['Drop-off to', esc_(o.address.street) + ', ' + esc_(o.address.city) + ' ' + esc_(o.address.zip)]
    : ['Pickup', forOwner === true ? 'Pickup' : esc_(getConfig_().pickupCity) + (forOwner === 'confirmed' ? ' (address above)' : ' (address sent once confirmed)')];
  const cell = (k, v) => '<td style="width:50%;vertical-align:top;padding:0 12px 14px 0"><div style="color:' + C.muted + ';font-size:12px;text-transform:uppercase;letter-spacing:.06em">' + k + '</div><div style="font-weight:600;margin-top:2px;font-size:14px">' + v + '</div></td>';
  return '<table role="presentation" cellpadding="0" cellspacing="0" width="100%" style="margin-bottom:4px">' +
    '<tr>' + cell('Needed by', esc_(prettyDate_(o.dateNeeded)) + (o.eventTime ? '<br><span style="font-weight:400">Event at ' + esc_(o.eventTime) + '</span>' : '')) + cell('Occasion', esc_(occasion_(o))) + '</tr>' +
    '<tr>' + cell(where[0], where[1]) + cell('Contact', esc_(o.customer.name) + '<br>' + esc_(o.customer.phone)) + '</tr>' +
    (o.pickupWindow ? '<tr><td colspan="2" style="padding:0 0 14px"><div style="color:' + C.muted + ';font-size:12px;text-transform:uppercase;letter-spacing:.06em">' + windowLabel_(o) + '</div><div style="font-weight:600;margin-top:2px;font-size:14px">' + esc_(o.pickupWindow) + '</div></td></tr>' : '') +
    (o.allergies && forOwner !== true ? '<tr><td colspan="2" style="padding:0 0 14px"><div style="color:' + C.muted + ';font-size:12px;text-transform:uppercase;letter-spacing:.06em">Allergies / dietary needs</div><div style="font-weight:600;margin-top:2px;font-size:14px">' + esc_(o.allergies) + '</div></td></tr>' : '') +
  '</table>';
}

// forOwner: also link the inspiration photo (a private Drive file only the owner can open).
function itemsBlock_(o, heading, forOwner) {
  return '<div style="border-top:1px solid ' + C.line + ';padding-top:14px;margin-bottom:18px">' + h2_(heading) +
    o.items.map((it) =>
      '<div style="padding:8px 0">' +
        '<table role="presentation" cellpadding="0" cellspacing="0" width="100%" style="font-size:15px"><tr><td><strong>' + esc_(itemHeading_(it)) + '</strong></td><td align="right">' + (it.kind === 'custom' ? 'from ' : '') + money_(it.lineTotal) + '</td></tr></table>' +
        '<div style="color:' + C.muted + ';font-size:14px">' + esc_(it.summary) + '</div>' +
        (it.desc ? '<div style="font-size:14px;color:' + C.muted + ';background:#FBF7F4;border-radius:10px;padding:10px 12px;margin-top:6px"><strong style="color:' + C.navy + '">Description:</strong> ' + esc_(it.desc) + '</div>' : '') +
        (forOwner && it.photos && it.photos.length ? '<div style="font-size:14px;margin-top:6px">' + photoLinks_(it.photos, 'their inspiration photo') + '</div>' : '') +
      '</div>').join('') +
  '</div>';
}

// The sales tax line. QuickBooks works out the tax on its invoice, so until there is one the line says it's added
// there (and the total is before tax). taxFromQb: the amount came from the QuickBooks invoice. Orders from before
// this change kept the site's own tax, and still show it.
function taxLine_(o) {
  if (o.fulfillment === 'class') return null;   // classes: no sales tax
  if (o.taxFromQb) return { label: 'Sales tax', amount: o.tax };
  if (o.tax > 0) return { label: 'Tax (' + o.taxRate + '%)', amount: o.tax };
  return { label: 'Sales tax', amount: null };
}
const beforeTax_ = (o, label) => { const t = taxLine_(o); return t && t.amount === null ? label.replace(/\*?$/, ' (before tax)$&') : label; };

function totalsBlock_(o, totalLabel) {
  const row = (k, v) => '<tr><td style="padding:3px 0;color:' + C.muted + ';font-size:15px">' + k + '</td><td align="right" style="padding:3px 0;font-size:15px">' + v + '</td></tr>';
  const isDel = o.fulfillment === 'delivery';
  const cookies = o.fulfillment !== 'class';   // classes have no tax or pickup/drop-off
  const tax = taxLine_(o);
  return '<table role="presentation" cellpadding="0" cellspacing="0" width="100%" style="border-top:1px solid ' + C.line + ';padding-top:14px;margin-bottom:10px">' +
    row('Subtotal', money_(o.subtotal)) +
    (o.discount ? row('Promo code ' + esc_(o.promoCode), '−' + money_(o.discount)) : '') +
    (tax ? row(tax.label, tax.amount === null ? '<span style="color:' + C.muted + ';font-size:14px">Added to your invoice</span>' : money_(tax.amount)) : '') +
    (cookies ? row(isDel ? 'Drop-off' : 'Pickup', isDel ? money_(o.deliveryFee) : 'Free') : '') +
    (o.giftCredit ? row('Gift card' + (o.promoCode ? ' ' + esc_(o.promoCode) : ''), '−' + money_(o.giftCredit)) : '') +
    '<tr><td style="border-top:1px solid ' + C.line + ';padding-top:10px"><strong>' + beforeTax_(o, totalLabel) + '</strong></td>' +
      '<td align="right" style="border-top:1px solid ' + C.line + ';padding-top:10px;font-family:' + SERIF + ';font-size:30px;font-weight:700">' + money_(o.total) + '</td></tr>' +
  '</table>';
}

// An approved order's totals for emails: QuickBooks' tax and amount due when it has made the invoice.
function invoiceTotals_(o) {
  const inv = o.invoice, qb = inv.qb || {};
  const fromQb = !!(qb.id && isFinite(qb.total));
  return {
    fulfillment: o.fulfillment, subtotal: inv.subtotal, deliveryFee: inv.fee, giftCredit: inv.credit || 0, promoCode: o.promoCode,
    taxRate: o.taxRate, taxFromQb: fromQb,
    // QuickBooks' tax is the gap between its total and the untaxed parts (lines, drop-off, gift card).
    tax: fromQb ? round2_(qb.total - inv.subtotal - (inv.fee || 0) + (inv.credit || 0)) : inv.tax,
    total: fromQb ? qb.total : inv.total
  };
}

function button_(href, label) {
  return '<div style="text-align:center;margin:8px 0 18px"><a href="' + esc_(href) + '" style="display:inline-block;background:' + C.coral + ';color:#FFFFFF;text-decoration:none;font-weight:700;padding:14px 26px;border-radius:999px;font-size:16px">' + esc_(label) + '</a></div>';
}

function itemsText_(o, forOwner) {
  return o.items.map((it) => itemHeading_(it) + ' – ' + (it.kind === 'custom' ? 'from ' : '') + money_(it.lineTotal) +
    '\n   ' + it.summary + (it.desc ? '\n   Description: ' + it.desc : '') +
    (forOwner && it.photos ? it.photos.map((p, i) => '\n   Inspiration photo' + (it.photos.length > 1 ? ' ' + (i + 1) : '') + ': ' + p.url).join('') : '')).join('\n');
}

// Owner emails: "View their photo", or "Their photos: Photo 1 · Photo 2 · …" (private Drive links).
function photoLinks_(photos, what) {
  const a = (p, label) => '<a href="' + esc_(p.url) + '" style="color:' + C.navy + ';font-weight:600">' + label + '</a>';
  return photos.length === 1 ? a(photos[0], 'View ' + what)
    : 'Their photos: ' + photos.map((p, i) => a(p, 'Photo ' + (i + 1))).join(' · ');
}

function totalsText_(o, totalLabel) {
  const cookies = o.fulfillment !== 'class';
  const tax = taxLine_(o);
  return ['Subtotal: ' + money_(o.subtotal),
    o.discount ? 'Promo code ' + o.promoCode + ': -' + money_(o.discount) : '',
    tax ? tax.label + ': ' + (tax.amount === null ? 'added to your invoice' : money_(tax.amount)) : '',
    cookies ? (o.fulfillment === 'delivery' ? 'Drop-off: ' + money_(o.deliveryFee) : 'Pickup: Free') : '',
    o.giftCredit ? 'Gift card: -' + money_(o.giftCredit) : '',
    beforeTax_(o, totalLabel) + ': ' + money_(o.total)].filter(Boolean).join('\n');
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
// "$4.80", and "−$58.20" (not "$-58.20") for discounts.
function money_(n) { const v = round2_(Number(n) || 0); return (v < 0 ? '−' : '') + '$' + Math.abs(v).toFixed(2); }

function esc_(s) {
  return String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

// Trimmed text with a length cap.
function clean_(v, max) { return String(v == null ? '' : v).trim().slice(0, max || 500); }

// Stop customer text from being treated as a Sheets formula.
function cell_(v) { return typeof v === 'string' && /^[=+\-@]/.test(v) ? "'" + v : v; }

// Same checks as SN.validEmail / SN.phoneDigits in the site's config.js.
// Email endings customers really use (same list as SN.EMAIL_ENDINGS in config.js); anything else is treated as a typo.
const EMAIL_ENDINGS = ['com', 'net', 'org', 'edu', 'gov', 'mil', 'us', 'co', 'io', 'me', 'info', 'biz', 'ai', 'app', 'dev', 'ca', 'uk', 'au', 'nz', 'ie', 'de', 'fr', 'mx', 'in'];
function validEmail_(s) {
  return /^[^\s@]+@[^\s@.]+(\.[^\s@.]+)*\.[A-Za-z]{2,}$/.test(s) && EMAIL_ENDINGS.indexOf(String(s).split('.').pop().toLowerCase()) !== -1;
}

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
