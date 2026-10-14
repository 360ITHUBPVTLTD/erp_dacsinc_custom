"""Create the database sequence of every "autoincrement" doctype that is missing one.

Frappe numbers such documents from a MariaDB sequence (<doctype>_id_seq). A doctype switched to
autoincrement after its table existed (Uniform Embroidery Transfer here) never got one, so the
first insert failed with "Unknown SEQUENCE: 'uniform_embroidery_transfer_id_seq'". The sequence
starts after the highest existing number. Safe to run again (existing sequences are left alone)."""

import frappe
from frappe.utils import cint


def execute():
    existing = {r[0] for r in frappe.db.sql("SHOW FULL TABLES WHERE Table_type = 'SEQUENCE'")}
    for dt in frappe.get_all("DocType", filters={"autoname": "autoincrement", "is_virtual": 0, "issingle": 0}, pluck="name"):
        seq = frappe.scrub(dt) + "_id_seq"
        if seq in existing or not frappe.db.table_exists(dt):
            continue
        last = frappe.db.sql(f"SELECT MAX(CAST(name AS UNSIGNED)) FROM `tab{dt}`")[0][0]
        frappe.db.create_sequence(dt, check_not_exists=True, start_value=cint(last) + 1)
        print(f"created sequence {seq} starting at {cint(last) + 1}")
