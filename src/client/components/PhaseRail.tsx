import { Fragment } from "react";

import { classNames } from "../lib/class-names.js";
import type { RailStation } from "../lib/phase-rail.js";

type PhaseRailProps = {
  stations: RailStation[];
};

/**
 * The Spine: a slim, always-visible rail collapsing the session's phase into the
 * four friendly stations a child can follow. State is server-owned — this only
 * paints what `railStations(currentPhase)` resolves.
 */
export function PhaseRail({ stations }: PhaseRailProps) {
  return (
    <div className="rail" aria-label="Lesson progress">
      {stations.map((station, index) => (
        <Fragment key={station.label}>
          {index > 0 ? (
            <span
              aria-hidden="true"
              className={classNames("conn", station.state === "next" && "conn--next")}
            />
          ) : null}
          <div className={classNames("station", `station--${station.state}`)}>
            <span aria-hidden="true" className="pip" />
            {station.label}
          </div>
        </Fragment>
      ))}
    </div>
  );
}
