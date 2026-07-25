mod commands;
mod db;
mod models;

use commands::{
    connect, disconnect, execute_query, list_schema, list_schemas, list_tables, test_connection,
};
use db::AppState;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .manage(AppState::default())
        .plugin(tauri_plugin_opener::init())
        .invoke_handler(tauri::generate_handler![
            test_connection,
            connect,
            disconnect,
            list_schemas,
            list_schema,
            list_tables,
            execute_query
        ])
        .run(tauri::generate_context!())
        .expect("error while running Hypergrid");
}
