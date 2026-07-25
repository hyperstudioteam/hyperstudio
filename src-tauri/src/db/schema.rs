use std::collections::BTreeMap;

use sqlx::{MySqlPool, PgPool, Row};

use crate::db::state::DatabasePool;
use crate::models::{ColumnNode, SchemaInfo, SchemaNode, TableNode};

pub async fn list_available_schemas(pool: &DatabasePool) -> Result<Vec<SchemaInfo>, String> {
    match pool {
        DatabasePool::Postgres(pool) => postgres_available_schemas(pool).await,
        DatabasePool::MySql(pool) => mysql_available_schemas(pool).await,
    }
}

pub async fn introspect_schema(
    pool: &DatabasePool,
    selected: &[String],
    all_schemas: bool,
) -> Result<Vec<SchemaNode>, String> {
    match pool {
        DatabasePool::Postgres(pool) => postgres_schema(pool, selected).await,
        DatabasePool::MySql(pool) => mysql_schema(pool, selected, all_schemas).await,
    }
}

/// Load tables and columns for a single schema.
pub async fn list_schema_tables(
    pool: &DatabasePool,
    schema: &str,
) -> Result<Vec<TableNode>, String> {
    let schema = schema.trim();
    if schema.is_empty() {
        return Err("Schema name is required.".into());
    }
    let nodes = introspect_schema(pool, &[schema.to_string()], false).await?;
    Ok(nodes
        .into_iter()
        .find(|node| node.name == schema)
        .map(|node| node.tables)
        .unwrap_or_default())
}

async fn postgres_available_schemas(pool: &PgPool) -> Result<Vec<SchemaInfo>, String> {
    let rows = sqlx::query(
        "SELECT nspname
         FROM pg_catalog.pg_namespace
         WHERE nspname NOT LIKE 'pg_toast%'
           AND nspname NOT LIKE 'pg_temp_%'
         ORDER BY nspname",
    )
    .fetch_all(pool)
    .await
    .map_err(|error| error.to_string())?;

    Ok(rows
        .into_iter()
        .filter_map(|row| {
            let name: String = row.try_get(0).ok()?;
            if name.is_empty() {
                return None;
            }
            let is_system = matches!(name.as_str(), "pg_catalog" | "information_schema")
                || name.starts_with("pg_");
            Some(SchemaInfo { name, is_system })
        })
        .collect())
}

async fn mysql_available_schemas(pool: &MySqlPool) -> Result<Vec<SchemaInfo>, String> {
    let rows = sqlx::query(
        "SELECT CAST(SCHEMA_NAME AS CHAR)
         FROM information_schema.SCHEMATA
         ORDER BY SCHEMA_NAME",
    )
    .fetch_all(pool)
    .await
    .map_err(|error| error.to_string())?;

    Ok(rows
        .into_iter()
        .filter_map(|row| {
            let name: String = row.try_get(0).ok()?;
            if name.is_empty() {
                return None;
            }
            let is_system = matches!(
                name.as_str(),
                "information_schema" | "mysql" | "performance_schema" | "sys"
            );
            Some(SchemaInfo { name, is_system })
        })
        .collect())
}

