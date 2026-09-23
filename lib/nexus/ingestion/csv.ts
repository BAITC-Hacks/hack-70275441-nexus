/**
 * RFC4180-style CSV parsing: a delimiter or newline inside a "quoted" field is part of the value, and a
 * doubled `""` inside a quoted field is one literal quote character. A naive line-then-split parse (the
 * previous implementation) corrupts any cell containing the delimiter or an embedded newline — e.g. a
 * name column like `"Иванов, Иван Иванович"` silently shifts every later column in that row.
 */
function parseCsv(text: string, delimiter: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let inQuotes = false;
  for (let i = 0; i < text.length; i += 1) {
    const char = text[i];
    if (inQuotes) {
      if (char === '"' && text[i + 1] === '"') { field += '"'; i += 1; continue; }
      if (char === '"') { inQuotes = false; continue; }
      field += char; continue;
    }
    if (char === '"') { inQuotes = true; continue; }
    if (char === delimiter) { row.push(field.trim()); field = ""; continue; }
    if (char === "\r") continue;
    if (char === "\n") { row.push(field.trim()); rows.push(row); row = []; field = ""; continue; }
    field += char;
  }
  if (field.length > 0 || row.length > 0) { row.push(field.trim()); rows.push(row); }
  return rows;
}

/** Counts candidate delimiters only outside quotes in the first logical CSV record. */
function detectDelimiter(text: string): string {
  let commas = 0, semicolons = 0, inQuotes = false;
  for (let i = 0; i < text.length; i += 1) {
    const char = text[i];
    if (char === '"') {
      if (inQuotes && text[i + 1] === '"') { i += 1; continue; }
      inQuotes = !inQuotes;
    } else if (!inQuotes) {
      if (char === "\n" || char === "\r") break;
      if (char === ",") commas += 1;
      if (char === ";") semicolons += 1;
    }
  }
  return semicolons > commas ? ";" : ",";
}

/** Parses raw CSV/TSV-like file text into rows of trimmed string cells, tolerant of a leading BOM and of quoted fields containing the delimiter or a newline. */
export function csvRows(text: string): string[][] {
  const stripped = text.replace(/^﻿/, "").trim();
  const delimiter = detectDelimiter(stripped);
  return parseCsv(stripped, delimiter);
}
