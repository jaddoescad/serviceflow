#!/usr/bin/env node

import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { createClient } from "@supabase/supabase-js";

const TARGET_PROJECT_REF = "bwbckdkouqghdadpkjvn";
const ADMIN_USER_ID = "97b8cd3f-ec14-418b-81e5-837a64be906e";
const POLARIS_CONTRACTOR_ID = "c5e12a25-2f40-4c05-af51-4f9f8401b573";
const AREF_CONTRACTOR_ID = "5fd3d97a-b5f7-4b34-8dad-9e5fa39c266d";
const APPLY = process.argv.includes("--apply");
const NOW = new Date().toISOString();

const PAYMENT_RECORD_CORRECTIONS = [
  "083b2802-7f9f-43e3-8ee1-0a56ce3cfba5",
  "b03bb25a-e428-4ca5-9dca-5ee2ecfd0b98",
  "97c17907-c5b6-4b22-ae85-6d0b6b4db84b",
  "c1282b1e-e97f-442f-aeac-380d134da532",
  "80b92632-8b03-4bb2-8621-3738fe8e2686",
  "55cd1a3b-b41b-4b04-a632-08597a0d6658",
  "7a98d346-f5a5-4ac7-9f61-271f0c684243",
  "9a741f17-e1d1-417d-bace-1704e4f447a9",
  "8a4616d1-7981-464f-8d6d-8eaf2ba8c1ea",
  "ba41388b-ac51-4612-a9d2-b977562a352e",
  "a50681e9-c8a3-450b-b837-01907a879bd9",
  "9f6accf2-edc7-45b7-a3a2-fbb5ced61a93",
  "714efbfa-a2b2-48ab-8095-7fdb40a6f764",
  "857d581d-591f-4462-8843-0201e8eaf36b",
  "fd83f041-d511-48f8-ae3a-fa3bb1140dae",
  "40937976-8274-4f66-95e5-4be6c7b79ca8",
  "0eb78b94-02b4-4890-8223-1dec91a39d5c",
  "05fc2853-d33b-4cbe-ba42-c976d34597e1",
  "2b530856-6d01-40f2-afd6-0fcc4233bf73",
  "3bf77a7c-9ab9-447c-83e6-f77175a2e2d9",
].map((financialTransactionId) => ({
  financialTransactionId,
  fromContractorId: AREF_CONTRACTOR_ID,
  toContractorId: POLARIS_CONTRACTOR_ID,
  recipientName: "Aref Hosain Mohammadi",
  reason:
    "Ottawa Painters administrator confirmed on 2026-07-30 that Aref Hosain Mohammadi is the individual e-transfer recipient for Polaris Painters. The bank counterparty remains Aref as source evidence; the payment record belongs to Polaris for invoice settlement.",
}));

const INVOICE_CORRECTIONS = [
  {
    id: "0dd5d2ac-2b6a-41d5-a32b-78074285356d",
    number: "25001",
    gross: 1388.97,
    desired: {
      match_status: "supporting_document",
      supporting_invoice_reference:
        "Superseded by invoice record 85a25280-4464-49fe-9e82-0b41848212f9",
    },
    reason:
      "Earlier Gmail copy of the same 613PAINTING invoice. The October 2 canonical copy is linked to the exact deposited payment.",
  },
  {
    id: "76ac6ef6-ab10-403b-9be6-58ff92ad1c5e",
    number: "25001",
    gross: 1388.97,
    desired: {
      match_status: "supporting_document",
      supporting_invoice_reference:
        "Duplicate of invoice record 85a25280-4464-49fe-9e82-0b41848212f9",
    },
    reason:
      "Duplicate Gmail attachment of the same 613PAINTING invoice. It must not create a second payable.",
  },
  {
    id: "2c90c639-506f-43f1-8c09-207eeae88243",
    number: "INV-000197",
    gross: 11535.04,
    desired: {
      match_status: "supporting_document",
      supporting_invoice_reference:
        "Superseded by invoice record 60056524-83a3-4480-a685-e59ef03ed974",
    },
    reason:
      "Earlier version of Goulet invoice INV-000197. The October 20 revision exactly matches the October 21 bank payment.",
  },
  {
    id: "2a342af9-9189-448b-8346-91940e0d91b5",
    number: "1",
    gross: 1085,
    desired: {
      match_status: "supporting_document",
      supporting_invoice_reference:
        "Superseded by invoice record e7acae64-3dfd-4b3a-8571-a7e805ae933d",
    },
    reason:
      "Lower Scott Bertin invoice version. The $1,980.00 version exactly matches the same-day verified payment.",
  },
  {
    id: "355846ef-3c24-43ba-b8cf-fe34643de2dc",
    number: "INV-20260128-001",
    gross: 1900,
    desired: {
      match_status: "supporting_document",
      supporting_invoice_reference:
        "Superseded by invoice record 28e83673-497a-4f2b-8d6d-e453035a311d",
    },
    reason:
      "The later $2,900.00 invoice adds Tracey Adams and paint to the same three jobs and exactly matches the deposited payment.",
  },
  {
    id: "85e14dec-3d16-47a9-bb16-e4cc59bfe1de",
    number: "INV-20260128-001",
    gross: 800,
    desired: {
      match_status: "matched",
      duplicate_group_id: null,
      supporting_invoice_reference: null,
    },
    reason:
      "Distinct February 18 Abdellah invoice for Gordon Zans and Tom Benton. The supplier reused an invoice number; this is not a duplicate of the January invoice.",
  },
  {
    id: "3e47a6ae-ce29-40b7-92c9-f2fde8355bca",
    number: "INV-20260615-001",
    gross: 520,
    desired: {
      match_status: "matched",
      duplicate_group_id: null,
      supporting_invoice_reference: null,
    },
    reason:
      "Distinct Abdellah invoice for Donna Quigley. Gmail subject and invoice content prove it is separate from the same-number Danielle Hards invoice.",
  },
  {
    id: "d771062d-e2d5-41c3-9645-e079eec1461f",
    number: "INV-20260615-001",
    gross: 104,
    desired: {
      match_status: "matched",
      duplicate_group_id: null,
      supporting_invoice_reference: null,
    },
    reason:
      "Distinct Abdellah invoice for Danielle Hards. Gmail subject and invoice content prove it is separate from the same-number Donna Quigley invoice.",
  },
  {
    id: "b4f0f232-63f0-4ba4-9f47-cc9c41c0683f",
    number: "108",
    gross: 5545.76,
    desired: {
      match_status: "supporting_document",
      supporting_invoice_reference:
        "Superseded by invoice record 82e7b902-1446-4d4c-926d-ffecce87b009",
    },
    reason:
      "Earlier AMG invoice #108 version. The latest $5,364.19 version is the payable total and equals the two verified payments.",
  },
  {
    id: "966934b8-3938-424a-ac09-da08c593d08f",
    number: "108",
    gross: 5364.19,
    desired: {
      match_status: "supporting_document",
      supporting_invoice_reference:
        "Duplicate of invoice record 82e7b902-1446-4d4c-926d-ffecce87b009",
    },
    reason:
      "Duplicate copy of the final AMG invoice #108. It must not create a second payable.",
  },
  {
    id: "5c7954ec-b980-4ba3-bca1-81e3aa2a3ba6",
    number: "109",
    gross: 1447.2,
    desired: {
      match_status: "supporting_document",
      supporting_invoice_reference:
        "Superseded by invoice record 097114d3-d3f0-4cc0-8543-43260d704a16",
    },
    reason:
      "AMG explicitly emailed that the $1,250.75 invoice was the correct replacement for the wrong earlier #109 amount; Gmail message 19e8e7a1da3f4a49.",
  },
  {
    id: "86264601-366e-4682-953a-6ca1b79b14e0",
    number: "FM-171",
    gross: 5367.5,
    desired: {
      match_status: "supporting_document",
      supporting_invoice_reference:
        "Superseded by invoice record e8cb4cc5-2610-4385-aa3d-1d64cc4c552d",
    },
    reason:
      "Premium Coat emailed an adjusted FM-171 after the initial version; Gmail message 19e7a57a2a98f36f. The adjusted $2,131.82 total exactly matches the payment.",
  },
  {
    id: "e8cb4cc5-2610-4385-aa3d-1d64cc4c552d",
    number: "FM-171",
    gross: 2131.82,
    expectedDocumentType: "receipt",
    desired: {
      document_type: "invoice",
    },
    reason:
      "The document is headed INVOICE FM-171, states a due date and total due, and is the adjusted payable invoice—not a receipt.",
  },
  {
    id: "083fe4ae-5409-4ab1-b560-6aef0a2f5991",
    number: "FM-149",
    gross: 7232.19,
    expectedDocumentType: "receipt",
    desired: {
      document_type: "invoice",
    },
    reason:
      "The stored Premium Coat document is an invoice with an invoice number, due date and total due; it was misclassified as a receipt.",
  },
  {
    id: "d1266895-85f3-4ce7-a4fe-a0646f8347ba",
    number: "GT-INV-202606-04",
    gross: 996.13,
    expectedDocumentType: "receipt",
    desired: {
      document_type: "invoice",
    },
    reason:
      "The stored Grutenco document is explicitly headed INVOICE and contains payment terms and a total payable; it was misclassified as a receipt.",
  },
  {
    id: "f9e1aa0a-3121-4172-882c-91008638e2da",
    number: "1",
    gross: 8414.47,
    expectedDocumentType: "receipt",
    desired: {
      document_type: "invoice",
    },
    reason:
      "The Caledonian document text is an invoice billed to Ottawa Painters, not a receipt.",
  },
  {
    id: "ca3e8c1e-5689-4a9d-b59d-f4469d553ba5",
    number: "3",
    gross: 1728,
    desired: {
      match_status: "supporting_document",
      supporting_invoice_reference:
        "Supporting hours page for invoice record f62d842d-9099-4b51-bea8-6f71cea2b2d0",
    },
    reason:
      "This attachment is page 2 of Angel invoice #3 and supplies the hours supporting the $1,728.00 summary invoice; it is not a second payable.",
  },
  {
    id: "a4b6583a-9a07-48e9-974e-3a4532452b35",
    number: "3",
    gross: 1275,
    desired: {
      match_status: "matched",
      duplicate_group_id: null,
      supporting_invoice_reference: null,
    },
    reason:
      "Distinct March 6 Angel invoice for Krista Colwell and Sukaina Okorofsky. The supplier reused invoice #3; this is not a duplicate.",
  },
  {
    id: "1c2a6b4c-ce17-46b9-b2c1-d7781c87d33f",
    number: "3",
    gross: 646.88,
    desired: {
      match_status: "matched",
      duplicate_group_id: null,
      supporting_invoice_reference: null,
    },
    reason:
      "Distinct March 11 Angel invoice for Greg Alexander. The supplier reused invoice #3; this is not a duplicate.",
  },
  {
    id: "aea01958-952c-48f9-8d52-2f5674435611",
    number: "8",
    gross: 393.75,
    desired: {
      match_status: "matched",
      duplicate_group_id: null,
      supporting_invoice_reference: null,
    },
    reason:
      "Distinct April 2 Angel invoice #8 for Paul Harrison. It is separate from the later same-number Noah Rossman invoice.",
  },
  {
    id: "71e3c85c-7beb-4d4b-9279-bdc6d82ae4ea",
    number: "8",
    gross: 187.5,
    desired: {
      match_status: "matched",
      duplicate_group_id: null,
      supporting_invoice_reference: null,
    },
    reason:
      "Distinct April 10 Angel invoice #8 for Noah Rossman. It is separate from the earlier same-number Paul Harrison invoice.",
  },
  {
    id: "06f7ff30-1bf7-4b84-91fa-2e92d9e3ded0",
    number: "9",
    gross: 431.25,
    desired: {
      match_status: "matched",
      duplicate_group_id: null,
      supporting_invoice_reference: null,
    },
    reason:
      "Distinct Angel invoice #9 for Rachelle Paul. It is one of two same-number job invoices paid together.",
  },
  {
    id: "5c48ca4d-b926-482e-bccc-4ac4fc9ddd89",
    number: "9",
    gross: 337.5,
    desired: {
      match_status: "matched",
      duplicate_group_id: null,
      supporting_invoice_reference: null,
    },
    reason:
      "Distinct Angel invoice #9 for Sarah Cruickshank. It is one of two same-number job invoices paid together.",
  },
];

