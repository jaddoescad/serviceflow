---
name: ottawa-meta-ads-reporting
description: Report Ottawa Painters Meta Ads performance from the read-only Marketing API connection. Use for daily or date-specific questions about Meta ad spend, customer leads, recruiting leads, cost per lead, campaign performance, seven-day trends, or ads spending without attributed leads.
---

# Ottawa Meta Ads Reporting

Use the bundled report script as the only Meta interface. It is read-only and uses `America/Toronto` for date defaults.

## Run a report

For yesterday:

```text
node /opt/data/skills/ottawa-meta-ads-reporting/scripts/meta-ads-report.mjs --json
```

For a specific date:

```text
node /opt/data/skills/ottawa-meta-ads-reporting/scripts/meta-ads-report.mjs --date YYYY-MM-DD --json
```

Run exactly once. Confirm `schema_version` is `1` and `status` is `ok`. Reply from `slack_text` and the structured metrics; do not recalculate them.

## Interpretation

- Treat `customer_acquisition.leads` as Meta-attributed customer leads.
- Report recruiting results separately; never mix applications into customer leads.
- Treat the seven-day comparison as directional because Meta attribution may update after the reporting date.
- Describe these as Meta-reported or Meta-attributed leads, not CRM-confirmed leads.
- Surface every returned warning or feedback item.

## Boundaries

- Never modify ads, campaigns, ad sets, creatives, budgets, audiences, or account settings.
- Never reveal access tokens, authorization headers, environment values, or credential files.
- If the script exits non-zero, report the concise error and stop. Do not inspect credentials or retry alternate account IDs.
