# Labour invoice reconciliation audit

Generated 2026-07-26T01:37:53.988Z against Supabase project bwbckdkouqghdadpkjvn.

## Summary

- Invoice files: 213
- Job links: 224
- Distinct linked jobs: 124
- Matched single-job files: 115
- Matched shared files: 36
- Unmatched labour invoice files: 9
- Non-job/overhead files: 33
- Duplicate/version groups: 16 (37 files)
- Shared invoices still missing a per-job split: 1
- Tracked non-test jobs: 161
- Tracked jobs without a linked invoice: 51 (36 completed, 15 open)
- Storage: 213 objects; 0 missing; 0 orphaned; private bucket confirmed

## Unmatched labour invoices

| Date | Supplier / invoice | Pre-tax | File | Why still unmatched |
|---|---|---:|---|---|
| 2025-07-23 | Unknown supplier #FILE-1EC137DDC9A7 | $2,574.00 | 2025-07-23 - PO 250001 & 250002.xlsx | Bradley is clear, but Roxanne has two same-customer proposals and the debit note does not identify the proposal split. |
| 2025-10-07 | Polaris Painters #41 | $5,900.00 | 2025-10-07 - Hosted - Jobber Invoice 41 - Services Rendered.pdf | Scott MacEwen is not present in the imported/current job list. |
| 2025-11-20 | Polaris Painters #45 | $2,150.00 | 2025-11-20 - Hosted - Jobber Invoice 45 - Elizabeth McCrae.pdf | Two Elizabeth McCrea proposals were signed and completed together; the invoice does not identify which proposal. |
| 2026-02-12 | Polaris Painters #56 | $180.00 | 2026-02-12 - Hosted - Jobber Invoice 56 - Reza - work with Scott.pdf | Internal work description; no customer job or address. |
| 2026-03-28 | Youssef Mroueh #1 | $3,150.00 | 2026-03-28 - invoice1.pdf | No job exists for 3791 Canyon Walk Drive. |
| 2026-03-28 | Youssef Mroueh #2 | $3,150.00 | 2026-03-28 - invoice2.pdf | No job exists for 3791 Canyon Walk Drive. |
| 2026-03-28 | Youssef Mroueh #3 | $3,150.00 | 2026-03-28 - invoice3.pdf | No job exists for 3789 Canyon Walk Drive. |
| 2026-03-28 | Youssef Mroueh #4 | $3,150.00 | 2026-03-28 - invoice4.pdf | No job exists for 1065 Beryl Private. |
| 2026-04-28 | Done Right Handyman Services #260048 | $150.00 | 2026-04-28 - Invoice_260048_from_Done_Right_Handyman_Services.pdf | Light-fixture service has no customer job or address. |

## Shared invoices still needing allocation

- 2026-04-05 - IMG_2959.jpeg — $855.00 pre-tax across Paul Harrison Rental and Christine Leclair — proposal 2370863 (completed). The source gives one combined total and no job split.

## Duplicate and revision groups

