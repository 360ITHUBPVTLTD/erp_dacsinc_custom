// Stock Entry form: an entry that belongs to an Embroidery Transfer (Order Flow › Embroidery Transfers) says so
// at the top — the transfer (EM/…), sent to / received back from which jobber, its notes and status —
// read from the transfer (uniform_transfer_api.transfer_of_stock_entry), so older entries show it too.
// docs/order-flow-dashboard.md › Embroidery Transfers.
frappe.ui.form.on('Stock Entry', {
    refresh(frm) {
        if (frm.is_new() || !['Material Transfer', 'Repack'].includes(frm.doc.purpose)) return;
        const name = frm.doc.name;
        frappe.xcall('erp_dacsinc_custom.uniform_transfer_api.transfer_of_stock_entry', { stock_entry: name })
            .then((t) => {
                if (!t || frm.doc.name !== name) return;   // the form moved on to another entry meanwhile
                const esc = frappe.utils.escape_html;
                const link = `<a href="/app/embroidery-work-order/${encodeURIComponent(t.transfer)}"><b>${esc(t.transfer)}</b></a>`;
                const jobber = esc(t.jobber_name || t.jobber || '');
                let html = t.sent
                    ? __('Embroidery Transfer {0} — sent to {1}', [link, `<b>${jobber}</b>`])
                    : __('Embroidery Transfer {0} — received back from {1}', [link, `<b>${jobber}</b>`]);
                html += ` · ${__('Status')}: ${esc(__(t.status || ''))}`;
                if ((t.notes || '').trim()) html += `<br>${__('Notes')}: ${esc(t.notes.trim())}`;
                frm.dashboard.set_headline_alert(`<div>${html}</div>`, 'blue');
            })
            .catch(() => {});
    },
});
