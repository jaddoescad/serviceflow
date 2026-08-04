#!/usr/bin/env node

import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { createClient } from "@supabase/supabase-js";

const TARGET_PROJECT_REF = "bwbckdkouqghdadpkjvn";
const EVIDENCE_SOURCE =
  "TD EasyWeb Interac e-Transfer history viewed 2026-07-30";
const EMAIL_EVIDENCE_SOURCE =
  "TD Interac e-Transfer confirmation email in info@paintersottawa.com";

const contractorNames = new Map([
  ["Anas New", "Abdellah Aouf"],
  ["ABDELLAH AOUF", "Abdellah Aouf"],
  ["anas", "Abdellah Aouf"],
  ["Andrew Bell", "Andrew Bell"],
  ["AREF HOSAIN MOHAMMADI", "Aref Hosain Mohammadi"],
  ["AUDREY MICHELLE MORADEL GALEANO", "AMG Service Construction"],
  ["Bilal akkacha", "Fennec Contracting"],
  ["CURB APPEAL EXTERIOR SOLUTIONS", "Curb Appeal Pro Wash"],
  ["Francisco Premium Coat", "Premium Coat"],
  ["LOLI TAPING", "Loli Taping"],
  ["M&A NICE PAINTING INC.", "M&A Nice Painting Inc."],
  ["Marcelo Cabrera", "Angel Marcelo Cabrera"],
  ["Michael Matambo", "XDesign Dev Inc"],
  ["Michael Prudhomme", "Michael Prudhomme"],
  ["Michelle Painter", "AMG Service Construction"],
  ["michelle - amg construction", "AMG Service Construction"],
  ["Nils Aschengreen", "Niels Aschengreen"],
  ["PERFECT STROKES PAINTING INC.", "Perfect Strokes Painting Inc."],
  ["Phil Hyde", "Phillip Hyde"],
  ["Polaris", "Polaris Painters"],
  ["Polaris Painting Ottawa", "Polaris Painters"],
  ["ROBABEH ROBATMILI", "Mas Reno"],
  ["Scott Madden", "Caledonian Painting Ltd"],
  ["Scott Painter", "Scott Bertin"],
  ["curb appeal softwash", "Curb Appeal Pro Wash"],
  ["grutenco", "Grutenco Painting & Construction Services"],
  ["hamed", "Mas Reno"],
  ["saeed painter", "PixReno Construction Inc."],
  ["wally", "Done Right Handyman Services"],
  ["YOUSSEF MROUE", "Youssef Mroueh"],
]);

