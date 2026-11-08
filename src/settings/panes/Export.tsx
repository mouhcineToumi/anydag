import { ChevronDown } from "lucide-react";
import { useEffect, useState } from "react";

import { megabytes, readLimits, type Limits } from "@/files/upload";

import { resetSettings, writeSettings } from "../store";
import { useSettings } from "../useSettings";
import { ScaledNumber, Switch } from "@/ui/controls";

import { Field, Group, Reset } from "./common";

/** The board grid an export margin is counted in: `metric.grid` in every theme. */
const GRID = 8;

/**
 * How this workspace's files leave and arrive: the old card's *Export* section, a line
 * saying where importing is, because importing is a gesture on a board rather than a setting, and
 * what this server takes as an attachment.
 */
export function ExportPane() {
  const s = useSettings();
  return (
    <>
      <Group title="Export">
        <Field label="PNG resolution" hint="How many image pixels per board pixel.">
          <select
            className="dag-select dag-select--narrow"
            data-dag-setting-export-scale=""
            value={String(s.export.scale)}
            onChange={(e) => writeSettings({ export: { scale: Number(e.target.value) } })}
          >
            {[1, 2, 3, 4].map((n) => (
              <option key={n} value={n}>
                {n}×
              </option>
            ))}
          </select>
        </Field>
        <Field label="Background" hint="Off exports the board on nothing, which suits a dark slide.">
          <Switch
            data-dag-setting-export-paper=""
            checked={s.export.paper}
            onChange={(e) => writeSettings({ export: { paper: e.target.checked } })}
          />
        </Field>
        <Field label="Margin" hint="Space around the board. A single item exports without either.">
          <ScaledNumber
            data-dag-setting-export-margin=""
            value={s.export.margin}
            scale={GRID}
            min={0}
            max={40}
            suffix="px"
            onValue={(margin) => writeSettings({ export: { margin } })}
          />
        </Field>
      </Group>

      <Group title="Import">
        <p className="dag-settings__prose">
          Drop files on a board, or use Import in a board&rsquo;s ⋯ menu. Images land as images and text as notes. An exported
          board, note or quiz comes back as its own file, and anything else becomes an attachment.
        </p>
      </Group>

      <Group title="Attachments">
        <UploadLimits />
      </Group>

      <Reset what="the export settings" onReset={() => resetSettings(["export"])} />
    </>
  );
}

/**
 * What this server takes as an attachment: the largest file and the types. Read-only,
 * because they are the server's and not the person's. Asked when the tab opens, never kept.
 */
function UploadLimits() {
  const [limits, setLimits] = useState<Limits | null>(null);
  useEffect(() => {
    let live = true;
    void readLimits().then((got) => live && setLimits(got));
    return () => {
      live = false;
    };
  }, []);
  return (
    <>
      <Field label="Largest file" plain>
        <span className="dag-settings__value" data-dag-setting-upload-max={limits?.maxBytes ?? ""}>
          {limits ? megabytes(limits.maxBytes) : "…"}
        </span>
      </Field>
      <details className="dag-settings__more">
        <summary>
          <span className="dag-settings__name">File types</span>
          <span className="dag-settings__value">{limits ? `${limits.types.length} kinds` : "…"}</span>
          <ChevronDown size={14} strokeWidth={2} aria-hidden="true" />
        </summary>
        <p className="dag-settings__types" data-dag-setting-upload-types="">
          {limits ? limits.types.map((t) => `.${t}`).join("  ") : ""}
        </p>
      </details>
    </>
  );
}
