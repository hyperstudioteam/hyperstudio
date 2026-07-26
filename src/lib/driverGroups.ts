import { DriverInfo } from "../types/connection";
import { ObjectGroupDef, TABLES_GROUP } from "../types/schema";

const STORAGE_KEY = "hypergrid.driver-groups.v1";

/** Every driver has tables unless it says otherwise. */
export const DEFAULT_OBJECT_GROUPS: ObjectGroupDef[] = [
  {
    id: TABLES_GROUP,
    label: "Tables",
    icon: "table",
    childLabel: "Columns",
    actions: ["viewData", "editData", "editTable", "editColumn", "editKey"],
    defaultOpen: true,
  },
];

const groupsByDriver = new Map<string, ObjectGroupDef[]>();

function hydrate() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return;
    const parsed = JSON.parse(raw) as Record<string, ObjectGroupDef[]>;
    if (!parsed || typeof parsed !== "object") return;
    for (const [driverId, groups] of Object.entries(parsed)) {
      if (Array.isArray(groups)) groupsByDriver.set(driverId, groups);
    }
  } catch {
    // Ignore corrupt cache; groups get refetched with the driver list.
  }
}

hydrate();

/**
 * Remember each driver's object groups so the schema tree can render its
 * categories before (or without) an open connection.
 */
export function cacheDriverGroups(drivers: DriverInfo[]) {
  for (const driver of drivers) {
    const groups = driver.objectGroups?.length
      ? driver.objectGroups
      : DEFAULT_OBJECT_GROUPS;
    groupsByDriver.set(driver.id, groups);
  }
  localStorage.setItem(
    STORAGE_KEY,
    JSON.stringify(Object.fromEntries(groupsByDriver)),
  );
}

export function objectGroupsFor(driverId: string): ObjectGroupDef[] {
  return groupsByDriver.get(driverId) ?? DEFAULT_OBJECT_GROUPS;
}
