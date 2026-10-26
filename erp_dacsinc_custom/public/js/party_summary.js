// Account Summary on the Customer / Supplier form (custom field custom_account_summary, at the top) —
// only for Admin, System Manager, Accounts Executive, Accounts Manager (party_balance.FINANCE_ROLES;
// the server returns nothing to anyone else and the section is hidden).
//   • Position card: the net figure in words, worked out as unpaid − advance / credit = balance
//   • cards: unpaid, overdue, billed this year, received / paid this year (+ credit limit)
//   • advance and unpaid together → a step that says what Adjust will do, with the button
//   • unpaid invoices (ageing), advances / notes waiting, recent payments
// Data: party_balance.get_party_summary. Receive / Make Payment = the payment prompt
// (public/js/bulk_payment.js); Adjust = party_balance.adjust_advances (ERPNext Payment Reconciliation).
(function () {
	const ROLES = ["Admin", "System Manager", "Accounts Executive", "Accounts Manager"];
	const CSS = `
	.dps { font-size: 13px; color: var(--text-color); }
	.dps-bar { display: flex; flex-wrap: wrap; gap: 8px; align-items: center; margin-bottom: 8px; }
	.dps-bar__state { font-size: 13px; font-weight: 700; border-radius: 16px; padding: 4px 12px; }
	.dps-bar__state.is-due { background: #fdecea; color: #b03a2e; } .dps-bar__state.is-adv { background: #e8f6ee; color: #1e8449; }
	.dps-bar__state.is-zero { background: var(--subtle-fg); color: var(--text-muted); }
	.dps-bar__btns { margin-left: auto; display: flex; flex-wrap: wrap; gap: 6px; }
	.dps-sec { font-size: 11.5px; font-weight: 700; color: var(--text-muted); text-transform: uppercase; letter-spacing: .05em; margin: 14px 0 6px; display: flex; gap: 8px; align-items: baseline; }
	.dps-sec small { text-transform: none; letter-spacing: 0; font-weight: 500; }
	.dps-kpi { display: grid; grid-template-columns: repeat(4, minmax(0, 1fr)); gap: 8px; }
	@media (max-width: 1000px) { .dps-kpi { grid-template-columns: repeat(2, minmax(0, 1fr)); } }
	@media (max-width: 520px) { .dps-kpi { grid-template-columns: 1fr; } }
	.dps-k { position: relative; background: var(--card-bg, #fff); border: 1px solid var(--border-color); border-left: 3px solid #aab7c4; border-radius: 8px;
		padding: 7px 10px 7px 12px; min-width: 0; }
	.dps-k__i { position: absolute; top: 7px; right: 8px; width: 20px; height: 20px; border-radius: 50%; display: flex; align-items: center; justify-content: center; font-size: 10px; background: var(--subtle-fg); color: var(--text-muted); }
	.dps-k__l { font-size: 11.5px; font-weight: 600; color: var(--text-muted); padding-right: 24px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
	.dps-k__v { font-size: 16px; font-weight: 800; font-variant-numeric: tabular-nums; margin: 1px 0; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
	.dps-k__v small { font-size: 11px; font-weight: 700; margin-left: 2px; }
	.dps-k__s { font-size: 11px; color: var(--text-muted); line-height: 1.35; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
	.dps-k__s b { color: var(--text-color); font-weight: 600; }
	.dps-k.is-red { border-left-color: #e74c3c; } .dps-k.is-red .dps-k__v { color: #c0392b; } .dps-k.is-red .dps-k__i { background: #fdecea; color: #c0392b; }
	.dps-k.is-orange { border-left-color: #e67e22; } .dps-k.is-orange .dps-k__v { color: #d35400; } .dps-k.is-orange .dps-k__i { background: #fdf2e3; color: #d35400; }
	.dps-k.is-green { border-left-color: #27ae60; } .dps-k.is-green .dps-k__v { color: #1e8449; } .dps-k.is-green .dps-k__i { background: #e8f6ee; color: #1e8449; }
	.dps-k.is-blue { border-left-color: #3498DB; } .dps-k.is-blue .dps-k__v { color: #21618c; } .dps-k.is-blue .dps-k__i { background: #e8f1fb; color: #2471a3; }
	.dps-k.is-purple { border-left-color: #8e44ad; } .dps-k.is-purple .dps-k__v { color: #6c3483; } .dps-k.is-purple .dps-k__i { background: #f4ecf7; color: #7d3c98; }
	.dps-k.is-grey .dps-k__v { color: var(--text-muted); }
	.dps-k__chips { display: inline; margin-left: 4px; }
	.dps-k__chips span { font-size: 10.5px; border-radius: 8px; padding: 0 6px; background: var(--subtle-fg); color: var(--text-color); white-space: nowrap; margin-right: 3px; }
	.dps-cards { display: grid; grid-template-columns: repeat(auto-fit, minmax(170px, 1fr)); gap: 10px; }
	.dps-card { border: 1px solid var(--border-color); border-radius: 10px; padding: 12px 14px; background: var(--card-bg, #fff); display: flex; flex-direction: column; gap: 3px; }
	.dps-card__t { font-size: 12px; font-weight: 700; color: var(--text-muted); display: flex; gap: 6px; align-items: center; }
	.dps-card__t .fa { width: 22px; height: 22px; border-radius: 6px; display: inline-flex; align-items: center; justify-content: center; font-size: 11px; }
	.dps-card__v { font-size: 20px; font-weight: 800; font-variant-numeric: tabular-nums; }
	.dps-card__s { font-size: 12px; color: var(--text-muted); }
	.dps-card.is-red .fa { background: #fdecea; color: #c0392b; } .dps-card.is-red .dps-card__v { color: #c0392b; }
	.dps-card.is-orange .fa { background: #fdf2e3; color: #d35400; } .dps-card.is-orange .dps-card__v { color: #d35400; }
	.dps-card.is-green .fa { background: #e8f6ee; color: #1e8449; } .dps-card.is-green .dps-card__v { color: #1e8449; }
	.dps-card.is-blue .fa { background: #e8f1fb; color: #2471a3; }
	.dps-card.is-grey .fa { background: var(--subtle-fg); color: var(--text-muted); } .dps-card.is-grey .dps-card__v { color: var(--text-muted); }
	.dps-note { margin-top: 12px; border-left: 4px solid #f1c40f; background: #fffbea; border-radius: 6px; padding: 9px 12px; display: flex; flex-wrap: wrap; gap: 10px; align-items: center; }
	.dps-note__txt { flex: 1 1 380px; } .dps-note__txt b { font-variant-numeric: tabular-nums; }
	.dps-box { border: 1px solid var(--border-color); border-radius: 10px; margin-top: 14px; overflow: hidden; background: var(--card-bg, #fff); }
	.dps-box__h { display: flex; flex-wrap: wrap; gap: 8px; align-items: center; padding: 9px 14px; background: var(--subtle-fg); font-weight: 700; }
	.dps-box__h small { font-weight: 400; color: var(--text-muted); } .dps-box__h a { margin-left: auto; font-weight: 600; font-size: 12px; }
	.dps-age { display: flex; flex-wrap: wrap; gap: 6px; padding: 10px 14px 0; }
	.dps-age span { border-radius: 14px; padding: 3px 10px; font-size: 12px; border: 1px solid var(--border-color); }
	.dps-age span b { font-variant-numeric: tabular-nums; } .dps-age span.is-on.is-late { background: #fdecea; border-color: #f5b7b1; color: #a93226; }
	.dps-age span.is-on.is-ok { background: #eaf2f8; border-color: #aed6f1; color: #21618c; }
	.dps-t { width: 100%; border-collapse: collapse; }
	.dps-t th { background: #3498DB; color: #fff; font-size: 12px; font-weight: 700; padding: 8px 14px; text-align: left; white-space: nowrap; border-right: 1px solid rgba(255,255,255,.35); }
	.dps-t th:last-child { border-right: 0; }
	.dps-t td { padding: 9px 14px; border-bottom: 1px solid var(--border-color); vertical-align: middle; }
	.dps-t tr:last-child td { border-bottom: 0; }
	.dps-t .r { text-align: right; font-variant-numeric: tabular-nums; white-space: nowrap; }
	.dps-t td small { display: block; color: var(--text-muted); font-size: 11.5px; }
	.dps-pill { display: inline-block; border-radius: 10px; padding: 2px 9px; font-size: 11.5px; font-weight: 700; white-space: nowrap; }
	.dps-pill.is-late { background: #fdecea; color: #a93226; } .dps-pill.is-ok { background: #eaf2f8; color: #21618c; }
	.dps-pill.is-part { background: #fdf2e3; color: #a04000; } .dps-pill.is-green { background: #e8f6ee; color: #1e8449; }
	.dps-fold { border: 1px solid var(--border-color); border-radius: 10px; margin-top: 12px; background: var(--card-bg, #fff); overflow: hidden; }
	.dps-fold__h { display: flex; flex-wrap: wrap; gap: 6px 12px; align-items: center; padding: 11px 14px; cursor: pointer; user-select: none; }
	.dps-fold__h:hover { background: #f5f9fd; }
	.dps-fold__h > .fa-chevron-right { color: #3498DB; transition: transform .15s; width: 12px; }
	.dps-fold.is-open > .dps-fold__h > .fa-chevron-right { transform: rotate(90deg); }
	.dps-fold__t { font-weight: 700; font-size: 13.5px; display: flex; gap: 7px; align-items: center; }
	.dps-fold__t .fa { color: #3498DB; }
	.dps-fold__sum { display: flex; flex-wrap: wrap; gap: 6px; }
	.dps-fold__sum span { font-size: 12px; border-radius: 12px; padding: 2px 10px; background: var(--subtle-fg); white-space: nowrap; }
	.dps-fold__sum span.is-red { background: #fdecea; color: #a93226; } .dps-fold__sum span.is-orange { background: #fdf2e3; color: #a04000; }
	.dps-fold__sum span.is-green { background: #e8f6ee; color: #1e8449; } .dps-fold__sum span.is-blue { background: #e8f1fb; color: #21618c; }
	.dps-fold__hint { margin-left: auto; font-size: 11.5px; color: var(--text-muted); }
	.dps-fold__b { display: none; border-top: 1px solid var(--border-color); padding: 12px 14px 14px; }
	.dps-fold.is-open > .dps-fold__b { display: block; }
	.dps-fold__b .dps-box:first-child { margin-top: 0; }
	.dps-fold[data-k="docs"] > .dps-fold__b { padding: 0; }
	.dps-fold__h { padding: 9px 14px; }
	.dps-docs .dps-filt { padding: 8px 14px; }
	.dps-docs .dps-age { padding: 8px 14px 0; } .dps-docs .dps-empty { padding: 10px 14px; }
	.dps-docs-sub { font-size: 11.5px; color: var(--text-muted); }
	.dps-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(360px, 1fr)); gap: 14px; }
	.dps-empty { color: var(--text-muted); padding: 14px; }
	.dps-meta { color: var(--text-muted); font-size: 12px; margin-top: 10px; }
	.dps-filt { display: flex; flex-wrap: wrap; gap: 6px; align-items: center; padding: 10px 14px; border-bottom: 1px solid var(--border-color); }
	.dps-chip { border: 1px solid var(--border-color); background: var(--card-bg, #fff); border-radius: 16px; padding: 4px 12px; font-size: 12px; font-weight: 600; cursor: pointer; }
	.dps-chip.is-on { background: #3498DB; border-color: #3498DB; color: #fff; }
	.dps-filt input[type=date] { width: 140px; display: inline-block; height: 28px; font-size: 12px; }
	.dps-filt .dps-dates { margin-left: auto; display: flex; gap: 6px; align-items: center; font-size: 12px; color: var(--text-muted); }
	.dps-tog { cursor: pointer; width: 26px; color: #3498DB; } .dps-tog .fa { transition: transform .15s; } tr.is-open .dps-tog .fa { transform: rotate(90deg); }
	tr.dps-main { cursor: pointer; } tr.dps-main:hover td { background: #f5f9fd; } tr.is-open td { background: #eef6fd; }
	tr.dps-sub > td { background: #fafbfc; padding: 10px 14px 14px 40px; }
	.dps-chain { display: flex; flex-wrap: wrap; gap: 6px; align-items: center; margin-bottom: 8px; }
	.dps-chain .lbl { font-size: 11px; font-weight: 700; color: var(--text-muted); text-transform: uppercase; margin-right: 2px; }
	.dps-chain a.doc { border: 1px solid var(--border-color); background: #fff; border-radius: 6px; padding: 2px 8px; font-size: 12px; }
	.dps-chain .arr { color: var(--text-muted); }
	.dps-mini { width: 100%; border-collapse: collapse; background: #fff; border: 1px solid var(--border-color); }
	.dps-mini th { background: #5dade2; color: #fff; font-size: 11.5px; padding: 5px 10px; text-align: left; }
	.dps-mini td { padding: 5px 10px; border-top: 1px solid var(--border-color); font-size: 12px; }
	.dps-mini .r, .dps-mini th.r { text-align: right; font-variant-numeric: tabular-nums; }
	.dpa-t input { width: 120px; text-align: right; display: inline-block; font-weight: 700; }`;

	const allowed = () => frappe.user.has_role(ROLES);

	function render(frm) {
		const fd = frm.fields_dict.custom_account_summary;
		if (!fd) return;
		const show = !frm.is_new() && allowed();
		frm.toggle_display(["custom_account_section", "custom_account_summary"], show);
		if (!show) { fd.$wrapper.html(""); return; }
		fd.$wrapper.html(`<div class="text-muted" style="padding:6px 0;">${__("Loading account summary…")}</div>`);
		frappe.call({ method: "erp_dacsinc_custom.party_balance.get_party_summary", args: { party_type: frm.doctype, party: frm.doc.name } })
			.then(r => paint(frm, fd.$wrapper, r.message || {}, frm.doctype === "Customer"));
	}

	function paint(frm, $w, s, customer) {
		if (!s.company) { $w.html(""); return; }
		const esc = frappe.utils.escape_html;
		const money = (v) => format_currency(flt(v, 2), s.currency);
		const date = (d) => d ? frappe.datetime.str_to_user(d) : "";
		const inv_dt = customer ? "Sales Invoice" : "Purchase Invoice";
		const one = customer ? __("invoice") : __("bill"), many = customer ? __("invoices") : __("bills");
		const count = (n) => `${n} ${n === 1 ? one : many}`;
		const link = (dt, n) => `<a href="/app/${frappe.router.slug(dt)}/${encodeURIComponent(n)}" target="_blank">${esc(n)}</a>`;
		const bal = flt(s.balance);
		const n_unpaid = s.unpaid.length;
		const n_adv = (s.advances || []).length, n_notes = (s.notes || []).length;
		const credits = flt(s.advance_total) + (s.notes || []).reduce((a, n) => a - flt(n.outstanding_amount), 0);
		const other = flt(bal - (flt(s.outstanding) - credits), 2);   // opening balances, journal entries…

		// ── state chip + buttons, then six equal figures ─────────────────────────────────
		const state_cls = bal > 0.005 ? "is-due" : bal < -0.005 ? "is-adv" : "is-zero";
		const state_txt = bal > 0.005 ? (customer ? __("Customer owes us {0}", [money(bal)]) : __("We owe the supplier {0}", [money(bal)]))
			: bal < -0.005 ? (customer ? __("Advance with us {0}", [money(-bal)]) : __("Advance with the supplier {0}", [money(-bal)])) : __("All settled");
		const report = (name, extra) => `/app/query-report/${encodeURIComponent(name)}?${new URLSearchParams(Object.assign({ company: s.company }, extra)).toString()}`;
		const bar = `<div class="dps-bar">
			<span class="dps-bar__state ${state_cls}">${state_txt}</span>
			<span class="dps-docs-sub">${esc(s.company)} · ${__("this year: billed {0}, {1} {2}", [money(s.billed_fy), customer ? __("received") : __("paid"), s.can_pe ? money(s.paid_fy) : "—"])}</span>
			<div class="dps-bar__btns">
				${s.can_pay ? `<button class="btn btn-sm btn-primary dps-pay"><i class="fa fa-${customer ? "arrow-down" : "arrow-up"}"></i> ${customer ? __("Receive Payment") : __("Make Payment")}</button>` : ""}
				<button class="btn btn-sm btn-default dps-stmt"><i class="fa fa-print"></i> ${__("Print Statement")}</button>
				<a class="btn btn-sm btn-default" target="_blank" href="${report("General Ledger", { party_type: frm.doctype, party: frm.doc.name, from_date: frappe.datetime.add_months(frappe.datetime.get_today(), -12), to_date: frappe.datetime.get_today(), group_by: "Group by Voucher (Consolidated)" })}"><i class="fa fa-book"></i> ${__("Ledger")}</a>
				<a class="btn btn-sm btn-default" target="_blank" href="${report(customer ? "Accounts Receivable" : "Accounts Payable", { party_type: frm.doctype, party: frm.doc.name })}"><i class="fa fa-bar-chart"></i> ${__("Ageing")}</a>
				<button class="btn btn-sm btn-default dps-refresh" title="${esc(__("Refresh"))}"><i class="fa fa-refresh"></i></button>
			</div></div>`;

		const k = (cls, icon, label, value, sub, chips) => `<div class="dps-k is-${cls}"><span class="dps-k__i"><i class="fa fa-${icon}"></i></span>
			<div class="dps-k__l">${label}</div><div class="dps-k__v">${value}</div>
			<div class="dps-k__s" title="${esc($("<div>").html(sub).text())}">${sub}${chips && chips.length ? `<span class="dps-k__chips">${chips.map(c => `<span>${c}</span>`).join("")}</span>` : ""}</div></div>`;
		const limit = customer && s.credit_limit ? ` · ${bal > s.credit_limit ? __("Over credit limit by <b>{0}</b>", [money(bal - s.credit_limit)]) : __("Credit limit <b>{0}</b>", [money(s.credit_limit)])}` : "";
		const o = s.orders || {};
		const odt = customer ? __("Sales Orders") : __("Purchase Orders");
		const n_ord = (n) => `${n} ${n === 1 ? (customer ? __("order") : __("PO")) : (customer ? __("orders") : __("POs"))}`;
		const ord_url = (extra) => `/app/${frappe.router.slug(o.doctype || (customer ? "Sales Order" : "Purchase Order"))}?${new URLSearchParams(Object.assign({ [customer ? "customer" : "supplier"]: frm.doc.name }, extra)).toString()}`;
		const kpi = `
		<div class="dps-kpi">
			${k(bal > 0.005 ? "red" : bal < -0.005 ? "green" : "grey", "balance-scale",
				bal > 0.005 ? (customer ? __("Net balance — they owe") : __("Net balance — we owe")) : bal < -0.005 ? __("Net balance — advance") : __("Net balance"),
				`${money(Math.abs(bal))}<small>${bal > 0.005 ? (customer ? "Dr" : "Cr") : bal < -0.005 ? (customer ? "Cr" : "Dr") : ""}</small>`,
				`<b>${money(s.outstanding)}</b> ${__("unpaid")} − <b>${money(credits)}</b> ${__("advance")}${Math.abs(other) > 0.005 ? ` ${other > 0 ? "+" : "−"} <b>${money(Math.abs(other))}</b> ${__("other")}` : ""}${limit}`)}
			${k(n_unpaid ? "red" : "grey", "file-text-o", customer ? __("Unpaid invoices") : __("Unpaid bills"), money(s.outstanding),
				n_unpaid ? count(n_unpaid) + (s.unpaid.length && s.unpaid[0].due_date ? " · " + __("next due {0}", [date(s.unpaid.filter(u => !u.days_overdue).map(u => u.due_date)[0] || s.unpaid[0].due_date)]) : "") : __("Nothing unpaid"))}
			${k(s.overdue_count ? "orange" : "grey", "clock-o", __("Overdue"), money(s.overdue),
				s.overdue_count ? __("{0} past due date", [count(s.overdue_count)]) : __("Nothing past due date"))}
			${k(credits > 0.005 ? "green" : "grey", "money", __("Advance / credit"), money(credits),
				credits > 0.005 ? __("Not yet set against invoices") : __("Nothing waiting"),
				[n_adv ? __("{0} advance", [n_adv]) : "", n_notes ? (customer ? __("{0} credit note", [n_notes]) : __("{0} debit note", [n_notes])) : ""].filter(Boolean))}
		</div>`;
		const orders_body = `<div class="dps-kpi">
			${k(o.draft_n ? "purple" : "grey", "pencil", customer ? __("Draft / awaiting approval") : __("Draft"), money(o.draft_amount),
				o.draft_n ? n_ord(o.draft_n) + " " + __("not submitted") : __("None"),
				(o.drafts || []).map(d => `${esc(__(d.state))}: ${d.n}`))}
			${k(o.open_n ? "blue" : "grey", "folder-open-o", __("Open orders"), money(o.open_amount),
				o.open_n ? n_ord(o.open_n) + " " + __("in progress") : __("None open"),
				(o.open || []).map(x => `${esc(__(x.status))}: ${x.n}`))}
			${k(o.to_do > 0.005 ? "orange" : "grey", customer ? "truck" : "inbox", customer ? __("To deliver") : __("To receive"), money(o.to_do),
				o.to_do > 0.005 ? __("still to {0} on {1}", [customer ? __("deliver") : __("receive"), n_ord(o.to_do_n)]) : __("Everything {0}", [customer ? __("delivered") : __("received")]))}
			${k(o.to_bill > 0.005 ? "red" : "grey", "file-text", __("To bill"), money(o.to_bill),
				o.to_bill > 0.005 ? __("{0} but not yet billed · {1}", [customer ? __("delivered") : __("received"), n_ord(o.to_bill_n)]) : __("Nothing waiting to be billed"))}
		</div>
		<div class="dps-meta">${__("{0} completed", [o.completed_n || 0])} · <a href="${ord_url({})}" target="_blank">${__("Open the {0} list", [odt])}</a></div>`;

		// ── advance and unpaid together: one line saying what Adjust does ─────────────────
		const can_adjust = s.can_pe && credits > 0.005 && n_unpaid;
		const use = Math.min(credits, flt(s.outstanding));
		const step = can_adjust ? `<div class="dps-note"><i class="fa fa-exchange" style="color:#b7950b;"></i>
			<div class="dps-note__txt">${__("Advance / credit <b>{0}</b> is not yet set against {1} (<b>{2}</b> unpaid).", [money(credits), count(n_unpaid), money(s.outstanding)])}
				${credits >= flt(s.outstanding) - 0.005 ? __("Adjusting makes them Paid; {0} advance stays for later.", [money(credits - use)]) : __("Adjusting leaves {0} unpaid.", [money(flt(s.outstanding) - use)])}</div>
			<button class="btn btn-sm btn-primary dps-adjust">${__("Adjust {0}", [money(use)])}</button></div>` : "";

		// ── documents: unpaid / all / paid / notes / orders, each row opens to its chain ─────────
		const age = AGE_CHIPS(s, money);
		const unpaid = `<div class="dps-docs">
			<div class="dps-filt">
				${[["unpaid", customer ? __("Unpaid invoices") : __("Unpaid bills")], ["all", customer ? __("All invoices") : __("All bills")], ["paid", __("Paid")],
					["returns", customer ? __("Credit notes") : __("Debit notes")], ["orders", customer ? __("Sales Orders (with quotation, delivery, invoice)") : __("Purchase Orders (with receipt, bill)")]]
					.map(([k, l]) => `<span class="dps-chip" data-v="${k}">${l}</span>`).join("")}
				<span class="dps-dates">${__("From")} <input type="date" class="form-control dps-from"> ${__("to")} <input type="date" class="form-control dps-to"></span>
			</div>
			<div class="dps-age-wrap">${age}</div>
			<div class="dps-docs-body"><div class="dps-empty">${__("Loading…")}</div></div>
		</div>`;

		const credit_rows = [
			...(s.advances || []).map(a => `<tr><td><b>${link("Payment Entry", a.name)}</b><small>${__("Advance payment")} · ${date(a.posting_date)}${a.mode_of_payment ? " · " + esc(a.mode_of_payment) : ""}${a.reference_no ? " · " + esc(a.reference_no) : ""}</small></td><td class="r"><b>${money(a.unallocated_amount)}</b></td></tr>`),
			...(s.notes || []).map(n => `<tr><td><b>${link(inv_dt, n.name)}</b><small>${customer ? __("Credit Note") : __("Debit Note")} · ${date(n.posting_date)}${n.return_against ? " · " + __("against {0}", [esc(n.return_against)]) : ""}</small></td><td class="r"><b>${money(-flt(n.outstanding_amount))}</b></td></tr>`),
		].join("");
		const credit_box = `<div class="dps-box"><div class="dps-box__h">${__("Advance / credit not adjusted")} <small>${money(credits)}</small></div>
			${credit_rows ? `<table class="dps-t"><tr><th>${__("Document")}</th><th class="r">${__("Not adjusted")}</th></tr>${credit_rows}</table>` : `<div class="dps-empty">${__("Nothing waiting.")}</div>`}</div>`;
		const pay_box = !s.can_pe ? "" : `<div class="dps-box"><div class="dps-box__h">${__("Recent payments")} <small>${__("last 8")}</small></div>
			${(s.payments || []).length ? `<table class="dps-t"><tr><th>${__("Payment")}</th><th class="r">${__("Amount")}</th><th></th></tr>
				${s.payments.map(p => `<tr><td><b>${link("Payment Entry", p.name)}</b><small>${date(p.posting_date)}${p.mode_of_payment ? " · " + esc(p.mode_of_payment) : ""}${p.reference_no ? " · " + esc(p.reference_no) : ""}${p.custom_bulk_payment ? " · " + __("Bulk Payment") + " " + esc(p.custom_bulk_payment) : ""}</small>
					${(p.payment_type === "Receive") !== customer ? `<span class="dps-pill is-part">${__("refund")}</span>` : ""}</td>
					<td class="r"><b>${money(p.paid_amount)}</b></td>
					<td class="r"><a class="btn btn-xs btn-default dps-print" data-pe="${esc(p.name)}" title="${esc(__("Print receipt"))}"><i class="fa fa-print"></i></a></td></tr>`).join("")}</table>`
				: `<div class="dps-empty">${__("No payments yet.")}</div>`}</div>`;

		// Money stays open; the rest fold away (the header keeps the key figures). Open / shut is
		// remembered per user and browser.
		const fold_key = (k) => `dps_fold:${frm.doctype}:${k}`;
		// Documents open by default (the most used), the others shut; the user's own choice wins
		const OPEN_BY_DEFAULT = { docs: true };
		const is_open = (k) => {
			let v = null;
			try { v = localStorage.getItem(fold_key(k)); } catch (e) { /* no storage */ }
			return v === null ? !!OPEN_BY_DEFAULT[k] : v === "1";
		};
		const fold = (key, icon, title, sums, body) => `<div class="dps-fold ${is_open(key) ? "is-open" : ""}" data-k="${key}">
			<div class="dps-fold__h"><i class="fa fa-chevron-right"></i><span class="dps-fold__t"><i class="fa fa-${icon}"></i>${title}</span>
				<span class="dps-fold__sum">${sums.filter(Boolean).map(([c, t]) => `<span class="${c ? "is-" + c : ""}">${t}</span>`).join("")}</span>
				<span class="dps-fold__hint">${__("click to open / close")}</span></div>
			<div class="dps-fold__b">${body}</div></div>`;

		$w.html(`<style>${CSS}</style><div class="dps">
			${bar}${kpi}${step}
			${fold("orders", customer ? "shopping-cart" : "truck", odt, [
				[o.open_n ? "blue" : "", __("{0} open · {1}", [o.open_n || 0, money(o.open_amount)])],
				[o.to_do > 0.005 ? "orange" : "", (customer ? __("to deliver {0}") : __("to receive {0}")).replace("{0}", money(o.to_do))],
				[o.to_bill > 0.005 ? "red" : "", __("to bill {0}", [money(o.to_bill)])],
				o.draft_n ? ["", __("{0} draft", [o.draft_n])] : null], orders_body)}
			${fold("docs", "file-text-o", __("Documents — invoices, notes, orders"), [
				[n_unpaid ? "red" : "", __("{0} unpaid · {1}", [n_unpaid, money(s.outstanding)])],
				s.overdue_count ? ["orange", __("overdue {0}", [money(s.overdue)])] : null,
				["", `<span class="dps-docs-sub">${__("click a row for Quotation → Order → Delivery → Invoice")}</span>`]], unpaid)}
			${fold("pays", "money", __("Advances & recent payments"), [
				[credits > 0.005 ? "green" : "", __("advance / credit {0}", [money(credits)])],
				s.can_pe && (s.payments || [])[0] ? ["", __("last payment {0} on {1}", [money(s.payments[0].paid_amount), date(s.payments[0].posting_date)])] : null],
				`<div class="dps-grid">${credit_box}${pay_box}</div>`)}
			<div class="dps-meta">${[esc(s.company), s.payment_terms ? __("Payment terms: {0}", [esc(s.payment_terms)]) : "",
				s.drafts ? __("{0} draft {1} not submitted yet", [s.drafts, s.drafts === 1 ? one : many]) : ""].filter(Boolean).join(" · ")}</div>
		</div>`);

		const refresh = () => render(frm);
		const pay = (o) => frappe.require("/assets/erp_dacsinc_custom/js/bulk_payment.js",
			() => dacs_payment_dialog(Object.assign({ payment_type: customer ? "Receive" : "Pay", party: frm.doc.name, from_form: 1, on_done: refresh }, o)));
		$w.find(".dps-pay").on("click", () => pay({}));
		$w.find(".dps-pay-one").on("click", (e) => pay({ invoice: String($(e.currentTarget).data("inv")) }));
		$w.find(".dps-adjust").on("click", () => adjust_dialog(frm, s, customer, refresh));
		$w.find(".dps-refresh").on("click", refresh);
		$w.find(".dps-stmt").on("click", () => statement_dialog(frm));
		// the documents load when their section is first opened
		let docs_loaded = false;
		const load_docs = () => { if (!docs_loaded) { docs_loaded = true; docs(frm, $w.find(".dps-docs"), s, customer, pay); } };
		if ($w.find('.dps-fold[data-k="docs"]').hasClass("is-open")) load_docs();
		$w.find(".dps-fold__h").on("click", (e) => {
			if ($(e.target).closest("a, button").length) return;
			const $f = $(e.currentTarget).closest(".dps-fold").toggleClass("is-open");
			const key = String($f.data("k")), open = $f.hasClass("is-open");
			try { localStorage.setItem(fold_key(key), open ? "1" : "0"); } catch (err) { /* no storage */ }
			if (key === "docs" && open) load_docs();
		});
		$w.find(".dps-print").on("click", (e) => window.open(dacs_print_url("Payment Entry", String($(e.currentTarget).data("pe"))), "_blank"));
	}

	function AGE_CHIPS(s, money) {
		const AGE = [["not_due", __("Not due yet"), "ok"], ["d30", __("1–30 days late"), "late"], ["d60", __("31–60 days late"), "late"],
			["d90", __("61–90 days late"), "late"], ["d90p", __("Over 90 days late"), "late"]];
		const on = AGE.filter(([k]) => flt((s.ageing || {})[k]) > 0.005);
		return on.length ? `<div class="dps-age" style="padding-bottom:10px;">${on.map(([k, l, c]) => `<span class="is-on is-${c}">${l}: <b>${money(s.ageing[k])}</b></span>`).join("")}</div>` : "";
	}

	// The Documents box: a view (chips) and a date range; each row opens to show where it came from and
	// what settled it (party_statement.get_party_documents). The unpaid view ignores the dates.
	function docs(frm, $box, s, customer, pay) {
		const esc = frappe.utils.escape_html;
		const money = (v) => format_currency(flt(v, 2), s.currency);
		const date = (d) => d ? frappe.datetime.str_to_user(d) : "";
		const link = (dt, n, cls) => `<a class="${cls || ""}" href="/app/${frappe.router.slug(dt)}/${encodeURIComponent(n)}" target="_blank" onclick="event.stopPropagation()">${esc(n)}</a>`;
		// the chosen view / dates stay while the same party is open
		if (!frm.__dps_docs || frm.__dps_docs.party !== frm.doc.name)
			frm.__dps_docs = { party: frm.doc.name, view: "unpaid", from: frappe.datetime.add_months(frappe.datetime.get_today(), -12), to: frappe.datetime.get_today() };
		const st = frm.__dps_docs;
		$box.find(".dps-from").val(st.from); $box.find(".dps-to").val(st.to);
		const pill = (cls, t) => `<span class="dps-pill is-${cls}">${t}</span>`;
		const status_pill = (r) => r.draft ? pill("part", esc(__(r.workflow_state || "Draft")))
			: r.doctype.endsWith("Invoice") ? (r.total < 0 ? pill("ok", __("Return"))
				: r.outstanding <= 0.005 ? pill("green", __("Paid"))
				: (r.due_date && r.due_date < frappe.datetime.get_today()) ? pill("late", __("{0} days late", [frappe.datetime.get_day_diff(frappe.datetime.get_today(), r.due_date)]))
				: r.outstanding < r.total - 0.005 ? pill("part", __("Part paid")) : pill("ok", __("Not due yet")))
			: pill(/Completed|Closed/.test(r.status) ? "green" : "ok", esc(__(r.status || "")));
		const chain = (label, items, dt) => items && items.length ? `<span class="lbl">${label}</span>${items.map(x => typeof x === "string" ? link(dt, x, "doc")
			: `${link(x.doctype, x.name, "doc")}${x.draft ? " " + pill("part", __("Draft")) : ""}`).join(" ")}<span class="arr">→</span>` : "";
		const pay_table = (rows, title) => rows && rows.length ? `<table class="dps-mini"><tr><th>${title}</th><th>${__("Date")}</th><th>${__("How")}</th><th class="r">${__("Amount")}</th></tr>
			${rows.map(p => `<tr><td>${link(p.doctype, p.name)}</td><td>${date(p.date)}</td><td>${esc(p.note || "")}</td><td class="r">${money(p.amount)}</td></tr>`).join("")}</table>` : "";

		const inv_rows = (rows) => `<table class="dps-t"><tr><th style="width:30px;"></th><th>${customer ? __("Invoice") : __("Bill")}</th><th>${__("Due date")}</th>
			<th class="r">${__("Total")}</th><th class="r">${__("Paid / adjusted")}</th><th class="r">${__("Still due")}</th><th>${__("Status")}</th><th></th></tr>
			${rows.map((r, i) => {
				const paid = r.total > 0 ? flt(r.total) - flt(r.outstanding) : 0;
				const c = r.chain || {};
				return `<tr class="dps-main" data-i="${i}"><td class="dps-tog"><i class="fa fa-chevron-right"></i></td>
					<td><b>${link(r.doctype, r.name)}</b><small>${date(r.date)}${r.bill_no ? " · " + esc(r.bill_no) : ""}${r.return_against ? " · " + __("against {0}", [esc(r.return_against)]) : ""}</small></td>
					<td>${date(r.due_date)}</td><td class="r">${money(r.total)}</td><td class="r">${paid > 0.005 ? money(paid) : "—"}</td>
					<td class="r"><b>${r.total > 0 ? money(r.outstanding) : "—"}</b></td><td>${status_pill(r)}</td>
					<td class="r">${s.can_pay && r.outstanding > 0.005 ? `<button class="btn btn-xs btn-default dps-pay-one" data-inv="${esc(r.name)}">${customer ? __("Receive") : __("Pay")}</button>` : ""}</td></tr>
				<tr class="dps-sub" data-i="${i}" style="display:none;"><td colspan="8">
					<div class="dps-chain">${chain(__("Quotation"), c.quotations, "Quotation")}${chain(customer ? __("Sales Order") : __("Purchase Order"), c.orders, customer ? "Sales Order" : "Purchase Order")}${chain(customer ? __("Delivery") : __("Receipt"), c.receipts, customer ? "Delivery Note" : "Purchase Receipt")}
						<span class="lbl">${customer ? __("Invoice") : __("Bill")}</span>${link(r.doctype, r.name, "doc")}</div>
					${pay_table(c.payments, __("Payments / notes against it")) || `<div class="text-muted">${__("Nothing paid or adjusted against it yet.")}</div>`}
				</td></tr>`;
			}).join("")}</table>`;

		const order_rows = (rows) => `<table class="dps-t"><tr><th style="width:30px;"></th><th>${customer ? __("Sales Order") : __("Purchase Order")}</th>
			<th class="r">${__("Total")}</th><th class="r">${customer ? __("Delivered") : __("Received")}</th><th class="r">${__("Billed")}</th><th>${__("Status")}</th></tr>
			${rows.map((r, i) => {
				const c = r.chain || {};
				const invs = c.invoices || [];
				return `<tr class="dps-main" data-i="${i}"><td class="dps-tog"><i class="fa fa-chevron-right"></i></td>
					<td><b>${link(r.doctype, r.name)}</b><small>${date(r.date)} · ${__("{0} quotation, {1} {2}, {3} {4}", [(c.quotations || []).length, (c.receipts || []).length,
						customer ? __("delivery") : __("receipt"), invs.length, customer ? __("invoice") : __("bill")])}</small></td>
					<td class="r">${money(r.total)}</td><td class="r">${Math.round(r.per_done || 0)}%</td><td class="r">${Math.round(r.per_billed || 0)}%</td><td>${status_pill(r)}</td></tr>
				<tr class="dps-sub" data-i="${i}" style="display:none;"><td colspan="6">
					<div class="dps-chain">${chain(__("Quotation"), c.quotations)}<span class="lbl">${customer ? __("Sales Order") : __("Purchase Order")}</span>${link(r.doctype, r.name, "doc")}</div>
					${(c.receipts || []).length ? `<table class="dps-mini" style="margin-bottom:8px;"><tr><th>${customer ? __("Delivery Note") : __("Purchase Receipt")}</th><th>${__("Date")}</th><th>${__("Status")}</th><th class="r">${__("Amount")}</th></tr>
						${c.receipts.map(d => `<tr><td>${link(d.doctype, d.name)}</td><td>${date(d.date)}</td><td>${d.draft ? __("Draft") : esc(__(d.status || ""))}</td><td class="r">${money(d.total)}</td></tr>`).join("")}</table>` : ""}
					${invs.length ? `<table class="dps-mini" style="margin-bottom:8px;"><tr><th>${customer ? __("Invoice") : __("Bill")}</th><th>${__("Date")}</th><th class="r">${__("Amount")}</th><th class="r">${__("Still due")}</th><th>${__("Payments")}</th></tr>
						${invs.map(v => `<tr><td>${link(v.doctype, v.name)}${v.draft ? " " + pill("part", __("Draft")) : ""}</td><td>${date(v.date)}</td><td class="r">${money(v.total)}</td>
							<td class="r">${v.total > 0 ? money(v.outstanding) : "—"}</td><td>${(v.payments || []).map(p => `${link(p.doctype, p.name)} ${money(p.amount)}`).join("<br>") || "—"}</td></tr>`).join("")}</table>`
						: `<div class="text-muted" style="margin-bottom:8px;">${__("Not billed yet.")}</div>`}
					${pay_table(c.advances, __("Advance against this order"))}
				</td></tr>`;
			}).join("")}</table>`;

		const load = () => {
			$box.find(".dps-chip").removeClass("is-on").filter(`[data-v="${st.view}"]`).addClass("is-on");
			$box.find(".dps-dates").toggle(st.view !== "unpaid");
			$box.find(".dps-age-wrap").toggle(st.view === "unpaid");
			const $body = $box.find(".dps-docs-body").html(`<div class="dps-empty">${__("Loading…")}</div>`);
			frappe.call({ method: "erp_dacsinc_custom.party_statement.get_party_documents",
				args: { party_type: frm.doctype, party: frm.doc.name, view: st.view, from_date: st.from, to_date: st.to } }).then(r => {
				const m = r.message || {}, rows = m.rows || [];
				$box.closest(".dps-fold").find(".dps-docs-sub").text(rows.length
					? __("{0} shown{1} · click a row for its details", [rows.length, m.more ? " (" + __("first 100") + ")" : ""]) : __("none for this filter"));
				if (!rows.length) { $body.html(`<div class="dps-empty">${__("Nothing for this filter.")}</div>`); return; }
				$body.html(st.view === "orders" ? order_rows(rows) : inv_rows(rows));
				$body.find("tr.dps-main").on("click", (e) => {
					const i = $(e.currentTarget).data("i");
					$(e.currentTarget).toggleClass("is-open");
					$body.find(`tr.dps-sub[data-i="${i}"]`).toggle();
				});
				$body.find(".dps-pay-one").on("click", (e) => { e.stopPropagation(); pay({ invoice: String($(e.currentTarget).data("inv")) }); });
			});
		};
		$box.find(".dps-chip").on("click", (e) => { st.view = String($(e.currentTarget).data("v")); load(); });
		$box.find(".dps-from, .dps-to").on("change", () => { st.from = $box.find(".dps-from").val(); st.to = $box.find(".dps-to").val(); load(); });
		load();
	}

	// Statement of account PDF on the letter head (party_statement.statement_pdf).
	function statement_dialog(frm) {
		const d = new frappe.ui.Dialog({
			title: __("Print Statement — {0}", [frm.doc[frm.doctype === "Customer" ? "customer_name" : "supplier_name"] || frm.doc.name]),
			fields: [
				{ fieldtype: "Select", fieldname: "period", label: __("Period"), default: "12",
				  options: [{ value: "fy", label: __("This financial year") }, { value: "12", label: __("Last 12 months") }, { value: "3", label: __("Last 3 months") },
					{ value: "1", label: __("Last month") }, { value: "custom", label: __("Choose dates") }],
				  onchange: () => set_dates() },
				{ fieldtype: "Date", fieldname: "from_date", label: __("From"), reqd: 1 },
				{ fieldtype: "Column Break" },
				{ fieldtype: "Date", fieldname: "to_date", label: __("To"), reqd: 1, default: frappe.datetime.get_today() },
				{ fieldtype: "Section Break" },
				{ fieldtype: "Check", fieldname: "letter_head", label: __("With letter head"), default: 1 },
			],
			primary_action_label: __("Open PDF"),
			primary_action(v) {
				const q = new URLSearchParams({ party_type: frm.doctype, party: frm.doc.name, from_date: v.from_date, to_date: v.to_date, letter_head: v.letter_head ? 1 : 0 });
				window.open(`/api/method/erp_dacsinc_custom.party_statement.statement_pdf?${q.toString()}`, "_blank");
				d.hide();
			},
		});
		const set_dates = () => {
			const p = d.get_value("period"), today = frappe.datetime.get_today();
			if (p === "custom") return;
			if (p === "fy") {
				const y = Number(today.slice(0, 4)), m = Number(today.slice(5, 7));
				d.set_value("from_date", `${m >= 4 ? y : y - 1}-04-01`);
			} else {
				d.set_value("from_date", frappe.datetime.add_months(today, -Number(p)));
			}
			d.set_value("to_date", today);
		};
		d.show();
		set_dates();
	}

	// Set advances / credit notes against unpaid invoices — ERPNext's Payment Reconciliation underneath.
	function adjust_dialog(frm, s, customer, on_done) {
		const esc = frappe.utils.escape_html;
		const money = (v) => format_currency(flt(v, 2), s.currency);
		const party_type = frm.doctype, party = frm.doc.name;
		const one = customer ? __("invoice") : __("bill");
		frappe.call({ method: "erp_dacsinc_custom.party_balance.get_adjustable", args: { party_type, party } }).then(r => {
			const data = r.message || {};
			const credits = data.credits || [], invs = data.invoices || [];
			if (!credits.length || !invs.length) return frappe.msgprint(__("Nothing to adjust: no unused advance / credit, or no unpaid {0}.", [one]));
			const on = new Set(credits.map(c => c.key));
			const amt = {};
			const d = new frappe.ui.Dialog({
				title: __("Adjust advance / credit — {0}", [frm.doc[customer ? "customer_name" : "supplier_name"] || party]),
				size: "large",
				fields: [{ fieldtype: "HTML", fieldname: "b" }],
				primary_action_label: __("Adjust"),
				primary_action: () => submit(),
			});
			const avail = () => credits.filter(c => on.has(c.key)).reduce((a, c) => a + flt(c.amount), 0);
			const used = () => Object.values(amt).reduce((a, v) => a + flt(v), 0);
			const spread = () => {
				// the chosen credits over the invoices, oldest due first
				let left = avail();
				Object.keys(amt).forEach(k => delete amt[k]);
				invs.slice().sort((a, b) => String(a.due_date || a.date).localeCompare(String(b.due_date || b.date))).forEach(i => {
					if (left <= 0.005) return;
					const t = Math.min(left, flt(i.outstanding)); amt[i.name] = flt(t, 2); left = flt(left - t, 2);
				});
			};
			const draw = () => {
				const rem = flt(avail() - used(), 2);
				d.fields_dict.b.$wrapper.html(`<style>${CSS}</style><div class="dps">
					<div class="dps-cards" style="margin-bottom:12px;">
						<div class="dps-card is-green"><div class="dps-card__t"><i class="fa fa-money"></i>${__("Advance / credit chosen")}</div><div class="dps-card__v">${money(avail())}</div></div>
						<div class="dps-card is-blue"><div class="dps-card__t"><i class="fa fa-check"></i>${__("Set against {0}", [customer ? __("invoices") : __("bills")])}</div><div class="dps-card__v">${money(used())}</div></div>
						<div class="dps-card ${rem < -0.005 ? "is-red" : "is-grey"}"><div class="dps-card__t"><i class="fa fa-inbox"></i>${__("Advance left for later")}</div><div class="dps-card__v">${money(rem)}</div></div>
					</div>
					<div class="dps-box" style="margin-top:0;"><div class="dps-box__h">① ${__("Advance / credit to use")} <small>${__("oldest used first")}</small></div>
					<table class="dps-t">${credits.map(c => `<tr><td style="width:34px;"><input type="checkbox" class="dpa-c" data-k="${esc(c.key)}" ${on.has(c.key) ? "checked" : ""}></td>
						<td><b>${esc(c.name)}</b><small>${esc(c.type)} · ${frappe.datetime.str_to_user(c.date)}</small></td><td class="r"><b>${money(c.amount)}</b></td></tr>`).join("")}</table></div>
					<div class="dps-box"><div class="dps-box__h">② ${__("Set against")} <a class="dpa-auto">${__("Fill oldest due first")}</a></div>
					<table class="dps-t dpa-t"><tr><th>${customer ? __("Invoice") : __("Bill")}</th><th class="r">${__("Still due")}</th><th class="r">${__("Adjust now")}</th><th class="r">${__("Due after")}</th><th></th></tr>
					${invs.map(i => {
						const a = flt(amt[i.name]), left = flt(i.outstanding) - a;
						return `<tr><td><b>${esc(i.name)}</b><small>${i.due_date ? __("due {0}", [frappe.datetime.str_to_user(i.due_date)]) : ""}</small></td><td class="r">${money(i.outstanding)}</td>
							<td class="r"><input type="number" step="0.01" min="0" class="form-control input-xs dpa-a" data-i="${esc(i.name)}" value="${a ? flt(a, 2) : ""}" placeholder="0.00"></td>
							<td class="r">${money(left)}</td><td>${a <= 0.005 ? "" : left <= 0.005 ? `<span class="dps-pill is-green">${__("Paid")}</span>` : `<span class="dps-pill is-part">${__("Part paid")}</span>`}</td></tr>`;
					}).join("")}</table></div>
					<div class="dps-meta">${__("Posted by ERPNext's Payment Reconciliation — the same as Accounting › Payment Reconciliation.")}</div></div>`);
				const $b = d.fields_dict.b.$wrapper;
				$b.find(".dpa-c").on("change", (e) => { const k = String($(e.target).data("k")); e.target.checked ? on.add(k) : on.delete(k); spread(); draw(); });
				$b.find(".dpa-auto").on("click", () => { spread(); draw(); });
				$b.find(".dpa-a").on("change", (e) => {
					const i = invs.find(x => x.name === String($(e.target).data("i")));
					const v = Math.min(flt(e.target.value, 2), flt(i.outstanding));
					if (v > 0) amt[i.name] = v; else delete amt[i.name];
					draw();
				});
			};
			const submit = () => {
				const chosen = invs.filter(i => flt(amt[i.name]) > 0).map(i => ({ name: i.name, amount: flt(amt[i.name], 2) }));
				if (!on.size || !chosen.length) return frappe.msgprint(__("Choose an advance / credit and enter an amount on an {0}.", [one]));
				if (used() - avail() > 0.005) return frappe.msgprint(__("{0} more than the advance / credit chosen.", [money(used() - avail())]));
				frappe.confirm(__("Set {0} of advance / credit against {1} {2}?", [money(used()), chosen.length, chosen.length === 1 ? one : (customer ? __("invoices") : __("bills"))]), () => {
					frappe.call({ method: "erp_dacsinc_custom.party_balance.adjust_advances",
						args: { party_type, party, credits: credits.filter(c => on.has(c.key)).map(c => c.key), invoices: chosen },
						freeze: true, freeze_message: __("Adjusting…") })
						.then(res => { d.hide(); frappe.show_alert({ indicator: "green", message: __("{0} adjusted", [money((res.message || {}).adjusted)]) }); on_done && on_done(); });
				});
			};
			spread(); draw(); d.show();
		});
	}

	["Customer", "Supplier"].forEach(dt => frappe.ui.form.on(dt, { refresh: render }));
})();
