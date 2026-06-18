import { useCallback, useState } from "react";

import { sidebarCollapsedStorageKey } from "../types.js";

const storage =
  typeof localStorage !== "undefined" ? localStorage : (undefined as undefined | Storage);

function readStoredCollapsed(): boolean {
  if (!storage) {
    return false;
  }

  return storage.getItem(sidebarCollapsedStorageKey) === "1";
}

function writeStoredCollapsed(collapsed: boolean): void {
  if (!storage) {
    return;
  }

  if (collapsed) {
    storage.setItem(sidebarCollapsedStorageKey, "1");
    return;
  }

  storage.removeItem(sidebarCollapsedStorageKey);
}

export function useSidebarCollapsed(): {
  collapsed: boolean;
  setCollapsed: (next: boolean) => void;
  toggleCollapsed: () => void;
} {
  const [collapsed, setCollapsedState] = useState<boolean>(readStoredCollapsed);

  const setCollapsed = useCallback((next: boolean) => {
    setCollapsedState(next);
    writeStoredCollapsed(next);
  }, []);

  const toggleCollapsed = useCallback(() => {
    setCollapsedState((previous) => {
      const next = !previous;
      writeStoredCollapsed(next);
      return next;
    });
  }, []);

  return { collapsed, setCollapsed, toggleCollapsed };
}
