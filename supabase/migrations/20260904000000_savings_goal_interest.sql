-- Model a user-entered interest rate on a savings goal.
--
-- A goal's projection is otherwise pure linear contribution math. This rate lets
-- the ETA and the required contribution reflect fortnightly compounding on the
-- running balance. It is a modelling assumption the household sets — Up publishes
-- no clean per-account rate — and applies whether or not the goal links a saver.
-- Basis points keep it an integer (450 = 4.50% p.a.); null or 0 models no
-- interest, and the projection then reduces exactly to the linear result. The
-- bound caps a fat-finger entry at 100% p.a.
--
-- Interest as assessable income is out of scope here (tracked as WSD-82).

alter table public.savings_goal
  add column annual_interest_bps integer
    constraint savings_goal_annual_interest_bps_range
      check (annual_interest_bps is null or (annual_interest_bps >= 0 and annual_interest_bps <= 10000));

comment on column public.savings_goal.annual_interest_bps is 'Modelled effective annual interest rate in basis points (450 = 4.50% p.a.), compounded fortnightly in the goal projection; null or 0 models no interest.';
