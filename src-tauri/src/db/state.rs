use crate::drivers::DriverRegistry;

#[derive(Default)]
pub struct AppState {
    pub registry: DriverRegistry,
}

impl AppState {
    pub fn new() -> Self {
        Self {
            registry: DriverRegistry::with_builtins(),
        }
    }
}
