use serde::{Deserialize, Serialize};
use serde_json::Value;

#[derive(Debug, Clone, Serialize, Deserialize)]
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

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ColumnNode {
    pub name: String,
    pub data_type: String,
    pub nullable: bool,
    pub primary_key: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
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

/// A category of objects a driver exposes under a schema: tables, views,
/// routines, triggers, collections, synonyms, and so on. Declared by the
/// driver so the tree can render categories it knows nothing about.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ObjectGroupDef {
    pub id: String,
    pub label: String,
    /// Lucide icon name rendered next to the group and its objects.
    #[serde(default, alias = "icon")]
    pub icon: Option<String>,
    /// Heading for an object's children, e.g. "Columns" or "Parameters".
    #[serde(default, alias = "child_label")]
    pub child_label: Option<String>,
    /// Action ids offered on objects in this group: viewData, editData, ddl.
    #[serde(default)]
    pub actions: Vec<String>,
    /// Load this group as soon as the schema is expanded.
    #[serde(default, alias = "default_open")]
    pub default_open: bool,
}

impl ObjectGroupDef {
    pub fn tables() -> Self {
        Self {
            id: "tables".into(),
            label: "Tables".into(),
            icon: Some("table".into()),
            child_label: Some("Columns".into()),
            actions: vec!["viewData".into(), "editData".into()],
            default_open: true,
        }
    }
}

/// One entry inside an object group. `children` holds columns for tables,
/// parameters for routines, fields for collections — whatever the driver
/// wants to show one level deeper.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ObjectNode {
    pub name: String,
    #[serde(default)]
    pub kind: String,
    /// Secondary text shown dimmed after the name (return type, event, …).
    #[serde(default)]
    pub detail: Option<String>,
    #[serde(default)]
    pub children: Vec<ColumnNode>,
    /// Overrides the group's actions when present.
    #[serde(default)]
    pub actions: Option<Vec<String>>,
}

impl From<TableNode> for ObjectNode {
    fn from(table: TableNode) -> Self {
        Self {
            name: table.name,
            kind: table.kind,
            detail: None,
            children: table.columns,
            actions: None,
        }
    }
}

#[derive(Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct QueryResult {
    pub columns: Vec<String>,
    pub rows: Vec<Vec<Value>>,
    pub affected_rows: u64,
    pub elapsed_ms: u128,
    pub truncated: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DriverCapabilities {
    pub schemas: bool,
    pub views: bool,
    pub file_based: bool,
    pub folder_based: bool,
    pub no_connection_required: bool,
    pub readonly: bool,
    pub identifier_quote: String,
    /// Max rows returned for a single SELECT from the query editor.
    /// Drivers append/clamp LIMIT to this value to avoid loading huge result sets.
    #[serde(default = "default_max_rows")]
    pub max_rows: u32,
}

fn default_max_rows() -> u32 {
    DriverCapabilities::DEFAULT_MAX_ROWS
}

impl DriverCapabilities {
    pub const DEFAULT_MAX_ROWS: u32 = 500;
}

impl Default for DriverCapabilities {
    fn default() -> Self {
        Self {
            schemas: true,
            views: true,
            file_based: false,
            folder_based: false,
            no_connection_required: false,
            readonly: false,
            identifier_quote: "\"".into(),
            max_rows: Self::DEFAULT_MAX_ROWS,
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct ColumnTypeDeclaration {
    #[serde(alias = "type_names")]
    pub type_names: Vec<String>,
    #[serde(default, alias = "match_prefix")]
    pub match_prefix: bool,
    #[serde(default)]
    pub align: Option<String>,
    #[serde(default, alias = "class_name")]
    pub class_name: Option<String>,
    #[serde(default)]
    pub viewer: Option<String>,
    #[serde(default)]
    pub priority: Option<i32>,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct ConnectionFieldDef {
    /// Maps onto a ConnectionProfile key: host | port | database | username | password | sslMode
    pub key: String,
    pub label: String,
    #[serde(default)]
    pub placeholder: Option<String>,
    #[serde(default)]
    pub required: bool,
    /// Render as a password input (and offer vault/raw storage when key is password).
    #[serde(default)]
    pub secret: bool,
    /// Optional select choices (e.g. http / https).
    #[serde(default)]
    pub options: Option<Vec<String>>,
    /// Optional hint under the field.
    #[serde(default)]
    pub description: Option<String>,
    /// Layout hint: "half" (default for host/port) or "full".
    #[serde(default)]
    pub width: Option<String>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DriverInfo {
    pub id: String,
    pub name: String,
    pub version: String,
    pub description: String,
    pub builtin: bool,
    pub default_port: Option<u16>,
    pub capabilities: DriverCapabilities,
    pub column_types: Vec<ColumnTypeDeclaration>,
    /// When non-empty, the connection modal renders these fields instead of the SQL defaults.
    pub connection_fields: Vec<ConnectionFieldDef>,
    pub object_groups: Vec<ObjectGroupDef>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct InstalledPluginInfo {
    pub id: String,
    pub name: String,
    pub version: String,
    pub description: String,
    pub enabled: bool,
    pub path: String,
}

impl ConnectionConfig {
    pub fn validate(&self) -> Result<(), String> {
        if self.id.trim().is_empty() || self.driver.trim().is_empty() {
            return Err("Connection id and driver are required.".into());
        }
        Ok(())
    }

    pub fn validate_network(&self) -> Result<(), String> {
        self.validate()?;
        if self.host.trim().is_empty()
            || self.database.trim().is_empty()
            || self.username.trim().is_empty()
        {
            return Err("Host, database, and username are required.".into());
        }
        Ok(())
    }
}
