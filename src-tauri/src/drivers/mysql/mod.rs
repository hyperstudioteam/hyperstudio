mod alter;
mod objects;
mod pool;
mod query;
mod schema;
mod table_metadata;
mod values;

use std::collections::HashMap;

use async_trait::async_trait;
use sqlx::pool::PoolConnection;
use sqlx::{MySql, MySqlPool};
use tokio::sync::RwLock;

use crate::drivers::DatabaseDriver;
use crate::drivers::session::SessionState;
use crate::drivers::shared::{get_pool, insert_pool, remove_pool};
use crate::models::{
    AlterColumnRequest, AlterKeyRequest, AlterTableRequest, ConnectionConfig, ConnectionInfo,
    DriverCapabilities, ObjectGroupDef, ObjectNode, QueryResult, SchemaInfo, SchemaNode, TableNode,
};

pub struct NativeMySql {
    pools: RwLock<HashMap<String, MySqlPool>>,
    sessions: SessionState<PoolConnection<MySql>>,
}

impl NativeMySql {
    pub fn new() -> Self {
        Self {
            pools: RwLock::new(HashMap::new()),
            sessions: SessionState::default(),
        }
    }
}

#[async_trait]
impl DatabaseDriver for NativeMySql {
    fn id(&self) -> &str {
        "mysql"
    }
    fn name(&self) -> &str {
        "MySQL"
    }
    fn version(&self) -> &str {
        env!("CARGO_PKG_VERSION")
    }
    fn description(&self) -> &str {
        "Built-in MySQL driver (sqlx)"
    }
    fn builtin(&self) -> bool {
        true
    }
    fn default_port(&self) -> Option<u16> {
        Some(3306)
    }
    fn capabilities(&self) -> DriverCapabilities {
        DriverCapabilities {
            schemas: true,
            views: true,
            file_based: false,
            folder_based: false,
            no_connection_required: false,
            readonly: false,
            identifier_quote: "`".into(),
            max_rows: DriverCapabilities::DEFAULT_MAX_ROWS,
            sessions: true,
        }
    }
    fn object_groups(&self) -> Vec<ObjectGroupDef> {
        objects::groups()
    }

    async fn test_connection(&self, cfg: &ConnectionConfig) -> Result<ConnectionInfo, String> {
        let pool = pool::create(cfg).await?;
        let info = pool::info(&pool).await;
        pool.close().await;
        info
    }

    async fn connect(&self, cfg: &ConnectionConfig) -> Result<ConnectionInfo, String> {
        let pool = pool::create(cfg).await?;
        let info = pool::info(&pool).await?;
        if let Some(previous) = insert_pool(&self.pools, cfg.id.clone(), pool).await {
            previous.close().await;
        }
        Ok(info)
    }

    async fn disconnect(&self, connection_id: &str) -> Result<(), String> {
        // Dropping a parked connection rolls its transaction back.
        self.sessions.forget(connection_id).await;
        if let Some(pool) = remove_pool(&self.pools, connection_id).await {
            pool.close().await;
        }
        Ok(())
    }

    async fn list_schemas(&self, connection_id: &str) -> Result<Vec<SchemaInfo>, String> {
        let pool = get_pool(&self.pools, connection_id).await?;
        schema::list_available(&pool).await
    }

    async fn list_schema(
        &self,
        connection_id: &str,
        schemas: Option<Vec<String>>,
        all_schemas: bool,
    ) -> Result<Vec<SchemaNode>, String> {
        let pool = get_pool(&self.pools, connection_id).await?;
        let selected = if all_schemas {
            Vec::new()
        } else {
            schemas
                .unwrap_or_default()
                .into_iter()
                .map(|schema| schema.trim().to_string())
                .filter(|schema| !schema.is_empty())
                .collect()
        };
        schema::introspect(&pool, &selected, all_schemas).await
    }

    async fn list_tables(
        &self,
        connection_id: &str,
        schema: &str,
    ) -> Result<Vec<TableNode>, String> {
        let pool = get_pool(&self.pools, connection_id).await?;
        schema::list_tables(&pool, schema).await
    }