const MATCHES = [
  {
    contractor: "613PAINTING INC",
    contractorId: "c8e9f477-e2bc-452a-998d-e280b95056cd",
    payment: {
      id: "308d6cbc-7bbd-4586-a327-c9b37ab43f51",
      date: "2025-10-02",
      reference: "mys",
      amount: 1388.97,
      messageId: "199a59e8ef566df4",
    },
    invoices: [
      {
        id: "85a25280-4464-49fe-9e82-0b41848212f9",
        number: "25001",
        amount: 1388.97,
        messageId: "1999d987106c390b",
      },
    ],
    note: "Exact after-HST invoice total. TD confirms the transfer to 613PAINTING was deposited.",
  },
  {
    contractor: "Andrew Bell",
    contractorId: "f6894975-0de8-411c-8d1a-881e99ccd742",
    payment: {
      id: "a4851651-067e-4034-b95e-f590559219dd",
      date: "2026-04-07",
      reference: "Nnh",
      amount: 855,
      messageId: "19d694009145c6e9",
    },
    invoices: [
      {
        id: "52b9d873-cb6a-441a-a835-5c82ba10a9f4",
        number: "001",
        amount: 855,
        messageId: "19d5fc35769e3f15",
      },
    ],
    note: "Exact invoice total. TD and EasyWeb identify Andrew Bell as the recipient.",
  },
  {
    contractor: "Andrew Bell",
    contractorId: "f6894975-0de8-411c-8d1a-881e99ccd742",
    payment: {
      id: "5645bffd-ab35-4ec8-9ae7-112868be7ba8",
      date: "2026-04-13",
      reference: "zdT",
      amount: 1290,
      messageId: "19d877f27663ed91",
    },
    invoices: [
      {
        id: "d273c857-9fc7-450d-a5e3-d4dfff59d3b1",
        number: "FILE-86FD75ADBC63",
        amount: 630,
        messageId: "19d7eed8dd633ac9",
      },
      {
        id: "df8d230d-3f7a-4eaa-8ab3-f57fa2ef326e",
        number: "FILE-4D64C6E844C2",
        amount: 660,
        messageId: "19d7eed8dd633ac9",
      },
    ],
    note: "Unique same-email invoice group: $630.00 plus $660.00 equals the $1,290.00 transfer. TD and EasyWeb identify Andrew Bell as the recipient.",
  },
  {
    contractor: "Andrew Bell",
    contractorId: "f6894975-0de8-411c-8d1a-881e99ccd742",
    payment: {
      id: "98f09ee5-5747-4459-850e-f949f206b3fe",
      date: "2026-04-21",
      reference: "dct",
      amount: 900,
      messageId: "19db18ce0eb3685a",
    },
    invoices: [
      {
        id: "8e25d48d-bc96-4c82-a90a-b3e7f9bce30c",
        number: "FILE-AF38E8B5363A",
        amount: 900,
        messageId: "19d98b64ed8966d3",
      },
    ],
    note: "Exact invoice total. TD and EasyWeb identify Andrew Bell as the recipient.",
  },
  {
    contractor: "Angel Marcelo Cabrera",
    contractorId: "93b35206-dc2d-4604-9ba3-ff64d57b44b5",
    payment: {
      id: "e0a5a1f0-41cc-4856-a4b7-5f7a7c5bfbb8",
      date: "2026-03-24",
      reference: "gWF",
      amount: 1575,
    },
    invoices: [
      {
        id: "ed019a02-ff35-428d-8466-b0450f286698",
        number: "6",
        amount: 1575,
      },
    ],
    note: "Exact invoice total one day after issue. EasyWeb identifies Marcelo Cabrera as the recipient.",
  },
  {
    contractor: "Curb Appeal Pro Wash",
    contractorId: "57aea7f4-fc95-4be1-adc2-1a4b97209821",
    payment: {
      id: "13f39c54-5f94-4256-aac1-17ca33373178",
      date: "2026-06-22",
      reference: "thB",
      amount: 440,
      messageId: "19ee4e3cbfdd0a3a",
      category: "Pressure washing",
    },
    invoices: [
      {
        id: "43e526bb-d915-401e-a25f-ff0e0b9ec2ae",
        number: "1375",
        amount: 90,
      },
      {
        id: "87af7349-6936-4a88-9833-c9e927023356",
        number: "1376",
        amount: 150,
      },
      {
        id: "30ee0dcf-2e47-4262-aadf-079bd80928ca",
        number: "1377",
        amount: 200,
      },
    ],
    note: "Unique same-date invoice group: $90.00 plus $150.00 plus $200.00 equals the $440.00 transfer. TD confirms the transfer was deposited.",
  },
  {
    contractor: "Goulet Contracting & Painting Inc.",
    contractorId: "56e843df-d962-41a1-a6cc-c7e96f9b93e4",
    payment: {
      id: "826b4650-405d-4361-8b99-27d00b31a669",
      date: "2025-10-21",
      reference: "3Vy",
      amount: 9150.74,
    },
    invoices: [
      {
        id: "60056524-83a3-4480-a685-e59ef03ed974",
        number: "INV-000197",
        amount: 9150.74,
      },
    ],
    note: "Exact total of the revised October 20 invoice, paid the following day. Recipient is confirmed by the reconciled bank record.",
  },
  {
    contractor: "Mas Reno",
    contractorId: "63c7140f-1ba2-4e81-b3e4-6144398a59e0",
    payment: {
      id: "3cee8024-1af7-41bf-b0c1-8adbedf59a6f",
      date: "2026-02-02",
      reference: "qgg",
      amount: 1221,
      messageId: "19c2039232197797",
    },
    invoices: [
      {
        id: "bc643df1-5aec-4ef3-85c8-03d816006d76",
        number: "012223",
        amount: 1221,
      },
    ],
    note: "Exact invoice total. TD confirms the transfer to the verified Mas Reno recipient was deposited.",
  },
  {
    contractor: "Mas Reno",
    contractorId: "63c7140f-1ba2-4e81-b3e4-6144398a59e0",
    payment: {
      id: "79cb01ac-87d3-4d7d-aa3c-f3369171b0cb",
      date: "2026-02-02",
      reference: "hK3",
      amount: 897.5,
    },
    invoices: [
      {
        id: "03b1ecdf-538f-4d6c-9802-31c7c280e1e4",
        number: "012224",
        amount: 897.5,
      },
    ],
    note: "Exact invoice total. Bank recipient evidence confirms this payment belongs to Mas Reno.",
  },
  {
    contractor: "Niels Aschengreen",
    contractorId: "5e17283e-2bde-4f76-8ed3-c8b24edf6146",
    payment: {
      id: "c53ff1a8-953c-4031-aa37-ceb336f4ddeb",
      date: "2026-03-09",
      reference: "vbH",
      amount: 672,
      messageId: "19ccdf702a7cf620",
    },
    invoices: [
      {
        id: "8452ba47-f0e0-4760-9437-0287ebf93843",
        number: "20260306",
        amount: 672,
      },
    ],
    note: "Exact invoice total. TD and EasyWeb identify Nils Aschengreen as the recipient.",
  },
  {
    contractor: "Niels Aschengreen",
    contractorId: "5e17283e-2bde-4f76-8ed3-c8b24edf6146",
    payment: {
      id: "9e335ebf-ddac-4660-ad9b-0b6c5a8842b5",
      date: "2026-03-11",
      reference: "ENe",
      amount: 459,
    },
    invoices: [
      {
        id: "b0d48498-0bff-4269-8aee-df4ab4a8b0d8",
        number: "20260311",
        amount: 459,
      },
    ],
    note: "Exact same-day invoice total. Bank recipient evidence confirms this payment belongs to Niels Aschengreen.",
  },
  {
    contractor: "Phillip Hyde",
    contractorId: "a30d8df6-8f46-4069-b4af-6061c43b1cd6",
    payment: {
      id: "441e10fa-9916-4c60-bdb8-24e220fa730f",
      date: "2025-09-02",
      reference: "FJm",
      amount: 2679,
    },
    invoices: [
      {
        id: "c5ea6d68-6c64-45ba-89e5-a6cfa7b9257c",
        number: "INV-000005",
        amount: 51,
      },
      {
        id: "4e5c3977-c483-4cd8-b073-e6ad67cbb629",
        number: "INV-000006",
        amount: 49.5,
      },
      {
        id: "ded41e90-b9a4-4215-9930-5f9e97f4da96",
        number: "INV-000007",
        amount: 1065,
      },
      {
        id: "2c2eefb8-18cd-4004-9b87-c417a69bc160",
        number: "INV-000008",
        amount: 129,
      },
      {
        id: "2d9a4ee9-f047-40af-9d68-e1e4cc526929",
        number: "INV-000009",
        amount: 1384.5,
      },
    ],
    note: "Unique August 29 invoice group: five invoice totals sum exactly to the September 2 transfer. Recipient is confirmed by the reconciled bank record.",
  },
  {
    contractor: "Phillip Hyde",
    contractorId: "a30d8df6-8f46-4069-b4af-6061c43b1cd6",
    payment: {
      id: "846c913c-2489-49da-b2f9-24dbc44725c4",
      date: "2025-10-27",
      reference: "Bha",
      amount: 2662.3,
    },
    invoices: [
      {
        id: "439e36d1-2053-45ac-b277-c9f69c0b0566",
        number: "INV-000012",
        amount: 2662.3,
      },
    ],
    note: "Exact invoice total paid three days after issue. Recipient is confirmed by the reconciled bank record.",
  },
  {
    contractor: "Phillip Hyde",
    contractorId: "a30d8df6-8f46-4069-b4af-6061c43b1cd6",
    payment: {
      id: "3e88b200-10bf-44f1-9bfc-20d831a28732",
      date: "2025-12-19",
      reference: "zzU",
      amount: 917.34,
      messageId: "19b382746ebe5890",
    },
    invoices: [
      {
        id: "b5e82787-cd6c-4918-b6df-5aad0b430481",
        number: "INV-000013",
        amount: 917.34,
      },
    ],
    note: "Exact invoice total paid four days after issue. TD confirms the payment was deposited.",
  },
  {
    contractor: "PixReno Construction Inc.",
    contractorId: "cb755f5e-724d-4ffd-8b42-ca4edcc5226a",
    payment: {
      id: "647520fd-ad7d-4646-84f9-8c2abdd87d4d",
      date: "2026-04-17",
      reference: "zcF",
      amount: 339,
    },
    invoices: [
      {
        id: "2e68bd50-4a26-4b5a-a26b-3077fe63066b",
        number: "1023",
        amount: 339,
      },
    ],
    note: "Exact invoice total paid the following day. Bank recipient evidence confirms PixReno.",
  },
  {
    contractor: "PixReno Construction Inc.",
    contractorId: "cb755f5e-724d-4ffd-8b42-ca4edcc5226a",
    payment: {
      id: "93a10501-6989-4b39-b8a5-c2b297c7d7ef",
      date: "2026-05-01",
      reference: "HH4",
      amount: 1005.7,
    },
    invoices: [
      {
        id: "3c75ec20-b88e-4588-bc47-0638282e8d6a",
        number: "1024",
        amount: 779.7,
      },
      {
        id: "123e6e41-52e6-4c2a-b156-b624d4125ef7",
        number: "1025",
        amount: 226,
      },
    ],
    note: "Unique invoice group: $779.70 plus $226.00 equals the $1,005.70 transfer. Bank recipient evidence confirms PixReno.",
  },
  {
    contractor: "PixReno Construction Inc.",
    contractorId: "cb755f5e-724d-4ffd-8b42-ca4edcc5226a",
    payment: {
      id: "26251a01-9f1d-4e0e-8f93-3a26e0c516c5",
      date: "2026-05-01",
      reference: "PsD",
      amount: 525.45,
      messageId: "19de6385165352fc",
    },
    invoices: [
      {
        id: "251b9b82-0de3-4909-b6da-55ac1b72f6eb",
        number: "1026",
        amount: 525.45,
        messageId: "19de08d55442f52b",
      },
    ],
    note: "Exact invoice total. TD confirms the transfer to the verified PixReno recipient was deposited.",
  },
  {
    contractor: "PixReno Construction Inc.",
    contractorId: "cb755f5e-724d-4ffd-8b42-ca4edcc5226a",
    payment: {
      id: "e74565f0-1466-49c8-a456-48731c5bb276",
      date: "2026-05-15",
      reference: "YMP",
      amount: 572.91,
    },
    invoices: [
      {
        id: "57502cd4-85e6-4d4e-8e7c-53ef4874573d",
        number: "1027",
        amount: 572.91,
      },
    ],
    note: "Exact invoice total. Bank recipient evidence confirms PixReno.",
  },
  {
    contractor: "Polaris Painters",
    contractorId: "c5e12a25-2f40-4c05-af51-4f9f8401b573",
    payment: {
      id: "6c1c1745-4bc9-48c6-ba23-0a4d4cd2b35e",
      date: "2025-10-29",
      reference: "acb",
      amount: 1400,
    },
    invoices: [
      {
        id: "1d957eb4-32d3-42b9-80bf-c1e74f4d050c",
        number: "42",
        amount: 1400,
      },
    ],
    note: "Exact same-day invoice total. Recipient is confirmed by the reconciled bank record.",
  },
  {
    contractor: "Polaris Painters",
    contractorId: "c5e12a25-2f40-4c05-af51-4f9f8401b573",
    payment: {
      id: "7f2edbea-3955-4be0-9dcb-c58103cae244",
      date: "2025-11-07",
      reference: "xMw",
      amount: 900,
      messageId: "19a601898d62ad0d",
    },
    invoices: [
      {
        id: "4929d6a1-70bc-417b-b0c3-3e80a5d0565b",
        number: "43",
        amount: 900,
      },
    ],
    note: "Exact invoice total paid two days after issue. TD confirms the payment was deposited.",
  },
  {
    contractor: "Polaris Painters",
    contractorId: "c5e12a25-2f40-4c05-af51-4f9f8401b573",
    payment: {
      id: "247e9771-51b9-49e1-9886-58ba0c1a3934",
      date: "2025-11-21",
      reference: "ThR",
      amount: 2150,
    },
    invoices: [
      {
        id: "eb21c723-6ca6-4136-adfa-4a9324ae58be",
        number: "45",
        amount: 2150,
      },
    ],
    note: "Exact invoice total paid the following day. Recipient is confirmed by the reconciled bank record.",
  },
  {
    contractor: "Polaris Painters",
    contractorId: "c5e12a25-2f40-4c05-af51-4f9f8401b573",
    payment: {
      id: "d7ac38de-818e-4697-99a7-a82ab72856ff",
      date: "2026-01-26",
      reference: "cCP",
      amount: 500,
      messageId: "19bfc37c1494df44",
    },
    invoices: [
      {
        id: "2d48ff2d-e359-4f49-b57c-2620f8cf08cb",
        number: "52",
        amount: 500,
      },
    ],
    note: "Exact invoice total paid the following day. TD confirms the payment to Polaris was deposited.",
  },
  {
    contractor: "Done Right Handyman Services",
    contractorId: "2c4020a8-2997-48b3-bade-719a67392a6c",
    payment: {
      id: "1d6b1561-53d8-4d36-b1ec-51d3d2514ff0",
      date: "2026-04-28",
      reference: "hqC",
      amount: 169.5,
    },
    invoices: [
      {
        id: "a1aa0428-7e53-41b0-86a7-e5eb5529bf6d",
        number: "260048",
        amount: 169.5,
      },
    ],
    note: "Exact same-day after-HST invoice total. EasyWeb identifies the Done Right recipient and confirms the transfer was deposited.",
  },
  {
    contractor: "Loli Taping",
    contractorId: "269668cf-4ba5-438f-b70b-7d6ac74cd7e3",
    payment: {
      id: "5fae6b94-0d44-4a24-9a37-e8f68df41f97",
      date: "2026-05-25",
      reference: "xGz",
      amount: 4983.3,
    },
    invoices: [
      {
        id: "5248f404-0db7-4cb6-86a9-8061f2b60e80",
        number: "1000065",
        amount: 4983.3,
      },
    ],
    note: "Exact after-HST invoice total. EasyWeb identifies LOLI TAPING as the recipient and confirms autodeposit.",
  },
  {
    contractor: "Perfect Strokes Painting Inc.",
    contractorId: "6436310d-bfe5-4aae-800d-d9b43652013e",
    payment: {
      id: "6a9f87b5-3b2c-4159-85dc-c2b1bdbc0eae",
      date: "2026-05-25",
      reference: "24S",
      amount: 5181.05,
    },
    invoices: [
      {
        id: "31a6e624-90b4-4429-bada-f24380287ac1",
        number: "118",
        amount: 5181.05,
      },
    ],
    note: "Exact after-HST invoice total. EasyWeb identifies PERFECT STROKES PAINTING INC. as the recipient and confirms autodeposit.",
  },
  {
    contractor: "Scott Bertin",
    contractorId: "3dd4a438-a5e5-47c0-9098-4ed640657855",
    payment: {
      id: "bfc4f8eb-e358-4e32-8491-f3b8b288f2e1",
      date: "2026-03-25",
      reference: "74S",
      amount: 1980,
    },
    invoices: [
      {
        id: "e7acae64-3dfd-4b3a-8571-a7e805ae933d",
        number: "1",
        amount: 1980,
      },
    ],
    note: "Exact same-day invoice total. EasyWeb identifies Scott Painter as the recipient and confirms autodeposit.",
  },
  {
    contractor: "Abdellah Aouf",
    contractorId: "27ce42af-0c13-4313-92e8-e088dfa05bdd",
    payment: {
      id: "ca76006b-0255-4263-a056-6965ea0e7558",
      date: "2026-02-02",
      reference: "uK5",
      amount: 2900,
      messageId: "19c1ae9961a90b69",
    },
    invoices: [
      {
        id: "28e83673-497a-4f2b-8d6d-e453035a311d",
        number: "20260128",
        amount: 2900,
        messageId: "19c17d49e1cd4e72",
      },
    ],
    note: "Exact corrected invoice total. TD confirms the payment to Abdellah Aouf was deposited.",
  },
  {
    contractor: "Abdellah Aouf",
    contractorId: "27ce42af-0c13-4313-92e8-e088dfa05bdd",
    payment: {
      id: "52ce929a-ff78-4402-885b-b6bbb28ca153",
      date: "2026-02-23",
      reference: "hsW",
      amount: 800,
      messageId: "19c83b4f20964278",
    },
    invoices: [
      {
        id: "85e14dec-3d16-47a9-bb16-e4cc59bfe1de",
        number: "INV-20260128-001",
        amount: 800,
        messageId: "19c78e91194bac95",
      },
    ],
    note: "Exact invoice total. The invoice contains distinct February jobs, and TD confirms the payment to Abdellah Aouf was deposited.",
  },
  {
    contractor: "Abdellah Aouf",
    contractorId: "27ce42af-0c13-4313-92e8-e088dfa05bdd",
    payment: {
      id: "d78d56d6-b5c9-46b4-8469-41c1fbf699a1",
      date: "2026-03-06",
      reference: "gZQ",
      amount: 950,
    },
    invoices: [
      {
        id: "0f2fff9f-b026-44b0-aca2-e471a5de8981",
        number: "INV-20260302-001",
        amount: 950,
      },
    ],
    note: "Exact invoice total three days after issue. EasyWeb confirms the verified Abdellah recipient.",
  },
  {
    contractor: "Abdellah Aouf",
    contractorId: "27ce42af-0c13-4313-92e8-e088dfa05bdd",
    payment: {
      id: "86725a13-2ffc-49a7-aaa1-38bfd73e60e4",
      date: "2026-03-18",
      reference: "akH",
      amount: 912.59,
    },
    invoices: [
      {
        id: "8a7a7aa3-1dfd-495b-b250-d96cecc1c045",
        number: "INV-20260316-001",
        amount: 912.59,
      },
    ],
    note: "Exact invoice total two days after issue. EasyWeb confirms the verified Abdellah recipient.",
  },
  {
    contractor: "Abdellah Aouf",
    contractorId: "27ce42af-0c13-4313-92e8-e088dfa05bdd",
    payment: {
      id: "02f952fe-b004-423f-9c04-24e3ef86d5a7",
      date: "2026-03-25",
      reference: "qGb",
      amount: 225,
    },
    invoices: [
      {
        id: "fd051e3e-7628-4e64-8787-37f6105547ba",
        number: "INV-20260306-004",
        amount: 225,
      },
    ],
    note: "Exact same-day invoice total. EasyWeb confirms the verified Abdellah recipient.",
  },
  {
    contractor: "Abdellah Aouf",
    contractorId: "27ce42af-0c13-4313-92e8-e088dfa05bdd",
    payment: {
      id: "f1a9779a-6b3d-42ff-82ac-2574bc0632db",
      date: "2026-03-30",
      reference: "Bta",
      amount: 1100,
    },
    invoices: [
      {
        id: "5bd22e6c-e7eb-4d27-80c4-c7a0a7336e0e",
        number: "INV-20260328-001",
        amount: 1100,
      },
    ],
    note: "Exact invoice total two days after issue. EasyWeb confirms the verified Abdellah recipient.",
  },
  {
    contractor: "Abdellah Aouf",
    contractorId: "27ce42af-0c13-4313-92e8-e088dfa05bdd",
    payment: {
      id: "344bc55f-43ea-4742-ac89-3db49985b9ed",
      date: "2026-04-07",
      reference: "zDX",
      amount: 200,
    },
    invoices: [
      {
        id: "411be2c7-216b-492c-876d-cb33c98d30aa",
        number: "INV-20260403-001",
        amount: 200,
      },
    ],
    methods: [
      "verified_contractor_identity",
      "same_day_equal_amount_set",
      "bank_record",
    ],
    note: "One of two same-day $200.00 Abdellah transfers covering the two same-day $200.00 invoices. The individual references are interchangeable; the paired set is exact.",
  },
  {
    contractor: "Abdellah Aouf",
    contractorId: "27ce42af-0c13-4313-92e8-e088dfa05bdd",
    payment: {
      id: "40079dea-310e-4e98-a09c-1744110f2f8b",
      date: "2026-04-07",
      reference: "8fd",
      amount: 200,
    },
    invoices: [
      {
        id: "12ec07d9-7ab5-4606-8959-20962ec89916",
        number: "INV-20260407-005",
        amount: 200,
      },
    ],
    methods: [
      "verified_contractor_identity",
      "same_day_equal_amount_set",
      "bank_record",
    ],
    note: "One of two same-day $200.00 Abdellah transfers covering the two same-day $200.00 invoices. The individual references are interchangeable; the paired set is exact.",
  },
  {
    contractor: "Abdellah Aouf",
    contractorId: "27ce42af-0c13-4313-92e8-e088dfa05bdd",
    payment: {
      id: "c2d2b135-5439-47ea-b4dd-ae510eed08cc",
      date: "2026-04-07",
      reference: "3UU",
      amount: 237.5,
    },
    invoices: [
      {
        id: "3d418c23-bd5e-4f8e-84f6-5be1c6a46a05",
        number: "INV-20260407-006",
        amount: 237.5,
      },
    ],
    note: "Exact same-day invoice total. EasyWeb confirms the verified Abdellah recipient.",
  },
  {
    contractor: "Abdellah Aouf",
    contractorId: "27ce42af-0c13-4313-92e8-e088dfa05bdd",
    payment: {
      id: "de06b6db-894c-4413-88ee-099312e42dcd",
      date: "2026-04-28",
      reference: "BjU",
      amount: 558.99,
    },
    invoices: [
      {
        id: "c70e4a48-088d-4d1d-b881-f85a33cb1191",
        number: "INV-20260424-001",
        amount: 558.99,
      },
    ],
    note: "Exact invoice total four days after issue. EasyWeb confirms the verified Abdellah recipient.",
  },
  {
    contractor: "Abdellah Aouf",
    contractorId: "27ce42af-0c13-4313-92e8-e088dfa05bdd",
    payment: {
      id: "e5660641-3aa5-445c-a234-62a2282079a9",
      date: "2026-06-15",
      reference: "yJ8",
      amount: 216,
    },
    invoices: [
      {
        id: "765c57be-2d5b-48ee-b410-aa1f8036e59d",
        number: "INV-20260612-001",
        amount: 216,
      },
    ],
    note: "Exact invoice total three days after issue. EasyWeb confirms the verified Abdellah recipient.",
  },
  {
    contractor: "Abdellah Aouf",
    contractorId: "27ce42af-0c13-4313-92e8-e088dfa05bdd",
    payment: {
      id: "53a0c78a-9d80-4c4f-8fd3-1a6467a8fc6d",
      date: "2026-06-18",
      reference: "q3d",
      amount: 624,
    },
    invoices: [
      {
        id: "3e47a6ae-ce29-40b7-92c9-f2fde8355bca",
        number: "INV-20260615-001",
        amount: 520,
        messageId: "19ecdaa903c23fa5",
      },
      {
        id: "d771062d-e2d5-41c3-9645-e079eec1461f",
        number: "INV-20260615-001",
        amount: 104,
        messageId: "19ecda68cd1d5344",
      },
    ],
    note: "The distinct Donna Quigley and Danielle Hards invoice emails total exactly $624.00. EasyWeb confirms the verified Abdellah recipient.",
  },
  {
    contractor: "AMG Service Construction",
    contractorId: "532d06b9-eb55-49cf-b8a5-88623da5b118",
    payment: {
      id: "84d430de-bfd0-4957-84f6-da5be473c8aa",
      date: "2026-05-26",
      reference: "GKH",
      amount: 3000,
      messageId: "19e6663e2d98878c",
    },
    invoices: [
      {
        id: "82e7b902-1446-4d4c-926d-ffecce87b009",
        number: "108",
        gross: 5364.19,
        allocation: 3000,
      },
    ],
    methods: [
      "verified_contractor_identity",
      "partial_invoice_payment",
      "exact_split_payment_sum",
      "td_payment_confirmation",
      "bank_record",
    ],
    note: "First payment toward the final AMG invoice #108. Together with Tjv, the two transfers equal the corrected $5,364.19 invoice total.",
  },
  {
    contractor: "AMG Service Construction",
    contractorId: "532d06b9-eb55-49cf-b8a5-88623da5b118",
    payment: {
      id: "40bb2174-6208-45af-bd0c-fb3d09169a2b",
      date: "2026-05-29",
      reference: "Tjv",
      amount: 2364.19,
    },
    invoices: [
      {
        id: "82e7b902-1446-4d4c-926d-ffecce87b009",
        number: "108",
        gross: 5364.19,
        allocation: 2364.19,
      },
    ],
    methods: [
      "verified_contractor_identity",
      "invoice_balance_payment",
      "exact_split_payment_sum",
      "bank_record",
    ],
    note: "Balance payment for the final AMG invoice #108. Together with GKH, the two transfers equal the corrected $5,364.19 invoice total.",
  },
  {
    contractor: "AMG Service Construction",
    contractorId: "532d06b9-eb55-49cf-b8a5-88623da5b118",
    payment: {
      id: "461aa0b7-b834-498c-b31f-b78f80961ef7",
      date: "2026-06-05",
      reference: "dBf",
      amount: 1250.75,
    },
    invoices: [
      {
        id: "097114d3-d3f0-4cc0-8543-43260d704a16",
        number: "109",
        amount: 1250.75,
        messageId: "19e8e7a1da3f4a49",
      },
    ],
    note: "Exact corrected invoice total. AMG explicitly identified this version as replacing the wrong earlier #109 invoice.",
  },
  {
    contractor: "Grutenco Painting & Construction Services",
    contractorId: "f3414a57-3a53-47b8-9f25-24be03fbca1c",
    payment: {
      id: "00d06df8-3c7f-4dcc-9029-a29c31f0bc0a",
      date: "2026-05-25",
      reference: "8xR",
      amount: 4734.8,
      messageId: "19e624da6bc02606",
    },
    invoices: [
      {
        id: "020c8a4f-fd4c-43b6-a093-d49f87c465f5",
        number: "GT-INV-202605-01",
        amount: 4734.8,
        messageId: "19e55d42c90c1a42",
      },
    ],
    note: "Exact invoice total. Gmail and TD confirm the Grutenco invoice and deposited transfer.",
  },
  {
    contractor: "Grutenco Painting & Construction Services",
    contractorId: "f3414a57-3a53-47b8-9f25-24be03fbca1c",
    payment: {
      id: "a237b5dc-5fd4-4fcb-bdb6-36cb771c81ed",
      date: "2026-06-05",
      reference: "RS9",
      amount: 3090.55,
      messageId: "19e985d07f59785d",
    },
    invoices: [
      {
        id: "d1e8836c-95ed-44dc-b579-eb9de4234266",
        number: "GT-INV-202606-01",
        amount: 3090.55,
        messageId: "19e88bcac6eb8e4b",
      },
    ],
    note: "Exact invoice total. Gmail and TD confirm the Grutenco invoice and deposited transfer.",
  },
  {
    contractor: "Grutenco Painting & Construction Services",
    contractorId: "f3414a57-3a53-47b8-9f25-24be03fbca1c",
    payment: {
      id: "e5b6869d-a66c-4eac-89e0-7666fd50fc06",
      date: "2026-06-22",
      reference: "rpk",
      amount: 2500,
      messageId: "19ee5650f3b36c03",
    },
    invoices: [
      {
        id: "3df9b131-ac2b-4874-b61b-6f515b60f780",
        number: "GT-INV-202606-02",
        gross: 5085,
        allocation: 2500,
        messageId: "19ec3a7144103c9a",
      },
    ],
    methods: [
      "verified_contractor_identity",
      "partial_invoice_payment",
      "supplier_payment_receipt",
      "td_payment_confirmation",
      "bank_record",
    ],
    note: "Grutenco issued a partial-payment receipt for $2,500.00 against Kirsty Harris invoice GT-INV-202606-02; Gmail message 19ee57080000313a.",
  },
  {
    contractor: "Grutenco Painting & Construction Services",
    contractorId: "f3414a57-3a53-47b8-9f25-24be03fbca1c",
    payment: {
      id: "721f4571-36ed-4709-b887-d3dbe1017322",
      date: "2026-07-02",
      reference: "DgV",
      amount: 996.13,
      messageId: "19f1e713a72b3652",
    },
    invoices: [
      {
        id: "d1266895-85f3-4ce7-a4fe-a0646f8347ba",
        number: "GT-INV-202606-04",
        amount: 996.13,
        messageId: "19f101a999f1ee94",
      },
    ],
    note: "Exact invoice total. Gmail and TD confirm the Grutenco invoice and deposited transfer.",
  },
  {
    contractor: "Grutenco Painting & Construction Services",
    contractorId: "f3414a57-3a53-47b8-9f25-24be03fbca1c",
    payment: {
      id: "bc3c6d45-1b54-4d90-b57b-d5ae761878a0",
      date: "2026-07-08",
      reference: "Nym",
      amount: 565,
      messageId: "19f42b1ab9327cbc",
    },
    invoices: [
      {
        id: "e3e3a613-4604-4e32-99a3-c0c351ed13f7",
        number: "GT-INV-202607-01",
        amount: 565,
        messageId: "19f3d9399d4c07b4",
      },
    ],
    note: "Exact invoice total. Gmail and TD confirm the Grutenco invoice and deposited transfer.",
  },
  {
    contractor: "Grutenco Painting & Construction Services",
    contractorId: "f3414a57-3a53-47b8-9f25-24be03fbca1c",
    payment: {
      id: "5d66dc4d-e782-4eee-bd22-35c1765e686a",
      date: "2026-07-13",
      reference: "HDz",
      amount: 2585,
      messageId: "19f5d3ce187e96ea",
    },
    invoices: [
      {
        id: "3df9b131-ac2b-4874-b61b-6f515b60f780",
        number: "GT-INV-202606-02",
        gross: 5085,
        allocation: 2585,
        messageId: "19ec3a7144103c9a",
      },
    ],
    methods: [
      "verified_contractor_identity",
      "invoice_balance_payment",
      "supplier_payment_receipt",
      "td_payment_confirmation",
      "bank_record",
    ],
    note: "Grutenco's reminder states a $2,585.00 remaining balance on GT-INV-202606-02, followed by its receipt confirming payment; Gmail messages 19f5d36f8a83126b and 19f5ed041f5f2959.",
  },
  {
    contractor: "Grutenco Painting & Construction Services",
    contractorId: "f3414a57-3a53-47b8-9f25-24be03fbca1c",
    payment: {
      id: "b2e8af02-c40e-4ffe-9a9b-5b74dc43c913",
      date: "2026-07-16",
      reference: "c84",
      amount: 1017,
      messageId: "19f6cfa5573a7624",
    },
    invoices: [
      {
        id: "bb9f879c-c63e-410d-bd88-d608185ca1e5",
        number: "GT-INV-202607-02",
        amount: 1017,
        messageId: "19f43162abd973cb",
      },
    ],
    note: "Exact invoice total. Gmail and TD confirm the Grutenco invoice and deposited transfer.",
  },
  {
    contractor: "Premium Coat",
    contractorId: "4b5d875c-11da-4d30-8a47-ef5039bab014",
    payment: {
      id: "0dd1c826-ffd7-4e53-9a08-76bc292ce601",
      date: "2026-04-27",
      reference: "Jag",
      amount: 3600,
    },
    invoices: [
      {
        id: "dbb826cd-2ce8-49ad-83ec-e8ddcb9aa6f9",
        number: "FM-158",
        amount: 3600,
      },
    ],
    note: "Exact same-day invoice total. EasyWeb identifies Francisco Premium Coat as the recipient.",
  },
  {
    contractor: "Premium Coat",
    contractorId: "4b5d875c-11da-4d30-8a47-ef5039bab014",
    payment: {
      id: "9320b20a-7b28-4f5f-9b97-c2ec0fe9f549",
      date: "2026-04-27",
      reference: "Z6A",
      amount: 2935.3,
    },
    invoices: [
      {
        id: "a2482f34-a573-479f-8be5-ee381c2326ec",
        number: "FM-155",
        amount: 1810.95,
      },
      {
        id: "070d092b-b043-4baa-8c83-e097c4d67c99",
        number: "FM-156",
        amount: 678,
      },
      {
        id: "4d7dfb73-7cfb-47bc-913d-71911230c832",
        number: "FM-157",
        amount: 446.35,
      },
    ],
    note: "Unique April 25 invoice group: $1,810.95 plus $678.00 plus $446.35 equals the $2,935.30 transfer. EasyWeb confirms Premium Coat.",
  },
  {
    contractor: "Premium Coat",
    contractorId: "4b5d875c-11da-4d30-8a47-ef5039bab014",
    payment: {
      id: "3b1772b3-d979-491e-afcb-cd828b10724f",
      date: "2026-06-01",
      reference: "Ysm",
      amount: 2131.82,
    },
    invoices: [
      {
        id: "e8cb4cc5-2610-4385-aa3d-1d64cc4c552d",
        number: "FM-171",
        amount: 2131.82,
        messageId: "19e7a57a2a98f36f",
      },
    ],
    note: "Exact adjusted invoice total. Premium Coat explicitly sent the $2,131.82 FM-171 as the adjusted version, and EasyWeb confirms the recipient.",
  },
  {
    contractor: "Angel Marcelo Cabrera",
    contractorId: "93b35206-dc2d-4604-9ba3-ff64d57b44b5",
    payment: {
      id: "9c62b462-f123-461f-91dd-8621be07f29e",
      date: "2026-02-10",
      reference: "Rwg",
      description: "SEND E-TFR *Rwg EPAY",
      amount: 250,
      messageId: "19c4a3830d5f8220",
    },
    invoices: [
      {
        id: "33670fa6-3a8a-43bc-be52-4a377dc20a7d",
        number: "1",
        amount: 250,
      },
    ],
    note: "Exact invoice total. TD confirms the payment to Marcelo Cabrera was deposited.",
  },
  {
    contractor: "Angel Marcelo Cabrera",
    contractorId: "93b35206-dc2d-4604-9ba3-ff64d57b44b5",
    payment: {
      id: "ec141944-2d5f-483f-ae17-0f8213088c4e",
      date: "2026-03-02",
      reference: "54f",
      amount: 1728,
    },
    invoices: [
      {
        id: "f62d842d-9099-4b51-bea8-6f71cea2b2d0",
        number: "3",
        amount: 1728,
        messageId: "19caf8df6df780c5",
      },
    ],
    note: "Exact invoice total. The separate hours attachment is retained as supporting evidence, not a second invoice.",
  },
  {
    contractor: "Angel Marcelo Cabrera",
    contractorId: "93b35206-dc2d-4604-9ba3-ff64d57b44b5",
    payment: {
      id: "a7533fc1-5054-47c4-9802-74f267cb2e1b",
      date: "2026-03-09",
      reference: "A5n",
      amount: 1275,
      messageId: "19ccdf483110ad2c",
    },
    invoices: [
      {
        id: "a4b6583a-9a07-48e9-974e-3a4532452b35",
        number: "3",
        amount: 1275,
        messageId: "19cc3af2678182e2",
      },
    ],
    note: "Exact distinct invoice total. TD confirms the payment to Angel Cabrera was deposited.",
  },
  {
    contractor: "Angel Marcelo Cabrera",
    contractorId: "93b35206-dc2d-4604-9ba3-ff64d57b44b5",
    payment: {
      id: "badd945f-8ab1-4983-8836-b1b399898168",
      date: "2026-03-11",
      reference: "4zx",
      amount: 646.88,
      messageId: "19cde65d5c5ded70",
    },
    invoices: [
      {
        id: "1c2a6b4c-ce17-46b9-b2c1-d7781c87d33f",
        number: "3",
        amount: 646.88,
        messageId: "19cdddbd15e9696f",
      },
    ],
    note: "Exact distinct invoice total. TD confirms the payment to Angel Cabrera was deposited.",
  },
  {
    contractor: "Angel Marcelo Cabrera",
    contractorId: "93b35206-dc2d-4604-9ba3-ff64d57b44b5",
    payment: {
      id: "61cfe664-090e-4d7c-a748-35c68eb0428d",
      date: "2026-03-18",
      reference: "JmV",
      amount: 975,
      messageId: "19d011c1ffc7f266",
    },
    invoices: [
      {
        id: "db85a496-ed83-4a6e-b29c-2ad66173053d",
        number: "5",
        amount: 975,
        messageId: "19cf6cd4d040bbbb",
      },
    ],
    note: "Exact invoice total. TD confirms the payment to Angel Cabrera was deposited.",
  },
  {
    contractor: "Angel Marcelo Cabrera",
    contractorId: "93b35206-dc2d-4604-9ba3-ff64d57b44b5",
    payment: {
      id: "ab6bf0c7-3199-4e7a-b324-2331e10ba6c7",
      date: "2026-04-01",
      reference: "66Z",
      amount: 1987.5,
      messageId: "19d4a4c2956319f6",
    },
    invoices: [
      {
        id: "74f5b2cc-1bb6-4287-b3e3-dd1df27cb231",
        number: "7",
        amount: 1987.5,
        messageId: "19d4a4a268bad9b8",
      },
    ],
    note: "Exact invoice total. TD confirms the payment to Angel Cabrera was deposited.",
  },
  {
    contractor: "Angel Marcelo Cabrera",
    contractorId: "93b35206-dc2d-4604-9ba3-ff64d57b44b5",
    payment: {
      id: "e4085615-143a-4a5d-90d7-e061696a0afe",
      date: "2026-04-06",
      reference: "9HV",
      amount: 393.75,
      messageId: "19d53b62d477a92f",
    },
    invoices: [
      {
        id: "aea01958-952c-48f9-8d52-2f5674435611",
        number: "8",
        amount: 393.75,
        messageId: "19d4f78f47b644e0",
      },
    ],
    note: "Exact distinct invoice total. TD confirms the payment to Angel Cabrera was deposited.",
  },
  {
    contractor: "Angel Marcelo Cabrera",
    contractorId: "93b35206-dc2d-4604-9ba3-ff64d57b44b5",
    payment: {
      id: "c5b8a936-c838-49ba-b136-10c38abac555",
      date: "2026-04-10",
      reference: "kAu",
      amount: 843.75,
      messageId: "19d7924dc45e30d7",
    },
    invoices: [
      {
        id: "271c1090-287b-44ed-8975-52e7c82f0085",
        number: "11",
        amount: 843.75,
        messageId: "19d791f44f687e3f",
      },
    ],
    note: "Exact same-day invoice total. TD confirms the payment to Angel Cabrera was deposited.",
  },
  {
    contractor: "Angel Marcelo Cabrera",
    contractorId: "93b35206-dc2d-4604-9ba3-ff64d57b44b5",
    payment: {
      id: "0fd4d568-1a7e-4df7-897f-fd127cb15877",
      date: "2026-04-13",
      reference: "gPs",
      amount: 56.25,
      messageId: "19d875489ee43bba",
    },
    invoices: [
      {
        id: "34cc75f1-3925-4363-b56a-f2c6dbcde24a",
        number: "10",
        amount: 56.25,
        messageId: "19d7868d380a82de",
      },
    ],
    note: "Exact invoice total. TD confirms the payment to Angel Cabrera was deposited.",
  },
  {
    contractor: "Angel Marcelo Cabrera",
    contractorId: "93b35206-dc2d-4604-9ba3-ff64d57b44b5",
    payment: {
      id: "4cbd18ef-afa9-4040-a771-ac50ec6e2ffb",
      date: "2026-04-13",
      reference: "yyX",
      amount: 187.5,
      messageId: "19d8753f0c335ac6",
    },
    invoices: [
      {
        id: "71e3c85c-7beb-4d4b-9279-bdc6d82ae4ea",
        number: "8",
        amount: 187.5,
        messageId: "19d78664baf5ed8b",
      },
    ],
    note: "Exact distinct invoice total. TD confirms the payment to Angel Cabrera was deposited.",
  },
  {
    contractor: "Angel Marcelo Cabrera",
    contractorId: "93b35206-dc2d-4604-9ba3-ff64d57b44b5",
    payment: {
      id: "b5500fee-317b-49be-b17d-97c417733bf2",
      date: "2026-04-16",
      reference: "kRQ",
      amount: 768.75,
      messageId: "19d9688274c81219",
    },
    invoices: [
      {
        id: "06f7ff30-1bf7-4b84-91fa-2e92d9e3ded0",
        number: "9",
        amount: 431.25,
        messageId: "19d8971eecadffbb",
      },
      {
        id: "5c48ca4d-b926-482e-bccc-4ac4fc9ddd89",
        number: "9",
        amount: 337.5,
        messageId: "19d8e262cafb64ee",
      },
    ],
    note: "The two distinct Angel invoice #9 job invoices total exactly $768.75. TD confirms the deposited payment.",
  },
  {
    contractor: "Angel Marcelo Cabrera",
    contractorId: "93b35206-dc2d-4604-9ba3-ff64d57b44b5",
    payment: {
      id: "54c9f104-bb6f-4d85-a7d8-0684efbb50b9",
      date: "2026-04-20",
      reference: "kcu",
      amount: 881.88,
      messageId: "19da7cc72da2ff76",
    },
    invoices: [
      {
        id: "e1c11537-b52f-4bd6-be9a-081e677514da",
        number: "12",
        amount: 881.88,
        messageId: "19da11468b73878c",
      },
    ],
    note: "Exact invoice total. TD confirms the payment to Angel Cabrera was deposited.",
  },
  {
    contractor: "PaintTastic Pro Inc",
    contractorId: "730887dc-f2fa-4bb3-9a11-7acb03a59936",
    payment: {
      id: "852bf603-f3d9-479b-b1ec-0de9534a702a",
      date: "2025-10-07",
      reference: "TxZ",
      amount: 3000,
    },
    invoices: [
      {
        id: "56789374-5897-4e51-aa3b-52ec737bc016",
        number: "327949",
        gross: 16385,
        allocation: 3000,
      },
    ],
    methods: [
      "verified_contractor_identity",
      "partial_invoice_payment",
      "supplier_payment_receipt",
      "confirmation_suffix",
      "bank_record",
    ],
    note: "PaintTastic's invoice receipt lists the October 7 payment reference ending TxZ as a $3,000.00 payment against invoice #327949.",
  },
  {
    contractor: "PaintTastic Pro Inc",
    contractorId: "730887dc-f2fa-4bb3-9a11-7acb03a59936",
    payment: {
      id: "287a46e5-d37c-4ce1-8713-1d23ef97852d",
      date: "2025-10-09",
      reference: "FM5",
      amount: 3000,
    },
    invoices: [
      {
        id: "56789374-5897-4e51-aa3b-52ec737bc016",
        number: "327949",
        gross: 16385,
        allocation: 3000,
      },
    ],
    methods: [
      "verified_contractor_identity",
      "partial_invoice_payment",
      "supplier_payment_receipt",
      "confirmation_suffix",
      "bank_record",
    ],
    note: "PaintTastic's invoice receipt lists the October 9 payment reference ending FM5 as a $3,000.00 payment against invoice #327949.",
  },
  {
    contractor: "PaintTastic Pro Inc",
    contractorId: "730887dc-f2fa-4bb3-9a11-7acb03a59936",
    payment: {
      id: "5e8b31f4-7062-4388-834e-1a4b898be627",
      date: "2025-10-14",
      reference: "b8V",
      amount: 3000,
    },
    invoices: [
      {
        id: "56789374-5897-4e51-aa3b-52ec737bc016",
        number: "327949",
        gross: 16385,
        allocation: 3000,
      },
    ],
    methods: [
      "verified_contractor_identity",
      "partial_invoice_payment",
      "supplier_payment_receipt",
      "confirmation_suffix",
      "bank_record",
    ],
    note: "PaintTastic's invoice receipt lists the transfer reference ending b8V as a $3,000.00 payment against invoice #327949; the bank posted it after the weekend.",
  },
  {
    contractor: "PaintTastic Pro Inc",
    contractorId: "730887dc-f2fa-4bb3-9a11-7acb03a59936",
    payment: {
      id: "7b12cb93-685e-47b2-8ffb-548f47ce15d3",
      date: "2025-10-15",
      reference: "22f",
      amount: 3000,
    },
    invoices: [
      {
        id: "56789374-5897-4e51-aa3b-52ec737bc016",
        number: "327949",
        gross: 16385,
        allocation: 3000,
      },
    ],
    methods: [
      "verified_contractor_identity",
      "partial_invoice_payment",
      "supplier_payment_receipt",
      "confirmation_suffix",
      "bank_record",
    ],
    note: "PaintTastic's invoice receipt lists the October 15 payment reference ending 22f as a $3,000.00 payment against invoice #327949.",
  },
  {
    contractor: "PaintTastic Pro Inc",
    contractorId: "730887dc-f2fa-4bb3-9a11-7acb03a59936",
    payment: {
      id: "252fcfbb-528e-4be5-93b5-4613a0574fbb",
      date: "2025-10-16",
      reference: "pCb",
      amount: 3000,
    },
    invoices: [
      {
        id: "56789374-5897-4e51-aa3b-52ec737bc016",
        number: "327949",
        gross: 16385,
        allocation: 3000,
      },
    ],
    methods: [
      "verified_contractor_identity",
      "partial_invoice_payment",
      "supplier_payment_receipt",
      "confirmation_suffix",
      "bank_record",
    ],
    note: "PaintTastic's invoice receipt lists the October 16 payment reference ending pCb as a $3,000.00 payment against invoice #327949.",
  },
  {
    contractor: "PaintTastic Pro Inc",
    contractorId: "730887dc-f2fa-4bb3-9a11-7acb03a59936",
    payment: {
      id: "13e0fd10-612e-478c-8a9e-b28c883a9c94",
      date: "2025-10-29",
      reference: "GtA",
      amount: 1385,
    },
    invoices: [
      {
        id: "56789374-5897-4e51-aa3b-52ec737bc016",
        number: "327949",
        gross: 16385,
        allocation: 1385,
      },
    ],
    methods: [
      "verified_contractor_identity",
      "invoice_balance_payment",
      "exact_split_payment_sum",
      "bank_record",
    ],
    note: "Final $1,385.00 balance payment. Together with the five receipt-confirmed $3,000.00 installments, it exactly settles invoice #327949.",
  },
  {
    contractor: "Polaris Painters",
    contractorId: "c5e12a25-2f40-4c05-af51-4f9f8401b573",
    payment: {
      id: "284f85ff-9615-4fb9-8d75-761d4ea23be1",
      date: "2025-08-29",
      reference: "MGT",
      amount: 3000,
      messageId: "198f638fef058f7b",
    },
    invoices: [
      {
        id: "ebe71903-b56f-4664-8eef-c5680482730f",
        number: "41",
        gross: 5900,
        allocation: 3000,
      },
    ],
    methods: [
      "verified_contractor_identity",
      "invoice_deposit",
      "exact_split_payment_sum",
      "td_payment_confirmation",
      "bank_record",
    ],
    note: "First deposit toward Polaris invoice #41. Four verified Polaris transfers total exactly $5,900.00.",
  },
  {
    contractor: "Polaris Painters",
    contractorId: "c5e12a25-2f40-4c05-af51-4f9f8401b573",
    payment: {
      id: "b76d4617-43e1-4957-812a-ee7c20de41d9",
      date: "2025-09-08",
      reference: "GCz",
      amount: 1500,
      messageId: "199260583e6c2b4f",
    },
    invoices: [
      {
        id: "ebe71903-b56f-4664-8eef-c5680482730f",
        number: "41",
        gross: 5900,
        allocation: 1500,
      },
    ],
    methods: [
      "verified_contractor_identity",
      "invoice_deposit",
      "exact_split_payment_sum",
      "td_payment_confirmation",
      "bank_record",
    ],
    note: "Second deposit toward Polaris invoice #41. Four verified Polaris transfers total exactly $5,900.00.",
  },
  {
    contractor: "Polaris Painters",
    contractorId: "c5e12a25-2f40-4c05-af51-4f9f8401b573",
    payment: {
      id: "55569655-c1fd-4833-9dad-ed18bb97d324",
      date: "2025-10-08",
      reference: "rp7",
      amount: 1000,
      messageId: "199c4d102d38a8e9",
    },
    invoices: [
      {
        id: "ebe71903-b56f-4664-8eef-c5680482730f",
        number: "41",
        gross: 5900,
        allocation: 1000,
      },
    ],
    methods: [
      "verified_contractor_identity",
      "partial_invoice_payment",
      "exact_split_payment_sum",
      "td_payment_confirmation",
      "bank_record",
    ],
    note: "Third payment toward Polaris invoice #41, one day after issue. Four verified Polaris transfers total exactly $5,900.00.",
  },
  {
    contractor: "Polaris Painters",
    contractorId: "c5e12a25-2f40-4c05-af51-4f9f8401b573",
    payment: {
      id: "ae1eafe0-2583-4ab9-82b8-486499077efb",
      date: "2025-10-09",
      reference: "m9F",
      amount: 400,
      messageId: "199c950816c87f69",
    },
    invoices: [
      {
        id: "ebe71903-b56f-4664-8eef-c5680482730f",
        number: "41",
        gross: 5900,
        allocation: 400,
      },
    ],
    methods: [
      "verified_contractor_identity",
      "invoice_balance_payment",
      "exact_split_payment_sum",
      "td_payment_confirmation",
      "bank_record",
    ],
    note: "Final payment toward Polaris invoice #41. Four verified Polaris transfers total exactly $5,900.00.",
  },
  {
    contractor: "Polaris Painters",
    contractorId: "c5e12a25-2f40-4c05-af51-4f9f8401b573",
    payment: {
      id: "9269d583-ec4f-4ee9-9166-87a2cdfd6ffc",
      date: "2025-12-04",
      reference: "ynu",
      amount: 1650,
      messageId: "19aeb76c38a7b3c5",
    },
    invoices: [
      {
        id: "076f7f84-9073-4cee-9b9a-75b9cd0fe845",
        number: "46",
        amount: 650,
      },
      {
        id: "40ad6ba7-fd53-4d2a-8169-82d8610c2441",
        number: "47",
        amount: 1000,
      },
    ],
    methods: [
      "verified_contractor_identity",
      "unique_exact_near_date_invoice_sum",
      "td_payment_confirmation",
      "bank_record",
    ],
    note: "The $650.00 and $1,000.00 Polaris invoices uniquely sum to the verified $1,650.00 transfer; the second invoice was entered by the supplier 13 days after payment.",
  },
  {
    contractor: "Polaris Painters",
    contractorId: "c5e12a25-2f40-4c05-af51-4f9f8401b573",
    payment: {
      id: "0c5dc764-c8b9-48cb-aeb9-eab085aaaefe",
      date: "2025-12-18",
      reference: "Rma",
      amount: 3000,
      messageId: "19b36bce6b3c0544",
    },
    invoices: [
      {
        id: "5c0939bd-ef36-47a9-977c-a5912fe05431",
        number: "48",
        gross: 5000,
        allocation: 3000,
      },
    ],
    methods: [
      "verified_contractor_identity",
      "partial_invoice_payment",
      "exact_split_payment_sum",
      "td_payment_confirmation",
      "bank_record",
    ],
    note: "First payment toward Polaris invoice #48. The two verified transfers total exactly $5,000.00.",
  },
  {
    contractor: "Polaris Painters",
    contractorId: "c5e12a25-2f40-4c05-af51-4f9f8401b573",
    payment: {
      id: "c58f162d-063c-4991-8c28-d6038cd5bebc",
      date: "2025-12-23",
      reference: "QyK",
      amount: 2000,
      messageId: "19b4e79855d7824f",
    },
    invoices: [
      {
        id: "5c0939bd-ef36-47a9-977c-a5912fe05431",
        number: "48",
        gross: 5000,
        allocation: 2000,
      },
    ],
    methods: [
      "verified_contractor_identity",
      "invoice_balance_payment",
      "exact_split_payment_sum",
      "td_payment_confirmation",
      "bank_record",
    ],
    note: "Balance payment for Polaris invoice #48. The two verified transfers total exactly $5,000.00.",
  },
  {
    contractor: "Polaris Painters",
    contractorId: "c5e12a25-2f40-4c05-af51-4f9f8401b573",
    payment: {
      id: "9c2bbe03-915a-42e0-8f4d-968bb8d35f13",
      date: "2026-02-02",
      reference: "4VJ",
      amount: 3000,
      messageId: "19c20db1343c58fe",
    },
    invoices: [
      {
        id: "2f4de129-1d94-45fc-ac9f-74f51c7831cb",
        number: "53",
        gross: 3700,
        allocation: 3000,
      },
    ],
    methods: [
      "verified_contractor_identity",
      "partial_invoice_payment",
      "same_day_invoice",
      "td_payment_confirmation",
      "bank_record",
    ],
    note: "Verified $3,000.00 Polaris transfer on the invoice date. Invoice #53 retains a visible $700.00 unpaid balance.",
  },
  {
    contractor: "Polaris Painters",
    contractorId: "c5e12a25-2f40-4c05-af51-4f9f8401b573",
    payment: {
      id: "6206f37a-fe4a-4d91-a32a-fe4544afebf3",
      date: "2026-02-06",
      reference: "tSj",
      amount: 950,
      messageId: "19c358a36268ae19",
    },
    invoices: [
      {
        id: "a464be11-ce11-4507-b18a-6b3515c0ca5d",
        number: "54",
        amount: 950,
      },
    ],
    note: "Exact invoice total four days after issue. TD confirms the payment to Polaris was deposited.",
  },
  {
    contractor: "Polaris Painters",
    contractorId: "c5e12a25-2f40-4c05-af51-4f9f8401b573",
    payment: {
      id: "6dd53ee7-681c-4a89-8440-b5a93c59f87f",
      date: "2026-02-17",
      reference: "GUz",
      description: "SEND E-TFR *GUz EPAY",
      amount: 1200,
      messageId: "19c671b8ddf1e1ca",
    },
    invoices: [
      {
        id: "1d7c7df6-78cc-4c45-b183-abf72c898bad",
        number: "55",
        amount: 1200,
        messageId: "19c4f343a9a5111b",
      },
    ],
    methods: [
      "verified_contractor_identity",
      "exact_after_hst_amount_cents",
      "payment_memo_job_name",
      "td_payment_confirmation",
      "bank_record",
    ],
    note: "TD payment memo says Shawn Myers and exactly equals Polaris invoice #55 for Shawn Myers.",
  },
  {
    contractor: "Polaris Painters",
    contractorId: "c5e12a25-2f40-4c05-af51-4f9f8401b573",
    payment: {
      id: "e755f2ce-e9cb-4a75-bbd5-47bde3fcf1a3",
      date: "2026-02-17",
      reference: "5dk",
      description: "SEND E-TFR *5dk EPAY",
      amount: 990,
      messageId: "19c671aeb79c6f9c",
    },
    invoices: [
      {
        id: "36a5d113-089a-4fca-b6af-12bcdcff3035",
        number: "57",
        amount: 990,
        messageId: "19c4f458b64944d9",
      },
    ],
    methods: [
      "verified_contractor_identity",
      "exact_after_hst_amount_cents",
      "payment_memo_job_name",
      "td_payment_confirmation",
      "bank_record",
    ],
    note: "TD payment memo says Sonya Lee (30%) and exactly equals Polaris invoice #57 for Sonya Lee (30%).",
  },
  {
    contractor: "Polaris Painters",
    contractorId: "c5e12a25-2f40-4c05-af51-4f9f8401b573",
    payment: {
      id: "284a78aa-075e-45d9-bfa3-76e2c5728acf",
      date: "2026-02-20",
      reference: "KpH",
      amount: 1200,
      messageId: "19c7d97125e1f6e8",
    },
    invoices: [
      {
        id: "3da0276b-369a-450d-bb05-cfe730887dcf",
        number: "58",
        amount: 1200,
        messageId: "19c784e337eeca0c",
      },
    ],
    methods: [
      "verified_contractor_identity",
      "exact_after_hst_amount_cents",
      "payment_memo_job_name",
      "invoice_includes_bonus",
      "td_payment_confirmation",
      "bank_record",
    ],
    note: "TD memo says Marilyn Hingorani including a $100 bonus. Polaris invoice #58 is explicitly $1,200.00 for Marilyn including the $100 bonus.",
  },
  {
    contractor: "Polaris Painters",
    contractorId: POLARIS_CONTRACTOR_ID,
    payment: {
      id: "d2059843-7e39-473b-8662-d448bae458bd",
      date: "2026-02-20",
      reference: "vNJ",
      amount: 1090,
      messageId: "19c7d9658594fc64",
    },
    invoices: [
      {
        id: "4a81ba54-b723-4861-8814-87a9606e7a84",
        number: "60",
        amount: 1040,
        messageId: "19c785358c7f2c0c",
      },
    ],
    otherAllocations: [
      {
        type: "other",
        amount: 50,
        explanation:
          "Historical $50.00 Katie Koba bonus stated in TD Interac confirmation message 19c7d9658594fc64; Polaris invoice #60 separately covers $980 labour plus $60 gas.",
      },
    ],
    methods: [
      "verified_contractor_identity",
      "payment_memo_job_name",
      "invoice_component",
      "td_payment_confirmation",
      "bank_record",
    ],
    note: "TD memo says Katie Koba including $60 gas plus a $50 bonus. Invoice #60 is $1,040.00 for Katie Koba and explicitly includes the $60 gas; the remaining $50.00 is separately classified from the same evidence.",
  },
  {
    contractor: "Polaris Painters",
    contractorId: POLARIS_CONTRACTOR_ID,
    payment: {
      id: "083b2802-7f9f-43e3-8ee1-0a56ce3cfba5",
      date: "2026-02-23",
      reference: "eZh",
      amount: 1200,
      messageId: "19c8334ec66aaea0",
    },
    invoices: [
      {
        id: "b5787086-22ce-41a8-ae71-ad8d7bd99086",
        number: "59",
        amount: 1200,
      },
    ],
    methods: [
      "verified_contractor_alias",
      "payment_memo_job_name",
      "exact_after_hst_amount_cents",
      "td_payment_confirmation",
      "bank_record",
    ],
    note: "Aref Hosain Mohammadi is the verified individual payee for Polaris Painters. The TD memo says Natacha McGuire (full payment) and exactly equals Polaris invoice #59 for Natacha McGuire.",
  },
  {
    contractor: "Polaris Painters",
    contractorId: POLARIS_CONTRACTOR_ID,
    payment: {
      id: "b03bb25a-e428-4ca5-9dca-5ee2ecfd0b98",
      date: "2026-03-02",
      reference: "96M",
      amount: 1110,
      messageId: "19caaa64d915357d",
    },
    invoices: [
      {
        id: "c94f4223-0a7c-4ebd-b199-18d6cdef2185",
        number: "61",
        amount: 1060,
      },
    ],
    otherAllocations: [
      {
        type: "other",
        amount: 50,
        explanation:
          "Historical $50.00 Courtney Mondoux bonus stated in TD Interac confirmation message 19caaa64d915357d; Polaris invoice #61 separately totals $1,060.00.",
      },
    ],
    methods: [
      "verified_contractor_alias",
      "payment_memo_job_name",
      "invoice_component",
      "td_payment_confirmation",
      "bank_record",
    ],
    note: "Aref Hosain Mohammadi is the verified individual payee for Polaris Painters. The TD memo says Courtney Mondoux ($1,060 plus $50 bonus); invoice #61 is $1,060.00 and the bonus is preserved as a separate payment component.",
  },
  {
    contractor: "Polaris Painters",
    contractorId: POLARIS_CONTRACTOR_ID,
    payment: {
      id: "97c17907-c5b6-4b22-ae85-6d0b6b4db84b",
      date: "2026-03-02",
      reference: "FEf",
      amount: 1400,
      messageId: "19caaada9db04706",
    },
    invoices: [
      {
        id: "d111422e-b60c-4038-916b-f271f04f4ed6",
        number: "65",
        gross: 2000,
        allocation: 1400,
      },
    ],
    methods: [
      "verified_contractor_alias",
      "payment_memo_job_name",
      "invoice_deposit",
      "exact_split_payment_sum",
      "td_payment_confirmation",
      "bank_record",
    ],
    note: "Aref Hosain Mohammadi is the verified individual payee for Polaris Painters. The TD memo says Debbie Byrnes (70% part payment), matching the $1,400.00 received amount printed on Polaris invoice #65.",
  },
  {
    contractor: "Polaris Painters",
    contractorId: POLARIS_CONTRACTOR_ID,
    payment: {
      id: "c1282b1e-e97f-442f-aeac-380d134da532",
      date: "2026-03-06",
      reference: "6M6",
      amount: 700,
      messageId: "19cc412cbcc9cfee",
    },
    invoices: [
      {
        id: "1ac89236-e094-4858-850c-60adf6e89c78",
        number: "63",
        amount: 700,
      },
    ],
    methods: [
      "verified_contractor_alias",
      "payment_memo_job_name",
      "exact_after_hst_amount_cents",
      "td_payment_confirmation",
      "bank_record",
    ],
    note: "Aref Hosain Mohammadi is the verified individual payee for Polaris Painters. The TD memo says Claire Colbert (full payment) and exactly equals Polaris invoice #63.",
  },
  {
    contractor: "Polaris Painters",
    contractorId: POLARIS_CONTRACTOR_ID,
    payment: {
      id: "80b92632-8b03-4bb2-8621-3738fe8e2686",
      date: "2026-03-06",
      reference: "TYK",
      amount: 700,
      messageId: "19cc4139a7ca49e2",
    },
    invoices: [
      {
        id: "2f4de129-1d94-45fc-ac9f-74f51c7831cb",
        number: "53",
        gross: 3700,
        allocation: 700,
      },
    ],
    methods: [
      "verified_contractor_alias",
      "payment_memo_job_name",
      "invoice_balance_payment",
      "exact_split_payment_sum",
      "td_payment_confirmation",
      "bank_record",
    ],
    note: "Aref Hosain Mohammadi is the verified individual payee for Polaris Painters. The TD memo says Luke (change order full payment); this is the exact $700.00 balance left after the verified $3,000.00 payment on Polaris invoice #53 for Luke Nixon Janssen.",
  },
  {
    contractor: "Polaris Painters",
    contractorId: POLARIS_CONTRACTOR_ID,
    payment: {
      id: "55cd1a3b-b41b-4b04-a632-08597a0d6658",
      date: "2026-03-09",
      reference: "5dB",
      amount: 1725,
      messageId: "19cc959d2a064503",
    },
    invoices: [
      {
        id: "f109796a-02f7-4f65-a3ad-2258f90efb12",
        number: "64",
        gross: 3450,
        allocation: 1725,
      },
    ],
    methods: [
      "verified_contractor_alias",
      "payment_memo_job_name",
      "invoice_deposit",
      "exact_split_payment_sum",
      "td_payment_confirmation",
      "bank_record",
    ],
    note: "Aref Hosain Mohammadi is the verified individual payee for Polaris Painters. The TD memo says Justin Wagar (50% payment), exactly half of Polaris invoice #64.",
  },
  {
    contractor: "Polaris Painters",
    contractorId: POLARIS_CONTRACTOR_ID,
    payment: {
      id: "7a98d346-f5a5-4ac7-9f61-271f0c684243",
      date: "2026-03-16",
      reference: "cSt",
      amount: 700,
      messageId: "19cf3b163305a547",
    },
    invoices: [
      {
        id: "d111422e-b60c-4038-916b-f271f04f4ed6",
        number: "65",
        gross: 2000,
        allocation: 600,
      },
    ],
    otherAllocations: [
      {
        type: "other",
        amount: 100,
        explanation:
          "Unresolved $100.00 Polaris invoice discrepancy. TD message 19cf3b163305a547 says Debbie Byrnes remaining 30%; invoice #65 totals $2,000.00 but also prints '$1,400 Received. $700 remaining,' which conflicts with that total by $100.00.",
      },
    ],
    methods: [
      "verified_contractor_alias",
      "payment_memo_job_name",
      "invoice_balance_component",
      "documented_invoice_discrepancy",
      "td_payment_confirmation",
      "bank_record",
    ],
    note: "Aref Hosain Mohammadi is the verified individual payee for Polaris Painters. $600.00 settles the mathematical balance of invoice #65 after its $1,400.00 deposit; the contradictory extra $100.00 is preserved separately for review rather than forced into the invoice.",
  },
  {
    contractor: "Polaris Painters",
    contractorId: POLARIS_CONTRACTOR_ID,
    payment: {
      id: "9a741f17-e1d1-417d-bace-1704e4f447a9",
      date: "2026-03-23",
      reference: "sBa",
      amount: 1500,
      messageId: "19d1665895aedf5b",
    },
    invoices: [
      {
        id: "f793523c-3832-4f7d-908b-5e52443f021a",
        number: "66",
        amount: 1500,
      },
    ],
    methods: [
      "verified_contractor_alias",
      "payment_memo_job_name",
      "exact_after_hst_amount_cents",
      "td_payment_confirmation",
      "bank_record",
    ],
    note: "Aref Hosain Mohammadi is the verified individual payee for Polaris Painters. The TD memo says Darko (full payment) and exactly equals Polaris invoice #66.",
  },
  {
    contractor: "Polaris Painters",
    contractorId: POLARIS_CONTRACTOR_ID,
    payment: {
      id: "8a4616d1-7981-464f-8d6d-8eaf2ba8c1ea",
      date: "2026-03-30",
      reference: "CKj",
      amount: 1725,
      messageId: "19d411eaf4f4ad38",
    },
    invoices: [
      {
        id: "f109796a-02f7-4f65-a3ad-2258f90efb12",
        number: "64",
        gross: 3450,
        allocation: 1725,
      },
    ],
    methods: [
      "verified_contractor_alias",
      "payment_memo_job_name",
      "invoice_balance_payment",
      "exact_split_payment_sum",
      "td_payment_confirmation",
      "bank_record",
    ],
    note: "Aref Hosain Mohammadi is the verified individual payee for Polaris Painters. The TD memo says Justin Wagar (remaining 50%, full payment), completing Polaris invoice #64.",
  },
  {
    contractor: "Polaris Painters",
    contractorId: POLARIS_CONTRACTOR_ID,
    payment: {
      id: "a50681e9-c8a3-450b-b837-01907a879bd9",
      date: "2026-04-02",
      reference: "YPu",
      amount: 510,
      messageId: "19d50c6935cb40d6",
    },
    invoices: [
      {
        id: "6fe23026-496d-4c72-9ed7-04ba8e97eb11",
        number: "69",
        amount: 460,
      },
    ],
    otherAllocations: [
      {
        type: "other",
        amount: 50,
        explanation:
          "Historical $50.00 McNulty bonus stated in TD Interac confirmation message 19d50c6935cb40d6; Polaris invoice #69 separately totals $460.00.",
      },
    ],
    methods: [
      "verified_contractor_alias",
      "payment_memo_job_name_variant",
      "invoice_component",
      "td_payment_confirmation",
      "bank_record",
    ],
    note: "Aref Hosain Mohammadi is the verified individual payee for Polaris Painters. The TD memo says Kora McNulty (full plus $50 bonus), while invoice #69 says Dora McNulty; the shared surname, date and exact $460.00 invoice plus $50.00 bonus support the match while preserving the name variance.",
  },
  {
    contractor: "Polaris Painters",
    contractorId: POLARIS_CONTRACTOR_ID,
    payment: {
      id: "9f6accf2-edc7-45b7-a3a2-fbb5ced61a93",
      date: "2026-04-13",
      reference: "Euh",
      amount: 290,
      messageId: "19d7e881d7923b5f",
    },
    invoices: [
      {
        id: "b462c7af-f4ec-4d71-aab2-ffdc5476adcb",
        number: "75",
        amount: 290,
      },
    ],
    methods: [
      "verified_contractor_alias",
      "payment_memo_job_name",
      "invoice_includes_bonus",
      "td_payment_confirmation",
      "bank_record",
    ],
    note: "Aref Hosain Mohammadi is the verified individual payee for Polaris Painters. The TD memo says Oriet Greg (full plus $25 bonus) and exactly equals Polaris invoice #75 for Oriet Greg.",
  },
  {
    contractor: "Polaris Painters",
    contractorId: POLARIS_CONTRACTOR_ID,
    payment: {
      id: "714efbfa-a2b2-48ab-8095-7fdb40a6f764",
      date: "2026-04-13",
      reference: "qQ7",
      amount: 1300,
      messageId: "19d7e84c24274f2a",
    },
    invoices: [
      {
        id: "a673d83c-5a1d-4634-b296-300258a8d2db",
        number: "72",
        amount: 1300,
      },
    ],
    methods: [
      "verified_contractor_alias",
      "payment_memo_job_name",
      "exact_after_hst_amount_cents",
      "td_payment_confirmation",
      "bank_record",
    ],
    note: "Aref Hosain Mohammadi is the verified individual payee for Polaris Painters. The TD memo says Darian Peeling (full) and exactly equals Polaris invoice #72.",
  },
  {
    contractor: "Polaris Painters",
    contractorId: POLARIS_CONTRACTOR_ID,
    payment: {
      id: "857d581d-591f-4462-8843-0201e8eaf36b",
      date: "2026-04-13",
      reference: "MPC",
      amount: 435,
      messageId: "19d7e86b8a15f60b",
    },
    invoices: [
      {
        id: "de0ab416-979a-4ab3-8943-82bea3b10f4a",
        number: "74",
        amount: 435,
      },
    ],
    methods: [
      "verified_contractor_alias",
      "payment_memo_job_name",
      "invoice_includes_bonus",
      "td_payment_confirmation",
      "bank_record",
    ],
    note: "Aref Hosain Mohammadi is the verified individual payee for Polaris Painters. The TD memo says Laura Van Cleef (full plus $50 bonus) and exactly equals Polaris invoice #74.",
  },
  {
    contractor: "Polaris Painters",
    contractorId: POLARIS_CONTRACTOR_ID,
    payment: {
      id: "fd83f041-d511-48f8-ae3a-fa3bb1140dae",
      date: "2026-04-15",
      reference: "MNB",
      amount: 1145,
      messageId: "19d91ce1d790c15c",
    },
    invoices: [
      {
        id: "37e76d25-9462-4c17-9195-6f004283a3ec",
        number: "76",
        amount: 1145,
      },
    ],
    methods: [
      "verified_contractor_alias",
      "payment_memo_job_name",
      "invoice_includes_bonus",
      "td_payment_confirmation",
      "bank_record",
    ],
    note: "Aref Hosain Mohammadi is the verified individual payee for Polaris Painters. The TD memo says Rekka Tulsikram (full plus bonus) and exactly equals Polaris invoice #76.",
  },
  {
    contractor: "Polaris Painters",
    contractorId: POLARIS_CONTRACTOR_ID,
    payment: {
      id: "40937976-8274-4f66-95e5-4be6c7b79ca8",
      date: "2026-04-15",
      reference: "2PF",
      amount: 1750,
      messageId: "19d91d0444b8dab4",
    },
    invoices: [
      {
        id: "aea0a22a-9c41-4714-bbea-021315fcafb3",
        number: "77",
        amount: 1750,
      },
    ],
    methods: [
      "verified_contractor_alias",
      "payment_memo_job_name",
      "invoice_includes_bonus",
      "td_payment_confirmation",
      "bank_record",
    ],
    note: "Aref Hosain Mohammadi is the verified individual payee for Polaris Painters. The TD memo says Julie Irving (full plus bonus) and exactly equals Polaris invoice #77.",
  },
  {
    contractor: "Polaris Painters",
    contractorId: POLARIS_CONTRACTOR_ID,
    payment: {
      id: "0eb78b94-02b4-4890-8223-1dec91a39d5c",
      date: "2026-04-28",
      reference: "xTe",
      amount: 690,
      messageId: "19dd73113dd90ab1",
    },
    invoices: [
      {
        id: "5953e27a-59e8-4720-89be-4dd17752409b",
        number: "80",
        amount: 690,
      },
    ],
    methods: [
      "verified_contractor_alias",
      "payment_memo_job_name",
      "exact_after_hst_amount_cents",
      "td_payment_confirmation",
      "bank_record",
    ],
    note: "Aref Hosain Mohammadi is the verified individual payee for Polaris Painters. The TD memo says Justin Wagar (full) and exactly equals Polaris invoice #80.",
  },
  {
    contractor: "Polaris Painters",
    contractorId: POLARIS_CONTRACTOR_ID,
    payment: {
      id: "05fc2853-d33b-4cbe-ba42-c976d34597e1",
      date: "2026-04-28",
      reference: "6ya",
      amount: 700,
      messageId: "19dd733412d9cb0a",
    },
    invoices: [
      {
        id: "b1b5e32d-24e8-4a37-8a75-74afa3caacc3",
        number: "81",
        amount: 700,
      },
    ],
    methods: [
      "verified_contractor_alias",
      "payment_memo_job_name",
      "exact_after_hst_amount_cents",
      "td_payment_confirmation",
      "bank_record",
    ],
    note: "Aref Hosain Mohammadi is the verified individual payee for Polaris Painters. The TD memo says Julie Irwing (full) and exactly equals Polaris invoice #81 for Julie Irwing added work.",
  },
  {
    contractor: "Polaris Painters",
    contractorId: POLARIS_CONTRACTOR_ID,
    payment: {
      id: "2b530856-6d01-40f2-afd6-0fcc4233bf73",
      date: "2026-04-28",
      reference: "5Dt",
      amount: 1500,
      messageId: "19dd736de6e0eafe",
    },
    invoices: [
      {
        id: "006cc656-b31b-4aa4-9bc3-03b6db566fde",
        number: "82",
        gross: 2295,
        allocation: 1500,
        allowPartial: true,
      },
    ],
    methods: [
      "verified_contractor_alias",
      "payment_memo_job_name_variant",
      "invoice_deposit",
      "exact_split_payment_sum",
      "td_payment_confirmation",
      "bank_record",
    ],
    note: "Aref Hosain Mohammadi is the verified individual payee for Polaris Painters. The TD memo says Yacoub Abdulla (part), matching the Jacob/Yacoub Polaris invoice #82.",
  },
  {
    contractor: "Polaris Painters",
    contractorId: POLARIS_CONTRACTOR_ID,
    payment: {
      id: "3bf77a7c-9ab9-447c-83e6-f77175a2e2d9",
      date: "2026-05-05",
      reference: "65p",
      amount: 700,
      messageId: "19dfaa192d8e9570",
    },
    invoices: [
      {
        id: "006cc656-b31b-4aa4-9bc3-03b6db566fde",
        number: "82",
        gross: 2295,
        allocation: 700,
        allowPartial: true,
      },
    ],
    methods: [
      "verified_contractor_alias",
      "payment_memo_job_name_variant",
      "invoice_balance_component",
      "exact_split_payment_sum",
      "td_payment_confirmation",
      "bank_record",
    ],
    note: "Aref Hosain Mohammadi is the verified individual payee for Polaris Painters. The TD memo says Yacub Abdulla (full), but the two verified transfers total $2,200.00 against invoice #82's $2,295.00 total, so the invoice correctly retains a visible $95.00 discrepancy.",
  },
];

