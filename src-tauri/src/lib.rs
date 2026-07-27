mod commands;
mod db;
mod drivers;
mod models;
mod plugins;
mod ssh;

use commands::{
    alter_column, alter_key, alter_table, begin_transaction, cancel_query, connect, disconnect,
    end_transaction, er_diagram, execute_batch, execute_query, extension_rpc, install_plugin,
    keychain_available, keychain_delete, keychain_get, keychain_set, list_drivers,
    list_object_groups, list_object_subgroup, list_objects, list_plugins, list_schema,
    list_schemas, list_tables, read_schema_cache, read_text_file, reload_plugins,
    resolve_plugin_asset, set_plugin_enabled, table_ddl, test_connection, transaction_open,
    uninstall_plugin, write_export_chunk, write_schema_cache,
};
use db::AppState;
use plugins::discover_and_register;
use tauri::Manager;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .manage(AppState::new())
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_dialog::init())
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
            er_diagram,
            keychain_available,
            keychain_get,
            keychain_set,
            keychain_delete,
            begin_transaction,
            end_transaction,
            transaction_open,
            cancel_query,
            execute_batch,
            table_ddl,
            write_export_chunk,
            read_text_file,
            read_schema_cache,
            write_schema_cache,
            alter_table,
            alter_column,
            alter_key,
            list_plugins,
            resolve_plugin_asset,
            extension_rpc,
            install_plugin,
            uninstall_plugin,
            set_plugin_enabled,
            reload_plugins,
        ])
        .run(tauri::generate_context!())
        .expect("error while running HyperStudio");
}
