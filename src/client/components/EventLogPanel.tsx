import { useState } from "react";

import { ActionButton } from "./ActionButton.js";
import { Panel } from "./Panel.js";

type EventLogPanelProps = {
  logText: string;
};

export function EventLogPanel({ logText }: EventLogPanelProps) {
  const [copyStatus, setCopyStatus] = useState<"copied" | "error" | "idle">("idle");

  const handleCopy = () => {
    copyTextToClipboard(logText)
      .then(() => {
        setCopyStatus("copied");
        window.setTimeout(() => setCopyStatus("idle"), 1800);
      })
      .catch(() => {
        setCopyStatus("error");
        window.setTimeout(() => setCopyStatus("idle"), 2200);
      });
  };

  return (
    <Panel
      className="events-panel"
      description="Connection, image, and voice events."
      id="events-title"
      title="Session log"
    >
      <div className="log-actions">
        <ActionButton className="copy-log-action" onClick={handleCopy} variant="secondary">
          Copy logs
        </ActionButton>
        <span className="copy-log-status" role="status">
          {copyStatus === "copied" ? "Copied" : copyStatus === "error" ? "Copy failed" : ""}
        </span>
      </div>
      <pre aria-live="polite">{logText}</pre>
    </Panel>
  );
}

async function copyTextToClipboard(text: string): Promise<void> {
  if (navigator.clipboard) {
    await navigator.clipboard.writeText(text);
    return;
  }

  const textArea = document.createElement("textarea");
  textArea.value = text;
  textArea.setAttribute("readonly", "");
  textArea.style.position = "fixed";
  textArea.style.inset = "0";
  textArea.style.opacity = "0";
  textArea.style.pointerEvents = "none";

  document.body.append(textArea);
  textArea.select();

  try {
    if (!document.execCommand("copy")) {
      throw new Error("Copy command failed.");
    }
  } finally {
    textArea.remove();
  }
}
