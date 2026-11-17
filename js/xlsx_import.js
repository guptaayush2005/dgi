(() => {
  const MAIN_NS = "http://schemas.openxmlformats.org/spreadsheetml/2006/main";
  const REL_NS = "http://schemas.openxmlformats.org/officeDocument/2006/relationships";
  const MAX_FILE_SIZE = 25 * 1024 * 1024;

  function readXml(text, label) {
    const document = new DOMParser().parseFromString(text, "application/xml");
    if (document.getElementsByTagName("parsererror").length) {
      throw new Error(`The Excel file contains invalid ${label} data.`);
    }
    return document;
  }

  async function readZipEntries(file) {
    if (file.size > MAX_FILE_SIZE) throw new Error("Excel file must be smaller than 25 MB.");
    const bytes = new Uint8Array(await file.arrayBuffer());
    const view = new DataView(bytes.buffer);
    const readU16 = offset => view.getUint16(offset, true);
    const readU32 = offset => view.getUint32(offset, true);
    let endOffset = -1;

    for (let offset = Math.max(0, bytes.length - 65557); offset <= bytes.length - 22; offset++) {
      if (readU32(offset) === 0x06054b50) endOffset = offset;
    }
    if (endOffset < 0) throw new Error("This is not a supported .xlsx file.");

    const entryCount = readU16(endOffset + 10);
    const directorySize = readU32(endOffset + 12);
    let offset = readU32(endOffset + 16);
    if (offset + directorySize > bytes.length) throw new Error("The Excel file is damaged.");

    const entries = new Map();
    const decoder = new TextDecoder();
    for (let index = 0; index < entryCount; index++) {
      if (readU32(offset) !== 0x02014b50 || offset + 46 > bytes.length) {
        throw new Error("The Excel file has an invalid ZIP directory.");
      }
      const flags = readU16(offset + 8);
      const method = readU16(offset + 10);
      const compressedSize = readU32(offset + 20);
      const uncompressedSize = readU32(offset + 24);
      const nameLength = readU16(offset + 28);
      const extraLength = readU16(offset + 30);
      const commentLength = readU16(offset + 32);
      const localOffset = readU32(offset + 42);
      const nameStart = offset + 46;
      const name = decoder.decode(bytes.subarray(nameStart, nameStart + nameLength));
      if (flags & 1) throw new Error("Encrypted Excel files are not supported.");
      if (compressedSize === 0xffffffff || uncompressedSize === 0xffffffff || localOffset === 0xffffffff) {
        throw new Error("Excel workbooks using ZIP64 compression are not supported.");
      }
      entries.set(name, { method, compressedSize, uncompressedSize, localOffset });
      offset = nameStart + nameLength + extraLength + commentLength;
    }

    async function readEntry(name) {
      const entry = entries.get(name);
      if (!entry) return null;
      if (entry.uncompressedSize > 100 * 1024 * 1024) {
        throw new Error("An Excel workbook part is too large to import safely.");
      }
      const localOffset = entry.localOffset;
      if (readU32(localOffset) !== 0x04034b50 || localOffset + 30 > bytes.length) {
        throw new Error("The Excel file contains an invalid worksheet.");
      }
      const dataStart = localOffset + 30 + readU16(localOffset + 26) + readU16(localOffset + 28);
      const dataEnd = dataStart + entry.compressedSize;
      if (dataEnd > bytes.length) throw new Error("The Excel file is incomplete.");
      const compressed = bytes.slice(dataStart, dataEnd);
      if (entry.method === 0) return decoder.decode(compressed);
      if (entry.method !== 8 || typeof DecompressionStream === "undefined") {
        throw new Error("This browser cannot decompress the selected Excel file.");
      }
      try {
        const stream = new Blob([compressed]).stream().pipeThrough(new DecompressionStream("deflate-raw"));
        return await new Response(stream).text();
      } catch (error) {
        throw new Error(`Could not decompress the Excel file: ${error.message}`);
      }
    }

    return { entries, readEntry };
  }

  function resolveWorkbookPath(target) {
    const parts = target.startsWith("/") ? [] : ["xl"];
    for (const part of target.split("/")) {
      if (!part || part === ".") continue;
      if (part === "..") parts.pop();
      else parts.push(part);
    }
    return parts.join("/");
  }

  function cellColumn(reference) {
    const letters = String(reference || "").match(/^[A-Z]+/i)?.[0]?.toUpperCase();
    if (!letters) return -1;
    let index = 0;
    for (const letter of letters) index = index * 26 + letter.charCodeAt(0) - 64;
    return index - 1;
  }

  function cellValue(cell, sharedStrings) {
    const type = cell.getAttribute("t");
    if (type === "inlineStr") {
      return [...cell.getElementsByTagNameNS(MAIN_NS, "t")].map(item => item.textContent).join("");
    }
    const value = cell.getElementsByTagNameNS(MAIN_NS, "v")[0]?.textContent || "";
    if (type === "s") return sharedStrings[Number(value)] || "";
    if (type === "b") return value === "1" ? "TRUE" : "FALSE";
    return value;
  }

  function normalizeHeader(value) {
    return String(value || "").toLowerCase().replace(/[^a-z0-9]/g, "");
  }

  const HEADER_ALIASES = {
    title: ["booktitle", "title", "bookname", "nameofbook"],
    author: ["authoreditor", "author", "writer"],
    publisher: ["publisher", "publication"],
    isbn: ["isbnissn", "isbn", "issn", "barcode"],
    accessionNo: ["accessionno", "accessionnumber", "accessionid"],
    quantity: ["qty", "quantity", "copies", "totalcopies"],
    category: ["category", "genre", "bookcategory"],
    department: ["department", "dept"],
    edition: ["edition"],
    year: ["year", "publicationyear", "publishedyear"],
    rack: ["rackshelfno", "rackno", "shelfno"],
    subject: ["subjectcourse", "subject", "course"],
    source: ["source"],
    status: ["status"],
    remarks: ["remarks", "remark"]
  };

  function findHeader(row) {
    const cells = row.map(normalizeHeader);
    const fields = {};
    for (const [field, aliases] of Object.entries(HEADER_ALIASES)) {
      fields[field] = cells.findIndex(value => aliases.includes(value));
    }
    return fields.title >= 0 ? fields : null;
  }

  function fieldValue(row, headers, field) {
    const index = headers[field];
    return index < 0 || index === undefined ? "" : String(row[index] ?? "").trim();
  }

  function identityKey(book, hasIsbn) {
    const clean = value => String(value || "").trim().toLowerCase().replace(/\s+/g, " ");
    const isbn = clean(book.isbn).replace(/[^a-z0-9]/g, "");
    if (hasIsbn && isbn && !["0", "na", "none", "notavailable"].includes(isbn)) return `isbn:${isbn}`;
    return `title:${[book.title, book.author, book.publisher, book.edition].map(clean).join("|")}`;
  }

  function parseWorksheet(document, sharedStrings, sheetName) {
    const rows = [...document.getElementsByTagNameNS(MAIN_NS, "row")];
    let headerRowIndex = -1;
    let headers = null;
    for (let index = 0; index < Math.min(rows.length, 30); index++) {
      const values = [...rows[index].getElementsByTagNameNS(MAIN_NS, "c")].map(cell => cellValue(cell, sharedStrings));
      const candidate = findHeader(values);
      if (candidate) {
        headers = candidate;
        headerRowIndex = index;
        break;
      }
    }
    if (!headers) return null;

    const books = [];
    let skippedRows = 0;
    for (let index = headerRowIndex + 1; index < rows.length; index++) {
      const values = [];
      for (const cell of rows[index].getElementsByTagNameNS(MAIN_NS, "c")) {
        const column = cellColumn(cell.getAttribute("r"));
        if (column >= 0) values[column] = cellValue(cell, sharedStrings);
      }
      const title = fieldValue(values, headers, "title");
      const accessionNo = fieldValue(values, headers, "accessionNo");
      if (!title) {
        const previousBook = books[books.length - 1];
        if (previousBook && accessionNo) {
          previousBook.accessionNos = [...new Set([...(previousBook.accessionNos || []), accessionNo])];
        }
        continue;
      }

      const quantityText = fieldValue(values, headers, "quantity");
      const quantity = quantityText ? Number(quantityText) : 1;
      if (!Number.isSafeInteger(quantity) || quantity < 1 || quantity > 10000) {
        skippedRows++;
        continue;
      }

      const isbnValue = fieldValue(values, headers, "isbn");
      const hasIsbn = isbnValue && !["0", "-", "n/a", "na", "none"].includes(isbnValue.toLowerCase());
      const isbn = hasIsbn ? isbnValue : accessionNo || "";
      const book = {
        title,
        author: fieldValue(values, headers, "author"),
        publisher: fieldValue(values, headers, "publisher"),
        isbn,
        category: fieldValue(values, headers, "category") || "General",
        quantity,
        published_year: fieldValue(values, headers, "year"),
        edition: fieldValue(values, headers, "edition"),
        accessionNo,
        accessionNos: accessionNo ? [accessionNo] : [],
        department: fieldValue(values, headers, "department") || sheetName,
        rack: fieldValue(values, headers, "rack"),
        subject: fieldValue(values, headers, "subject"),
        source: fieldValue(values, headers, "source"),
        status: fieldValue(values, headers, "status"),
        remarks: fieldValue(values, headers, "remarks")
      };
      book.importKey = identityKey(book, Boolean(hasIsbn));
      books.push(book);
    }
    return { books, skippedRows };
  }

  async function parse(file) {
    if (!file || !/\.xlsx$/i.test(file.name)) throw new Error("Choose an Excel workbook in .xlsx format.");
    const zip = await readZipEntries(file);
    const workbookXml = await zip.readEntry("xl/workbook.xml");
    const relationshipsXml = await zip.readEntry("xl/_rels/workbook.xml.rels");
    if (!workbookXml || !relationshipsXml) throw new Error("Could not find the workbook structure in this file.");

    const workbook = readXml(workbookXml, "workbook");
    const relationships = readXml(relationshipsXml, "workbook relationship");
    const targets = new Map();
    for (const relationship of relationships.getElementsByTagNameNS("*", "Relationship")) {
      if (relationship.getAttribute("TargetMode") !== "External") {
        targets.set(relationship.getAttribute("Id"), resolveWorkbookPath(relationship.getAttribute("Target")));
      }
    }
    const sheets = [...workbook.getElementsByTagNameNS(MAIN_NS, "sheet")].map(sheet => ({
      name: sheet.getAttribute("name"),
      path: targets.get(sheet.getAttributeNS(REL_NS, "id"))
    })).filter(sheet => sheet.path);
    const departmentSheets = sheets.filter(sheet => /^(CSE|EE|CE|ME|APSH)$/i.test(sheet.name));
    const candidates = departmentSheets.length
      ? departmentSheets
      : sheets.filter(sheet => !/^(master data|summary|how to use)$/i.test(sheet.name));

    const stringsXml = await zip.readEntry("xl/sharedStrings.xml");
    const sharedStrings = stringsXml
      ? [...readXml(stringsXml, "shared strings").getElementsByTagNameNS(MAIN_NS, "si")]
        .map(item => [...item.getElementsByTagNameNS(MAIN_NS, "t")].map(text => text.textContent).join(""))
      : [];

    const books = [];
    let skippedRows = 0;
    const sourceSheets = [];
    for (const sheet of candidates) {
      const worksheetXml = await zip.readEntry(sheet.path);
      if (!worksheetXml) continue;
      const parsed = parseWorksheet(readXml(worksheetXml, "worksheet"), sharedStrings, sheet.name);
      if (!parsed) continue;
      books.push(...parsed.books);
      skippedRows += parsed.skippedRows;
      sourceSheets.push(sheet.name);
    }
    if (!books.length) throw new Error("No book entries were found. Check that the workbook has a Book Title column.");
    return { books, skippedRows, sourceSheets };
  }

  window.bookExcelImporter = { parse };
})();
