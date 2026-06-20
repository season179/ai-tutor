import { createFileRoute } from "@tanstack/react-router";

import { App } from "../client/App.js";

// The tutoring screen is browser-stateful (audio, voice, localStorage, refs), so
// it renders client-only. Start still SSRs the document shell around it.
export const Route = createFileRoute("/")({
  ssr: false,
  component: App,
});
