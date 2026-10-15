import frappe
A = ["Bank Charges A/c","Round Off Account","Job Work Charges","jobwork expenses","Annual Subriciption","Misc Expenses","Sundry Exp","Expenses A/c",
 "Telephone Charges","Travelling Exp","Computer Stationery & Printing","Computer Stationery & Peripherals","Vehicle Maintainence","Car Maintainence",
 "Office Maintenance Expenses","Commission on Sales","Business Promotion A/c","Marketing Expenses","TDS","TDS on Labour Charges",
 "Phone Pay Private Limited","Phonepe Private Limited","Pragathi Advertisers","Manibhadra Stationery World","Sravanya Foods","Textile Mirror",
 "Creatives Geekz","East Exxim Agencies Ltd","Provab Techno Soft Pvt Ltd","RATHANAMMA","S.Square Solutions","K & N Associates",
 "Service Invoice (Bhandari Ventures)","SERVICE INVOICE (D.M& CO)","Entry Tax","Vat Audit Fees","TIN Regn  (Deposit)","EMI on Car","Bank Account",
 "TDS Receivable","TCS Receivable A/c","Salary Advance","Travelling Advance","Yes bank - 1445 - Bank O/D","VAT Refund 06-07 &09-10"]
SKIP = {"Account", "GL Entry", "Payment Ledger Entry", "Account Closing Balance", "Version", "Deleted Document"}
def link_fields():
    out = []
    for dt, fn in frappe.db.sql("select parent, fieldname from tabDocField where fieldtype='Link' and options='Account'"):
        out.append((dt, fn))
    for dt, fn in frappe.db.sql("select dt, fieldname from `tabCustom Field` where fieldtype='Link' and options='Account'"):
        out.append((dt, fn))
    return [(d, f) for d, f in out if d not in SKIP and not frappe.get_meta(d).issingle and frappe.db.table_exists(d)]
def run():
    lf = link_fields()
    print("link fields:", len(lf))
    for a in A:
        name = a + " - IND"
        if not frappe.db.exists("Account", name):
            print("MISSING", name); continue
        gl = frappe.db.count("GL Entry", {"account": name, "is_cancelled": 0})
        refs = []
        for dt, fn in lf:
            try:
                n = frappe.db.sql(f"select count(*) from `tab{dt}` where `{fn}`=%s", name)[0][0]
            except Exception:
                continue
            if n: refs.append(f"{dt}.{fn}={n}")
        print(f"{a:38} gl={gl:<4} refs={', '.join(refs) or '-'}")
    for f in ["default_bank_account","default_cash_account","round_off_account","write_off_account","default_expense_account","default_income_account","stock_adjustment_account","default_receivable_account","default_payable_account"]:
        print("Company.", f, "=", frappe.db.get_value("Company", "Dac's Inc", f))
    for p in frappe.get_all("POS Profile", fields=["name","account_for_change_amount","write_off_account"]):
        print("POS", p)
