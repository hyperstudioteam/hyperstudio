# Typesense plugin for Hypergrid

Browse Typesense collections and run searches from Hypergrid.

## Install

```bash
cd plugins/typesense
cargo build --release
cp target/release/hypergrid-typesense .
```

In Hypergrid → **Plugins**, paste this folder path and install.

## Connection

| Field | Value |
| --- | --- |
| Host | `localhost` or your Typesense Cloud host |
| Port | `8108` (local) or `443` (Cloud) |
| API Key | Typesense API key (Password field under the hood) |
| Protocol | `http` or `https` (defaults to https when port is 443) |

The connection form comes from `connectionFields` in `manifest.json` — no Database /
Username fields.

## Query dialect

```sql
SHOW COLLECTIONS
DESCRIBE companies

-- Browse (what View Data / Edit Data generate):
SELECT *
FROM "collections"."companies"
LIMIT 100 OFFSET 0

-- Typesense filter + sort:
SELECT * FROM companies
WHERE num_employees:>100
ORDER BY num_employees DESC
LIMIT 50

-- Full-text search:
SEARCH companies q=stark query_by=company_name filter_by=num_employees:>100

-- Full-text inside SELECT:
SELECT * FROM companies Q 'stark' QUERY_BY company_name LIMIT 20
```

Collections appear under the `collections` schema. Each Typesense field becomes a column (`object` / array types open the JSON viewer).
