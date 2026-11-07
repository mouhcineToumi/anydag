import { Component, type ReactNode } from "react";

import { fail, flush } from "@/telemetry/client";

interface Props {
  children: ReactNode;
}

interface State {
  broken: boolean;
}

/**
 * Draws a reload screen instead of a white page when a render throws. React unmounts the whole
 * tree on an uncaught render error, so without a boundary the page is blank. It is a class because
 * there is no hook form of `getDerivedStateFromError`.
 */
export class Boundary extends Component<Props, State> {
  override state: State = { broken: false };

  static getDerivedStateFromError(): State {
    return { broken: true };
  }

  /** Logged when somebody said yes (`telemetry/client.ts`), and sent now: the page is not coming back. */
  override componentDidCatch(error: unknown): void {
    fail("render", error);
    flush(true);
  }

  override render(): ReactNode {
    if (!this.state.broken) return this.props.children;
    return (
      <div className="dag-crash" data-dag-crash role="alert">
        <div className="dag-crash__card">
          <h1 className="dag-crash__title">AnyDag stopped</h1>
          <p className="dag-crash__body">
            Something went wrong while drawing this page. Your board is saved as a file, so nothing you did has been lost.
            Reloading usually brings it back.
          </p>
          <button className="dag-crash__act" type="button" onClick={() => location.reload()}>
            Reload
          </button>
        </div>
      </div>
    );
  }
}