function parseEnvFile(filePath) {
  if (!existsSync(filePath)) return {};
  const values = {};
  for (const rawLine of readFileSync(filePath, "utf8").split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) continue;
    const separator = line.indexOf("=");
    if (separator < 1) continue;
    const key = line.slice(0, separator).trim();
    let value = line.slice(separator + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    values[key] = value;
  }
  return values;
}

function cents(value) {
  return Math.round(Number(value) * 100);
}

function gross(invoice) {
  if (invoice.amount_paid != null) return Math.abs(Number(invoice.amount_paid));
  return (
    Math.abs(Number(invoice.amount_before_tax ?? 0)) +
    Math.abs(Number(invoice.tax_amount ?? 0))
  );
}

function expectedInvoiceGross(invoice) {
  return invoice.gross ?? invoice.amount;
}

function expectedAllocation(invoice) {
  return invoice.allocation ?? invoice.amount;
}

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function messageIdFromSourceData(sourceData) {
  if (!sourceData || typeof sourceData !== "object") return null;
  return (
    sourceData.td_interac_email_evidence?.gmail_message_id ??
    sourceData.td_payment_confirmation?.gmail_message_id ??
    null
  );
}

async function insertAuditEvent(row) {
  const existing = await db
    .from("labour_verification_events")
    .select("id")
    .eq("entity_type", row.entity_type)
    .eq("entity_id", row.entity_id)
    .eq("action", row.action)
    .eq("reason", row.reason)
    .limit(1);
  if (existing.error) throw existing.error;
  if ((existing.data ?? []).length) return;

  const result = await db.from("labour_verification_events").insert(row);
  if (result.error) throw result.error;
}