async fn postgres_schema(pool: &PgPool, selected: &[String]) -> Result<Vec<SchemaNode>, String> {
    let table_rows = if selected.is_empty() {
        sqlx::query(
            "SELECT table_schema AS s, table_name AS t, table_type AS k
             FROM information_schema.tables
             WHERE table_schema NOT IN ('pg_catalog', 'information_schema')
             ORDER BY table_schema, table_name",
        )
        .fetch_all(pool)
        .await
        .map_err(|error| error.to_string())?
    } else {
        sqlx::query(
            "SELECT table_schema AS s, table_name AS t, table_type AS k
             FROM information_schema.tables
             WHERE table_schema = ANY($1)
             ORDER BY table_schema, table_name",
        )
        .bind(selected)
        .fetch_all(pool)
        .await
        .map_err(|error| error.to_string())?
    };

    let column_rows = if selected.is_empty() {
        sqlx::query(
            "SELECT c.table_schema AS s,
                    c.table_name AS t,
                    c.column_name AS c,
                    c.data_type AS d,
                    c.is_nullable AS n,
                    CASE WHEN pk.column_name IS NULL THEN 'NO' ELSE 'YES' END AS p
             FROM information_schema.columns c
             LEFT JOIN (
               SELECT kcu.table_schema, kcu.table_name, kcu.column_name
               FROM information_schema.table_constraints tc
               JOIN information_schema.key_column_usage kcu
                 ON tc.constraint_schema = kcu.constraint_schema
                AND tc.constraint_name = kcu.constraint_name
                AND tc.table_schema = kcu.table_schema
                AND tc.table_name = kcu.table_name
               WHERE tc.constraint_type = 'PRIMARY KEY'
             ) pk
               ON pk.table_schema = c.table_schema
              AND pk.table_name = c.table_name
              AND pk.column_name = c.column_name
             WHERE c.table_schema NOT IN ('pg_catalog', 'information_schema')
             ORDER BY c.table_schema, c.table_name, c.ordinal_position",
        )
        .fetch_all(pool)
        .await
        .map_err(|error| error.to_string())?
    } else {
        sqlx::query(
            "SELECT c.table_schema AS s,
                    c.table_name AS t,
                    c.column_name AS c,
                    c.data_type AS d,
                    c.is_nullable AS n,
                    CASE WHEN pk.column_name IS NULL THEN 'NO' ELSE 'YES' END AS p
             FROM information_schema.columns c
             LEFT JOIN (
               SELECT kcu.table_schema, kcu.table_name, kcu.column_name
               FROM information_schema.table_constraints tc
               JOIN information_schema.key_column_usage kcu
                 ON tc.constraint_schema = kcu.constraint_schema
                AND tc.constraint_name = kcu.constraint_name
                AND tc.table_schema = kcu.table_schema
                AND tc.table_name = kcu.table_name
               WHERE tc.constraint_type = 'PRIMARY KEY'
             ) pk
               ON pk.table_schema = c.table_schema
              AND pk.table_name = c.table_name
              AND pk.column_name = c.column_name
             WHERE c.table_schema = ANY($1)
             ORDER BY c.table_schema, c.table_name, c.ordinal_position",
        )
        .bind(selected)
        .fetch_all(pool)
        .await
        .map_err(|error| error.to_string())?
    };

    build_schema_tree(table_rows, column_rows)
}

async fn mysql_schema(
    pool: &MySqlPool,
    selected: &[String],
    all_schemas: bool,
) -> Result<Vec<SchemaNode>, String> {
    // MySQL returns information_schema names in UPPERCASE; use positional indexes.
    let table_rows = if !selected.is_empty() {
        let placeholders = selected.iter().map(|_| "?").collect::<Vec<_>>().join(", ");
        let sql = format!(
            "SELECT CAST(TABLE_SCHEMA AS CHAR),
                    CAST(TABLE_NAME AS CHAR),
                    CAST(TABLE_TYPE AS CHAR)
             FROM information_schema.TABLES
             WHERE TABLE_SCHEMA IN ({placeholders})
             ORDER BY TABLE_SCHEMA, TABLE_NAME"
        );
        let mut query = sqlx::query(&sql);
        for schema in selected {
            query = query.bind(schema);
        }
        query
            .fetch_all(pool)
            .await
            .map_err(|error| error.to_string())?
    } else if all_schemas {
        sqlx::query(
            "SELECT CAST(TABLE_SCHEMA AS CHAR),
                    CAST(TABLE_NAME AS CHAR),
                    CAST(TABLE_TYPE AS CHAR)
             FROM information_schema.TABLES
             WHERE TABLE_SCHEMA NOT IN ('information_schema', 'mysql', 'performance_schema', 'sys')
             ORDER BY TABLE_SCHEMA, TABLE_NAME",
        )
        .fetch_all(pool)
        .await
        .map_err(|error| error.to_string())?
    } else {
        sqlx::query(
            "SELECT CAST(TABLE_SCHEMA AS CHAR),
                    CAST(TABLE_NAME AS CHAR),
                    CAST(TABLE_TYPE AS CHAR)
             FROM information_schema.TABLES
             WHERE TABLE_SCHEMA = DATABASE()
             ORDER BY TABLE_NAME",
        )
        .fetch_all(pool)
        .await
        .map_err(|error| error.to_string())?
    };

    let column_rows = if !selected.is_empty() {
        let placeholders = selected.iter().map(|_| "?").collect::<Vec<_>>().join(", ");
        let sql = format!(
            "SELECT CAST(TABLE_SCHEMA AS CHAR),
                    CAST(TABLE_NAME AS CHAR),
                    CAST(COLUMN_NAME AS CHAR),
                    CAST(COLUMN_TYPE AS CHAR),
                    CAST(IS_NULLABLE AS CHAR),
                    CAST(COLUMN_KEY AS CHAR)
             FROM information_schema.COLUMNS
             WHERE TABLE_SCHEMA IN ({placeholders})
             ORDER BY TABLE_SCHEMA, TABLE_NAME, ORDINAL_POSITION"
        );
        let mut query = sqlx::query(&sql);
        for schema in selected {
            query = query.bind(schema);
        }
        query
            .fetch_all(pool)
            .await
            .map_err(|error| error.to_string())?
    } else if all_schemas {
        sqlx::query(
            "SELECT CAST(TABLE_SCHEMA AS CHAR),
                    CAST(TABLE_NAME AS CHAR),
                    CAST(COLUMN_NAME AS CHAR),
                    CAST(COLUMN_TYPE AS CHAR),
                    CAST(IS_NULLABLE AS CHAR),
                    CAST(COLUMN_KEY AS CHAR)
             FROM information_schema.COLUMNS
             WHERE TABLE_SCHEMA NOT IN ('information_schema', 'mysql', 'performance_schema', 'sys')
             ORDER BY TABLE_SCHEMA, TABLE_NAME, ORDINAL_POSITION",
        )
        .fetch_all(pool)
        .await
        .map_err(|error| error.to_string())?
    } else {
        sqlx::query(
            "SELECT CAST(TABLE_SCHEMA AS CHAR),
                    CAST(TABLE_NAME AS CHAR),
                    CAST(COLUMN_NAME AS CHAR),
                    CAST(COLUMN_TYPE AS CHAR),
                    CAST(IS_NULLABLE AS CHAR),
                    CAST(COLUMN_KEY AS CHAR)
             FROM information_schema.COLUMNS
             WHERE TABLE_SCHEMA = DATABASE()
             ORDER BY TABLE_NAME, ORDINAL_POSITION",
        )
        .fetch_all(pool)
        .await
        .map_err(|error| error.to_string())?
    };

    build_schema_tree(table_rows, column_rows)
}

