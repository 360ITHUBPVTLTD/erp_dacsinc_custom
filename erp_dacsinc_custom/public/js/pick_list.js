// Reducing "Picked Qty" below what this row was allocated for its own
// Sales Order leaves that difference in the shared stock pool — any OTHER
// Sales Order line for the same item + warehouse can pick it from here on.
// That's often exactly the intent (deliberately handing spare stock to
// another order), but it happens silently otherwise: nothing on this form
// says the leftover is now up for grabs. Purely informational — never
// blocks the edit — the Item Stock & Action Plan's own "Picked (Others)"
// column is what actually shows it happening once another order claims it.
frappe.ui.form.on("Pick List Item", {
    picked_qty(frm, cdt, cdn) {
        const row = locals[cdt][cdn];
        if (!row.sales_order || !row.item_code) return;

        const allocated = flt(row.qty);
        const picked = flt(row.picked_qty);
        const leftover = allocated - picked;

        if (leftover > 0.001) {
            frappe.show_alert({
                message: __(
                    "{0} {1} of {2} left unpicked for {3} — becomes available for other Sales Orders needing the same item in {4} to pick.",
                    [leftover.toFixed(2), row.stock_uom || row.uom || "", frappe.utils.escape_html(row.item_code),
                        frappe.utils.escape_html(row.sales_order), frappe.utils.escape_html(row.warehouse || "")]
                ),
                indicator: "orange"
            }, 9);
        }
    }
});


// Full Piece embroidery on the Pick List itself, and "undo Submit".
//  - While qty is out at the jobber: a big AT JOBBER banner + title
//    indicator, and the Submit button is removed (the server's before_submit
//    guard refuses it anyway).
//  - After it comes back the history stays (sent → back per EWO).
//  - A SUBMITTED Pick List with no Delivery Note made from it gets
//    "Revert to Draft" (cancel + amend — so_embroidery.revert_pick_list_to_draft),
//    e.g. submitted by mistake and now needed for embroidery. Once a DN
//    exists the form says so instead.
// Data: so_embroidery.get_pick_list_state.
frappe.ui.form.on("Pick List", {
    refresh(frm) {
        if (frm.is_new()) return;
        frappe.call({
            method: "erp_dacsinc_custom.so_embroidery.get_pick_list_state",
            args: { pick_list: frm.doc.name },
        }).then(r => {
            const st = r.message || {};
            const hist = st.history || [];
            const esc = frappe.utils.escape_html;
            const held = flt(st.hold_qty);
            const thumbs = (t) => (t.attachments || []).filter(a => a.is_image).slice(0, 4).map(a =>
                `<a href="${encodeURI(a.file_url)}" target="_blank" title="${esc(a.file_name)}"><img src="${encodeURI(a.file_url)}" style="width:28px; height:28px; object-fit:cover; border:1px solid #d1d8dd; border-radius:3px; vertical-align:middle; margin-left:4px;"></a>`).join("");
            const lines = hist.map(t => `<b>${esc(t.ewo)}</b>${t.jobber ? " · " + esc(t.jobber) : ""}: `
                + __("sent {0} → back {1}", [t.sent, t.received]) + (flt(t.at_jobber) > 0.001 ? ` <b>(${t.at_jobber} ${__("at jobber")})</b>` : " ✓") + thumbs(t)).join("<br>");

            if (held > 0.001) {
                frm.page.set_indicator(__("At Jobber"), "purple");
                frm.dashboard.set_headline_alert(`
                    <div style="font-size:15px; font-weight:700; color:#6b21a8;">
                        <i class="fa fa-magic"></i> ${__("AT JOBBER — {0} sent for embroidery", [held])}</div>
                    <div style="margin:2px 0 4px;">${__("This Pick List cannot be submitted, deleted, or reduced below {0} until the goods are received back from the jobber.", [held])}</div>
                    ${lines}`, "orange");
                if (frm.doc.docstatus === 0) frm.page.clear_primary_action();
            } else if (hist.length) {
                const sent = hist.reduce((a, t) => a + flt(t.sent), 0);
                frm.dashboard.set_headline_alert(`
                    <div style="font-weight:700; color:#166534;"><i class="fa fa-check"></i> ${__("Embroidery done — {0} sent and all back. You can submit this Pick List.", [sent])}</div>
                    ${lines}`, "green");
            }

            if (frm.doc.docstatus === 1) {
                if (st.revertable) {
                    frm.add_custom_button(__("Revert to Draft"), () => {
                        frappe.confirm(__("Bring this Pick List back to draft? It is cancelled and amended as a new draft with the same qty (e.g. to send it for embroidery)."), () => {
                            frappe.call({
                                method: "erp_dacsinc_custom.so_embroidery.revert_pick_list_to_draft",
                                args: { pick_list: frm.doc.name }, freeze: true, freeze_message: __("Reverting…"),
                            }).then(res => { if (res.message) frappe.set_route("Form", "Pick List", res.message); });
                        });
                    });
                } else if ((st.delivery_notes || []).length) {
                    frm.dashboard.add_comment(__("Delivery Note {0} is made from this Pick List — it can no longer go back to draft.",
                        [st.delivery_notes.map(n => frappe.utils.get_form_link("Delivery Note", n, true)).join(", ")]), "blue", true);
                }
            }
        });
    },
});
