use std::fs;
use std::io::{Read, Write};
use std::path::{Path, PathBuf};

use zip::ZipArchive;

use crate::plugins::manager::{load_manifest, load_manifest_loose, plugins_dir};

pub fn install_from_path(app_data: &Path, source: &Path) -> Result<String, String> {
    if !source.exists() {
        return Err(format!("Path does not exist: {}", source.display()));
    }
    if source.is_dir() {
        install_from_dir(app_data, source)
    } else if source
        .extension()
        .and_then(|ext| ext.to_str())
        .is_some_and(|ext| ext.eq_ignore_ascii_case("zip"))
    {
        install_from_zip(app_data, source)
    } else {
        Err("Provide a plugin folder or a .zip archive.".into())
    }
}

fn install_from_dir(app_data: &Path, source: &Path) -> Result<String, String> {
    let manifest = load_manifest_loose(source)?;
    let dest = plugins_dir(app_data).join(&manifest.id);
    let tmp = plugins_dir(app_data).join(format!(".tmp-{}", manifest.id));
    if tmp.exists() {
        fs::remove_dir_all(&tmp).map_err(|error| error.to_string())?;
    }
    copy_dir(source, &tmp)?;
    finalize_install(&tmp, &dest)?;
    Ok(manifest.id)
}

fn install_from_zip(app_data: &Path, zip_path: &Path) -> Result<String, String> {
    let file = fs::File::open(zip_path).map_err(|error| error.to_string())?;
    let mut archive = ZipArchive::new(file).map_err(|error| error.to_string())?;

    let staging = plugins_dir(app_data).join(format!(
        ".tmp-zip-{}",
        std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .map(|d| d.as_millis())
            .unwrap_or(0)
    ));
    fs::create_dir_all(&staging).map_err(|error| error.to_string())?;

    for index in 0..archive.len() {
        let mut entry = archive
            .by_index(index)
            .map_err(|error| error.to_string())?;
        let name = entry
            .enclosed_name()
            .ok_or_else(|| "Zip entry has an unsafe path.".to_string())?
            .to_path_buf();
        let out = staging.join(&name);
        if entry.is_dir() {
            fs::create_dir_all(&out).map_err(|error| error.to_string())?;
            continue;
        }
        if let Some(parent) = out.parent() {
            fs::create_dir_all(parent).map_err(|error| error.to_string())?;
        }
        let mut outfile = fs::File::create(&out).map_err(|error| error.to_string())?;
        let mut buffer = Vec::new();
        entry
            .read_to_end(&mut buffer)
            .map_err(|error| error.to_string())?;
        outfile
            .write_all(&buffer)
            .map_err(|error| error.to_string())?;
        #[cfg(unix)]
        {
            use std::os::unix::fs::PermissionsExt;
            if let Some(mode) = entry.unix_mode() {
                let _ = fs::set_permissions(&out, fs::Permissions::from_mode(mode));
            }
        }
    }

    let plugin_root = find_plugin_root(&staging)?;
    let manifest = load_manifest_loose(&plugin_root)?;
    let dest = plugins_dir(app_data).join(&manifest.id);
    let tmp = plugins_dir(app_data).join(format!(".tmp-{}", manifest.id));
    if tmp.exists() {
        fs::remove_dir_all(&tmp).map_err(|error| error.to_string())?;
    }
    if plugin_root == staging {
        fs::rename(&staging, &tmp).map_err(|error| error.to_string())?;
    } else {
        copy_dir(&plugin_root, &tmp)?;
        let _ = fs::remove_dir_all(&staging);
    }
    finalize_install(&tmp, &dest)?;
    Ok(manifest.id)
}

fn find_plugin_root(staging: &Path) -> Result<PathBuf, String> {
    if staging.join("manifest.json").exists() {
        return Ok(staging.to_path_buf());
    }
    let mut candidates = Vec::new();
    for entry in fs::read_dir(staging).map_err(|error| error.to_string())? {
        let entry = entry.map_err(|error| error.to_string())?;
        let path = entry.path();
        if path.is_dir() && path.join("manifest.json").exists() {
            candidates.push(path);
        }
    }
    match candidates.len() {
        1 => Ok(candidates.remove(0)),
        0 => Err("Zip archive does not contain a manifest.json.".into()),
        _ => Err("Zip archive contains multiple plugin folders.".into()),
    }
}

fn finalize_install(tmp: &Path, dest: &Path) -> Result<(), String> {
    // Validate contents before swapping into place (folder name is checked on dest).
    load_manifest_loose(tmp)?;
    if dest.exists() {
        fs::remove_dir_all(dest).map_err(|error| error.to_string())?;
    }
    fs::rename(tmp, dest).map_err(|error| {
        format!("Failed to finalize plugin installation: {error}")
    })?;
    load_manifest(dest)?;
    Ok(())
}

pub fn uninstall(app_data: &Path, plugin_id: &str) -> Result<(), String> {
    let id = plugin_id.trim();
    if id.is_empty() || id.contains("..") || id.contains('/') || id.contains('\\') {
        return Err("Invalid plugin id.".into());
    }
    let dest = plugins_dir(app_data).join(id);
    if !dest.exists() {
        return Err(format!("Plugin '{id}' is not installed."));
    }
    fs::remove_dir_all(dest).map_err(|error| error.to_string())
}

fn copy_dir(src: &Path, dest: &Path) -> Result<(), String> {
    fs::create_dir_all(dest).map_err(|error| error.to_string())?;
    for entry in fs::read_dir(src).map_err(|error| error.to_string())? {
        let entry = entry.map_err(|error| error.to_string())?;
        let path = entry.path();
        let target = dest.join(entry.file_name());
        if path.is_dir() {
            copy_dir(&path, &target)?;
        } else {
            fs::copy(&path, &target).map_err(|error| error.to_string())?;
            #[cfg(unix)]
            {
                if let Ok(meta) = fs::metadata(&path) {
                    let _ = fs::set_permissions(&target, meta.permissions());
                }
            }
        }
    }
    Ok(())
}