const repoRoot = path.resolve(
  path.dirname(new URL(import.meta.url).pathname),
  "..",
);
const env = {
  ...parseEnvFile(path.resolve(repoRoot, "../Ottawa Painters App/.env.local")),
  ...parseEnvFile(path.resolve(repoRoot, ".env.local")),
  ...process.env,
};
const supabaseUrl =
  env.SUPABASE_URL ||
  env.NEXT_PUBLIC_SUPABASE_URL ||
  env.EXPO_PUBLIC_SUPABASE_URL;
const serviceRoleKey = env.SUPABASE_SERVICE_ROLE_KEY;

if (!supabaseUrl || !serviceRoleKey) {
  throw new Error("Missing Supabase URL or server-only service role key.");
}

const projectRef = new URL(supabaseUrl).hostname.split(".")[0];
if (projectRef !== TARGET_PROJECT_REF) {
  throw new Error(
    `Refusing reconciliation for unexpected project ${projectRef}.`,
  );
}

const db = createClient(supabaseUrl, serviceRoleKey, {
  auth: { persistSession: false, autoRefreshToken: false },
});

const paymentIds = MATCHES.map((match) => match.payment.id);
const paymentRecordCorrectionIds = PAYMENT_RECORD_CORRECTIONS.map(
  (correction) => correction.financialTransactionId,
);
const reviewedPaymentIds = [
  ...new Set([...paymentIds, ...paymentRecordCorrectionIds]),
];
const invoiceIds = [
  ...new Set(
    MATCHES.flatMap((match) => match.invoices.map((invoice) => invoice.id)),
  ),
];
const contractorIds = [
  ...new Set([
    ...MATCHES.map((match) => match.contractorId),
    ...PAYMENT_RECORD_CORRECTIONS.flatMap((correction) => [
      correction.fromContractorId,
      correction.toContractorId,
    ]),
  ]),
];

