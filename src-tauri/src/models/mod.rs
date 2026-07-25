use serde::{Deserialize, Serialize};
use serde_json::Value;

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ConnectionConfig {
    pub id: String,
    pub driver: String,
    pub host: String,
    pub port: u16,
    pub database: String,
    pub username: String,
    pub password: String,
    pub ssl_mode: String,
    /// Present on the UI connection payload; introspection filters go to `list_schema`.
    #[serde(default)]
    #[allow(dead_code)]
    pub schemas: Vec<String>,
    /// When true, ignore `schemas` and fetch every accessible schema.
    #[serde(default)]
    #[allow(dead_code)]
    pub all_schemas: bool,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ConnectionInfo {
    pub server_version: String,
    pub database: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SchemaInfo {
    pub name: String,
    pub is_system: bool,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ColumnNode {
    pub name: String,
    pub data_type: String,
    pub nullable: bool,
    pub primary_key: bool,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TableNode {
    pub name: String,
    pub kind: String,
    pub columns: Vec<ColumnNode>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SchemaNode {
    pub name: String,
    pub tables: Vec<TableNode>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct QueryResult {
    pub columns: Vec<String>,
    pub rows: Vec<Vec<Value>>,
    pub affected_rows: u64,
    pub elapsed_ms: u128,
    pub truncated: bool,
}

impl ConnectionConfig {
    pub fn validate(&self) -> Result<(), String> {
        if self.id.trim().is_empty()
            || self.host.trim().is_empty()
            || self.database.trim().is_empty()
            || self.username.trim().is_empty()
        {
            return Err("Connection name, host, database, and username are required.".into());
        }
        if !matches!(self.driver.as_str(), "postgres" | "mysql") {
            return Err("Unsupported database driver.".into());
        }
        Ok(())
    }
}
