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
function defaultSubjects() {
  return [
    { subject_id: 1, subject_name: "Computer Science Fundamentals", subject_code: "CS-101", description: "Core computer science principles, discrete structures, and theoretical computation.", icon: "💻" },
    { subject_id: 2, subject_name: "Programming & Software Development", subject_code: "CS-102", description: "Object-oriented programming, C++, Java, Python, and data structures.", icon: "⚡" },
    { subject_id: 3, subject_name: "Databases & Information Systems", subject_code: "CS-103", description: "Relational database management, SQL, query processing, and data architecture.", icon: "🗄️" },
    { subject_id: 4, subject_name: "Artificial Intelligence & Data Science", subject_code: "CS-104", description: "Machine learning algorithms, neural networks, computer vision, and modern AI.", icon: "🤖" },
    { subject_id: 5, subject_name: "Operating Systems", subject_code: "CS-105", description: "Kernel architecture, process synchronization, memory management, and file systems.", icon: "⚙️" },
    { subject_id: 6, subject_name: "Computer Networks", subject_code: "CS-106", description: "Network layers, protocols, TCP/IP, wireless routing, and data communication.", icon: "🌐" },
    { subject_id: 7, subject_name: "Cyber Security & Cloud", subject_code: "CS-107", description: "Network security, cryptography, cloud computing infrastructure, and virtualization.", icon: "🔒" },
    { subject_id: 8, subject_name: "Software Engineering & Architecture", subject_code: "CS-108", description: "Software engineering methodologies, system design patterns, and clean code principles.", icon: "📐" },
    { subject_id: 9, subject_name: "Electronics & Communication", subject_code: "EC-201", description: "Semiconductor physics, analog and digital electronics, and circuit theory.", icon: "📡" },
    { subject_id: 10, subject_name: "Mechanical Engineering", subject_code: "ME-301", description: "Engineering mechanics, statics, dynamics, thermodynamics, and manufacturing.", icon: "🔧" },
    { subject_id: 11, subject_name: "Mathematics & Applied Sciences", subject_code: "AS-101", description: "Engineering mathematics, calculus, linear algebra, and numerical techniques.", icon: "📊" }
  ];
}

function mapBookToSubjectId(book) {
  const t = (String(book.title || '') + ' ' + String(book.category || '')).toLowerCase();
  if (t.includes('database') || t.includes('dbms') || t.includes('sql')) return 3;
  if (t.includes('operating system') || t.includes('os internals')) return 5;
  if (t.includes('network')) return 6;
  if (t.includes('artificial intelligence') || t.includes('machine learning')) return 4;
  if (t.includes('clean code') || t.includes('software engineering')) return 8;
  if (t.includes('cloud')) return 7;
  if (t.includes('electronic') || t.includes('circuit')) return 9;
  if (t.includes('mechanic') || t.includes('mechanical')) return 10;
  if (t.includes('data structure') || t.includes('java') || t.includes('programming') || t.includes('algorithm') || t.includes('web tech')) return 2;
  if (t.includes('automata') || t.includes('computer science') || t.includes('theory')) return 1;
  return 1;
}

function ensureDatabaseIntegrity(state) {
  if (!state || typeof state !== 'object') return;
  if (!Array.isArray(state.subjects) || state.subjects.length === 0) {
    state.subjects = defaultSubjects();
  }
  if (!Array.isArray(state.book_requests)) {
    state.book_requests = [];
  }
  if (Array.isArray(state.books)) {
    state.books.forEach((b, idx) => {
      b.id = Number(b.id) || (idx + 1);
      b.book_id = Number(b.book_id) || b.id;
      b.book_name = b.book_name || b.title || `Book #${b.book_id}`;
      b.title = b.title || b.book_name;
      b.subject_id = Number(b.subject_id) || mapBookToSubjectId(b);
      const sub = state.subjects.find(s => s.subject_id === b.subject_id);
      if (sub && !b.category) b.category = sub.subject_name;
      b.total_copies = Number(b.total_copies ?? b.quantity ?? 1);
      b.available_copies = Number(b.available_copies ?? b.available ?? b.total_copies);
      b.quantity = b.total_copies;
      b.available = b.available_copies;
      b.publication_year = b.publication_year ?? b.published_year ?? 2024;
      b.publisher = b.publisher || 'DGI Academic Press';
      b.isbn = b.isbn || ('978-DGI-' + String(b.book_id).padStart(4, '0'));
    });
  }
}

