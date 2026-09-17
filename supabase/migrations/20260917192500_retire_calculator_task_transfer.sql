-- Retire only the calculator-specific task/budget publishing entry point.
-- Existing estimates, tasks, budgets, and shared mutation functions are preserved.
drop function if exists public.publish_calculator_budget(uuid, jsonb);
