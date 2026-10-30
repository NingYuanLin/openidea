import type { ReferenceKind } from "@/bindings";
import { tx } from "@/platform/i18n";
import type { Usage } from "./usages";

export type UsageKindFilterValue = "all" | ReferenceKind;

export function filterUsageKind(items: readonly Usage[], kind: UsageKindFilterValue): Usage[] {
  return items.filter((u) => kind === "all" || (u.kind ?? "unknown") === kind);
}

export function UsageKindFilter({
  items,
  value,
  onChange,
}: {
  items: readonly Usage[];
  value: UsageKindFilterValue;
  onChange: (value: UsageKindFilterValue) => void;
}) {
  // Ordinary LSP results have no categories. Avoid implying they were classified.
  if (!items.some((u) => u.kind && u.kind !== "unknown")) return null;
  const choices: [UsageKindFilterValue, string][] = [
    ["all", tx("All")],
    ["getter", "Getter"],
    ["setter", "Setter"],
    ["field", tx("Direct field references")],
    ["unknown", tx("Unknown")],
  ];
  return (
    <label style={{ display: "flex", alignItems: "center", gap: 6, padding: "4px 8px" }}>
      {tx("Usage kind")}
      <select
        aria-label={tx("Usage kind")}
        value={value}
        onKeyDown={(e) => e.stopPropagation()}
        onChange={(e) => onChange(e.target.value as UsageKindFilterValue)}
      >
        {choices.map(([kind, label]) => (
          <option key={kind} value={kind}>
            {label} ({filterUsageKind(items, kind).length})
          </option>
        ))}
      </select>
    </label>
  );
}