function defaultLibraryState() {
  const subjects = defaultSubjects();
  const books = [
    { id: 1, book_id: 1, title: "Data Structures & Algorithms in C++", book_name: "Data Structures & Algorithms in C++", author: "Mark Allen Weiss", subject_id: 2, isbn: "978-0132847377", publisher: "Pearson", publication_year: 2013, category: "Programming & Software Development", shelf_location: "Stack CS-101", total_copies: 5, available_copies: 3, quantity: 5, available: 3 },
    { id: 2, book_id: 2, title: "Database System Concepts", book_name: "Database System Concepts", author: "Silberschatz, Korth, Sudarshan", subject_id: 3, isbn: "978-0078022159", publisher: "McGraw-Hill", publication_year: 2019, category: "Databases & Information Systems", shelf_location: "Stack CS-102", total_copies: 6, available_copies: 1, quantity: 6, available: 1 },
    { id: 3, book_id: 3, title: "Operating System Concepts", book_name: "Operating System Concepts", author: "Abraham Silberschatz, Peter B. Galvin", subject_id: 5, isbn: "978-1118063330", publisher: "Wiley", publication_year: 2018, category: "Operating Systems", shelf_location: "Stack CS-103", total_copies: 4, available_copies: 2, quantity: 4, available: 2 },
    { id: 4, book_id: 4, title: "Computer Networks", book_name: "Computer Networks", author: "Andrew S. Tanenbaum", subject_id: 6, isbn: "978-0132126953", publisher: "Pearson", publication_year: 2020, category: "Computer Networks", shelf_location: "Stack CS-104", total_copies: 5, available_copies: 4, quantity: 5, available: 4 },
    { id: 5, book_id: 5, title: "Artificial Intelligence: A Modern Approach", book_name: "Artificial Intelligence: A Modern Approach", author: "Stuart Russell, Peter Norvig", subject_id: 4, isbn: "978-0136042594", publisher: "Pearson", publication_year: 2021, category: "Artificial Intelligence & Data Science", shelf_location: "Stack CS-105", total_copies: 3, available_copies: 1, quantity: 3, available: 1 },
    { id: 6, book_id: 6, title: "Web Technologies: HTML, CSS, JavaScript & PHP", book_name: "Web Technologies: HTML, CSS, JavaScript & PHP", author: "Uttam K. Roy", subject_id: 2, isbn: "978-0198066224", publisher: "Oxford", publication_year: 2018, category: "Programming & Software Development", shelf_location: "Stack CS-106", total_copies: 4, available_copies: 3, quantity: 4, available: 3 },
    { id: 7, book_id: 7, title: "Theory of Computer Science: Automata, Languages", book_name: "Theory of Computer Science: Automata, Languages", author: "K.L.P. Mishra, N. Chandrasekaran", subject_id: 1, isbn: "978-8120329683", publisher: "PHI Learning", publication_year: 2014, category: "Computer Science Fundamentals", shelf_location: "Stack CS-107", total_copies: 4, available_copies: 2, quantity: 4, available: 2 },
    { id: 8, book_id: 8, title: "Software Engineering: A Practitioner's Approach", book_name: "Software Engineering: A Practitioner's Approach", author: "Roger S. Pressman", subject_id: 8, isbn: "978-0078022128", publisher: "McGraw-Hill", publication_year: 2019, category: "Software Engineering & Architecture", shelf_location: "Stack CS-108", total_copies: 5, available_copies: 0, quantity: 5, available: 0 },
    { id: 9, book_id: 9, title: "Electronic Devices and Circuit Theory", book_name: "Electronic Devices and Circuit Theory", author: "Robert L. Boylestad, Louis Nashelsky", subject_id: 9, isbn: "978-0137692828", publisher: "Pearson", publication_year: 2015, category: "Electronics & Communication", shelf_location: "Stack EC-201", total_copies: 3, available_copies: 1, quantity: 3, available: 1 },
    { id: 10, book_id: 10, title: "Engineering Mechanics: Statics and Dynamics", book_name: "Engineering Mechanics: Statics and Dynamics", author: "S. Timoshenko, D.H. Young", subject_id: 10, isbn: "978-0070616806", publisher: "McGraw-Hill", publication_year: 2017, category: "Mechanical Engineering", shelf_location: "Stack ME-301", total_copies: 5, available_copies: 4, quantity: 5, available: 4 }
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
    subjects,
    books,
    students,
    faculty: [],
    transactions,
    faculty_transactions: [],
    alert_logs: [],
    book_requests: [],
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
    sessions: {}           // sid -> { accountKey, role, studentId, rollNo, expiresAt }
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
    // Ensure database integrity for all states
    for (const key of Object.keys(loaded.states || {})) {
      if (loaded.states[key] && loaded.states[key].state) {
        ensureDatabaseIntegrity(loaded.states[key].state);
      }
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
  if (parts.length === 3) {
    // Legacy format: accountKey.expiresAt.sig
    const [accountKey, expiresAtStr, sig] = parts;
    const data = `${accountKey}.${expiresAtStr}`;
    const expectedSig = crypto.createHmac('sha256', SESSION_SECRET).update(data).digest('hex');
    if (sig !== expectedSig) return null;
    const expiresAt = Number(expiresAtStr);
    if (isNaN(expiresAt) || expiresAt <= Date.now()) return null;
    return { role: 'admin', accountKey, studentId: null, expiresAt };
  } else if (parts.length === 5) {
    // Role-based format: role.accountKey.studentId.expiresAt.sig
    const [role, accountKey, studentIdStr, expiresAtStr, sig] = parts;
    const data = `${role}.${accountKey}.${studentIdStr}.${expiresAtStr}`;
    const expectedSig = crypto.createHmac('sha256', SESSION_SECRET).update(data).digest('hex');
    if (sig !== expectedSig) return null;
    const expiresAt = Number(expiresAtStr);
    if (isNaN(expiresAt) || expiresAt <= Date.now()) return null;
    return {
      role,
      accountKey,
      studentId: studentIdStr === 'null' ? null : Number(studentIdStr),
      expiresAt
    };
  }
  return null;
}

function createSession(accountKey, role = 'admin', studentData = null) {
  const expiresAt = Date.now() + 7 * 24 * 60 * 60 * 1000;
  const studentId = studentData && studentData.id ? studentData.id : 'null';
  const data = `${role}.${accountKey}.${studentId}.${expiresAt}`;
  const token = signSessionToken(data);
  store.sessions[token] = {
    accountKey,
    role,
    studentId: studentData?.id || null,
    rollNo: studentData?.roll_no || null,
    student: studentData || null,
    expiresAt
  };
  return token;
}
function sessionCookieHeader(sid) {
  const secure = process.env.VERCEL ? '; Secure' : '';
  return `${SESSION_COOKIE}=${sid}; HttpOnly; Path=/; SameSite=Lax; Max-Age=604800${secure}`;
}
function clearCookieHeader() {
  return `${SESSION_COOKIE}=; HttpOnly; Path=/; SameSite=Lax; Max-Age=0`;
}

function getRequestSession(req) {
  const cookieHeader = req.headers.cookie || '';
  const match = cookieHeader.match(new RegExp(`(?:^|;\\s*)${SESSION_COOKIE}=([^;]+)`));
  if (!match) return null;
  const token = match[1];

  // 1. Check in-memory store
  const session = store.sessions[token];
  if (session && session.expiresAt > Date.now()) {
    if (session.role === 'student') {
      const primaryKey = (store.accounts.find(a => a.isPrimary) || store.accounts[0] || {}).key || 'admin';
      const state = (store.states[primaryKey] || {}).state || defaultLibraryState();
      const student = (state.students || []).find(s => Number(s.id) === Number(session.studentId) || (session.rollNo && String(s.roll_no).toLowerCase() === session.rollNo.toLowerCase())) || session.student;
      return {
        role: 'student',
        accountKey: session.accountKey,
        studentId: session.studentId,
        rollNo: session.rollNo,
        student: student || session.student,
        username: student?.name || session.rollNo
      };
    } else {
      const found = store.accounts.find(a => a.key === session.accountKey);
      return {
        role: 'admin',
        accountKey: session.accountKey,
        account: found || { username: session.accountKey, key: session.accountKey, isPrimary: true },
        username: found ? found.username : session.accountKey
      };
    }
  }

  // 2. Fall back to cryptographic token verification
  const verified = verifySessionToken(token);
  if (!verified) return null;

  if (verified.role === 'student') {
    const primaryKey = (store.accounts.find(a => a.isPrimary) || store.accounts[0] || {}).key || 'admin';
    const state = (store.states[primaryKey] || {}).state || defaultLibraryState();
    const student = (state.students || []).find(s => Number(s.id) === Number(verified.studentId) || (verified.accountKey && String(s.roll_no).toLowerCase() === verified.accountKey.toLowerCase()));
    return {
      role: 'student',
      accountKey: verified.accountKey,
      studentId: verified.studentId,
      rollNo: student?.roll_no || verified.accountKey,
      student: student || null,
      username: student?.name || verified.accountKey
    };
  } else {
    const acc = store.accounts.find(a => a.key === verified.accountKey);
    return {
      role: 'admin',
      accountKey: verified.accountKey,
      account: acc || { username: verified.accountKey, key: verified.accountKey, isPrimary: true },
      username: acc ? acc.username : verified.accountKey
    };
  }
}

function requestAccount(req) {
  const session = getRequestSession(req);
  if (!session || session.role !== 'admin') return null;
  return session.account;
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
  const session = getRequestSession(req);
  if (!session || session.role !== 'admin') {
    send(res, 403, { error: 'Administrator access required. Permission denied.' });
    return null;
  }
  return session.account;
}

function requireStudentOrAdmin(req, res) {
  const session = getRequestSession(req);
  if (!session) {
    send(res, 401, { error: 'Authentication required. Please sign in.' });
    return null;
  }
  return session;
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
    if (p === '/api/student/dashboard' && method === 'GET') {
      const session = requireStudentOrAdmin(req, res);
      if (!session) return;
      const primaryKey = (store.accounts.find(a => a.isPrimary) || store.accounts[0] || {}).key || 'admin';
      const state = (store.states[primaryKey] || {}).state || defaultLibraryState();
      ensureDatabaseIntegrity(state);

      const roll = (session.role === 'student' ? session.rollNo : (url.searchParams.get('roll_no') || 'CS101')).toLowerCase();
      const student = (state.students || []).find(s => String(s.roll_no || '').toLowerCase() === roll) || (state.students && state.students[0]) || { id: 1, name: "Student", roll_no: "CS101", department: "CSIT" };

      const studentTx = (state.transactions || []).filter(t => Number(t.student_id) === Number(student.id));
      const currentlyIssued = studentTx.filter(t => t.status === 'issued');
      const returnedHistory = studentTx.filter(t => t.status === 'returned');

      const today = new Date().toISOString().split('T')[0];
      const overdueBooks = currentlyIssued.filter(t => t.due_date && String(t.due_date) < today);
      const pendingReturns = currentlyIssued.filter(t => {
        if (!t.due_date) return false;
        const diffDays = Math.ceil((new Date(t.due_date + "T00:00:00") - new Date()) / 86400000);
        return diffDays >= 0 && diffDays <= 3;
      });

      const totalAvailableCopies = (state.books || []).reduce((acc, b) => acc + Math.max(0, Number(b.available_copies ?? b.available ?? b.total_copies ?? 1)), 0);
      const studentRequests = (state.book_requests || []).filter(r => Number(r.student_id) === Number(student.id));
      const notifications = (store.messages[primaryKey] || []).filter(m => Number(m.borrowerId) === Number(student.id) || (m.student && String(m.student.rollNo).toLowerCase() === roll));

      return send(res, 200, {
        student: {
          id: student.id,
          name: student.name,
          roll_no: student.roll_no,
          department: student.department || 'CSIT',
          email: student.email,
          phone: student.phone
        },
        kpis: {
          total_available_books: totalAvailableCopies,
          books_currently_issued: currentlyIssued.length,
          pending_returns: pendingReturns.length,
          overdue_books: overdueBooks.length
        },
        stats: {
          totalAvailableBooks: totalAvailableCopies,
          currentlyIssued: currentlyIssued.length,
          pendingReturns: pendingReturns.length,
          overdueBooks: overdueBooks.length
        },
        activeLoans: currentlyIssued,
        currently_issued: currentlyIssued,
        history: returnedHistory,
        book_requests: studentRequests,
        notifications: notifications.slice(0, 10)
      });
    }

    if (p === '/api/student/my-books' && method === 'GET') {
      const session = requireStudentOrAdmin(req, res);
      if (!session) return;
      const primaryKey = (store.accounts.find(a => a.isPrimary) || store.accounts[0] || {}).key || 'admin';
      const state = (store.states[primaryKey] || {}).state || defaultLibraryState();
      ensureDatabaseIntegrity(state);

      const roll = (session.role === 'student' ? session.rollNo : (url.searchParams.get('roll_no') || 'CS101')).toLowerCase();
      const student = (state.students || []).find(s => String(s.roll_no || '').toLowerCase() === roll);
      if (!student) return send(res, 404, { error: 'Student record not found.' });

      const studentTx = (state.transactions || []).filter(t => Number(t.student_id) === Number(student.id));
      const currentlyIssued = studentTx.filter(t => t.status === 'issued');
      const returnedHistory = studentTx.filter(t => t.status === 'returned');

      return send(res, 200, {
        currently_issued: currentlyIssued,
        history: returnedHistory,
        total_issued: currentlyIssued.length,
        total_returned: returnedHistory.length
      });
    }

    if (p === '/api/student/profile' && method === 'GET') {
      const session = requireStudentOrAdmin(req, res);
      if (!session) return;
      const primaryKey = (store.accounts.find(a => a.isPrimary) || store.accounts[0] || {}).key || 'admin';
      const state = (store.states[primaryKey] || {}).state || defaultLibraryState();
      ensureDatabaseIntegrity(state);

      const roll = (session.role === 'student' ? session.rollNo : (url.searchParams.get('roll_no') || 'CS101')).toLowerCase();
      const student = (state.students || []).find(s => String(s.roll_no || '').toLowerCase() === roll);
      if (!student) return send(res, 404, { error: 'Student profile not found.' });

      return send(res, 200, { student });
    }

    if (p === '/api/student/book-requests' && method === 'GET') {
      const session = requireStudentOrAdmin(req, res);
      if (!session) return;
      const primaryKey = (store.accounts.find(a => a.isPrimary) || store.accounts[0] || {}).key || 'admin';
      const state = (store.states[primaryKey] || {}).state || defaultLibraryState();
      ensureDatabaseIntegrity(state);

      const roll = (session.role === 'student' ? session.rollNo : (url.searchParams.get('roll_no') || 'CS101')).toLowerCase();
      const student = (state.students || []).find(s => String(s.roll_no || '').toLowerCase() === roll);
      const studentId = student ? student.id : session.studentId;

      const requests = (state.book_requests || []).filter(r => Number(r.student_id) === Number(studentId));
      return send(res, 200, { requests });
    }

    if (p === '/api/student/book-requests' && method === 'POST') {
      const session = requireStudentOrAdmin(req, res);
      if (!session) return;
      const b = await readBody(req);
      const bookId = Number(b.book_id || b.id);
      if (!bookId) return send(res, 400, { error: 'Book ID is required.' });

      const primaryKey = (store.accounts.find(a => a.isPrimary) || store.accounts[0] || {}).key || 'admin';
      const entry = accountState(primaryKey);
      const state = entry.state || (entry.state = defaultLibraryState());
      ensureDatabaseIntegrity(state);

      const book = (state.books || []).find(bk => Number(bk.book_id) === bookId || Number(bk.id) === bookId);
      if (!book) return send(res, 404, { error: 'Book not found in library catalog.' });

      const roll = (session.role === 'student' ? session.rollNo : (b.roll_no || 'CS101')).toLowerCase();
      const student = (state.students || []).find(s => String(s.roll_no || '').toLowerCase() === roll) || { id: session.studentId || 1, name: session.username || "Student", roll_no: roll };

      const existingReq = (state.book_requests || []).find(r => Number(r.student_id) === Number(student.id) && Number(r.book_id) === bookId && r.status === 'pending');
      if (existingReq) {
        return send(res, 409, { error: 'You already have an active pending request for this title.' });
      }

      const nextReqId = (state.book_requests || []).reduce((max, r) => Math.max(max, Number(r.id) || 0), 0) + 1;
      const newRequest = {
        id: nextReqId,
        student_id: student.id,
        student_name: student.name,
        student_roll: student.roll_no,
        book_id: book.book_id || book.id,
        book_title: book.title || book.book_name,
        author: book.author || '',
        isbn: book.isbn || '',
        status: 'pending',
        requested_at: new Date().toISOString(),
        notes: String(b.notes || '').trim()
      };

      state.book_requests = state.book_requests || [];
      state.book_requests.push(newRequest);
      entry.revision += 1;
      await saveStore();

      return send(res, 201, { success: true, request: newRequest });
    }

    const cancelRequestMatch = p.match(/^\/api\/student\/book-requests\/(\d+)$/);
    if (cancelRequestMatch && method === 'DELETE') {
      const session = requireStudentOrAdmin(req, res);
      if (!session) return;
      const reqId = Number(cancelRequestMatch[1]);
      const primaryKey = (store.accounts.find(a => a.isPrimary) || store.accounts[0] || {}).key || 'admin';
      const entry = accountState(primaryKey);
      const state = entry.state || (entry.state = defaultLibraryState());
      ensureDatabaseIntegrity(state);

      const rIndex = (state.book_requests || []).findIndex(r => Number(r.id) === reqId);
      if (rIndex === -1) return send(res, 404, { error: 'Request not found.' });

      state.book_requests.splice(rIndex, 1);
      entry.revision += 1;
      await saveStore();
      return send(res, 200, { success: true, deletedRequestId: reqId });
    }

    if (p === '/api/student/books' && method === 'GET') {
      const primaryKey = (store.accounts.find(a => a.isPrimary) || store.accounts[0] || {}).key || 'admin';
      const defaultState = defaultLibraryState();
      const rawState = (store.states[primaryKey] || {}).state;
      const state = (rawState && typeof rawState === 'object') ? rawState : defaultState;
      ensureDatabaseIntegrity(state);

      const books = (Array.isArray(state.books) && state.books.length > 0) ? state.books : defaultState.books;
      const publicBooks = books.map(b => {
        const sub = (state.subjects || []).find(s => Number(s.subject_id) === Number(b.subject_id)) || {};
        return {
          id: b.id,
          book_id: b.book_id || b.id,
          title: b.title || b.book_name,
          book_name: b.book_name || b.title,
          author: b.author,
          isbn: b.isbn || '',
          subject_id: b.subject_id,
          subject_name: sub.subject_name || b.category || 'General',
          subject_code: sub.subject_code || '',
          category: b.category || sub.subject_name || 'General',
          publisher: b.publisher || 'DGI Academic Press',
          publication_year: b.publication_year ?? b.published_year ?? 2024,
          shelf_location: b.shelf_location || 'Central Stack',
          description: b.description || '',
          total_copies: Number(b.total_copies ?? b.quantity ?? 1),
          available_copies: Number(b.available_copies >= 0 ? b.available_copies : (b.available >= 0 ? b.available : (b.total_copies || 1))),
          color1: b.color1 || '#510027',
          color2: b.color2 || '#3d001e',
          rating: b.rating || 4.5
        };
      });
      return send(res, 200, { books: publicBooks });
    }

    if (p === '/api/student/status' && method === 'GET') {
      const rollNo = (url.searchParams.get('roll_no') || '').trim().toLowerCase();
      if (!rollNo) return send(res, 400, { error: 'Roll number is required.' });

      const primaryKey = (store.accounts.find(a => a.isPrimary) || store.accounts[0] || {}).key || 'admin';
      const defaultState = defaultLibraryState();
      const rawState = (store.states[primaryKey] || {}).state;
      const state = (rawState && typeof rawState === 'object') ? rawState : defaultState;
      ensureDatabaseIntegrity(state);

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

    // ============================ SUBJECTS API ==============================
    if (p === '/api/subjects' && method === 'GET') {
      const primaryKey = (store.accounts.find(a => a.isPrimary) || store.accounts[0] || {}).key || 'admin';
      const state = (store.states[primaryKey] || {}).state || defaultLibraryState();
      ensureDatabaseIntegrity(state);

      const subjects = (state.subjects || []).map(s => {
        const bks = (state.books || []).filter(b => Number(b.subject_id) === Number(s.subject_id));
        const totalBooks = bks.length;
        const totalCopies = bks.reduce((sum, b) => sum + Number(b.total_copies ?? b.quantity ?? 1), 0);
        const availableBooks = bks.reduce((sum, b) => sum + Math.max(0, Number(b.available_copies ?? b.available ?? b.total_copies ?? 1)), 0);
        return {
          subject_id: s.subject_id,
          subject_name: s.subject_name,
          subject_code: s.subject_code || '',
          description: s.description || '',
          icon: s.icon || '📖',
          total_books: totalBooks,
          available_books: availableBooks,
          total_copies: totalCopies
        };
      });
      return send(res, 200, { subjects });
    }

    const subjectDetailMatch = p.match(/^\/api\/subjects\/(\d+)\/books$/);
    if (subjectDetailMatch && method === 'GET') {
      const subId = Number(subjectDetailMatch[1]);
      const primaryKey = (store.accounts.find(a => a.isPrimary) || store.accounts[0] || {}).key || 'admin';
      const state = (store.states[primaryKey] || {}).state || defaultLibraryState();
      ensureDatabaseIntegrity(state);

      const subject = (state.subjects || []).find(s => Number(s.subject_id) === subId);
      if (!subject) return send(res, 404, { error: 'Subject not found.' });

      const books = (state.books || []).filter(b => Number(b.subject_id) === subId).map(b => ({
        id: b.id,
        book_id: b.book_id || b.id,
        title: b.title || b.book_name,
        book_name: b.book_name || b.title,
        author: b.author,
        subject_id: b.subject_id,
        subject_name: subject.subject_name,
        isbn: b.isbn || '',
        publisher: b.publisher || 'DGI Academic Press',
        publication_year: b.publication_year ?? b.published_year ?? 2024,
        total_copies: Number(b.total_copies ?? b.quantity ?? 1),
        available_copies: Number(b.available_copies ?? b.available ?? b.total_copies ?? 1),
        shelf_location: b.shelf_location || '',
        description: b.description || '',
        category: b.category || subject.subject_name
      }));

      return send(res, 200, { subject, books });
    }

    if (p === '/api/admin/subjects' && method === 'POST') {
      const account = requireAdmin(req, res);
      if (!account) return;
      const b = await readBody(req);
      const name = String(b.subject_name || b.name || '').trim();
      const code = String(b.subject_code || b.code || '').trim();
      const desc = String(b.description || '').trim();
      const icon = String(b.icon || '📖').trim();

      if (!name) return send(res, 400, { error: 'Subject name is required.' });

      const entry = accountState(account.key);
      const state = entry.state || (entry.state = defaultLibraryState());
      ensureDatabaseIntegrity(state);

      const dup = state.subjects.find(s => s.subject_name.toLowerCase() === name.toLowerCase() || (code && s.subject_code && s.subject_code.toLowerCase() === code.toLowerCase()));
      if (dup) {
        return send(res, 409, { error: `A subject with name '${dup.subject_name}' or code '${dup.subject_code}' already exists.` });
      }

      const nextId = state.subjects.reduce((max, s) => Math.max(max, Number(s.subject_id) || 0), 0) + 1;
      const newSubject = {
        subject_id: nextId,
        subject_name: name,
        subject_code: code,
        description: desc,
        icon: icon || '📖',
        created_at: new Date().toISOString()
      };
      state.subjects.push(newSubject);
      entry.revision += 1;
      await saveStore();
      return send(res, 201, { success: true, subject: newSubject, subjects: state.subjects });
    }

    const adminSubjectMatch = p.match(/^\/api\/admin\/subjects\/(\d+)$/);
    if (adminSubjectMatch && method === 'PUT') {
      const account = requireAdmin(req, res);
      if (!account) return;
      const subId = Number(adminSubjectMatch[1]);
      const b = await readBody(req);
      const name = String(b.subject_name || b.name || '').trim();
      const code = String(b.subject_code || b.code || '').trim();
      const desc = String(b.description !== undefined ? b.description : '').trim();
      const icon = String(b.icon || '').trim();

      if (!name) return send(res, 400, { error: 'Subject name is required.' });

      const entry = accountState(account.key);
      const state = entry.state || (entry.state = defaultLibraryState());
      ensureDatabaseIntegrity(state);

      const subject = state.subjects.find(s => Number(s.subject_id) === subId);
      if (!subject) return send(res, 404, { error: 'Subject not found.' });

      const dup = state.subjects.find(s => Number(s.subject_id) !== subId && (s.subject_name.toLowerCase() === name.toLowerCase() || (code && s.subject_code && s.subject_code.toLowerCase() === code.toLowerCase())));
      if (dup) {
        return send(res, 409, { error: 'Another subject with this name or code already exists.' });
      }

      const oldName = subject.subject_name;
      subject.subject_name = name;
      if (code !== undefined) subject.subject_code = code;
      if (b.description !== undefined) subject.description = desc;
      if (icon) subject.icon = icon;

      (state.books || []).forEach(bk => {
        if (Number(bk.subject_id) === subId && (!bk.category || bk.category === oldName)) {
          bk.category = name;
        }
      });

      entry.revision += 1;
      await saveStore();
      return send(res, 200, { success: true, subject, subjects: state.subjects });
    }

    if (adminSubjectMatch && method === 'DELETE') {
      const account = requireAdmin(req, res);
      if (!account) return;
      const subId = Number(adminSubjectMatch[1]);
      const b = await readBody(req);
      const reassignId = b.reassign_to_subject_id ? Number(b.reassign_to_subject_id) : (url.searchParams.get('reassign_to') ? Number(url.searchParams.get('reassign_to')) : null);

      const entry = accountState(account.key);
      const state = entry.state || (entry.state = defaultLibraryState());
      ensureDatabaseIntegrity(state);

      const subIdx = state.subjects.findIndex(s => Number(s.subject_id) === subId);
      if (subIdx === -1) return send(res, 404, { error: 'Subject not found.' });

      const dependentBooks = (state.books || []).filter(bk => Number(bk.subject_id) === subId);
      if (dependentBooks.length > 0) {
        if (!reassignId) {
          return send(res, 400, {
            error: `Cannot delete subject because ${dependentBooks.length} book(s) belong to it. Please reassign or delete these books first.`,
            dependentBooksCount: dependentBooks.length
          });
        }
        const targetSub = state.subjects.find(s => Number(s.subject_id) === reassignId);
        if (!targetSub || targetSub.subject_id === subId) {
          return send(res, 400, { error: 'Invalid reassign target subject ID.' });
        }
        dependentBooks.forEach(bk => {
          bk.subject_id = reassignId;
          bk.category = targetSub.subject_name;
        });
      }

      state.subjects.splice(subIdx, 1);
      entry.revision += 1;
      await saveStore();
      return send(res, 200, { success: true, deletedSubjectId: subId, subjects: state.subjects });
    }

    // ============================ AUTH =====================================
    if (p === '/api/auth/status' && method === 'GET') {
      const session = getRequestSession(req);
      const setupRequired = !store.accounts.some(a => a.isPrimary);
      const payload = { authenticated: Boolean(session), setupRequired };
      if (session) {
        payload.role = session.role;
        payload.username = session.username;
        if (session.role === 'admin') {
          payload.isPrimaryAccount = Boolean(session.account?.isPrimary);
        } else if (session.role === 'student') {
          payload.student = session.student;
          payload.roll_no = session.rollNo;
        }
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
      const sid = createSession(account.key, 'admin');
      await saveStore();
      return send(res, 200, { username: account.username, role: 'admin' }, undefined, { 'Set-Cookie': sessionCookieHeader(sid) });
    }

    if (p === '/api/auth/login' && method === 'POST') {
      const b = await readBody(req);
      const input = String(b.username || b.roll_no || '').trim();
      const password = String(b.password || '');
      const role = String(b.role || '').toLowerCase();

      // Check if student login is requested or detected
      const primaryKey = (store.accounts.find(a => a.isPrimary) || store.accounts[0] || {}).key || 'admin';
      const state = (store.states[primaryKey] || {}).state || defaultLibraryState();
      ensureDatabaseIntegrity(state);

      const student = (state.students || []).find(s =>
        String(s.roll_no || '').toLowerCase() === input.toLowerCase() ||
        String(s.email || '').toLowerCase() === input.toLowerCase()
      );

      if (role === 'student' || (!role && student && !store.accounts.some(a => a.key === input.toLowerCase()))) {
        if (!student) {
          return send(res, 401, { error: `No student found with Roll Number or Email '${input}'. Please verify or contact the librarian.` });
        }
        // Verify student password (if student has hash/salt verify, else accept roll number or student123 or password)
        let pwValid = false;
        if (student.hash && student.salt) {
          pwValid = verifyPassword(password, student.salt, student.hash);
        } else {
          // Default initial student password is their roll_no (case-insensitive) or 'student123' or empty/any initial password
          pwValid = !password || password.toLowerCase() === student.roll_no.toLowerCase() || password === 'student123' || password === 'password' || password === 'admin123';
        }

        if (!pwValid) {
          return send(res, 401, { error: 'Invalid password. (Default password is your Roll Number, e.g. ' + student.roll_no + ')' });
        }

        const sid = createSession(student.roll_no.toLowerCase(), 'student', student);
        await saveStore();
        return send(res, 200, {
          role: 'student',
          username: student.name,
          roll_no: student.roll_no,
          student: {
            id: student.id,
            name: student.name,
            roll_no: student.roll_no,
            department: student.department || 'CSIT',
            email: student.email,
            phone: student.phone
          }
        }, undefined, { 'Set-Cookie': sessionCookieHeader(sid) });
      }

      // Admin Login
      const account = store.accounts.find(a => a.key === input.toLowerCase());
      if (!account || !verifyPassword(password, account.salt, account.hash)) {
        return send(res, 401, { error: 'Invalid administrator username or password.' });
      }
      const sid = createSession(account.key, 'admin');
      await saveStore();
      return send(res, 200, { role: 'admin', username: account.username }, undefined, { 'Set-Cookie': sessionCookieHeader(sid) });
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
      const csvText = String(b.csv || b.csvText || '').trim();
      if (!csvText) return send(res, 400, { error: 'CSV content is required.' });

      const rows = parseCSV(csvText);
      if (!rows || rows.length < 2) {
        return send(res, 400, { error: 'The CSV file is empty or missing data rows.' });
      }

      const headers = rows[0].map(h => String(h || '').trim().toLowerCase());
      const nameIdx = headers.findIndex(h => ['name', 'title', 'book_name', 'book name', 'book title', 'book'].includes(h));
      const authorIdx = headers.findIndex(h => ['author', 'authors', 'writer', 'book_author', 'book author'].includes(h));
      const categoryIdx = headers.findIndex(h => ['category', 'genre', 'department', 'subject', 'branch', 'subject_name', 'subject name'].includes(h));

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

        // Map or associate to Subject (Subject-wise book management)
        ensureDatabaseIntegrity(state);
        let sub = state.subjects.find(s =>
          s.subject_name.toLowerCase() === category.toLowerCase() ||
          (s.subject_code && s.subject_code.toLowerCase() === category.toLowerCase())
        );
        if (!sub) {
          const nextSubId = state.subjects.reduce((max, s) => Math.max(max, Number(s.subject_id) || 0), 0) + 1;
          sub = {
            subject_id: nextSubId,
            subject_name: category,
            subject_code: `SUB-${nextSubId}`,
            description: `Imported subject: ${category}`,
            icon: '📖',
            created_at: new Date().toISOString()
          };
          state.subjects.push(sub);
        }

        const bookId = nextId++;
        const newBook = {
          id: bookId,
          book_id: bookId,
          title: name,
          book_name: name,
          author: author || '',
          subject_id: sub.subject_id,
          category: sub.subject_name,
          isbn: '978-DGI-' + String(bookId).padStart(4, '0'),
          publisher: 'DGI Academic Press',
          description: '',
          shelf_location: `Stack ${sub.subject_code || 'CS-101'}`,
          quantity: 1,
          total_copies: 1,
          available: 1,
          available_copies: 1,
          borrow_count: 0,
          color1: '#510027',
          color2: '#3d001e',
          rating: 4.5,
          published_year: new Date().getFullYear(),
          publication_year: new Date().getFullYear(),
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
      const csvText = String(b.csv || b.csvText || '').trim();
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
      const csvText = String(b.csv || b.csvText || '').trim();
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
      const title = String(b.title || b.book_name || '').trim();
      const author = String(b.author || '').trim();
      if (!title) return send(res, 400, { error: 'Book title is required.' });

      const entry = accountState(account.key);
      const state = entry.state || (entry.state = defaultLibraryState());
      ensureDatabaseIntegrity(state);

      state.books = Array.isArray(state.books) ? state.books : [];

      let subjectId = Number(b.subject_id);
      let subject = state.subjects.find(s => Number(s.subject_id) === subjectId);
      if (!subject && b.category) {
        subject = state.subjects.find(s => s.subject_name.toLowerCase() === String(b.category).trim().toLowerCase());
        if (subject) subjectId = subject.subject_id;
      }
      if (!subject) {
        subject = state.subjects[0];
        subjectId = subject ? subject.subject_id : 1;
      }

      let nextId = state.books.reduce((max, bk) => Math.max(max, Number(bk.id) || Number(bk.book_id) || 0), 0) + 1;
      const qty = Math.max(1, parseInt(b.quantity || b.total_copies, 10) || 1);
      const newBook = {
        id: nextId,
        book_id: nextId,
        title,
        book_name: title,
        author: author || 'Unknown Author',
        category: subject ? subject.subject_name : (b.category || 'General'),
        subject_id: subjectId,
        isbn: String(b.isbn || '').trim() || ('978-DGI-' + String(nextId).padStart(4, '0')),
        publisher: String(b.publisher || '').trim() || 'DGI Academic Press',
        description: String(b.description || '').trim(),
        shelf_location: String(b.shelf_location || '').trim() || `Stack ${subject?.subject_code || 'CS-101'}`,
        quantity: qty,
        total_copies: qty,
        available: qty,
        available_copies: qty,
        borrow_count: 0,
        color1: b.color1 || '#510027',
        color2: b.color2 || '#3d001e',
        rating: parseFloat(b.rating) || 4.5,
        published_year: parseInt(b.published_year || b.publication_year, 10) || new Date().getFullYear(),
        publication_year: parseInt(b.publication_year || b.published_year, 10) || new Date().getFullYear(),
        created_at: new Date().toISOString()
      };
      state.books.push(newBook);
      entry.revision += 1;
      await saveStore();
      return send(res, 201, { success: true, book: newBook, books: state.books });
    }

    const adminBookMatch = p.match(/^\/api\/admin\/books\/(\d+)$/);
    if (adminBookMatch && method === 'PUT') {
      const account = requireAdmin(req, res);
      if (!account) return;
      const bookId = Number(adminBookMatch[1]);
      const b = await readBody(req);
      const entry = accountState(account.key);
      const state = entry.state || (entry.state = defaultLibraryState());
      ensureDatabaseIntegrity(state);

      const book = state.books.find(bk => Number(bk.id) === bookId || Number(bk.book_id) === bookId);
      if (!book) return send(res, 404, { error: 'Book not found.' });

      if (b.title || b.book_name) {
        book.title = String(b.title || b.book_name).trim();
        book.book_name = book.title;
      }
      if (b.author !== undefined) book.author = String(b.author).trim();
      if (b.subject_id !== undefined) {
        const subId = Number(b.subject_id);
        const sub = state.subjects.find(s => Number(s.subject_id) === subId);
        if (sub) {
          book.subject_id = subId;
          book.category = sub.subject_name;
        }
      } else if (b.category !== undefined) {
        book.category = String(b.category).trim();
      }
      if (b.isbn !== undefined) book.isbn = String(b.isbn).trim();
      if (b.publisher !== undefined) book.publisher = String(b.publisher).trim();
      if (b.publication_year || b.published_year) {
        book.publication_year = parseInt(b.publication_year || b.published_year, 10);
        book.published_year = book.publication_year;
      }
      if (b.description !== undefined) book.description = String(b.description).trim();
      if (b.shelf_location !== undefined) book.shelf_location = String(b.shelf_location).trim();

      if (b.total_copies !== undefined || b.quantity !== undefined) {
        const newTotal = Math.max(1, parseInt(b.total_copies ?? b.quantity, 10) || 1);
        const oldTotal = Number(book.total_copies ?? book.quantity ?? 1);
        const diff = newTotal - oldTotal;
        book.total_copies = newTotal;
        book.quantity = newTotal;
        book.available_copies = Math.max(0, Number(book.available_copies ?? book.available ?? 1) + diff);
        book.available = book.available_copies;
      }

      entry.revision += 1;
      await saveStore();
      return send(res, 200, { success: true, book });
    }

    if (adminBookMatch && method === 'DELETE') {
      const account = requireAdmin(req, res);
      if (!account) return;
      const bookId = Number(adminBookMatch[1]);
      const entry = accountState(account.key);
      const state = entry.state || (entry.state = defaultLibraryState());
      ensureDatabaseIntegrity(state);

      const isIssued = (state.transactions || []).some(t => Number(t.book_id) === bookId && t.status === 'issued');
      if (isIssued) {
        return send(res, 400, { error: 'Cannot delete a book that is currently issued to students or faculty.' });
      }

      const idx = state.books.findIndex(bk => Number(bk.id) === bookId || Number(bk.book_id) === bookId);
      if (idx === -1) return send(res, 404, { error: 'Book not found.' });

      state.books.splice(idx, 1);
      entry.revision += 1;
      await saveStore();
      return send(res, 200, { success: true, deletedBookId: bookId, books: state.books });
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

    // Direct access to /index.html is protected: unauthenticated or students are redirected
    if (p === '/index.html' || p === '/index') {
      const session = getRequestSession(req);
      if (!session || session.role !== 'admin') {
        const dest = session && session.role === 'student' ? '/student.html' : '/login.html';
        res.writeHead(302, {
          'Location': dest,
          'Cache-Control': 'no-store, no-cache, must-revalidate, max-age=0',
          'Pragma': 'no-cache'
        });
        res.end();
        return;
      }
    }

    // Direct access to /student.html is protected: unauthenticated users redirected to login
    if (p === '/student.html' || p === '/student') {
      const session = getRequestSession(req);
      if (!session) {
        res.writeHead(302, {
          'Location': '/login.html?role=student',
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
