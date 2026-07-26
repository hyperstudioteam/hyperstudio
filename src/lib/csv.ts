export type CsvDelimiter = "," | ";" | "\t" | "|";

export const CSV_DELIMITERS: { id: CsvDelimiter; label: string }[] = [
  { id: ",", label: "Comma" },
  { id: ";", label: "Semicolon" },
  { id: "\t", label: "Tab" },
  { id: "|", label: "Pipe" },
];

/** Pick the delimiter that yields the most consistent column count. */
export function sniffDelimiter(sample: string): CsvDelimiter {
  const lines = sample.split(/\r?\n/).filter((line) => line.trim()).slice(0, 20);
  if (lines.length === 0) return ",";

  let best: CsvDelimiter = ",";
  let bestScore = -1;
  for (const { id } of CSV_DELIMITERS) {
    const counts = lines.map((line) => parseCsv(line, id)[0]?.length ?? 0);
    const columns = counts[0] ?? 0;
    if (columns < 2) continue;
    const consistent = counts.every((count) => count === columns);
    const score = (consistent ? 1000 : 0) + columns;
    if (score > bestScore) {
      bestScore = score;
      best = id;
    }
  }
  return best;
}

/**
 * RFC 4180 parser: double quotes wrap fields, `""` is an escaped quote, and a
 * quoted field may contain the delimiter or a newline.
 */
export function parseCsv(text: string, delimiter: CsvDelimiter): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let quoted = false;
  let index = 0;
  // Strip a UTF-8 BOM so the first header does not carry an invisible prefix.
  if (text.charCodeAt(0) === 0xfeff) index = 1;

  function endField() {
    row.push(field);
    field = "";
  }

  function endRow() {
    endField();
    // Ignore the blank row produced by a trailing newline.
    if (row.length > 1 || row[0] !== "") rows.push(row);
    row = [];
  }

  while (index < text.length) {
    const char = text[index];

    if (quoted) {
      if (char === '"') {
        if (text[index + 1] === '"') {
          field += '"';
          index += 2;
          continue;
        }
        quoted = false;
        index += 1;
        continue;
      }
      field += char;
      index += 1;
      continue;
    }

    if (char === '"' && field === "") {
      quoted = true;
      index += 1;
      continue;
    }
    if (char === delimiter) {
      endField();
      index += 1;
      continue;
    }
    if (char === "\r") {
      index += 1;
      continue;
    }
    if (char === "\n") {
      endRow();
      index += 1;
      continue;
    }
    field += char;
    index += 1;
  }

  if (field !== "" || row.length > 0) endRow();
  return rows;
}

/** Make header names usable as map keys, filling in blanks positionally. */
export function headerNames(row: string[]): string[] {
  return row.map((name, index) => name.trim() || `column_${index + 1}`);
}
