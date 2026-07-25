use serde::Deserialize;
use serde_json::{Value, json};
use std::time::Duration;

const SCHEMA_NAME: &str = "collections";
const MAX_ROWS: usize = 1_000;
/// Typesense rejects per_page above this (HTTP 422).
const MAX_PER_PAGE: usize = 250;

#[derive(Clone, Debug)]
pub struct TypesenseConfig {
    pub base_url: String,
    pub api_key: String,
}

impl TypesenseConfig {
    pub fn from_params(params: &Value) -> Result<Self, String> {
        let host = params
            .get("host")
            .and_then(|v| v.as_str())
            .unwrap_or("")
            .trim();
        if host.is_empty() {
            return Err("Host is required (e.g. localhost or xxx.a1.typesense.net).".into());
        }
        let port = params
            .get("port")
            .and_then(|v| v.as_u64())
            .unwrap_or(8108) as u16;
        let api_key = params
            .get("password")
            .and_then(|v| v.as_str())
            .unwrap_or("")
            .trim()
            .to_string();
        if api_key.is_empty() {
            return Err("API key is required — put it in the Password field.".into());
        }

        // database field doubles as protocol: "https" / "http"
        let protocol = params
            .get("database")
            .and_then(|v| v.as_str())
            .unwrap_or("")
            .trim()
            .to_ascii_lowercase();
        let scheme = if protocol == "https" || protocol == "http" {
            protocol
        } else if port == 443 {
            "https".into()
        } else {
            "http".into()
        };

        let host = host
            .trim_start_matches("https://")
            .trim_start_matches("http://")
            .trim_end_matches('/');

        let base_url = if (scheme == "http" && port == 80) || (scheme == "https" && port == 443) {
            format!("{scheme}://{host}")
        } else {
            format!("{scheme}://{host}:{port}")
        };

        Ok(Self { base_url, api_key })
    }
}

#[derive(Debug, Deserialize)]
pub struct CollectionSummary {
    pub name: String,
    #[serde(default)]
    pub fields: Vec<FieldDef>,
    #[serde(default)]
    pub num_documents: u64,
}

#[derive(Debug, Clone, Deserialize)]
pub struct FieldDef {
    pub name: String,
    #[serde(rename = "type")]
    pub field_type: String,
    #[serde(default)]
    pub optional: bool,
}

pub struct TypesenseClient {
    config: TypesenseConfig,
    agent: ureq::Agent,
}

impl TypesenseClient {
    pub fn new(config: TypesenseConfig) -> Self {
        let agent = ureq::AgentBuilder::new()
            .timeout_connect(Duration::from_secs(10))
            .timeout_read(Duration::from_secs(60))
            .build();
        Self { config, agent }
    }

    fn request(&self, method: &str, path: &str) -> ureq::Request {
        let url = format!("{}{}", self.config.base_url, path);
        let req = match method {
            "GET" => self.agent.get(&url),
            "POST" => self.agent.post(&url),
            "DELETE" => self.agent.delete(&url),
            _ => self.agent.request(method, &url),
        };
        req.set("X-TYPESENSE-API-KEY", &self.config.api_key)
            .set("Accept", "application/json")
    }

    fn read_json(&self, response: ureq::Response) -> Result<Value, String> {
        response
            .into_json::<Value>()
            .map_err(|error| format!("Failed to parse Typesense response: {error}"))
    }

    fn map_http_error(error: ureq::Error) -> String {
        match error {
            ureq::Error::Status(code, response) => {
                let body = response
                    .into_string()
                    .unwrap_or_else(|_| "(empty body)".into());
                if let Ok(value) = serde_json::from_str::<Value>(&body) {
                    if let Some(message) = value.get("message").and_then(|v| v.as_str()) {
                        return format!("Typesense HTTP {code}: {message}");
                    }
                }
                format!("Typesense HTTP {code}: {body}")
            }
            other => format!("Typesense request failed: {other}"),
        }
    }

    pub fn health(&self) -> Result<Value, String> {
        let response = self
            .request("GET", "/health")
            .call()
            .map_err(Self::map_http_error)?;
        self.read_json(response)
    }

    pub fn server_info(&self) -> Result<(String, String), String> {
        let health = self.health()?;
        let ok = health
            .get("ok")
            .and_then(|v| v.as_bool())
            .unwrap_or(false);
        if !ok {
            return Err(format!("Typesense health check failed: {health}"));
        }
        // /debug is optional; fall back to a friendly label.
        let version = self
            .request("GET", "/debug")
            .call()
            .ok()
            .and_then(|response| self.read_json(response).ok())
            .and_then(|value| {
                value
                    .get("version")
                    .and_then(|v| v.as_str())
                    .map(str::to_string)
            })
            .unwrap_or_else(|| "typesense".into());
        Ok((version, "typesense".into()))
    }

    pub fn list_collections(&self) -> Result<Vec<CollectionSummary>, String> {
        let response = self
            .request("GET", "/collections")
            .call()
            .map_err(Self::map_http_error)?;
        let value = self.read_json(response)?;
        serde_json::from_value(value)
            .map_err(|error| format!("Invalid collections response: {error}"))
    }

