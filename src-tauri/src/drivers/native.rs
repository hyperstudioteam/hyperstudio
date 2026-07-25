use std::collections::HashMap;

use async_trait::async_trait;
use tokio::sync::RwLock;

use crate::db::{
    create_pool, execute_sql, introspect_schema, list_available_schemas, list_objects,
    list_schema_tables, mysql_groups, pool_info, postgres_groups, DatabasePool,
};
use crate::drivers::DatabaseDriver;
use crate::models::{
    ConnectionConfig, ConnectionInfo, DriverCapabilities, ObjectGroupDef, ObjectNode, QueryResult,
    SchemaInfo, SchemaNode, TableNode,
};

pub const BUILTIN_DRIVER_IDS: [&str; 2] = ["postgres", "mysql"];

pub struct NativePostgres {
    pools: RwLock<HashMap<String, DatabasePool>>,
}

pub struct NativeMySql {
    pools: RwLock<HashMap<String, DatabasePool>>,
}

impl NativePostgres {
    pub fn new() -> Self {
        Self {
            pools: RwLock::new(HashMap::new()),
        }
    }
}

impl NativeMySql {
    pub fn new() -> Self {
        Self {
            pools: RwLock::new(HashMap::new()),
        }
    }
}

async fn get_pool(
    pools: &RwLock<HashMap<String, DatabasePool>>,
    connection_id: &str,
) -> Result<DatabasePool, String> {
    pools
        .read()
        .await
        .get(connection_id)
        .cloned()
        .ok_or_else(|| "Connection is not active.".to_string())
}

async fn insert_pool(
    pools: &RwLock<HashMap<String, DatabasePool>>,
    connection_id: String,
    pool: DatabasePool,
) {
    if let Some(previous) = pools.write().await.insert(connection_id, pool) {
        previous.close().await;
    }
}

async fn remove_pool(
    pools: &RwLock<HashMap<String, DatabasePool>>,
    connection_id: &str,
) -> Option<DatabasePool> {
    pools.write().await.remove(connection_id)
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
        }
    }
    fn object_groups(&self) -> Vec<ObjectGroupDef> {
        postgres_groups()
    }

    async fn test_connection(&self, cfg: &ConnectionConfig) -> Result<ConnectionInfo, String> {
        cfg.validate_network()?;
        let mut config = cfg.clone();
        config.driver = "postgres".into();
        let pool = create_pool(&config).await?;
        let info = pool_info(&pool).await;
        pool.close().await;
        info
    }

    async fn connect(&self, cfg: &ConnectionConfig) -> Result<ConnectionInfo, String> {
        cfg.validate_network()?;
        let mut config = cfg.clone();
        config.driver = "postgres".into();
        let pool = create_pool(&config).await?;
        let info = pool_info(&pool).await?;
        insert_pool(&self.pools, cfg.id.clone(), pool).await;
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
        list_available_schemas(&pool).await
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
        introspect_schema(&pool, &selected, all_schemas).await
    }

    async fn list_tables(
        &self,
        connection_id: &str,
        schema: &str,
    ) -> Result<Vec<TableNode>, String> {
        let pool = get_pool(&self.pools, connection_id).await?;
        list_schema_tables(&pool, schema).await
    }

    async fn list_objects(
        &self,
        connection_id: &str,
        schema: &str,
        group: &str,
    ) -> Result<Vec<ObjectNode>, String> {
        let pool = get_pool(&self.pools, connection_id).await?;
        list_objects(&pool, schema, group).await
    }

    async fn execute_query(
        &self,
        connection_id: &str,
        sql: &str,
    ) -> Result<QueryResult, String> {
        let pool = get_pool(&self.pools, connection_id).await?;
        execute_sql(&pool, sql).await
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
        }
    }
    fn object_groups(&self) -> Vec<ObjectGroupDef> {
        mysql_groups()
    }

    async fn test_connection(&self, cfg: &ConnectionConfig) -> Result<ConnectionInfo, String> {
        cfg.validate_network()?;
        let mut config = cfg.clone();
        config.driver = "mysql".into();
        let pool = create_pool(&config).await?;
        let info = pool_info(&pool).await;
        pool.close().await;
        info
    }

    async fn connect(&self, cfg: &ConnectionConfig) -> Result<ConnectionInfo, String> {
        cfg.validate_network()?;
        let mut config = cfg.clone();
        config.driver = "mysql".into();
        let pool = create_pool(&config).await?;
        let info = pool_info(&pool).await?;
        insert_pool(&self.pools, cfg.id.clone(), pool).await;
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
        list_available_schemas(&pool).await
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
        introspect_schema(&pool, &selected, all_schemas).await
    }

    async fn list_tables(
        &self,
        connection_id: &str,
        schema: &str,
    ) -> Result<Vec<TableNode>, String> {
        let pool = get_pool(&self.pools, connection_id).await?;
        list_schema_tables(&pool, schema).await
    }

    async fn list_objects(
        &self,
        connection_id: &str,
        schema: &str,
        group: &str,
    ) -> Result<Vec<ObjectNode>, String> {
        let pool = get_pool(&self.pools, connection_id).await?;
        list_objects(&pool, schema, group).await
    }

    async fn execute_query(
        &self,
        connection_id: &str,
        sql: &str,
    ) -> Result<QueryResult, String> {
        let pool = get_pool(&self.pools, connection_id).await?;
        execute_sql(&pool, sql).await
    }
}
