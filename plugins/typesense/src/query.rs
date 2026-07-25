use serde_json::{Value, json};

use crate::client::{
    TypesenseClient, columns_from_docs, default_query_by, documents_to_result, max_per_page,
    max_rows, schema_name,
};

#[derive(Debug)]
pub enum Query {
    ShowCollections,
    Describe(String),
    /// Browse / filter a collection via Typesense search (q=* by default).
    Select {
        collection: String,
        filter_by: Option<String>,
        sort_by: Option<String>,
        limit: usize,
        offset: usize,
        query_text: Option<String>,
        query_by: Option<String>,
    },
    /// Native Typesense search: SEARCH companies q=stark query_by=company_name
    Search {
        collection: String,
        params: Vec<(String, String)>,
    },
}

pub fn execute(client: &TypesenseClient, sql: &str) -> Result<Value, String> {
    let query = parse(sql)?;
    match query {
        Query::ShowCollections => {
            let collections = client.list_collections()?;
            let columns: Vec<String> = vec![
                "name".into(),
                "num_documents".into(),
                "fields".into(),
            ];
            let rows: Vec<Value> = collections
                .iter()
                .map(|collection| {
                    json!([
                        collection.name,
                        collection.num_documents,
                        collection.fields.len() as u64
                    ])
                })
                .collect();
            Ok(json!({
                "columns": columns,
                "rows": rows,
                "affectedRows": 0,
                "truncated": false,
            }))
        }
        Query::Describe(name) => {
            let collection = client.get_collection(&name)?;
            let columns: Vec<String> = vec![
                "name".into(),
                "type".into(),
                "optional".into(),
            ];
            let rows: Vec<Value> = collection
                .fields
                .iter()
                .map(|field| json!([field.name, field.field_type, field.optional]))
                .collect();
            Ok(json!({
                "columns": columns,
                "rows": rows,
                "affectedRows": 0,
                "truncated": false,
            }))
        }
        Query::Select {
            collection,
            filter_by,
            sort_by,
            limit,
            offset,
            query_text,
            query_by,
        } => {
            let meta = client.get_collection(&collection)?;
            let q = query_text.unwrap_or_else(|| "*".into());
            let by = query_by.unwrap_or_else(|| default_query_by(&meta.fields));
            let limit = limit.min(max_per_page()).min(max_rows()).max(1);
            let mut params = vec![
                ("q", q),
                ("query_by", by),
                ("per_page", limit.to_string()),
            ];
            if offset > 0 {
                params.push(("offset", offset.to_string()));
            }
            if let Some(filter) = filter_by {
                if !filter.is_empty() {
                    params.push(("filter_by", filter));
                }
            }
            if let Some(sort) = sort_by {
                if !sort.is_empty() {
                    params.push(("sort_by", sort));
                }
            }
            let param_refs: Vec<(&str, String)> =
                params.into_iter().map(|(k, v)| (k, v)).collect();
            let response = client.search(&collection, &param_refs)?;
            let hits = response
                .get("hits")
                .and_then(|v| v.as_array())
                .cloned()
                .unwrap_or_default();
            let docs: Vec<Value> = hits
                .into_iter()
                .filter_map(|hit| hit.get("document").cloned())
                .collect();
            let columns = columns_from_docs(&docs, &meta.fields);
            Ok(documents_to_result(&docs, &columns))
        }
        Query::Search {
            collection,
            params,
        } => {
            let meta = client.get_collection(&collection).ok();
            let mut map: Vec<(String, String)> = params;
            if !map.iter().any(|(k, _)| k == "q") {
                map.push(("q".into(), "*".into()));
            }
            if !map.iter().any(|(k, _)| k == "query_by") {
                let by = meta
                    .as_ref()
                    .map(|m| default_query_by(&m.fields))
                    .unwrap_or_else(|| "id".into());
                map.push(("query_by".into(), by));
            }
            if let Some((_, value)) = map.iter_mut().find(|(k, _)| k == "per_page") {
                let n: usize = value.parse().unwrap_or(100);
                *value = n.min(max_per_page()).to_string();
            } else {
                map.push(("per_page".into(), "100".into()));
            }
            let param_refs: Vec<(&str, String)> =
                map.iter().map(|(k, v)| (k.as_str(), v.clone())).collect();
            let response = client.search(&collection, &param_refs)?;
            let hits = response
                .get("hits")
                .and_then(|v| v.as_array())
                .cloned()
                .unwrap_or_default();
            let docs: Vec<Value> = hits
                .into_iter()
                .filter_map(|hit| hit.get("document").cloned())
                .collect();
            let fields = meta.as_ref().map(|m| m.fields.as_slice()).unwrap_or(&[]);
            let columns = columns_from_docs(&docs, fields);
            let mut result = documents_to_result(&docs, &columns);
            if let Some(found) = response.get("found") {
                result
                    .as_object_mut()
                    .map(|obj| obj.insert("affectedRows".into(), found.clone()));
            }
            Ok(result)
        }
    }
}

