import type { ReactNode } from "react";
import { ArrowUpRight, Inbox } from "lucide-react";

export function money(cents: number, currency = "USD") {
  return new Intl.NumberFormat("en-US", { style: "currency", currency, minimumFractionDigits: cents % 100 === 0 ? 0 : 2, maximumFractionDigits: 2 }).format(cents / 100);
}
export function Money({ cents, currency = "USD" }: { cents: number; currency?: string }) { return <>{money(cents, currency)}</>; }

const marks: Record<string, { color: string; text: string }> = {
  sofi: { color: "#007b89", text: "SoFi" }, rakuten: { color: "#bf0024", text: "R" }, uber: { color: "#121212", text: "Uber" }, doordash: { color: "#eb1700", text: "D" }, dropbox: { color: "#0061ff", text: "Db" }, revolut: { color: "#1c1c1c", text: "R" }, "t-mobile": { color: "#e20074", text: "T" }, rove: { color: "#315a3b", text: "rove" }, "demo-fintech": { color: "#6260d0", text: "D" }, "demo-cashback": { color: "#d67635", text: "C" }, "demo-travel": { color: "#257c68", text: "T" }, "demo-cloud": { color: "#5282d0", text: "C" },
};
export function ProgramMark({ name, slug, size = "md" }: { name: string; slug?: string; size?: "sm" | "md" | "lg" }) {
  const mark = marks[slug || name.toLowerCase().replaceAll(" ", "-")] || { color: "#263e44", text: name.slice(0, 2) };
  return <span aria-hidden="true" className={`program-mark program-mark-${size}`} style={{ backgroundColor: mark.color }}>{mark.text}</span>;
}
export function StatusBadge({ status }: { status: string }) {
  const positive = ["ACTIVE", "ALLOWED", "VERIFIED", "PAID", "RESOLVED", "FUNDED", "APPROVED"].includes(status);
  const negative = ["PROHIBITED", "REJECTED", "SUSPENDED", "CANCELLED", "DISABLED"].includes(status);
  const caution = ["DISPUTED", "RESTRICTED", "UNKNOWN", "PENDING", "AWAITING_VERIFICATION", "PAYOUT_PENDING"].includes(status);
  return <span className={`badge ${positive ? "badge-success" : negative ? "badge-danger" : caution ? "badge-warning" : "badge-muted"}`}><span className="status-dot" />{status.toLowerCase().replaceAll("_", " ")}</span>;
}
export function EmptyState({ title, description, action }: { title: string; description?: string; action?: ReactNode }) {
  return <div className="empty-state"><div className="empty-icon"><Inbox size={24} strokeWidth={1.5} /></div><h3>{title}</h3>{description && <p>{description}</p>}{action && <div>{action}</div>}</div>;
}
export function PageHeading({ eyebrow, title, description, actions }: { eyebrow?: string; title: string; description?: string; actions?: ReactNode }) {
  return <div className="page-heading"><div>{eyebrow && <p className="eyebrow">{eyebrow}</p>}<h1>{title}</h1>{description && <p className="muted">{description}</p>}</div>{actions && <div className="page-actions">{actions}</div>}</div>;
}
export function Field({ label, children, hint }: { label: string; children: ReactNode; hint?: string }) {
  return <label className="field"><span className="field-label">{label}</span>{children}{hint && <span className="field-hint">{hint}</span>}</label>;
}
export function TextLink({ children, href }: { children: ReactNode; href: string }) { return <a className="text-link" href={href}>{children}<ArrowUpRight size={16} /></a>; }
