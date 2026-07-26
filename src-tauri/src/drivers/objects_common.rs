//! Shared helpers for turning information_schema rows into ObjectNodes.
//! Dialect-specific SQL lives under `drivers/{postgres,mysql}/objects.rs`.

use std::collections::BTreeMap;

use sqlx::Row;

use crate::models::{ColumnNode, ObjectGroupDef, ObjectNode};

pub fn group(
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
        object_subgroups: Vec::new(),
    }
}

pub fn build_routines<RRow, PRow>(routine_rows: Vec<RRow>, param_rows: Vec<PRow>) -> Vec<ObjectNode>
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

pub fn trigger_node<R>(row: R) -> Option<ObjectNode>
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
        detail: Some(format!("{timing} {events} on {table}").trim().to_string()),
        children: Vec::new(),
        actions: None,
    })
}
