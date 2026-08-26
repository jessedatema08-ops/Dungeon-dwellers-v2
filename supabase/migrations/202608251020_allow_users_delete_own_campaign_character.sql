create policy "players delete own character"
on public.characters
for delete
to authenticated
using (user_id = auth.uid());