const [
  contractorsResult,
  paymentsResult,
  paymentRecordsResult,
  invoicesResult,
  activeAllocationsResult,
  correctionInvoicesResult,
  activeOtherAllocationsResult,
] = await Promise.all([
  db
    .from("labour_contractors")
    .select("id,supplier_name")
    .in("id", contractorIds),
  db
    .from("financial_transactions")
    .select(
      "id,posted_on,description,counterparty,amount,currency,transaction_type,category,review_status,source_data",
    )
    .in("id", reviewedPaymentIds),
  db
    .from("labour_payment_records")
    .select(
      "financial_transaction_id,contractor_id,recipient_status,confirmation_method,confirmation_note",
    )
    .in("financial_transaction_id", reviewedPaymentIds),
  db
    .from("labour_invoices")
    .select(
      "id,contractor_id,invoice_number,amount_before_tax,tax_amount,amount_paid,currency,document_type,match_status",
    )
    .in("id", invoiceIds),
  db
    .from("labour_payment_allocations")
    .select(
      "id,financial_transaction_id,invoice_id,allocated_amount,reversed_at",
    )
    .in("financial_transaction_id", paymentIds)
    .is("reversed_at", null),
  db
    .from("labour_invoices")
    .select(
      "id,invoice_number,amount_before_tax,tax_amount,amount_paid,document_type,match_status,duplicate_group_id,supporting_invoice_reference",
    )
    .in(
      "id",
      INVOICE_CORRECTIONS.map((correction) => correction.id),
    ),
  db
    .from("labour_payment_other_allocations")
    .select(
      "id,financial_transaction_id,contractor_id,companycam_project_id,allocation_type,allocated_amount,explanation,reversed_at",
    )
    .in("financial_transaction_id", paymentIds)
    .is("reversed_at", null),
]);

