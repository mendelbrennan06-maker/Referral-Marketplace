import { publicData,publicPrograms } from '@/lib/environment';
import { availableListingWhere } from "@/lib/catalog";
import Link from "next/link";
import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { ArrowUpRight, ChevronRight } from "lucide-react";
import { db } from "@/lib/db";
import { canUseProgram } from "@/lib/marketplace";
import { ProgramCard } from "@/components/program-card";
import { EmptyState, PageHeading } from "@/components/ui";

type Props = { params: Promise<{ slug: string }> };
export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { slug } = await params;
  const category = await db.category.findUnique({ where: { slug,...publicData() } });
  return category ? { title: `${category.name} referral offers`, description: category.description || `Explore and compare ${category.name.toLowerCase()} referral offers.`, alternates: { canonical: `/category/${slug}` } } : { title: "Category not found" };
}
export default async function CategoryPage({ params }: Props) {
  const { slug } = await params;
  const category = await db.category.findUnique({ where: { slug,...publicData() }, include: { programs: { where:publicPrograms(),include: { category: true, listings: { where: availableListingWhere(), select: { bountyCents: true, isFunded: true }, take: 100 } }, orderBy: { name: "asc" }, take: 100 } } });
  if (!category) notFound();
  return <section className="section-sm"><div className="container"><nav className="breadcrumb" aria-label="Breadcrumb"><Link href="/marketplace">Marketplace</Link><ChevronRight size={12} /><span>{category.name}</span></nav><PageHeading eyebrow="Explore by category" title={`${category.name}. Shared rewards.`} description={category.description || `Discover programs and referral offers in ${category.name.toLowerCase()}.`} actions={<Link href={`/marketplace?category=${category.slug}`} className="button button-secondary">Search this category<ArrowUpRight size={15} /></Link>} />{category.programs.length ? <div className="program-grid">{category.programs.map(program => <ProgramCard program={{ ...program, listings: canUseProgram(program) ? program.listings : [] }} key={program.id} />)}</div> : <EmptyState title="This category is just getting started" description="Explore the marketplace to find more programs." action={<Link href="/marketplace" className="button button-primary">Browse programs</Link>} />}<p className="section-caption"><span className="badge badge-demo">Demo data</span>Sample benefits are illustrative. Program marketplace eligibility is reviewed separately.</p></div></section>;
}
