import { classNames } from "../lib/class-names.js";
import { EventLogPanel } from "./EventLogPanel.js";

type RightSidebarProps = {
  collapsed: boolean;
  logText: string;
  onToggleCollapsed: () => void;
};

export function RightSidebar({ collapsed, logText, onToggleCollapsed }: RightSidebarProps) {
  const toggleLabel = collapsed ? "Expand sidebar" : "Collapse sidebar";

  return (
    <aside
      className={classNames("right-sidebar", collapsed && "right-sidebar--collapsed")}
      aria-label="Session log"
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
