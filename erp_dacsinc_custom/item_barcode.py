"""Item › Barcode (custom_barcode) and the Barcodes table, kept in step — docs/item-barcode.md.

The Barcode field is what people type; the Barcodes table (Item Barcode) is what scanning and printing read.
Runs on before_validate, so the table is right BEFORE ERPNext's own validate_barcode checks it, and is saved
with the item (the old on_update hook appended a row after the save, which was never stored).

  - Barcode set / changed  → its row is in the table (the old value's row, if it changed, is removed);
  - Barcode cleared        → the old value's row is removed;
  - row deleted in the table while Barcode was not touched → Barcode follows the table (the next
    barcode in it, or empty), instead of the row coming back;
  - type: CODE-39 only when the value is a valid CODE-39 (capitals, digits, space - . $ / + %); otherwise
    no type — ERPNext then accepts any value, and scanning works the same. Every row typed CODE-39 that
    isn't valid CODE-39 loses the type too, or ERPNext refuses the save ("… is not a valid CODE-39 code").
"""

import barcodenumber
import frappe
from frappe import _
from frappe.utils import cstr

CODE39 = "CODE-39"


def barcode_type(value):
	return CODE39 if value and barcodenumber.check_code("code39", value) else ""


def before_validate(doc, method=None):
	new = cstr(doc.get("custom_barcode")).strip()
	if new != cstr(doc.get("custom_barcode")):
		doc.custom_barcode = new
	before = doc.get_doc_before_save() if not doc.is_new() else None
	old = cstr(before.get("custom_barcode")).strip() if before else ""
	rows = doc.get("barcodes") or []

	had_row = bool(before) and any(r.barcode == old for r in before.get("barcodes") or [])
	if new == old and old and had_row and not any(r.barcode == old for r in rows):
		# the user deleted the row and left the field alone: the field follows the table (an item whose
		# row was never saved — the old hook's bug — has no row before either, and keeps its barcode)
		doc.custom_barcode = new = (rows[0].barcode if rows else "")
		old = new

	if old and old != new:
		doc.set("barcodes", [r for r in rows if r.barcode != old])
		rows = doc.get("barcodes")

	if new:
		dup = frappe.db.get_value("Item Barcode", {"barcode": new, "parent": ["!=", doc.name]}, "parent")
		if dup and new != old:
			frappe.throw(_("Barcode {0} is already used in Item {1}.").format(
				frappe.bold(new), frappe.bold(dup)), title=_("Duplicate barcode"))
		if dup:
			# an old duplicate (loaded that way): don't block every other edit of the item — say so,
			# and leave it out of this item's table until one of the two is corrected
			frappe.msgprint(_("Barcode {0} is also on Item {1}, so it is not in this item's Barcodes table. "
							  "Give one of them a different barcode.").format(frappe.bold(new), frappe.bold(dup)),
							title=_("Duplicate barcode"), indicator="orange")
			return _tidy(doc)
		row = next((r for r in rows if r.barcode == new), None)
		if not row:
			row = doc.append("barcodes", {"barcode": new})
		row.uom = row.uom or doc.stock_uom
		row.barcode_type = barcode_type(new)

	_tidy(doc)


def _tidy(doc):
	"""The item's own barcode (the Barcode field) first, the rest in the order they were added, numbered
	1, 2, 3… — removing / appending rows above left two rows with the same No. Drops CODE-39 from any
	row whose value isn't CODE-39, or ERPNext refuses the save."""
	main = cstr(doc.get("custom_barcode")).strip()
	rows = sorted(doc.get("barcodes") or [], key=lambda r: (r.barcode != main, r.idx or 0))
	for i, r in enumerate(rows, 1):
		r.idx = i
		if r.barcode_type == CODE39 and not barcode_type(r.barcode):
			r.barcode_type = ""
	doc.set("barcodes", rows)


def missing_rows(fix=False):
	"""Items whose Barcode field has no row in their Barcodes table (left by the old on_update hook).
	Returns {"fill": [...], "duplicate": [...]}; with fix=True adds the row to every "fill" item —
	the Item Barcode row only (no item save, no modified change). Duplicates (the barcode is on another
	item already) are only listed: which item keeps it is for the client to say."""
	rows = frappe.db.sql("""
		SELECT i.name, i.custom_barcode, i.stock_uom,
			(SELECT b.parent FROM `tabItem Barcode` b WHERE b.barcode = i.custom_barcode AND b.parent != i.name LIMIT 1) AS on_item,
			(SELECT j.name FROM `tabItem` j WHERE j.custom_barcode = i.custom_barcode AND j.name != i.name LIMIT 1) AS field_on_item
		FROM `tabItem` i
		WHERE IFNULL(i.custom_barcode, '') != ''
		  AND NOT EXISTS (SELECT 1 FROM `tabItem Barcode` b WHERE b.parent = i.name AND b.barcode = i.custom_barcode)
		ORDER BY i.name""", as_dict=True)
	out = {"fill": [], "duplicate": []}
	for r in rows:
		(out["duplicate"] if r.on_item or r.field_on_item else out["fill"]).append(r)
	if fix:
		on = frappe.utils.formatdate(frappe.utils.today(), "dd-MM-yyyy")
		for r in out["fill"]:
			parent = frappe.get_doc("Item", r.name)
			code = r.custom_barcode.strip()
			parent.append("barcodes", {"barcode": code, "uom": r.stock_uom, "barcode_type": barcode_type(code)}).db_insert()
			# every record changed by a data fix carries a dated note of what changed
			parent.add_comment("Comment", f"{on}: barcode {code} added to the Barcodes table — the Barcode field had it "
										  "but the row was never saved (old barcode hook). Other barcodes unchanged.")
	return {k: len(v) for k, v in out.items()} if fix else out
