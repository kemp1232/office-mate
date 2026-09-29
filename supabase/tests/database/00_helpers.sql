-- Shared helpers for pgTAP files (created inside each test's transaction and rolled back).
-- Files run in lexical order; this one only asserts pgTAP is available.
begin;
create extension if not exists pgtap with schema extensions;
select plan(1);
select has_schema('app', 'app schema exists');
select * from finish();
rollback;
