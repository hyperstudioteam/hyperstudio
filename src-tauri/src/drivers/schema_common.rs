use std::collections::BTreeMap;

use sqlx::Row;

use crate::models::{ColumnNode, SchemaNode, TableNode};

pub fn build_schema_tree<TRow, CRow>(
    table_rows: Vec<TRow>,
    column_rows: Vec<CRow>,
) -> Result<Vec<SchemaNode>, String>
where
    TRow: Row,
    usize: sqlx::ColumnIndex<TRow>,
    for<'r> String: sqlx::Decode<'r, TRow::Database> + sqlx::Type<TRow::Database>,
    CRow: Row<Database = TRow::Database>,
    usize: sqlx::ColumnIndex<CRow>,
{
    let mut tables: BTreeMap<(String, String), TableNode> = BTreeMap::new();
    for row in table_rows {
        let schema: String = row.try_get(0).map_err(|error| error.to_string())?;
        let name: String = row.try_get(1).map_err(|error| error.to_string())?;
        let kind: String = row.try_get(2).map_err(|error| error.to_string())?;
        tables.insert(
            (schema, name.clone()),
            TableNode {
                name,
                kind,
                columns: Vec::new(),
            },
        );
    }

    for row in column_rows {
        let schema: String = row.try_get(0).map_err(|error| error.to_string())?;
        let table: String = row.try_get(1).map_err(|error| error.to_string())?;
        if let Some(node) = tables.get_mut(&(schema, table)) {
            let nullable: String = row.try_get(4).map_err(|error| error.to_string())?;
            let primary: String = row.try_get(5).unwrap_or_else(|_| "NO".into());
            node.columns.push(ColumnNode {
                name: row.try_get(2).map_err(|error| error.to_string())?,
                data_type: row.try_get(3).map_err(|error| error.to_string())?,
                nullable: nullable.eq_ignore_ascii_case("YES"),
                primary_key: primary.eq_ignore_ascii_case("YES")
                    || primary.eq_ignore_ascii_case("PRI"),
            });
        }
    }

    let mut schemas: BTreeMap<String, Vec<TableNode>> = BTreeMap::new();
    for ((schema, _), table) in tables {
        schemas.entry(schema).or_default().push(table);
    }
    Ok(schemas
        .into_iter()
        .map(|(name, tables)| SchemaNode { name, tables })
        .collect())
}
