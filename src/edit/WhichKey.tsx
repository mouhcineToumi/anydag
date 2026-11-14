import { BINDINGS, bindingOn, LEADER_LABEL } from "@/edit/bindings";
import { useAi } from "@/settings/useAi";

/**
 * What the leader can reach, shown once somebody has held it long enough to be asking.
 *
 * Which-key's bargain, from Emacs by way of Hyprland: a person who knows the chord presses it and
 * is gone before this exists, and a person who does not gets the whole set without having to know
 * that a sheet exists somewhere behind a `?`. That is most of the discoverability a leader buys,
 * and it is why the prefix is worth the extra press.
 *
 * It is a strip along the bottom rather than a card in the middle: a chord is opened *while
 * looking at something*, and a dialog over the board would hide the thing the command is about.
 * It takes no pointer events at all — the gesture in progress is a keyboard one, and a strip that
 * could be clicked would be a second way to do what the letter under it already does.
 */
export function WhichKey() {
  /* An AI feature that is off takes its chord with it (#296). */
  const ai = useAi();
  return (
    <div className="dag-whichkey" data-dag-whichkey="" role="status" aria-label="Leader key">
      <kbd className="dag-whichkey__leader">{LEADER_LABEL}</kbd>
      <ul className="dag-whichkey__list">
        {BINDINGS.filter((b) => bindingOn(b, (f) => ai[f])).map((b) => (
          <li key={b.key} className="dag-whichkey__item" data-dag-whichkey-key={b.key}>
            <kbd>{b.key}</kbd>
            <span>{b.label}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}
