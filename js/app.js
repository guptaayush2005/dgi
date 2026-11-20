/**
 * DGI LMS - Master Application Controller
 * Handles Navigation, Reactive Views, Forms, Modals, and External Triggers
 */

class DGIApp {
  constructor() {
    this.currentView = "dashboard";
    this.catalogMode = "subjects";
    this.activeSubjectId = null;
    this.pendingDeleteSubjectId = null;
    this.activeAlertTab = "overdue"; // 'overdue' | 'dueSoon'
    this.selectedBookForIssue = null;
    this.selectedStudentForIssue = null;
    this.existingStudentMatchId = null;
    this.issueStudentMode = "existing"; // 'existing' | 'new'
    this.inlineExistingStudentId = null;
    this.issueDraftRestored = false;
    this.editingMessageId = null;
    this.messageHistoryPage = 1;
    this.booksCurrentPage = 1;
    this.booksPageSize = 10;
    this.adminBookRequests = [];

    this.init();
    const adminName = document.getElementById("admin-display-name");
    if (adminName && window.adminDisplayName) adminName.textContent = window.adminDisplayName;
  }

  init() {
    this.setupTheme();
    this.setupHeaderClock();
    this.setupAdminAccountMenu();
    this.setupNavigation();
    this.setupEventListeners();
    this.renderCurrentView();
    this.updateNotificationBadge();
    this.loadAdminBookRequests();
    window.setInterval(() => {
      if (this.currentView === "reports") this.renderMessageHistory();
    }, 30000);

    // Check startup overdue alert
    setTimeout(() => {
      this.checkStartupAlerts();
    }, 600);
  }

