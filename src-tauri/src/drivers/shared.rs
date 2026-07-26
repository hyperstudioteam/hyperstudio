//! Helpers shared by the built-in sqlx drivers.

use std::collections::HashMap;

use tokio::sync::RwLock;

pub async fn get_pool<P: Clone>(
    pools: &RwLock<HashMap<String, P>>,
    connection_id: &str,
) -> Result<P, String> {
    pools
        .read()
        .await
        .get(connection_id)
        .cloned()
        .ok_or_else(|| "Connection is not active.".to_string())
}

pub async fn insert_pool<P>(
    pools: &RwLock<HashMap<String, P>>,
    connection_id: String,
    pool: P,
) -> Option<P> {
    pools.write().await.insert(connection_id, pool)
}

pub async fn remove_pool<P>(pools: &RwLock<HashMap<String, P>>, connection_id: &str) -> Option<P> {
    pools.write().await.remove(connection_id)
}
