// Purchase Receipt form. A Purchase Return (is_return) shows whether its Debit Note is made, with
// "Make Debit Note" (from the original Purchase Invoice, so it is against that bill) while it
// isn't — return_goods.py / return_actions.js › dacs_goods_status. ERPNext's own
// "Create › Debit Note" on a return is removed: it makes a note not linked to the bill.
//
// Create menu: no Landed Cost Voucher, Purchase Return, Make Stock Entry or Retention Stock Entry —
// a supplier return is made from the Purchase Invoice (Debit Note: its Update Stock tick or "Make
// Purchase Return"), and the server refuses any other (return_goods.guard_purchase_return_from_note).
const DACS_PR_HIDDEN = ['Landed Cost Voucher', 'Purchase Return', 'Make Stock Entry', 'Retention Stock Entry'];
frappe.ui.form.on('Purchase Receipt', {
	refresh(frm) {
		const hide = () => DACS_PR_HIDDEN.forEach(l => frm.remove_custom_button(__(l), __('Create')));
		hide();
		[300, 800, 1500, 2500].forEach(delay => setTimeout(hide, delay));
		$(frm.layout.wrapper).find('.dacs-rp').remove();
		if (!cint(frm.doc.is_return) || frm.is_new()) return;
		const drop = () => frm.remove_custom_button(__('Debit Note'), __('Create'));
		drop();
		[300, 800, 1500, 2500].forEach(delay => setTimeout(drop, delay));
		frappe.require('/assets/erp_dacsinc_custom/js/return_actions.js', () => window.dacs_goods_status(frm));
	},
});
