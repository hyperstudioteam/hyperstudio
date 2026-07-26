use sqlx::PgPool;

use crate::models::{
    AlterColumnRequest, AlterKeyRequest, AlterTableRequest, TableColumnChange, TableIndexChange,
    TableKeyChange,
};

fn quote_ident(name: &str) -> String {
    format!("\"{}\"", name.replace('"', "\"\""))
}

fn qualify(schema: &str, table: &str) -> String {
    format!("{}.{}", quote_ident(schema), quote_ident(table))
}

fn require_ident(label: &str, value: &str) -> Result<String, String> {
    let trimmed = value.trim();
    if trimmed.is_empty() {
        return Err(format!("{label} is required."));
    }
    Ok(trimmed.to_string())
}

fn sql_string(value: &str) -> String {
    format!("'{}'", value.replace('\'', "''"))
}

async fn exec(pool: &PgPool, sql: &str) -> Result<(), String> {
    sqlx::query(sql)
        .execute(pool)
        .await
        .map_err(|error| error.to_string())?;
    Ok(())
}

pub async fn alter_table(pool: &PgPool, request: AlterTableRequest) -> Result<(), String> {
    let schema = require_ident("Schema", &request.schema)?;
    let table = require_ident("Table", &request.table)?;

    if request.columns.is_empty()
        && request.keys.is_empty()
        && request.indexes.is_empty()
        && request
            .new_name
            .as_deref()
            .map(str::trim)
            .filter(|name| !name.is_empty())
            .is_none()
    {
        return Err("No table changes provided.".into());
    }

    for change in request
        .keys
        .iter()
        .filter(|change| change.action.eq_ignore_ascii_case("drop"))
    {
        apply_key_change(pool, &schema, &table, change).await?;
    }
    for change in request
        .indexes
        .iter()
        .filter(|change| change.action.eq_ignore_ascii_case("drop"))
    {
        apply_index_change(pool, &schema, &table, change).await?;
    }
    for change in &request.columns {
        apply_column_change(pool, &schema, &table, change).await?;
    }
    for change in request
        .keys
        .iter()
        .filter(|change| !change.action.eq_ignore_ascii_case("drop"))
    {
        apply_key_change(pool, &schema, &table, change).await?;
    }
    for change in request
        .indexes
        .iter()
        .filter(|change| !change.action.eq_ignore_ascii_case("drop"))
    {
        apply_index_change(pool, &schema, &table, change).await?;
    }

    if let Some(new_name) = request
        .new_name
        .as_deref()
        .map(str::trim)
        .filter(|name| !name.is_empty())
    {
        if new_name != table {
            let sql = format!(
                "ALTER TABLE {} RENAME TO {}",
                qualify(&schema, &table),
                quote_ident(new_name)
            );
            exec(pool, &sql).await?;
        }
    }

    Ok(())
}

async fn apply_key_change(
    pool: &PgPool,
    schema: &str,
    table: &str,
    change: &TableKeyChange,
) -> Result<(), String> {
    alter_key(
        pool,
        AlterKeyRequest {
            schema: schema.into(),
            table: table.into(),
            name: change.name.clone(),
            new_name: change.new_name.clone(),
            kind: Some(change.kind.clone()),
            columns: Some(change.columns.clone()),
            drop: change.action.eq_ignore_ascii_case("drop"),
        },
    )
    .await
}

