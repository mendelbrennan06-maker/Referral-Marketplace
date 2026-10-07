import type { Metadata } from "next";
import { site } from "@/lib/config";
import { Nav } from "@/components/nav";
import { Footer } from "@/components/footer";
import "./globals.css";

export const metadata: Metadata = { metadataBase: new URL(site.url), title: { default: `${site.name} — Good referrals. Shared rewards.`, template: `%s | ${site.name}` }, description: site.description, openGraph: { title: `${site.name} — Never use a referral link for free.`, description: site.description, type: "website", siteName: site.name }, twitter: { card: "summary_large_image" } };
export const dynamic = "force-dynamic";
export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return <html lang="en"><body><a href="#main-content" className="skip-link">Skip to content</a><Nav /><main id="main-content">{children}</main><Footer /></body></html>;
}
