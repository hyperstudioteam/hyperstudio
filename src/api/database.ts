import { invoke } from "@tauri-apps/api/core";
import { ConnectionProfile } from "../types/connection";
import { ConnectionInfo, QueryResult } from "../types/query";
import { SchemaInfo, SchemaNode, TableNode } from "../types/schema";

export function toConfig(profile: ConnectionProfile) {
  return {
    id: profile.id,
    name: profile.name,
    driver: profile.driver,
    host: profile.host,
    port: profile.port,
    database: profile.database,
    username: profile.username,
    password: profile.password,
    sslMode: profile.sslMode,
    schemas: profile.schemas,
    allSchemas: profile.allSchemas,
  };
}

export const databaseApi = {
  testConnection(profile: ConnectionProfile) {
    return invoke<ConnectionInfo>("test_connection", {
      config: toConfig(profile),
    });
  },
  connect(profile: ConnectionProfile) {
    return invoke<ConnectionInfo>("connect", {
      config: toConfig(profile),
    });
  },
  disconnect(connectionId: string) {
    return invoke<void>("disconnect", { connectionId });
  },
  listSchemas(connectionId: string) {
    return invoke<SchemaInfo[]>("list_schemas", { connectionId });
  },
  listSchema(connectionId: string, profile: ConnectionProfile) {
    return invoke<SchemaNode[]>("list_schema", {
      connectionId,
      schemas: profile.allSchemas ? null : profile.schemas,
      allSchemas: profile.allSchemas,
    });
  },
  listTables(connectionId: string, schema: string) {
    return invoke<TableNode[]>("list_tables", { connectionId, schema });
  },
  executeQuery(connectionId: string, sql: string) {
    return invoke<QueryResult>("execute_query", { connectionId, sql });
  },
};
