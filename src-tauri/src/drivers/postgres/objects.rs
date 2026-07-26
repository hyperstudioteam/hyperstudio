//! PostgreSQL introspection for non-table schema objects.

use sqlx::PgPool;

use crate::drivers::objects_common::{build_routines, group, trigger_node};
use crate::models::{ObjectGroupDef, ObjectNode};

pub fn groups() -> Vec<ObjectGroupDef> {
    vec![
        ObjectGroupDef::database_tables(),
        group("views", "Views", "eye", Some("Columns"), &["viewData"]),
        group("routines", "Routines", "function", Some("Parameters"), &[]),
        group("triggers", "Triggers", "zap", None, &[]),
        group("sequences", "Sequences", "hash", None, &[]),
    ]
}

pub async fn list(pool: &PgPool, schema: &str, group: &str) -> Result<Vec<ObjectNode>, String> {
    match group {
        "routines" => routines(pool, schema).await,
        "triggers" => triggers(pool, schema).await,
        "sequences" => sequences(pool, schema).await,
        other => Err(format!("Unknown object group '{other}'.")),
    }
}

async fn routines(pool: &PgPool, schema: &str) -> Result<Vec<ObjectNode>, String> {
    let rows = sqlx::query(
        "SELECT routine_name, routine_type, COALESCE(data_type, '')
         FROM information_schema.routines
         WHERE routine_schema = $1
         ORDER BY routine_name",
    )
    .bind(schema)
    .fetch_all(pool)
    .await
    .map_err(|error| error.to_string())?;

    let param_rows = sqlx::query(
        "SELECT r.routine_name,
                COALESCE(p.parameter_name, ''),
                p.data_type,
                COALESCE(p.parameter_mode, '')
         FROM information_schema.routines r
         JOIN information_schema.parameters p
           ON p.specific_schema = r.specific_schema
          AND p.specific_name = r.specific_name
         WHERE r.routine_schema = $1
         ORDER BY r.routine_name, p.ordinal_position",
    )
    .bind(schema)
    .fetch_all(pool)
    .await
    .unwrap_or_default();

    Ok(build_routines(rows, param_rows))
}

async fn triggers(pool: &PgPool, schema: &str) -> Result<Vec<ObjectNode>, String> {
    let rows = sqlx::query(
        "SELECT trigger_name,
                event_object_table,
                action_timing,
                string_agg(event_manipulation, ', ' ORDER BY event_manipulation)
         FROM information_schema.triggers
         WHERE trigger_schema = $1
         GROUP BY trigger_name, event_object_table, action_timing
         ORDER BY trigger_name",
    )
    .bind(schema)
    .fetch_all(pool)
    .await
    .map_err(|error| error.to_string())?;

    Ok(rows.into_iter().filter_map(trigger_node).collect())
}

async fn sequences(pool: &PgPool, schema: &str) -> Result<Vec<ObjectNode>, String> {
    let rows = sqlx::query(
        "SELECT sequence_name, data_type
         FROM information_schema.sequences
         WHERE sequence_schema = $1
         ORDER BY sequence_name",
    )
    .bind(schema)
    .fetch_all(pool)
    .await
    .map_err(|error| error.to_string())?;

    Ok(rows
        .into_iter()
        .filter_map(|row| {
            use sqlx::Row;
            Some(ObjectNode {
                name: row.try_get(0).ok()?,
                kind: "SEQUENCE".into(),
                detail: row.try_get::<String, _>(1).ok(),
                children: Vec::new(),
                actions: None,
            })
        })
        .collect())
}
