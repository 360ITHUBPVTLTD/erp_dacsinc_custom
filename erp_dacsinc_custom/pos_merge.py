"""POS closing: returns that don't depend on the shift's own sales are booked before them (docs/pos-store-scope.md ›
Exchanges at closing).

ERPNext's POS Invoice Merge Log makes the shift's consolidated Sales Invoice first and its credit notes after. A store
exchange — the customer brings back a shirt bought earlier (a return on its own, or against an already-closed bill) and
takes another — then fails at closing whenever the item sold is the one just returned and the store had none before: the
sale is booked while the returned piece isn't in stock yet ("1 units of … needed in … Store"), though the POS screen
allowed it (it counts the shift's returns). Here those independent returns go first, so the returned stock is in when
the sales are booked. Returns of a bill from the same shift stay after the sales, exactly as ERPNext does: their credit
note is made against that consolidated invoice, and their stock went out with it.

When: the independent returns' credit note is posted at the time of the earliest of those return bills — when the
goods really came back. ERPNext posts the shift's Sales Invoice at its last sale bill's time (merge_pos_invoice_into
takes each bill's time) but credit notes at the closing time, so even "just before the closing" was after that invoice,
and the sale's stock check (it counts only entries strictly before its own time) still found nothing (live, Varthur,
03-11-2026). The time is also kept a second before the shift's Sales Invoice, and after any invoice a return is made
against. A shift without such a return runs ERPNext's own code unchanged.

Customers: ERPNext closes a shift one customer at a time (a merge log each), in the order the customers first appear in
the closing's bills. `StorePOSClosingEntry.on_submit` (pos_closing.py) hands the bills over return bills first, so a
customer who brought something back is closed before a customer who bought it.

Cost of a returned piece: ERPNext values a return from the item's stock history in that warehouse. For a return with
no original bill it skips its own fallbacks and stops ("Valuation Rate for the Item … is required"), so an item never
stocked in that store (e.g. its opening stock not loaded) blocked the closing even with a valuation rate on the Item.
On a consolidated credit note, a line whose item has no stock history in its warehouse gets its incoming rate from the
item's latest valuation in another warehouse of the company, else ERPNext's own fallbacks (stock_ledger.get_valuation_rate:
Item valuation rate, standard rate, buying Item Price). ERPNext keeps an incoming rate already set (FIFO items); lines
with history are left to ERPNext. With none of these, ERPNext's error stands — give the Item a valuation rate.

Cancelling: ERPNext cancels only the consolidated invoice and the last credit note it noted, so a shift with more than
one credit note (an exchange plus a return of its own bill — or, in ERPNext too, returns against several earlier
closings) left the others submitted. Here every invoice the shift's bills were merged into is cancelled, newest first
(the reverse of how they were booked, so stock never runs short on the way).
"""

from datetime import timedelta

import frappe
from erpnext.accounts.doctype.pos_invoice_merge_log.pos_invoice_merge_log import POSInvoiceMergeLog
from erpnext.stock.utils import get_combine_datetime
from frappe.utils import flt


