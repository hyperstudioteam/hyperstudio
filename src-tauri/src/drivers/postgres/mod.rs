mod alter;
mod ddl;
mod objects;
mod pool;
mod query;
mod schema;
mod table_metadata;
mod values;

use std::collections::HashMap;

use async_trait::async_trait;
use sqlx::pool::PoolConnection;
use sqlx::{PgPool, Postgres};
use tokio::sync::RwLock;

use crate::drivers::DatabaseDriver;
use crate::drivers::session::SessionState;
use crate::drivers::shared::{get_pool, insert_pool, remove_pool};
use crate::models::{
    AlterColumnRequest, AlterKeyRequest, AlterTableRequest, ConnectionConfig, ConnectionInfo,
    DriverCapabilities, ObjectGroupDef, ObjectNode, QueryResult, SchemaInfo, SchemaNode, TableNode,
};

pub struct NativePostgres {
    pools: RwLock<HashMap<String, PgPool>>,
    sessions: SessionState<PoolConnection<Postgres>>,
}

impl NativePostgres {
    pub fn new() -> Self {
        Self {
            pools: RwLock::new(HashMap::new()),
            sessions: SessionState::default(),
        }
    }
}

#[async_trait]
impl DatabaseDriver for NativePostgres {
    fn id(&self) -> &str {
        "postgres"
    }
    fn name(&self) -> &str {
        "PostgreSQL"
    }
    fn version(&self) -> &str {
        env!("CARGO_PKG_VERSION")
    }
    fn description(&self) -> &str {
        "Built-in PostgreSQL driver (sqlx)"
    }
    fn builtin(&self) -> bool {
        true
    }
    fn default_port(&self) -> Option<u16> {
        Some(5432)
    }
    fn capabilities(&self) -> DriverCapabilities {
        DriverCapabilities {
            schemas: true,
            views: true,
            file_based: false,
            folder_based: false,
            no_connection_required: false,
            readonly: false,
            identifier_quote: "\"".into(),
            max_rows: DriverCapabilities::DEFAULT_MAX_ROWS,
            sessions: true,
            transactions: true,
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
        schema::introspect(&pool, &selected).await
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

    async fn table_ddl(
        &self,
        connection_id: &str,
        schema: &str,
        table: &str,
    ) -> Result<String, String> {
        let pool = get_pool(&self.pools, connection_id).await?;
        ddl::table_ddl(&pool, schema, table).await
    }

    async fn execute_query(&self, connection_id: &str, sql: &str) -> Result<QueryResult, String> {
        let pool = get_pool(&self.pools, connection_id).await?;
        let max_rows = self.capabilities().max_rows as usize;

        // Statements join an open transaction when there is one, so the user
        // sees their own uncommitted writes.
        let parked = self.sessions.transaction(connection_id).await;
        let mut owned;
        let mut guard;
        let conn: &mut sqlx::PgConnection = match parked {
            Some(ref handle) => {
                guard = handle.lock().await;
                &mut guard
            }
            None => {
                owned = pool.acquire().await.map_err(|error| error.to_string())?;
                &mut owned
            }
        };

        let pid = query::backend_pid(conn).await?;
        self.sessions.mark_running(connection_id, pid as u64).await;
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
        sqlx::query("BEGIN")
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
        // The connection returns to the pool once this handle drops, so end
        // the transaction even if the statement itself fails.
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
        let Some(pid) = self.sessions.running_session(connection_id).await else {
            return Ok(false);
        };
        let pool = get_pool(&self.pools, connection_id).await?;
        query::cancel_backend(&pool, pid as i32).await
    }

    async fn execute_batch(
        &self,
        connection_id: &str,
        statements: &[String],
    ) -> Result<Vec<u64>, String> {
        let pool = get_pool(&self.pools, connection_id).await?;
        query::execute_batch(&pool, statements).await
    }
}
