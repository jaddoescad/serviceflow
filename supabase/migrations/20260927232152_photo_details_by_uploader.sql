-- Let people describe and mark up the photos they took themselves.
--
-- edit_photo_details and save_photo_annotations were manager-only, so a crew
-- member couldn't add a note or drawing to their own capture from the phone.
-- Managers can still edit any photo in their company; everyone else can edit
-- photos they uploaded. The function bodies are patched in place and the block
-- fails if an anchor is missing.
do $migration$
declare
  details text := pg_get_functiondef('private.edit_photo_details__unscoped(uuid,uuid,text,uuid,text,text[])'::regprocedure);
  notes text := pg_get_functiondef('private.save_photo_annotations__unscoped(uuid,uuid,text,uuid,jsonb)'::regprocedure);
  d_auth constant text := E'  if auth.uid() is null or not private.is_manager() then\n    raise exception ''Only active managers can edit photo details.'' using errcode = ''42501'';\n  end if;';
  d_found constant text := E'  if not found then\n    raise exception ''Photo not found.'' using errcode = ''P0002'';\n  end if;';
  n_auth constant text := E'if auth.uid() is null or not private.is_manager() then raise exception ''Only active managers can edit annotations.'' using errcode=''42501''; end if;';
  n_found constant text := E'raise exception ''Photo unavailable.'' using errcode=''P0002'';\n  end if;';
begin
  if position(d_auth in details) = 0 or position(d_found in details) = 0
     or position(n_auth in notes) = 0 or position(n_found in notes) = 0 then
    raise exception 'photo edit functions have changed; update this migration';
  end if;

  details := replace(details, d_auth, E'  if auth.uid() is null or not private.acting_member() then\n    raise exception ''Only active members can edit photo details.'' using errcode = ''42501'';\n  end if;');
  details := replace(details, d_found, d_found
    || E'\n  if not private.is_manager() and media.uploaded_by is distinct from auth.uid() then\n'
    || E'    raise exception ''Only managers can edit photos taken by someone else.'' using errcode = ''42501'';\n  end if;');

  notes := replace(notes, n_auth, E'if auth.uid() is null or not private.acting_member() then raise exception ''Only active members can edit annotations.'' using errcode=''42501''; end if;');
  notes := replace(notes, n_found, n_found
    || E'\n  if not private.is_manager() and media.uploaded_by is distinct from auth.uid() then\n'
    || E'    raise exception ''Only managers can edit photos taken by someone else.'' using errcode=''42501'';\n  end if;');

  execute details;
  execute notes;
end
$migration$;
