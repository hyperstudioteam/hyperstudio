export type ExtensionLocation = "panel.right" | "panel.modal";

export interface CommandContribution {
  id: string;
  title: string;
  opensView?: string;
}

export interface MenuContribution {
  command: string;
  group?: string;
  when?: string;
}

export interface ViewContribution {
  id: string;
  name: string;
  location: ExtensionLocation;
  entry: string;
}

export interface StatusBarContribution {
  id: string;
  text: string;
  command?: string;
  alignment?: "left" | "right";
}

export interface ViewerContribution {
  id: string;
  label: string;
  entry: string;
  typeNames?: string[];
  priority?: number;
}

export interface ExtensionContributions {
  commands?: CommandContribution[];
  menus?: Record<string, MenuContribution[]>;
  views?: ViewContribution[];
  viewers?: ViewerContribution[];
  statusBar?: StatusBarContribution[];
}

export interface RegisteredCommand extends CommandContribution {
  source: string;
}

export interface RegisteredMenuItem extends MenuContribution {
  source: string;
  title: string;
}

export interface RegisteredView extends ViewContribution {
  source: string;
}

export interface RegisteredStatusItem extends StatusBarContribution {
  source: string;
}

export interface RegisteredViewer extends ViewerContribution {
  source: string;
}

export interface ExtensionCommandContext {
  sql?: string;
  selectedSql?: string;
  driver?: string;
  connectionId?: string | null;
  schema?: string;
  object?: string;
  column?: string;
  value?: unknown;
}
