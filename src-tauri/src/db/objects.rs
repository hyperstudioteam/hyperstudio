//! Introspection for schema objects other than tables: views, routines,
//! triggers, sequences and events. Each built-in driver declares which of
//! these groups it exposes; the tree renders whatever comes back.

use std::collections::BTreeMap;

use sqlx::{MySqlPool, PgPool, Row};

use crate::db::schema::list_schema_tables;
use crate::db::state::DatabasePool;
use crate::models::{ColumnNode, ObjectGroupDef, ObjectNode};

pub fn postgres_groups() -> Vec<ObjectGroupDef> {
    vec![
        ObjectGroupDef::tables(),
        group("views", "Views", "eye", Some("Columns"), &["viewData"]),
        group("routines", "Routines", "function", Some("Parameters"), &[]),
        group("triggers", "Triggers", "zap", None, &[]),
        group("sequences", "Sequences", "hash", None, &[]),
    ]
}

pub fn mysql_groups() -> Vec<ObjectGroupDef> {
    vec![
        ObjectGroupDef::tables(),
        group("views", "Views", "eye", Some("Columns"), &["viewData"]),
        group("routines", "Routines", "function", Some("Parameters"), &[]),
        group("triggers", "Triggers", "zap", None, &[]),
        group("events", "Events", "clock", None, &[]),
    ]
}

fn group(
    id: &str,
    label: &str,
    icon: &str,
    child_label: Option<&str>,
    actions: &[&str],
) -> ObjectGroupDef {
    ObjectGroupDef {
        id: id.into(),
        label: label.into(),
        icon: Some(icon.into()),
        child_label: child_label.map(Into::into),
        actions: actions.iter().map(|action| (*action).into()).collect(),
        default_open: false,
    }
}

pub async fn list_objects(
    pool: &DatabasePool,
    schema: &str,
    group: &str,
) -> Result<Vec<ObjectNode>, String> {
    let schema = schema.trim();
    if schema.is_empty() {
        return Err("Schema name is required.".into());
    }

    match group {
        "tables" => tables_of_kind(pool, schema, false).await,
        "views" => tables_of_kind(pool, schema, true).await,
        _ => match pool {
            DatabasePool::Postgres(pool) => match group {
                "routines" => postgres_routines(pool, schema).await,
                "triggers" => postgres_triggers(pool, schema).await,
                "sequences" => postgres_sequences(pool, schema).await,
                other => Err(unknown(other)),
            },
            DatabasePool::MySql(pool) => match group {
                "routines" => mysql_routines(pool, schema).await,
                "triggers" => mysql_triggers(pool, schema).await,
                "events" => mysql_events(pool, schema).await,
                other => Err(unknown(other)),
            },
        },
    }
}

fn unknown(group: &str) -> String {
    format!("Unknown object group '{group}'.")
}

/// `information_schema.tables` already covers both, so views are just a
/// filter over the existing table introspection rather than a second query.
async fn tables_of_kind(
    pool: &DatabasePool,
    schema: &str,
    views: bool,
) -> Result<Vec<ObjectNode>, String> {
    Ok(list_schema_tables(pool, schema)
        .await?
        .into_iter()
        .filter(|table| table.kind.to_uppercase().contains("VIEW") == views)
        .map(ObjectNode::from)
        .collect())
}

async fn postgres_routines(pool: &PgPool, schema: &str) -> Result<Vec<ObjectNode>, String> {
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

async fn mysql_routines(pool: &MySqlPool, schema: &str) -> Result<Vec<ObjectNode>, String> {
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

fn build_routines<RRow, PRow>(routine_rows: Vec<RRow>, param_rows: Vec<PRow>) -> Vec<ObjectNode>
where
    RRow: Row,
    usize: sqlx::ColumnIndex<RRow>,
    for<'r> String: sqlx::Decode<'r, RRow::Database> + sqlx::Type<RRow::Database>,
    PRow: Row<Database = RRow::Database>,
    usize: sqlx::ColumnIndex<PRow>,
{
    let mut params: BTreeMap<String, Vec<ColumnNode>> = BTreeMap::new();
    for row in param_rows {
        let Ok(routine) = row.try_get::<String, _>(0) else {
            continue;
        };
        let name: String = row.try_get(1).unwrap_or_default();
        let data_type: String = row.try_get(2).unwrap_or_default();
        let mode: String = row.try_get(3).unwrap_or_default();
        params.entry(routine).or_default().push(ColumnNode {
            name: if name.is_empty() {
                "return".into()
            } else {
                name
            },
            data_type: if mode.is_empty() {
                data_type
            } else {
                format!("{} {data_type}", mode.to_uppercase())
            },
            nullable: true,
            primary_key: false,
        });
    }

    routine_rows
        .into_iter()
        .filter_map(|row| {
            let name: String = row.try_get(0).ok()?;
            let kind: String = row.try_get(1).unwrap_or_default();
            let returns: String = row.try_get(2).unwrap_or_default();
            let children = params.remove(&name).unwrap_or_default();
            Some(ObjectNode {
                detail: (!returns.is_empty()).then(|| format!("→ {returns}")),
                name,
                kind: kind.to_uppercase(),
                children,
                actions: None,
            })
        })
        .collect()
}

async fn postgres_triggers(pool: &PgPool, schema: &str) -> Result<Vec<ObjectNode>, String> {
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

async fn mysql_triggers(pool: &MySqlPool, schema: &str) -> Result<Vec<ObjectNode>, String> {
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

fn trigger_node<R>(row: R) -> Option<ObjectNode>
where
    R: Row,
    usize: sqlx::ColumnIndex<R>,
    for<'r> String: sqlx::Decode<'r, R::Database> + sqlx::Type<R::Database>,
{
    let name: String = row.try_get(0).ok()?;
    let table: String = row.try_get(1).unwrap_or_default();
    let timing: String = row.try_get(2).unwrap_or_default();
    let events: String = row.try_get(3).unwrap_or_default();
    Some(ObjectNode {
        name,
        kind: "TRIGGER".into(),
        detail: Some(
            format!("{timing} {events} on {table}")
                .trim()
                .to_string(),
        ),
        children: Vec::new(),
        actions: None,
    })
}

async fn postgres_sequences(pool: &PgPool, schema: &str) -> Result<Vec<ObjectNode>, String> {
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

async fn mysql_events(pool: &MySqlPool, schema: &str) -> Result<Vec<ObjectNode>, String> {
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
