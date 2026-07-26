use sqlx::{MySqlPool, Row};

use crate::drivers::schema_common::build_schema_tree;
use crate::models::{ObjectNode, SchemaInfo, SchemaNode, TableNode};

pub async fn list_available(pool: &MySqlPool) -> Result<Vec<SchemaInfo>, String> {
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

pub async fn introspect(
    pool: &MySqlPool,
    selected: &[String],
    all_schemas: bool,
) -> Result<Vec<SchemaNode>, String> {
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

pub async fn list_tables(pool: &MySqlPool, schema: &str) -> Result<Vec<TableNode>, String> {
    let schema = schema.trim();
    if schema.is_empty() {
        return Err("Schema name is required.".into());
    }
    let nodes = introspect(pool, &[schema.to_string()], false).await?;
    Ok(nodes
        .into_iter()
        .find(|node| node.name == schema)
        .map(|node| node.tables)
        .unwrap_or_default())
}

pub async fn list_tables_of_kind(
    pool: &MySqlPool,
    schema: &str,
    views: bool,
) -> Result<Vec<ObjectNode>, String> {
    Ok(list_tables(pool, schema)
        .await?
        .into_iter()
        .filter(|table| table.kind.to_uppercase().contains("VIEW") == views)
        .map(ObjectNode::from)
        .collect())
}
