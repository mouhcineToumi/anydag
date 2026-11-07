/** Hand the browser a file to save. The anchor is the whole mechanism; no library, no dialog. */
export function saveFile(name: string, data: Blob | string, type = "application/octet-stream"): void {
  const blob = data instanceof Blob ? data : new Blob([data], { type });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  a.click();
  /* Revoked on the next tick, not now: the click has to have started the download first. */
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

/** A board or item name as a file stem: `reference/erd` → `reference-erd`. */
export const fileStem = (name: string): string => name.replace(/[\/\\]+/g, "-").replace(/[^\w.-]+/g, "_");
