-- Superannuation: turn the linked account's balance into a dated baseline that
-- accrues modelled contributions between true-ups.
--
-- Under payday super the balance a member enters is only accurate on the day
-- they confirm it. Rather than let it drift stale, treat `balance_cents` on the
-- linked account as a baseline confirmed on `balance_as_of`, and estimate the
-- effective balance by accruing the member's modelled net annual contributions
-- from that date. A "true-up" rewrites the balance and resets `balance_as_of` to
-- today. No investment growth is applied to the live figure — contributions only.

alter table public.super_profile add column balance_as_of date;

comment on column public.super_profile.balance_as_of is 'The date the linked account''s balance_cents was last confirmed (a true-up). The effective balance accrues the member''s modelled net contributions from this date; null treats the stored balance as current (no accrual).';
