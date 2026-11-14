// Item Stock Ledger (/app/item-stock-ledger?item=…) — one item's stock from the first movement (docs/item-stock-ledger.md):
// stock now per warehouse, what each jobber has of it per Subcontracting Order (sent − used − returned, with PO and
// Sales Order), the orders that make it at a jobber, then every movement with what it was for — jobber / supplier /
// customer, SCO, PO, Sales Order — from → to, in, out and the total after it. Admin and Production Manager only.
// Data: item_ledger.get_item_ledger.
frappe.pages["item-stock-ledger"].on_page_load = function (wrapper) {
	const page = frappe.ui.make_app_page({ parent: wrapper, title: __("Item Stock Ledger"), single_column: true });
	const esc = frappe.utils.escape_html;
	const KINDS = [
		["all", __("All")], ["to_jobber", __("Sent to jobber")], ["used", __("Used by jobber")],
		["from_jobber", __("Back from jobber")], ["in", __("Received")], ["out", __("Delivered / sold / issued")],
		["transfer", __("Transfers")], ["opening", __("Opening")], ["count", __("Stock counts")],
	];
	let data = null, kind = "all", sco_filter = null, q = "";

	const f_item = page.add_field({
		fieldname: "item", label: __("Item"), fieldtype: "Link", options: "Item",
		get_query: () => ({ query: "erpnext.controllers.queries.item_query" }), change: () => load(),
	});
	const f_wh = page.add_field({ fieldname: "warehouse", label: __("Warehouse"), fieldtype: "Link", options: "Warehouse", change: () => load() });
	const f_from = page.add_field({ fieldname: "from_date", label: __("From"), fieldtype: "Date", change: () => load() });
	const f_to = page.add_field({ fieldname: "to_date", label: __("To"), fieldtype: "Date", change: () => load() });
	page.set_primary_action(__("Refresh"), () => load(), "refresh");
	page.add_inner_button(__("Print"), () => print());

	const $body = $(`<div class="isl"></div>`).appendTo(page.main);
	$body.before(`<style>
		.isl { padding: 4px 0 40px; font-size: 13px; }
		.isl-empty { padding: 40px; text-align: center; color: var(--text-muted); border: 1px dashed var(--border-color); border-radius: 12px; }
		.isl-head { display: flex; flex-wrap: wrap; gap: 14px 24px; align-items: center; justify-content: space-between; padding: 14px 18px; border-radius: 12px; border: 1px solid var(--border-color); border-left: 5px solid #3498DB; background: linear-gradient(90deg, #f0f7fd 0%, var(--card-bg, #fff) 60%); margin-bottom: 12px; }
		.isl-head h3 { margin: 0; font-size: 19px; font-weight: 800; } .isl-head .sub { color: var(--text-muted); font-size: 12.5px; margin-top: 2px; }
		.isl-k { display: flex; flex-wrap: wrap; gap: 8px; }
		.isl-k div { border: 1px solid var(--border-color); border-radius: 8px; padding: 6px 14px; background: var(--card-bg, #fff); min-width: 120px; }
		.isl-k span { display: block; font-size: 11.5px; color: var(--text-muted); font-weight: 600; } .isl-k b { font-size: 17px; font-variant-numeric: tabular-nums; }
		.isl-k .is-job b { color: #b9770e; }
		.isl-sec { border: 1px solid var(--border-color); border-radius: 12px; overflow: hidden; margin-bottom: 14px; background: var(--card-bg, #fff); }
		.isl-sec > h4 { margin: 0; padding: 9px 14px; font-size: 13.5px; font-weight: 800; background: #eaf3fb; border-bottom: 1px solid #d6eaf8; }
		.isl-sec > h4 small { font-weight: 400; color: var(--text-muted); margin-left: 6px; }
		.isl-wrap { overflow-x: auto; }
		.isl-t { width: 100%; border-collapse: collapse; }
		.isl-t th { background: #3498DB; color: #fff; font-size: 11px; text-transform: uppercase; letter-spacing: .03em; padding: 6px 10px; text-align: left; font-weight: 700; white-space: nowrap; }
		.isl-t td { padding: 6px 10px; border-bottom: 1px solid var(--border-color); vertical-align: top; }
		.isl-t tr:nth-child(even) td { background: #f8fbfe; }
		.isl-t .r { text-align: right; white-space: nowrap; font-variant-numeric: tabular-nums; }
		.isl-t td small { display: block; color: var(--text-muted); }
		.isl-t tr.tot td { font-weight: 800; background: #eef5fb !important; }
		.isl-t .in { color: #1e8449; font-weight: 700; } .isl-t .out { color: #c0392b; font-weight: 700; }
		.isl-t .left b { color: #b9770e; } .isl-t .left.zero b { color: var(--text-muted); }
		.isl-kind { display: inline-block; border-radius: 6px; padding: 1px 7px; font-size: 11px; font-weight: 700; white-space: nowrap; background: #eaf2f8; color: #21618c; }
		.isl-kind.k-to_jobber { background: #fef5e7; color: #935116; } .isl-kind.k-used { background: #fdebd0; color: #7e5109; }
		.isl-kind.k-from_jobber { background: #d5f5e3; color: #1e8449; } .isl-kind.k-in { background: #e8f8f5; color: #117864; }
		.isl-kind.k-out { background: #fdecea; color: #b03a2e; } .isl-kind.k-opening, .isl-kind.k-count { background: #f4ecf7; color: #6c3483; }
		.isl-ref { display: inline-block; margin: 0 4px 2px 0; padding: 0 6px; border-radius: 5px; border: 1px solid var(--border-color); font-size: 11.5px; white-space: nowrap; }
		.isl-ref i { font-style: normal; color: var(--text-muted); margin-right: 3px; }
		.isl-tools { display: flex; flex-wrap: wrap; gap: 6px; align-items: center; padding: 8px 12px; border-bottom: 1px solid var(--border-color); }
		.isl-tools button { border: 1px solid var(--border-color); background: var(--card-bg, #fff); border-radius: 14px; padding: 2px 10px; font-size: 12px; }
		.isl-tools button.is-on { background: #3498DB; color: #fff; border-color: #3498DB; }
		.isl-tools button span { opacity: .75; margin-left: 4px; }
		.isl-tools input { margin-left: auto; min-width: 220px; border: 1px solid var(--border-color); border-radius: 8px; padding: 3px 10px; font-size: 12.5px; }
		.isl-sco-on { margin: 0 12px; padding: 6px 10px; border-radius: 8px; background: #fef5e7; font-size: 12.5px; }
		.isl a.isl-sco { cursor: pointer; }
		.isl-wh.jobber { color: #935116; font-weight: 600; }
		.isl-t td.doc a { white-space: nowrap; }
	</style>`);

	const n = (v) => format_number(flt(v), null, 3).replace(/\.?0+$/, "") || "0";
	const link = (dt, name) => name ? `<a href="/app/${frappe.router.slug(dt)}/${encodeURIComponent(name)}" target="_blank">${esc(name)}</a>` : "";
	const open_link = (dt, name) => `<a class="isl-open" href="/app/${frappe.router.slug(dt)}/${encodeURIComponent(name)}" target="_blank" title="${__("Open")}"><i class="fa fa-external-link"></i></a>`;
	const refs = (r) => [
		r.sco ? `<span class="isl-ref"><i>SCO</i>${link("Subcontracting Order", r.sco)}</span>` : "",
		r.po ? `<span class="isl-ref"><i>PO</i>${link("Purchase Order", r.po)}</span>` : "",
		...(r.so || []).map((s) => `<span class="isl-ref"><i>SO</i>${link("Sales Order", s)}</span>`),
		r.pick_list ? `<span class="isl-ref"><i>Pick</i>${link("Pick List", r.pick_list)}</span>` : "",
		r.ewo ? `<span class="isl-ref"><i>${__("Embroidery")}</i>${link("Embroidery Work Order", r.ewo)}</span>` : "",
	].join("");
	const is_jobber_wh = (w) => w && (data.jobber_warehouses || []).includes(w);
	const wh = (w, bal) => w ? `<span class="isl-wh ${is_jobber_wh(w) ? "jobber" : ""}">${esc(w)}</span><small>${__("left {0}", [n(bal)])}</small>` : "";

	function load() {
		const item = f_item.get_value();
		if (!item) {
			data = null;
			$body.html(`<div class="isl-empty">${__("Choose an item to see its stock from the first movement: where it is now, what each jobber has, and every movement with its jobber, Subcontracting Order, Purchase Order and Sales Order.")}</div>`);
			return;
		}
		frappe.call({
			method: "erp_dacsinc_custom.item_ledger.get_item_ledger",
			args: { item_code: item, warehouse: f_wh.get_value() || null, from_date: f_from.get_value() || null, to_date: f_to.get_value() || null },
			freeze: true, freeze_message: __("Reading the stock ledger…"),
			callback: (r) => { data = r.message; sco_filter = null; render(); },
		});
	}

	function render() {
		const d = data, uom = esc(d.item.stock_uom || "");
		const total = d.stock.reduce((a, s) => a + flt(s.qty), 0);
		const at_jobbers = d.stock.filter((s) => s.is_jobber).reduce((a, s) => a + flt(s.qty), 0);
		const with_jobbers = d.jobbers.reduce((a, j) => a + flt(j.balance), 0);
		let html = `<div class="isl-head"><div><h3>${esc(d.item.item_name || d.item.name)}</h3>
			<div class="sub">${link("Item", d.item.name)} · ${uom}${d.item.disabled ? ` · <b style="color:#c0392b">${__("Disabled")}</b>` : ""}</div></div>
			<div class="isl-k">
				<div><span>${__("Stock now (all warehouses)")}</span><b>${n(total)}</b></div>
				<div><span>${__("In own stores")}</span><b>${n(total - at_jobbers)}</b></div>
				<div class="is-job"><span>${__("At jobbers' warehouse")}</span><b>${n(at_jobbers)}</b></div>
				<div class="is-job"><span>${__("With jobbers (by their orders)")}</span><b>${n(with_jobbers)}</b></div>
			</div></div>`;

		// stock now
		html += `<div class="isl-sec"><h4>${__("Stock now")}<small>${__("per warehouse")}</small></h4>`;
		html += d.stock.length ? `<div class="isl-wrap"><table class="isl-t"><tr><th>${__("Warehouse")}</th><th class="r">${__("Qty")}</th><th class="r">${__("Reserved for orders")}</th></tr>
			${d.stock.map((s) => `<tr><td><span class="isl-wh ${s.is_jobber ? "jobber" : ""}">${esc(s.warehouse)}</span>${s.is_jobber ? ` <small>${__("all jobbers share this warehouse — see With jobbers below")}</small>` : ""}</td>
				<td class="r"><b>${n(s.qty)}</b></td><td class="r">${n(flt(s.reserved_qty) + flt(s.reserved_stock))}</td></tr>`).join("")}
			<tr class="tot"><td>${__("Total")}</td><td class="r">${n(total)}</td><td></td></tr></table></div>`
			: `<div class="isl-empty" style="border:0">${__("No stock in any warehouse.")}</div>`;
		html += `</div>`;

		// with jobbers
		if (d.jobbers.length) {
			const t = (k) => d.jobbers.reduce((a, j) => a + flt(j[k]), 0);
			html += `<div class="isl-sec"><h4>${__("With jobbers")}<small>${__("this item sent as raw material — per Subcontracting Order; click an order to see only its movements")}</small></h4>
				<div class="isl-wrap"><table class="isl-t"><tr><th>${__("Jobber")}</th><th>${__("Subcontracting Order")}</th><th>${__("Purchase Order")}</th><th>${__("Sales Order")}</th>
				<th class="r">${__("Needed")}</th><th class="r">${__("Sent")}</th><th class="r">${__("Used")}</th><th class="r">${__("Returned")}</th><th class="r">${__("Still with jobber")}</th></tr>
				${d.jobbers.map((j) => `<tr><td><b>${esc(j.supplier_name || j.supplier || "")}</b></td>
					<td><a class="isl-sco" data-sco="${esc(j.sco)}">${esc(j.sco)}</a> ${open_link("Subcontracting Order", j.sco)}<small>${frappe.datetime.str_to_user(j.transaction_date)} · ${esc(__(j.status || ""))}</small></td>
					<td>${link("Purchase Order", j.po)}</td><td>${(j.so || []).map((s) => link("Sales Order", s)).join("<br>")}</td>
					<td class="r">${n(j.required)}</td><td class="r">${n(j.sent)}</td><td class="r">${n(j.used)}</td><td class="r">${n(j.returned)}</td>
					<td class="r left ${flt(j.balance) ? "" : "zero"}"><b>${n(j.balance)}</b></td></tr>`).join("")}
				<tr class="tot"><td colspan="4">${__("Total")}</td><td class="r">${n(t("required"))}</td><td class="r">${n(t("sent"))}</td><td class="r">${n(t("used"))}</td><td class="r">${n(t("returned"))}</td><td class="r">${n(t("balance"))}</td></tr>
				</table></div></div>`;
		}
		// made by jobbers
		if (d.fg_orders.length) {
			html += `<div class="isl-sec"><h4>${__("Made by jobbers")}<small>${__("this item as the finished good of Subcontracting Orders")}</small></h4>
				<div class="isl-wrap"><table class="isl-t"><tr><th>${__("Jobber")}</th><th>${__("Subcontracting Order")}</th><th>${__("Purchase Order")}</th><th>${__("Sales Order")}</th>
				<th class="r">${__("Ordered")}</th><th class="r">${__("Received")}</th><th class="r">${__("Pending")}</th></tr>
				${d.fg_orders.map((j) => `<tr><td><b>${esc(j.supplier_name || "")}</b></td>
					<td><a class="isl-sco" data-sco="${esc(j.sco)}">${esc(j.sco)}</a> ${open_link("Subcontracting Order", j.sco)}<small>${frappe.datetime.str_to_user(j.transaction_date)} · ${esc(__(j.status || ""))}</small></td>
					<td>${link("Purchase Order", j.po)}</td><td>${(j.so || []).map((s) => link("Sales Order", s)).join("<br>")}</td>
					<td class="r">${n(j.qty)}</td><td class="r">${n(j.received)}</td><td class="r left ${flt(j.qty) - flt(j.received) > 0 ? "" : "zero"}"><b>${n(flt(j.qty) - flt(j.received))}</b></td></tr>`).join("")}
				</table></div></div>`;
		}

		// the ledger
		html += `<div class="isl-sec"><h4>${__("Every movement")}<small>${d.filters.from_date ? __("from {0}", [frappe.datetime.str_to_user(d.filters.from_date)]) : __("from the first one")}${d.filters.warehouse ? " · " + esc(d.filters.warehouse) : ""} — ${__("Total after = stock of all shown warehouses after that movement")}</small></h4>
			<div class="isl-tools"></div><div class="isl-scoline"></div><div class="isl-wrap isl-led"></div></div>`;
		if (d.truncated) html += `<div class="text-muted small">${__("Only the first {0} movements are shown — choose a From date or a warehouse.", [d.max_rows])}</div>`;
		$body.html(html);
		render_ledger();
	}

	function shown_rows() {
		const words = q.toLowerCase().split(/\s+/).filter(Boolean);
		return data.rows.filter((r) => (kind === "all" || r.kind === kind)
			&& (!sco_filter || r.sco === sco_filter)
			&& (!words.length || words.every((w) => [r.voucher_no, r.party, r.sco, r.po, ...(r.so || []), r.ewo, r.remarks, r.from_wh, r.to_wh, r.label, r.by]
				.some((v) => (v || "").toLowerCase().includes(w)))));
	}

	function render_ledger() {
		const counts = {};
		data.rows.forEach((r) => { counts[r.kind] = (counts[r.kind] || 0) + 1; });
		const $tools = $body.find(".isl-tools").html(KINDS.filter(([k]) => k === "all" || counts[k]).map(([k, label]) =>
			`<button type="button" data-k="${k}" class="${k === kind ? "is-on" : ""}">${label}<span>${k === "all" ? data.rows.length : counts[k]}</span></button>`).join("")
			+ `<input type="search" placeholder="${__("Search document, jobber, SCO, PO, SO, EM, notes…")}" value="${esc(q)}">`);
		$body.find(".isl-scoline").html(sco_filter ? `<div class="isl-sco-on">${__("Only Subcontracting Order {0}", [`<b>${esc(sco_filter)}</b>`])} · <a class="isl-sco-clear">${__("show all")}</a></div>` : "");
		const rows = shown_rows();
		let tin = 0, tout = 0;
		const body = rows.map((r) => {
			const transfer = r.from_wh && r.to_wh;
			// a transfer moves stock between warehouses: its own column, not in the In / Out totals
			if (!transfer) { tin += flt(r.qty_in); tout += flt(r.qty_out); }
			return `<tr>
				<td style="white-space:nowrap">${frappe.datetime.str_to_user(r.date)}<small>${esc(r.time || "")}</small></td>
				<td class="doc"><span class="isl-kind k-${r.kind}">${esc(r.label)}</span><br>${link(r.voucher_type, r.voucher_no)}<small>${esc(__(r.voucher_type))}</small></td>
				<td>${esc(r.party || "")}${r.remarks ? `<small>${esc(String(r.remarks).slice(0, 120))}</small>` : ""}</td>
				<td>${refs(r)}</td>
				<td>${wh(r.from_wh, r.from_balance)}</td><td>${wh(r.to_wh, r.to_balance)}</td>
				<td class="r in">${transfer ? "" : flt(r.qty_in) ? n(r.qty_in) : ""}</td>
				<td class="r out">${transfer ? "" : flt(r.qty_out) ? n(r.qty_out) : ""}</td>
				<td class="r">${transfer ? `<b>${n(r.qty_in)}</b><small>${__("moved")}</small>` : ""}</td>
				<td class="r"><b>${n(r.total)}</b></td>
				<td><small>${esc(r.by || "")}</small></td></tr>`;
		}).join("");
		$body.find(".isl-led").html(rows.length ? `<table class="isl-t"><tr><th>${__("Date")}</th><th>${__("Movement")}</th><th>${__("Jobber / supplier / customer")}</th><th>${__("For")}</th>
			<th>${__("From")}</th><th>${__("To")}</th><th class="r">${__("In")}</th><th class="r">${__("Out")}</th><th class="r">${__("Moved")}</th><th class="r">${__("Total after")}</th><th>${__("By")}</th></tr>
			${data.opening != null && kind === "all" && !sco_filter && !q ? `<tr class="tot"><td colspan="9">${__("Opening on {0}", [frappe.datetime.str_to_user(data.filters.from_date)])}</td><td class="r">${n(data.opening)}</td><td></td></tr>` : ""}
			${body}
			<tr class="tot"><td colspan="6">${__("Total of these {0} movements", [rows.length])}</td><td class="r">${n(tin)}</td><td class="r">${n(tout)}</td><td colspan="3"></td></tr></table>`
			: `<div class="isl-empty" style="border:0">${__("No movements.")}</div>`);
		$tools.find("input").on("input", frappe.utils.debounce((e) => { q = e.target.value; render_ledger(); $body.find(".isl-tools input").focus(); }, 300));
	}

	$body.on("click", ".isl-tools button", (e) => { kind = String($(e.currentTarget).data("k")); render_ledger(); });
	$body.on("click", "a.isl-sco", (e) => {
		sco_filter = String($(e.currentTarget).data("sco")); kind = "all"; render_ledger();
		$body.find(".isl-led")[0].scrollIntoView({ behavior: "smooth", block: "start" });
	});
	$body.on("click", ".isl-sco-clear", () => { sco_filter = null; render_ledger(); });

	function print() {
		if (!data) return;
		const w = window.open("", "_blank");
		if (!w) return frappe.msgprint(__("Allow pop-ups for this site to print."));
		w.document.write(`<html><head><title>${esc(data.item.name)} — ${__("Item Stock Ledger")}</title>
			<style>body{font-family:Arial,sans-serif;font-size:10px;color:#000} h3{margin:0 0 4px} table{width:100%;border-collapse:collapse;margin-bottom:10px}
			th,td{border:1px solid #999;padding:3px 5px;text-align:left;vertical-align:top} th{background:#eee} .r{text-align:right} small{display:block;color:#555}
			h4{margin:10px 0 4px;font-size:12px} .isl-tools,.isl-scoline,.isl-open{display:none} a{color:#000;text-decoration:none} .isl-kind{font-weight:bold}
			@page{size:A4 landscape;margin:8mm}</style></head><body>${$body.html()}</body></html>`);
		w.document.close(); w.focus(); setTimeout(() => w.print(), 300);
	}

	page.wrapper.on("show", () => {
		const item = frappe.utils.get_url_arg("item") || (frappe.route_options && frappe.route_options.item);
		frappe.route_options = null;
		if (item && item !== f_item.get_value()) f_item.set_value(item); else if (!data) load();
	});
	load();
};
