export function errorMessage(error: unknown) {
  return error instanceof Error ? error.message : String(error);
}

export function displayValue(value: unknown) {
  if (value === null) return "<null>";
  if (typeof value === "object") return JSON.stringify(value);
  return String(value);
}
