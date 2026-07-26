//! Schema-wide table + foreign-key graph for the ER diagram.

use std::collections::BTreeMap;

use sqlx::{MySqlPool, Row};

use crate::models::{ErColumn, ErDiagram, ErEdge, ErTable};

pub async fn diagram(pool: &MySqlPool, schema: &str) -> Result<ErDiagram, String> {
    let tables = tables(pool, schema).await?;
    let edges = edges(pool, schema).await?;
    Ok(ErDiagram {
        schema: schema.to_string(),
        tables,
        edges,
    })
}

async fn tables(pool: &MySqlPool, schema: &str) -> Result<Vec<ErTable>, String> {
    let rows = sqlx::query(
        "SELECT CAST(c.TABLE_NAME AS CHAR),
                CAST(c.COLUMN_NAME AS CHAR),
                CAST(c.COLUMN_TYPE AS CHAR),
                CASE WHEN c.COLUMN_KEY = 'PRI' THEN 1 ELSE 0 END
         FROM information_schema.COLUMNS c
         JOIN information_schema.TABLES t
           ON t.TABLE_SCHEMA = c.TABLE_SCHEMA
          AND t.TABLE_NAME = c.TABLE_NAME
         WHERE c.TABLE_SCHEMA = ?
           AND t.TABLE_TYPE = 'BASE TABLE'
         ORDER BY c.TABLE_NAME, c.ORDINAL_POSITION",
    )
    .bind(schema)
    .fetch_all(pool)
    .await
    .map_err(|error| error.to_string())?;

    let mut grouped: BTreeMap<String, Vec<ErColumn>> = BTreeMap::new();
    for row in rows {
        let table: String = row.try_get(0).map_err(|error| error.to_string())?;
        let name: String = row.try_get(1).map_err(|error| error.to_string())?;
        let data_type: String = row.try_get(2).map_err(|error| error.to_string())?;
        let primary_key: i64 = row.try_get(3).unwrap_or(0);
        grouped.entry(table).or_default().push(ErColumn {
            name,
            data_type,
            primary_key: primary_key != 0,
        });
    }

    Ok(grouped
        .into_iter()
        .map(|(name, columns)| ErTable { name, columns })
        .collect())
}

async fn edges(pool: &MySqlPool, schema: &str) -> Result<Vec<ErEdge>, String> {
    let rows = sqlx::query(
        "SELECT CAST(kcu.CONSTRAINT_NAME AS CHAR),
                CAST(kcu.TABLE_NAME AS CHAR),
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
           AND kcu.REFERENCED_TABLE_NAME IS NOT NULL
         ORDER BY kcu.CONSTRAINT_NAME, kcu.ORDINAL_POSITION",
    )
    .bind(schema)
    .fetch_all(pool)
    .await
    .map_err(|error| error.to_string())?;

    type Parts = (String, Vec<String>, String, String, Vec<String>, String, String);
    let mut grouped: BTreeMap<String, Parts> = BTreeMap::new();
    for row in rows {
        let name: String = row.try_get(0).map_err(|error| error.to_string())?;
        let from_table: String = row.try_get(1).map_err(|error| error.to_string())?;
        let from_col: String = row.try_get(2).map_err(|error| error.to_string())?;
        let to_schema: String = row.try_get(3).map_err(|error| error.to_string())?;
        let to_table: String = row.try_get(4).map_err(|error| error.to_string())?;
        let to_col: String = row.try_get(5).map_err(|error| error.to_string())?;
        let on_update: String = row.try_get(6).unwrap_or_default();
        let on_delete: String = row.try_get(7).unwrap_or_default();
        let entry = grouped.entry(name.clone()).or_insert_with(|| {
            (
                from_table,
                Vec::new(),
                to_schema,
                to_table,
                Vec::new(),
                on_update,
                on_delete,
            )
        });
        entry.1.push(from_col);
        entry.4.push(to_col);
    }

    Ok(grouped
        .into_iter()
        .map(
            |(
                name,
                (from_table, from_columns, to_schema, to_table, to_columns, on_update, on_delete),
            )| ErEdge {
                name,
                from_table,
                from_columns,
                to_schema,
                to_table,
                to_columns,
                on_update,
                on_delete,
            },
        )
        .collect())
}
