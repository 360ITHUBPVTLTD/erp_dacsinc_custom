"""POS closing: returns that don't depend on the shift's own sales are booked before them (docs/pos-store-scope.md ›
Exchanges at closing).

ERPNext's POS Invoice Merge Log makes the shift's consolidated Sales Invoice first and its credit notes after. A store
exchange — the customer brings back a shirt bought earlier (a return on its own, or against an already-closed bill) and
takes another — then fails at closing whenever the item sold is the one just returned and the store had none before: the
sale is booked while the returned piece isn't in stock yet ("1 units of … needed in … Store"), though the POS screen
allowed it (it counts the shift's returns). Here those independent returns go first, so the returned stock is in when
the sales are booked. Returns of a bill from the same shift stay after the sales, exactly as ERPNext does: their credit
note is made against that consolidated invoice, and their stock went out with it.

The independent returns' credit note is posted one second before the closing time: the sale's stock check counts only
entries strictly before its own posting time, so a credit note at the very same second would not count yet. A shift
without such a return runs ERPNext's own code unchanged.

Cancelling: ERPNext cancels only the consolidated invoice and the last credit note it noted, so a shift with more than
one credit note (an exchange plus a return of its own bill — or, in ERPNext too, returns against several earlier
closings) left the others submitted. Here every invoice the shift's bills were merged into is cancelled, newest first
(the reverse of how they were booked, so stock never runs short on the way).
"""

from datetime import timedelta

import frappe
from erpnext.accounts.doctype.pos_invoice_merge_log.pos_invoice_merge_log import POSInvoiceMergeLog
from erpnext.stock.utils import get_combine_datetime
from frappe.utils import getdate


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
		closing_time = self.posting_time
		earlier = get_combine_datetime(self.posting_date, self.posting_time) - timedelta(seconds=1)
		# a credit note can't be dated before the invoice it returns against (a closing made in the same second)
		originals = [k for k in self.distinguish_return_pos_invoices(independent) if k]
		latest = max((get_combine_datetime(*frappe.db.get_value("Sales Invoice", k, ["posting_date", "posting_time"]))
			for k in originals), default=None)
		if earlier.date() == getdate(self.posting_date) and (not latest or earlier > latest):
			self.posting_time = earlier.time()
		try:
			credit_notes.update(self.process_merging_into_credit_notes(self.distinguish_return_pos_invoices(independent)))
		finally:
			self.posting_time = closing_time

		sales_invoice, sales_invoice_doc = "", None
		if sales:
			sales_invoice_doc = self.process_merging_into_sales_invoice(sales)
			sales_invoice = sales_invoice_doc.name

		if of_shift:
			credit_notes.update(self.process_merging_into_credit_notes(
				self.distinguish_return_pos_invoices(of_shift, sales_invoice_doc)))

		self.save()  # consolidated_invoice / consolidated_credit_note refs on the merge log
		self.update_pos_invoices(pos_invoice_docs, sales_invoice, credit_notes)

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
