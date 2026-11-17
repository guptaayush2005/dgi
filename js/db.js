/**
 * In-memory LMS database cache backed by the authenticated server API.
 */

class LibraryDatabase {
  constructor() {
    this.STORAGE_KEY = 'dgi_library_db_v1';
    this.data = this.seedInitialData();
    this.persistenceQueue = Promise.resolve();
    this.revision = 0;
    this.ready = null;
  }

  async init() {
    if (this.ready) return this.ready;
    this.ready = this.loadRemoteData();
    return this.ready;
  }

  async loadRemoteData() {
    let result = null;
    let serverOk = false;
    if (["http:", "https:"].includes(window.location.protocol)) {
      try {
        const response = await fetch("/api/library-state", { credentials: "same-origin" });
        if (response.ok) {
          result = await response.json();
          serverOk = true;
        } else if (response.status === 401) {
          const raw = sessionStorage.getItem("dgi_admin_session") || localStorage.getItem("dgi_admin_session");
          if (!raw) {
            window.location.replace("login.html");
            throw new Error("Sign in to load the library database.");
          }
        }
      } catch (err) {
        console.warn("Could not fetch remote library state, using local storage cache:", err);
      }
    }

    this.revision = (result && Number(result.revision)) || 0;
    const isPrimaryAccount = window.isPrimaryLibraryAccount !== false;
    const saved = localStorage.getItem(this.STORAGE_KEY);
    if (result && result.state) {
      this.data = result.state;
    } else if (saved) {
      try {
        this.data = this._parseStoredData(saved);
      } catch (e) {
        this.data = this.seedInitialData();
      }
    } else {
      this.data = this.seedInitialData();
    }

    delete this.data.admin;
    this.data.faculty ||= [];
    this.data.faculty_transactions ||= [];
    if (isPrimaryAccount) this.applyStudentRecordImport();
    this.removeImportedDefaultBookCategories();
    await this.classifyBookGenres();
    await this.persist();
  }

  _getData() {
    return this.data;
  }

  _parseStoredData(raw) {
    const data = JSON.parse(raw);
    if (!data || typeof data !== "object" || Array.isArray(data) ||
      !Array.isArray(data.books) ||
      !Array.isArray(data.students) ||
      !Array.isArray(data.transactions)) {
      throw new Error("Saved library data has an invalid format.");
    }
    return data;
  }

  _saveData(data) {
    this.data = data;
    return this.persist();
  }

