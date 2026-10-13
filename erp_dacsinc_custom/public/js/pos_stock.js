// POS stores (pos_scope.py):
// - warehouses on Material Request / Stock Entry: see pos_apply_store_defaults below;
// - Stock Entry (transfer): the receiving store (target) submits it once received — POS
//   Admin may submit any;
// - Material Request: "Stock at the selected warehouses" panel (custom_stock_panel)
//   shows, per item row, the stock at its target and source warehouse, so a request
//   or transfer can be made against what is really there.

// Warehouses (pos_scope.get_my_pos_defaults / enforce_*_warehouses, also enforced on save):
// - POS Store Manager: Material Request source = VV Puram, target = their store (header and
//   rows, locked; on several stores they pick among their own). Their own Stock Entry
//   transfer: source = their store (locked); the target is theirs to choose among the other
//   POS stores and VV Puram. Set every time, not only when empty: ERPNext pre-fills
//   Stock Settings › Default Warehouse (VV Puram) on new documents.
// - POS Admin: defaults on a new document only, nothing locked.
function pos_defaults(frm) {
	if (!frm.__pos_defaults) {
		frm.__pos_defaults = frappe.call({ method: "erp_dacsinc_custom.pos_scope.get_my_pos_defaults" }).then((r) => r.message || {});
	}
	return frm.__pos_defaults;
}