    pub fn get_collection(&self, name: &str) -> Result<CollectionSummary, String> {
        let path = format!("/collections/{}", urlencoding::encode(name));
        let response = self
            .request("GET", &path)
            .call()
            .map_err(Self::map_http_error)?;
        let value = self.read_json(response)?;
        serde_json::from_value(value)
            .map_err(|error| format!("Invalid collection response: {error}"))
    }

    pub fn list_aliases(&self) -> Result<Vec<Value>, String> {
        let response = self
            .request("GET", "/aliases")
            .call()
            .map_err(Self::map_http_error)?;
        let value = self.read_json(response)?;
        Ok(value
            .get("aliases")
            .and_then(|v| v.as_array())
            .cloned()
            .unwrap_or_default())
    }

    /// Synonyms can be scoped to a collection or listed cluster-wide via
    /// `/synonyms`. Prefer the cluster endpoint when available.
    pub fn list_synonyms(&self) -> Result<Vec<Value>, String> {
        match self.request("GET", "/synonyms").call() {
            Ok(response) => {
                let value = self.read_json(response)?;
                Ok(value
                    .get("synonyms")
                    .and_then(|v| v.as_array())
                    .cloned()
                    .unwrap_or_default())
            }
            Err(_) => {
                // Older Typesense builds only expose per-collection synonyms.
                let mut all = Vec::new();
                for collection in self.list_collections()? {
                    let path = format!(
                        "/collections/{}/synonyms",
                        urlencoding::encode(&collection.name)
                    );
                    if let Ok(response) = self.request("GET", &path).call() {
                        if let Ok(value) = self.read_json(response) {
                            if let Some(items) =
                                value.get("synonyms").and_then(|v| v.as_array())
                            {
                                for item in items {
                                    let mut next = item.clone();
                                    if let Some(obj) = next.as_object_mut() {
                                        obj.entry("collection".to_string())
                                            .or_insert_with(|| {
                                                Value::String(collection.name.clone())
                                            });
                                    }
                                    all.push(next);
                                }
                            }
                        }
                    }
                }
                Ok(all)
            }
        }
    }

    pub fn list_keys(&self) -> Result<Vec<Value>, String> {
        let response = self
            .request("GET", "/keys")
            .call()
            .map_err(Self::map_http_error)?;
        let value = self.read_json(response)?;
        Ok(value
            .get("keys")
            .and_then(|v| v.as_array())
            .cloned()
            .unwrap_or_default())
    }

    pub fn search(
        &self,
        collection: &str,
        params: &[(&str, String)],
    ) -> Result<Value, String> {
        let query = params
            .iter()
            .map(|(key, value)| format!("{key}={}", urlencoding::encode(value)))
            .collect::<Vec<_>>()
            .join("&");
        let path = format!(
            "/collections/{}/documents/search?{query}",
            urlencoding::encode(collection)
        );
        let response = self
            .request("GET", &path)
            .call()
            .map_err(Self::map_http_error)?;
        self.read_json(response)
    }

    #[allow(dead_code)]
    pub fn export_documents(
        &self,
        collection: &str,
        limit: usize,
    ) -> Result<Vec<Value>, String> {
        let path = format!(
            "/collections/{}/documents/export",
            urlencoding::encode(collection)
        );
        let response = self
            .request("GET", &path)
            .call()
            .map_err(Self::map_http_error)?;
        let body = response
            .into_string()
            .map_err(|error| format!("Failed to read export body: {error}"))?;
        let mut docs = Vec::new();
        for line in body.lines() {
            if line.trim().is_empty() {
                continue;
            }
            let doc: Value = serde_json::from_str(line)
                .map_err(|error| format!("Invalid export line: {error}"))?;
            docs.push(doc);
            if docs.len() >= limit {
                break;
            }
        }
        Ok(docs)
    }
}

pub fn schema_name() -> &'static str {
    SCHEMA_NAME
}

pub fn max_rows() -> usize {
    MAX_ROWS
}

pub fn max_per_page() -> usize {
    MAX_PER_PAGE
}

pub fn field_to_column(field: &FieldDef) -> Value {
    let primary = field.name == "id";
    json!({
        "name": field.name,
        "dataType": field.field_type,
        "nullable": field.optional && !primary,
        "primaryKey": primary,
    })
}

pub fn collection_to_table(collection: &CollectionSummary) -> Value {
    let mut columns: Vec<Value> = collection.fields.iter().map(field_to_column).collect();
    if !columns.iter().any(|column| column.get("name").and_then(|v| v.as_str()) == Some("id")) {
        columns.insert(
            0,
            json!({
                "name": "id",
                "dataType": "string",
                "nullable": false,
                "primaryKey": true,
            }),
        );
    }
    json!({
        "name": collection.name,
        "kind": "BASE TABLE",
        "columns": columns,
    })
}

