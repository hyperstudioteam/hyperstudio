use sqlx::{MySqlPool, Row};

use crate::models::{
    AlterColumnRequest, AlterKeyRequest, AlterTableRequest, TableColumnChange, TableIndexChange,
    TableKeyChange,
};

fn quote_ident(name: &str) -> String {
    format!("`{}`", name.replace('`', "``"))
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

async fn exec(pool: &MySqlPool, sql: &str) -> Result<(), String> {
    sqlx::query(sql)
        .execute(pool)
        .await
        .map_err(|error| error.to_string())?;
    Ok(())
}

pub async fn alter_table(pool: &MySqlPool, request: AlterTableRequest) -> Result<(), String> {
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
                "RENAME TABLE {} TO {}",
                qualify(&schema, &table),
                qualify(&schema, new_name)
            );
            exec(pool, &sql).await?;
        }
    }

    Ok(())
}

async fn apply_key_change(
    pool: &MySqlPool,
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
    pool: &MySqlPool,
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
            &format!("ALTER TABLE {target} DROP INDEX {}", quote_ident(&name)),
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
                "ALTER TABLE {target} RENAME INDEX {} TO {}",
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
            &format!("ALTER TABLE {target} DROP INDEX {}", quote_ident(&name)),
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
    let method = change
        .method
        .as_deref()
        .map(str::trim)
        .filter(|method| !method.is_empty())
        .unwrap_or("BTREE")
        .to_ascii_uppercase();
    let definition = match method.as_str() {
        "FULLTEXT" | "SPATIAL" => format!(
            "{method} INDEX {} ({columns})",
            quote_ident(&name)
        ),
        _ => {
            let unique = if change.unique { "UNIQUE " } else { "" };
            format!(
                "{unique}INDEX {} USING {method} ({columns})",
                quote_ident(&name)
            )
        }
    };
    exec(
        pool,
        &format!("ALTER TABLE {target} ADD {definition}"),
    )
    .await
}

async fn apply_column_change(
    pool: &MySqlPool,
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
            let definition = column_definition(data_type, change, None)?;
            let sql = format!(
                "ALTER TABLE {target} ADD COLUMN {} {definition}",
                quote_ident(&name)
            );
            exec(pool, &sql).await
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
                    auto_increment: change.auto_increment,
                    on_update: change.on_update.clone(),
                    collation: change.collation.clone(),
                },
            )
            .await
        }
        other => Err(format!("Unknown column action '{other}'.")),
    }
}

struct ColumnMeta {
    data_type: String,
    nullable: bool,
    default_value: Option<String>,
    comment: Option<String>,
    auto_increment: bool,
    extra: String,
    collation: Option<String>,
}

async fn column_meta(
    pool: &MySqlPool,
    schema: &str,
    table: &str,
    column: &str,
) -> Result<ColumnMeta, String> {
    let row = sqlx::query(
        "SELECT CAST(COLUMN_TYPE AS CHAR),
                CAST(IS_NULLABLE AS CHAR),
                CAST(COLUMN_DEFAULT AS CHAR),
                CAST(COLUMN_COMMENT AS CHAR),
                CAST(EXTRA AS CHAR),
                CAST(COLLATION_NAME AS CHAR)
         FROM information_schema.COLUMNS
         WHERE TABLE_SCHEMA = ? AND TABLE_NAME = ? AND COLUMN_NAME = ?",
    )
    .bind(schema)
    .bind(table)
    .bind(column)
    .fetch_optional(pool)
    .await
    .map_err(|error| error.to_string())?
    .ok_or_else(|| format!("Column '{column}' not found on {schema}.{table}."))?;

    let data_type: String = row.try_get(0).map_err(|error| error.to_string())?;
    let nullable: String = row.try_get(1).map_err(|error| error.to_string())?;
    let default_value: Option<String> = row.try_get(2).ok().flatten();
    let comment: Option<String> = row.try_get(3).ok().flatten();
    let extra: String = row.try_get(4).unwrap_or_default();
    let collation: Option<String> = row.try_get(5).ok().flatten();
    Ok(ColumnMeta {
        data_type,
        nullable: nullable.eq_ignore_ascii_case("YES"),
        default_value: default_value.filter(|value| !value.is_empty()),
        comment: comment.filter(|value| !value.is_empty()),
        auto_increment: extra.to_ascii_lowercase().contains("auto_increment"),
        extra,
        collation: collation.filter(|value| !value.is_empty()),
    })
}

fn column_definition(
    data_type: &str,
    change: &TableColumnChange,
    existing: Option<&ColumnMeta>,
) -> Result<String, String> {
    let nullable = change
        .nullable
        .unwrap_or_else(|| existing.map(|meta| meta.nullable).unwrap_or(true));
    let null_sql = if nullable { "NULL" } else { "NOT NULL" };

    let mut parts = vec![data_type.to_string(), null_sql.to_string()];

    let collation = change
        .collation
        .as_deref()
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .or_else(|| existing.and_then(|meta| meta.collation.as_deref()));
    if let Some(collation) = collation {
        parts.insert(1, format!("COLLATE {collation}"));
    }

    if change.clear_default {
        // omit DEFAULT
    } else if let Some(default_value) = change
        .default_value
        .as_deref()
        .map(str::trim)
        .filter(|value| !value.is_empty())
    {
        parts.push(format!("DEFAULT {default_value}"));
    } else if change.default_value.is_none() {
        if let Some(existing) = existing.and_then(|meta| meta.default_value.as_deref()) {
            parts.push(format!("DEFAULT {existing}"));
        }
    }

    if let Some(on_update) = change
        .on_update
        .as_deref()
        .map(str::trim)
        .filter(|value| !value.is_empty())
    {
        parts.push(format!("ON UPDATE {on_update}"));
    } else if let Some(existing) = existing {
        let lower = existing.extra.to_ascii_lowercase();
        if let Some(idx) = lower.find("on update ") {
            parts.push(existing.extra[idx..].to_string());
        }
    }

    let auto_increment = change
        .auto_increment
        .unwrap_or_else(|| existing.map(|meta| meta.auto_increment).unwrap_or(false));
    if auto_increment {
        parts.push("AUTO_INCREMENT".into());
    }

    if let Some(comment) = change.comment.as_deref() {
        parts.push(format!("COMMENT {}", sql_string(comment)));
    } else if change.comment.is_none() {
        if let Some(existing) = existing.and_then(|meta| meta.comment.as_deref()) {
            parts.push(format!("COMMENT {}", sql_string(existing)));
        }
    }

    Ok(parts.join(" "))
}

