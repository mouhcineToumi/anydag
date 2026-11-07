import type { BoardItem } from "@/board/types";

/**
 * A diagram whose renderer does not exist yet.
 *
 * It shows the type and the source rather than an empty box, so a board written ahead of the
 * milestone that renders it is still legible — and so a typo in the fence type is obvious.
 */
export function PendingItem({ item }: { item: BoardItem }) {
  return (
    <div className="dag-pending">
      <div className="dag-pending__head">
        <span className="dag-pending__type">{item.type}</span>
        {item.title ? <span className="dag-pending__title">{item.title}</span> : null}
      </div>
      <pre className="dag-pending__src">{item.body}</pre>
    </div>
  );
}
