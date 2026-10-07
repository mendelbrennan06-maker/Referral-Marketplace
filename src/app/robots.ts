import type { MetadataRoute } from "next";
import { site } from "@/lib/config";
export const dynamic = "force-dynamic";
export default function robots(): MetadataRoute.Robots { return { rules: { userAgent: "*", allow: "/", disallow: ["/dashboard/", "/admin/", "/api/", "/go/", "/login", "/register"] }, sitemap: `${site.url}/sitemap.xml` }; }
