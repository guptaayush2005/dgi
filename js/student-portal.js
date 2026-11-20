/**
 * DGI LMS - Student Portal Controller
 * Professional Student-Facing Interface
 */

class StudentPortal {
  constructor() {
    this.currentView = "dashboard";
    this.browseMode = "subjects"; // 'subjects' | 'all'
    this.activeSubjectId = null;
    this.modalBookId = null;

    this.student = null;
    this.dashboardData = null;
    this.myBooksData = null;
    this.subjects = [];
    this.allBooks = [];
    this.requests = [];

    this.init();
  }

  async init() {
    this.setupTheme();
    this.setupHeaderClock();
    await this.loadInitialData();
  }

  escapeHTML(value) {
    return String(value ?? "").replace(/[&<>"']/g, c => ({
      "&": "&amp;",
      "<": "&lt;",
      ">": "&gt;",
      '"': "&quot;",
      "'": "&#39;"
    })[c]);
  }

  safeBookColor(value) {
    const color = String(value || "");
    return /^#[\da-f]{3,8}$/i.test(color) && [4, 5, 7, 9].includes(color.length) ? color : "#510027";
  }

  matchId(a, b) {
    if (a == null || b == null) return false;
    if (window.db?.matchId) return window.db.matchId(a, b);
    const sa = String(a).trim().toLowerCase();
    const sb = String(b).trim().toLowerCase();
    if (sa === sb) return true;
    const numA = sa.replace(/^[a-z_-]+/i, "");
    const numB = sb.replace(/^[a-z_-]+/i, "");
    if (numA && numB && parseInt(numA, 10) === parseInt(numB, 10)) return true;
    return false;
  }

  // --- Themes & Display Settings ---
  setupTheme() {
    const savedAccent = localStorage.getItem("dgi_accent") || "dronacharya";
    const savedTheme = localStorage.getItem("dgi_student_theme") || "dark";
    document.documentElement.setAttribute("data-theme", savedTheme);
    document.documentElement.setAttribute("data-accent", savedAccent);
    this.updateThemeButton(savedTheme);
  }

  toggleTheme() {
    const current = document.documentElement.getAttribute("data-theme") || "dark";
    const next = current === "dark" ? "light" : "dark";
    document.documentElement.setAttribute("data-theme", next);
    localStorage.setItem("dgi_student_theme", next);
    this.updateThemeButton(next);
  }

  updateThemeButton(theme) {
    const icon = document.getElementById("theme-toggle-icon");
    if (icon) icon.textContent = theme === "dark" ? "☀️" : "🌙";
  }

  setAccent(accent) {
    document.documentElement.setAttribute("data-accent", accent);
    localStorage.setItem("dgi_accent", accent);
  }

  setupHeaderClock() {
    const dateEl = document.getElementById("header-date");
    const timeEl = document.getElementById("header-time");
    if (!dateEl || !timeEl) return;
    const refresh = () => {
      const now = new Date();
      dateEl.textContent = new Intl.DateTimeFormat("en-IN", {
        weekday: "short", day: "2-digit", month: "short", year: "numeric", timeZone: "Asia/Kolkata"
      }).format(now);
      timeEl.textContent = new Intl.DateTimeFormat("en-IN", {
        hour: "2-digit", minute: "2-digit", second: "2-digit", hour12: true, timeZone: "Asia/Kolkata"
      }).format(now);
    };
    refresh();
    setInterval(refresh, 1000);
  }

  toggleMobileMenu() {
    const sidebar = document.getElementById("sidebar");
    if (sidebar) sidebar.classList.toggle("mobile-open");
  }

  // --- Data Loading ---
  async loadInitialData() {
    try {
      // 1. Auth Status & Student Info
      const authRes = await fetch("/api/auth/status", { credentials: "same-origin" });
      if (authRes.ok) {
        const authData = await authRes.json();
        this.student = authData.student || { name: authData.username || "Student", roll_no: authData.username || "CS101" };
      }

      // 2. Fetch parallel endpoints
      const [dashRes, myBooksRes, subjectsRes, booksRes, reqsRes] = await Promise.all([
        fetch("/api/student/dashboard", { credentials: "same-origin" }).then(r => r.ok ? r.json() : null),
        fetch("/api/student/my-books", { credentials: "same-origin" }).then(r => r.ok ? r.json() : null),
        fetch("/api/subjects", { credentials: "same-origin" }).then(r => r.ok ? r.json() : []),
        fetch("/api/student/books", { credentials: "same-origin" }).then(r => r.ok ? r.json() : []),
        fetch("/api/student/book-requests", { credentials: "same-origin" }).then(r => r.ok ? r.json() : { requests: [] })
      ]);

      this.dashboardData = dashRes || { stats: {}, activeLoans: [], notifications: [] };
      this.myBooksData = myBooksRes || { activeLoans: [], returnHistory: [] };
      this.subjects = Array.isArray(subjectsRes) ? subjectsRes : (subjectsRes?.subjects || []);
      this.allBooks = Array.isArray(booksRes) ? booksRes : (booksRes?.books || []);
      this.requests = reqsRes?.requests || [];

      // Update student profile displays
      this.renderStudentIdentity();

      // Render Dashboard
      this.renderDashboard();
      this.renderSubjectCards();
      this.renderQuickSubjects();
      this.populateAllSubjectsFilter();
      this.renderIssuedBooks();
      this.renderReturnHistory();
      this.renderBookRequests();
      this.renderNotifications();
      this.renderProfile();
      this.updateBadges();

    } catch (err) {
      console.error("Failed to load student portal data:", err);
      this.showToast("Connection Warning", "Could not refresh all library data from server.", "warning");
    }
  }

  renderStudentIdentity() {
    if (!this.student) return;
    const name = this.student.name || "Student";
    const roll = this.student.roll_no || "";
    const dept = this.student.department || "CSIT";

    const sidebarName = document.getElementById("sidebar-student-name");
    const sidebarRoll = document.getElementById("sidebar-student-roll");
    const sidebarAvatar = document.getElementById("sidebar-student-avatar");
    const dashName = document.getElementById("dash-student-name");
    const dashBranch = document.getElementById("dash-student-branch");

    if (sidebarName) sidebarName.textContent = name;
    if (sidebarRoll) sidebarRoll.textContent = roll;
    if (sidebarAvatar) sidebarAvatar.textContent = name.split(" ").map(w => w[0]).join("").substring(0, 2).toUpperCase() || "ST";
    if (dashName) dashName.textContent = name;
    if (dashBranch) dashBranch.textContent = dept;
  }

  updateBadges() {
    const activeCount = (this.dashboardData?.activeLoans || []).length;
    const notifCount = (this.dashboardData?.notifications || []).length;
    const reqCount = this.requests.filter(r => r.status === "Pending").length;

    const issuedBadge = document.getElementById("nav-issued-count");
    const notifBadge = document.getElementById("nav-notif-count");
    const reqBadge = document.getElementById("nav-requests-count");
    const topbarNotifDot = document.getElementById("topbar-notif-dot");

    if (issuedBadge) {
      issuedBadge.textContent = activeCount;
      issuedBadge.style.display = activeCount > 0 ? "inline-block" : "none";
    }
    if (notifBadge) {
      notifBadge.textContent = notifCount;
      notifBadge.style.display = notifCount > 0 ? "inline-block" : "none";
    }
    if (reqBadge) {
      reqBadge.textContent = reqCount;
      reqBadge.style.display = reqCount > 0 ? "inline-block" : "none";
    }
    if (topbarNotifDot) {
      topbarNotifDot.style.display = notifCount > 0 ? "block" : "none";
    }
  }

  // --- View Switching ---
  switchView(viewName) {
    this.currentView = viewName;
    document.querySelectorAll(".page-view").forEach(el => {
      el.style.display = "none";
      el.classList.remove("active");
    });
    document.querySelectorAll(".sidebar-nav .nav-item").forEach(el => el.classList.remove("active"));

    // Close mobile menu if open
    const sidebar = document.getElementById("sidebar");
    if (sidebar) sidebar.classList.remove("mobile-open");

    const navItem = document.querySelector(`.sidebar-nav .nav-item[data-view="${viewName}"]`);
    if (navItem) navItem.classList.add("active");

    if (viewName === "dashboard") {
      const target = document.getElementById("view-dashboard");
      if (target) { target.style.display = "block"; target.classList.add("active"); }
      this.renderDashboard();
    } else if (viewName === "browse") {
      const target = document.getElementById("view-browse");
      if (target) { target.style.display = "block"; target.classList.add("active"); }
      this.setBrowseMode("all");
    } else if (viewName === "subjects") {
      const target = document.getElementById("view-browse");
      if (target) { target.style.display = "block"; target.classList.add("active"); }
      this.setBrowseMode("subjects");
      this.backToSubjects();
    } else if (viewName === "issued") {
      const target = document.getElementById("view-issued");
      if (target) { target.style.display = "block"; target.classList.add("active"); }
      this.renderIssuedBooks();
    } else if (viewName === "returns") {
      const target = document.getElementById("view-returns");
      if (target) { target.style.display = "block"; target.classList.add("active"); }
      this.renderReturnHistory();
    } else if (viewName === "requests") {
      const target = document.getElementById("view-requests");
      if (target) { target.style.display = "block"; target.classList.add("active"); }
      this.renderBookRequests();
    } else if (viewName === "notifications") {
      const target = document.getElementById("view-notifications");
      if (target) { target.style.display = "block"; target.classList.add("active"); }
      this.renderNotifications();
    } else if (viewName === "profile") {
      const target = document.getElementById("view-profile");
      if (target) { target.style.display = "block"; target.classList.add("active"); }
      this.renderProfile();
    }
  }

  // --- View 1: Dashboard Rendering ---
  renderDashboard() {
    const stats = this.dashboardData?.stats || this.dashboardData?.kpis || {};
    const availBooksEl = document.getElementById("kpi-available-books");
    const issuedBooksEl = document.getElementById("kpi-currently-issued");
    const pendingReturnsEl = document.getElementById("kpi-pending-returns");
    const overdueBooksEl = document.getElementById("kpi-overdue-books");

    if (availBooksEl) availBooksEl.textContent = stats.totalAvailableBooks ?? stats.total_available_books ?? this.allBooks.reduce((sum, b) => sum + Number(b.available_copies ?? b.available ?? 0), 0);
    if (issuedBooksEl) issuedBooksEl.textContent = stats.currentlyIssued ?? stats.books_currently_issued ?? (this.dashboardData?.activeLoans?.length || 0);
    if (pendingReturnsEl) pendingReturnsEl.textContent = stats.pendingReturns ?? stats.pending_returns ?? (this.dashboardData?.activeLoans?.length || 0);
    if (overdueBooksEl) overdueBooksEl.textContent = stats.overdueBooks ?? stats.overdue_books ?? (this.dashboardData?.activeLoans?.filter(l => l.isOverdue)?.length || 0);

    // Active Loans Table on Dashboard
    const activeLoans = this.dashboardData?.activeLoans || this.dashboardData?.currently_issued || [];
    const tbody = document.getElementById("dash-active-loans-tbody");
    if (tbody) {
      if (activeLoans.length === 0) {
        tbody.innerHTML = `<tr><td colspan="6" style="text-align:center; padding:30px; color:var(--text-muted);">
          <div style="font-size:24px; margin-bottom:6px;">✨</div>
          <div>You have no active book loans at present.</div>
          <button class="btn btn-primary btn-sm" style="margin-top:10px;" onclick="window.studentPortal.switchView('browse')">Browse Library Catalog</button>
        </td></tr>`;
      } else {
        tbody.innerHTML = activeLoans.map(loan => {
          const isOverdue = Boolean(loan.isOverdue || (loan.daysRemaining != null && loan.daysRemaining < 0));
          const daysText = isOverdue
            ? `<span class="countdown-pill countdown-urgent">⚠️ Overdue (${Math.abs(loan.daysRemaining || 0)}d)</span>`
            : (loan.daysRemaining <= 2
              ? `<span class="countdown-pill countdown-warning">⏳ Due in ${loan.daysRemaining}d</span>`
              : `<span class="countdown-pill countdown-ok">✓ ${loan.daysRemaining} days left</span>`);

          return `
            <tr>
              <td>
                <div style="font-weight:700; color:var(--text-primary);">${this.escapeHTML(loan.book_title || "Untitled")}</div>
                <div style="font-size:11px; color:var(--text-muted);">${loan.isbn ? `ISBN: ${this.escapeHTML(loan.isbn)}` : `ID: #${loan.book_id}`}</div>
              </td>
              <td>${this.escapeHTML(loan.author || "—")}</td>
              <td>${this.escapeHTML(loan.issue_date || "—")}</td>
              <td><strong>${this.escapeHTML(loan.due_date || "—")}</strong></td>
              <td>${daysText}</td>
              <td>
                <button class="btn btn-secondary btn-sm" onclick="window.studentPortal.openBookModal(${loan.book_id})">View Book</button>
              </td>
            </tr>
          `;
        }).join("");
      }
    }
  }

  renderQuickSubjects() {
    const container = document.getElementById("dash-quick-subjects");
    if (!container) return;
    const showcase = this.subjects.slice(0, 6);
    container.innerHTML = showcase.map(s => `
      <div class="card subject-card-hover" style="padding:16px; display:flex; align-items:center; gap:14px; background:var(--bg-card); border:1px solid var(--border-color); border-radius:var(--radius-md); cursor:pointer;"
           onclick="window.studentPortal.switchView('browse'); window.studentPortal.openSubjectDetail('${this.escapeHTML(s.subject_id)}')">
        <div style="font-size:28px; width:48px; height:48px; border-radius:12px; background:rgba(81,0,39,0.15); display:flex; align-items:center; justify-content:center; flex-shrink:0;">
          ${s.icon || "📚"}
        </div>
        <div style="overflow:hidden;">
          <div style="font-size:11px; font-weight:700; color:var(--accent-primary);">${this.escapeHTML(s.subject_code || "GEN")}</div>
          <div style="font-size:14px; font-weight:800; color:var(--text-primary); white-space:nowrap; overflow:hidden; text-overflow:ellipsis;">${this.escapeHTML(s.subject_name)}</div>
          <div style="font-size:12px; color:var(--text-muted);">${s.total_books || 0} Titles available</div>
        </div>
      </div>
    `).join("");
  }

  // --- View 2 & 3: Subject-Wise Catalog ---
  setBrowseMode(mode) {
    this.browseMode = mode;
    const subjectsCont = document.getElementById("student-subjects-container");
    const detailCont = document.getElementById("student-subject-detail-container");
    const allBooksCont = document.getElementById("student-all-books-container");
    const btnSubjects = document.getElementById("btn-mode-subjects");
    const btnAll = document.getElementById("btn-mode-all");
    const pageTitle = document.getElementById("browse-page-title");

    if (mode === "subjects") {
      if (this.activeSubjectId) {
        if (subjectsCont) subjectsCont.style.display = "none";
        if (detailCont) detailCont.style.display = "block";
      } else {
        if (subjectsCont) subjectsCont.style.display = "block";
        if (detailCont) detailCont.style.display = "none";
      }
      if (allBooksCont) allBooksCont.style.display = "none";
      if (btnSubjects) btnSubjects.className = "btn btn-primary btn-sm";
      if (btnAll) btnAll.className = "btn btn-secondary btn-sm";
      if (pageTitle) pageTitle.textContent = "Subject-Wise Book Catalog";
      this.renderSubjectCards();
    } else {
      if (subjectsCont) subjectsCont.style.display = "none";
      if (detailCont) detailCont.style.display = "none";
      if (allBooksCont) allBooksCont.style.display = "block";
      if (btnSubjects) btnSubjects.className = "btn btn-secondary btn-sm";
      if (btnAll) btnAll.className = "btn btn-primary btn-sm";
      if (pageTitle) pageTitle.textContent = "All Books Catalog";
      this.renderAllBooksTable();
    }
  }

  renderSubjectCards() {
    const grid = document.getElementById("student-subjects-grid");
    if (!grid) return;

    const countEl = document.getElementById("student-kpi-subjects");
    if (countEl) countEl.textContent = this.subjects.length;

    const search = (document.getElementById("student-subject-search")?.value || "").toLowerCase().trim();
    let filtered = this.subjects;
    if (search) {
      filtered = filtered.filter(s =>
        String(s.subject_name || "").toLowerCase().includes(search) ||
        String(s.subject_code || "").toLowerCase().includes(search) ||
        String(s.description || "").toLowerCase().includes(search)
      );
    }

    if (filtered.length === 0) {
      grid.innerHTML = `<div style="grid-column:1/-1; text-align:center; padding:40px; color:var(--text-muted); background:var(--bg-card); border-radius:var(--radius-md);">
        <div style="font-size:32px; margin-bottom:8px;">🔍</div>
        <div>No academic subjects matched "${this.escapeHTML(search)}".</div>
      </div>`;
      return;
    }

    grid.innerHTML = filtered.map(s => {
      const booksInSub = this.allBooks.filter(b => this.matchId(b.subject_id, s.subject_id));
      const totalTitles = booksInSub.length;
      const availCopies = booksInSub.reduce((acc, b) => acc + Number(b.available_copies ?? b.available ?? 0), 0);
      const totalCopies = booksInSub.reduce((acc, b) => acc + Number(b.total_copies ?? b.quantity ?? 0), 0);

      return `
        <div class="card subject-card-hover" style="border-radius:var(--radius-md); padding:20px; display:flex; flex-direction:column; justify-content:space-between; background:var(--bg-card); border:1px solid var(--border-color); cursor:pointer;"
             onclick="window.studentPortal.openSubjectDetail('${this.escapeHTML(s.subject_id)}')">
          <div>
            <div style="display:flex; justify-content:space-between; align-items:flex-start; margin-bottom:12px;">
              <div style="font-size:32px; width:52px; height:52px; border-radius:12px; background:rgba(81,0,39,0.15); display:flex; align-items:center; justify-content:center; border:1px solid var(--border-color);">
                ${s.icon || "📚"}
              </div>
              <span class="badge badge-accent" style="font-size:11px; font-weight:700;">${this.escapeHTML(s.subject_code || "GEN")}</span>
            </div>

            <h3 style="margin:0 0 6px; font-size:17px; font-weight:800; color:var(--text-primary); line-height:1.3;">
              ${this.escapeHTML(s.subject_name)}
            </h3>

            <p style="margin:0 0 16px; font-size:12px; color:var(--text-secondary); line-height:1.4; display:-webkit-box; -webkit-line-clamp:2; -webkit-box-orient:vertical; overflow:hidden; min-height:34px;">
              ${this.escapeHTML(s.description || "Core textbooks and engineering reference resources.")}
            </p>
          </div>

          <div style="border-top:1px solid var(--border-color); padding-top:14px;">
            <div style="display:grid; grid-template-columns:1fr 1fr; gap:8px; margin-bottom:12px; font-size:12px;">
              <div style="background:rgba(0,0,0,0.15); padding:8px 10px; border-radius:6px;">
                <div style="color:var(--text-muted); font-size:11px;">Total Titles</div>
                <div style="font-weight:800; font-size:14px; color:var(--text-primary);">${totalTitles} Books</div>
              </div>
              <div style="background:rgba(0,0,0,0.15); padding:8px 10px; border-radius:6px;">
                <div style="color:var(--text-muted); font-size:11px;">Available</div>
                <div style="font-weight:800; font-size:14px; color:${availCopies > 0 ? 'var(--success)' : 'var(--danger)'};">${availCopies} / ${totalCopies}</div>
              </div>
            </div>
            <button class="btn btn-secondary btn-sm" style="width:100%; justify-content:center; font-weight:700; pointer-events:none;">
              View Subject Books →
            </button>
          </div>
        </div>
      `;
    }).join("");
  }

  openSubjectDetail(subjectId) {
    const subject = this.subjects.find(s => this.matchId(s.subject_id, subjectId));
    if (!subject) return;

    this.activeSubjectId = subject.subject_id;
    this.browseMode = "subjects";

    const subjectsCont = document.getElementById("student-subjects-container");
    const detailCont = document.getElementById("student-subject-detail-container");
    const allBooksCont = document.getElementById("student-all-books-container");

    if (subjectsCont) subjectsCont.style.display = "none";
    if (allBooksCont) allBooksCont.style.display = "none";
    if (detailCont) detailCont.style.display = "block";

    // Populate hero banner
    const nameEl = document.getElementById("student-subject-detail-name");
    const codeEl = document.getElementById("student-subject-detail-code");
    const descEl = document.getElementById("student-subject-detail-desc");
    const iconEl = document.getElementById("student-subject-detail-icon");
    const breadcrumb = document.getElementById("student-subject-breadcrumb");

    if (nameEl) nameEl.textContent = subject.subject_name;
    if (breadcrumb) breadcrumb.textContent = subject.subject_name;
    if (codeEl) codeEl.textContent = subject.subject_code || "GEN";
    if (descEl) descEl.textContent = subject.description || "Core textbooks and engineering reference resources.";
    if (iconEl) iconEl.textContent = subject.icon || "📚";

    // Populate author dropdown for this subject
    const books = this.allBooks.filter(b => this.matchId(b.subject_id, subject.subject_id));
    const authorSelect = document.getElementById("student-subject-author-select");
    if (authorSelect) {
      const authors = [...new Set(books.map(b => (b.author || "").trim()).filter(Boolean))].sort();
      authorSelect.innerHTML = `<option value="all">All Authors (${authors.length})</option>` +
        authors.map(a => `<option value="${this.escapeHTML(a)}">${this.escapeHTML(a)}</option>`).join("");
    }

    // Reset filters
    const searchInput = document.getElementById("student-subject-book-search");
    if (searchInput) searchInput.value = "";
    const availSelect = document.getElementById("student-subject-avail-select");
    if (availSelect) availSelect.value = "all";
    const sortSelect = document.getElementById("student-subject-sort-select");
    if (sortSelect) sortSelect.value = "title_asc";

    this.renderSubjectBooks();
  }

  backToSubjects() {
    this.activeSubjectId = null;
    const subjectsCont = document.getElementById("student-subjects-container");
    const detailCont = document.getElementById("student-subject-detail-container");
    if (subjectsCont) subjectsCont.style.display = "block";
    if (detailCont) detailCont.style.display = "none";
    this.renderSubjectCards();
  }

  renderSubjectBooks() {
    if (!this.activeSubjectId) return;
    const grid = document.getElementById("student-subject-books-grid");
    if (!grid) return;

    let books = this.allBooks.filter(b => this.matchId(b.subject_id, this.activeSubjectId));

    const searchVal = (document.getElementById("student-subject-book-search")?.value || "").toLowerCase().trim();
    const authorVal = document.getElementById("student-subject-author-select")?.value || "all";
    const availVal = document.getElementById("student-subject-avail-select")?.value || "all";
    const sortVal = document.getElementById("student-subject-sort-select")?.value || "title_asc";

    if (searchVal) {
      books = books.filter(b =>
        String(b.book_name || b.title || "").toLowerCase().includes(searchVal) ||
        String(b.author || "").toLowerCase().includes(searchVal) ||
        String(b.publisher || "").toLowerCase().includes(searchVal) ||
        String(b.isbn || "").toLowerCase().includes(searchVal) ||
        String(b.book_id || b.id || "").toLowerCase().includes(searchVal)
      );
    }

    if (authorVal !== "all") {
      books = books.filter(b => String(b.author || "").trim().toLowerCase() === authorVal.toLowerCase());
    }

    if (availVal === "available") {
      books = books.filter(b => Number(b.available_copies ?? b.available ?? 0) > 0);
    } else if (availVal === "out_of_stock") {
      books = books.filter(b => Number(b.available_copies ?? b.available ?? 0) === 0);
    }

    books.sort((a, b) => {
      const titleA = String(a.book_name || a.title || "").toLowerCase();
      const titleB = String(b.book_name || b.title || "").toLowerCase();
      const availA = Number(a.available_copies ?? a.available ?? 0);
      const availB = Number(b.available_copies ?? b.available ?? 0);

      if (sortVal === "title_desc") return titleB.localeCompare(titleA);
      if (sortVal === "avail_desc") return availB - availA;
      return titleA.localeCompare(titleB);
    });

    if (books.length === 0) {
      grid.innerHTML = `<div style="grid-column:1/-1; text-align:center; padding:40px; color:var(--text-muted); background:var(--bg-card); border-radius:var(--radius-md);">
        <div style="font-size:32px; margin-bottom:8px;">📚</div>
        <div>No books matched your criteria in this subject domain.</div>
      </div>`;
      return;
    }

    grid.innerHTML = books.map(b => {
      const bookId = b.book_id || b.id;
      const title = b.book_name || b.title || "Untitled Book";
      const available = Number(b.available_copies ?? b.available ?? 0);
      const total = Number(b.total_copies ?? b.quantity ?? 0);
      const year = b.publication_year || b.published_year || "";

      return `
        <div class="card" style="padding:18px; display:flex; flex-direction:column; justify-content:space-between; background:var(--bg-card); border:1px solid var(--border-color); border-radius:var(--radius-md);">
          <div>
            <div style="display:flex; gap:12px; margin-bottom:12px;">
              <div style="width:48px; height:64px; border-radius:8px; background:linear-gradient(135deg, ${this.safeBookColor(b.color1)}, ${this.safeBookColor(b.color2)}); display:flex; align-items:center; justify-content:center; font-size:22px; flex-shrink:0;">
                📖
              </div>
              <div style="overflow:hidden;">
                <div style="display:flex; align-items:center; gap:6px; margin-bottom:3px;">
                  <code style="font-size:11px; font-weight:700; color:var(--accent-primary);">${this.escapeHTML(bookId)}</code>
                </div>
                <div style="font-size:15px; font-weight:800; color:var(--text-primary); margin-bottom:4px; line-height:1.3;">${this.escapeHTML(title)}</div>
                <div style="font-size:12px; color:var(--text-secondary);">By <strong>${this.escapeHTML(b.author || "Unknown")}</strong></div>
                ${year ? `<div style="font-size:11px; color:var(--text-muted);">Year: ${this.escapeHTML(year)}</div>` : ""}
              </div>
            </div>

            <div style="display:flex; justify-content:space-between; align-items:center; font-size:12px; margin-bottom:12px; padding:6px 10px; background:rgba(0,0,0,0.15); border-radius:6px;">
              <div>
                <span style="color:var(--text-muted);">ISBN:</span>
                <code>${this.escapeHTML(b.isbn || "—")}</code>
              </div>
              <div>
                ${available > 0 
                  ? `<span class="badge badge-success">${available} / ${total} Copies</span>` 
                  : `<span class="badge badge-danger">Out of Stock (0/${total})</span>`}
              </div>
            </div>
          </div>

          <div style="display:flex; gap:8px;">
            <button class="btn btn-secondary btn-sm" style="flex:1;" onclick="window.studentPortal.openBookModal('${this.escapeHTML(bookId)}')">
              Details
            </button>
            <button class="btn btn-primary btn-sm" style="flex:1;" onclick="window.studentPortal.quickRequestBook('${this.escapeHTML(bookId)}')">
              ${available > 0 ? "Request" : "Reserve"}
            </button>
          </div>
        </div>
      `;
    }).join("");
  }

  // --- Sub-View C: All Books Table ---
  populateAllSubjectsFilter() {
    const select = document.getElementById("student-all-subject-filter");
    if (!select) return;
    select.innerHTML = `<option value="all">All Subjects (${this.subjects.length})</option>` +
      this.subjects.map(s => `<option value="${s.subject_id}">${this.escapeHTML(s.subject_name)}</option>`).join("");
  }

  renderAllBooksTable() {
    const tbody = document.getElementById("student-all-books-tbody");
    if (!tbody) return;

    let books = [...this.allBooks];
    const search = (document.getElementById("student-all-book-search")?.value || "").toLowerCase().trim();
    const subVal = document.getElementById("student-all-subject-filter")?.value || "all";
    const availVal = document.getElementById("student-all-avail-filter")?.value || "all";

    if (search) {
      books = books.filter(b =>
        String(b.book_name || b.title || "").toLowerCase().includes(search) ||
        String(b.author || "").toLowerCase().includes(search) ||
        String(b.book_id || b.id || "").toLowerCase().includes(search) ||
        String(b.isbn || "").toLowerCase().includes(search)
      );
    }

    if (subVal !== "all") {
      books = books.filter(b => this.matchId(b.subject_id, subVal));
    }

    if (availVal === "available") {
      books = books.filter(b => Number(b.available_copies ?? b.available ?? 0) > 0);
    } else if (availVal === "out_of_stock") {
      books = books.filter(b => Number(b.available_copies ?? b.available ?? 0) === 0);
    }

    if (books.length === 0) {
      tbody.innerHTML = `<tr><td colspan="7" style="text-align:center; padding:30px; color:var(--text-muted);">No books found matching search filters.</td></tr>`;
      return;
    }

    tbody.innerHTML = books.map(b => {
      const bookId = b.book_id || b.id;
      const title = b.book_name || b.title || "Untitled";
      const sub = this.subjects.find(s => this.matchId(s.subject_id, b.subject_id));
      const subName = sub ? sub.subject_name : (b.category || "General");
      const available = Number(b.available_copies ?? b.available ?? 0);
      const total = Number(b.total_copies ?? b.quantity ?? 0);

      return `
        <tr>
          <td>
            <div style="display:flex; align-items:center; gap:6px;">
              <code style="font-size:11px; font-weight:700; color:var(--accent-primary);">${this.escapeHTML(bookId)}</code>
            </div>
            <div style="font-weight:700; color:var(--text-primary); margin-top:2px;">${this.escapeHTML(title)}</div>
            <div style="font-size:11px; color:var(--text-muted);">${b.publisher ? `Publisher: ${this.escapeHTML(b.publisher)}` : ""}</div>
          </td>
          <td><span class="badge badge-accent">${this.escapeHTML(subName)}</span></td>
          <td>${this.escapeHTML(b.author || "—")}</td>
          <td><code>${this.escapeHTML(b.isbn || "—")}</code></td>
          <td><strong>${available}</strong> / ${total}</td>
          <td>
            ${available > 0
              ? `<span class="badge badge-success">Available</span>`
              : `<span class="badge badge-danger">Out of Stock</span>`}
          </td>
          <td>
            <button class="btn btn-primary btn-sm" onclick="window.studentPortal.openBookModal('${this.escapeHTML(bookId)}')">View & Request</button>
          </td>
        </tr>
      `;
    }).join("");
  }

  // --- Modal: Book Details & Request ---
  openBookModal(bookId) {
    const book = this.allBooks.find(b => this.matchId(b.book_id || b.id, bookId));
    if (!book) return;

    this.modalBookId = book.book_id || book.id;
    const subject = this.subjects.find(s => this.matchId(s.subject_id, book.subject_id));
    const title = book.book_name || book.title || "Untitled Book";
    const available = Number(book.available_copies ?? book.available ?? 0);
    const total = Number(book.total_copies ?? book.quantity ?? 0);

    const titleEl = document.getElementById("modal-book-title");
    const authorEl = document.getElementById("modal-book-author");
    const subjectEl = document.getElementById("modal-book-subject");
    const codeEl = document.getElementById("modal-book-code");
    const publisherEl = document.getElementById("modal-book-publisher");
    const yearEl = document.getElementById("modal-book-year");
    const isbnEl = document.getElementById("modal-book-isbn");
    const availCopiesEl = document.getElementById("modal-book-avail-copies");
    const totalCopiesEl = document.getElementById("modal-book-total-copies");
    const descEl = document.getElementById("modal-book-desc");
    const availBadge = document.getElementById("modal-book-avail-badge");
    const stockAlert = document.getElementById("modal-book-stock-alert");
    const reqBtn = document.getElementById("modal-book-request-btn");

    if (titleEl) titleEl.textContent = title;
    if (authorEl) authorEl.textContent = book.author || "Unknown";
    if (subjectEl) subjectEl.textContent = subject ? subject.subject_name : (book.category || "General");
    if (codeEl) codeEl.textContent = subject?.subject_code || "GEN";
    if (publisherEl) publisherEl.textContent = book.publisher || "DGI Academic Press";
    if (yearEl) yearEl.textContent = book.publication_year || book.published_year || "2024";
    if (isbnEl) isbnEl.textContent = book.isbn || "978-DGI-LIB";
    if (availCopiesEl) {
      availCopiesEl.textContent = available;
      availCopiesEl.style.color = available > 0 ? "#059669" : "#dc2626";
    }
    if (totalCopiesEl) totalCopiesEl.textContent = total;
    if (descEl) descEl.textContent = book.description || `Authoritative textbook for ${subject ? subject.subject_name : "engineering curriculum"} at Dronacharya Group of Institutions.`;

    if (availBadge) {
      availBadge.textContent = available > 0 ? "Available Now" : "Out of Stock";
      availBadge.className = `badge ${available > 0 ? "badge-success" : "badge-danger"}`;
    }

    if (stockAlert) {
      stockAlert.style.display = available > 0 ? "none" : "block";
    }

    if (reqBtn) {
      reqBtn.textContent = available > 0 ? "📥 Request Book" : "📑 Place Reservation";
    }

    document.getElementById("modal-book-details")?.classList.add("active");
  }

  async quickRequestBook(bookId) {
    this.modalBookId = bookId;
    await this.requestCurrentModalBook();
  }

  async requestCurrentModalBook() {
    if (!this.modalBookId) return;
    try {
      const res = await fetch("/api/student/book-requests", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "same-origin",
        body: JSON.stringify({ book_id: this.modalBookId, notes: "Requested via student portal." })
      });
      const data = await res.json();
      if (res.ok && data.success) {
        this.showToast("Request Placed", `Your book request (${data.request_id || "created"}) was registered. Library staff will review it.`, "success");
        this.closeModal("modal-book-details");
        await this.reloadBookRequests();
      } else {
        this.showToast("Request Failed", data.error || "Failed to submit request.", "danger");
      }
    } catch (err) {
      this.showToast("Request Failed", err.message, "danger");
    }
  }

  async reloadBookRequests() {
    try {
      const reqsRes = await fetch("/api/student/book-requests", { credentials: "same-origin" }).then(r => r.json());
      this.requests = reqsRes?.requests || [];
      this.renderBookRequests();
      this.updateBadges();
    } catch (_) {}
  }

  // --- View 4: My Issued Books ---
  renderIssuedBooks() {
    const tbody = document.getElementById("issued-books-tbody");
    if (!tbody) return;

    const activeLoans = this.myBooksData?.activeLoans || this.dashboardData?.activeLoans || [];
    if (activeLoans.length === 0) {
      tbody.innerHTML = `<tr><td colspan="6" style="text-align:center; padding:30px; color:var(--text-muted);">
        You do not currently have any issued books.
      </td></tr>`;
      return;
    }

    tbody.innerHTML = activeLoans.map(loan => {
      const isOverdue = Boolean(loan.isOverdue || (loan.daysRemaining != null && loan.daysRemaining < 0));
      const fine = Number(loan.fine_amount || 0);

      const daysPill = isOverdue
        ? `<span class="countdown-pill countdown-urgent">⚠️ Overdue by ${Math.abs(loan.daysRemaining || 0)} days</span>`
        : `<span class="countdown-pill countdown-ok">✓ ${loan.daysRemaining} days remaining</span>`;

      const fineBadge = fine > 0
        ? `<span class="badge badge-danger">₹${fine} Due</span>`
        : `<span class="badge badge-success">₹0 Clean</span>`;

      const bookId = loan.book_id || "";

      return `
        <tr>
          <td>
            <div style="font-weight:700; color:var(--text-primary);">${this.escapeHTML(loan.book_title || "Untitled")}</div>
            <div style="font-size:11px; color:var(--text-muted);">
              ${bookId ? `<code>${this.escapeHTML(bookId)}</code> &bull; ` : ""}By ${this.escapeHTML(loan.author || "—")} | ISBN: ${this.escapeHTML(loan.isbn || "—")}
            </div>
          </td>
          <td>${this.escapeHTML(loan.issue_date || "—")}</td>
          <td><strong>${this.escapeHTML(loan.due_date || "—")}</strong></td>
          <td>${daysPill}</td>
          <td>${fineBadge}</td>
          <td>
            <button class="btn btn-secondary btn-sm" onclick="window.studentPortal.openBookModal('${this.escapeHTML(bookId)}')">Book Info</button>
          </td>
        </tr>
      `;
    }).join("");
  }

  // --- View 5: Return History ---
  renderReturnHistory() {
    const tbody = document.getElementById("return-history-tbody");
    if (!tbody) return;

    const history = this.myBooksData?.returnHistory || [];
    if (history.length === 0) {
      tbody.innerHTML = `<tr><td colspan="6" style="text-align:center; padding:30px; color:var(--text-muted);">
        No completed return records found in library history.
      </td></tr>`;
      return;
    }

    tbody.innerHTML = history.map(item => `
      <tr>
        <td>
          <div style="font-weight:700; color:var(--text-primary);">${this.escapeHTML(item.book_title || "Untitled")}</div>
          <div style="font-size:11px; color:var(--text-muted);">${item.isbn ? `ISBN: ${this.escapeHTML(item.isbn)}` : `ID: #${item.book_id}`}</div>
        </td>
        <td>${this.escapeHTML(item.issue_date || "—")}</td>
        <td><strong>${this.escapeHTML(item.return_date || "—")}</strong></td>
        <td>${this.escapeHTML(item.duration || "14 days")}</td>
        <td>${Number(item.fine_paid || 0) > 0 ? `₹${item.fine_paid}` : "₹0 (On Time)"}</td>
        <td><span class="badge badge-success">Returned</span></td>
      </tr>
    `).join("");
  }

  // --- View 6: Book Requests ---
  renderBookRequests() {
    const tbody = document.getElementById("book-requests-tbody");
    if (!tbody) return;

    if (this.requests.length === 0) {
      tbody.innerHTML = `<tr><td colspan="6" style="text-align:center; padding:30px; color:var(--text-muted);">
        No book requests placed yet.
      </td></tr>`;
      return;
    }

    tbody.innerHTML = this.requests.map(req => {
      const isPending = req.status === "Pending";
      const statusBadge = isPending
        ? `<span class="badge badge-warning">Pending Review</span>`
        : (req.status === "Approved"
          ? `<span class="badge badge-success">Approved / Ready</span>`
          : `<span class="badge badge-danger">${this.escapeHTML(req.status)}</span>`);

      const reqKey = req.request_id || req.id;

      return `
        <tr>
          <td>
            <div style="font-weight:700; color:var(--text-primary);">${this.escapeHTML(req.book_title || "Untitled Book")}</div>
            <div style="font-size:11px; color:var(--text-muted);">Req ID: <code>${this.escapeHTML(reqKey)}</code></div>
          </td>
          <td>${this.escapeHTML(req.subject_name || "General")}</td>
          <td>${this.escapeHTML(req.request_date || "—")}</td>
          <td><span style="font-size:12px; color:var(--text-secondary);">${this.escapeHTML(req.notes || "None")}</span></td>
          <td>${statusBadge}</td>
          <td>
            ${isPending ? `<button class="btn btn-danger btn-sm" onclick="window.studentPortal.cancelRequest('${this.escapeHTML(reqKey)}')">Cancel</button>` : "—"}
          </td>
        </tr>
      `;
    }).join("");
  }

  openNewRequestModal() {
    const select = document.getElementById("request-select-book");
    if (select) {
      select.innerHTML = `<option value="">-- Choose a Title from Catalog --</option>` +
        this.allBooks.map(b => `
          <option value="${b.book_id || b.id}">
            ${this.escapeHTML(b.book_name || b.title)} (by ${this.escapeHTML(b.author)})
          </option>
        `).join("");
    }
    document.getElementById("modal-make-request")?.classList.add("active");
  }

  async submitBookRequest(e) {
    e.preventDefault();
    const bookId = document.getElementById("request-select-book")?.value;
    const notes = document.getElementById("request-notes")?.value.trim() || "";

    if (!bookId) {
      this.showToast("Selection Required", "Please select a book from the list.", "danger");
      return;
    }

    try {
      const res = await fetch("/api/student/book-requests", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "same-origin",
        body: JSON.stringify({ book_id: bookId, notes: notes })
      });
      const data = await res.json();
      if (res.ok && data.success) {
        this.showToast("Request Submitted", `Your request (${data.request_id || "created"}) has been placed into the review queue.`, "success");
        this.closeModal("modal-make-request");
        document.getElementById("form-book-request")?.reset();
        await this.reloadBookRequests();
      } else {
        this.showToast("Request Failed", data.error || "Request submission failed.", "danger");
      }
    } catch (err) {
      this.showToast("Error", err.message, "danger");
    }
  }

  async cancelRequest(requestId) {
    if (!confirm(`Are you sure you want to cancel book request '${requestId}'?`)) return;
    try {
      const res = await fetch(`/api/student/book-requests/${encodeURIComponent(requestId)}`, {
        method: "DELETE",
        credentials: "same-origin"
      });
      const data = await res.json();
      if (res.ok && data.success) {
        this.showToast("Cancelled", "Book request was cancelled.", "info");
        await this.reloadBookRequests();
      } else {
        this.showToast("Cancellation Failed", data.error || "Failed to cancel request.", "danger");
      }
    } catch (err) {
      this.showToast("Error", err.message, "danger");
    }
  }

  // --- View 7: Notifications ---
  renderNotifications() {
    const container = document.getElementById("notifications-list");
    if (!container) return;

    const notifs = this.dashboardData?.notifications || [];
    if (notifs.length === 0) {
      container.innerHTML = `<div style="text-align:center; padding:30px; color:var(--text-muted);">
        <div style="font-size:28px; margin-bottom:8px;">🔔</div>
        <div>No unread notifications or circulation alerts.</div>
      </div>`;
      return;
    }

    container.innerHTML = notifs.map(n => `
      <div style="display:flex; gap:14px; padding:16px; background:rgba(0,0,0,0.15); border:1px solid var(--border-color); border-radius:10px; align-items:flex-start;">
        <div style="font-size:24px; line-height:1;">${n.type === "overdue" ? "⚠️" : (n.type === "due_soon" ? "⏳" : "📢")}</div>
        <div style="flex:1;">
          <div style="display:flex; justify-content:space-between; margin-bottom:4px;">
            <strong style="color:var(--text-primary);">${this.escapeHTML(n.title || "Notification")}</strong>
            <span style="font-size:11px; color:var(--text-muted);">${this.escapeHTML(n.date || "Today")}</span>
          </div>
          <p style="margin:0; font-size:13px; color:var(--text-secondary); line-height:1.4;">${this.escapeHTML(n.message)}</p>
        </div>
      </div>
    `).join("");
  }

  // --- View 8: Profile ---
  renderProfile() {
    if (!this.student) return;
    const s = this.student;

    const nameEl = document.getElementById("profile-name");
    const rollEl = document.getElementById("profile-roll");
    const deptEl = document.getElementById("profile-dept");
    const emailEl = document.getElementById("profile-email");
    const phoneEl = document.getElementById("profile-phone");
    const semEl = document.getElementById("profile-semester");
    const activeEl = document.getElementById("profile-active-loans");
    const totalEl = document.getElementById("profile-total-borrowed");
    const avatarEl = document.getElementById("profile-avatar");

    if (nameEl) nameEl.textContent = s.name || "Student";
    if (rollEl) rollEl.textContent = s.roll_no || "";
    if (deptEl) deptEl.textContent = `Department of ${s.department || "Computer Science & Information Technology"}`;
    if (emailEl) emailEl.textContent = s.email || "student@dronacharya.info";
    if (phoneEl) phoneEl.textContent = s.phone || "—";
    if (semEl) semEl.textContent = s.semester ? `Semester ${s.semester}` : "Semester 4";
    if (avatarEl) avatarEl.textContent = (s.name || "ST").split(" ").map(w => w[0]).join("").substring(0, 2).toUpperCase();

    const activeCount = (this.dashboardData?.activeLoans || []).length;
    const historyCount = (this.myBooksData?.returnHistory || []).length;
    if (activeEl) activeEl.textContent = activeCount;
    if (totalEl) totalEl.textContent = activeCount + historyCount;
  }

  // --- UI Helpers & Modals ---
  closeModal(modalId) {
    document.getElementById(modalId)?.classList.remove("active");
  }

  showToast(title, message, type = "info") {
    const container = document.getElementById("toast-container");
    if (!container) return;

    const toast = document.createElement("div");
    toast.className = `toast toast-${type}`;
    toast.style.cssText = `
      background: var(--bg-card);
      border: 1px solid var(--border-color);
      border-left: 4px solid ${type === "success" ? "var(--success)" : (type === "danger" ? "var(--danger)" : "var(--accent-primary)")};
      border-radius: var(--radius-sm);
      padding: 12px 16px;
      box-shadow: 0 8px 24px rgba(0,0,0,0.35);
      color: var(--text-primary);
      min-width: 260px;
      max-width: 360px;
      animation: fadeIn 0.3s ease;
    `;

    toast.innerHTML = `
      <div style="font-weight:700; font-size:13px; margin-bottom:2px;">${this.escapeHTML(title)}</div>
      <div style="font-size:12px; color:var(--text-secondary); line-height:1.3;">${this.escapeHTML(message)}</div>
    `;

    container.appendChild(toast);
    setTimeout(() => {
      toast.style.opacity = "0";
      toast.style.transition = "opacity 0.3s";
      setTimeout(() => toast.remove(), 300);
    }, 3500);
  }

  async logout() {
    try {
      await fetch("/api/auth/logout", { method: "POST", credentials: "same-origin" });
    } catch (_) {}
    sessionStorage.removeItem("dgi_student_session");
    localStorage.removeItem("dgi_student_session");
    window.location.replace("login.html?role=student");
  }
}

// Instantiate on DOM load
window.addEventListener("DOMContentLoaded", () => {
  window.studentPortal = new StudentPortal();
});
