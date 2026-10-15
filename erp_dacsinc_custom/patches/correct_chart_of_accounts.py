"""Chart of accounts corrections (agreed 2026-10-15; see docs/chart-of-accounts.md).

Runs once on migrate, for every company that has these accounts. Idempotent and cautious:
  * accounts in the wrong group are moved (their root type follows the new parent);
  * TDS / TCS ledgers get Account Type "Tax";
  * duplicate, legacy and vendor-named ledgers are disabled ONLY when nothing uses them — no GL
    Entry and no document / setting / template links to them (any Link-to-Account field);
  * the company's default bank account and the POS "change amount" account stop pointing at the
    generic "Bank Account" ledger.
Anything it cannot do safely is skipped and listed in the output (and the Error Log).

`execute(dry_run=True)` (bench execute ...correct_chart_of_accounts.execute --kwargs "{'dry_run': 1}")
only reports what it would do.
"""

import frappe
from frappe.utils import cint

# (account name without " - ABBR", new parent without " - ABBR", account type or None)
MOVES = [
    ("TDS Receivable", "Tax Assets", "Tax"),
    ("TCS Receivable A/c", "Tax Assets", "Tax"),
    ("Salary Advance", "Loans and Advances (Assets)", None),
    ("Travelling Advance", "Loans and Advances (Assets)", None),
    ("Yes bank - 1445 - Bank O/D", "Loans (Liabilities)", "Bank"),
]

TAX_TYPE = [
    "TDS Payable", "TDS on Contract", "TDS on Commission", "TDS on Interest", "TDS on Labour",
    "TDS on Professional", "TDS on Purchases", "TDS on Rent", "TCS On Sales", "TCS Payable A/c",
]

# Disabled only when unused. The ledger kept for each duplicate is in the comment.
DISABLE_IF_UNUSED = [
    "Bank Charges A/c",                    # keep Bank Charges
    "Round Off Account",                   # keep Rounded Off (the company round-off account)
    "jobwork expenses",                    # keep Job Work Charges
    "Annual Subriciption",                 # keep Annual Subscription
    "Misc Expenses", "Sundry Exp", "Expenses A/c",  # keep Miscellaneous Expenses
    "Telephone Charges",                   # keep Telephone Expenses
    "Travel Expenses",                     # keep Travelling Exp (used by an Expense Claim Type)
    "Computer Stationery & Printing", "Computer Stationery & Peripherals",  # keep Print and Stationery
    "Vehicle Maintainence", "Car Maintainence",  # keep Vehicle Repairs & Maintenance
    "Office Maintenance Expenses",          # keep Repairs & Maintainence
    "Commission on Sales",                 # keep Commission Paid
    "Business Promotion A/c",              # keep Marketing Expenses (in use) / Advertisement / Sales Promotion
    "TDS",                                 # keep TDS Payable and the section-wise TDS ledgers
    "TDS on Labour Charges",               # keep TDS on Labour
    "EMI on Car",                          # EMI = loan repayment (HDFC Car Loan) + Interest on Emi
    "Entry Tax", "Vat Audit Fees", "TIN Regn  (Deposit)",  # pre-GST
    # vendors kept as expense ledgers: they belong in Supplier, the bill in an expense by nature
    "Phone Pay Private Limited", "Phonepe Private Limited", "Pragathi Advertisers",
    "Manibhadra Stationery World", "Sravanya Foods", "Textile Mirror", "Creatives Geekz",
    "East Exxim Agencies Ltd", "Provab Techno Soft Pvt Ltd", "RATHANAMMA", "S.Square Solutions",
    "K & N Associates", "Service Invoice (Bhandari Ventures)", "SERVICE INVOICE (D.M& CO)",
]

GENERIC_BANK = "Bank Account"
MAIN_BANK = "092484600001445 - YES BANK"

_SKIP_DOCTYPES = {"Account", "GL Entry", "Payment Ledger Entry", "Account Closing Balance", "Version", "Deleted Document"}


