mod commands;
mod db;
mod drivers;
mod models;
mod plugins;

use commands::{
    alter_column, alter_key, alter_table, begin_transaction, cancel_query, connect, disconnect,
    end_transaction, execute_query, install_plugin, list_drivers, list_object_groups,
    list_object_subgroup, list_objects, list_plugins, list_schema, list_schemas, list_tables,
    reload_plugins, set_plugin_enabled, test_connection, transaction_open, uninstall_plugin,
};
use db::AppState;
use plugins::discover_and_register;
use tauri::Manager;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .manage(AppState::new())
        .plugin(tauri_plugin_opener::init())
        .setup(|app| {
            let app_handle = app.handle().clone();
            tauri::async_runtime::spawn(async move {
                let data = match app_handle.path().app_data_dir() {
                    Ok(path) => path,
                    Err(error) => {
                        eprintln!("Failed to resolve app data dir: {error}");
                        return;
                    }
                };
                let state = app_handle.state::<AppState>();
                match discover_and_register(&state.registry, &data).await {
                    Ok(loaded) if !loaded.is_empty() => {
                        eprintln!("Loaded plugins: {}", loaded.join(", "));
                    }
                    Ok(_) => {}
                    Err(error) => eprintln!("Plugin discovery failed: {error}"),
                }
            });
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            list_drivers,
            test_connection,
            connect,
            disconnect,
            list_schemas,
            list_schema,
            list_tables,
            list_object_groups,
            list_objects,
            list_object_subgroup,
            execute_query,
            begin_transaction,
            end_transaction,
            transaction_open,
            cancel_query,
            alter_table,
            alter_column,
            alter_key,
            list_plugins,
            install_plugin,
            uninstall_plugin,
            set_plugin_enabled,
            reload_plugins,
        ])
        .run(tauri::generate_context!())
        .expect("error while running HyperStudio");
}