const transfers = [
  [
    "TA2",
    "2026-01-27",
    1477.48,
    "graeme",
    "gajarchibald@gmail.com",
    "Autodeposited",
  ],
  [
    "kDf",
    "2026-01-27",
    813.6,
    "Darlene",
    "darlene@dressingrooms.ca",
    "Deposited",
  ],
  [
    "4M5",
    "2026-01-27",
    524.7,
    "Phil Hyde",
    "phil.hyde33@gmail.com",
    "Autodeposited",
  ],
  [
    "w26",
    "2026-01-20",
    203.4,
    "Darlene",
    "darlene@dressingrooms.ca",
    "Deposited",
  ],
  [
    "NUt",
    "2026-01-16",
    4520,
    "Scott Madden",
    "scott@caledonianpainting.ca",
    "Autodeposited",
  ],
  [
    "HdQ",
    "2026-02-23",
    610.2,
    "Darlene",
    "darlene@dressingrooms.ca",
    "Deposited",
  ],
  [
    "hsW",
    "2026-02-21",
    800,
    "anas",
    "aouf0002@algonquinlive.com",
    "Autodeposited",
  ],
  [
    "rzh",
    "2026-02-21",
    282.5,
    "Michael Matambo",
    "xdesign.ottawa@gmail.com",
    "Deposited",
  ],
  [
    "s2H",
    "2026-02-20",
    1665.62,
    "Marcelo Cabrera",
    "mashelo325@gmail.com",
    "Autodeposited",
  ],
  ["yjG", "2026-02-18", 300, "hamed", "rroba032@uottawa.ca", "Autodeposited"],
  [
    "Rwg",
    "2026-02-10",
    250,
    "Marcelo Cabrera",
    "mashelo325@gmail.com",
    "Deposited",
  ],
  [
    "JKy",
    "2026-02-07",
    610.2,
    "Darlene",
    "darlene@dressingrooms.ca",
    "Deposited",
  ],
  [
    "wvk",
    "2026-02-05",
    5715.22,
    "Scott Madden",
    "scott@caledonianpainting.ca",
    "Autodeposited",
  ],
  [
    "4VJ",
    "2026-02-02",
    3000,
    "Polaris",
    "polarispaintersottawa@gmail.com",
    "Deposited",
  ],
  [
    "vY8",
    "2026-03-30",
    557.09,
    "client temp justin wagar",
    "justinwagar@wealthsimple.me",
    "Autodeposited",
  ],
  [
    "35F",
    "2026-03-28",
    4032.19,
    "Francisco Premium Coat",
    "payments@premiumcoat.ca",
    "Autodeposited",
  ],
  [
    "dX2",
    "2026-03-28",
    576.3,
    "Michael Matambo",
    "xdesign.ottawa@gmail.com",
    "Deposited",
  ],
  [
    "Bta",
    "2026-03-28",
    1100,
    "anas",
    "aouf0002@algonquinlive.com",
    "Autodeposited",
  ],
  [
    "MUk",
    "2026-03-28",
    440.7,
    "Michael Matambo",
    "xdesign.ottawa@gmail.com",
    "Deposited",
  ],
  [
    "74S",
    "2026-03-25",
    1980,
    "Scott Painter",
    "ezlikesunmorn71@gmail.com",
    "Autodeposited",
  ],
  [
    "qGb",
    "2026-03-25",
    225,
    "anas",
    "aouf0002@algonquinlive.com",
    "Autodeposited",
  ],
  [
    "FrV",
    "2026-03-24",
    3000,
    "Francisco Premium Coat",
    "payments@premiumcoat.ca",
    "Autodeposited",
  ],
  [
    "ktJ",
    "2026-03-24",
    203.4,
    "Darlene",
    "darlene@dressingrooms.ca",
    "Deposited",
  ],
  [
    "gWF",
    "2026-03-24",
    1575,
    "Marcelo Cabrera",
    "mashelo325@gmail.com",
    "Autodeposited",
  ],
  [
    "feR",
    "2026-03-21",
    100,
    "Scott Madden",
    "scott@caledonianpainting.ca",
    "Autodeposited",
  ],
  [
    "7nb",
    "2026-03-18",
    610.2,
    "Darlene",
    "darlene@dressingrooms.ca",
    "Cancelled",
  ],
  [
    "akH",
    "2026-03-18",
    912.59,
    "anas",
    "aouf0002@algonquinlive.com",
    "Autodeposited",
  ],
  [
    "JmV",
    "2026-03-18",
    975,
    "Marcelo Cabrera",
    "mashelo325@gmail.com",
    "Autodeposited",
  ],
  [
    "mCy",
    "2026-03-15",
    1921,
    "Francisco Premium Coat",
    "payments@premiumcoat.ca",
    "Autodeposited",
  ],
  [
    "4zx",
    "2026-03-11",
    646.88,
    "Marcelo Cabrera",
    "mashelo325@gmail.com",
    "Autodeposited",
  ],
  [
    "ENe",
    "2026-03-11",
    459,
    "Nils Aschengreen",
    "aschengreen@gmail.com",
    "Autodeposited",
  ],
  [
    "zE2",
    "2026-03-09",
    305.1,
    "Darlene",
    "darlene@dressingrooms.ca",
    "Deposited",
  ],
  [
    "d4K",
    "2026-03-08",
    610.02,
    "Darlene",
    "darlene@dressingrooms.ca",
    "Deposited",
  ],
  [
    "vbH",
    "2026-03-08",
    672,
    "Nils Aschengreen",
    "aschengreen@gmail.com",
    "Autodeposited",
  ],
  [
    "A5n",
    "2026-03-08",
    1275,
    "Marcelo Cabrera",
    "mashelo325@gmail.com",
    "Autodeposited",
  ],
  [
    "QDG",
    "2026-03-06",
    8414.47,
    "Scott Madden",
    "scott@caledonianpainting.ca",
    "Autodeposited",
  ],
  [
    "gZQ",
    "2026-03-06",
    950,
    "anas",
    "aouf0002@algonquinlive.com",
    "Autodeposited",
  ],
  [
    "54f",
    "2026-03-02",
    1728,
    "Marcelo Cabrera",
    "mashelo325@gmail.com",
    "Autodeposited",
  ],
  [
    "SjP",
    "2026-03-02",
    400,
    "JAD SLIM",
    "deposits@coinsquare.com",
    "Cancelled (Accept Request failed)",
  ],
  [
    "hqC",
    "2026-04-28",
    169.5,
    "wally",
    "wally@donerighthandymanservices.ca",
    "Deposited",
  ],
  [
    "BjU",
    "2026-04-28",
    558.99,
    "anas",
    "aouf0002@algonquinlive.com",
    "Autodeposited",
  ],
  [
    "Z6A",
    "2026-04-27",
    2935.3,
    "Francisco Premium Coat",
    "payments@premiumcoat.ca",
    "Autodeposited",
  ],
  [
    "Jag",
    "2026-04-27",
    3600,
    "Francisco Premium Coat",
    "payments@premiumcoat.ca",
    "Autodeposited",
  ],
  [
    "tkD",
    "2026-04-23",
    169.5,
    "Janet Refund",
    "jabmorris@rogers.com",
    "Autodeposited",
  ],
  [
    "nHn",
    "2026-04-21",
    271.2,
    "Michael Matambo",
    "xdesign.ottawa@gmail.com",
    "Deposited",
  ],
  [
    "dct",
    "2026-04-21",
    900,
    "Andrew Bell",
    "ndrw.bll@gmail.com",
    "Autodeposited",
  ],
  [
    "H8n",
    "2026-04-21",
    1017,
    "Michael Matambo",
    "xdesign.ottawa@gmail.com",
    "Deposited",
  ],
  [
    "kcu",
    "2026-04-19",
    881.88,
    "Marcelo Cabrera",
    "mashelo325@gmail.com",
    "Autodeposited",
  ],
  [
    "zcF",
    "2026-04-17",
    339,
    "saeed painter",
    "saeed@pixrenoconstruction.ca",
    "Deposited",
  ],
  [
    "MYK",
    "2026-04-17",
    3271.35,
    "Francisco Premium Coat",
    "payments@premiumcoat.ca",
    "Autodeposited",
  ],
  [
    "kRQ",
    "2026-04-16",
    768.75,
    "Marcelo Cabrera",
    "mashelo325@gmail.com",
    "Autodeposited",
  ],
  [
    "HFy",
    "2026-04-16",
    8708.6,
    "Scott Madden",
    "scott@caledonianpainting.ca",
    "Autodeposited",
  ],
  [
    "Udc",
    "2026-04-13",
    5000,
    "Scott Madden",
    "scott@caledonianpainting.ca",
    "Autodeposited",
  ],
  [
    "7SF",
    "2026-04-13",
    500,
    "Shakepay Inc.",
    "funding@etransfers.shakepay.com",
    "Request deposited",
  ],
  [
    "fmU",
    "2026-04-13",
    1500,
    "Shakepay Inc.",
    "funding@etransfers.shakepay.com",
    "Request deposited",
  ],
  [
    "zdT",
    "2026-04-13",
    1290,
    "Andrew Bell",
    "ndrw.bll@gmail.com",
    "Autodeposited",
  ],
  [
    "AZP",
    "2026-04-13",
    1050.9,
    "Michael Matambo",
    "xdesign.ottawa@gmail.com",
    "Deposited",
  ],
  [
    "gPs",
    "2026-04-13",
    56.25,
    "Marcelo Cabrera",
    "mashelo325@gmail.com",
    "Autodeposited",
  ],
  [
    "yyX",
    "2026-04-13",
    187.5,
    "Marcelo Cabrera",
    "mashelo325@gmail.com",
    "Autodeposited",
  ],
  [
    "kAu",
    "2026-04-10",
    843.75,
    "Marcelo Cabrera",
    "mashelo325@gmail.com",
    "Autodeposited",
  ],
  [
    "3UU",
    "2026-04-07",
    237.5,
    "anas",
    "aouf0002@algonquinlive.com",
    "Autodeposited",
  ],
  [
    "8fd",
    "2026-04-07",
    200,
    "anas",
    "aouf0002@algonquinlive.com",
    "Autodeposited",
  ],
  [
    "zDX",
    "2026-04-07",
    200,
    "anas",
    "aouf0002@algonquinlive.com",
    "Autodeposited",
  ],
  [
    "Nnh",
    "2026-04-07",
    855,
    "Andrew Bell",
    "ndrw.bll@gmail.com",
    "Autodeposited",
  ],
  [
    "eXe",
    "2026-04-03",
    10,
    "Shakepay Inc.",
    "funding@etransfers.shakepay.com",
    "Request deposited",
  ],
  [
    "9HV",
    "2026-04-03",
    393.75,
    "Marcelo Cabrera",
    "mashelo325@gmail.com",
    "Autodeposited",
  ],
  [
    "gjM",
    "2026-04-03",
    813.6,
    "Darlene",
    "darlene@dressingrooms.ca",
    "Deposited",
  ],
  [
    "mDm",
    "2026-04-03",
    203.4,
    "Darlene",
    "darlene@dressingrooms.ca",
    "Deposited",
  ],
  [
    "66Z",
    "2026-04-01",
    1987.5,
    "Marcelo Cabrera",
    "mashelo325@gmail.com",
    "Autodeposited",
  ],
  [
    "GaR",
    "2026-07-28",
    1533.42,
    "elaine custkmer",
    "elainekeveney@gmail.com",
    "Deposited",
  ],
  [
    "ZSw",
    "2026-07-28",
    84.75,
    "Michael Matambo",
    "xdesign.ottawa@gmail.com",
    "Deposited",
  ],
  ["ntd", "2026-07-26", 4237.5, "grutenco", "hello@grutenco.ca", "Deposited"],
  [
    "Paw",
    "2026-07-26",
    113,
    "Michael Matambo",
    "xdesign.ottawa@gmail.com",
    "Deposited",
  ],
  [
    "Brg",
    "2026-07-26",
    2101.8,
    "Michael Matambo",
    "xdesign.ottawa@gmail.com",
    "Deposited",
  ],
  [
    "r8P",
    "2026-07-24",
    597.97,
    "kirsty johnson customer",
    "kristijohnson@rogers.com",
    "Autodeposited",
  ],
  [
    "Sf4",
    "2026-07-17",
    2920,
    "Shakepay Inc.",
    "funding@etransfers.shakepay.com",
    "Request deposited",
  ],
  [
    "DNe",
    "2026-07-16",
    577,
    "Michael Matambo",
    "xdesign.ottawa@gmail.com",
    "Deposited",
  ],
  [
    "6jd",
    "2026-07-16",
    1796,
    "Michael Matambo",
    "xdesign.ottawa@gmail.com",
    "Deposited",
  ],
  [
    "6E8",
    "2026-07-16",
    3690,
    "Bilal akkacha",
    "bilal.akkacha2@outlook.com",
    "Autodeposited",
  ],
  ["c84", "2026-07-16", 1017, "grutenco", "hello@grutenco.ca", "Deposited"],
  ["HDz", "2026-07-13", 2585, "grutenco", "hello@grutenco.ca", "Deposited"],
  ["Nym", "2026-07-08", 565, "grutenco", "hello@grutenco.ca", "Deposited"],
  [
    "29g",
    "2026-07-08",
    1796.7,
    "Michael Matambo",
    "xdesign.ottawa@gmail.com",
    "Deposited",
  ],
  [
    "Ekh",
    "2026-07-08",
    5193.05,
    "Scott Madden",
    "scott@caledonianpainting.ca",
    "Autodeposited",
  ],
  [
    "MNT",
    "2026-07-06",
    100,
    "Shakepay Inc.",
    "funding@etransfers.shakepay.com",
    "Request deposited",
  ],
  [
    "5gZ",
    "2026-07-03",
    5000,
    "Scott Madden",
    "scott@caledonianpainting.ca",
    "Autodeposited",
  ],
  [
    "s8M",
    "2026-07-03",
    1500,
    "Shakepay Inc.",
    "funding@etransfers.shakepay.com",
    "Request deposited",
  ],
  [
    "ZRd",
    "2026-07-03",
    610.2,
    "Darlene",
    "darlene@dressingrooms.ca",
    "Deposited",
  ],
  ["DgV", "2026-07-01", 996.13, "grutenco", "hello@grutenco.ca", "Deposited"],
  [
    "3dK",
    "2026-07-01",
    2847.6,
    "Michael Matambo",
    "xdesign.ottawa@gmail.com",
    "Deposited",
  ],
  [
    "Mw7",
    "2026-06-24",
    600,
    "Michael Prudhomme",
    "michael23prudhomme@gmail.com",
    "Autodeposited",
  ],
  ["rpk", "2026-06-20", 2500, "grutenco", "hello@grutenco.ca", "Deposited"],
  [
    "thB",
    "2026-06-20",
    440,
    "curb appeal softwash",
    "payments@curbappealprowash.ca",
    "Autodeposited",
  ],
  [
    "2Sj",
    "2026-06-18",
    2256.1,
    "Scott Madden",
    "scott@caledonianpainting.ca",
    "Autodeposited",
  ],
  [
    "q3d",
    "2026-06-18",
    624,
    "Anas New",
    "abdellahaouf2@gmail.com",
    "Deposited",
  ],
  [
    "pKE",
    "2026-06-15",
    1636.2,
    "Michael Matambo",
    "xdesign.ottawa@gmail.com",
    "Deposited",
  ],
  [
    "fq4",
    "2026-06-15",
    330,
    "Michael Matambo",
    "xdesign.ottawa@gmail.com",
    "Deposited",
  ],
  [
    "nkY",
    "2026-06-15",
    644.1,
    "Michael Matambo",
    "xdesign.ottawa@gmail.com",
    "Deposited",
  ],
  [
    "yJ8",
    "2026-06-15",
    216,
    "anas",
    "aouf0002@algonquinlive.com",
    "Autodeposited",
  ],
  [
    "7EH",
    "2026-06-15",
    881.4,
    "Michael Matambo",
    "xdesign.ottawa@gmail.com",
    "Deposited",
  ],
  [
    "jGV",
    "2026-06-12",
    10000,
    "Scott Madden",
    "scott@caledonianpainting.ca",
    "Autodeposited",
  ],
  [
    "n2H",
    "2026-06-10",
    372.9,
    "Michael Matambo",
    "xdesign.ottawa@gmail.com",
    "Deposited",
  ],
  [
    "JrB",
    "2026-06-07",
    542.4,
    "Michael Matambo",
    "xdesign.ottawa@gmail.com",
    "Deposited",
  ],
  [
    "nSH",
    "2026-06-07",
    678,
    "One Touch Print",
    "info@onetouchprint.ca",
    "Autodeposited",
  ],
  ["RS9", "2026-06-05", 3090.55, "grutenco", "hello@grutenco.ca", "Deposited"],
  [
    "dBf",
    "2026-06-05",
    1250.75,
    "Michelle Painter",
    "audreygaleano4@gmail.com",
    "Autodeposited",
  ],
  [
    "WU8",
    "2026-06-03",
    2000,
    "Shakepay Inc.",
    "funding@etransfers.shakepay.com",
    "Request deposited",
  ],
  [
    "Z6x",
    "2026-06-03",
    610.2,
    "Darlene",
    "darlene@dressingrooms.ca",
    "Deposited",
  ],
  [
    "Ysm",
    "2026-06-01",
    2131.82,
    "Francisco Premium Coat",
    "payments@premiumcoat.ca",
    "Autodeposited",
  ],
  [
    "Tjv",
    "2026-05-29",
    2364.19,
    "michelle - amg construction",
    "audreygaleano4@gmail.com",
    "Autodeposited",
  ],
  [
    "7ym",
    "2026-05-27",
    71.75,
    "CLIENT - Rashonda",
    "rashonda.legault@gmail.com",
    "Autodeposited",
  ],
  ["8xR", "2026-05-25", 4734.8, "grutenco", "hello@grutenco.ca", "Deposited"],
  [
    "24S",
    "2026-05-25",
    5181.05,
    "PERFECT STROKES PAINTING INC.",
    "psppaintinginc@gmail.com",
    "Autodeposited",
  ],
  [
    "xGz",
    "2026-05-23",
    4983.3,
    "LOLI TAPING",
    "lolis041025@gmail.com",
    "Autodeposited",
  ],
  [
    "VvV",
    "2026-05-21",
    5905,
    "Jad Business",
    "jaddoescad@gmail.com",
    "Autodeposited",
  ],
  [
    "7pb",
    "2026-05-19",
    1627.2,
    "Michael Matambo",
    "xdesign.ottawa@gmail.com",
    "Deposited",
  ],
  [
    "jEY",
    "2026-05-15",
    3758.47,
    "Francisco Premium Coat",
    "payments@premiumcoat.ca",
    "Autodeposited",
  ],
  [
    "YMP",
    "2026-05-15",
    572.91,
    "saeed painter",
    "saeed@pixrenoconstruction.ca",
    "Deposited",
  ],
  [
    "9ck",
    "2026-05-15",
    1627.2,
    "Michael Matambo",
    "xdesign.ottawa@gmail.com",
    "Cancelled",
  ],
  [
    "jFt",
    "2026-05-09",
    5575,
    "Scott Madden",
    "scott@caledonianpainting.ca",
    "Autodeposited",
  ],
  [
    "8gW",
    "2026-05-06",
    813.6,
    "Darlene",
    "darlene@dressingrooms.ca",
    "Deposited",
  ],
  [
    "c8m",
    "2026-05-04",
    6000,
    "Scott Madden",
    "scott@caledonianpainting.ca",
    "Autodeposited",
  ],
  [
    "BK5",
    "2026-05-04",
    3226.15,
    "Francisco Premium Coat",
    "payments@premiumcoat.ca",
    "Autodeposited",
  ],
  [
    "26e",
    "2026-05-04",
    525.45,
    "saeed painter",
    "saeed@pixrenoconstruction.ca",
    "Cancelled (Expired)",
  ],
].map(([suffix, sent_on, amount, recipient_name, recipient_email, status]) => ({
  suffix,
  sent_on,
  amount,
  recipient_name,
  recipient_email,
  status,
}));