pub fn parse(sql: &str) -> Result<Query, String> {
    let trimmed = sql
        .trim()
        .trim_end_matches(';')
        .trim();
    if trimmed.is_empty() {
        return Err("Enter a SQL / SEARCH statement first.".into());
    }
    let lower = trimmed.to_ascii_lowercase();

    if lower == "show collections"
        || lower == "show tables"
        || lower == "show schemas"
    {
        return Ok(Query::ShowCollections);
    }

    if let Some(rest) = strip_prefix_ci(trimmed, "describe ") {
        let name = unquote(rest.trim());
        if name.is_empty() {
            return Err("DESCRIBE requires a collection name.".into());
        }
        return Ok(Query::Describe(name));
    }
    if let Some(rest) = strip_prefix_ci(trimmed, "show columns from ") {
        let name = unquote(rest.trim());
        return Ok(Query::Describe(name));
    }

    if let Some(rest) = strip_prefix_ci(trimmed, "search ") {
        return parse_search(rest.trim());
    }

    if lower.starts_with("select") {
        return parse_select(trimmed);
    }

    Err(format!(
        "Unsupported query. Try:\n\
         SHOW COLLECTIONS\n\
         DESCRIBE companies\n\
         SELECT * FROM collections.companies LIMIT 100\n\
         SEARCH companies q=stark query_by=company_name\n\
         Got: {trimmed}"
    ))
}

fn parse_search(rest: &str) -> Result<Query, String> {
    let rest = rest.trim();
    let (collection, after_name) = if rest.starts_with('"') || rest.starts_with('`') {
        let quote = rest.chars().next().unwrap();
        let end = rest[1..]
            .find(quote)
            .ok_or_else(|| "Unclosed quoted collection name.".to_string())?
            + 1;
        let name = rest[1..end].to_string();
        (name, rest[end + 1..].trim())
    } else {
        let mut parts = rest.splitn(2, char::is_whitespace);
        let name = parts.next().unwrap_or("").to_string();
        let after = parts.next().unwrap_or("").trim();
        (name, after)
    };
    if collection.is_empty() {
        return Err("SEARCH requires a collection name.".into());
    }

    let mut params = Vec::new();
    for token in after_name.split_whitespace() {
        if let Some((key, value)) = token.split_once('=') {
            params.push((key.to_string(), strip_quotes(value).to_string()));
        }
    }
    Ok(Query::Search {
        collection,
        params,
    })
}

