use std::collections::HashMap;
use std::path::PathBuf;
use std::sync::Arc;

use async_trait::async_trait;
use serde_json::{Value, json};
use tokio::sync::RwLock;

use crate::drivers::DatabaseDriver;
use crate::models::{
    ColumnNode, ColumnTypeDeclaration, ConnectionConfig, ConnectionFieldDef, ConnectionInfo,
    DriverCapabilities, ObjectGroupDef, ObjectNode, QueryResult, SchemaInfo, SchemaNode, TableNode,
};
use crate::plugins::manifest::PluginManifest;
use crate::plugins::process::PluginProcess;

pub struct PluginDriver {
    manifest: PluginManifest,
    plugin_dir: PathBuf,
    settings: Value,
    sessions: RwLock<HashMap<String, Arc<PluginProcess>>>,
}

impl PluginDriver {
    pub fn new(manifest: PluginManifest, plugin_dir: PathBuf, settings: Value) -> Self {
        Self {
            manifest,
            plugin_dir,
            settings,
            sessions: RwLock::new(HashMap::new()),
        }
    }

    fn executable_path(&self) -> PathBuf {
        self.plugin_dir.join(&self.manifest.executable)
    }

    async fn session(&self, connection_id: &str) -> Result<Arc<PluginProcess>, String> {
        self.sessions
            .read()
            .await
            .get(connection_id)
            .cloned()
            .ok_or_else(|| "Connection is not active.".to_string())
    }

    async fn spawn_session(&self, connection_id: &str) -> Result<Arc<PluginProcess>, String> {
        let process = PluginProcess::spawn(self.executable_path(), self.settings.clone()).await?;
        let process = Arc::new(process);
        self.sessions
            .write()
            .await
            .insert(connection_id.to_string(), process.clone());
        Ok(process)
    }

    fn connection_params(cfg: &ConnectionConfig) -> Value {
        json!({
            "id": cfg.id,
            "host": cfg.host,
            "port": cfg.port,
            "database": cfg.database,
            "username": cfg.username,
            "password": cfg.password,
            "sslMode": cfg.ssl_mode,
        })
    }
}

#[async_trait]
impl DatabaseDriver for PluginDriver {
    fn id(&self) -> &str {
        &self.manifest.id
    }
    fn name(&self) -> &str {
        &self.manifest.name
    }
    fn version(&self) -> &str {
        &self.manifest.version
    }
    fn description(&self) -> &str {
        &self.manifest.description
    }
    fn builtin(&self) -> bool {
        false
    }
    fn default_port(&self) -> Option<u16> {
        self.manifest.default_port
    }
    fn capabilities(&self) -> DriverCapabilities {
        DriverCapabilities::from(&self.manifest.capabilities)
    }
    fn column_types(&self) -> Vec<ColumnTypeDeclaration> {
        self.manifest.contributes.column_types.clone()
    }
    fn connection_fields(&self) -> Vec<ConnectionFieldDef> {
        self.manifest.connection_fields.clone()
    }
    fn object_groups(&self) -> Vec<ObjectGroupDef> {
        let declared = &self.manifest.contributes.object_groups;
        if declared.is_empty() {
            vec![ObjectGroupDef::tables()]
        } else {
            declared.clone()
        }
    }

    async fn test_connection(&self, cfg: &ConnectionConfig) -> Result<ConnectionInfo, String> {
        cfg.validate()?;
        let process =
            PluginProcess::spawn(self.executable_path(), self.settings.clone()).await?;
        let result = process
            .call("test_connection", Self::connection_params(cfg))
            .await?;
        parse_connection_info(result, &cfg.database)
    }

    async fn connect(&self, cfg: &ConnectionConfig) -> Result<ConnectionInfo, String> {
        cfg.validate()?;
        let process = self.spawn_session(&cfg.id).await?;
        let params = Self::connection_params(cfg);
        let result = match process.call("connect", params.clone()).await {
            Ok(result) => result,
            // Some plugins only implement test_connection.
            Err(_) => process.call("test_connection", params).await?,
        };
        parse_connection_info(result, &cfg.database)
    }

