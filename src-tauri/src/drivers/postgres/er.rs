//! Schema-wide table + foreign-key graph for the ER diagram.

use std::collections::BTreeMap;

use sqlx::{PgPool, Row};

use crate::models::{ErColumn, ErDiagram, ErEdge, ErTable};

pub async fn diagram(pool: &PgPool, schema: &str) -> Result<ErDiagram, String> {
    let tables = tables(pool, schema).await?;
    let edges = edges(pool, schema).await?;
    Ok(ErDiagram {
        schema: schema.to_string(),
        tables,
        edges,
    })
}

async fn tables(pool: &PgPool, schema: &str) -> Result<Vec<ErTable>, String> {
    let rows = sqlx::query(
        "SELECT c.relname,
                a.attname,
                pg_catalog.format_type(a.atttypid, a.atttypmod),
                COALESCE(
                  (
                    SELECT true
                    FROM pg_catalog.pg_index i
                    WHERE i.indrelid = c.oid
                      AND i.indisprimary
                      AND a.attnum = ANY (i.indkey)
                  ),
                  false
                )
         FROM pg_catalog.pg_class c
         JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace
         JOIN pg_catalog.pg_attribute a ON a.attrelid = c.oid
         WHERE n.nspname = $1
           AND c.relkind IN ('r', 'p')
           AND a.attnum > 0
           AND NOT a.attisdropped
         ORDER BY c.relname, a.attnum",
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
        let primary_key: bool = row.try_get(3).unwrap_or(false);
        grouped.entry(table).or_default().push(ErColumn {
            name,
            data_type,
            primary_key,
        });
    }

    Ok(grouped
        .into_iter()
        .map(|(name, columns)| ErTable { name, columns })
        .collect())
}

async fn edges(pool: &PgPool, schema: &str) -> Result<Vec<ErEdge>, String> {
    let rows = sqlx::query(
        "SELECT con.conname,
                c.relname,
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
         ORDER BY con.conname, ord.ordinality",
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
