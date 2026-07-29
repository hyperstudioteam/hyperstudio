import type { ReactNode } from "react";
import { Moon, Palette, Sun, X } from "lucide-react";
import { cn } from "../lib/cn";
import { useTheme } from "../theme";
import type { ThemeFamily } from "../theme";

interface SettingsModalProps {
  onClose: () => void;
}

export function SettingsModal({ onClose }: SettingsModalProps) {
  const { family, colorScheme, setFamily, setColorScheme, families } =
    useTheme();

  return (
    <div
      className="fixed inset-0 z-50 grid place-items-center bg-black/50"
      onClick={onClose}
    >
      <div
        className="max-h-[min(640px,92vh)] w-[440px] max-w-[92vw] overflow-auto rounded-lg border border-border bg-panel shadow-[0_24px_60px_rgba(0,0,0,.5)]"
        onClick={(event) => event.stopPropagation()}
      >
        <header className="sticky top-0 z-[1] flex items-center gap-2 border-b border-border bg-panel px-3.5 py-2.5">
          <Palette size={14} className="text-accent-bright" />
          <h2 className="m-0 text-[12px] font-semibold text-text-bright">
            Settings
          </h2>
          <button
            type="button"
            className="ml-auto grid size-6 cursor-pointer place-items-center rounded-[4px] border-0 bg-transparent text-subtle hover:bg-panel-soft hover:text-text"
            aria-label="Close"
            onClick={onClose}
          >
            <X size={14} />
          </button>
        </header>

        <div className="flex flex-col gap-3.5 px-3.5 py-3">
          <section className="flex flex-col gap-2">
            <h3 className="m-0 text-[10px] font-[540] uppercase tracking-[0.06em] text-muted">
              Mode
            </h3>
            <div
              className="grid grid-cols-2 gap-1.5"
              role="radiogroup"
              aria-label="Color mode"
            >
              <ModeButton
                selected={colorScheme === "dark"}
                label="Dark"
                icon={<Moon size={13} />}
                onClick={() => setColorScheme("dark")}
              />
              <ModeButton
                selected={colorScheme === "light"}
                label="Light"
                icon={<Sun size={13} />}
                onClick={() => setColorScheme("light")}
              />
            </div>
          </section>

          <div className="h-px bg-border" />

          <section className="flex flex-col gap-2">
            <h3 className="m-0 text-[10px] font-[540] uppercase tracking-[0.06em] text-muted">
              Theme
            </h3>
            <p className="m-0 text-[10px] leading-[1.45] text-subtle">
              Built-in themes including popular standards. Preference is saved
              on this device.
            </p>
            <div
              className="flex flex-col gap-1.5"
              role="radiogroup"
              aria-label="Theme family"
            >
              {families.map((item) => {
                const selected = item.id === family;
                return (
                  <button
                    key={item.id}
                    type="button"
                    role="radio"
                    aria-checked={selected}
                    className={cn(
                      "flex cursor-pointer items-start gap-2.5 rounded-[6px] border border-border bg-transparent px-2.5 py-2 text-left hover:border-border-bright",
                      selected && "border-accent bg-accent-soft",
                    )}
                    onClick={() => setFamily(item.id)}
                  >
                    <ThemeSwatch
                      family={item}
                      mode={colorScheme}
                      selected={selected}
                    />
                    <span className="min-w-0 flex-1">
                      <span className="block text-[11px] font-[600] text-text-bright">
                        {item.label}
                      </span>
                      <span className="mt-0.5 block text-[10px] leading-[1.4] text-muted">
                        {item.description}
                      </span>
                    </span>
                  </button>
                );
              })}
            </div>
          </section>
        </div>
      </div>
    </div>
  );
}

function ModeButton({
  selected,
  label,
  icon,
  onClick,
}: {
  selected: boolean;
  label: string;
  icon: ReactNode;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      role="radio"
      aria-checked={selected}
      className={cn(
        "flex cursor-pointer items-center justify-center gap-1.5 rounded-[6px] border border-border bg-transparent px-2 py-2 text-[11px] font-[600] text-muted hover:border-border-bright hover:text-text",
        selected && "border-accent bg-accent-soft text-accent-bright",
      )}
      onClick={onClick}
    >
      {icon}
      {label}
    </button>
  );
}

function ThemeSwatch({
  family,
  mode,
  selected,
}: {
  family: ThemeFamily;
  mode: "dark" | "light";
  selected: boolean;
}) {
  const colors = family.swatch[mode];

  return (
    <span
      className={cn(
        "mt-0.5 grid shrink-0 grid-cols-2 gap-0.5 rounded-[4px] border border-border p-0.5",
        selected && "border-accent",
      )}
      aria-hidden
    >
      {colors.map((color) => (
        <span
          key={color}
          className="size-2.5 rounded-[2px]"
          style={{ backgroundColor: color }}
        />
      ))}
    </span>
  );
}
