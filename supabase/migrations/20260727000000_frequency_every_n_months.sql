-- Add the "every N months" cadence to the frequency enum: an amount received
-- once every N months, where N is a user-supplied positive integer. A newly
-- added enum value cannot be referenced in the same transaction that adds it, so
-- the interval checks that reference this value live in the following migration.

alter type public.frequency add value if not exists 'every_n_months';
