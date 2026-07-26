use std::path::PathBuf;

use tauri::{AppHandle, Manager, State};

use crate::db::AppState;
use crate::models::{
    AlterColumnRequest, AlterKeyRequest, AlterTableRequest, ConnectionConfig, ConnectionInfo,
    DriverInfo, InstalledPluginInfo, ObjectGroupDef, ObjectNode, QueryResult, SchemaInfo,
    SchemaNode, TableNode,
};
use crate::plugins::{
    discover_and_register, install_from_path, list_installed, register_plugin_dir, uninstall,
    write_enabled,
};

fn app_data_dir(app: &AppHandle) -> Result<PathBuf, String> {
    app.path()
        .app_data_dir()
        .map_err(|error| error.to_string())
}

#[tauri::command]
pub async fn list_drivers(state: State<'_, AppState>) -> Result<Vec<DriverInfo>, String> {
    Ok(state.registry.list().await)
}

#[tauri::command]
pub async fn test_connection(
    config: ConnectionConfig,
    state: State<'_, AppState>,
) -> Result<ConnectionInfo, String> {
    let driver = state.registry.get(&config.driver).await?;
    driver.test_connection(&config).await
}

#[tauri::command]
pub async fn connect(
    config: ConnectionConfig,
    state: State<'_, AppState>,
) -> Result<ConnectionInfo, String> {
    let driver = state.registry.get(&config.driver).await?;
    let info = driver.connect(&config).await?;
    state
        .registry
        .bind_connection(config.id.clone(), config.driver.clone())
        .await;
    Ok(info)
}

#[tauri::command]
pub async fn disconnect(connection_id: String, state: State<'_, AppState>) -> Result<(), String> {
    if let Some(driver_id) = state.registry.unbind_connection(&connection_id).await {
        if let Ok(driver) = state.registry.get(&driver_id).await {
            driver.disconnect(&connection_id).await?;
        }
    }
    Ok(())
}

#[tauri::command]
pub async fn list_schemas(
    connection_id: String,
    state: State<'_, AppState>,
) -> Result<Vec<SchemaInfo>, String> {
    let driver = state.registry.driver_for_connection(&connection_id).await?;
    driver.list_schemas(&connection_id).await
}

#[tauri::command]
pub async fn list_schema(
    connection_id: String,
    schemas: Option<Vec<String>>,
    all_schemas: Option<bool>,
    state: State<'_, AppState>,
) -> Result<Vec<SchemaNode>, String> {
    let driver = state.registry.driver_for_connection(&connection_id).await?;
    driver
        .list_schema(&connection_id, schemas, all_schemas.unwrap_or(false))
        .await
}

#[tauri::command]
pub async fn list_tables(
    connection_id: String,
    schema: String,
    state: State<'_, AppState>,
) -> Result<Vec<TableNode>, String> {
    let driver = state.registry.driver_for_connection(&connection_id).await?;
    driver.list_tables(&connection_id, &schema).await
}

#[tauri::command]
pub async fn list_object_groups(
    connection_id: String,
    state: State<'_, AppState>,
) -> Result<Vec<ObjectGroupDef>, String> {
    let driver = state.registry.driver_for_connection(&connection_id).await?;
    Ok(driver.object_groups())
}

#[tauri::command]
pub async fn list_objects(
    connection_id: String,
    schema: String,
    group: String,
    state: State<'_, AppState>,
) -> Result<Vec<ObjectNode>, String> {
    let driver = state.registry.driver_for_connection(&connection_id).await?;
    driver.list_objects(&connection_id, &schema, &group).await
}

#[tauri::command]
pub async fn list_object_subgroup(
    connection_id: String,
    schema: String,
    object: String,
    subgroup: String,
    state: State<'_, AppState>,
) -> Result<Vec<ObjectNode>, String> {
    let driver = state.registry.driver_for_connection(&connection_id).await?;
    driver
        .list_object_subgroup(&connection_id, &schema, &object, &subgroup)
        .await
}

