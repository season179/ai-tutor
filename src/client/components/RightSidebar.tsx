import type { RefObject } from "react";

import { classNames } from "../lib/class-names.js";
import { EventLogPanel } from "./EventLogPanel.js";
import { VoiceSessionPanel } from "./VoiceSessionPanel.js";

type RightSidebarProps = {
  audioRef: RefObject<HTMLAudioElement | null>;
  canRecordAudioTurn: boolean;
  collapsed: boolean;
  hasPriorActivity: boolean;
  isRecording: boolean;
  isRunning: boolean;
  logText: string;
  onFinishAudioTurn: () => void;
  onStart: () => void;
  onStartAudioTurn: () => void;
  onStop: () => void;
  onToggleCollapsed: () => void;
  sessionReady: boolean;
};

export function RightSidebar({
  audioRef,
  canRecordAudioTurn,
  collapsed,
  hasPriorActivity,
  isRecording,
  isRunning,
  logText,
  onFinishAudioTurn,
  onStart,
  onStartAudioTurn,
  onStop,
  onToggleCollapsed,
  sessionReady
}: RightSidebarProps) {
  const toggleLabel = collapsed ? "Expand sidebar" : "Collapse sidebar";

  return (
    <aside
      className={classNames("right-sidebar", collapsed && "right-sidebar--collapsed")}
      aria-label="Voice and session log"
    >
      <div className="right-sidebar-header">
        <button
          aria-expanded={!collapsed}
          aria-label={toggleLabel}
          className="icon-button right-sidebar-toggle"
          onClick={onToggleCollapsed}
          title={toggleLabel}
          type="button"
        >
          <ChevronIcon collapsed={collapsed} />
        </button>
      </div>

      <div className="right-sidebar-stack">
        <VoiceSessionPanel
          audioRef={audioRef}
          canRecordAudioTurn={canRecordAudioTurn}
          collapsed={collapsed}
          hasPriorActivity={hasPriorActivity}
          isRecording={isRecording}
          isRunning={isRunning}
          onFinishAudioTurn={onFinishAudioTurn}
          onStart={onStart}
          onStartAudioTurn={onStartAudioTurn}
          onStop={onStop}
          sessionReady={sessionReady}
        />

        {collapsed ? null : <EventLogPanel logText={logText} />}
      </div>
    </aside>
  );
}

function ChevronIcon({ collapsed }: { collapsed: boolean }) {
  return (
    <svg
      aria-hidden="true"
      fill="none"
      stroke="currentColor"
      strokeLinecap="round"
      strokeLinejoin="round"
      strokeWidth="1.8"
      viewBox="0 0 24 24"
      className={classNames("right-sidebar-chevron", collapsed && "right-sidebar-chevron--collapsed")}
    >
      <path d="M9 6l6 6-6 6" />
    </svg>
  );
}
