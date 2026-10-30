-- To-dos, the activity feed, drip message log and blasts were not wanted.
-- Their tables were empty when removed.
begin;

drop function public.get_todos(text, uuid);
drop function public.save_todo(uuid, uuid, text, text, date, uuid);
drop function public.set_todo_done(uuid, boolean);
drop function public.delete_todo(uuid);
drop table public.todos;

drop function public.get_activity_feed(uuid, integer);
drop function public.get_message_activity();

drop function public.count_blast_audience(text, text);
drop function public.save_blast(uuid, text, text, text, text, text);
drop function public.send_blast(uuid);
drop function public.delete_blast(uuid);
drop function public.get_blasts();
drop function private.blast_audience(uuid, text, text);
alter table public.outbound_messages drop column blast_id;
drop table public.blasts;

select pg_notify('pgrst', 'reload schema');

commit;
