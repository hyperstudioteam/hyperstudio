use sqlx::{MySqlPool, PgPool};

use crate::drivers::DriverRegistry;

#[derive(Clone)]
pub enum DatabasePool {
    Postgres(PgPool),
    MySql(MySqlPool),
}

impl DatabasePool {
    pub async fn close(self) {
        match self {
            DatabasePool::Postgres(pool) => pool.close().await,
            DatabasePool::MySql(pool) => pool.close().await,
        }
    }
}

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
