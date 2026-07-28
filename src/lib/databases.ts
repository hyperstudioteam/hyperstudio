import { ConnectionProfile } from "../types/connection";
import { SchemaInfo } from "../types/schema";

/** Databases the user may switch to for a Postgres multi-DB connection. */
export function selectableDatabases(
  profile: ConnectionProfile,
  available: SchemaInfo[],
): SchemaInfo[] {
  if (profile.driver !== "postgres") {
    return profile.database
      ? [{ name: profile.database, isSystem: false }]
      : [];
  }

  let list: SchemaInfo[];
  if (profile.allDatabases) {
    list =
      available.length > 0
        ? available
        : profile.database
          ? [{ name: profile.database, isSystem: false }]
          : [];
  } else if (profile.databases.length === 0) {
    list = profile.database
      ? [{ name: profile.database, isSystem: false }]
      : [];
  } else {
    const selected = new Set(profile.databases);
    const fromAvailable = available.filter((db) => selected.has(db.name));
    list =
      fromAvailable.length > 0
        ? fromAvailable
        : profile.databases.map((name) => ({ name, isSystem: false }));
  }

  if (
    profile.database &&
    !list.some((database) => database.name === profile.database)
  ) {
    return [{ name: profile.database, isSystem: false }, ...list];
  }
  return list;
}

/** Keep the active database field coherent with the multi-DB selection. */
export function syncActiveDatabase(
  profile: ConnectionProfile,
): Partial<ConnectionProfile> {
  if (profile.driver !== "postgres" || profile.allDatabases) {
    return {};
  }
  if (profile.databases.length === 0) return {};
  if (profile.databases.includes(profile.database)) return {};
  return { database: profile.databases[0] };
}
