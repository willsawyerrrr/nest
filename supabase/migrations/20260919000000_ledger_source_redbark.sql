-- Redbark syncs bank accounts and balances as a second ledger source,
-- alongside Up. A newly added enum value cannot be referenced in the same
-- transaction that adds it, so every later migration naming 'redbark' is its
-- own, later-timestamped file.

alter type public.ledger_source add value if not exists 'redbark';
