// Group Outstanding (/app/group-outstanding) — one Customer / Supplier Group (e.g. a firm's branches) on one page
// (docs/bulk-payment.md › Group payment): the group's totals, then each member with what it owes (tick the items the
// cheque pays) and what is held for it; a bar at the bottom with the ticked total and Receive / Pay, which opens the
// payment prompt (public/js/bulk_payment.js) with those members and items — one Bulk Payment, one Payment Entry each.
// Print gives the same list on paper. Data: party_group.get_group_outstanding. Opened with ?party_type=&group=.
frappe.pages["group-outstanding"].on_page_load = function (wrapper) {
	const page = frappe.ui.make_app_page({ parent: wrapper, title: __("Group Outstanding"), single_column: true });
	const esc = frappe.utils.escape_html;
	const KIND = {
		invoice: [__("Invoice"), __("Bill")], opening_invoice: [__("Opening invoice"), __("Opening bill")],
		opening: [__("Opening balance")], journal: [__("Journal Entry")], journal_credit: [__("Journal Entry credit")],
		credit_note: [__("Credit note")], debit_note: [__("Debit note")], advance: [__("Advance payment")],
		refund: [__("Refund paid out"), __("Refund received")], other: [__("Other")],
	};
	let data = null;
	const ticked = new Set();   // item names ticked for the payment

	const f_type = page.add_field({ fieldname: "party_type", label: __("Of"), fieldtype: "Select", options: ["Customer", "Supplier"], default: "Customer",
		change: () => { f_group.df.options = group_dt(); f_group.set_value(""); } });
	const group_dt = () => f_type.get_value() === "Supplier" ? "Supplier Group" : "Customer Group";
	const f_group = page.add_field({ fieldname: "group", label: __("Group"), fieldtype: "Link", options: "Customer Group", change: () => load() });
	page.set_primary_action(__("Refresh"), () => load(), "refresh");
	page.add_inner_button(__("Print"), () => print());

	const $body = $(`<div class="gos"></div>`).appendTo(page.main);
	$body.before(`<style>
		.gos { padding: 4px 0 90px; font-size: 13px; }
		.gos-empty { padding: 40px; text-align: center; color: var(--text-muted); border: 1px dashed var(--border-color); border-radius: 12px; }
		.gos-head { display: flex; flex-wrap: wrap; gap: 14px 24px; align-items: center; justify-content: space-between; padding: 14px 18px; border-radius: 12px; border: 1px solid var(--border-color); border-left: 5px solid #3498DB; background: linear-gradient(90deg, #f0f7fd 0%, var(--card-bg, #fff) 60%); margin-bottom: 10px; }
		.gos-head h3 { margin: 0; font-size: 19px; font-weight: 800; } .gos-head .sub { color: var(--text-muted); font-size: 12.5px; margin-top: 2px; }
		.gos-k { display: flex; flex-wrap: wrap; gap: 8px; }
		.gos-k div { border: 1px solid var(--border-color); border-radius: 8px; padding: 6px 14px; background: var(--card-bg, #fff); min-width: 130px; }
		.gos-k span { display: block; font-size: 11.5px; color: var(--text-muted); font-weight: 600; } .gos-k b { font-size: 17px; font-variant-numeric: tabular-nums; }
		.gos-k .is-due b { color: #c0392b; } .gos-k .is-cr b { color: #1e8449; } .gos-k .is-net { border: 2px solid #85c1e9; background: #f4f9fd; }
		.gos-tools { display: flex; gap: 8px; align-items: center; margin: 4px 0 10px; color: var(--text-muted); font-size: 12.5px; }
		.gos-m { border: 1px solid var(--border-color); border-radius: 12px; overflow: hidden; margin-bottom: 12px; background: var(--card-bg, #fff); }
		.gos-mh { display: flex; flex-wrap: wrap; gap: 6px 16px; align-items: center; padding: 10px 14px; background: #eaf3fb; border-bottom: 1px solid #d6eaf8; }
		.gos-mh label { display: flex; gap: 8px; align-items: center; margin: 0; flex: 1; min-width: 220px; cursor: pointer; }
		.gos-mh b { font-size: 14px; } .gos-mh small { color: var(--text-muted); display: block; font-weight: 400; }
		.gos-mh .amt { text-align: right; font-variant-numeric: tabular-nums; } .gos-mh .amt b { color: #c0392b; } .gos-mh .amt small { display: block; }
		.gos-t { width: 100%; border-collapse: collapse; }
		.gos-t th { background: #3498DB; color: #fff; font-size: 11px; text-transform: uppercase; letter-spacing: .03em; padding: 6px 12px; text-align: left; font-weight: 700; }
		.gos-t td { padding: 7px 12px; border-bottom: 1px solid var(--border-color); vertical-align: middle; }
		.gos-t tr:nth-child(even) td { background: #f8fbfe; } .gos-t tr.is-on td { background: #fff7e6 !important; }
		.gos-t .r { text-align: right; white-space: nowrap; font-variant-numeric: tabular-nums; } .gos-t td small { display: block; color: var(--text-muted); }
		.gos-t tr.is-cr td { background: #f1faf4 !important; color: #1e8449; }
		.gos-kind { display: inline-block; border-radius: 6px; padding: 1px 7px; font-size: 11px; font-weight: 700; margin-right: 6px; background: #eaf2f8; color: #21618c; }
		.gos-kind.k-opening { background: #f4ecf7; color: #6c3483; } .gos-kind.k-journal { background: #fef5e7; color: #935116; } .gos-t tr.is-cr .gos-kind { background: #d5f5e3; color: #1e8449; }
		.gos-late { display: inline-block; border-radius: 10px; padding: 1px 8px; font-size: 11px; font-weight: 700; background: #fdecea; color: #b03a2e; }
		.gos-ok { display: inline-block; border-radius: 10px; padding: 1px 8px; font-size: 11px; font-weight: 700; background: #eaf2f8; color: #21618c; }
		.gos-bar { position: fixed; left: 0; right: 0; bottom: 0; z-index: 20; background: var(--card-bg, #fff); border-top: 2px solid #3498DB; box-shadow: 0 -4px 14px rgba(0,0,0,.08); padding: 10px 24px; display: flex; gap: 16px; align-items: center; justify-content: flex-end; flex-wrap: wrap; }
		.gos-bar .txt { flex: 1; font-size: 13px; } .gos-bar .txt b { font-size: 16px; }
		.gos-note { font-size: 12px; color: var(--text-muted); margin: -4px 0 10px; }
	</style>`);
	const $bar = $(`<div class="gos-bar" style="display:none;"></div>`).appendTo(page.main);

	const money = (v) => format_currency(flt(v, 2), data && data.currency);
	const date = (d) => d ? frappe.datetime.str_to_user(d) : "";
	const link = (dt, n) => `<a href="/app/${frappe.router.slug(dt)}/${encodeURIComponent(n)}" target="_blank">${esc(n)}</a>`;
	const supplier = () => data && data.party_type === "Supplier";
	const kind = (k) => { const x = KIND[k] || KIND.other; return supplier() && x[1] ? x[1] : x[0]; };

	function load() {
		const group = f_group.get_value();
		ticked.clear();
		if (!group) {
			data = null; $bar.hide();
			$body.html(`<div class="gos-empty"><i class="fa fa-users fa-2x"></i><br><br>${__("Choose a {0} above — its members' unpaid items show here, member by member, and you can take one payment for all of them.", [__(group_dt())])}
				<br><small>${__("Branches of one firm: put them in one {0} (on each {1}'s form).", [__(group_dt()), __(f_type.get_value())])}</small></div>`);
			return;
		}
		$body.html(`<div class="gos-empty">${__("Loading…")}</div>`);
		frappe.call({ method: "erp_dacsinc_custom.party_group.get_group_outstanding", args: { party_type: f_type.get_value(), group } })
			.then(r => { data = r.message; paint(); });
	}

	function paint() {
		const t = data.totals, owing = data.members.filter(m => m.items.length);
		const who = supplier() ? __("suppliers") : __("customers");
		$body.html(`
			<div class="gos-head">
				<div><h3><i class="fa fa-users" style="color:#3498DB;"></i> ${esc(data.group)}</h3>
					<div class="sub">${__("{0} of {1} {2} have something open", [data.members.length, data.members_total, who])} · ${esc(data.company)}</div></div>
				<div class="gos-k">
					<div class="is-due"><span>${supplier() ? __("We owe") : __("They owe")}</span><b>${money(t.due)}</b></div>
					<div class="is-due"><span>${__("Overdue")}</span><b>${money(t.overdue)}</b></div>
					${t.credits > 0.005 ? `<div class="is-cr"><span>${supplier() ? __("They hold for us") : __("We hold for them")}</span><b>${money(t.credits)}</b></div>` : ""}
					<div class="is-net"><span>${supplier() ? __("Net to pay") : __("Net to receive")}</span><b>${money(t.net)}</b></div>
				</div>
			</div>
			${data.members.length ? `<div class="gos-tools">
				<button class="btn btn-xs btn-default gos-all">${__("Tick all")}</button>
				<button class="btn btn-xs btn-default gos-none">${__("Clear")}</button>
				<span>${__("Tick what the cheque pays, then {0} at the bottom. Nothing ticked: the prompt opens with every member that owes, and spreads the amount oldest first.", [supplier() ? __("Pay") : __("Receive")])}</span></div>`
				: `<div class="gos-empty">${__("Nothing open for this group.")}</div>`}
			${data.members.map(member).join("")}`);
		if (data.members.some(m => m.credits.length)) {
			$body.find(".gos-tools").after(`<div class="gos-note"><i class="fa fa-info-circle" style="color:#3498DB;"></i> ${__("Green rows (credit notes, advances) are held for that {0}: set them off with Adjust on its Account Summary (open its form).", [supplier() ? __("supplier") : __("customer")])}</div>`);
		}
		paint_bar();
	}

	function member(m) {
		const all_on = m.items.length && m.items.every(i => ticked.has(i.name));
		const place = [m.place, m.gstin, m.mobile].filter(Boolean).map(esc).join(" · ");
		const due_rows = m.items.map(i => `<tr class="${ticked.has(i.name) ? "is-on" : ""}">
			<td style="width:30px;"><input type="checkbox" class="gos-i" data-n="${esc(i.name)}" ${ticked.has(i.name) ? "checked" : ""}></td>
			<td><span class="gos-kind k-${i.kind}">${kind(i.kind)}</span>${link(i.doctype, i.name)}<small>${[date(i.posting_date), i.bill_no ? esc(i.bill_no) : "", i.remark ? esc(i.remark) : ""].filter(Boolean).join(" · ")}</small></td>
			<td>${i.late ? `<span class="gos-late">${__("{0} days late", [i.late])}</span>` : `<span class="gos-ok">${__("due {0}", [date(i.due_date)])}</span>`}</td>
			<td class="r">${money(i.total)}</td>
			<td class="r"><b>${money(i.outstanding)}</b></td></tr>`).join("");
		const cr_rows = m.credits.map(c => `<tr class="is-cr"><td></td>
			<td><span class="gos-kind">${kind(c.kind)}</span>${link(c.doctype, c.name)}<small>${date(c.posting_date)}${c.return_against ? " · " + __("return of {0}", [esc(c.return_against)]) : ""}</small></td>
			<td>${__("held for them")}</td><td></td><td class="r"><b>− ${money(c.amount)}</b></td></tr>`).join("");
		return `<div class="gos-m" data-p="${esc(m.party)}">
			<div class="gos-mh"><label>${m.items.length ? `<input type="checkbox" class="gos-p" ${all_on ? "checked" : ""}>` : ""}
				<span><b>${esc(m.party_name)}</b><small>${link(data.party_type, m.party)}${place ? " · " + place : ""}</small></span></label>
				<div class="amt"><b>${money(m.due)}</b><small>${__("{0} items", [m.items.length])}${m.overdue > 0.005 ? " · " + __("{0} overdue", [money(m.overdue)]) : ""}${m.credit > 0.005 ? " · " + __("held {0} → net {1}", [money(m.credit), money(m.net)]) : ""}</small></div></div>
			<table class="gos-t"><tr><th></th><th>${__("Item")}</th><th>${__("Status")}</th><th class="r">${__("Total")}</th><th class="r">${__("Open")}</th></tr>${due_rows}${cr_rows}</table></div>`;
	}

	const picked = () => {
		const out = [];
		(data ? data.members : []).forEach(m => m.items.forEach(i => { if (ticked.has(i.name) && i.kind !== "refund") out.push({ m, i }); }));
		return out;
	};
	function paint_bar() {
		if (!data || !data.members.some(m => m.items.length) || !data.can_pay) { $bar.hide(); return; }
		const p = picked(), total = p.reduce((a, x) => a + flt(x.i.outstanding), 0), n_m = new Set(p.map(x => x.m.party)).size;
		const act = supplier() ? __("Pay") : __("Receive");
		$bar.html(`<div class="txt">${p.length
			? __("Ticked: {0} items of {1} {2} = <b>{3}</b>", [p.length, n_m, n_m === 1 ? __("member") : __("members"), money(total)])
			: __("Nothing ticked — the prompt opens with all {0} members that owe.", [data.members.filter(m => m.items.length).length])}</div>
			<button class="btn btn-primary gos-pay"><i class="fa fa-${supplier() ? "arrow-up" : "arrow-down"}"></i> ${p.length ? __("{0} {1}", [act, money(total)]) : __("{0} payment for the group", [act])}</button>`).show();
	}

	$body.on("change", ".gos-i", (e) => { const n = String($(e.currentTarget).data("n")); e.currentTarget.checked ? ticked.add(n) : ticked.delete(n); paint_member($(e.currentTarget).closest(".gos-m")); });
	$body.on("change", ".gos-p", (e) => {
		const $m = $(e.currentTarget).closest(".gos-m"), m = data.members.find(x => x.party === String($m.data("p")));
		m.items.forEach(i => e.currentTarget.checked ? ticked.add(i.name) : ticked.delete(i.name));
		paint_member($m);
	});
	$body.on("click", ".gos-all", () => { data.members.forEach(m => m.items.forEach(i => ticked.add(i.name))); paint(); });
	$body.on("click", ".gos-none", () => { ticked.clear(); paint(); });
	function paint_member($m) {
		const m = data.members.find(x => x.party === String($m.data("p")));
		$m.replaceWith(member(m)); paint_bar();
	}
	$bar.on("click", ".gos-pay", () => {
		const p = picked();
		const parties = p.length ? [...new Map(p.map(x => [x.m.party, x.m.party_name])).entries()]
			: data.members.filter(m => m.items.length).map(m => [m.party, m.party_name]);
		const items = Object.fromEntries(p.map(x => [x.i.name, x.i.outstanding]));
		frappe.require("/assets/erp_dacsinc_custom/js/bulk_payment.js", () => dacs_payment_dialog({
			payment_type: data.payment_type, parties, items, on_done: () => load() }));
	});

	function print() {
		if (!data) return frappe.msgprint(__("Choose a group first."));
		const t = data.totals;
		const rows = data.members.map(m => `<tr class="m"><td colspan="4"><b>${esc(m.party_name)}</b> <small>${esc(m.party)}${m.gstin ? " · " + esc(m.gstin) : ""}</small></td><td class="r"><b>${money(m.due)}</b></td></tr>`
			+ m.items.map(i => `<tr><td>${kind(i.kind)}</td><td>${esc(i.name)}${i.bill_no ? " (" + esc(i.bill_no) + ")" : ""}</td><td>${date(i.posting_date)}</td><td>${i.late ? __("{0} days late", [i.late]) : __("due {0}", [date(i.due_date)])}</td><td class="r">${money(i.outstanding)}</td></tr>`).join("")
			+ m.credits.map(c => `<tr class="cr"><td>${kind(c.kind)}</td><td>${esc(c.name)}</td><td>${date(c.posting_date)}</td><td>${__("held for them")}</td><td class="r">− ${money(c.amount)}</td></tr>`).join("")).join("");
		const w = window.open("", "_blank");
		w.document.write(`<!doctype html><html><head><meta charset="utf-8"><title>${esc(data.group)} — ${__("Outstanding")}</title><style>
			body { font-family: Arial, sans-serif; font-size: 11.5px; margin: 24px; color: #222; } h2 { margin: 0 0 2px; } .sub { color: #666; margin-bottom: 12px; }
			table { width: 100%; border-collapse: collapse; } th { background: #3498DB; color: #fff; text-align: left; padding: 5px 8px; } td { padding: 4px 8px; border-bottom: 1px solid #e5e5e5; }
			.r { text-align: right; white-space: nowrap; } tr.m td { background: #eaf3fb; padding-top: 7px; } tr.cr td { color: #1e8449; } small { color: #666; }
			.tot td { font-weight: bold; border-top: 2px solid #3498DB; }
			.lh { margin-bottom: 10px; } .lh img { max-width: 100%; } .lh td { border-bottom: none; padding: 0; }</style></head><body>
			${data.letter_head ? `<div class="lh">${data.letter_head}</div>` : ""}
			<h2>${esc(data.group)} — ${__("Outstanding")}</h2><div class="sub">${esc(data.company)} · ${__("as on {0}", [frappe.datetime.str_to_user(frappe.datetime.get_today())])}</div>
			<table><tr><th>${__("Item")}</th><th>${__("No.")}</th><th>${__("Date")}</th><th>${__("Status")}</th><th class="r">${__("Open")}</th></tr>${rows}
			<tr class="tot"><td colspan="4">${supplier() ? __("We owe") : __("They owe")}</td><td class="r">${money(t.due)}</td></tr>
			${t.credits > 0.005 ? `<tr class="tot"><td colspan="4">${__("Less held for them")}</td><td class="r">− ${money(t.credits)}</td></tr>
			<tr class="tot"><td colspan="4">${supplier() ? __("Net to pay") : __("Net to receive")}</td><td class="r">${money(t.net)}</td></tr>` : ""}</table>
			<script>window.onload = () => window.print();<\/script></body></html>`);
		w.document.close();
	}

	// opened with ?party_type=&group= (Customer Group / Supplier Group form, Account Summary)
	wrapper.gos_show = () => {
		const ro = frappe.route_options || {};
		frappe.route_options = null;
		if (ro.party_type && ro.party_type !== f_type.get_value()) { f_type.set_value(ro.party_type); f_group.df.options = group_dt(); }
		if (ro.group && ro.group !== f_group.get_value()) f_group.set_value(ro.group); else if (!data) load();
	};
};
frappe.pages["group-outstanding"].on_page_show = function (wrapper) {
	wrapper.gos_show && wrapper.gos_show();
};
