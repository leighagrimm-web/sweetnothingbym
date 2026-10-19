# Sweet Nothings by M — website prototype

A clickable prototype of the ordering site for **Sweet Nothings by M** ([@sweet_nothings_by_m](https://www.instagram.com/sweet_nothings_by_m/)).

## What's in here

| Page | What it does |
|---|---|
| `index.html` | **Landing page.** Hero with **Start your order**, what she makes (with live prices), how ordering works, recent creations, and links to FAQ and Contact. |
| `order.html` | **Order page.** Menu of Custom Cookies (starting at $5/cookie), Mini Artisan and Large Artisan. Each opens a slide-over to customize and **Add to bag**. The **Bag** collects event type, date (8+ days out), allergies/dietary needs (optional), pickup or drop-off (fee by ZIP) and contact details, shows an **estimated** total, and sends a **preliminary order request** (no payment yet). |
| `faq.html` | **FAQ.** Questions and answers she edits from the admin page (starter answers have [brackets] for her details). |
| (every page) | **Message me** pop-out form (email + message only), opened by any button with `data-quick-message="<topic>"`. Used on Special Events. |
| `contact.html` | **Contact form.** Name, email (required), phone (optional), topic, message and an optional photo. Messages show in the admin **Messages** inbox. |
| `admin.html` | **Owner admin.** Orders arrive as *Pending review*. **Review** opens the request with an editable invoice: approve as-is, approve with changes (edit prices/qty, add lines, change drop-off fee, add a note), or decline. Approving sends the invoice. **Preview changes** opens the site in a new tab showing her unsaved edits (yellow "Preview mode" banner, ordering turned off) before she saves. Also: **Messages** inbox from the Contact page and the "Message me" form, **FAQ editor**, custom starting price + pricing note, artisan prices, add/hide/delete flavors, monthly special, lead time, blocked dates, drop-off ZIPs, tax rate, contact info. |
| `email.html` | Email previews: `?type=request` (request received), `?type=invoice` (approved, with Pay button), `?type=declined`. Add `&o=SN-1042` to show a real test order. |
| `about.html`, `events.html`, `gallery.html` | Content pages with `[bracketed]` placeholders for M's story and photos. |

Settings live in `js/config.js` (`SN_DEFAULTS`). Shared look is in `css/styles.css`.

## Backend (phase 1)

- Settings, orders and messages live in a **Google Sheet**, served by a **Google Apps Script** web app. Setup steps are in [`apps-script/README.md`](apps-script/README.md).
- `config.js` → `SN_ENV` picks the backend by website address: the GitHub Pages site uses the **UAT** Sheet, and Melissa's domain will use **PROD**.
- Sending an order request saves it as `SN-####`, emails the customer "request received (not yet confirmed)", and emails the owner "New order to review". Contact and "Message me" messages are saved and emailed to the owner, with reply-to set to the customer.
- If the Sheet can't be reached, pages show the built-in defaults, and sending shows a friendly error.

## Still prototype (later phases)

- **Admin page** (`admin.html`) still works only in the browser it's opened in. It moves to Apps Script with Google sign-in in phase 2. Until then, edit settings directly in the Sheet.
- **Photos** aren't uploaded yet (phase 4). Only the file name is recorded.
- **Payments / QuickBooks** come in phase 3.

## Publish it on GitHub Pages

1. Create a new repository on GitHub (for example `sweet-nothings`). Public is required for free GitHub Pages.
2. Click **Add file → Upload files**, drag in everything from this folder (keep the `assets`, `css` and `js` folders), and commit.
3. Go to **Settings → Pages**. Under **Build and deployment**, set Source to **Deploy from a branch**, branch **main**, folder **/ (root)**, and save.
4. After a minute or two the site is live at `https://<your-username>.github.io/sweet-nothings/`.

## Adding real photos

- Menu cards: put photos in `assets/` and set the paths in `js/config.js` under `images` (for example `custom: 'assets/custom.jpg'`).
- Gallery: list photos in the `photos` array at the bottom of `gallery.html`.
- About and Events: replace the `[bracketed]` placeholders.

## Next phase (real build in Claude Code)

- Google Sheet with **Settings** and **Orders** tabs; Google Apps Script web app to save orders and serve settings
- Order numbers; "request received" email to customer and "new order to review" email to owner, sent from Gmail via Apps Script
- **Approval flow:** admin Approve (as-is or with changes) calls Apps Script, which creates the customer + invoice in **QuickBooks Online** (lines, tax, drop-off fee, M's note in the invoice memo/message) and sends it via the QuickBooks invoice *send* endpoint so the customer gets a Pay button (requires QuickBooks Payments). Decline sends a decline email. Status flow: Pending review → Invoice sent → Paid → Baking → Ready → Completed (or Declined)
- Preview changes: the admin page will live on Apps Script (a different site than GitHub Pages), so browser storage can't carry the draft. Save the draft to a "Draft" tab in the Sheet and have the public site read it when opened with `?preview=1`
- Blocked dates: keep auto-dropping dates before today (done in `SN.dropPastDates`)
- Contact form: save to a Messages tab, email M with the customer's email as reply-to, photo to Drive
- FAQ: store in a FAQ tab of the Sheet so the admin editor saves there
- Optional: hourly Apps Script trigger that checks QuickBooks for paid invoices and flips the order to Paid
- Inspiration photos saved to a Google Drive folder
- Admin page locked to the owner's Google account
- Max-orders-per-day enforcement and fully booked dates
