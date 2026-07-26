use std::fs;
use std::path::{Path, PathBuf};
use std::sync::Arc;

use serde_json::Value;

use crate::drivers::DriverRegistry;
use crate::models::InstalledPluginInfo;
use crate::plugins::driver::PluginDriver;
use crate::plugins::manifest::{PluginManifest, PluginType};

pub fn plugins_dir(app_data: &Path) -> PathBuf {
    app_data.join("plugins")
}

pub fn ensure_plugins_dir(app_data: &Path) -> Result<PathBuf, String> {
    let dir = plugins_dir(app_data);
    fs::create_dir_all(&dir).map_err(|error| error.to_string())?;
    Ok(dir)
}

pub fn load_manifest(plugin_dir: &Path) -> Result<PluginManifest, String> {
    load_manifest_at(plugin_dir, true)
}

pub fn load_manifest_loose(plugin_dir: &Path) -> Result<PluginManifest, String> {
    load_manifest_at(plugin_dir, false)
}

fn load_manifest_at(plugin_dir: &Path, require_folder_match: bool) -> Result<PluginManifest, String> {
    let path = plugin_dir.join("manifest.json");
    let raw = fs::read_to_string(&path)
        .map_err(|error| format!("Failed to read {}: {error}", path.display()))?;
    let manifest: PluginManifest = serde_json::from_str(&raw)
        .map_err(|error| format!("Invalid manifest in {}: {error}", path.display()))?;
    manifest.validate()?;
    for entry_path in manifest
        .contributes
        .views
        .iter()
        .map(|view| &view.entry)
        .chain(
            manifest
                .contributes
                .viewers
                .iter()
                .map(|viewer| &viewer.entry),
        )
    {
        let entry = plugin_dir.join(entry_path);
        if !entry.is_file() {
            return Err(format!(
                "Plugin view entry missing: {}",
                entry.display()
            ));
        }
    }
    if require_folder_match
        && plugin_dir
            .file_name()
            .and_then(|name| name.to_str())
            .is_some_and(|name| name != manifest.id)
    {
        return Err(format!(
            "Plugin folder name must match manifest id '{}'.",
            manifest.id
        ));
    }
    Ok(manifest)
}

pub fn load_settings(plugin_dir: &Path) -> Value {
    let path = plugin_dir.join("settings.json");
    fs::read_to_string(path)
        .ok()
        .and_then(|raw| serde_json::from_str(&raw).ok())
        .unwrap_or(Value::Object(Default::default()))
}

pub fn write_enabled(plugin_dir: &Path, enabled: bool) -> Result<(), String> {
    let mut manifest = load_manifest(plugin_dir)?;
    manifest.enabled = Some(enabled);
    let path = plugin_dir.join("manifest.json");
    let raw = serde_json::to_string_pretty(&manifest).map_err(|error| error.to_string())?;
    fs::write(path, raw).map_err(|error| error.to_string())
}

pub async fn discover_and_register(
    registry: &DriverRegistry,
    app_data: &Path,
) -> Result<Vec<String>, String> {
    let dir = ensure_plugins_dir(app_data)?;
    let mut loaded = Vec::new();
    let entries = fs::read_dir(&dir).map_err(|error| error.to_string())?;
    for entry in entries {
        let entry = entry.map_err(|error| error.to_string())?;
        let path = entry.path();
        if !path.is_dir() {
            continue;
        }
        let name = path
            .file_name()
            .and_then(|n| n.to_str())
            .unwrap_or("")
            .to_string();
        if name.starts_with('.') {
            continue;
        }
        match register_plugin_dir(registry, &path).await {
            Ok(id) => loaded.push(id),
            Err(error) => eprintln!("Skipping plugin {}: {error}", path.display()),
        }
    }
    Ok(loaded)
}

pub async fn register_plugin_dir(
    registry: &DriverRegistry,
    plugin_dir: &Path,
) -> Result<String, String> {
    let manifest = load_manifest(plugin_dir)?;
    if !manifest.is_enabled() {
        return Err(format!("Plugin '{}' is disabled.", manifest.id));
    }
    if manifest.plugin_type != PluginType::Driver {
        return Ok(manifest.id);
    }
    let executable = manifest
        .executable
        .as_ref()
        .ok_or_else(|| format!("Driver plugin '{}' has no executable.", manifest.id))?;
    let exe = plugin_dir.join(executable);
    if !exe.exists() {
        return Err(format!(
            "Plugin executable missing: {}",
            exe.display()
        ));
    }
    let settings = load_settings(plugin_dir);
    let driver = Arc::new(PluginDriver::new(
        manifest.clone(),
        plugin_dir.to_path_buf(),
        settings,
    ));
    registry.register(driver).await?;
    Ok(manifest.id)
}

pub fn list_installed(app_data: &Path) -> Result<Vec<InstalledPluginInfo>, String> {
    let dir = ensure_plugins_dir(app_data)?;
    let mut plugins = Vec::new();
    let entries = fs::read_dir(&dir).map_err(|error| error.to_string())?;
    for entry in entries {
        let entry = entry.map_err(|error| error.to_string())?;
        let path = entry.path();
        if !path.is_dir() || path.file_name().is_some_and(|n| n.to_string_lossy().starts_with('.'))
        {
            continue;
        }
        match load_manifest(&path) {
            Ok(manifest) => {
                let enabled = manifest.is_enabled();
                plugins.push(InstalledPluginInfo {
                    id: manifest.id,
                    name: manifest.name,
                    version: manifest.version,
                    description: manifest.description,
                    kind: match manifest.plugin_type {
                        PluginType::Driver => "driver",
                        PluginType::Extension => "extension",
                    }
                    .into(),
                    enabled,
                    path: path.display().to_string(),
                    contributes: serde_json::to_value(&manifest.contributes)
                        .unwrap_or(serde_json::Value::Null),
                });
            }
            Err(error) => eprintln!("Invalid plugin at {}: {error}", path.display()),
        }
    }
    plugins.sort_by(|a, b| a.name.to_lowercase().cmp(&b.name.to_lowercase()));
    Ok(plugins)
}