pub async fn alter_column(pool: &MySqlPool, request: AlterColumnRequest) -> Result<(), String> {
    let schema = require_ident("Schema", &request.schema)?;
    let table = require_ident("Table", &request.table)?;
    let column = require_ident("Column", &request.column)?;
    let target = qualify(&schema, &table);
    let meta = column_meta(pool, &schema, &table, &column).await?;

    let new_name = request
        .new_name
        .as_deref()
        .map(str::trim)
        .filter(|name| !name.is_empty())
        .unwrap_or(column.as_str());
    let data_type = request
        .data_type
        .as_deref()
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .unwrap_or(meta.data_type.as_str());

    let change = TableColumnChange {
        action: "modify".into(),
        name: column.clone(),
        new_name: Some(new_name.into()),
        data_type: Some(data_type.into()),
        nullable: request.nullable,
        default_value: request.default_value.clone(),
        clear_default: request.clear_default,
        comment: request.comment.clone(),
        auto_increment: request.auto_increment,
        on_update: request.on_update.clone(),
        collation: request.collation.clone(),
    };

    let rename_only = new_name != column
        && request.data_type.is_none()
        && request.nullable.is_none()
        && !request.clear_default
        && request.default_value.is_none()
        && request.comment.is_none()
        && request.auto_increment.is_none()
        && request.on_update.is_none()
        && request.collation.is_none();

    if rename_only {
        let sql = format!(
            "ALTER TABLE {target} RENAME COLUMN {} TO {}",
            quote_ident(&column),
            quote_ident(new_name)
        );
        return exec(pool, &sql).await;
    }

    let definition = column_definition(data_type, &change, Some(&meta))?;
    let changed = new_name != column
        || data_type != meta.data_type
        || request.nullable.is_some()
        || request.clear_default
        || request.default_value.is_some()
        || request.comment.is_some()
        || request.auto_increment.is_some()
        || request.on_update.is_some()
        || request.collation.is_some();
    if !changed {
        return Err("No column changes provided.".into());
    }

    let sql = format!(
        "ALTER TABLE {target} CHANGE COLUMN {} {} {definition}",
        quote_ident(&column),
        quote_ident(new_name)
    );
    exec(pool, &sql).await
}

pub async fn alter_key(pool: &MySqlPool, request: AlterKeyRequest) -> Result<(), String> {
    let schema = require_ident("Schema", &request.schema)?;
    let table = require_ident("Table", &request.table)?;
    let target = qualify(&schema, &table);

    if request.drop {
        let name = require_ident(
            "Key name",
            request.name.as_deref().unwrap_or(""),
        )?;
        let sql = if name.eq_ignore_ascii_case("PRIMARY") {
            format!("ALTER TABLE {target} DROP PRIMARY KEY")
        } else {
            format!("ALTER TABLE {target} DROP INDEX {}", quote_ident(&name))
        };
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
            if old_name.eq_ignore_ascii_case("PRIMARY") {
                return Err("Cannot rename PRIMARY KEY in MySQL; recreate it instead.".into());
            }
            let sql = format!(
                "ALTER TABLE {target} RENAME INDEX {} TO {}",
                quote_ident(old_name),
                quote_ident(new_name)
            );
            return exec(pool, &sql).await;
        }
    }

    if let Some(old_name) = &existing {
        let sql = if old_name.eq_ignore_ascii_case("PRIMARY") {
            format!("ALTER TABLE {target} DROP PRIMARY KEY")
        } else {
            format!(
                "ALTER TABLE {target} DROP INDEX {}",
                quote_ident(old_name)
            )
        };
        exec(pool, &sql).await?;
    }

    if columns.is_empty() {
        return Err("At least one column is required for a key.".into());
    }

    let kind = kind.unwrap_or_else(|| "UNIQUE".into());
    let cols = columns
        .iter()
        .map(|col| quote_ident(col))
        .collect::<Vec<_>>()
        .join(", ");

    let sql = match kind.as_str() {
        "PRIMARY KEY" | "PRIMARY" | "PK" => {
            format!("ALTER TABLE {target} ADD PRIMARY KEY ({cols})")
        }
        "UNIQUE" | "UQ" => {
            let name = new_name.or(existing);
            if let Some(name) = name {
                format!(
                    "ALTER TABLE {target} ADD UNIQUE {} ({cols})",
                    quote_ident(&name)
                )
            } else {
                format!("ALTER TABLE {target} ADD UNIQUE ({cols})")
            }
        }
        other => {
            return Err(format!(
                "Unsupported key kind '{other}'. Use PRIMARY KEY or UNIQUE."
            ));
        }
    };
    exec(pool, &sql).await
}
