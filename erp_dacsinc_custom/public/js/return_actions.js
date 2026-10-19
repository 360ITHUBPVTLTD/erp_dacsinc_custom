// Credit / Debit Note (a return) on its form: what it did in the accounts, and the right button —
// no "Receive Payment" (nothing is received on a return), but Refund / Receive Refund when the
// return carries its own balance, and Adjust (Payment Reconciliation) against unpaid invoices.
// Same rules as Order Flow › Finance › Returns / Notes (order_flow_api._describe_notes).
window.dacs_return_actions = function (frm) {
		const d = frm.doc;
		if (!cint(d.is_return)) return;
		const credit = d.doctype === 'Sales Invoice';
		const party_type = credit ? 'Customer' : 'Supplier';
		const party = credit ? d.customer : d.supplier;
		const money = (v) => format_currency(Math.abs(flt(v)), d.currency);
		if (d.docstatus === 0) {
			frm.set_intro(credit
				? __('Credit Note (sales return): enter only the items and quantities being returned, as negative numbers (-1, -2 …). Submit applies it.')
				: __('Debit Note (purchase return): enter only the items and quantities being returned, as negative numbers (-1, -2 …). Submit applies it.'), 'blue');
			return;
		}
		if (d.docstatus !== 1) return;
		const out = flt(d.outstanding_amount);
		if (out < -0.005) {
			frm.set_intro(credit
				? __('Customer credit {0}: adjust it against their unpaid invoices (Adjust), or refund it (Refund to Customer).', [money(out)])
				: __('The supplier owes us {0}: adjust it against their unpaid bills (Adjust), or receive the refund.', [money(out)]), 'orange');
			if (frappe.model.can_create('Payment Entry')) {
				frm.add_custom_button(credit ? __('Refund to Customer') : __('Receive Refund from Supplier'), () => {
					frappe.require('/assets/erp_dacsinc_custom/js/payment_prompt.js', () =>
						of_refund_prompt(d.doctype, d.name, () => frm.reload_doc(), { from_form: 1 }));
				}).addClass(credit ? 'btn-warning' : 'btn-success');
			}
			frm.add_custom_button(__('Adjust (Payment Reconciliation)'), () => {
				const q = new URLSearchParams({ company: d.company, party_type, party });
				window.open(`/app/payment-reconciliation?${q.toString()}`, '_blank');
			});
		} else if (d.return_against && !cint(d.update_outstanding_for_self)) {
			frm.set_intro(credit
				? __('This credit note reduced {0} by {1}. Nothing to refund.', [d.return_against, money(d.grand_total)])
				: __('This debit note reduced {0} by {1}. Nothing to receive.', [d.return_against, money(d.grand_total)]), 'green');
		} else {
			frm.set_intro(__('Settled — refunded or adjusted.'), 'green');
		}
	};
