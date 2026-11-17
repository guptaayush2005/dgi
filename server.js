/**
 * DGI LMS — Dronacharya Group of Institutions, Greater Noida
 * Library Management System (Standalone Server)
 * ---------------------------------------------------------------
 * Pure Node.js server (no npm packages needed).
 * Run:  node server.js
 * Open: http://localhost:3000  (or the PORT given by the host, e.g. Render)
 *
 * - Serves the website (index.html, login.html, reissue.html + css/js/assets)
 * - Implements the complete REST API the frontend calls:
 *     /api/auth/*            account setup, login, logout, status,
 *                            change username/password, forgot/reset password
 *     /api/library-state     GET/PUT of the whole library state (revisioned)
 *     /api/messages          notification messages, actions, replies,
 *                            failed-message cleanup, legacy import
 *     /api/reissue-links     creates borrower reissue links (tokens)
 *     /api/reissue-requests  borrower submissions + librarian approve/reject
 *     /api/reissue-request-stats
 * - All data is stored in data/library-data.json next to this file.
 *   Each librarian account has its own separate library state, exactly
 *   like the original system. The first account (created on the setup
 *   screen, or the pre-seeded "admin" account) is the primary account.
 * - Default seeded admin login: username "admin", password "admin123"
 *   (change it from Settings after the first sign-in; deleting
 *   data/library-data.json restores the first-run setup screen).
 */
const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const PORT = process.env.PORT || 3000;
const HOST = '0.0.0.0';
const ROOT = __dirname;
const DATA_DIR = process.env.VERCEL ? path.join('/tmp', 'data') : path.join(ROOT, 'data');
const DATA_FILE = path.join(DATA_DIR, 'library-data.json');
const SESSION_COOKIE = 'dgi_lms_session';
const REISSUE_EXTENSION_DAYS = 7;

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg',
  '.svg': 'image/svg+xml', '.ico': 'image/x-icon', '.json': 'application/json',
  '.txt': 'text/plain; charset=utf-8'
};

// ---------------------------------------------------------------------------
// Password hashing (scrypt, built into Node — no dependencies)
// ---------------------------------------------------------------------------
function hashPassword(password) {
  const salt = crypto.randomBytes(16).toString('hex');
  const hash = crypto.scryptSync(String(password), salt, 64).toString('hex');
  return { salt, hash };
}
function verifyPassword(password, salt, expectedHash) {
  try {
    const actual = crypto.scryptSync(String(password), salt, 64);
    const expected = Buffer.from(expectedHash, 'hex');
    return actual.length === expected.length && crypto.timingSafeEqual(actual, expected);
  } catch {
    return false;
  }
}

// ---------------------------------------------------------------------------
// Persistent store (single JSON file)
// ---------------------------------------------------------------------------
function emptyStore() {
  return {
    accounts: [],          // { username, key, salt, hash, isPrimary, createdAt }
    states: {},            // key -> { state: object|null, revision: number }
    messages: {},          // key -> [ message, ... ]
    reissueRequests: {},   // key -> [ request, ... ]
    reissueLinks: {},      // token -> { accountKey, transactionId, createdAt }
    resetTokens: {},       // token -> { accountKey, expiresAt }
    sessions: {}           // sid -> { accountKey, expiresAt }
  };
}
function seedStore() {
  const store = emptyStore();
  const { salt, hash } = hashPassword('admin123');
  store.accounts.push({
    username: 'admin',
    key: 'admin',
    salt,
    hash,
    isPrimary: true,
    createdAt: new Date().toISOString()
  });
  store.states.admin = { state: null, revision: 0 };
  store.messages.admin = [];
  store.reissueRequests.admin = [];
  return store;
}
function loadStore() {
  try {
    if (!fs.existsSync(DATA_FILE)) {
      try {
        fs.mkdirSync(DATA_DIR, { recursive: true });
        const seed = seedStore();
        fs.writeFileSync(DATA_FILE, JSON.stringify(seed, null, 2));
        return seed;
      } catch {
        return seedStore();
      }
    }
    const parsed = JSON.parse(fs.readFileSync(DATA_FILE, 'utf8'));
    const loaded = Object.assign(emptyStore(), parsed);
    loaded.sessions ||= {};
    if (!loaded.accounts || loaded.accounts.length === 0) {
      const seed = seedStore();
      loaded.accounts = seed.accounts;
      loaded.states = { ...seed.states, ...loaded.states };
      loaded.messages = { ...seed.messages, ...loaded.messages };
      loaded.reissueRequests = { ...seed.reissueRequests, ...loaded.reissueRequests };
    }
    return loaded;
  } catch {
    return seedStore();
  }
}
let store = loadStore();
let persistenceAdapter = null;
function getStore() { return store; }
function setStore(nextStore) {
  store = Object.assign(emptyStore(), nextStore || {});
  store.sessions ||= {};
}
function setPersistenceAdapter(adapter) {
  persistenceAdapter = typeof adapter === 'function' ? adapter : null;
}
async function saveStore() {
  if (persistenceAdapter) {
    try {
      await persistenceAdapter(store);
      return;
    } catch (e) {
      console.warn("Adapter save failed:", e);
    }
  }
  try {
    fs.mkdirSync(DATA_DIR, { recursive: true });
    fs.writeFileSync(DATA_FILE, JSON.stringify(store, null, 2));
  } catch (err) {
    console.warn("Local data file write failed:", err);
  }
}

