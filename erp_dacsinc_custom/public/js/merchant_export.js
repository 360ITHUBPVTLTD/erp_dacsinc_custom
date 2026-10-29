// "Merchant Export - GST 0.1%" tick on Quotation / Sales Order / Delivery Note / Sales Invoice (merchant_export.py,
// docs/item-taxes.md): shown only for a customer ticked Merchant Exporter (0.1% GST). Ticking puts every line whose
// item lists GST 0.1% - IND on it; unticking puts those lines back on their normal GST. The server does the same on
// save (apply_document_tick), so new lines added while ticked get 0.1% too.
(function () {
    const TEMPLATE = 'GST 0.1% - IND';
    const FIELD = 'custom_merchant_export';
    const M = 'erp_dacsinc_custom.merchant_export.';

    const customer_of = (frm) => frm.doctype === 'Quotation'
        ? (frm.doc.quotation_to === 'Customer' ? frm.doc.party_name : null)
        : frm.doc.customer;

    // show the tick only for a merchant exporter (or when it is already ticked, so it can be unticked)
    async function show_tick(frm) {
        if (!frm.fields_dict[FIELD]) return;
        const cust = customer_of(frm);
        let ok = false;
        if (cust) {
            const r = await frappe.db.get_value('Customer', cust, 'custom_merchant_exporter');
            ok = !!(r && r.message && cint(r.message.custom_merchant_exporter));
        }
        frm.toggle_display(FIELD, ok || cint(frm.doc[FIELD]));
        frm.set_df_property(FIELD, 'read_only', frm.doc.docstatus !== 0);
    }

    async function apply(frm) {
        const rows = (frm.doc.items || []).filter(r => r.item_code);
        if (cint(frm.doc[FIELD])) {
            const r = await frappe.call({ method: M + 'items_with_template', args: { item_codes: rows.map(r => r.item_code) } });
            const allowed = new Set(r.message || []);
            for (const row of rows) {
                if (allowed.has(row.item_code) && row.item_tax_template !== TEMPLATE) {
                    await frappe.model.set_value(row.doctype, row.name, 'item_tax_template', TEMPLATE);
                }
            }
            frappe.show_alert({ message: __('Lines set to GST 0.1% (merchant export).'), indicator: 'blue' });
        } else {
            if (!rows.some(r => r.item_tax_template === TEMPLATE)) return;
            const r = await frappe.call({ method: M + 'get_default_templates', args: { doc: frm.doc } });
            const back = r.message || {};
            for (const row of rows) {
                if (back[row.name]) await frappe.model.set_value(row.doctype, row.name, 'item_tax_template', back[row.name]);
            }
            frappe.show_alert({ message: __('Lines put back on their normal GST.'), indicator: 'blue' });
        }
    }

    const handlers = {
        refresh: show_tick,
        customer: show_tick,
        party_name: show_tick,
        quotation_to: show_tick,
        [FIELD]: apply,
    };
    ['Quotation', 'Sales Order', 'Delivery Note', 'Sales Invoice'].forEach(dt => frappe.ui.form.on(dt, handlers));
})();