const emailTransfers = [
  [
    "2KR",
    "2026-06-19",
    440,
    "CURB APPEAL EXTERIOR SOLUTIONS",
    "19ee23e3949c994e",
    "Cancelled (notification failed)",
  ],
  ["r2C", "2026-06-10", 2100, "YOUSSEF MROUE", "19eb39665ae82475", "Deposited"],
  ["Csj", "2026-06-09", 3000, "YOUSSEF MROUE", "19eadaee0b790ce0", "Deposited"],
  ["YSf", "2026-05-28", 3000, "YOUSSEF MROUE", "19e702f925ee9c0d", "Deposited"],
  [
    "GKH",
    "2026-05-26",
    3000,
    "AUDREY MICHELLE MORADEL GALEANO",
    "19e6663e2d98878c",
    "Deposited",
  ],
  [
    "65p",
    "2026-05-05",
    700,
    "AREF HOSAIN MOHAMMADI",
    "19dfaa192d8e9570",
    "Deposited",
  ],
  ["tqR", "2026-05-04", 3000, "YOUSSEF MROUE", "19df51a1b0913f79", "Deposited"],
  [
    "PsD",
    "2026-05-01",
    525.45,
    "saeed painter",
    "19de6385165352fc",
    "Deposited",
  ],
  [
    "HH4",
    "2026-05-01",
    1005.7,
    "saeed painter",
    "19de45cf777a85e6",
    "Deposited",
  ],
  [
    "6ya",
    "2026-04-28",
    700,
    "AREF HOSAIN MOHAMMADI",
    "19dd733412d9cb0a",
    "Deposited",
  ],
  [
    "xTe",
    "2026-04-28",
    690,
    "AREF HOSAIN MOHAMMADI",
    "19dd73113dd90ab1",
    "Deposited",
  ],
  [
    "5Dt",
    "2026-04-28",
    1500,
    "AREF HOSAIN MOHAMMADI",
    "19dd736de6e0eafe",
    "Deposited",
  ],
  ["7zm", "2026-04-27", 2800, "YOUSSEF MROUE", "19dd1902eb5ad447", "Deposited"],
  [
    "2PF",
    "2026-04-15",
    1750,
    "AREF HOSAIN MOHAMMADI",
    "19d91d0444b8dab4",
    "Deposited",
  ],
  [
    "MNB",
    "2026-04-15",
    1145,
    "AREF HOSAIN MOHAMMADI",
    "19d91ce1d790c15c",
    "Deposited",
  ],
  ["R3q", "2026-04-14", 3000, "YOUSSEF MROUE", "19d8a342f2f3314d", "Deposited"],
  [
    "qQ7",
    "2026-04-13",
    1300,
    "AREF HOSAIN MOHAMMADI",
    "19d7e84c24274f2a",
    "Deposited",
  ],
  [
    "MPC",
    "2026-04-13",
    435,
    "AREF HOSAIN MOHAMMADI",
    "19d7e86b8a15f60b",
    "Deposited",
  ],
  [
    "Euh",
    "2026-04-13",
    290,
    "AREF HOSAIN MOHAMMADI",
    "19d7e881d7923b5f",
    "Deposited",
  ],
  [
    "YPu",
    "2026-04-02",
    510,
    "AREF HOSAIN MOHAMMADI",
    "19d50c6935cb40d6",
    "Deposited",
  ],
  [
    "ujd",
    "2026-04-02",
    1010,
    "AREF HOSAIN MOHAMMADI",
    "19d50c507849b9f3",
    "Deposited",
  ],
  ["xBj", "2026-04-01", 3000, "YOUSSEF MROUE", "19d4b34f28915b37", "Deposited"],
  ["8rF", "2026-03-30", 3000, "YOUSSEF MROUE", "19d3a94aab3efdf0", "Deposited"],
  [
    "CKj",
    "2026-03-30",
    1725,
    "AREF HOSAIN MOHAMMADI",
    "19d411eaf4f4ad38",
    "Deposited",
  ],
  [
    "sBa",
    "2026-03-23",
    1500,
    "AREF HOSAIN MOHAMMADI",
    "19d1665895aedf5b",
    "Deposited",
  ],
  [
    "cSt",
    "2026-03-16",
    700,
    "AREF HOSAIN MOHAMMADI",
    "19cf3b163305a547",
    "Deposited",
  ],
  [
    "5dB",
    "2026-03-09",
    1725,
    "AREF HOSAIN MOHAMMADI",
    "19cc959d2a064503",
    "Deposited",
  ],
  [
    "TYK",
    "2026-03-06",
    700,
    "AREF HOSAIN MOHAMMADI",
    "19cc4139a7ca49e2",
    "Deposited",
  ],
  [
    "6M6",
    "2026-03-06",
    700,
    "AREF HOSAIN MOHAMMADI",
    "19cc412cbcc9cfee",
    "Deposited",
  ],
  [
    "FEf",
    "2026-03-02",
    1400,
    "AREF HOSAIN MOHAMMADI",
    "19caaada9db04706",
    "Deposited",
  ],
  [
    "96M",
    "2026-03-02",
    1110,
    "AREF HOSAIN MOHAMMADI",
    "19caaa64d915357d",
    "Deposited",
  ],
  [
    "eZh",
    "2026-02-23",
    1200,
    "AREF HOSAIN MOHAMMADI",
    "19c8334ec66aaea0",
    "Deposited",
  ],
  [
    "KpH",
    "2026-02-20",
    1200,
    "Polaris Painting Ottawa",
    "19c7d97125e1f6e8",
    "Deposited",
  ],
  [
    "vNJ",
    "2026-02-20",
    1090,
    "Polaris Painting Ottawa",
    "19c7d9658594fc64",
    "Deposited",
  ],
  [
    "vgP",
    "2026-02-17",
    180,
    "Polaris Painting Ottawa",
    "19c671a49d473116",
    "Deposited",
  ],
  [
    "GUz",
    "2026-02-17",
    1200,
    "Polaris Painting Ottawa",
    "19c671b8ddf1e1ca",
    "Deposited",
  ],
  [
    "5dk",
    "2026-02-17",
    990,
    "Polaris Painting Ottawa",
    "19c671aeb79c6f9c",
    "Deposited",
  ],
  [
    "tSj",
    "2026-02-06",
    950,
    "Polaris Painting Ottawa",
    "19c358a36268ae19",
    "Deposited",
  ],
  [
    "aMT",
    "2026-02-06",
    1017,
    "M&A NICE PAINTING INC.",
    "19c33f38b92e6798",
    "Deposited",
  ],
  [
    "RZP",
    "2026-02-03",
    791,
    "ROBABEH ROBATMILI",
    "19c255be032eb2e0",
    "Deposited",
  ],
  [
    "qgg",
    "2026-02-02",
    1221,
    "ROBABEH ROBATMILI",
    "19c2039232197797",
    "Deposited",
  ],
  [
    "hK3",
    "2026-02-02",
    897.5,
    "ROBABEH ROBATMILI",
    "19c2039dc0488d89",
    "Deposited",
  ],
  ["uK5", "2026-02-02", 2900, "ABDELLAH AOUF", "19c1ae9961a90b69", "Deposited"],
  [
    "cCP",
    "2026-01-26",
    500,
    "Polaris Painting Ottawa",
    "19bfc37c1494df44",
    "Deposited",
  ],
  [
    "tqg",
    "2026-01-12",
    680,
    "Polaris Painting Ottawa",
    "19baeec276eed904",
    "Deposited",
  ],
].map(
  ([suffix, sent_on, amount, recipient_name, gmail_message_id, status]) => ({
    suffix,
    sent_on,
    amount,
    recipient_name,
    gmail_message_id,
    status,
  }),
);

