# DGI LMS — Library Management System
### Dronacharya Group of Institutions, Greater Noida

A complete copy of the Library Management System, rebranded for
**Dronacharya Group of Institutions, Greater Noida**. The system is
identical to the original — same features, same design, same screens and
flows (dashboard, books catalogue with Excel import and ISBN/QR scan,
students & faculty, issue/return with ₹5/day fines, deadline alerts,
WhatsApp/email notification log, borrower reissue links, reports,
backup/restore and account settings). Only the institution identity
(name, library name, storage keys) has been changed.

**Colour theme:** the app uses a warm college palette of maroon `#510027`,
cream `#fff1cc` and gold `#ffc500`. The maroon sidebar and topbar pair
with readable cream and gold text; the default accent is named
`dronacharya` (other accent options remain in the topbar picker). The app carries the college's
**full official logo** — the complete emblem + wordmark lockup
(emblem with Dronacharya the archer, open book and the motto banner
"विद्या ददाति विनयम्", beside "DRONACHARYA / Group of Institutions /
Greater Noida"), shown on a white/cream plate with a subtle border
(sign-in page, topbar, reissue page); the sidebar uses the emblem
portion alone on the same white plate.

---

## How to run locally

You only need **Node.js** (any recent version). No `npm install` — the
server uses zero external packages.

```bash
cd library-dronacharya
node server.js
```

Then open **http://localhost:3000** in a browser.
(On Windows you can also double-click `open_app.bat`.)

The server listens on `process.env.PORT || 3000` and binds `0.0.0.0`,
so the same file runs unchanged on a local PC and on Render.

All data (accounts, library state, messages, reissue requests) is stored
in **`data/library-data.json`** next to `server.js`. Back up that one
file to back up the whole system.

## Admin login

| Username | Password |
|---|---|
| `admin` | `admin123` |

This is the pre-seeded primary librarian account. **Change the password
after the first sign-in** from **Settings → Account Security**.

The original account system is fully preserved:

- Additional librarian accounts can be created from the login screen
  (**Create Account**) — every account gets its **own separate library
  database**, exactly like the original.
- Username/password can be changed from Settings; forgot-password
  generates a one-time reset link (in this standalone build the link is
  printed in the server console, because no mail server is configured).
- If `data/library-data.json` is deleted, the app returns to the
  original **first-run setup screen** ("Create Admin Account") on the
  next start.

## Deploy on Render

1. Push this folder to a GitHub repository (or use Render's manual
   deploy with the ZIP contents).
2. Create a **Web Service** → Runtime: **Node**.
3. **Build Command:** *(leave empty — no dependencies)*
4. **Start Command:** `node server.js`
5. Render sets `PORT` automatically; the server reads it.
6. Note: on Render's free plan the filesystem is temporary — data in
   `data/library-data.json` resets on redeploy/restart. Attach a Render
   Disk mounted at `data/` (or move to a paid plan) for permanent data.

---

## Institution details — real, from the college website

The app now carries DGI's real published details, taken from the
Contact page of **gnindia.dronacharya.info**:

- **Logo:** the full official DGI logo lockup (emblem + wordmark,
  dark maroon artwork on white) at `assets/logo.png` and the
  project-root `logo.png`; the emblem portion alone is at
  `assets/logo-emblem.png` for the sidebar.
- **Address:** #27, APJ Abdul Kalam Road, Knowledge Park-III, Greater
  Noida, UP - 201306 (seeded in the `js/db.js` settings defaults).
- **Phone:** 0120-2322022 / 2323851-56 · **Email:**
  `info@dronacharya.info` (also the Gmail compose account in
  `js/app.js`, `buildGmailComposeLink`) · **Since 2006.**
- **Affiliation:** "Affiliated to Dr. A.P.J. Abdul Kalam Technical
  University, Lucknow & Approved by AICTE, New Delhi" (topbar).
- The sign-in page shows the same details under the login card.

**AKTU college code — not shown.** The college code is **not published
on the college website** (the homepage, Contact page, approvals and
Mandatory Disclosure were all checked), so no college code appears
anywhere in the app. If DGI provides the code, it can be added to the
sign-in page contact block in `login.html`.

## ⚠️ One placeholder left: sample student data
   `js/student_records_import.js` in the original carried the other
   college's **real** student records; those were deliberately **not**
   copied. This build ships the same file/format with 8 clearly-marked
   **sample** students (names end with "(Sample)", @example.com emails)
   plus the same generic book catalogue, so the dashboard and charts
   demonstrate correctly on the primary account. Delete the sample
   students from the **Students** view once real DGI data is entered.

---

## What is inside

| File / folder | Purpose |
|---|---|
| `index.html` | The full LMS single-page app (dashboard, books, students, faculty, issue, return, alerts, reports, settings) |
| `login.html` | Sign in / create account / forgot & reset password |
| `reissue.html` | Public borrower page opened from a reissue link *(newly written for this copy — the original's page was not in the handed-over source; it talks to the same reissue API)* |
| `css/style.css` | The complete original design system (unchanged) |
| `js/` | `app.js`, `auth.js`, `db.js`, `charts.js`, `qr.js`, `xlsx_import.js`, `student_records_import.js` — original logic, rebranded |
| `server.js` | Pure-Node server: static files + the complete REST API |
| `assets/logo.png` | The college's full official logo lockup — emblem + "DRONACHARYA / Group of Institutions / Greater Noida" wordmark (also at the project root as `logo.png`); `assets/logo-emblem.png` is the emblem portion used in the sidebar |
| `data/library-data.json` | All persistent data (auto-created on first run) |
| `open_app.bat` | Windows double-click launcher |

## API implemented by `server.js`

- **Auth:** `GET /api/auth/status`, `POST /api/auth/setup`,
  `POST /api/auth/register`, `POST /api/auth/login`,
  `POST /api/auth/logout`, `POST /api/auth/forgot-password`,
  `POST /api/auth/reset-password`, `POST /api/auth/change-password`,
  `POST /api/auth/change-username` (cookie session, same-origin)
- **Library state:** `GET /api/library-state`,
  `PUT /api/library-state` (whole state as revision-numbered JSON;
  a stale revision is rejected with HTTP 409)
- **Messages:** `GET/POST /api/messages`,
  `POST /api/messages/import-legacy`,
  `DELETE /api/messages/failed`, `DELETE /api/messages/:id`,
  `POST /api/messages/:id/actions`
  (`submit`, `submit-manual-email`, `edit`, `prepare`, `cancel`,
  `resolve`, `acknowledge`, `mark-no-response`, `mark-sent`),
  `POST /api/messages/:id/replies/:replyId/read`
- **Reissue:** `POST /api/reissue-links`,
  `GET /api/reissue-links/:token`, `POST /api/reissue-requests`
  (borrower, via token), `GET /api/reissue-requests` (`?history=1` for
  all), `POST /api/reissue-requests/:id/actions` (`approve` extends the
  due date by 7 days and preserves any accrued fine, `reject`),
  `DELETE /api/reissue-requests/:id`,
  `GET /api/reissue-request-stats`

**One honest limitation:** the original deployment sent WhatsApp/email
messages through a configured provider. This standalone server has no
provider credentials, so a submitted message is recorded as a
**submission** and the app opens the WhatsApp/Gmail window for manual
sending — the same fallback flow the original UI already supports.
Automatic email-reply sync likewise reports "not configured".
