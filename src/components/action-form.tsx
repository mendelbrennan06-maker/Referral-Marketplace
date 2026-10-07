"use client";

import { useActionState, type ButtonHTMLAttributes, type ReactNode } from "react";
import { useFormStatus } from "react-dom";
import { LoaderCircle } from "lucide-react";
import type { FormAction } from "@/lib/types";

export function ActionForm({ action, children, className = "stack", successMessage }: { action: FormAction; children: ReactNode; className?: string; successMessage?: string }) {
  const [state, formAction] = useActionState(action, {});
  return <form action={formAction} className={className}>
    {state.error && <div className="notice notice-danger" role="alert">{state.error}</div>}
    {state.success && <div className="notice notice-success" role="status">{successMessage || state.success}</div>}
    {children}
  </form>;
}

export function SubmitButton({ children, pendingLabel = "Working…", className = "button button-primary", disabled, ...props }: ButtonHTMLAttributes<HTMLButtonElement> & { pendingLabel?: string }) {
  const { pending } = useFormStatus();
  return <button {...props} type="submit" className={className} disabled={disabled || pending} aria-busy={pending}>
    {pending ? <><LoaderCircle size={16} className="spin" />{pendingLabel}</> : children}
  </button>;
}