    async fn disconnect(&self, connection_id: &str) -> Result<(), String> {
        if let Some(process) = self.sessions.write().await.remove(connection_id) {
            let _ = process
                .call("disconnect", json!({ "connectionId": connection_id }))
                .await;
        }
        Ok(())
    }

    async fn list_schemas(&self, connection_id: &str) -> Result<Vec<SchemaInfo>, String> {
        let process = self.session(connection_id).await?;
        let result = process
            .call("get_schemas", json!({ "connectionId": connection_id }))
            .await?;
        parse_schemas(result)
    }

    async fn list_schema(
        &self,
        connection_id: &str,
        schemas: Option<Vec<String>>,
        all_schemas: bool,
    ) -> Result<Vec<SchemaNode>, String> {
        let process = self.session(connection_id).await?;
        let selected = if all_schemas {
            Vec::new()
        } else {
            schemas.unwrap_or_default()
        };

        // Prefer a bulk get_schema_tree if the plugin provides it.
        if let Ok(tree) = process
            .call(
                "get_schema_tree",
                json!({
                    "connectionId": connection_id,
                    "schemas": selected,
                    "allSchemas": all_schemas,
                }),
            )
            .await
        {
            return parse_schema_nodes(tree);
        }

        let schema_names = if selected.is_empty() {
            parse_schemas(
                process
                    .call("get_schemas", json!({ "connectionId": connection_id }))
                    .await?,
            )?
            .into_iter()
            .filter(|schema| !schema.is_system)
            .map(|schema| schema.name)
            .collect::<Vec<_>>()
        } else {
            selected
        };

        let mut nodes = Vec::new();
        for schema in schema_names {
            let tables = self.list_tables(connection_id, &schema).await?;
            nodes.push(SchemaNode {
                name: schema,
                tables,
            });
        }
        Ok(nodes)
    }

    async fn list_tables(
        &self,
        connection_id: &str,
        schema: &str,
    ) -> Result<Vec<TableNode>, String> {
        let process = self.session(connection_id).await?;
        let tables = process
            .call(
                "get_tables",
                json!({ "connectionId": connection_id, "schema": schema }),
            )
            .await?;
        let mut tables = parse_tables(tables)?;
        for table in &mut tables {
            if table.columns.is_empty() {
                if let Ok(columns) = process
                    .call(
                        "get_columns",
                        json!({
                            "connectionId": connection_id,
                            "schema": schema,
                            "table": table.name,
                        }),
                    )
                    .await
                {
                    table.columns = parse_columns(columns)?;
                }
            }
        }
        Ok(tables)
    }

    async fn list_objects(
        &self,
        connection_id: &str,
        schema: &str,
        group: &str,
    ) -> Result<Vec<ObjectNode>, String> {
        let process = self.session(connection_id).await?;
        let response = process
            .call(
                "get_objects",
                json!({
                    "connectionId": connection_id,
                    "schema": schema,
                    "group": group,
                }),
            )
            .await;

        match response {
            Ok(value) => parse_objects(value),
            // Plugins that predate get_objects still answer for tables.
            Err(error) if group == "tables" => {
                let tables = process
                    .call(
                        "get_tables",
                        json!({ "connectionId": connection_id, "schema": schema }),
                    )
                    .await
                    .map_err(|_| error)?;
                Ok(parse_tables(tables)?
                    .into_iter()
                    .map(ObjectNode::from)
                    .collect())
            }
            Err(error) => Err(error),
        }
    }

    async fn list_object_subgroup(
        &self,
        connection_id: &str,
        schema: &str,
        object: &str,
        subgroup: &str,
    ) -> Result<Vec<ObjectNode>, String> {
        let process = self.session(connection_id).await?;
        let value = process
            .call(
                "get_object_subgroup",
                json!({
                    "connectionId": connection_id,
                    "schema": schema,
                    "object": object,
                    "subgroup": subgroup,
                }),
            )
            .await?;
        parse_objects(value)
    }

