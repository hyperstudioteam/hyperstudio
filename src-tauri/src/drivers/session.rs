//! Per-connection state for explicit transactions and query cancellation.
//!
//! An open transaction has to keep the *same* server session for every
//! statement, so the connection is pulled out of the pool and parked here
//! until the user commits or rolls back. Cancellation needs the server-side
//! id of whichever session is running a statement, which is recorded while
//! the statement is in flight and dropped as soon as it settles.

use std::collections::HashMap;
use std::sync::Arc;

use tokio::sync::{Mutex, RwLock};

/// A connection checked out of the pool for the life of a transaction.
pub type Parked<C> = Arc<Mutex<C>>;

pub struct SessionState<C> {
    /// connection_id → parked connection with an open transaction
    transactions: RwLock<HashMap<String, Parked<C>>>,
    /// connection_id → server session id of the statement in flight
    running: RwLock<HashMap<String, u64>>,
}

impl<C> Default for SessionState<C> {
    fn default() -> Self {
        Self {
            transactions: RwLock::new(HashMap::new()),
            running: RwLock::new(HashMap::new()),
        }
    }
}

impl<C> SessionState<C> {
    pub async fn transaction(&self, connection_id: &str) -> Option<Parked<C>> {
        self.transactions.read().await.get(connection_id).cloned()
    }

    pub async fn is_open(&self, connection_id: &str) -> bool {
        self.transactions.read().await.contains_key(connection_id)
    }

    pub async fn park(&self, connection_id: String, conn: C) {
        self.transactions
            .write()
            .await
            .insert(connection_id, Arc::new(Mutex::new(conn)));
    }

    pub async fn take(&self, connection_id: &str) -> Option<Parked<C>> {
        self.transactions.write().await.remove(connection_id)
    }

    pub async fn mark_running(&self, connection_id: &str, session_id: u64) {
        self.running
            .write()
            .await
            .insert(connection_id.to_string(), session_id);
    }

    pub async fn clear_running(&self, connection_id: &str) {
        self.running.write().await.remove(connection_id);
    }

    pub async fn running_session(&self, connection_id: &str) -> Option<u64> {
        self.running.read().await.get(connection_id).copied()
    }

    /// Forget everything about a connection that is going away.
    pub async fn forget(&self, connection_id: &str) -> Option<Parked<C>> {
        self.running.write().await.remove(connection_id);
        self.transactions.write().await.remove(connection_id)
    }
}
