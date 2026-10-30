# ServiceFlow deployment and ownership

Private repository: jaddoescad/serviceflow. Vercel project: ottawa-painters-dashboard (existing project name). Canonical production address: https://serviceflow-admin.vercel.app. Database: bwbckdkouqghdadpkjvn. Branding is explicit in source. Push to the connected current branch to deploy; never attach this repository to Ottawa Painters' Vercel project.

Contacts, deals, jobs, photos, tasks, issues, recorded hours, labour budgets and employee pay rates are edited here. The mobile app and Zapier continue using this database. A transactional outbox sends an explicit operational column allowlist to Ottawa Painters. No reverse sync exists. Receiver credentials are private and are not production service-role keys.

Customer-facing proposals, change orders, invoices and the payments recorded against them are edited here (job Invoices tab) and are not synced to Ottawa Painters. Banking, accounting, supplier invoices and allocations belong exclusively in Ottawa Painters: https://ottawa-painters-admin.vercel.app. Run supported manual accounting commands from the ottawa-painters-admin repository using its protected credentials. Accounting pages and dedicated import/repair scripts have been removed from this repository. Historical migrations are retained as provenance only; do not replay them over production.

The receiver runs in Ottawa Painters every minute. Failed delivery leases expire in three minutes. Destination writes preserve UUIDs and versions, update source-owned columns only, and retain deleted records as archived copies for accounting history. Monitor its sync status banner before diagnosing stale records. New employees never gain Ottawa Painters login access through this pipeline.
