use bigdecimal::BigDecimal;
use serde_json::{Value, json};
use sqlx::{Column, Row, TypeInfo, ValueRef, postgres::PgRow};

pub fn decode(row: &PgRow, index: usize) -> Value {
    if row
        .try_get_raw(index)
        .map(|value| value.is_null())
        .unwrap_or(true)
    {
        return Value::Null;
    }
    let kind = row.column(index).type_info().name();
    match kind {
        "BOOL" => row.try_get::<bool, _>(index).map(Value::Bool),
        "INT2" => row.try_get::<i16, _>(index).map(|value| json!(value)),
        "INT4" => row.try_get::<i32, _>(index).map(|value| json!(value)),
        "INT8" => row.try_get::<i64, _>(index).map(|value| json!(value)),
        "FLOAT4" => row.try_get::<f32, _>(index).map(|value| json!(value)),
        "FLOAT8" => row.try_get::<f64, _>(index).map(|value| json!(value)),
        "NUMERIC" => row
            .try_get::<BigDecimal, _>(index)
            .map(|value| Value::String(value.to_string())),
        "JSON" | "JSONB" => row.try_get::<Value, _>(index),
        "UUID" => row
            .try_get::<uuid::Uuid, _>(index)
            .map(|value| Value::String(value.to_string())),
        "DATE" => row
            .try_get::<chrono::NaiveDate, _>(index)
            .map(|value| Value::String(value.to_string())),
        "TIME" => row
            .try_get::<chrono::NaiveTime, _>(index)
            .map(|value| Value::String(value.to_string())),
        "TIMESTAMP" => row
            .try_get::<chrono::NaiveDateTime, _>(index)
            .map(|value| Value::String(value.to_string())),
        "TIMESTAMPTZ" => row
            .try_get::<chrono::DateTime<chrono::Utc>, _>(index)
            .map(|value| Value::String(value.to_rfc3339())),
        "BYTEA" => row
            .try_get::<Vec<u8>, _>(index)
            .map(|value| Value::String(format!("<{} bytes>", value.len()))),
        // Text, varchar, enums, and other UDTs whose wire value is UTF-8 text.
        _ => decode_textish(row, index),
    }
    .unwrap_or_else(|_| Value::String(format!("<unsupported {kind}>")))
}

/// Decode values sqlx won't map to `String` (notably Postgres enums) via the raw wire bytes.
fn decode_textish(row: &PgRow, index: usize) -> Result<Value, sqlx::Error> {
    if let Ok(value) = row.try_get::<String, _>(index) {
        return Ok(Value::String(value));
    }
    let raw = row.try_get_raw(index)?;
    if let Ok(text) = raw.as_str() {
        return Ok(Value::String(text.to_owned()));
    }
    let bytes = raw
        .as_bytes()
        .map_err(|error| sqlx::Error::Decode(error))?;
    match std::str::from_utf8(bytes) {
        Ok(text) => Ok(Value::String(text.to_owned())),
        Err(_) => Ok(Value::String(format!("<{} bytes>", bytes.len()))),
    }
}
