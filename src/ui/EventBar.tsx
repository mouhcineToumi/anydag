import { useId } from "react";

import { CalendarClock, Clock, Sun } from "lucide-react";

import { fieldsOf, whenWords, withAllDay, withEnd, withStart } from "@/calendar/model";
import { useZone } from "@/calendar/usePrefs";
import { isDay, momentOf, type EventChange, type NoteEvent } from "@/note/event";
import { currentZone, zoneName } from "@/note/zone";

import { Switch } from "./controls";

/**
 * How an event's time is drawn on its own page: a bar under the title
 * to change it, and a line above the text where nothing may.
 *
 * **Every time is shown, and written, in the viewer's zone** — a time
 * carries its offset and is shown in the viewer's, which is the person's choice in
 * Settings → Calendar, or this machine's when there is none (`src/note/zone.ts`). So the bar reads
 * the file's instant into fields in that zone, and a change writes them back with the offset it keeps
 * on that date (`eventFrom`, through `timeOf`): an event written in Paris and moved in New York is
 * written in New York's offset, which names the same moment the person saw.
 *
 * No colour and no length: the task bar's classes, which this shares for the parts that look the
 * same. It imports nothing from the editor, because the read-only line is drawn by `src/view/` too.
 */

/** The viewer's zone at a moment, as a person reads it — `GMT+2`, `PDT` — or its offset when it has no name. */
const zoneAt = (at: Date): string => zoneName(at);

/**
 * The bar at the top of an event's own page: all day or not, when it starts, when it ends, the zone
 * those are in, and the way back to being a plain note. Moving the start keeps how long it is.
 */
export function EventBar({
  event,
  onChange,
  editable,
}: {
  event: NoteEvent;
  onChange(change: EventChange): void;
  editable: boolean;
}) {
  useZone();
  const f = fieldsOf(event);
  const zone = f.allDay ? "" : zoneAt(momentOf(event.start));
  /* The visible label is the control's name as well as its pointer: `htmlFor` on the date, and
     `aria-labelledby` on the time a label cannot carry itself. */
  const id = useId();
  const allDayId = `${id}all-day`;
  const startId = `${id}start`;
  const startDayId = `${id}start-day`;
  const startTimeId = `${id}start-time`;
  const endId = `${id}end`;
  const endDayId = `${id}end-day`;
  const endTimeId = `${id}end-time`;
  const labelClass = editable ? "dag-facts__label dag-eventbar__label" : "dag-facts__label";
  return (
    <div className="dag-taskbar dag-eventbar dag-facts" data-dag-eventbar={f.allDay ? "all-day" : "timed"}>
      <label className={labelClass} htmlFor={allDayId} data-dag-eventbar-label="all-day">
        <Sun size={14} strokeWidth={2} aria-hidden="true" />
        All day
      </label>
      <span className="dag-facts__value">
        <Switch
          id={allDayId}
          checked={f.allDay}
          disabled={!editable}
          data-dag-eventbar-allday=""
          onChange={(e) => onChange(withAllDay(event, e.target.checked))}
        />
      </span>
      <label id={startId} className={labelClass} htmlFor={startDayId} data-dag-eventbar-label="start">
        <CalendarClock size={14} strokeWidth={2} aria-hidden="true" />
        Starts
      </label>
      <span className="dag-facts__value dag-eventbar__when">
        <input
          id={startDayId}
          type="date"
          value={f.startDay}
          disabled={!editable}
          data-dag-eventbar-start-day=""
          onChange={(e) => e.target.value && onChange(withStart(event, e.target.value))}
        />
        {f.allDay ? null : (
          <input
            id={startTimeId}
            type="time"
            step={900}
            value={f.startTime}
            disabled={!editable}
            aria-labelledby={startId}
            data-dag-eventbar-start-time=""
            onChange={(e) => e.target.value && onChange(withStart(event, f.startDay, e.target.value))}
          />
        )}
      </span>
      <label id={endId} className={labelClass} htmlFor={endDayId} data-dag-eventbar-label="end">
        <Clock size={14} strokeWidth={2} aria-hidden="true" />
        Ends
      </label>
      <span className="dag-facts__value dag-eventbar__when">
        <input
          id={endDayId}
          type="date"
          value={f.endDay}
          min={f.startDay}
          disabled={!editable}
          data-dag-eventbar-end-day=""
          onChange={(e) => e.target.value && onChange(withEnd(event, e.target.value))}
        />
        {f.allDay ? null : (
          <input
            id={endTimeId}
            type="time"
            step={900}
            value={f.endTime}
            disabled={!editable}
            aria-labelledby={endId}
            data-dag-eventbar-end-time=""
            onChange={(e) => e.target.value && onChange(withEnd(event, f.endDay, e.target.value))}
          />
        )}
        {zone ? (
          <span
            className="dag-eventbar__zone"
            data-dag-eventbar-zone=""
            title={`Shown in ${currentZone().replace(/_/g, " ")}, and written with its offset. Settings → Calendar changes the time zone.`}
          >
            {zone}
          </span>
        ) : null}
      </span>
    </div>
  );
}

/**
 * An event's time, read-only, above its text wherever it is drawn with nothing to change it with:
 * `?view=1`, `?snapshot=1`, and the PDF — `TaskLine`'s twin. A time says its zone,
 * because the person reading may be somewhere else from whoever wrote it.
 */
export function EventLine({ event }: { event: NoteEvent }) {
  useZone();
  const zone = isDay(event.start) ? "" : zoneAt(momentOf(event.start));
  return (
    <p className="dag-taskbar dag-taskbar--read dag-eventline" data-dag-eventline={event.start}>
      <CalendarClock size={14} strokeWidth={2} aria-hidden="true" />
      <span>{whenWords(event)}</span>
      {zone ? <span className="dag-eventbar__zone">{zone}</span> : null}
    </p>
  );
}
