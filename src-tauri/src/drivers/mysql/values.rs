use bigdecimal::BigDecimal;
use serde_json::{Value, json};
use sqlx::{Column, Row, TypeInfo, ValueRef, mysql::MySqlRow};

pub fn decode(row: &MySqlRow, index: usize) -> Value {
    if row
        .try_get_raw(index)
        .map(|value| value.is_null())
        .unwrap_or(true)
    {
        return Value::Null;
    }
    let kind = row.column(index).type_info().name().to_ascii_uppercase();
    let result = if kind.starts_with("TINYINT UNSIGNED") {
        row.try_get::<u8, _>(index).map(|value| json!(value))
    } else if kind.starts_with("SMALLINT UNSIGNED") {
        row.try_get::<u16, _>(index).map(|value| json!(value))
    } else if kind.starts_with("MEDIUMINT UNSIGNED") || kind.starts_with("INT UNSIGNED") {
        row.try_get::<u32, _>(index).map(|value| json!(value))
    } else if kind.starts_with("BIGINT UNSIGNED") {
        row.try_get::<u64, _>(index).map(|value| json!(value))
    } else if kind.starts_with("TINYINT") {
        row.try_get::<i8, _>(index).map(|value| json!(value))
    } else if kind.starts_with("SMALLINT") {
        row.try_get::<i16, _>(index).map(|value| json!(value))
    } else if kind.starts_with("MEDIUMINT") || kind.starts_with("INT") {
        row.try_get::<i32, _>(index).map(|value| json!(value))
    } else if kind.starts_with("BIGINT") {
        row.try_get::<i64, _>(index).map(|value| json!(value))
    } else if kind.starts_with("FLOAT") {
        row.try_get::<f32, _>(index).map(|value| json!(value))
    } else if kind.starts_with("DOUBLE") {
        row.try_get::<f64, _>(index).map(|value| json!(value))
    } else if kind.starts_with("DECIMAL") {
        row.try_get::<BigDecimal, _>(index)
            .map(|value| Value::String(value.to_string()))
    } else if kind.starts_with("JSON") {
        row.try_get::<Value, _>(index)
    } else if kind.starts_with("DATETIME") || kind.starts_with("TIMESTAMP") {
        // Must come before DATE — "DATETIME" also starts with "DATE".
        row.try_get::<chrono::NaiveDateTime, _>(index)
            .map(|value| Value::String(value.to_string()))
    } else if kind.starts_with("DATE") {
        row.try_get::<chrono::NaiveDate, _>(index)
            .map(|value| Value::String(value.to_string()))
    } else if kind.starts_with("TIME") {
        row.try_get::<chrono::NaiveTime, _>(index)
            .map(|value| Value::String(value.to_string()))
    } else if kind.contains("BLOB") || kind.contains("BINARY") {
        row.try_get::<Vec<u8>, _>(index)
            .map(|value| Value::String(format!("<{} bytes>", value.len())))
    } else {
        row.try_get::<String, _>(index).map(Value::String)
    };
    result.unwrap_or_else(|_| Value::String(format!("<unsupported {kind}>")))
}
