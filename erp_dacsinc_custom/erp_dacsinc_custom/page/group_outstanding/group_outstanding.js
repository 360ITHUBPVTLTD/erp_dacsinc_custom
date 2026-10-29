// Group Outstanding (/app/group-outstanding) — one Customer / Supplier Group (e.g. a firm's branches) on one page
// (docs/bulk-payment.md › Group payment): the group's totals, then each member with what it owes (tick the items the
// cheque pays) and what is held for it; a bar at the bottom with the ticked total and Receive / Pay, which opens the
// payment prompt (public/js/bulk_payment.js) with those members and items — one Bulk Payment, one Payment Entry each.
// Print gives the same list on paper. Data: party_group.get_group_outstanding. Opened with ?party_type=&group=.
// No group chosen: every group with something open (get_groups_outstanding), most owed first — a click opens it,
// "All groups" goes back; or, switched to "By customer / supplier" (remembered), every party with something open
// (get_parties_outstanding) — a click opens that party with its ledger. One search bar on top finds groups and single customers / suppliers (id, name, mobile,
// GSTIN, group, city… — party_group.search); a party opens on its own: the same Account Summary as its form
// (party_summary.js dacs_party_summary — Receive / Pay, Adjust, Refund, Returns, orders, history, payments,
// statement) and its ledger for the dates (get_party_view). A member of a group opens the same way from its
// "Summary & ledger" button, and has Adjust (dacs_party_adjust) when it owes and something is held; Back returns.
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
	let party = null, party_back = null;   // one customer / supplier open (and the group to go back to)
	// the list before anything is opened: by group, or every customer / supplier with something open
	let overview = "group";
	try { overview = localStorage.getItem("gos_overview") === "party" ? "party" : "group"; } catch (e) { /* private window */ }
	let led_from = frappe.datetime.add_months(frappe.datetime.get_today(), -12), led_to = frappe.datetime.get_today();

	// Customers | Suppliers — two buttons (a select for two choices opened the browser's own list)
	let party_type = "Customer";
	const f_type = {
		get_value: () => party_type,
		set_value: (v) => {
			party_type = v === "Supplier" ? "Supplier" : "Customer";
			$type.find("button").each((_, b) => $(b).toggleClass("is-on", $(b).data("t") === party_type));
			f_group.df.options = group_dt();
			f_group.$input && f_group.$input.attr("placeholder", __(group_dt()));
			paint_view();
			party = party_back = null; $search.find("input").val(""); $res.hide();
			if (f_group.get_value()) f_group.set_value(""); else load();   // clearing the group reloads
		},
	};
	const group_dt = () => party_type === "Supplier" ? "Supplier Group" : "Customer Group";
	const f_group = page.add_field({ fieldname: "group", label: __("Customer Group"), fieldtype: "Link", options: "Customer Group", change: () => { party = null; load(); } });
	const $type = $(`<div class="gos-type">
		<button type="button" class="is-on" data-t="Customer"><i class="fa fa-arrow-down"></i> ${__("Customers")}</button>
		<button type="button" data-t="Supplier"><i class="fa fa-arrow-up"></i> ${__("Suppliers")}</button></div>`).prependTo(page.page_form);
	$type.on("click", "button", (e) => { const t = String($(e.currentTarget).data("t")); if (t !== party_type) f_type.set_value(t); });
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
		.gos-gr, .gos-pr { cursor: pointer; } .gos-gr:hover td, .gos-pr:hover td { background: #eaf3fb !important; } .gos-gr.is-ca td { color: var(--text-muted); }
		.gos-gr[data-none] { cursor: default; }
		.gos-type { display: inline-flex; border: 1px solid var(--border-color); border-radius: 8px; overflow: hidden; margin: 0 10px 0 15px; height: 30px; align-self: center; }
		.gos-type button { border: 0; background: var(--card-bg, #fff); padding: 0 14px; font-size: 13px; font-weight: 600; color: var(--text-muted); }
		.gos-type button + button { border-left: 1px solid var(--border-color); }
		.gos-type button.is-on { background: #3498DB; color: #fff; }
		.gos-search { position: relative; margin: 6px 0 12px; }
		.gos-search > i { position: absolute; left: 13px; top: 12px; color: var(--text-muted); z-index: 3; }
		.gos-search input { height: 38px; padding-left: 36px; font-size: 14px; border-radius: 10px; border: 1px solid #aed6f1; background: var(--card-bg, #fff); }
		.gos-res { display: none; position: absolute; z-index: 30; left: 0; right: 0; top: 42px; max-height: 420px; overflow: auto; background: var(--card-bg, #fff); border: 1px solid var(--border-color); border-radius: 10px; box-shadow: 0 8px 24px rgba(0,0,0,.12); }
		.gos-rh { font-size: 11px; font-weight: 700; text-transform: uppercase; letter-spacing: .03em; color: var(--text-muted); padding: 8px 14px 4px; }
		.gos-ri { display: flex; gap: 10px; align-items: center; padding: 7px 14px; cursor: pointer; border-top: 1px solid var(--border-color); }
		.gos-ri:hover { background: #eaf3fb; } .gos-ri > i { color: #3498DB; width: 16px; } .gos-ri > div { flex: 1; min-width: 0; }
		.gos-ri small { display: block; color: var(--text-muted); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
		.gos-ri .amt { text-align: right; white-space: nowrap; } .gos-ri .amt b { color: #c0392b; } .gos-ri .amt small { color: #1e8449; }
		.gos-led { margin-top: 18px; }
		.gos-pbar { display: flex; flex-wrap: wrap; gap: 6px 12px; align-items: center; margin-bottom: 10px; font-size: 13px; }
		.gos-pbar b { font-size: 15px; } .gos-pbar span { color: var(--text-muted); }
		.gos-mact { display: inline-flex; gap: 6px; }
		.gos-led-h { display: flex; flex-wrap: wrap; gap: 8px 12px; align-items: center; margin-bottom: 8px; }
		.gos-led-h h4 { margin: 0; font-size: 15px; font-weight: 800; flex: 1; }
		.gos-led-h input[type=date] { height: 28px; border: 1px solid var(--border-color); border-radius: 6px; padding: 0 6px; font-size: 12.5px; background: var(--card-bg, #fff); }
		.gos-t tr.is-ob td { background: #f4f6f7 !important; font-weight: 700; }
		.gos-drcr { font-size: 11px; color: var(--text-muted); font-weight: 600; } .gos-dr { color: #c0392b; } .gos-cr { color: #1e8449; }
		.gos-mh .gos-ledger { margin-left: 8px; }
		.gos-type.gos-view { margin-left: 0; }
		.gos-note { font-size: 12px; color: var(--text-muted); margin: -4px 0 10px; }
	</style>`);
	const $bar = $(`<div class="gos-bar" style="display:none;"></div>`).appendTo(page.main);
	const $search = $(`<div class="gos-search"><i class="fa fa-search"></i>
		<input type="text" class="form-control" autocomplete="off">
		<div class="gos-res"></div></div>`).insertBefore($body);
	const $res = $search.find(".gos-res");
	// the search follows By group / By customer: groups by name, or customers / suppliers by anything
	const placeholder = () => $search.find("input").attr("placeholder", overview === "group"
		? (party_type === "Supplier" ? __("Search a supplier group by name…") : __("Search a customer group by name…"))
		: (party_type === "Supplier" ? __("Search a supplier — name, ID, mobile, GSTIN, email, group, city, pincode…")
			: __("Search a customer — name, ID, mobile, GSTIN, email, group, city, pincode…")));
	placeholder();
	let s_timer, s_seq = 0;
	$search.on("input", "input", (e) => {
		clearTimeout(s_timer);
		const txt = e.target.value.trim();
		if (txt.length < 2) { $res.hide(); return; }
		s_timer = setTimeout(() => {
			const seq = ++s_seq;
			frappe.call({ method: "erp_dacsinc_custom.party_group.search", args: { party_type, txt, scope: overview } }).then(r => {
				if (seq !== s_seq) return;
				const o = r.message || {}, m = (v) => format_currency(flt(v, 2));
				const who = party_type === "Supplier" ? __("Suppliers") : __("Customers");
				$res.html((o.groups.length ? `<div class="gos-rh">${__("Groups")}</div>` + o.groups.map(g => `<div class="gos-ri" data-g="${esc(g.group)}">
						<i class="fa fa-users"></i><div><b>${esc(g.group)}</b><small>${__("{0} members", [g.members])}${g.members > 60 ? " · " + __("catch-all") : ""}</small></div></div>`).join("") : "")
					+ (o.parties.length ? `<div class="gos-rh">${who}</div>` + o.parties.map(p => `<div class="gos-ri" data-p="${esc(p.party)}">
						<i class="fa fa-user"></i><div><b>${esc(p.party_name)}</b><small>${[esc(p.party), p.group ? `<i class="fa fa-users"></i> ${esc(p.group)}` : "", p.mobile ? esc(p.mobile) : "", p.gstin ? esc(p.gstin) : "", p.place ? esc(p.place) : ""].filter(Boolean).join(" · ")}</small></div>
						<span class="amt">${p.due > 0.005 ? `<b>${m(p.due)}</b>` : `<span class="text-muted">${__("nothing due")}</span>`}${p.credit > 0.005 ? `<small>${__("held {0}", [m(p.credit)])}</small>` : ""}</span></div>`).join("") : "")
					|| `<div class="gos-rh">${__("Nothing found.")}</div>`).show();
			});
		}, 250);
	});
	$search.on("click", ".gos-ri", (e) => {
		const $i = $(e.currentTarget);
		$res.hide(); $search.find("input").val("");
		if ($i.data("p")) return open_party(String($i.data("p")), null);
		party = party_back = null;
		const g = String($i.data("g"));
		if (f_group.get_value() === g) load(); else f_group.set_value(g);
	});
	$(document).on("click.gos", (e) => { if (!$(e.target).closest(".gos-search").length) $res.hide(); });
	$search.on("keydown", "input", (e) => { if (e.key === "Escape") $res.hide(); });
	$search.on("focus", "input", () => { if ($res.children().length && $search.find("input").val().trim().length > 1) $res.show(); });

	function open_party(p, back_group) {
		party = p; party_back = back_group;
		load();
		$("html, body").scrollTop(0);
	}

	const money = (v) => format_currency(flt(v, 2), data && data.currency);
	const date = (d) => d ? frappe.datetime.str_to_user(d) : "";
	const link = (dt, n) => `<a href="/app/${frappe.router.slug(dt)}/${encodeURIComponent(n)}" target="_blank">${esc(n)}</a>`;
	const supplier = () => data && data.party_type === "Supplier";
	const kind = (k) => { const x = KIND[k] || KIND.other; return supplier() && x[1] ? x[1] : x[0]; };

	function load() {
		const group = f_group.get_value();
		ticked.clear();
		if (party) return load_party();
		if (!group) { data = null; $bar.hide(); return load_all(); }
		$body.html(`<div class="gos-empty">${__("Loading…")}</div>`);
		frappe.call({ method: "erp_dacsinc_custom.party_group.get_group_outstanding", args: { party_type: f_type.get_value(), group } })
			.then(r => { data = r.message; paint(); });
	}

	// By group | By customer (supplier) — in the top bar, next to Customers | Suppliers; the Group field and the
	// search follow it
	const $view = $(`<div class="gos-type gos-view"></div>`).insertAfter($type);
	const paint_view = () => {
		const sup = party_type === "Supplier";
		$view.html(`<button type="button" data-v="group" class="${overview === "group" ? "is-on" : ""}"><i class="fa fa-users"></i> ${__("By group")}</button>
			<button type="button" data-v="party" class="${overview === "party" ? "is-on" : ""}"><i class="fa fa-user"></i> ${sup ? __("By supplier") : __("By customer")}</button>`);
		f_group.$wrapper.toggle(overview === "group");
		placeholder();
	};
	$view.on("click", "button", (e) => {
		const v = String($(e.currentTarget).data("v"));
		if (v === overview && !party && !f_group.get_value()) return;
		overview = v;
		try { localStorage.setItem("gos_overview", overview); } catch (err) { /* private window */ }
		party = party_back = null; $search.find("input").val(""); $res.hide();
		paint_view();
		if (f_group.get_value()) f_group.set_value(""); else load();
	});
	$body.on("click", ".gos-pr", (e) => { if (!$(e.target).closest("a").length) open_party(String($(e.currentTarget).data("p")), null); });

	// every customer / supplier with something open, most owed first; a click opens it with its ledger
	function load_all_parties() {
		$body.html(`<div class="gos-empty">${__("Loading…")}</div>`);
		frappe.call({ method: "erp_dacsinc_custom.party_group.get_parties_outstanding", args: { party_type } }).then(r => {
			const o = r.message || {}, ps = o.parties || [];
			const m = (v) => format_currency(flt(v, 2), o.currency);
			const sup = party_type === "Supplier";
			const sum = (k) => ps.reduce((a, x) => a + flt(x[k]), 0);
			const row = (x) => `<tr class="gos-pr" data-p="${esc(x.party)}">
				<td><b>${esc(x.party_name)}</b><small>${esc(x.party)}${x.oldest_due ? " · " + __("oldest due {0}", [date(x.oldest_due)]) : ""}</small></td>
				<td>${x.group ? esc(x.group) : "—"}</td>
				<td class="r">${x.n_items}</td>
				<td class="r"><b style="color:#c0392b;">${m(x.due)}</b></td>
				<td class="r">${x.overdue > 0.005 ? `<span style="color:#c0392b;">${m(x.overdue)}</span>` : "—"}</td>
				<td class="r">${x.credits > 0.005 ? `<span style="color:#1e8449;">− ${m(x.credits)}</span>` : "—"}</td>
				<td class="r"><b>${m(x.net)}</b></td>
				<td class="r"><button class="btn btn-xs btn-primary">${__("Open")} <i class="fa fa-chevron-right"></i></button></td></tr>`;
			$body.html(`
				<div class="gos-head"><div><h3><i class="fa fa-user" style="color:#3498DB;"></i> ${sup ? __("All suppliers with something open") : __("All customers with something open")}</h3>
					<div class="sub">${ps.length === 1 ? (sup ? __("1 supplier") : __("1 customer")) : __("{0} {1}", [ps.length, sup ? __("suppliers") : __("customers")])} · ${__("click one to see what is open and its ledger, and take a payment")} · ${esc(o.company || "")}</div></div>
					<div class="gos-k"><div class="is-due"><span>${sup ? __("We owe") : __("They owe")}</span><b>${m(sum("due"))}</b></div>
						<div class="is-due"><span>${__("Overdue")}</span><b>${m(sum("overdue"))}</b></div>
						<div class="is-net"><span>${sup ? __("Net to pay") : __("Net to receive")}</span><b>${m(sum("net"))}</b></div></div></div>
				${ps.length ? `<div class="gos-m"><table class="gos-t"><tr><th>${sup ? __("Supplier") : __("Customer")}</th><th>${__("Group")}</th><th class="r">${__("Items")}</th><th class="r">${sup ? __("We owe") : __("They owe")}</th>
					<th class="r">${__("Overdue")}</th><th class="r">${sup ? __("They hold") : __("Held for them")}</th><th class="r">${sup ? __("Net to pay") : __("Net to receive")}</th><th></th></tr>
					${ps.map(row).join("")}</table></div>` : `<div class="gos-empty">${__("Nothing open.")}</div>`}`);
		});
	}

	function load_all() {
		if (overview === "party") return load_all_parties();
		$body.html(`<div class="gos-empty">${__("Loading…")}</div>`);
		frappe.call({ method: "erp_dacsinc_custom.party_group.get_groups_outstanding", args: { party_type: f_type.get_value() } }).then(r => {
			const o = r.message || {}, gs = o.groups || [];
			const m = (v) => format_currency(flt(v, 2), o.currency);
			const sup = f_type.get_value() === "Supplier";
			const sum = (k) => gs.reduce((a, g) => a + flt(g[k]), 0);
			const row = (g) => `<tr class="gos-gr ${g.catch_all ? "is-ca" : ""}" data-g="${esc(g.group)}" ${g.members ? "" : 'data-none="1"'}>
				<td><b>${esc(g.group)}</b><small>${!g.members ? __("{0} {1} owe but have no group set — set the {2} on their form", [g.owing, sup ? __("suppliers") : __("customers"), __(group_dt())])
					: g.catch_all ? __("catch-all group ({0} members) — not one firm", [g.members])
					: __("{0} of {1} owe · oldest due {2}", [g.owing, g.members, g.oldest_due ? date(g.oldest_due) : "—"])}</small></td>
				<td class="r">${g.n_items}</td>
				<td class="r"><b style="color:#c0392b;">${m(g.due)}</b></td>
				<td class="r">${g.overdue > 0.005 ? `<span style="color:#c0392b;">${m(g.overdue)}</span>` : "—"}</td>
				<td class="r">${g.credits > 0.005 ? `<span style="color:#1e8449;">− ${m(g.credits)}</span>` : "—"}</td>
				<td class="r"><b>${m(g.net)}</b></td>
				<td class="r">${g.members ? `<button class="btn btn-xs btn-primary">${__("Open")} <i class="fa fa-chevron-right"></i></button>` : ""}</td></tr>`;
			$body.html(gs.length ? `
				<div class="gos-head"><div><h3><i class="fa fa-users" style="color:#3498DB;"></i> ${__("All {0}s with something open", [__(group_dt())])}</h3>
					<div class="sub">${gs.length === 1 ? __("1 group") : __("{0} groups", [gs.length])} · ${__("click one to see each member's items and take one payment for them")} · ${esc(o.company || "")}</div></div>
					<div class="gos-k"><div class="is-due"><span>${sup ? __("We owe") : __("They owe")}</span><b>${m(sum("due"))}</b></div>
						<div class="is-due"><span>${__("Overdue")}</span><b>${m(sum("overdue"))}</b></div>
						<div class="is-net"><span>${sup ? __("Net to pay") : __("Net to receive")}</span><b>${m(sum("net"))}</b></div></div></div>
				<div class="gos-m"><table class="gos-t gos-all-t"><tr><th>${__("Group")}</th><th class="r">${__("Items")}</th><th class="r">${sup ? __("We owe") : __("They owe")}</th>
					<th class="r">${__("Overdue")}</th><th class="r">${sup ? __("They hold") : __("Held for them")}</th><th class="r">${sup ? __("Net to pay") : __("Net to receive")}</th><th></th></tr>
					${gs.map(row).join("")}</table></div>`
				: `<div class="gos-empty"><i class="fa fa-users fa-2x"></i><br><br>${__("No group has anything open.")}<br><small>${__("Branches of one firm: put them in one {0} (on each {1}'s form).", [__(group_dt()), __(f_type.get_value())])}</small></div>`);
		});
	}
	$body.on("click", ".gos-gr", (e) => { const $r = $(e.currentTarget); if (!$r.data("none")) f_group.set_value(String($r.data("g"))); });

	// one customer / supplier: what is open (tick → Receive / Pay) and the ledger for the dates
	function load_party() {
		$bar.hide();
		$body.html(`<div class="gos-empty">${__("Loading…")}</div>`);
		get_party().then(v => { data = Object.assign({}, v, { group: null, members: [] }); paint_party(); });
	}
	const get_party = () => frappe.call({ method: "erp_dacsinc_custom.party_group.get_party_view",
		args: { party_type, party, from_date: led_from, to_date: led_to } }).then(r => r.message);
	// one customer / supplier: the same Account Summary as its form (public/js/party_summary.js — Receive / Pay,
	// Adjust, Refund, Returns, orders, history, payments, statement), then its ledger for the dates
	function paint_party() {
		const v = data;
		const back = party_back ? __("Back to {0}", [esc(party_back)]) : overview === "party" ? (supplier() ? __("All suppliers") : __("All customers")) : __("All groups");
		$body.html(`
			<div class="gos-pbar"><button class="btn btn-xs btn-default gos-back"><i class="fa fa-arrow-left"></i> ${back}</button>
				<b><i class="fa fa-user" style="color:#3498DB;"></i> ${esc(v.party_name)}</b>${v.disabled ? ` <span class="gos-late">${__("Disabled")}</span>` : ""}
				<span>${link(v.party_type, v.party)}${v.group ? ` · <i class="fa fa-users"></i> ${v.group_is_firm ? `<a href="#" class="gos-opengroup" data-g="${esc(v.group)}">${esc(v.group)}</a>` : esc(v.group)}` : ""}</span></div>
			<div class="gos-sum"></div>
			<div class="gos-led"></div>`);
		frappe.require("/assets/erp_dacsinc_custom/js/party_summary.js", () =>
			dacs_party_summary($body.find(".gos-sum"), v.party_type, v.party, v.party_name, () => refresh_ledger()));
		paint_ledger();
	}
	// after a payment / adjust / refund from the summary: only the ledger is fetched again
	const refresh_ledger = () => get_party().then(v => { if (party === v.party) { data = Object.assign({}, v, { group: null, members: [] }); paint_ledger(); } });
	function paint_ledger() {
		const v = data, L = v.ledger, sup = supplier();
		const bal = (x) => { x = flt(x, 2); return Math.abs(x) < 0.005 ? money(0) : `${money(Math.abs(x))} <span class="gos-drcr">${x > 0 ? "Dr" : "Cr"}</span>`; };
		const rows = L.entries.map(e => `<tr><td>${date(e.posting_date)}</td>
			<td>${link(e.voucher_type, e.voucher_no)}<small>${esc(__(e.voucher_type))}${e.details ? " · " + esc(e.details) : ""}</small></td>
			<td class="r gos-dr">${flt(e.debit) ? money(e.debit) : ""}</td><td class="r gos-cr">${flt(e.credit) ? money(e.credit) : ""}</td>
			<td class="r"><b>${bal(e.balance)}</b></td></tr>`).join("");
		$body.find(".gos-led").html(`
				<div class="gos-led-h"><h4><i class="fa fa-book" style="color:#3498DB;"></i> ${__("Ledger")}</h4>
					<input type="date" class="gos-from" value="${esc(String(v.from_date))}"> – <input type="date" class="gos-to" value="${esc(String(v.to_date))}">
					<button class="btn btn-xs btn-default gos-stmt"><i class="fa fa-file-pdf-o"></i> ${__("Statement PDF")}</button>
					<a class="btn btn-xs btn-default" target="_blank" href="/app/query-report/General Ledger?${new URLSearchParams({ company: v.company, party_type: v.party_type, party: v.party, from_date: v.from_date, to_date: v.to_date, group_by: "Group by Voucher (Consolidated)" })}"><i class="fa fa-table"></i> ${__("General Ledger")}</a>
					<a class="btn btn-xs btn-default" target="_blank" href="/app/${frappe.router.slug(v.party_type)}/${encodeURIComponent(v.party)}"><i class="fa fa-external-link"></i> ${__("Open {0}", [__(v.party_type)])}</a></div>
				<div class="gos-m"><table class="gos-t"><tr><th>${__("Date")}</th><th>${__("Voucher")}</th><th class="r">${__("Debit")}</th><th class="r">${__("Credit")}</th><th class="r">${__("Balance")}</th></tr>
					<tr class="is-ob"><td>${date(v.from_date)}</td><td>${__("Opening balance")}</td><td></td><td></td><td class="r">${bal(L.opening)}</td></tr>
					${rows || `<tr><td colspan="5" class="text-muted">${__("No entries in these dates.")}</td></tr>`}
					<tr class="is-ob"><td>${date(v.to_date)}</td><td>${__("Closing balance")}</td><td></td><td></td><td class="r">${bal(L.closing)}</td></tr></table></div>
				<div class="gos-note" style="margin-top:6px;">${sup ? __("Cr balance = we owe the supplier; Dr = they owe us (advance).") : __("Dr balance = the customer owes us; Cr = we owe them (advance / credit).")}</div>`);
	}
	$body.on("change", ".gos-from, .gos-to", () => {
		led_from = $body.find(".gos-from").val() || led_from; led_to = $body.find(".gos-to").val() || led_to;
		refresh_ledger();
	});
	$body.on("click", ".gos-stmt", () => statement());
	$body.on("click", ".gos-opengroup", (e) => { e.preventDefault(); const g = String($(e.currentTarget).data("g")); party = party_back = null; if (f_group.get_value() === g) load(); else f_group.set_value(g); });

	function paint() {
		const t = data.totals, owing = data.members.filter(m => m.items.length);
		const who = supplier() ? __("suppliers") : __("customers");
		$body.html(`
			<div class="gos-head">
				<div><button class="btn btn-xs btn-default gos-back" style="margin-bottom:6px;"><i class="fa fa-arrow-left"></i> ${__("All groups")}</button>
					<h3><i class="fa fa-users" style="color:#3498DB;"></i> ${esc(data.group)}</h3>
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
			$body.find(".gos-tools").after(`<div class="gos-note"><i class="fa fa-info-circle" style="color:#3498DB;"></i> ${__("Green rows (credit notes, advances) are held for that {0}: <b>Adjust</b> sets them off against what it owes; <b>Summary & ledger</b> opens its full Account Summary (refund, returns, orders, payments) and ledger.", [supplier() ? __("supplier") : __("customer")])}</div>`);
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
				${data.group ? `<span class="gos-mact">
					${m.credit > 0.005 && m.items.length ? `<button class="btn btn-xs btn-default gos-adjust" data-p="${esc(m.party)}" title="${esc(__("Set what is held for them against what they owe"))}"><i class="fa fa-exchange"></i> ${__("Adjust")} ${money(Math.min(m.credit, m.due))}</button>` : ""}
					<button class="btn btn-xs btn-default gos-ledger" data-p="${esc(m.party)}" title="${esc(__("Account Summary and ledger"))}"><i class="fa fa-book"></i> ${__("Summary & ledger")}</button></span>` : ""}
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
			: data.group ? __("Nothing ticked — the prompt opens with all {0} members that owe.", [data.members.filter(m => m.items.length).length])
				: __("Nothing ticked — the prompt opens for {0}; the amount is set against the oldest first.", [esc(data.members[0].party_name)])}</div>
			<button class="btn btn-primary gos-pay"><i class="fa fa-${supplier() ? "arrow-up" : "arrow-down"}"></i> ${p.length ? __("{0} {1}", [act, money(total)]) : (data.group ? __("{0} payment for the group", [act]) : __("{0} payment", [act]))}</button>`).show();
	}

	$body.on("change", ".gos-i", (e) => { const n = String($(e.currentTarget).data("n")); e.currentTarget.checked ? ticked.add(n) : ticked.delete(n); paint_member($(e.currentTarget).closest(".gos-m")); });
	$body.on("change", ".gos-p", (e) => {
		const $m = $(e.currentTarget).closest(".gos-m"), m = data.members.find(x => x.party === String($m.data("p")));
		m.items.forEach(i => e.currentTarget.checked ? ticked.add(i.name) : ticked.delete(i.name));
		paint_member($m);
	});
	$body.on("click", ".gos-all", () => { data.members.forEach(m => m.items.forEach(i => ticked.add(i.name))); party ? paint_party() : paint(); });
	$body.on("click", ".gos-adjust", (e) => {
		e.preventDefault();
		const m = data.members.find(x => x.party === String($(e.currentTarget).data("p")));
		frappe.require("/assets/erp_dacsinc_custom/js/party_summary.js", () =>
			dacs_party_adjust(data.party_type, m.party, m.party_name, data.currency, () => load()));
	});
	$body.on("click", ".gos-ledger", (e) => { e.preventDefault(); open_party(String($(e.currentTarget).data("p")), data.group); });
	$body.on("click", ".gos-back", () => {
		if (!party) return f_group.set_value("");
		const back = party_back; party = party_back = null;
		if ((back || "") !== (f_group.get_value() || "")) f_group.set_value(back || ""); else load();
	});
	$body.on("click", ".gos-none", () => { ticked.clear(); party ? paint_party() : paint(); });
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

	function statement() {
		const q = new URLSearchParams({ party_type: data.party_type, party: data.party, from_date: led_from, to_date: led_to, company: data.company });
		window.open(`/api/method/erp_dacsinc_custom.party_statement.statement_pdf?${q.toString()}`, "_blank");
	}
	function print() {
		if (party && data && data.party) return statement();
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
		if (ro.party_type && ro.party_type !== party_type) {   // switch without a reload: the group (if any) loads next
			party_type = ro.party_type === "Supplier" ? "Supplier" : "Customer";
			$type.find("button").each((_, b) => $(b).toggleClass("is-on", $(b).data("t") === party_type));
			f_group.df.options = group_dt();
		}
		if (ro.group) overview = "group";
		paint_view();
		if (ro.party) return open_party(ro.party, null);
		if (ro.group && ro.group !== f_group.get_value()) f_group.set_value(ro.group); else if (!data) load();
	};
};
frappe.pages["group-outstanding"].on_page_show = function (wrapper) {
	wrapper.gos_show && wrapper.gos_show();
};
