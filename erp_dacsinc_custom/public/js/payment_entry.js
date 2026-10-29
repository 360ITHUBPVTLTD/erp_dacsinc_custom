// Payment Entry: Mode of Payment offers only the modes ticked "Show in Payment Entry"
// (payment_modes.py) — the POS counter / store modes stay out.
frappe.ui.form.on('Payment Entry', {
    setup(frm) {
        frm.set_query('mode_of_payment', () => ({
            filters: { enabled: 1, custom_show_in_payment_entry: 1 },
        }));
    },
    // Print the receipt / voucher (Payment Receipt DAC — print_prompt.js › dacs_print_url),
    // the same PDF as the 🖨 under an invoice's payments on Order Flow › Finance.
    refresh(frm) {
        if (frm.is_new()) return;
        // Receipt / Payment / Contra Voucher (print_format/payment_receipt_dac) — one label for all three
        frm.add_custom_button(__('Print Voucher'), () => window.open(dacs_print_url('Payment Entry', frm.doc.name), '_blank'))
            .css({ 'background-color': '#000', 'color': '#fff' });
        // part of a Bulk Payment: say so, and Cancel first shows what it will do — only this payment, or the whole
        // Bulk Payment (bulk_cancel.js), instead of Frappe's "Cancel All Documents"
        if (frm.doc.custom_bulk_payment) {
            frm.set_intro(__('Part of Bulk Payment {0}. Cancel shows what cancelling only this payment does, or lets you cancel the whole Bulk Payment.',
                [`<a href="/app/bulk-payment/${encodeURIComponent(frm.doc.custom_bulk_payment)}">${frm.doc.custom_bulk_payment}</a>`]), 'blue');
            if (frm.doc.docstatus === 1) {
                frm.savecancel = (btn, callback, on_error) => frappe.require('/assets/erp_dacsinc_custom/js/bulk_cancel.js',
                    () => dacs_bulk_cancel(frm, btn, callback, on_error));
            }
        }
    },
});
