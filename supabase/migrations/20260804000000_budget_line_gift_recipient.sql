-- Partition a gift breakdown's derived lines by recipient member.
--
-- A single gift breakdown funds gifts for everyone, but the two partners want to
-- fund each other's gifts from different accounts. So the one rolled-up gift line
-- splits into one derived line per household member who has gift budgets (plus one
-- line for all external, non-member recipients). This column is that partition
-- discriminator: on a gift-breakdown line it names the member whose gifts the line
-- funds; it is null for the external line, for generic-breakdown lines, and for
-- manual lines. The composite foreign key on (gift_recipient_member_id,
-- household_id) keeps the reference inside the household and cascades the line away
-- with the member. No new RLS policy is needed — the existing budget_line
-- household policy covers this column like every other.

alter table public.budget_line
  add column gift_recipient_member_id uuid,
  add constraint budget_line_gift_recipient_member_id_household_id_fkey
    foreign key (gift_recipient_member_id, household_id)
    references public.members (id, household_id) on delete cascade;
create index on public.budget_line (gift_recipient_member_id);

comment on column public.budget_line.gift_recipient_member_id is 'On a gift-breakdown line, the household member whose gifts this line funds; null for the external-recipients line, generic-breakdown lines, and manual lines.';
