import type { SelectHTMLAttributes } from "react";

import { EFFORTS } from "@/settings/store";

type Data = Record<`data-${string}`, string | number | undefined>;

const LABELS: Readonly<Record<string, string>> = {
  low: "Low",
  medium: "Medium",
  high: "High",
  max: "Max",
};

export interface EffortPickerProps extends Omit<SelectHTMLAttributes<HTMLSelectElement>, "value" | "onChange">, Data {
  /** One of `EFFORTS`, the older `none`, or `null` for Automatic. */
  value: string | null;
  onChange(level: string | null): void;
}

/**
 * The one effort scale every AI control shows: Automatic, Low, Medium, High, Max.
 *
 * It is the native select for the reason `controls.tsx` gives — the keyboard and a screen reader
 * already know it — and it is one component so Settings and the Assistant cannot drift into two
 * scales again. `none` is read for a preference stored before Max existed, and is shown only while
 * it is the value, rather than silently becoming Automatic.
 */
export function EffortPicker({ value, onChange, className, ...rest }: EffortPickerProps) {
  const current = value ?? "";
  return (
    <select
      className={`dag-select dag-effort${className ? ` ${className}` : ""}`}
      value={current}
      onChange={(e) => onChange(e.target.value || null)}
      {...rest}
    >
      <option value="">Automatic</option>
      {current === "none" ? <option value="none">None (older setting)</option> : null}
      {EFFORTS.map((level) => (
        <option key={level} value={level}>
          {LABELS[level]}
        </option>
      ))}
    </select>
  );
}
