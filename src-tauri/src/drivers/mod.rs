pub mod mysql;
pub mod objects_common;
pub mod postgres;
pub mod query_common;
pub mod schema_common;
mod shared;

use std::collections::HashMap;
use std::sync::Arc;

use async_trait::async_trait;
use tokio::sync::RwLock;

use crate::models::{
    AlterColumnRequest, AlterKeyRequest, AlterTableRequest, ColumnTypeDeclaration,
    ConnectionConfig, ConnectionFieldDef, ConnectionInfo, DriverCapabilities, DriverInfo,
    ObjectGroupDef, ObjectNode, QueryResult, SchemaInfo, SchemaNode, TableNode,
};

pub use mysql::NativeMySql;
pub use postgres::NativePostgres;

pub const BUILTIN_DRIVER_IDS: [&str; 2] = ["postgres", "mysql"];

#[async_trait]
pub trait DatabaseDriver: Send + Sync {
    fn id(&self) -> &str;
    fn name(&self) -> &str;
    fn version(&self) -> &str;
    fn description(&self) -> &str;
    fn builtin(&self) -> bool;
    fn default_port(&self) -> Option<u16>;
    fn capabilities(&self) -> DriverCapabilities;

    /// Declarative column-type contributions surfaced to the UI registry.
    fn column_types(&self) -> Vec<ColumnTypeDeclaration> {
        Vec::new()
    }

    /// Custom connection-form fields. Empty means use the built-in SQL form.
    fn connection_fields(&self) -> Vec<ConnectionFieldDef> {
        Vec::new()
    }

    /// Object categories shown under each schema. Defaults to tables only.
    fn object_groups(&self) -> Vec<ObjectGroupDef> {
        vec![ObjectGroupDef::tables()]
    }

    fn info(&self) -> DriverInfo {
        DriverInfo {
            id: self.id().into(),
            name: self.name().into(),
            version: self.version().into(),
            description: self.description().into(),
            builtin: self.builtin(),
            default_port: self.default_port(),
            capabilities: self.capabilities(),
            column_types: self.column_types(),
            connection_fields: self.connection_fields(),
            object_groups: self.object_groups(),
        }
    }

    async fn test_connection(&self, cfg: &ConnectionConfig) -> Result<ConnectionInfo, String>;
    async fn connect(&self, cfg: &ConnectionConfig) -> Result<ConnectionInfo, String>;
    async fn disconnect(&self, connection_id: &str) -> Result<(), String>;
    async fn list_schemas(&self, connection_id: &str) -> Result<Vec<SchemaInfo>, String>;
    async fn list_schema(
        &self,
        connection_id: &str,
        schemas: Option<Vec<String>>,
        all_schemas: bool,
    ) -> Result<Vec<SchemaNode>, String>;
    async fn list_tables(
        &self,
        connection_id: &str,
        schema: &str,
    ) -> Result<Vec<TableNode>, String>;

    /// Objects inside one declared group. The default implementation only
    /// knows how to answer for `tables`, which keeps simple drivers trivial.
    async fn list_objects(
        &self,
        connection_id: &str,
        schema: &str,
        group: &str,
    ) -> Result<Vec<ObjectNode>, String> {
        if group != "tables" {
            return Err(format!("Driver '{}' has no group '{group}'.", self.id()));
        }
        Ok(self
            .list_tables(connection_id, schema)
            .await?
            .into_iter()
            .map(ObjectNode::from)
            .collect())
    }

    async fn list_object_subgroup(
        &self,
        _connection_id: &str,
        _schema: &str,
        _object: &str,
        subgroup: &str,
    ) -> Result<Vec<ObjectNode>, String> {
        Err(format!(
            "Driver '{}' has no object subgroup '{subgroup}'.",
            self.id()
        ))
    }

    async fn alter_table(
        &self,
        _connection_id: &str,
        _request: AlterTableRequest,
    ) -> Result<(), String> {
        Err(format!(
            "Driver '{}' does not support alter_table.",
            self.id()
        ))
    }

