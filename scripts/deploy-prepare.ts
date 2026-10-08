import "dotenv/config";
import { spawnSync } from "node:child_process";
import { PrismaClient } from "@prisma/client";

function run(name: string) {
  const result = spawnSync("npm", ["run", name], { stdio: "inherit" });
  if (result.status !== 0) throw new Error(`${name} failed. Deployment initialization was stopped.`);
}

async function main() {
  run("db:migrate");
  run("catalog:prepare");
  if (process.env.APP_ENV !== "demo") {
    if (process.env.DEMO_BOOTSTRAP_ONCE === "true" || process.env.DEMO_SEED === "true") throw new Error("Demo seeding is forbidden outside APP_ENV=demo.");
    return;
  }
  if (process.env.DEMO_BOOTSTRAP_ONCE !== "true") return;
  if (process.env.PAYMENT_MODE !== "demo" || process.env.DEMO_SEED !== "true") {
    throw new Error("One-time demo initialization requires explicit PAYMENT_MODE=demo and DEMO_SEED=true.");
  }
  const db = new PrismaClient();
  try {
    const marker = await db.adminAction.findFirst({ where: { action: "DEMO_BOOTSTRAP_COMPLETED", entityType: "Environment", entityId: "demo-v1" } });
    if (marker) {
      console.log("One-time demo initialization already completed. Existing data is preserved.");
      return;
    }
    run("db:seed");
    run("catalog:prepare");
    run("admin:create");
    const admin = await db.user.findUniqueOrThrow({ where: { email: process.env.ADMIN_EMAIL!.trim().toLowerCase() } });
    if (admin.role !== "ADMIN") throw new Error("Administrator bootstrap was not confirmed.");
    await db.adminAction.create({ data: { adminId: admin.id, action: "DEMO_BOOTSTRAP_COMPLETED", entityType: "Environment", entityId: "demo-v1", isDemo: true, details: { note: "Explicit one-time demo bootstrap. Subsequent deployments never reset balances or account data." } } });
    console.log("One-time demo initialization completed. Disable the bootstrap environment flags.");
  } finally { await db.$disconnect(); }
}

main().catch(error => {
  console.error(error instanceof Error ? error.message : "Deployment preparation failed.");
  process.exitCode = 1;
});
