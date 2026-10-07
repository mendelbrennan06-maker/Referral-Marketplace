"use client";

import { useState } from "react";
import Link from "next/link";
import { ArrowRight, ShieldCheck } from "lucide-react";
import { ActionForm, SubmitButton } from "@/components/action-form";
import { Field, money } from "@/components/ui";
import { createListingAction } from "@/lib/actions";

type ProgramOption = { id: string; name: string; demo: boolean };
type Fee = { percentageBps: number; fixedCents: number; minimumCents: number; maximumCents: number | null };

export function ListingForm({ programs, fee }: { programs: ProgramOption[]; fee: Fee }) {
  const [reward, setReward] = useState("100");
  const [bounty, setBounty] = useState("50");
  const [rewardType, setRewardType] = useState("CASH");
  const rewardCents = Math.max(0, Math.round(Number(reward || 0) * 100));
  const bountyCents = Math.max(0, Math.round(Number(bounty || 0) * 100));
  let feeCents = Math.max(fee.minimumCents, Math.round(bountyCents * fee.percentageBps / 10000) + fee.fixedCents);
  if (fee.maximumCents !== null) feeCents = Math.min(feeCents, fee.maximumCents);
  feeCents = Math.min(bountyCents, feeCents);
  return <ActionForm action={createListingAction} className="stack">
    <div className="panel"><div className="panel-header"><h2>Choose your program</h2><span className="tiny muted">01 / 03</span></div><div className="panel-body stack">
      <Field label="Referral program" hint="Only programs enabled by an administrator can be listed."><select name="programId" required defaultValue=""><option value="" disabled>Select a program</option>{programs.map(p => <option value={p.id} key={p.id}>{p.name}{p.demo ? " · Demo program" : ""}</option>)}</select></Field>
      <div className="form-grid"><Field label="Referral URL"><input name="referralUrl" type="url" placeholder="https://company.com/ref/your-link" required /></Field><Field label="Referral code (optional)"><input name="referralCode" placeholder="Your referral code" maxLength={100} /></Field></div>
    </div></div>
    <div className="panel"><div className="panel-header"><h2>Set your offer</h2><span className="tiny muted">02 / 03</span></div><div className="panel-body stack">
      <div className="form-grid"><Field label={rewardType === "CASH" ? "Your expected referral reward (USD)" : "Estimated reward value (USD)"} hint="For points, miles, or perks, enter an estimated dollar value."><input name="expectedReward" type="number" min="0.01" max="100000" step="0.01" value={reward} onChange={e=>setReward(e.target.value)} required /></Field><Field label="Cash bounty you offer (USD)" hint="The customer receives your cash bounty minus the marketplace fee."><input name="bounty" type="number" min="0.01" max="100000" step="0.01" value={bounty} onChange={e=>setBounty(e.target.value)} required /></Field></div>
      <div className="form-grid"><Field label="Your referral reward type"><select name="rewardType" value={rewardType} onChange={e=>setRewardType(e.target.value)}>{["CASH","POINTS","MILES","CREDIT","GIFT_CARD","DISCOUNT","FREE_SERVICE","OTHER"].map(t=><option value={t} key={t}>{t.replaceAll("_"," ")}</option>)}</select></Field><Field label="Available referral slots"><input name="slots" type="number" defaultValue="3" min="1" max="1000" required /></Field></div>
      <div className="financial-breakdown"><div><span>{rewardType === "CASH" ? "Referral reward" : "Estimated reward value"}</span><strong>{money(rewardCents)}</strong></div><div><span>Your cash bounty</span><strong>{money(bountyCents)}</strong></div><div><span>Marketplace success fee</span><strong>{money(feeCents)}</strong></div><div className="breakdown-highlight"><span>Customer receives</span><strong>{money(bountyCents-feeCents)}</strong></div><div><span>{rewardType === "CASH" ? "You retain" : "Estimated retained value"}</span><strong>{money(rewardCents-bountyCents)}</strong></div></div>
      <p className="tiny muted">This is a preview. The server calculates and saves the final fee. No monthly subscription or fee to create a basic listing.</p>
    </div></div>
    <div className="panel"><div className="panel-header"><h2>Requirements & availability</h2><span className="tiny muted">03 / 03</span></div><div className="panel-body stack">
      <div className="form-grid"><Field label="Eligible countries" hint="Separate country codes with commas."><input name="countries" defaultValue="US" placeholder="US, GB, CA" required /></Field><Field label="Expires on (optional)"><input name="expiresAt" type="date" min={new Date().toISOString().slice(0,10)} /></Field></div>
      <Field label="Signup requirements" hint="Be specific: account eligibility, purchase requirements, and deadlines."><textarea name="requirements" rows={3} placeholder="New customers only. Complete all program requirements…" required minLength={10} maxLength={3000} /></Field>
      <Field label="Additional notes (optional)"><textarea name="notes" rows={2} maxLength={2000} placeholder="Anything else a customer should know" /></Field>
      <div className="notice"><ShieldCheck size={18} /><span>Your listing is reviewed before going live. Fund your wallet to reserve bounties when someone starts a referral.</span></div>
    </div></div>
    <div className="form-actions"><Link className="button button-secondary" href="/dashboard/listings">Cancel</Link><SubmitButton pendingLabel="Creating listing…">Submit for review <ArrowRight size={16} /></SubmitButton></div>
  </ActionForm>;
}