    async fn list_objects(
        &self,
        connection_id: &str,
        schema: &str,
        group: &str,
    ) -> Result<Vec<ObjectNode>, String> {
        let schema = schema.trim();
        if schema.is_empty() {
            return Err("Schema name is required.".into());
        }
        let pool = get_pool(&self.pools, connection_id).await?;
        match group {
            "tables" => schema::list_tables_of_kind(&pool, schema, false).await,
            "views" => schema::list_tables_of_kind(&pool, schema, true).await,
            other => objects::list(&pool, schema, other).await,
        }
    }

    async fn list_object_subgroup(
        &self,
        connection_id: &str,
        schema: &str,
        object: &str,
        subgroup: &str,
    ) -> Result<Vec<ObjectNode>, String> {
        let pool = get_pool(&self.pools, connection_id).await?;
        table_metadata::list(&pool, schema, object, subgroup).await
    }

    async fn alter_table(
        &self,
        connection_id: &str,
        request: AlterTableRequest,
    ) -> Result<(), String> {
        let pool = get_pool(&self.pools, connection_id).await?;
        alter::alter_table(&pool, request).await
    }

    async fn alter_column(
        &self,
        connection_id: &str,
        request: AlterColumnRequest,
    ) -> Result<(), String> {
        let pool = get_pool(&self.pools, connection_id).await?;
        alter::alter_column(&pool, request).await
    }

    async fn alter_key(
        &self,
        connection_id: &str,
        request: AlterKeyRequest,
    ) -> Result<(), String> {
        let pool = get_pool(&self.pools, connection_id).await?;
        alter::alter_key(&pool, request).await
    }

    async fn execute_query(&self, connection_id: &str, sql: &str) -> Result<QueryResult, String> {
        let pool = get_pool(&self.pools, connection_id).await?;
        let max_rows = self.capabilities().max_rows as usize;

        // Statements join an open transaction when there is one, so the user
        // sees their own uncommitted writes.
        let parked = self.sessions.transaction(connection_id).await;
        let mut owned;
        let mut guard;
        let conn: &mut sqlx::MySqlConnection = match parked {
            Some(ref handle) => {
                guard = handle.lock().await;
                &mut guard
            }
            None => {
                owned = pool.acquire().await.map_err(|error| error.to_string())?;
                &mut owned
            }
        };

        let session_id = query::connection_id(conn).await?;
        self.sessions.mark_running(connection_id, session_id).await;
        let outcome = query::execute_on(conn, sql, max_rows).await;
        self.sessions.clear_running(connection_id).await;
        outcome
    }

    async fn begin_transaction(&self, connection_id: &str) -> Result<(), String> {
        if self.sessions.is_open(connection_id).await {
            return Err("A transaction is already open on this connection.".into());
        }
        let pool = get_pool(&self.pools, connection_id).await?;
        let mut conn = pool.acquire().await.map_err(|error| error.to_string())?;
        sqlx::query("START TRANSACTION")
            .execute(&mut *conn)
            .await
            .map_err(|error| error.to_string())?;
        self.sessions.park(connection_id.to_string(), conn).await;
        Ok(())
    }

    async fn end_transaction(&self, connection_id: &str, commit: bool) -> Result<(), String> {
        let parked = self
            .sessions
            .take(connection_id)
            .await
            .ok_or_else(|| "No transaction is open on this connection.".to_string())?;
        let mut conn = parked.lock().await;
        sqlx::query(if commit { "COMMIT" } else { "ROLLBACK" })
            .execute(&mut **conn)
            .await
            .map(|_| ())
            .map_err(|error| error.to_string())
    }

    async fn transaction_open(&self, connection_id: &str) -> bool {
        self.sessions.is_open(connection_id).await
    }

    async fn cancel_query(&self, connection_id: &str) -> Result<bool, String> {
        let Some(session_id) = self.sessions.running_session(connection_id).await else {
            return Ok(false);
        };
        let pool = get_pool(&self.pools, connection_id).await?;
        query::kill_query(&pool, session_id).await
    }
}
