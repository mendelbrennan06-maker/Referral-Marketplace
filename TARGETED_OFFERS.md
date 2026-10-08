# Account-specific offers

Users submit a targeted referrer reward, optional personalized customer signup reward, qualification steps, expiration, and private PNG/JPEG/PDF proof. Uploads have magic-byte/MIME and 5 MB limits. Evidence lives in PostgreSQL and is downloadable only by the submitting user or an active administrator; users should redact account identifiers before upload.

Submissions enter PENDING_REVIEW. Admins inspect proof, explain approval/rejection, and review a dollar-value estimate for non-cash rewards. Verification expires after 30 days by default (`TARGETED_VERIFICATION_DAYS`, 1–90), or at the source expiration if sooner. Access checks enforce expiry even if the scheduled sweep is delayed; the worker marks expired offers and disables attached listings.

A listing can use the verified public offer, submit a new targeted offer with proof, or select the owner’s previously verified offer for that same program. New targeted listings stay pending until proof is verified and listing approval succeeds. Verified cash/estimated economics cap the permitted bounty. No one can attach another person’s targeted reward.

Public signup benefits, account-specific rewards, and customer cash bounties are separate. Verified targeted labels explain that the offer belongs to one referrer and is not universal. Optional customer-specific signup rewards also disclose individual eligibility. Private proof and reviewer notes are not serialized into public offers.

Requests and bids use active approved listings, including valid targeted listings. Acceptance rechecks program permissions, user access, listing availability, expiration, and targeted verification. One request accepts one bid atomically and creates the existing tracked referral; the agreed full bounty and separate fee are saved.
