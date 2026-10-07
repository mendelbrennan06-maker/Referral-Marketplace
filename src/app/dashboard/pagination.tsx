import Link from "next/link";

export function pageNumber(value?: string) {
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) && parsed > 0 ? Math.min(parsed, 10000) : 1;
}

export function Pagination({ page, total, pageSize = 25, href }: { page: number; total: number; pageSize?: number; href: string }) {
  const pages = Math.max(1, Math.ceil(total / pageSize));
  const destination = (next: number) => {
    const [path, query = ""] = href.split("?");
    const params = new URLSearchParams(query);
    params.set("page", String(next));
    return `${path}?${params.toString()}`;
  };
  if (pages <= 1) return null;
  return <nav className="form-actions pagination" aria-label="Pagination"><span className="tiny muted">Page {page} of {pages} · {total} records</span>{page > 1 && <Link className="button button-secondary button-sm" href={destination(page-1)}>Previous</Link>}{page < pages && <Link className="button button-secondary button-sm" href={destination(page+1)}>Next</Link>}</nav>;
}
