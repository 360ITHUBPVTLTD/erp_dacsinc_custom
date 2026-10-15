# Chart of accounts — corrections and rules

The company's chart came over from Tally with ledgers in the wrong groups, duplicates and vendor
names as expense ledgers. `patches/correct_chart_of_accounts.py` (in `patches.txt`, runs once on
migrate, idempotent; `execute(dry_run=1)` reports only) corrects it:

| Change | Accounts |
|---|---|
| Moved to **Tax Assets**, type Tax (claimed back, so an asset) | TDS Receivable, TCS Receivable A/c |
| Moved to **Loans and Advances (Assets)** (an advance is owed back, not an expense) | Salary Advance, Travelling Advance |
| Moved to **Loans (Liabilities)**, type Bank | Yes bank - 1445 - Bank O/D |
| Account Type **Tax** | TDS Payable, TDS on Contract / Commission / Interest / Labour / Professional / Purchases / Rent, TCS On Sales, TCS Payable A/c |
| Company **default bank** → `092484600001445 - YES BANK` (was the generic "Bank Account") | Company |
| POS Profile "Account for Change Amount" no longer the generic "Bank Account" (blank = company cash account) | JP Nagar |
| **Disabled, only when unused** (no GL Entry, no Link-to-Account field anywhere points at it) | duplicates (Bank Charges A/c, Round Off Account, jobwork expenses, Annual Subriciption, Misc Expenses, Sundry Exp, Expenses A/c, Telephone Charges, Travel Expenses, Computer Stationery & Printing / & Peripherals, Vehicle Maintainence, Car Maintainence, Office Maintenance Expenses, Commission on Sales, Business Promotion A/c, TDS, TDS on Labour Charges), EMI on Car, pre-GST (Entry Tax, Vat Audit Fees, TIN Regn (Deposit)), vendor-named ledgers (Pragathi Advertisers, Manibhadra Stationery World, Sravanya Foods, Textile Mirror, Creatives Geekz, East Exxim Agencies Ltd, Provab Techno Soft Pvt Ltd, RATHANAMMA, S.Square Solutions, K & N Associates, Service Invoice (Bhandari Ventures), SERVICE INVOICE (D.M& CO), Phone Pay / Phonepe Private Limited) |

An account still in use is kept and listed ("KEEP … in use"); the run's list goes to the Error Log
("Chart of accounts corrections"). Posted amounts never change — only groups, types and the
disabled flag.

## Rules from here

- **One ledger per kind of expense.** Kept: Bank Charges, Rounded Off, Job Work Charges, Annual
  Subscription, Miscellaneous Expenses, Telephone Expenses, Travelling Exp, Print and Stationery,
  Vehicle Repairs & Maintenance, Repairs & Maintainence, Commission Paid, Marketing Expenses.
- **Vendors are Suppliers**, never ledgers; their bills go to an expense by nature. The vendors
  above have no Supplier record yet — create them before their next bill.
- **TDS by section:** TDS on Contract (194C, jobbers), TDS on Professional (194J), TDS on Rent
  (194I), TDS on Commission (194H), TDS on Purchases (194Q); TDS Payable for anything else.
  Customers' TDS → TDS Receivable (asset). The Receive / Pay prompt follows this
  (`dashboard_payment._supplier_tds_account`) and refuses non-TDS / non-expense ledgers.
- **EMI**: principal to the loan (HDFC Car Loan), interest to Interest on Emi (Car Loan).

## Not changed (needs the CA)

VAT Refund 06-07 &09-10 (asset if still receivable, else written off); "Bank Account" (has a
posting, so kept enabled — no longer the default); staff loan ledgers per person; supplier
"advance / deposit" ledgers; whether "Yes bank - 1445 - Bank O/D" is the same bank account as
"092484600001445 - YES BANK"; the opening-balance problems (opening stock against Stock Adjustment,
fixed assets without cost, no opening balances).