fn build_schema_tree<TRow, CRow>(
    table_rows: Vec<TRow>,
    column_rows: Vec<CRow>,
) -> Result<Vec<SchemaNode>, String>
where
    TRow: Row,
    for<'r> usize: sqlx::ColumnIndex<TRow>,
    for<'r> String: sqlx::Decode<'r, TRow::Database> + sqlx::Type<TRow::Database>,
    CRow: Row<Database = TRow::Database>,
    for<'r> usize: sqlx::ColumnIndex<CRow>,
{
    let mut tables: BTreeMap<(String, String), TableNode> = BTreeMap::new();
    for row in table_rows {
        let schema: String = row.try_get(0).map_err(|error| error.to_string())?;
        let name: String = row.try_get(1).map_err(|error| error.to_string())?;
        let kind: String = row.try_get(2).map_err(|error| error.to_string())?;
        tables.insert(
            (schema, name.clone()),
            TableNode {
                name,
                kind,
                columns: Vec::new(),
            },
        );
    }

    for row in column_rows {
        let schema: String = row.try_get(0).map_err(|error| error.to_string())?;
        let table: String = row.try_get(1).map_err(|error| error.to_string())?;
        if let Some(node) = tables.get_mut(&(schema, table)) {
            let nullable: String = row.try_get(4).map_err(|error| error.to_string())?;
            let primary: String = row.try_get(5).unwrap_or_else(|_| "NO".into());
            node.columns.push(ColumnNode {
                name: row.try_get(2).map_err(|error| error.to_string())?,
                data_type: row.try_get(3).map_err(|error| error.to_string())?,
                nullable: nullable.eq_ignore_ascii_case("YES"),
                primary_key: primary.eq_ignore_ascii_case("YES")
                    || primary.eq_ignore_ascii_case("PRI"),
            });
        }
    }

    let mut schemas: BTreeMap<String, Vec<TableNode>> = BTreeMap::new();
    for ((schema, _), table) in tables {
        schemas.entry(schema).or_default().push(table);
    }
    Ok(schemas
        .into_iter()
        .map(|(name, tables)| SchemaNode { name, tables })
        .collect())
}
