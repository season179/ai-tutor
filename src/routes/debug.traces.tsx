import { createFileRoute } from "@tanstack/react-router";

import { LocalTracesPage } from "../client/components/debug/LocalTracesPage.js";

export const Route = createFileRoute("/debug/traces")({
  ssr: false,
  component: LocalTracesPage
});
