# Apps Script backend

Two files are pasted into the Sheet's Apps Script editor by hand. Each environment (UAT, PROD) has its own Sheet and script.

- **`Code.gs`** is the whole backend: the Google Sheet layout, the public web app the website talks to, the owner's admin functions, and the emails.
- **`Admin.html`** is a small loader for the owner's admin page. The admin's look and logic (`styles.css`, `config.js`, `admin.js`) load from the website, so admin changes ship with the website and this file rarely changes.

The same script has **two deployments**:

| Deployment | Execute as | Who has access | Used for |
|---|---|---|---|
| Public | Me | Anyone | The website: settings, order requests, messages |
| Admin | User accessing the web app | Only myself | The owner's admin page, behind Google sign-in |

## Set up a new environment (one time, about 10 minutes)

Type the addresses below yourself rather than clicking links in emails. Before you approve anything, check that the browser's address bar says `google.com`.

1. **Make the Sheet.** Signed in to the right Google account, go to `sheets.new`. Name it `Sweet Nothings – UAT` (or `– PROD`).
2. **Open the script editor.** In the Sheet: **Extensions → Apps Script**. Click "Untitled project" at the top and rename it `Sweet Nothings backend`.
3. **Set the time zone.** Click the gear (**Project Settings**) on the left. Under **Time zone**, pick **(GMT-06:00) Central Time – Chicago**.
4. **Paste the code.** Click **Editor** (the `<>` icon), then `Code.gs`. Select everything in it and delete it. Paste in the full contents of `apps-script/Code.gs` from this repo. Press **Ctrl+S** to save.
5. **Build the tabs.** In the toolbar's function menu (next to **Debug**), pick **setupSheet** and click **Run**.
   - Google asks for permission the first time: **Review permissions** → choose the account.
   - It warns "Google hasn't verified this app". That's normal for your own script. Click **Advanced** → **Go to Sweet Nothings backend (unsafe)** → **Allow**.
   - The log should end with `Sheet is ready.` Back in the Sheet, you'll see the tabs: Settings, Flavors, Zones, BlockedDates, FAQ, Orders, OrderItems, Messages, Draft, Counters.
6. **Publish the web app.** Click **Deploy → New deployment**. Click the gear next to "Select type" and choose **Web app**.
   - Description: `v1`
   - Execute as: **Me**
   - Who has access: **Anyone**

   Click **Deploy** and copy the **Web app URL** (it ends in `/exec`).
7. **Point the website at it.** Paste the URL into `config.js` → `SN_ENV` → `API.uat` (or `API.prod`).
8. **Add the admin page.**
   1. In the editor's **Files** list, click **+ → HTML**, name it `Admin`, and paste in `apps-script/Admin.html`. Save.
   2. Click **Deploy → New deployment → Web app**:
      - Description: `admin`
      - Execute as: **User accessing the web app**
      - Who has access: **Only myself**
   3. Click **Deploy** and copy its URL.
9. **Point everything at the admin.** Paste the admin URL in two places:
   - the Sheet's Settings tab, `adminUrl` (used in the "New order to review" emails)
   - `config.js` → `SN_ENV` → `ADMIN.uat` (or `ADMIN.prod`), used by the website's admin.html link

For PROD, also set `environment` to `PROD` and `siteUrl` to the real domain on the Settings tab. Leave `ownerEmail` blank to send alerts to the account that runs the script, and set `replyToEmail` to the business inbox.

## Updating the code later

1. Paste the new `Code.gs` (and `Admin.html`, if it changed) over the old one and save.
2. If the update added tabs or settings, run **setupSheet** again. It only adds what's missing.
3. Click **Deploy → Manage deployments**. For **each** deployment (public and admin), click the pencil, set **Version** to **New version**, and click **Deploy**.

   Don't use "New deployment" for updates: that creates a new URL and the website would stop reaching the script.

Changes to `admin.js`, `config.js` or `styles.css` only need publishing the website; the admin picks them up on its next load.

**Testing the admin locally:** run `node .claude/serve.js` and open `http://localhost:5500/admin.html?dev=1`. It uses fake data from `.claude/admin-dev.js`, not the Sheet.

## What's in the Sheet

| Tab | What it holds |
|---|---|
| Settings | Prices, lead time, tax, notes, contact info. `PRIVATE` rows are never sent to the website. |
| Flavors, Zones, BlockedDates, FAQ | The lists from the admin page. Past blocked dates are ignored automatically. |
| Pages | Website wording and photo slots: home page heading and photo, menu photos, About page, Events and Gallery headings. The "Where it shows" column says where each one appears. |
| Events | One card per row on the Special Events page. Untick **Show** to hide a card. **Button** is Order now, Message me, Sign up (uses **Sign-up link**; blank shows "coming soon") or None. |
| Gallery | One photo per row on the Gallery page, in order. The first 4 shown also appear under "Recent creations" on the home page. |

**Photos:** in any photo cell, paste either:
- a link to the image, or
- a Google Drive share link. In Drive, use **Share → General access → Anyone with the link**, then **Copy link**.

`[Bracket text]` shows a placeholder box. A blank cell shows no photo.

**Text:** a blank line starts a new paragraph. To add a line inside a cell in Sheets, press **Alt+Enter** (Ctrl+Enter on a Mac).
| Orders | One row per order request: `SN-####`, status, customer, date, totals, and whether each email sent. |
| OrderItems | One row per item in an order. |
| Messages | Contact page and "Message me" messages. |
| Draft | Unsaved admin changes for "Preview changes" (used from phase 2). |
| Counters | Next order number (starts at 1042) and next message ID. |

Editing the Sheet updates the website right away for new visitors. The script caches settings for up to 10 minutes, and an edit clears that cache. A browser tab that already has the site open keeps its copy for up to 30 seconds.

## Email

Emails go out with MailApp from the account that runs the script. That's about 100 emails a day on a personal Gmail.

- If a send fails, the order row says `FAILED: …` in the **Customer email** or **Owner alert** column.
- In UAT, every subject starts with `[TEST]`.
