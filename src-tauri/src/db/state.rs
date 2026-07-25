use std::collections::HashMap;

use sqlx::{MySqlPool, PgPool};
use tokio::sync::RwLock;

#[derive(Clone)]
pub enum DatabasePool {
    Postgres(PgPool),
    MySql(MySqlPool),
}

#[derive(Default)]
pub struct AppState {
    pub pools: RwLock<HashMap<String, DatabasePool>>,
}

impl AppState {
    pub async fn get_pool(&self, connection_id: &str) -> Result<DatabasePool, String> {
        self.pools
            .read()
            .await
            .get(connection_id)
            .cloned()
            .ok_or_else(|| "Connection is not active.".to_string())
    }

    pub async fn insert_pool(&self, connection_id: String, pool: DatabasePool) {
        self.pools.write().await.insert(connection_id, pool);
    }

    pub async fn remove_pool(&self, connection_id: &str) -> Option<DatabasePool> {
        self.pools.write().await.remove(connection_id)
    }
}

impl DatabasePool {
    pub async fn close(self) {
        match self {
            DatabasePool::Postgres(pool) => pool.close().await,
            DatabasePool::MySql(pool) => pool.close().await,
        }
    }
}
