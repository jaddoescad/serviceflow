-- The job's description travels with the job (like its address), so the app
-- shows it as soon as the job opens instead of loading it afterwards.
create or replace view public.job_feed with (security_invoker = true) as
 SELECT job.id,
    job.name,
    job.status,
    job.formatted_address,
    job.address_line_1,
    job.address_line_2,
    job.city,
    job.province,
    job.postal_code,
    job.country,
    job.latitude,
    job.longitude,
    job.companycam_project_ids,
    job.scheduled_on,
    job.started_on,
    job.completed_on,
    job.is_feed_visible,
    job.updated_at,
    budget.budget_minutes,
    usage.used_minutes,
        CASE
            WHEN budget.budget_minutes IS NULL OR budget.budget_minutes = 0 THEN NULL::numeric
            ELSE round(usage.used_minutes::numeric / budget.budget_minutes::numeric * 100::numeric, 2)
        END AS budget_percent_used,
        CASE
            WHEN budget.budget_minutes IS NULL THEN 'not_configured'::text
            WHEN usage.used_minutes > budget.budget_minutes THEN 'over_budget'::text
            WHEN job.status = 'completed'::text THEN 'complete'::text
            ELSE 'active'::text
        END AS budget_status,
    job.lead_id,
    job.org_id,
    rate.budget_hourly_rate_cents,
    ( SELECT description.body
           FROM job_descriptions description
          WHERE description.job_id = job.id) AS description
   FROM jobs job
     LEFT JOIN LATERAL ( SELECT source.budget_minutes,
            COALESCE(source.hourly_rate_cents, NULLIF(source.metadata ->> 'formula_hourly_rate_cents'::text, ''::text)::integer) AS hourly_rate_cents
           FROM job_budgets source
          WHERE source.job_id = job.id AND (source.status = ANY (ARRAY['active'::text, 'closed'::text]))
          ORDER BY (source.status = 'active'::text) DESC, (source.source = ANY (ARRAY['manual'::text, 'project_budget'::text])) DESC, (source.source = 'manual'::text) DESC, source.version DESC, source.updated_at DESC, source.id
         LIMIT 1) budget ON true
     LEFT JOIN LATERAL ( SELECT
                CASE
                    WHEN budget.budget_minutes > 0 THEN COALESCE(budget.hourly_rate_cents, ( SELECT NULLIF(org.settings #>> '{labour_budget,planning_hourly_rate_cents}'::text[], ''::text)::integer AS "nullif"
                       FROM organizations org
                      WHERE org.id = job.org_id), 3000)
                    ELSE NULL::integer
                END AS budget_hourly_rate_cents) rate ON true
     LEFT JOIN LATERAL ( SELECT private.job_budget_used_minutes(job.id, rate.budget_hourly_rate_cents) AS used_minutes) usage ON true
  WHERE job.is_feed_visible;
