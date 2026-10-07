"use client";
import { RefreshCw } from "lucide-react";
export default function ErrorPage({ reset }: { error: Error & { digest?: string }; reset: () => void }) { return <div className="container error-page"><p className="eyebrow" style={{ justifyContent: "center" }}>Something went wrong</p><h1>Let’s try that again.</h1><p>We couldn’t load this page. Please retry in a moment.</p><button type="button" onClick={reset} className="button button-primary"><RefreshCw size={16} />Try again</button></div>; }
