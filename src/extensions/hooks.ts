import { useSyncExternalStore } from "react";
import { extensionRegistry } from "./registry";

function useExtensionVersion() {
  return useSyncExternalStore(
    (listener) => extensionRegistry.subscribe(listener),
    extensionRegistry.snapshot,
    extensionRegistry.snapshot,
  );
}

export function useExtensionMenu(menuId: string) {
  useExtensionVersion();
  return extensionRegistry.menuItems(menuId);
}

export function useExtensionViews(location: string) {
  useExtensionVersion();
  return extensionRegistry.viewsAt(location);
}

export function useExtensionStatusItems() {
  useExtensionVersion();
  return extensionRegistry.statusBarItems();
}

export function useExtensionDataViewers(typeName?: string) {
  useExtensionVersion();
  return extensionRegistry.dataViewers(typeName);
}

export function useActiveExtensionView() {
  useExtensionVersion();
  return extensionRegistry.active();
}
