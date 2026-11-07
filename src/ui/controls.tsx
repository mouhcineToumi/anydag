import { useState, type InputHTMLAttributes, type ReactNode } from "react";

/**
 * The form controls the chrome shares, so a select in Settings and a select in the inspector are
 * one control rather than two that look alike by accident.
 *
 * They stay the browser's own elements underneath — a `<select>`, an `<input type=checkbox>` — on
 * purpose: the keyboard, the screen reader and Playwright's `selectOption` and `check` all know
 * those, and a hand-made listbox would have to earn each of them back. What changes is the drawing,
 * in `chrome.css` under `.dag-select`, `.dag-switch`, `.dag-check` and `.dag-textfield`.
 */

type Data = Record<`data-${string}`, string | number | undefined>;

/** An on/off setting: a checkbox that says `role="switch"`, drawn as a track and a knob. */
export function Switch({ className, ...rest }: Omit<InputHTMLAttributes<HTMLInputElement>, "type"> & Data) {
  return <input type="checkbox" role="switch" className={className ? `dag-switch ${className}` : "dag-switch"} {...rest} />;
}

/** A box ticked in a list — the calendar's kinds, a quiz's right answers — where a switch would be loud. */
export function Check({ className, ...rest }: Omit<InputHTMLAttributes<HTMLInputElement>, "type"> & Data) {
  return <input type="checkbox" className={className ? `dag-check ${className}` : "dag-check"} {...rest} />;
}

/**
 * A text or number field with its unit inside the box, where it reads as part of the value
 * ("32 px") rather than a word floating beside it.
 */
export function TextField({
  suffix,
  className,
  wide,
  ...rest
}: InputHTMLAttributes<HTMLInputElement> & Data & { suffix?: ReactNode; wide?: boolean }) {
  return (
    <span className={`dag-textfield${wide ? " dag-textfield--wide" : ""}${className ? ` ${className}` : ""}`}>
      <input {...rest} />
      {suffix ? <span className="dag-textfield__suffix">{suffix}</span> : null}
    </span>
  );
}

/**
 * A number that is stored in one unit and shown in another — an export margin kept in grid steps
 * and read in pixels. The field holds what is being typed while it has the caret, so "3" on the way
 * to "32" is not rounded to a grid step under the person typing; a value that already lands on a
 * step is written at once, and anything else when the field is left.
 */
export function ScaledNumber({
  value,
  scale,
  min,
  max,
  onValue,
  ...rest
}: Omit<InputHTMLAttributes<HTMLInputElement>, "value" | "onChange" | "min" | "max"> &
  Data & { value: number; scale: number; min: number; max: number; onValue(v: number): void; suffix?: ReactNode }) {
  /* Only while the caret is in it: an outside reset shows through the moment the field is left. */
  const [draft, setDraft] = useState<string | null>(null);
  const shown = draft ?? String(value * scale);
  const clamp = (n: number) => Math.min(max, Math.max(min, Math.round(n / scale)));
  return (
    <TextField
      type="number"
      inputMode="numeric"
      min={min * scale}
      max={max * scale}
      step={scale}
      value={shown}
      onChange={(e) => {
        const raw = e.target.value;
        setDraft(raw);
        const n = Number(raw);
        if (raw !== "" && Number.isFinite(n) && n % scale === 0) onValue(clamp(n));
      }}
      onBlur={() => {
        if (draft !== null && draft !== "" && Number.isFinite(Number(draft))) onValue(clamp(Number(draft)));
        setDraft(null);
      }}
      {...rest}
    />
  );
}
