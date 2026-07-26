import { ObjectGroupDef, ObjectNode, SchemaNode } from "../types/schema";

export interface SchemaSearchResult {
  /** Schemas reduced to the branches that matched. */
  schemas: SchemaNode[];
  /** Branches to force open so matches are visible without manual expanding. */
  openSchemas: string[];
  openGroups: Array<{ schema: string; group: string }>;
  openObjects: Array<{ schema: string; group: string; object: string }>;
  matches: number;
}

function contains(haystack: string, needle: string): boolean {
  return haystack.toLowerCase().includes(needle);
}

/**
 * Narrow the schema tree to entries matching `query`.
 *
 * Only cached metadata can be searched — groups that have never been expanded
 * hold no objects yet, so they are simply absent from the results.
 * Returns null for a blank query, meaning "show the full tree".
 */
export function filterSchemaTree(
  schemas: SchemaNode[],
  groups: ObjectGroupDef[],
  query: string,
): SchemaSearchResult | null {
  const needle = query.trim().toLowerCase();
  if (!needle) return null;

  const result: SchemaSearchResult = {
    schemas: [],
    openSchemas: [],
    openGroups: [],
    openObjects: [],
    matches: 0,
  };

  for (const schema of schemas) {
    const schemaMatches = contains(schema.name, needle);
    const objects: SchemaNode["objects"] = {};
    let schemaHits = 0;

    for (const group of groups) {
      const loaded = schema.objects[group.id];
      if (!loaded) continue;

      const kept: ObjectNode[] = [];
      for (const object of loaded) {
        const nameHit = contains(object.name, needle);
        const columnHits = object.children.filter((column) =>
          contains(column.name, needle),
        );

        // A schema-name match keeps everything beneath it.
        if (schemaMatches) {
          kept.push(object);
          continue;
        }
        if (!nameHit && columnHits.length === 0) continue;

        kept.push(object);
        schemaHits += nameHit ? 1 : columnHits.length;
        result.openGroups.push({ schema: schema.name, group: group.id });
        if (!nameHit) {
          result.openObjects.push({
            schema: schema.name,
            group: group.id,
            object: object.name,
          });
        }
      }

      if (kept.length > 0) objects[group.id] = kept;
    }

    const hasContent = Object.keys(objects).length > 0;
    if (!schemaMatches && !hasContent) continue;

    result.schemas.push({ ...schema, objects });
    result.openSchemas.push(schema.name);
    result.matches += schemaMatches ? 1 : schemaHits;
  }

  return result;
}