fn parse_select(sql: &str) -> Result<Query, String> {
    let lower = sql.to_ascii_lowercase();
    let from_idx = find_from_clause(&lower)
        .ok_or_else(|| "SELECT requires a FROM clause.".to_string())?;
    // Skip the "from" keyword and following whitespace
    let after_keyword = &sql[from_idx + 4..];
    let after_from = after_keyword.trim_start();
    let skipped = after_keyword.len() - after_from.len();
    let _ = skipped;

    let (table_part, rest) = split_clause_start(after_from);
    let collection = resolve_collection(table_part)?;

    let mut filter_by = None;
    let mut sort_by = None;
    let mut limit = 100usize;
    let mut offset = 0usize;
    let mut query_text = None;
    let mut query_by = None;

    let rest_lower = rest.to_ascii_lowercase();
    let mut cursor = 0usize;
    while cursor < rest.len() {
        let slice_lower = &rest_lower[cursor..];
        if let Some(rel) = find_keyword(slice_lower, "where ") {
            let start = cursor + rel + 6;
            let (clause, next) = take_until_keyword(&rest[start..]);
            filter_by = Some(clause.trim().to_string());
            cursor = start + next;
            continue;
        }
        if let Some(rel) = find_keyword(slice_lower, "order by ") {
            let start = cursor + rel + 9;
            let (clause, next) = take_until_keyword(&rest[start..]);
            sort_by = Some(normalize_sort(clause.trim()));
            cursor = start + next;
            continue;
        }
        if let Some(rel) = find_keyword(slice_lower, "limit ") {
            let start = cursor + rel + 6;
            let (clause, next) = take_until_keyword(&rest[start..]);
            limit = clause
                .trim()
                .split_whitespace()
                .next()
                .and_then(|v| v.parse().ok())
                .unwrap_or(100);
            cursor = start + next;
            continue;
        }
        if let Some(rel) = find_keyword(slice_lower, "offset ") {
            let start = cursor + rel + 7;
            let (clause, next) = take_until_keyword(&rest[start..]);
            offset = clause
                .trim()
                .split_whitespace()
                .next()
                .and_then(|v| v.parse().ok())
                .unwrap_or(0);
            cursor = start + next;
            continue;
        }
        // Optional Typesense extensions: Q 'text' QUERY_BY field
        if let Some(rel) = find_keyword(slice_lower, "q ") {
            let start = cursor + rel + 2;
            let (clause, next) = take_until_keyword(&rest[start..]);
            query_text = Some(strip_quotes(clause.trim()).to_string());
            cursor = start + next;
            continue;
        }
        if let Some(rel) = find_keyword(slice_lower, "query_by ") {
            let start = cursor + rel + 9;
            let (clause, next) = take_until_keyword(&rest[start..]);
            query_by = Some(strip_quotes(clause.trim()).to_string());
            cursor = start + next;
            continue;
        }
        break;
    }

    Ok(Query::Select {
        collection,
        filter_by,
        sort_by,
        limit,
        offset,
        query_text,
        query_by,
    })
}

fn resolve_collection(table_part: &str) -> Result<String, String> {
    let cleaned = table_part.trim().trim_end_matches(',');
    let parts: Vec<String> = split_ident_path(cleaned);
    match parts.as_slice() {
        [schema, table] if schema == schema_name() || schema == "public" => Ok(table.clone()),
        [table] => Ok(table.clone()),
        [_, table] => Ok(table.clone()), // tolerate other schema names
        _ => Err(format!("Could not parse table name from '{table_part}'.")),
    }
}

fn split_ident_path(input: &str) -> Vec<String> {
    let mut parts = Vec::new();
    let mut current = String::new();
    let mut chars = input.chars().peekable();
    while let Some(ch) = chars.next() {
        match ch {
            '"' | '`' => {
                let quote = ch;
                while let Some(c) = chars.next() {
                    if c == quote {
                        break;
                    }
                    current.push(c);
                }
            }
            '.' => {
                if !current.is_empty() {
                    parts.push(std::mem::take(&mut current));
                }
            }
            c if c.is_whitespace() => break,
            c => current.push(c),
        }
    }
    if !current.is_empty() {
        parts.push(current);
    }
    parts
}

fn find_from_clause(lower: &str) -> Option<usize> {
    // Match " from " or start-of-line / newline "from "
    if let Some(idx) = lower.find(" from ") {
        return Some(idx + 1); // point at 'f'
    }
    if lower.starts_with("from ") {
        return Some(0);
    }
    lower.find("\nfrom ").map(|idx| idx + 1)
}

