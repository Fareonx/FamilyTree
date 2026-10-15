-- Keep the RLS helper functions out of the exposed API schema.
create schema if not exists private;
alter function public.is_member() set schema private;
alter function public.is_editor() set schema private;
revoke all on function private.is_member() from public, anon;
revoke all on function private.is_editor() from public, anon;
grant usage on schema private to authenticated;
grant execute on function private.is_member() to authenticated;
grant execute on function private.is_editor() to authenticated;
