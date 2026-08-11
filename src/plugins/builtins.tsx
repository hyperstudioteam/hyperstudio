import { CellContext, contributions, defaultFormat } from "./contributions";
import { JsonTree } from "../components/viewers/JsonTree";
import { ImagePreview } from "../components/viewers/ImagePreview";
import { TextPreview } from "../components/viewers/TextPreview";
import { EnumPreview } from "../components/viewers/EnumPreview";

const BUILT_IN = "built-in";

function toJsonValue(value: unknown): unknown {
  if (typeof value === "string") {
    try {
      return JSON.parse(value);
    } catch {
      return value;
    }
  }
  return value;
}

function looksLikeJson(value: unknown): boolean {
  if (value && typeof value === "object") return true;
  if (typeof value !== "string") return false;
  const trimmed = value.trim();
  if (!/^[[{]/.test(trimmed)) return false;
  try {
    JSON.parse(trimmed);
    return true;
  } catch {
    return false;
  }
}

const IMAGE_RE = /^data:image\//i;
const IMAGE_URL_RE = /^https?:\/\/\S+\.(png|jpe?g|gif|webp|svg)(\?\S*)?$/i;

function looksLikeImage(value: unknown): boolean {
  return (
    typeof value === "string" &&
    (IMAGE_RE.test(value) || IMAGE_URL_RE.test(value))
  );
}

const BYTES_RE = /^<\d+\s+bytes>$/;

function textOf(ctx: CellContext): string {
  if (ctx.value === null || ctx.value === undefined) return "";
  if (typeof ctx.value === "object") return JSON.stringify(ctx.value, null, 2);
  return String(ctx.value);
}

/**
 * Register the column types and viewers that ship with HyperStudio. These use the
 * exact same public API a plugin would, so the core stays "just another plugin".
 */
export function registerBuiltinContributions() {
  // ----- Column types (inline rendering) -----

  contributions.registerColumnType({
    id: "builtin.json",
    source: BUILT_IN,
    typeNames: ["json", "jsonb"],
    matchValue: (value) => value !== null && typeof value === "object",
    format: (ctx) => defaultFormat(ctx.value),
    className: "text-green",
    defaultViewer: "builtin.json",
    priority: 5,
  });

  contributions.registerColumnType({
    id: "builtin.numeric",
    source: BUILT_IN,
    typeNames: [
      "int2",
      "int4",
      "int8",
      "integer",
      "int",
      "bigint",
      "smallint",
      "float4",
      "float8",
      "double",
      "real",
      "numeric",
      "decimal",
    ],
    matchPrefix: true,
    matchValue: (value) => typeof value === "number",
    align: "right",
    className: "tabular-nums text-warn",
  });

  contributions.registerColumnType({
    id: "builtin.bool",
    source: BUILT_IN,
    typeNames: ["bool", "boolean", "tinyint(1)"],
    matchPrefix: true,
    matchValue: (value) => typeof value === "boolean",
    align: "center",
    format: (ctx) => {
      if (ctx.value === null || ctx.value === undefined) return "<null>";
      if (typeof ctx.value === "boolean") return ctx.value ? "true" : "false";
      // MySQL TINYINT(1) may arrive as 0/1 before the driver maps it to bool.
      if (ctx.value === 0 || ctx.value === 1) return ctx.value === 1 ? "true" : "false";
      return String(ctx.value);
    },
  });

  contributions.registerColumnType({
    id: "builtin.uuid",
    source: BUILT_IN,
    typeNames: ["uuid"],
    className: "font-mono text-[11px]",
  });

  contributions.registerColumnType({
    id: "builtin.binary",
    source: BUILT_IN,
    typeNames: ["bytea", "blob", "binary", "varbinary"],
    matchPrefix: true,
    matchValue: (value) => typeof value === "string" && BYTES_RE.test(value),
    className: "font-mono text-[11px] text-subtle italic",
    defaultViewer: "builtin.text",
  });

  contributions.registerColumnType({
    id: "builtin.enum",
    source: BUILT_IN,
    match: (ctx) => Boolean(ctx.enumLabels && ctx.enumLabels.length > 0),
    className: "text-warn",
    defaultViewer: "builtin.enum",
    priority: 20,
  });

  // ----- Data viewers (rich inspection) -----

  contributions.registerDataViewer({
    id: "builtin.json",
    label: "JSON",
    source: BUILT_IN,
    priority: 20,
    canView: (ctx) => looksLikeJson(ctx.value),
    render: (ctx) => <JsonTree value={toJsonValue(ctx.value)} />,
  });

  contributions.registerDataViewer({
    id: "builtin.image",
    label: "Image",
    source: BUILT_IN,
    priority: 30,
    canView: (ctx) => looksLikeImage(ctx.value),
    render: (ctx) => <ImagePreview src={String(ctx.value)} />,
  });

  contributions.registerDataViewer({
    id: "builtin.enum",
    label: "Enum",
    source: BUILT_IN,
    priority: 25,
    canView: (ctx) => Boolean(ctx.enumLabels && ctx.enumLabels.length > 0),
    render: (ctx) => (
      <EnumPreview value={ctx.value} labels={ctx.enumLabels ?? []} />
    ),
  });

  contributions.registerDataViewer({
    id: "builtin.text",
    label: "Text",
    source: BUILT_IN,
    priority: 0,
    canView: () => true,
    render: (ctx) => (
      <TextPreview text={textOf(ctx)} nullValue={ctx.value === null} />
    ),
  });
}