// ---------------------------------------------------------------------------
// Sessions are included in the persistent store so serverless instances can share them.
// ---------------------------------------------------------------------------
function createSession(accountKey) {
  const sid = crypto.randomBytes(24).toString('hex');
  store.sessions[sid] = { accountKey, expiresAt: Date.now() + 7 * 24 * 60 * 60 * 1000 };
  return sid;
}
function sessionCookieHeader(sid) {
  const secure = process.env.VERCEL ? '; Secure' : '';
  return `${SESSION_COOKIE}=${sid}; HttpOnly; Path=/; SameSite=Lax; Max-Age=604800${secure}`;
}
function clearCookieHeader() {
  return `${SESSION_COOKIE}=; HttpOnly; Path=/; SameSite=Lax; Max-Age=0`;
}
function requestAccount(req) {
  const cookieHeader = req.headers.cookie || '';
  const match = cookieHeader.match(new RegExp(`(?:^|;\\s*)${SESSION_COOKIE}=([^;]+)`));
  if (!match) return null;
  const session = store.sessions[match[1]];
  if (!session) return null;
  if (session.expiresAt <= Date.now()) {
    delete store.sessions[match[1]];
    return null;
  }
  const accountKey = session.accountKey;
  return store.accounts.find(a => a.key === accountKey) || null;
}
function dropAccountSessions(accountKey) {
  for (const [sid, session] of Object.entries(store.sessions)) {
    if (session.accountKey === accountKey) delete store.sessions[sid];
  }
}

// ---------------------------------------------------------------------------
// HTTP helpers
// ---------------------------------------------------------------------------
function send(res, code, body, type, extraHeaders) {
  const headers = { 'Content-Type': type || 'application/json; charset=utf-8', ...(extraHeaders || {}) };
  res.writeHead(code, headers);
  res.end(typeof body === 'string' || Buffer.isBuffer(body) ? body : JSON.stringify(body));
}
function readBody(req, limitBytes = 25 * 1024 * 1024) {
  return new Promise((resolve) => {
    let data = '';
    req.on('data', chunk => {
      data += chunk;
      if (data.length > limitBytes) req.destroy();
    });
    req.on('end', () => {
      try { resolve(JSON.parse(data || '{}')); }
      catch { resolve({}); }
    });
    req.on('error', () => resolve({}));
  });
}
const USERNAME_PATTERN = /^[A-Za-z0-9_.@ -]{3,40}$/;
function publicBaseUrl(req) {
  const proto = (req.headers['x-forwarded-proto'] || 'http').split(',')[0].trim();
  const host = req.headers['x-forwarded-host'] || req.headers.host || `localhost:${PORT}`;
  return `${proto}://${host}/`;
}
function accountState(accountKey) {
  if (!store.states[accountKey]) store.states[accountKey] = { state: null, revision: 0 };
  return store.states[accountKey];
}
function findTransaction(accountKey, transactionId) {
  const entry = accountState(accountKey);
  const state = entry.state;
  if (!state || !Array.isArray(state.transactions)) return null;
  return state.transactions.find(t => Number(t.id) === Number(transactionId)) || null;
}

