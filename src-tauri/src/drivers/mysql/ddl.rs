use sqlx::{MySqlPool, Row};

/// Read DDL straight from the server.
///
/// MySQL answers `SHOW CREATE TABLE` for tables and views alike; the second
/// column holds the statement, so no reconstruction is needed.
pub async fn table_ddl(pool: &MySqlPool, schema: &str, table: &str) -> Result<String, String> {
    let quoted = format!(
        "`{}`.`{}`",
        schema.replace('`', "``"),
        table.replace('`', "``")
    );

    let row = sqlx::query(&format!("SHOW CREATE TABLE {quoted}"))
        .fetch_optional(pool)
        .await
        .map_err(|error| error.to_string())?
        .ok_or_else(|| format!("'{schema}.{table}' was not found."))?;

    // Tables return (Table, Create Table); views return four columns with the
    // statement still in position 1.
    let ddl: String = row
        .try_get::<String, _>(1)
        .map_err(|error| format!("Could not read DDL for {quoted}: {error}"))?;

    Ok(format!("{};", ddl.trim_end_matches(';')))
}