function pos_apply_store_defaults(frm) {
	pos_defaults(frm).then((d) => {
		if (!d.warehouse && !d.source_warehouse && !d.locked) return;
		if (d.locked) return pos_lock_store_warehouses(frm, d);
		if (!frm.is_new() || frm.__pos_defaults_done) return;
		frm.__pos_defaults_done = true;
		const wh = d.warehouse;
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

function pos_lock_store_warehouses(frm, d) {
	if (frm.doc.docstatus !== 0) return;
	const mine = d.store_warehouses || [];
	if (!mine.length) return;
	const grid = frm.fields_dict.items && frm.fields_dict.items.grid;
	if (frm.doctype === "Material Request") {
		if (!frm.is_new() && !frm.doc.custom_is_pos_request) return;
		const target = mine.includes(frm.doc.set_warehouse) ? frm.doc.set_warehouse : mine[0];
		if (frm.doc.material_request_type !== "Material Transfer") frm.set_value("material_request_type", "Material Transfer");
		if (frm.doc.set_from_warehouse !== d.source_warehouse) frm.set_value("set_from_warehouse", d.source_warehouse);
		if (frm.doc.set_warehouse !== target) frm.set_value("set_warehouse", target);
		frm.set_df_property("set_from_warehouse", "read_only", 1);
		frm.set_df_property("set_warehouse", "read_only", mine.length === 1 ? 1 : 0);
		frm.set_query("set_warehouse", () => ({ filters: { name: ["in", mine] } }));
		if (grid) ["warehouse", "from_warehouse"].forEach((f) => grid.update_docfield_property(f, "read_only", 1));
		(frm.doc.items || []).forEach((r) => pos_mr_row_warehouses(frm, r));
	} else if (frm.doctype === "Stock Entry") {
		// only the store's own transfer; HO's transfer for a request / another store's transfer stay as they are
		if (!(frm.is_new() || frm.doc.owner === frappe.session.user)) return;
		if ((frm.doc.items || []).some((r) => r.material_request)) return;
		if (frm.doc.stock_entry_type && frm.doc.purpose && frm.doc.purpose !== "Material Transfer") return;
		if (!frm.doc.stock_entry_type) frm.set_value("stock_entry_type", "Material Transfer");
		const source = mine.includes(frm.doc.from_warehouse) ? frm.doc.from_warehouse : mine[0];
		const targets = (d.targets || []).concat(mine).filter((w) => w !== source);
		if (frm.doc.from_warehouse !== source) frm.set_value("from_warehouse", source);
		// a new transfer: the store picks the target itself (ERPNext pre-fills Stock Settings' VV Puram)
		if (frm.is_new() && !frm.__pos_target_cleared) {
			frm.__pos_target_cleared = true;
			if (frm.doc.to_warehouse) frm.set_value("to_warehouse", "");
		} else if (frm.doc.to_warehouse && !targets.includes(frm.doc.to_warehouse)) frm.set_value("to_warehouse", "");
		frm.set_df_property("from_warehouse", "read_only", mine.length === 1 ? 1 : 0);
		frm.set_query("from_warehouse", () => ({ filters: { name: ["in", mine] } }));
		frm.set_query("to_warehouse", () => ({ filters: { name: ["in", targets] } }));
		frm.set_query("t_warehouse", "items", () => ({ filters: { name: ["in", targets] } }));
		if (grid) grid.update_docfield_property("s_warehouse", "read_only", 1);
		(frm.doc.items || []).forEach((r) => {
			if (r.s_warehouse !== source) frappe.model.set_value(r.doctype, r.name, "s_warehouse", source);
			if (r.t_warehouse && !targets.includes(r.t_warehouse)) frappe.model.set_value(r.doctype, r.name, "t_warehouse", frm.doc.to_warehouse || "");
		});
	}
}

function pos_mr_row_warehouses(frm, row) {
	pos_defaults(frm).then((d) => {
		if (!d.locked || frm.doc.docstatus !== 0) return;
		if (row.warehouse !== frm.doc.set_warehouse) frappe.model.set_value(row.doctype, row.name, "warehouse", frm.doc.set_warehouse);
		if (row.from_warehouse !== frm.doc.set_from_warehouse) frappe.model.set_value(row.doctype, row.name, "from_warehouse", frm.doc.set_from_warehouse);
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

// POS store requests (pos_request.py): the status line and the one next action, the
// same dialogs as the workspace board (pos_requests_board.js). The store can't submit;
// HO approves (= submit), dispatches; the store receives.
function pos_request_form(frm) {
	const status = frm.doc.custom_pos_request_status;
	if (!status || frm.is_new() || !window.erp_pos_requests) return;
	const R = window.erp_pos_requests;
	const reload = () => frm.reload_doc();
	frappe.call({ method: "erp_dacsinc_custom.pos_request.get_request", args: { name: frm.doc.name } }).then((r) => {
		const d = r.message || {}, can = d.can || {};
		if (frm.doc.docstatus === 0) frm.page.clear_primary_action();
		const head = (text, color) => frm.dashboard.set_headline(text, color);
		if (status === "Draft") {
			head(__("Draft — send it to HO for approval when it's ready. HO approves it and sends the stock."), "blue");
		} else if (status === "Rejected") {
			head(__("Rejected by HO: {0}. Change it and send it again.", [frappe.utils.escape_html(frm.doc.custom_pos_rejection_reason || "")]), "red");
		} else if (status === "Pending HO Approval") {
			head(can.review ? __("Waiting for your approval.") : __("Waiting for HO approval — it can't be changed meanwhile."), "orange");
			if (!can.review) frm.disable_save();
		} else if (status === "Approved" || status === "Partly Received") {
			head(status === "Approved" ? __("Approved by HO — HO makes the transfer to the store.") : __("Part received — HO sends the rest."), "blue");
		} else if (status === "In Transit") {
			head(can.receive ? __("HO has sent it. When it arrives, press Check & Receive, check the qty and submit the transfer.")
				: __("HO has made the transfer — waiting for the store to check and submit it."), "purple");
		} else if (status === "Received") {
			head(__("Received at the store."), "green");
		}
		if (can.send) frm.page.set_primary_action(__("Send for HO Approval"), () =>
			(frm.is_dirty() ? frm.save() : Promise.resolve()).then(() => R.send(frm.doc.name, reload)));
		if (can.review) {
			frm.page.set_primary_action(__("Review & Approve"), () => R.review(frm.doc.name, reload));
		}
		if (can.dispatch) frm.page.set_primary_action(__("Send to store"), () => R.dispatch(frm.doc.name, reload));
		if (can.purchase) frm.add_custom_button(__("Purchase shortfall"), () => R.purchase(frm.doc.name));
		if (can.receive) frm.page.set_primary_action(__("Check & Receive"), () => R.receive(frm.doc.name));
	});
}

frappe.ui.form.on("Material Request", {
	onload: pos_apply_store_defaults,
	refresh(frm) { pos_lock_mr_type(frm); pos_apply_store_defaults(frm); mr_stock_panel(frm); pos_request_form(frm); },
	set_warehouse: mr_stock_panel,
	set_from_warehouse: mr_stock_panel,
	items_add: mr_stock_panel,
	items_remove: mr_stock_panel,
});

frappe.ui.form.on("Material Request Item", {
	items_add(frm, cdt, cdn) { pos_mr_row_warehouses(frm, locals[cdt][cdn]); },
	item_code(frm, cdt, cdn) { pos_mr_row_warehouses(frm, locals[cdt][cdn]); mr_stock_panel(frm); },
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

// A transfer into a POS store (pos_request.guard_transfer_submit): it stays a draft (In Transit)
// until the receiving store accepts it — a POS user there, not the sender, checks what arrived
// and submits it. Everyone else sees whose turn it is, and no Submit.
function pos_request_transfer_state(frm) {
	if (frm.is_new() || frm.doc.docstatus !== 0 || !(frm.doc.items || []).some((d) => d.t_warehouse)) return;
	frappe.call({ method: "erp_dacsinc_custom.pos_request.get_transfer_state", args: { name: frm.doc.name } }).then((r) => {
		const st = r.message || {};
		if (!st.store) return;
		if (st.can_submit) {
			frm.dashboard.set_headline((st.requests || []).length
				? __("Stock sent by HO for request {0}. Check what arrived — lower a qty if less came — then Submit.", [st.requests.join(", ")])
				: __("Transfer from {0} to your store. Check what arrived — lower a qty if less came — then Submit to accept it.", [st.source]), "blue");
		} else {
			frm.dashboard.set_headline(st.is_sender
				? __("Sent to {0}. A POS user there accepts it (Submit) when the stock arrives; until then it is In Transit.", [st.store])
				: __("In transit to {0} — the store checks what arrived and submits it.", [st.store]), "orange");
			frm.page.clear_primary_action();
		}
	});
}

frappe.ui.form.on("Stock Entry", {
	onload: pos_apply_store_defaults,
	stock_entry_type: pos_apply_store_defaults,
	refresh(frm) {
		pos_apply_store_defaults(frm);
		pos_request_transfer_state(frm);
		if (frm.doc.custom_is_pos_transfer && frm.doc.docstatus === 1 && frm.doc.custom_approved_by) {
			frm.dashboard.set_headline(__("Warehouse approval: approved by {0}", [frappe.user.full_name(frm.doc.custom_approved_by)]), "green");
		}
		pos_transfer_approval_state(frm);
	},
});