// ---------------------------------------------------------------------------
// Server
// ---------------------------------------------------------------------------
async function handleRequest(req, res) {
  const origin = req.headers.origin;
  if (origin) {
    res.setHeader('Access-Control-Allow-Origin', origin);
    res.setHeader('Access-Control-Allow-Credentials', 'true');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization, X-Requested-With');
  }
  if (req.method === 'OPTIONS') {
    res.writeHead(204);
    res.end();
    return;
  }

  const url = new URL(req.url, 'http://localhost');
  const p = url.pathname;
  const method = req.method;

  try {
    // ============================ STUDENT PORTAL API =======================
    if (p === '/api/student/books' && method === 'GET') {
      const primaryKey = (store.accounts.find(a => a.isPrimary) || store.accounts[0] || {}).key || 'admin';
      const state = (store.states[primaryKey] || {}).state || {};
      const books = Array.isArray(state.books) ? state.books : [];
      const publicBooks = books.map(b => ({
        id: b.id,
        title: b.title,
        author: b.author,
        isbn: b.isbn,
        category: b.category,
        shelf_location: b.shelf_location,
        total_copies: Number(b.total_copies) || 1,
        available_copies: Number(b.available_copies) >= 0 ? Number(b.available_copies) : (Number(b.total_copies) || 1)
      }));
      return send(res, 200, { books: publicBooks });
    }

    if (p === '/api/student/status' && method === 'GET') {
      const rollNo = (url.searchParams.get('roll_no') || '').trim().toLowerCase();
      if (!rollNo) return send(res, 400, { error: 'Roll number is required.' });

      const primaryKey = (store.accounts.find(a => a.isPrimary) || store.accounts[0] || {}).key || 'admin';
      const state = (store.states[primaryKey] || {}).state || {};
      const students = Array.isArray(state.students) ? state.students : [];
      const transactions = Array.isArray(state.transactions) ? state.transactions : [];

      const student = students.find(s => String(s.roll_no || '').trim().toLowerCase() === rollNo);
      if (!student) {
        return send(res, 404, { error: `Student with Roll Number '${url.searchParams.get('roll_no')}' not found.` });
      }

      const studentTx = transactions.filter(t => Number(t.student_id) === Number(student.id));
      const currentlyIssued = studentTx.filter(t => t.status === 'issued');

      return send(res, 200, {
        student: {
          id: student.id,
          name: student.name,
          roll_no: student.roll_no,
          department: student.department || 'CSIT',
          email: student.email,
          phone: student.phone
        },
        currently_issued: currentlyIssued,
        history: studentTx,
        total_borrowed_count: studentTx.length,
        current_issued_count: currentlyIssued.length
      });
    }

    // ============================ AUTH =====================================
    if (p === '/api/auth/status' && method === 'GET') {
      const account = requestAccount(req);
      const setupRequired = !store.accounts.some(a => a.isPrimary);
      const payload = { authenticated: Boolean(account), setupRequired };
      if (account) {
        payload.username = account.username;
        payload.isPrimaryAccount = Boolean(account.isPrimary);
      }
      return send(res, 200, payload);
    }

    if (p === '/api/auth/setup' && method === 'POST') {
      if (store.accounts.some(a => a.isPrimary)) {
        return send(res, 409, { error: 'The administrator account has already been set up.' });
      }
      const b = await readBody(req);
      const username = String(b.username || '').trim();
      const password = String(b.password || '');
      if (!USERNAME_PATTERN.test(username)) return send(res, 400, { error: 'Username must be 3-40 characters using letters, numbers, spaces, dots, underscores, hyphens, or @.' });
      if (password.length < 8 || password.length > 128) return send(res, 400, { error: 'Password must contain 8-128 characters.' });
      if (store.accounts.some(a => a.key === username.toLowerCase())) return send(res, 409, { error: 'An account with this username already exists.' });
      const { salt, hash } = hashPassword(password);
      const account = { username, key: username.toLowerCase(), salt, hash, isPrimary: true, createdAt: new Date().toISOString() };
      store.accounts.push(account);
      accountState(account.key);
      store.messages[account.key] = [];
      store.reissueRequests[account.key] = [];
      await saveStore();
      return send(res, 200, { username: account.username });
    }

    if (p === '/api/auth/register' && method === 'POST') {
      const b = await readBody(req);
      const username = String(b.username || '').trim();
      const password = String(b.password || '');
      if (!USERNAME_PATTERN.test(username)) return send(res, 400, { error: 'Username must be 3-40 characters using letters, numbers, spaces, dots, underscores, hyphens, or @.' });
      if (password.length < 8 || password.length > 128) return send(res, 400, { error: 'Password must contain 8-128 characters.' });
      if (store.accounts.some(a => a.key === username.toLowerCase())) return send(res, 409, { error: 'An account with this username already exists. Sign in instead.' });
      const { salt, hash } = hashPassword(password);
      const account = { username, key: username.toLowerCase(), salt, hash, isPrimary: false, createdAt: new Date().toISOString() };
      store.accounts.push(account);
      accountState(account.key);
      store.messages[account.key] = [];
      store.reissueRequests[account.key] = [];
      await saveStore();
      const sid = createSession(account.key);
      await saveStore();
      return send(res, 200, { username: account.username }, undefined, { 'Set-Cookie': sessionCookieHeader(sid) });
    }

    if (p === '/api/auth/login' && method === 'POST') {
      const b = await readBody(req);
      const username = String(b.username || '').trim();
      const password = String(b.password || '');
      const account = store.accounts.find(a => a.key === username.toLowerCase());
      if (!account || !verifyPassword(password, account.salt, account.hash)) {
        return send(res, 401, { error: 'Invalid username or password.' });
      }
      const sid = createSession(account.key);
      await saveStore();
      return send(res, 200, { username: account.username }, undefined, { 'Set-Cookie': sessionCookieHeader(sid) });
    }

    if (p === '/api/auth/logout' && method === 'POST') {
      const cookieHeader = req.headers.cookie || '';
      const match = cookieHeader.match(new RegExp(`(?:^|;\\s*)${SESSION_COOKIE}=([^;]+)`));
      if (match) delete store.sessions[match[1]];
      await saveStore();
      return send(res, 200, { ok: true }, undefined, { 'Set-Cookie': clearCookieHeader() });
    }

    if (p === '/api/auth/forgot-password' && method === 'POST') {
      const b = await readBody(req);
      const username = String(b.username || '').trim();
      const account = store.accounts.find(a => a.key === username.toLowerCase());
      if (account) {
        const token = crypto.randomBytes(24).toString('hex');
        store.resetTokens[token] = { accountKey: account.key, expiresAt: Date.now() + 60 * 60 * 1000 };
        await saveStore();
        // No mail server is configured in this standalone build, so the
        // one-time reset link is printed to the server console (the
        // "library recovery inbox" of this deployment). See README.
        console.log(`[DGI LMS] Password reset link for "${account.username}": ${publicBaseUrl(req)}login.html?resetToken=${token}`);
      }
      return send(res, 200, { message: 'If the account exists, a reset link will be sent to the library recovery inbox.' });
    }

    if (p === '/api/auth/reset-password' && method === 'POST') {
      const b = await readBody(req);
      const token = String(b.token || '');
      const password = String(b.password || '');
      const entry = store.resetTokens[token];
      if (!entry || entry.expiresAt < Date.now()) {
        return send(res, 400, { error: 'This reset link is invalid or has expired. Request a new one.' });
      }
      if (password.length < 8 || password.length > 128) return send(res, 400, { error: 'Password must contain 8-128 characters.' });
      const account = store.accounts.find(a => a.key === entry.accountKey);
      if (!account) return send(res, 400, { error: 'This reset link is invalid or has expired. Request a new one.' });
      const { salt, hash } = hashPassword(password);
      account.salt = salt;
      account.hash = hash;
      delete store.resetTokens[token];
      dropAccountSessions(account.key);
      await saveStore();
      return send(res, 200, { message: 'Password updated. Sign in with your new password.' });
    }

    if (p === '/api/auth/change-password' && method === 'POST') {
      const account = requestAccount(req);
      if (!account) return send(res, 401, { error: 'Sign in to change your password.' });
      const b = await readBody(req);
      if (!verifyPassword(String(b.currentPassword || ''), account.salt, account.hash)) {
        return send(res, 403, { error: 'The current password is incorrect.' });
      }
      const newPassword = String(b.newPassword || '');
      if (newPassword.length < 8 || newPassword.length > 128) return send(res, 400, { error: 'Password must contain 8-128 characters.' });
      const { salt, hash } = hashPassword(newPassword);
      account.salt = salt;
      account.hash = hash;
      dropAccountSessions(account.key);
      await saveStore();
      return send(res, 200, { ok: true }, undefined, { 'Set-Cookie': clearCookieHeader() });
    }

    if (p === '/api/auth/change-username' && method === 'POST') {
      const account = requestAccount(req);
      if (!account) return send(res, 401, { error: 'Sign in to change your username.' });
      const b = await readBody(req);
      if (!verifyPassword(String(b.currentPassword || ''), account.salt, account.hash)) {
        return send(res, 403, { error: 'The current password is incorrect.' });
      }
      const username = String(b.username || '').trim();
      if (!USERNAME_PATTERN.test(username)) return send(res, 400, { error: 'Username must be 3-40 characters and use only letters, numbers, spaces, dots, underscores, hyphens, or @.' });
      const newKey = username.toLowerCase();
      if (newKey !== account.key && store.accounts.some(a => a.key === newKey)) {
        return send(res, 409, { error: 'Another account already uses this username.' });
      }
      const oldKey = account.key;
      if (newKey !== oldKey) {
        store.states[newKey] = store.states[oldKey];
        store.messages[newKey] = store.messages[oldKey];
        store.reissueRequests[newKey] = store.reissueRequests[oldKey];
        delete store.states[oldKey];
        delete store.messages[oldKey];
        delete store.reissueRequests[oldKey];
        for (const link of Object.values(store.reissueLinks)) {
          if (link.accountKey === oldKey) link.accountKey = newKey;
        }
        for (const session of Object.values(store.sessions)) {
          if (session.accountKey === oldKey) session.accountKey = newKey;
        }
        account.key = newKey;
      }
      account.username = username;
      await saveStore();
      return send(res, 200, { username: account.username });
    }

    // ======================= LIBRARY STATE =================================
    if (p === '/api/library-state' && method === 'GET') {
      const account = requestAccount(req);
      if (!account) return send(res, 401, { error: 'Sign in to load the library database.' });
      const entry = accountState(account.key);
      return send(res, 200, { state: entry.state, revision: entry.revision });
    }

    if (p === '/api/library-state' && method === 'PUT') {
      const account = requestAccount(req);
      if (!account) return send(res, 401, { error: 'Sign in to save the library database.' });
      const b = await readBody(req);
      if (!b.state || typeof b.state !== 'object' || Array.isArray(b.state)) {
        return send(res, 400, { error: 'Invalid library state.' });
      }
      const entry = accountState(account.key);
      if (Number(b.revision) !== entry.revision) {
        return send(res, 409, { error: 'This library data was changed in another session. Reload the page to load the latest data before saving.' });
      }
      entry.state = b.state;
      entry.revision += 1;
      await saveStore();
      return send(res, 200, { revision: entry.revision });
    }

    // ========================== MESSAGES ===================================
    if (p === '/api/messages' && method === 'GET') {
      const account = requestAccount(req);
      if (!account) return send(res, 401, { error: 'Sign in to load messages.' });
      const messages = (store.messages[account.key] || []).slice().sort((a, b) => b.id - a.id);
      return send(res, 200, {
        messages,
        emailReplySync: { status: 'not_configured', lastCheckedAt: null }
      });
    }

    if (p === '/api/messages' && method === 'POST') {
      const account = requestAccount(req);
      if (!account) return send(res, 401, { error: 'Sign in to save messages.' });
      const b = await readBody(req);
      const list = store.messages[account.key] || (store.messages[account.key] = []);
      const id = list.reduce((max, m) => Math.max(max, Number(m.id) || 0), 0) + 1;
      const student = (b.student && typeof b.student === 'object') ? b.student : {};
      const message = {
        id,
        direction: 'outgoing',
        transactionId: b.transactionId ?? null,
        borrowerType: b.borrowerType || student.borrowerType || 'student',
        borrowerId: b.borrowerId ?? student.borrowerId ?? student.id ?? null,
        student: {
          id: student.id ?? null,
          name: student.name || '',
          rollNo: student.rollNo || '',
          phone: student.phone || '',
          email: student.email || ''
        },
        channel: b.channel || '',
        recipient: b.recipient || '',
        message: b.message || '',
        messageType: b.messageType || 'reminder',
        status: b.status || 'prepared',
        timestamp: new Date().toISOString(),
        submittedAt: null,
        replies: [],
        statusHistory: [{ status: b.status || 'prepared', changedAt: new Date().toISOString() }]
      };
      list.push(message);
      await saveStore();
      return send(res, 200, { message });
    }

    if (p === '/api/messages/import-legacy' && method === 'POST') {
      const account = requestAccount(req);
      if (!account) return send(res, 401, { error: 'Sign in to import messages.' });
      const b = await readBody(req);
      const alerts = Array.isArray(b.alerts) ? b.alerts : [];
      const list = store.messages[account.key] || (store.messages[account.key] = []);
      let nextId = list.reduce((max, m) => Math.max(max, Number(m.id) || 0), 0) + 1;
      let imported = 0;
      for (const alert of alerts) {
        if (list.some(m => m.legacyId != null && Number(m.legacyId) === Number(alert.id))) continue;
        list.push({
          id: nextId++,
          legacyId: alert.id,
          direction: 'outgoing',
          transactionId: alert.transactionId ?? null,
          borrowerType: 'student',
          borrowerId: alert.student?.id ?? null,
          student: {
            id: alert.student?.id ?? null,
            name: alert.student?.name || 'Unknown',
            rollNo: alert.student?.rollNo || '',
            phone: alert.student?.phone || '',
            email: alert.student?.email || ''
          },
          channel: alert.channel || '',
          recipient: alert.recipient || '',
          message: alert.message || '',
          messageType: 'reminder',
          status: 'sent',
          timestamp: alert.timestamp || new Date().toISOString(),
          submittedAt: alert.timestamp || null,
          replies: [],
          statusHistory: [{ status: 'sent', changedAt: alert.timestamp || new Date().toISOString() }]
        });
        imported += 1;
      }
      await saveStore();
      return send(res, 200, { imported });
    }

    if (p === '/api/messages/failed' && method === 'DELETE') {
      const account = requestAccount(req);
      if (!account) return send(res, 401, { error: 'Sign in to delete messages.' });
      const list = store.messages[account.key] || [];
      const kept = list.filter(m => !(m.direction === 'outgoing' && m.status === 'send_failed'));
      store.messages[account.key] = kept;
      await saveStore();
      return send(res, 200, { deleted: list.length - kept.length });
    }

    const replyReadMatch = p.match(/^\/api\/messages\/(\d+)\/replies\/(\d+)\/read$/);
    if (replyReadMatch && method === 'POST') {
      const account = requestAccount(req);
      if (!account) return send(res, 401, { error: 'Sign in to update replies.' });
      const b = await readBody(req);
      const list = store.messages[account.key] || [];
      const message = list.find(m => Number(m.id) === Number(replyReadMatch[1]));
      if (!message) return send(res, 404, { error: 'Message not found.' });
      const reply = (message.replies || []).find(r => Number(r.replyId) === Number(replyReadMatch[2]));
      if (reply) reply.adminReadAt = b.read ? new Date().toISOString() : null;
      await saveStore();
      return send(res, 200, { message });
    }

    const messageActionMatch = p.match(/^\/api\/messages\/(\d+)\/actions$/);
    if (messageActionMatch && method === 'POST') {
      const account = requestAccount(req);
      if (!account) return send(res, 401, { error: 'Sign in to update messages.' });
      const b = await readBody(req);
      const list = store.messages[account.key] || [];
      const message = list.find(m => Number(m.id) === Number(messageActionMatch[1]));
      if (!message) return send(res, 404, { error: 'Message not found.' });
      const action = String(b.action || '');
      const now = new Date().toISOString();
      const setStatus = (status) => {
        message.status = status;
        message.statusHistory = [...(message.statusHistory || []), { status, changedAt: now }];
      };
      let warning = '';
      if (action === 'submit' || action === 'submit-manual-email') {
        setStatus('submitted');
        message.submissionId = `SUB-${message.id}`;
        message.submittedAt = now;
        warning = 'No automatic sending provider is configured on this server, so the submission was recorded only. Send the message from the opened WhatsApp/Gmail window.';
      } else if (action === 'edit') {
        if (typeof b.message === 'string') message.message = b.message;
        if (typeof b.messageType === 'string') message.messageType = b.messageType;
        if (b.student && typeof b.student === 'object') {
          message.student = {
            id: b.student.id ?? message.student?.id ?? null,
            name: b.student.name || '',
            rollNo: b.student.rollNo || '',
            phone: b.student.phone || '',
            email: b.student.email || ''
          };
          message.borrowerId = b.student.id ?? message.borrowerId;
        }
        if (typeof b.channel === 'string') message.channel = b.channel;
        if (typeof b.recipient === 'string') message.recipient = b.recipient;
      } else if (action === 'prepare') {
        setStatus('prepared');
      } else if (action === 'cancel') {
        setStatus('prepared');
        message.submissionId = null;
        message.submittedAt = null;
      } else if (action === 'resolve') {
        setStatus('resolved');
      } else if (action === 'acknowledge') {
        message.acknowledgedAt = now;
      } else if (action === 'mark-no-response') {
        message.noResponseAt = now;
      } else if (action === 'mark-sent') {
        setStatus('sent');
        message.sentAt = now;
      } else {
        return send(res, 400, { error: `Unknown message action: ${action || '(empty)'}.` });
      }
      await saveStore();
      return send(res, 200, { message, ...(warning ? { warning } : {}) });
    }

    const messageDeleteMatch = p.match(/^\/api\/messages\/(\d+)$/);
    if (messageDeleteMatch && method === 'DELETE') {
      const account = requestAccount(req);
      if (!account) return send(res, 401, { error: 'Sign in to delete messages.' });
      const list = store.messages[account.key] || [];
      const kept = list.filter(m => Number(m.id) !== Number(messageDeleteMatch[1]));
      if (kept.length === list.length) return send(res, 404, { error: 'Message not found.' });
      store.messages[account.key] = kept;
      await saveStore();
      return send(res, 200, { deleted: true });
    }

    // ======================== REISSUE LINKS ================================
    if (p === '/api/reissue-links' && method === 'POST') {
      const account = requestAccount(req);
      if (!account) return send(res, 401, { error: 'Sign in to create a reissue link.' });
      const b = await readBody(req);
      const tx = findTransaction(account.key, b.transactionId);
      if (!tx) return send(res, 404, { error: 'The loan for this message was not found.' });
      if (tx.status !== 'issued') return send(res, 200, { reissueUnavailable: true });
      const today = new Date().toISOString().split('T')[0];
      if (String(tx.due_date) < today) return send(res, 200, { reissueUnavailable: true });
      if (Number(tx.reissue_count || 0) >= 2) return send(res, 200, { returnRequired: true });
      const token = crypto.randomBytes(24).toString('hex');
      store.reissueLinks[token] = { accountKey: account.key, transactionId: tx.id, createdAt: new Date().toISOString() };
      await saveStore();
      return send(res, 200, { token, publicUrl: publicBaseUrl(req) });
    }

    const reissueLinkMatch = p.match(/^\/api\/reissue-links\/([a-f0-9]{48})$/);
    if (reissueLinkMatch && method === 'GET') {
      const link = store.reissueLinks[reissueLinkMatch[1]];
      if (!link) return send(res, 404, { error: 'This reissue link is invalid.' });
      const tx = findTransaction(link.accountKey, link.transactionId);
      if (!tx) return send(res, 404, { error: 'This loan could not be found.' });
      const entry = accountState(link.accountKey);
      const state = entry.state || {};
      const student = (state.students || []).find(s => Number(s.id) === Number(tx.student_id)) || {};
      const settings = state.settings || {};
      return send(res, 200, {
        libraryName: settings.library_name || 'DGI Central Library',
        bookTitle: tx.book_title || '',
        studentName: student.name || '',
        dueDate: tx.due_date || '',
        reissuesUsed: Number(tx.reissue_count || 0),
        status: tx.status
      });
    }

    // ====================== REISSUE REQUESTS ===============================
    if (p === '/api/reissue-requests' && method === 'POST') {
      // Public borrower submission via a reissue link token.
      const b = await readBody(req);
      const link = store.reissueLinks[String(b.token || '')];
      if (!link) return send(res, 404, { error: 'This reissue link is invalid.' });
      const tx = findTransaction(link.accountKey, link.transactionId);
      if (!tx || tx.status !== 'issued') return send(res, 400, { error: 'This loan is no longer active.' });
      const today = new Date().toISOString().split('T')[0];
      if (String(tx.due_date) < today) return send(res, 400, { error: 'The due date has passed, so this loan can no longer be reissued. Please return the book at the library.' });
      if (Number(tx.reissue_count || 0) >= 2) return send(res, 400, { error: 'Both reissues have already been used for this loan. Please return the book at the library.' });
      const list = store.reissueRequests[link.accountKey] || (store.reissueRequests[link.accountKey] = []);
      if (list.some(r => Number(r.transactionId) === Number(tx.id) && r.status === 'pending')) {
        return send(res, 409, { error: 'A reissue request for this loan is already pending with the librarian.' });
      }
      const entry = accountState(link.accountKey);
      const state = entry.state || {};
      const student = (state.students || []).find(s => Number(s.id) === Number(tx.student_id)) || {};
      const request = {
        id: list.reduce((max, r) => Math.max(max, Number(r.id) || 0), 0) + 1,
        transactionId: tx.id,
        studentId: tx.student_id,
        studentName: student.name || '',
        studentRoll: student.roll_no || '',
        bookTitle: tx.book_title || '',
        dueDate: tx.due_date || '',
        reissuesUsed: Number(tx.reissue_count || 0),
        requestedAt: new Date().toISOString(),
        status: 'pending',
        reviewedBy: ''
      };
      list.push(request);
      await saveStore();
      return send(res, 200, { request });
    }

    if (p === '/api/reissue-requests' && method === 'GET') {
      const account = requestAccount(req);
      if (!account) return send(res, 401, { error: 'Sign in to load reissue requests.' });
      const history = url.searchParams.get('history') === '1';
      const all = (store.reissueRequests[account.key] || []).slice().sort((a, b) => b.id - a.id);
      const requests = history ? all : all.filter(r => r.status === 'pending');
      return send(res, 200, { requests });
    }

    if (p === '/api/reissue-request-stats' && method === 'GET') {
      const account = requestAccount(req);
      if (!account) return send(res, 401, { error: 'Sign in to load reissue request totals.' });
      const requests = (store.reissueRequests[account.key] || []).map(r => ({
        studentId: r.studentId,
        transactionId: r.transactionId,
        status: r.status,
        requestedAt: r.requestedAt
      }));
      return send(res, 200, { requests });
    }

    const reissueActionMatch = p.match(/^\/api\/reissue-requests\/(\d+)\/actions$/);
    if (reissueActionMatch && method === 'POST') {
      const account = requestAccount(req);
      if (!account) return send(res, 401, { error: 'Sign in to review reissue requests.' });
      const b = await readBody(req);
      const list = store.reissueRequests[account.key] || [];
      const request = list.find(r => Number(r.id) === Number(reissueActionMatch[1]));
      if (!request) return send(res, 404, { error: 'Reissue request not found.' });
      if (request.status !== 'pending') return send(res, 409, { error: 'This request has already been reviewed.' });
      const action = String(b.action || '');
      if (action === 'reject') {
        request.status = 'rejected';
        request.reviewedBy = account.username;
        await saveStore();
        return send(res, 200, { request });
      }
      if (action !== 'approve') return send(res, 400, { error: `Unknown reissue action: ${action || '(empty)'}.` });

      const entry = accountState(account.key);
      const tx = findTransaction(account.key, request.transactionId);
      if (!tx || tx.status !== 'issued') return send(res, 400, { error: 'The loan for this request is no longer active.' });
      // Preserve any fine accrued so far, then extend the due date —
      // the same rule the original system applies on approval.
      const settings = (entry.state && entry.state.settings) || {};
      const rate = parseFloat(settings.fine_per_day) || 5;
      const due = new Date(`${tx.due_date}T00:00:00`);
      const nowDate = new Date();
      nowDate.setHours(0, 0, 0, 0);
      const daysLate = Math.ceil((nowDate - due) / 86400000);
      if (daysLate > 0) {
        tx.fine_before_reissue = Math.round(((Number(tx.fine_before_reissue) || 0) + daysLate * rate) * 100) / 100;
      }
      due.setDate(due.getDate() + REISSUE_EXTENSION_DAYS);
      tx.due_date = due.toISOString().split('T')[0];
      tx.reissue_count = Number(tx.reissue_count || 0) + 1;
      entry.revision += 1;
      request.status = 'approved';
      request.reviewedBy = account.username;
      request.dueDate = tx.due_date;
      request.reissuesUsed = tx.reissue_count;
      await saveStore();
      return send(res, 200, { request, dueDate: tx.due_date });
    }

    const reissueDeleteMatch = p.match(/^\/api\/reissue-requests\/(\d+)$/);
    if (reissueDeleteMatch && method === 'DELETE') {
      const account = requestAccount(req);
      if (!account) return send(res, 401, { error: 'Sign in to delete reissue requests.' });
      const list = store.reissueRequests[account.key] || [];
      const kept = list.filter(r => Number(r.id) !== Number(reissueDeleteMatch[1]));
      if (kept.length === list.length) return send(res, 404, { error: 'Reissue request not found.' });
      store.reissueRequests[account.key] = kept;
      await saveStore();
      return send(res, 200, { deleted: true });
    }

    if (p.startsWith('/api/')) return send(res, 404, { error: 'API endpoint not found.' });

    // ========================= STATIC FILES ================================
    let file = p === '/' ? '/index.html' : p;
    let full = path.join(ROOT, decodeURIComponent(file));
    if (!fs.existsSync(full) && fs.existsSync(full + '.html')) {
      full = full + '.html';
    }
    if (!full.startsWith(ROOT) || !fs.existsSync(full) || fs.statSync(full).isDirectory()) {
      return send(res, 404, 'Not found', 'text/plain; charset=utf-8');
    }
    const type = MIME[path.extname(full)] || 'application/octet-stream';
    const headers = { 'Content-Type': type };
    if (path.extname(full) === '.html') headers['Cache-Control'] = 'no-cache';
    return send(res, 200, fs.readFileSync(full), type, headers);
  } catch (error) {
    console.error('Request failed:', req.method, p, error);
    return send(res, Number(error.statusCode) || 500, { error: error.statusCode === 409 ? error.message : 'Internal server error.' });
  }
}

if (require.main === module) {
  const server = http.createServer(handleRequest);
  server.listen(PORT, HOST, () => {
    console.log(`DGI LMS running at http://localhost:${PORT} (bound ${HOST})`);
  });
}

function handler(req, res) {
  return handleRequest(req, res);
}

module.exports = handler;
module.exports.handler = handler;
module.exports.handleRequest = handleRequest;
module.exports.getStore = getStore;
module.exports.setStore = setStore;
module.exports.setPersistenceAdapter = setPersistenceAdapter;
module.exports.emptyStore = emptyStore;
