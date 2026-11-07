export function validProfileSettings(value: unknown): value is { reasoningEffort?: "low" | "medium" | "high" | null; jsonMode?: boolean } {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const settings = value as Record<string, unknown>;
  return (settings.reasoningEffort === undefined || settings.reasoningEffort === null || (typeof settings.reasoningEffort === "string" && ["low", "medium", "high"].includes(settings.reasoningEffort))) &&
    (settings.jsonMode === undefined || typeof settings.jsonMode === "boolean");
}