fn split_clause_start(after_from: &str) -> (&str, &str) {
    let lower = after_from.to_ascii_lowercase();
    let mut end = after_from.len();
    for keyword in [" where ", " order by ", " limit ", " offset ", " q ", " query_by "] {
        if let Some(idx) = lower.find(keyword) {
            end = end.min(idx);
        }
    }
    // Also handle newline-separated clauses without leading space in lower find —
    // keywords already include spaces; check line starts.
    for (idx, _) in lower.match_indices('\n') {
        let next = lower[idx..].trim_start();
        if next.starts_with("where ")
            || next.starts_with("order by ")
            || next.starts_with("limit ")
            || next.starts_with("offset ")
        {
            end = end.min(idx);
            break;
        }
    }
    (&after_from[..end], after_from[end..].trim())
}

fn find_keyword(haystack_lower: &str, keyword: &str) -> Option<usize> {
    let bare = keyword.trim_start();
    if haystack_lower.starts_with(bare) {
        return Some(0);
    }
    haystack_lower.find(keyword).or_else(|| {
        // newline-prefixed keyword
        haystack_lower.find(&format!("\n{bare}")).map(|idx| idx + 1)
    })
}

fn take_until_keyword(rest: &str) -> (&str, usize) {
    let lower = rest.to_ascii_lowercase();
    let mut end = rest.len();
    for keyword in [" where ", " order by ", " limit ", " offset ", " q ", " query_by "] {
        if let Some(idx) = lower.find(keyword) {
            end = end.min(idx);
        }
    }
    // newline + keyword
    for (idx, _) in lower.match_indices('\n') {
        let next = lower[idx..].trim_start();
        if next.starts_with("where ")
            || next.starts_with("order by ")
            || next.starts_with("limit ")
            || next.starts_with("offset ")
            || next.starts_with("q ")
            || next.starts_with("query_by ")
        {
            end = end.min(idx);
            break;
        }
    }
    (&rest[..end], end)
}

fn normalize_sort(clause: &str) -> String {
    // "num_employees DESC, name ASC" → "num_employees:desc,name:asc"
    clause
        .split(',')
        .map(|part| {
            let tokens: Vec<&str> = part.split_whitespace().collect();
            match tokens.as_slice() {
                [field, dir] => {
                    let d = dir.to_ascii_lowercase();
                    let mapped = if d.starts_with("desc") {
                        "desc"
                    } else {
                        "asc"
                    };
                    format!("{}:{mapped}", unquote(field))
                }
                [field] => {
                    let f = unquote(field);
                    if f.contains(':') {
                        f
                    } else {
                        format!("{f}:asc")
                    }
                }
                _ => part.trim().to_string(),
            }
        })
        .collect::<Vec<_>>()
        .join(",")
}

fn strip_prefix_ci<'a>(input: &'a str, prefix: &str) -> Option<&'a str> {
    if input.len() >= prefix.len() && input[..prefix.len()].eq_ignore_ascii_case(prefix) {
        Some(&input[prefix.len()..])
    } else {
        None
    }
}

fn unquote(input: &str) -> String {
    strip_quotes(input.trim()).to_string()
}

fn strip_quotes(input: &str) -> &str {
    let trimmed = input.trim();
    if (trimmed.starts_with('"') && trimmed.ends_with('"'))
        || (trimmed.starts_with('`') && trimmed.ends_with('`'))
        || (trimmed.starts_with('\'') && trimmed.ends_with('\''))
    {
        &trimmed[1..trimmed.len() - 1]
    } else {
        trimmed
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_select_from_schema_table() {
        let q = parse(
            "SELECT *\nFROM \"collections\".\"companies\"\nLIMIT 100 OFFSET 0;",
        )
        .unwrap();
        match q {
            Query::Select {
                collection,
                limit,
                offset,
                ..
            } => {
                assert_eq!(collection, "companies");
                assert_eq!(limit, 100);
                assert_eq!(offset, 0);
            }
            _ => panic!("expected Select"),
        }
    }

    #[test]
    fn parses_search() {
        let q = parse("SEARCH companies q=stark query_by=company_name").unwrap();
        match q {
            Query::Search { collection, params } => {
                assert_eq!(collection, "companies");
                assert!(params.iter().any(|(k, v)| k == "q" && v == "stark"));
            }
            _ => panic!("expected Search"),
        }
    }
}
