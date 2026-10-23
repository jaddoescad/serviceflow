# Job budget audit — October 11, 2026

Checked all 371 ServiceFlow job records and the app's budget selection logic. No job budgets or pay rates were changed during this audit. Authenticated browser verification was blocked by the production sign-in page.

229 jobs have a positive recorded job amount: 225 have positive budget hours, three have explicit zero-hour budgets, and one is a superseded duplicate. 34 active or scheduled jobs have no hours budget and no recorded job amount (including one QA job). Another six active or scheduled jobs have hours but no job amount; five are demo fixtures. Historical jobs remain locked under AGENTS.md.

## Missing amounts on active or scheduled jobs

| Job | Status | Amount | Budget hours |
|---|---|---:|---:|
| [Aisha Suhail](https://serviceflow-admin.vercel.app/jobs/d8361a95-a5dc-5b51-8a42-4749bfb23f32/labour) | active | Missing | Missing |
| [Alison Senior](https://serviceflow-admin.vercel.app/jobs/8847aa80-49b8-5750-a722-b580a4033e7e/labour) | active | Missing | Missing |
| [Alta Vista Deck Stain](https://serviceflow-admin.vercel.app/jobs/dee00000-0000-4000-8000-000000000205/labour) | scheduled | Missing | 16h 0m |
| [Andrea Ainslie - 2026-08-02T22:17:43.71](https://serviceflow-admin.vercel.app/jobs/acf936bd-aaf1-5613-b00b-c2d6bc5d23aa/labour) | active | Missing | Missing |
| [Andrew Hewson](https://serviceflow-admin.vercel.app/jobs/65df334f-5abb-5029-86fa-58816275d885/labour) | active | Missing | Missing |
| [Anne Melrose](https://serviceflow-admin.vercel.app/jobs/66776c0c-b277-5ad8-b7a6-93034e8243b1/labour) | active | Missing | Missing |
| [Ashok Saha](https://serviceflow-admin.vercel.app/jobs/a10b78ed-2c61-5783-b826-4308e2eaf3f3/labour) | active | Missing | Missing |
| [Aspen Tzal](https://serviceflow-admin.vercel.app/jobs/e61ce274-f31b-5837-9b3f-a060609dc781/labour) | active | Missing | Missing |
| [Audrey Reid - 2026-08-03T14:40:23.213Z](https://serviceflow-admin.vercel.app/jobs/51024d52-3bd1-56ee-a23d-bf9a467d5787/labour) | active | Missing | Missing |
| [Bill Duck](https://serviceflow-admin.vercel.app/jobs/a6375614-e1cb-5eb7-8ce3-02ac2d90bc40/labour) | active | Missing | Missing |
| [Byward Café Refresh](https://serviceflow-admin.vercel.app/jobs/dee00000-0000-4000-8000-000000000204/labour) | active | Missing | 56h 0m |
| [Catherine Beaulieu](https://serviceflow-admin.vercel.app/jobs/b53958f2-7906-5550-9fab-01a8bdb51929/labour) | active | Missing | Missing |
| [Catherine Hood](https://serviceflow-admin.vercel.app/jobs/acb9e82c-385b-5384-8bad-b753982a5e2d/labour) | active | Missing | Missing |
| [Christine Girouard](https://serviceflow-admin.vercel.app/jobs/2cc6a41a-8ab2-5c61-a450-e658693fe877/labour) | active | Missing | 0 (explicit) |
| [Drywall repair — proposal 1802104](https://serviceflow-admin.vercel.app/jobs/8ca51c83-9343-5677-b03d-27249e67b86d/labour) | active | Missing | Missing |
| [Erik Brownrigg](https://serviceflow-admin.vercel.app/jobs/ec13dde2-90ff-5e67-83e3-5991f1c52bed/labour) | active | Missing | Missing |
| [Fanny Landry](https://serviceflow-admin.vercel.app/jobs/6e4cae37-d489-5e92-a662-87c375dc2bb3/labour) | active | Missing | Missing |
| [Fiona Smith](https://serviceflow-admin.vercel.app/jobs/c43bb440-2deb-52b5-a557-8a2808771c74/labour) | active | Missing | Missing |
| [Francois Levesque](https://serviceflow-admin.vercel.app/jobs/3d617d8c-4e85-53bb-b0f4-5369b9814ff4/labour) | active | Missing | Missing |
| [Ginette Joseph](https://serviceflow-admin.vercel.app/jobs/9e60f288-d3c6-588b-95c9-e7642dccade8/labour) | active | Missing | Missing |
| [Glebe Kitchen Cabinets](https://serviceflow-admin.vercel.app/jobs/dee00000-0000-4000-8000-000000000202/labour) | active | Missing | 31h 0m |
| [Hanna Bland](https://serviceflow-admin.vercel.app/jobs/f5ce9243-cc16-5e01-8e5e-aa52c38ec099/labour) | active | Missing | Missing |
| [Katie Wakeman](https://serviceflow-admin.vercel.app/jobs/97cd8cf6-07ec-5443-9643-22c28e0a49e9/labour) | active | Missing | Missing |
| [Ladislau Papara - 2026-08-04T15:43:57.013](https://serviceflow-admin.vercel.app/jobs/e122c069-7ad2-527c-947f-96feac4ed501/labour) | active | Missing | Missing |
| [Maple Street Repaint](https://serviceflow-admin.vercel.app/jobs/dee00000-0000-4000-8000-000000000201/labour) | active | Missing | 120h 0m |
| [Marie-josee Cardinal](https://serviceflow-admin.vercel.app/jobs/2499c2a3-f71d-5211-878e-b91c3cd808d7/labour) | active | Missing | Missing |
| [Matthieu Fortin](https://serviceflow-admin.vercel.app/jobs/6c31388c-3bda-5313-bb69-e523e3cae156/labour) | active | Missing | Missing |
| [Matthieu Kimmell](https://serviceflow-admin.vercel.app/jobs/d7719eff-5526-55ee-959f-c2755bcd316a/labour) | active | Missing | Missing |
| [Media Move QA — TEST ONLY](https://serviceflow-admin.vercel.app/jobs/047064ac-b3dc-4ca0-a699-f4f1e7e20b97/labour) | scheduled | Missing | Missing |
| [Melanie Stockdale](https://serviceflow-admin.vercel.app/jobs/b1c7bfcc-31e4-5076-9eda-3e03db9325f4/labour) | active | Missing | Missing |
| [Michelle Seperich](https://serviceflow-admin.vercel.app/jobs/d8c269a2-e4f2-5e8b-9510-ca7f81a6bf12/labour) | active | Missing | Missing |
| [Nancy Karas](https://serviceflow-admin.vercel.app/jobs/864d558f-6330-55a6-8f3f-46f37c49e16d/labour) | active | Missing | Missing |
| [Nathalie Guimont](https://serviceflow-admin.vercel.app/jobs/bda303d3-2800-5513-b1e3-9a8c89f0cf81/labour) | active | Missing | Missing |
| [Phil Coe #1](https://serviceflow-admin.vercel.app/jobs/fa99b710-0960-5b5a-9066-9dc6f771f296/labour) | active | Missing | Missing |
| [Pierre E](https://serviceflow-admin.vercel.app/jobs/cf79e35a-a144-501e-bd1a-014e5454f5c3/labour) | active | Missing | Missing |
| [Preeti Sharma](https://serviceflow-admin.vercel.app/jobs/759d4d88-ae45-5d38-8920-e9917ac93076/labour) | active | Missing | Missing |
| [Rachelle Latremouille](https://serviceflow-admin.vercel.app/jobs/6c110c70-bf35-5e09-97bd-f820cfc69e04/labour) | active | Missing | Missing |
| [Ryan Green](https://serviceflow-admin.vercel.app/jobs/6fef6014-dd17-5a31-96d3-68f4f5a79a7c/labour) | active | Missing | Missing |
| [Westboro Condo Interior](https://serviceflow-admin.vercel.app/jobs/dee00000-0000-4000-8000-000000000203/labour) | active | Missing | 40h 0m |
| [Zeana Robleh](https://serviceflow-admin.vercel.app/jobs/3efe1c65-54f5-571c-aeed-bf08b8e62999/labour) | active | Missing | Missing |

## Explicit zero-hour budgets with positive job amounts

Amal Malik ($340), Anjou Delplancke ($1,769.91), and Shezara Ali ($855) contain explicit zero hours in saved budget history. Their intended hours require review; no formula overwrites were made.

## Superseded duplicate

Shezara Ali — proposal 2873427 is archived, hidden from the feed, and its budget metadata explicitly marks it superseded by the current Shezara Ali job. A new competing budget must not be created.

## Unpriced labour on non-demo jobs

| Painter | Unpriced hours | Saved rate | Effective from |
|---|---:|---:|---|
| Abdellah Aouf | 34.52 | $27/hr | October 11, 2026 |
| Camilo Bastidas | 27.00 | $33/hr | October 2, 2026 |
| Anas Aouf | 8.00 | Missing | — |
| Jad Slim | 0.27 | Missing | — |

Confirm historical rates and effective dates before applying them to prior shifts. The $30 default for new painters does not establish these employees' historical pay rates.

## All job records

| Job | Status | Recorded amount | Budget hours | Historical lock |
|---|---|---:|---:|---|
| [501 Chemin Klock](https://serviceflow-admin.vercel.app/jobs/45868cf7-f5b8-5e87-a114-7894e11354fa/labour) | cancelled | Missing | Missing | — |
| [Adeel Anwar](https://serviceflow-admin.vercel.app/jobs/23736ee5-8e26-5c33-9993-a0254e1d2f27/labour) | active | $3290.00 | 40h 35m | — |
| [Ahmed Abdillahi](https://serviceflow-admin.vercel.app/jobs/26cd2f04-ed10-5e49-9cf6-2b2f8908dd77/labour) | archived | Missing | Missing | Locked |
| [Aisha Suhail](https://serviceflow-admin.vercel.app/jobs/d8361a95-a5dc-5b51-8a42-4749bfb23f32/labour) | active | Missing | Missing | — |
| [Alexandra Mackenzie](https://serviceflow-admin.vercel.app/jobs/c10c5dbe-c027-5a80-9876-e705f7c637eb/labour) | completed | $4105.00 | 43h 24m | Locked |
| [Alison Senior](https://serviceflow-admin.vercel.app/jobs/8847aa80-49b8-5750-a722-b580a4033e7e/labour) | active | Missing | Missing | — |
| [Allen Manouchehri](https://serviceflow-admin.vercel.app/jobs/0c626639-cca8-5b7a-9495-74734162ca4f/labour) | active | $7794.74 | 96h 8m | — |
| [Alta Vista Deck Stain](https://serviceflow-admin.vercel.app/jobs/dee00000-0000-4000-8000-000000000205/labour) | scheduled | Missing | 16h 0m | — |
| [Alycia Vachon](https://serviceflow-admin.vercel.app/jobs/b8aa7702-95b6-5073-8903-70cfe91f506b/labour) | archived | Missing | Missing | Locked |
| [Alycia Vachon — proposal 2330911 (completed)](https://serviceflow-admin.vercel.app/jobs/ef0fe341-c098-55da-9833-14cad0b84d9a/labour) | completed | $800.00 | 8h 27m | Locked |
| [Amal Malik](https://serviceflow-admin.vercel.app/jobs/2e473c02-16fe-58a7-8675-5b5b00a93ae6/labour) | scheduled | $340.00 | 0 (explicit) | — |
| [Amanda Daoust](https://serviceflow-admin.vercel.app/jobs/2252ca66-b3be-5b88-a0a6-2ff6e1b020fc/labour) | completed | $3932.00 | 41h 34m | Locked |
| [Amir Banihashemi](https://serviceflow-admin.vercel.app/jobs/49b6e4cb-f88a-5886-b64a-fccc7db9ef3e/labour) | completed | $1132.74 | 11h 58m | Locked |
| [Amit Mishra](https://serviceflow-admin.vercel.app/jobs/9e5429f5-c1ad-500b-abce-17d1c3da8b98/labour) | archived | Missing | Missing | Locked |
| [Amy Felton](https://serviceflow-admin.vercel.app/jobs/db0ed461-54a5-5b4b-94b0-e0f229d4c6aa/labour) | completed | $941.00 | 9h 57m | Locked |
| [Andrea Ainslie - 2026-08-02T22:17:43.71](https://serviceflow-admin.vercel.app/jobs/acf936bd-aaf1-5613-b00b-c2d6bc5d23aa/labour) | active | Missing | Missing | — |
| [Andrea Laporte](https://serviceflow-admin.vercel.app/jobs/0a4c9180-d499-581e-a956-580d21a1b50f/labour) | active | $4565.20 | 56h 18m | — |
| [Andrew Hewson](https://serviceflow-admin.vercel.app/jobs/65df334f-5abb-5029-86fa-58816275d885/labour) | active | Missing | Missing | — |
| [Andrew Hrycaj](https://serviceflow-admin.vercel.app/jobs/3a4adc75-9590-5bab-9725-7813f4da20f9/labour) | active | $3819.40 | 47h 6m | — |
| [Angela Bilmer](https://serviceflow-admin.vercel.app/jobs/7a65c6d7-b325-5d2e-b4ef-7b67c56b601c/labour) | completed | $4398.00 | 46h 29m | Locked |
| [Anjou Delplancke - 2026-07-07T14:05:10.983](https://serviceflow-admin.vercel.app/jobs/db0cd13b-212d-5f20-a9d7-eae148ea89df/labour) | completed | $1769.91 | 0 (explicit) | — |
| [Ankit Verma — proposal 2484688 (completed)](https://serviceflow-admin.vercel.app/jobs/423273e8-637f-51f0-b614-cd5758b0d537/labour) | completed | $750.00 | 7h 56m | Locked |
| [Anna-Louise Pentland](https://serviceflow-admin.vercel.app/jobs/3057948e-6d75-57df-90fc-911edcc791ba/labour) | active | $4055.00 | 50h 1m | — |
| [Anne Melrose](https://serviceflow-admin.vercel.app/jobs/66776c0c-b277-5ad8-b7a6-93034e8243b1/labour) | active | Missing | Missing | — |
| [Anthony Onwuama](https://serviceflow-admin.vercel.app/jobs/69d338ef-10ae-5351-856f-807f0fe71a33/labour) | active | $994.40 | 12h 16m | — |
| [Arnaud Griess](https://serviceflow-admin.vercel.app/jobs/53e72eb1-8987-5238-b15c-7350a01b2930/labour) | active | $250.00 | 3h 5m | — |
| [Ashok Saha](https://serviceflow-admin.vercel.app/jobs/a10b78ed-2c61-5783-b826-4308e2eaf3f3/labour) | active | Missing | Missing | — |
| [Aspen Tzal](https://serviceflow-admin.vercel.app/jobs/e61ce274-f31b-5837-9b3f-a060609dc781/labour) | active | Missing | Missing | — |
| [Atlantis](https://serviceflow-admin.vercel.app/jobs/1d430b18-9747-5384-ad34-794ee8f1f3e5/labour) | archived | Missing | Missing | Locked |
| [Audrey Reid - 2026-08-03T14:40:23.213Z](https://serviceflow-admin.vercel.app/jobs/51024d52-3bd1-56ee-a23d-bf9a467d5787/labour) | active | Missing | Missing | — |
| [Bailey Muldner](https://serviceflow-admin.vercel.app/jobs/85428f20-6fa9-54b8-8db9-b4d132fed6e4/labour) | completed | $947.00 | 10h 37m | Locked |
| [Barb Howie — proposal 1843130 (completed)](https://serviceflow-admin.vercel.app/jobs/821a1a2a-baf4-5491-964d-a75dc3689dac/labour) | completed | $1950.00 | 20h 37m | Locked |
| [Barbara Greenberg](https://serviceflow-admin.vercel.app/jobs/dbe9dc86-64dc-5d0a-b674-abdf18e813cc/labour) | archived | Missing | Missing | Locked |
| [Baro Baro](https://serviceflow-admin.vercel.app/jobs/dc0d0737-d850-5821-be26-aebb45af000f/labour) | archived | Missing | Missing | Locked |
| [Barry Dollin](https://serviceflow-admin.vercel.app/jobs/006776be-552c-5deb-aeb9-f190d6b5a558/labour) | scheduled | $5683.00 | 60h 5m | — |
| [Ben javanpour — proposal 1908273 (completed)](https://serviceflow-admin.vercel.app/jobs/4c05314c-4605-5c63-8f54-14d864e26982/labour) | completed | $825.00 | 8h 43m | Locked |
| [Ben javanpour — proposal 2047974 (completed)](https://serviceflow-admin.vercel.app/jobs/caee3dda-1c75-56fe-8210-b1537013a467/labour) | completed | $4855.00 | 51h 19m | Locked |
| [Bethan Elliott](https://serviceflow-admin.vercel.app/jobs/70e73d08-0aa6-5402-bf2c-844ad6c98f4c/labour) | completed | $2650.00 | 28h 1m | Locked |
| [Bill Duck](https://serviceflow-admin.vercel.app/jobs/a6375614-e1cb-5eb7-8ce3-02ac2d90bc40/labour) | active | Missing | Missing | — |
| [Bill Vail](https://serviceflow-admin.vercel.app/jobs/3ef9cdc8-6608-5318-b583-0cb03d9e3278/labour) | archived | Missing | Missing | Locked |
| [Bradley McDermid — proposal 1767363 (completed)](https://serviceflow-admin.vercel.app/jobs/8f9d990f-f22f-5dcd-95a9-ad178b66a90c/labour) | completed | $2100.00 | 22h 12m | Locked |
| [Bronte Shay](https://serviceflow-admin.vercel.app/jobs/ca4fe22d-703b-5d0a-9279-db2b6bf94ff1/labour) | scheduled | $670.00 | 7h 5m | — |
| [Bruno Lepine](https://serviceflow-admin.vercel.app/jobs/cff62588-3941-53b3-97c7-632e4656322d/labour) | scheduled | $2650.29 | 28h 1m | — |
| [Byward Café Refresh](https://serviceflow-admin.vercel.app/jobs/dee00000-0000-4000-8000-000000000204/labour) | active | Missing | 56h 0m | — |
| [Carina Stark](https://serviceflow-admin.vercel.app/jobs/5c68f2f5-68b9-5606-8c97-0ff0eb4b07eb/labour) | scheduled | $5439.00 | 53h 56m | — |
| [Carl Suurland](https://serviceflow-admin.vercel.app/jobs/e532e534-2135-5f37-bf97-88eb0bcdc6da/labour) | archived | Missing | Missing | Locked |
| [Carly Plate](https://serviceflow-admin.vercel.app/jobs/20c497b7-e254-57bf-a522-88932c196a8f/labour) | archived | Missing | Missing | Locked |
| [Carly Plate — proposal 2394273 (completed)](https://serviceflow-admin.vercel.app/jobs/5f2600a0-9943-505b-86b8-567436a3ccb2/labour) | completed | $1677.00 | 17h 44m | Locked |
| [Carol anderson - 2025-07-23T15:17:55.073](https://serviceflow-admin.vercel.app/jobs/189c6295-ff40-5560-885e-6161f2d21258/labour) | completed | $480.00 | 5h 4m | — |
| [Carol anderson — proposal 1890091 (completed)](https://serviceflow-admin.vercel.app/jobs/7ffc992c-fc4c-533f-960d-b77f0d3171c4/labour) | completed | $2149.98 | 22h 44m | Locked |
| [Caroline Ladanowski](https://serviceflow-admin.vercel.app/jobs/6afe3b71-fad5-550f-b0db-14ceee89018c/labour) | archived | Missing | Missing | Locked |
| [Carolyn Law — proposal 1863401 (completed)](https://serviceflow-admin.vercel.app/jobs/c1dad81b-7ec6-5770-9ce3-67d568a0d4c5/labour) | completed | $4300.00 | 45h 27m | Locked |
| [Carrie Poirier](https://serviceflow-admin.vercel.app/jobs/91e91f29-e861-54b7-82bd-fdfeecef6f3d/labour) | archived | Missing | Missing | Locked |
| [Catherine Beaulieu](https://serviceflow-admin.vercel.app/jobs/b53958f2-7906-5550-9fab-01a8bdb51929/labour) | active | Missing | Missing | — |
| [Catherine Hood](https://serviceflow-admin.vercel.app/jobs/acb9e82c-385b-5384-8bad-b753982a5e2d/labour) | active | Missing | Missing | — |
| [Catherine McGerray](https://serviceflow-admin.vercel.app/jobs/2bfc7fc3-03f9-547f-928e-9ef51ee86f84/labour) | active | $10306.30 | 127h 7m | — |
| [Chantal Tremblay](https://serviceflow-admin.vercel.app/jobs/a131a568-7402-5cc4-914d-aba8fc4490d7/labour) | active | $1169.55 | 14h 25m | — |
| [Chioma Okekeze](https://serviceflow-admin.vercel.app/jobs/b8c5ebb0-489a-50d0-afba-6be2b978fa8b/labour) | archived | Missing | Missing | Locked |
| [Chris Bucar](https://serviceflow-admin.vercel.app/jobs/ed4ed7ef-3f07-561f-b271-39d06514793a/labour) | archived | Missing | Missing | Locked |
| [Chris Casey](https://serviceflow-admin.vercel.app/jobs/0ac3da2a-7b22-5192-8f18-4875015f3546/labour) | active | $4057.00 | 50h 2m | — |
| [Chris Jupp - 2026-06-29T15:29:46.587](https://serviceflow-admin.vercel.app/jobs/e4758c1f-6bdb-59bd-9f31-7b4f0f8e672b/labour) | completed | $2807.00 | 26h 1m | — |
| [Chris Pereira](https://serviceflow-admin.vercel.app/jobs/01304989-17cf-5f49-9007-302a52f019c4/labour) | archived | Missing | Missing | Locked |
| [Christian Boulet](https://serviceflow-admin.vercel.app/jobs/9dd7b83f-071d-5302-b265-41358eb579fe/labour) | completed | $8849.56 | 93h 33m | — |
| [Christina Fernandez](https://serviceflow-admin.vercel.app/jobs/680185f4-c66f-553c-b94a-51360d625405/labour) | archived | Missing | Missing | Locked |
| [Christine Girouard](https://serviceflow-admin.vercel.app/jobs/2cc6a41a-8ab2-5c61-a450-e658693fe877/labour) | active | Missing | 0 (explicit) | — |
| [Christine Leclair](https://serviceflow-admin.vercel.app/jobs/06dd173d-ceb9-5e5c-b59b-ddd8d6c6d9e2/labour) | completed | $1360.00 | 14h 23m | — |
| [Christine Leclair — proposal 2370863 (completed)](https://serviceflow-admin.vercel.app/jobs/a98b213f-f49a-5ae5-9738-45086317a2b4/labour) | completed | $3729.00 | 39h 25m | Locked |
| [Christine Nasrallah](https://serviceflow-admin.vercel.app/jobs/562e008b-5e8d-5c14-a9e5-32ac068bb64d/labour) | active | $2890.00 | 30h 33m | — |
| [Christine Snow-Bayers](https://serviceflow-admin.vercel.app/jobs/a2969538-3e40-5417-99e3-c6a870835f64/labour) | active | $7479.47 | 92h 15m | — |
| [Christopher Fernan... — proposal 1959073 (completed)](https://serviceflow-admin.vercel.app/jobs/68953f82-0db9-5674-8581-d6180c65d69a/labour) | completed | $1600.00 | 16h 55m | Locked |
| [Claire Colbert](https://serviceflow-admin.vercel.app/jobs/0eff8399-7f29-5205-a4e3-39c8861c876a/labour) | completed | $1764.00 | 18h 39m | Locked |
| [Claire Colbert — proposal 2425225 (completed)](https://serviceflow-admin.vercel.app/jobs/cb7dfd47-740a-5375-a113-be4521dfb4a7/labour) | archived | $960.00 | 10h 9m | Locked |
| [Claude Jobin](https://serviceflow-admin.vercel.app/jobs/66367819-affc-529d-9bb2-850f7275e3e9/labour) | archived | Missing | Missing | Locked |
| [Clayton Block](https://serviceflow-admin.vercel.app/jobs/6b572713-0184-59bf-823d-fd023e7d23b8/labour) | active | $2634.00 | 32h 29m | — |
| [Colette Hemeni](https://serviceflow-admin.vercel.app/jobs/b650f951-8c1e-56aa-934a-ba0a614d80a0/labour) | archived | Missing | Missing | Locked |
| [companycamtest test](https://serviceflow-admin.vercel.app/jobs/df7be06b-2830-5085-a149-a703a8c3c402/labour) | cancelled | Missing | Missing | — |
| [Corey Parsons](https://serviceflow-admin.vercel.app/jobs/f5f15bfe-5ac7-53da-9296-bfd1cfa8dd41/labour) | completed | $2766.99 | 29h 15m | — |
| [Corey Parsons — proposal 2663981 (completed)](https://serviceflow-admin.vercel.app/jobs/9e810bb7-6400-5a9b-9658-24f3c0dc4508/labour) | completed | $545.00 | 5h 46m | Locked |
| [Courtney Mondoux](https://serviceflow-admin.vercel.app/jobs/5703b1e6-c394-5e43-9230-0119f76c1783/labour) | completed | $2904.00 | 30h 42m | Locked |
| [Daniel](https://serviceflow-admin.vercel.app/jobs/67c26d63-b780-5432-a5ef-3352eaf78bcc/labour) | archived | Missing | Missing | Locked |
| [Daniel Heredia](https://serviceflow-admin.vercel.app/jobs/922f03d6-857f-56c7-aa82-f7b4eefb0b3d/labour) | archived | Missing | Missing | Locked |
| [Daniel Leblanc](https://serviceflow-admin.vercel.app/jobs/81d65112-cf58-5b20-be07-df94a8e5c5ae/labour) | completed | $2855.00 | 30h 11m | Locked |
| [Daniel Lemieux](https://serviceflow-admin.vercel.app/jobs/70a461e3-19b3-5644-a68f-71eaedb48c69/labour) | archived | Missing | Missing | Locked |
| [Daniel Leung - 2026-06-04T13:32:17.61](https://serviceflow-admin.vercel.app/jobs/12fd7d4d-7648-5360-ae20-2bcc02e64498/labour) | completed | $1442.00 | 15h 14m | — |
| [Daniele Cinquemani](https://serviceflow-admin.vercel.app/jobs/67245917-6de7-578e-b884-bf0897fd0660/labour) | archived | Missing | Missing | Locked |
| [Danielle Hards](https://serviceflow-admin.vercel.app/jobs/b5937a4d-2ef7-532d-be19-4b8039a6b8c5/labour) | completed | $995.00 | 10h 31m | — |
| [Danish Meman — proposal 1861442 (completed)](https://serviceflow-admin.vercel.app/jobs/513d33fb-ac29-57fe-899d-9517fa01b3fb/labour) | completed | $850.00 | 8h 59m | Locked |
| [Darian Peeling](https://serviceflow-admin.vercel.app/jobs/89fd6d15-2a07-5d85-b27d-0f0dc64af758/labour) | completed | $3436.00 | 36h 34m | Locked |
| [Darko Cugalj](https://serviceflow-admin.vercel.app/jobs/912d16b6-42a6-548e-9f86-b3772485ad02/labour) | completed | $4039.00 | 42h 42m | Locked |
| [Darya Rafi](https://serviceflow-admin.vercel.app/jobs/7b11cfde-5772-5682-a09f-2061255fa01a/labour) | scheduled | $5114.00 | 63h 4m | — |
| [David Maloley](https://serviceflow-admin.vercel.app/jobs/4aa9562c-2385-5945-8a32-57afdd8bad57/labour) | active | $4022.80 | 49h 37m | — |
| [David Porter](https://serviceflow-admin.vercel.app/jobs/02cdcedb-0860-5207-9dd9-fa968e36d1f9/labour) | active | $1313.06 | 16h 12m | — |
| [David Rennie](https://serviceflow-admin.vercel.app/jobs/e4d85d8a-7da6-59c3-be6b-951cf5dd6a66/labour) | completed | $2781.20 | 29h 24m | Locked |
| [David Singh](https://serviceflow-admin.vercel.app/jobs/e9bf5a37-4090-5bf7-b488-8a763b0672ef/labour) | archived | Missing | Missing | Locked |
| [David Singh — proposal 2503613 (completed)](https://serviceflow-admin.vercel.app/jobs/4c38ea0e-e14a-5459-8335-65983bfff3f9/labour) | completed | $1769.90 | 18h 43m | Locked |
| [Dayne Degroot](https://serviceflow-admin.vercel.app/jobs/f36bd15c-98a9-5f77-b77e-09a41686a8a6/labour) | archived | Missing | Missing | Locked |
| [Debbie Byrnes](https://serviceflow-admin.vercel.app/jobs/a69b64a9-17ba-5649-9b65-1e5b5e6aa181/labour) | completed | $5505.00 | 58h 30m | Locked |
| [Debbie Lundin](https://serviceflow-admin.vercel.app/jobs/53e52081-6c7c-5cce-b914-3c08e0d7bb17/labour) | completed | $4849.00 | 51h 16m | Locked |
| [Deborah Mavula](https://serviceflow-admin.vercel.app/jobs/64c3e004-bc4c-54cd-8310-663e46ce1cd4/labour) | archived | Missing | Missing | Locked |
| [Deck Painting — proposal 1799093 (completed)](https://serviceflow-admin.vercel.app/jobs/4fbb91f6-5096-56e1-a346-2a6d00930b05/labour) | archived | $1900.00 | 20h 5m | Locked |
| [Deck Painting — proposal 1844880 (completed)](https://serviceflow-admin.vercel.app/jobs/e2865360-a855-51a5-af47-47647964ab2b/labour) | completed | $195.00 | 2h 4m | Locked |
| [Deck Staining — proposal 1863413 (completed)](https://serviceflow-admin.vercel.app/jobs/53110802-df5f-5bc6-ac2d-2ff749134359/labour) | completed | $1400.00 | 14h 48m | Locked |
| [Dever Jylha](https://serviceflow-admin.vercel.app/jobs/512f9bdf-8533-5c99-9e9c-12c7f3702a71/labour) | completed | $20164.00 | 213h 10m | Locked |
| [Diane Benoit](https://serviceflow-admin.vercel.app/jobs/ad273558-c0ef-5abf-bf9c-6aad8178d886/labour) | completed | $2575.00 | 27h 13m | — |
| [Diane Girard Boileau](https://serviceflow-admin.vercel.app/jobs/0b7ff223-443e-5a93-99bd-b754790f9d28/labour) | archived | Missing | Missing | Locked |
| [Didi Pascal](https://serviceflow-admin.vercel.app/jobs/bcb74ffe-d62d-504d-8c6f-92133e2f280d/labour) | archived | Missing | Missing | Locked |
| [Don & Peggy McHugh](https://serviceflow-admin.vercel.app/jobs/f9a12aae-89ee-540c-9286-d5b07bc0d1f2/labour) | completed | $835.00 | 19h 0m | — |
| [Donna Quigley](https://serviceflow-admin.vercel.app/jobs/5e5f653b-e771-5b0b-8cde-bb804428e0e0/labour) | completed | $3982.30 | 42h 6m | — |
| [Dr Alain Kabemba](https://serviceflow-admin.vercel.app/jobs/b25ba262-2a10-58af-8527-9c55f4641acf/labour) | archived | Missing | Missing | Locked |
| [Drywall repair — proposal 1802104](https://serviceflow-admin.vercel.app/jobs/8ca51c83-9343-5677-b03d-27249e67b86d/labour) | active | Missing | Missing | — |
| [Dubravka Staka](https://serviceflow-admin.vercel.app/jobs/da3bd63d-7a35-5eb7-bdb8-218dd82437df/labour) | completed | $1321.00 | 13h 58m | Locked |
| [Elaine Keverney](https://serviceflow-admin.vercel.app/jobs/0f58ed77-c4e2-5566-8195-1a82b9929fc5/labour) | scheduled | $2714.00 | 28h 49m | — |
| [Elizabeth McCrea — proposal 2230796 (completed)](https://serviceflow-admin.vercel.app/jobs/cf7ca10e-2bc9-5aa9-b2f7-a92c62ed44b7/labour) | completed | $1350.00 | 14h 16m | Locked |
| [Elizabeth McCrea — proposal 2230810 (completed)](https://serviceflow-admin.vercel.app/jobs/320e8826-6be8-513b-89c9-2de607ec12ba/labour) | completed | $3499.00 | 36h 59m | Locked |
| [Emma Bodoni](https://serviceflow-admin.vercel.app/jobs/9c92ebbf-b51a-5f5e-80a0-11f544112e31/labour) | completed | $1090.00 | 11h 31m | — |
| [Erik Brownrigg](https://serviceflow-admin.vercel.app/jobs/ec13dde2-90ff-5e67-83e3-5991f1c52bed/labour) | active | Missing | Missing | — |
| [Erin Armstrong](https://serviceflow-admin.vercel.app/jobs/0d98ccb0-8834-5c78-bb2f-96db12b630ae/labour) | archived | Missing | Missing | Locked |
| [Erin Lee](https://serviceflow-admin.vercel.app/jobs/578e8c24-e7bd-5f29-8179-27a2b626bbe3/labour) | completed | $767.00 | 8h 6m | — |
| [Erin Wilson](https://serviceflow-admin.vercel.app/jobs/5fd3d24b-49d1-5211-91ad-1dc09e7018b3/labour) | active | $6891.87 | 85h 0m | — |
| [Erin zuber](https://serviceflow-admin.vercel.app/jobs/b66f4fa0-d463-5c6e-8442-e40a75122327/labour) | active | $3536.00 | 43h 37m | — |
| [Erin-Renee Keddo](https://serviceflow-admin.vercel.app/jobs/9a4b25c5-6faa-5344-b2c4-c9de33a06d70/labour) | archived | Missing | Missing | Locked |
| [Fanny Landry](https://serviceflow-admin.vercel.app/jobs/6e4cae37-d489-5e92-a662-87c375dc2bb3/labour) | active | Missing | Missing | — |
| [Fiona Smith](https://serviceflow-admin.vercel.app/jobs/c43bb440-2deb-52b5-a557-8a2808771c74/labour) | active | Missing | Missing | — |
| [Francois Levesque](https://serviceflow-admin.vercel.app/jobs/3d617d8c-4e85-53bb-b0f4-5369b9814ff4/labour) | active | Missing | Missing | — |
| [George Chamaa](https://serviceflow-admin.vercel.app/jobs/c95f3b4f-ff04-5766-a1a9-3e0f0ad94f8a/labour) | completed | $616.00 | 6h 31m | Locked |
| [George Sorrenti](https://serviceflow-admin.vercel.app/jobs/7d74c970-abef-5e0b-bd32-bdd508679831/labour) | active | $6369.81 | 78h 34m | — |
| [Georgesc Focsaneanu](https://serviceflow-admin.vercel.app/jobs/0842152d-9d95-5160-9243-403e278d9018/labour) | completed | $5262.00 | 55h 38m | — |
| [Ginette Joseph](https://serviceflow-admin.vercel.app/jobs/9e60f288-d3c6-588b-95c9-e7642dccade8/labour) | active | Missing | Missing | — |
| [Glebe Kitchen Cabinets](https://serviceflow-admin.vercel.app/jobs/dee00000-0000-4000-8000-000000000202/labour) | active | Missing | 31h 0m | — |
| [Gord Stockdale](https://serviceflow-admin.vercel.app/jobs/c8c4ffc7-65f7-5e61-a5b8-a128eb314b90/labour) | completed | $4244.00 | 44h 52m | Locked |
| [Gordon Zans](https://serviceflow-admin.vercel.app/jobs/939d327e-75e4-5604-acc7-d9260b633125/labour) | completed | $1561.00 | 16h 30m | Locked |
| [Graeme Archibald](https://serviceflow-admin.vercel.app/jobs/38b6208e-12dd-5e62-b963-591a89868d91/labour) | archived | Missing | Missing | Locked |
| [Gregg Alexander](https://serviceflow-admin.vercel.app/jobs/b722a7fa-9457-503e-a6e6-ab0f4663259f/labour) | completed | $582.00 | 6h 9m | — |
| [Gregg Alexander — proposal 2484669 (completed)](https://serviceflow-admin.vercel.app/jobs/e3f3842c-238d-59de-b71c-13eefff23430/labour) | completed | $5277.00 | 55h 47m | Locked |
| [Hanna Bland](https://serviceflow-admin.vercel.app/jobs/f5ce9243-cc16-5e01-8e5e-aa52c38ec099/labour) | active | Missing | Missing | — |
| [Hannah Boyle](https://serviceflow-admin.vercel.app/jobs/d3bf1ccd-f946-563c-ac2e-649fe4c2b6ca/labour) | archived | Missing | Missing | Locked |
| [Heather Thomsen](https://serviceflow-admin.vercel.app/jobs/0a729fba-26bb-562b-81f0-415d9cf4dae0/labour) | completed | $2971.00 | 31h 25m | Locked |
| [Helen Lee](https://serviceflow-admin.vercel.app/jobs/9db795ec-e7f0-501c-b068-3988e751ef9f/labour) | active | $2245.00 | 27h 41m | — |
| [Herkirt Dhillon](https://serviceflow-admin.vercel.app/jobs/54efc97f-ae24-556c-9fef-c280849204d8/labour) | scheduled | $2340.00 | 24h 44m | — |
| [Hugo Lafontaine](https://serviceflow-admin.vercel.app/jobs/e3844256-8d2b-5f04-9236-3a6bbccd20c6/labour) | archived | Missing | Missing | Locked |
| [Ian Rothwell](https://serviceflow-admin.vercel.app/jobs/b749aff8-7390-59b4-94db-f921ac2dc8fc/labour) | completed | $1038.57 | 10h 59m | — |
| [Ian Rothwell — proposal 2096038 (completed)](https://serviceflow-admin.vercel.app/jobs/380e2f50-4f00-513a-933a-ce0187683c9d/labour) | completed | $1450.00 | 15h 20m | Locked |
| [Interior Painting ... — proposal 1865720 (completed)](https://serviceflow-admin.vercel.app/jobs/614b7f4f-4a20-584b-a0c4-7762c96a83d8/labour) | completed | $2100.00 | 22h 12m | Locked |
| [Irene Roberts - 2026-06-23T21:47:19.76](https://serviceflow-admin.vercel.app/jobs/984741d2-5587-50a6-9bb1-9158b52c3216/labour) | scheduled | $1957.01 | 21h 37m | — |
| [Isaac senechal — proposal 2087234 (completed)](https://serviceflow-admin.vercel.app/jobs/1d5d9a63-6c29-5a41-8915-fd791729f7fc/labour) | completed | $1708.00 | 18h 3m | Locked |
| [Isabelle Alvarez — proposal 3088435](https://serviceflow-admin.vercel.app/jobs/b526c337-9b1a-5dae-b738-08e36350482f/labour) | scheduled | $3763.20 | 46h 25m | — |
| [isabelle Ares — proposal 2196763 (completed)](https://serviceflow-admin.vercel.app/jobs/705200ef-eaa7-59b4-bf87-48601f5df0ec/labour) | archived | $3670.00 | 38h 48m | Locked |
| [Issa Daoud](https://serviceflow-admin.vercel.app/jobs/16166c09-8979-5cb8-ab6c-86407403f9ac/labour) | completed | $1305.00 | 14h 2m | Locked |
| [Jackie Weatherall](https://serviceflow-admin.vercel.app/jobs/29b68922-1639-54c0-ae1f-cef01b54d175/labour) | active | $1936.00 | 20h 28m | — |
| [Jad Slim](https://serviceflow-admin.vercel.app/jobs/1d4a89c3-76ee-5f4c-94b1-e34769743a93/labour) | active | $565.00 | 6h 58m | — |
| [Jad Slim](https://serviceflow-admin.vercel.app/jobs/95ae58ea-ef23-5a79-beaf-71af78e01cf3/labour) | cancelled | Missing | Missing | — |
| [Jad Slim -2026-05-29T13:04:12.433Z](https://serviceflow-admin.vercel.app/jobs/3b81f9c9-4f2b-5646-ba3a-162dce9bac71/labour) | cancelled | Missing | Missing | — |
| [Jad Slim1](https://serviceflow-admin.vercel.app/jobs/cc0110ea-1fae-579e-9b3e-9d6d4a93b2c0/labour) | cancelled | Missing | Missing | — |
| [Jad Slim2](https://serviceflow-admin.vercel.app/jobs/5934e301-50b9-59c4-92a1-972437a676cb/labour) | cancelled | Missing | Missing | — |
| [Jad Test](https://serviceflow-admin.vercel.app/jobs/a376c93a-d20d-5d20-8e36-50793f82e541/labour) | cancelled | Missing | Missing | — |
| [Janelle Bah](https://serviceflow-admin.vercel.app/jobs/20d5965d-82ee-58b9-9920-0468e1516ffd/labour) | archived | Missing | Missing | Locked |
| [Janet Marr](https://serviceflow-admin.vercel.app/jobs/09072317-c1a4-58ac-b67e-da88f863affc/labour) | active | $6883.96 | 84h 54m | — |
| [Janet Morris](https://serviceflow-admin.vercel.app/jobs/343de055-eb41-5de8-bbad-0966264b1dd6/labour) | completed | $2136.00 | 22h 35m | Locked |
| [Jaslyn English](https://serviceflow-admin.vercel.app/jobs/55fc05ed-2674-5963-8aaa-7845639eb974/labour) | active | $897.00 | 11h 4m | — |
| [jay test](https://serviceflow-admin.vercel.app/jobs/f1dfa9de-bd5c-5c14-b60e-ceb8e0a18c0f/labour) | cancelled | Missing | Missing | — |
| [Jay Wong — proposal 2283227 (completed)](https://serviceflow-admin.vercel.app/jobs/2883a13e-f3c5-5fc8-9150-8d342d7faba3/labour) | completed | $467.50 | 4h 57m | Locked |
| [Jayden Doyle](https://serviceflow-admin.vercel.app/jobs/cc4d955a-5659-5361-b26d-09ceb90206d8/labour) | active | $9383.85 | 115h 44m | — |
| [Jean Comtois — proposal 1787855 (completed)](https://serviceflow-admin.vercel.app/jobs/c4135e6a-4466-526b-8829-b8a9c8277f57/labour) | completed | $2373.00 | 25h 5m | Locked |
| [Jean Marcelin](https://serviceflow-admin.vercel.app/jobs/6df67f19-659a-5426-9371-359a21808298/labour) | archived | Missing | Missing | Locked |
| [Jeff Larose — proposal 2220463 (completed)](https://serviceflow-admin.vercel.app/jobs/fc761ee2-b1fb-5e82-9998-5d3d658fadf8/labour) | completed | $1589.00 | 16h 48m | Locked |
| [Jeffrey Roy / Jeffrey Ian — proposal 2101292 (completed)](https://serviceflow-admin.vercel.app/jobs/78bde05b-5106-54f4-86b0-23b11731b814/labour) | archived | Missing | Missing | Locked |
| [Jen Payne](https://serviceflow-admin.vercel.app/jobs/23104019-dd5b-5855-ba75-c766553d4f40/labour) | completed | $1873.00 | 19h 48m | — |
| [Jen Read](https://serviceflow-admin.vercel.app/jobs/50d1fc55-75b2-5207-9ac5-4cf81c5c30f3/labour) | active | $1175.20 | 14h 30m | — |
| [Jess Foley](https://serviceflow-admin.vercel.app/jobs/85d17b23-8fee-5e10-a49f-7d822db1c7ed/labour) | archived | Missing | Missing | Locked |
| [Jillian Letts](https://serviceflow-admin.vercel.app/jobs/9a26f3cf-1b9e-5c9f-aa9f-b17fa7053c42/labour) | scheduled | $1273.90 | 14h 2m | — |
| [Jillian Letts — proposal 2473605 (completed)](https://serviceflow-admin.vercel.app/jobs/a99615b7-4ec5-582d-b898-a71f44024cb0/labour) | completed | $2169.00 | 22h 56m | Locked |
| [Jillian Morgan](https://serviceflow-admin.vercel.app/jobs/2b7c0b7c-3041-5960-95c0-a3ae4e3d429a/labour) | completed | $2535.00 | 26h 48m | Locked |
| [Jo-Ann Fata](https://serviceflow-admin.vercel.app/jobs/8c972c73-e99c-5b4f-b183-e722b05d7ad4/labour) | active | $3291.69 | 40h 36m | — |
| [Joe Fuca](https://serviceflow-admin.vercel.app/jobs/fc4e0f62-940f-5bec-b95d-bdaceaad99b2/labour) | archived | Missing | Missing | Locked |
| [Joelle Boutros](https://serviceflow-admin.vercel.app/jobs/e604a0f8-a913-5b0e-b29b-330b01e5fc39/labour) | completed | $7556.00 | 79h 53m | Locked |
| [Joelle Moncrieff](https://serviceflow-admin.vercel.app/jobs/0e9d744f-0690-5afe-b31f-e4f5de768c0b/labour) | completed | $4004.00 | 42h 20m | Locked |
| [John Hubbard](https://serviceflow-admin.vercel.app/jobs/735ce801-9b32-54f4-afc7-d7e6e6df008b/labour) | completed | $2255.00 | 23h 50m | Locked |
| [Jon Roebuck](https://serviceflow-admin.vercel.app/jobs/08df7a67-a226-5b8b-9e70-2a74953518a9/labour) | scheduled | $4477.31 | 47h 20m | — |
| [Jose Reyes - Store Name = Cosey](https://serviceflow-admin.vercel.app/jobs/52d8975c-0149-5766-936b-abf229837580/labour) | completed | $1610.00 | 17h 1m | Locked |
| [Joy Shand](https://serviceflow-admin.vercel.app/jobs/afc2c862-578b-5836-ac77-788c4537afca/labour) | archived | Missing | Missing | Locked |
| [Julie Irwin](https://serviceflow-admin.vercel.app/jobs/4bacf97f-61db-552c-a1fc-e4f418b96ba1/labour) | completed | $6316.00 | 66h 46m | Locked |
| [Justin Arcand — proposal 2360010 (completed)](https://serviceflow-admin.vercel.app/jobs/f4e920b1-2cbb-55d8-96c8-e33cda01c3f6/labour) | completed | $775.00 | 8h 12m | Locked |
| [Justin Bara](https://serviceflow-admin.vercel.app/jobs/d1d08856-1ab6-536a-9696-5d14b4c4f475/labour) | archived | Missing | Missing | Locked |
| [Justin Wagar](https://serviceflow-admin.vercel.app/jobs/e57509d1-6870-5a63-8742-f47444c8a60d/labour) | completed | $12604.00 | 133h 14m | Locked |
| [Karen Van Staveren](https://serviceflow-admin.vercel.app/jobs/bf1e3514-5513-5ad0-8ea8-5f4e8f6d2611/labour) | archived | Missing | Missing | Locked |
| [Karim Carthage — proposal 2759160 (completed)](https://serviceflow-admin.vercel.app/jobs/5c60168a-64cd-5b34-9e5d-7f7974c4a53c/labour) | completed | $1071.35 | 11h 20m | Locked |
| [Katharina Keet](https://serviceflow-admin.vercel.app/jobs/19a09c1e-bdc2-5f32-ad3f-67c4b2b3242d/labour) | active | $1170.00 | 14h 26m | — |
| [Katie Koba — proposal 2455758 (completed)](https://serviceflow-admin.vercel.app/jobs/26088410-7bee-5b6e-b6ea-ba2aa04d25c5/labour) | completed | $2598.00 | 27h 28m | Locked |
| [Katie Kobia](https://serviceflow-admin.vercel.app/jobs/99a4cb86-ec09-54c1-8a95-ffac416cf844/labour) | archived | Missing | Missing | Locked |
| [Katie Wakeman](https://serviceflow-admin.vercel.app/jobs/97cd8cf6-07ec-5443-9643-22c28e0a49e9/labour) | active | Missing | Missing | — |
| [Kelly Boville](https://serviceflow-admin.vercel.app/jobs/42ff9e77-762e-5d1d-8323-6b43e2fc11c4/labour) | completed | $734.00 | 7h 46m | Locked |
| [Kelly Milne](https://serviceflow-admin.vercel.app/jobs/d2fe26a4-3a27-59e6-9c8c-607507e4d0e0/labour) | archived | Missing | Missing | Locked |
| [Kelly Milne — proposal 2411971 (completed)](https://serviceflow-admin.vercel.app/jobs/441eab66-14af-5c44-9554-407cab79ff68/labour) | completed | $2147.00 | 22h 42m | Locked |
| [Kelly Mounce](https://serviceflow-admin.vercel.app/jobs/a7adc7ef-b437-5b31-bc66-328030fe2e71/labour) | scheduled | $3858.06 | 39h 19m | — |
| [Kim Johnson](https://serviceflow-admin.vercel.app/jobs/56bcd3f0-8f33-5a6b-a7f8-bfa1db3c1e37/labour) | archived | Missing | Missing | Locked |
| [Kim Johnston — proposal 2383685 (completed)](https://serviceflow-admin.vercel.app/jobs/5f6ca26b-e988-5255-8d3b-0568cd52c930/labour) | completed | $2523.00 | 26h 40m | Locked |
| [Kim Kim](https://serviceflow-admin.vercel.app/jobs/7100e6e5-1667-5b1b-a986-9487145c58d1/labour) | active | $1762.00 | 21h 44m | — |
| [Kim Switzer — proposal 2195000](https://serviceflow-admin.vercel.app/jobs/b4a1d512-7b7f-59a6-af5f-1e0969b8eda9/labour) | completed | $37191.00 | 393h 10m | — |
| [Kim Switzer — proposal 2583136 (completed)](https://serviceflow-admin.vercel.app/jobs/a18670ea-a7c8-53e8-a3e2-50986fca9211/labour) | completed | $5313.00 | 56h 10m | Locked |
| [Kirsty Harris](https://serviceflow-admin.vercel.app/jobs/937164b8-fd2e-5d1c-bcf5-6d6797684c15/labour) | completed | $13222.00 | 139h 47m | — |
| [Kora McNulty](https://serviceflow-admin.vercel.app/jobs/c25beadf-930a-5d05-a4f4-5f29c222a8af/labour) | completed | $1264.00 | 13h 22m | Locked |
| [Krista Colwell](https://serviceflow-admin.vercel.app/jobs/0fbc8537-9760-50ad-883d-ea61e1a3ac1c/labour) | cancelled | Missing | Missing | — |
| [Krista Colwell](https://serviceflow-admin.vercel.app/jobs/88cc1e85-edb2-535c-8de0-77f36ffd390c/labour) | completed | $2073.00 | 21h 55m | Locked |
| [Kristi Johnson — proposal 3123192](https://serviceflow-admin.vercel.app/jobs/091bc64b-3c30-5419-97e9-7ea84f09882f/labour) | completed | $2116.00 | 22h 22m | — |
| [Ladislau Papara - 2026-08-04T15:43:57.013](https://serviceflow-admin.vercel.app/jobs/e122c069-7ad2-527c-947f-96feac4ed501/labour) | active | Missing | Missing | — |
| [Laura Braden — proposal 2851940 (completed)](https://serviceflow-admin.vercel.app/jobs/a14623f8-de48-54ad-9ab0-a2db9490aa83/labour) | archived | $70.00 | 0h 44m | Locked |
| [Laura Van Cleef](https://serviceflow-admin.vercel.app/jobs/727fddd3-09a4-5e77-a515-132dfcb6306d/labour) | completed | $1091.00 | 11h 32m | Locked |
| [Laura Van Cleef — proposal 2413005 (completed)](https://serviceflow-admin.vercel.app/jobs/1c43f245-68ce-5386-ab69-f77fc276744a/labour) | completed | $13524.05 | 142h 58m | Locked |
| [Laura Whitworth](https://serviceflow-admin.vercel.app/jobs/391a62d8-2940-5de8-8426-d2b439da680b/labour) | active | $2190.00 | 23h 9m | — |
| [Laurice Mahli — proposal 2021263 (completed)](https://serviceflow-admin.vercel.app/jobs/a760c15a-027e-57cd-9709-3e086b677274/labour) | completed | $700.00 | 7h 24m | Locked |
| [Laurissa Hevenor — proposal 1797547 (completed)](https://serviceflow-admin.vercel.app/jobs/6bd64518-2a09-5b76-ba8d-ea3eafdca34e/labour) | completed | $900.00 | 9h 31m | Locked |
| [Lee Snelling](https://serviceflow-admin.vercel.app/jobs/049683ef-dc8e-5962-bb02-80b438dd9bdd/labour) | completed | $6973.00 | 73h 43m | Locked |
| [Leiya Dobson](https://serviceflow-admin.vercel.app/jobs/7c61827a-d6c4-5c81-936b-3ab8cfbd05f6/labour) | completed | $957.00 | 10h 7m | — |
| [Lesley Lesley](https://serviceflow-admin.vercel.app/jobs/bd28a7cb-d6a7-5467-960c-966696416d09/labour) | active | $2650.00 | 32h 41m | — |
| [Libby Boulianne](https://serviceflow-admin.vercel.app/jobs/22c7c14e-7050-586b-be72-0dee546a64ea/labour) | completed | $1835.00 | 19h 24m | Locked |
| [Liz Foster — proposal 2059567 (completed)](https://serviceflow-admin.vercel.app/jobs/1b2f39f6-9211-54dc-9910-df00b8b3334b/labour) | completed | $1585.00 | 16h 45m | Locked |
| [Lorraine Ulrick - 2026-06-01T18:42:01.52](https://serviceflow-admin.vercel.app/jobs/8fc3c2b0-ea4f-510d-803a-613eadf70b09/labour) | completed | $3004.00 | 31h 46m | — |
| [Louis Titley — proposal 2002431 (completed)](https://serviceflow-admin.vercel.app/jobs/c17cad11-30a2-5e8e-ba01-d3e5e48b99f7/labour) | completed | $31700.00 | 335h 7m | Locked |
| [Louise Taillefer](https://serviceflow-admin.vercel.app/jobs/7ecdfdb0-f063-5eab-b4f5-e364c1d4de8d/labour) | archived | Missing | Missing | Locked |
| [Lucie McClennen](https://serviceflow-admin.vercel.app/jobs/be0908ff-7f68-5005-8b8d-ce7185c30408/labour) | archived | Missing | Missing | Locked |
| [Luke Nixon-janssen](https://serviceflow-admin.vercel.app/jobs/7b41167a-4fbf-53af-8fe6-166e3793f09e/labour) | archived | Missing | Missing | Locked |
| [Luke Nixon-Janssen... — proposal 2372277 (completed)](https://serviceflow-admin.vercel.app/jobs/53ce3349-2d3f-530d-b760-d364afefe5fe/labour) | completed | $6241.00 | 65h 59m | Locked |
| [Lune Arpin](https://serviceflow-admin.vercel.app/jobs/044fd14d-9c31-5ca2-bbce-227425c4ddd9/labour) | archived | Missing | Missing | Locked |
| [Maple Street Repaint](https://serviceflow-admin.vercel.app/jobs/dee00000-0000-4000-8000-000000000201/labour) | active | Missing | 120h 0m | — |
| [Marc Leahy — proposal 3121524](https://serviceflow-admin.vercel.app/jobs/3ae1f8f7-e591-5db0-90c4-35c32ca035bd/labour) | scheduled | $1857.00 | 22h 54m | — |
| [Marcelle Saad](https://serviceflow-admin.vercel.app/jobs/3b624f5a-707f-5661-bc41-ad11e62ebfb2/labour) | archived | Missing | Missing | Locked |
| [Marcelo's First Project](https://serviceflow-admin.vercel.app/jobs/6c93e046-c09d-53bd-bc08-498d4bf7a984/labour) | cancelled | Missing | Missing | — |
| [Maria Gonzalez — proposal 2200288 (completed)](https://serviceflow-admin.vercel.app/jobs/03e0c76e-af3d-50aa-b534-e398cc258fc6/labour) | archived | $750.00 | 7h 56m | Locked |
| [Mariah Landers](https://serviceflow-admin.vercel.app/jobs/1b5435e1-d82f-5cd6-bc41-f7143d95c6d2/labour) | archived | Missing | Missing | Locked |
| [Mariah Landers — proposal 2362146 (completed)](https://serviceflow-admin.vercel.app/jobs/18aad5ca-68a2-54f9-bdd1-d353d3728d97/labour) | completed | $1218.00 | 12h 53m | Locked |
| [Marie-josee Cardinal](https://serviceflow-admin.vercel.app/jobs/2499c2a3-f71d-5211-878e-b91c3cd808d7/labour) | active | Missing | Missing | — |
| [Mariel McKenzie](https://serviceflow-admin.vercel.app/jobs/20d583eb-1c2e-5515-8313-541ee7f808d7/labour) | active | $9038.00 | 111h 28m | — |
| [Marienne Graham](https://serviceflow-admin.vercel.app/jobs/68c95319-e1e3-598f-b065-e5e5733a5044/labour) | cancelled | Missing | Missing | — |
| [Marienne Graham](https://serviceflow-admin.vercel.app/jobs/c4c269e3-5a2b-535e-a15f-1476c3938033/labour) | completed | $3311.40 | 35h 1m | Locked |
| [Marilyn Hingorani](https://serviceflow-admin.vercel.app/jobs/b3fde37d-4e80-56ec-8535-c10e9c02c7c2/labour) | completed | $3625.20 | 38h 19m | Locked |
| [Martin Huot](https://serviceflow-admin.vercel.app/jobs/cd69dac4-e1d7-54a0-bce3-9f7feb884064/labour) | scheduled | $3075.36 | 32h 52m | Locked |
| [Mary Ann Laplante](https://serviceflow-admin.vercel.app/jobs/7c321f36-481c-5029-8dfe-fd5c532b2b00/labour) | archived | Missing | Missing | Locked |
| [Mary Honeywell — proposal 3119239](https://serviceflow-admin.vercel.app/jobs/8b8a9680-819e-55f5-8386-75ba6e29956e/labour) | active | $1021.65 | 12h 36m | — |
| [Maryanne Piecha — proposal 1834527 (completed)](https://serviceflow-admin.vercel.app/jobs/a7e7183d-a40e-5e65-8483-601fcae900f4/labour) | completed | $4030.00 | 42h 36m | Locked |
| [Matt Andruff](https://serviceflow-admin.vercel.app/jobs/a3c43058-8477-50ac-9f99-9c145360582a/labour) | archived | Missing | Missing | Locked |
| [Matt Mitchell](https://serviceflow-admin.vercel.app/jobs/fb46c1ea-86a4-539f-bb95-cd7905873067/labour) | completed | $2565.00 | 27h 7m | Locked |
| [Matthieu Fortin](https://serviceflow-admin.vercel.app/jobs/6c31388c-3bda-5313-bb69-e523e3cae156/labour) | active | Missing | Missing | — |
| [Matthieu Kimmell](https://serviceflow-admin.vercel.app/jobs/d7719eff-5526-55ee-959f-c2755bcd316a/labour) | active | Missing | Missing | — |
| [Media Move QA — TEST ONLY](https://serviceflow-admin.vercel.app/jobs/047064ac-b3dc-4ca0-a699-f4f1e7e20b97/labour) | scheduled | Missing | Missing | — |
| [Meg Friedman](https://serviceflow-admin.vercel.app/jobs/c29eddfc-5a8b-50da-8899-245466e96aa1/labour) | archived | Missing | Missing | Locked |
| [Mehaly Marinakis](https://serviceflow-admin.vercel.app/jobs/f34caa2c-4b8f-5600-9642-abc7f228ab50/labour) | completed | $1643.00 | 17h 22m | — |
| [Mehaly Marinakis — proposal 2959424](https://serviceflow-admin.vercel.app/jobs/ec24398b-3137-5b77-b59a-6497cd648aa9/labour) | scheduled | $575.68 | 7h 6m | — |
| [Melanie Stockdale](https://serviceflow-admin.vercel.app/jobs/b1c7bfcc-31e4-5076-9eda-3e03db9325f4/labour) | active | Missing | Missing | — |
| [Melissa Mathurin](https://serviceflow-admin.vercel.app/jobs/666a4446-cd83-5fd8-827f-8f2ea82dec0f/labour) | archived | Missing | Missing | Locked |
| [Mfs Property](https://serviceflow-admin.vercel.app/jobs/6d80deb1-7ab3-5463-be77-912e25ca39c4/labour) | archived | Missing | Missing | Locked |
| [Michael Sheridan](https://serviceflow-admin.vercel.app/jobs/c97726f4-fc7a-59d0-bd0c-1987efd79b8b/labour) | completed | $8618.00 | 91h 6m | Locked |
| [Michelle Brunet — proposal 2522158 (completed)](https://serviceflow-admin.vercel.app/jobs/35672a66-bf1b-53b8-983e-91a74d1758eb/labour) | completed | $350.00 | 3h 42m | Locked |
| [Michelle Fothering... — proposal 2002074 (completed)](https://serviceflow-admin.vercel.app/jobs/67d1e188-0476-5a4a-af80-44f5a5483c19/labour) | completed | $3700.00 | 39h 7m | Locked |
| [Michelle Seperich](https://serviceflow-admin.vercel.app/jobs/d8c269a2-e4f2-5e8b-9510-ca7f81a6bf12/labour) | active | Missing | Missing | — |
| [Michelle Wherrett](https://serviceflow-admin.vercel.app/jobs/6832ebd1-b58f-5c6e-b81a-24b1fdc76c13/labour) | archived | Missing | Missing | Locked |
| [Mike Hill](https://serviceflow-admin.vercel.app/jobs/c79dd591-62a3-53c9-ba63-a0eb1ff7e477/labour) | archived | Missing | Missing | Locked |
| [Mike Keillor](https://serviceflow-admin.vercel.app/jobs/4b051392-68a5-5eca-89e8-6c7c8afb877a/labour) | completed | $827.00 | 8h 44m | Locked |
| [Mike Ralph](https://serviceflow-admin.vercel.app/jobs/45bc1dd9-2634-5182-9e16-b17a778c0222/labour) | completed | $986.82 | 11h 41m | Locked |
| [Milana Karaganis](https://serviceflow-admin.vercel.app/jobs/cd1c5e9a-f80f-56ee-87a4-6ab000e8f362/labour) | completed | $567.52 | 6h 0m | — |
| [Miriam Abbadi](https://serviceflow-admin.vercel.app/jobs/bd4aebba-11ab-584f-a0e9-444d23570859/labour) | archived | Missing | Missing | Locked |
| [Molly Ruser](https://serviceflow-admin.vercel.app/jobs/bcef25d8-c518-503c-8f21-e4b008dee791/labour) | completed | $680.00 | 7h 11m | Locked |
| [Nancy Karas](https://serviceflow-admin.vercel.app/jobs/864d558f-6330-55a6-8f3f-46f37c49e16d/labour) | active | Missing | Missing | — |
| [Nandini Sarkar](https://serviceflow-admin.vercel.app/jobs/b5308edb-4446-553c-a07d-d9ed69bf4342/labour) | archived | Missing | Missing | Locked |
| [Natacha McGuire](https://serviceflow-admin.vercel.app/jobs/a3c24514-b777-5a97-9645-de69d406a830/labour) | completed | $3270.00 | 34h 34m | Locked |
| [Natasha Beauparlan... — proposal 2441742 (completed)](https://serviceflow-admin.vercel.app/jobs/e0806e97-507f-5a39-a89b-778070fffb79/labour) | completed | $655.00 | 6h 55m | Locked |
| [Natasha Kawam](https://serviceflow-admin.vercel.app/jobs/057e0dde-2a8d-5321-9e79-63f4b4521d0f/labour) | completed | Missing | 0 (explicit) | Locked |
| [Nathalie Guimont](https://serviceflow-admin.vercel.app/jobs/bda303d3-2800-5513-b1e3-9a8c89f0cf81/labour) | active | Missing | Missing | — |
| [Naya Mardi — proposal 1850029 (completed)](https://serviceflow-admin.vercel.app/jobs/65cc22b5-3d28-56c9-b1ae-28742fe8552a/labour) | completed | $6650.00 | 70h 18m | Locked |
| [Neill Bales](https://serviceflow-admin.vercel.app/jobs/0c568fca-95b3-5dec-ae51-38d198eb6c1f/labour) | active | $5955.10 | 73h 27m | — |
| [Nichole Dufour](https://serviceflow-admin.vercel.app/jobs/bb88ce79-88b6-57da-beaa-821a5a9bd26a/labour) | archived | Missing | Missing | Locked |
| [Nick Dix — proposal 2101879 (completed)](https://serviceflow-admin.vercel.app/jobs/5ee70f6d-08d5-54b7-87bd-2c717445baa7/labour) | cancelled | $1450.00 | 15h 20m | — |
| [Ninon Parent](https://serviceflow-admin.vercel.app/jobs/e9589a83-e5cb-505d-a6bb-faad21781c99/labour) | archived | Missing | Missing | Locked |
| [Noah Rossman](https://serviceflow-admin.vercel.app/jobs/e5acf9f3-8f1e-5904-98bb-db6f276490d2/labour) | completed | $6401.00 | 67h 55m | Locked |
| [Oriet Greg](https://serviceflow-admin.vercel.app/jobs/4d99913a-e15f-5493-9bd4-e0b1b10df554/labour) | completed | $755.00 | 7h 59m | Locked |
| [Paola Vicent](https://serviceflow-admin.vercel.app/jobs/7fca37ea-7e24-5af2-ba8a-f1cb8b9192dd/labour) | active | $2667.93 | 32h 54m | — |
| [Pat Alarie — proposal 2159941 (completed)](https://serviceflow-admin.vercel.app/jobs/267fe967-8961-5474-b847-2b7beab9b4ba/labour) | cancelled | $11170.00 | 118h 5m | — |
| [Pat Hogue](https://serviceflow-admin.vercel.app/jobs/f6c47e40-8a55-5141-b229-91c828d1d5e5/labour) | archived | Missing | Missing | Locked |
| [Patrick Lenouvel](https://serviceflow-admin.vercel.app/jobs/2d8c4129-67a4-55e1-ac96-71a76fbe5594/labour) | completed | $2169.00 | 22h 56m | — |
| [Patti Hallman](https://serviceflow-admin.vercel.app/jobs/ff08fcdb-0014-561c-936a-30c0de1c9cff/labour) | active | $1125.00 | 13h 53m | — |
| [Patti Hallman](https://serviceflow-admin.vercel.app/jobs/e388310b-c526-5c13-ab90-07fe0e5c3391/labour) | active | $2943.65 | 36h 18m | — |
| [Paul Harrison — proposal 2496838 (completed)](https://serviceflow-admin.vercel.app/jobs/44ec008e-5e81-521c-8e92-cbe77ad7cf0e/labour) | completed | $1669.00 | 17h 39m | Locked |
| [Paul Harrison Rental](https://serviceflow-admin.vercel.app/jobs/afc652ee-c8ab-5c2c-a82d-d732ef9f0c8b/labour) | completed | $1791.00 | 18h 56m | Locked |
| [Paul Toonders](https://serviceflow-admin.vercel.app/jobs/3955bafb-4b27-5d9b-a7df-5db84d087341/labour) | scheduled | $2455.00 | 25h 57m | — |
| [Paul Toonders](https://serviceflow-admin.vercel.app/jobs/fe2abf23-b072-5833-a720-7703c1deb9e9/labour) | cancelled | Missing | Missing | — |
| [Pauline Burton — proposal 3102375](https://serviceflow-admin.vercel.app/jobs/790d1f16-664c-5b1a-b143-0183d97cc9cd/labour) | active | $5856.40 | 72h 14m | — |
| [Phil Anido](https://serviceflow-admin.vercel.app/jobs/fa9d5e0b-4192-5251-8d16-5d7d7dd0ac16/labour) | scheduled | $3310.00 | 34h 59m | — |
| [Phil Coe #1](https://serviceflow-admin.vercel.app/jobs/fa99b710-0960-5b5a-9066-9dc6f771f296/labour) | active | Missing | Missing | — |
| [Pierre Caron](https://serviceflow-admin.vercel.app/jobs/4f6fb831-bce5-5789-bb33-f90fd1750947/labour) | completed | $1220.00 | 0h 53m | — |
| [Pierre E](https://serviceflow-admin.vercel.app/jobs/cf79e35a-a144-501e-bd1a-014e5454f5c3/labour) | active | Missing | Missing | — |
| [Preeti Sharma](https://serviceflow-admin.vercel.app/jobs/759d4d88-ae45-5d38-8920-e9917ac93076/labour) | active | Missing | Missing | — |
| [Priscila Gondim Al... — proposal 2640615 (completed)](https://serviceflow-admin.vercel.app/jobs/7d3de26f-8b87-5470-9c23-ce19c6540893/labour) | completed | $930.00 | 9h 50m | Locked |
| [Priscilla](https://serviceflow-admin.vercel.app/jobs/a7980feb-1f04-5697-8a9d-1738789343e5/labour) | archived | Missing | Missing | Locked |
| [Priya Dube](https://serviceflow-admin.vercel.app/jobs/f5d94da0-f7db-5f14-8b1a-0203b27cc121/labour) | active | $2717.65 | 33h 31m | — |
| [project 1](https://serviceflow-admin.vercel.app/jobs/f7d39c70-3a8e-5c07-99fe-6f26eabf880e/labour) | cancelled | Missing | Missing | — |
| [Rachel May-Boland](https://serviceflow-admin.vercel.app/jobs/06ee1385-bffd-5f91-ba2c-d46e4fb2129a/labour) | archived | Missing | Missing | Locked |
| [Rachelle Latremouille](https://serviceflow-admin.vercel.app/jobs/6c110c70-bf35-5e09-97bd-f820cfc69e04/labour) | active | Missing | Missing | — |
| [Rachelle Paul](https://serviceflow-admin.vercel.app/jobs/c2034098-ef21-518a-9f4f-3494b35e17fa/labour) | completed | $1246.00 | 13h 10m | Locked |
| [Rashonda Legault](https://serviceflow-admin.vercel.app/jobs/c27f44a1-1f5c-5121-8bb8-326fee7d4f96/labour) | completed | $760.00 | 8h 10m | Locked |
| [Rebecca Westwell](https://serviceflow-admin.vercel.app/jobs/87842ecc-f13f-5b57-95f5-529ac5436729/labour) | archived | Missing | Missing | Locked |
| [Regan Meloche](https://serviceflow-admin.vercel.app/jobs/1366c06d-ad1f-5444-a79a-1bf46bcd3b85/labour) | active | $548.05 | 6h 46m | — |
| [Rekha Tulsiram](https://serviceflow-admin.vercel.app/jobs/8341792b-eda0-5a02-9db9-16732d204bab/labour) | completed | $2982.00 | 31h 31m | Locked |
| [Rene Bellavance](https://serviceflow-admin.vercel.app/jobs/8eb0e714-17f5-5e80-894a-119ae308eda4/labour) | completed | $4000.00 | 37h 25m | Locked |
| [Rick Piche — proposal 2258601 (completed)](https://serviceflow-admin.vercel.app/jobs/c7410e2d-3d7f-5606-ab9b-1e85535866d4/labour) | completed | $1805.00 | 19h 5m | Locked |
| [Rima Burder](https://serviceflow-admin.vercel.app/jobs/3aaceca1-d011-53b8-92bf-3bdd32397433/labour) | archived | Missing | Missing | Locked |
| [Robert Peixoto](https://serviceflow-admin.vercel.app/jobs/f2a5b0c9-0a49-53a9-adf8-557274dd7a77/labour) | archived | Missing | Missing | Locked |
| [Robin Fader — proposal 2411742 (completed)](https://serviceflow-admin.vercel.app/jobs/4218f23c-459b-5147-8e40-26e34a1089a1/labour) | completed | $670.00 | 7h 5m | Locked |
| [Rohit Jain](https://serviceflow-admin.vercel.app/jobs/0b025988-15c3-5c03-a055-a30ca001eac8/labour) | archived | Missing | Missing | Locked |
| [Ron Burman](https://serviceflow-admin.vercel.app/jobs/16e460fa-c597-5c52-89d1-91bbf996a73e/labour) | archived | Missing | Missing | Locked |
| [Ron Burman — proposal 2388959 (completed)](https://serviceflow-admin.vercel.app/jobs/350b625d-316f-55cb-87c7-7509d1328b42/labour) | completed | $1000.00 | 10h 34m | Locked |
| [Roslyn Mulongo](https://serviceflow-admin.vercel.app/jobs/f0743718-d031-5e03-9f60-0628bb0d82d7/labour) | completed | $1318.00 | 13h 56m | Locked |
| [Ruth Leard](https://serviceflow-admin.vercel.app/jobs/7279fbde-6183-54fe-8fbf-7f41da918018/labour) | active | $2748.16 | 33h 54m | — |
| [Ryan Green](https://serviceflow-admin.vercel.app/jobs/6fef6014-dd17-5a31-96d3-68f4f5a79a7c/labour) | active | Missing | Missing | — |
| [Ryan Molloy](https://serviceflow-admin.vercel.app/jobs/0d328786-a30d-507f-97a2-e43d253860b1/labour) | archived | Missing | Missing | Locked |
| [Salah Osman — proposal 2159531 (completed)](https://serviceflow-admin.vercel.app/jobs/0d5093bc-2cd0-5334-844b-6d50b5a39a73/labour) | completed | $6940.00 | 73h 22m | Locked |
| [Sally Bidal](https://serviceflow-admin.vercel.app/jobs/b33ba56b-eb80-5496-8104-7ce504d7354c/labour) | completed | $4290.00 | 45h 21m | — |
| [Sam Damidenko](https://serviceflow-admin.vercel.app/jobs/953fd5ec-5359-592f-bb82-c0d65d9d1ab4/labour) | active | $4226.20 | 52h 7m | — |
| [Sam Kotecha](https://serviceflow-admin.vercel.app/jobs/f092e873-b58c-59a5-bdeb-a22351d65c3d/labour) | archived | Missing | Missing | Locked |
| [Samer Juma Ali](https://serviceflow-admin.vercel.app/jobs/7b055ea5-6e9c-524d-8d58-c1153608065a/labour) | archived | Missing | Missing | Locked |
| [Sami Evelyn — proposal 2039512 (completed)](https://serviceflow-admin.vercel.app/jobs/6816f447-ec02-5d83-a93a-6431edb22fd7/labour) | completed | $2911.00 | 30h 46m | Locked |
| [Santhosh Kumar](https://serviceflow-admin.vercel.app/jobs/d00436a8-cb7a-5542-bc6c-71892969f77b/labour) | archived | Missing | Missing | Locked |
| [Sarah Cruickshank](https://serviceflow-admin.vercel.app/jobs/86ce4cd0-3546-59c7-bbb0-5b602f3d9c38/labour) | completed | $2969.00 | 31h 34m | Locked |
| [Saroeun Cole](https://serviceflow-admin.vercel.app/jobs/f5b49025-3d8b-5afe-91f6-4d53621f0409/labour) | completed | $2358.75 | 24h 56m | Locked |
| [scott](https://serviceflow-admin.vercel.app/jobs/3c19a04a-7154-5eca-ad6c-68c22fd57960/labour) | cancelled | Missing | Missing | Locked |
| [Scott MacEwen — proposal 1889052 (completed)](https://serviceflow-admin.vercel.app/jobs/c79f6970-4820-5f9c-adfb-275b3ec75aee/labour) | archived | Missing | Missing | Locked |
| [Scott Madden Test](https://serviceflow-admin.vercel.app/jobs/10334452-85fc-517b-8901-6f01d27fed4f/labour) | cancelled | Missing | Missing | Locked |
| [Scott Maxwell — proposal 2193648 (completed)](https://serviceflow-admin.vercel.app/jobs/624aece4-ce63-59e8-a29a-79067a0f98fd/labour) | completed | $1545.00 | 16h 20m | Locked |
| [Selvinah Vydelingum](https://serviceflow-admin.vercel.app/jobs/2909c1ba-d0cf-57b2-b33e-b97dd72fddd0/labour) | archived | Missing | Missing | Locked |
| [Semirath Fagbemi](https://serviceflow-admin.vercel.app/jobs/875a635e-336f-53f8-a59b-62106111b27b/labour) | archived | Missing | Missing | Locked |
| [Serap Saribiga](https://serviceflow-admin.vercel.app/jobs/3d24b3c1-0b33-592a-b1ae-6a27e7e28b91/labour) | archived | Missing | Missing | Locked |
| [Shawn Myers](https://serviceflow-admin.vercel.app/jobs/f5d63c49-6094-5fea-a23b-e3b90edc111e/labour) | archived | Missing | Missing | Locked |
| [Shawn Myers — proposal 2285755 (completed)](https://serviceflow-admin.vercel.app/jobs/b7b6c7d0-2755-5224-be82-70b2b23a3526/labour) | completed | $2365.00 | 25h 0m | Locked |
| [Sheila McSwiggan](https://serviceflow-admin.vercel.app/jobs/4499ebe1-cad6-545e-8498-6fb47ba36839/labour) | completed | $1000.00 | 10h 34m | — |
| [Sheila McSwiggan — proposal 2140736 (completed)](https://serviceflow-admin.vercel.app/jobs/d59067a6-7485-59f7-b11a-2658d33378d1/labour) | archived | $600.00 | 6h 21m | Locked |
| [Sherrie Egan](https://serviceflow-admin.vercel.app/jobs/b0bc0dba-9412-50de-afb8-d26899e4330f/labour) | scheduled | $3990.00 | 49h 13m | — |
| [Sherry Connors](https://serviceflow-admin.vercel.app/jobs/33e23ed7-39af-5f26-9b7a-120efc64b396/labour) | active | $1380.86 | 17h 2m | — |
| [Shezara Ali](https://serviceflow-admin.vercel.app/jobs/f0cd9e9f-f153-5bae-a68f-4b940e99fbee/labour) | completed | $855.00 | 0 (explicit) | — |
| [Shezara Ali — proposal 2873427](https://serviceflow-admin.vercel.app/jobs/a401f302-c764-5153-a2e4-75d0ae13606f/labour) | archived | $1406.85 | Missing | — |
| [Shiho mshoshii — proposal 2266588 (completed)](https://serviceflow-admin.vercel.app/jobs/b3c7e36f-9641-52a1-b044-c70b066a0a56/labour) | completed | $300.00 | 3h 10m | Locked |
| [Sonya Lee](https://serviceflow-admin.vercel.app/jobs/dd79bee0-f945-5239-9f28-bdac32246b69/labour) | completed | $7050.00 | 74h 32m | Locked |
| [Sophie Bruyere](https://serviceflow-admin.vercel.app/jobs/ce046ed8-abbe-5801-96c0-0badf5edb839/labour) | active | $4365.00 | 53h 50m | — |
| [Stefanie Pinto](https://serviceflow-admin.vercel.app/jobs/965deefc-9378-5aff-96ca-a74104db2e01/labour) | active | $602.29 | 7h 26m | — |
| [Stephanie Gigault](https://serviceflow-admin.vercel.app/jobs/28c7dd53-f655-54ff-9b69-3b401698b0e3/labour) | archived | Missing | Missing | Locked |
| [Stephanie Udeh - Thermogenics](https://serviceflow-admin.vercel.app/jobs/8a2db041-e479-5a1d-a5ae-c1a868728602/labour) | archived | Missing | Missing | Locked |
| [Sue Deluney](https://serviceflow-admin.vercel.app/jobs/7b0d9ef0-c0b7-507a-b74d-4fe1bd7c6eb7/labour) | scheduled | $3332.00 | 32h 47m | — |
| [Sukaina Okorofsky](https://serviceflow-admin.vercel.app/jobs/07e911af-522a-5b46-93a6-8f5d3c9dfb6b/labour) | completed | $2254.00 | 23h 50m | Locked |
| [Sunita Sharma — proposal 1983452 (completed)](https://serviceflow-admin.vercel.app/jobs/12459e2d-006b-5ab5-8a68-bf7dd9d045b7/labour) | completed | $1668.50 | 17h 38m | Locked |
| [Tanya Wagdin](https://serviceflow-admin.vercel.app/jobs/aceffee8-7906-5c43-bc00-2057ff2b8059/labour) | scheduled | $2645.00 | 27h 58m | — |
| [Tareq Shiblaq](https://serviceflow-admin.vercel.app/jobs/fa2ba12f-bb76-5464-b93b-e214a00d22f3/labour) | completed | $3604.00 | 38h 6m | — |
| [Tasha Thornton](https://serviceflow-admin.vercel.app/jobs/76f23ac5-0a28-5268-9175-672cec8d1716/labour) | active | $795.00 | 9h 48m | — |
| [Tessa Fauquier — proposal 2045413 (completed)](https://serviceflow-admin.vercel.app/jobs/3aa87a09-ef59-505e-bf72-1e17260ba354/labour) | completed | $1800.00 | 19h 2m | Locked |
| [Theresa Ngondi](https://serviceflow-admin.vercel.app/jobs/b67870d7-28af-5114-a74f-c4d9fe8ba162/labour) | archived | Missing | Missing | Locked |
| [Tina Morden](https://serviceflow-admin.vercel.app/jobs/13a8d26a-c195-5021-93cf-384d3c339baa/labour) | archived | Missing | Missing | Locked |
| [Tom Benton](https://serviceflow-admin.vercel.app/jobs/f545b045-29e8-5422-b8f1-4b101d5b0b94/labour) | scheduled | $1699.00 | 20h 57m | — |
| [Tom Benton — proposal 2390920 (completed)](https://serviceflow-admin.vercel.app/jobs/5e4558ff-c4bb-5591-b33b-69929b13732e/labour) | completed | $3110.00 | 32h 53m | Locked |
| [Tracy Adams](https://serviceflow-admin.vercel.app/jobs/0a03062b-1a61-5fd5-b029-530d5e9a3c6c/labour) | completed | $1778.00 | 18h 48m | Locked |
| [Tyler Duncan](https://serviceflow-admin.vercel.app/jobs/73c39b39-67f3-545b-8322-2ac4e9b40f31/labour) | completed | $942.00 | 9h 58m | — |
| [Vamsi Pulagem](https://serviceflow-admin.vercel.app/jobs/a8ec6fc6-b24c-587f-b04c-3808ea989ca1/labour) | archived | Missing | Missing | Locked |
| [Vanessa Mercier](https://serviceflow-admin.vercel.app/jobs/3ab8d9b1-6280-594a-8044-b39e3abf8d9c/labour) | archived | Missing | Missing | Locked |
| [Vincy Li — proposal 1908370 (completed)](https://serviceflow-admin.vercel.app/jobs/1f3c6f39-8f1c-5156-baff-b4fca80f0ecd/labour) | completed | $5365.00 | 56h 43m | Locked |
| [Wanda](https://serviceflow-admin.vercel.app/jobs/bda0efc1-068d-5a04-a296-ee963baff04a/labour) | completed | $437.00 | 4h 52m | Locked |
| [Wardah Vacher - 2026-07-04T13:26:59.99](https://serviceflow-admin.vercel.app/jobs/4cb883f3-58e6-5fa0-861a-05680f692bd3/labour) | scheduled | $4450.00 | 47h 2m | — |
| [Wendy Luciani](https://serviceflow-admin.vercel.app/jobs/620e5bc7-aa1e-5a83-b75f-4cb0dd69e20e/labour) | archived | Missing | Missing | Locked |
| [Wendy Page](https://serviceflow-admin.vercel.app/jobs/3b13fd20-083d-5917-9216-419885bbff2c/labour) | scheduled | $4894.00 | 51h 44m | — |
| [Westboro Condo Interior](https://serviceflow-admin.vercel.app/jobs/dee00000-0000-4000-8000-000000000203/labour) | active | Missing | 40h 0m | — |
| [Yacoub Abdulla](https://serviceflow-admin.vercel.app/jobs/2a5db544-6d2c-5f33-83f1-6fe065d2f2c2/labour) | completed | $6365.31 | 67h 17m | — |
| [Yasmin Jiwani](https://serviceflow-admin.vercel.app/jobs/38c0ff2b-08f8-5453-96ed-ddba800e3176/labour) | active | $453.98 | 5h 36m | — |
| [Yasmin Jiwani](https://serviceflow-admin.vercel.app/jobs/efb985ef-501b-522c-875c-cc27f4e12197/labour) | active | $1738.98 | 21h 27m | — |
| [Yolanda Cobisa](https://serviceflow-admin.vercel.app/jobs/8a9fc3aa-988b-5989-a902-8dc12d9a7274/labour) | archived | Missing | Missing | Locked |
| [Yuri Khoroshilov](https://serviceflow-admin.vercel.app/jobs/e5e1d833-3131-539d-b4a5-5d159d13d0ce/labour) | archived | Missing | Missing | Locked |
| [YURI KHOROSHILOV — proposal 2496932 (completed)](https://serviceflow-admin.vercel.app/jobs/c121ec3e-f779-505f-ab55-2d3953d50a4c/labour) | archived | $7124.00 | 75h 19m | Locked |
| [Zeana Robleh](https://serviceflow-admin.vercel.app/jobs/3efe1c65-54f5-571c-aeed-bf08b8e62999/labour) | active | Missing | Missing | — |

