import Link from "next/link";
import { ArrowUpRight } from "lucide-react";
export default function NotFound() { return <div className="container error-page"><p className="eyebrow" style={{ justifyContent: "center" }}>Page not found</p><h1>A little off track.</h1><p>We couldn’t find this page. There are more programs and offers waiting in the marketplace.</p><Link href="/marketplace" className="button button-primary">Explore the marketplace<ArrowUpRight size={16} /></Link></div>; }
