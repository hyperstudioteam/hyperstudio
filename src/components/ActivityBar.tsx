import {
  Database,
  KeyRound,
  Lock,
  Puzzle,
  Search,
  Settings,
} from "lucide-react";
import { cn } from "../lib/cn";
import { useExtensionMenu } from "../extensions/hooks";
import { extensionRegistry } from "../extensions/registry";

interface ActivityBarProps {
  active: "databases" | "settings";
  onSelect: (view: "databases" | "settings") => void;
  onOpenPlugins: () => void;
  /** Absent when no vault has been created yet. */
  vaultUnlocked?: boolean | null;
  onOpenVault?: () => void;
}

const activityClass = cn(
  "relative grid h-[33px] w-[33px] cursor-pointer place-items-center rounded-md border-0 bg-transparent text-subtle",
  "hover:bg-panel-soft hover:text-text",
);

export function ActivityBar({
  active,
  onSelect,
  onOpenPlugins,
  vaultUnlocked = null,
  onOpenVault,
}: ActivityBarProps) {
  const extensionItems = useExtensionMenu("activity");
  return (
    <aside className="flex shrink-0 flex-col items-center gap-[5px] border-r border-border bg-activity px-[5px] py-2">
      <button
        className={cn(
          activityClass,
          active === "databases" &&
            "bg-accent-soft text-accent-bright before:absolute before:-left-[5px] before:h-[19px] before:w-0.5 before:rounded-sm before:bg-accent before:content-['']",
        )}
        aria-label="Databases"
        onClick={() => onSelect("databases")}
      >
        <Database size={19} />
      </button>
      <button
        className={activityClass}
        aria-label="Search"
        disabled
        title="Coming soon"
      >
        <Search size={19} />
      </button>
      {extensionItems.map((item) => (
        <button
          type="button"
          key={`${item.source}:${item.command}`}
          className={activityClass}
          aria-label={item.title}
          title={item.title}
          onClick={() => extensionRegistry.executeCommand(item.command)}
        >
          <Puzzle size={18} />
        </button>
      ))}
      <div className="flex-1" />
      {vaultUnlocked !== null && onOpenVault && (
        <button
          className={cn(activityClass, vaultUnlocked && "text-accent-bright")}
          aria-label="Vault settings"
          title={
            vaultUnlocked
              ? "Vault unlocked · settings"
              : "Vault locked · settings"
          }
          onClick={onOpenVault}
        >
          {vaultUnlocked ? <KeyRound size={19} /> : <Lock size={19} />}
        </button>
      )}
      <button
        className={activityClass}
        aria-label="Plugins"
        title="Plugins"
        onClick={onOpenPlugins}
      >
        <Puzzle size={19} />
      </button>
      <button
        className={cn(
          activityClass,
          active === "settings" &&
            "bg-accent-soft text-accent-bright before:absolute before:-left-[5px] before:h-[19px] before:w-0.5 before:rounded-sm before:bg-accent before:content-['']",
        )}
        aria-label="Settings"
        title="Plugins & settings"
        onClick={onOpenPlugins}
      >
        <Settings size={19} />
      </button>
    </aside>
  );
}
