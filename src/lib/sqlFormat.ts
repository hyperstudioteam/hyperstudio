import { format, SqlLanguage } from "sql-formatter";

/** Map a HyperStudio driver id onto a sql-formatter dialect. */
export function formatLanguageFor(driver: string): SqlLanguage {
  switch (driver) {
    case "postgres":
    case "postgresql":
    case "cockroach":
      return "postgresql";
    case "redshift":
      return "redshift";
    case "mysql":
      return "mysql";
    case "mariadb":
      return "mariadb";
    case "sqlite":
      return "sqlite";
    case "mssql":
    case "sqlserver":
      return "transactsql";
    default:
      return "sql";
  }
}

export class SqlFormatError extends Error {}

/**
 * Pretty-print SQL for the given driver. Throws SqlFormatError when the
 * statement cannot be parsed, so callers can surface it instead of silently
 * replacing the user's buffer with mangled text.
 */
export function formatSql(sql: string, driver: string): string {
  if (!sql.trim()) return sql;
  try {
    return format(sql, {
      language: formatLanguageFor(driver),
      keywordCase: "upper",
      indentStyle: "standard",
      linesBetweenQueries: 1,
    });
  } catch (error) {
    throw new SqlFormatError(
      error instanceof Error ? error.message : String(error),
    );
  }
}
