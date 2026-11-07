import { useMemo } from "react";

import { CAL_KINDS, CAL_LABEL } from "@/calendar/model";
import { useCalendarHidden, useWeekStart, useZone } from "@/calendar/usePrefs";
import { localZone } from "@/note/zone";

import { Switch } from "@/ui/controls";

import { Field, Group, Reset } from "./common";

/** The days a week may start on, in the order a person thinks of them: Monday first, the default. */
const WEEK_STARTS: readonly [number, string][] = [
  [1, "Monday"],
  [0, "Sunday"],
  [6, "Saturday"],
];

/**
 * Every zone this browser knows by name, `UTC`, this browser's own and `keep` among them. Chromium
 * lists ICU's canonical names, some of them the older spelling — `Asia/Calcutta`, `Europe/Kiev` —
 * while it may call the zone it is in `Asia/Kolkata`; both are the same zone to `Intl` and to the
 * server's `zoneinfo`, and adding the browser's own keeps the name *Automatic* shows pickable.
 */
function zoneNames(keep: string | null): string[] {
  let names: string[] = [];
  try {
    names = (Intl as unknown as { supportedValuesOf(key: "timeZone"): string[] }).supportedValuesOf("timeZone");
  } catch {
    /* An engine without the list still offers the automatic choice and whatever is set. */
  }
  const all = new Set(names);
  all.add("UTC");
  all.add(localZone());
  if (keep) all.add(keep);
  return [...all].sort();
}

/**
 * The calendar's tab: the time zone, where a week
 * starts, and which kinds it shows. **All three are the same in every vault**, which is why the tab
 * is in the app's group. The toggles are the same preference the
 * Calendar page's own switches write, through the same hook, so the two cannot disagree.
 *
 * The time zone is *Automatic* until somebody picks one: the browser's own, which is what
 * the page always used. Picked, every time on every page is shown and written in it, and an agent
 * writing a time with no offset gets it too.
 */
export function CalendarPane() {
  const [weekStart, setWeekStart] = useWeekStart();
  const [hidden, setHidden] = useCalendarHidden();
  const [, zone, setZoneChoice] = useZone();
  const names = useMemo(() => zoneNames(zone), [zone]);
  const here = localZone();
  return (
    <>
      <Group title="Time">
        <Field label="Time zone" hint="Events keep the moment they name, so changing this moves where they show, not when they are.">
          <select className="dag-select dag-select--wide" data-dag-setting-time-zone="" value={zone ?? ""} onChange={(e) => setZoneChoice(e.target.value || null)}>
            <option value="">Automatic ({here.replace(/_/g, " ")})</option>
            {names.map((z) => (
              <option key={z} value={z}>
                {z.replace(/_/g, " ")}
              </option>
            ))}
          </select>
        </Field>
        <Field label="Weeks start on">
          <select className="dag-select" data-dag-setting-week-start="" value={weekStart} onChange={(e) => setWeekStart(Number(e.target.value))}>
            {WEEK_STARTS.map(([d, label]) => (
              <option key={d} value={d}>
                {label}
              </option>
            ))}
          </select>
        </Field>
      </Group>

      <Group title="Show on the calendar">
        {CAL_KINDS.map((k) => (
          <Field key={k} label={CAL_LABEL[k]}>
            <Switch data-dag-setting-calendar-kind={k} checked={!hidden.has(k)} onChange={(e) => setHidden(k, !e.target.checked)} />
          </Field>
        ))}
      </Group>

      <Reset
        what="the calendar's settings"
        onReset={() => {
          setZoneChoice(null);
          setWeekStart(1);
          for (const k of CAL_KINDS) if (hidden.has(k)) setHidden(k, false);
        }}
      />
    </>
  );
}