    async fn execute_query(
        &self,
        connection_id: &str,
        sql: &str,
    ) -> Result<QueryResult, String> {
        let process = self.session(connection_id).await?;
        let started = std::time::Instant::now();
        let result = process
            .call(
                "execute_query",
                json!({ "connectionId": connection_id, "query": sql }),
            )
            .await?;
        parse_query_result(result, started.elapsed().as_millis())
    }
}

fn parse_connection_info(value: Value, fallback_db: &str) -> Result<ConnectionInfo, String> {
    if let Some(obj) = value.as_object() {
        if obj.get("success").and_then(|v| v.as_bool()) == Some(false) {
            let message = obj
                .get("message")
                .and_then(|v| v.as_str())
                .unwrap_or("Connection test failed.");
            return Err(message.into());
        }
        return Ok(ConnectionInfo {
            server_version: obj
                .get("serverVersion")
                .or_else(|| obj.get("server_version"))
                .and_then(|v| v.as_str())
                .unwrap_or("plugin")
                .into(),
            database: obj
                .get("database")
                .and_then(|v| v.as_str())
                .unwrap_or(fallback_db)
                .into(),
        });
    }
    Ok(ConnectionInfo {
        server_version: "plugin".into(),
        database: fallback_db.into(),
    })
}

fn parse_schemas(value: Value) -> Result<Vec<SchemaInfo>, String> {
    let Some(items) = value.as_array() else {
        return Ok(Vec::new());
    };
    Ok(items
        .iter()
        .filter_map(|item| {
            if let Some(name) = item.as_str() {
                return Some(SchemaInfo {
                    name: name.into(),
                    is_system: false,
                });
            }
            let obj = item.as_object()?;
            let name = obj.get("name")?.as_str()?.to_string();
            let is_system = obj
                .get("isSystem")
                .or_else(|| obj.get("is_system"))
                .and_then(|v| v.as_bool())
                .unwrap_or(false);
            Some(SchemaInfo { name, is_system })
        })
        .collect())
}

fn parse_tables(value: Value) -> Result<Vec<TableNode>, String> {
    let Some(items) = value.as_array() else {
        return Ok(Vec::new());
    };
    let mut tables = Vec::new();
    for item in items {
        let obj = item
            .as_object()
            .ok_or_else(|| "Invalid get_tables response.".to_string())?;
        let name = obj
            .get("name")
            .and_then(|v| v.as_str())
            .ok_or_else(|| "Table name missing.".to_string())?
            .to_string();
        let kind = obj
            .get("kind")
            .or_else(|| obj.get("type"))
            .and_then(|v| v.as_str())
            .unwrap_or("BASE TABLE")
            .to_string();
        let columns = obj
            .get("columns")
            .cloned()
            .map(parse_columns)
            .transpose()?
            .unwrap_or_default();
        tables.push(TableNode {
            name,
            kind,
            columns,
        });
    }
    Ok(tables)
}

fn parse_objects(value: Value) -> Result<Vec<ObjectNode>, String> {
    let Some(items) = value.as_array() else {
        return Ok(Vec::new());
    };
    let mut objects = Vec::new();
    for item in items {
        if let Some(name) = item.as_str() {
            objects.push(ObjectNode {
                name: name.into(),
                kind: String::new(),
                detail: None,
                children: Vec::new(),
                actions: None,
            });
            continue;
        }
        let obj = item
            .as_object()
            .ok_or_else(|| "Invalid get_objects response.".to_string())?;
        let children = obj
            .get("children")
            .or_else(|| obj.get("columns"))
            .cloned()
            .map(parse_columns)
            .transpose()?
            .unwrap_or_default();
        objects.push(ObjectNode {
            name: obj
                .get("name")
                .and_then(|v| v.as_str())
                .ok_or_else(|| "Object name missing.".to_string())?
                .into(),
            kind: obj
                .get("kind")
                .or_else(|| obj.get("type"))
                .and_then(|v| v.as_str())
                .unwrap_or_default()
                .into(),
            detail: obj
                .get("detail")
                .or_else(|| obj.get("description"))
                .and_then(|v| v.as_str())
                .map(str::to_string),
            children,
            actions: obj.get("actions").and_then(|v| v.as_array()).map(|items| {
                items
                    .iter()
                    .filter_map(|item| item.as_str().map(str::to_string))
                    .collect()
            }),
        });
    }
    Ok(objects)
}

