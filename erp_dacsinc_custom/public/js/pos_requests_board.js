// POS store requests (pos_request.py, docs/pos-store-scope.md).
// - erp_pos_requests.mount(el): the board on the POS / POS Admin / POS HO workspaces
//   (Custom HTML Block "POS Requests Board" loads this file). Count tiles per stage and the
//   requests of the chosen stage, each with the one action that moves it on.
// - "Store Transfers": draft transfers into a store not made for a request (store to store),
//   waiting for the receiving store to accept them (pos_request.guard_transfer_submit).
// - The same dialogs (send, review, dispatch, receive, purchase shortfall) are used by the
//   Material Request form (pos_stock.js), so the board and the form always behave alike.
// What a user may do comes from the server (row.can / get_request().can); the server
// checks it again on every action.
(function () {
	if (window.erp_pos_requests) return;
	const M = "erp_dacsinc_custom.pos_request.";
	const esc = (v) => frappe.utils.escape_html(v == null ? "" : String(v));
	const num = (v) => format_number(flt(v), null, flt(v) % 1 ? 2 : 0);
	const COLORS = {
		"Draft": "gray", "Pending HO Approval": "orange", "Rejected": "red", "Approved": "blue",
		"In Transit": "purple", "Partly Received": "yellow", "Received": "green", "Cancelled": "gray",
	};
	const TAB_COLORS = { pending: "#d97706", draft: "#6b7280", dispatch: "#2563eb", transit: "#7c3aed", transfers: "#0891b2", received: "#16a34a" };
	const HINTS = {
		pending: __("Waiting for HO to approve"),
		draft: __("Not sent yet, or sent back by HO"),
		dispatch: __("Approved — HO makes the transfer"),
		transit: __("Transfer made — the store checks and submits it"),
		transfers: __("Store to store — the receiving store accepts it"),
		received: __("Delivered to the store — last 30 days"),
	};

	function call(method, args, freeze_message) {
		return frappe.call({ method: M + method, args, freeze: true, freeze_message }).then((r) => r.message);
	}

	// ---------------------------------------------------------------- actions
	function send(name, done) {
		frappe.confirm(__("Send {0} to HO for approval? You can't change it while HO reviews it.", [name.bold()]), () =>
			call("send_for_approval", { name }, __("Sending…")).then((r) => {
				frappe.show_alert({ message: r.mailed && r.mailed.length ? __("Sent to HO — they have been emailed.") : __("Sent to HO."), indicator: "green" });
				done && done();
			}));
	}

	// the dialog grids are fixed lists: no add / upload buttons, no row tick boxes
	function plain_grid(dlg) {
		const w = dlg.fields_dict.rows && dlg.fields_dict.rows.grid && dlg.fields_dict.rows.grid.wrapper;
		if (!w) return;
		w.find(".grid-footer, .grid-add-row, .grid-add-multiple-rows, .grid-upload").addClass("hidden");
		w.find(".grid-row-check, .row-check").css("visibility", "hidden");
	}

	function head_html(d) {
		return `<div class="small" style="margin-bottom:8px;line-height:1.7">
			<b>${esc(d.store_label || d.store)}</b> ${__("from")} ${esc(d.source)} · ${__("raised by")} ${esc(d.owner_name)}
			· ${__("required by")} ${esc(frappe.datetime.str_to_user(d.schedule_date))}
			${d.rejection_reason ? `<div class="text-danger">${__("Rejected earlier")}: ${esc(d.rejection_reason)}</div>` : ""}</div>`;
	}

	function review(name, done) {
		call("get_request", { name }).then((d) => {
			const dlg = new frappe.ui.Dialog({
				title: __("Review {0}", [name]),
				size: "large",
				fields: [
					{ fieldtype: "HTML", fieldname: "head", options: head_html(d) },
					{
						fieldtype: "Table", fieldname: "rows", cannot_add_rows: true, cannot_delete_rows: true, in_place_edit: true,
						data: d.rows.map((r) => ({ row: r.name, item_code: r.item_code, qty: r.qty, free: r.free_at_source, at_store: r.at_store })),
						fields: [
							{ fieldtype: "Data", fieldname: "row", hidden: 1 },
							{ fieldtype: "Link", options: "Item", fieldname: "item_code", label: __("Item"), read_only: 1, in_list_view: 1, columns: 4 },
							{ fieldtype: "Float", fieldname: "qty", label: __("Approve qty"), in_list_view: 1, columns: 2 },
							{ fieldtype: "Float", fieldname: "free", label: __("Free at source"), read_only: 1, in_list_view: 1, columns: 2 },
							{ fieldtype: "Float", fieldname: "at_store", label: __("At store"), read_only: 1, in_list_view: 1, columns: 2 },
						],
					},
					{ fieldtype: "HTML", options: `<div class="text-muted small">${__("Free at source = free stock at {0} (not counting stock held for Sales Orders or already in transfers waiting for a store). Change a qty to approve less (0 takes the item off). Approving submits the request; then send it to the store from To Send.", [esc(d.source)])}</div>` },
				],
				primary_action_label: __("Approve"),
				primary_action() {
					const qtys = {};
					(dlg.get_value("rows") || []).forEach((r) => { qtys[r.row] = flt(r.qty); });
					call("approve", { name, qtys }, __("Approving…")).then(() => {
						dlg.hide();
						frappe.show_alert({ message: __("{0} approved", [name]), indicator: "green" });
						done && done();
					});
				},
				secondary_action_label: __("Reject"),
				secondary_action() {
					frappe.prompt({ fieldtype: "Small Text", fieldname: "reason", label: __("Why? The store sees this."), reqd: 1 },
						(v) => call("reject", { name, reason: v.reason }, __("Rejecting…")).then(() => {
							dlg.hide();
							frappe.show_alert({ message: __("{0} sent back to the store", [name]), indicator: "orange" });
							done && done();
						}), __("Reject {0}", [name]), __("Reject"));
				},
			});
			dlg.show();
			plain_grid(dlg);
		});
	}

	function dispatch(name, done) {
		call("get_request", { name }).then((d) => {
			const open = d.rows.filter((r) => r.remaining > 0.0001);
			const short = open.some((r) => r.free_at_source + 0.0001 < r.remaining);
			const dlg = new frappe.ui.Dialog({
				title: __("Send to store — {0}", [name]),
				size: "large",
				fields: [
					{ fieldtype: "HTML", fieldname: "head", options: head_html(d) },
					{
						fieldtype: "Table", fieldname: "rows", cannot_add_rows: true, cannot_delete_rows: true, in_place_edit: true,
						data: open.map((r) => ({ row: r.name, item_code: r.item_code, left: r.remaining, free: r.free_at_source,
							send: Math.max(0, Math.min(r.remaining, r.free_at_source)) })),
						fields: [
							{ fieldtype: "Data", fieldname: "row", hidden: 1 },
							{ fieldtype: "Link", options: "Item", fieldname: "item_code", label: __("Item"), read_only: 1, in_list_view: 1, columns: 4 },
							{ fieldtype: "Float", fieldname: "left", label: __("Left to send"), read_only: 1, in_list_view: 1, columns: 2 },
							{ fieldtype: "Float", fieldname: "free", label: __("Free at source"), read_only: 1, in_list_view: 1, columns: 2 },
							{ fieldtype: "Float", fieldname: "send", label: __("Send now"), in_list_view: 1, columns: 2 },
						],
					},
					{ fieldtype: "HTML", options: `<div class="text-muted small">${
						(short ? __("Some items are short at {0}: send what is free now, and use Purchase shortfall for the rest.", [esc(d.source)]) + " " : "")
						+ __("This makes a draft transfer {0} → {1}. The store checks what arrived and submits it; until then it shows as In Transit.", [esc(d.source), esc(d.store_label || d.store)])}</div>` },
				],
				primary_action_label: __("Create transfer"),
				primary_action() {
					const qtys = {};
					(dlg.get_value("rows") || []).forEach((r) => { qtys[r.row] = flt(r.send); });
					if (!Object.values(qtys).some((q) => q > 0)) return frappe.msgprint(__("Enter a qty to send."));
					call("dispatch", { name, qtys }, __("Creating the transfer…")).then((r) => {
						dlg.hide();
						frappe.show_alert({ message: __("Transfer {0} made — the store submits it when the stock arrives.", [r.stock_entry]), indicator: "green" }, 8);
						done && done();
					});
				},
			});
			if (short && d.can.purchase) {
				dlg.set_secondary_action_label(__("Purchase shortfall"));
				dlg.set_secondary_action(() => { dlg.hide(); purchase(name); });
			}
			dlg.show();
			plain_grid(dlg);
		});
	}

	// The store checks what arrived in HO's draft transfer (it may lower a qty) and submits it there.
	function receive(name) {
		call("get_request", { name }).then((d) => {
			const t = d.transfers || [];
			if (!t.length) return frappe.msgprint(__("Nothing is on its way for {0}.", [name]));
			if (t.length === 1) return frappe.set_route("Form", "Stock Entry", t[0]);
			frappe.route_options = { name: ["in", t] };
			frappe.set_route("List", "Stock Entry");
		});
	}

	function purchase(name) {
		call("purchase_shortfall", { name }).then((p) => {
			frappe.model.with_doctype("Purchase Order", () => {
				const po = frappe.model.get_new_doc("Purchase Order");
				Object.assign(po, { company: p.company, schedule_date: p.schedule_date, set_warehouse: p.warehouse,
					custom_pos_material_request: p.material_request });
				p.items.forEach((i) => {
					const row = frappe.model.add_child(po, "items");
					Object.assign(row, { item_code: i.item_code, qty: i.qty, uom: i.uom, warehouse: p.warehouse, schedule_date: p.schedule_date });
				});
				frappe.set_route("Form", "Purchase Order", po.name).then(() => {
					const frm = window.cur_frm;
					if (!frm || frm.doc.name !== po.name) return;
					// fetch each item's details (name, UOM, rate) as if it had been picked
					(frm.doc.items || []).forEach((r) => {
						const qty = r.qty;
						frm.script_manager.trigger("item_code", r.doctype, r.name).then(() => frappe.model.set_value(r.doctype, r.name, "qty", qty));
					});
					frappe.show_alert({ message: __("Pick the supplier and save. The stock comes into {0}; dispatch it to the store when it arrives.", [p.warehouse]), indicator: "blue" }, 10);
				});
			});
		});
	}

	// ---------------------------------------------------------------- board
	const CSS = `
		.prb { font-size: 13px; color: var(--text-color); }
		.prb-top { display:flex; flex-wrap:wrap; gap:8px; align-items:center; justify-content:space-between; margin-bottom:12px; }
		.prb-title { font-size:16px; font-weight:600; }
		.prb-sub { color: var(--text-muted); font-size:12px; }
		.prb-tools { display:flex; gap:6px; align-items:center; }
		.prb-tools select { height:28px; border-radius:6px; border:1px solid var(--border-color); background: var(--control-bg); padding:0 8px; font-size:12px; }
		.prb-tiles { display:grid; grid-template-columns: repeat(auto-fit, minmax(140px, 1fr)); gap:8px; margin-bottom:12px; }
		.prb-tile { border:1px solid var(--border-color); border-radius:10px; padding:10px 12px; cursor:pointer; background: var(--card-bg); border-left:4px solid var(--c); }
		.prb-tile:hover { box-shadow: var(--shadow-sm); }
		.prb-tile.active { background: var(--subtle-fg); box-shadow: 0 0 0 1px var(--c) inset; }
		.prb-tile .n { font-size:22px; font-weight:700; color: var(--c); line-height:1.1; }
		.prb-tile .l { font-weight:600; margin-top:2px; }
		.prb-tile .h { color: var(--text-muted); font-size:11px; margin-top:2px; }
		.prb-row { display:flex; gap:12px; align-items:flex-start; border:1px solid var(--border-color); border-radius:10px; padding:10px 12px; margin-bottom:8px; background: var(--card-bg); }
		.prb-main { flex:1; min-width:0; }
		.prb-name { font-weight:600; cursor:pointer; color: var(--text-color); }
		.prb-name:hover { text-decoration: underline; }
		.prb-meta { color: var(--text-muted); font-size:12px; margin-top:2px; }
		.prb-items { margin-top:4px; }
		.prb-items span { display:inline-block; background: var(--subtle-fg); border-radius:6px; padding:1px 7px; margin:2px 4px 0 0; font-size:12px; }
		.prb-reason { color: var(--red-600); font-size:12px; margin-top:4px; }
		.prb-po { font-size:12px; margin-top:4px; }
		.prb-po a { cursor:pointer; }
		.prb-acts { display:flex; flex-direction:column; gap:6px; align-items:stretch; min-width:130px; }
		.prb-row.prb-late { border-left:4px solid var(--orange-500, #f97316); }
		.prb-late-badge { display:inline-block; margin-left:6px; font-size:11px; font-weight:600; color: var(--orange-700, #c2410c);
			background: var(--orange-50, #fff7ed); border:1px solid var(--orange-200, #fed7aa); border-radius:6px; padding:0 6px; }
		.prb-tile .late { color: var(--orange-700, #c2410c); font-size:11px; font-weight:600; margin-top:2px; }
		.prb-empty { text-align:center; color: var(--text-muted); padding:28px 0; border:1px dashed var(--border-color); border-radius:10px; }
		@media (max-width: 640px) { .prb-row { flex-direction:column; } .prb-acts { flex-direction:row; flex-wrap:wrap; min-width:0; } }
	`;

	function mount(el) {
		if (!el) return;
		const state = { tab: null, store: "", data: null };
		el.innerHTML = `<style>${CSS}</style><div class="prb"><div class="text-muted small">${__("Loading…")}</div></div>`;
		const root = el.querySelector(".prb");

		const load = () => frappe.call({ method: M + "get_board", args: { tab: state.tab, store: state.store } }).then((r) => {
			state.data = r.message;
			state.tab = r.message.tab;
			render();
		});

		function render() {
			const d = state.data;
			const who = d.is_store ? __("Your store") : (state.store ? (d.stores.find((s) => s.value === state.store) || {}).label : __("All stores"));
			const stores = d.stores.length
				? `<select class="prb-store"><option value="">${__("All stores")}</option>${d.stores.map((s) =>
					`<option value="${esc(s.value)}" ${s.value === state.store ? "selected" : ""}>${esc(s.label)}</option>`).join("")}</select>` : "";
			const tiles = d.tabs.map((t) => `<div class="prb-tile ${t.key === d.tab ? "active" : ""}" data-tab="${t.key}" style="--c:${TAB_COLORS[t.key]}">
				<div class="n">${t.count}</div><div class="l">${esc(t.label)}</div><div class="h">${esc(HINTS[t.key])}</div>
				${t.key === "transit" && d.late ? `<div class="late">${__("{0} waiting over {1} days", [d.late, d.late_days])}</div>` : ""}
				${t.key === "transfers" && d.late_transfers ? `<div class="late">${__("{0} waiting over {1} days", [d.late_transfers, d.late_days])}</div>` : ""}</div>`).join("");
			const rows = d.rows.length ? d.rows.map(row_html).join("")
				: `<div class="prb-empty">${__("Nothing in {0}.", [esc((d.tabs.find((t) => t.key === d.tab) || {}).label)])}</div>`;
			root.innerHTML = `
				<div class="prb-top">
					<div><div class="prb-title">${__("POS Stock Requests")}</div><div class="prb-sub">${esc(who)}</div></div>
					<div class="prb-tools">${stores}
						${d.can_create ? `<button class="btn btn-primary btn-xs prb-new">${__("+ New Request")}</button>` : ""}
						${d.can_transfer ? `<button class="btn btn-default btn-xs prb-new-transfer">${__("+ New Transfer")}</button>` : ""}
						<button class="btn btn-default btn-xs prb-refresh" title="${__("Refresh")}">↻</button>
					</div>
				</div>
				<div class="prb-tiles">${tiles}</div>
				<div class="prb-list">${rows}</div>`;
		}

		function transfer_html(r) {
			const done = r.status === "Received";
			const late = !done && r.waiting_days >= (state.data.late_days || 2);
			const items = r.items.slice(0, 6).map((i) => `<span>${esc(i.item_code)} × <b>${num(i.qty)}</b></span>`).join("")
				+ (r.items.length > 6 ? `<span>+${r.items.length - 6} ${__("more")}</span>` : "");
			const who = r.direction === "incoming" ? __("Coming to your store") : r.direction === "outgoing" ? __("Sent by your store") : "";
			const acts = [];
			if (r.can.accept) acts.push(`<button class="btn btn-success btn-xs" data-act="accept">${__("Check & accept")}</button>`);
			acts.push(`<button class="btn btn-default btn-xs" data-act="open">${__("Open")}</button>`);
			return `<div class="prb-row ${late ? "prb-late" : ""}" data-name="${esc(r.name)}" data-kind="transfer">
				<div class="prb-main">
					<div><span class="prb-name" data-act="open">${esc(r.name)}</span>
						<span class="indicator-pill ${done ? "green" : "purple"}" style="margin-left:6px">${done ? __("Received") : __("In Transit")}</span>
						<span class="text-muted small" style="margin-left:6px">${__("Store transfer")}</span>
						${who ? `<span class="text-muted small" style="margin-left:6px">${esc(who)}</span>` : ""}
						${late ? `<span class="prb-late-badge">${__("Waiting {0} days — not accepted yet", [r.waiting_days])}</span>` : ""}</div>
					<div class="prb-meta"><b>${esc(r.from)} → ${esc(r.to)}</b> · ${esc(r.owner_name)} · ${done
						? __("accepted by {0} {1}", [esc(r.accepted_by), frappe.datetime.comment_when(r.accepted_on, true)])
						: __("sent {0}", [frappe.datetime.comment_when(r.sent_on, true)])}
						· ${r.items.length} ${__("items")}, ${num(r.total_qty)} ${__("qty")}</div>
					<div class="prb-items">${items}</div>
					${done ? "" : `<div class="prb-po text-muted">${__("{0} accepts it: a POS user there checks what arrived and submits it.", [esc(r.to)])}</div>`}
				</div>
				<div class="prb-acts">${acts.join("")}</div>
			</div>`;
		}

		function row_html(r) {
			if (r.kind === "transfer") return transfer_html(r);
			const items = r.items.slice(0, 6).map((i) => `<span>${esc(i.item_code)} × <b>${num(i.qty)}</b>${
				i.dispatched > 0.0001 && i.dispatched + 0.0001 < i.qty ? ` <span class="text-muted">(${__("{0} received", [num(i.dispatched)])})</span>` : ""}</span>`).join("")
				+ (r.items.length > 6 ? `<span>+${r.items.length - 6} ${__("more")}</span>` : "");
			const late = r.status === "In Transit" && r.waiting_days != null && r.waiting_days >= (state.data.late_days || 2);
			const when = r.status === "In Transit" && r.sent_on ? __("sent to the store {0}", [frappe.datetime.comment_when(r.sent_on, true)])
				: r.status === "Pending HO Approval" && r.custom_pos_sent_on ? __("sent {0}", [frappe.datetime.comment_when(r.custom_pos_sent_on, true)])
				: r.custom_pos_approved_on && r.docstatus === 1 ? __("approved {0}", [frappe.datetime.comment_when(r.custom_pos_approved_on, true)])
				: __("updated {0}", [frappe.datetime.comment_when(r.modified, true)]);
			const acts = [];
			if (r.can.send) acts.push(`<button class="btn btn-primary btn-xs" data-act="send">${__("Send for approval")}</button>`);
			if (r.can.review) acts.push(`<button class="btn btn-primary btn-xs" data-act="review">${__("Review & approve")}</button>`);
			if (r.can.dispatch) acts.push(`<button class="btn btn-primary btn-xs" data-act="dispatch">${__("Send to store")}</button>`);
			if (r.can.purchase) acts.push(`<button class="btn btn-default btn-xs" data-act="purchase">${__("Purchase shortfall")}</button>`);
			if (r.can.receive) acts.push(`<button class="btn btn-success btn-xs" data-act="receive">${__("Check & receive")}</button>`);
			acts.push(`<button class="btn btn-default btn-xs" data-act="open">${r.can.send ? __("Edit") : __("Open")}</button>`);
			const se = (r.transfers || []).length ? `<div class="prb-po">${__("Transfer")}: ${r.transfers.map((t) =>
				`<a data-se="${esc(t)}">${esc(t)}</a>`).join(", ")} <span class="text-muted">(${__("waiting for the store to submit")})</span></div>` : "";
			const pos = r.purchase_orders.length ? `<div class="prb-po">${__("Purchase")}: ${r.purchase_orders.map((p) =>
				`<a data-po="${esc(p.name)}">${esc(p.name)}</a> <span class="text-muted">(${esc(p.status)})</span>`).join(", ")}</div>` : "";
			return `<div class="prb-row ${late ? "prb-late" : ""}" data-name="${esc(r.name)}">
				<div class="prb-main">
					<div><span class="prb-name" data-act="open">${esc(r.name)}</span>
						<span class="indicator-pill ${COLORS[r.status] || "gray"}" style="margin-left:6px">${esc(__(r.status))}</span>
						${late ? `<span class="prb-late-badge">${__("Waiting {0} days — the store hasn't submitted it", [r.waiting_days])}</span>` : ""}</div>
					<div class="prb-meta"><b>${esc(r.store)}</b> · ${esc(r.owner_name)} · ${when} · ${__("required by")} ${esc(frappe.datetime.str_to_user(r.schedule_date))}
						· ${r.items.length} ${__("items")}, ${num(r.total_qty)} ${__("qty")}</div>
					<div class="prb-items">${items}</div>
					${r.status === "Rejected" && r.custom_pos_rejection_reason ? `<div class="prb-reason">${__("Rejected")}: ${esc(r.custom_pos_rejection_reason)}</div>` : ""}
					${se}${pos}
				</div>
				<div class="prb-acts">${acts.join("")}</div>
			</div>`;
		}

		root.addEventListener("click", (e) => {
			const tile = e.target.closest(".prb-tile");
			if (tile) { state.tab = tile.dataset.tab; return load(); }
			if (e.target.closest(".prb-refresh")) return load();
			if (e.target.closest(".prb-new")) return frappe.new_doc("Material Request");
			// store to store: the source is the user's store (locked), the target their choice (pos_stock.js)
			if (e.target.closest(".prb-new-transfer")) return frappe.new_doc("Stock Entry", { stock_entry_type: "Material Transfer" });
			const po = e.target.closest("[data-po]");
			if (po) return frappe.set_route("Form", "Purchase Order", po.dataset.po);
			const sel = e.target.closest("[data-se]");
			if (sel) return frappe.set_route("Form", "Stock Entry", sel.dataset.se);
			const act = e.target.closest("[data-act]");
			const row = e.target.closest(".prb-row");
			if (!act || !row) return;
			const name = row.dataset.name;
			if (row.dataset.kind === "transfer") return frappe.set_route("Form", "Stock Entry", name);
			const handlers = { send, review, dispatch, receive: (n) => receive(n), purchase: (n) => purchase(n),
				open: (n) => frappe.set_route("Form", "Material Request", n) };
			handlers[act.dataset.act] && handlers[act.dataset.act](name, load);
		});
		root.addEventListener("change", (e) => {
			if (e.target.classList.contains("prb-store")) { state.store = e.target.value; state.tab = null; load(); }
		});

		// another user's change (a store sending, HO approving…) shows up without a reload
		let timer = null;
		const on_change = (msg) => {
			if (!document.body.contains(el.getRootNode().host || el)) return frappe.realtime.off("list_update", on_change);
			if (msg && ["Material Request", "Stock Entry"].includes(msg.doctype)) {
				clearTimeout(timer);
				timer = setTimeout(load, 1500);
			}
		};
		frappe.realtime.on("list_update", on_change);
		load();
	}

	window.erp_pos_requests = { mount, send, review, dispatch, receive, purchase };
})();