for (const [label, result] of Object.entries({
  contractors: contractorsResult,
  payments: paymentsResult,
  paymentRecords: paymentRecordsResult,
  invoices: invoicesResult,
  activeAllocations: activeAllocationsResult,
  correctionInvoices: correctionInvoicesResult,
  activeOtherAllocations: activeOtherAllocationsResult,
})) {
  if (result.error) throw new Error(`${label}: ${result.error.message}`);
}

assert(
  contractorsResult.data.length === contractorIds.length,
  "One or more reviewed contractors are missing.",
);
assert(
  paymentsResult.data.length === reviewedPaymentIds.length,
  "One or more reviewed payments are missing.",
);
assert(
  paymentRecordsResult.data.length === reviewedPaymentIds.length,
  "One or more reviewed payment recipient records are missing.",
);
assert(
  invoicesResult.data.length === invoiceIds.length,
  "One or more reviewed invoices are missing.",
);
assert(
  correctionInvoicesResult.data.length === INVOICE_CORRECTIONS.length,
  "One or more invoice-version corrections are missing.",
);

const correctionInvoiceById = new Map(
  correctionInvoicesResult.data.map((invoice) => [invoice.id, invoice]),
);
let invoiceCorrectionCount = 0;
for (const correction of INVOICE_CORRECTIONS) {
  const invoice = correctionInvoiceById.get(correction.id);
  assert(
    invoice?.invoice_number === correction.number &&
      (invoice.document_type ===
        (correction.expectedDocumentType ?? "invoice") ||
        invoice.document_type === correction.desired.document_type) &&
      cents(gross(invoice)) === cents(correction.gross),
    `Invoice correction target ${correction.id} no longer matches the reviewed evidence.`,
  );
  if (
    Object.entries(correction.desired).some(
      ([key, value]) => invoice[key] !== value,
    )
  ) {
    invoiceCorrectionCount += 1;
  }
}

