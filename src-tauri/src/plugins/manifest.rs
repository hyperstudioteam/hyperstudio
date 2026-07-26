use serde::{Deserialize, Serialize};

use crate::drivers::BUILTIN_DRIVER_IDS;
use crate::models::{
    ColumnTypeDeclaration, ConnectionFieldDef, DriverCapabilities, ObjectGroupDef,
};

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PluginManifest {
    pub id: String,
    pub name: String,
    pub version: String,
    #[serde(default)]
    pub description: String,
    pub executable: String,
    #[serde(default)]
    pub default_port: Option<u16>,
    #[serde(default)]
    pub capabilities: ManifestCapabilities,
    #[serde(default)]
    pub settings: Vec<PluginSettingDef>,
    /// Custom connection-form fields for this driver.
    #[serde(default, alias = "connectionFields")]
    pub connection_fields: Vec<ConnectionFieldDef>,
    #[serde(default)]
    pub contributes: ManifestContributes,
    #[serde(default)]
    pub enabled: Option<bool>,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
pub struct ManifestContributes {
    #[serde(default, alias = "columnTypes")]
    pub column_types: Vec<ColumnTypeDeclaration>,
    /// Object categories under each schema. Empty falls back to tables only.
    #[serde(default, alias = "objectGroups")]
    pub object_groups: Vec<ObjectGroupDef>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ManifestCapabilities {
    #[serde(default = "default_true")]
    pub schemas: bool,
    #[serde(default = "default_true")]
    pub views: bool,
    #[serde(default)]
    pub file_based: bool,
    #[serde(default)]
    pub folder_based: bool,
    #[serde(default)]
    pub no_connection_required: bool,
    #[serde(default)]
    pub readonly: bool,
    #[serde(default = "default_quote")]
    pub identifier_quote: String,
    #[serde(default = "default_max_rows", alias = "maxRows")]
    pub max_rows: u32,
}

fn default_max_rows() -> u32 {
    DriverCapabilities::DEFAULT_MAX_ROWS
}

impl Default for ManifestCapabilities {
    fn default() -> Self {
        Self {
            schemas: true,
            views: true,
            file_based: false,
            folder_based: false,
            no_connection_required: false,
            readonly: false,
            identifier_quote: "\"".into(),
            max_rows: DriverCapabilities::DEFAULT_MAX_ROWS,
        }
    }
}

impl From<&ManifestCapabilities> for DriverCapabilities {
    fn from(value: &ManifestCapabilities) -> Self {
        Self {
            schemas: value.schemas,
            views: value.views,
            file_based: value.file_based,
            folder_based: value.folder_based,
            no_connection_required: value.no_connection_required,
            readonly: value.readonly,
            identifier_quote: value.identifier_quote.clone(),
            max_rows: if value.max_rows == 0 {
                DriverCapabilities::DEFAULT_MAX_ROWS
            } else {
                value.max_rows
            },
            // The plugin protocol has no session affinity, so a transaction
            // could not span calls and there is no handle to cancel.
            sessions: false,
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PluginSettingDef {
    pub key: String,
    pub label: String,
    #[serde(rename = "type")]
    pub setting_type: String,
    #[serde(default)]
    pub default: Option<serde_json::Value>,
    #[serde(default)]
    pub description: Option<String>,
    #[serde(default)]
    pub required: bool,
    #[serde(default)]
    pub options: Option<Vec<String>>,
}

fn default_true() -> bool {
    true
}

fn default_quote() -> String {
    "\"".into()
}

impl PluginManifest {
    pub fn validate(&self) -> Result<(), String> {
        let id = self.id.trim();
        if id.is_empty() {
            return Err("Plugin manifest id is required.".into());
        }
        if id.contains('/') || id.contains('\\') || id.contains("..") {
            return Err("Plugin id must be a simple folder-safe name.".into());
        }
        if BUILTIN_DRIVER_IDS.contains(&id) {
            return Err(format!(
                "Plugin id '{id}' collides with a built-in driver and was refused"
            ));
        }
        if self.name.trim().is_empty() {
            return Err("Plugin manifest name is required.".into());
        }
        if self.executable.trim().is_empty() {
            return Err("Plugin manifest executable is required.".into());
        }
        if self.executable.contains("..")
            || std::path::Path::new(&self.executable).is_absolute()
        {
            return Err("Plugin executable must be a relative path inside the plugin folder.".into());
        }
        let mut seen = std::collections::HashSet::new();
        for group in &self.contributes.object_groups {
            if group.id.trim().is_empty() {
                return Err("Every object group needs a non-empty id.".into());
            }
            if !seen.insert(group.id.trim()) {
                return Err(format!("Duplicate object group id '{}'.", group.id));
            }
        }
        Ok(())
    }

    pub fn is_enabled(&self) -> bool {
        self.enabled.unwrap_or(true)
    }
}
