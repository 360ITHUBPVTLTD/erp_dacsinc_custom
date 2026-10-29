// Cancelling a Bulk Payment, or one of its Payment Entries, says first exactly what will happen
// (docs/bulk-payment.md › Bulk Payment lifecycle). Replaces Frappe's generic "Cancel All Documents" step, which on a
// Payment Entry offered to cancel the whole Bulk Payment (and every other party's entry) without saying so.
//   Payment Entry of a Bulk Payment: what this entry settles (reopens) and what happens to the Bulk Payment —
//     [Cancel only this payment] · [Cancel the whole Bulk Payment] · Go back
//   Bulk Payment: every entry that will be cancelled with it and what each settles — [Cancel all] · Go back
// Data: bulk_payment.cancel_preview; the whole one: bulk_payment.cancel_bulk_payment.
window.dacs_bulk_cancel = function (frm, btn, callback, on_error) {
	const M = "erp_dacsinc_custom.erp_dacsinc_custom.doctype.bulk_payment.bulk_payment.";
	const is_entry = frm.doctype === "Payment Entry";
	const esc = frappe.utils.escape_html;
	const money = (v) => format_currency(flt(v, 2));
	const link = (dt, n) => `<a href="/app/${frappe.router.slug(dt)}/${encodeURIComponent(n)}" target="_blank">${esc(n)}</a>`;
	const back = () => frm.handle_save_fail(btn, on_error);
	// cancel this form's document now, without Frappe's linked-documents step (this dialog was the confirmation)
	const cancel_this = () => frm._cancel(btn, callback, on_error, true);

	frappe.call({ method: M + "cancel_preview", args: is_entry ? { payment_entry: frm.doc.name } : { bulk_payment: frm.doc.name } }).then(r => {
		const p = r.message;
		if (!p) return cancel_this();
		const receive = p.payment_type === "Receive";
		const settles = (e) => (e.refs || []).map(x => `${link(x.reference_doctype, x.reference_name)} ${money(x.allocated_amount)}`)
			.concat(e.advance > 0.005 ? [__("advance {0}", [money(e.advance)])] : []).join(", ") || "—";
		const row = (e, me) => `<tr class="${me ? "is-me" : ""}"><td>${link("Payment Entry", e.name)}${me ? ` <span class="dbc-me">${__("this one")}</span>` : ""}<small>${esc(e.party_name)}</small></td>
			<td>${settles(e)}</td><td class="r"><b>${money(e.amount)}</b></td></tr>`;
		const table = (list, me) => `<table class="dbc-t"><tr><th>${__("Payment Entry")}</th><th>${__("Settles (reopens if cancelled)")}</th><th class="r">${receive ? __("Received") : __("Paid")}</th></tr>
			${list.map(e => row(e, e.name === me)).join("")}</table>`;
		const css = `<style>
			.dbc-t { width: 100%; border-collapse: collapse; margin: 6px 0 12px; font-size: 12.5px; }
			.dbc-t th { background: #3498DB; color: #fff; padding: 6px 10px; text-align: left; font-size: 11.5px; } .dbc-t th.r, .dbc-t td.r { text-align: right; white-space: nowrap; }
			.dbc-t td { padding: 7px 10px; border-bottom: 1px solid var(--border-color); vertical-align: top; } .dbc-t td small { display: block; color: var(--text-muted); }
			.dbc-t tr.is-me td { background: #fff7e6; } .dbc-me { background: #f39c12; color: #fff; border-radius: 8px; font-size: 10.5px; padding: 1px 7px; font-weight: 700; }
			.dbc-box { border-radius: 10px; padding: 10px 12px; margin-bottom: 10px; font-size: 13px; }
			.dbc-box.is-one { background: #fff7e6; border: 1px solid #f8c471; } .dbc-box.is-all { background: #fdedec; border: 1px solid #f5b7b1; }
			.dbc-box ul { margin: 6px 0 0 18px; padding: 0; }</style>`;
		const others = p.entries.filter(e => e.name !== p.this);
		const me = p.entries.find(e => e.name === p.this);
		let html, d;
		if (is_entry) {
			const last = !others.length;
			html = `${css}<div>${__("This payment is part of Bulk Payment {0} ({1} payment entries still standing, {2}).", [link("Bulk Payment", p.bulk_payment), p.entries.length, money(p.entries.reduce((a, e) => a + e.amount, 0))])}</div>
				${table(p.entries, p.this)}
				<div class="dbc-box is-one"><b>${__("Cancel only this payment")}</b><ul>
					<li>${__("{0} {1} from {2} is cancelled; what it settled is due again: {3}.", [money(me ? me.amount : 0), receive ? __("received") : __("paid"), esc(me ? me.party_name : ""), me ? settles(me) : "—"])}</li>
					<li>${last ? __("It is the last one: Bulk Payment {0} is cancelled too.", [esc(p.bulk_payment)])
						: __("Bulk Payment {0} becomes <b>Partly Cancelled</b>; its other {1} payment(s) stay as they are: {2}.", [esc(p.bulk_payment), others.length, others.map(e => esc(e.name)).join(", ")])}</li>
					<li>${__("To pay it again later, make a new payment (or Amend this one) — it will be a payment of its own.")}</li></ul></div>
				${p.can_cancel_bulk && !last ? `<div class="dbc-box is-all"><b>${__("Cancel the whole Bulk Payment")}</b> — ${__("cancels all {0} payments above; everything they settled is due again.", [p.entries.length])}</div>` : ""}`;
			d = new frappe.ui.Dialog({ title: __("Cancel {0}?", [frm.doc.name]), size: "large", fields: [{ fieldtype: "HTML", fieldname: "b" }] });
			d.set_primary_action(__("Cancel only this payment"), () => { d.hide(); cancel_this(); });
			if (p.can_cancel_bulk && !last) {
				d.set_secondary_action_label(__("Cancel the whole Bulk Payment"));
				d.set_secondary_action(() => frappe.confirm(__("Cancel Bulk Payment {0} and all its {1} payments?", [p.bulk_payment, p.entries.length]), () => {
					d.hide();
					frappe.call({ method: M + "cancel_bulk_payment", args: { bulk_payment: p.bulk_payment }, freeze: true, freeze_message: __("Cancelling…") })
						.then(() => { frm.reload_doc(); callback && callback(); }).catch(back);
				}));
			}
		} else {
			html = `${css}<div class="dbc-box is-all">${__("Cancelling Bulk Payment {0} cancels these {1} payment(s); everything they settled is due again.", [esc(p.bulk_payment), p.entries.length])}
				${p.cancelled_amount > 0.005 ? "<br>" + __("{0} was already cancelled earlier (rows ticked Cancelled).", [money(p.cancelled_amount)]) : ""}</div>
				${p.entries.length ? table(p.entries, null) : `<div class="text-muted">${__("No payment entry of it is still standing.")}</div>`}
				<div class="text-muted">${__("To cancel only one party's payment, open that Payment Entry and cancel it there.")}</div>`;
			d = new frappe.ui.Dialog({ title: __("Cancel {0}?", [frm.doc.name]), size: "large", fields: [{ fieldtype: "HTML", fieldname: "b" }] });
			d.set_primary_action(__("Cancel all"), () => { d.hide(); cancel_this(); });
		}
		d.fields_dict.b.$wrapper.html(html);
		d.get_primary_btn().removeClass("btn-primary").addClass("btn-danger");
		d.show();
	});
};
