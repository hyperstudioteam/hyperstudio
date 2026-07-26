//! Typesense driver plugin for Hypergrid.
//!
//! Speaks JSON-RPC 2.0 over newline-delimited stdin/stdout.
//!
//! Connection form mapping:
//! - Host     → Typesense host (localhost or Cloud hostname)
//! - Port     → 8108 (local) / 443 (Cloud)
//! - Password → API key (`X-TYPESENSE-API-KEY`)
//! - Database → optional protocol: `http` or `https` (default http, or https on 443)
//!
//! Build: `cargo build --release && cp target/release/hypergrid-typesense .`

mod client;
mod query;

use client::{
    TypesenseClient, TypesenseConfig, alias_to_object, collection_subgroup, collection_to_object,
    collection_to_table, key_to_object, schema_name, synonym_to_object,
};
use serde_json::{Value, json};
use std::io::{self, BufRead, Write};
use std::sync::Mutex;

struct State {
    client: Option<TypesenseClient>,
}

impl State {
    fn new() -> Self {
        Self { client: None }
    }

    fn connect(&mut self, params: &Value) -> Result<(String, String), String> {
        let config = TypesenseConfig::from_params(params)?;
        let client = TypesenseClient::new(config);
        let info = client.server_info()?;
        self.client = Some(client);
        Ok(info)
    }

    fn client(&self) -> Result<&TypesenseClient, String> {
        self.client
            .as_ref()
            .ok_or_else(|| "Not connected. Call connect / test_connection first.".into())
    }
}

fn main() {
    let state = Mutex::new(State::new());
    let stdin = io::stdin();
    let mut stdout = io::stdout();

    for line in stdin.lock().lines() {
        let Ok(line) = line else { break };
        if line.trim().is_empty() {
            continue;
        }
        let request: Value = match serde_json::from_str(&line) {
            Ok(value) => value,
            Err(error) => {
                let _ = writeln!(
                    stdout,
                    "{}",
                    json!({
                        "jsonrpc": "2.0",
                        "error": { "code": -32700, "message": error.to_string() },
                        "id": Value::Null
                    })
                );
                let _ = stdout.flush();
                continue;
            }
        };
        let id = request.get("id").cloned().unwrap_or(Value::Null);
        let method = request
            .get("method")
            .and_then(|v| v.as_str())
            .unwrap_or("");
        let params = request.get("params").cloned().unwrap_or(json!({}));
        let response = match dispatch(&state, method, &params, id.clone()) {
            Ok(result) => ok(id, result),
            Err(message) => json!({
                "jsonrpc": "2.0",
                "error": { "code": -32000, "message": message },
                "id": id
            }),
        };
        let _ = writeln!(stdout, "{response}");
        let _ = stdout.flush();
    }
}

fn dispatch(
    state: &Mutex<State>,
    method: &str,
    params: &Value,
    _id: Value,
) -> Result<Value, String> {
    match method {
        "initialize" | "ping" => Ok(Value::Null),
        "disconnect" => {
            let mut guard = state.lock().map_err(|e| e.to_string())?;
            guard.client = None;
            Ok(Value::Null)
        }
        "test_connection" | "connect" => {
            let mut guard = state.lock().map_err(|e| e.to_string())?;
            let (version, database) = guard.connect(params)?;
            Ok(json!({
                "success": true,
                "serverVersion": version,
                "database": database,
            }))
        }
        "get_schemas" => Ok(json!([
            { "name": schema_name(), "isSystem": false }
        ])),
        "get_tables" => {
            let guard = state.lock().map_err(|e| e.to_string())?;
            let client = guard.client()?;
            let collections = client.list_collections()?;
            let tables: Vec<Value> = collections.iter().map(collection_to_table).collect();
            Ok(Value::Array(tables))
        }
        "get_objects" => {
            let group = params
                .get("group")
                .and_then(|v| v.as_str())
                .unwrap_or("tables")
                .trim();
            let guard = state.lock().map_err(|e| e.to_string())?;
            let client = guard.client()?;
            match group {
                "tables" | "collections" => {
                    let collections = client.list_collections()?;
                    Ok(Value::Array(
                        collections.iter().map(collection_to_object).collect(),
                    ))
                }
                "aliases" => Ok(Value::Array(
                    client
                        .list_aliases()?
                        .iter()
                        .filter_map(alias_to_object)
                        .collect(),
                )),
                "synonyms" => Ok(Value::Array(
                    client
                        .list_synonyms()?
                        .iter()
                        .filter_map(synonym_to_object)
                        .collect(),
                )),
                "keys" => Ok(Value::Array(
                    client
                        .list_keys()?
                        .iter()
                        .filter_map(key_to_object)
                        .collect(),
                )),
                other => Err(format!("Unknown object group '{other}'.")),
            }
        }
        "get_object_subgroup" => {
            let object = params
                .get("object")
                .and_then(|v| v.as_str())
                .unwrap_or("")
                .trim();
            let subgroup = params
                .get("subgroup")
                .and_then(|v| v.as_str())
                .unwrap_or("")
                .trim();
            if object.is_empty() {
                return Err("object is required for get_object_subgroup.".into());
            }
            let guard = state.lock().map_err(|e| e.to_string())?;
            let client = guard.client()?;
            let collection = client.get_collection(object)?;
            Ok(Value::Array(collection_subgroup(&collection, subgroup)?))
        }
        "get_columns" => {
            let table = params
                .get("table")
                .and_then(|v| v.as_str())
                .unwrap_or("")
                .trim();
            if table.is_empty() {
                return Err("table is required for get_columns.".into());
            }
            let guard = state.lock().map_err(|e| e.to_string())?;
            let client = guard.client()?;
            let collection = client.get_collection(table)?;
            Ok(collection_to_table(&collection)
                .get("columns")
                .cloned()
                .unwrap_or(json!([])))
        }
        "get_schema_tree" => {
            let guard = state.lock().map_err(|e| e.to_string())?;
            let client = guard.client()?;
            let collections = client.list_collections()?;
            let tables: Vec<Value> = collections.iter().map(collection_to_table).collect();
            Ok(json!([{ "name": schema_name(), "tables": tables }]))
        }
        "execute_query" => {
            let sql = params
                .get("query")
                .or_else(|| params.get("sql"))
                .and_then(|v| v.as_str())
                .unwrap_or("")
                .to_string();
            let guard = state.lock().map_err(|e| e.to_string())?;
            let client = guard.client()?;
            query::execute(client, &sql)
        }
        _ => Err(format!("Method not found: {method}")),
    }
}

fn ok(id: Value, result: Value) -> Value {
    json!({ "jsonrpc": "2.0", "result": result, "id": id })
}
