-- Assertions for the budget line management link: it is optional, and a stored
-- value must be a trimmed http(s) URL with a host, at most 2048 characters.
--
-- Any failed assertion aborts the script (psql ON_ERROR_STOP). Wrapped in a
-- transaction and rolled back.

\set ON_ERROR_STOP on
begin;

insert into auth.users (instance_id, id, aud, role, email) values
  ('00000000-0000-0000-0000-000000000000', '31000000-0000-0000-0000-000000000001', 'authenticated', 'authenticated', 'bmu@example.com');

set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"31000000-0000-0000-0000-000000000001","email":"bmu@example.com"}', true);
select public.create_household('Link household', 'Ada') as hid \gset
select set_config('bmu.hid', :'hid', false);

do $$
declare
  v_hid uuid := current_setting('bmu.hid')::uuid;
  v_value text;
begin
  insert into public.budget_line (household_id, line_group, name, amount_cents, frequency)
    values (v_hid, 'wants', 'No link', 1_00, 'monthly');
  assert (select management_url from public.budget_line where name = 'No link') is null,
    'the management link should default to null';

  foreach v_value in array array[
    'https://www.netflix.com/account',
    'http://example.com',
    'HTTPS://Example.com/a?b=c#d',
    'https://example.com:8080/x',
    'https://' || repeat('a', 2048 - length('https://'))
  ] loop
    insert into public.budget_line (household_id, line_group, name, amount_cents, frequency, management_url)
      values (v_hid, 'wants', 'ok', 1_00, 'monthly', v_value);
  end loop;

  foreach v_value in array array[
    '',
    ' https://example.com',
    'https://example.com ',
    'https://exa mple.com',
    'javascript:alert(1)',
    'ftp://example.com',
    'example.com',
    'https://',
    'https:///path',
    'https://' || repeat('a', 2048 - length('https://') + 1)
  ] loop
    begin
      insert into public.budget_line (household_id, line_group, name, amount_cents, frequency, management_url)
        values (v_hid, 'wants', 'bad', 1_00, 'monthly', v_value);
      raise exception 'FAIL: % should have been rejected', left(v_value, 40);
    exception when check_violation then
      null;
    end;
  end loop;

  begin
    update public.budget_line set management_url = 'javascript:alert(1)' where name = 'No link';
    raise exception 'FAIL: an update to a non-http(s) link should have been rejected';
  exception when check_violation then
    null;
  end;
end $$;

rollback;
