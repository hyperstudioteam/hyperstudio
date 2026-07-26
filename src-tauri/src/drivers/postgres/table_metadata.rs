use std::collections::BTreeMap;

use sqlx::{PgPool, Row};

use crate::models::ObjectNode;

fn node(name: String, kind: &str, detail: String) -> ObjectNode {
    ObjectNode {
        name,
        kind: kind.into(),
        detail: Some(detail),
        children: Vec::new(),
        actions: None,
    }
}

pub async fn list(
    pool: &PgPool,
    schema: &str,
    table: &str,
    subgroup: &str,
) -> Result<Vec<ObjectNode>, String> {
    match subgroup {
        "keys" => keys(pool, schema, table).await,
        "foreignKeys" => foreign_keys(pool, schema, table).await,
        "indexes" => indexes(pool, schema, table).await,
        other => Err(format!("Unknown table subgroup '{other}'.")),
    }
}

async fn keys(pool: &PgPool, schema: &str, table: &str) -> Result<Vec<ObjectNode>, String> {
    let rows = sqlx::query(
        "SELECT con.conname,
                CASE con.contype WHEN 'p' THEN 'PRIMARY KEY' ELSE 'UNIQUE' END,
                a.attname
         FROM pg_catalog.pg_constraint con
         JOIN pg_catalog.pg_class c ON c.oid = con.conrelid
         JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace
         CROSS JOIN LATERAL
           unnest(con.conkey) WITH ORDINALITY AS ord(attnum, ordinality)
         JOIN pg_catalog.pg_attribute a
           ON a.attrelid = c.oid AND a.attnum = ord.attnum
         WHERE con.contype IN ('p', 'u')
           AND n.nspname = $1
           AND c.relname = $2
         ORDER BY CASE con.contype WHEN 'p' THEN 0 ELSE 1 END,
                  con.conname, ord.ordinality",
    )
    .bind(schema)
    .bind(table)
    .fetch_all(pool)
    .await
    .map_err(|error| error.to_string())?;

    let mut grouped: BTreeMap<String, (String, Vec<String>)> = BTreeMap::new();
    for row in rows {
        let name: String = row.try_get(0).map_err(|error| error.to_string())?;
        let kind: String = row.try_get(1).map_err(|error| error.to_string())?;
        let column: String = row.try_get(2).map_err(|error| error.to_string())?;
        let entry = grouped.entry(name).or_insert_with(|| (kind, Vec::new()));
        entry.1.push(column);
    }

    Ok(grouped
        .into_iter()
        .map(|(name, (kind, columns))| node(name, &kind, format!("({})", columns.join(", "))))
        .collect())
}

async fn foreign_keys(pool: &PgPool, schema: &str, table: &str) -> Result<Vec<ObjectNode>, String> {
    let rows = sqlx::query(
        "SELECT con.conname,
                a.attname,
                fn.nspname,
                fc.relname,
                fa.attname,
                CASE con.confupdtype
                  WHEN 'a' THEN 'NO ACTION' WHEN 'r' THEN 'RESTRICT'
                  WHEN 'c' THEN 'CASCADE' WHEN 'n' THEN 'SET NULL'
                  WHEN 'd' THEN 'SET DEFAULT'
                END,
                CASE con.confdeltype
                  WHEN 'a' THEN 'NO ACTION' WHEN 'r' THEN 'RESTRICT'
                  WHEN 'c' THEN 'CASCADE' WHEN 'n' THEN 'SET NULL'
                  WHEN 'd' THEN 'SET DEFAULT'
                END
         FROM pg_catalog.pg_constraint con
         JOIN pg_catalog.pg_class c ON c.oid = con.conrelid
         JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace
         JOIN pg_catalog.pg_class fc ON fc.oid = con.confrelid
         JOIN pg_catalog.pg_namespace fn ON fn.oid = fc.relnamespace
         CROSS JOIN LATERAL
           unnest(con.conkey, con.confkey)
           WITH ORDINALITY AS ord(attnum, ref_attnum, ordinality)
         JOIN pg_catalog.pg_attribute a
           ON a.attrelid = c.oid AND a.attnum = ord.attnum
         JOIN pg_catalog.pg_attribute fa
           ON fa.attrelid = fc.oid AND fa.attnum = ord.ref_attnum
         WHERE con.contype = 'f'
           AND n.nspname = $1
           AND c.relname = $2
         ORDER BY con.conname, ord.ordinality",
    )
    .bind(schema)
    .bind(table)
    .fetch_all(pool)
    .await
    .map_err(|error| error.to_string())?;

    type ForeignKeyParts = (Vec<String>, String, String, Vec<String>, String, String);
    let mut grouped: BTreeMap<String, ForeignKeyParts> = BTreeMap::new();
    for row in rows {
        let name: String = row.try_get(0).map_err(|error| error.to_string())?;
        let local: String = row.try_get(1).map_err(|error| error.to_string())?;
        let ref_schema: String = row.try_get(2).map_err(|error| error.to_string())?;
        let ref_table: String = row.try_get(3).map_err(|error| error.to_string())?;
        let referenced: String = row.try_get(4).map_err(|error| error.to_string())?;
        let on_update: String = row.try_get(5).unwrap_or_default();
        let on_delete: String = row.try_get(6).unwrap_or_default();
        let entry = grouped.entry(name).or_insert_with(|| {
            (
                Vec::new(),
                ref_schema,
                ref_table,
                Vec::new(),
                on_update,
                on_delete,
            )
        });
        entry.0.push(local);
        entry.3.push(referenced);
    }

    Ok(grouped
        .into_iter()
        .map(
            |(name, (local, ref_schema, ref_table, referenced, on_update, on_delete))| {
                node(
                    name,
                    "FOREIGN KEY",
                    format!(
                        "({}) → {}.{}({}) · UPDATE {} · DELETE {}",
                        local.join(", "),
                        ref_schema,
                        ref_table,
                        referenced.join(", "),
                        on_update,
                        on_delete
                    ),
                )
            },
        )
        .collect())
}

async fn indexes(pool: &PgPool, schema: &str, table: &str) -> Result<Vec<ObjectNode>, String> {
    let rows = sqlx::query(
        "SELECT indexname, indexdef
         FROM pg_catalog.pg_indexes
         WHERE schemaname = $1 AND tablename = $2
         ORDER BY indexname",
    )
    .bind(schema)
    .bind(table)
    .fetch_all(pool)
    .await
    .map_err(|error| error.to_string())?;

    Ok(rows
        .into_iter()
        .filter_map(|row| {
            Some(node(
                row.try_get(0).ok()?,
                "INDEX",
                row.try_get(1).unwrap_or_default(),
            ))
        })
        .collect())
}
