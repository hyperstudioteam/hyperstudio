use futures_util::TryStreamExt;
use sqlx::{Column, Row};

use crate::db::state::DatabasePool;
use crate::db::values::{mysql_value, postgres_value};
use crate::models::QueryResult;

const MAX_RESULT_ROWS: usize = 1_000;

fn is_row_query(sql: &str) -> bool {
    let statement = sql
        .trim_start_matches(|character: char| character.is_whitespace() || character == ';')
        .to_ascii_lowercase();
    [
        "select", "with", "show", "describe", "desc", "explain", "values",
    ]
    .iter()
    .any(|keyword| statement.starts_with(keyword))
}

pub async fn execute_sql(pool: &DatabasePool, sql: &str) -> Result<QueryResult, String> {
    if sql.trim().is_empty() {
        return Err("Enter a SQL statement first.".into());
    }
    let started = std::time::Instant::now();

    if !is_row_query(sql) {
        let affected_rows = match pool {
            DatabasePool::Postgres(pool) => sqlx::query(sql)
                .execute(pool)
                .await
                .map_err(|error| error.to_string())?
                .rows_affected(),
            DatabasePool::MySql(pool) => sqlx::query(sql)
                .execute(pool)
                .await
                .map_err(|error| error.to_string())?
                .rows_affected(),
        };
        return Ok(QueryResult {
            columns: Vec::new(),
            rows: Vec::new(),
            affected_rows,
            elapsed_ms: started.elapsed().as_millis(),
            truncated: false,
        });
    }

    match pool {
        DatabasePool::Postgres(pool) => {
            let mut stream = sqlx::query(sql).fetch(pool);
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
                rows.push(
                    (0..row.len())
                        .map(|index| postgres_value(&row, index))
                        .collect(),
                );
                if rows.len() > MAX_RESULT_ROWS {
                    break;
                }
            }
            let truncated = rows.len() > MAX_RESULT_ROWS;
            rows.truncate(MAX_RESULT_ROWS);
            Ok(QueryResult {
                columns,
                rows,
                affected_rows: 0,
                elapsed_ms: started.elapsed().as_millis(),
                truncated,
            })
        }
        DatabasePool::MySql(pool) => {
            let mut stream = sqlx::query(sql).fetch(pool);
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
                rows.push(
                    (0..row.len())
                        .map(|index| mysql_value(&row, index))
                        .collect(),
                );
                if rows.len() > MAX_RESULT_ROWS {
                    break;
                }
            }
            let truncated = rows.len() > MAX_RESULT_ROWS;
            rows.truncate(MAX_RESULT_ROWS);
            Ok(QueryResult {
                columns,
                rows,
                affected_rows: 0,
                elapsed_ms: started.elapsed().as_millis(),
                truncated,
            })
        }
    }
}