function parseEnvFile(filePath) {
  if (!existsSync(filePath)) return {};
  return Object.fromEntries(
    readFileSync(filePath, "utf8")
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter((line) => line && !line.startsWith("#") && line.includes("="))
      .map((line) => {
        const separator = line.indexOf("=");
        return [
          line.slice(0, separator).trim(),
          line
            .slice(separator + 1)
            .trim()
            .replace(/^(['"])(.*)\1$/, "$2"),
        ];
      }),
  );
}

function maskedSuffix(transaction) {
  const source =
    transaction.source_data && typeof transaction.source_data === "object"
      ? transaction.source_data
      : {};
  const searchable = [
    transaction.description,
    transaction.counterparty,
    source.original_description,
    source.merchant_name,
  ]
    .filter(Boolean)
    .join(" ");
  return searchable.match(/\*{1,3}([A-Za-z0-9]{3})/)?.[1] ?? null;
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
  env.SUPABASE_URL ??
  env.NEXT_PUBLIC_SUPABASE_URL ??
  env.EXPO_PUBLIC_SUPABASE_URL;
const serviceRoleKey = env.SUPABASE_SERVICE_ROLE_KEY;

if (!supabaseUrl || !serviceRoleKey) {
  throw new Error("Missing Supabase URL or server-only service role key.");
}
const projectRef = new URL(supabaseUrl).hostname.split(".")[0];
if (projectRef !== TARGET_PROJECT_REF) {
  throw new Error(`Refusing audit for unexpected project ${projectRef}.`);
}

const db = createClient(supabaseUrl, serviceRoleKey, {
  auth: { persistSession: false, autoRefreshToken: false },
});
const applyChanges = process.argv.includes("--apply");
const transactionsResult = await db
  .from("financial_transactions")
  .select(
    "id,posted_on,transaction_on,amount,description,counterparty,category,transaction_type,review_status,source_data",
  )
  .gte("posted_on", "2026-01-01")
  .lte("posted_on", "2026-07-30")
  .order("posted_on", { ascending: false });
if (transactionsResult.error) throw transactionsResult.error;

const transfersBySuffix = new Map();
for (const transfer of transfers) {
  const suffixMatches = transfersBySuffix.get(transfer.suffix) ?? [];
  suffixMatches.push(transfer);
  transfersBySuffix.set(transfer.suffix, suffixMatches);
}
const emailTransfersBySuffix = new Map();
for (const transfer of emailTransfers) {
  const suffixMatches = emailTransfersBySuffix.get(transfer.suffix) ?? [];
  suffixMatches.push(transfer);
  emailTransfersBySuffix.set(transfer.suffix, suffixMatches);
}
const transactionById = new Map(
  (transactionsResult.data ?? []).map((transaction) => [
    transaction.id,
    transaction,
  ]),
);

function dayDifference(left, right) {
  return Math.abs(
    (Date.parse(`${left}T12:00:00Z`) - Date.parse(`${right}T12:00:00Z`)) /
      86_400_000,
  );
}

function exactTransferCandidates(transaction) {
  const suffix = maskedSuffix(transaction);
  const bankAmount = Math.abs(Number(transaction.amount));
  const dateTolerance = /^RECLAIM E-TFR/i.test(transaction.description ?? "")
    ? 45
    : /^CANCEL E-TFR/i.test(transaction.description ?? "")
      ? 7
      : 3;
  const bankDates = [transaction.transaction_on, transaction.posted_on].filter(
    Boolean,
  );
  const amountAndDateMatch = (transfer) =>
    Math.abs(bankAmount - transfer.amount) < 0.005 &&
    bankDates.some(
      (bankDate) => dayDifference(bankDate, transfer.sent_on) <= dateTolerance,
    );

  if (suffix) {
    return (transfersBySuffix.get(suffix) ?? [])
      .filter(amountAndDateMatch)
      .map((transfer) => ({
        transfer,
        suffix,
        match_method: "confirmation_suffix_amount_date",
      }));
  }

  const searchable = [
    transaction.description,
    transaction.source_data?.original_description,
    transaction.source_data?.merchant_name,
  ]
    .filter(Boolean)
    .join(" ");
  if (!/E-?TR(?:ANSFER|FR)|INTERAC/i.test(searchable)) return [];

  return transfers.filter(amountAndDateMatch).map((transfer) => ({
    transfer,
    suffix: transfer.suffix,
    match_method: "unique_amount_date",
  }));
}

function exactEmailTransferCandidates(transaction) {
  const suffix = maskedSuffix(transaction);
  if (!suffix) return [];

  const bankAmount = Math.abs(Number(transaction.amount));
  const dateTolerance = /^RECLAIM E-TFR/i.test(transaction.description ?? "")
    ? 45
    : /^CANCEL E-TFR/i.test(transaction.description ?? "")
      ? 7
      : 3;
  const bankDates = [transaction.transaction_on, transaction.posted_on].filter(
    Boolean,
  );
  return (emailTransfersBySuffix.get(suffix) ?? [])
    .filter(
      (transfer) =>
        Math.abs(bankAmount - transfer.amount) < 0.005 &&
        bankDates.some(
          (bankDate) =>
            dayDifference(bankDate, transfer.sent_on) <= dateTolerance,
        ),
    )
    .map((transfer) => ({
      transfer,
      suffix,
      match_method: "confirmation_suffix_amount_date",
    }));
}

const easyWebMatches = (transactionsResult.data ?? [])
  .map((transaction) => {
    const candidates = exactTransferCandidates(transaction);
    if (candidates.length !== 1) return null;
    const { transfer, suffix, match_method } = candidates[0];
    return {
      transaction_id: transaction.id,
      bank_date: transaction.posted_on,
      transfer_date: transfer.sent_on,
      bank_amount: Math.abs(Number(transaction.amount)),
      transfer_amount: transfer.amount,
      amount_matches: true,
      suffix,
      match_method,
      recipient_name: transfer.recipient_name,
      recipient_email: transfer.recipient_email,
      transfer_status: transfer.status,
      description: transaction.description,
      counterparty: transaction.counterparty,
      category: transaction.category,
      transaction_type: transaction.transaction_type,
      review_status: transaction.review_status,
      evidence_kind: "easyweb_history",
    };
  })
  .filter(Boolean);

const easyWebMatchedTransactionIds = new Set(
  easyWebMatches.map((match) => match.transaction_id),
);
const emailMatches = (transactionsResult.data ?? [])
  .filter((transaction) => !easyWebMatchedTransactionIds.has(transaction.id))
  .map((transaction) => {
    const candidates = exactEmailTransferCandidates(transaction);
    if (candidates.length !== 1) return null;
    const { transfer, suffix, match_method } = candidates[0];
    return {
      transaction_id: transaction.id,
      bank_date: transaction.posted_on,
      transfer_date: transfer.sent_on,
      bank_amount: Math.abs(Number(transaction.amount)),
      transfer_amount: transfer.amount,
      amount_matches: true,
      suffix,
      match_method,
      recipient_name: transfer.recipient_name,
      recipient_email: null,
      gmail_message_id: transfer.gmail_message_id,
      transfer_status: transfer.status,
      description: transaction.description,
      counterparty: transaction.counterparty,
      category: transaction.category,
      transaction_type: transaction.transaction_type,
      review_status: transaction.review_status,
      evidence_kind: "td_confirmation_email",
    };
  })
  .filter(Boolean);

const matches = [...easyWebMatches, ...emailMatches];
const matchedEasyWebSuffixes = new Set(
  easyWebMatches.map((match) => match.suffix),
);
const matchedEmailSuffixes = new Set(emailMatches.map((match) => match.suffix));
const matchedTransactionIds = new Set(
  matches.map((match) => match.transaction_id),
);
const subcontractorEvidenceMatches = matches.filter(
  (match) => match.category === "Subcontractors",
);
const contractorPaymentMatches = subcontractorEvidenceMatches.filter(
  (match) =>
    match.transaction_type === "expense" &&
    contractorNames.has(match.recipient_name) &&
    !/(cancel|fail|return|expir|unable)/i.test(match.transfer_status),
);
const excludedSubcontractorMatches = subcontractorEvidenceMatches.filter(
  (match) => !contractorPaymentMatches.includes(match),
);

const contractorsResult = await db
  .from("labour_contractors")
  .select("id,supplier_name");
if (contractorsResult.error) throw contractorsResult.error;
const normalize = (value) => value.trim().toLocaleLowerCase("en-CA");
const contractorByName = new Map(
  (contractorsResult.data ?? []).map((contractor) => [
    normalize(contractor.supplier_name),
    contractor,
  ]),
);
const missingContractors = [
  ...new Set(
    contractorPaymentMatches
      .map((match) => contractorNames.get(match.recipient_name))
      .filter(
        (supplierName) =>
          supplierName && !contractorByName.has(normalize(supplierName)),
      ),
  ),
];

if (applyChanges && missingContractors.length) {
  const insertResult = await db
    .from("labour_contractors")
    .insert(
      missingContractors.map((supplierName) => ({
        supplier_name: supplierName,
        notes:
          "Created from TD e-transfer recipient evidence reviewed 2026-07-30.",
      })),
    )
    .select("id,supplier_name");
  if (insertResult.error) throw insertResult.error;
  for (const contractor of insertResult.data ?? []) {
    contractorByName.set(normalize(contractor.supplier_name), contractor);
  }
}

const paymentRecords = contractorPaymentMatches.map((match) => {
  const supplierName = contractorNames.get(match.recipient_name);
  const contractor = supplierName
    ? contractorByName.get(normalize(supplierName))
    : null;
  if (applyChanges && !contractor) {
    throw new Error(`Missing contractor ${supplierName} for ${match.suffix}.`);
  }
  return {
    financial_transaction_id: match.transaction_id,
    contractor_id: contractor?.id ?? "[create contractor]",
    recipient_status: "confirmed",
    confirmation_method: "bank_record",
    confirmation_note:
      match.evidence_kind === "easyweb_history"
        ? `${EVIDENCE_SOURCE}: ${match.transfer_date}, $${match.transfer_amount.toFixed(2)}, ` +
          `${match.recipient_name} <${match.recipient_email}>, confirmation ${match.suffix}, ` +
          `status ${match.transfer_status}. Match method: ${match.match_method}.`
        : `${EMAIL_EVIDENCE_SOURCE}: ${match.transfer_date}, $${match.transfer_amount.toFixed(2)}, ` +
          `${match.recipient_name}, Gmail message ${match.gmail_message_id}, confirmation ${match.suffix}, ` +
          `status ${match.transfer_status}. Match method: ${match.match_method}.`,
    confirmed_at: new Date().toISOString(),
  };
});

if (applyChanges) {
  for (const match of subcontractorEvidenceMatches) {
    const supplierName =
      contractorNames.get(match.recipient_name) ?? match.recipient_name;
    const transaction = transactionById.get(match.transaction_id);
    const sourceData =
      transaction?.source_data &&
      typeof transaction.source_data === "object" &&
      !Array.isArray(transaction.source_data)
        ? transaction.source_data
        : {};
    const transferEvidence =
      match.evidence_kind === "easyweb_history"
        ? {
            easyweb_e_transfer_evidence: {
              source: EVIDENCE_SOURCE,
              sent_on: match.transfer_date,
              amount: match.transfer_amount,
              recipient_name: match.recipient_name,
              recipient_email: match.recipient_email,
              confirmation_suffix: match.suffix,
              status: match.transfer_status,
              match_method: match.match_method,
              bank_posted_on: match.bank_date,
            },
          }
        : {
            td_interac_email_evidence: {
              source: EMAIL_EVIDENCE_SOURCE,
              gmail_message_id: match.gmail_message_id,
              sent_on: match.transfer_date,
              amount: match.transfer_amount,
              recipient_name: match.recipient_name,
              confirmation_suffix: match.suffix,
              status: match.transfer_status,
              match_method: match.match_method,
              bank_posted_on: match.bank_date,
            },
          };
    const updateResult = await db
      .from("financial_transactions")
      .update({
        counterparty: supplierName,
        source_data: {
          ...sourceData,
          ...transferEvidence,
        },
      })
      .eq("id", match.transaction_id);
    if (updateResult.error) throw updateResult.error;
  }

  const upsertResult = await db
    .from("labour_payment_records")
    .upsert(paymentRecords, { onConflict: "financial_transaction_id" });
  if (upsertResult.error) throw upsertResult.error;
}

const verificationResult = applyChanges
  ? await db
      .from("labour_payment_verification")
      .select("financial_transaction_id,recipient_status")
      .in(
        "financial_transaction_id",
        contractorPaymentMatches.map((match) => match.transaction_id),
      )
  : { data: [], error: null };
if (verificationResult.error) throw verificationResult.error;
const evidenceVerificationResult = applyChanges
  ? await db
      .from("financial_transactions")
      .select("id,counterparty,source_data")
      .in(
        "id",
        subcontractorEvidenceMatches.map((match) => match.transaction_id),
      )
  : { data: [], error: null };
if (evidenceVerificationResult.error) throw evidenceVerificationResult.error;
if (
  applyChanges &&
  ((verificationResult.data ?? []).length !== contractorPaymentMatches.length ||
    (verificationResult.data ?? []).some(
      (record) => record.recipient_status !== "confirmed",
    ))
) {
  throw new Error("Post-apply recipient verification failed.");
}
if (
  applyChanges &&
  ((evidenceVerificationResult.data ?? []).length !==
    subcontractorEvidenceMatches.length ||
    (evidenceVerificationResult.data ?? []).some((transaction) => {
      const evidenceMatch = subcontractorEvidenceMatches.find(
        (match) => match.transaction_id === transaction.id,
      );
      const evidence =
        evidenceMatch?.evidence_kind === "easyweb_history"
          ? transaction.source_data?.easyweb_e_transfer_evidence
          : transaction.source_data?.td_interac_email_evidence;
      return (
        !transaction.counterparty ||
        evidence?.confirmation_suffix !== evidenceMatch?.suffix
      );
    }))
) {
  throw new Error("Post-apply e-transfer evidence verification failed.");
}

console.log(
  JSON.stringify(
    {
      mode: applyChanges ? "applied" : "read-only",
      project_ref: projectRef,
      easyweb_transfer_evidence_count: transfers.length,
      email_transfer_evidence_count: emailTransfers.length,
      matched_bank_transaction_count: matches.length,
      exact_amount_match_count: matches.filter((match) => match.amount_matches)
        .length,
      contractor_payment_count: contractorPaymentMatches.length,
      subcontractor_evidence_count: subcontractorEvidenceMatches.length,
      easyweb_subcontractor_evidence_count: subcontractorEvidenceMatches.filter(
        (match) => match.evidence_kind === "easyweb_history",
      ).length,
      email_subcontractor_evidence_count: subcontractorEvidenceMatches.filter(
        (match) => match.evidence_kind === "td_confirmation_email",
      ).length,
      payment_record_count: paymentRecords.length,
      created_contractors: applyChanges ? missingContractors : [],
      excluded_subcontractor_matches: excludedSubcontractorMatches,
      unmatched_transfers: transfers.filter(
        (transfer) => !matchedEasyWebSuffixes.has(transfer.suffix),
      ),
      unmatched_email_transfers: emailTransfers.filter(
        (transfer) => !matchedEmailSuffixes.has(transfer.suffix),
      ),
      unmatched_subcontractor_transactions: (transactionsResult.data ?? [])
        .filter(
          (transaction) =>
            transaction.category === "Subcontractors" &&
            !matchedTransactionIds.has(transaction.id),
        )
        .map((transaction) => ({
          transaction_id: transaction.id,
          bank_date: transaction.posted_on,
          bank_amount: Math.abs(Number(transaction.amount)),
          suffix: maskedSuffix(transaction),
          description: transaction.description,
          counterparty: transaction.counterparty,
        })),
      category_summary: matches.reduce((summary, match) => {
        summary[match.category] = (summary[match.category] ?? 0) + 1;
        return summary;
      }, {}),
      matches,
    },
    null,
    2,
  ),
);
