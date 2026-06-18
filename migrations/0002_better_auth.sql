-- better-auth schema (Google OAuth only).
-- Tables: user, session, account, verification.
--
-- Column names follow better-auth's default camelCase convention. Timestamp
-- columns are declared TEXT (better-auth's CLI emits `date`, but SQLite gives
-- `date` NUMERIC affinity while storing ISO-8601 strings either way; TEXT is
-- explicit and round-trips identical ISO strings — verified empirically).

CREATE TABLE "user" (
  "id" TEXT PRIMARY KEY NOT NULL,
  "email" TEXT NOT NULL,
  "emailVerified" INTEGER DEFAULT FALSE NOT NULL,
  "name" TEXT NOT NULL,
  "image" TEXT,
  "createdAt" TEXT DEFAULT (CURRENT_TIMESTAMP) NOT NULL,
  "updatedAt" TEXT DEFAULT (CURRENT_TIMESTAMP) NOT NULL
);

CREATE TABLE "session" (
  "id" TEXT PRIMARY KEY NOT NULL,
  "token" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "expiresAt" TEXT NOT NULL,
  "ipAddress" TEXT,
  "userAgent" TEXT,
  "createdAt" TEXT DEFAULT (CURRENT_TIMESTAMP) NOT NULL,
  "updatedAt" TEXT DEFAULT (CURRENT_TIMESTAMP) NOT NULL,
  FOREIGN KEY ("userId") REFERENCES "user"("id") ON DELETE CASCADE
);

CREATE TABLE "account" (
  "id" TEXT PRIMARY KEY NOT NULL,
  "providerId" TEXT NOT NULL,
  "accountId" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "accessToken" TEXT,
  "refreshToken" TEXT,
  "idToken" TEXT,
  "accessTokenExpiresAt" TEXT,
  "refreshTokenExpiresAt" TEXT,
  "scope" TEXT,
  "password" TEXT,
  "createdAt" TEXT DEFAULT (CURRENT_TIMESTAMP) NOT NULL,
  "updatedAt" TEXT DEFAULT (CURRENT_TIMESTAMP) NOT NULL,
  FOREIGN KEY ("userId") REFERENCES "user"("id") ON DELETE CASCADE
);

CREATE TABLE "verification" (
  "id" TEXT PRIMARY KEY NOT NULL,
  "value" TEXT NOT NULL,
  "identifier" TEXT NOT NULL,
  "expiresAt" TEXT NOT NULL,
  "createdAt" TEXT DEFAULT (CURRENT_TIMESTAMP) NOT NULL,
  "updatedAt" TEXT DEFAULT (CURRENT_TIMESTAMP) NOT NULL
);

CREATE UNIQUE INDEX "session_token_unique" ON "session"("token");
CREATE UNIQUE INDEX "user_email_unique" ON "user"("email");
