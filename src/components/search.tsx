"use client";

import { Search, ArrowRight } from "lucide-react";
import { useId, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";

type Suggestion = { name: string; slug: string; category?: string };
export function ProgramSearch({ programs, defaultValue = "", compact = false }: { programs: Suggestion[]; defaultValue?: string; compact?: boolean }) {
  const id = useId();
  const router = useRouter();
  const [value, setValue] = useState(defaultValue);
  const [open, setOpen] = useState(false);
  const [focused, setFocused] = useState(-1);
  const suggestions = programs.filter(p => p.name.toLowerCase().includes(value.toLowerCase()) || p.category?.toLowerCase().includes(value.toLowerCase())).slice(0, 5);
  return <form className={`search-form ${compact ? "search-compact" : ""}`} action="/marketplace" method="get" role="search">
    <div className="search-input-wrap">
      <Search size={22} strokeWidth={1.6} aria-hidden="true" />
      <label className="sr-only" htmlFor={id}>Search a company or referral program</label>
      <input id={id} name="q" value={value} placeholder="Search a company or referral program…" autoComplete="off" role="combobox" aria-autocomplete="list" aria-expanded={open && suggestions.length > 0} aria-controls={`${id}-suggestions`} aria-activedescendant={focused >= 0 ? `${id}-suggestion-${focused}` : undefined} onChange={e => { setValue(e.target.value); setOpen(true); setFocused(-1); }} onFocus={() => setOpen(true)} onBlur={() => window.setTimeout(() => setOpen(false), 150)} onKeyDown={e => {
        if (e.key === "ArrowDown") { e.preventDefault(); setOpen(true); setFocused(n => Math.min(n + 1, suggestions.length - 1)); }
        if (e.key === "ArrowUp") { e.preventDefault(); setFocused(n => Math.max(n - 1, 0)); }
        if (e.key === "Escape") setOpen(false);
        if (e.key === "Enter" && open && focused >= 0 && suggestions[focused]) { e.preventDefault(); router.push(`/referral/${suggestions[focused].slug}`); }
      }} />
      {open && suggestions.length > 0 && <ul id={`${id}-suggestions`} className="search-suggestions" role="listbox" aria-label="Suggested programs">{suggestions.map((program, i) => <li key={program.slug} role="option" aria-selected={i === focused} id={`${id}-suggestion-${i}`}><Link href={`/referral/${program.slug}`} className={i === focused ? "suggestion active" : "suggestion"}><Search size={15} /><span>{program.name}<small>{program.category || "Referral program"}</small></span><ArrowRight size={15} /></Link></li>)}</ul>}
    </div>
    <button type="submit" className="search-submit" aria-label="Search programs"><span>Find offers</span><ArrowRight size={21} /></button>
  </form>;
}
