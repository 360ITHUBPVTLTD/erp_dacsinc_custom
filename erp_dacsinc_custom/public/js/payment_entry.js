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
    },
});
