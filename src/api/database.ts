import { invoke } from "@tauri-apps/api/core";
import {
  ConnectionProfile,
  DriverInfo,
  InstalledPluginInfo,
} from "../types/connection";
import { ConnectionInfo, QueryResult } from "../types/query";
import {
  AlterColumnRequest,
  AlterKeyRequest,
  AlterTableRequest,
  ObjectGroupDef,
  ObjectNode,
  SchemaInfo,
  SchemaNode,
  TableNode,
} from "../types/schema";

export function toConfig(profile: ConnectionProfile) {
  const ssh = profile.ssh;
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
    ssh:
      ssh && ssh.enabled
        ? {
            enabled: true,
            host: ssh.host,
            port: ssh.port,
            username: ssh.username,
            auth: ssh.auth,
            password: ssh.password,
            privateKeyPath: ssh.privateKeyPath,
            passphrase: ssh.passphrase,
          }
        : null,
  };
}

export const databaseApi = {
  listDrivers() {
    return invoke<DriverInfo[]>("list_drivers");
  },
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
  listObjectGroups(connectionId: string) {
    return invoke<ObjectGroupDef[]>("list_object_groups", { connectionId });
  },
  listObjects(connectionId: string, schema: string, group: string) {
    return invoke<ObjectNode[]>("list_objects", {
      connectionId,
      schema,
      group,
    });
  },
  listObjectSubgroup(
    connectionId: string,
    schema: string,
    object: string,
    subgroup: string,
  ) {
    return invoke<ObjectNode[]>("list_object_subgroup", {
      connectionId,
      schema,
      object,
      subgroup,
    });
  },
  executeQuery(connectionId: string, sql: string) {
    return invoke<QueryResult>("execute_query", { connectionId, sql });
  },
  alterTable(connectionId: string, request: AlterTableRequest) {
    return invoke<void>("alter_table", { connectionId, request });
  },
  alterColumn(connectionId: string, request: AlterColumnRequest) {
    return invoke<void>("alter_column", { connectionId, request });
  },
  alterKey(connectionId: string, request: AlterKeyRequest) {
    return invoke<void>("alter_key", { connectionId, request });
  },
};

export const pluginsApi = {
  list() {
    return invoke<InstalledPluginInfo[]>("list_plugins");
  },
  install(sourcePath: string) {
    return invoke<InstalledPluginInfo>("install_plugin", { sourcePath });
  },
  uninstall(pluginId: string) {
    return invoke<void>("uninstall_plugin", { pluginId });
  },
  setEnabled(pluginId: string, enabled: boolean) {
    return invoke<void>("set_plugin_enabled", { pluginId, enabled });
  },
  reload() {
    return invoke<string[]>("reload_plugins");
  },
};
