-- Initialize the success fee for an empty marketplace without sample user data.
-- Preserve any fee settings already edited by an administrator.
INSERT INTO "FeeSetting" ("id", "percentageBps", "fixedCents", "minCents", "maxCents", "createdAt", "updatedAt")
VALUES ('global', 1000, 0, 0, NULL, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
ON CONFLICT ("id") DO NOTHING;
