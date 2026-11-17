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

// Static assets explicitly mapped for @vercel/nft bundler trace
const STATIC_ASSETS = {
  '/logo.png': { file: path.join(__dirname, 'logo.png'), type: 'image/png' },
  '/assets/logo.png': { file: path.join(__dirname, 'assets', 'logo.png'), type: 'image/png' },
  '/assets/logo-emblem.png': { file: path.join(__dirname, 'assets', 'logo-emblem.png'), type: 'image/png' },
  '/css/style.css': { file: path.join(__dirname, 'css', 'style.css'), type: 'text/css; charset=utf-8' },
  '/js/auth.js': { file: path.join(__dirname, 'js', 'auth.js'), type: 'text/javascript; charset=utf-8' },
  '/js/app.js': { file: path.join(__dirname, 'js', 'app.js'), type: 'text/javascript; charset=utf-8' },
  '/js/db.js': { file: path.join(__dirname, 'js', 'db.js'), type: 'text/javascript; charset=utf-8' },
  '/js/charts.js': { file: path.join(__dirname, 'js', 'charts.js'), type: 'text/javascript; charset=utf-8' },
  '/js/qr.js': { file: path.join(__dirname, 'js', 'qr.js'), type: 'text/javascript; charset=utf-8' },
  '/js/xlsx_import.js': { file: path.join(__dirname, 'js', 'xlsx_import.js'), type: 'text/javascript; charset=utf-8' },
  '/login.html': { file: path.join(__dirname, 'login.html'), type: 'text/html; charset=utf-8' },
  '/student.html': { file: path.join(__dirname, 'student.html'), type: 'text/html; charset=utf-8' },
  '/index.html': { file: path.join(__dirname, 'index.html'), type: 'text/html; charset=utf-8' },
  '/reissue.html': { file: path.join(__dirname, 'reissue.html'), type: 'text/html; charset=utf-8' }
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
function defaultLibraryState() {
  const books = [
    { id: 1, title: "Data Structures & Algorithms in C++", author: "Mark Allen Weiss", isbn: "978-0132847377", category: "CSIT", shelf_location: "Stack CS-101", total_copies: 5, available_copies: 3 },
    { id: 2, title: "Database System Concepts", author: "Silberschatz, Korth, Sudarshan", isbn: "978-0078022159", category: "CSIT", shelf_location: "Stack CS-102", total_copies: 6, available_copies: 1 },
    { id: 3, title: "Operating System Concepts", author: "Abraham Silberschatz, Peter B. Galvin", isbn: "978-1118063330", category: "CSIT", shelf_location: "Stack CS-103", total_copies: 4, available_copies: 2 },
    { id: 4, title: "Computer Networks", author: "Andrew S. Tanenbaum", isbn: "978-0132126953", category: "CSIT", shelf_location: "Stack CS-104", total_copies: 5, available_copies: 4 },
    { id: 5, title: "Artificial Intelligence: A Modern Approach", author: "Stuart Russell, Peter Norvig", isbn: "978-0136042594", category: "CSIT", shelf_location: "Stack CS-105", total_copies: 3, available_copies: 1 },
    { id: 6, title: "Web Technologies: HTML, CSS, JavaScript & PHP", author: "Uttam K. Roy", isbn: "978-0198066224", category: "CSIT", shelf_location: "Stack CS-106", total_copies: 4, available_copies: 3 },
    { id: 7, title: "Theory of Computer Science: Automata, Languages", author: "K.L.P. Mishra, N. Chandrasekaran", isbn: "978-8120329683", category: "CSIT", shelf_location: "Stack CS-107", total_copies: 4, available_copies: 2 },
    { id: 8, title: "Software Engineering: A Practitioner's Approach", author: "Roger S. Pressman", isbn: "978-0078022128", category: "CSIT", shelf_location: "Stack CS-108", total_copies: 5, available_copies: 0 },
    { id: 9, title: "Electronic Devices and Circuit Theory", author: "Robert L. Boylestad, Louis Nashelsky", isbn: "978-0137692828", category: "Electronics", shelf_location: "Stack EC-201", total_copies: 3, available_copies: 1 },
    { id: 10, title: "Engineering Mechanics: Statics and Dynamics", author: "S. Timoshenko, D.H. Young", isbn: "978-0070616806", category: "Mechanical", shelf_location: "Stack ME-301", total_copies: 5, available_copies: 4 }
  ];
  const students = [
    { id: 1, name: "Ayush Gupta", roll_no: "CS101", department: "CSIT", email: "ayush.csit@dronacharya.info", phone: "+91 98765 43210" },
    { id: 2, name: "Priya Sharma", roll_no: "CS102", department: "CSIT", email: "priya.csit@dronacharya.info", phone: "+91 98765 43211" },
    { id: 3, name: "Rahul Verma", roll_no: "CS103", department: "CSIT", email: "rahul.csit@dronacharya.info", phone: "+91 98765 43212" },
    { id: 4, name: "Ananya Singh", roll_no: "CS104", department: "CSIT", email: "ananya.csit@dronacharya.info", phone: "+91 98765 43213" },
    { id: 5, name: "Amit Kumar", roll_no: "ME101", department: "Mechanical", email: "amit.me@dronacharya.info", phone: "+91 98765 43214" }
  ];
  const transactions = [
    { id: 1, student_id: 1, book_id: 2, book_title: "Database System Concepts", book_isbn: "978-0078022159", issue_date: "2026-11-05", due_date: "2026-11-19", return_date: null, status: "issued", fine: 0, reissue_count: 0 },
    { id: 2, student_id: 1, book_id: 1, book_title: "Data Structures & Algorithms in C++", book_isbn: "978-0132847377", issue_date: "2026-10-10", due_date: "2026-10-24", return_date: "2026-10-22", status: "returned", fine: 0, reissue_count: 0 },
    { id: 3, student_id: 1, book_id: 3, book_title: "Operating System Concepts", book_isbn: "978-1118063330", issue_date: "2026-09-01", due_date: "2026-09-15", return_date: "2026-09-14", status: "returned", fine: 0, reissue_count: 0 },
    { id: 4, student_id: 2, book_id: 8, book_title: "Software Engineering: A Practitioner's Approach", book_isbn: "978-0078022128", issue_date: "2026-11-01", due_date: "2026-11-15", return_date: null, status: "issued", fine: 10, reissue_count: 1 }
  ];
  return {
    books,
    students,
    faculty: [],
    transactions,
    faculty_transactions: [],
    alert_logs: [],
    settings: {
      library_name: "DGI Central Library",
      institution_name: "Dronacharya Group of Institutions, Greater Noida",
      address: "#27, APJ Abdul Kalam Road, Knowledge Park-III, Greater Noida, Uttar Pradesh - 201306",
      phone: "0120-2322022, 2323851-56",
      email: "info@dronacharya.info",
      established: "2006",
      fine_per_day: 5.0,
      currency: "₹"
    }
  };
}

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
  store.states.admin = { state: defaultLibraryState(), revision: 1 };
  store.messages.admin = [];
  store.reissueRequests.admin = [];
  return store;
}
function loadStore() {
  try {
    const rootDataFile = path.join(ROOT, 'data', 'library-data.json');
    if (process.env.VERCEL && !fs.existsSync(DATA_FILE) && fs.existsSync(rootDataFile)) {
      try {
        fs.mkdirSync(DATA_DIR, { recursive: true });
        fs.copyFileSync(rootDataFile, DATA_FILE);
      } catch (e) {
        console.warn('Could not copy bundled library-data.json to /tmp:', e);
      }
    }
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
    if (!loaded.states || !loaded.states.admin || !loaded.states.admin.state) {
      loaded.states = loaded.states || {};
      loaded.states.admin = { state: defaultLibraryState(), revision: 1 };
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
// Stateless HMAC signed sessions (works reliably across all serverless lambda containers)
// ---------------------------------------------------------------------------
const SESSION_SECRET = process.env.SESSION_SECRET || 'dgi-lms-super-secure-fixed-key-2026';

function signSessionToken(data) {
  const sig = crypto.createHmac('sha256', SESSION_SECRET).update(data).digest('hex');
  return `${data}.${sig}`;
}

function verifySessionToken(token) {
  if (!token || typeof token !== 'string') return null;
  const parts = token.split('.');
  if (parts.length !== 3) return null;
  const [accountKey, expiresAtStr, sig] = parts;
  const data = `${accountKey}.${expiresAtStr}`;
  const expectedSig = crypto.createHmac('sha256', SESSION_SECRET).update(data).digest('hex');
  if (sig !== expectedSig) return null;
  const expiresAt = Number(expiresAtStr);
  if (isNaN(expiresAt) || expiresAt <= Date.now()) return null;
  return accountKey;
}

function createSession(accountKey) {
  const expiresAt = Date.now() + 7 * 24 * 60 * 60 * 1000;
  const token = signSessionToken(`${accountKey}.${expiresAt}`);
  store.sessions[token] = { accountKey, expiresAt };
  return token;
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
  const token = match[1];
  // 1. Check in-memory store if present
  const session = store.sessions[token];
  if (session && session.expiresAt > Date.now()) {
    const found = store.accounts.find(a => a.key === session.accountKey);
    if (found) return found;
  }
  // 2. Fall back to cryptographic token verification (stateless lambda support)
  const accountKey = verifySessionToken(token);
  if (!accountKey) return null;
  const acc = store.accounts.find(a => a.key === accountKey);
  return acc || { username: accountKey, key: accountKey, isPrimary: true };
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
    if (req.body !== undefined && req.body !== null) {
      if (typeof req.body === 'object') return resolve(req.body);
      if (typeof req.body === 'string') {
        try { return resolve(JSON.parse(req.body || '{}')); }
        catch { return resolve({ raw: req.body }); }
      }
    }
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
// Security Middleware & Utility Helpers
// ---------------------------------------------------------------------------
function requireAdmin(req, res) {
  const account = requestAccount(req);
  if (!account) {
    send(res, 401, { error: 'Authentication required. Please sign in as administrator.' });
    return null;
  }
  return account;
}

function parseCSV(text) {
  const rows = [];
  let currentRow = [];
  let currentVal = '';
  let inQuotes = false;
  let i = 0;
  const str = String(text || '').replace(/\r\n/g, '\n').replace(/\r/g, '\n');

  while (i < str.length) {
    const char = str[i];
    if (inQuotes) {
      if (char === '"') {
        if (i + 1 < str.length && str[i + 1] === '"') {
          currentVal += '"';
          i += 2;
          continue;
        } else {
          inQuotes = false;
          i++;
          continue;
        }
      } else {
        currentVal += char;
        i++;
        continue;
      }
    } else {
      if (char === '"') {
        inQuotes = true;
        i++;
        continue;
      } else if (char === ',') {
        currentRow.push(currentVal);
        currentVal = '';
        i++;
        continue;
      } else if (char === '\n') {
        currentRow.push(currentVal);
        currentVal = '';
        if (currentRow.some(val => val.trim().length > 0)) {
          rows.push(currentRow);
        }
        currentRow = [];
        i++;
        continue;
      } else {
        currentVal += char;
        i++;
        continue;
      }
    }
  }
  if (currentVal || currentRow.length > 0) {
    currentRow.push(currentVal);
    if (currentRow.some(val => val.trim().length > 0)) {
      rows.push(currentRow);
    }
  }
  return rows;
}

function suggestAcademicCategory(text) {
  const t = String(text || '').toLowerCase();
  if (/\b(computer|programming|software|algorithm|data structure|python|java|c\+\+|javascript|database|sql|network|operating system|artificial intelligence|machine learning|web|cyber|cloud|compiler)\b/i.test(t)) {
    return 'CSIT';
  }
  if (/\b(circuit|electronic|signal|communication|vlsi|semiconductor|microprocessor|embedded|antenna|telecom)\b/i.test(t)) {
    return 'Electronics';
  }
  if (/\b(mechanical|thermodynamics|fluid|heat transfer|mechanics|manufacturing|machine design|kinematics|cad|cam)\b/i.test(t)) {
    return 'Mechanical';
  }
  if (/\b(civil|concrete|structure|surveying|geotechnical|construction|environmental|transportation)\b/i.test(t)) {
    return 'Civil';
  }
  if (/\b(math|calculus|algebra|discrete|statistics|probability|differential|numerical)\b/i.test(t)) {
    return 'Mathematics';
  }
  if (/\b(physics|optics|quantum|electromagnetism|thermodynamics)\b/i.test(t)) {
    return 'Physics';
  }
  if (/\b(chemistry|organic|inorganic|polymer)\b/i.test(t)) {
    return 'Chemistry';
  }
  if (/\b(management|business|economics|communication skills|finance|marketing|entrepreneurship)\b/i.test(t)) {
    return 'Management';
  }
  return 'CSIT';
}

function fetchJson(urlStr, timeoutMs = 4000) {
  return new Promise((resolve) => {
    try {
      const u = new URL(urlStr);
      const mod = u.protocol === 'https:' ? require('https') : require('http');
      const req = mod.get(urlStr, { headers: { 'User-Agent': 'DGILMS/1.0' }, timeout: timeoutMs }, (res) => {
        let data = '';
        res.on('data', chunk => { data += chunk; });
        res.on('end', () => {
          try { resolve(JSON.parse(data)); }
          catch { resolve(null); }
        });
      });
      req.on('timeout', () => { req.destroy(); resolve(null); });
      req.on('error', () => { resolve(null); });
    } catch {
      resolve(null);
    }
  });
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
  let p = url.searchParams.get('_path') || req.headers['x-forwarded-uri'] || req.headers['x-matched-path'] || url.pathname;
  if (p.startsWith('/api/index.js') || p === '/api') {
    p = url.searchParams.get('_path') || req.headers['x-forwarded-uri'] || '/';
  }
  const method = req.method;

  try {
    // ============================ STUDENT PORTAL API =======================
    if (p === '/api/student/books' && method === 'GET') {
      const primaryKey = (store.accounts.find(a => a.isPrimary) || store.accounts[0] || {}).key || 'admin';
      const defaultState = defaultLibraryState();
      const rawState = (store.states[primaryKey] || {}).state;
      const state = (rawState && typeof rawState === 'object') ? rawState : defaultState;
      const books = (Array.isArray(state.books) && state.books.length > 0) ? state.books : defaultState.books;
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
      const defaultState = defaultLibraryState();
      const rawState = (store.states[primaryKey] || {}).state;
      const state = (rawState && typeof rawState === 'object') ? rawState : defaultState;
      const students = (Array.isArray(state.students) && state.students.length > 0) ? state.students : defaultState.students;
      const transactions = (Array.isArray(state.transactions) && state.transactions.length > 0) ? state.transactions : defaultState.transactions;

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

    // ==================== ADMIN BOOKS & CSV IMPORT =========================
    if (p === '/api/admin/books/import-csv' && method === 'POST') {
      const account = requireAdmin(req, res);
      if (!account) return;
      const b = await readBody(req);
      const csvText = String(b.csv || '').trim();
      if (!csvText) return send(res, 400, { error: 'CSV content is required.' });

      const rows = parseCSV(csvText);
      if (!rows || rows.length < 2) {
        return send(res, 400, { error: 'The CSV file is empty or missing data rows.' });
      }

      const headers = rows[0].map(h => String(h || '').trim().toLowerCase());
      const nameIdx = headers.findIndex(h => ['name', 'title', 'book_name', 'book title', 'book'].includes(h));
      const authorIdx = headers.findIndex(h => ['author', 'authors', 'writer', 'book_author'].includes(h));
      const categoryIdx = headers.findIndex(h => ['category', 'genre', 'department', 'subject', 'branch'].includes(h));

      if (nameIdx === -1 || authorIdx === -1 || categoryIdx === -1) {
        const missing = [];
        if (nameIdx === -1) missing.push('Name');
        if (authorIdx === -1) missing.push('Author');
        if (categoryIdx === -1) missing.push('Category');
        return send(res, 400, {
          error: `Missing required column headers: ${missing.join(', ')}. The CSV must contain ONLY columns: Name, Author, Category.`
        });
      }

      const entry = accountState(account.key);
      const state = entry.state || (entry.state = defaultLibraryState());
      state.books = Array.isArray(state.books) ? state.books : [];

      let nextId = state.books.reduce((max, bk) => Math.max(max, Number(bk.id) || 0), 0) + 1;
      let totalFound = 0;
      let importedCount = 0;
      let duplicateCount = 0;
      let invalidCount = 0;
      const errors = [];
      const importedBooks = [];

      for (let i = 1; i < rows.length; i++) {
        const row = rows[i];
        if (!row || row.every(col => !col || !String(col).trim())) continue;
        totalFound++;

        const name = String(row[nameIdx] || '').trim();
        const author = String(row[authorIdx] || '').trim();
        const category = String(row[categoryIdx] || '').trim();

        if (!name) {
          invalidCount++;
          errors.push(`Row ${i + 1}: Missing book name.`);
          continue;
        }

        // Duplicate check (by Title + Author case-insensitive)
        const isDup = state.books.some(bk =>
          String(bk.title || '').trim().toLowerCase() === name.toLowerCase() &&
          String(bk.author || '').trim().toLowerCase() === author.toLowerCase()
        ) || importedBooks.some(bk =>
          bk.title.toLowerCase() === name.toLowerCase() &&
          bk.author.toLowerCase() === author.toLowerCase()
        );

        if (isDup) {
          duplicateCount++;
          continue;
        }

        // Strict Requirement: Import ONLY Name, Author, Category.
        // No fake ISBNs, publishers, descriptions, or accession numbers.
        const newBook = {
          id: nextId++,
          title: name,
          author: author || '',
          category: category || 'General',
          isbn: '',
          publisher: '',
          description: '',
          shelf_location: '',
          quantity: 1,
          available: 1,
          borrow_count: 0,
          color1: '#510027',
          color2: '#3d001e',
          rating: 4.5,
          published_year: null,
          created_at: new Date().toISOString()
        };

        state.books.push(newBook);
        importedBooks.push(newBook);
        importedCount++;
      }

      entry.revision += 1;
      await saveStore();

      return send(res, 200, {
        success: true,
        totalFound,
        importedCount,
        duplicateCount,
        invalidCount,
        errors,
        books: state.books
      });
    }

    // ==================== ADMIN STUDENTS CSV IMPORT ========================
    if (p === '/api/admin/students/import-csv' && method === 'POST') {
      const account = requireAdmin(req, res);
      if (!account) return;
      const b = await readBody(req);
      const csvText = String(b.csv || '').trim();
      if (!csvText) return send(res, 400, { error: 'CSV content is required.' });

      const rows = parseCSV(csvText);
      if (!rows || rows.length < 2) {
        return send(res, 400, { error: 'The CSV file is empty or missing data rows.' });
      }

      const headers = rows[0].map(h => String(h || '').trim().toLowerCase());
      const nameIdx = headers.findIndex(h => ['student name', 'name', 'full name', 'student', 'student_name'].includes(h));
      const rollIdx = headers.findIndex(h => ['roll number', 'roll no', 'roll_no', 'rollno', 'roll', 'admission no'].includes(h));
      const emailIdx = headers.findIndex(h => ['email', 'email address', 'email id', 'email_id', 'student email'].includes(h));
      const deptIdx = headers.findIndex(h => ['department', 'dept', 'branch', 'course', 'stream'].includes(h));
      const phoneIdx = headers.findIndex(h => ['contact phone', 'phone', 'phone number', 'phone_number', 'mobile', 'contact', 'contact no'].includes(h));

      if (nameIdx === -1 || rollIdx === -1) {
        const missing = [];
        if (nameIdx === -1) missing.push('Student Name');
        if (rollIdx === -1) missing.push('Roll Number');
        return send(res, 400, {
          error: `Missing required column headers: ${missing.join(', ')}. Supported headers: Student Name, Roll Number, Email, Department, Contact Phone.`
        });
      }

      const entry = accountState(account.key);
      const state = entry.state || (entry.state = defaultLibraryState());
      state.students = Array.isArray(state.students) ? state.students : [];

      let nextId = state.students.reduce((max, s) => Math.max(max, Number(s.id) || 0), 0) + 1;
      let totalFound = 0;
      let importedCount = 0;
      let duplicateCount = 0;
      let invalidCount = 0;
      const errors = [];
      const importedStudents = [];

      for (let i = 1; i < rows.length; i++) {
        const row = rows[i];
        if (!row || row.every(col => !col || !String(col).trim())) continue;
        totalFound++;

        const name = String(row[nameIdx] || '').trim();
        const roll = String(row[rollIdx] || '').trim().toUpperCase();
        const email = emailIdx !== -1 ? String(row[emailIdx] || '').trim().toLowerCase() : '';
        const dept = deptIdx !== -1 ? String(row[deptIdx] || '').trim() : 'CSIT';
        const phone = phoneIdx !== -1 ? String(row[phoneIdx] || '').trim() : '+91';

        if (!name || !roll) {
          invalidCount++;
          errors.push(`Row ${i + 1}: Missing student Name or Roll Number.`);
          continue;
        }

        // Duplicate check: roll number or email
        const isDup = state.students.some(s =>
          String(s.roll_no || '').trim().toUpperCase() === roll ||
          (email && String(s.email || '').trim().toLowerCase() === email)
        ) || importedStudents.some(s =>
          s.roll_no.toUpperCase() === roll ||
          (email && s.email.toLowerCase() === email)
        );

        if (isDup) {
          duplicateCount++;
          continue;
        }

        const initials = name.split(/\s+/).map(w => w[0]).slice(0, 2).join('').toUpperCase() || 'ST';
        const newStudent = {
          id: nextId++,
          name,
          roll_no: roll,
          email: email || `${roll.toLowerCase()}@dronacharya.info`,
          department: dept || 'CSIT',
          phone: phone || '+91',
          avatar: initials,
          created_at: new Date().toISOString()
        };

        state.students.push(newStudent);
        importedStudents.push(newStudent);
        importedCount++;
      }

      entry.revision += 1;
      await saveStore();

      return send(res, 200, {
        success: true,
        totalFound,
        importedCount,
        duplicateCount,
        invalidCount,
        errors,
        students: state.students
      });
    }

    // ==================== ADMIN FACULTY CSV IMPORT =========================
    if (p === '/api/admin/faculty/import-csv' && method === 'POST') {
      const account = requireAdmin(req, res);
      if (!account) return;
      const b = await readBody(req);
      const csvText = String(b.csv || '').trim();
      if (!csvText) return send(res, 400, { error: 'CSV content is required.' });

      const rows = parseCSV(csvText);
      if (!rows || rows.length < 2) {
        return send(res, 400, { error: 'The CSV file is empty or missing data rows.' });
      }

      const headers = rows[0].map(h => String(h || '').trim().toLowerCase());
      const nameIdx = headers.findIndex(h => ['faculty name', 'name', 'full name', 'professor', 'faculty_name'].includes(h));
      const idIdx = headers.findIndex(h => ['faculty id', 'employee id', 'emp id', 'empid', 'id', 'faculty_id'].includes(h));
      const desigIdx = headers.findIndex(h => ['designation', 'post', 'role', 'title'].includes(h));
      const deptIdx = headers.findIndex(h => ['department', 'dept', 'branch'].includes(h));
      const phoneIdx = headers.findIndex(h => ['phone number', 'phone', 'contact number', 'mobile', 'contact'].includes(h));
      const emailIdx = headers.findIndex(h => ['email id', 'email', 'email address', 'faculty email'].includes(h));

      if (nameIdx === -1 || emailIdx === -1) {
        const missing = [];
        if (nameIdx === -1) missing.push('Faculty Name');
        if (emailIdx === -1) missing.push('Email');
        return send(res, 400, {
          error: `Missing required column headers: ${missing.join(', ')}. Supported headers: Faculty Name, Email, Employee ID, Department, Contact Number, Designation.`
        });
      }

      const entry = accountState(account.key);
      const state = entry.state || (entry.state = defaultLibraryState());
      state.faculty = Array.isArray(state.faculty) ? state.faculty : [];

      let nextId = state.faculty.reduce((max, f) => Math.max(max, Number(f.id) || 0), 0) + 1;
      let totalFound = 0;
      let importedCount = 0;
      let duplicateCount = 0;
      let invalidCount = 0;
      const errors = [];
      const importedFaculty = [];

      for (let i = 1; i < rows.length; i++) {
        const row = rows[i];
        if (!row || row.every(col => !col || !String(col).trim())) continue;
        totalFound++;

        const name = String(row[nameIdx] || '').trim();
        const email = String(row[emailIdx] || '').trim().toLowerCase();
        const facultyId = idIdx !== -1 ? String(row[idIdx] || '').trim() : '';
        const desig = desigIdx !== -1 ? String(row[desigIdx] || '').trim() : 'Assistant Professor';
        const dept = deptIdx !== -1 ? String(row[deptIdx] || '').trim() : 'CSIT';
        const phone = phoneIdx !== -1 ? String(row[phoneIdx] || '').trim() : '';

        if (!name || !email) {
          invalidCount++;
          errors.push(`Row ${i + 1}: Missing faculty Name or Email.`);
          continue;
        }

        // Duplicate check: faculty_id or email
        const isDup = state.faculty.some(f =>
          (facultyId && String(f.faculty_id || '').trim().toLowerCase() === facultyId.toLowerCase()) ||
          String(f.email || '').trim().toLowerCase() === email
        ) || importedFaculty.some(f =>
          (facultyId && f.faculty_id.toLowerCase() === facultyId.toLowerCase()) ||
          f.email.toLowerCase() === email
        );

        if (isDup) {
          duplicateCount++;
          continue;
        }

        const newFaculty = {
          id: nextId++,
          faculty_id: facultyId || `FAC-${nextId}`,
          name,
          designation: desig || 'Assistant Professor',
          department: dept || 'CSIT',
          phone: phone || '',
          email,
          created_at: new Date().toISOString()
        };

        state.faculty.push(newFaculty);
        importedFaculty.push(newFaculty);
        importedCount++;
      }

      entry.revision += 1;
      await saveStore();

      return send(res, 200, {
        success: true,
        totalFound,
        importedCount,
        duplicateCount,
        invalidCount,
        errors,
        faculty: state.faculty
      });
    }

    if (p === '/api/admin/books/metadata' && method === 'GET') {
      const account = requireAdmin(req, res);
      if (!account) return;
      const rawIsbn = (url.searchParams.get('isbn') || '').trim();
      const isbn = rawIsbn.replace(/[^0-9X]/gi, '');
      if (!isbn) return send(res, 400, { error: 'ISBN is required.' });

      let bookData = null;
      // 1. Try Open Library
      try {
        const olUrl = `https://openlibrary.org/api/books?bibkeys=ISBN:${isbn}&jscmd=data&format=json`;
        const olRes = await fetchJson(olUrl);
        const item = olRes ? olRes[`ISBN:${isbn}`] : null;
        if (item) {
          const authors = (item.authors || []).map(a => a.name).join(', ') || '';
          const subjects = (item.subjects || []).map(s => s.name).slice(0, 3).join(', ') || '';
          const publishers = (item.publishers || []).map(pub => pub.name).join(', ') || '';
          bookData = {
            title: item.title || '',
            author: authors,
            category: suggestAcademicCategory(item.title + ' ' + subjects),
            publisher: publishers,
            published_year: item.publish_date ? parseInt(item.publish_date.match(/\d{4}/)?.[0] || '', 10) || null : null,
            description: item.notes || (typeof item.description === 'string' ? item.description : item.description?.value) || '',
            isbn: rawIsbn
          };
        }
      } catch (err) {
        console.warn('Open Library lookup error:', err);
      }

      // 2. Fall back to Google Books API
      if (!bookData || !bookData.title) {
        try {
          const gbUrl = `https://www.googleapis.com/books/v1/volumes?q=isbn:${isbn}`;
          const gbRes = await fetchJson(gbUrl);
          const gbItem = gbRes?.items?.[0]?.volumeInfo;
          if (gbItem) {
            bookData = {
              title: gbItem.title || '',
              author: (gbItem.authors || []).join(', '),
              category: suggestAcademicCategory((gbItem.categories || []).join(' ') + ' ' + (gbItem.title || '')),
              publisher: gbItem.publisher || '',
              published_year: gbItem.publishedDate ? parseInt(gbItem.publishedDate.substring(0, 4), 10) || null : null,
              description: gbItem.description || '',
              isbn: rawIsbn
            };
          }
        } catch (err) {
          console.warn('Google Books lookup error:', err);
        }
      }

      if (!bookData || !bookData.title) {
        return send(res, 404, { error: `No metadata found online for ISBN ${rawIsbn}. Please enter details manually.` });
      }

      return send(res, 200, { success: true, book: bookData });
    }

    if (p === '/api/admin/books/ocr' && method === 'POST') {
      const account = requireAdmin(req, res);
      if (!account) return;
      const b = await readBody(req);
      const rawText = String(b.text || '').trim();
      if (!rawText) return send(res, 400, { error: 'Text content is required for OCR analysis.' });

      const lines = rawText.split(/\r?\n/).map(l => l.trim()).filter(l => l.length > 1);
      const isNoise = l => /^(edition|volume|pearson|mcgraw|wiley|oxford|cambridge|press|isbn|copyright|all rights|published|reprint|third|fourth|fifth|first|second|\d+(st|nd|rd|th))\b/i.test(l);

      const candidateTitles = [];
      const candidateAuthors = [];

      for (const line of lines) {
        if (/^(by|author|dr\.|prof\.)\s+/i.test(line)) {
          candidateAuthors.push(line.replace(/^(by|author:?)\s+/i, '').trim());
        } else if (!isNoise(line)) {
          candidateTitles.push(line);
        }
      }

      const title = candidateTitles[0] || lines[0] || 'Untitled Scanned Book';
      const author = candidateAuthors[0] || (candidateTitles.length > 1 ? candidateTitles[candidateTitles.length - 1] : 'Unknown Author');
      const suggestedCategory = suggestAcademicCategory(rawText);

      return send(res, 200, {
        success: true,
        title,
        author,
        category: suggestedCategory,
        disclaimer: 'Scanned via AI OCR. Please verify details before saving.'
      });
    }

    if (p === '/api/admin/books' && method === 'POST') {
      const account = requireAdmin(req, res);
      if (!account) return;
      const b = await readBody(req);
      const title = String(b.title || '').trim();
      const author = String(b.author || '').trim();
      const category = String(b.category || '').trim();
      if (!title) return send(res, 400, { error: 'Book title is required.' });
      if (!category) return send(res, 400, { error: 'Book category is required.' });

      const entry = accountState(account.key);
      const state = entry.state || (entry.state = defaultLibraryState());
      state.books = Array.isArray(state.books) ? state.books : [];

      let nextId = state.books.reduce((max, bk) => Math.max(max, Number(bk.id) || 0), 0) + 1;
      const qty = Math.max(1, parseInt(b.quantity, 10) || 1);
      const newBook = {
        id: nextId,
        title,
        author: author || '',
        category,
        isbn: String(b.isbn || '').trim(),
        publisher: String(b.publisher || '').trim(),
        description: String(b.description || '').trim(),
        shelf_location: String(b.shelf_location || '').trim(),
        quantity: qty,
        available: qty,
        borrow_count: 0,
        color1: b.color1 || '#510027',
        color2: b.color2 || '#3d001e',
        rating: parseFloat(b.rating) || 4.5,
        published_year: parseInt(b.published_year, 10) || null,
        created_at: new Date().toISOString()
      };
      state.books.push(newBook);
      entry.revision += 1;
      await saveStore();
      return send(res, 201, { success: true, book: newBook, books: state.books });
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
    // Root path '/' always serves login.html first
    if (p === '/' || p === '' || p === '/login' || p === '/login.html') {
      const asset = STATIC_ASSETS['/login.html'];
      if (asset && fs.existsSync(asset.file)) {
        return send(res, 200, fs.readFileSync(asset.file), asset.type, { 'Cache-Control': 'no-cache, no-store, must-revalidate' });
      }
    }

    // Direct access to /index.html is protected: unauthenticated users are redirected to /login.html
    if (p === '/index.html' || p === '/index') {
      const account = requestAccount(req);
      if (!account) {
        res.writeHead(302, {
          'Location': '/login.html',
          'Cache-Control': 'no-store, no-cache, must-revalidate, max-age=0',
          'Pragma': 'no-cache'
        });
        res.end();
        return;
      }
    }

    const norm = p.startsWith('/') ? p : '/' + p;
    if (STATIC_ASSETS[norm] && fs.existsSync(STATIC_ASSETS[norm].file)) {
      const asset = STATIC_ASSETS[norm];
      const headers = { 'Content-Type': asset.type };
      if (asset.type.startsWith('text/html')) headers['Cache-Control'] = 'no-cache';
      return send(res, 200, fs.readFileSync(asset.file), asset.type, headers);
    }

    let cleanPath = decodeURIComponent(p);
    if (cleanPath.startsWith('/')) cleanPath = cleanPath.slice(1);
    let full = path.join(ROOT, cleanPath || 'index.html');
    if (!fs.existsSync(full) && fs.existsSync(full + '.html')) {
      full = full + '.html';
    }
    if (!fs.existsSync(full) && process.cwd() && process.cwd() !== ROOT) {
      const altFull = path.join(process.cwd(), cleanPath || 'index.html');
      if (fs.existsSync(altFull)) full = altFull;
      else if (fs.existsSync(altFull + '.html')) full = altFull + '.html';
    }
    if (!fs.existsSync(full) || fs.statSync(full).isDirectory()) {
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