pub fn collection_to_object(collection: &CollectionSummary) -> Value {
    let table = collection_to_table(collection);
    json!({
        "name": collection.name,
        "kind": "COLLECTION",
        "detail": format!("{} docs", collection.num_documents),
        "children": table.get("columns").cloned().unwrap_or(json!([])),
        "actions": ["viewData", "editData"],
    })
}

pub fn alias_to_object(alias: &Value) -> Option<Value> {
    let name = alias.get("name")?.as_str()?.to_string();
    let collection = alias
        .get("collection_name")
        .or_else(|| alias.get("collectionName"))
        .and_then(|v| v.as_str())
        .unwrap_or("");
    Some(json!({
        "name": name,
        "kind": "ALIAS",
        "detail": if collection.is_empty() {
            Value::Null
        } else {
            Value::String(format!("→ {collection}"))
        },
        "children": [],
    }))
}

pub fn synonym_to_object(synonym: &Value) -> Option<Value> {
    let name = synonym
        .get("id")
        .or_else(|| synonym.get("name"))
        .and_then(|v| v.as_str())?
        .to_string();
    let root = synonym
        .get("root")
        .and_then(|v| v.as_str())
        .unwrap_or("");
    let synonyms = synonym
        .get("synonyms")
        .and_then(|v| v.as_array())
        .map(|items| {
            items
                .iter()
                .filter_map(|item| item.as_str())
                .collect::<Vec<_>>()
                .join(", ")
        })
        .unwrap_or_default();
    let collection = synonym
        .get("collection")
        .and_then(|v| v.as_str())
        .unwrap_or("");
    let detail = if !root.is_empty() {
        format!("{root} · {synonyms}")
    } else if !synonyms.is_empty() {
        synonyms
    } else if !collection.is_empty() {
        collection.to_string()
    } else {
        String::new()
    };
    Some(json!({
        "name": name,
        "kind": "SYNONYM",
        "detail": if detail.is_empty() { Value::Null } else { Value::String(detail) },
        "children": [],
    }))
}

pub fn key_to_object(key: &Value) -> Option<Value> {
    let id = key
        .get("id")
        .map(|v| match v {
            Value::Number(n) => n.to_string(),
            Value::String(s) => s.clone(),
            _ => String::new(),
        })
        .filter(|s| !s.is_empty())?;
    let description = key
        .get("description")
        .and_then(|v| v.as_str())
        .unwrap_or("");
    let actions = key
        .get("actions")
        .and_then(|v| v.as_array())
        .map(|items| {
            items
                .iter()
                .filter_map(|item| item.as_str())
                .take(3)
                .collect::<Vec<_>>()
                .join(", ")
        })
        .unwrap_or_default();
    let detail = if !description.is_empty() {
        description.to_string()
    } else {
        actions
    };
    Some(json!({
        "name": id,
        "kind": "API_KEY",
        "detail": if detail.is_empty() { Value::Null } else { Value::String(detail) },
        "children": [],
    }))
}

/// Flatten document hits into a rectangular result set.
pub fn documents_to_result(docs: &[Value], columns: &[String]) -> Value {
    let rows: Vec<Value> = docs
        .iter()
        .map(|doc| {
            let cells: Vec<Value> = columns
                .iter()
                .map(|column| cell_value(doc.get(column).unwrap_or(&Value::Null)))
                .collect();
            Value::Array(cells)
        })
        .collect();
    json!({
        "columns": columns,
        "rows": rows,
        "affectedRows": 0,
        "truncated": docs.len() >= MAX_ROWS,
    })
}

pub fn cell_value(value: &Value) -> Value {
    match value {
        Value::Null => Value::Null,
        Value::Bool(b) => Value::Bool(*b),
        Value::Number(n) => Value::Number(n.clone()),
        Value::String(s) => Value::String(s.clone()),
        other => Value::String(other.to_string()),
    }
}

pub fn default_query_by(fields: &[FieldDef]) -> String {
    let string_fields: Vec<&str> = fields
        .iter()
        .filter(|field| {
            field.field_type == "string"
                || field.field_type == "string[]"
                || field.field_type.starts_with("string")
        })
        .map(|field| field.name.as_str())
        .collect();
    if !string_fields.is_empty() {
        return string_fields.join(",");
    }
    fields
        .first()
        .map(|field| field.name.clone())
        .unwrap_or_else(|| "id".into())
}

pub fn columns_from_docs(docs: &[Value], schema_fields: &[FieldDef]) -> Vec<String> {
    let mut columns: Vec<String> = schema_fields.iter().map(|f| f.name.clone()).collect();
    if columns.is_empty() {
        let mut seen = std::collections::BTreeSet::new();
        for doc in docs {
            if let Some(obj) = doc.as_object() {
                for key in obj.keys() {
                    seen.insert(key.clone());
                }
            }
        }
        columns = seen.into_iter().collect();
    }
    if !columns.iter().any(|name| name == "id") {
        columns.insert(0, "id".into());
    }
    columns
}
