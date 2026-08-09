# Command routing

Choose the narrowest matching command and make one call.

| User intent | Command |
| --- | --- |
| Daily/weekly overview, priorities, what needs attention | `ottawa briefing --days 14 --limit 20 --json` |
| Who worked, where the crew worked, clock-in/out times, hours, or timesheet approval for a day | `ottawa labour --date yesterday --limit 100 --json` (replace `yesterday` with `today` or `YYYY-MM-DD` when requested) |
| One job, address, project, profitability, labour usage | `ottawa job "<name/address/contact/id>" --json` |
| One customer, complete history, communications, relationship, or “what happened” | `ottawa customer-brief "<name/email/phone/id>" --max-evidence 30 --timeout-ms 6500 --json` |
| Explicitly database-only customer lookup | `ottawa customer "<name/email/phone/id>" --json` |
| Leads/quotes that may need follow-up | `ottawa followups --days 7 --limit 50 --json` |
| Upcoming jobs and missing preparation | `ottawa readiness --days 14 --limit 50 --json` |
| Open/overdue customer receivables | `ottawa cash --limit 50 --json` |
| Missing links, dates, contact details, or readiness data | `ottawa data-quality --limit 50 --json` |

For a multi-part executive question, prefer `briefing`. Call a second report only when the first result identifies a specific job/customer that the user asked to investigate. Never supplement a resolved `customer-brief` with separate Gmail, Quo, CompanyCam, or database calls unless the user explicitly requests a deep audit.

Escalate to `ottawa-db` only for an explicit deep audit. Keep raw SQL read-only and bounded; never inspect secrets or authentication schemas.
