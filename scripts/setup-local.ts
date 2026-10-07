import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { randomBytes } from "node:crypto";
import { spawnSync } from "node:child_process";
import { config } from "dotenv";

if (!existsSync(".env")) {
  const password = randomBytes(24).toString("hex");
  const values = [
    `DATABASE_URL="postgresql://refermarket:${password}@127.0.0.1:5432/refermarket?schema=public"`,
    `POSTGRES_USER="refermarket"`, `POSTGRES_DB="refermarket"`,
    `POSTGRES_PASSWORD="${password}"`,
    `AUTH_SECRET="${randomBytes(48).toString("hex")}"`,
    `APP_URL="http://localhost:3000"`, `PAYMENT_MODE="demo"`,
    `NEXT_PUBLIC_SITE_NAME="ReferMarket"`, `DEMO_SEED="true"`,
    `DEMO_PASSWORD="${randomBytes(18).toString("base64url")}"`
  ];
  writeFileSync(".env", values.join("\n") + "\n", { mode: 0o600 });
}
config({ quiet: true });
if (!process.env.DATABASE_URL?.includes("127.0.0.1:5432/refermarket")) {
  throw new Error("Existing .env points to another database. Keep it intact and use its documented setup.");
}
if (!readFileSync(".env", "utf8").includes("POSTGRES_PASSWORD=")) {
  throw new Error("The existing .env has no local PostgreSQL credentials. It has been preserved.");
}
function run(args: string[]) {
  const result = spawnSync("docker", args, { stdio: "inherit" });
  if (result.status !== 0) throw new Error("Local PostgreSQL setup failed.");
}
const inspect = spawnSync("docker", ["container", "inspect", "refermarket-postgres"], { stdio: "ignore" });
if (inspect.status === 0) {
  run(["start", "refermarket-postgres"]);
} else {
  run(["run", "--detach", "--name", "refermarket-postgres", "--publish", "127.0.0.1:5432:5432",
    "--env", "POSTGRES_USER", "--env", "POSTGRES_DB", "--env", "POSTGRES_PASSWORD",
    "--volume", "refermarket-pgdata:/var/lib/postgresql/data", "postgres:17-alpine"]);
}
console.log("Local PostgreSQL started. Credentials remain in the ignored .env file.");