async fn apply_index_change(
    pool: &PgPool,
    schema: &str,
    table: &str,
    change: &TableIndexChange,
) -> Result<(), String> {
    let target = qualify(schema, table);
    let action = change.action.trim().to_ascii_lowercase();
    let existing = change
        .name
        .as_deref()
        .map(str::trim)
        .filter(|name| !name.is_empty());
    let next_name = change
        .new_name
        .as_deref()
        .map(str::trim)
        .filter(|name| !name.is_empty())
        .or(existing);

    if action == "drop" {
        let name = require_ident("Index name", existing.unwrap_or(""))?;
        return exec(
            pool,
            &format!(
                "DROP INDEX {}.{}",
                quote_ident(schema),
                quote_ident(&name)
            ),
        )
        .await;
    }

    if action == "modify"
        && existing.is_some()
        && change.columns.is_empty()
        && change.method.is_none()
        && change.new_name.as_deref().is_some_and(|name| Some(name.trim()) != existing)
    {
        let old_name = existing.unwrap();
        let new_name = require_ident("New index name", next_name.unwrap_or(""))?;
        return exec(
            pool,
            &format!(
                "ALTER INDEX {}.{} RENAME TO {}",
                quote_ident(schema),
                quote_ident(old_name),
                quote_ident(&new_name)
            ),
        )
        .await;
    }

    if action == "modify" {
        let name = require_ident("Index name", existing.unwrap_or(""))?;
        exec(
            pool,
            &format!(
                "DROP INDEX {}.{}",
                quote_ident(schema),
                quote_ident(&name)
            ),
        )
        .await?;
    } else if action != "add" {
        return Err(format!("Unknown index action '{action}'."));
    }

    let name = require_ident("Index name", next_name.unwrap_or(""))?;
    if change.columns.is_empty() {
        return Err("At least one column is required for an index.".into());
    }
    let columns = change
        .columns
        .iter()
        .map(|column| quote_ident(column.trim()))
        .collect::<Vec<_>>()
        .join(", ");
    let unique = if change.unique { "UNIQUE " } else { "" };
    let method = change
        .method
        .as_deref()
        .map(str::trim)
        .filter(|method| !method.is_empty())
        .unwrap_or("btree");
    exec(
        pool,
        &format!(
            "CREATE {unique}INDEX {} ON {target} USING {method} ({columns})",
            quote_ident(&name)
        ),
    )
    .await
}

async fn apply_column_change(
    pool: &PgPool,
    schema: &str,
    table: &str,
    change: &TableColumnChange,
) -> Result<(), String> {
    let target = qualify(schema, table);
    let action = change.action.trim().to_ascii_lowercase();
    match action.as_str() {
        "drop" => {
            let name = require_ident("Column", &change.name)?;
            let sql = format!("ALTER TABLE {target} DROP COLUMN {}", quote_ident(&name));
            exec(pool, &sql).await
        }
        "add" => {
            let name = require_ident(
                "Column",
                change
                    .new_name
                    .as_deref()
                    .filter(|value| !value.trim().is_empty())
                    .unwrap_or(&change.name),
            )?;
            let data_type = change
                .data_type
                .as_deref()
                .map(str::trim)
                .filter(|value| !value.is_empty())
                .ok_or_else(|| "Data type is required when adding a column.".to_string())?;
            let mut sql = format!(
                "ALTER TABLE {target} ADD COLUMN {} {data_type}",
                quote_ident(&name)
            );
            if change.nullable == Some(false) {
                sql.push_str(" NOT NULL");
            }
            if let Some(default_value) = change
                .default_value
                .as_deref()
                .map(str::trim)
                .filter(|value| !value.is_empty())
            {
                sql.push_str(" DEFAULT ");
                sql.push_str(default_value);
            }
            exec(pool, &sql).await?;
            if let Some(comment) = change.comment.as_deref() {
                let sql = format!(
                    "COMMENT ON COLUMN {target}.{} IS {}",
                    quote_ident(&name),
                    sql_string(comment)
                );
                exec(pool, &sql).await?;
            }
            Ok(())
        }
        "modify" => {
            alter_column(
                pool,
                AlterColumnRequest {
                    schema: schema.into(),
                    table: table.into(),
                    column: change.name.clone(),
                    new_name: change.new_name.clone(),
                    data_type: change.data_type.clone(),
                    nullable: change.nullable,
                    default_value: change.default_value.clone(),
                    clear_default: change.clear_default,
                    comment: change.comment.clone(),
                    auto_increment: None,
                    on_update: None,
                    collation: None,
                },
            )
            .await
        }
        other => Err(format!("Unknown column action '{other}'.")),
    }
}

