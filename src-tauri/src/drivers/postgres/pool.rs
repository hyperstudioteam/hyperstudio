use std::time::Duration;

use sqlx::{
    PgPool, Row,
    postgres::{PgConnectOptions, PgPoolOptions, PgSslMode},
};

use crate::models::{ConnectionConfig, ConnectionInfo};

pub async fn create(config: &ConnectionConfig) -> Result<PgPool, String> {
    config.validate_network()?;
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
        .map_err(|error| error.to_string())
}

pub async fn info(pool: &PgPool) -> Result<ConnectionInfo, String> {
    let row = sqlx::query("SELECT version(), current_database()")
        .fetch_one(pool)
        .await
        .map_err(|error| error.to_string())?;
    Ok(ConnectionInfo {
        server_version: row.try_get(0).unwrap_or_default(),
        database: row.try_get(1).unwrap_or_default(),
    })
}
