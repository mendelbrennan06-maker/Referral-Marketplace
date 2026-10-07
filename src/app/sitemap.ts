import type { MetadataRoute } from "next";
import { db } from "@/lib/db";
import { site } from "@/lib/config";
export const dynamic = "force-dynamic";
export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const [programs, categories] = await Promise.all([db.program.findMany({ select: { slug: true, updatedAt: true }, take: 10000 }), db.category.findMany({ select: { slug: true, updatedAt: true }, take: 1000 })]);
  return [{ url: site.url, changeFrequency: "weekly", priority: 1 }, { url: `${site.url}/marketplace`, changeFrequency: "daily", priority: .9 }, ...programs.map(p => ({ url: `${site.url}/referral/${p.slug}`, lastModified: p.updatedAt, changeFrequency: "weekly" as const, priority: .8 })), ...categories.map(c => ({ url: `${site.url}/category/${c.slug}`, lastModified: c.updatedAt, changeFrequency: "weekly" as const, priority: .7 }))];
}