| Supplier / invoice | Files | Versions |
|---|---:|---|
| 613PAINTING INC #25001 | 3 | 2025-10-01 - INVOICE_25001_from_613PAINTING INC.pdf ($1,229.18); 2025-10-02 - INVOICE_25001_from_613PAINTING INC (2).pdf ($1,229.18); 2025-10-02 - INVOICE_25001_from_613PAINTING INC.pdf ($1,229.18) |
| Abdellah Aouf #INV-20260128-001 | 2 | 2026-01-29 - invoice_ottawa_painters copy.pdf ($1,900.00); 2026-02-20 - Invoice Feb 18.pdf ($800.00) |
| Abdellah Aouf #INV-20260615-001 | 2 | 2026-06-15 - INV-20260615-001 (2).pdf ($520.00); 2026-06-15 - INV-20260615-001.pdf ($104.00) |
| AMG Service Construction #108 | 3 | 2026-05-25 - 108-Ottawa-painters.pdf ($4,758.26); 2026-05-26 - 108-Ottawa-painters.pdf ($4,758.26); 2026-05-28 - 108-Ottawa-painters.pdf ($4,758.26) |
| AMG Service Construction #109 | 2 | 2026-06-03 - 109-Ottawa-painters (2).pdf ($1,250.75); 2026-06-03 - 109-Ottawa-painters.pdf ($1,447.20) |
| Andre Archambault Handyman Services Inc. #797 | 3 | 2026-04-01 - invoice_797.pdf ($475.00); 2026-04-07 - invoice_797 (2).pdf ($475.00); 2026-04-07 - invoice_797.pdf ($475.00) |
| Angel Marcelo Cabrera #3 | 4 | 2026-03-02 - Marcelo invoice #3-1.pdf ($1,728.00); 2026-03-02 - Marcelo invoice#3.pdf ($1,728.00); 2026-03-06 - Marcelo invoice#3-1.pdf ($1,275.00); 2026-03-11 - Marcelo invoice#4.pdf ($646.88) |
| Angel Marcelo Cabrera #8 | 2 | 2026-04-02 - Marcelo invoice#8.pdf ($393.75); 2026-04-10 - Marcelo invoice#8.pdf ($187.50) |
| Angel Marcelo Cabrera #9 | 2 | 2026-04-14 - Marcelo invoice#9 (2).pdf ($337.50); 2026-04-14 - Marcelo invoice#9.pdf ($431.25) |
| Goulet Contracting & Painting Inc. #INV-000197 | 2 | 2025-09-11 - INV-000197.pdf ($10,208.00); 2025-10-20 - INV-000197.pdf ($8,098.00) |
| Phillip Hyde #INV-000013 | 2 | 2025-12-15 - INV-000013.pdf ($917.34); 2025-12-29 - Payment-1.pdf ($917.34) |
| Phillip Hyde #INV-000015 | 2 | 2026-01-23 - INV-000015.pdf ($524.70); 2026-01-28 - Payment-2.pdf ($524.70) |
| Premium Coat #FM-171 | 2 | 2026-05-30 - Invoice FM-171 (2).pdf ($1,472.41); 2026-05-30 - Invoice FM-171.pdf ($4,750.00) |
| Scott Bertin #1 | 2 | 2026-03-25 - 1000018917.jpg ($1,980.00); 2026-03-25 - Screenshot_20260324_200419_Sheets.jpg ($1,085.00) |
| XDesign Dev Inc #8586 | 2 | 2026-06-07 - Invoice_8586_2026-06-06.pdf ($240.00); 2026-06-08 - Invoice_8586_2026-06-06.pdf ($330.00) |
| XDesign Dev Inc #8602 | 2 | 2026-07-20 - Invoice_8602_2026-07-17 (original).pdf ($300.00); 2026-07-20 - Invoice_8602_2026-07-17 (updated).pdf ($330.00) |

## Tracked jobs without linked invoices

