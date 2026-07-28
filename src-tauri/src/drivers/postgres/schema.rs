use sqlx::{PgPool, Row};

use crate::drivers::schema_common::build_schema_tree;
use crate::models::{ObjectNode, SchemaInfo, SchemaNode, TableNode};

pub async fn list_available(pool: &PgPool) -> Result<Vec<SchemaInfo>, String> {
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

pub async fn list_databases(pool: &PgPool) -> Result<Vec<SchemaInfo>, String> {
    let rows = sqlx::query(
        "SELECT datname
         FROM pg_catalog.pg_database
         WHERE datallowconn
         ORDER BY datname",
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
            let is_system = matches!(name.as_str(), "template0" | "template1");
            Some(SchemaInfo { name, is_system })
        })
        .collect())
}

pub async fn introspect(pool: &PgPool, selected: &[String]) -> Result<Vec<SchemaNode>, String> {
    let table_rows = if selected.is_empty() {
        sqlx::query(
            "SELECT table_schema, table_name, table_type
             FROM information_schema.tables
             WHERE table_schema NOT IN ('pg_catalog', 'information_schema')
             ORDER BY table_schema, table_name",
        )
        .fetch_all(pool)
        .await
        .map_err(|error| error.to_string())?
    } else {
        sqlx::query(
            "SELECT table_schema, table_name, table_type
             FROM information_schema.tables
             WHERE table_schema = ANY($1)
             ORDER BY table_schema, table_name",
        )
        .bind(selected)
        .fetch_all(pool)
        .await
        .map_err(|error| error.to_string())?
    };

    let column_sql_all = "SELECT c.table_schema,
                                 c.table_name,
                                 c.column_name,
                                 CASE
                                   WHEN c.data_type = 'USER-DEFINED' THEN c.udt_name
                                   ELSE c.data_type
                                 END,
                                 c.is_nullable,
                                 CASE WHEN pk.column_name IS NULL THEN 'NO' ELSE 'YES' END,
                                 c.column_default,
                                 (
                                   SELECT pg_catalog.col_description(cls.oid, c.ordinal_position::int)
                                   FROM pg_catalog.pg_class cls
                                   JOIN pg_catalog.pg_namespace nsp ON nsp.oid = cls.relnamespace
                                   WHERE nsp.nspname = c.table_schema AND cls.relname = c.table_name
                                     AND cls.relkind IN ('r', 'p', 'v', 'm', 'f')
                                   LIMIT 1
                                 ),
                                 CASE
                                   WHEN c.is_identity = 'YES' THEN 'YES'
                                   WHEN c.column_default LIKE 'nextval(%' THEN 'YES'
                                   ELSE 'NO'
                                 END,
                                 (
                                   SELECT jsonb_agg(e.enumlabel ORDER BY e.enumsortorder)::text
                                   FROM pg_catalog.pg_type t
                                   JOIN pg_catalog.pg_namespace n ON n.oid = t.typnamespace
                                   JOIN pg_catalog.pg_enum e ON e.enumtypid = t.oid
                                   WHERE c.data_type = 'USER-DEFINED'
                                     AND t.typname = c.udt_name
                                     AND n.nspname = c.udt_schema
                                 )
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
                          ORDER BY c.table_schema, c.table_name, c.ordinal_position";
    let column_sql_selected = "SELECT c.table_schema,
                                      c.table_name,
                                      c.column_name,
                                      CASE
                                        WHEN c.data_type = 'USER-DEFINED' THEN c.udt_name
                                        ELSE c.data_type
                                      END,
                                      c.is_nullable,
                                      CASE WHEN pk.column_name IS NULL THEN 'NO' ELSE 'YES' END,
                                      c.column_default,
                                      (
                                        SELECT pg_catalog.col_description(cls.oid, c.ordinal_position::int)
                                        FROM pg_catalog.pg_class cls
                                        JOIN pg_catalog.pg_namespace nsp ON nsp.oid = cls.relnamespace
                                        WHERE nsp.nspname = c.table_schema AND cls.relname = c.table_name
                                          AND cls.relkind IN ('r', 'p', 'v', 'm', 'f')
                                        LIMIT 1
                                      ),
                                      CASE
                                        WHEN c.is_identity = 'YES' THEN 'YES'
                                        WHEN c.column_default LIKE 'nextval(%' THEN 'YES'
                                        ELSE 'NO'
                                      END,
                                      (
                                        SELECT jsonb_agg(e.enumlabel ORDER BY e.enumsortorder)::text
                                        FROM pg_catalog.pg_type t
                                        JOIN pg_catalog.pg_namespace n ON n.oid = t.typnamespace
                                        JOIN pg_catalog.pg_enum e ON e.enumtypid = t.oid
                                        WHERE c.data_type = 'USER-DEFINED'
                                          AND t.typname = c.udt_name
                                          AND n.nspname = c.udt_schema
                                      )
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
                               ORDER BY c.table_schema, c.table_name, c.ordinal_position";
    let column_rows = if selected.is_empty() {
        sqlx::query(column_sql_all)
            .fetch_all(pool)
            .await
            .map_err(|error| error.to_string())?
    } else {
        sqlx::query(column_sql_selected)
            .bind(selected)
            .fetch_all(pool)
            .await
            .map_err(|error| error.to_string())?
    };

    build_schema_tree(table_rows, column_rows)
}

pub async fn list_tables(pool: &PgPool, schema: &str) -> Result<Vec<TableNode>, String> {
    let schema = schema.trim();
    if schema.is_empty() {
        return Err("Schema name is required.".into());
    }
    let nodes = introspect(pool, &[schema.to_string()]).await?;
    Ok(nodes
        .into_iter()
        .find(|node| node.name == schema)
        .map(|node| node.tables)
        .unwrap_or_default())
}

pub async fn list_tables_of_kind(
    pool: &PgPool,
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
