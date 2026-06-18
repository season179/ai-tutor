import { createAuthClient } from "better-auth/react";

// Same-origin: better-auth routes live at /api/auth/* on this host. The session
// cookie attaches automatically to all same-origin fetch calls.
export const authClient = createAuthClient();