def _account_link_fields():
    rows = frappe.db.sql("select parent, fieldname from tabDocField where fieldtype='Link' and options='Account'")
    rows += frappe.db.sql("select dt, fieldname from `tabCustom Field` where fieldtype='Link' and options='Account'")
    out = []
    for dt, fn in rows:
        if dt in _SKIP_DOCTYPES or not frappe.db.exists("DocType", dt):
            continue
        meta = frappe.get_meta(dt)
        if meta.issingle or not frappe.db.table_exists(dt) or not frappe.db.has_column(dt, fn):
            continue
        out.append((dt, fn))
    return out


def _uses(account, link_fields):
    """Where the account is used: GL entries and any Link-to-Account field. Empty = unused."""
    found = []
    gl = frappe.db.count("GL Entry", {"account": account, "is_cancelled": 0})
    if gl:
        found.append(f"GL Entry ({gl})")
    for dt, fn in link_fields:
        n = frappe.db.sql(f"select count(*) from `tab{dt}` where `{fn}` = %s", account)[0][0]
        if n:
            found.append(f"{dt}.{fn} ({n})")
    return found


def execute(dry_run=False):
    dry_run = cint(dry_run)
    log = []
    say = lambda m: (log.append(m), print(m))
    link_fields = _account_link_fields()

    for company, abbr in frappe.get_all("Company", fields=["name", "abbr"], as_list=True):
        acc = lambda n: f"{n} - {abbr}"
        exists = lambda n: frappe.db.exists("Account", {"name": acc(n), "company": company})

        # 1. moves (and type)
        for name, parent, acc_type in MOVES:
            if not exists(name):
                continue
            if not frappe.db.exists("Account", {"name": acc(parent), "company": company, "is_group": 1}):
                say(f"SKIP move {acc(name)}: group {acc(parent)} not found")
                continue
            doc = frappe.get_doc("Account", acc(name))
            if doc.is_group:
                say(f"SKIP move {acc(name)}: it is a group")
                continue
            if doc.parent_account == acc(parent) and (not acc_type or doc.account_type == acc_type):
                continue
            say(f"MOVE {acc(name)}: {doc.parent_account} -> {acc(parent)}" + (f", type {acc_type}" if acc_type else ""))
            if not dry_run:
                doc.parent_account = acc(parent)
                if acc_type:
                    doc.account_type = acc_type
                doc.flags.ignore_permissions = True
                doc.save()

        # 2. Account Type "Tax" on TDS / TCS ledgers
        for name in TAX_TYPE:
            if exists(name) and not frappe.db.get_value("Account", acc(name), "is_group") \
                    and frappe.db.get_value("Account", acc(name), "account_type") != "Tax":
                say(f"TYPE {acc(name)}: Tax")
                if not dry_run:
                    frappe.db.set_value("Account", acc(name), "account_type", "Tax")

        # 3. company default bank and the POS change-amount account away from the generic ledger
        generic, main = acc(GENERIC_BANK), acc(MAIN_BANK)
        if frappe.db.exists("Account", main):
            if frappe.db.get_value("Company", company, "default_bank_account") in (None, "", generic):
                say(f"COMPANY {company}: default bank account -> {main}")
                if not dry_run:
                    frappe.db.set_value("Company", company, "default_bank_account", main)
        for pos in frappe.get_all("POS Profile", filters={"company": company, "account_for_change_amount": generic}, pluck="name"):
            say(f"POS {pos}: change-amount account {generic} -> (blank = company cash account)")
            if not dry_run:
                frappe.db.set_value("POS Profile", pos, "account_for_change_amount", None)

        # 4. disable unused duplicates / legacy / vendor-named ledgers
        for name in DISABLE_IF_UNUSED:
            if not exists(name) or frappe.db.get_value("Account", acc(name), "disabled"):
                continue
            if frappe.db.get_value("Account", acc(name), "is_group"):
                say(f"SKIP disable {acc(name)}: it is a group")
                continue
            used = _uses(acc(name), link_fields)
            if used:
                say(f"KEEP {acc(name)}: in use — {', '.join(used)}")
                continue
            say(f"DISABLE {acc(name)}")
            if not dry_run:
                doc = frappe.get_doc("Account", acc(name))
                doc.disabled = 1
                doc.flags.ignore_permissions = True
                doc.save()

    if not dry_run and log:
        frappe.log_error(title="Chart of accounts corrections", message="\n".join(log))
    return log
