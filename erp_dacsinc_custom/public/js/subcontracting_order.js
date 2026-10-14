// Job work is received from the subcontract Purchase Order — its "Receive Finished Goods" button
// makes the Subcontracting Receipt and the Purchase Receipt together (purchase_order.py). The
// Subcontracting Order's own Create › Subcontracting Receipt is a second way that skips that
// customisation, so it is hidden here. ERPNext adds it after its own calls, hence the repeats.
frappe.ui.form.on('Subcontracting Order', {
	refresh(frm) {
		const remover = () => frm.remove_custom_button(__('Subcontracting Receipt'), __('Create'));
		remover();
		[300, 800, 1500, 2500].forEach(delay => setTimeout(remover, delay));
		if (frm.doc.docstatus === 1 && frm.doc.purchase_order && frm.doc.per_received < 100) {
			frm.set_intro(__('Receive the finished goods from the Purchase Order {0} (Receive Finished Goods).',
				[`<a href="/app/purchase-order/${encodeURIComponent(frm.doc.purchase_order)}">${frappe.utils.escape_html(frm.doc.purchase_order)}</a>`]), 'blue');
		}
	},
});