  escapeHTML(value) {
    return String(value ?? "").replace(/[&<>"']/g, character => ({
      "&": "&amp;",
      "<": "&lt;",
      ">": "&gt;",
      '"': "&quot;",
      "'": "&#39;"
    })[character]);
  }

  escapeHtml(value) {
    return this.escapeHTML(value);
  }

  safeBookColor(value) {
    const color = String(value || "");
    return /^#[\da-f]{3,8}$/i.test(color) && [4, 5, 7, 9].includes(color.length)
      ? color
      : "#510027";
  }

  // --- Themes & Accents ---
  setupTheme() {
    let savedAccent = localStorage.getItem("dgi_accent") || "dronacharya";
    if (savedAccent === "cyan") {
      savedAccent = "teal";
      localStorage.setItem("dgi_accent", savedAccent);
    } else if (savedAccent === "amber") {
      savedAccent = "violet";
      localStorage.setItem("dgi_accent", savedAccent);
    } else if (savedAccent === "gold") {
      savedAccent = "teal";
      localStorage.setItem("dgi_accent", savedAccent);
    }

    localStorage.removeItem("dgi_theme");
    document.documentElement.setAttribute("data-theme", "light");
    document.documentElement.setAttribute("data-accent", savedAccent);

    this.updateThemeButton("light");
    this.setupCollegeBrandSizing();
  }

  setupHeaderClock() {
    const dateElement = document.getElementById("header-date");
    const timeElement = document.getElementById("header-time");
    if (!dateElement || !timeElement) return;
    const refreshClock = () => {
      const now = new Date();
      dateElement.textContent = new Intl.DateTimeFormat("en-IN", {
        weekday: "long", day: "2-digit", month: "short", year: "numeric", timeZone: "Asia/Kolkata"
      }).format(now);
      timeElement.textContent = new Intl.DateTimeFormat("en-IN", {
        hour: "2-digit", minute: "2-digit", second: "2-digit", hour12: true, timeZone: "Asia/Kolkata"
      }).format(now);
    };
    refreshClock();
    window.setInterval(refreshClock, 1000);
  }

  setupAdminAccountMenu() {
    const toggle = document.getElementById("admin-account-toggle");
    const menu = document.getElementById("admin-account-menu");
    if (!toggle || !menu) return;
    const closeMenu = () => {
      menu.hidden = true;
      toggle.setAttribute("aria-expanded", "false");
    };
    toggle.addEventListener("click", event => {
      event.stopPropagation();
      menu.hidden = !menu.hidden;
      toggle.setAttribute("aria-expanded", String(!menu.hidden));
    });
    menu.addEventListener("click", event => event.stopPropagation());
    document.addEventListener("click", event => {
      if (!menu.hidden && !menu.contains(event.target) && !toggle.contains(event.target)) closeMenu();
    });
    document.addEventListener("keydown", event => {
      if (event.key === "Escape" && !menu.hidden) {
        closeMenu();
        toggle.focus();
      }
    });
  }

  setupCollegeBrandSizing() {
    const name = document.getElementById("topbar-college-name");
    const subtitle = document.querySelector(".topbar-college-subtitle");
    if (!name || !subtitle) return;
    this.collegeNameFontSize = Number(localStorage.getItem("dgi_college_name_font_size")) || 14;
    this.collegeSubtitleFontSize = Number(localStorage.getItem("dgi_college_subtitle_font_size")) || 12;
    this.fitCollegeBrandText();
    if ("ResizeObserver" in window) {
      this.collegeBrandResizeObserver = new ResizeObserver(() => this.fitCollegeBrandText());
      this.collegeBrandResizeObserver.observe(name.parentElement);
    }
  }

  fitCollegeBrandText() {
    const name = document.getElementById("topbar-college-name");
    const subtitle = document.querySelector(".topbar-college-subtitle");
    if (!name || !subtitle) return;
    const maxSize = Math.min(20, Math.max(10, this.collegeNameFontSize || 14));
    name.style.fontSize = `${maxSize}px`;
    if (name.clientWidth && name.scrollWidth > name.clientWidth) {
      const sizeRatio = name.clientWidth / name.scrollWidth;
      name.style.fontSize = `${Math.max(8, maxSize * sizeRatio)}px`;
    }
    subtitle.style.fontSize = `${Math.min(18, Math.max(10, this.collegeSubtitleFontSize || 12))}px`;
  }

  adjustCollegeFontSize(direction) {
    const step = Number(direction) < 0 ? -1 : 1;
    this.collegeNameFontSize = Math.min(20, Math.max(10, (this.collegeNameFontSize || 14) + step));
    this.collegeSubtitleFontSize = Math.min(18, Math.max(10, (this.collegeSubtitleFontSize || 12) + step));
    localStorage.setItem("dgi_college_name_font_size", String(this.collegeNameFontSize));
    localStorage.setItem("dgi_college_subtitle_font_size", String(this.collegeSubtitleFontSize));
    this.fitCollegeBrandText();
  }

  toggleTheme() {
    const current = document.documentElement.getAttribute("data-theme") || "light";
    const next = current === "dark" ? "light" : "dark";
    document.documentElement.setAttribute("data-theme", next);
    localStorage.setItem("dgi_theme", next);
    this.updateThemeButton(next);
  }

  updateThemeButton(theme) {
    const btn = document.getElementById("theme-toggle-btn");
    if (btn) {
      const icon = document.getElementById("theme-toggle-icon");
      const nextMode = theme === "dark" ? "Light" : "Dark";
      if (icon) icon.textContent = theme === "dark" ? "☀️" : "🌙";
      btn.title = `Switch to ${nextMode} Mode`;
      btn.setAttribute("aria-label", `Switch to ${nextMode} Mode`);
    }
  }

  setAccent(accentName) {
    document.documentElement.setAttribute("data-accent", accentName);
    localStorage.setItem("dgi_accent", accentName);
    this.showToast("Accent Updated", `Theme accent changed to ${accentName.toUpperCase()}`, "info");
  }

  // --- Navigation & Routing ---
  setupNavigation() {
    const navItems = document.querySelectorAll(".nav-item");
    navItems.forEach(item => {
      item.addEventListener("click", () => {
        const view = item.getAttribute("data-view");
        if (view) {
          this.switchView(view);
          // On mobile, close sidebar
          const sidebar = document.getElementById("sidebar");
          if (sidebar) sidebar.classList.remove("mobile-open");
        }
      });
    });

    const mobileMenuBtn = document.getElementById("mobile-menu-btn");
    if (mobileMenuBtn) {
      mobileMenuBtn.addEventListener("click", () => {
        const sidebar = document.getElementById("sidebar");
        if (sidebar) sidebar.classList.toggle("mobile-open");
      });
    }
  }

  switchView(viewName) {
    document.querySelectorAll(".nav-item").forEach(item => {
      item.classList.toggle("active", item.getAttribute("data-view") === viewName);
    });

    document.querySelectorAll(".page-view").forEach(page => {
      page.classList.remove("active");
    });

    const targetPage = document.getElementById(`view-${viewName}`);
    if (targetPage) {
      targetPage.classList.add("active");
      this.currentView = viewName;
      this.renderCurrentView();
    }
  }

  renderCurrentView() {
    this.updateNotificationBadge();

    switch (this.currentView) {
      case "dashboard":
        this.renderDashboard();
        break;
      case "books":
        this.renderBooks();
        break;
      case "students":
        this.renderStudents();
        break;
      case "faculty":
        this.renderFaculty();
        break;
      case "issue":
        this.renderIssueForm();
        break;
      case "return":
        this.renderReturnDesk();
        break;
      case "alerts":
        this.renderAlertsView();
        break;
      case "reports":
        this.renderReports();
        break;
      case "book-requests":
        this.renderAdminBookRequests();
        break;
      case "settings":
        this.renderSettings();
        break;
    }
  }

  normalizePhoneNumber(value) {
    const raw = String(value ?? "").trim();
    if (!raw) return "";

    const digits = raw.replace(/\D/g, "");
    if (!digits) return "";

    if (raw.startsWith("+91") || raw.startsWith("91")) {
      return `+${digits}`;
    }

    if (raw.startsWith("0")) {
      return `+91${digits.slice(1)}`;
    }

    return `+91${digits}`;
  }

  updateNotificationBadge() {
    const { overdue, totalAlerts } = window.db.getPendingAlerts();
    const navBadge = document.getElementById("nav-alert-badge");
    const topbarBadge = document.getElementById("topbar-alert-dot");

    if (navBadge) {
      if (overdue.length > 0) {
        navBadge.style.display = "inline-block";
        navBadge.textContent = overdue.length;
        navBadge.className = "nav-badge alert-badge";
      } else if (totalAlerts > 0) {
        navBadge.style.display = "inline-block";
        navBadge.textContent = totalAlerts;
        navBadge.className = "nav-badge";
      } else {
        navBadge.style.display = "none";
      }
    }

    if (topbarBadge) {
      topbarBadge.style.display = overdue.length > 0 ? "block" : "none";
    }
  }

  checkStartupAlerts() {
    const { overdue } = window.db.getPendingAlerts();
    if (overdue.length > 0) {
      this.showToast(
        "Overdue Books Alert!",
        `There are ${overdue.length} book(s) past their due date requiring attention.`,
        "warning"
      );
    }
  }

  // --- View 1: Dashboard ---
  renderDashboard() {
    const stats = window.db.getDashboardStats();
    const { overdue } = window.db.getPendingAlerts();

      // Stats
      document.getElementById("kpi-total-books").textContent = stats.totalBooks;
      document.getElementById("kpi-book-titles").textContent = stats.totalTitles;
      document.getElementById("kpi-issued-books").textContent = stats.issuedBooks;
    document.getElementById("kpi-available-books").textContent = stats.availableBooks;
    document.getElementById("kpi-total-students").textContent = stats.totalStudents;
    document.getElementById("kpi-overdue-count").textContent = stats.overdueCount;
    document.getElementById("kpi-fines-collected").textContent = `₹${stats.finesCollected}`;

    // Overdue Alert Banner
    const banner = document.getElementById("dashboard-alert-banner");
    if (banner) {
      if (overdue.length > 0) {
        banner.style.display = "flex";
        document.getElementById("banner-overdue-count").textContent = overdue.length;
      } else {
        banner.style.display = "none";
      }
    }

    // Recent Transactions Table
    const txBody = document.getElementById("recent-transactions-tbody");
    if (txBody) {
      const recent = [...window.db.getTransactions(), ...window.db.getFacultyTransactions()].sort((a, b) => Number(b.id) - Number(a.id)).slice(0, 5);
      if (recent.length === 0) {
        txBody.innerHTML = `<tr><td colspan="6" style="text-align:center; padding: 24px;">No transactions recorded yet.</td></tr>`;
      } else {
        txBody.innerHTML = recent.map(t => `
          <tr>
            <td><span class="isbn-code">#${t.borrower_type === 'faculty' ? 'F' : 'TX'}-${this.escapeHTML(t.id)}</span></td>
            <td><strong>${this.escapeHTML(t.book_title)}</strong></td>
            <td>${this.escapeHTML(t.borrower_type === 'faculty' ? 'Faculty: ' : '')}${this.escapeHTML(t.student_name)} (${this.escapeHTML(t.student_roll)})</td>
            <td>${this.escapeHTML(t.issue_date)}</td>
            <td>${this.escapeHTML(t.due_date)}</td>
            <td>
              ${t.status === 'issued' 
                ? (t.days_late > 0 ? `<span class="badge badge-danger">Overdue (${this.escapeHTML(t.days_late)}d)</span>` : `<span class="badge badge-warning">Issued</span>`)
                : `<span class="badge badge-success">Returned</span>`
              }
            </td>
          </tr>
        `).join("");
      }
    }

    const reissueBody = document.getElementById("dashboard-reissues-tbody");
    if (reissueBody) {
      const reissueRecords = window.db.getTransactions().flatMap(transaction =>
        (Array.isArray(transaction.reissue_history) ? transaction.reissue_history : []).map((entry, index) => ({
          transaction,
          entry,
          reissueNumber: index + 1
        }))
      ).sort((left, right) => Date.parse(right.entry.approvedAt || 0) - Date.parse(left.entry.approvedAt || 0)).slice(0, 5);
      if (!reissueRecords.length) {
        reissueBody.innerHTML = `<tr><td colspan="7" style="text-align:center; padding:24px;">No books have been reissued yet.</td></tr>`;
      } else {
        reissueBody.innerHTML = reissueRecords.map(({ transaction, entry, reissueNumber }) => {
          const approvedAt = entry.approvedAt && Number.isFinite(Date.parse(entry.approvedAt))
            ? new Date(entry.approvedAt).toLocaleString()
            : "—";
          return `
            <tr>
              <td>${this.escapeHTML(approvedAt)}</td>
              <td><strong>${this.escapeHTML(transaction.book_title)}</strong></td>
              <td>${this.escapeHTML(transaction.student_name)} (${this.escapeHTML(transaction.student_roll)})</td>
              <td><span class="badge badge-accent">${this.escapeHTML(reissueNumber)} of 2</span></td>
              <td>${this.escapeHTML(entry.previousDueDate || "—")}</td>
              <td>${this.escapeHTML(entry.dueDate || (reissueNumber === Number(transaction.reissue_count || 0) ? transaction.due_date : "—"))}</td>
              <td>${this.escapeHTML(entry.approvedBy || "—")}</td>
            </tr>`;
        }).join("");
      }
    }
    this.renderDashboardReissueRequests();
  }

  async reviewRequestsOnDashboard() {
    this.switchView("dashboard");
    document.getElementById("dashboard-reissue-requests")?.scrollIntoView({ behavior: "smooth", block: "start" });
    await this.renderDashboardReissueRequests();
  }

  async renderDashboardReissueRequests() {
    return this.renderReissueRequests("dashboard-reissue-requests-tbody");
  }

  // --- View 2: Books Catalog ---
  getBookDepartments(book) {
    const departments = [
      ...(Array.isArray(book.departments) ? book.departments : []),
      book.department
    ];
    return [...new Set(departments.map(value => String(value || "").trim()).filter(Boolean))];
  }

  getBookAccessions(book) {
    const accessions = Array.isArray(book.accessionNos) && book.accessionNos.length
      ? book.accessionNos
      : (book.accessionNo ? [book.accessionNo] : []);
    return [...new Set(accessions.map(value => String(value || "").trim()).filter(Boolean))];
  }

  renderCatalogKpis() {
    const allBooks = window.db.getBooks ? window.db.getBooks() : [];
    const subjects = window.db.getSubjects ? window.db.getSubjects() : [];
    const totalBooks = allBooks.length;
    const totalCopies = allBooks.reduce((sum, b) => sum + Number(b.total_copies ?? b.quantity ?? 1), 0);
    const availableCopies = allBooks.reduce((sum, b) => sum + Math.max(0, Number(b.available_copies ?? b.available ?? 0)), 0);
    const issuedCopies = Math.max(0, totalCopies - availableCopies);
    const outOfStock = allBooks.filter(b => Number(b.available_copies ?? b.available ?? 0) === 0).length;
    const totalSubjects = subjects.length;

    const elTB = document.getElementById("kpi-catalog-total-books");
    const elTC = document.getElementById("kpi-catalog-total-copies");
    const elAC = document.getElementById("kpi-catalog-available-copies");
    const elIC = document.getElementById("kpi-catalog-issued-copies");
    const elOS = document.getElementById("kpi-catalog-out-of-stock");
    const elTS = document.getElementById("kpi-catalog-total-subjects");
    if (elTB) elTB.textContent = totalBooks;
    if (elTC) elTC.textContent = totalCopies;
    if (elAC) elAC.textContent = availableCopies;
    if (elIC) elIC.textContent = issuedCopies;
    if (elOS) elOS.textContent = outOfStock;
    if (elTS) elTS.textContent = totalSubjects;
  }

  renderBooks() {
    this.renderCatalogKpis();

    // Populate subject filter dropdown in table view
    const subjectFilterSelect = document.getElementById("books-subject-filter-select");
    if (subjectFilterSelect) {
      const currentSub = subjectFilterSelect.value || "all";
      const subjects = window.db.getSubjects ? window.db.getSubjects() : [];
      subjectFilterSelect.innerHTML = `<option value="all">All Subjects (${subjects.length})</option>` +
        subjects.map(s => `<option value="${s.subject_id}" ${window.db.matchId(currentSub, s.subject_id) ? "selected" : ""}>${this.escapeHTML(s.subject_code ? `[${s.subject_code}] ` : "")}${this.escapeHTML(s.subject_name)}</option>`).join("");
    }

    if (this.catalogMode === "subjects") {
      if (this.activeSubjectId) {
        this.renderSubjectBooksTable();
      } else {
        this.renderSubjectsCards();
      }
    }

    const searchVal = (document.getElementById("books-search-input")?.value || "").toLowerCase().trim();
    const availVal = document.getElementById("books-avail-select")?.value || "all";
    const subVal = document.getElementById("books-subject-filter-select")?.value || "all";
    const sortVal = document.getElementById("books-sort-select")?.value || "name_asc";

    const allBooks = window.db.getBooks();
    this.renderBranchFilter(allBooks);

    const selectedBranch = document.getElementById("books-branch-select")?.value || "all";
    let branchBooks = allBooks;
    if (selectedBranch === "unassigned") {
      branchBooks = allBooks.filter(book => this.getBookDepartments(book).length === 0);
    } else if (selectedBranch !== "all") {
      branchBooks = allBooks.filter(book => this.getBookDepartments(book).includes(selectedBranch));
    }

    // Category choices and pills follow the selected branch.
    this.renderCategoryPills(branchBooks);
    const catVal = document.getElementById("books-category-select")?.value || "all";
    let books = branchBooks;

    if (subVal !== "all") {
      books = books.filter(b => window.db.matchId(b.subject_id, subVal));
    }

    // Apply filters
    if (searchVal) {
      books = books.filter(b => 
        String(b.title || b.book_name || "").toLowerCase().includes(searchVal) ||
        String(b.author || "").toLowerCase().includes(searchVal) ||
        String(b.book_id || b.id || "").toLowerCase().includes(searchVal) ||
        String(b.publisher || "").toLowerCase().includes(searchVal) ||
        String(b.isbn || "").toLowerCase().includes(searchVal) ||
        String(b.category || "").toLowerCase().includes(searchVal)
      );
    }

    if (catVal !== "all") {
      books = books.filter(b => (b.category || "").toLowerCase() === catVal.toLowerCase());
    }

    if (availVal === "available") {
      books = books.filter(b => (b.available ?? b.available_copies ?? 0) > 0);
    } else if (availVal === "out_of_stock") {
      books = books.filter(b => (b.available ?? b.available_copies ?? 0) === 0);
    }

    // Sort books
    if (sortVal === "name_asc") {
      books.sort((a, b) => String(a.title || a.book_name || "").localeCompare(String(b.title || b.book_name || "")));
    } else if (sortVal === "name_desc") {
      books.sort((a, b) => String(b.title || b.book_name || "").localeCompare(String(a.title || a.book_name || "")));
    } else if (sortVal === "recent") {
      books.sort((a, b) => {
        const idA = String(a.book_id || a.id || "").replace(/\D/g, "");
        const idB = String(b.book_id || b.id || "").replace(/\D/g, "");
        return (Number(idB) || 0) - (Number(idA) || 0);
      });
    } else if (sortVal === "copies_desc") {
      books.sort((a, b) => (Number(b.total_copies ?? b.quantity ?? 0)) - (Number(a.total_copies ?? a.quantity ?? 0)));
    } else if (sortVal === "avail_desc") {
      books.sort((a, b) => (Number(b.available_copies ?? b.available ?? 0)) - (Number(a.available_copies ?? a.available ?? 0)));
    }

    // Pagination
    const totalEntries = books.length;
    const totalPages = Math.max(1, Math.ceil(totalEntries / this.booksPageSize));
    if (this.booksCurrentPage > totalPages) this.booksCurrentPage = totalPages;
    if (this.booksCurrentPage < 1) this.booksCurrentPage = 1;
    const startIndex = (this.booksCurrentPage - 1) * this.booksPageSize;
    const pagedBooks = books.slice(startIndex, startIndex + this.booksPageSize);

    this.renderBooksPagination(totalEntries, totalPages, startIndex, pagedBooks.length);

    const tableContainer = document.getElementById("books-table-view-container");
    if (tableContainer) tableContainer.style.display = "block";
    this.renderBooksTable(pagedBooks);
  }

  setBooksPage(page) {
    this.booksCurrentPage = page;
    this.renderBooks();
  }

  renderBooksPagination(totalEntries, totalPages, startIndex, countOnPage) {
    const infoEl = document.getElementById("books-pagination-info");
    const controlsEl = document.getElementById("books-pagination-controls");
    if (infoEl) {
      if (totalEntries === 0) {
        infoEl.textContent = "Showing 0 books";
      } else {
        infoEl.textContent = `Showing ${startIndex + 1} to ${startIndex + countOnPage} of ${totalEntries} books`;
      }
    }
    if (!controlsEl) return;

    if (totalPages <= 1) {
      controlsEl.innerHTML = "";
      return;
    }

    let buttonsHtml = "";
    buttonsHtml += `<button class="btn btn-secondary btn-sm" ${this.booksCurrentPage === 1 ? 'disabled style="opacity:0.5;"' : ''} onclick="window.app.setBooksPage(${this.booksCurrentPage - 1})">← Prev</button>`;

    for (let p = 1; p <= totalPages; p++) {
      if (p === 1 || p === totalPages || (p >= this.booksCurrentPage - 1 && p <= this.booksCurrentPage + 1)) {
        buttonsHtml += `<button class="btn btn-sm ${p === this.booksCurrentPage ? 'btn-primary' : 'btn-secondary'}" onclick="window.app.setBooksPage(${p})">${p}</button>`;
      } else if (p === this.booksCurrentPage - 2 || p === this.booksCurrentPage + 2) {
        buttonsHtml += `<span style="padding:0 4px; color:var(--text-muted);">…</span>`;
      }
    }

    buttonsHtml += `<button class="btn btn-secondary btn-sm" ${this.booksCurrentPage === totalPages ? 'disabled style="opacity:0.5;"' : ''} onclick="window.app.setBooksPage(${this.booksCurrentPage + 1})">Next →</button>`;
    controlsEl.innerHTML = buttonsHtml;
  }

  toggleCatalogMode(mode) {
    this.catalogMode = mode;
    const subjectsContainer = document.getElementById("catalog-subjects-container");
    const detailContainer = document.getElementById("catalog-subject-detail-container");
    const allTableContainer = document.getElementById("catalog-all-books-container");
    const btnSubjects = document.getElementById("btn-toggle-subjects-view") || document.getElementById("catalog-mode-subjects");
    const btnTable = document.getElementById("btn-toggle-allbooks-view") || document.getElementById("catalog-mode-table");

    if (mode === "subjects") {
      if (this.activeSubjectId) {
        if (subjectsContainer) subjectsContainer.style.display = "none";
        if (detailContainer) detailContainer.style.display = "block";
        this.renderSubjectBooksTable();
      } else {
        if (subjectsContainer) subjectsContainer.style.display = "block";
        if (detailContainer) detailContainer.style.display = "none";
        this.renderSubjectsCards();
      }
      if (allTableContainer) allTableContainer.style.display = "none";
      if (btnSubjects) { btnSubjects.className = "btn btn-primary btn-sm"; btnSubjects.style.background = ""; }
      if (btnTable) { btnTable.className = "btn btn-secondary btn-sm"; btnTable.style.background = "transparent"; }
    } else {
      if (subjectsContainer) subjectsContainer.style.display = "none";
      if (detailContainer) detailContainer.style.display = "none";
      if (allTableContainer) allTableContainer.style.display = "block";
      if (btnSubjects) { btnSubjects.className = "btn btn-secondary btn-sm"; btnSubjects.style.background = "transparent"; }
      if (btnTable) { btnTable.className = "btn btn-primary btn-sm"; btnTable.style.background = ""; }
      this.renderBooks();
    }
  }

  backToSubjects() {
    this.activeSubjectId = null;
    const subjectsContainer = document.getElementById("catalog-subjects-container");
    const detailContainer = document.getElementById("catalog-subject-detail-container");
    if (subjectsContainer) subjectsContainer.style.display = "block";
    if (detailContainer) detailContainer.style.display = "none";
    this.renderSubjectsCards();
  }

  openSubjectDetail(subjectId) {
    const subject = window.db.getSubjectById ? window.db.getSubjectById(subjectId) : null;
    if (!subject) {
      this.showToast("Error", "Subject not found", "danger");
      return;
    }
    this.activeSubjectId = subject.subject_id;
    this.catalogMode = "subjects";

    const subjectsContainer = document.getElementById("catalog-subjects-container");
    const detailContainer = document.getElementById("catalog-subject-detail-container");
    const allTableContainer = document.getElementById("catalog-all-books-container");
    if (subjectsContainer) subjectsContainer.style.display = "none";
    if (allTableContainer) allTableContainer.style.display = "none";
    if (detailContainer) detailContainer.style.display = "block";

    // Populate hero banner
    const nameEl = document.getElementById("subject-detail-name");
    const codeEl = document.getElementById("subject-detail-code-badge");
    const descEl = document.getElementById("subject-detail-desc");
    const iconEl = document.getElementById("subject-detail-icon");
    const breadcrumbEl = document.getElementById("subject-detail-breadcrumb");

    if (nameEl) nameEl.textContent = subject.subject_name;
    if (breadcrumbEl) breadcrumbEl.textContent = subject.subject_name;
    if (codeEl) {
      codeEl.textContent = subject.subject_code || "GEN";
      codeEl.style.display = subject.subject_code ? "inline-block" : "none";
    }
    if (descEl) descEl.textContent = subject.description || "Comprehensive subject domain and textbook collection.";
    if (iconEl) iconEl.textContent = subject.icon || "📚";

    // Reset filters
    const searchInput = document.getElementById("subject-books-search-input");
    if (searchInput) searchInput.value = "";
    const availSelect = document.getElementById("subject-books-avail-select");
    if (availSelect) availSelect.value = "all";
    const sortSelect = document.getElementById("subject-books-sort-select");
    if (sortSelect) sortSelect.value = "name_asc";

    // Populate author dropdown for this subject
    const books = window.db.getBooksBySubjectId ? window.db.getBooksBySubjectId(this.activeSubjectId) : window.db.getBooks().filter(b => window.db.matchId(b.subject_id, this.activeSubjectId));
    const authorSelect = document.getElementById("subject-books-author-select");
    if (authorSelect) {
      const authors = [...new Set(books.map(b => (b.author || "").trim()).filter(Boolean))].sort();
      authorSelect.innerHTML = `<option value="all">All Authors (${authors.length})</option>` +
        authors.map(a => `<option value="${this.escapeHTML(a)}">${this.escapeHTML(a)}</option>`).join("");
    }

    this.renderSubjectBooksTable();
  }

  renderSubjectBooksTable() {
    if (!this.activeSubjectId) return;
    const tbody = document.getElementById("subject-books-table-tbody");
    if (!tbody) return;

    let books = window.db.getBooksBySubjectId ? window.db.getBooksBySubjectId(this.activeSubjectId) : window.db.getBooks().filter(b => window.db.matchId(b.subject_id, this.activeSubjectId));

    const searchVal = (document.getElementById("subject-books-search-input")?.value || "").toLowerCase().trim();
    const authorVal = document.getElementById("subject-books-author-select")?.value || "all";
    const availVal = document.getElementById("subject-books-avail-select")?.value || "all";
    const sortVal = document.getElementById("subject-books-sort-select")?.value || "name_asc";

    // Filter
    if (searchVal) {
      books = books.filter(b =>
        String(b.title || b.book_name || "").toLowerCase().includes(searchVal) ||
        String(b.author || "").toLowerCase().includes(searchVal) ||
        String(b.publisher || "").toLowerCase().includes(searchVal) ||
        String(b.book_id || b.id || "").toLowerCase().includes(searchVal) ||
        String(b.isbn || "").toLowerCase().includes(searchVal)
      );
    }

    if (authorVal !== "all") {
      books = books.filter(b => String(b.author || "").trim().toLowerCase() === authorVal.toLowerCase());
    }

    if (availVal === "available") {
      books = books.filter(b => Number(b.available ?? b.available_copies ?? 0) > 0);
    } else if (availVal === "out_of_stock") {
      books = books.filter(b => Number(b.available ?? b.available_copies ?? 0) === 0);
    }

    // Sort
    books.sort((a, b) => {
      const titleA = String(a.title || a.book_name || "").toLowerCase();
      const titleB = String(b.title || b.book_name || "").toLowerCase();
      const availA = Number(a.available ?? a.available_copies ?? 0);
      const availB = Number(b.available ?? b.available_copies ?? 0);
      const qtyA = Number(a.quantity ?? a.total_copies ?? 0);
      const qtyB = Number(b.quantity ?? b.total_copies ?? 0);

      if (sortVal === "name_desc") return titleB.localeCompare(titleA);
      if (sortVal === "copies_desc") return qtyB - qtyA;
      if (sortVal === "avail_desc") return availB - availA;
      return titleA.localeCompare(titleB);
    });

    if (books.length === 0) {
      tbody.innerHTML = `<tr><td colspan="7" style="text-align: center; padding: 40px; color: var(--text-muted);">
        <div style="font-size: 32px; margin-bottom: 8px;">📚</div>
        <div style="font-size: 15px; font-weight: 700; color: var(--text-primary); margin-bottom: 4px;">No books found in this subject matching your search/filters.</div>
        <div style="font-size: 13px; margin-bottom: 14px;">You can add books to this subject or clear your filter criteria.</div>
        <button class="btn btn-primary btn-sm" onclick="window.app.openAddBookForCurrentSubject()">+ Add Book to this Subject</button>
      </td></tr>`;
      return;
    }

    tbody.innerHTML = books.map(b => {
      const bookKey = b.book_id || b.id;
      const available = Number(b.available ?? b.available_copies ?? 0);
      const total = Number(b.quantity ?? b.total_copies ?? 0);
      const bookTitle = b.title || b.book_name || "Untitled Book";
      const year = b.publication_year || b.published_year || "";
      return `
        <tr>
          <td>
            <div class="book-title-cell">
              <div class="book-mini-cover" style="background: linear-gradient(135deg, ${this.safeBookColor(b.color1)}, ${this.safeBookColor(b.color2)});">
                📖
              </div>
              <div>
                <div class="book-meta-primary">${this.escapeHTML(bookTitle)}</div>
                <div class="book-meta-sub"><code>${this.escapeHTML(bookKey)}</code> ${year ? `| Year: ${this.escapeHTML(year)}` : ""} ${b.category ? `| ${this.escapeHTML(b.category)}` : ""}</div>
              </div>
            </div>
          </td>
          <td><strong>${this.escapeHTML(b.author || "Unknown")}</strong></td>
          <td>${this.escapeHTML(b.publisher || "—")}</td>
          <td><span class="isbn-code">${this.escapeHTML(b.isbn || "—")}</span></td>
          <td>
            <span style="font-weight: 800; font-size: 15px; color: ${available > 0 ? 'var(--success)' : 'var(--danger)'};">${available}</span>
            <span style="color: var(--text-muted); font-size: 13px;"> / ${total}</span>
          </td>
          <td>
            ${available > 0 
              ? `<span class="badge badge-success">Available</span>` 
              : `<span class="badge badge-danger">Out of Stock</span>`}
          </td>
          <td>
            <div class="action-btn-group">
              <button class="btn btn-secondary btn-sm" title="View Details" onclick="window.app.openBookDetailsModal('${this.escapeHTML(bookKey)}')">👁️</button>
              <button class="btn btn-secondary btn-sm btn-icon-only" title="Edit Book" onclick="window.app.openEditBookModal('${this.escapeHTML(bookKey)}')">✏️</button>
              <button class="btn btn-primary btn-sm" ${available === 0 ? 'disabled style="opacity:0.5;"' : ''} onclick="window.app.quickIssueBook('${this.escapeHTML(bookKey)}')">Issue</button>
              <button class="btn btn-danger btn-sm btn-icon-only" title="Delete Book" onclick="window.app.deleteBook('${this.escapeHTML(bookKey)}')">🗑️</button>
            </div>
          </td>
        </tr>
      `;
    }).join("");
  }

  renderSubjectsCards() {
    const container = document.getElementById("subjects-cards-grid");
    if (!container) return;

    const subjects = window.db.getSubjects ? window.db.getSubjects() : [];
    const allBooks = window.db.getBooks ? window.db.getBooks() : [];

    // Update overall KPIs
    const totalSubjectsEl = document.getElementById("kpi-subjects-count");
    const totalTitlesEl = document.getElementById("kpi-subject-titles-count");
    const totalCopiesEl = document.getElementById("kpi-subject-copies-count");
    if (totalSubjectsEl) totalSubjectsEl.textContent = subjects.length;
    if (totalTitlesEl) totalTitlesEl.textContent = allBooks.length;
    const totalCopies = allBooks.reduce((sum, b) => sum + Number(b.quantity ?? b.total_copies ?? 0), 0);
    if (totalCopiesEl) totalCopiesEl.textContent = totalCopies;

    // Filter subjects by search input
    const searchVal = (document.getElementById("subjects-search-input")?.value || "").toLowerCase().trim();
    let filtered = subjects;
    if (searchVal) {
      filtered = subjects.filter(s =>
        String(s.subject_name || "").toLowerCase().includes(searchVal) ||
        String(s.subject_code || "").toLowerCase().includes(searchVal) ||
        String(s.description || "").toLowerCase().includes(searchVal)
      );
    }

    if (filtered.length === 0) {
      container.innerHTML = `
        <div style="grid-column: 1/-1; text-align: center; padding: 50px 20px; background: var(--bg-card); border: 1px dashed var(--border-color); border-radius: var(--radius-md);">
          <div style="font-size: 36px; margin-bottom: 10px;">🔍</div>
          <div style="font-size: 16px; font-weight: 700; color: var(--text-primary); margin-bottom: 6px;">No subjects found</div>
          <div style="font-size: 13px; color: var(--text-muted); margin-bottom: 16px;">Try another search term or create a new subject domain.</div>
          <button class="btn btn-primary btn-sm" onclick="window.app.openAddSubjectModal()">+ Add New Subject</button>
        </div>
      `;
      return;
    }

    container.innerHTML = filtered.map(s => {
      const subBooks = allBooks.filter(b => window.db.matchId(b.subject_id, s.subject_id));
      const titleCount = subBooks.length;
      const totalCopies = subBooks.reduce((acc, b) => acc + Number(b.quantity ?? b.total_copies ?? 0), 0);
      const availCopies = subBooks.reduce((acc, b) => acc + Number(b.available ?? b.available_copies ?? 0), 0);
      const icon = s.icon || "📚";
      const code = s.subject_code || "GEN";

      return `
        <div class="card subject-catalog-card" style="position: relative; border-radius: var(--radius-md); padding: 20px; display: flex; flex-direction: column; justify-content: space-between; transition: transform 0.2s, box-shadow 0.2s; cursor: pointer; border: 1px solid var(--border-color); background: var(--bg-card);"
             onclick="if(!event.target.closest('.subject-card-actions')) window.app.openSubjectDetail('${this.escapeHTML(s.subject_id)}')"
             onmouseenter="this.style.transform='translateY(-3px)'; this.style.boxShadow='0 10px 24px rgba(0,0,0,0.25)';"
             onmouseleave="this.style.transform='none'; this.style.boxShadow='none';">
          <div>
            <div style="display: flex; justify-content: space-between; align-items: flex-start; margin-bottom: 12px;">
              <div style="font-size: 34px; width: 54px; height: 54px; background: rgba(81,0,39,0.15); border: 1px solid var(--border-color); border-radius: 12px; display: flex; align-items: center; justify-content: center;">
                ${icon}
              </div>
              <div class="subject-card-actions" style="display: flex; gap: 6px;">
                <button class="btn btn-secondary btn-sm btn-icon-only" title="Edit Subject" onclick="event.stopPropagation(); window.app.openEditSubjectModal('${this.escapeHTML(s.subject_id)}')">✏️</button>
                <button class="btn btn-danger btn-sm btn-icon-only" title="Delete Subject" onclick="event.stopPropagation(); window.app.promptDeleteSubject('${this.escapeHTML(s.subject_id)}')">🗑️</button>
              </div>
            </div>

            <div style="display: flex; align-items: center; gap: 8px; margin-bottom: 6px;">
              <span class="badge badge-accent" style="font-size: 11px; font-weight: 700;">${this.escapeHTML(code)}</span>
            </div>

            <h3 style="margin: 0 0 8px; font-size: 17px; font-weight: 800; color: var(--text-primary); line-height: 1.3;">
              ${this.escapeHTML(s.subject_name)}
            </h3>

            <p style="margin: 0 0 16px; font-size: 12px; color: var(--text-secondary); line-height: 1.4; display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; overflow: hidden; min-height: 34px;">
              ${this.escapeHTML(s.description || "Comprehensive subject domain and textbook collection.")}
            </p>
          </div>

          <div style="border-top: 1px solid var(--border-color); padding-top: 14px; margin-top: 8px;">
            <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 8px; margin-bottom: 12px; font-size: 12px;">
              <div style="background: rgba(0,0,0,0.15); padding: 8px 10px; border-radius: 6px;">
                <div style="color: var(--text-muted); font-size: 11px;">Total Titles</div>
                <div style="font-weight: 800; font-size: 15px; color: var(--text-primary);">${titleCount} books</div>
              </div>
              <div style="background: rgba(0,0,0,0.15); padding: 8px 10px; border-radius: 6px;">
                <div style="color: var(--text-muted); font-size: 11px;">Available</div>
                <div style="font-weight: 800; font-size: 15px; color: ${availCopies > 0 ? 'var(--success)' : 'var(--danger)'};">${availCopies} / ${totalCopies}</div>
              </div>
            </div>
            <button class="btn btn-secondary btn-sm" style="width: 100%; justify-content: center; font-weight: 700; pointer-events: none;">
              Explore Subject Catalog →
            </button>
          </div>
        </div>
      `;
    }).join("");
  }

  // --- Subject Management Modals ---
  openAddSubjectModal() {
    document.getElementById("form-subject")?.reset();
    document.getElementById("subject-modal-id").value = "";
    document.getElementById("modal-subject-title").textContent = "Add New Subject";
    document.getElementById("subject-modal-submit-btn").textContent = "Create Subject";
    document.getElementById("modal-subject")?.classList.add("active");
  }

  openEditSubjectModal(subjectId) {
    const s = window.db.getSubjectById ? window.db.getSubjectById(subjectId) : null;
    if (!s) return;
    document.getElementById("subject-modal-id").value = s.subject_id;
    document.getElementById("subject-modal-name").value = s.subject_name || "";
    document.getElementById("subject-modal-code").value = s.subject_code || "";
    document.getElementById("subject-modal-icon").value = s.icon || "📚";
    document.getElementById("subject-modal-desc").value = s.description || "";
    document.getElementById("modal-subject-title").textContent = "Edit Subject";
    document.getElementById("subject-modal-submit-btn").textContent = "Save Changes";
    document.getElementById("modal-subject")?.classList.add("active");
  }

  openEditCurrentSubject() {
    if (this.activeSubjectId) {
      this.openEditSubjectModal(this.activeSubjectId);
    }
  }

  openAddBookForCurrentSubject() {
    this.openAddBookModal(this.activeSubjectId);
  }

  async handleSubjectFormSubmit(e) {
    e.preventDefault();
    const idVal = document.getElementById("subject-modal-id").value;
    const name = document.getElementById("subject-modal-name").value.trim();
    const code = document.getElementById("subject-modal-code").value.trim();
    const icon = document.getElementById("subject-modal-icon").value.trim() || "📚";
    const desc = document.getElementById("subject-modal-desc").value.trim();

    if (!name) {
      this.showToast("Required", "Please provide a subject name.", "danger");
      return;
    }

    const payload = {
      subject_name: name,
      subject_code: code,
      icon: icon,
      description: desc
    };

    try {
      if (idVal) {
        await window.db.updateSubject(idVal, payload);
        this.showToast("Subject Updated", `Subject '${name}' updated successfully.`, "success");
        if (window.db.matchId(this.activeSubjectId, idVal)) {
          this.openSubjectDetail(idVal);
        }
      } else {
        await window.db.addSubject(payload);
        this.showToast("Subject Created", `Subject '${name}' added to library catalog.`, "success");
      }
      this.closeModal("modal-subject");
      this.renderSubjectsCards();
      this.renderBooks();
    } catch (err) {
      this.showToast("Error", err.message, "danger");
    }
  }

  promptDeleteSubject(subjectId) {
    const s = window.db.getSubjectById ? window.db.getSubjectById(subjectId) : null;
    if (!s) return;
    const books = window.db.getBooksBySubjectId ? window.db.getBooksBySubjectId(subjectId) : window.db.getBooks().filter(b => window.db.matchId(b.subject_id, subjectId));

    if (books.length === 0) {
      if (confirm(`Are you sure you want to delete subject '${s.subject_name}'? No books belong to this subject.`)) {
        this.executeDeleteSubject(s.subject_id, null);
      }
      return;
    }

    // Dependent books exist: show reassignment modal
    this.pendingDeleteSubjectId = s.subject_id;
    const modal = document.getElementById("modal-delete-subject");
    const warnText = document.getElementById("delete-subject-warning-text");
    const select = document.getElementById("delete-subject-reassign-select");
    if (!modal || !select) return;

    warnText.innerHTML = `Subject <strong>${this.escapeHTML(s.subject_name)}</strong> currently has <strong>${books.length} book(s)</strong> assigned to it.<br><br>Select a target subject to safely reassign all existing books before deleting:`;

    const otherSubjects = (window.db.getSubjects ? window.db.getSubjects() : []).filter(sub => !window.db.matchId(sub.subject_id, s.subject_id));
    select.innerHTML = otherSubjects.map(sub => `
      <option value="${sub.subject_id}">
        ${this.escapeHTML(sub.subject_name)} (${this.escapeHTML(sub.subject_code || "GEN")})
      </option>
    `).join("");

    modal.classList.add("active");
  }

  async confirmDeleteSubject() {
    if (!this.pendingDeleteSubjectId) return;
    const select = document.getElementById("delete-subject-reassign-select");
    const reassignId = select ? select.value : null;
    await this.executeDeleteSubject(this.pendingDeleteSubjectId, reassignId);
    this.closeModal("modal-delete-subject");
    this.pendingDeleteSubjectId = null;
  }

  async executeDeleteSubject(subjectId, reassignId) {
    try {
      await window.db.deleteSubject(subjectId, reassignId);
      this.showToast("Subject Deleted", "Subject was safely removed.", "info");
      if (window.db.matchId(this.activeSubjectId, subjectId)) {
        this.backToSubjects();
      } else {
        this.renderSubjectsCards();
        this.renderBooks();
      }
    } catch (err) {
      this.showToast("Deletion Blocked", err.message, "danger");
    }
  }

  renderBranchFilter(books) {
    const select = document.getElementById("books-branch-select");
    if (!select) return;

    const currentBranch = select.value || "all";
    const branches = [...new Set(books.flatMap(book => this.getBookDepartments(book)))].sort((a, b) => a.localeCompare(b));
    const hasUnassigned = books.some(book => this.getBookDepartments(book).length === 0);
    select.replaceChildren(new Option("All Branches", "all"));
    branches.forEach(branch => select.add(new Option(branch, branch)));
    if (hasUnassigned) select.add(new Option("Unassigned", "unassigned"));
    select.value = currentBranch === "unassigned" && hasUnassigned || branches.includes(currentBranch)
      ? currentBranch
      : "all";
  }

  renderCategoryPills(allBooks) {
    const pillsContainer = document.getElementById("books-category-pills");
    if (!pillsContainer) return;

    const categories = [...new Set(allBooks.map(book => String(book.category || "").trim()).filter(Boolean))];
    const categorySelect = document.getElementById("books-category-select");
    const currentCat = categorySelect?.value || "all";

    if (categorySelect) {
      categorySelect.replaceChildren(new Option("All Categories", "all"));
      categories.forEach(category => categorySelect.add(new Option(category, category)));
      categorySelect.value = categories.includes(currentCat) ? currentCat : "all";
    }

    const activeCategory = categorySelect?.value || "all";
    const pills = ["all", ...categories].map(category => {
      const pill = document.createElement("div");
      pill.className = `category-pill ${category.toLowerCase() === activeCategory.toLowerCase() ? "active" : ""}`;
      pill.textContent = category === "all" ? "✨ All Genres" : category;
      pill.addEventListener("click", () => this.filterByCategory(category));
      return pill;
    });
    pillsContainer.replaceChildren(...pills);
  }

  filterByCategory(cat) {
    const select = document.getElementById("books-category-select");
    if (select) select.value = cat;
    this.renderBooks();
  }

  renderBooksTable(books) {
    const tbody = document.getElementById("books-table-tbody");
    if (!tbody) return;

    if (books.length === 0) {
      tbody.innerHTML = `<tr><td colspan="11" style="text-align: center; padding: 40px; color:var(--text-muted);">
        <div style="font-size:32px; margin-bottom:8px;">🔍</div>
        <div style="font-size:15px; font-weight:700; color:var(--text-primary); margin-bottom:4px;">No books found</div>
        <div>No library books matched your active filter or search criteria.</div>
      </td></tr>`;
      return;
    }

    const subjects = window.db.getSubjects ? window.db.getSubjects() : [];

    tbody.innerHTML = books.map(b => {
      const bookKey = b.book_id || b.id;
      const accessions = this.getBookAccessions(b);
      const subject = subjects.find(s => window.db.matchId(s.subject_id, b.subject_id));
      const subjectName = subject ? subject.subject_name : (b.category || "General");
      const subjectCode = subject?.subject_code ? `[${subject.subject_code}] ` : "";
      const bookTitle = b.title || b.book_name || "Untitled Book";
      const available = Number(b.available ?? b.available_copies ?? 0);
      const total = Number(b.quantity ?? b.total_copies ?? 0);
      const year = b.publication_year || b.published_year || "";
      const isAvailable = available > 0;

      return `
      <tr>
        <td>
          <code style="font-size:12px; font-weight:700; color:var(--accent-primary); background:rgba(81,0,39,0.08); padding:3px 6px; border-radius:4px;">${this.escapeHTML(bookKey)}</code>
        </td>
        <td>
          <div class="book-mini-cover" style="width:38px; height:48px; border-radius:4px; display:flex; align-items:center; justify-content:center; font-size:18px; box-shadow:0 2px 6px rgba(0,0,0,0.18); background: linear-gradient(135deg, ${this.safeBookColor(b.color1)}, ${this.safeBookColor(b.color2)});">
            📖
          </div>
        </td>
        <td>
          <div style="font-weight:700; color:var(--text-primary); line-height:1.3;">${this.escapeHTML(bookTitle)}</div>
          <div style="font-size:11px; color:var(--text-muted); margin-top:2px;">
            ${year ? `Year: ${this.escapeHTML(year)} &bull; ` : ""}⭐ ${this.escapeHTML(b.rating || "4.5")}
          </div>
        </td>
        <td>
          <div>${this.escapeHTML(b.author || "Unknown")}</div>
          ${b.publisher ? `<div style="font-size:11px; color:var(--text-muted);">Pub: ${this.escapeHTML(b.publisher)}</div>` : ""}
        </td>
        <td>
          <span class="badge badge-accent category-badge" title="${this.escapeHTML(subjectName)}" style="cursor:pointer;" onclick="window.app.openSubjectDetail('${this.escapeHTML(b.subject_id || '')}')">
            ${this.escapeHTML(subjectCode)}${this.escapeHTML(subjectName)}
          </span>
        </td>
        <td>
          <span class="badge badge-info" style="font-size:11px;">${this.escapeHTML(b.category || "General")}</span>
        </td>
        <td>
          <span class="isbn-code">${this.escapeHTML(b.isbn || "—")}</span>
          ${accessions.length ? `<details style="font-size: 11px; margin-top: 5px;"><summary>${accessions.length} accession</summary><div style="max-height: 100px; overflow: auto;">${accessions.map(value => `<code>${this.escapeHTML(value)}</code>`).join("<br>")}</div></details>` : ""}
        </td>
        <td style="text-align:center; font-weight:700;">${total}</td>
        <td style="text-align:center; font-weight:800; color:${isAvailable ? 'var(--success)' : 'var(--danger)'};">${available}</td>
        <td>
          ${isAvailable 
            ? `<span class="badge badge-success">Available</span>` 
            : `<span class="badge badge-danger">Out of Stock</span>`}
        </td>
        <td style="text-align:right;">
          <div class="action-btn-group" style="justify-content:flex-end;">
            <button class="btn btn-secondary btn-sm" title="View Details" onclick="window.app.openBookDetailsModal('${this.escapeHTML(bookKey)}')">👁️</button>
            <button class="btn btn-secondary btn-sm btn-icon-only" title="Edit" onclick="window.app.openEditBookModal('${this.escapeHTML(bookKey)}')">✏️</button>
            <button class="btn btn-primary btn-sm" ${available === 0 ? 'disabled style="opacity:0.5;"' : ''} onclick="window.app.quickIssueBook('${this.escapeHTML(bookKey)}')">Issue</button>
            <button class="btn btn-danger btn-sm btn-icon-only" title="Delete" onclick="window.app.deleteBook('${this.escapeHTML(bookKey)}')">🗑️</button>
          </div>
        </td>
      </tr>
    `;
    }).join("");
  }

  // --- View 3: Students Directory ---
  renderStudents() {
    const searchVal = (document.getElementById("students-search-input")?.value || "").toLowerCase().trim();
    let students = window.db.getStudents();

    if (searchVal) {
      students = students.filter(s =>
        s.name.toLowerCase().includes(searchVal) ||
        s.roll_no.toLowerCase().includes(searchVal) ||
        s.phone.includes(searchVal) ||
        s.email.toLowerCase().includes(searchVal) ||
        s.department.toLowerCase().includes(searchVal)
      );
    }

    const tbody = document.getElementById("students-table-tbody");
    if (!tbody) return;

    if (students.length === 0) {
      tbody.innerHTML = `<tr><td colspan="5" style="text-align: center; padding: 40px;">No students found.</td></tr>`;
      return;
    }

    tbody.innerHTML = students.map(s => {
      return `
        <tr>
          <td>
            <div style="display: flex; align-items: center; gap: 12px;">
              <div class="user-avatar">${this.escapeHTML(s.avatar)}</div>
              <div>
                <strong style="color: var(--text-primary); font-size: 14px;">${this.escapeHTML(s.name)}</strong>
                <div style="font-size: 11.5px; color: var(--text-muted);">${this.escapeHTML(s.email)}</div>
              </div>
            </div>
          </td>
          <td><span class="isbn-code">${this.escapeHTML(s.roll_no)}</span></td>
          <td><span class="badge badge-accent">${this.escapeHTML(s.department)}</span></td>
          <td>${this.escapeHTML(s.phone)}</td>
          <td>
            <div class="action-btn-group">
              <button class="btn btn-secondary btn-sm btn-icon-only" title="Edit" onclick="window.app.openEditStudentModal(${s.id})">✏️</button>
              <button class="btn btn-danger btn-sm btn-icon-only" title="Delete" onclick="window.app.deleteStudent(${s.id})">🗑️</button>
            </div>
          </td>
        </tr>
      `;
    }).join("");
  }

  renderFaculty() {
    const tbody = document.getElementById("faculty-table-tbody");
    const departmentFilter = document.getElementById("faculty-department-filter");
    if (!tbody || !departmentFilter) return;

    const previousDepartment = departmentFilter.value || "all";
    const faculty = window.db.getFaculty();
    const departments = [...new Set(faculty.map(member => String(member.department || "").trim()).filter(Boolean))]
      .sort((a, b) => a.localeCompare(b, undefined, { sensitivity: "base" }));
    departmentFilter.innerHTML = `<option value="all">All Departments</option>${departments.map(department =>
      `<option value="${this.escapeHTML(department)}">${this.escapeHTML(department)}</option>`
    ).join("")}`;
    departmentFilter.value = departments.includes(previousDepartment) ? previousDepartment : "all";

    const search = (document.getElementById("faculty-search-input")?.value || "").trim().toLowerCase();
    const sortBy = document.getElementById("faculty-sort-select")?.value || "name-asc";
    const collator = new Intl.Collator(undefined, { sensitivity: "base", numeric: true });
    const sortField = sortBy === "department" || sortBy === "designation" || sortBy === "phone"
      ? sortBy
      : "name";
    const direction = sortBy === "name-desc" ? -1 : 1;
    const visibleFaculty = faculty
      .filter(member => departmentFilter.value === "all" || member.department === departmentFilter.value)
      .filter(member => !search || [
        member.name,
        member.department,
        member.designation,
        member.phone
      ].some(value => String(value || "").toLowerCase().includes(search)))
      .sort((a, b) => direction * collator.compare(String(a[sortField] || ""), String(b[sortField] || "")) ||
        collator.compare(String(a.name || ""), String(b.name || "")));

    if (!visibleFaculty.length) {
      tbody.innerHTML = `<tr><td colspan="7" style="text-align: center; padding: 40px;">No faculty records found.</td></tr>`;
      return;
    }
    tbody.innerHTML = visibleFaculty.map(member => `
      <tr>
        <td><span class="isbn-code">${this.escapeHTML(member.faculty_id || "—")}</span></td>
        <td><strong style="color: var(--text-primary);">${this.escapeHTML(member.name)}</strong></td>
        <td>${this.escapeHTML(member.designation)}</td>
        <td><span class="badge badge-accent">${this.escapeHTML(member.department)}</span></td>
        <td>${this.escapeHTML(member.phone)}</td>
        <td>${this.escapeHTML(member.email)}</td>
        <td>
          <div class="action-btn-group">
            <button class="btn btn-secondary btn-sm btn-icon-only" title="Edit" aria-label="Edit ${this.escapeHTML(member.name)}" onclick="window.app.openEditFacultyModal(${member.id})">✏️</button>
            <button class="btn btn-danger btn-sm btn-icon-only" title="Delete" aria-label="Delete ${this.escapeHTML(member.name)}" onclick="window.app.deleteFaculty(${member.id})">🗑️</button>
          </div>
        </td>
      </tr>
    `).join("");
  }

  openAddFacultyModal() {
    document.getElementById("form-faculty")?.reset();
    document.getElementById("faculty-modal-id").value = "";
    document.getElementById("modal-faculty-title").textContent = "Add Faculty";
    document.querySelector("#form-faculty button[type='submit']").textContent = "Save Faculty";
    document.getElementById("modal-faculty").classList.add("active");
  }

  openEditFacultyModal(id) {
    const member = window.db.getFacultyById(id);
    if (!member) return;
    document.getElementById("faculty-modal-id").value = member.id;
    document.getElementById("faculty-modal-faculty-id").value = member.faculty_id || "";
    document.getElementById("faculty-modal-name").value = member.name;
    document.getElementById("faculty-modal-designation").value = member.designation;
    document.getElementById("faculty-modal-department").value = member.department;
    document.getElementById("faculty-modal-phone").value = member.phone;
    document.getElementById("faculty-modal-email").value = member.email;
    document.getElementById("modal-faculty-title").textContent = "Edit Faculty Details";
    document.querySelector("#form-faculty button[type='submit']").textContent = "Save Changes";
    document.getElementById("modal-faculty").classList.add("active");
  }

  submitFacultyForm(event) {
    event.preventDefault();
    const id = document.getElementById("faculty-modal-id").value;
    const facultyData = {
      faculty_id: document.getElementById("faculty-modal-faculty-id").value,
      name: document.getElementById("faculty-modal-name").value,
      designation: document.getElementById("faculty-modal-designation").value,
      department: document.getElementById("faculty-modal-department").value,
      phone: document.getElementById("faculty-modal-phone").value,
      email: document.getElementById("faculty-modal-email").value
    };
    try {
      if (id) {
        window.db.updateFaculty(id, facultyData);
        this.showToast("Faculty Updated", `${facultyData.name.trim()}'s details were saved.`, "success");
      } else {
        window.db.addFaculty(facultyData);
        this.showToast("Faculty Added", `${facultyData.name.trim()} was added to the directory.`, "success");
      }
      this.closeModal("modal-faculty");
      this.renderFaculty();
    } catch (error) {
      this.showToast("Could Not Save Faculty", error.message, "danger");
    }
  }

  deleteFaculty(id) {
    const member = window.db.getFacultyById(id);
    if (!member || !confirm(`Are you sure you want to delete '${member.name}' from the faculty directory?`)) return;
    try {
      if (window.db.deleteFaculty(id)) {
        this.showToast("Faculty Deleted", `${member.name} was removed from the directory.`, "info");
        this.renderFaculty();
      }
    } catch (error) { this.showToast("Faculty Has Active Loan", error.message, "warning"); }
  }

  // --- View 4: Issue Book Desk ---
  findStudentForIssueSearch(value) {
    const normalize = (text) => String(text || "")
      .toLowerCase()
      .replace(/[—–]/g, "-")
      .replace(/\s+/g, " ")
      .trim();
    const input = normalize(value);
    if (!input) return null;

    const students = window.db.getStudents();
    const exactMatch = students.find(student => {
      const baseDisplay = `${student.name} (${student.roll_no})`;
      const fullDisplay = student.department ? `${baseDisplay} — ${student.department}` : baseDisplay;
      return normalize(fullDisplay) === input ||
        normalize(baseDisplay) === input ||
        normalize(student.roll_no) === input ||
        normalize(student.email) === input ||
        normalize(student.phone) === input;
    });
    if (exactMatch) return exactMatch;

    const rollNoInLabel = input.match(/\(([^)]+)\)/)?.[1];
    return rollNoInLabel
      ? students.find(student => normalize(student.roll_no) === normalize(rollNoInLabel)) || null
      : null;
  }

  getIssueDraftStorageKey() {
    const accountName = encodeURIComponent(String(window.adminDisplayName || "unknown").toLowerCase());
    return `dgi_issue_form_draft_${accountName}`;
  }

  saveIssueDraft() {
    const draft = {
      selectedBookForIssue: document.getElementById("issue-book-select")?.value || "",
      issueStudentMode: this.issueStudentMode || "existing",
      selectedStudentForIssue: this.selectedStudentForIssue || document.getElementById("issue-student-select")?.value || "",
      issueStudentSearch: document.getElementById("issue-student-search")?.value || "",
      issueDate: document.getElementById("issue-date")?.value || "",
      loanPeriod: document.getElementById("issue-loan-period")?.value || "7",
      dueDate: document.getElementById("issue-due-date")?.value || "",
      remarks: document.getElementById("issue-remarks")?.value || "",
      issueInlineRoll: document.getElementById("issue-inline-roll")?.value || "",
      issueInlineName: document.getElementById("issue-inline-name")?.value || "",
      issueInlineDept: document.getElementById("issue-inline-dept")?.value || "",
      issueInlinePhone: document.getElementById("issue-inline-phone")?.value || "",
      issueInlineEmail: document.getElementById("issue-inline-email")?.value || ""
    };
    localStorage.setItem(this.getIssueDraftStorageKey(), JSON.stringify(draft));
  }

  restoreIssueDraft() {
    if (this.issueDraftRestored) return;
    this.issueDraftRestored = true;

    const raw = localStorage.getItem(this.getIssueDraftStorageKey());
    if (!raw) return;

    try {
      const draft = JSON.parse(raw);
      if (!draft || typeof draft !== "object") return;

      const bookSelect = document.getElementById("issue-book-select");
      if (bookSelect && draft.selectedBookForIssue) {
        bookSelect.value = draft.selectedBookForIssue;
      }

      const studentSearch = document.getElementById("issue-student-search");
      const studentSelect = document.getElementById("issue-student-select");
      if (studentSearch && draft.issueStudentSearch) studentSearch.value = draft.issueStudentSearch;
      const studentSearchMatch = studentSearch?.value
        ? this.findStudentForIssueSearch(studentSearch.value)
        : null;
      const savedStudent = draft.selectedStudentForIssue
        ? window.db.getStudentById(draft.selectedStudentForIssue)
        : null;
      const restoredStudent = studentSearchMatch || savedStudent;
      if (studentSelect && restoredStudent) {
        studentSelect.value = String(restoredStudent.id);
        this.selectedStudentForIssue = restoredStudent.id;
      } else {
        this.selectedStudentForIssue = null;
      }

      const issueDateInput = document.getElementById("issue-date");
      if (issueDateInput && draft.issueDate) issueDateInput.value = draft.issueDate;

      const loanPeriodSelect = document.getElementById("issue-loan-period");
      if (loanPeriodSelect) {
        const savedPeriod = ["7", "14"].includes(String(draft.loanPeriod)) ? String(draft.loanPeriod) : "";
        const inferredPeriod = issueDateInput?.value && draft.dueDate &&
          this.getDateDifferenceInDays(issueDateInput.value, draft.dueDate) === 14 ? "14" : "7";
        loanPeriodSelect.value = savedPeriod || inferredPeriod;
      }

      const dueDateInput = document.getElementById("issue-due-date");
      if (dueDateInput && draft.dueDate) dueDateInput.value = draft.dueDate;

      const remarksInput = document.getElementById("issue-remarks");
      if (remarksInput && draft.remarks) remarksInput.value = draft.remarks;

      const rollInput = document.getElementById("issue-inline-roll");
      const nameInput = document.getElementById("issue-inline-name");
      const deptInput = document.getElementById("issue-inline-dept");
      const phoneInput = document.getElementById("issue-inline-phone");
      const emailInput = document.getElementById("issue-inline-email");
      if (rollInput && draft.issueInlineRoll) rollInput.value = draft.issueInlineRoll;
      if (nameInput && draft.issueInlineName) nameInput.value = draft.issueInlineName;
      if (deptInput && draft.issueInlineDept) deptInput.value = draft.issueInlineDept;
      if (phoneInput && draft.issueInlinePhone) phoneInput.value = draft.issueInlinePhone;
      if (emailInput && draft.issueInlineEmail) emailInput.value = draft.issueInlineEmail;

      if (draft.issueStudentMode) {
        this.setIssueStudentMode(draft.issueStudentMode);
      }

      if (draft.issueInlineRoll || draft.issueInlinePhone || draft.issueInlineEmail) {
        this.checkExistingStudentInline();
      }
    } catch (_) {
      localStorage.removeItem(this.getIssueDraftStorageKey());
    }
  }

  clearIssueDraft() {
    localStorage.removeItem(this.getIssueDraftStorageKey());
  }

  addDaysToDate(dateString, days) {
    if (!dateString) return "";
    const [year, month, day] = dateString.split("-").map(Number);
    const date = new Date(year, month - 1, day);
    if (Number.isNaN(date.getTime())) return "";
    date.setDate(date.getDate() + Number(days));
    return [
      date.getFullYear(),
      String(date.getMonth() + 1).padStart(2, "0"),
      String(date.getDate()).padStart(2, "0")
    ].join("-");
  }

  getDateDifferenceInDays(startDate, endDate) {
    const start = new Date(`${startDate}T00:00:00`);
    const end = new Date(`${endDate}T00:00:00`);
    return Math.round((end - start) / (24 * 60 * 60 * 1000));
  }

  updateIssueDueDate() {
    const issueDate = document.getElementById("issue-date")?.value;
    const loanPeriod = document.getElementById("issue-loan-period")?.value;
    const dueDateInput = document.getElementById("issue-due-date");
    if (!dueDateInput || !["7", "14"].includes(String(loanPeriod))) return;
    dueDateInput.value = this.addDaysToDate(issueDate, loanPeriod);
    this.saveIssueDraft();
  }

  renderIssueStudentOptions() {
    const studentSelect = document.getElementById("issue-student-select");
    const studentSearch = document.getElementById("issue-student-search");
    const studentOptions = document.getElementById("issue-student-options");
    if (!studentSelect || !studentSearch || !studentOptions) return;

    const students = window.db.getStudents();
    const searchValue = studentSearch.value.trim();
    const search = searchValue.toLowerCase();
    const typedStudent = searchValue ? this.findStudentForIssueSearch(searchValue) : null;
    if (searchValue) {
      this.selectedStudentForIssue = typedStudent?.id || null;
      studentSelect.value = typedStudent ? String(typedStudent.id) : "";
    }

    const matchingStudents = students.filter(student =>
      [student.name, student.roll_no, student.department, student.phone, student.email]
        .some(value => String(value || "").toLowerCase().includes(search))
    );
    const selectedStudent = students.find(student => student.id === Number(this.selectedStudentForIssue));
    if (selectedStudent && !matchingStudents.some(student => student.id === selectedStudent.id)) {
      matchingStudents.unshift(selectedStudent);
    }

    const formatStudentDisplay = student => `${student.name} (${student.roll_no})`;
    studentOptions.innerHTML = matchingStudents.map(student => `
      <option value="${this.escapeHTML(formatStudentDisplay(student))}"></option>
    `).join("");
    studentSelect.innerHTML = `<option value="">-- Select Registered Student --</option>` +
      matchingStudents.map(student => `
        <option value="${student.id}" ${String(this.selectedStudentForIssue || "") === String(student.id) ? "selected" : ""}>
          ${this.escapeHTML(formatStudentDisplay(student))}
        </option>
      `).join("");

    if (selectedStudent && (!searchValue || typedStudent)) {
      studentSearch.value = formatStudentDisplay(selectedStudent);
    }
    this.updateIssueSelectedStudentInfo(selectedStudent || null);
  }

  renderIssueForm() {
    const bookSelect = document.getElementById("issue-book-select");
    const bookSearch = document.getElementById("issue-book-search");
    const bookList = document.getElementById("issue-book-options");
    const issueDateInput = document.getElementById("issue-date");
    if (issueDateInput && !issueDateInput.value) {
      issueDateInput.value = new Date().toISOString().split('T')[0];
    }

    if (bookSelect) {
      const books = window.db.getBooks();
      if (bookList) bookList.innerHTML = books.filter(b => Number(b.available) > 0).map(b => `<option value="${this.escapeHTML(this.getIssueBookLabel(b))}"></option>`).join("");
      bookSelect.innerHTML = `<option value="">-- Choose Book from Catalog --</option>` +
        books.map(b => `
          <option value="${b.id}" ${b.available === 0 ? 'disabled' : ''} ${this.selectedBookForIssue == b.id ? 'selected' : ''}>
            ${this.escapeHTML(b.title)} (${b.available > 0 ? `${this.escapeHTML(b.available)} avail` : 'OUT OF STOCK'}) — ${this.escapeHTML(b.isbn)}
          </option>
        `).join("");
      if (this.selectedBookForIssue) {
        bookSelect.value = String(this.selectedBookForIssue);
        if (bookSearch && !bookSearch.value) bookSearch.value = this.getIssueBookLabel(books.find(b => Number(b.id) === Number(this.selectedBookForIssue)) || {});
      }
      this.updateIssueSelectedBookInfo();
    }

    const faculty = window.db.getFaculty();
    const facultyList = document.getElementById("issue-faculty-options");
    if (facultyList) facultyList.innerHTML = faculty.map(f => `<option value="${this.escapeHTML(this.getIssueFacultyLabel(f))}"></option>`).join("");
    this.updateIssueBorrowerMode();

    this.restoreIssueDraft();
    const dueDateInput = document.getElementById("issue-due-date");
    if (dueDateInput && !dueDateInput.value) this.updateIssueDueDate();
    this.renderIssueStudentOptions();

    ["issue-book-select", "issue-book-search", "issue-student-search", "issue-student-select", "issue-date", "issue-loan-period", "issue-due-date", "issue-remarks", "issue-inline-roll", "issue-inline-name", "issue-inline-dept", "issue-inline-phone", "issue-inline-email", "issue-faculty-search"].forEach((elementId) => {
      const element = document.getElementById(elementId);
      if (!element || element.dataset.issueDraftBound === "true") return;
      ["input", "change"].forEach((eventName) => {
        element.addEventListener(eventName, () => this.saveIssueDraft());
      });
      element.dataset.issueDraftBound = "true";
    });

    this.setIssueStudentMode(this.issueStudentMode || "existing");
  }

  getIssueBookLabel(book) {
    if (!book?.id) return "";
    const accessions = Array.isArray(book.accessionNos) ? book.accessionNos.join(", ") : (book.accessionNo || "");
    return [book.title, accessions && `Accession ${accessions}`, book.isbn && `ISBN ${book.isbn}`, book.author, book.category].filter(Boolean).join(" · ");
  }

  updateIssueSelectedBookInfo() {
    const select = document.getElementById("issue-book-select");
    const info = document.getElementById("issue-selected-book-info");
    const book = window.db.getBooks().find(item => Number(item.id) === Number(select?.value));
    if (!info) return;
    if (!book) { info.style.display = "none"; info.innerHTML = ""; return; }
    info.style.display = "block";
    info.innerHTML = `<strong>${this.escapeHTML(book.title)}</strong><br>Author: ${this.escapeHTML(book.author || "—")} · ISBN: ${this.escapeHTML(book.isbn || "—")} · Category: ${this.escapeHTML(book.category || "General")} · Available: ${this.escapeHTML(book.available)}`;
  }

  getIssueFacultyLabel(faculty) { return `${faculty.name} · ID ${faculty.faculty_id || faculty.id} · ${faculty.department || ""}`; }

  findFacultyForIssueSearch(query) {
    const normalized = String(query || "").trim().toLowerCase();
    if (!normalized) return null;
    return window.db.getFaculty().find(f => this.getIssueFacultyLabel(f).toLowerCase() === normalized || String(f.faculty_id || "").toLowerCase() === normalized || String(f.id) === normalized || String(f.name || "").toLowerCase() === normalized) || null;
  }

  updateIssueFacultyInfo() {
    const input = document.getElementById("issue-faculty-search");
    const info = document.getElementById("issue-selected-faculty-info");
    const faculty = this.findFacultyForIssueSearch(input?.value);
    if (!info) return;
    info.style.display = faculty ? "block" : "none";
    info.innerHTML = faculty ? `<strong>${this.escapeHTML(faculty.name)}</strong><br>${this.escapeHTML(faculty.faculty_id || `ID ${faculty.id}`)} · ${this.escapeHTML(faculty.designation)} · ${this.escapeHTML(faculty.department)} · ${this.escapeHTML(faculty.phone)}` : "";
  }

  updateIssueBorrowerMode() {
    const isFaculty = document.getElementById("issue-borrower-type")?.value === "faculty";
    const student = document.getElementById("issue-student-container");
    const faculty = document.getElementById("issue-faculty-container");
    if (student) student.style.display = isFaculty ? "none" : "block";
    if (faculty) faculty.style.display = isFaculty ? "block" : "none";
  }

  setIssueStudentMode(mode = "existing") {
    this.issueStudentMode = mode;
    const btnExisting = document.getElementById("btn-issue-mode-existing");
    const btnNew = document.getElementById("btn-issue-mode-new");
    const containerExisting = document.getElementById("issue-existing-student-container");
    const containerNew = document.getElementById("issue-new-student-container");

    if (btnExisting && btnNew) {
      if (mode === "existing") {
        btnExisting.className = "btn btn-sm btn-primary";
        btnNew.className = "btn btn-sm btn-secondary";
      } else {
        btnExisting.className = "btn btn-sm btn-secondary";
        btnNew.className = "btn btn-sm btn-primary";
      }
    }

    if (containerExisting && containerNew) {
      containerExisting.style.display = mode === "existing" ? "block" : "none";
      containerNew.style.display = mode === "new" ? "block" : "none";
    }

    if (mode === "new") {
      this.updateIssueSelectedStudentInfo(null);
      const rollInput = document.getElementById("issue-inline-roll");
      const phoneInput = document.getElementById("issue-inline-phone");
      if (phoneInput && !phoneInput.value) {
        phoneInput.value = "+91";
      }
      if (rollInput && !rollInput.value) {
        setTimeout(() => rollInput.focus(), 60);
      }
    }

    this.saveIssueDraft();
  }

  checkExistingStudentInline() {
    const rollInput = document.getElementById("issue-inline-roll");
    const nameInput = document.getElementById("issue-inline-name");
    const deptInput = document.getElementById("issue-inline-dept");
    const phoneInput = document.getElementById("issue-inline-phone");
    const emailInput = document.getElementById("issue-inline-email");
    const notice = document.getElementById("issue-inline-match-notice");
    const badge = document.getElementById("issue-inline-badge");

    if (!rollInput || !notice) return;

    const rollNo = rollInput.value.trim();
    const phone = phoneInput?.value.trim() || "";
    const email = emailInput?.value.trim() || "";

    const match = window.db.findMatchingStudent({ roll_no: rollNo, phone, email });

    const prevMatch = this.inlineExistingStudentId ? window.db.getStudentById(this.inlineExistingStudentId) : null;
    this.inlineExistingStudentId = match ? match.id : null;

    if (!match) {
      if (prevMatch) {
        if (nameInput && nameInput.value === prevMatch.name) nameInput.value = "";
        if (deptInput && deptInput.value === prevMatch.department) deptInput.value = "";
        if (phoneInput && phoneInput.value === prevMatch.phone) phoneInput.value = "";
        if (emailInput && emailInput.value === prevMatch.email) emailInput.value = "";
      }
      notice.style.display = "none";
      if (badge) {
        badge.className = "badge badge-info";
        badge.textContent = rollNo ? "New Student Entry" : "Live Roll No. Lookup";
      }
      return;
    }

    // Auto-fill existing student details
    if (nameInput) nameInput.value = match.name;
    if (deptInput) deptInput.value = match.department || "";
    if (phoneInput) phoneInput.value = match.phone;
    if (emailInput) emailInput.value = match.email;

    const activeLoans = window.db.getTransactions().filter(t => t.student_id === match.id && t.status === 'issued').length;

    notice.innerHTML = `
      <div style="display: flex; align-items: flex-start; gap: 8px;">
        <span style="font-size: 16px;">ℹ️</span>
        <div>
          <strong>Student Already Registered!</strong><br/>
          <span>${this.escapeHTML(match.name)} (Roll No: <code>${this.escapeHTML(match.roll_no)}</code>) is already enrolled in the library system.</span><br/>
          <span style="font-size: 11.5px; opacity: 0.9;">Saved details have been automatically filled. This <strong>existing record (#${match.id})</strong> will be used for issuing this book (no duplicate student record will be created). Currently active loans: <strong>${activeLoans}/4</strong>.</span>
        </div>
      </div>
    `;
    notice.style.display = "block";

    if (badge) {
      badge.className = "badge badge-success";
      badge.textContent = "Existing Student Linked";
    }

    const studentSelect = document.getElementById("issue-student-select");
    if (studentSelect) {
      studentSelect.value = match.id;
      this.updateIssueSelectedStudentInfo(match);
    }
  }

  updateIssueSelectedStudentInfo(student) {
    const infoBox = document.getElementById("issue-selected-student-info");
    if (!infoBox) return;
    const behaviourPanel = document.getElementById("issue-student-behaviour-panel");
    if (!student) {
      infoBox.style.display = "none";
      infoBox.innerHTML = "";
      if (behaviourPanel) {
        behaviourPanel.style.display = "none";
        behaviourPanel.replaceChildren();
      }
      return;
    }
    const activeLoans = window.db.getTransactions().filter(t => Number(t.student_id) === Number(student.id) && t.status === 'issued').length;
    infoBox.innerHTML = `
      <div style="display:flex; justify-content:space-between; align-items:center; flex-wrap:wrap; gap:6px;">
        <span><strong>${this.escapeHTML(student.name)}</strong> (Roll: <code>${this.escapeHTML(student.roll_no)}</code>) — ${this.escapeHTML(student.department || 'Academic')}</span>
        <span class="badge ${activeLoans >= 4 ? 'badge-danger' : activeLoans > 0 ? 'badge-warning' : 'badge-success'}">
          ${activeLoans}/4 Books Borrowed ${activeLoans >= 4 ? '(Max Limit Reached)' : ''}
        </span>
      </div>
      <div style="font-size:11.5px; margin-top:4px; opacity:0.85;">📞 ${this.escapeHTML(student.phone)} | ✉️ ${this.escapeHTML(student.email)}</div>
    `;
    infoBox.style.display = "block";
    this.renderStudentBehaviourPanel(student);
  }

  renderStudentBehaviourPanel(student) {
    const panel = document.getElementById("issue-student-behaviour-panel");
    if (!panel) return;
    const transactions = window.db.getTransactions()
      .filter(transaction => Number(transaction.student_id) === Number(student.id));
    const activeLoans = transactions.filter(transaction => transaction.status === "issued");
    const overdueLoans = activeLoans.filter(transaction => transaction.days_late > 0);
    const returnedLoans = transactions.filter(transaction => transaction.status === "returned");
    const lateReturns = returnedLoans.filter(transaction => {
      if (!transaction.return_date || !transaction.due_date) return false;
      const returned = Date.parse(`${transaction.return_date}T00:00:00Z`);
      const due = Date.parse(`${transaction.due_date}T00:00:00Z`);
      return Number.isFinite(returned) && Number.isFinite(due) && returned > due;
    });
    const latestReturns = [...returnedLoans]
      .sort((left, right) => Date.parse(right.return_date) - Date.parse(left.return_date))
      .slice(0, 3);
    const lastThreeReturnsWereLate = latestReturns.length === 3 &&
      latestReturns.every(transaction => lateReturns.includes(transaction));
    const onTimeReturns = returnedLoans.length - lateReturns.length;
    const unpaidReturnedFines = returnedLoans
      .filter(transaction => !["paid", "waived"].includes(transaction.fine_status))
      .reduce((sum, transaction) => sum + Math.max(0, Number(transaction.fine) || 0), 0);
    const pendingFine = overdueLoans.reduce((sum, transaction) =>
      sum + Math.max(0, Number(transaction.calculated_fine) || 0), unpaidReturnedFines);
    const isDefaulter = overdueLoans.length > 0 || pendingFine >= 100 || lateReturns.length >= 3;
    const isGoodStudent = !isDefaulter && pendingFine === 0 && lateReturns.length === 0;
    const isWarning = !isDefaulter && !isGoodStudent;
    const status = isDefaulter ? "Defaulter" : isWarning ? "Warning" : "Good Student";
    const statusClass = isDefaulter ? "badge-danger" : isWarning ? "badge-warning" : "badge-success";
    const statusIcon = isDefaulter ? "🔴" : isWarning ? "🟡" : "🟢";
    const reasons = [];
    if (isGoodStudent) {
      reasons.push("✓ No overdue books", "✓ No pending fine", `✓ Good return history (${onTimeReturns} on-time returns)`);
    } else {
      if (overdueLoans.length) reasons.push(`${overdueLoans.length} book${overdueLoans.length === 1 ? "" : "s"} overdue`);
      if (pendingFine > 0) reasons.push(`₹${pendingFine.toFixed(2)} pending fine`);
      if (lastThreeReturnsWereLate) {
        reasons.push("Last 3 returns were late");
      } else if (lateReturns.length) {
        reasons.push(`${lateReturns.length} late return${lateReturns.length === 1 ? "" : "s"}`);
        if (latestReturns[0] && lateReturns.includes(latestReturns[0])) reasons.push("Return delay recorded");
      }
      if (!isDefaulter && !reasons.length) reasons.push("No late returns recorded");
    }

    const historyRows = transactions.map(transaction => `
      <li style="margin-bottom:6px;">
        <strong>${this.escapeHTML(transaction.book_title)}</strong>
        <span class="badge ${transaction.status === "issued" ? "badge-warning" : "badge-success"}">${this.escapeHTML(transaction.status)}</span>
        <div style="font-size:11px;color:var(--text-muted);">Issued ${this.escapeHTML(transaction.issue_date)} · Due ${this.escapeHTML(transaction.due_date)}${transaction.return_date ? ` · Returned ${this.escapeHTML(transaction.return_date)}` : ""}</div>
      </li>
    `).join("") || "<li>No previous transactions.</li>";
    const fineRows = transactions
      .filter(transaction => Number(transaction.calculated_fine || transaction.fine) > 0)
      .map(transaction => {
        const amount = transaction.status === "issued" ? transaction.calculated_fine : transaction.fine;
        const fineStatus = ["paid", "waived"].includes(transaction.fine_status) ? transaction.fine_status : "pending";
        return `<li style="margin-bottom:6px;">${this.escapeHTML(transaction.book_title)} — ₹${Number(amount || 0).toFixed(2)} (${this.escapeHTML(fineStatus)})</li>`;
      }).join("") || "<li>No fines recorded.</li>";
    const phoneAvailable = Boolean(String(student.phone || "").replace(/\D/g, ""));
    const blocked = Boolean(student.library_blocked);
    const permissionAvailable = Boolean(student.issue_permission);
    const actionLabel = blocked ? "Unblock Library Account" : "Block Library Account";
    const buttonClass = blocked ? "btn btn-secondary btn-sm" : "btn btn-danger btn-sm";

    panel.innerHTML = `
      <div style="border:1px solid var(--border-color);border-radius:var(--radius-md);padding:16px;background:var(--bg-card);">
        <div style="display:flex;justify-content:space-between;align-items:center;gap:8px;flex-wrap:wrap;">
          <div class="card-title" style="margin:0;">Student Behaviour</div>
          <span class="badge ${statusClass}">${statusIcon} ${status}</span>
        </div>
        <div style="margin-top:10px;font-size:12px;color:var(--text-secondary);">
          <strong>Reason:</strong>
          ${reasons.map(reason => `<div>${this.escapeHTML(isGoodStudent ? reason : `- ${reason}`)}</div>`).join("")}
          <div style="margin-top:5px;">Active loans: ${activeLoans.length}/4 · Total issues: ${transactions.length}</div>
          <div style="margin-top:5px;"><strong>Account:</strong> ${blocked ? "Blocked" : "Active"}${permissionAvailable ? " · One-time issue permission available" : ""}</div>
        </div>
        <div style="display:flex;flex-wrap:wrap;gap:7px;margin-top:12px;">
          <button type="button" class="btn btn-secondary btn-sm" onclick="window.app.toggleIssueStudentDetails('history')">View Full History</button>
          <button type="button" class="btn btn-secondary btn-sm" onclick="window.app.toggleIssueStudentDetails('fines')">View Fine Details</button>
          <button type="button" class="btn btn-primary btn-sm" ${phoneAvailable ? "" : "disabled"} onclick="window.app.sendIssueStudentReminder(${Number(student.id)})">Send Reminder</button>
          <button type="button" class="${buttonClass}" onclick="window.app.toggleStudentLibraryBlock(${Number(student.id)})">${actionLabel}</button>
          ${blocked && !permissionAvailable ? `<button type="button" class="btn btn-primary btn-sm" onclick="window.app.allowStudentIssue(${Number(student.id)})">Allow Issue with Permission</button>` : ""}
        </div>
        <details id="issue-student-history-details" style="display:none;margin-top:12px;">
          <summary style="cursor:pointer;">Transaction History (${transactions.length})</summary>
          <ul style="padding-left:18px;font-size:12px;">${historyRows}</ul>
        </details>
        <details id="issue-student-fines-details" style="display:none;margin-top:12px;">
          <summary style="cursor:pointer;">Fine Details · ₹${pendingFine.toFixed(2)} pending</summary>
          <ul style="padding-left:18px;font-size:12px;">${fineRows}</ul>
        </details>
      </div>`;
    panel.style.display = "block";
  }

  toggleIssueStudentDetails(section) {
    const targetId = section === "fines" ? "issue-student-fines-details" : "issue-student-history-details";
    const details = document.getElementById(targetId);
    if (details) {
      details.style.display = "block";
      details.open = !details.open;
    }
  }

  toggleStudentLibraryBlock(studentId) {
    const student = window.db.getStudentById(studentId);
    if (!student) return;
    const blocked = Boolean(student.library_blocked);
    if (!confirm(`${blocked ? "Unblock" : "Block"} the library account for ${student.name}?`)) return;
    try {
      window.db.updateStudent(student.id, {
        library_blocked: !blocked,
        issue_permission: blocked ? false : Boolean(student.issue_permission)
      });
      this.updateIssueSelectedStudentInfo(window.db.getStudentById(student.id));
      this.showToast("Library Account Updated", `${student.name}'s account is now ${blocked ? "active" : "blocked"}.`, "success");
    } catch (error) {
      this.showToast("Account Update Failed", error.message, "danger");
    }
  }

  allowStudentIssue(studentId) {
    const student = window.db.getStudentById(studentId);
    if (!student || !student.library_blocked) return;
    if (!confirm(`Allow one book issue to ${student.name}? The permission will be used on their next issue.`)) return;
    try {
      window.db.updateStudent(student.id, { issue_permission: true });
      this.updateIssueSelectedStudentInfo(window.db.getStudentById(student.id));
      this.showToast("One-Time Permission Granted", `${student.name} can issue one book while the account remains blocked.`, "success");
    } catch (error) {
      this.showToast("Permission Not Granted", error.message, "danger");
    }
  }

  async sendIssueStudentReminder(studentId) {
    const student = window.db.getStudentById(studentId);
    if (!student) return;
    const transaction = window.db.getTransactions()
      .filter(item => Number(item.student_id) === Number(student.id) && item.status === "issued")
      .sort((left, right) => Date.parse(left.due_date) - Date.parse(right.due_date))[0];
    if (!transaction) {
      this.showToast("No Active Loan", "There is no active book loan to include in a reminder.", "info");
      return;
    }
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const dueDate = new Date(`${transaction.due_date}T00:00:00`);
    const daysLeft = Math.ceil((dueDate - today) / (24 * 60 * 60 * 1000));
    const alert = {
      ...transaction,
      days_left: daysLeft,
      days_overdue: Math.max(0, -daysLeft),
      calculated_fine: transaction.calculated_fine || 0
    };
    const message = this.generateAlertMessage(alert);
    await this.sendWhatsAppMessage(alert, message, daysLeft < 0 ? "overdue" : "reminder");
  }

  quickIssueBook(bookId) {
    this.selectedBookForIssue = bookId;
    this.switchView("issue");
  }

  selectStudentForIssue(student) {
    this.selectedStudentForIssue = student.id;
    this.issueStudentMode = "existing";
    const studentSearch = document.getElementById("issue-student-search");
    if (studentSearch) studentSearch.value = `${student.name} (${student.roll_no})`;
    this.switchView("issue");
    this.setIssueStudentMode("existing");
    const studentSelect = document.getElementById("issue-student-select");
    if (studentSelect) studentSelect.value = student.id;
    this.updateIssueSelectedStudentInfo(student);
    this.showToast("Student Selected", `${student.name} (${student.roll_no}) is selected for issue.`, "success");
  }

  submitIssueBook(e) {
    e.preventDefault();
    const bookId = document.getElementById("issue-book-select")?.value;
    const issueDate = document.getElementById("issue-date")?.value;
    const dueDate = document.getElementById("issue-due-date")?.value;
    const remarks = document.getElementById("issue-remarks")?.value || "";

    if (!bookId) {
      this.showToast("Missing Information", "Please select a book from the catalog.", "warning");
      return;
    }
    if (!issueDate) {
      this.showToast("Missing Information", "Please specify the issue date.", "warning");
      return;
    }
    if (!dueDate) {
      this.showToast("Missing Information", "Please specify a return due date.", "warning");
      return;
    }
    if (new Date(dueDate) < new Date(issueDate)) {
      this.showToast("Invalid Dates", "Due date cannot be earlier than the issue date.", "warning");
      return;
    }

    if (document.getElementById("issue-borrower-type")?.value === "faculty") {
      const facultyLabel = document.getElementById("issue-faculty-search")?.value || "";
      const faculty = this.findFacultyForIssueSearch(facultyLabel);
      const normalizedFaculty = facultyLabel.trim().toLowerCase();
      if (!faculty || ![this.getIssueFacultyLabel(faculty).toLowerCase(), String(faculty.faculty_id || "").toLowerCase(), String(faculty.id), String(faculty.name || "").toLowerCase()].includes(normalizedFaculty)) {
        this.showToast("Select Faculty", "Choose a faculty member from the suggestions by Faculty ID or name.", "warning");
        return;
      }
      try {
        const tx = window.db.issueFacultyBook(bookId, faculty.id, dueDate, remarks, issueDate);
        this.showToast("Book Issued Successfully!", `${tx.book_title} issued to ${faculty.name}. Faculty transaction #F-${tx.id} recorded.`, "success");
        this.openIssueSlipModal(`faculty:${tx.id}`);
        this.selectedBookForIssue = null;
        this.selectedStudentForIssue = null;
        this.inlineExistingStudentId = null;
        document.getElementById("issue-book-form")?.reset();
        this.clearIssueDraft();
        this.setIssueStudentMode("existing");
        document.getElementById("issue-date").value = new Date().toISOString().slice(0, 10);
        this.renderIssueForm();
        this.renderDashboard();
      } catch (error) { this.showToast("Issue Failed", error.message, "danger"); }
      return;
    }

    let finalStudentId = null;
    let studentDisplayName = "";
    let isExistingReuse = false;

    if (this.issueStudentMode === "new") {
      const rollNo = document.getElementById("issue-inline-roll")?.value.trim();
      const name = document.getElementById("issue-inline-name")?.value.trim();
      const dept = document.getElementById("issue-inline-dept")?.value.trim() || "Academic";
      const phone = this.normalizePhoneNumber(document.getElementById("issue-inline-phone")?.value);
      const email = document.getElementById("issue-inline-email")?.value.trim();

      if (!rollNo || !name || !phone || !email) {
        this.showToast("Missing Details", "Please fill in Roll Number, Full Name, Phone, and Email to register/identify student.", "warning");
        return;
      }

      // Check if student already exists in database (by ID, Roll No, Phone, or Email)
      let matchedStudent = this.inlineExistingStudentId ? window.db.getStudentById(this.inlineExistingStudentId) : null;
      if (!matchedStudent) {
        matchedStudent = window.db.getStudentByRollNo(rollNo);
      }
      if (!matchedStudent) {
        const students = window.db.getStudents();
        matchedStudent = students.find(s => s.roll_no.trim().toLowerCase() === rollNo.toLowerCase());
      }

      if (matchedStudent) {
        // STUDENT ALREADY REGISTERED -> USE EXISTING RECORD, DO NOT CREATE DUPLICATE!
        finalStudentId = matchedStudent.id;
        studentDisplayName = matchedStudent.name;
        isExistingReuse = true;

        // Keep profile contact info fresh
        try {
          window.db.updateStudent(matchedStudent.id, {
            name: name || matchedStudent.name,
            phone: phone || matchedStudent.phone,
            email: email || matchedStudent.email,
            department: dept || matchedStudent.department
          });
        } catch (_) {}
      } else {
        // GENUINELY NEW STUDENT -> REGISTER IN DATABASE
        try {
          const newStudent = window.db.addStudent({
            name,
            roll_no: rollNo,
            email,
            phone,
            department: dept
          });
          finalStudentId = newStudent.id;
          studentDisplayName = newStudent.name;
        } catch (addErr) {
          this.showToast("Registration Error", addErr.message, "danger");
          return;
        }
      }
    } else {
      const searchValue = document.getElementById("issue-student-search")?.value.trim() || "";
      const searchMatch = searchValue ? this.findStudentForIssueSearch(searchValue) : null;
      const selectedStudentId = this.selectedStudentForIssue ||
        document.getElementById("issue-student-select")?.value;
      const student = searchValue
        ? searchMatch
        : (selectedStudentId ? window.db.getStudentById(selectedStudentId) : null);

      if (!student || (searchValue && !searchMatch)) {
        this.showToast("Missing Student", "Please select a student from the dropdown or switch to 'Register New Student'.", "warning");
        return;
      }
      finalStudentId = student.id;
      this.selectedStudentForIssue = student.id;
      studentDisplayName = student.name;
    }

    try {
      const issueStudent = window.db.getStudentById(finalStudentId);
      if (issueStudent?.library_blocked && !issueStudent.issue_permission) {
        this.showToast(
          "Library Account Blocked",
          `${issueStudent.name}'s account is blocked. Use Allow Issue with Permission from the side panel to authorize one issue.`,
          "danger"
        );
        return;
      }
      const tx = window.db.issueBook(bookId, finalStudentId, dueDate, remarks, issueDate);
      const successMsg = isExistingReuse 
        ? `Existing profile for ${studentDisplayName} used. Transaction #TX-${tx.id} recorded.`
        : `Book issued to ${studentDisplayName}. Transaction #TX-${tx.id} recorded.`;

      this.showToast("Book Issued Successfully!", successMsg, "success");

      // Generate Printable Receipt
      this.openIssueSlipModal(tx.id);

      // Reset form & state
      this.selectedBookForIssue = null;
      this.selectedStudentForIssue = null;
      this.inlineExistingStudentId = null;
      const issueForm = document.getElementById("issue-book-form");
      issueForm?.reset();
      this.clearIssueDraft();
      const issueDateInput = document.getElementById("issue-date");
      if (issueDateInput) issueDateInput.value = new Date().toISOString().split('T')[0];
      const inlineNotice = document.getElementById("issue-inline-match-notice");
      if (inlineNotice) inlineNotice.style.display = "none";
      this.setIssueStudentMode("existing");
      this.renderIssueForm();
      this.updateNotificationBadge();
    } catch (err) {
      this.showToast("Issue Failed", err.message, "danger");
    }
  }

  // --- View 5: Return Desk ---
  renderReturnDesk() {
    const searchVal = (document.getElementById("return-search-input")?.value || "").toLowerCase().trim();
    let txs = [...window.db.getTransactions(), ...window.db.getFacultyTransactions()].filter(t => t.status === 'issued');

    if (searchVal) {
      txs = txs.filter(t =>
        t.book_title.toLowerCase().includes(searchVal) ||
        t.book_isbn.toLowerCase().includes(searchVal) ||
        t.student_name.toLowerCase().includes(searchVal) ||
        t.student_roll.toLowerCase().includes(searchVal)
      );
    }

    const tbody = document.getElementById("return-table-tbody");
    if (!tbody) return;

    if (txs.length === 0) {
      tbody.innerHTML = `<tr><td colspan="7" style="text-align: center; padding: 40px; color: var(--text-muted);">No issued books waiting for return matching search.</td></tr>`;
    } else tbody.innerHTML = txs.map(t => {
      const isLate = t.days_late > 0;
      return `
        <tr>
          <td><span class="isbn-code">#${t.borrower_type === 'faculty' ? 'F' : 'TX'}-${this.escapeHTML(t.id)}</span></td>
          <td><strong>${this.escapeHTML(t.book_title)}</strong><div style="font-size:11px; color:var(--text-muted);">${this.escapeHTML(t.book_isbn)}</div></td>
          <td>${this.escapeHTML(t.student_name)}<div style="font-size:11px; color:var(--text-muted);">${t.borrower_type === 'faculty' ? 'Faculty ID' : 'Roll No.'}: ${this.escapeHTML(t.student_roll)}</div></td>
          <td>${this.escapeHTML(t.issue_date)}</td>
          <td>${this.escapeHTML(t.due_date)}</td>
          <td>
            ${isLate 
              ? `<span class="badge badge-danger">Late by ${this.escapeHTML(t.days_late)}d (₹${this.escapeHTML(t.calculated_fine)})</span>` 
              : `<span class="badge badge-success">On Schedule</span>`
            }
          </td>
          <td>
            <button class="btn btn-success btn-sm" onclick="window.app.openProcessReturnModal('${t.borrower_type === 'faculty' ? `faculty:${t.id}` : t.id}')">
              📥 Process Return
            </button>
          </td>
        </tr>
      `;
    }).join("");

    const facultyHistory = document.getElementById("faculty-circulation-history-tbody");
    if (facultyHistory) {
      const records = window.db.getFacultyTransactions();
      facultyHistory.innerHTML = records.length ? records.map(t => `
        <tr>
          <td><span class="isbn-code">#F-${this.escapeHTML(t.id)}</span></td>
          <td><strong>${this.escapeHTML(t.book_title)}</strong><div style="font-size:11px;color:var(--text-muted);">${this.escapeHTML(t.book_isbn)}</div></td>
          <td>${this.escapeHTML(t.student_name)}<div style="font-size:11px;color:var(--text-muted);">Faculty ID: ${this.escapeHTML(t.student_roll)}</div></td>
          <td>${this.escapeHTML(t.issue_date)}</td><td>${this.escapeHTML(t.due_date)}</td><td>${this.escapeHTML(t.return_date || "—")}</td>
          <td><span class="badge ${t.status === "issued" ? (t.days_late > 0 ? "badge-danger" : "badge-warning") : "badge-success"}">${t.status === "issued" ? (t.days_late > 0 ? `Overdue · ${this.escapeHTML(t.days_late)}d` : "Issued") : "Returned"}</span></td>
        </tr>`).join("") : `<tr><td colspan="7" style="text-align:center;padding:24px;color:var(--text-muted);">No faculty book issues have been recorded.</td></tr>`;
    }
  }

  openProcessReturnModal(txId) {
    const isFaculty = String(txId).startsWith("faculty:");
    const rawId = isFaculty ? String(txId).split(":")[1] : txId;
    const tx = (isFaculty ? window.db.getFacultyTransactions() : window.db.getTransactions()).find(t => t.id === Number(rawId));
    if (!tx) return;

    const modal = document.getElementById("modal-process-return");
    if (!modal) return;

    document.getElementById("return-tx-id").value = `${isFaculty ? 'faculty:' : ''}${tx.id}`;
    document.getElementById("return-modal-book-title").textContent = tx.book_title;
    document.getElementById("return-modal-student").textContent = `${isFaculty ? 'Faculty' : 'Student'}: ${tx.student_name} (${tx.student_roll})`;
    document.getElementById("return-modal-due-date").textContent = tx.due_date;
    document.getElementById("return-modal-days-late").textContent = `${tx.days_late} days`;
    document.getElementById("return-modal-fine-amount").textContent = `₹${tx.calculated_fine}`;

    const fineActionSelect = document.getElementById("return-fine-action");
    if (fineActionSelect) {
      const paidOption = fineActionSelect.querySelector('option[value="paid"]');
      if (paidOption) paidOption.disabled = tx.calculated_fine <= 0;
      fineActionSelect.value = tx.calculated_fine > 0 ? "paid" : "none";
    }
    const paymentMethod = document.getElementById("return-payment-method");
    if (paymentMethod) paymentMethod.value = "";
    this.updateReturnPaymentMethodVisibility();

    modal.classList.add("active");
  }

  updateReturnPaymentMethodVisibility() {
    const fineAction = document.getElementById("return-fine-action")?.value;
    const paymentGroup = document.getElementById("return-payment-method-group");
    const paymentMethod = document.getElementById("return-payment-method");
    const isPaymentRequired = fineAction === "paid";
    if (paymentGroup) paymentGroup.style.display = isPaymentRequired ? "block" : "none";
    if (paymentMethod) paymentMethod.required = isPaymentRequired;
  }

  submitProcessReturn() {
    const txId = document.getElementById("return-tx-id")?.value;
    const fineAction = document.getElementById("return-fine-action")?.value || "none";
    const paymentMethod = document.getElementById("return-payment-method")?.value || "";
    const remarks = document.getElementById("return-modal-remarks")?.value || "";

    const isFaculty = String(txId).startsWith("faculty:");
    const rawId = isFaculty ? String(txId).split(":")[1] : txId;
    const tx = (isFaculty ? window.db.getFacultyTransactions() : window.db.getTransactions()).find(t => t.id === Number(rawId));
    if (!tx) return;

    const fineAmount = fineAction === "none" ? 0 : tx.calculated_fine;
    if (fineAction === "paid" && fineAmount > 0 && !paymentMethod) {
      this.showToast("Payment Method Required", "Select Cash or UPI before confirming fine collection.", "warning");
      return;
    }

    try {
      if (isFaculty) window.db.returnFacultyBook(rawId, fineAction, fineAmount, remarks, paymentMethod);
      else window.db.returnBook(rawId, fineAction, fineAmount, remarks, paymentMethod);
      this.showToast("Return Processed!", `'${tx.book_title}' has been returned to the catalog.`, "success");

      this.closeModal("modal-process-return");
      this.renderReturnDesk();
      this.updateNotificationBadge();

      // Open Return Clearance Slip
      this.openReturnSlipModal(isFaculty ? `faculty:${tx.id}` : tx.id, fineAction, fineAmount, paymentMethod);
    } catch (e) {
      this.showToast("Return Failed", e.message, "danger");
    }
  }

  // --- View 6: Deadline Alerts ---
  renderAlertsView() {
    const { overdue, dueSoon } = window.db.getPendingAlerts();
    const settings = window.db.getSettings();
    document.getElementById("alerts-overdue-count").textContent = overdue.length;
    document.getElementById("alerts-duesoon-count").textContent = dueSoon.length;

    const alertItems = this.activeAlertTab === "overdue" ? overdue : dueSoon;
    const items = alertItems;
    const container = document.getElementById("alerts-list-container");

    if (!container) return;

    if (items.length === 0) {
      container.innerHTML = `
        <div style="text-align: center; padding: 60px 20px; background: var(--bg-card); border-radius: var(--radius-md); border: 1px solid var(--border-color);">
          <div style="font-size: 40px; margin-bottom: 12px;">🎉</div>
          <h3 style="font-size: 18px; margin-bottom: 6px;">No ${this.activeAlertTab === 'overdue' ? 'Overdue' : 'Due Soon'} Alerts!</h3>
          <p style="color: var(--text-muted); font-size: 13.5px;">All borrowers have returned their books on time or deadlines are outside the alert window.</p>
        </div>
      `;
      return;
    }

    container.innerHTML = items.map(item => {
      const isOverdue = item.days_left < 0;
      const daysText = isOverdue ? `${item.days_overdue} days overdue` : `due in ${item.days_left} day(s)`;
      const fineText = isOverdue ? `• Fine: ₹${item.calculated_fine}` : '';

      return `
        <div style="background: var(--bg-card); border: 1px solid var(--border-color); border-radius: var(--radius-md); padding: 20px; display: flex; align-items: center; justify-content: space-between; gap: 20px; flex-wrap: wrap; margin-bottom: 14px;">
          <div style="display: flex; align-items: center; gap: 16px;">
            <div style="width: 44px; height: 44px; border-radius: 50%; background: ${isOverdue ? 'rgba(239, 68, 68, 0.15)' : 'rgba(245, 158, 11, 0.15)'}; color: ${isOverdue ? 'var(--danger)' : 'var(--warning)'}; display: flex; align-items: center; justify-content: center; font-size: 20px;">
              ${isOverdue ? '⚠️' : '⏰'}
            </div>
            <div>
              <div style="display: flex; align-items: center; gap: 10px;">
                <strong style="font-size: 16px; color: var(--text-primary);">${this.escapeHTML(item.book_title)}</strong>
                <span class="badge ${isOverdue ? 'badge-danger' : 'badge-warning'}">${this.escapeHTML(daysText)}</span>
              </div>
              <div style="font-size: 13px; color: var(--text-secondary); margin-top: 4px;">
              ${item.borrower_type === "faculty" ? "Faculty" : "Student"}: <strong>${this.escapeHTML(item.student_name)}</strong> (${this.escapeHTML(item.student_roll || "—")}) | Phone: ${this.escapeHTML(item.student_phone || "Not provided")} ${this.escapeHTML(fineText)}
              </div>
            </div>
          </div>
          <div style="display: flex; align-items: center; gap: 10px;">
            <button class="btn btn-whatsapp btn-sm" ${item.student_phone ? "" : "disabled"} onclick="window.app.sendWhatsAppAlert('${item.borrower_type || "student"}:${item.id}')">
              💬 WhatsApp Alert
            </button>
            <button class="btn btn-secondary btn-sm" ${item.student_email ? "" : "disabled"} onclick="window.app.sendEmailAlert('${item.borrower_type || "student"}:${item.id}')">
              ✉️ Email Alert
            </button>
            <button class="btn btn-secondary btn-sm btn-icon-only" title="Copy Message" onclick="window.app.copyAlertText('${item.borrower_type || "student"}:${item.id}')">
              📋
            </button>
          </div>
        </div>
      `;
    }).join("");
  }

  setAlertTab(tab) {
    this.activeAlertTab = tab;
    document.getElementById("btn-tab-overdue")?.classList.toggle("btn-primary", tab === "overdue");
    document.getElementById("btn-tab-overdue")?.classList.toggle("btn-secondary", tab !== "overdue");
    document.getElementById("btn-tab-duesoon")?.classList.toggle("btn-primary", tab === "dueSoon");
    document.getElementById("btn-tab-duesoon")?.classList.toggle("btn-secondary", tab !== "dueSoon");
    this.renderAlertsView();
  }

  findPendingAlert(transactionKey) {
    const pending = window.db.getPendingAlerts();
    const allItems = [...pending.overdue, ...pending.dueSoon];
    if (typeof transactionKey === "string" && transactionKey.includes(":")) {
      const [borrowerType, rawId] = transactionKey.split(":", 2);
      if (!["student", "faculty"].includes(borrowerType)) return null;
      return allItems.find(item => (item.borrower_type || "student") === borrowerType && Number(item.id) === Number(rawId)) || null;
    }
    return allItems.find(item => Number(item.id) === Number(transactionKey)) || null;
  }

  generateAlertMessage(item) {
    const isOverdue = item.days_left < 0;
    const isFaculty = item.borrower_type === "faculty";
    const borrowerLabel = isFaculty ? "Faculty" : "Student";
    const borrowerIdLabel = isFaculty ? "Faculty ID" : "Roll No";
    const transactionLabel = `${isFaculty ? "F" : "TX"}-${item.id}`;
    const settings = window.db.getSettings();
    const libraryName = settings.library_name || "DGI Central Library";
    const weeklyFine = Number(settings.fine_per_day) || 5;

    if (isOverdue) {
      return `📚 *${libraryName} — Overdue Book Reminder*\n\n` +
        `Dear ${item.student_name} (${borrowerLabel} · ${borrowerIdLabel}: ${item.student_roll || "Not provided"}),\n\n` +
        `This is an urgent notice from the library regarding your borrowed book:\n` +
        `📖 Book Title: ${item.book_title}\n` +
        `🔖 ISBN: ${item.book_isbn}\n` +
        `🔢 Transaction ID: #${transactionLabel}\n` +
        `📅 Issue Date: ${item.issue_date}\n` +
        `⏰ Due Date: ${item.due_date}\n` +
        `⚠️ Days Overdue: ${item.days_overdue}\n` +
        `💰 Outstanding Fine: ₹${item.calculated_fine} (₹${weeklyFine}/day)\n\n` +
        `📋 *Important Action Required:*\n` +
        `1. Please return the book immediately to avoid any further penalty.\n` +
        `2. The total overdue fine currently due is ₹${item.calculated_fine}.\n` +
        `3. Visit the library desk for return, renewal, or payment assistance.\n\n` +
        `Thank you,\n*${libraryName}*`;
    }

    return `📚 *${libraryName} — Book Return Reminder*\n\n` +
      `Dear ${item.student_name} (${borrowerLabel} · ${borrowerIdLabel}: ${item.student_roll || "Not provided"}),\n\n` +
      `This is a friendly reminder from ${libraryName}.\n\n` +
      `Your borrowed book is due for return soon:\n` +
      `📖 Book Title: ${item.book_title}\n` +
      `🔖 ISBN: ${item.book_isbn}\n` +
      `📅 Due Date: ${item.due_date}\n` +
      `⏳ Days Remaining: ${item.days_left}\n` +
      `💰 Late Fine: ₹${item.calculated_fine} after the due date (₹${weeklyFine}/day)\n\n` +
      `Please return or renew the book on time to avoid additional charges.\n\n` +
      `Thank you,\n*${libraryName}*`;
  }

  generateIssueMessage(tx) {
    const libraryName = window.db.getSettings().library_name || "DGI Central Library";
    const borrowerType = tx.borrower_type === "faculty" ? "Faculty" : "Student";
    const borrowerReference = tx.borrower_type === "faculty" ? "Faculty ID" : "Roll No";
    return `📚 *${libraryName} — Book Issue Confirmation*\n\n` +
      `Dear ${tx.student_name} (${borrowerReference}: ${tx.student_roll}),\n\n` +
      `A book has been issued to your library account:\n` +
      `📖 Book Title: ${tx.book_title}\n` +
      `🔖 ISBN: ${tx.book_isbn}\n` +
      `🔢 Transaction ID: #${tx.borrower_type === "faculty" ? "F" : "TX"}-${tx.id}\n` +
      `📅 Issue Date: ${tx.issue_date}\n` +
      `⏰ Return Due Date: ${tx.due_date}\n\n` +
      `📋 *Important Circulation Guidelines:*\n` +
      `1. ⚠️ Each ${borrowerType.toLowerCase()} should borrow books using their registered library account.\n` +
      `2. ⏰ Please return the book by ${tx.due_date}.\n` +
      `3. 💰 A late fee of ₹5.00 per day will apply after the due date.\n` +
      `4. 📖 Please keep the book in good condition.\n\n` +
      `For assistance or renewal, contact the library desk.\n\n` +
      `Thank you,\n*${libraryName}*`;
  }

  async appendReissueOption(tx, message) {
    const linkResponse = await this.messageApiRequest("/api/reissue-links", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ transactionId: tx.id })
    });
    const linkResult = await linkResponse.json();
    if (linkResponse.status === 404 && linkResult.error === "API endpoint not found.") {
      this.showToast(
        "Reissue Link Unavailable",
        "The reminder will still be sent. Restart the updated library server to enable reissue links.",
        "warning"
      );
      return `${message}\n\nReissue link is temporarily unavailable. Please contact the library to request a reissue.`;
    }
    if (!linkResponse.ok) throw new Error(linkResult.error || "Could not prepare the reissue link.");
    if (linkResult.reissueUnavailable) {
      return `${message}\n\nReissue is unavailable because the due date has passed. Reissue requests must be sent on or before the due date. Please return the book at the library.`;
    }
    if (linkResult.returnRequired) {
      return `${message}\n\nYou have used both reissues for this loan. Please return the book at the library; this same book will be unavailable to you for 3 days after return.`;
    }
    const requestUrl = new URL(`reissue.html?token=${encodeURIComponent(linkResult.token)}`, linkResult.publicUrl).href;
    return `${message}\n\nReissue request (admin approval required): ${requestUrl}`;
  }

  async sendWhatsAppMessage(tx, message, messageType = "reminder") {
    const phone = (tx.student_phone || "").replace(/[^0-9]/g, "");
    if (!phone) {
      this.showToast("Phone Number Missing", `No phone number is saved for ${tx.student_name}.`, "danger");
      return;
    }

    if (messageType === "reminder" && tx.id && tx.borrower_type !== "faculty") {
      try {
        message = await this.appendReissueOption(tx, message);
      } catch (error) {
        this.showToast("Reissue Link Not Created", error.message || "The reminder was not sent.", "danger");
        return;
      }
    }

    const draftWindow = window.open("about:blank", "_blank");
    try {
      const result = await this.saveMessageLog(tx, "whatsapp", tx.student_phone, message, messageType);
      if (result.sent) {
        draftWindow?.close();
        this.showToast("WhatsApp Message Sent", `Message sent to ${tx.student_name}.`, "success");
      } else {
        if (draftWindow && result.submission?.channel === "whatsapp" && result.status === "submitted") {
          draftWindow.location.href = `https://api.whatsapp.com/send?phone=${phone}&text=${encodeURIComponent(message)}`;
        } else if (result.status !== "submitted") {
          draftWindow?.close();
        }
        const detail = result.warning ? ` ${result.warning}` : "";
        this.showToast(
          result.status === "send_failed" ? "Message Sending Failed" : "Message Submitted",
          `${result.status === "send_failed" ? `Submission ${result.submission?.submissionId || ""} failed for ${tx.student_name}.` : `Submission ${result.submission?.submissionId || ""} for ${tx.student_name}.`}${draftWindow && result.status === "submitted" ? " Send it in the opened WhatsApp chat, then mark it sent in the submission queue." : ""}${detail}`,
          result.warning ? "warning" : "info"
        );
      }
      return result;
    } catch (error) {
      draftWindow?.close();
      this.showToast("Message Not Saved", error.message, "danger");
    }
  }

  async saveMessageLog(tx, channel, recipient, message, messageType = "reminder") {
    const response = await this.messageApiRequest("/api/messages", {
      method: "POST",
      headers: {
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        transactionId: tx.id,
        borrowerType: tx.borrower_type === "faculty" ? "faculty" : "student",
        borrowerId: tx.borrower_type === "faculty" ? tx.faculty_id : tx.student_id,
        student: {
          id: tx.borrower_type === "faculty" ? null : tx.student_id,
          name: tx.student_name,
          rollNo: tx.student_roll,
          phone: tx.student_phone,
          email: tx.student_email
        },
        channel,
        recipient,
        message,
        messageType,
        status: "prepared"
      })
    });
    const result = await response.json();
    if (!response.ok) throw new Error(result.error || `Message server error (${response.status}).`);
    const submissionResponse = await this.messageApiRequest(`/api/messages/${result.message.id}/actions`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: channel === "email" ? "submit-manual-email" : "submit" })
    });
    const submissionResult = await submissionResponse.json();
    if (!submissionResponse.ok) throw new Error(submissionResult.error || `Submission error (${submissionResponse.status}).`);
    this.renderMessageHistory();
    return {
      sent: submissionResult.message?.status === "sent" || ["delivered", "read", "awaiting_reply", "response_received"].includes(submissionResult.message?.status),
      status: submissionResult.message?.status || "submitted",
      warning: submissionResult.warning || "",
      submission: submissionResult.message
    };
  }

  async messageApiRequest(path, options = {}) {
    try {
      const response = await fetch(path, {
        ...options,
        credentials: "same-origin",
        headers: options.headers
      });
      if (response.status === 401) {
        const raw = sessionStorage.getItem("dgi_admin_session") || localStorage.getItem("dgi_admin_session");
        if (!raw) {
          window.location.replace("login.html");
          throw new Error("Your admin session expired. Sign in again.");
        }
      }
      return response;
    } catch (err) {
      if (!["http:", "https:"].includes(window.location.protocol) || err.name === "TypeError") {
        return new Response(JSON.stringify({ ok: true, messages: [], requests: [] }), {
          status: 200,
          headers: { "Content-Type": "application/json" }
        });
      }
      throw err;
    }
  }

  async importLegacyMessageLogs() {
    const accountName = encodeURIComponent(String(window.adminDisplayName || "unknown").toLowerCase());
    const migrationKey = `dgi_message_legacy_import_v1_${accountName}`;
    if (localStorage.getItem(migrationKey)) return;

    const alerts = window.db.getAlertLogs().map(alert => {
      const transaction = window.db.getTransactions().find(item => Number(item.id) === Number(alert.transaction_id));
      const student = window.db.getStudentById(alert.student_id) || {};
      return {
        id: alert.id,
        transactionId: alert.transaction_id,
        channel: alert.channel,
        recipient: alert.recipient,
        message: alert.message,
        timestamp: alert.sent_at,
        student: {
          id: student.id ?? alert.student_id,
          name: student.name || transaction?.student_name || "Unknown",
          rollNo: student.roll_no || transaction?.student_roll || "",
          phone: student.phone || transaction?.student_phone || "",
          email: student.email || transaction?.student_email || ""
        }
      };
    });
    if (alerts.length) {
      const response = await this.messageApiRequest("/api/messages/import-legacy", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ alerts })
      });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || `Message server error (${response.status}).`);
    }
    localStorage.setItem(migrationKey, "complete");
  }

  async renderMessageHistory() {
    const history = document.getElementById("reports-message-history-tbody");
    const studentSelect = document.getElementById("message-student-select");
    if (!history) return;
    const searchInput = document.getElementById("message-history-search");
    if (searchInput && !searchInput.dataset.bound) {
      searchInput.addEventListener("input", () => {
        this.messageHistoryPage = 1;
        this.filterMessageHistory();
      });
      searchInput.dataset.bound = "true";
    }
    const channelFilter = document.getElementById("message-history-channel");
    if (channelFilter && !channelFilter.dataset.bound) {
      channelFilter.addEventListener("change", () => {
        this.messageHistoryPage = 1;
        this.filterMessageHistory();
      });
      channelFilter.dataset.bound = "true";
    }
    const borrowerFilter = document.getElementById("message-history-borrower");
    if (borrowerFilter && !borrowerFilter.dataset.bound) {
      borrowerFilter.addEventListener("change", () => {
        this.messageHistoryPage = 1;
        this.filterMessageHistory();
      });
      borrowerFilter.dataset.bound = "true";
    }
    const previousPage = document.getElementById("message-history-prev");
    const nextPage = document.getElementById("message-history-next");
    if (previousPage && !previousPage.dataset.bound) {
      previousPage.addEventListener("click", () => this.changeMessageHistoryPage(-1));
      previousPage.dataset.bound = "true";
    }
    if (nextPage && !nextPage.dataset.bound) {
      nextPage.addEventListener("click", () => this.changeMessageHistoryPage(1));
      nextPage.dataset.bound = "true";
    }
    if (!history.dataset.expandBound) {
      const toggleStudentHistory = row => {
        if (!row?.matches(".message-history-latest")) return;
        const groupId = row.dataset.historyGroup;
        const expanded = row.dataset.historyExpanded !== "true";
        [...history.querySelectorAll("tr[data-history-group]")]
          .filter(groupRow => groupRow.dataset.historyGroup === groupId)
          .forEach(groupRow => {
          groupRow.dataset.historyExpanded = String(expanded);
        });
        row.setAttribute("aria-expanded", String(expanded));
        this.filterMessageHistory();
      };
      history.addEventListener("click", event => {
        const toggleButton = event.target.closest(".message-history-toggle");
        if (toggleButton) {
          event.preventDefault();
          event.stopPropagation();
          toggleStudentHistory(toggleButton.closest(".message-history-latest"));
          return;
        }
        if (event.target.closest("button, a, input, select, textarea, summary, details")) return;
        toggleStudentHistory(event.target.closest(".message-history-latest"));
      });
      history.addEventListener("keydown", event => {
        if (!event.target.matches(".message-history-latest") || !["Enter", " "].includes(event.key)) return;
        event.preventDefault();
        toggleStudentHistory(event.target);
      });
      history.dataset.expandBound = "true";
    }
    history.innerHTML = `<tr><td colspan="6" style="text-align:center; padding:24px;">Loading message history...</td></tr>`;
    try {
      if (studentSelect) {
        const previousStudent = studentSelect.value;
        studentSelect.innerHTML = `<option value="">Select a student</option>${window.db.getStudents().map(student =>
          `<option value="${Number(student.id)}">${this.escapeHTML(student.name)} (${this.escapeHTML(student.roll_no)})</option>`
        ).join("")}`;
        if (window.db.getStudentById(previousStudent)) studentSelect.value = String(previousStudent);
      }
      await this.importLegacyMessageLogs();
      const response = await this.messageApiRequest("/api/messages");
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || `Message server error (${response.status}).`);
      this.renderEmailReplySyncStatus(result.emailReplySync);

      const messages = result.messages || [];
      const outgoing = messages.filter(item => item.direction === "outgoing");
      const failedCount = outgoing.filter(item => item.status === "send_failed").length;
      const deleteFailedButton = document.getElementById("message-history-delete-failed");
      if (deleteFailedButton) {
        deleteFailedButton.hidden = failedCount === 0;
        deleteFailedButton.textContent = `Delete all failed messages (${failedCount})`;
      }
      history.replaceChildren();
      if (!outgoing.length && !messages.some(item => item.direction === "incoming")) {
        const row = history.insertRow();
        const cell = row.insertCell();
        cell.colSpan = 6;
        cell.textContent = "No messages have been prepared or submitted yet.";
        return;
      }
      const incomingRepliesByParent = new Map();
      messages.filter(item => item.direction === "incoming" && item.replyToId).forEach(item => {
        const parentId = Number(item.replyToId);
        const linked = incomingRepliesByParent.get(parentId) || [];
        linked.push(item);
        incomingRepliesByParent.set(parentId, linked);
      });
      outgoing.forEach(message => {
        const row = history.insertRow();
        const borrowerType = message.borrowerType || message.student?.borrowerType || "student";
        const borrowerIdLabel = borrowerType === "faculty" ? "faculty id" : "roll no";
        const borrowerId = message.borrowerId || message.student?.borrowerId || message.student?.rollNo || "";
        row.dataset.borrowerType = borrowerType;
        row.dataset.search = `${message.student?.name || ""} ${message.student?.rollNo || ""} ${borrowerId} ${borrowerIdLabel} ${borrowerType} ${message.student?.email || ""} ${message.student?.phone || ""} ${message.recipient || ""}`.toLocaleLowerCase();
        row.dataset.channel = String(message.channel || "").toLowerCase();
        row.dataset.studentKey = `${borrowerType}:${message.borrowerId || message.student?.borrowerId || message.student?.id || message.student?.rollNo || message.student?.name || `message-${message.id}`}`.trim().toLocaleLowerCase();
        const linkedIncomingReplies = (incomingRepliesByParent.get(Number(message.id)) || [])
          .map(item => ({
            replyId: item.replyId,
            message: item.message,
            timestamp: item.timestamp,
            channel: item.channel,
            adminReadAt: item.adminReadAt || null
          }));
        const repliesByKey = new Map();
        [...(message.replies || []), ...linkedIncomingReplies].forEach(reply => {
          const key = `${reply.channel || message.channel}|${reply.timestamp}|${reply.message}`;
          const existing = repliesByKey.get(key);
          if (!existing || (!existing.replyId && reply.replyId)) repliesByKey.set(key, reply);
        });
        const actualReplies = [...repliesByKey.values()]
          .sort((left, right) => (Date.parse(left.timestamp) || 0) - (Date.parse(right.timestamp) || 0));
        const responseContent = actualReplies.map(reply => {
          return `<div style="white-space:pre-wrap;overflow-wrap:anywhere;margin:6px 0;">${this.escapeHTML(reply.message || "")}</div>`;
        }).join("") || `<span style="color:var(--text-muted);">No student response received.</span>`;
        const responseDetails = `<details class="message-history-dropdown"><summary>View response${actualReplies.length ? ` (${actualReplies.length})` : ""}</summary><div class="message-history-dropdown-content">${responseContent}</div></details>`;
        const timestamp = message.submittedAt || message.timestamp;
        const activityTimestamp = [timestamp, ...(message.statusHistory || []).map(event => event.changedAt), ...(message.replies || []).map(reply => reply.timestamp)]
          .filter(value => Number.isFinite(Date.parse(value)))
          .sort((left, right) => Date.parse(right) - Date.parse(left))[0] || timestamp;
        row.dataset.activityTime = String(Date.parse(activityTimestamp) || 0);
        const messageContent = `<details><summary style="cursor:pointer;">View message</summary><div style="white-space:pre-wrap;overflow-wrap:anywhere;margin-top:8px;">${this.escapeHTML(message.message || "")}</div></details>`;
        const borrowerLabel = borrowerType === "faculty" ? "Faculty ID" : "Roll No";
        const borrowerReference = (borrowerType === "faculty" ? message.student?.rollNo : borrowerId) || borrowerId || "Not provided";
        const responseActions = message.status === "response_received"
          ? `<button class="btn btn-primary btn-sm" type="button" onclick="window.app.performMessageAction(${Number(message.id)}, 'resolve')">Resolve</button>`
          : ["delivered", "read", "awaiting_reply"].includes(message.status)
            ? `<div style="display:flex;gap:4px;margin-top:6px;flex-wrap:wrap;"><button class="btn btn-secondary btn-sm" type="button" onclick="window.app.performMessageAction(${Number(message.id)}, 'acknowledge')">Acknowledge</button><button class="btn btn-secondary btn-sm" type="button" onclick="window.app.performMessageAction(${Number(message.id)}, 'mark-no-response')">No response</button></div>`
            : "";
        const deleteFailedAction = message.status === "send_failed"
          ? `<button class="btn btn-danger btn-sm" type="button" style="margin-top:6px;" onclick="window.app.deleteFailedMessage(${Number(message.id)})">Delete</button>`
          : "";
        row.innerHTML = `
          <td>${this.escapeHTML(new Date(activityTimestamp).toLocaleString())}</td>
          <td>${this.escapeHTML(message.student?.name || "Unknown")}<div style="font-size:11px;color:var(--text-muted);">${borrowerLabel}: ${this.escapeHTML(borrowerReference)}</div></td>
          <td>${this.escapeHTML(message.channel || "")}</td>
          <td>${messageContent}</td>
          <td>${responseDetails}</td>
          <td>${this.messageStatusBadge(message)}${responseActions}${deleteFailedAction}</td>`;
      });
      messages.filter(message => message.direction === "incoming" && !message.replyToId).forEach(reply => {
        const row = history.insertRow();
        const borrowerType = reply.borrowerType || reply.student?.borrowerType || "student";
        row.dataset.borrowerType = borrowerType;
        row.dataset.search = `${reply.student?.name || ""} ${reply.student?.rollNo || ""} ${reply.borrowerId || reply.student?.borrowerId || ""} ${borrowerType === "faculty" ? "faculty id" : "roll no"} ${borrowerType} ${reply.student?.email || ""} ${reply.student?.phone || ""} ${reply.recipient || ""}`.toLocaleLowerCase();
        row.dataset.channel = String(reply.channel || "").toLowerCase();
        row.dataset.studentKey = `${borrowerType}:${reply.borrowerId || reply.student?.borrowerId || reply.student?.id || reply.student?.rollNo || reply.student?.name || `message-${reply.id}`}`.trim().toLocaleLowerCase();
        row.dataset.activityTime = String(Date.parse(reply.timestamp) || 0);
        row.innerHTML = `
          <td>${this.escapeHTML(new Date(reply.timestamp).toLocaleString())}</td>
          <td>${this.escapeHTML(reply.student?.name || "Unknown")}<div style="font-size:11px;color:var(--text-muted);">${borrowerType === "faculty" ? "Faculty ID" : "Roll No"}: ${this.escapeHTML((borrowerType === "faculty" ? reply.student?.rollNo : reply.borrowerId || reply.student?.borrowerId || reply.student?.rollNo) || reply.borrowerId || "Not provided")}</div></td>
          <td>${this.escapeHTML(reply.channel || "")}</td>
          <td>—</td>
          <td><details class="message-history-dropdown"><summary>View response</summary><div class="message-history-dropdown-content"><div style="white-space:pre-wrap;overflow-wrap:anywhere;">${this.escapeHTML(reply.message)}</div></div></details></td>
          <td>${this.messageStatusBadge("unmatched")}</td>`;
      });
      this.groupMessageHistoryRows(history);
      this.filterMessageHistory();
    } catch (error) {
      history.innerHTML = `<tr><td colspan="6">${this.escapeHTML(error.message)}</td></tr>`;
      this.showToast("Message History Unavailable", error.message, "warning");
    }
  }

  filterMessageHistory() {
    const query = (document.getElementById("message-history-search")?.value || "").trim().toLocaleLowerCase();
    const channel = (document.getElementById("message-history-channel")?.value || "all").toLocaleLowerCase();
    const borrower = (document.getElementById("message-history-borrower")?.value || "all").toLocaleLowerCase();
    const title = document.getElementById("message-history-title");
    if (title) title.innerHTML = borrower === "faculty"
      ? "Faculty Message &amp; Reply History"
      : borrower === "student" ? "Student Message &amp; Reply History" : "Student &amp; Faculty Message &amp; Reply History";
    const rows = [...document.querySelectorAll("#reports-message-history-tbody tr[data-search]")];
    const matches = row => {
      const matchesSearch = !query || row.dataset.search.includes(query);
      const matchesChannel = channel === "all" || row.dataset.channel === channel;
      const matchesBorrower = borrower === "all" || row.dataset.borrowerType === borrower;
      return matchesSearch && matchesChannel && matchesBorrower;
    };
    const groups = new Map();
    rows.forEach(row => {
      row.cells[1]?.querySelector(".message-history-toggle")?.remove();
      row.cells[1]?.querySelector(".student-history-toggle-hint")?.remove();
      const groupId = row.dataset.historyGroup || `single-${row.dataset.studentKey}`;
      if (!groups.has(groupId)) groups.set(groupId, []);
      groups.get(groupId).push(row);
    });
    const visibleGroups = [...groups.values()].map(groupRows => ({
      groupRows,
      visibleRows: groupRows.filter(matches),
      activityTime: Number(groupRows.find(matches)?.dataset.activityTime || 0)
    })).filter(group => group.visibleRows.length)
      .sort((left, right) => right.activityTime - left.activityTime);
    const pageSize = 10;
    const pageCount = Math.max(1, Math.ceil(visibleGroups.length / pageSize));
    this.messageHistoryPage = Math.min(Math.max(1, Number(this.messageHistoryPage) || 1), pageCount);
    const firstGroup = (this.messageHistoryPage - 1) * pageSize;
    const pageGroups = new Set(visibleGroups.slice(firstGroup, firstGroup + pageSize).map(group => group.groupRows[0]?.dataset.historyGroup));
    visibleGroups.forEach(group => {
      const { groupRows, visibleRows } = group;
      const expanded = groupRows.some(row => row.dataset.historyExpanded === "true");
      const latest = visibleRows[0];
      const onCurrentPage = pageGroups.has(groupRows[0]?.dataset.historyGroup);
      groupRows.forEach(row => {
        row.classList.remove("message-history-latest");
        row.removeAttribute("tabindex");
        row.removeAttribute("aria-expanded");
        row.hidden = !onCurrentPage || !visibleRows.includes(row) || (!expanded && row !== latest);
      });
      if (!latest) return;
      if (visibleRows.length > 1) {
        latest.classList.add("message-history-latest");
        latest.tabIndex = 0;
        latest.setAttribute("aria-expanded", String(expanded));
        const studentCell = latest.cells[1];
        const toggle = document.createElement("button");
        toggle.type = "button";
        toggle.className = "message-history-toggle";
        toggle.textContent = expanded ? "Collapse history" : `${visibleRows.length - 1} older record${visibleRows.length === 2 ? "" : "s"} · Expand`;
        toggle.setAttribute("aria-label", `${expanded ? "Collapse" : "Expand"} complete history for ${studentCell.textContent.trim()}`);
        studentCell.append(toggle);
      } else {
        latest.cells[1]?.querySelector(".message-history-toggle")?.remove();
      }
    });
    groups.forEach(groupRows => {
      if (visibleGroups.some(group => group.groupRows === groupRows)) return;
      groupRows.forEach(row => { row.hidden = true; });
    });
    const pageLabel = document.getElementById("message-history-page-label");
    const previousPage = document.getElementById("message-history-prev");
    const nextPage = document.getElementById("message-history-next");
    const pagination = document.getElementById("message-history-pagination");
    if (pageLabel) pageLabel.textContent = visibleGroups.length
      ? `Showing ${Math.min(firstGroup + 1, visibleGroups.length)}–${Math.min(firstGroup + pageSize, visibleGroups.length)} of ${visibleGroups.length} borrower histories · Page ${this.messageHistoryPage} of ${pageCount}`
      : "No matching message history";
    if (previousPage) previousPage.disabled = this.messageHistoryPage <= 1;
    if (nextPage) nextPage.disabled = this.messageHistoryPage >= pageCount;
    if (pagination) pagination.hidden = visibleGroups.length <= pageSize;
  }

  changeMessageHistoryPage(direction) {
    this.messageHistoryPage = Math.max(1, (Number(this.messageHistoryPage) || 1) + Number(direction || 0));
    this.filterMessageHistory();
  }

  renderEmailReplySyncStatus(syncState) {
    const statusElement = document.getElementById("email-reply-sync-status");
    if (!statusElement) return;
    const status = syncState?.status || "not_configured";
    if (status === "connected") {
      statusElement.hidden = true;
      statusElement.textContent = "";
      statusElement.dataset.state = status;
      return;
    }
    statusElement.hidden = false;
    const checkedAt = syncState?.lastCheckedAt
      ? new Date(syncState.lastCheckedAt).toLocaleString()
      : "not checked yet";
    const messages = {
      checking: "Checking the email inbox for student replies…",
      waiting: "Automatic email reply sync is starting. The inbox will be checked shortly.",
      not_configured: "Automatic email reply sync is not configured. Set the IMAP account and either an App Password or Gmail OAuth credentials on the server.",
      authentication_failed: "Email inbox sign-in failed. Check the Gmail account and its App Password or OAuth credentials in the server environment.",
      error: `Email inbox sync failed${syncState?.errorCode ? ` (${syncState.errorCode})` : ""}. Check the server email configuration. Last check: ${checkedAt}.`
    };
    statusElement.textContent = messages[status] || messages.error;
    statusElement.dataset.state = status;
  }

  groupMessageHistoryRows(history) {
    const groups = new Map();
    [...history.querySelectorAll("tr[data-search]")].forEach(row => {
      const key = row.dataset.studentKey || `unknown-${row.rowIndex}`;
      if (!groups.has(key)) groups.set(key, []);
      groups.get(key).push(row);
    });
    const orderedGroups = [...groups.values()]
      .map(rows => rows.sort((left, right) => Number(right.dataset.activityTime) - Number(left.dataset.activityTime)))
      .sort((left, right) => Number(right[0]?.dataset.activityTime) - Number(left[0]?.dataset.activityTime));
    orderedGroups.forEach((rows, groupIndex) => {
      const groupId = `borrower-message-history-${groupIndex}`;
      rows.forEach(row => {
        row.dataset.historyGroup = groupId;
        row.dataset.historyExpanded = "false";
        history.append(row);
      });
    });
  }

  messageStatusBadge(messageOrStatus) {
    const message = typeof messageOrStatus === "object" ? messageOrStatus : null;
    const borrowerLabel = (message?.borrowerType || message?.student?.borrowerType) === "faculty" ? "Faculty member" : "Student";
    const status = message ? String(message.status || "prepared") : String(messageOrStatus || "prepared");
    let label = "Pending";
    let detail = "Message or response is being processed.";
    if (status === "send_failed") {
      label = "Failed";
      detail = message?.channel === "email" && message?.error
        ? `Email provider error: ${message.error}`
        : "Message could not be sent.";
    } else if (["response_received", "unmatched", "resolved", "closed"].includes(status)) {
      label = "Replied";
      detail = `${borrowerLabel} has replied.`;
    } else if (message?.noResponseAt) {
      label = "No Response";
      detail = `${borrowerLabel} has not replied yet.`;
    } else if (status === "read" || (status === "awaiting_reply" && message?.readAt)) {
      label = "Read";
      detail = `${borrowerLabel} has viewed the message.`;
    } else if (["delivered", "awaiting_reply"].includes(status)) {
      label = "Delivered";
      detail = `The message was delivered to the ${borrowerLabel.toLowerCase()}'s WhatsApp or app.`;
    }
    const badge = ["Failed"].includes(label)
      ? "badge-danger"
      : ["Delivered", "Read", "Replied"].includes(label)
        ? "badge-success"
        : "badge-warning";
    return `<span class="badge ${badge}">${this.escapeHTML(label)}</span><div style="font-size:11px;color:var(--text-muted);margin-top:4px;">${this.escapeHTML(detail)}</div>`;
  }

  async setMessageResponseState(id, action) {
    await this.performMessageAction(id, action);
  }

  async deleteFailedMessage(id) {
    if (!confirm("Delete this failed message from history?")) return;
    try {
      const response = await this.messageApiRequest(`/api/messages/${Number(id)}`, { method: "DELETE" });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || "Could not delete the failed message.");
      this.showToast("Failed Message Deleted", "The selected failed message was removed from history.", "success");
      await this.renderMessageHistory();
    } catch (error) {
      this.showToast("Message Delete Failed", error.message, "danger");
    }
  }

  async deleteAllFailedMessages() {
    const button = document.getElementById("message-history-delete-failed");
    const count = Number((button?.textContent.match(/\((\d+)\)/) || [])[1] || 0);
    if (!count || !confirm(`Delete all ${count} failed messages from history? This cannot be undone.`)) return;
    try {
      const response = await this.messageApiRequest("/api/messages/failed", { method: "DELETE" });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || "Could not delete failed messages.");
      this.showToast("Failed Messages Deleted", `${Number(result.deleted) || 0} failed messages were removed from history.`, "success");
      await this.renderMessageHistory();
    } catch (error) {
      this.showToast("Message Delete Failed", error.message, "danger");
    }
  }

  async setStudentReplyRead(messageId, replyId, read) {
    try {
      const response = await this.messageApiRequest(`/api/messages/${Number(messageId)}/replies/${Number(replyId)}/read`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ read })
      });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || "Could not update reply read status.");
      await this.renderMessageHistory();
    } catch (error) {
      this.showToast("Reply Status Not Updated", error.message, "danger");
    }
  }

  async createMessage(student, channel, recipient, message, messageType, status = "prepared", transactionId = null) {
    const response = await this.messageApiRequest("/api/messages", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        student: {
          id: student.id,
          name: student.name,
          rollNo: student.roll_no,
          phone: student.phone,
          email: student.email
        },
        transactionId,
        channel,
        recipient,
        message,
        messageType,
        status
      })
    });
    const result = await response.json();
    if (!response.ok) throw new Error(result.error || `Message server error (${response.status}).`);
    return result.message;
  }

  async savePreparedMessage(status, submitNow = false) {
    const student = window.db.getStudentById(document.getElementById("message-student-select")?.value);
    const channel = document.getElementById("message-channel-select")?.value || "";
    const message = document.getElementById("message-content-input")?.value.trim() || "";
    const messageType = document.getElementById("message-type-select")?.value || "notice";
    const recipient = channel === "email" ? student?.email : student?.phone;
    if (!student || !message || !channel || !recipient) {
      this.showToast("Message Incomplete", "Select a student and channel with a saved destination, then enter message content.", "warning");
      return;
    }
    try {
      const wasEditingMessage = Boolean(this.editingMessageId);
      let messageId;
      if (this.editingMessageId) {
        const response = await this.messageApiRequest(`/api/messages/${this.editingMessageId}/actions`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            action: "edit",
            message,
            messageType,
            student: {
              id: student.id,
              name: student.name,
              rollNo: student.roll_no,
              phone: student.phone,
              email: student.email
            },
            channel,
            recipient
          })
        });
        const result = await response.json();
        if (!response.ok) throw new Error(result.error || "Could not update the message.");
        messageId = this.editingMessageId;
        if (status === "prepared" && result.message.status === "draft") {
          const prepareResponse = await this.messageApiRequest(`/api/messages/${this.editingMessageId}/actions`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ action: "prepare" })
          });
          const prepareResult = await prepareResponse.json();
          if (!prepareResponse.ok) throw new Error(prepareResult.error || "Could not prepare the message.");
        }
      } else {
        const created = await this.createMessage(student, channel, recipient, message, messageType, submitNow ? "prepared" : status);
        messageId = created.id;
      }
      this.editingMessageId = null;
      document.getElementById("form-message-compose")?.reset();
      if (submitNow) {
        await this.performMessageAction(messageId, "submit", false);
      } else {
        this.showToast(
          status === "draft" ? "Draft Saved" : wasEditingMessage ? "Message Updated" : "Message Prepared",
          status === "draft" ? "The draft was saved and has not been submitted." : "The message is prepared and has not been submitted.",
          "success"
        );
      }
      this.renderMessageHistory();
    } catch (error) {
      this.showToast("Message Not Saved", error.message, "danger");
    }
  }

  async editPreparedMessage(id) {
    try {
      const messages = await this.getMessageRecords();
      const message = messages.find(item => item.id === Number(id));
      if (!message) throw new Error("Message was not found.");
      this.editingMessageId = message.id;
      const student = window.db.getStudents().find(item => Number(item.id) === Number(message.student?.id));
      document.getElementById("message-student-select").value = student ? String(student.id) : "";
      document.getElementById("message-channel-select").value = message.channel;
      document.getElementById("message-type-select").value = message.messageType || "notice";
      document.getElementById("message-content-input").value = message.message;
      document.getElementById("message-content-input").focus();
    } catch (error) {
      this.showToast("Could Not Edit Message", error.message, "danger");
    }
  }

  async getMessageRecords() {
    const response = await this.messageApiRequest("/api/messages");
    const result = await response.json();
    if (!response.ok) throw new Error(result.error || `Message server error (${response.status}).`);
    return result.messages || [];
  }

  openMessageDraft(id) {
    const draftWindow = window.open("about:blank", "_blank");
    this.getMessageRecords().then(messages => {
      const message = messages.find(item => item.id === Number(id));
      if (!message) throw new Error("Message was not found.");
      const url = message.channel === "email"
        ? this.buildGmailComposeLink(message.recipient, this.getLibraryEmailSubject(message.messageType, message.student?.name), message.message)
        : `https://api.whatsapp.com/send?phone=${encodeURIComponent(String(message.recipient || "").replace(/\D/g, ""))}&text=${encodeURIComponent(message.message)}`;
      if (draftWindow) draftWindow.location.href = url;
      else window.location.href = url;
    }).catch(error => {
      draftWindow?.close();
      this.showToast("Could Not Open Message", error.message, "danger");
    });
  }

  async performMessageAction(id, action, refresh = true) {
    const draftWindow = action === "submit" ? window.open("about:blank", "_blank") : null;
    try {
      if (action === "delete" && !confirm("Delete this unsent draft?")) return;
      if (action === "cancel" && !confirm("Cancel this message submission?")) return;
      const url = action === "delete" ? `/api/messages/${id}` : `/api/messages/${id}/actions`;
      const response = await this.messageApiRequest(url, action === "delete"
        ? { method: "DELETE" }
        : {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ action })
        });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || `Could not ${action} message.`);
      if (action === "submit" && result.warning && result.message?.status === "submitted") {
        if (draftWindow) {
          const messages = await this.getMessageRecords();
          const message = messages.find(item => item.id === Number(id));
          if (!message) throw new Error("Message was submitted, but could not be loaded for manual sending.");
          const draftUrl = message.channel === "email"
            ? this.buildGmailComposeLink(message.recipient, this.getLibraryEmailSubject(message.messageType, message.student?.name), message.message)
            : `https://api.whatsapp.com/send?phone=${encodeURIComponent(String(message.recipient || "").replace(/\D/g, ""))}&text=${encodeURIComponent(message.message)}`;
          draftWindow.location.href = draftUrl;
        } else {
          this.showToast("Allow Pop-ups", "The message was submitted, but the manual send window was blocked. Use Open channel from the queue.", "warning");
        }
      } else {
        draftWindow?.close();
      }
      this.showToast("Message Updated", result.warning || `Message status: ${result.message?.status || "deleted"}.`, result.warning ? "warning" : "success");
      if (refresh) await this.renderMessageHistory();
    } catch (error) {
      draftWindow?.close();
      this.showToast("Message Action Failed", error.message, "danger");
    }
  }

  async logIssueNotification(channel) {
    const tx = this.lastIssuedTx;
    if (!tx || channel !== "whatsapp" || !tx.student_phone) return;
    await this.sendWhatsAppMessage(tx, this.generateIssueMessage(tx), "issue_confirmation");
  }

  copyCurrentIssueMessage() {
    if (!this.lastIssuedTx) return;
    const message = this.generateIssueMessage(this.lastIssuedTx);
    navigator.clipboard.writeText(message);
    this.showToast("Copied to Clipboard!", "Full issue notification text with 4 books & ₹5 fine guidelines copied.", "success");
  }

  buildMailtoLink(email, subject, body, fromAddress = "") {
    const recipient = (email || "").trim();
    if (!recipient) return "#";
    const encodedSubject = encodeURIComponent(subject);
    const encodedBody = encodeURIComponent(body);
    const senderParam = fromAddress ? `&cc=${encodeURIComponent(fromAddress)}` : "";
    return `mailto:${recipient}?subject=${encodedSubject}&body=${encodedBody}${senderParam}`;
  }

  getLibraryEmailSubject(messageType, studentName) {
    const type = String(messageType || "").toLowerCase();
    const label = type === "overdue" ? "Overdue Notice" : type === "reminder" ? "Notice" : "Library Notice";
    return `Library ${label}: ${studentName || "Student"}`;
  }

  buildGmailComposeLink(email, subject, body) {
    const params = new URLSearchParams({
      view: "cm",
      fs: "1",
      authuser: "info@dronacharya.info",
      to: (email || "").trim(),
      su: subject,
      body
    });
    return `https://mail.google.com/mail/?${params.toString()}`;
  }

  async sendWhatsAppAlert(txId) {
    const tx = this.findPendingAlert(txId);
    if (!tx) return;

    const message = this.generateAlertMessage(tx);
    await this.sendWhatsAppMessage(tx, message, tx.days_left < 0 ? "overdue" : "reminder");
  }

  async sendEmailAlert(txId) {
    const tx = this.findPendingAlert(txId);
    if (!tx) return;

    let message = this.generateAlertMessage(tx);
    const messageType = tx.days_left < 0 ? "overdue" : "reminder";
    if (!tx.student_email) {
      this.showToast("Email Address Missing", `No email address is saved for ${tx.student_name}.`, "danger");
      return;
    }

    const draftWindow = window.open("about:blank", "_blank");
    try {
      if (messageType === "reminder" && tx.borrower_type !== "faculty") message = await this.appendReissueOption(tx, message);
      const result = await this.saveMessageLog(tx, "email", tx.student_email, message, messageType);
      if (result.status === "submitted") {
        if (draftWindow) {
          draftWindow.location.href = this.buildGmailComposeLink(
            tx.student_email,
            this.getLibraryEmailSubject(messageType, tx.student_name),
            message
          );
          this.showToast("Gmail Compose Opened", "Review the message in the library Gmail account and press Send.", "info");
        } else {
          this.showToast("Allow Pop-ups", "The message is saved in history. Allow pop-ups and use Open channel to open it in Gmail.", "warning");
        }
      } else {
        draftWindow?.close();
        this.showToast("Email Sending Failed", result.warning || `Email could not be sent to ${tx.student_name}. Check the message history for details.`, "danger");
      }
    } catch (error) {
      draftWindow?.close();
      this.showToast("Message Not Saved", error.message, "danger");
    }
  }

  copyAlertText(txId) {
    const tx = this.findPendingAlert(txId);
    if (!tx) return;
    const message = this.generateAlertMessage(tx);
    navigator.clipboard.writeText(message);
    this.showToast("Copied to Clipboard!", "Alert text is ready to paste anywhere.", "success");
  }

  async blastAllOverdueAlerts() {
    const { overdue } = window.db.getPendingAlerts();
    if (overdue.length === 0) {
      this.showToast("No Overdue Items", "There are no overdue books to alert right now.", "info");
      return;
    }

    for (const item of overdue) {
      await this.sendWhatsAppMessage(item, this.generateAlertMessage(item), "overdue");
    }
    this.showToast("Bulk Alerts Processed", `${overdue.length} overdue student/faculty message(s) were processed. Check WhatsApp and message history for their status.`, "info");
  }

  // --- View 7: Reports & Analytics ---
  renderReports() {
    const stats = window.db.getDashboardStats();
    const topBooks = window.db.getTopBooks(5);
    const topStudents = window.db.getTopBorrowers(5);
    this.renderMessageHistory();
    this.renderReissueRequests();

    // Top books table
    const topBooksContainer = document.getElementById("reports-top-books-tbody");
    if (topBooksContainer) {
      topBooksContainer.innerHTML = topBooks.map((b, idx) => `
        <tr>
          <td><span class="badge ${idx === 0 ? 'badge-warning' : 'badge-accent'}">#${idx + 1}</span></td>
          <td><strong>${this.escapeHTML(b.title)}</strong></td>
          <td>${this.escapeHTML(b.author)}</td>
          <td><strong style="color: var(--accent-primary); font-family: var(--font-mono);">${this.escapeHTML(b.borrow_count)}</strong> times</td>
        </tr>
      `).join("");
    }

    // Top students leaderboard
    const topStudentsContainer = document.getElementById("reports-top-students-tbody");
    if (topStudentsContainer) {
      const medals = ["🥇", "🥈", "🥉", "🎖️", "🎖️"];
      topStudentsContainer.innerHTML = topStudents.map((s, idx) => `
        <tr>
          <td style="font-size: 18px;">${medals[idx] || "🎖️"}</td>
          <td><strong>${this.escapeHTML(s.name)}</strong></td>
          <td><span class="isbn-code">${this.escapeHTML(s.roll_no)}</span></td>
          <td>${this.escapeHTML(s.department)}</td>
          <td><strong style="color: var(--success); font-family: var(--font-mono);">${this.escapeHTML(s.borrow_count)}</strong> books</td>
        </tr>
      `).join("");
    }

    const transactionsContainer = document.getElementById("reports-transactions-tbody");
    if (transactionsContainer) {
      const transactions = [...window.db.getTransactions()].sort((a, b) => Number(b.id) - Number(a.id));
      const studentGroups = new Map();
      transactions.forEach(transaction => {
        const studentKey = `${transaction.borrower_type || "student"}:${transaction.student_roll || transaction.student_name || transaction.id}`;
        if (!studentGroups.has(studentKey)) studentGroups.set(studentKey, []);
        studentGroups.get(studentKey).push(transaction);
      });
      const formatTransactionRow = (t, extra = "") => {
        const paymentLabel = t.fine_status === "paid"
          ? (t.payment_method || "Recorded").toUpperCase()
          : t.fine_status === "waived" ? "Waived" : "—";
        return `
          <tr${extra}>
            <td><span class="isbn-code">#TX-${this.escapeHTML(t.id)}</span></td>
            <td><strong>${this.escapeHTML(t.book_title)}</strong><div style="font-size:11px; color:var(--text-muted);">${this.escapeHTML(t.book_isbn)}</div></td>
            <td>${this.escapeHTML(t.student_name)}<div style="font-size:11px; color:var(--text-muted);">${this.escapeHTML(t.student_roll)}</div></td>
            <td>${this.escapeHTML(t.issue_date)}</td>
            <td>${this.escapeHTML(t.due_date)}</td>
            <td>${this.escapeHTML(t.return_date || "—")}</td>
            <td>₹${Number(t.fine || 0).toFixed(2)}</td>
            <td>${this.escapeHTML(paymentLabel)}</td>
            <td><span class="badge ${t.status === "issued" ? "badge-warning" : "badge-success"}">${t.status === "issued" ? "Issued" : "Returned"}</span></td>
          </tr>
        `;
      };
      if (!transactions.length) {
        transactionsContainer.innerHTML = `<tr><td colspan="9" style="text-align:center; padding:24px;">No circulation records yet.</td></tr>`;
      } else {
        let groupIndex = 0;
        transactionsContainer.innerHTML = [...studentGroups.values()].map(records => {
          const groupId = `student-history-${groupIndex++}`;
          const [latest, ...older] = records;
          const latestRow = formatTransactionRow(latest, older.length
            ? ` class="student-history-latest" data-history-group="${groupId}" data-older-count="${older.length}" tabindex="0" role="button" aria-expanded="false" aria-label="Show full history for ${this.escapeHTML(latest.student_name)}, ${older.length} older records"`
            : "");
          const labeledLatest = older.length
            ? latestRow.replace(`#TX-${this.escapeHTML(latest.id)}</span>`, `#TX-${this.escapeHTML(latest.id)}</span><span class="student-history-toggle-hint">${older.length} older record${older.length === 1 ? "" : "s"} · click to expand</span>`)
            : latestRow;
          const olderRows = older.map(record => formatTransactionRow(record, ` class="student-history-older" data-history-parent="${groupId}" hidden`)).join("");
          return labeledLatest + olderRows;
        }).join("");
      }
      if (!transactionsContainer.dataset.historyBound) {
        const toggleHistory = row => {
          if (!row?.matches(".student-history-latest")) return;
          const groupId = row.dataset.historyGroup;
          const expanded = row.getAttribute("aria-expanded") === "true";
          row.setAttribute("aria-expanded", String(!expanded));
          row.querySelector(".student-history-toggle-hint")?.replaceChildren(document.createTextNode(
            `${expanded ? "Click to expand" : "Click to collapse"} · ${row.dataset.olderCount} older record${row.dataset.olderCount === "1" ? "" : "s"}`
          ));
          transactionsContainer.querySelectorAll(`[data-history-parent="${groupId}"]`).forEach(olderRow => { olderRow.hidden = expanded; });
        };
        transactionsContainer.addEventListener("click", event => toggleHistory(event.target.closest(".student-history-latest")));
        transactionsContainer.addEventListener("keydown", event => {
          const row = event.target.closest(".student-history-latest");
          if (row && (event.key === "Enter" || event.key === " ")) { event.preventDefault(); toggleHistory(row); }
        });
        transactionsContainer.dataset.historyBound = "true";
      }
    }
  }

  // --- View 8: Settings ---
  renderSettings() {
    const s = window.db.getSettings();
    document.getElementById("setting-lib-name").value = s.library_name;
    document.getElementById("setting-fine-rate").value = s.fine_per_day;
    document.getElementById("setting-alert-days").value = s.alert_threshold_days;
  }

  async renderReissueRequests(bodyId = "reports-reissue-requests-tbody") {
    const body = document.getElementById(bodyId);
    if (!body) return;
    const historyMode = bodyId === "reports-reissue-requests-tbody";
    const searchInput = historyMode ? document.getElementById("reissue-history-search") : null;
    const statusFilter = historyMode ? document.getElementById("reissue-history-status") : null;
    if (searchInput && !searchInput.dataset.bound) {
      searchInput.addEventListener("input", () => this.filterReissueRequests());
      searchInput.dataset.bound = "true";
    }
    if (statusFilter && !statusFilter.dataset.bound) {
      statusFilter.addEventListener("change", () => this.filterReissueRequests());
      statusFilter.dataset.bound = "true";
    }
    body.innerHTML = `<tr><td colspan="${historyMode ? 7 : 6}" style="text-align:center; padding:20px;">Loading requests…</td></tr>`;
    try {
      const response = await this.messageApiRequest(`/api/reissue-requests${historyMode ? "?history=1" : ""}`);
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || "Could not load reissue requests.");
      if (!result.requests?.length) {
        body.innerHTML = `<tr><td colspan="${historyMode ? 7 : 6}" style="text-align:center; padding:20px;">${historyMode ? "No reissue request history yet." : "No pending reissue requests."}</td></tr>`;
        return;
      }
      body.innerHTML = result.requests.map(request => `
        <tr${historyMode ? ` data-request-search="${this.escapeHTML(`${request.studentName} ${request.studentRoll}`.toLocaleLowerCase())}" data-request-status="${this.escapeHTML(request.status || "pending")}"` : ""}>
          <td><strong>${this.escapeHTML(request.studentName)}</strong><div style="font-size:11px;color:var(--text-muted);">${this.escapeHTML(request.studentRoll)}</div></td>
          <td>${this.escapeHTML(request.bookTitle)}</td>
          <td>${this.escapeHTML(request.dueDate)}</td>
          <td>${this.escapeHTML(request.reissuesUsed)}/2 used</td>
          <td>${this.escapeHTML(request.requestedAt ? new Date(request.requestedAt).toLocaleString() : "—")}</td>
          ${historyMode ? `<td><span class="badge ${request.status === "approved" ? "badge-success" : request.status === "pending" ? "badge-warning" : "badge-accent"}">${this.escapeHTML((request.status || "pending").replace(/^./, letter => letter.toUpperCase()))}</span>${request.reviewedBy ? `<div style="font-size:11px;color:var(--text-muted);">by ${this.escapeHTML(request.reviewedBy)}</div>` : ""}</td>` : ""}
          <td style="white-space:nowrap;">
            ${request.status === "pending" || !historyMode ? `<button class="btn btn-primary btn-sm" type="button" onclick="window.app.reviewReissueRequest(${Number(request.id)}, 'approve')">Approve</button>
            <button class="btn btn-secondary btn-sm" type="button" onclick="window.app.reviewReissueRequest(${Number(request.id)}, 'reject')">Reject</button>` : ""}
            ${historyMode ? `<button class="btn btn-secondary btn-sm" type="button" onclick="window.app.deleteReissueRequest(${Number(request.id)})" aria-label="Delete this reissue request history entry">Delete</button>` : ""}
          </td>
        </tr>
      `).join("");
      if (historyMode) this.filterReissueRequests();
    } catch (error) {
      body.innerHTML = `<tr><td colspan="${historyMode ? 7 : 6}" style="text-align:center; padding:20px;">${this.escapeHTML(error.message)}</td></tr>`;
    }
  }

  filterReissueRequests() {
    const query = (document.getElementById("reissue-history-search")?.value || "").trim().toLocaleLowerCase();
    const status = (document.getElementById("reissue-history-status")?.value || "all").toLocaleLowerCase();
    document.querySelectorAll("#reports-reissue-requests-tbody tr[data-request-search]").forEach(row => {
      const matchesSearch = !query || row.dataset.requestSearch.includes(query);
      const matchesStatus = status === "all" || row.dataset.requestStatus === status;
      row.hidden = !matchesSearch || !matchesStatus;
    });
  }

  async deleteReissueRequest(requestId) {
    if (!confirm("Delete this reissue request history entry? This does not undo an approved due-date extension.")) return;
    try {
      const response = await this.messageApiRequest(`/api/reissue-requests/${Number(requestId)}`, { method: "DELETE" });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || "Could not delete this reissue request.");
      await window.db.loadRemoteData();
      await this.renderReissueRequests();
      await this.renderDashboardReissueRequests();
      this.showToast("Reissue History Deleted", "The selected request entry was deleted.", "success");
    } catch (error) {
      this.showToast("Could Not Delete Request", error.message, "danger");
    }
  }

  async reviewReissueRequest(requestId, action) {
    if (action === "reject" && !confirm("Reject this reissue request?")) return;
    try {
      const response = await this.messageApiRequest(`/api/reissue-requests/${Number(requestId)}/actions`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action })
      });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || "Could not process this request.");
      if (action === "approve") await window.db.loadRemoteData();
      await this.renderReissueRequests();
      await this.renderDashboardReissueRequests();
      if (action === "approve") this.renderDashboard();
      this.showToast(action === "approve" ? "Reissue Approved" : "Request Rejected",
        action === "approve" ? `New due date: ${result.dueDate}.` : "The student request was rejected.", "success");
    } catch (error) {
      this.showToast("Reissue Request Error", error.message, "danger");
    }
  }

  saveSettings(e) {
    e.preventDefault();
    const newSettings = {
      library_name: document.getElementById("setting-lib-name").value.trim(),
      fine_per_day: parseFloat(document.getElementById("setting-fine-rate").value) || 5.0,
      alert_threshold_days: parseInt(document.getElementById("setting-alert-days").value) || 3
    };

    window.db.saveSettings(newSettings);
    this.showToast("Settings Saved", "Library configurations updated successfully.", "success");
  }

  async changeAdminPassword(event) {
    event.preventDefault();
    const currentPassword = document.getElementById("security-current-password").value;
    const newPassword = document.getElementById("security-new-password").value;
    const confirmPassword = document.getElementById("security-confirm-password").value;
    if (newPassword.length < 8 || newPassword.length > 128) {
      this.showToast("Password Not Updated", "Use a password between 8 and 128 characters.", "danger");
      return;
    }
    if (newPassword !== confirmPassword) {
      this.showToast("Password Not Updated", "The new password and confirmation do not match.", "danger");
      return;
    }
    try {
      const response = await fetch("/api/auth/change-password", {
        method: "POST",
        credentials: "same-origin",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ currentPassword, newPassword })
      });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || "Could not update the password.");
      window.location.replace("login.html?passwordChanged=1");
    } catch (error) {
      this.showToast("Password Not Updated", error.message, "danger");
    }
  }

  toggleSecurityForm(kind, forceOpen = null) {
    const panels = {
      password: document.getElementById("security-password-panel"),
      username: document.getElementById("security-username-panel")
    };
    const buttons = [...document.querySelectorAll(".account-security-options [aria-controls]")];
    const target = panels[kind];
    if (!target) return;
    const shouldOpen = forceOpen === null ? target.hidden : Boolean(forceOpen);
    Object.entries(panels).forEach(([name, panel]) => {
      if (panel) panel.hidden = !shouldOpen || name !== kind;
    });
    buttons.forEach(button => button.setAttribute("aria-expanded", String(shouldOpen && button.getAttribute("aria-controls") === target.id)));
  }

  async changeAdminUsername(event) {
    event.preventDefault();
    const currentPassword = document.getElementById("security-username-current-password").value;
    const username = document.getElementById("security-new-username").value.trim();
    if (!/^[A-Za-z0-9_.@ -]{3,40}$/.test(username)) {
      this.showToast("Username Not Updated", "Username must be 3-40 characters and use only letters, numbers, spaces, dots, underscores, hyphens, or @.", "danger");
      return;
    }
    try {
      const response = await fetch("/api/auth/change-username", {
        method: "POST",
        credentials: "same-origin",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ currentPassword, username })
      });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || "Could not update the username.");
      window.adminDisplayName = result.username;
      const displayName = document.getElementById("admin-display-name");
      if (displayName) displayName.textContent = result.username;
      document.getElementById("security-username-current-password").value = "";
      document.getElementById("security-new-username").value = "";
      this.toggleSecurityForm("username", false);
      this.showToast("Username Updated", `Your admin username is now ${result.username}.`, "success");
    } catch (error) {
      this.showToast("Username Not Updated", error.message, "danger");
    }
  }

  downloadJSONBackup() {
    const jsonStr = window.db.exportDatabaseJSON();
    const blob = new Blob([jsonStr], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = `dgi_library_backup_${new Date().toISOString().split('T')[0]}.json`;
    link.click();
    this.showToast("Backup Downloaded", "Database JSON backup saved to your downloads.", "success");
  }

  async importJSONBackup(event) {
    const file = event.target.files[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = async (e) => {
      try {
        await window.db.importDatabaseJSON(e.target.result);
        this.showToast("Database Restored", "Library database successfully loaded from backup!", "success");
        this.renderCurrentView();
      } catch (err) {
        this.showToast("Restore Failed", err.message, "danger");
      }
    };
    reader.readAsText(file);
  }

  async classifyBookGenres() {
    const total = window.db.getBooks().length;
    if (!confirm(`Automatically assign subject-based genres to all ${total} catalog titles using their branch, title, and subject details?`)) return;
    try {
      const result = await window.db.classifyBookGenres();
      this.renderBooks();
      this.showToast("Branch Genres Updated", `Assigned categories to ${result.changed} titles across ${result.total} catalog titles.`, "success");
    } catch (error) {
      this.showToast("Genre Update Failed", error.message, "danger");
    }
  }

  async importBooksExcel(event) {
    const input = event.currentTarget;
    const file = input.files?.[0];
    if (!file) return;

    try {
      const parsed = await window.bookExcelImporter.parse(file);
      const sheetNames = parsed.sourceSheets.join(", ");
      const totalCopies = parsed.books.reduce((total, book) => total + Number(book.quantity || 0), 0);
      const accessionMismatches = parsed.books.filter(book =>
        Array.isArray(book.accessionNos) && book.accessionNos.length && book.accessionNos.length !== Number(book.quantity)
      ).length;
      const skippedNote = parsed.skippedRows
        ? `\n${parsed.skippedRows} rows with invalid quantities will be skipped.`
        : "";
      const accessionNote = accessionMismatches
        ? `\n${accessionMismatches} title rows have a Qty that differs from their listed accession numbers. The import will preserve both values.`
        : "";
      if (!confirm(
        `${parsed.books.length} titled book rows found in ${sheetNames} (${totalCopies} copies by Qty).\n` +
        "Duplicate books will be combined or skipped. Books will be saved to the library database." +
        skippedNote +
        accessionNote +
        "\n\nContinue with import?"
      )) return;

      const result = await window.db.importBooks(parsed.books);
      this.renderBooks();
      this.showToast(
        result.addedBooks ? "Books Imported" : "No New Books",
        result.addedBooks
          ? `Added ${result.addedBooks} book titles (${result.addedCopies} copies). Skipped ${result.skippedBooks} duplicates.`
          : `All ${result.skippedBooks} book titles already exist in the catalog.`,
        result.addedBooks ? "success" : "info"
      );
    } catch (error) {
      this.showToast("Excel Import Failed", error.message, "danger");
    } finally {
      input.value = "";
    }
  }

  restoreScreenshotRecords() {
    if (confirm("Restore the screenshot's students, books, and transactions? Existing library data will be kept.")) {
      try {
        window.db.applyStudentRecordImport(true);
        this.showToast("Screenshot Records Restored", "Screenshot records were added without clearing existing library data.", "success");
        this.renderCurrentView();
      } catch (error) {
        this.showToast("Restore Failed", error.message, "danger");
      }
    }
  }

  // --- Modals & Printing ---
  openAddBookModal(preselectSubjectId) {
    document.getElementById("form-book")?.reset();
    document.getElementById("book-modal-id").value = "";
    this.renderBookCategorySuggestions();
    this.renderBookSubjectOptions(preselectSubjectId || this.activeSubjectId);
    const yearInput = document.getElementById("book-modal-year");
    if (yearInput) yearInput.value = new Date().getFullYear();
    document.getElementById("modal-book-title").textContent = "Add New Book";
    document.getElementById("modal-book").classList.add("active");
  }

  renderBookSubjectOptions(preselectedSubjectId) {
    const select = document.getElementById("book-modal-subject");
    if (!select) return;
    const subjects = window.db.getSubjects ? window.db.getSubjects() : [];
    select.innerHTML = subjects.map(s => `
      <option value="${s.subject_id}" ${preselectedSubjectId && window.db.matchId(preselectedSubjectId, s.subject_id) ? "selected" : ""}>
        ${this.escapeHTML(s.subject_code ? `[${s.subject_code}] ` : "")}${this.escapeHTML(s.subject_name)}
      </option>
    `).join("");
  }

  renderBookCategorySuggestions() {
    const categoryList = document.getElementById("book-category-options");
    if (!categoryList) return;
    const categories = this.getBookCategories();
    categoryList.replaceChildren(...categories.map(category => new Option(category, category)));
  }

  getBookCategories() {
    return [...new Set(
      window.db.getBooks()
        .map(book => String(book.category || "").trim())
        .filter(Boolean)
    )];
  }

  openEditBookModal(bookId) {
    const b = window.db.getBookById ? window.db.getBookById(bookId) : window.db.getBooks().find(item => window.db.matchId(item.book_id || item.id, bookId));
    if (!b) return;

    this.renderBookCategorySuggestions();
    this.renderBookSubjectOptions(b.subject_id);
    document.getElementById("book-modal-id").value = b.book_id || b.id;
    document.getElementById("book-modal-title-input").value = b.title || b.book_name || "";
    document.getElementById("book-modal-author").value = b.author || "";
    document.getElementById("book-modal-publisher").value = b.publisher || "";
    const yearInput = document.getElementById("book-modal-year");
    if (yearInput) yearInput.value = b.publication_year || b.published_year || "";
    document.getElementById("book-modal-isbn").value = b.isbn || "";
    document.getElementById("book-modal-category").value = b.category || "";
    document.getElementById("book-modal-qty").value = b.quantity || b.total_copies || 1;
    document.getElementById("book-modal-desc").value = b.description || "";
    document.getElementById("modal-book-title").textContent = "Edit Book Details";
    document.getElementById("modal-book").classList.add("active");
  }

  submitBookForm(e) {
    e.preventDefault();
    const id = document.getElementById("book-modal-id").value;
    const subjectSelect = document.getElementById("book-modal-subject");
    const subjectId = subjectSelect ? (subjectSelect.value.trim() || null) : null;
    const yearVal = document.getElementById("book-modal-year")?.value || "";

    const bookData = {
      title: document.getElementById("book-modal-title-input").value,
      book_name: document.getElementById("book-modal-title-input").value,
      author: document.getElementById("book-modal-author").value,
      publisher: document.getElementById("book-modal-publisher").value.trim(),
      publication_year: yearVal,
      published_year: yearVal,
      isbn: document.getElementById("book-modal-isbn").value,
      category: document.getElementById("book-modal-category").value,
      subject_id: subjectId,
      quantity: document.getElementById("book-modal-qty").value,
      total_copies: document.getElementById("book-modal-qty").value,
      description: document.getElementById("book-modal-desc").value
    };

    try {
      if (id) {
        window.db.updateBook(id, bookData);
        this.showToast("Book Updated", `Updated '${bookData.title}' successfully.`, "success");
      } else {
        window.db.addBook(bookData);
        this.showToast("Book Added", `Added '${bookData.title}' to library catalog.`, "success");
      }
      this.closeModal("modal-book");
      this.renderBooks();
      this.renderSubjectsCards();
      if (this.activeSubjectId) {
        this.renderSubjectBooksTable();
      }
    } catch (err) {
      this.showToast("Error", err.message, "danger");
    }
  }

  deleteBook(bookId) {
    const b = window.db.getBookById ? window.db.getBookById(bookId) : window.db.getBooks().find(item => window.db.matchId(item.book_id || item.id, bookId));
    if (!b) return;

    if (confirm(`Are you sure you want to delete '${b.title || b.book_name}'?`)) {
      try {
        window.db.deleteBook(b.book_id || b.id || bookId);
        this.showToast("Book Deleted", `'${b.title || b.book_name}' was removed.`, "info");
        this.renderBooks();
        this.renderSubjectsCards();
        if (this.activeSubjectId) {
          this.renderSubjectBooksTable();
        }
      } catch (err) {
        this.showToast("Deletion Blocked", err.message, "danger");
      }
    }
  }

  openBookDetailsModal(bookId) {
    const b = window.db.getBookById ? window.db.getBookById(bookId) : window.db.getBooks().find(item => window.db.matchId(item.book_id || item.id, bookId));
    if (!b) {
      this.showToast("Error", "Book details not found.", "danger");
      return;
    }
    const subjects = window.db.getSubjects ? window.db.getSubjects() : [];
    const subject = subjects.find(s => window.db.matchId(s.subject_id, b.subject_id));
    const title = b.title || b.book_name || "Untitled Book";
    const available = Number(b.available ?? b.available_copies ?? 0);
    const total = Number(b.quantity ?? b.total_copies ?? 0);
    const isAvail = available > 0;
    const year = b.publication_year || b.published_year || "—";
    const accessions = this.getBookAccessions(b);

    const titleEl = document.getElementById("admin-book-detail-title");
    const bodyEl = document.getElementById("admin-book-detail-body");
    const footerEl = document.getElementById("admin-book-detail-footer");

    if (titleEl) titleEl.textContent = title;
    if (bodyEl) {
      bodyEl.innerHTML = `
        <div style="display:flex; gap:18px; align-items:flex-start; margin-bottom:14px; flex-wrap:wrap;">
          <div style="width:84px; height:110px; border-radius:8px; display:flex; align-items:center; justify-content:center; font-size:38px; box-shadow:0 6px 14px rgba(0,0,0,0.22); background: linear-gradient(135deg, ${this.safeBookColor(b.color1)}, ${this.safeBookColor(b.color2)}); color:#ffc500; border:1px solid #d8caa7; flex-shrink:0;">
            📖
          </div>
          <div style="flex:1; min-width:220px;">
            <div style="display:flex; align-items:center; gap:8px; margin-bottom:6px; flex-wrap:wrap;">
              <code class="book-id-badge" style="font-size:12px; font-weight:800; color:#FFF9EB; background:#4B0028; padding:3px 8px; border-radius:4px; font-family:monospace;">${this.escapeHTML(b.book_id || b.id)}</code>
              ${isAvail ? `<span class="badge badge-success">Available (${available} left)</span>` : `<span class="badge badge-danger">Out of Stock</span>`}
            </div>
            <h2 class="book-details-title" style="margin:0 0 5px; font-size:19px; font-weight:800; color:#4B0028; line-height:1.3;">${this.escapeHTML(title)}</h2>
            <div style="font-size:13px; color:#292929; margin-bottom:4px;">by <strong style="color:#292929;">${this.escapeHTML(b.author || "Unknown")}</strong></div>
            <div style="font-size:12px; color:#555555;">Subject: <strong style="color:#4B0028;">${this.escapeHTML(subject ? subject.subject_name : (b.category || "General"))}</strong> ${subject?.subject_code ? `<span style="color:#555555;">(${this.escapeHTML(subject.subject_code)})</span>` : ""}</div>
          </div>
        </div>

        <div class="book-details-grid" style="display:grid; grid-template-columns:1fr 1fr; gap:10px 14px; background:#FFFFFF; padding:12px 16px; border-radius:10px; border:1px solid #ebd9b8; margin-bottom:12px; font-size:13px; box-shadow:0 2px 6px rgba(0,0,0,0.04);">
          <div><span class="spec-label" style="color:#555555; font-weight:600;">ISBN:</span> <code class="isbn-badge" style="font-weight:700; color:#4B0028; background:#f0e3c5; padding:2px 6px; border-radius:4px; border:1px solid #dfd0ad;">${this.escapeHTML(b.isbn || "—")}</code></div>
          <div><span class="spec-label" style="color:#555555; font-weight:600;">Category:</span> <strong style="color:#292929;">${this.escapeHTML(b.category || "General")}</strong></div>
          <div><span class="spec-label" style="color:#555555; font-weight:600;">Publisher:</span> <strong style="color:#292929;">${this.escapeHTML(b.publisher || "—")}</strong></div>
          <div><span class="spec-label" style="color:#555555; font-weight:600;">Year:</span> <strong style="color:#292929;">${this.escapeHTML(year)}</strong></div>
          <div><span class="spec-label" style="color:#555555; font-weight:600;">Total Inventory:</span> <strong style="color:#292929;">${total} copies</strong></div>
          <div><span class="spec-label" style="color:#555555; font-weight:600;">Currently Available:</span> <strong style="color:${isAvail ? '#059669' : '#dc2626'}; font-size:14px; font-weight:800;">${available} copies</strong></div>
        </div>

        <div style="margin-bottom:10px;">
          <div style="font-size:11px; font-weight:800; color:#4B0028; text-transform:uppercase; letter-spacing:0.5px; margin-bottom:4px;">Description</div>
          <div style="font-size:13px; color:#292929; line-height:1.5;">${this.escapeHTML(b.description || "Comprehensive academic reference book from library collections.")}</div>
        </div>

        ${accessions.length ? `
          <div style="margin-top:8px; margin-bottom:2px;">
            <div style="font-size:11px; font-weight:800; color:#4B0028; text-transform:uppercase; letter-spacing:0.5px; margin-bottom:4px;">Accession Numbers (${accessions.length})</div>
            <div style="max-height:65px; overflow:auto; display:flex; gap:6px; flex-wrap:wrap; padding:6px; background:#FFFFFF; border:1px solid #ebd9b8; border-radius:6px;">
              ${accessions.map(a => `<code style="font-size:11px; font-weight:700; padding:2px 6px; background:#f0e3c5; color:#4B0028; border:1px solid #dfd0ad; border-radius:3px;">${this.escapeHTML(a)}</code>`).join("")}
            </div>
          </div>
        ` : ""}
      `;
    }

    if (footerEl) {
      footerEl.innerHTML = `
        <button class="btn btn-secondary" onclick="window.app.closeModal('modal-admin-book-details')">Close</button>
        <button class="btn btn-secondary" onclick="window.app.closeModal('modal-admin-book-details'); window.app.openEditBookModal('${this.escapeHTML(b.book_id || b.id)}')">✏️ Edit Book</button>
        <button class="btn btn-primary" ${available === 0 ? 'disabled style="opacity:0.5; cursor:not-allowed;"' : ''} onclick="window.app.closeModal('modal-admin-book-details'); window.app.quickIssueBook('${this.escapeHTML(b.book_id || b.id)}')">Issue Book</button>
      `;
    }

    const modal = document.getElementById("modal-admin-book-details");
    if (modal) modal.classList.add("active");
  }

  // --- Admin Book Requests Management ---
  async loadAdminBookRequests() {
    try {
      const res = await fetch("/api/admin/book-requests", { credentials: "same-origin" });
      if (res.ok) {
        const data = await res.json();
        this.adminBookRequests = data.requests || [];
      } else {
        this.adminBookRequests = window.db.getBookRequests ? window.db.getBookRequests() : [];
      }
    } catch {
      this.adminBookRequests = window.db.getBookRequests ? window.db.getBookRequests() : [];
    }
    this.updateAdminBookRequestsBadge();
    this.renderAdminBookRequests();
  }

  updateAdminBookRequestsBadge() {
    const requests = this.adminBookRequests.length ? this.adminBookRequests : (window.db.getBookRequests ? window.db.getBookRequests() : []);
    const pendingCount = requests.filter(r => (r.status || "").toLowerCase() === "pending").length;
    const badge = document.getElementById("nav-book-requests-badge");
    if (badge) {
      badge.textContent = pendingCount;
      badge.style.display = pendingCount > 0 ? "inline-flex" : "none";
    }
  }

  renderAdminBookRequests() {
    const tbody = document.getElementById("admin-book-requests-tbody");
    if (!tbody) return;

    const searchVal = (document.getElementById("admin-requests-search")?.value || "").toLowerCase().trim();
    const statusVal = document.getElementById("admin-requests-status-filter")?.value || "Pending";

    let requests = this.adminBookRequests.length ? [...this.adminBookRequests] : (window.db.getBookRequests ? window.db.getBookRequests() : []);

    if (statusVal !== "all") {
      requests = requests.filter(r => (r.status || "").toLowerCase() === statusVal.toLowerCase());
    }

    if (searchVal) {
      requests = requests.filter(r =>
        String(r.request_id || r.id || "").toLowerCase().includes(searchVal) ||
        String(r.student_name || "").toLowerCase().includes(searchVal) ||
        String(r.student_roll || r.roll_no || r.student_id || "").toLowerCase().includes(searchVal) ||
        String(r.book_title || r.title || "").toLowerCase().includes(searchVal) ||
        String(r.book_id || "").toLowerCase().includes(searchVal)
      );
    }

    if (requests.length === 0) {
      tbody.innerHTML = `<tr><td colspan="9" style="text-align: center; padding: 40px; color:var(--text-muted);">
        <div style="font-size:32px; margin-bottom:8px;">📥</div>
        <div style="font-size:15px; font-weight:700; color:var(--text-primary); margin-bottom:4px;">No book requests found</div>
        <div>There are no student book requests matching this filter.</div>
      </td></tr>`;
      return;
    }

    tbody.innerHTML = requests.map(r => {
      const reqId = r.request_id || r.id;
      const isPending = (r.status || "").toLowerCase() === "pending";
      const isApproved = (r.status || "").toLowerCase() === "approved";
      const isRejected = (r.status || "").toLowerCase() === "rejected";
      const inStock = Number(r.available_copies ?? r.available ?? 1);

      let statusBadge = `<span class="badge badge-warning">Pending</span>`;
      if (isApproved) statusBadge = `<span class="badge badge-success">Approved</span>`;
      else if (isRejected) statusBadge = `<span class="badge badge-danger">Rejected</span>`;

      return `
        <tr>
          <td><code style="font-size:12px; font-weight:700; color:var(--accent-primary);">${this.escapeHTML(reqId)}</code></td>
          <td>
            <div style="font-weight:700; color:var(--text-primary);">${this.escapeHTML(r.student_name || "Student")}</div>
            <div style="font-size:11px; color:var(--text-muted);">${this.escapeHTML(r.student_roll || r.roll_no || r.student_id || "")}</div>
          </td>
          <td>
            <div style="font-weight:700; color:var(--text-primary);">${this.escapeHTML(r.book_title || "Untitled")}</div>
            <div style="font-size:11px; color:var(--text-muted);"><code>${this.escapeHTML(r.book_id || "")}</code></div>
          </td>
          <td><span class="isbn-code">${this.escapeHTML(r.isbn || "—")}</span></td>
          <td><strong style="color:${inStock > 0 ? 'var(--success)' : 'var(--danger)'};">${inStock}</strong></td>
          <td>${this.escapeHTML(r.request_date || "—")}</td>
          <td style="font-size:12px; max-width:180px; overflow:hidden; text-overflow:ellipsis;">${this.escapeHTML(r.notes || "—")}</td>
          <td>${statusBadge}</td>
          <td style="text-align:right;">
            ${isPending ? `
              <div class="action-btn-group" style="justify-content:flex-end;">
                <button class="btn btn-primary btn-sm" ${inStock <= 0 ? 'disabled title="Cannot approve: Out of stock"' : ''} onclick="window.app.approveBookRequest('${this.escapeHTML(reqId)}')">✓ Approve</button>
                <button class="btn btn-danger btn-sm" onclick="window.app.rejectBookRequest('${this.escapeHTML(reqId)}')">✕ Reject</button>
              </div>
            ` : `
              <span style="font-size:12px; color:var(--text-muted);">${isApproved ? 'Fulfilled' : (r.admin_notes || 'Closed')}</span>
            `}
          </td>
        </tr>
      `;
    }).join("");
  }

  async approveBookRequest(requestId) {
    if (!confirm(`Approve book request '${requestId}' and issue book to student?`)) return;
    try {
      const res = await fetch(`/api/admin/book-requests/${encodeURIComponent(requestId)}/approve`, {
        method: "POST",
        credentials: "same-origin"
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Failed to approve book request.");
      this.showToast("Request Approved", `Book has been issued (Issue ID: ${data.issue_id || "created"}).`, "success");
      await this.loadAdminBookRequests();
      this.renderBooks();
    } catch (err) {
      try {
        window.db.approveBookRequest(requestId);
        this.showToast("Request Approved", "Book request was approved locally.", "success");
        await this.loadAdminBookRequests();
        this.renderBooks();
      } catch (localErr) {
        this.showToast("Approval Failed", err.message || localErr.message, "danger");
      }
    }
  }

  async rejectBookRequest(requestId) {
    const reason = prompt("Enter reason for rejecting this request (optional):", "Copies currently reserved or unavailable.");
    if (reason === null) return;
    try {
      const res = await fetch(`/api/admin/book-requests/${encodeURIComponent(requestId)}/reject`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "same-origin",
        body: JSON.stringify({ reason })
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Failed to reject book request.");
      this.showToast("Request Rejected", "The request was marked as rejected.", "info");
      await this.loadAdminBookRequests();
    } catch (err) {
      try {
        window.db.rejectBookRequest(requestId, reason);
        this.showToast("Request Rejected", "The request was rejected locally.", "info");
        await this.loadAdminBookRequests();
      } catch (localErr) {
        this.showToast("Rejection Failed", err.message || localErr.message, "danger");
      }
    }
  }

  // --- Students Modals ---
  openAddStudentModal() {
    document.getElementById("form-student")?.reset();
    document.getElementById("student-modal-id").value = "";
    const phoneInput = document.getElementById("student-modal-phone");
    if (phoneInput) phoneInput.value = "+91";
    this.existingStudentMatchId = null;
    document.getElementById("student-existing-match").style.display = "none";
    document.querySelector("#form-student button[type='submit']").textContent = "Save Student";
    document.getElementById("modal-student-title").textContent = "Register New Student";
    document.getElementById("modal-student").classList.add("active");
  }

  openEditStudentModal(studentId) {
    const s = window.db.getStudentById(studentId);
    if (!s) return;

    document.getElementById("student-modal-id").value = s.id;
    document.getElementById("student-modal-name").value = s.name;
    document.getElementById("student-modal-roll").value = s.roll_no;
    document.getElementById("student-modal-email").value = s.email;
    const phoneInput = document.getElementById("student-modal-phone");
    if (phoneInput) phoneInput.value = this.normalizePhoneNumber(s.phone || "+91");
    document.getElementById("student-modal-dept").value = s.department;
    this.existingStudentMatchId = null;
    document.getElementById("student-existing-match").style.display = "none";
    document.querySelector("#form-student button[type='submit']").textContent = "Save Student";
    document.getElementById("modal-student-title").textContent = "Edit Student Profile";
    document.getElementById("modal-student").classList.add("active");
  }

  checkExistingStudent() {
    if (document.getElementById("student-modal-id").value) return;

    const rollNo = (document.getElementById("student-modal-roll")?.value || "").trim();
    const phone = (document.getElementById("student-modal-phone")?.value || "").trim();
    const email = (document.getElementById("student-modal-email")?.value || "").trim();
    const notice = document.getElementById("student-existing-match");
    const submitButton = document.querySelector("#form-student button[type='submit']");
    if (!notice || !submitButton) return;

    const match = window.db.findMatchingStudent({ roll_no: rollNo, phone, email });

    const previousMatch = this.existingStudentMatchId ? window.db.getStudentById(this.existingStudentMatchId) : null;
    this.existingStudentMatchId = match?.id || null;

    if (!match) {
      if (previousMatch) {
        const fields = [
          ["student-modal-name", previousMatch.name],
          ["student-modal-email", previousMatch.email],
          ["student-modal-phone", previousMatch.phone],
          ["student-modal-dept", previousMatch.department]
        ];
        fields.forEach(([fieldId, oldValue]) => {
          const field = document.getElementById(fieldId);
          if (field && field.value === oldValue) field.value = "";
        });
      }
      notice.style.display = "none";
      submitButton.textContent = "Save Student";
      return;
    }

    document.getElementById("student-modal-name").value = match.name;
    document.getElementById("student-modal-email").value = match.email;
    document.getElementById("student-modal-phone").value = match.phone;
    document.getElementById("student-modal-dept").value = match.department || "";
    notice.innerHTML = `<strong>${this.escapeHTML(match.name)} (${this.escapeHTML(match.roll_no)})</strong> is already registered. Saved details are filled; continuing will use this existing record without creating a duplicate.`;
    notice.style.display = "block";
    submitButton.textContent = "Use Existing Student Record";
  }

  submitStudentForm(e) {
    e.preventDefault();
    const id = document.getElementById("student-modal-id").value;
    const studentData = {
      name: document.getElementById("student-modal-name").value.trim(),
      roll_no: document.getElementById("student-modal-roll").value.trim(),
      email: document.getElementById("student-modal-email").value.trim(),
      phone: this.normalizePhoneNumber(document.getElementById("student-modal-phone").value),
      department: document.getElementById("student-modal-dept").value.trim()
    };

    try {
      if (!id) {
        const existingStudent = window.db.findMatchingStudent(studentData);
        if (existingStudent) {
          window.db.updateStudent(existingStudent.id, {
            name: studentData.name || existingStudent.name,
            phone: studentData.phone || existingStudent.phone,
            email: studentData.email || existingStudent.email,
            department: studentData.department || existingStudent.department
          });
          this.closeModal("modal-student");
          this.existingStudentMatchId = null;
          this.showToast("Student Already Registered", `${existingStudent.name}'s existing record was used.`, "info");
          this.renderStudents();
          return;
        }
      }

      let savedStudent;
      if (id) {
        savedStudent = window.db.updateStudent(id, studentData);
        this.showToast("Student Updated", `Profile for ${studentData.name} saved.`, "success");
      } else {
        savedStudent = window.db.addStudent(studentData);
        this.showToast("Student Registered", `${studentData.name} enrolled in library system.`, "success");
      }
      this.closeModal("modal-student");
      this.renderStudents();
    } catch (err) {
      this.showToast("Error", err.message, "danger");
    }
  }

  deleteStudent(studentId) {
    const s = window.db.getStudentById(studentId);
    if (!s) return;

    if (confirm(`Are you sure you want to delete student '${s.name}' (${s.roll_no})?`)) {
      try {
        window.db.deleteStudent(studentId);
        this.showToast("Student Removed", `${s.name} removed from system.`, "info");
        this.renderStudents();
      } catch (err) {
        this.showToast("Cannot Delete", err.message, "danger");
      }
    }
  }

  // --- Shared CSV Parser Utility ---
  parseCsvString(str) {
    const rows = [];
    let currentRow = [];
    let currentVal = "";
    let inQuotes = false;
    let i = 0;
    const s = String(str || "").replace(/\r\n/g, "\n").replace(/\r/g, "\n");
    while (i < s.length) {
      const char = s[i];
      if (inQuotes) {
        if (char === '"') {
          if (i + 1 < s.length && s[i + 1] === '"') {
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
        } else if (char === ",") {
          currentRow.push(currentVal);
          currentVal = "";
          i++;
          continue;
        } else if (char === "\n") {
          currentRow.push(currentVal);
          currentVal = "";
          if (currentRow.some(val => val.trim().length > 0)) rows.push(currentRow);
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
      if (currentRow.some(val => val.trim().length > 0)) rows.push(currentRow);
    }
    return rows;
  }

  // --- CSV Import (3 Columns: Name, Author, Category) ---
  openCsvImportModal() {
    this._pendingCsvText = null;
    this._parsedCsvRows = null;
    const fileInput = document.getElementById("csv-file-input");
    if (fileInput) fileInput.value = "";
    const previewSection = document.getElementById("csv-preview-section");
    if (previewSection) previewSection.style.display = "none";
    const progress = document.getElementById("csv-import-progress");
    if (progress) progress.style.display = "none";
    const results = document.getElementById("csv-import-results");
    if (results) results.style.display = "none";
    const confirmBtn = document.getElementById("csv-confirm-import-btn");
    if (confirmBtn) {
      confirmBtn.style.display = "none";
      confirmBtn.disabled = false;
    }
    this.openModal("modal-csv-import");
  }

  handleCsvFileSelection(event) {
    const file = event.target.files && event.target.files[0];
    if (!file) return;

    if (!file.name.toLowerCase().endsWith(".csv")) {
      this.showToast("Invalid File Type", "Please select a valid .csv file.", "warning");
      event.target.value = "";
      return;
    }

    const reader = new FileReader();
    reader.onload = (e) => {
      const text = e.target.result;
      this._pendingCsvText = text;
      this._parseAndPreviewCsv(text);
    };
    reader.onerror = () => {
      this.showToast("File Read Error", "Could not read the selected CSV file.", "danger");
    };
    reader.readAsText(file);
  }

  _parseAndPreviewCsv(text) {
    const rows = this.parseCsvString(text);
    if (!rows || rows.length < 2) {
      this.showToast("Empty CSV", "The CSV file contains no data rows.", "warning");
      return;
    }

    const headers = rows[0].map(h => String(h || "").trim().toLowerCase());
    const nameIdx = headers.findIndex(h => ["name", "title", "book_name", "book title", "book"].includes(h));
    const authorIdx = headers.findIndex(h => ["author", "authors", "writer", "book_author"].includes(h));
    const categoryIdx = headers.findIndex(h => ["category", "genre", "department", "subject", "branch"].includes(h));

    if (nameIdx === -1 || authorIdx === -1 || categoryIdx === -1) {
      const missing = [];
      if (nameIdx === -1) missing.push("Name");
      if (authorIdx === -1) missing.push("Author");
      if (categoryIdx === -1) missing.push("Category");
      this.showToast("Invalid CSV Headers", `Missing required columns: ${missing.join(", ")}. File must have Name, Author, and Category.`, "danger");
      return;
    }

    const previewTbody = document.getElementById("csv-preview-tbody");
    if (previewTbody) {
      previewTbody.innerHTML = "";
      const previewRows = rows.slice(1, 6);
      previewRows.forEach(r => {
        const tr = document.createElement("tr");
        tr.innerHTML = `
          <td><strong>${this.escapeHTML(String(r[nameIdx] || ""))}</strong></td>
          <td>${this.escapeHTML(String(r[authorIdx] || ""))}</td>
          <td><span class="badge badge-primary">${this.escapeHTML(String(r[categoryIdx] || ""))}</span></td>
        `;
        previewTbody.appendChild(tr);
      });
    }

    const countElem = document.getElementById("csv-preview-count");
    if (countElem) countElem.textContent = String(rows.length - 1);

    const previewSection = document.getElementById("csv-preview-section");
    if (previewSection) previewSection.style.display = "block";
    const confirmBtn = document.getElementById("csv-confirm-import-btn");
    if (confirmBtn) confirmBtn.style.display = "inline-block";
  }

  async executeCsvImport() {
    if (!this._pendingCsvText) {
      this.showToast("No File Selected", "Please select a .csv file first.", "warning");
      return;
    }

    const progress = document.getElementById("csv-import-progress");
    const confirmBtn = document.getElementById("csv-confirm-import-btn");
    const results = document.getElementById("csv-import-results");

    if (progress) progress.style.display = "block";
    if (confirmBtn) confirmBtn.disabled = true;
    if (results) results.style.display = "none";

    try {
      const isOnline = ['http:', 'https:'].includes(window.location.protocol);
      let res = null;

      if (isOnline) {
        try {
          const response = await fetch("/api/admin/books/import-csv", {
            method: "POST",
            credentials: "same-origin",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ csv: this._pendingCsvText })
          });
          const json = await response.json();
          if (response.ok) {
            res = json;
          } else {
            throw new Error(json.error || `Server error (${response.status})`);
          }
        } catch (fetchErr) {
          if (fetchErr.message && !fetchErr.message.toLowerCase().includes("failed to fetch")) {
            throw fetchErr;
          }
        }
      }

      // Offline / file:// fallback
      if (!res) {
        const rows = this.parseCsvString(this._pendingCsvText);
        if (!rows || rows.length < 2) throw new Error("The CSV file contains no data rows.");

        const headers = rows[0].map(h => String(h || "").trim().toLowerCase());
        const nameIdx = headers.findIndex(h => ["name", "title", "book_name", "book title", "book"].includes(h));
        const authorIdx = headers.findIndex(h => ["author", "authors", "writer", "book_author"].includes(h));
        const categoryIdx = headers.findIndex(h => ["category", "genre", "department", "subject", "branch"].includes(h));

        if (nameIdx === -1 || authorIdx === -1 || categoryIdx === -1) {
          throw new Error("Missing required columns: Name, Author, and Category.");
        }

        const data = window.db._getData();
        data.books = Array.isArray(data.books) ? data.books : [];
        let nextId = data.books.reduce((max, b) => Math.max(max, Number(b.id) || 0), 0) + 1;
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

          const name = String(row[nameIdx] || "").trim();
          const author = String(row[authorIdx] || "").trim();
          const category = String(row[categoryIdx] || "").trim();

          if (!name || !author || !category) {
            invalidCount++;
            errors.push(`Row ${i + 1}: Missing Name, Author, or Category.`);
            continue;
          }

          const isDup = data.books.some(bk =>
            String(bk.title || "").trim().toLowerCase() === name.toLowerCase() &&
            String(bk.author || "").trim().toLowerCase() === author.toLowerCase()
          ) || importedBooks.some(bk =>
            bk.title.toLowerCase() === name.toLowerCase() &&
            bk.author.toLowerCase() === author.toLowerCase()
          );

          if (isDup) {
            duplicateCount++;
            continue;
          }

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

          data.books.push(newBook);
          importedBooks.push(newBook);
          importedCount++;
        }

        window.db._saveData(data);
        res = {
          success: true,
          totalFound,
          importedCount,
          duplicateCount,
          invalidCount,
          errors,
          books: data.books
        };
      }

      if (progress) progress.style.display = "none";
      if (results) results.style.display = "block";
      if (confirmBtn) confirmBtn.style.display = "none";

      document.getElementById("csv-summary-total").textContent = res.totalFound;
      document.getElementById("csv-summary-imported").textContent = res.importedCount;
      document.getElementById("csv-summary-duplicates").textContent = res.duplicateCount;
      document.getElementById("csv-summary-invalid").textContent = res.invalidCount;

      const errorBox = document.getElementById("csv-summary-errors-box");
      if (errorBox) {
        if (res.errors && res.errors.length > 0) {
          errorBox.innerHTML = `<strong>Validation Issues:</strong><br>${res.errors.join("<br>")}`;
          errorBox.style.display = "block";
        } else {
          errorBox.style.display = "none";
        }
      }

      if (Array.isArray(res.books)) {
        const data = window.db._getData();
        data.books = res.books;
        window.db._saveData(data);
      }
      this.renderBooks();
      this.renderDashboard();
      if (typeof this.updateCategoryPills === "function") this.updateCategoryPills();

      this.showToast("Import Successful", `${res.importedCount} new book(s) imported into catalog.`, "success");
    } catch (err) {
      if (progress) progress.style.display = "none";
      if (confirmBtn) confirmBtn.disabled = false;
      this.showToast("Import Failed", err.message, "danger");
    }
  }

  // --- Student CSV Import ---
  openStudentCsvImportModal() {
    this._pendingStudentCsvText = null;
    this._parsedStudentCsvRows = null;
    const fileInput = document.getElementById("student-csv-file-input");
    if (fileInput) fileInput.value = "";
    const previewSection = document.getElementById("student-csv-preview-section");
    if (previewSection) previewSection.style.display = "none";
    const progress = document.getElementById("student-csv-import-progress");
    if (progress) progress.style.display = "none";
    const results = document.getElementById("student-csv-import-results");
    if (results) results.style.display = "none";
    const confirmBtn = document.getElementById("student-csv-confirm-import-btn");
    if (confirmBtn) {
      confirmBtn.style.display = "none";
      confirmBtn.disabled = false;
    }
    this.openModal("modal-student-csv-import");
  }

  handleStudentCsvFileSelection(event) {
    const file = event.target.files && event.target.files[0];
    if (!file) return;

    if (!file.name.toLowerCase().endsWith(".csv")) {
      this.showToast("Invalid File Type", "Please select a valid .csv file.", "warning");
      event.target.value = "";
      return;
    }

    const reader = new FileReader();
    reader.onload = (e) => {
      const text = e.target.result;
      this._pendingStudentCsvText = text;
      this._parseAndPreviewStudentCsv(text);
    };
    reader.onerror = () => {
      this.showToast("File Read Error", "Could not read the selected student CSV file.", "danger");
    };
    reader.readAsText(file);
  }

  _parseAndPreviewStudentCsv(text) {
    const rows = this.parseCsvString(text);
    if (!rows || rows.length < 2) {
      this.showToast("Empty CSV", "The CSV file contains no data rows.", "warning");
      return;
    }

    const headers = rows[0].map(h => String(h || "").trim().toLowerCase());
    const nameIdx = headers.findIndex(h => ["student name", "name", "full name", "student", "student_name"].includes(h));
    const rollIdx = headers.findIndex(h => ["roll number", "roll no", "roll_no", "rollno", "roll", "admission no"].includes(h));
    const emailIdx = headers.findIndex(h => ["email", "email address", "email id", "email_id", "student email"].includes(h));
    const deptIdx = headers.findIndex(h => ["department", "dept", "branch", "course", "stream"].includes(h));
    const phoneIdx = headers.findIndex(h => ["contact phone", "phone", "phone number", "phone_number", "mobile", "contact", "contact no"].includes(h));

    if (nameIdx === -1 || rollIdx === -1) {
      const missing = [];
      if (nameIdx === -1) missing.push("Student Name");
      if (rollIdx === -1) missing.push("Roll Number");
      this.showToast("Invalid CSV Headers", `Missing required columns: ${missing.join(", ")}. Supported headers: Student Name, Roll Number, Email, Department, Contact Phone.`, "danger");
      return;
    }

    const previewTbody = document.getElementById("student-csv-preview-tbody");
    if (previewTbody) {
      previewTbody.innerHTML = "";
      const previewRows = rows.slice(1, 6);
      previewRows.forEach(r => {
        const tr = document.createElement("tr");
        const dept = deptIdx !== -1 && r[deptIdx] ? String(r[deptIdx]).trim() : "CSIT";
        const email = emailIdx !== -1 && r[emailIdx] ? String(r[emailIdx]).trim() : "—";
        const phone = phoneIdx !== -1 && r[phoneIdx] ? String(r[phoneIdx]).trim() : "+91";
        tr.innerHTML = `
          <td><strong>${this.escapeHTML(String(r[nameIdx] || "").trim())}</strong></td>
          <td><span class="isbn-code">${this.escapeHTML(String(r[rollIdx] || "").trim().toUpperCase())}</span></td>
          <td><span class="badge badge-accent">${this.escapeHTML(dept)}</span></td>
          <td>${this.escapeHTML(email)}</td>
          <td>${this.escapeHTML(phone)}</td>
        `;
        previewTbody.appendChild(tr);
      });
    }

    const countElem = document.getElementById("student-csv-preview-count");
    if (countElem) countElem.textContent = String(rows.length - 1);

    const previewSection = document.getElementById("student-csv-preview-section");
    if (previewSection) previewSection.style.display = "block";
    const confirmBtn = document.getElementById("student-csv-confirm-import-btn");
    if (confirmBtn) confirmBtn.style.display = "inline-block";
  }

  async executeStudentCsvImport() {
    if (!this._pendingStudentCsvText) {
      this.showToast("No File Selected", "Please select a .csv file first.", "warning");
      return;
    }

    const progress = document.getElementById("student-csv-import-progress");
    const confirmBtn = document.getElementById("student-csv-confirm-import-btn");
    const results = document.getElementById("student-csv-import-results");

    if (progress) progress.style.display = "block";
    if (confirmBtn) confirmBtn.disabled = true;
    if (results) results.style.display = "none";

    try {
      const isOnline = ['http:', 'https:'].includes(window.location.protocol);
      let res = null;

      if (isOnline) {
        try {
          const response = await fetch("/api/admin/students/import-csv", {
            method: "POST",
            credentials: "same-origin",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ csv: this._pendingStudentCsvText })
          });
          const json = await response.json();
          if (response.ok) {
            res = json;
          } else {
            throw new Error(json.error || `Server error (${response.status})`);
          }
        } catch (fetchErr) {
          if (fetchErr.message && !fetchErr.message.toLowerCase().includes("failed to fetch")) {
            throw fetchErr;
          }
        }
      }

      // Offline / file:// fallback
      if (!res) {
        const rows = this.parseCsvString(this._pendingStudentCsvText);
        if (!rows || rows.length < 2) {
          throw new Error("The CSV file contains no data rows.");
        }
        const headers = rows[0].map(h => String(h || "").trim().toLowerCase());
        const nameIdx = headers.findIndex(h => ["student name", "name", "full name", "student", "student_name"].includes(h));
        const rollIdx = headers.findIndex(h => ["roll number", "roll no", "roll_no", "rollno", "roll", "admission no"].includes(h));
        const emailIdx = headers.findIndex(h => ["email", "email address", "email id", "email_id", "student email"].includes(h));
        const deptIdx = headers.findIndex(h => ["department", "dept", "branch", "course", "stream"].includes(h));
        const phoneIdx = headers.findIndex(h => ["contact phone", "phone", "phone number", "phone_number", "mobile", "contact", "contact no"].includes(h));

        if (nameIdx === -1 || rollIdx === -1) {
          throw new Error("Missing required columns: Student Name and Roll Number.");
        }

        const data = window.db._getData();
        data.students = Array.isArray(data.students) ? data.students : [];
        let nextId = data.students.reduce((max, s) => Math.max(max, Number(s.id) || 0), 0) + 1;
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

          const name = String(row[nameIdx] || "").trim();
          const roll = String(row[rollIdx] || "").trim().toUpperCase();
          const email = emailIdx !== -1 ? String(row[emailIdx] || "").trim().toLowerCase() : "";
          const dept = deptIdx !== -1 ? String(row[deptIdx] || "").trim() : "CSIT";
          const phone = phoneIdx !== -1 ? String(row[phoneIdx] || "").trim() : "+91";

          if (!name || !roll) {
            invalidCount++;
            errors.push(`Row ${i + 1}: Missing student Name or Roll Number.`);
            continue;
          }

          const isDup = data.students.some(s =>
            String(s.roll_no || "").trim().toUpperCase() === roll ||
            (email && String(s.email || "").trim().toLowerCase() === email)
          ) || importedStudents.some(s =>
            s.roll_no.toUpperCase() === roll ||
            (email && s.email.toLowerCase() === email)
          );

          if (isDup) {
            duplicateCount++;
            continue;
          }

          const initials = name.split(/\s+/).map(w => w[0]).slice(0, 2).join("").toUpperCase() || "ST";
          const newStudent = {
            id: nextId++,
            name,
            roll_no: roll,
            email: email || `${roll.toLowerCase()}@dronacharya.info`,
            department: dept || "CSIT",
            phone: phone || "+91",
            avatar: initials,
            created_at: new Date().toISOString()
          };

          data.students.push(newStudent);
          importedStudents.push(newStudent);
          importedCount++;
        }

        window.db._saveData(data);
        res = {
          success: true,
          totalFound,
          importedCount,
          duplicateCount,
          invalidCount,
          errors,
          students: data.students
        };
      }

      if (progress) progress.style.display = "none";
      if (results) results.style.display = "block";
      if (confirmBtn) confirmBtn.style.display = "none";

      document.getElementById("student-csv-summary-total").textContent = res.totalFound;
      document.getElementById("student-csv-summary-imported").textContent = res.importedCount;
      document.getElementById("student-csv-summary-duplicates").textContent = res.duplicateCount;
      document.getElementById("student-csv-summary-invalid").textContent = res.invalidCount;

      const errorBox = document.getElementById("student-csv-summary-errors-box");
      if (errorBox) {
        if (res.errors && res.errors.length > 0) {
          errorBox.innerHTML = `<strong>Validation Issues:</strong><br>${res.errors.join("<br>")}`;
          errorBox.style.display = "block";
        } else {
          errorBox.style.display = "none";
        }
      }

      if (Array.isArray(res.students)) {
        const data = window.db._getData();
        data.students = res.students;
        window.db._saveData(data);
      }
      this.renderStudents();
      this.renderDashboard();

      this.showToast("Import Successful", `${res.importedCount} student(s) imported into directory.`, "success");
    } catch (err) {
      if (progress) progress.style.display = "none";
      if (confirmBtn) confirmBtn.disabled = false;
      this.showToast("Import Failed", err.message, "danger");
    }
  }

  // --- Faculty CSV Import ---
  openFacultyCsvImportModal() {
    this._pendingFacultyCsvText = null;
    this._parsedFacultyCsvRows = null;
    const fileInput = document.getElementById("faculty-csv-file-input");
    if (fileInput) fileInput.value = "";
    const previewSection = document.getElementById("faculty-csv-preview-section");
    if (previewSection) previewSection.style.display = "none";
    const progress = document.getElementById("faculty-csv-import-progress");
    if (progress) progress.style.display = "none";
    const results = document.getElementById("faculty-csv-import-results");
    if (results) results.style.display = "none";
    const confirmBtn = document.getElementById("faculty-csv-confirm-import-btn");
    if (confirmBtn) {
      confirmBtn.style.display = "none";
      confirmBtn.disabled = false;
    }
    this.openModal("modal-faculty-csv-import");
  }

  handleFacultyCsvFileSelection(event) {
    const file = event.target.files && event.target.files[0];
    if (!file) return;

    if (!file.name.toLowerCase().endsWith(".csv")) {
      this.showToast("Invalid File Type", "Please select a valid .csv file.", "warning");
      event.target.value = "";
      return;
    }

    const reader = new FileReader();
    reader.onload = (e) => {
      const text = e.target.result;
      this._pendingFacultyCsvText = text;
      this._parseAndPreviewFacultyCsv(text);
    };
    reader.onerror = () => {
      this.showToast("File Read Error", "Could not read the selected faculty CSV file.", "danger");
    };
    reader.readAsText(file);
  }

  _parseAndPreviewFacultyCsv(text) {
    const rows = this.parseCsvString(text);
    if (!rows || rows.length < 2) {
      this.showToast("Empty CSV", "The CSV file contains no data rows.", "warning");
      return;
    }

    const headers = rows[0].map(h => String(h || "").trim().toLowerCase());
    const nameIdx = headers.findIndex(h => ["faculty name", "name", "full name", "professor", "faculty_name"].includes(h));
    const idIdx = headers.findIndex(h => ["faculty id", "employee id", "emp id", "empid", "id", "faculty_id"].includes(h));
    const desigIdx = headers.findIndex(h => ["designation", "post", "role", "title"].includes(h));
    const deptIdx = headers.findIndex(h => ["department", "dept", "branch"].includes(h));
    const phoneIdx = headers.findIndex(h => ["phone number", "phone", "contact number", "mobile", "contact"].includes(h));
    const emailIdx = headers.findIndex(h => ["email id", "email", "email address", "faculty email"].includes(h));

    if (nameIdx === -1 || emailIdx === -1) {
      const missing = [];
      if (nameIdx === -1) missing.push("Faculty Name");
      if (emailIdx === -1) missing.push("Email");
      this.showToast("Invalid CSV Headers", `Missing required columns: ${missing.join(", ")}. Supported headers: Faculty Name, Email, Employee ID, Department, Contact Number, Designation.`, "danger");
      return;
    }

    const previewTbody = document.getElementById("faculty-csv-preview-tbody");
    if (previewTbody) {
      previewTbody.innerHTML = "";
      const previewRows = rows.slice(1, 6);
      previewRows.forEach(r => {
        const tr = document.createElement("tr");
        const facId = idIdx !== -1 && r[idIdx] ? String(r[idIdx]).trim() : "Auto";
        const desig = desigIdx !== -1 && r[desigIdx] ? String(r[desigIdx]).trim() : "Assistant Professor";
        const dept = deptIdx !== -1 && r[deptIdx] ? String(r[deptIdx]).trim() : "CSIT";
        const phone = phoneIdx !== -1 && r[phoneIdx] ? String(r[phoneIdx]).trim() : "—";
        tr.innerHTML = `
          <td><span class="isbn-code">${this.escapeHTML(facId)}</span></td>
          <td><strong>${this.escapeHTML(String(r[nameIdx] || "").trim())}</strong></td>
          <td>${this.escapeHTML(desig)}</td>
          <td><span class="badge badge-accent">${this.escapeHTML(dept)}</span></td>
          <td>${this.escapeHTML(String(r[emailIdx] || "").trim())}</td>
          <td>${this.escapeHTML(phone)}</td>
        `;
        previewTbody.appendChild(tr);
      });
    }

    const countElem = document.getElementById("faculty-csv-preview-count");
    if (countElem) countElem.textContent = String(rows.length - 1);

    const previewSection = document.getElementById("faculty-csv-preview-section");
    if (previewSection) previewSection.style.display = "block";
    const confirmBtn = document.getElementById("faculty-csv-confirm-import-btn");
    if (confirmBtn) confirmBtn.style.display = "inline-block";
  }

  async executeFacultyCsvImport() {
    if (!this._pendingFacultyCsvText) {
      this.showToast("No File Selected", "Please select a .csv file first.", "warning");
      return;
    }

    const progress = document.getElementById("faculty-csv-import-progress");
    const confirmBtn = document.getElementById("faculty-csv-confirm-import-btn");
    const results = document.getElementById("faculty-csv-import-results");

    if (progress) progress.style.display = "block";
    if (confirmBtn) confirmBtn.disabled = true;
    if (results) results.style.display = "none";

    try {
      const isOnline = ['http:', 'https:'].includes(window.location.protocol);
      let res = null;

      if (isOnline) {
        try {
          const response = await fetch("/api/admin/faculty/import-csv", {
            method: "POST",
            credentials: "same-origin",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ csv: this._pendingFacultyCsvText })
          });
          const json = await response.json();
          if (response.ok) {
            res = json;
          } else {
            throw new Error(json.error || `Server error (${response.status})`);
          }
        } catch (fetchErr) {
          if (fetchErr.message && !fetchErr.message.toLowerCase().includes("failed to fetch")) {
            throw fetchErr;
          }
        }
      }

      // Offline / file:// fallback
      if (!res) {
        const rows = this.parseCsvString(this._pendingFacultyCsvText);
        if (!rows || rows.length < 2) {
          throw new Error("The CSV file contains no data rows.");
        }
        const headers = rows[0].map(h => String(h || "").trim().toLowerCase());
        const nameIdx = headers.findIndex(h => ["faculty name", "name", "full name", "professor", "faculty_name"].includes(h));
        const idIdx = headers.findIndex(h => ["faculty id", "employee id", "emp id", "empid", "id", "faculty_id"].includes(h));
        const desigIdx = headers.findIndex(h => ["designation", "post", "role", "title"].includes(h));
        const deptIdx = headers.findIndex(h => ["department", "dept", "branch"].includes(h));
        const phoneIdx = headers.findIndex(h => ["phone number", "phone", "contact number", "mobile", "contact"].includes(h));
        const emailIdx = headers.findIndex(h => ["email id", "email", "email address", "faculty email"].includes(h));

        if (nameIdx === -1 || emailIdx === -1) {
          throw new Error("Missing required columns: Faculty Name and Email.");
        }

        const data = window.db._getData();
        data.faculty = Array.isArray(data.faculty) ? data.faculty : [];
        let nextId = data.faculty.reduce((max, f) => Math.max(max, Number(f.id) || 0), 0) + 1;
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

          const name = String(row[nameIdx] || "").trim();
          const email = String(row[emailIdx] || "").trim().toLowerCase();
          const facultyId = idIdx !== -1 ? String(row[idIdx] || "").trim() : "";
          const desig = desigIdx !== -1 ? String(row[desigIdx] || "").trim() : "Assistant Professor";
          const dept = deptIdx !== -1 ? String(row[deptIdx] || "").trim() : "CSIT";
          const phone = phoneIdx !== -1 ? String(row[phoneIdx] || "").trim() : "";

          if (!name || !email) {
            invalidCount++;
            errors.push(`Row ${i + 1}: Missing faculty Name or Email.`);
            continue;
          }

          const isDup = data.faculty.some(f =>
            (facultyId && String(f.faculty_id || "").trim().toLowerCase() === facultyId.toLowerCase()) ||
            String(f.email || "").trim().toLowerCase() === email
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
            designation: desig || "Assistant Professor",
            department: dept || "CSIT",
            phone: phone || "",
            email,
            created_at: new Date().toISOString()
          };

          data.faculty.push(newFaculty);
          importedFaculty.push(newFaculty);
          importedCount++;
        }

        window.db._saveData(data);
        res = {
          success: true,
          totalFound,
          importedCount,
          duplicateCount,
          invalidCount,
          errors,
          faculty: data.faculty
        };
      }

      if (progress) progress.style.display = "none";
      if (results) results.style.display = "block";
      if (confirmBtn) confirmBtn.style.display = "none";

      document.getElementById("faculty-summary-total").textContent = res.totalFound;
      document.getElementById("faculty-summary-imported").textContent = res.importedCount;
      document.getElementById("faculty-summary-duplicates").textContent = res.duplicateCount;
      document.getElementById("faculty-summary-invalid").textContent = res.invalidCount;

      const errorBox = document.getElementById("faculty-summary-errors-box");
      if (errorBox) {
        if (res.errors && res.errors.length > 0) {
          errorBox.innerHTML = `<strong>Validation Issues:</strong><br>${res.errors.join("<br>")}`;
          errorBox.style.display = "block";
        } else {
          errorBox.style.display = "none";
        }
      }

      if (Array.isArray(res.faculty)) {
        const data = window.db._getData();
        data.faculty = res.faculty;
        window.db._saveData(data);
      }
      this.renderFaculty();
      this.renderDashboard();

      this.showToast("Import Successful", `${res.importedCount} faculty member(s) imported into directory.`, "success");
    } catch (err) {
      if (progress) progress.style.display = "none";
      if (confirmBtn) confirmBtn.disabled = false;
      this.showToast("Import Failed", err.message, "danger");
    }
  }

  // --- Book Entry ISBN / Barcode / OCR Scanner ---
  openBookScannerModal() {
    this.resetScannerPreview();
    this.switchScannerTab("barcode");
    this.openModal("modal-scanner");
    const manualInput = document.getElementById("scanner-manual-input");
    if (manualInput) manualInput.value = "";
    const video = document.getElementById("scanner-video");
    if (video) {
      window.qrManager.startCamera(
        video,
        (decodedText) => this.handleBookEntryScan(decodedText),
        (errMsg) => console.log("Camera notice:", errMsg)
      );
    }
  }

  openBookEntryScanner() {
    this.openBookScannerModal();
  }

  closeScannerModal() {
    window.qrManager.stopCamera();
    this.closeModal("modal-scanner");
  }

  switchScannerTab(tab) {
    const isBarcode = tab === "barcode";
    const tabBarcode = document.getElementById("scanner-tab-barcode");
    const tabOcr = document.getElementById("scanner-tab-ocr");
    const btnBarcode = document.getElementById("scanner-tab-btn-barcode");
    const btnOcr = document.getElementById("scanner-tab-btn-ocr");

    if (tabBarcode) tabBarcode.style.display = isBarcode ? "block" : "none";
    if (tabOcr) tabOcr.style.display = !isBarcode ? "block" : "none";

    if (btnBarcode) {
      btnBarcode.style.background = isBarcode ? "var(--accent-primary)" : "transparent";
      btnBarcode.style.color = isBarcode ? "#16010b" : "var(--text-secondary)";
    }
    if (btnOcr) {
      btnOcr.style.background = !isBarcode ? "var(--accent-primary)" : "transparent";
      btnOcr.style.color = !isBarcode ? "#16010b" : "var(--text-secondary)";
    }

    if (!isBarcode) {
      window.qrManager.stopCamera();
    } else {
      const video = document.getElementById("scanner-video");
      if (video) {
        window.qrManager.startCamera(
          video,
          (decodedText) => this.handleBookEntryScan(decodedText),
          (errMsg) => console.log("Camera notice:", errMsg)
        );
      }
    }
  }

  resetScannerPreview() {
    const preview = document.getElementById("scanner-book-preview");
    if (preview) preview.style.display = "none";
    const disclaimer = document.getElementById("scanner-disclaimer");
    if (disclaimer) disclaimer.style.display = "none";
    const statusBox = document.getElementById("scanner-status-box");
    if (statusBox) statusBox.style.display = "none";
    const ocrBox = document.getElementById("ocr-preview-box");
    if (ocrBox) ocrBox.style.display = "none";
    ["scan-book-title", "scan-book-author", "scan-book-category", "scan-book-isbn", "scan-book-publisher"].forEach(id => {
      const el = document.getElementById(id);
      if (el) el.value = "";
    });
    const qty = document.getElementById("scan-book-qty");
    if (qty) qty.value = "1";
  }

  async lookupIsbnMetadata(code) {
    const isbn = String(code || document.getElementById("scanner-manual-input")?.value || "").trim();
    if (!isbn) {
      this.showToast("ISBN Required", "Please enter or scan an ISBN.", "warning");
      return;
    }

    const statusBox = document.getElementById("scanner-status-box");
    const statusText = document.getElementById("scanner-status-text");
    if (statusBox) statusBox.style.display = "block";
    if (statusText) statusText.textContent = `Fetching metadata for ISBN: ${isbn}...`;

    try {
      const response = await fetch(`/api/admin/books/metadata?isbn=${encodeURIComponent(isbn)}`, {
        credentials: "same-origin"
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "Metadata not found.");

      if (statusBox) statusBox.style.display = "none";
      const book = data.book || {};

      document.getElementById("scan-book-title").value = book.title || "";
      document.getElementById("scan-book-author").value = book.author || "";
      document.getElementById("scan-book-category").value = book.category || "CSIT";
      document.getElementById("scan-book-isbn").value = book.isbn || isbn;
      document.getElementById("scan-book-publisher").value = book.publisher || "";
      document.getElementById("scan-book-qty").value = "1";

      const disclaimer = document.getElementById("scanner-disclaimer");
      if (disclaimer) disclaimer.style.display = "none";

      document.getElementById("scanner-book-preview").style.display = "block";
      this.showToast("Metadata Found", `Loaded: "${book.title}". Please verify before saving.`, "success");
    } catch (err) {
      if (statusBox) statusBox.style.display = "none";
      document.getElementById("scan-book-isbn").value = isbn;
      document.getElementById("scanner-book-preview").style.display = "block";
      this.showToast("Manual Details Entry", `${err.message} You can enter details manually.`, "info");
    }
  }

  handleBookEntryScan(scannedData) {
    let code = String(scannedData || "").trim();
    if (!code) return;
    try {
      const parsed = JSON.parse(code);
      if (parsed && typeof parsed === "object") {
        code = parsed.isbn || parsed.ISBN || parsed.barcode || code;
      }
    } catch (_) {}

    const manualInput = document.getElementById("scanner-manual-input");
    if (manualInput) manualInput.value = code;
    this.lookupIsbnMetadata(code);
  }

  handleScannerFileUpload(event) {
    const file = event.target.files && event.target.files[0];
    if (!file) return;

    window.qrManager.decodeImageFile(
      file,
      (decodedText) => this.handleBookEntryScan(decodedText),
      (errMsg) => this.showToast("Scan Error", errMsg, "warning")
    );
    event.target.value = "";
  }

  submitManualScan() {
    this.lookupIsbnMetadata();
  }

  async handleCoverOcrUpload(event) {
    const file = event.target.files && event.target.files[0];
    if (!file) return;

    const statusBox = document.getElementById("scanner-status-box");
    const statusText = document.getElementById("scanner-status-text");
    if (statusBox) statusBox.style.display = "block";
    if (statusText) statusText.textContent = "Analyzing book cover with AI OCR...";

    const cleanName = file.name.replace(/\.[^/.]+$/, "").replace(/[-_]+/g, " ");

    try {
      const response = await fetch("/api/admin/books/ocr", {
        method: "POST",
        credentials: "same-origin",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text: cleanName })
      });
      const data = await response.json();

      if (statusBox) statusBox.style.display = "none";
      const ocrBox = document.getElementById("ocr-preview-box");
      const detectedText = document.getElementById("ocr-detected-text");
      if (ocrBox && detectedText) {
        ocrBox.style.display = "block";
        detectedText.textContent = `Cover file: ${file.name}\nExtracted Title: ${data.title}\nAuthor: ${data.author}\nSuggested Subject: ${data.category}`;
      }

      document.getElementById("scan-book-title").value = data.title || cleanName;
      document.getElementById("scan-book-author").value = data.author || "";
      document.getElementById("scan-book-category").value = data.category || "CSIT";
      document.getElementById("scan-book-isbn").value = "";
      document.getElementById("scan-book-publisher").value = "";
      document.getElementById("scan-book-qty").value = "1";

      const disclaimer = document.getElementById("scanner-disclaimer");
      if (disclaimer) disclaimer.style.display = "block";

      document.getElementById("scanner-book-preview").style.display = "block";
      this.showToast("Cover OCR Complete", "Details extracted! Scanned via AI OCR. Please verify details before saving.", "info");
    } catch (err) {
      if (statusBox) statusBox.style.display = "none";
      this.showToast("OCR Error", err.message, "danger");
    }
    event.target.value = "";
  }

  async saveScannedBook() {
    const title = (document.getElementById("scan-book-title")?.value || "").trim();
    const author = (document.getElementById("scan-book-author")?.value || "").trim();
    const category = (document.getElementById("scan-book-category")?.value || "").trim();
    const isbn = (document.getElementById("scan-book-isbn")?.value || "").trim();
    const publisher = (document.getElementById("scan-book-publisher")?.value || "").trim();
    const qty = parseInt(document.getElementById("scan-book-qty")?.value, 10) || 1;

    if (!title) {
      this.showToast("Title Required", "Please enter the book title/name.", "warning");
      return;
    }
    if (!category) {
      this.showToast("Category Required", "Please enter the category.", "warning");
      return;
    }

    try {
      const response = await fetch("/api/admin/books", {
        method: "POST",
        credentials: "same-origin",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          title,
          author,
          category,
          isbn,
          publisher,
          quantity: qty,
          description: "Added via Book Scanner & OCR."
        })
      });

      const res = await response.json();
      if (!response.ok) throw new Error(res.error || "Failed to save book.");

      if (Array.isArray(res.books)) {
        const data = window.db._getData();
        data.books = res.books;
        window.db._saveData(data);
        this.renderBooks();
        this.renderDashboard();
        if (typeof this.updateCategoryPills === "function") this.updateCategoryPills();
      }

      this.closeScannerModal();
      this.showToast("Book Saved", `"${title}" has been saved to the library catalog!`, "success");
    } catch (err) {
      this.showToast("Save Failed", err.message, "danger");
    }
  }

  // --- Printable Slips ---
  openIssueSlipModal(txId) {
    const isFaculty = String(txId).startsWith("faculty:");
    const rawId = isFaculty ? String(txId).split(":")[1] : txId;
    const tx = (isFaculty ? window.db.getFacultyTransactions() : window.db.getTransactions()).find(t => t.id === Number(rawId));
    if (!tx) return;

    const settings = window.db.getSettings();
    document.getElementById("slip-lib-name").textContent = settings.library_name;
    document.getElementById("slip-tx-id").textContent = `#TX-${tx.id}`;
    document.getElementById("slip-issue-date").textContent = tx.issue_date;
    document.getElementById("slip-due-date").textContent = tx.due_date;
    document.getElementById("slip-book-title").textContent = tx.book_title;
    document.getElementById("slip-book-isbn").textContent = tx.book_isbn;
    document.getElementById("slip-student-name").textContent = tx.borrower_type === "faculty" ? `Faculty: ${tx.student_name}` : tx.student_name;
    document.getElementById("slip-student-roll").textContent = tx.borrower_type === "faculty" ? `Faculty ID: ${tx.student_roll}` : tx.student_roll;

    this.lastIssuedTx = tx;
    const message = this.generateIssueMessage(tx);
    const whatsappLink = document.getElementById("issue-whatsapp-link");
    const phone = (tx.student_phone || "").replace(/[^0-9]/g, "");

    if (whatsappLink) {
      whatsappLink.href = phone ? `https://api.whatsapp.com/send?phone=${phone}&text=${encodeURIComponent(message)}` : "#";
      whatsappLink.style.display = phone ? "" : "none";
    }
    const noticeEl = document.getElementById("issue-notice");
    if (noticeEl) {
      document.getElementById("issue-notice-title").textContent = "Issue Message Ready";
      document.getElementById("issue-notice-recipient").textContent =
        `WhatsApp: ${tx.student_phone || 'unavailable'}.`;
      noticeEl.style.display = "flex";
    }

    document.getElementById("modal-issue-slip").classList.add("active");
  }

  openReturnSlipModal(txId, fineStatus, fineAmount, paymentMethod = "") {
    const isFaculty = String(txId).startsWith("faculty:");
    const rawId = isFaculty ? String(txId).split(":")[1] : txId;
    const tx = (isFaculty ? window.db.getFacultyTransactions() : window.db.getTransactions()).find(t => t.id === Number(rawId));
    if (!tx) return;

    const settings = window.db.getSettings();
    document.getElementById("ret-slip-lib-name").textContent = settings.library_name;
    document.getElementById("ret-slip-tx-id").textContent = `#${tx.borrower_type === "faculty" ? "F" : "TX"}-${tx.id}`;
    document.getElementById("ret-slip-return-date").textContent = new Date().toISOString().split('T')[0];
    document.getElementById("ret-slip-book-title").textContent = tx.book_title;
    document.getElementById("ret-slip-student-name").textContent = `${tx.borrower_type === "faculty" ? "Faculty" : "Student"}: ${tx.student_name}`;
    const paymentLabel = fineStatus === "paid" && paymentMethod ? ` via ${paymentMethod.toUpperCase()}` : "";
    document.getElementById("ret-slip-fine-paid").textContent = `₹${fineAmount} (${fineStatus.toUpperCase()}${paymentLabel})`;

    document.getElementById("modal-return-slip").classList.add("active");
  }

  openModal(modalId) {
    const m = document.getElementById(modalId);
    if (m) m.classList.add("active");
  }

  closeModal(modalId) {
    const m = document.getElementById(modalId);
    if (m) m.classList.remove("active");
  }

  printCurrentSlip() {
    window.print();
  }

  // --- Toast Notifications ---
  showToast(title, message, type = "info") {
    const container = document.getElementById("toast-container");
    if (!container) return;

    const toast = document.createElement("div");
    toast.className = `toast toast-${type}`;

    const icons = {
      success: "✅",
      warning: "⚠️",
      danger: "❌",
      info: "ℹ️"
    };

    toast.innerHTML = `
      <div class="toast-icon">${icons[type] || "ℹ️"}</div>
      <div class="toast-content">
        <div class="toast-title">${this.escapeHTML(title)}</div>
        <div class="toast-message">${this.escapeHTML(message)}</div>
      </div>
    `;

    container.appendChild(toast);

    setTimeout(() => {
      toast.classList.add("toast-hiding");
      setTimeout(() => toast.remove(), 250);
    }, 4000);
  }

  setupEventListeners() {
    // Books filter events
    document.getElementById("books-search-input")?.addEventListener("input", () => this.renderBooks());
    document.getElementById("books-subject-filter-select")?.addEventListener("change", () => this.renderBooks());
    document.getElementById("books-category-select")?.addEventListener("change", () => this.renderBooks());
    document.getElementById("books-branch-select")?.addEventListener("change", () => this.renderBooks());
    document.getElementById("books-avail-select")?.addEventListener("change", () => this.renderBooks());

    // Students filter
    document.getElementById("students-search-input")?.addEventListener("input", () => this.renderStudents());

    // Faculty filters
    document.getElementById("faculty-search-input")?.addEventListener("input", () => this.renderFaculty());
    document.getElementById("faculty-department-filter")?.addEventListener("change", () => this.renderFaculty());
    document.getElementById("faculty-sort-select")?.addEventListener("change", () => this.renderFaculty());

    // Return desk search
    document.getElementById("return-search-input")?.addEventListener("input", () => this.renderReturnDesk());
    document.getElementById("return-fine-action")?.addEventListener("change", () => this.updateReturnPaymentMethodVisibility());

    document.getElementById("issue-borrower-type")?.addEventListener("change", () => this.updateIssueBorrowerMode());
    document.getElementById("issue-faculty-search")?.addEventListener("input", () => this.updateIssueFacultyInfo());
    document.getElementById("issue-book-search")?.addEventListener("input", (event) => {
      const query = String(event.target.value || "").trim().toLowerCase();
      const books = window.db.getBooks();
      const matches = books.filter(book => Number(book.available) > 0 && [
        book.title, book.author, book.isbn, book.category, book.accessionNo,
        ...(Array.isArray(book.accessionNos) ? book.accessionNos : []),
        ...(Array.isArray(book.departments) ? book.departments : [])
      ].some(value => String(value || "").toLowerCase().includes(query)));
      const exact = books.find(book => Number(book.available) > 0 && this.getIssueBookLabel(book).toLowerCase() === query);
      const select = document.getElementById("issue-book-select");
      const list = document.getElementById("issue-book-options");
      if (list && query) list.innerHTML = matches.map(book => `<option value="${this.escapeHTML(this.getIssueBookLabel(book))}"></option>`).join("");
      if (exact && select) {
        select.value = String(exact.id); this.selectedBookForIssue = exact.id;
      } else if (select) {
        select.value = ""; this.selectedBookForIssue = null;
      }
      this.updateIssueSelectedBookInfo();
    });
    document.getElementById("issue-book-search")?.addEventListener("change", (event) => {
      const query = String(event.target.value || "").trim().toLowerCase();
      const book = window.db.getBooks().find(item => Number(item.available) > 0 && this.getIssueBookLabel(item).toLowerCase() === query);
      if (book) { document.getElementById("issue-book-select").value = String(book.id); this.selectedBookForIssue = book.id; }
      this.updateIssueSelectedBookInfo();
    });

    // Forms
    document.getElementById("issue-book-form")?.addEventListener("submit", (e) => this.submitIssueBook(e));
    document.getElementById("issue-date")?.addEventListener("change", () => this.updateIssueDueDate());
    document.getElementById("issue-loan-period")?.addEventListener("change", () => this.updateIssueDueDate());
    document.getElementById("issue-student-search")?.addEventListener("input", () => {
      const value = document.getElementById("issue-student-search")?.value || "";
      const trimmed = value.trim();
      const match = this.findStudentForIssueSearch(trimmed);
      const studentSelect = document.getElementById("issue-student-select");

      if (match) {
        this.selectedStudentForIssue = match.id;
        if (studentSelect) studentSelect.value = String(match.id);
        this.updateIssueSelectedStudentInfo(match);
      } else {
        this.selectedStudentForIssue = null;
        if (studentSelect) studentSelect.value = "";
        this.updateIssueSelectedStudentInfo(null);
      }
      this.renderIssueStudentOptions();
      this.saveIssueDraft();
    });
    document.getElementById("issue-student-select")?.addEventListener("change", (e) => {
      this.selectedStudentForIssue = Number(e.target.value) || null;
      const student = e.target.value ? window.db.getStudentById(e.target.value) : null;
      this.updateIssueSelectedStudentInfo(student);
      const studentSearch = document.getElementById("issue-student-search");
      if (studentSearch && student) {
        studentSearch.value = `${student.name} (${student.roll_no})`;
      }
      this.renderIssueStudentOptions();
      this.saveIssueDraft();
    });
    document.getElementById("issue-inline-roll")?.addEventListener("input", () => this.checkExistingStudentInline());
    document.getElementById("issue-inline-roll")?.addEventListener("change", () => this.checkExistingStudentInline());
    document.getElementById("issue-inline-phone")?.addEventListener("input", (e) => {
      const value = this.normalizePhoneNumber(e.target.value);
      if (value) e.target.value = value;
    });
    document.getElementById("issue-inline-phone")?.addEventListener("blur", () => this.checkExistingStudentInline());
    document.getElementById("issue-inline-email")?.addEventListener("blur", () => this.checkExistingStudentInline());
    document.getElementById("issue-whatsapp-link")?.addEventListener("click", (event) => {
      event.preventDefault();
      this.logIssueNotification("whatsapp");
    });

    document.getElementById("form-book")?.addEventListener("submit", (e) => this.submitBookForm(e));
    document.getElementById("form-student")?.addEventListener("submit", (e) => this.submitStudentForm(e));
    document.getElementById("form-faculty")?.addEventListener("submit", (e) => this.submitFacultyForm(e));
    document.getElementById("student-modal-roll")?.addEventListener("input", () => this.checkExistingStudent());
    document.getElementById("student-modal-phone")?.addEventListener("input", (e) => {
      const value = this.normalizePhoneNumber(e.target.value);
      if (value) e.target.value = value;
    });
    document.getElementById("student-modal-phone")?.addEventListener("blur", () => this.checkExistingStudent());
    document.getElementById("student-modal-email")?.addEventListener("blur", () => this.checkExistingStudent());
    document.getElementById("form-settings")?.addEventListener("submit", (e) => this.saveSettings(e));
    document.getElementById("form-change-password")?.addEventListener("submit", (event) => this.changeAdminPassword(event));
    document.getElementById("form-change-username")?.addEventListener("submit", (event) => this.changeAdminUsername(event));
    document.getElementById("form-message-compose")?.addEventListener("submit", (event) => {
      event.preventDefault();
      this.savePreparedMessage("prepared");
    });

    // CSV Drag & Drop handlers
    const setupDropZone = (dropZoneId, handler) => {
      const zone = document.getElementById(dropZoneId);
      if (!zone) return;
      zone.addEventListener("dragover", (e) => {
        e.preventDefault();
        zone.style.borderColor = "var(--accent-primary)";
      });
      zone.addEventListener("dragleave", () => {
        zone.style.borderColor = "var(--border-color)";
      });
      zone.addEventListener("drop", (e) => {
        e.preventDefault();
        zone.style.borderColor = "var(--border-color)";
        if (e.dataTransfer && e.dataTransfer.files && e.dataTransfer.files.length > 0) {
          handler({ target: { files: e.dataTransfer.files } });
        }
      });
    };
    setupDropZone("csv-drop-zone", (e) => this.handleCsvFileSelection(e));
    setupDropZone("student-csv-drop-zone", (e) => this.handleStudentCsvFileSelection(e));
    setupDropZone("faculty-csv-drop-zone", (e) => this.handleFacultyCsvFileSelection(e));

    // Close modal on backdrop click
    document.querySelectorAll(".modal-backdrop").forEach(backdrop => {
      backdrop.addEventListener("click", (e) => {
        if (e.target === backdrop) backdrop.classList.remove("active");
      });
    });
  }
}

// Instantiate on DOM load
document.addEventListener("DOMContentLoaded", () => {
  (async () => {
    try {
      const authenticated = await window.adminSessionReady;
      if (!authenticated) return;
      await window.db.init();
      window.app = new DGIApp();
    } catch (error) {
      console.error("The library application could not initialize.", error);
      const container = document.querySelector(".page-container");
      if (container) {
        container.replaceChildren();
        const message = document.createElement("p");
        message.textContent = `Library database could not be loaded: ${error.message}`;
        message.setAttribute("role", "alert");
        container.appendChild(message);
      }
    }
  })();
});
