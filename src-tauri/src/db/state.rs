use crate::drivers::DriverRegistry;
use crate::ssh::{SharedTunnels, TunnelManager};
use std::sync::Arc;

#[derive(Default)]
pub struct AppState {
    pub registry: DriverRegistry,
    pub tunnels: SharedTunnels,
}

impl AppState {
    pub fn new() -> Self {
        Self {
            registry: DriverRegistry::with_builtins(),
            tunnels: Arc::new(TunnelManager::default()),
        }
    }
}
