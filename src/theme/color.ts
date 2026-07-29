/** Normalize `#rgb` / `#rrggbb` / `#rrggbbaa` to uppercase `#RRGGBB`. */
export function normalizeHex(input: string): string {
  const raw = input.trim();
  const match = /^#([0-9a-f]{3}|[0-9a-f]{6}|[0-9a-f]{8})$/i.exec(raw);
  if (!match) {
    throw new Error(`Invalid color: ${input}`);
  }
  let hex = match[1]!;
  if (hex.length === 3) {
    hex = hex
      .split("")
      .map((ch) => ch + ch)
      .join("");
  }
  if (hex.length === 8) {
    hex = hex.slice(0, 6);
  }
  return `#${hex.toLowerCase()}`;
}

export function isHexColor(value: unknown): value is string {
  return typeof value === "string" && /^#([0-9a-f]{3}|[0-9a-f]{6}|[0-9a-f]{8})$/i.test(
    value.trim(),
  );
}

interface Rgb {
  r: number;
  g: number;
  b: number;
}

function parseRgb(hex: string): Rgb {
  const normalized = normalizeHex(hex).slice(1);
  return {
    r: Number.parseInt(normalized.slice(0, 2), 16),
    g: Number.parseInt(normalized.slice(2, 4), 16),
    b: Number.parseInt(normalized.slice(4, 6), 16),
  };
}

function toHex({ r, g, b }: Rgb): string {
  const clamp = (n: number) => Math.max(0, Math.min(255, Math.round(n)));
  return `#${[clamp(r), clamp(g), clamp(b)]
    .map((n) => n.toString(16).padStart(2, "0"))
    .join("")}`;
}

/** Relative luminance 0–1 (sRGB). */
export function luminance(hex: string): number {
  const { r, g, b } = parseRgb(hex);
  const channel = (c: number) => {
    const s = c / 255;
    return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * channel(r) + 0.7152 * channel(g) + 0.0722 * channel(b);
}

/** Mix `from` toward `to` by `amount` (0–1). */
export function mix(from: string, to: string, amount: number): string {
  const a = parseRgb(from);
  const b = parseRgb(to);
  const t = Math.max(0, Math.min(1, amount));
  return toHex({
    r: a.r + (b.r - a.r) * t,
    g: a.g + (b.g - a.g) * t,
    b: a.b + (b.b - a.b) * t,
  });
}

export function withAlpha(hex: string, alpha: number): string {
  const { r, g, b } = parseRgb(hex);
  const a = Math.max(0, Math.min(1, alpha));
  return `rgb(${r} ${g} ${b} / ${Number(a.toFixed(3))})`;
}
