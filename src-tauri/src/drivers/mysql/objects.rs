//! MySQL introspection for non-table schema objects.

use sqlx::MySqlPool;

use crate::drivers::objects_common::{build_routines, group, trigger_node};
use crate::models::{ObjectGroupDef, ObjectNode};

pub fn groups() -> Vec<ObjectGroupDef> {
    vec![
        ObjectGroupDef::database_tables(),
        group("views", "Views", "eye", Some("Columns"), &["viewData"]),
        group("routines", "Routines", "function", Some("Parameters"), &[]),
        group("triggers", "Triggers", "zap", None, &[]),
        group("events", "Events", "clock", None, &[]),
    ]
}

pub async fn list(pool: &MySqlPool, schema: &str, group: &str) -> Result<Vec<ObjectNode>, String> {
    match group {
        "routines" => routines(pool, schema).await,
        "triggers" => triggers(pool, schema).await,
        "events" => events(pool, schema).await,
        other => Err(format!("Unknown object group '{other}'.")),
    }
}

async fn routines(pool: &MySqlPool, schema: &str) -> Result<Vec<ObjectNode>, String> {
    let rows = sqlx::query(
        "SELECT CAST(ROUTINE_NAME AS CHAR),
                CAST(ROUTINE_TYPE AS CHAR),
                CAST(COALESCE(DTD_IDENTIFIER, '') AS CHAR)
         FROM information_schema.ROUTINES
         WHERE ROUTINE_SCHEMA = ?
         ORDER BY ROUTINE_NAME",
    )
    .bind(schema)
    .fetch_all(pool)
    .await
    .map_err(|error| error.to_string())?;

    let param_rows = sqlx::query(
        "SELECT CAST(SPECIFIC_NAME AS CHAR),
                CAST(COALESCE(PARAMETER_NAME, '') AS CHAR),
                CAST(DTD_IDENTIFIER AS CHAR),
                CAST(COALESCE(PARAMETER_MODE, '') AS CHAR)
         FROM information_schema.PARAMETERS
         WHERE SPECIFIC_SCHEMA = ?
         ORDER BY SPECIFIC_NAME, ORDINAL_POSITION",
    )
    .bind(schema)
    .fetch_all(pool)
    .await
    .unwrap_or_default();

    Ok(build_routines(rows, param_rows))
}

async fn triggers(pool: &MySqlPool, schema: &str) -> Result<Vec<ObjectNode>, String> {
    let rows = sqlx::query(
        "SELECT CAST(TRIGGER_NAME AS CHAR),
                CAST(EVENT_OBJECT_TABLE AS CHAR),
                CAST(ACTION_TIMING AS CHAR),
                CAST(EVENT_MANIPULATION AS CHAR)
         FROM information_schema.TRIGGERS
         WHERE TRIGGER_SCHEMA = ?
         ORDER BY TRIGGER_NAME",
    )
    .bind(schema)
    .fetch_all(pool)
    .await
    .map_err(|error| error.to_string())?;

    Ok(rows.into_iter().filter_map(trigger_node).collect())
}

async fn events(pool: &MySqlPool, schema: &str) -> Result<Vec<ObjectNode>, String> {
    let rows = sqlx::query(
        "SELECT CAST(EVENT_NAME AS CHAR),
                CAST(EVENT_TYPE AS CHAR),
                CAST(STATUS AS CHAR)
         FROM information_schema.EVENTS
         WHERE EVENT_SCHEMA = ?
         ORDER BY EVENT_NAME",
    )
    .bind(schema)
    .fetch_all(pool)
    .await
    .map_err(|error| error.to_string())?;

    Ok(rows
        .into_iter()
        .filter_map(|row| {
            use sqlx::Row;
            let kind: String = row.try_get(1).unwrap_or_default();
            let status: String = row.try_get(2).unwrap_or_default();
            Some(ObjectNode {
                name: row.try_get(0).ok()?,
                kind: "EVENT".into(),
                detail: Some(format!("{kind} · {status}").trim().to_string()),
                children: Vec::new(),
                actions: None,
            })
        })
        .collect())
}
