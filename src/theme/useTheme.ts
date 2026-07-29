import { useCallback, useSyncExternalStore } from "react";
import { applyTheme, loadThemeId, saveThemeId } from "./applyTheme";
import {
  getThemeDefinition,
  listThemeFamilies,
  listThemeInfos,
  themeIdFor,
  themeInfo,
} from "./registry";

const listeners = new Set<() => void>();

function readActiveTheme(): string {
  if (typeof document !== "undefined") {
    const fromDom = document.documentElement.dataset.theme;
    if (typeof fromDom === "string" && getThemeDefinition(fromDom)) {
      return fromDom;
    }
  }
  return loadThemeId();
}

let currentThemeId: string = readActiveTheme();

function emit() {
  for (const listener of listeners) listener();
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

function getSnapshot(): string {
  return currentThemeId;
}

function getServerSnapshot(): string {
  return currentThemeId;
}

function setThemeId(id: string) {
  if (!getThemeDefinition(id)) return;
  if (id === currentThemeId) {
    applyTheme(id);
    emit();
    return;
  }
  currentThemeId = id;
  saveThemeId(id);
  applyTheme(id);
  emit();
}

/** Subscribe to the active appearance theme. */
export function useTheme() {
  const themeId = useSyncExternalStore(
    subscribe,
    getSnapshot,
    getServerSnapshot,
  );

  const info = themeInfo(themeId);

  const setTheme = useCallback((id: string) => {
    setThemeId(id);
  }, []);

  const setFamily = useCallback((family: string) => {
    setThemeId(themeIdFor(family, themeInfo(currentThemeId).colorScheme));
  }, []);

  const setColorScheme = useCallback((colorScheme: "dark" | "light") => {
    setThemeId(themeIdFor(themeInfo(currentThemeId).family, colorScheme));
  }, []);

  return {
    themeId,
    family: info.family,
    colorScheme: info.colorScheme,
    setTheme,
    setFamily,
    setColorScheme,
    themes: listThemeInfos(),
    families: listThemeFamilies(),
  };
}