const contractorById = new Map(
  contractorsResult.data.map((contractor) => [contractor.id, contractor]),
);
const paymentById = new Map(
  paymentsResult.data.map((payment) => [payment.id, payment]),
);
const paymentRecordById = new Map(
  paymentRecordsResult.data.map((record) => [
    record.financial_transaction_id,
    record,
  ]),
);
const paymentRecordCorrectionById = new Map(
  PAYMENT_RECORD_CORRECTIONS.map((correction) => [
    correction.financialTransactionId,
    correction,
  ]),
);
const invoiceById = new Map(
  invoicesResult.data.map((invoice) => [invoice.id, invoice]),
);
const activeAllocationsByPayment = new Map();
for (const allocation of activeAllocationsResult.data) {
  const rows =
    activeAllocationsByPayment.get(allocation.financial_transaction_id) ?? [];
  rows.push(allocation);
  activeAllocationsByPayment.set(allocation.financial_transaction_id, rows);
}
const activeOtherAllocationsByPayment = new Map();
for (const allocation of activeOtherAllocationsResult.data) {
  const rows =
    activeOtherAllocationsByPayment.get(allocation.financial_transaction_id) ??
    [];
  rows.push(allocation);
  activeOtherAllocationsByPayment.set(
    allocation.financial_transaction_id,
    rows,
  );
}

assert(
  contractorById.get(AREF_CONTRACTOR_ID)?.supplier_name ===
    "Aref Hosain Mohammadi",
  "The reviewed Aref contractor record no longer matches.",
);
assert(
  contractorById.get(POLARIS_CONTRACTOR_ID)?.supplier_name ===
    "Polaris Painters",
  "The reviewed Polaris contractor record no longer matches.",
);

