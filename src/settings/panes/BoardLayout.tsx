import { useCallback, useEffect, useRef, useState, type CSSProperties } from "react";

import { FLOW_DEFAULT, FLOW_RANGE, flowMeta } from "@/board/settings";
import type { Board } from "@/board/types";
import { TextField } from "@/ui/controls";

import { SETTLE } from "../feedback";
import { markSaved } from "../saved";

import { Field, Group } from "./common";

/** The keys the two rows announce their writes under, so each shows its own Saved tick. */
const WIDTH_KEY = "board.flow.width";
const GAP_KEY = "board.flow.gap";

/** The preview's boxes: enough that the default width wraps the last one onto a second row. */
const PREVIEW_BOXES = [0, 1, 2, 3, 4, 5, 6, 7];

type Row = "width" | "gap";

/**
 * The open board's own layout: how wide the auto-flow wraps, and how far apart it leaves what it
 * places. Both numbers live in the board's frontmatter and are written through `Editor.setMeta` —
 * one `MetaOp`, the file's sha1 `base`, one undo entry — exactly as the card that held them did.
 *
 * The tab is drawn only while a board is open and editable, so this pane always has a board. A value
 * is written when it settles (a pause, Enter, or the field left), never on every keystroke; one that
 * is not a number `flowMeta` will write stays in the box and the row says what the range is.
 */
export function BoardLayoutPane({
  board,
  onMeta,
}: {
  board: Pick<Board, "flow">;
  /** `Editor.setMeta`: the keys to set in the frontmatter, `null` removing one. */
  onMeta(meta: Record<string, unknown>): Promise<boolean>;
}) {
  const [width, setWidth] = useState(String(board.flow.width));
  const [gap, setGap] = useState(String(board.flow.gap));
  const [bad, setBad] = useState<{ row: Row; text: string } | null>(null);
  /* The drafts are read at commit time rather than from a render: a pause waits for the typing to
     stop, and the timer must write what is in the box then, not what it held when it was set. */
  const drafts = useRef({ width: String(board.flow.width), gap: String(board.flow.gap) });
  /* The values the file last said, so a commit can tell whether it would write anything. */
  const file = useRef(board.flow);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    file.current = board.flow;
  }, [board.flow]);

  const cancel = useCallback(() => {
    if (timer.current !== null) {
      clearTimeout(timer.current);
      timer.current = null;
    }
  }, []);

  useEffect(() => cancel, [cancel]);

  const commit = useCallback(() => {
    cancel();
    const rawWidth = drafts.current.width;
    const rawGap = drafts.current.gap;
    const nextWidth = Number(rawWidth);
    const nextGap = Number(rawGap);
    const widthOk =
      rawWidth.trim() !== "" &&
      Number.isFinite(nextWidth) &&
      nextWidth >= FLOW_RANGE.width.min &&
      nextWidth <= FLOW_RANGE.width.max;
    if (!widthOk) {
      setBad({
        row: "width",
        text: `Row width has to be ${FLOW_RANGE.width.min}–${FLOW_RANGE.width.max} px.`,
      });
      return;
    }
    const gapOk =
      rawGap.trim() !== "" && Number.isFinite(nextGap) && nextGap >= FLOW_RANGE.gap.min && nextGap <= FLOW_RANGE.gap.max;
    if (!gapOk) {
      setBad({
        row: "gap",
        text: `Spacing has to be ${FLOW_RANGE.gap.min}–${FLOW_RANGE.gap.max} px.`,
      });
      return;
    }

    setBad(null);
    /* What `flowMeta` rounds to is what the file will say, so the box says it too. */
    const rounded = { width: Math.round(nextWidth), gap: Math.round(nextGap) };
    drafts.current = { width: String(rounded.width), gap: String(rounded.gap) };
    setWidth(drafts.current.width);
    setGap(drafts.current.gap);

    const before = file.current;
    if (rounded.width === before.width && rounded.gap === before.gap) return;
    const op = flowMeta(rounded.width, rounded.gap);
    if (!op) return;
    void onMeta(op.meta).then((ok) => {
      if (!ok) return;
      file.current = rounded;
      if (rounded.width !== before.width) markSaved(WIDTH_KEY);
      if (rounded.gap !== before.gap) markSaved(GAP_KEY);
    });
  }, [cancel, onMeta]);

  const schedule = useCallback(() => {
    cancel();
    timer.current = setTimeout(() => {
      timer.current = null;
      commit();
    }, SETTLE);
  }, [cancel, commit]);

  const applyDefaults = () => {
    drafts.current = { width: String(FLOW_DEFAULT.width), gap: String(FLOW_DEFAULT.gap) };
    setWidth(drafts.current.width);
    setGap(drafts.current.gap);
    commit();
  };

  const draftWidth = Number(width);
  const draftGap = Number(gap);
  const preview = {
    "--board-flow-width": Number.isFinite(draftWidth) && draftWidth >= FLOW_RANGE.width.min ? draftWidth : board.flow.width,
    "--board-flow-gap": Number.isFinite(draftGap) && draftGap >= FLOW_RANGE.gap.min ? draftGap : board.flow.gap,
  } as CSSProperties;

  return (
    <Group
      footer={
        <p className="dag-settings__defaults">
          Defaults: {FLOW_DEFAULT.width} px and {FLOW_DEFAULT.gap} px
          <span aria-hidden="true"> · </span>
          <button type="button" className="dag-settings__reset" data-dag-board-flow-defaults="" onClick={applyDefaults}>
            Use defaults
          </button>
        </p>
      }
    >
      <Field label="Row width" hint="Items you haven't placed wrap past this" save={WIDTH_KEY} settle={SETTLE}>
        <TextField
          data-dag-board-flow-width=""
          type="number"
          inputMode="numeric"
          min={FLOW_RANGE.width.min}
          max={FLOW_RANGE.width.max}
          step={10}
          suffix="px"
          value={width}
          onChange={(e) => {
            drafts.current.width = e.target.value;
            setWidth(e.target.value);
            schedule();
          }}
          onBlur={() => commit()}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              commit();
            }
          }}
        />
      </Field>
      {bad?.row === "width" ? (
        <p className="dag-settings__problem" role="alert" data-dag-board-flow-bad="">
          {bad.text}
        </p>
      ) : null}
      <Field label="Spacing" hint="Between items. Tidy up keeps it" save={GAP_KEY} settle={SETTLE}>
        <TextField
          data-dag-board-flow-gap=""
          type="number"
          inputMode="numeric"
          min={FLOW_RANGE.gap.min}
          max={FLOW_RANGE.gap.max}
          step={10}
          suffix="px"
          value={gap}
          onChange={(e) => {
            drafts.current.gap = e.target.value;
            setGap(e.target.value);
            schedule();
          }}
          onBlur={() => commit()}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              commit();
            }
          }}
        />
      </Field>
      {bad?.row === "gap" ? (
        <p className="dag-settings__problem" role="alert" data-dag-board-flow-bad="">
          {bad.text}
        </p>
      ) : null}
      <div className="dag-settings__preview" data-dag-board-flow-preview="" aria-hidden="true">
        <div className="dag-settings__previewRow" style={preview}>
          {PREVIEW_BOXES.map((i) => (
            <span key={i} className={`dag-settings__previewBox${i % 2 === 0 ? " dag-settings__previewBox--warm" : ""}`} />
          ))}
        </div>
      </div>
    </Group>
  );
}
