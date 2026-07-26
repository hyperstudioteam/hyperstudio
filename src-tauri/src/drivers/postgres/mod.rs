mod objects;
mod pool;
mod query;
mod schema;
mod values;

use std::collections::HashMap;

use async_trait::async_trait;
use sqlx::PgPool;
use tokio::sync::RwLock;

use crate::drivers::DatabaseDriver;
use crate::drivers::shared::{get_pool, insert_pool, remove_pool};
use crate::models::{
    ConnectionConfig, ConnectionInfo, DriverCapabilities, ObjectGroupDef, ObjectNode, QueryResult,
    SchemaInfo, SchemaNode, TableNode,
};

pub struct NativePostgres {
    pools: RwLock<HashMap<String, PgPool>>,
}

impl NativePostgres {
    pub fn new() -> Self {
        Self {
            pools: RwLock::new(HashMap::new()),
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

    async fn execute_query(&self, connection_id: &str, sql: &str) -> Result<QueryResult, String> {
        let pool = get_pool(&self.pools, connection_id).await?;
        let max_rows = self.capabilities().max_rows as usize;
        query::execute(&pool, sql, max_rows).await
    }
}
