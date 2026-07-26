export interface SplitStatement {
  sql: string;
  /** 1-based line number where the statement begins, for error reporting. */
  line: number;
}

/**
 * Split a script into individual statements on top-level semicolons.
 *
 * Semicolons inside string literals, quoted identifiers, comments, and
 * dollar-quoted blocks are ignored, so function bodies and text containing
 * `;` survive intact.
 */
export function splitStatements(script: string): SplitStatement[] {
  const statements: SplitStatement[] = [];
  let buffer = "";
  let line = 1;
  let startLine = 1;
  let started = false;

  let index = 0;
  const length = script.length;

  function push() {
    if (buffer.trim()) {
      statements.push({ sql: buffer.trim(), line: startLine });
    }
    buffer = "";
    started = false;
  }

  while (index < length) {
    const char = script[index];
    const next = script[index + 1];

    if (char === "\n") line += 1;

    if (!started && !/\s/.test(char)) {
      started = true;
      startLine = line;
    }

    // Line comment
    if (char === "-" && next === "-") {
      const end = script.indexOf("\n", index);
      const stop = end === -1 ? length : end;
      buffer += script.slice(index, stop);
      index = stop;
      continue;
    }

    // Block comment
    if (char === "/" && next === "*") {
      const end = script.indexOf("*/", index + 2);
      const stop = end === -1 ? length : end + 2;
      const chunk = script.slice(index, stop);
      line += (chunk.match(/\n/g) ?? []).length;
      buffer += chunk;
      index = stop;
      continue;
    }

    // Dollar-quoted block, e.g. $$ ... $$ or $tag$ ... $tag$
    if (char === "$") {
      const tagMatch = /^\$[A-Za-z_][A-Za-z0-9_]*\$|^\$\$/.exec(
        script.slice(index),
      );
      if (tagMatch) {
        const tag = tagMatch[0];
        const end = script.indexOf(tag, index + tag.length);
        const stop = end === -1 ? length : end + tag.length;
        const chunk = script.slice(index, stop);
        line += (chunk.match(/\n/g) ?? []).length;
        buffer += chunk;
        index = stop;
        continue;
      }
    }

    // Quoted string or identifier
    if (char === "'" || char === '"' || char === "`") {
      let cursor = index + 1;
      let chunk = char;
      while (cursor < length) {
        const inner = script[cursor];
        if (inner === "\\" && (char === "'" || char === '"')) {
          // Backslash escapes are MySQL-style; consume the pair.
          chunk += script.slice(cursor, cursor + 2);
          cursor += 2;
          continue;
        }
        if (inner === char) {
          // A doubled quote is an escaped quote, not a terminator.
          if (script[cursor + 1] === char) {
            chunk += char + char;
            cursor += 2;
            continue;
          }
          chunk += char;
          cursor += 1;
          break;
        }
        if (inner === "\n") line += 1;
        chunk += inner;
        cursor += 1;
      }
      buffer += chunk;
      index = cursor;
      continue;
    }

    if (char === ";") {
      push();
      index += 1;
      continue;
    }

    buffer += char;
    index += 1;
  }

  push();
  return statements;
}

/** True when the script holds more than one runnable statement. */
export function hasMultipleStatements(script: string): boolean {
  return splitStatements(script).length > 1;
}
