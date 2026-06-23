import { useEffect, useState, type ComponentType } from "react";

/**
 * Local-only TanStack devtools. The unified panel auto-detects the installed
 * TanStack libraries (Router, Query, Form, Pacer) — no plugins or event-bus
 * wiring are needed for the base panel, which is all this phase ships.
 *
 * The devtools module is loaded with a dynamic `import()` that runs only when
 * `import.meta.env.DEV` is true. In production that whole branch is dead code,
 * so the bundler never emits the devtools module into the prod build at all
 * (same pattern TanStack Query's own devtools use). The import also happens in
 * an effect, so the panel mounts only after hydration on the client — it never
 * renders during SSR, avoiding hydration mismatches.
 */
export function Devtools() {
  const [Panel, setPanel] = useState<ComponentType | null>(null);

  useEffect(() => {
    if (!import.meta.env.DEV) {
      return;
    }

    let active = true;
    import("@tanstack/react-devtools")
      .then((mod) => {
        if (active) {
          setPanel(() => mod.TanStackDevtools);
        }
      })
      .catch(() => {
        // Devtools are non-essential; a load failure must never break the app.
      });

    return () => {
      active = false;
    };
  }, []);

  if (!Panel) {
    return null;
  }

  return <Panel />;
}
