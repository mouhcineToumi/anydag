import { useState, type ButtonHTMLAttributes, type InputHTMLAttributes, type ReactNode, type Ref } from "react";

import { Tooltip } from "@/ui/Tooltip";

/**
 * The form controls the chrome shares, so a select in Settings and a select in the inspector are
 * one control rather than two that look alike by accident.
 *
 * They stay the browser's own elements underneath — a `<select>`, an `<input type=checkbox>` — on
 * purpose: the keyboard, the screen reader and Playwright's `selectOption` and `check` all know
 * those, and a hand-made listbox would have to earn each of them back. What changes is the drawing,
 * in `chrome.css` under `.dag-select`, `.dag-switch`, `.dag-check` and `.dag-textfield`.
 *
 * `Button` and `IconButton` are the chrome's buttons (#207). Before them the shell had 42 mixes of
 * height, corner, size, weight, fill and border, from 16 to 37 px tall, and four kinds of primary.
 * Every number they draw with is a `--dag-ui-*` token, so a theme changes all of them or none.
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

/** What a button is for: the one action a card asks for, an ordinary one, one with no box, one that destroys. */
export type ButtonVariant = "primary" | "secondary" | "quiet" | "danger";

/**
 * How tall: `sm` 24 (inside a row or a dense bar), `md` 30 (the default), `touch` 44 (a finger's).
 * **Under 720px `md` is `touch` by itself** — the stylesheet says so — so a screen does not have to
 * remember to make its buttons a finger's on a phone; a `sm` stays small on purpose.
 */
export type ButtonSize = "sm" | "md" | "touch";

type ButtonProps = ButtonHTMLAttributes<HTMLButtonElement> & Data & { ref?: Ref<HTMLButtonElement> };

const join = (...names: (string | false | undefined)[]) => names.filter(Boolean).join(" ");

/**
 * A button with words on it, and an icon before them if it has one. `type` is `button` unless the
 * caller says `submit`: a button in a form that submits by accident is the default HTML gives you.
 * Every other attribute — `data-dag-*`, `aria-*`, `title`, `disabled` — passes through untouched,
 * because the end-to-end suite finds controls by them.
 */
export function Button({
  variant = "secondary",
  size = "md",
  className,
  type = "button",
  ...rest
}: ButtonProps & { variant?: ButtonVariant; size?: ButtonSize }) {
  return (
    <button type={type} className={join("dag-button", `dag-button--${variant}`, `dag-button--${size}`, className)} {...rest} />
  );
}

/**
 * A button that is only an icon: square, quiet unless it destroys, and **named by its `aria-label`**,
 * which is also what its tooltip says — the drawn one (`Tooltip`), because the native `title` does
 * not appear dependably in the desktop app on macOS. `tip` replaces the words of the tooltip where
 * the accessible name carries more (the row it acts on, the chord), and `shortcut` adds the chord.
 *
 * **A `title` is kept, and then there is no drawn tooltip.** It is how a control says a sentence
 * rather than a name — what *New* can make, or that the app is locked and how to unlock it — and one
 * control shows one tooltip.
 *
 * **Without a label it refuses to render in development**: an icon with no name is a button a
 * screen reader announces as "button", and nothing in a review shows that. In a build it renders
 * anyway, since a missing control is worse than an unnamed one.
 */
export function IconButton({
  variant = "quiet",
  size = "md",
  className,
  type = "button",
  tip,
  shortcut,
  title,
  ...rest
}: Omit<ButtonProps, "aria-label"> & {
  "aria-label": string;
  variant?: "quiet" | "danger";
  size?: ButtonSize;
  /** The tooltip's words, where they differ from the accessible name. */
  tip?: string;
  /** The chord, drawn after the name in the tooltip. */
  shortcut?: string;
}) {
  const label = rest["aria-label"];
  if (!label?.trim() && import.meta.env.DEV) {
    console.error("IconButton needs an aria-label: it is the button's only name, and its tooltip.");
    return null;
  }
  const button = (
    <button
      type={type}
      className={join("dag-icon", `dag-icon--${size}`, variant === "danger" && "dag-icon--danger", className)}
      title={title}
      {...rest}
    />
  );
  if (title !== undefined) return button;
  return (
    <Tooltip name={tip ?? label} shortcut={shortcut}>
      {button}
    </Tooltip>
  );
}
