//! Shared helpers for built-in driver query execution.

pub fn is_row_query(sql: &str) -> bool {
    let statement = sql
        .trim_start_matches(|character: char| character.is_whitespace() || character == ';')
        .to_ascii_lowercase();
    [
        "select", "with", "show", "describe", "desc", "explain", "values",
    ]
    .iter()
    .any(|keyword| statement.starts_with(keyword))
}

/// EXPLAIN plans must not receive LIMIT/OFFSET capping — that corrupts the statement.
pub fn is_explain_query(sql: &str) -> bool {
    let statement = sql
        .trim_start_matches(|character: char| character.is_whitespace() || character == ';')
        .to_ascii_lowercase();
    statement.starts_with("explain")
}

pub struct TrailingLimit {
    /// Byte offset where the LIMIT/OFFSET clause begins.
    pub start: usize,
    pub limit: usize,
    /// Text after LIMIT for forms that keep OFFSET, e.g. `" OFFSET 10"`.
    pub suffix: String,
}

impl TrailingLimit {
    pub fn rewrite(&self, body: &str, max_rows: usize) -> String {
        self.force_limit(body, self.limit.min(max_rows))
    }

    pub fn force_limit(&self, body: &str, limit: usize) -> String {
        let prefix = body[..self.start].trim_end();
        format!("{prefix}\nLIMIT {limit}{}", self.suffix)
    }
}

pub fn split_trailing_semi(sql: &str) -> (&str, bool) {
    let trimmed = sql.trim();
    if let Some(stripped) = trimmed.strip_suffix(';') {
        (stripped.trim_end(), true)
    } else {
        (trimmed, false)
    }
}

pub fn with_semi(body: String, trailing_semi: bool) -> String {
    if trailing_semi {
        format!("{body};")
    } else {
        body
    }
}

pub fn probe_one_extra(
    sql: &str,
    page_size: usize,
    parse: impl Fn(&str) -> Option<TrailingLimit>,
) -> String {
    let (body, trailing_semi) = split_trailing_semi(sql);
    let Some(existing) = parse(body) else {
        return sql.to_string();
    };
    if existing.limit != page_size {
        return sql.to_string();
    }
    with_semi(
        existing.force_limit(body, page_size.saturating_add(1)),
        trailing_semi,
    )
}

pub fn keyword_back(bytes: &[u8], end: usize, keyword: &str) -> Option<usize> {
    let kw = keyword.as_bytes();
    if end < kw.len() {
        return None;
    }
    let start = end - kw.len();
    if &bytes[start..end] != kw {
        return None;
    }
    if start > 0 && !bytes[start - 1].is_ascii_whitespace() {
        return None;
    }
    Some(start)
}

pub fn require_keyword_back(bytes: &[u8], i: &mut usize, keyword: &str) -> Option<usize> {
    let start = keyword_back(bytes, *i, keyword)?;
    *i = start;
    skip_spaces_back(bytes, i);
    Some(start)
}

pub fn read_usize_back(bytes: &[u8], end: usize) -> Option<(usize, usize)> {
    if end == 0 || !bytes[end - 1].is_ascii_digit() {
        return None;
    }
    let mut start = end;
    while start > 0 && bytes[start - 1].is_ascii_digit() {
        start -= 1;
    }
    let (value, _) = read_usize(bytes, start)?;
    Some((value, start))
}

pub fn skip_spaces_back(bytes: &[u8], i: &mut usize) {
    while *i > 0 && bytes[*i - 1].is_ascii_whitespace() {
        *i -= 1;
    }
}

pub fn read_usize(bytes: &[u8], start: usize) -> Option<(usize, usize)> {
    let mut i = start;
    if i >= bytes.len() || !bytes[i].is_ascii_digit() {
        return None;
    }
    let mut value: usize = 0;
    while i < bytes.len() && bytes[i].is_ascii_digit() {
        value = value
            .checked_mul(10)?
            .checked_add((bytes[i] - b'0') as usize)?;
        i += 1;
    }
    Some((value, i))
}

/// Parse `LIMIT n`, `LIMIT n OFFSET m`, and `OFFSET m LIMIT n`.
pub fn parse_standard_limit(body: &str) -> Option<TrailingLimit> {
    let lower = body.to_ascii_lowercase();
    let bytes = lower.as_bytes();
    let mut i = bytes.len();
    skip_spaces_back(bytes, &mut i);
    if i == 0 {
        return None;
    }

    let (last_num, before_last) = read_usize_back(bytes, i)?;
    i = before_last;
    skip_spaces_back(bytes, &mut i);

    let kw_end = i;
    if let Some(limit_start) = keyword_back(bytes, kw_end, "limit") {
        let mut j = limit_start;
        skip_spaces_back(bytes, &mut j);
        if let Some((offset_num, before_offset_num)) = read_usize_back(bytes, j) {
            j = before_offset_num;
            skip_spaces_back(bytes, &mut j);
            if let Some(offset_start) = keyword_back(bytes, j, "offset") {
                return Some(TrailingLimit {
                    start: offset_start,
                    limit: last_num,
                    suffix: format!(" OFFSET {offset_num}"),
                });
            }
        }
        return Some(TrailingLimit {
            start: limit_start,
            limit: last_num,
            suffix: String::new(),
        });
    }

    if let Some(offset_start) = keyword_back(bytes, kw_end, "offset") {
        let offset_num = last_num;
        let mut j = offset_start;
        skip_spaces_back(bytes, &mut j);
        let (limit_num, before_limit) = read_usize_back(bytes, j)?;
        j = before_limit;
        skip_spaces_back(bytes, &mut j);
        let limit_start = require_keyword_back(bytes, &mut j, "limit")?;
        return Some(TrailingLimit {
            start: limit_start,
            limit: limit_num,
            suffix: format!(" OFFSET {offset_num}"),
        });
    }

    None
}