let paymentRecordCorrectionCount = 0;
for (const correction of PAYMENT_RECORD_CORRECTIONS) {
  const payment = paymentById.get(correction.financialTransactionId);
  const paymentRecord = paymentRecordById.get(
    correction.financialTransactionId,
  );
  assert(
    payment?.counterparty === correction.recipientName &&
      payment.transaction_type === "expense" &&
      payment.category === "Subcontractors" &&
      payment.currency === "CAD",
    `Aref/Polaris payment ${correction.financialTransactionId} no longer matches the reviewed bank evidence.`,
  );
  assert(
    paymentRecord?.recipient_status === "confirmed" &&
      [correction.fromContractorId, correction.toContractorId].includes(
        paymentRecord.contractor_id,
      ),
    `Aref/Polaris payment ${correction.financialTransactionId} has an unexpected payment record.`,
  );

  const currentNote = paymentRecord.confirmation_note ?? "";
  const desiredNote = currentNote.includes(correction.reason)
    ? currentNote
    : `${currentNote} ${correction.reason}`.trim();
  correction.desiredConfirmationNote = desiredNote;
  if (
    paymentRecord.contractor_id !== correction.toContractorId ||
    paymentRecord.confirmation_note !== desiredNote
  ) {
    paymentRecordCorrectionCount += 1;
  }
}

let allocationInsertCount = 0;
let otherAllocationInsertCount = 0;
for (const match of MATCHES) {
  const contractor = contractorById.get(match.contractorId);
  const payment = paymentById.get(match.payment.id);
  const paymentRecord = paymentRecordById.get(match.payment.id);

  assert(
    contractor?.supplier_name === match.contractor,
    `Contractor ${match.contractorId} no longer matches ${match.contractor}.`,
  );
  assert(payment, `Missing payment ${match.payment.reference}.`);
  assert(
    payment.posted_on === match.payment.date &&
      payment.description ===
        (match.payment.description ??
          `SEND E-TFR ***${match.payment.reference}`) &&
      cents(Math.abs(payment.amount)) === cents(match.payment.amount) &&
      payment.currency === "CAD" &&
      payment.transaction_type === "expense" &&
      payment.category === (match.payment.category ?? "Subcontractors"),
    `Payment ${match.payment.reference} no longer matches the reviewed bank evidence.`,
  );
  assert(
    (paymentRecord?.contractor_id === match.contractorId ||
      (paymentRecordCorrectionById.get(match.payment.id)?.toContractorId ===
        match.contractorId &&
        paymentRecord?.contractor_id ===
          paymentRecordCorrectionById.get(match.payment.id)
            ?.fromContractorId)) &&
      paymentRecord.recipient_status === "confirmed",
    `Payment ${match.payment.reference} does not have confirmed recipient evidence for ${match.contractor}.`,
  );

  const plannedPaymentTotal =
    match.invoices.reduce(
      (total, invoice) => total + expectedAllocation(invoice),
      0,
    ) +
    (match.otherAllocations ?? []).reduce(
      (total, allocation) => total + allocation.amount,
      0,
    );
  assert(
    cents(plannedPaymentTotal) === cents(match.payment.amount),
    `Planned allocations for ${match.payment.reference} do not equal the payment.`,
  );

  const expectedInvoiceIds = new Set(
    match.invoices.map((invoice) => invoice.id),
  );
  const activeAllocations =
    activeAllocationsByPayment.get(match.payment.id) ?? [];
  assert(
    activeAllocations.every((allocation) =>
      expectedInvoiceIds.has(allocation.invoice_id),
    ),
    `Payment ${match.payment.reference} has an unexpected active allocation.`,
  );

  for (const expectedInvoice of match.invoices) {
    const invoice = invoiceById.get(expectedInvoice.id);
    assert(invoice, `Missing invoice ${expectedInvoice.number}.`);
    assert(
      (invoice.document_type === "invoice" ||
        INVOICE_CORRECTIONS.some(
          (correction) =>
            correction.id === invoice.id &&
            correction.desired.document_type === "invoice",
        )) &&
        invoice.contractor_id === match.contractorId &&
        invoice.invoice_number === expectedInvoice.number &&
        invoice.currency === "CAD" &&
        cents(gross(invoice)) === cents(expectedInvoiceGross(expectedInvoice)),
      `Invoice ${match.contractor} #${expectedInvoice.number} no longer matches the reviewed evidence.`,
    );

    const active = activeAllocations.find(
      (allocation) => allocation.invoice_id === expectedInvoice.id,
    );
    if (active) {
      assert(
        cents(active.allocated_amount) ===
          cents(expectedAllocation(expectedInvoice)),
        `Existing ${match.payment.reference} allocation for invoice #${expectedInvoice.number} has a different amount.`,
      );
    } else {
      allocationInsertCount += 1;
    }
  }

  const activeOtherAllocations =
    activeOtherAllocationsByPayment.get(match.payment.id) ?? [];
  assert(
    activeOtherAllocations.every((allocation) =>
      (match.otherAllocations ?? []).some(
        (expected) =>
          allocation.contractor_id === match.contractorId &&
          allocation.allocation_type === expected.type &&
          cents(allocation.allocated_amount) === cents(expected.amount) &&
          allocation.explanation === expected.explanation,
      ),
    ),
    `Payment ${match.payment.reference} has an unexpected active non-invoice allocation.`,
  );
  for (const expected of match.otherAllocations ?? []) {
    const active = activeOtherAllocations.find(
      (allocation) =>
        allocation.contractor_id === match.contractorId &&
        allocation.allocation_type === expected.type &&
        cents(allocation.allocated_amount) === cents(expected.amount) &&
        allocation.explanation === expected.explanation,
    );
    if (!active) otherAllocationInsertCount += 1;
  }
}

for (const invoiceId of invoiceIds) {
  const planned = MATCHES.flatMap((match) =>
    match.invoices
      .filter((invoice) => invoice.id === invoiceId)
      .map((invoice) => ({
        contractorId: match.contractorId,
        gross: expectedInvoiceGross(invoice),
        allocation: expectedAllocation(invoice),
        allowPartial: invoice.allowPartial === true,
      })),
  );
  const invoice = invoiceById.get(invoiceId);
  const plannedGrossValues = new Set(planned.map((row) => cents(row.gross)));
  assert(
    plannedGrossValues.size === 1 &&
      cents(gross(invoice)) === [...plannedGrossValues][0],
    `Planned gross total is inconsistent for invoice ${invoiceId}.`,
  );
  const plannedTotal = planned.reduce(
    (total, row) => total + row.allocation,
    0,
  );
  if (planned.some((row) => row.allowPartial)) {
    assert(
      cents(plannedTotal) > 0 && cents(plannedTotal) < cents(gross(invoice)),
      `Planned partial allocations are invalid for invoice ${invoiceId}.`,
    );
  } else {
    assert(
      cents(plannedTotal) === cents(gross(invoice)),
      `Planned allocations do not fully settle invoice ${invoiceId}.`,
    );
  }
}

console.log(
  JSON.stringify(
    {
      mode: APPLY ? "apply" : "dry-run",
      project_ref: projectRef,
      contractors: contractorIds.length,
      payments: MATCHES.length,
      invoices: invoiceIds.length,
      allocation_inserts: allocationInsertCount,
      other_allocation_inserts: otherAllocationInsertCount,
      invoice_version_corrections: invoiceCorrectionCount,
      payment_record_corrections: paymentRecordCorrectionCount,
      total_payment_amount: MATCHES.reduce(
        (total, match) => total + match.payment.amount,
        0,
      ),
    },
    null,
    2,
  ),
);

if (!APPLY) process.exit(0);

for (const correction of INVOICE_CORRECTIONS) {
  const current = correctionInvoiceById.get(correction.id);
  const changed = Object.entries(correction.desired).some(
    ([key, value]) => current[key] !== value,
  );
  if (!changed) continue;

  const oldValues = Object.fromEntries(
    Object.keys(correction.desired).map((key) => [key, current[key]]),
  );
  const update = await db
    .from("labour_invoices")
    .update(correction.desired)
    .eq("id", correction.id);
  if (update.error) throw update.error;

  await insertAuditEvent({
    entity_type: "invoice",
    entity_id: correction.id,
    action: "update",
    old_values: oldValues,
    new_values: correction.desired,
    reason: correction.reason,
    performed_by: ADMIN_USER_ID,
    performed_at: NOW,
  });
}

for (const correction of PAYMENT_RECORD_CORRECTIONS) {
  const current = paymentRecordById.get(correction.financialTransactionId);
  const desired = {
    contractor_id: correction.toContractorId,
    confirmation_note: correction.desiredConfirmationNote,
  };
  const changed = Object.entries(desired).some(
    ([key, value]) => current[key] !== value,
  );
  if (!changed) continue;

  const oldValues = {
    contractor_id: current.contractor_id,
    confirmation_note: current.confirmation_note,
  };
  const update = await db
    .from("labour_payment_records")
    .update(desired)
    .eq("financial_transaction_id", correction.financialTransactionId);
  if (update.error) throw update.error;

  await insertAuditEvent({
    entity_type: "payment",
    entity_id: correction.financialTransactionId,
    action: "update",
    old_values: oldValues,
    new_values: desired,
    reason: correction.reason,
    performed_by: ADMIN_USER_ID,
    performed_at: NOW,
  });

  Object.assign(current, desired);
}

for (const match of MATCHES) {
  const payment = paymentById.get(match.payment.id);
  const paymentMessageId =
    match.payment.messageId ?? messageIdFromSourceData(payment.source_data);

  for (const expectedInvoice of match.invoices) {
    const active = (
      activeAllocationsByPayment.get(match.payment.id) ?? []
    ).find((allocation) => allocation.invoice_id === expectedInvoice.id);
    if (active) continue;

    const allocationAmount = expectedAllocation(expectedInvoice);
    const invoiceGross = expectedInvoiceGross(expectedInvoice);
    const matchMethod = [
      ...new Set(
        match.methods ?? [
          "verified_contractor_identity",
          "exact_after_hst_amount_cents",
          match.invoices.length === 1 &&
          cents(allocationAmount) === cents(invoiceGross)
            ? "unique_exact_invoice_total"
            : match.invoices.length > 1
              ? "unique_exact_invoice_sum"
              : "partial_payment_component",
          "bank_record",
        ],
      ),
    ];
    if (paymentMessageId && !matchMethod.includes("td_payment_confirmation")) {
      matchMethod.push("td_payment_confirmation");
    }

    const allocationInsert = await db
      .from("labour_payment_allocations")
      .insert({
        financial_transaction_id: match.payment.id,
        invoice_id: expectedInvoice.id,
        allocated_amount: allocationAmount,
        match_method: matchMethod,
        invoice_source_message_id: expectedInvoice.messageId ?? null,
        payment_confirmation_message_id: paymentMessageId,
        confirmed_by: ADMIN_USER_ID,
        confirmed_at: NOW,
        notes:
          `${match.note} Allocated $${allocationAmount.toFixed(2)} ` +
          `to invoice #${expectedInvoice.number}.`,
      });
    if (allocationInsert.error) throw allocationInsert.error;
  }

  const activeOtherAllocations =
    activeOtherAllocationsByPayment.get(match.payment.id) ?? [];
  for (const expected of match.otherAllocations ?? []) {
    const active = activeOtherAllocations.find(
      (allocation) =>
        allocation.contractor_id === match.contractorId &&
        allocation.allocation_type === expected.type &&
        cents(allocation.allocated_amount) === cents(expected.amount) &&
        allocation.explanation === expected.explanation,
    );
    if (active) continue;

    const otherAllocationInsert = await db
      .from("labour_payment_other_allocations")
      .insert({
        financial_transaction_id: match.payment.id,
        contractor_id: match.contractorId,
        companycam_project_id: expected.projectId ?? null,
        allocation_type: expected.type,
        allocated_amount: expected.amount,
        explanation: expected.explanation,
        inserted_by: ADMIN_USER_ID,
      });
    if (otherAllocationInsert.error) throw otherAllocationInsert.error;
  }
}

const paymentVerification = await db
  .from("labour_payment_verification")
  .select(
    "financial_transaction_id,payment_amount,total_allocated_amount,unallocated_amount,payment_status",
  )
  .in("financial_transaction_id", paymentIds);
if (paymentVerification.error) throw paymentVerification.error;

for (const verification of paymentVerification.data) {
  assert(
    verification.payment_status === "fully_allocated" &&
      cents(verification.unallocated_amount) === 0 &&
      cents(verification.total_allocated_amount) ===
        cents(verification.payment_amount),
    `Payment ${verification.financial_transaction_id} did not become fully allocated.`,
  );
}

const invoiceVerification = await db
  .from("labour_invoice_verification")
  .select(
    "invoice_id,invoice_amount,paid_amount,amount_remaining,payment_status",
  )
  .in("invoice_id", invoiceIds);
if (invoiceVerification.error) throw invoiceVerification.error;

for (const verification of invoiceVerification.data) {
  const planned = MATCHES.flatMap((match) =>
    match.invoices
      .filter((invoice) => invoice.id === verification.invoice_id)
      .map((invoice) => ({
        allocation: expectedAllocation(invoice),
        allowPartial: invoice.allowPartial === true,
      })),
  );
  const plannedTotal = planned.reduce(
    (total, row) => total + row.allocation,
    0,
  );
  if (planned.some((row) => row.allowPartial)) {
    assert(
      verification.payment_status === "partially_paid" &&
        cents(verification.paid_amount) === cents(plannedTotal) &&
        cents(verification.amount_remaining) ===
          cents(verification.invoice_amount - plannedTotal),
      `Invoice ${verification.invoice_id} did not retain the expected partial balance.`,
    );
  } else {
    assert(
      verification.payment_status === "paid" &&
        cents(verification.amount_remaining) === 0 &&
        cents(verification.paid_amount) === cents(verification.invoice_amount),
      `Invoice ${verification.invoice_id} did not become fully paid.`,
    );
  }
}

const reconciliationUpdate = await db
  .from("financial_transactions")
  .update({
    review_status: "reconciled",
  })
  .in("id", paymentIds);
if (reconciliationUpdate.error) throw reconciliationUpdate.error;

console.log(
  JSON.stringify(
    {
      applied: true,
      payments_fully_allocated: paymentVerification.data.length,
      invoices_verified: invoiceVerification.data.length,
      financial_transactions_reconciled: paymentIds.length,
    },
    null,
    2,
  ),
);
