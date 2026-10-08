'use client';
import { useState } from 'react';
import Script from 'next/script';
import { Field } from './ui';
export function PasswordFields({current=false}:{current?:boolean}){
 const [password,setPassword]=useState('');const bytes=new TextEncoder().encode(password).length;
 const strength=bytes>72?'Too long for secure hashing':Array.from(password).length<12?'Use at least 12 characters':Array.from(password).length<16?'Good length — make it unique':'Strong length — make it unique';
 return <>{current&&<Field label="Current password"><input type="password" name="currentPassword" autoComplete="current-password" required maxLength={72}/></Field>}<Field label={current?'New password':'Password'} hint="12–72 UTF-8 bytes. Spaces, punctuation and password managers are welcome."><input type="password" name="password" autoComplete="new-password" required minLength={12} maxLength={72} onChange={e=>setPassword(e.target.value)}/><p className="tiny muted" role="status">{strength}</p></Field><Field label="Confirm password"><input type="password" name="confirmPassword" autoComplete="new-password" required minLength={12} maxLength={72}/></Field></>;
}
export function BotChallenge(){const key=process.env.NEXT_PUBLIC_TURNSTILE_SITE_KEY;if(!key)return null;return <><Script src="https://challenges.cloudflare.com/turnstile/v0/api.js" strategy="afterInteractive"/><div className="cf-turnstile" data-sitekey={key}/></>;}
