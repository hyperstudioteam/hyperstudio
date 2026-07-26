//! MySQL query execution with dialect-aware LIMIT capping.

use futures_util::TryStreamExt;
use sqlx::{Column, MySqlPool, Row};

use crate::drivers::mysql::values::decode;
use crate::drivers::query_common::{
    TrailingLimit, is_row_query, parse_standard_limit, probe_one_extra, read_usize_back,
    require_keyword_back, skip_spaces_back, split_trailing_semi, with_semi,
};
use crate::models::QueryResult;

/// Parse standard LIMIT/OFFSET plus MySQL's `LIMIT offset, count` form.
fn parse_limit(body: &str) -> Option<TrailingLimit> {
    let lower = body.to_ascii_lowercase();
    let bytes = lower.as_bytes();
    let mut i = bytes.len();
    skip_spaces_back(bytes, &mut i);
    if i == 0 {
        return None;
    }

    let (count, before_count) = read_usize_back(bytes, i)?;
    i = before_count;
    skip_spaces_back(bytes, &mut i);
    if i == 0 || bytes[i - 1] != b',' {
        return parse_standard_limit(body);
    }

    i -= 1;
    skip_spaces_back(bytes, &mut i);
    let (offset, before_offset) = read_usize_back(bytes, i)?;
    i = before_offset;
    skip_spaces_back(bytes, &mut i);
    let limit_start = require_keyword_back(bytes, &mut i, "limit")?;
    Some(TrailingLimit {
        start: limit_start,
        limit: count,
        suffix: format!(" OFFSET {offset}"),
    })
}

/// Cap SELECT-like statements at `max_rows` using MySQL LIMIT forms
/// (`LIMIT n`, `LIMIT n OFFSET m`, `LIMIT offset, count`).
pub fn enforce_select_limit(sql: &str, max_rows: usize) -> String {
    if max_rows == 0 || !is_row_query(sql) {
        return sql.to_string();
    }

    let (body, trailing_semi) = split_trailing_semi(sql);
    let rewritten = match parse_limit(body) {
        Some(existing) => existing.rewrite(body, max_rows),
        None => format!("{body}\nLIMIT {max_rows}"),
    };
    with_semi(rewritten, trailing_semi)
}

pub async fn execute(pool: &MySqlPool, sql: &str, max_rows: usize) -> Result<QueryResult, String> {
    if sql.trim().is_empty() {
        return Err("Enter a SQL statement first.".into());
    }
    let max_rows = max_rows.max(1);
    let capped = enforce_select_limit(sql, max_rows);
    let sql = probe_one_extra(&capped, max_rows, parse_limit);
    let started = std::time::Instant::now();

    if !is_row_query(&sql) {
        let affected_rows = sqlx::query(&sql)
            .execute(pool)
            .await
            .map_err(|error| error.to_string())?
            .rows_affected();
        return Ok(QueryResult {
            columns: Vec::new(),
            rows: Vec::new(),
            affected_rows,
            elapsed_ms: started.elapsed().as_millis(),
            truncated: false,
        });
    }

    let mut stream = sqlx::query(&sql).fetch(pool);
    let mut rows = Vec::new();
    let mut columns = Vec::new();
    while let Some(row) = stream.try_next().await.map_err(|error| error.to_string())? {
        if columns.is_empty() {
            columns = row
                .columns()
                .iter()
                .map(|column| column.name().into())
                .collect();
        }
        rows.push((0..row.len()).map(|index| decode(&row, index)).collect());
        if rows.len() > max_rows {
            break;
        }
    }
    let truncated = rows.len() > max_rows;
    rows.truncate(max_rows);
    Ok(QueryResult {
        columns,
        rows,
        affected_rows: 0,
        elapsed_ms: started.elapsed().as_millis(),
        truncated,
    })
}

#[cfg(test)]
mod tests {
    use super::enforce_select_limit;

    #[test]
    fn appends_limit_when_missing() {
        assert_eq!(
            enforce_select_limit("SELECT * FROM users", 500),
            "SELECT * FROM users\nLIMIT 500"
        );
    }

    #[test]
    fn clamps_large_limit() {
        assert_eq!(
            enforce_select_limit("SELECT * FROM users LIMIT 10000", 500),
            "SELECT * FROM users\nLIMIT 500"
        );
    }

    #[test]
    fn preserves_small_limit() {
        assert_eq!(
            enforce_select_limit("SELECT * FROM users LIMIT 10", 500),
            "SELECT * FROM users\nLIMIT 10"
        );
    }

    #[test]
    fn preserves_offset_when_clamping() {
        assert_eq!(
            enforce_select_limit("SELECT * FROM users LIMIT 9999 OFFSET 100", 500),
            "SELECT * FROM users\nLIMIT 500 OFFSET 100"
        );
    }

    #[test]
    fn clamps_mysql_limit_offset() {
        assert_eq!(
            enforce_select_limit("SELECT * FROM users LIMIT 100, 9999", 500),
            "SELECT * FROM users\nLIMIT 500 OFFSET 100"
        );
    }

    #[test]
    fn leaves_mutations_alone() {
        assert_eq!(
            enforce_select_limit("DELETE FROM users", 500),
            "DELETE FROM users"
        );
    }
}