fn parse_columns(value: Value) -> Result<Vec<ColumnNode>, String> {
    let Some(items) = value.as_array() else {
        return Ok(Vec::new());
    };
    let mut columns = Vec::new();
    for item in items {
        let obj = item
            .as_object()
            .ok_or_else(|| "Invalid get_columns response.".to_string())?;
        columns.push(ColumnNode {
            name: obj
                .get("name")
                .and_then(|v| v.as_str())
                .ok_or_else(|| "Column name missing.".to_string())?
                .into(),
            data_type: obj
                .get("dataType")
                .or_else(|| obj.get("data_type"))
                .or_else(|| obj.get("type"))
                .and_then(|v| v.as_str())
                .unwrap_or("text")
                .into(),
            nullable: obj
                .get("nullable")
                .and_then(|v| v.as_bool())
                .unwrap_or(true),
            primary_key: obj
                .get("primaryKey")
                .or_else(|| obj.get("primary_key"))
                .and_then(|v| v.as_bool())
                .unwrap_or(false),
        });
    }
    Ok(columns)
}

fn parse_schema_nodes(value: Value) -> Result<Vec<SchemaNode>, String> {
    let Some(items) = value.as_array() else {
        return Ok(Vec::new());
    };
    let mut nodes = Vec::new();
    for item in items {
        let obj = item
            .as_object()
            .ok_or_else(|| "Invalid get_schema_tree response.".to_string())?;
        let name = obj
            .get("name")
            .and_then(|v| v.as_str())
            .ok_or_else(|| "Schema name missing.".to_string())?
            .to_string();
        let tables = obj
            .get("tables")
            .cloned()
            .map(parse_tables)
            .transpose()?
            .unwrap_or_default();
        nodes.push(SchemaNode { name, tables });
    }
    Ok(nodes)
}

fn parse_query_result(value: Value, elapsed_ms: u128) -> Result<QueryResult, String> {
    let obj = value
        .as_object()
        .ok_or_else(|| "Invalid execute_query response.".to_string())?;
    let columns = obj
        .get("columns")
        .and_then(|v| v.as_array())
        .map(|cols| {
            cols.iter()
                .filter_map(|c| c.as_str().map(str::to_string))
                .collect::<Vec<_>>()
        })
        .unwrap_or_default();
    let rows = obj
        .get("rows")
        .and_then(|v| v.as_array())
        .map(|rows| {
            rows.iter()
                .filter_map(|row| {
                    row.as_array()
                        .map(|cells| cells.iter().cloned().collect::<Vec<_>>())
                })
                .collect::<Vec<_>>()
        })
        .unwrap_or_default();
    let affected_rows = obj
        .get("affectedRows")
        .or_else(|| obj.get("affected_rows"))
        .or_else(|| obj.get("total_count"))
        .and_then(|v| v.as_u64())
        .unwrap_or(0);
    let truncated = obj
        .get("truncated")
        .and_then(|v| v.as_bool())
        .unwrap_or(false);
    let elapsed = obj
        .get("elapsedMs")
        .or_else(|| obj.get("elapsed_ms"))
        .and_then(|v| v.as_u64())
        .map(|v| v as u128)
        .unwrap_or(elapsed_ms);
    Ok(QueryResult {
        columns,
        rows,
        affected_rows,
        elapsed_ms: elapsed,
        truncated,
    })
}
