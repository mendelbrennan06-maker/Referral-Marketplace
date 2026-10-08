import { z } from 'zod';
export const TERMS_VERSION = '2026-10-08';
export const normalizeEmail = (value: string) => value.trim().toLowerCase();
const reserved = new Set(['admin','administrator','root','support','help','system','staff','referralmarket','referral-market','moderator','payments','api','login','register','official']);
export function validUsername(value: string) { const username=value.trim().toLowerCase(); if(!/^[a-z0-9][a-z0-9_-]{2,29}$/.test(username)||reserved.has(username)||/^(admin|support|official|moderator)[_-]/.test(username)) throw new Error('Choose a URL-safe username of 3–30 characters without reserved staff names.'); return username; }
export function validPassword(value: unknown) { const password=z.string().min(12,'Use at least 12 characters.').max(72,'Use at most 72 characters.').parse(value); if(Array.from(password).length<12)throw new Error('Use at least 12 characters.'); if(Buffer.byteLength(password,'utf8')>72) throw new Error('Use at most 72 UTF-8 bytes (bcrypt limit). Spaces and punctuation are welcome.'); return password; }