pub async fn alter_column(pool: &PgPool, request: AlterColumnRequest) -> Result<(), String> {
    let schema = require_ident("Schema", &request.schema)?;
    let table = require_ident("Table", &request.table)?;
    let column = require_ident("Column", &request.column)?;
    let target = qualify(&schema, &table);
    let col = quote_ident(&column);
    let mut statements = Vec::new();

    if let Some(new_name) = request
        .new_name
        .as_deref()
        .map(str::trim)
        .filter(|name| !name.is_empty())
    {
        if new_name != column {
            statements.push(format!(
                "ALTER TABLE {target} RENAME COLUMN {col} TO {}",
                quote_ident(new_name)
            ));
        }
    }

    let current_name = request
        .new_name
        .as_deref()
        .map(str::trim)
        .filter(|name| !name.is_empty())
        .unwrap_or(column.as_str());
    let current_col = quote_ident(current_name);

    if let Some(data_type) = request
        .data_type
        .as_deref()
        .map(str::trim)
        .filter(|value| !value.is_empty())
    {
        statements.push(format!(
            "ALTER TABLE {target} ALTER COLUMN {current_col} TYPE {data_type}"
        ));
    }

    if let Some(nullable) = request.nullable {
        if nullable {
            statements.push(format!(
                "ALTER TABLE {target} ALTER COLUMN {current_col} DROP NOT NULL"
            ));
        } else {
            statements.push(format!(
                "ALTER TABLE {target} ALTER COLUMN {current_col} SET NOT NULL"
            ));
        }
    }

    if request.clear_default {
        statements.push(format!(
            "ALTER TABLE {target} ALTER COLUMN {current_col} DROP DEFAULT"
        ));
    } else if let Some(default_value) = request
        .default_value
        .as_deref()
        .map(str::trim)
        .filter(|value| !value.is_empty())
    {
        statements.push(format!(
            "ALTER TABLE {target} ALTER COLUMN {current_col} SET DEFAULT {default_value}"
        ));
    }

    if let Some(comment) = &request.comment {
        statements.push(format!(
            "COMMENT ON COLUMN {target}.{current_col} IS {}",
            sql_string(comment)
        ));
    }

    if statements.is_empty() {
        return Err("No column changes provided.".into());
    }

    for sql in statements {
        exec(pool, &sql).await?;
    }
    Ok(())
}

pub async fn alter_key(pool: &PgPool, request: AlterKeyRequest) -> Result<(), String> {
    let schema = require_ident("Schema", &request.schema)?;
    let table = require_ident("Table", &request.table)?;
    let target = qualify(&schema, &table);

    if request.drop {
        let name = require_ident(
            "Key name",
            request.name.as_deref().unwrap_or(""),
        )?;
        let sql = format!(
            "ALTER TABLE {target} DROP CONSTRAINT {}",
            quote_ident(&name)
        );
        return exec(pool, &sql).await;
    }

    let columns = request
        .columns
        .as_ref()
        .map(|cols| {
            cols.iter()
                .map(|col| col.trim().to_string())
                .filter(|col| !col.is_empty())
                .collect::<Vec<_>>()
        })
        .unwrap_or_default();

    let kind = request
        .kind
        .as_deref()
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .map(|value| value.to_uppercase());

    let existing = request
        .name
        .as_deref()
        .map(str::trim)
        .filter(|name| !name.is_empty())
        .map(|name| name.to_string());

    let new_name = request
        .new_name
        .as_deref()
        .map(str::trim)
        .filter(|name| !name.is_empty())
        .map(|name| name.to_string());

    if let (Some(old_name), Some(new_name)) = (&existing, &new_name) {
        if columns.is_empty() && kind.is_none() {
            if old_name == new_name {
                return Err("New key name is the same as the current name.".into());
            }
            let sql = format!(
                "ALTER TABLE {target} RENAME CONSTRAINT {} TO {}",
                quote_ident(old_name),
                quote_ident(new_name)
            );
            return exec(pool, &sql).await;
        }
    }

    if let Some(old_name) = &existing {
        let sql = format!(
            "ALTER TABLE {target} DROP CONSTRAINT {}",
            quote_ident(old_name)
        );
        exec(pool, &sql).await?;
    }

    if columns.is_empty() {
        return Err("At least one column is required for a key.".into());
    }

    let kind = kind.unwrap_or_else(|| "UNIQUE".into());
    let kind = match kind.as_str() {
        "PRIMARY KEY" | "PRIMARY" | "PK" => "PRIMARY KEY",
        "UNIQUE" | "UQ" => "UNIQUE",
        other => {
            return Err(format!(
                "Unsupported key kind '{other}'. Use PRIMARY KEY or UNIQUE."
            ));
        }
    };

    let cols = columns
        .iter()
        .map(|col| quote_ident(col))
        .collect::<Vec<_>>()
        .join(", ");

    let constraint_name = new_name.or(existing);
    let sql = if let Some(name) = constraint_name {
        format!(
            "ALTER TABLE {target} ADD CONSTRAINT {} {kind} ({cols})",
            quote_ident(&name)
        )
    } else {
        format!("ALTER TABLE {target} ADD {kind} ({cols})")
    };
    exec(pool, &sql).await
}
