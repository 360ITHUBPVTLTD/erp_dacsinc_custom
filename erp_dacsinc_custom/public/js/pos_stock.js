// POS stores (pos_scope.py), for a new document made from a POS login:
// - Material Request: target = the user's store warehouse, source = the stores'
//   supply warehouse (Admin Settings › POS Stock Requests, e.g. VV Puram - IND);
// - Stock Entry (transfer): source = the user's store warehouse; the receiving
//   store (target) submits it once received — POS Admin may submit any;
// - Material Request: "Stock at the selected warehouses" panel (custom_stock_panel)
//   shows, per item row, the stock at its target and source warehouse, so a request
//   or transfer can be made against what is really there.

function pos_apply_store_defaults(frm) {
	if (!frm.is_new() || frm.__pos_defaults_done) return;
	frm.__pos_defaults_done = true;
	frappe.call({ method: "erp_dacsinc_custom.pos_scope.get_my_pos_defaults" }).then((r) => {
		const d = r.message || {};
		const wh = d.warehouse;
		if (!wh && !d.source_warehouse) return;
		if (frm.doctype === "Material Request") {
			if (frm.doc.material_request_type !== "Material Transfer") frm.set_value("material_request_type", "Material Transfer");
			if (wh && !frm.doc.set_warehouse) frm.set_value("set_warehouse", wh);
			if (d.source_warehouse && !frm.doc.set_from_warehouse && d.source_warehouse !== wh)
				frm.set_value("set_from_warehouse", d.source_warehouse);
		} else if (frm.doctype === "Stock Entry") {
			if (!frm.doc.stock_entry_type) frm.set_value("stock_entry_type", "Material Transfer");
			if (wh && !frm.doc.from_warehouse) frm.set_value("from_warehouse", wh);
		}
	});
}

function mr_stock_panel(frm) {
	const field = frm.fields_dict.custom_stock_panel;
	if (!field) return;
	clearTimeout(frm.__mr_stock_timer);
	frm.__mr_stock_timer = setTimeout(() => {
		const rows = (frm.doc.items || []).filter((d) => d.item_code).map((d) => ({
			item_code: d.item_code, qty: d.qty, uom: d.stock_uom || d.uom,
			warehouse: d.warehouse || frm.doc.set_warehouse,
			from_warehouse: d.from_warehouse || frm.doc.set_from_warehouse,
		}));
		if (!rows.length) {
			field.$wrapper.html(`<div class="text-muted small">${__("Add items to see their stock at the selected warehouses.")}</div>`);
			return;
		}
		frappe.call({ method: "erp_dacsinc_custom.pos_scope.get_stock_for_rows", args: { rows } }).then((r) => {
			const stock = r.message || {};
			const qty = (item, wh) => (wh && stock[`${item}||${wh}`]) ? stock[`${item}||${wh}`].actual : 0;
			const esc = frappe.utils.escape_html;
			const body = rows.map((d) => {
				const at = d.warehouse ? qty(d.item_code, d.warehouse) : null;
				const from = d.from_warehouse ? qty(d.item_code, d.from_warehouse) : null;
				const short = from !== null && from < (d.qty || 0);
				return `<tr>
					<td>${esc(d.item_code)}</td>
					<td class="text-right">${format_number(d.qty || 0)} ${esc(d.uom || "")}</td>
					<td class="text-right">${at === null ? "—" : `<b>${format_number(at)}</b><div class="text-muted small">${esc(d.warehouse)}</div>`}</td>
					<td class="text-right">${from === null ? "—" : `<b style="color:${short ? "var(--red-600)" : "var(--green-600)"}">${format_number(from)}</b><div class="text-muted small">${esc(d.from_warehouse)}</div>`}</td>
					<td>${from === null ? "" : short
						? `<span class="indicator-pill red">${__("Short by {0}", [format_number((d.qty || 0) - from)])}</span>`
						: `<span class="indicator-pill green">${__("Available")}</span>`}</td>
				</tr>`;
			}).join("");
			field.$wrapper.html(`
				<div class="small text-muted" style="margin-bottom:6px;">${__("Stock right now (actual qty), per item row")}</div>
				<table class="table table-bordered table-condensed" style="margin:0;">
					<thead><tr><th>${__("Item")}</th><th class="text-right">${__("Requested")}</th>
						<th class="text-right">${__("At target warehouse")}</th><th class="text-right">${__("At source warehouse")}</th><th></th></tr></thead>
					<tbody>${body}</tbody>
				</table>`);
		});
	}, 300);
}

// POS users (POS Admin / POS Store Manager, admins excluded): the MR type is always
// Material Transfer and can't be changed (also forced on the server, pos_notify).
function pos_lock_mr_type(frm) {
	const pos_user = frappe.user.has_role(["POS Admin", "POS Store Manager"])
		&& !frappe.user.has_role(["Administrator", "System Manager", "Admin", "Super Admin"]);
	if (!pos_user && !frm.doc.custom_is_pos_request) return;
	if (frm.doc.docstatus === 0 && frm.doc.material_request_type !== "Material Transfer")
		frm.set_value("material_request_type", "Material Transfer");
	frm.set_df_property("material_request_type", "read_only", 1);
}

frappe.ui.form.on("Material Request", {
	onload: pos_apply_store_defaults,
	refresh(frm) { pos_lock_mr_type(frm); mr_stock_panel(frm); },
	set_warehouse: mr_stock_panel,
	set_from_warehouse: mr_stock_panel,
	items_add: mr_stock_panel,
	items_remove: mr_stock_panel,
});

frappe.ui.form.on("Material Request Item", {
	item_code: mr_stock_panel,
	qty: mr_stock_panel,
	warehouse: mr_stock_panel,
	from_warehouse: mr_stock_panel,
});

// POS transfers to / from the supply warehouse (VV Puram - IND) wait for warehouse
// approval: Warehouse Incharge / Warehouse Executive / POS Admin approve (= submit);
// for anyone else Submit is hidden (pos_notify.guard_pos_approval enforces it).
function pos_transfer_approval_state(frm) {
	if (!frm.doc.custom_is_pos_transfer || frm.is_new() || frm.doc.docstatus !== 0) return;
	frappe.call({ method: "erp_dacsinc_custom.pos_notify.get_pos_transfer_state", args: { name: frm.doc.name } }).then((r) => {
		const st = r.message || {};
		if (!st.needs_approval) return;
		if (st.can_approve) {
			frm.dashboard.set_headline(__("POS transfer to / from the supply warehouse — waiting for your approval."), "orange");
			frm.page.set_primary_action(__("Approve"), () => frm.savesubmit());
		} else {
			frm.dashboard.set_headline(__("Waiting for warehouse approval — Warehouse Incharge, Warehouse Executive or POS Admin submits this transfer."), "orange");
			frm.page.clear_primary_action();
		}
	});
}

frappe.ui.form.on("Stock Entry", {
	onload: pos_apply_store_defaults,
	refresh(frm) {
		if (frm.doc.custom_is_pos_transfer && frm.doc.docstatus === 1 && frm.doc.custom_approved_by) {
			frm.dashboard.set_headline(__("Warehouse approval: approved by {0}", [frappe.user.full_name(frm.doc.custom_approved_by)]), "green");
		}
		pos_transfer_approval_state(frm);
	},
});
