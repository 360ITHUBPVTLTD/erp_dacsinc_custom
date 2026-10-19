// Payment Reconciliation opened from Order Flow › Finance › Returns / Notes "Adjust" or a Credit /
// Debit Note's "Adjust" button: /app/payment-reconciliation?company=…&party_type=…&party=…
// fills those in, so the user only clicks "Get Unreconciled Entries".
frappe.ui.form.on('Payment Reconciliation', {
    refresh(frm) {
        const ro = frappe.route_options || {};
        if (!ro.party || !ro.party_type) return;
        frappe.route_options = null;
        (async () => {
            if (ro.company) await frm.set_value('company', ro.company);
            await frm.set_value('party_type', ro.party_type);
            await frm.set_value('party', ro.party);
            frappe.show_alert({ message: __('{0} {1} filled in — click Get Unreconciled Entries, then match the credit with the invoices.',
                [__(ro.party_type), ro.party]), indicator: 'blue' }, 7);
        })();
    },
});
