use std::collections::BTreeMap;

use sqlx::{MySqlPool, Row};

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
    pool: &MySqlPool,
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

async fn keys(pool: &MySqlPool, schema: &str, table: &str) -> Result<Vec<ObjectNode>, String> {
    let rows = sqlx::query(
        "SELECT CAST(tc.CONSTRAINT_NAME AS CHAR),
                CAST(tc.CONSTRAINT_TYPE AS CHAR),
                CAST(kcu.COLUMN_NAME AS CHAR)
         FROM information_schema.TABLE_CONSTRAINTS tc
         JOIN information_schema.KEY_COLUMN_USAGE kcu
           ON tc.CONSTRAINT_SCHEMA = kcu.CONSTRAINT_SCHEMA
          AND tc.CONSTRAINT_NAME = kcu.CONSTRAINT_NAME
          AND tc.TABLE_SCHEMA = kcu.TABLE_SCHEMA
          AND tc.TABLE_NAME = kcu.TABLE_NAME
         WHERE tc.TABLE_SCHEMA = ?
           AND tc.TABLE_NAME = ?
           AND tc.CONSTRAINT_TYPE IN ('PRIMARY KEY', 'UNIQUE')
         ORDER BY CASE tc.CONSTRAINT_TYPE WHEN 'PRIMARY KEY' THEN 0 ELSE 1 END,
                  tc.CONSTRAINT_NAME, kcu.ORDINAL_POSITION",
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

async fn foreign_keys(
    pool: &MySqlPool,
    schema: &str,
    table: &str,
) -> Result<Vec<ObjectNode>, String> {
    let rows = sqlx::query(
        "SELECT CAST(kcu.CONSTRAINT_NAME AS CHAR),
                CAST(kcu.COLUMN_NAME AS CHAR),
                CAST(kcu.REFERENCED_TABLE_SCHEMA AS CHAR),
                CAST(kcu.REFERENCED_TABLE_NAME AS CHAR),
                CAST(kcu.REFERENCED_COLUMN_NAME AS CHAR),
                CAST(rc.UPDATE_RULE AS CHAR),
                CAST(rc.DELETE_RULE AS CHAR)
         FROM information_schema.KEY_COLUMN_USAGE kcu
         JOIN information_schema.REFERENTIAL_CONSTRAINTS rc
           ON kcu.CONSTRAINT_SCHEMA = rc.CONSTRAINT_SCHEMA
          AND kcu.CONSTRAINT_NAME = rc.CONSTRAINT_NAME
         WHERE kcu.TABLE_SCHEMA = ?
           AND kcu.TABLE_NAME = ?
           AND kcu.REFERENCED_TABLE_NAME IS NOT NULL
         ORDER BY kcu.CONSTRAINT_NAME, kcu.ORDINAL_POSITION",
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

async fn indexes(pool: &MySqlPool, schema: &str, table: &str) -> Result<Vec<ObjectNode>, String> {
    let rows = sqlx::query(
        "SELECT CAST(INDEX_NAME AS CHAR),
                CAST(NON_UNIQUE AS SIGNED),
                CAST(INDEX_TYPE AS CHAR),
                CAST(COLUMN_NAME AS CHAR),
                CAST(SUB_PART AS SIGNED),
                CAST(COLLATION AS CHAR)
         FROM information_schema.STATISTICS
         WHERE TABLE_SCHEMA = ? AND TABLE_NAME = ?
         ORDER BY CASE WHEN INDEX_NAME = 'PRIMARY' THEN 0 ELSE 1 END,
                  INDEX_NAME, SEQ_IN_INDEX",
    )
    .bind(schema)
    .bind(table)
    .fetch_all(pool)
    .await
    .map_err(|error| error.to_string())?;

    let mut grouped: BTreeMap<String, (bool, String, Vec<String>)> = BTreeMap::new();
    for row in rows {
        let name: String = row.try_get(0).map_err(|error| error.to_string())?;
        let non_unique: i64 = row.try_get(1).unwrap_or(1);
        let method: String = row.try_get(2).unwrap_or_default();
        let column: String = row.try_get(3).unwrap_or_else(|_| "<expression>".into());
        let sub_part: Option<i64> = row.try_get(4).ok();
        let order: String = row.try_get(5).unwrap_or_default();
        let mut display = match sub_part {
            Some(length) => format!("{column}({length})"),
            None => column,
        };
        if order.eq_ignore_ascii_case("D") {
            display.push_str(" DESC");
        }
        let entry = grouped
            .entry(name)
            .or_insert_with(|| (non_unique == 0, method, Vec::new()));
        entry.2.push(display);
    }

    Ok(grouped
        .into_iter()
        .map(|(name, (unique, method, columns))| {
            let prefix = if unique { "UNIQUE " } else { "" };
            node(
                name,
                "INDEX",
                format!("{prefix}{method} ({})", columns.join(", ")),
            )
        })
        .collect())
}