#[tauri::command]
pub async fn execute_query(
    connection_id: String,
    sql: String,
    state: State<'_, AppState>,
) -> Result<QueryResult, String> {
    let driver = state.registry.driver_for_connection(&connection_id).await?;
    driver.execute_query(&connection_id, &sql).await
}

/// Append a formatted chunk of an export to disk.
///
/// Exports are streamed batch by batch so a large result set never has to be
/// held in memory as one string. `append` is false for the first chunk, which
/// truncates any existing file.
#[tauri::command]
pub async fn write_export_chunk(
    path: String,
    contents: String,
    append: bool,
) -> Result<(), String> {
    use std::fs::OpenOptions;
    use std::io::Write;

    let mut file = OpenOptions::new()
        .write(true)
        .create(true)
        .append(append)
        .truncate(!append)
        .open(&path)
        .map_err(|error| format!("Cannot open {path}: {error}"))?;
    file.write_all(contents.as_bytes())
        .map_err(|error| format!("Cannot write {path}: {error}"))
}

#[tauri::command]
pub async fn alter_table(
    connection_id: String,
    request: AlterTableRequest,
    state: State<'_, AppState>,
) -> Result<(), String> {
    let driver = state.registry.driver_for_connection(&connection_id).await?;
    driver.alter_table(&connection_id, request).await
}

#[tauri::command]
pub async fn alter_column(
    connection_id: String,
    request: AlterColumnRequest,
    state: State<'_, AppState>,
) -> Result<(), String> {
    let driver = state.registry.driver_for_connection(&connection_id).await?;
    driver.alter_column(&connection_id, request).await
}

#[tauri::command]
pub async fn alter_key(
    connection_id: String,
    request: AlterKeyRequest,
    state: State<'_, AppState>,
) -> Result<(), String> {
    let driver = state.registry.driver_for_connection(&connection_id).await?;
    driver.alter_key(&connection_id, request).await
}

#[tauri::command]
pub async fn list_plugins(app: AppHandle) -> Result<Vec<InstalledPluginInfo>, String> {
    let data = app_data_dir(&app)?;
    list_installed(&data)
}

#[tauri::command]
pub async fn install_plugin(
    app: AppHandle,
    state: State<'_, AppState>,
    source_path: String,
) -> Result<InstalledPluginInfo, String> {
    let data = app_data_dir(&app)?;
    let id = install_from_path(&data, PathBuf::from(&source_path).as_path())?;
    let plugin_dir = data.join("plugins").join(&id);
    // Re-register (or register) so it appears immediately.
    let _ = state.registry.unregister(&id).await;
    register_plugin_dir(&state.registry, &plugin_dir).await?;
    list_installed(&data)?
        .into_iter()
        .find(|plugin| plugin.id == id)
        .ok_or_else(|| format!("Installed plugin '{id}' but could not read it back."))
}

#[tauri::command]
pub async fn uninstall_plugin(
    app: AppHandle,
    state: State<'_, AppState>,
    plugin_id: String,
) -> Result<(), String> {
    let data = app_data_dir(&app)?;
    let _ = state.registry.unregister(&plugin_id).await;
    uninstall(&data, &plugin_id)
}

#[tauri::command]
pub async fn set_plugin_enabled(
    app: AppHandle,
    state: State<'_, AppState>,
    plugin_id: String,
    enabled: bool,
) -> Result<(), String> {
    let data = app_data_dir(&app)?;
    let plugin_dir = data.join("plugins").join(&plugin_id);
    write_enabled(&plugin_dir, enabled)?;
    if enabled {
        register_plugin_dir(&state.registry, &plugin_dir).await?;
    } else {
        state.registry.unregister(&plugin_id).await?;
    }
    Ok(())
}

#[tauri::command]
pub async fn reload_plugins(app: AppHandle, state: State<'_, AppState>) -> Result<Vec<String>, String> {
    let data = app_data_dir(&app)?;
    // Drop non-builtin drivers, then rediscover.
    let current = state.registry.list().await;
    for driver in current {
        if !driver.builtin {
            let _ = state.registry.unregister(&driver.id).await;
        }
    }
    discover_and_register(&state.registry, &data).await
}