    async fn alter_column(
        &self,
        _connection_id: &str,
        _request: AlterColumnRequest,
    ) -> Result<(), String> {
        Err(format!(
            "Driver '{}' does not support alter_column.",
            self.id()
        ))
    }

    async fn alter_key(
        &self,
        _connection_id: &str,
        _request: AlterKeyRequest,
    ) -> Result<(), String> {
        Err(format!("Driver '{}' does not support alter_key.", self.id()))
    }

    async fn execute_query(&self, connection_id: &str, sql: &str) -> Result<QueryResult, String>;

    /// Run every statement in one transaction, returning affected rows per
    /// statement. Only offered by drivers whose capabilities set
    /// `transactions`; callers fall back to statement-at-a-time execution.
    async fn execute_batch(
        &self,
        _connection_id: &str,
        _statements: &[String],
    ) -> Result<Vec<u64>, String> {
        Err(format!(
            "Driver '{}' does not support transactions.",
            self.id()
        ))
    }
}

pub struct DriverRegistry {
    drivers: RwLock<HashMap<String, Arc<dyn DatabaseDriver>>>,
    /// connection_id → driver_id
    connections: RwLock<HashMap<String, String>>,
}

impl Default for DriverRegistry {
    fn default() -> Self {
        Self::with_builtins()
    }
}

impl DriverRegistry {
    pub fn with_builtins() -> Self {
        let mut drivers: HashMap<String, Arc<dyn DatabaseDriver>> = HashMap::new();
        let postgres: Arc<dyn DatabaseDriver> = Arc::new(NativePostgres::new());
        let mysql: Arc<dyn DatabaseDriver> = Arc::new(NativeMySql::new());
        drivers.insert(postgres.id().into(), postgres);
        drivers.insert(mysql.id().into(), mysql);
        Self {
            drivers: RwLock::new(drivers),
            connections: RwLock::new(HashMap::new()),
        }
    }

    pub async fn register(&self, driver: Arc<dyn DatabaseDriver>) -> Result<(), String> {
        let id = driver.id().to_string();
        if BUILTIN_DRIVER_IDS.contains(&id.as_str()) && !driver.builtin() {
            return Err(format!(
                "Plugin id '{id}' collides with a built-in driver and was refused"
            ));
        }
        self.drivers.write().await.insert(id, driver);
        Ok(())
    }

    pub async fn unregister(&self, id: &str) -> Result<(), String> {
        if BUILTIN_DRIVER_IDS.contains(&id) {
            return Err("Cannot unregister a built-in driver.".into());
        }
        let mut drivers = self.drivers.write().await;
        if drivers.remove(id).is_none() {
            return Err(format!("Driver '{id}' is not registered."));
        }
        Ok(())
    }

    pub async fn get(&self, id: &str) -> Result<Arc<dyn DatabaseDriver>, String> {
        self.drivers
            .read()
            .await
            .get(id)
            .cloned()
            .ok_or_else(|| format!("Unknown driver '{id}'."))
    }

    pub async fn list(&self) -> Vec<DriverInfo> {
        let mut list: Vec<_> = self
            .drivers
            .read()
            .await
            .values()
            .map(|driver| driver.info())
            .collect();
        list.sort_by(|a, b| {
            b.builtin
                .cmp(&a.builtin)
                .then_with(|| a.name.to_lowercase().cmp(&b.name.to_lowercase()))
        });
        list
    }

    pub async fn bind_connection(&self, connection_id: String, driver_id: String) {
        self.connections
            .write()
            .await
            .insert(connection_id, driver_id);
    }

    pub async fn unbind_connection(&self, connection_id: &str) -> Option<String> {
        self.connections.write().await.remove(connection_id)
    }

    pub async fn driver_for_connection(
        &self,
        connection_id: &str,
    ) -> Result<Arc<dyn DatabaseDriver>, String> {
        let driver_id = self
            .connections
            .read()
            .await
            .get(connection_id)
            .cloned()
            .ok_or_else(|| "Connection is not active.".to_string())?;
        self.get(&driver_id).await
    }
}