| Status | Job | Customer amount | Project ID |
|---|---|---:|---|
| Completed | Amir Banihashemi — proposal 2404954 (completed) | $1,471.26 | dripjobs-2404954 |
| Completed | Ben javanpour — proposal 1908273 (completed) | $932.25 | dripjobs-1908273 |
| Completed | Ben javanpour — proposal 2047974 (completed) | $5,486.15 | dripjobs-2047974 |
| Completed | Bethan Elliott — proposal 2376247 (completed) | $2,994.50 | dripjobs-2376247 |
| Completed | Bradley McDermid — proposal 1767363 (completed) | $2,386.00 | dripjobs-1767363 |
| Completed | Carly Plate — proposal 2394273 (completed) | $1,895.01 | dripjobs-2394273 |
| Completed | Carol anderson — proposal 1890091 (completed) | $2,429.48 | dripjobs-1890091 |
| Completed | Christopher Fernan... — proposal 1959073 (completed) | $1,808.00 | dripjobs-1959073 |
| Completed | Danish Meman — proposal 1861442 (completed) | $960.50 | dripjobs-1861442 |
| Completed | Deck Painting — proposal 1799093 (completed) | $2,147.00 | dripjobs-1799093 |
| Completed | Deck Painting — proposal 1844880 (completed) | $218.40 | dripjobs-1844880 |
| Completed | Deck Staining — proposal 1863413 (completed) | $1,595.00 | dripjobs-1863413 |
| Completed | Elizabeth McCrea — proposal 2230796 (completed) | $1,525.50 | dripjobs-2230796 |
| Completed | Elizabeth McCrea — proposal 2230810 (completed) | $3,960.50 | dripjobs-2230810 |
| Completed | Isaac senechal — proposal 2087234 (completed) | $1,930.04 | dripjobs-2087234 |
| Completed | isabelle Ares — proposal 2196763 (completed) | $4,189.35 | dripjobs-2196763 |
| Completed | Jay Wong — proposal 2283227 (completed) | $532.50 | dripjobs-2283227 |
| Completed | Jean Comtois — proposal 1787855 (completed) | $2,373.00 | dripjobs-1787855 |
| Completed | Jillian Morgan — proposal 2355250 (completed) | $2,864.55 | dripjobs-2355250 |
| Completed | Jose Reyes — proposal 2376176 (completed) | $1,819.30 | dripjobs-2376176 |
| Completed | Karim Carthage — proposal 2759160 (completed) | $1,210.63 | dripjobs-2759160 |
| Completed | Kim Switzer — proposal 2583136 (completed) | $6,003.69 | dripjobs-2583136 |
| Completed | Laurice Mahli — proposal 2021263 (completed) | $791.00 | dripjobs-2021263 |
| Completed | Laurissa Hevenor — proposal 1797547 (completed) | $1,017.00 | dripjobs-1797547 |
| Completed | Maria Gonzalez — proposal 2200288 (completed) | $847.50 | dripjobs-2200288 |
| Completed | Maryanne Piecha — proposal 1834527 (completed) | $4,547.40 | dripjobs-1834527 |
| Completed | Michelle Brunet — proposal 2522158 (completed) | $395.50 | dripjobs-2522158 |
| Completed | Naya Mardi — proposal 1850029 (completed) | $7,514.50 | dripjobs-1850029 |
| Completed | Paul Harrison — proposal 2496838 (completed) | $1,885.97 | dripjobs-2496838 |
| Completed | Priscila Gondim Al... — proposal 2640615 (completed) | $1,050.90 | dripjobs-2640615 |
| Completed | Sami Evelyn — proposal 2039512 (completed) | $3,289.43 | dripjobs-2039512 |
| Completed | Scott Maxwell — proposal 2193648 (completed) | $1,745.85 | dripjobs-2193648 |
| Completed | Sheila McSwiggan — proposal 2140736 (completed) | $678.00 | dripjobs-2140736 |
| Completed | Shiho mshoshii — proposal 2266588 (completed) | $339.00 | dripjobs-2266588 |
| Completed | Sunita Sharma — proposal 1983452 (completed) | $1,668.50 | dripjobs-1983452 |
| Completed | Tracy Adams — proposal 2390082 (completed) | $2,009.14 | dripjobs-2390082 |
| Open | Barry Dollin | $6,421.79 | 102929362 |
| Open | Carina Stark | $5,765.26 | 103507278 |
| Open | Christine Nasrallah | $3,265.70 | 101275098 |
| Open | Claire Colbert — proposal 2425225 (scheduled) | $1,084.80 | dripjobs-2425225 |
| Open | Ian Rothwell — proposal 2096038 (accepted) | $1,638.50 | dripjobs-2096038 |
| Open | Jackie Weatherall | $2,187.68 | 100393273 |
| Open | Jillian Letts | $1,499.51 | 99430054 |
| Open | Joelle Boutros | $8,538.28 | 104221368 |
| Open | Jon Roebuck | $5,059.36 | 105834859 |
| Open | Kelly Mounce | $4,201.41 | 105144863 |
| Open | Laura Braden — proposal 2851940 (accepted) | $70.00 | dripjobs-2851940 |
| Open | Laura Whitworth | $2,474.70 | 99473540 |
| Open | Sue Deluney | $3,505.26 | 99548034 |
| Open | Wendy Page | $5,530.22 | 105746981 |
| Open | YURI KHOROSHILOV — proposal 2496932 (accepted) | $8,050.12 | dripjobs-2496932 |
