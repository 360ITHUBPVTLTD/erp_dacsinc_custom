// Account Summary on the Customer / Supplier form (custom field custom_account_summary, at the top) —
// only for Admin, System Manager, Accounts Executive, Accounts Manager (party_balance.FINANCE_ROLES;
// the server returns nothing to anyone else and the section is hidden).
//   • one sentence and a sum: what they owe − what we hold for them = net balance (party_open_items:
//     invoices, opening balances / Journal Entries, credit notes, advances — every row named in words)
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
	.dps-head { display: flex; flex-wrap: wrap; gap: 12px 20px; align-items: center; justify-content: space-between; padding: 14px 18px; border-radius: 12px; border: 1px solid var(--border-color); background: var(--card-bg, #fff); margin-bottom: 10px; border-left: 5px solid #aab7c4; }
	.dps-head.is-due { border-left-color: #e74c3c; background: linear-gradient(90deg, #fff4f3 0%, #fff 55%); }
	.dps-head.is-cr { border-left-color: #27ae60; background: linear-gradient(90deg, #f0faf4 0%, #fff 55%); }
	.dps-head.is-zero { background: linear-gradient(90deg, #f5f7fa 0%, #fff 55%); }
	.dps-list, .dps-pane { box-shadow: 0 1px 3px rgba(16,24,40,.06); }
	.dps-head__lbl { font-size: 12.5px; font-weight: 600; color: var(--text-muted); }
	.dps-head__amt { font-size: 28px; font-weight: 800; line-height: 1.15; font-variant-numeric: tabular-nums; }
	.dps-head.is-due .dps-head__amt { color: #c0392b; } .dps-head.is-cr .dps-head__amt { color: #1e8449; } .dps-head.is-zero .dps-head__amt { color: var(--text-muted); }
	.dps-head__sub { font-size: 12.5px; color: var(--text-color); margin-top: 2px; }
	.dps-late { color: #c0392b; } .dps-ok { color: #1e8449; }
	.dps-sum { font-size: 13px; margin: 0 0 10px; padding: 8px 14px; border-radius: 8px; background: var(--subtle-fg); }
	.dps-sum span { color: var(--text-muted); margin: 0 6px; font-weight: 700; }
	.dps-list { border: 1px solid var(--border-color); border-radius: 12px; overflow: hidden; background: var(--card-bg, #fff); }
	.dps-list .dps-t th, .dps-pane .dps-t th { background: #3498DB; color: #fff; font-size: 11px; text-transform: uppercase; letter-spacing: .05em; border-right: 0; padding: 8px 14px; }
	.dps-list .dps-t tr:nth-child(even):not(.dps-grp) td, .dps-pane .dps-t tr:nth-child(even):not(.dps-grp) td { background: #f8fbfe; }
	.dps-grp.is-due td { background: #fdf3f2 !important; color: #a93226 !important; }
	.dps-grp.is-cr td { background: #eff9f3 !important; color: #1e8449 !important; }
	.dps-grp.is-due td:first-child { box-shadow: inset 3px 0 0 #e74c3c; } .dps-grp.is-cr td:first-child { box-shadow: inset 3px 0 0 #27ae60; }
	.dps-list .btn-go { background: #3498DB; border-color: #2e86c1; color: #fff; font-weight: 600; } .dps-list .btn-go:hover { background: #2e86c1; color: #fff; }
	.dps-tab .fa { margin-right: 5px; opacity: .8; }
	.dps-list .dps-t td, .dps-pane .dps-t td { padding: 9px 14px; }
	.dps-list .dps-t tr:not(.dps-grp):hover td { background: #f8fafc; }
	.dps-list .dps-t td a { font-weight: 600; }
	.dps-grp td { background: #fbfcfd; font-size: 12px; font-weight: 700; color: var(--text-muted); text-transform: uppercase; letter-spacing: .03em; padding: 6px 14px !important; }
	.dps-tabs { display: flex; flex-wrap: wrap; gap: 6px; margin: 14px 0 0; padding-top: 12px; border-top: 1px solid var(--border-color); }
	.dps-tab { border: 1px solid var(--border-color); background: var(--card-bg, #fff); border-radius: 18px; padding: 5px 14px; font-size: 12.5px; font-weight: 600; color: var(--text-color); cursor: pointer; }
	.dps-tab:hover { border-color: #3498DB; } .dps-tab.is-on { background: #3498DB; border-color: #3498DB; color: #fff; }
	.dps-tab span { display: inline-block; min-width: 18px; border-radius: 9px; background: #e74c3c; color: #fff; font-size: 11px; padding: 0 5px; margin-left: 3px; }
	.dps-pane { margin-top: 10px; border: 1px solid var(--border-color); border-radius: 12px; overflow: hidden; background: var(--card-bg, #fff); }
	.dps-pane > .dps-kpi, .dps-pane > .dps-meta { margin: 12px; } .dps-pane > .dps-box { margin: 0; border: 0; }
	.dps-eq { display: flex; flex-wrap: wrap; align-items: stretch; gap: 6px; margin: 0 0 10px; }
	.dps-eq__i { border: 1px solid var(--border-color); border-radius: 8px; padding: 6px 12px; background: var(--card-bg, #fff); min-width: 150px; }
	.dps-eq__i span { display: block; font-size: 11.5px; color: var(--text-muted); font-weight: 600; }
	.dps-eq__i b { font-size: 17px; font-variant-numeric: tabular-nums; }
	.dps-eq__i small { display: block; font-size: 11px; color: var(--text-muted); }
	.dps-eq__i.is-due b { color: #c0392b; } .dps-eq__i.is-cr b { color: #1e8449; }
	.dps-eq__i.is-net { border-width: 2px; } .dps-eq__i.is-net.is-due { border-color: #e6b0aa; background: #fdf6f5; } .dps-eq__i.is-net.is-cr { border-color: #a9dfbf; background: #f4fbf6; }
	.dps-note { margin: 0 0 10px; font-size: 12.5px; color: var(--text-muted); } .dps-note i { color: #3498DB; }
	.dps-retnote { display: block; color: #1e8449 !important; font-weight: 600; margin-top: 2px; }
	.dps-net td { background: #eaf3fb !important; font-weight: 700; font-size: 13.5px; border-top: 2px solid #3498DB; } .dps-net td small { display: inline; margin-left: 8px; font-weight: 400; color: var(--text-muted); }
	.dps-net b { font-size: 15px; }
	.dps-eq__op { align-self: center; font-size: 20px; font-weight: 700; color: var(--text-muted); padding: 0 2px; }
	.dps-warn { margin: 0 0 10px; border-left: 4px solid #e67e22; background: #fef5e7; border-radius: 6px; padding: 8px 12px; font-size: 12.5px; color: #935116; }
	.dps-kind { display: inline-block; border-radius: 6px; padding: 1px 7px; font-size: 11px; font-weight: 700; margin-right: 6px; background: #eaf2f8; color: #21618c; white-space: nowrap; }
	.dps-kind.k-opening, .dps-kind.k-opening_invoice { background: #f4ecf7; color: #6c3483; } .dps-kind.k-journal, .dps-kind.k-journal_credit { background: #fef5e7; color: #935116; }
	.dps-kind.k-advance, .dps-kind.k-credit_note, .dps-kind.k-debit_note { background: #e8f6ee; color: #1e8449; } .dps-kind.k-refund { background: #fdecea; color: #a93226; }
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
		const credits = flt(s.credit_total);
		const other = flt(s.difference);   // not explained by the open items: should be 0, shown if not
		const KIND = dps_kinds(customer);
		// "2 invoices, 1 opening balance" — what a list of open items is made of
		const kinds_text = (list) => {
			const n = {};
			list.forEach(r => { n[r.kind] = (n[r.kind] || 0) + 1; });
			return Object.entries(n).map(([k, c]) => `${c} ${c === 1 ? KIND[k][0].toLowerCase() : KIND[k][1]}`).join(", ");
		};

		const report = (name, extra) => `/app/query-report/${encodeURIComponent(name)}?${new URLSearchParams(Object.assign({ company: s.company }, extra)).toString()}`;
		const k = (cls, icon, label, value, sub, chips) => `<div class="dps-k is-${cls}"><span class="dps-k__i"><i class="fa fa-${icon}"></i></span>
			<div class="dps-k__l">${label}</div><div class="dps-k__v">${value}</div>
			<div class="dps-k__s" title="${esc($("<div>").html(sub).text())}">${sub}${chips && chips.length ? `<span class="dps-k__chips">${chips.map(c => `<span>${c}</span>`).join("")}</span>` : ""}</div></div>`;
		const limit = customer && s.credit_limit ? ` · ${bal > s.credit_limit ? __("Over credit limit by <b>{0}</b>", [money(bal - s.credit_limit)]) : __("Credit limit <b>{0}</b>", [money(s.credit_limit)])}` : "";
		const o = s.orders || {};
		const odt = customer ? __("Sales Orders") : __("Purchase Orders");
		const n_ord = (n) => `${n} ${n === 1 ? (customer ? __("order") : __("PO")) : (customer ? __("orders") : __("POs"))}`;
		const ord_url = (extra) => `/app/${frappe.router.slug(o.doctype || (customer ? "Sales Order" : "Purchase Order"))}?${new URLSearchParams(Object.assign({ [customer ? "customer" : "supplier"]: frm.doc.name }, extra)).toString()}`;
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

		const pay_box = !s.can_pe ? "" : `<div class="dps-box" style="margin-top:0;">
			${(s.payments || []).length ? `<table class="dps-t"><tr><th>${__("Payment")}</th><th class="r">${__("Amount")}</th><th></th></tr>
				${s.payments.map(p => `<tr><td><b>${link("Payment Entry", p.name)}</b><small>${date(p.posting_date)}${p.mode_of_payment ? " · " + esc(p.mode_of_payment) : ""}${p.reference_no ? " · " + esc(p.reference_no) : ""}${p.custom_bulk_payment ? " · " + __("Bulk Payment") + " " + esc(p.custom_bulk_payment) : ""}</small>
					${(p.payment_type === "Receive") !== customer ? `<span class="dps-pill is-part">${__("refund")}</span>` : ""}</td>
					<td class="r"><b>${money(p.paid_amount)}</b></td>
					<td class="r"><a class="btn btn-xs btn-default dps-print" data-pe="${esc(p.name)}" title="${esc(__("Print receipt"))}"><i class="fa fa-print"></i></a></td></tr>`).join("")}</table>`
				: `<div class="dps-empty">${__("No payments yet.")}</div>`}</div>`;

		// ── returns: every credit / debit note with its status, what is open, what settled it, the goods ──
		const rets = s.returns || [];
		const ret_open = rets.filter(r => r.status !== "settled");
		const RST = {
			settled: ["green", __("Settled")],
			adjust: ["part", customer ? __("Open — set off against their dues") : __("Open — set off against our bills")],
			refund: ["late", customer ? __("Open — to pay back") : __("Open — to receive back")],
		};
		const how = (x) => x.how === "against" ? __("set against {0}", [link(x.doctype, x.name)])
			: x.how === "refund" ? (customer ? __("refunded by {0}", [link(x.doctype, x.name)]) : __("received back by {0}", [link(x.doctype, x.name)]))
			: __("by {0}", [link(x.doctype, x.name)]);
		const GOODS = { done: ["green", __("Back in stock")], self: ["green", __("Back in stock")], none: ["ok", __("No stock item")],
			draft: ["part", __("Return in draft")], pending: ["late", __("Goods not back")], unlinked: ["late", __("Goods not linked")] };
		const returns_body = rets.length ? `<table class="dps-t"><tr><th>${customer ? __("Credit note") : __("Debit note")}</th><th class="r">${__("Amount")}</th>
			<th class="r">${__("Still open")}</th><th>${__("Money")}</th><th>${__("Goods")}</th><th></th></tr>
			${rets.map(r => `<tr><td><b>${link(inv_dt, r.name)}</b><small>${date(r.date)}${r.return_against ? " · " + __("return of {0}", [link(inv_dt, r.return_against)]) : ""}</small></td>
				<td class="r">${money(r.total)}</td><td class="r"><b>${r.open > 0.005 ? money(r.open) : "—"}</b></td>
				<td><span class="dps-pill is-${RST[r.status][0]}">${RST[r.status][1]}</span>
					<small>${(r.settled_by || []).map(x => `${how(x)} · ${money(x.amount)}`).join("<br>") || (r.status === "settled" ? "" : __("nothing set off yet"))}</small></td>
				<td>${r.goods_status ? `<span class="dps-pill is-${(GOODS[r.goods_status] || ["ok"])[0]}">${(GOODS[r.goods_status] || ["", ""])[1]}</span><small>${esc(r.goods_text || "")}</small>` : ""}</td>
				<td class="r">${r.status === "refund" && s.can_pay ? `<button class="btn btn-xs btn-primary dps-refund" data-n="${esc(r.name)}">${customer ? __("Refund") : __("Receive refund")}</button>`
					: r.status === "adjust" && s.can_pe ? `<button class="btn btn-xs btn-default dps-adjust">${__("Adjust")}</button>` : ""}</td></tr>`).join("")}</table>`
			: `<div class="dps-empty">${customer ? __("No credit notes.") : __("No debit notes.")}</div>`;

		// ── headline: the position in one big line and one plain sentence, the buttons on the right ──────
		const today = frappe.datetime.get_today();
		const late_n = s.unpaid.filter(r => r.due_date && r.due_date < today).length;
		const head_cls = bal > 0.005 ? "is-due" : bal < -0.005 ? "is-cr" : "is-zero";
		const both = n_unpaid && credits > 0.005;   // dues and credits: the headline is the net of the two
		const head_lbl = bal > 0.005 ? (both ? (customer ? __("Net to receive from the customer") : __("Net to pay the supplier")) : (customer ? __("Customer owes us") : __("We owe the supplier")))
			: bal < -0.005 ? (customer ? __("We owe the customer (advance / credit)") : __("Supplier owes us (advance / debit)")) : __("All settled");
		const head_sub = [
			both ? __("{0} due − {1} {2} = {3}", [money(s.outstanding), money(credits), customer ? __("we hold for them") : __("they hold for us"), money(Math.abs(bal))])
				: n_unpaid ? (customer ? __("To receive {0} on {1}", [money(s.outstanding), kinds_text(s.unpaid)]) : __("To pay {0} on {1}", [money(s.outstanding), kinds_text(s.unpaid)])) : "",
			late_n ? `<b class="dps-late">${__("{0} overdue", [money(s.overdue)])}</b>` : "",
			!n_unpaid && credits > 0.005 ? kinds_text(s.credits) : "",
		].filter(Boolean).join(" · ") || __("Nothing open.");
		const head = `<div class="dps-head ${head_cls}">
			<div class="dps-head__l"><div class="dps-head__lbl">${head_lbl}</div>
				<div class="dps-head__amt">${money(Math.abs(bal))}</div>
				<div class="dps-head__sub">${head_sub}${limit}</div></div>
			<div class="dps-bar__btns">
				${s.can_pay ? `<button class="btn btn-sm btn-primary dps-pay"><i class="fa fa-${customer ? "arrow-down" : "arrow-up"}"></i> ${customer ? __("Receive Payment") : __("Make Payment")}</button>` : ""}
				<button class="btn btn-sm btn-default dps-stmt"><i class="fa fa-print"></i> ${__("Statement")}</button>
				${s.group ? `<a class="btn btn-sm btn-default" href="/app/group-outstanding?${new URLSearchParams({ party_type: frm.doctype, group: s.group.name })}" title="${esc(__("All {0} members of {1}: what each owes, one payment for all", [s.group.members, s.group.name]))}"><i class="fa fa-users"></i> ${__("Group")}: ${esc(s.group.name)}</a>` : ""}
				<a class="btn btn-sm btn-default" target="_blank" href="${report("General Ledger", { party_type: frm.doctype, party: frm.doc.name, from_date: frappe.datetime.add_months(today, -12), to_date: today, group_by: "Group by Voucher (Consolidated)" })}"><i class="fa fa-book"></i> ${__("Ledger")}</a>
				<button class="btn btn-sm btn-default dps-refresh" title="${esc(__("Refresh"))}"><i class="fa fa-refresh"></i></button>
			</div></div>`;
		// the sum only when both sides have something (else it repeats the headline): due − held = net, each box
		// saying what it is made of, and a line on what Adjust does (until then the invoices show their full due)
		const kinds_amt = (list, f) => {
			const n = {};
			list.forEach(r => { const x = n[r.kind] = n[r.kind] || { c: 0, a: 0 }; x.c++; x.a += flt(r[f]); });
			return Object.entries(n).map(([k, x]) => `${x.c} ${x.c === 1 ? KIND[k][0].toLowerCase() : KIND[k][1]} ${money(x.a)}`).join(" · ");
		};
		const eq = both ? `<div class="dps-eq">
			<div class="dps-eq__i is-due"><span>${customer ? __("They owe") : __("We owe")}</span><b>${money(s.outstanding)}</b><small>${kinds_amt(s.unpaid, "outstanding_amount")}</small></div>
			<div class="dps-eq__op">−</div>
			<div class="dps-eq__i is-cr"><span>${customer ? __("We hold for them") : __("They hold for us")}</span><b>${money(credits)}</b><small>${kinds_amt(s.credits, "amount")}</small></div>
			<div class="dps-eq__op">=</div>
			<div class="dps-eq__i is-net ${bal > 0.005 ? "is-due" : "is-cr"}"><span>${bal > 0.005 ? (customer ? __("Net to receive") : __("Net to pay")) : (customer ? __("We owe them") : __("They owe us"))}</span><b>${money(Math.abs(bal))}</b>
				<small>${bal > 0.005 ? __("what is really left") : (customer ? __("pay back or keep as advance") : __("get back or keep against bills"))}</small></div>
			</div>
			<div class="dps-note"><i class="fa fa-info-circle"></i> ${__("The {0} are not set off yet, so the list below still shows every item's full due. Click <b>Adjust</b> to set them off — then only {1} stays open.",
				[kinds_text(s.credits), money(Math.max(bal, 0))])}</div>` : "";

		// ── open items: what is to be received / paid, then what is held — each with its one action ──────
		const ret_status = {};
		(s.returns || []).forEach(r => { ret_status[r.name] = r.status; });
		const returns_of = {};   // invoice → its credit / debit notes still held (not yet set off against it)
		(s.credits || []).forEach(c => { if (c.return_against) (returns_of[c.return_against] = returns_of[c.return_against] || []).push(c); });
		const due_row = (r) => {
			const late = r.due_date && r.due_date < today;
			const rets = returns_of[r.name] || [], ret_amt = rets.reduce((a, c) => a + flt(c.amount), 0);
			const ret_note = rets.length ? `<small class="dps-retnote"><i class="fa fa-undo"></i> ${__("Return {0} {1} not set off yet — {2} after Adjust",
				[rets.map(c => esc(c.name)).join(", "), money(ret_amt), money(Math.max(flt(r.outstanding_amount) - ret_amt, 0))])}</small>` : "";
			return `<tr><td><span class="dps-kind k-${r.kind}">${KIND[r.kind][0]}</span>${link(r.doctype, r.name)}
				<small>${date(r.posting_date)}${r.bill_no ? " · " + esc(r.bill_no) : ""}${r.remark ? " · " + esc(r.remark) : ""}</small>${ret_note}</td>
				<td>${late ? `<span class="dps-pill is-late">${__("{0} days late", [frappe.datetime.get_day_diff(today, r.due_date)])}</span>` : `<span class="dps-pill is-ok">${r.due_date ? __("due {0}", [date(r.due_date)]) : __("due")}</span>`}</td>
				<td class="r"><b>${money(r.outstanding_amount)}</b>${flt(r.invoice_total) - flt(r.outstanding_amount) > 0.005 ? `<small>${__("of {0}", [money(r.invoice_total)])}</small>` : ""}</td>
				<td class="r">${s.can_pay && r.kind !== "refund" ? `<button class="btn btn-xs btn-go dps-pay-one" data-inv="${esc(r.name)}" data-out="${flt(r.outstanding_amount, 2)}">${customer ? __("Receive") : __("Pay")}</button>` : ""}</td></tr>`;
		};
		const credit_row = (c) => {
			const refund = (c.kind === "credit_note" || c.kind === "debit_note") && ret_status[c.name] === "refund";
			return `<tr><td><span class="dps-kind k-${c.kind}">${KIND[c.kind][0]}</span>${link(c.doctype, c.name)}
				<small>${date(c.posting_date)}${c.return_against ? " · " + __("return of {0}", [esc(c.return_against)]) : ""}${c.remark ? " · " + esc(c.remark) : ""}</small></td>
				<td><span class="dps-pill is-green">${n_unpaid ? __("can be set off") : (customer ? __("to pay back") : __("to get back"))}</span></td>
				<td class="r"><b class="dps-ok">${money(c.amount)}</b></td>
				<td class="r">${refund && s.can_pay ? `<button class="btn btn-xs btn-default dps-refund" data-n="${esc(c.name)}">${customer ? __("Refund") : __("Get refund")}</button>`
					: n_unpaid && s.can_pe ? `<button class="btn btn-xs btn-default dps-adjust" title="${esc(__("Set it against what they owe"))}">${__("Adjust")}</button>` : ""}</td></tr>`;
		};
		const group = (title, total, cls) => `<tr class="dps-grp ${cls === "dps-late" ? "is-due" : "is-cr"}"><td colspan="2">${title}</td><td class="r"><b class="${cls}">${money(total)}</b></td><td></td></tr>`;
		const items = (n_unpaid || (s.credits || []).length) ? `<div class="dps-list"><table class="dps-t">
			<tr><th>${__("Open item")}</th><th>${__("Status")}</th><th class="r">${__("Open amount")}</th><th></th></tr>
			${n_unpaid ? group(customer ? __("To receive") : __("To pay"), s.outstanding, "dps-late") + s.unpaid.map(due_row).join("") : ""}
			${(s.credits || []).length ? group(customer ? __("Held for them") : __("Held with them"), credits, "dps-ok") + s.credits.map(credit_row).join("") : ""}
			${both ? `<tr class="dps-net"><td colspan="2">${bal > 0.005 ? (customer ? __("Net to receive") : __("Net to pay")) : (customer ? __("We owe them") : __("They owe us"))}
				<small>${money(s.outstanding)} − ${money(credits)}</small></td><td class="r"><b class="${bal > 0.005 ? "dps-late" : "dps-ok"}">${money(Math.abs(bal))}</b></td><td></td></tr>` : ""}
			</table></div>` : `<div class="dps-list dps-empty">${__("Nothing open — the account is settled.")}</div>`;
		const back = flt(s.to_pay_back);
		const warn = Math.abs(other) > 0.005 ? `<div class="dps-warn"><i class="fa fa-exclamation-triangle"></i> ${__("The ledger balance differs from the open items by {0}. Check the Ledger or ask Accounts.", [money(other)])}</div>` : "";

		// ── tabs below: one open at a time (or none); Returns first when a return needs attention ─────────
		const TABS = [
			rets.length ? ["returns", `<i class="fa fa-undo"></i>${__("Returns")}`, ret_open.length ? ret_open.length : "", returns_body] : null,
			["orders", `<i class="fa fa-${customer ? "shopping-cart" : "truck"}"></i>${odt}`, o.open_n || "", orders_body],
			["hist", `<i class="fa fa-history"></i>${__("History")}`, "", unpaid],
			s.can_pe ? ["pays", `<i class="fa fa-money"></i>${__("Payments")}`, "", pay_box] : null,
		].filter(Boolean);
		const tab_key = `dps_tab:${frm.doctype}`;
		let cur = null;
		try { cur = localStorage.getItem(tab_key); } catch (e) { /* no storage */ }
		if (ret_open.length && cur === null) cur = "returns";
		if (!TABS.some(t => t[0] === cur)) cur = "";
		const tabs = `<div class="dps-tabs">${TABS.map(([k, l, n]) => `<button type="button" class="dps-tab ${k === cur ? "is-on" : ""}" data-t="${k}">${l}${n ? ` <span>${n}</span>` : ""}</button>`).join("")}</div>
			${TABS.map(([k, , , body]) => `<div class="dps-pane" data-t="${k}" style="${k === cur ? "" : "display:none;"}">${body}</div>`).join("")}`;

		$w.html(`<style>${CSS}</style><div class="dps">
			${head}${eq}${warn}${items}${tabs}
			<div class="dps-meta">${[esc(s.company), __("this year: billed {0}, {1} {2}", [money(s.billed_fy), customer ? __("received") : __("paid"), s.can_pe ? money(s.paid_fy) : "—"]),
				s.payment_terms ? __("Payment terms: {0}", [esc(s.payment_terms)]) : "",
				s.drafts ? __("{0} draft {1} not submitted yet", [s.drafts, s.drafts === 1 ? one : many]) : ""].filter(Boolean).join(" · ")}</div>
		</div>`);

		const refresh = () => render(frm);
		const pay = (o) => frappe.require("/assets/erp_dacsinc_custom/js/bulk_payment.js",
			() => dacs_payment_dialog(Object.assign({ payment_type: customer ? "Receive" : "Pay", party: frm.doc.name, from_form: 1, on_done: refresh }, o)));
		$w.find(".dps-pay").on("click", () => pay({}));
		$w.find(".dps-pay-one").on("click", (e) => pay({ invoice: String($(e.currentTarget).data("inv")), amount: flt($(e.currentTarget).data("out")) }));
		$w.find(".dps-adjust").on("click", (e) => { e.stopPropagation(); adjust_dialog(frm, s, customer, refresh); });
		$w.find(".dps-refund").on("click", (e) => {
			e.stopPropagation();
			const n = String($(e.currentTarget).data("n"));
			frappe.require("/assets/erp_dacsinc_custom/js/payment_prompt.js", () => of_refund_prompt(inv_dt, n, refresh, { from_form: 1 }));
		});
		$w.find(".dps-refresh").on("click", refresh);
		$w.find(".dps-stmt").on("click", () => statement_dialog(frm));
		// History loads when its tab is first opened
		let docs_loaded = false;
		const load_docs = () => { if (!docs_loaded) { docs_loaded = true; docs(frm, $w.find(".dps-docs"), s, customer, pay); } };
		if (cur === "hist") load_docs();
		$w.find(".dps-tab").on("click", (e) => {
			const k = String($(e.currentTarget).data("t"));
			const open = !$(e.currentTarget).hasClass("is-on");
			$w.find(".dps-tab").removeClass("is-on"); $w.find(".dps-pane").hide();
			if (open) { $(e.currentTarget).addClass("is-on"); $w.find(`.dps-pane[data-t="${k}"]`).show(); if (k === "hist") load_docs(); }
			try { localStorage.setItem(tab_key, open ? k : ""); } catch (err) { /* no storage */ }
		});
		$w.find(".dps-print").on("click", (e) => window.open(dacs_print_url("Payment Entry", String($(e.currentTarget).data("pe"))), "_blank"));
	}

	// what each open item is, in words: [one, many]
	function dps_kinds(customer) {
		return {
			invoice: customer ? [__("Invoice"), __("invoices")] : [__("Bill"), __("bills")],
			opening_invoice: customer ? [__("Opening invoice"), __("opening invoices")] : [__("Opening bill"), __("opening bills")],
			opening: [__("Opening balance"), __("opening balances")],
			journal: [__("Journal Entry"), __("journal entries")],
			journal_credit: [__("Journal Entry credit"), __("journal entry credits")],
			credit_note: [__("Credit note"), __("credit notes")],
			debit_note: [__("Debit note"), __("debit notes")],
			advance: [__("Advance payment"), __("advance payments")],
			refund: customer ? [__("Refund paid out"), __("refunds paid out")] : [__("Refund received"), __("refunds received")],
			other: [__("Other"), __("other")],
		};
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
			frm.__dps_docs = { party: frm.doc.name, view: "all", from: frappe.datetime.add_months(frappe.datetime.get_today(), -12), to: frappe.datetime.get_today() };
		const st = frm.__dps_docs;
		$box.find(".dps-from").val(st.from); $box.find(".dps-to").val(st.to);
		const pill = (cls, t) => `<span class="dps-pill is-${cls}">${t}</span>`;
		const status_pill = (r) => r.draft ? pill("part", esc(__(r.workflow_state || "Draft")))
			: (r.doctype.endsWith("Invoice") || r.kind) ? (r.total < 0 ? pill("ok", __("Return"))
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
					<td>${r.kind ? `<span class="dps-kind k-${r.kind}">${dps_kinds(customer)[r.kind][0]}</span>` : ""}<b>${link(r.doctype, r.name)}</b><small>${date(r.date)}${r.bill_no ? " · " + esc(r.bill_no) : ""}${r.return_against ? " · " + __("against {0}", [esc(r.return_against)]) : ""}${r.remark ? " · " + esc(r.remark) : ""}</small></td>
					<td>${date(r.due_date)}</td><td class="r">${money(r.total)}</td><td class="r">${paid > 0.005 ? money(paid) : "—"}</td>
					<td class="r"><b>${r.total > 0 ? money(r.outstanding) : "—"}</b></td><td>${status_pill(r)}</td>
					<td class="r">${s.can_pay && r.outstanding > 0.005 && r.kind !== "refund" ? `<button class="btn btn-xs btn-default dps-pay-one" data-inv="${esc(r.name)}" data-out="${flt(r.outstanding, 2)}">${customer ? __("Receive") : __("Pay")}</button>` : ""}</td></tr>
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
				$body.find(".dps-pay-one").on("click", (e) => { e.stopPropagation(); pay({ invoice: String($(e.currentTarget).data("inv")), amount: flt($(e.currentTarget).data("out")) }); });
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
