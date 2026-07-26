use std::collections::HashMap;

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
    #[serde(default, rename = "type")]
    pub plugin_type: PluginType,
    #[serde(default)]
    pub executable: Option<String>,
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

#[derive(Debug, Clone, Copy, Serialize, Deserialize, Default, PartialEq, Eq)]
#[serde(rename_all = "lowercase")]
pub enum PluginType {
    #[default]
    Driver,
    Extension,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct ManifestContributes {
    #[serde(default, alias = "columnTypes")]
    pub column_types: Vec<ColumnTypeDeclaration>,
    /// Object categories under each schema. Empty falls back to tables only.
    #[serde(default, alias = "objectGroups")]
    pub object_groups: Vec<ObjectGroupDef>,
    #[serde(default)]
    pub commands: Vec<CommandContribution>,
    #[serde(default)]
    pub menus: HashMap<String, Vec<MenuContribution>>,
    #[serde(default)]
    pub views: Vec<ViewContribution>,
    #[serde(default)]
    pub viewers: Vec<ViewerContribution>,
    #[serde(default)]
    pub status_bar: Vec<StatusBarContribution>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CommandContribution {
    pub id: String,
    pub title: String,
    #[serde(default)]
    pub opens_view: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct MenuContribution {
    pub command: String,
    #[serde(default)]
    pub group: Option<String>,
    #[serde(default)]
    pub when: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ViewContribution {
    pub id: String,
    pub name: String,
    pub location: String,
    pub entry: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ViewerContribution {
    pub id: String,
    pub label: String,
    pub entry: String,
    #[serde(default)]
    pub type_names: Vec<String>,
    #[serde(default)]
    pub priority: Option<i32>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct StatusBarContribution {
    pub id: String,
    pub text: String,
    #[serde(default)]
    pub command: Option<String>,
    #[serde(default)]
    pub alignment: Option<String>,
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
            // Plugins run one statement per RPC call, so there is no batch to
            // wrap in a transaction.
            transactions: false,
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
        if self.plugin_type == PluginType::Driver && self.executable.is_none() {
            return Err("Driver plugin manifest executable is required.".into());
        }
        if let Some(executable) = &self.executable {
            if executable.trim().is_empty()
                || executable.contains("..")
                || std::path::Path::new(executable).is_absolute()
            {
                return Err(
                    "Plugin executable must be a relative path inside the plugin folder.".into(),
                );
            }
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
        let mut command_ids = std::collections::HashSet::new();
        for command in &self.contributes.commands {
            if command.id.trim().is_empty() || command.title.trim().is_empty() {
                return Err("Every contributed command needs an id and title.".into());
            }
            if !command.id.starts_with(&format!("{}.", self.id)) {
                return Err(format!(
                    "Command id '{}' must be namespaced with '{}.'.",
                    command.id, self.id
                ));
            }
            if !command_ids.insert(command.id.trim()) {
                return Err(format!("Duplicate command id '{}'.", command.id));
            }
        }
        let mut view_ids = std::collections::HashSet::new();
        for view in &self.contributes.views {
            if view.id.trim().is_empty() || view.name.trim().is_empty() {
                return Err("Every contributed view needs an id and name.".into());
            }
            if view.location != "panel.right" && view.location != "panel.modal" {
                return Err(format!("Unsupported view location '{}'.", view.location));
            }
            if !view.id.starts_with(&format!("{}.", self.id)) {
                return Err(format!(
                    "View id '{}' must be namespaced with '{}.'.",
                    view.id, self.id
                ));
            }
            if view.entry.trim().is_empty()
                || view.entry.contains("..")
                || std::path::Path::new(&view.entry).is_absolute()
            {
                return Err("View entry must be a relative path inside the plugin folder.".into());
            }
            if !view_ids.insert(view.id.trim()) {
                return Err(format!("Duplicate view id '{}'.", view.id));
            }
        }
        for viewer in &self.contributes.viewers {
            if viewer.id.trim().is_empty() || viewer.label.trim().is_empty() {
                return Err("Every contributed viewer needs an id and label.".into());
            }
            if viewer.entry.trim().is_empty()
                || viewer.entry.contains("..")
                || std::path::Path::new(&viewer.entry).is_absolute()
            {
                return Err("Viewer entry must be a relative path inside the plugin folder.".into());
            }
            if !viewer.id.starts_with(&format!("{}.", self.id)) {
                return Err(format!(
                    "Viewer id '{}' must be namespaced with '{}.'.",
                    viewer.id, self.id
                ));
            }
        }
        for command in &self.contributes.commands {
            if command
                .opens_view
                .as_ref()
                .is_some_and(|view| !view_ids.contains(view.trim()))
            {
                return Err(format!(
                    "Command '{}' opens an unknown view.",
                    command.id
                ));
            }
        }
        for items in self.contributes.menus.values() {
            for item in items {
                if !command_ids.contains(item.command.trim()) {
                    return Err(format!(
                        "Menu references unknown command '{}'.",
                        item.command
                    ));
                }
            }
        }
        for item in &self.contributes.status_bar {
            if !item.id.starts_with(&format!("{}.", self.id)) {
                return Err(format!(
                    "Status bar id '{}' must be namespaced with '{}.'.",
                    item.id, self.id
                ));
            }
            if item
                .command
                .as_ref()
                .is_some_and(|command| !command_ids.contains(command.trim()))
            {
                return Err(format!(
                    "Status bar item '{}' references an unknown command.",
                    item.id
                ));
            }
        }
        Ok(())
    }

    pub fn is_enabled(&self) -> bool {
        self.enabled.unwrap_or(true)
    }
}
