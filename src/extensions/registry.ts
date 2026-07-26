import { InstalledPluginInfo } from "../types/connection";
import {
  ExtensionCommandContext,
  RegisteredCommand,
  RegisteredMenuItem,
  RegisteredStatusItem,
  RegisteredViewer,
  RegisteredView,
} from "./types";

type Listener = () => void;

export interface ActiveExtensionView {
  view: RegisteredView;
  context: ExtensionCommandContext;
}

class ExtensionRegistry {
  private commands = new Map<string, RegisteredCommand>();
  private menus = new Map<string, RegisteredMenuItem[]>();
  private views = new Map<string, RegisteredView>();
  private statusItems: RegisteredStatusItem[] = [];
  private viewers: RegisteredViewer[] = [];
  private activeView: ActiveExtensionView | null = null;
  private listeners = new Set<Listener>();
  private version = 0;

  sync(plugins: InstalledPluginInfo[]) {
    this.commands.clear();
    this.menus.clear();
    this.views.clear();
    this.statusItems = [];
    this.viewers = [];

    for (const plugin of plugins) {
      if (!plugin.enabled) continue;
      const contributed = plugin.contributes ?? {};
      for (const command of contributed.commands ?? []) {
        this.commands.set(command.id, { ...command, source: plugin.id });
      }
      for (const view of contributed.views ?? []) {
        this.views.set(view.id, { ...view, source: plugin.id });
      }
      for (const [menuId, items] of Object.entries(contributed.menus ?? {})) {
        const target = this.menus.get(menuId) ?? [];
        for (const item of items) {
          const command = this.commands.get(item.command);
          if (!command) continue;
          target.push({
            ...item,
            source: plugin.id,
            title: command.title,
          });
        }
        target.sort((a, b) =>
          (a.group ?? "").localeCompare(b.group ?? ""),
        );
        this.menus.set(menuId, target);
      }
      for (const item of contributed.statusBar ?? []) {
        this.statusItems.push({ ...item, source: plugin.id });
      }
      for (const viewer of contributed.viewers ?? []) {
        this.viewers.push({ ...viewer, source: plugin.id });
      }
    }

    if (
      this.activeView &&
      !this.views.has(this.activeView.view.id)
    ) {
      this.activeView = null;
    }
    this.emit();
  }

  menuItems(menuId: string): RegisteredMenuItem[] {
    return this.menus.get(menuId) ?? [];
  }

  viewsAt(location: string): RegisteredView[] {
    return [...this.views.values()].filter(
      (view) => view.location === location,
    );
  }

  statusBarItems(): RegisteredStatusItem[] {
    return this.statusItems;
  }

  dataViewers(typeName?: string): RegisteredViewer[] {
    const type = typeName?.toLowerCase();
    return this.viewers
      .filter(
        (viewer) =>
          !viewer.typeNames?.length ||
          (type && viewer.typeNames.some((name) => name.toLowerCase() === type)),
      )
      .sort((a, b) => (b.priority ?? 0) - (a.priority ?? 0));
  }

  executeCommand(
    id: string,
    context: ExtensionCommandContext = {},
  ): boolean {
    const command = this.commands.get(id);
    if (!command) return false;
    const viewId =
      command.opensView ??
      [...this.views.values()].find((view) => view.source === command.source)?.id;
    const view = viewId ? this.views.get(viewId) : undefined;
    if (!view) return false;
    this.activeView = { view, context };
    this.emit();
    return true;
  }

  openView(viewId: string, context: ExtensionCommandContext = {}): boolean {
    const view = this.views.get(viewId);
    if (!view) return false;
    this.activeView = { view, context };
    this.emit();
    return true;
  }

  closeView() {
    if (!this.activeView) return;
    this.activeView = null;
    this.emit();
  }

  active(): ActiveExtensionView | null {
    return this.activeView;
  }

  subscribe(listener: Listener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  snapshot = () => this.version;

  private emit() {
    this.version += 1;
    for (const listener of this.listeners) listener();
  }
}

export const extensionRegistry = new ExtensionRegistry();
