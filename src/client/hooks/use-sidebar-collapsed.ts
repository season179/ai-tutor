import { useCallback, useState } from "react";

import { sidebarCollapsedStorageKey } from "../types.js";

const storage =
  typeof localStorage !== "undefined" ? localStorage : (undefined as undefined | Storage);

function readStoredCollapsed(storageKey: string): boolean {
  if (!storage) {
    return false;
  }

  return storage.getItem(storageKey) === "1";
}

function writeStoredCollapsed(storageKey: string, collapsed: boolean): void {
  if (!storage) {
    return;
  }

  if (collapsed) {
    storage.setItem(storageKey, "1");
    return;
  }

  storage.removeItem(storageKey);
}

export function useSidebarCollapsed(
  storageKey: string = sidebarCollapsedStorageKey
): {
  collapsed: boolean;
  setCollapsed: (next: boolean) => void;
  toggleCollapsed: () => void;
} {
  const [collapsed, setCollapsedState] = useState<boolean>(() => readStoredCollapsed(storageKey));

  const setCollapsed = useCallback(
    (next: boolean) => {
      setCollapsedState(next);
      writeStoredCollapsed(storageKey, next);
    },
    [storageKey]
  );

  const toggleCollapsed = useCallback(() => {
    setCollapsedState((previous) => {
      const next = !previous;
      writeStoredCollapsed(storageKey, next);
      return next;
    });
  }, [storageKey]);

  return { collapsed, setCollapsed, toggleCollapsed };
}
