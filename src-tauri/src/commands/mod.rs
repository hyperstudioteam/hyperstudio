use tauri::State;

use crate::db::{
    AppState, create_pool, execute_sql, introspect_schema, list_available_schemas,
    list_schema_tables, pool_info,
};
use crate::models::{
    ConnectionConfig, ConnectionInfo, QueryResult, SchemaInfo, SchemaNode, TableNode,
};

#[tauri::command]
pub async fn test_connection(config: ConnectionConfig) -> Result<ConnectionInfo, String> {
    let pool = create_pool(&config).await?;
    let info = pool_info(&pool).await;
    pool.close().await;
    info
}

#[tauri::command]
pub async fn connect(
    config: ConnectionConfig,
    state: State<'_, AppState>,
) -> Result<ConnectionInfo, String> {
    let pool = create_pool(&config).await?;
    let info = pool_info(&pool).await?;
    state.insert_pool(config.id, pool).await;
    Ok(info)
}

#[tauri::command]
pub async fn disconnect(connection_id: String, state: State<'_, AppState>) -> Result<(), String> {
    if let Some(pool) = state.remove_pool(&connection_id).await {
        pool.close().await;
    }
    Ok(())
}

#[tauri::command]
pub async fn list_schemas(
    connection_id: String,
    state: State<'_, AppState>,
) -> Result<Vec<SchemaInfo>, String> {
    let pool = state.get_pool(&connection_id).await?;
    list_available_schemas(&pool).await
}

#[tauri::command]
pub async fn list_schema(
    connection_id: String,
    schemas: Option<Vec<String>>,
    all_schemas: Option<bool>,
    state: State<'_, AppState>,
) -> Result<Vec<SchemaNode>, String> {
    let pool = state.get_pool(&connection_id).await?;
    let fetch_all = all_schemas.unwrap_or(false);
    let selected = if fetch_all {
        Vec::new()
    } else {
        // Prefer explicit command args; fall back to config-style empty list.
        schemas
            .unwrap_or_default()
            .into_iter()
            .map(|schema| schema.trim().to_string())
            .filter(|schema| !schema.is_empty())
            .collect()
    };
    introspect_schema(&pool, &selected, fetch_all).await
}

#[tauri::command]
pub async fn list_tables(
    connection_id: String,
    schema: String,
    state: State<'_, AppState>,
) -> Result<Vec<TableNode>, String> {
    let pool = state.get_pool(&connection_id).await?;
    list_schema_tables(&pool, &schema).await
}

#[tauri::command]
pub async fn execute_query(
    connection_id: String,
    sql: String,
    state: State<'_, AppState>,
) -> Result<QueryResult, String> {
    let pool = state.get_pool(&connection_id).await?;
    execute_sql(&pool, &sql).await
}
