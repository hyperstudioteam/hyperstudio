use std::time::Duration;

use sqlx::{
    MySqlPool, Row,
    mysql::{MySqlConnectOptions, MySqlPoolOptions, MySqlSslMode},
};

use crate::models::{ConnectionConfig, ConnectionInfo};

pub async fn create(config: &ConnectionConfig) -> Result<MySqlPool, String> {
    config.validate_network()?;
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
        .map_err(|error| error.to_string())
}

pub async fn info(pool: &MySqlPool) -> Result<ConnectionInfo, String> {
    let row = sqlx::query("SELECT VERSION(), DATABASE()")
        .fetch_one(pool)
        .await
        .map_err(|error| error.to_string())?;
    Ok(ConnectionInfo {
        server_version: row.try_get(0).unwrap_or_default(),
        database: row.try_get(1).unwrap_or_default(),
    })
}
