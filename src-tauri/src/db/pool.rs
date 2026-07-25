use std::time::Duration;

use sqlx::{
    Row,
    mysql::{MySqlConnectOptions, MySqlPoolOptions, MySqlSslMode},
    postgres::{PgConnectOptions, PgPoolOptions, PgSslMode},
};

use crate::db::state::DatabasePool;
use crate::models::{ConnectionConfig, ConnectionInfo};

pub async fn create_pool(config: &ConnectionConfig) -> Result<DatabasePool, String> {
    config.validate()?;

    match config.driver.as_str() {
        "postgres" => {
            let ssl_mode = match config.ssl_mode.as_str() {
                "disable" => PgSslMode::Disable,
                "require" => PgSslMode::Require,
                _ => PgSslMode::Prefer,
            };
            let options = PgConnectOptions::new()
                .host(&config.host)
                .port(config.port)
                .database(&config.database)
                .username(&config.username)
                .password(&config.password)
                .ssl_mode(ssl_mode);
            PgPoolOptions::new()
                .max_connections(5)
                .acquire_timeout(Duration::from_secs(10))
                .connect_with(options)
                .await
                .map(DatabasePool::Postgres)
                .map_err(|error| error.to_string())
        }
        "mysql" => {
            let ssl_mode = match config.ssl_mode.as_str() {
                "disable" => MySqlSslMode::Disabled,
                "require" => MySqlSslMode::Required,
                _ => MySqlSslMode::Preferred,
            };
            let options = MySqlConnectOptions::new()
                .host(&config.host)
                .port(config.port)
                .database(&config.database)
                .username(&config.username)
                .password(&config.password)
                .ssl_mode(ssl_mode);
            MySqlPoolOptions::new()
                .max_connections(5)
                .acquire_timeout(Duration::from_secs(10))
                .connect_with(options)
                .await
                .map(DatabasePool::MySql)
                .map_err(|error| error.to_string())
        }
        _ => unreachable!(),
    }
}

pub async fn pool_info(pool: &DatabasePool) -> Result<ConnectionInfo, String> {
    match pool {
        DatabasePool::Postgres(pool) => {
            let row = sqlx::query("SELECT version(), current_database()")
                .fetch_one(pool)
                .await
                .map_err(|error| error.to_string())?;
            Ok(ConnectionInfo {
                server_version: row.try_get(0).unwrap_or_default(),
                database: row.try_get(1).unwrap_or_default(),
            })
        }
        DatabasePool::MySql(pool) => {
            let row = sqlx::query("SELECT VERSION(), DATABASE()")
                .fetch_one(pool)
                .await
                .map_err(|error| error.to_string())?;
            Ok(ConnectionInfo {
                server_version: row.try_get(0).unwrap_or_default(),
                database: row.try_get(1).unwrap_or_default(),
            })
        }
    }
}