class StorePOSInvoiceMergeLog(POSInvoiceMergeLog):
	def on_submit(self):
		pos_invoice_docs = [frappe.get_cached_doc("POS Invoice", d.pos_invoice) for d in self.pos_invoices]
		sales = [d for d in pos_invoice_docs if not d.get("is_return")]
		shift_sales = {d.name for d in sales}
		returns = [d for d in pos_invoice_docs if d.get("is_return")]
		independent = [d for d in returns if d.get("return_against") not in shift_sales]
		of_shift = [d for d in returns if d.get("return_against") in shift_sales]
		if not independent:
			return super().on_submit()

		credit_notes = {}
		# a return on its own: credit note with no invoice against it; against an earlier closed bill: against
		# that bill's consolidated invoice (distinguish_return_pos_invoices with no new invoice yet)
		closing_date, closing_time = self.posting_date, self.posting_time
		when = self.independent_returns_time(independent, sales)
		self.posting_date, self.posting_time = when.date(), when.time()
		try:
			credit_notes.update(self.process_merging_into_credit_notes(self.distinguish_return_pos_invoices(independent)))
		finally:
			self.posting_date, self.posting_time = closing_date, closing_time

		sales_invoice, sales_invoice_doc = "", None
		if sales:
			sales_invoice_doc = self.process_merging_into_sales_invoice(sales)
			sales_invoice = sales_invoice_doc.name

		if of_shift:
			credit_notes.update(self.process_merging_into_credit_notes(
				self.distinguish_return_pos_invoices(of_shift, sales_invoice_doc)))

		self.save()  # consolidated_invoice / consolidated_credit_note refs on the merge log
		self.update_pos_invoices(pos_invoice_docs, sales_invoice, credit_notes)

	def independent_returns_time(self, independent, sales):
		"""The earliest return bill's time; a second before the shift's Sales Invoice (the last sale bill's time, as
		merge_pos_invoice_into sets it); never at or before an invoice a return is made against."""
		when = min(get_combine_datetime(d.posting_date, d.posting_time) for d in independent)
		if sales:
			when = min(when, get_combine_datetime(sales[-1].posting_date, sales[-1].posting_time) - timedelta(seconds=1))
		originals = [k for k in self.distinguish_return_pos_invoices(independent) if k]
		latest = max((get_combine_datetime(*frappe.db.get_value("Sales Invoice", k, ["posting_date", "posting_time"]))
			for k in originals), default=None)
		if latest and when <= latest:
			when = latest + timedelta(seconds=1)
		return when

	def on_cancel(self):
		# collected before ERPNext's on_cancel clears the bills' links (update_pos_invoices)
		self._linked_invoices = self.linked_invoices()
		super().on_cancel()

	def linked_invoices(self):
		"""Every consolidated invoice / credit note this merge made, newest first."""
		names = {self.consolidated_invoice, self.consolidated_credit_note}
		bills = [d.pos_invoice for d in self.pos_invoices]
		if bills:
			names.update(frappe.get_all("POS Invoice", filters={"name": ["in", bills]}, pluck="consolidated_invoice"))
		names = [n for n in names if n]
		return frappe.get_all("Sales Invoice", filters={"name": ["in", names]}, pluck="name", order_by="creation desc") if names else []

	def cancel_linked_invoices(self):
		for name in getattr(self, "_linked_invoices", None) or self.linked_invoices():
			si = frappe.get_doc("Sales Invoice", name)
			if si.docstatus == 1:
				si.flags.ignore_validate = True
				si.cancel()

	def merge_pos_invoice_into(self, invoice, data):
		invoice = super().merge_pos_invoice_into(invoice, data)
		if invoice.get("is_return"):
			for row in invoice.get("items") or []:
				if not flt(row.get("incoming_rate")) and row.get("item_code") and row.get("warehouse"):
					rate = returned_piece_cost(row.item_code, row.warehouse, invoice.company, invoice.currency)
					if rate:
						row.incoming_rate = rate
		return invoice


def returned_piece_cost(item_code, warehouse, company, currency):
	"""The cost of a returned piece of an item with no stock history in `warehouse` (None when it has history: ERPNext
	values it from there)."""
	if not frappe.db.get_value("Item", item_code, "is_stock_item"):
		return None
	if frappe.db.exists("Stock Ledger Entry", {"item_code": item_code, "warehouse": warehouse, "is_cancelled": 0}):
		return None
	elsewhere = frappe.db.sql("""select valuation_rate from `tabStock Ledger Entry`
		where item_code = %s and company = %s and is_cancelled = 0 and valuation_rate > 0
		order by posting_datetime desc, creation desc limit 1""", (item_code, company))
	if elsewhere:
		return flt(elsewhere[0][0])
	return flt(frappe.db.get_value("Item", item_code, "valuation_rate")
		or frappe.db.get_value("Item", item_code, "standard_rate")
		or frappe.db.get_value("Item Price", {"item_code": item_code, "buying": 1, "currency": currency}, "price_list_rate")) or None
