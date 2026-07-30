import type { ReactNode } from "react";

type ContextRailProps = {
  children?: ReactNode;
};

export function ContextRail({ children }: Readonly<ContextRailProps>) {
  return (
    <aside
      className="context-rail"
      aria-label="Research context"
    >
      {children ?? (
        <p className="context-rail-empty">
          Select an item to see details here.
        </p>
      )}
    </aside>
  );
}
