pub mod driver;
pub mod installer;
pub mod manager;
pub mod manifest;
pub mod process;
pub mod rpc;

pub use installer::{install_from_path, uninstall};
pub use manager::{
    discover_and_register, list_installed, register_plugin_dir, write_enabled,
};