  persist() {
    const snapshot = JSON.stringify(this.data);
    try {
      localStorage.setItem(this.STORAGE_KEY, snapshot);
    } catch (e) {}

    if (["http:", "https:"].includes(window.location.protocol)) {
      const save = this.persistenceQueue.then(async () => {
        try {
          const response = await fetch("/api/library-state", {
            method: "PUT",
            credentials: "same-origin",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              state: JSON.parse(snapshot),
              revision: this.revision
            })
          });
          if (response.ok) {
            const result = await response.json();
            this.revision = Number(result.revision) || this.revision;
          }
        } catch (error) {
          console.warn("Library data could not be saved to server, kept locally in storage.", error);
        }
      });
      this.persistenceQueue = save.catch(() => {});
      return save;
    }
    return Promise.resolve();
  }

  removeImportedDefaultBookCategories() {
    const data = this._getData();
    let changed = false;
    const importedIsbns = new Set([
      "81-7992-232-4",
      "978-0-7611-6925-3",
      "93-5497-894-0"
    ]);
    data.books.forEach(book => {
      if (importedIsbns.has(book.isbn) &&
        book.category === "General" &&
        book.description === "Imported from the student circulation record.") {
        book.category = "";
        changed = true;
      }
    });
    if (changed) this._saveData(data);
  }

  applyStudentRecordImport(force = false) {
    if (window.isPrimaryLibraryAccount !== true) {
      throw new Error("These preloaded records are reserved for the original library account.");
    }
    const importKey = "dgi_student_records_import_v2";
    if (!force && localStorage.getItem(importKey)) return;

    const records = window.DGI_STUDENT_RECORD_IMPORT;
    if (!records) return;
    if (!Array.isArray(records.students) || !Array.isArray(records.books) || !Array.isArray(records.transactions)) {
      throw new Error("Student record import file is invalid.");
    }

    const data = this._getData();
    const nextId = (items, preferredId) => {
      if (!items.some(item => Number(item.id) === Number(preferredId))) return Number(preferredId);
      return items.reduce((max, item) => Math.max(max, Number(item.id) || 0), 0) + 1;
    };
    const normalizeDate = value => {
      const match = String(value || "").match(/^(\d{2})-(\d{2})-(\d{4})$/);
      if (!match) throw new Error(`Invalid imported date: ${value}`);
      return `${match[3]}-${match[2]}-${match[1]}`;
    };

    const importedStudents = new Map();
    records.students.forEach(record => {
      const rollNo = String(record.roll_no).trim();
      let student = data.students.find(item => item.roll_no.trim().toLowerCase() === rollNo.toLowerCase());
      if (!student) {
        student = data.students.find(item => item.email.trim().toLowerCase() === String(record.email).trim().toLowerCase());
      }

      if (student) {
        Object.assign(student, {
          name: record.name,
          roll_no: rollNo,
          email: record.email,
          phone: record.phone,
          department: record.department
        });
      } else {
        const id = nextId(data.students, records.students.indexOf(record) + 1);
        student = {
          id,
          name: record.name,
          roll_no: rollNo,
          email: record.email,
          phone: record.phone,
          department: record.department,
          avatar: record.name.trim().split(/\s+/).map(word => word[0]).slice(0, 2).join("").toUpperCase(),
          created_at: new Date().toISOString()
        };
        data.students.push(student);
      }
      importedStudents.set(rollNo, student);
    });

    const importedBooks = new Map();
    records.books.forEach(record => {
      let book = data.books.find(item => item.isbn.trim().toLowerCase() === String(record.isbn).trim().toLowerCase());
      if (!book) {
        const id = nextId(data.books, records.books.indexOf(record) + 1);
        book = {
          id,
          title: record.title,
          author: record.author || "Not provided",
          isbn: record.isbn,
          category: record.category || "",
          quantity: Math.max(1, Number(record.quantity) || 1),
          available: Math.max(1, Number(record.quantity) || 1),
          borrow_count: 0,
          description: "Imported from the student circulation record.",
          color1: "#510027",
          color2: "#3d001e",
          rating: 4.5,
          published_year: new Date().getFullYear(),
          created_at: new Date().toISOString()
        };
        data.books.push(book);
      } else {
        book.title = record.title;
        book.isbn = record.isbn;
        book.author = record.author || book.author || "Not provided";
        book.category = record.category || book.category || "";
      }
      importedBooks.set(String(record.isbn), book);
    });

    records.transactions.forEach(record => {
      const student = importedStudents.get(String(record.student_roll_no));
      const book = importedBooks.get(String(record.book_isbn));
      if (!student || !book) throw new Error(`Could not match imported transaction #${record.id}.`);

      const issueDate = normalizeDate(record.issue_date);
      const dueDate = normalizeDate(record.due_date);
      const returnDate = record.return_date ? normalizeDate(record.return_date) : null;
      const status = record.status === "returned" ? "returned" : "issued";
      const existing = data.transactions.find(item =>
        Number(item.student_id) === Number(student.id) &&
        Number(item.book_id) === Number(book.id) &&
        item.issue_date === issueDate &&
        item.due_date === dueDate
      );
      if (existing) {
        if (status === "returned" && existing.status !== "returned") {
          existing.status = "returned";
          existing.return_date = returnDate;
          existing.fine = Number(record.fine) || 0;
          existing.fine_status = record.fine_status || "none";
          existing.payment_method = record.payment_method || "";
          book.available = Math.min(book.quantity, book.available + 1);
        }
        return;
      }

      const id = nextId(data.transactions, record.id);
      data.transactions.push({
        id,
        book_id: book.id,
        book_title: book.title,
        book_isbn: book.isbn,
        student_id: student.id,
        issue_date: issueDate,
        due_date: dueDate,
        return_date: returnDate,
        fine: Number(record.fine) || 0,
        fine_status: record.fine_status || "none",
        payment_method: record.payment_method || "",
        status,
        remarks: ""
      });
      book.quantity = Math.max(1, Number(book.quantity) || 1);
      if (status === "issued") {
        book.available = Math.max(0, (Number(book.available) || 0) - 1);
      }
      book.borrow_count = (Number(book.borrow_count) || 0) + 1;
    });

    this._saveData(data);
    localStorage.setItem(importKey, "complete");
  }

  seedInitialData() {
    return {
      books: [],
      students: [],
      faculty: [],
      transactions: [],
      alert_logs: [],
      settings: {
        library_name: "DGI Central Library",
        institution_name: "Dronacharya Group of Institutions, Greater Noida",
        address: "#27, APJ Abdul Kalam Road, Knowledge Park-III, Greater Noida, Uttar Pradesh - 201306",
        phone: "0120-2322022, 2323851-56",
        email: "info@dronacharya.info",
        established: "2006",
        fine_per_day: 5.0,
        alert_threshold_days: 3,
        currency: "₹",
        theme: "dark",
        accent: "dronacharya",
        auto_alerts: true
      }
    };
  }

  // --- Books CRUD ---
  getBooks() {
    return this._getData().books || [];
  }

  getBookById(id) {
    return this.getBooks().find(b => b.id === Number(id));
  }

  addBook(bookData) {
    const data = this._getData();
    if (!String(bookData.category || "").trim()) {
      throw new Error("Enter the book category.");
    }
    const newId = data.books.length > 0 ? Math.max(...data.books.map(b => b.id)) + 1 : 1;
    const qty = parseInt(bookData.quantity) || 1;

    // Pick vibrant gradient pair
    const palettes = [
      ["#510027", "#3d001e"],
      ["#10b981", "#059669"],
      ["#a16207", "#78350f"],
      ["#f59e0b", "#d97706"],
      ["#ec4899", "#be185d"],
      ["#7c2d12", "#451a03"]
    ];
    const chosenPalette = palettes[Math.floor(Math.random() * palettes.length)];

    const newBook = {
      id: newId,
      title: bookData.title.trim(),
      author: bookData.author.trim(),
      publisher: String(bookData.publisher || "").trim(),
      isbn: bookData.isbn.trim(),
      category: bookData.category.trim(),
      quantity: qty,
      available: qty,
      borrow_count: 0,
      description: bookData.description || "Comprehensive academic reference book.",
      color1: bookData.color1 || chosenPalette[0],
      color2: bookData.color2 || chosenPalette[1],
      rating: parseFloat(bookData.rating) || 4.5,
      published_year: parseInt(bookData.published_year) || new Date().getFullYear(),
      created_at: new Date().toISOString()
    };

    data.books.push(newBook);
    this._saveData(data);
    this.classifyBookGenres();
    return newBook;
  }

  async importBooks(bookRows) {
    const data = this._getData();
    const getKey = book => {
      if (book.importKey) return String(book.importKey).toLowerCase();
      const clean = value => String(value || "").trim().toLowerCase().replace(/\s+/g, " ");
      const isbn = clean(book.isbn).replace(/[^a-z0-9]/g, "");
      if (isbn && !["0", "na", "none", "notavailable"].includes(isbn)) return `isbn:${isbn}`;
      return `title:${[book.title, book.author, book.publisher, book.edition].map(clean).join("|")}`;
    };
    const incoming = new Map();

    for (const row of bookRows) {
      const title = String(row.title || "").trim();
      const category = String(row.category || "").trim();
      const quantity = Number(row.quantity);
      if (!title || !category || !Number.isSafeInteger(quantity) || quantity < 1 || quantity > 10000) {
        throw new Error("The Excel import contains a book with invalid title, category, or quantity.");
      }
      const book = { ...row, title, category, quantity };
      book.importKey = getKey(book);
      const existing = incoming.get(book.importKey);
      if (existing) {
        existing.quantity += quantity;
        existing.accessionNos = [...new Set([
          ...(existing.accessionNos || []),
          existing.accessionNo,
          book.accessionNo,
          ...(Array.isArray(book.accessionNos) ? book.accessionNos : [])
        ].filter(Boolean))];
        existing.departments = [...new Set([
          ...(existing.departments || []),
          existing.department
        ].filter(Boolean))];
      } else {
        book.accessionNos = [...new Set([
          ...(Array.isArray(book.accessionNos) ? book.accessionNos : []),
          book.accessionNo
        ].filter(Boolean))];
        book.departments = book.department ? [book.department] : [];
        incoming.set(book.importKey, book);
      }
    }

    const existingKeys = new Set(data.books.map(getKey));
    const imported = [...incoming.values()].filter(book => !existingKeys.has(book.importKey));
    if (!imported.length) {
      return { addedBooks: 0, addedCopies: 0, skippedBooks: incoming.size };
    }

    const palettes = [
      ["#510027", "#3d001e"],
      ["#10b981", "#059669"],
      ["#a16207", "#78350f"],
      ["#f59e0b", "#d97706"],
      ["#ec4899", "#be185d"],
      ["#7c2d12", "#451a03"]
    ];
    let nextId = data.books.reduce((max, book) => Math.max(max, Number(book.id) || 0), 0) + 1;
    const addedCopies = imported.reduce((total, book) => total + book.quantity, 0);
    const fallbackIsbn = value => {
      let hash = 2166136261;
      for (const character of value) hash = Math.imul(hash ^ character.charCodeAt(0), 16777619);
      return `NO-ISBN-${(hash >>> 0).toString(16).toUpperCase()}`;
    };
    for (const book of imported) {
      const palette = palettes[Math.floor(Math.random() * palettes.length)];
      data.books.push({
        ...book,
        categorySource: "auto",
        id: nextId++,
        author: String(book.author || "").trim(),
        publisher: String(book.publisher || "").trim(),
        isbn: String(book.isbn || book.accessionNo || fallbackIsbn(book.importKey)).trim(),
        quantity: book.quantity,
        available: book.quantity,
        borrow_count: 0,
        description: String(book.remarks || book.subject || "").trim() || "Imported from Excel accession register.",
        color1: palette[0],
        color2: palette[1],
        rating: 4.5,
        published_year: parseInt(book.published_year, 10) || new Date().getFullYear(),
        created_at: new Date().toISOString()
      });
    }

    await this.classifyBookGenres();
    await this._saveData(data);
    return {
      addedBooks: imported.length,
      addedCopies,
      skippedBooks: incoming.size - imported.length
    };
  }

  async classifyBookGenres() {
    const data = this._getData();
    const rules = {
      CSE: [
        ["Artificial Intelligence & Data Science", /\b(artificial intelligence|machine learning|deep learning|neural network|data mining|data science|pattern recognition|natural language processing|computer vision)\b/i],
        ["Programming & Software Development", /\b(programming|programmer|python|java|c\+\+|c language|software engineering|software testing|software development|web development|android|compiler|operating system|linux)\b/i],
        ["Algorithms & Computer Theory", /\b(algorithm|data structure|automata|theory of computation|discrete mathematics|graph theory|compiler design)\b/i],
        ["Databases & Information Systems", /\b(database|sql|data warehouse|information system|big data)\b/i],
        ["Networks & Cybersecurity", /\b(network|internet|cyber|security|cryptography|wireless|通信|communication network|protocol)\b/i],
        ["Computer Architecture & Embedded Systems", /\b(computer architecture|computer organization|microprocessor|embedded|digital logic|digital system)\b/i],
        ["Mathematics & Statistics", /\b(mathematics|mathematical|statistics|numerical method|linear algebra|probability)\b/i]
      ],
      EE: [
        ["Electrical Machines & Drives", /\b(electrical machine|induction motor|synchronous machine|transformer|electric drive|motor)\b/i],
        ["Power Systems & Energy", /\b(power system|power plant|power generation|transmission|distribution|energy|renewable|high voltage|switchgear|protection)\b/i],
        ["Control Systems & Instrumentation", /\b(control system|control engineering|instrumentation|measurement|process control|automatic control)\b/i],
        ["Electronics & Communication", /\b(electronic|electronics|circuit|semiconductor|communication|signal|telecommunication|vlsi|digital system)\b/i],
        ["Power Electronics", /\b(power electronic|converter|inverter|rectifier|drive)\b/i],
        ["Electrical Engineering Fundamentals", /\b(electrical|electromagnetic|electric circuit|electrical engineering)\b/i]
      ],
      CE: [
        ["Structural Engineering & Design", /\b(structur|reinforced concrete|rcc|steel structure|concrete|earthquake|bridge|building design|limit state)\b/i],
        ["Geotechnical Engineering", /\b(soil|foundation|geotechnical|rock mechanics|soil mechanics|ground improvement)\b/i],
        ["Transportation & Highway Engineering", /\b(transport|highway|traffic|railway|airport|pavement|road)\b/i],
        ["Environmental & Water Resources", /\b(environment|water|wastewater|hydrology|irrigation|sanitary|pollution|hydraulic)\b/i],
        ["Surveying & Geomatics", /\b(survey|geomatic|remote sensing|gis|geographic information|levelling)\b/i],
        ["Construction & Project Management", /\b(construction|project management|estimation|costing|quantity surveying|building material)\b/i],
        ["Civil Engineering Fundamentals", /\b(civil engineering|engineering drawing|building construction)\b/i]
      ],
      ME: [
        ["Thermal & Fluid Engineering", /\b(thermodynamic|heat transfer|fluid mechanic|fluid machin|power plant|refrigeration|air conditioning|ic engine|combustion|steam)\b/i],
        ["Machine Design & Mechanics", /\b(machine design|mechanical design|theory of machine|mechanics|kinematics|machine element|strength of material)\b/i],
        ["Manufacturing & Production", /\b(manufactur|production|welding|casting|machining|industrial engineering|operation research|quality control|metrology)\b/i],
        ["Robotics & Automation", /\b(robot|automation|mechatronic|artificial intelligence)\b/i],
        ["Materials & Metallurgy", /\b(material science|metallurg|material engineering|composite|polymers)\b/i],
        ["Mechanical Engineering Fundamentals", /\b(mechanical engineering|engineering drawing|engineering mechanics)\b/i]
      ],
      APSH: [
        ["Mathematics", /\b(mathemat|calculus|algebra|differential equation|numerical analysis|statistics|probability|discrete structure)\b/i],
        ["Physics", /\b(physics|mechanic|optics|electromagnet|quantum|thermodynamic|modern physics|solid state)\b/i],
        ["Chemistry & Materials Science", /\b(chemistry|chemical|organic|inorganic|physical chemistry|material science|callister)\b/i],
        ["English & Communication", /\b(english|communication skill|technical writing|language|grammar|professional communication)\b/i],
        ["Humanities & Management", /\b(humanit|management|economics|ethics|constitution|history|psychology|sociology|personality development)\b/i],
        ["Environmental & Life Sciences", /\b(environment|biology|ecology|life science|sustainability)\b/i],
        ["Basic Engineering Sciences", /\b(engineering chemistry|engineering physics|engineering mathematics|basic electrical|workshop)\b/i]
      ]
    };
    const fallback = {
      CSE: "Computer Science Fundamentals",
      EE: "Electrical Engineering Fundamentals",
      CE: "Civil Engineering Fundamentals",
      ME: "Mechanical Engineering Fundamentals",
      APSH: "Applied Sciences & Humanities"
    };
    const normalizeBranch = value => {
      const text = String(value || "").trim().toUpperCase();
      if (/^(CSE|COMPUTER SCIENCE|COMPUTER SCIENCE AND ENGINEERING)$/.test(text)) return "CSE";
      if (/^(EE|ELECTRICAL|ELECTRICAL ENGINEERING)$/.test(text)) return "EE";
      if (/^(CE|CIVIL|CIVIL ENGINEERING)$/.test(text)) return "CE";
      if (/^(ME|MECHANICAL|MECHANICAL ENGINEERING)$/.test(text)) return "ME";
      if (/^(APSH|APPLIED SCIENCE|APPLIED SCIENCES|HUMANITIES)$/.test(text)) return "APSH";
      return "";
    };
    const inferBranch = text => {
      if (/\b(computer|programming|python|java|database|algorithm|software|prolog|data structure|artificial intelligence|operating system|network|microprocessor)\b/i.test(text)) return "CSE";
      if (/\b(electrical|power system|power plant|electronics|control system|circuit|transformer|electromagnetic|instrumentation)\b/i.test(text)) return "EE";
      if (/\b(civil|structural|soil mechanics|geotechnical|surveying|highway|transportation|concrete|construction|hydrology|irrigation)\b/i.test(text)) return "CE";
      if (/\b(mechanical|thermodynamic|fluid mechanics|machine design|manufacturing|production engineering|robotics|metallurgy)\b/i.test(text)) return "ME";
      return "APSH";
    };
    let changed = 0;
    for (const book of data.books || []) {
      if (book.categorySource === "manual") continue;
      const text = [book.title, book.subject, book.description, book.category].filter(Boolean).join(" ");
      const branches = [...new Set([
        ...(Array.isArray(book.departments) ? book.departments : []),
        book.department
      ].map(normalizeBranch).filter(Boolean))];
      const branch = normalizeBranch(book.department) || branches[0] || inferBranch(text);
      if (!normalizeBranch(book.department)) {
        book.department = branch;
        changed++;
      }
      const bookBranches = Array.isArray(book.departments) ? book.departments : [];
      if (!bookBranches.some(value => normalizeBranch(value) === branch)) {
        book.departments = [...bookBranches, branch];
        changed++;
      }
      let category = "General Reference";
      if (branch) {
        const match = rules[branch].find(([, pattern]) => pattern.test(text));
        category = match ? match[0] : fallback[branch];
      } else {
        const inferred = Object.entries(rules).flatMap(([key, entries]) => entries
          .filter(([, pattern]) => pattern.test(text))
          .map(([label]) => label));
        category = inferred[0] || "General Reference";
      }
      if (book.category !== category) {
        book.category = category;
        changed++;
      }
      if (book.categorySource !== "auto") {
        book.categorySource = "auto";
        changed++;
      }
    }
    if (changed) await this._saveData(data);
    return { changed, total: (data.books || []).length };
  }

  updateBook(id, updateData) {
    const data = this._getData();
    const idx = data.books.findIndex(b => b.id === Number(id));
    if (idx === -1) return null;
    if (Object.prototype.hasOwnProperty.call(updateData, "category") && !String(updateData.category).trim()) {
      throw new Error("Enter the book category.");
    }

    const old = data.books[idx];
    const qtyDiff = (parseInt(updateData.quantity) || old.quantity) - old.quantity;
    const newAvailable = Math.max(0, old.available + qtyDiff);

    data.books[idx] = {
      ...old,
      ...updateData,
      ...(Object.prototype.hasOwnProperty.call(updateData, "category") ? { categorySource: "manual" } : {}),
      quantity: parseInt(updateData.quantity) || old.quantity,
      available: newAvailable
    };

    this._saveData(data);
    return data.books[idx];
  }

  deleteBook(id) {
    const data = this._getData();
    // Check if book currently issued
    const isIssued = data.transactions.some(t => t.book_id === Number(id) && t.status === 'issued');
    if (isIssued) {
      throw new Error("Cannot delete a book that is currently issued to students!");
    }
    data.books = data.books.filter(b => b.id !== Number(id));
    this._saveData(data);
    return true;
  }

  // --- Students CRUD ---
  getStudents() {
    return this._getData().students || [];
  }

  getStudentById(id) {
    return this.getStudents().find(s => s.id === Number(id));
  }

  getStudentByRollNo(rollNo) {
    return this.getStudents().find(s => s.roll_no.toLowerCase() === rollNo.trim().toLowerCase());
  }

  findMatchingStudent(studentData) {
    const students = this.getStudents();
    const rollNo = (studentData.roll_no || "").trim().toLowerCase();
    const email = (studentData.email || "").trim().toLowerCase();
    const phone = (studentData.phone || "").replace(/\D/g, "");
    const byRoll = rollNo && students.find(student => student.roll_no.trim().toLowerCase() === rollNo);
    if (byRoll) return byRoll;
    const byEmail = email && students.find(student => student.email.trim().toLowerCase() === email);
    if (byEmail) return byEmail;
    return phone.length >= 10
      ? students.find(student => {
        const existingPhone = (student.phone || "").replace(/\D/g, "");
        return existingPhone === phone || (existingPhone.length >= 10 && (existingPhone.endsWith(phone) || phone.endsWith(existingPhone)));
      }) || null
      : null;
  }

  addStudent(studentData) {
    const data = this._getData();
    if (this.findMatchingStudent(studentData)) {
      throw new Error("A student with this roll number, email, or phone number already exists.");
    }

    const newId = data.students.length > 0 ? Math.max(...data.students.map(s => s.id)) + 1 : 1;
    const initials = studentData.name.trim().split(" ").map(w => w[0]).slice(0, 2).join("").toUpperCase() || "ST";

    const newStudent = {
      id: newId,
      name: studentData.name.trim(),
      roll_no: studentData.roll_no.trim().toUpperCase(),
      email: studentData.email.trim(),
      phone: studentData.phone.trim(),
      department: studentData.department.trim() || "Academic",
      avatar: initials,
      created_at: new Date().toISOString()
    };

    data.students.push(newStudent);
    this._saveData(data);
    return newStudent;
  }

  updateStudent(id, updateData) {
    const data = this._getData();
    const idx = data.students.findIndex(s => s.id === Number(id));
    if (idx === -1) return null;

    const updatedStudent = { ...data.students[idx], ...updateData };
    const duplicate = this.findMatchingStudent(updatedStudent);
    if (duplicate && duplicate.id !== Number(id)) {
      throw new Error("Another student already uses this roll number, email, or phone number.");
    }
    data.students[idx] = updatedStudent;
    this._saveData(data);
    return data.students[idx];
  }

  deleteStudent(id) {
    const data = this._getData();
    const hasLoans = data.transactions.some(t => t.student_id === Number(id) && t.status === 'issued');
    if (hasLoans) {
      throw new Error("Cannot delete a student who has active borrowed books!");
    }
    data.students = data.students.filter(s => s.id !== Number(id));
    this._saveData(data);
    return true;
  }

  getFaculty() {
    return this._getData().faculty || [];
  }

  getFacultyById(id) {
    return this.getFaculty().find(member => Number(member.id) === Number(id));
  }

  addFaculty(facultyData) {
    const data = this._getData();
    const faculty = {
      faculty_id: String(facultyData.faculty_id || "").trim(),
      name: String(facultyData.name || "").trim(),
      designation: String(facultyData.designation || "").trim(),
      department: String(facultyData.department || "").trim(),
      phone: String(facultyData.phone || "").trim(),
      email: String(facultyData.email || "").trim()
    };
    this.validateFaculty(faculty);
    this.ensureUniqueFaculty(faculty);

    const newFaculty = {
      id: data.faculty.length ? Math.max(...data.faculty.map(member => Number(member.id) || 0)) + 1 : 1,
      ...faculty,
      created_at: new Date().toISOString()
    };
    data.faculty.push(newFaculty);
    this._saveData(data);
    return newFaculty;
  }

  updateFaculty(id, facultyData) {
    const data = this._getData();
    const index = data.faculty.findIndex(member => Number(member.id) === Number(id));
    if (index === -1) return null;

    const faculty = {
      ...data.faculty[index],
      faculty_id: String(facultyData.faculty_id || "").trim(),
      name: String(facultyData.name || "").trim(),
      designation: String(facultyData.designation || "").trim(),
      department: String(facultyData.department || "").trim(),
      phone: String(facultyData.phone || "").trim(),
      email: String(facultyData.email || "").trim()
    };
    this.validateFaculty(faculty);
    this.ensureUniqueFaculty(faculty, Number(id));
    data.faculty[index] = faculty;
    this._saveData(data);
    return faculty;
  }

  validateFaculty(faculty) {
    if (!faculty.name || !faculty.designation || !faculty.department || !faculty.phone || !faculty.email) {
      throw new Error("Enter the faculty name, designation, department, phone number, and email address.");
    }
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(faculty.email)) {
      throw new Error("Enter a valid faculty email address.");
    }
  }

  ensureUniqueFaculty(faculty, exceptId = null) {
    const duplicate = this.getFaculty().find(member =>
      Number(member.id) !== exceptId &&
      ((faculty.faculty_id && String(member.faculty_id || "").toLowerCase() === faculty.faculty_id.toLowerCase()) ||
        String(member.email || "").toLowerCase() === faculty.email.toLowerCase())
    );
    if (duplicate) throw new Error("A faculty record with this Faculty ID or email address already exists.");
  }

  deleteFaculty(id) {
    const data = this._getData();
    const exists = data.faculty.some(member => Number(member.id) === Number(id));
    if (!exists) return false;
    if ((data.faculty_transactions || []).some(tx => Number(tx.faculty_id) === Number(id) && tx.status === 'issued')) {
      throw new Error("This faculty member has an active book loan. Process the return before removing the faculty record.");
    }
    data.faculty = data.faculty.filter(member => Number(member.id) !== Number(id));
    this._saveData(data);
    return true;
  }

  // --- Transactions & Loans ---
  getTransactions() {
    const data = this._getData();
    const books = data.books;
    const students = data.students;

    return (data.transactions || []).map(t => {
      const book = books.find(b => b.id === t.book_id) || { title: t.book_title || "Unknown Book", isbn: t.book_isbn || "N/A" };
      const student = students.find(s => s.id === t.student_id) || { name: "Unknown Student", roll_no: "N/A", phone: "", email: "" };
      
      // Calculate live fine if status is issued
      let currentFine = Number(t.fine) || 0;
      let daysLate = 0;
      if (t.status === 'issued') {
        const today = new Date().toISOString().split('T')[0];
        const calc = this.calculateFine(t.due_date, today);
        currentFine = Math.round(((Number(t.fine_before_reissue) || 0) + calc.fine) * 100) / 100;
        daysLate = calc.daysLate;
      }

      return {
        ...t,
        book_title: t.book_title || book.title,
        book_author: t.book_author || book.author || "",
        book_isbn: t.book_isbn || book.isbn,
        student_name: student.name,
        student_roll: student.roll_no,
        student_phone: student.phone,
        student_email: student.email,
        calculated_fine: currentFine,
        days_late: daysLate
      };
    }).sort((a, b) => b.id - a.id);
  }

  getFacultyTransactions() {
    const data = this._getData();
    return (data.faculty_transactions || []).map(t => {
      const book = data.books.find(b => Number(b.id) === Number(t.book_id)) || {};
      const faculty = (data.faculty || []).find(f => Number(f.id) === Number(t.faculty_id)) || {};
      const calc = t.status === 'issued' ? this.calculateFine(t.due_date) : { fine: 0, daysLate: 0 };
      return { ...t, borrower_type: 'faculty', book_title: t.book_title || book.title || 'Unknown Book', book_author: book.author || '', book_isbn: t.book_isbn || book.isbn || '', student_name: faculty.name || t.faculty_name || 'Unknown Faculty', student_roll: faculty.faculty_id || t.faculty_code || '—', student_phone: faculty.phone || '', student_email: faculty.email || '', calculated_fine: Math.round(((Number(t.fine) || 0) + calc.fine) * 100) / 100, days_late: calc.daysLate };
    }).sort((a, b) => b.id - a.id);
  }

  issueFacultyBook(bookId, facultyId, dueDateStr, remarks = '', issueDateStr = null) {
    const data = this._getData();
    const book = data.books.find(b => Number(b.id) === Number(bookId));
    const faculty = (data.faculty || []).find(f => Number(f.id) === Number(facultyId));
    if (!book || book.available <= 0) throw new Error('Selected book is unavailable.');
    if (!faculty) throw new Error('Select a registered faculty member.');
    data.faculty_transactions ||= [];
    const id = data.faculty_transactions.length ? Math.max(...data.faculty_transactions.map(t => Number(t.id) || 0)) + 1 : 1;
    const tx = { id, book_id: book.id, book_title: book.title, book_isbn: book.isbn, faculty_id: faculty.id, faculty_name: faculty.name, faculty_code: faculty.faculty_id || '', issue_date: issueDateStr || new Date().toISOString().slice(0, 10), due_date: dueDateStr, return_date: null, fine: 0, fine_status: 'none', status: 'issued', remarks: String(remarks || '').trim() };
    book.available -= 1;
    book.borrow_count = (book.borrow_count || 0) + 1;
    data.faculty_transactions.push(tx);
    this._saveData(data);
    return tx;
  }

  returnFacultyBook(transactionId, fineAction = 'none', fineAmount = 0, remarks = '', paymentMethod = '') {
    const data = this._getData();
    const tx = (data.faculty_transactions || []).find(t => Number(t.id) === Number(transactionId));
    if (!tx || tx.status === 'returned') throw new Error('Faculty loan not found or already returned.');
    const book = data.books.find(b => Number(b.id) === Number(tx.book_id));
    tx.status = 'returned'; tx.return_date = new Date().toISOString().slice(0, 10); tx.fine = Number(fineAmount) || 0; tx.fine_status = fineAction; tx.payment_method = fineAction === 'paid' ? paymentMethod : '';
    if (remarks) tx.remarks = [tx.remarks, remarks].filter(Boolean).join(' | ');
    if (book) book.available = Math.min(book.quantity, book.available + 1);
    this._saveData(data);
    return tx;
  }

  issueBook(bookId, studentId, dueDateStr, remarks = "", issueDateStr = null) {
    const data = this._getData();
    const book = data.books.find(b => b.id === Number(bookId));
    const student = data.students.find(s => s.id === Number(studentId));

    if (!book) throw new Error("Selected book was not found.");
    if (!student) throw new Error("Selected student was not found.");
    if (book.available <= 0) throw new Error(`'${book.title}' is currently out of stock.`);
    const todayStr = new Date().toISOString().split('T')[0];
    const reissueCooldown = data.transactions
      .filter(tx => Number(tx.student_id) === Number(student.id) &&
        Number(tx.book_id) === Number(book.id) &&
        tx.status === 'returned' && Number(tx.reissue_count || 0) >= 2 && tx.return_date)
      .sort((left, right) => String(right.return_date).localeCompare(String(left.return_date)))[0];
    if (reissueCooldown) {
      const unlockDate = new Date(`${reissueCooldown.return_date}T00:00:00.000Z`);
      unlockDate.setUTCDate(unlockDate.getUTCDate() + 3);
      const unlockDateText = unlockDate.toISOString().split('T')[0];
      if (todayStr < unlockDateText) {
        throw new Error(`This student can borrow this book again after ${unlockDateText}; the 3-day cooldown is active.`);
      }
    }
    if (student.library_blocked && !student.issue_permission) {
      throw new Error("This student's library account is blocked. A librarian must allow this issue with permission first.");
    }

    // Active loan limit check (Maximum 4 books allowed)
    const activeStudentLoans = data.transactions.filter(t => t.student_id === student.id && t.status === 'issued');
    if (activeStudentLoans.length >= 4) {
      throw new Error(`Circulation Limit Reached: ${student.name} already holds ${activeStudentLoans.length} active books. Maximum 4 books allowed per student.`);
    }

    const normalizedIssueDate = issueDateStr || todayStr;
    const newId = data.transactions.length > 0 ? Math.max(...data.transactions.map(t => t.id)) + 1 : 1;

    const newTx = {
      id: newId,
      book_id: book.id,
      book_title: book.title,
      book_isbn: book.isbn,
      student_id: student.id,
      issue_date: normalizedIssueDate,
      due_date: dueDateStr,
      return_date: null,
      fine: 0,
      fine_status: "none",
      status: "issued",
      remarks: remarks.trim()
    };

    // Update inventory
    book.available -= 1;
    book.borrow_count = (book.borrow_count || 0) + 1;

    data.transactions.push(newTx);
    if (student.library_blocked && student.issue_permission) {
      student.issue_permission = false;
      student.issue_permission_used_at = new Date().toISOString();
    }
    this._saveData(data);
    return this.getTransactions().find(t => t.id === newTx.id);
  }

  returnBook(transactionId, fineAction = "none", fineAmount = 0, returnRemarks = "", paymentMethod = "") {
    const data = this._getData();
    const tx = data.transactions.find(t => t.id === Number(transactionId));
    if (!tx) throw new Error("Transaction not found.");
    if (tx.status === 'returned') throw new Error("Book is already marked as returned.");
    if (fineAction === "paid" && Number(fineAmount) <= 0) {
      throw new Error("No fine is due for collection.");
    }
    if (fineAction === "paid" && (!paymentMethod || !["cash", "upi"].includes(paymentMethod))) {
      throw new Error("Choose Cash or UPI to record the fine payment.");
    }

    const todayStr = new Date().toISOString().split('T')[0];
    const book = data.books.find(b => b.id === tx.book_id);

    tx.status = 'returned';
    tx.return_date = todayStr;
    tx.fine = fineAmount;
    tx.fine_status = fineAction; // 'paid', 'waived', 'none'
    tx.payment_method = fineAction === "paid" ? paymentMethod : "";
    if (returnRemarks) {
      tx.remarks = (tx.remarks ? tx.remarks + " | " : "") + returnRemarks;
    }

    // Restore book availability
    if (book) {
      book.available = Math.min(book.quantity, book.available + 1);
    }

    this._saveData(data);
    return tx;
  }

  // --- Alerts & Overdue Queries ---
  calculateFine(dueDateStr, returnDateStr = null) {
    const settings = this.getSettings();
    const rate = parseFloat(settings.fine_per_day) || 5.0;

    const dueDate = new Date(dueDateStr);
    const returnDate = returnDateStr ? new Date(returnDateStr) : new Date();

    // Strip time
    dueDate.setHours(0, 0, 0, 0);
    returnDate.setHours(0, 0, 0, 0);

    const diffTime = returnDate - dueDate;
    const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24));

    if (diffDays <= 0) {
      return { daysLate: 0, fine: 0 };
    }

    return {
      daysLate: diffDays,
      fine: Math.round(diffDays * rate * 100) / 100
    };
  }

  getPendingAlerts() {
    const txs = [
      ...this.getTransactions().map(transaction => ({ ...transaction, borrower_type: 'student' })),
      ...this.getFacultyTransactions()
    ].filter(t => t.status === 'issued');
    const settings = this.getSettings();
    const thresholdDays = parseInt(settings.alert_threshold_days) || 3;
    const today = new Date();
    today.setHours(0, 0, 0, 0);

    const overdue = [];
    const dueSoon = [];

    for (const tx of txs) {
      const due = new Date(tx.due_date);
      due.setHours(0, 0, 0, 0);

      const daysLeft = Math.ceil((due - today) / (1000 * 60 * 60 * 24));

      const item = {
        ...tx,
        days_left: daysLeft
      };

      if (daysLeft < 0) {
        // Faculty loans remain visible in the circulation history, but are not
        // included in the app's overdue alerts.
        if (tx.borrower_type === 'faculty') continue;
        item.status_type = "Overdue";
        item.days_overdue = Math.abs(daysLeft);
        overdue.push(item);
      } else if (daysLeft <= thresholdDays) {
        item.status_type = "Due Soon";
        dueSoon.push(item);
      }
    }

    return {
      overdue,
      dueSoon,
      totalAlerts: overdue.length + dueSoon.length
    };
  }

  logAlert(transactionId, studentId, channel, recipient, message) {
    const data = this._getData();
    const newId = (data.alert_logs || []).length > 0 ? Math.max(...data.alert_logs.map(l => l.id)) + 1 : 1;
    const newLog = {
      id: newId,
      transaction_id: transactionId,
      student_id: studentId,
      channel,
      recipient,
      message,
      sent_at: new Date().toISOString()
    };
    if (!data.alert_logs) data.alert_logs = [];
    data.alert_logs.push(newLog);
    this._saveData(data);
    return newLog;
  }

  getAlertLogs() {
    return (this._getData().alert_logs || []).sort((a, b) => b.id - a.id);
  }

  // --- Dashboard Statistics ---
  getDashboardStats() {
    const data = this._getData();
    const books = data.books || [];
    const students = data.students || [];
    const transactions = data.transactions || [];

    const totalBooks = books.reduce((acc, b) => acc + (b.quantity || 0), 0);
    const availableBooks = books.reduce((acc, b) => acc + (b.available || 0), 0);
    const facultyTransactions = data.faculty_transactions || [];
    const activeFacultyLoans = this.getFacultyTransactions().filter(t => t.status === 'issued');
    const facultyDueSoonCount = activeFacultyLoans.filter(t => {
      const days = Math.ceil((new Date(`${t.due_date}T00:00:00`) - new Date(new Date().toDateString())) / 86400000);
      return days >= 0 && days <= (parseInt(this.getSettings().alert_threshold_days, 10) || 3);
    }).length;
    const issuedBooks = transactions.filter(t => t.status === 'issued').length + facultyTransactions.filter(t => t.status === 'issued').length;
    const returnedBooks = transactions.filter(t => t.status === 'returned').length + facultyTransactions.filter(t => t.status === 'returned').length;
    const { overdue, dueSoon } = this.getPendingAlerts();

    const finesCollected = [...transactions, ...facultyTransactions]
      .filter(t => t.fine_status === 'paid')
      .reduce((acc, t) => acc + (parseFloat(t.fine) || 0), 0);

    return {
      totalTitles: books.length,
      totalBooks,
      availableBooks,
      issuedBooks,
      returnedBooks,
      totalStudents: students.length,
      overdueCount: overdue.length,
      dueSoonCount: dueSoon.length + facultyDueSoonCount,
      finesCollected: finesCollected.toFixed(2)
    };
  }

  getCategoryDistribution() {
    const books = this.getBooks();
    const map = {};
    for (const b of books) {
      const cat = b.category || "General";
      map[cat] = (map[cat] || 0) + (b.quantity || 1);
    }
    return map;
  }

  getMonthlyTrends() {
    const txs = [...(this._getData().transactions || []), ...(this._getData().faculty_transactions || [])];
    const months = {};
    
    // Last 6 months
    for (let i = 5; i >= 0; i--) {
      const d = new Date();
      d.setMonth(d.getMonth() - i);
      const key = d.toLocaleString('default', { month: 'short' });
      months[key] = { issued: 0, returned: 0 };
    }

    txs.forEach(t => {
      if (t.issue_date) {
        const issueDate = new Date(t.issue_date);
        const mKey = issueDate.toLocaleString('default', { month: 'short' });
        if (months[mKey]) months[mKey].issued += 1;
      }
      if (t.return_date) {
        const retDate = new Date(t.return_date);
        const mKey = retDate.toLocaleString('default', { month: 'short' });
        if (months[mKey]) months[mKey].returned += 1;
      }
    });

    return months;
  }

  getTopBorrowers(limit = 5) {
    const txs = this._getData().transactions || [];
    const students = this.getStudents();
    const counts = {};

    txs.forEach(t => {
      counts[t.student_id] = (counts[t.student_id] || 0) + 1;
    });

    return Object.entries(counts)
      .map(([sid, count]) => {
        const s = students.find(st => st.id === Number(sid));
        return {
          id: sid,
          name: s ? s.name : "Unknown",
          roll_no: s ? s.roll_no : "N/A",
          department: s ? s.department : "N/A",
          borrow_count: count
        };
      })
      .sort((a, b) => b.borrow_count - a.borrow_count)
      .slice(0, limit);
  }

  getTopBooks(limit = 5) {
    return [...this.getBooks()]
      .sort((a, b) => (b.borrow_count || 0) - (a.borrow_count || 0))
      .slice(0, limit);
  }

  // --- Settings ---
  getSettings() {
    return this._getData().settings || {
      library_name: "DGI Central Library",
      fine_per_day: 5.0,
      alert_threshold_days: 3,
      currency: "₹",
      theme: "dark",
      accent: "dronacharya"
    };
  }

  getAdminProfile() {
    return {
      username: window.adminDisplayName || "Administrator",
      email: "",
      role: "Chief Librarian"
    };
  }

  getAdminEmail() {
    return (this.getAdminProfile().email || "admin@library.edu").trim();
  }

  saveSettings(newSettings) {
    const data = this._getData();
    data.settings = { ...data.settings, ...newSettings };
    this._saveData(data);
    return data.settings;
  }

  // --- Backup & Export ---
  exportDatabaseJSON() {
    return JSON.stringify(this._getData(), null, 2);
  }

  async importDatabaseJSON(jsonStr) {
    try {
      const parsed = JSON.parse(jsonStr);
      if (!parsed.books || !parsed.students || !parsed.transactions) {
        throw new Error("Invalid database schema in backup file.");
      }
      delete parsed.admin;
      parsed.faculty ||= [];
      parsed.faculty_transactions ||= [];
      if (!Array.isArray(parsed.faculty)) throw new Error("Faculty records in backup must be an array.");
      if (!Array.isArray(parsed.faculty_transactions)) throw new Error("Faculty loan records in backup must be an array.");
      await this._saveData(parsed);
      return true;
    } catch (e) {
      throw new Error("Failed to restore database: " + e.message);
    }
  }

  async exportCSV(type = "books") {
    let rows = [];
    let filename = "";
    let reissueCountsByStudent = new Map();
    if (type === "students") {
      try {
        const response = await fetch("/api/reissue-request-stats", { credentials: "same-origin" });
        const result = await response.json();
        if (!response.ok) throw new Error(result.error || "Could not load reissue request totals.");
        (result.requests || []).forEach(request => {
          const studentId = Number(request.studentId);
          reissueCountsByStudent.set(studentId, (reissueCountsByStudent.get(studentId) || 0) + 1);
        });
      } catch (error) {
        window.app?.showToast("Student CSV Not Exported", error.message, "danger");
        return;
      }
    }
    const csvCell = value => {
      const text = String(value ?? "");
      return /[\",\r\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
    };

    if (type === "books") {
      filename = "dgi_books_catalog.csv";
      rows.push(["ID", "Title", "Author", "Publication", "ISBN", "Branch(es)", "Accession No(s)", "Accession Records (JSON)", "Category", "Total Qty", "Available", "Borrow Count", "Rating", "Qty / Accession Check"]);
      this.getBooks().forEach(b => {
        const branches = [...new Set([
          ...(Array.isArray(b.departments) ? b.departments : []),
          b.department
        ].map(value => String(value || "").trim()).filter(Boolean))];
        const accessions = Array.isArray(b.accessionNos) && b.accessionNos.length
          ? b.accessionNos
          : (b.accessionNo ? [b.accessionNo] : []);
        const accessionCheck = accessions.length && accessions.length !== Number(b.quantity)
          ? `Quantity ${b.quantity}; ${accessions.length} accession rows`
          : "";
        rows.push([b.id, b.title, b.author, b.publisher || "", b.isbn, branches.join(", "), accessions.join(", "), JSON.stringify(b.accessionRecords || []), b.category, b.quantity, b.available, b.borrow_count, b.rating, accessionCheck]);
      });
    } else if (type === "students") {
      filename = "dgi_students_directory.csv";
      rows.push(["Student ID", "Student Name", "Roll No", "Email", "Phone", "Department", "Transaction ID", "Book Title", "Author", "ISBN", "Issue Date", "Due Date", "Return Date", "Book Status", "Fine (INR)", "Fine Status", "Payment Method", "Reissue Requested", "Total Reissue Requests"]);
      const transactions = this.getTransactions();
      this.getStudents().forEach(s => {
        const studentTransactions = transactions.filter(t => Number(t.student_id) === Number(s.id));
        const records = studentTransactions.length ? studentTransactions : [null];
        records.forEach(t => {
          rows.push([
            s.id,
            s.name,
            s.roll_no,
            s.email,
            s.phone,
            s.department,
            t?.id ?? "",
            t?.book_title ?? "",
            t?.book_author ?? "",
            t?.book_isbn ?? "",
            t?.issue_date ?? "",
            t?.due_date ?? "",
            t?.return_date ?? "",
            t ? (t.status === "issued" ? "Issued" : t.status === "returned" ? "Returned" : t.status) : "",
            t ? Number(t.calculated_fine || 0).toFixed(2) : "",
            t?.fine_status ?? "",
            t?.payment_method ?? "",
            (reissueCountsByStudent.get(Number(s.id)) || 0) > 0 ? "Yes" : "No",
            reissueCountsByStudent.get(Number(s.id)) || 0
          ]);
        });
      });
    } else if (type === "faculty") {
      filename = "dgi_faculty_directory.csv";
      rows.push(["Faculty ID", "Faculty Name", "Designation", "Department", "Phone Number", "Email ID"]);
      this.getFaculty().forEach(member => {
        rows.push([member.faculty_id || "", member.name, member.designation, member.department, member.phone, member.email]);
      });
    } else if (type === "transactions") {
      filename = "dgi_transactions_history.csv";
      rows.push(["TX ID", "Book Title", "ISBN", "Student Name", "Roll No", "Issue Date", "Due Date", "Return Date", "Fine (INR)", "Fine Status", "Payment Method", "Status"]);
      this.getTransactions().forEach(t => {
        rows.push([t.id, t.book_title, t.book_isbn, t.student_name, t.student_roll, t.issue_date, t.due_date, t.return_date || "-", t.fine || 0, t.fine_status || "none", t.payment_method || "-", t.status]);
      });
    }

    const csvContent = "\uFEFF" + rows.map(row => row.map(csvCell).join(",")).join("\n");
    const blob = new Blob([csvContent], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.setAttribute("href", url);
    link.setAttribute("download", filename);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  }
}

window.db = new LibraryDatabase();
