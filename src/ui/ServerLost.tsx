import { Unplug } from "lucide-react";
import { useSyncExternalStore } from "react";

import { lostWords, onServerLost, serverLost } from "@/auth/lost";
import { Said } from "@/files/Said";

import { Toast } from "./Toast";

/**
 * The server no longer lets this page in (#402): `anydag serve` restarted, with another secret path,
 * under a page left open. Every write is refused from here on and the change feed has stopped, so the
 * page says so for as long as it is open — a toast with no timeout and no ×, since putting it away
 * would leave a page that looks alive and saves nothing — with the way back. A write refused
 * meanwhile says, in its own toast, that it was not saved (`useBoard`).
 */
export function ServerLost() {
  const lost = useSyncExternalStore(onServerLost, serverLost, serverLost);
  if (!lost) return null;
  const { short, full } = lostWords();
  return (
    <Toast icon={Unplug} tone="danger" role="alert" data-dag-server-lost="" title={full.replaceAll("`", "")}>
      <Said text={short} />
    </Toast>
  );
}
