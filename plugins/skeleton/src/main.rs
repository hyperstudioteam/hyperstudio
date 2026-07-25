//! Minimal Hypergrid driver plugin.
//!
//! Speaks JSON-RPC 2.0 over newline-delimited stdin/stdout.
//! Build with `cargo build --release` then install the folder containing
//! this `manifest.json` and the `hypergrid-skeleton` binary.

use serde_json::{Value, json};
use std::io::{self, BufRead, Write};

fn main() {
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
        let response = dispatch(method, id);
        let _ = writeln!(stdout, "{response}");
        let _ = stdout.flush();
    }
}

fn dispatch(method: &str, id: Value) -> Value {
    match method {
        "initialize" => ok(id, Value::Null),
        "ping" => ok(id, Value::Null),
        "test_connection" | "connect" => ok(
            id,
            json!({
                "success": true,
                "serverVersion": "skeleton-0.1.0",
                "database": "demo"
            }),
        ),
        "disconnect" => ok(id, Value::Null),
        "get_schemas" => ok(
            id,
            json!([
                { "name": "public", "isSystem": false },
                { "name": "pg_catalog", "isSystem": true }
            ]),
        ),
        "get_tables" => ok(
            id,
            json!([
                {
                    "name": "hello",
                    "kind": "BASE TABLE",
                    "columns": [
                        { "name": "id", "dataType": "integer", "nullable": false, "primaryKey": true },
                        { "name": "message", "dataType": "text", "nullable": true, "primaryKey": false },
                        { "name": "payload", "dataType": "jsonb", "nullable": true, "primaryKey": false }
                    ]
                }
            ]),
        ),
        "get_columns" => ok(
            id,
            json!([
                { "name": "id", "dataType": "integer", "nullable": false, "primaryKey": true },
                { "name": "message", "dataType": "text", "nullable": true, "primaryKey": false },
                { "name": "payload", "dataType": "jsonb", "nullable": true, "primaryKey": false }
            ]),
        ),
        "execute_query" => ok(
            id,
            json!({
                "columns": ["id", "message", "payload"],
                "rows": [
                    [1, "Hello from Hypergrid plugin", "{\"kind\":\"greeting\",\"tags\":[\"demo\",\"json\"]}"],
                    [2, "JSON-RPC over stdin/stdout", "{\"kind\":\"transport\",\"lines\":1}"]
                ],
                "affectedRows": 0,
                "truncated": false
            }),
        ),
        _ => json!({
            "jsonrpc": "2.0",
            "error": { "code": -32601, "message": format!("Method not found: {method}") },
            "id": id
        }),
    }
}

fn ok(id: Value, result: Value) -> Value {
    json!({ "jsonrpc": "2.0", "result": result, "id": id })
}
