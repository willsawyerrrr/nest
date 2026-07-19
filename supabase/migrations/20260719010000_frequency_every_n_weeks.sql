-- Add the "every N weeks" cadence to the frequency enum: an amount received once
-- every N weeks, where N is a user-supplied positive integer. A newly added enum
-- value cannot be referenced in the same transaction that adds it, so the
-- interval_weeks column and its check that references this value live in the
-- following migration.

alter type public.frequency add value if not exists 'every_n_weeks';
