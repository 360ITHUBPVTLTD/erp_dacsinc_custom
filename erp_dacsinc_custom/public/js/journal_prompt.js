// Journal Entry prompt — Order Flow › Finance › New › Journal Entry (journal_prompt.py).
// Left: the kind of entry, in groups (bank & cash, expenses & salary, taxes, customers & suppliers,
//       loans & advances, other); each shows its Dr / Cr and fills the lines from the company's ledgers.
// Middle: the lines — account, party (Debtors / Creditors only), Debit or Credit — and, for every line,
//       what it does in words ("money goes out of the bank", "expense booked", "we owe less"…), from
//       the account's type (ERPNext's rule: Dr raises assets / expenses, Cr raises liabilities /
//       income / equity). Live Total Debit = Total Credit check; "Balance on the last line".
// Right: amount (fills both sides of a two-line entry), entry type, date, reference, remark → Review
//       (lines + effect) → Submit or Save as Draft.
window.dacs_journal_prompt = function (opts) {
	opts = opts || {};
	const company = frappe.defaults.get_user_default("Company");
	frappe.call({ method: "erp_dacsinc_custom.journal_prompt.get_setup", args: { company } }).then(r => r.message && open(r.message));

	function open(setup) {
		const A = setup.accounts || {};
		const esc = frappe.utils.escape_html;
		const money = (v) => format_currency(flt(v, 2), setup.currency);
		const F = {   // account pickers for lines the user chooses
			expense: { root_type: "Expense" }, bank: { account_type: "Bank" }, liability: { root_type: "Liability" },
			asset: { root_type: "Asset" }, tds: { account_name: ["like", "%TDS%"], root_type: "Liability" },
		};
		const L = (key, side, o) => Object.assign({ key, side }, o || {});
		const T = [
			{ g: __("Bank & cash"), k: "bank_charges", icon: "university", label: __("Bank charges"), type: "Bank Entry", remark: __("Bank charges"), lines: [L("bank_charges", "Dr"), L("bank", "Cr")] },
			{ g: __("Bank & cash"), k: "interest_od", icon: "percent", label: __("Interest charged by bank (OD)"), type: "Bank Entry", remark: __("Interest on OD"), lines: [L("interest_od", "Dr", { f: "expense" }), L("bank", "Cr")] },
			{ g: __("Bank & cash"), k: "deposit", icon: "arrow-right", label: __("Cash deposited in bank"), type: "Contra Entry", remark: __("Cash deposited in bank"), lines: [L("bank", "Dr"), L("cash", "Cr")] },
			{ g: __("Bank & cash"), k: "withdraw", icon: "arrow-left", label: __("Cash withdrawn from bank"), type: "Contra Entry", remark: __("Cash withdrawn from bank"), lines: [L("cash", "Dr"), L("bank", "Cr")] },
			{ g: __("Bank & cash"), k: "bank_transfer", icon: "exchange", label: __("Bank to bank transfer"), type: "Contra Entry", remark: __("Transfer between our bank accounts"), lines: [L(null, "Dr", { f: "bank", hint: __("bank it goes to") }), L("bank", "Cr", { f: "bank" })] },
			{ g: __("Expenses & salary"), k: "exp_cash", icon: "money", label: __("Expense paid in cash"), type: "Cash Entry", remark: "", lines: [L(null, "Dr", { f: "expense", hint: __("which expense") }), L("cash", "Cr")] },
			{ g: __("Expenses & salary"), k: "exp_bank", icon: "credit-card", label: __("Expense paid from bank"), type: "Bank Entry", remark: "", lines: [L(null, "Dr", { f: "expense", hint: __("which expense (rent, electricity…)") }), L("bank", "Cr")] },
			{ g: __("Expenses & salary"), k: "salary_due", icon: "users", label: __("Salary for the month (due)"), type: "Journal Entry", remark: __("Salary for the month"), lines: [L("salary", "Dr", { f: "expense" }), L("payroll_payable", "Cr", { f: "liability" })] },
			{ g: __("Expenses & salary"), k: "salary_paid", icon: "user", label: __("Salary paid"), type: "Bank Entry", remark: __("Salary paid"), lines: [L("payroll_payable", "Dr", { f: "liability" }), L("bank", "Cr")] },
			{ g: __("Expenses & salary"), k: "depreciation", icon: "line-chart", label: __("Depreciation"), type: "Depreciation Entry", remark: __("Depreciation for the period"), lines: [L("depreciation", "Dr"), L("accum_dep", "Cr")] },
			{ g: __("Taxes"), k: "tds_paid", icon: "bank", label: __("TDS paid to government"), type: "Bank Entry", remark: __("TDS deposited (challan)"), lines: [L("tds_payable", "Dr", { f: "tds", hint: __("the TDS section ledger") }), L("bank", "Cr")] },
			{ g: __("Taxes"), k: "gst_paid", icon: "file-text-o", label: __("GST paid to government"), type: "Bank Entry", remark: __("GST paid (challan)"), multi: true,
			  lines: [L("out_cgst", "Dr"), L("out_sgst", "Dr"), L("out_igst", "Dr"), L("bank", "Cr")] },
			{ g: __("Taxes"), k: "pf_paid", icon: "shield", label: __("PF / ESIC paid"), type: "Bank Entry", remark: __("PF paid"), lines: [L("pf", "Dr", { f: "liability" }), L("bank", "Cr")] },
			{ g: __("Taxes"), k: "tds_by_cust", icon: "scissors", label: __("TDS cut by a customer"), type: "Journal Entry", remark: __("TDS deducted by customer"), lines: [L("tds_receivable", "Dr"), L("debtors", "Cr", { party_type: "Customer" })] },
			{ g: __("Customers & suppliers"), k: "wo_cust", icon: "eraser", label: __("Write off a customer's small balance"), type: "Write Off Entry", remark: __("Small balance written off"), lines: [L("write_off", "Dr"), L("debtors", "Cr", { party_type: "Customer" })] },
			{ g: __("Customers & suppliers"), k: "wo_supp", icon: "eraser", label: __("Write off a supplier's small balance"), type: "Write Off Entry", remark: __("Small balance written off"), lines: [L("creditors", "Dr", { party_type: "Supplier" }), L("write_off", "Cr")] },
			{ g: __("Customers & suppliers"), k: "setoff", icon: "random", label: __("Set off: customer is also a supplier"), type: "Journal Entry", remark: __("Set off between receivable and payable"), lines: [L("creditors", "Dr", { party_type: "Supplier" }), L("debtors", "Cr", { party_type: "Customer" })] },
			{ g: __("Loans & advances"), k: "staff_adv", icon: "hand-o-right", label: __("Advance / loan given to staff"), type: "Cash Entry", remark: __("Advance to staff"), lines: [L(null, "Dr", { f: "asset", hint: __("the staff's advance / loan ledger") }), L("cash", "Cr")] },
			{ g: __("Loans & advances"), k: "loan_in", icon: "download", label: __("Loan received"), type: "Bank Entry", remark: __("Loan received"), lines: [L("bank", "Dr"), L(null, "Cr", { f: "liability", hint: __("the loan ledger") })] },
			{ g: __("Loans & advances"), k: "loan_out", icon: "upload", label: __("Loan repaid"), type: "Bank Entry", remark: __("Loan repaid"), lines: [L(null, "Dr", { f: "liability", hint: __("the loan ledger") }), L("bank", "Cr")] },
			{ g: __("Other"), k: "blank", icon: "pencil", label: __("Other — I'll fill the lines"), type: "Journal Entry", remark: "", lines: [L(null, "Dr"), L(null, "Cr")] },
		];
		const short = (a) => (a || "").replace(/ - [^-]+$/, "");
		const tpl_drcr = (t) => {
			const nm = (l) => l.key && A[l.key] ? short(A[l.key]) : (l.hint || __("choose"));
			return `Dr ${t.lines.filter(l => l.side === "Dr").map(nm).join(" + ")} · Cr ${t.lines.filter(l => l.side === "Cr").map(nm).join(" + ")}`;
		};

		let lines = [];        // {account, party_type, party, debit, credit, hint, f}
		let tpl = null, auto_remark = "";
		const meta = {};       // account → {root_type, account_type}

		const d = new frappe.ui.Dialog({
			title: __("New Journal Entry"),
			size: "extra-large",
			fields: [
				{ fieldtype: "HTML", fieldname: "layout" },
				{ fieldtype: "Currency", fieldname: "amount", label: __("Amount"), options: setup.currency,
				  description: __("Goes on both sides of a two-line entry.") },
				{ fieldtype: "Select", fieldname: "voucher_type", label: __("Entry Type"), default: "Journal Entry",
				  options: ["Journal Entry", "Bank Entry", "Cash Entry", "Contra Entry", "Write Off Entry", "Depreciation Entry"].join("\n") },
				{ fieldtype: "Date", fieldname: "posting_date", label: __("Date"), reqd: 1, default: frappe.datetime.get_today() },
				{ fieldtype: "Data", fieldname: "cheque_no", label: __("Cheque / UTR No") },
				{ fieldtype: "Date", fieldname: "cheque_date", label: __("Cheque / UTR Date") },
				{ fieldtype: "Data", fieldname: "user_remark", label: __("Remark — what is this entry for?"), reqd: 1 },
				{ fieldtype: "HTML", fieldname: "lines" },
				{ fieldtype: "HTML", fieldname: "summary" },
			],
			primary_action_label: __("Review"),
			primary_action: () => review(),
		});

		const css = `
		.djp-dialog .modal-dialog { max-width: 1320px; width: 97vw; }
		.djx { display: grid; grid-template-columns: 250px minmax(0, 1fr) 300px; gap: 16px; align-items: start; }
		@media (max-width: 1100px) { .djx { grid-template-columns: 1fr; } }
		.djx-step { display: flex; align-items: center; gap: 8px; font-weight: 700; font-size: 13.5px; margin: 0 0 8px; }
		.djx-step span { width: 22px; height: 22px; border-radius: 50%; background: #3498DB; color: #fff; display: inline-flex; align-items: center; justify-content: center; font-size: 12px; }
		.djx-tpls { border: 1px solid var(--border-color); border-radius: 10px; max-height: 64vh; overflow: auto; }
		.djx-g { font-size: 11px; font-weight: 700; text-transform: uppercase; letter-spacing: .05em; color: var(--text-muted); background: var(--subtle-fg); padding: 6px 10px; position: sticky; top: 0; }
		.djx-t { padding: 7px 10px; cursor: pointer; border-top: 1px solid var(--border-color); display: flex; gap: 8px; align-items: flex-start; }
		.djx-t:hover { background: #f5f9fd; } .djx-t.is-on { background: #e3f0fb; box-shadow: inset 3px 0 0 #3498DB; }
		.djx-t .fa { width: 22px; height: 22px; border-radius: 50%; background: #e8f1fb; color: #2471a3; display: inline-flex; align-items: center; justify-content: center; font-size: 11px; flex: none; margin-top: 1px; }
		.djx-t b { display: block; font-size: 12.5px; } .djx-t small { display: block; font-size: 10.5px; color: var(--text-muted); line-height: 1.35; }
		.djx-r { position: sticky; top: 0; display: flex; flex-direction: column; gap: 10px; }
		.djx-card { border: 1px solid var(--border-color); border-radius: 10px; padding: 10px 12px; background: var(--card-bg, #fff); }
		.djx-card .frappe-control { margin-bottom: 8px; } .djx-card .form-group { margin-bottom: 0; } .djx-card .control-label { font-size: 12px; margin-bottom: 3px; }
		.djx-card .help-box { font-size: 11px !important; } .djx-card [data-fieldname="amount"] input { font-size: 17px !important; font-weight: 800; height: 38px !important; color: #21618c; }
		.djx-legend { display: grid; grid-template-columns: 1fr 1fr; gap: 8px; margin-bottom: 10px; }
		.djx-legend div { border-radius: 8px; padding: 7px 10px; font-size: 11.5px; line-height: 1.4; }
		.djx-legend .dr { background: #eaf2f8; color: #1b4f72; } .djx-legend .cr { background: #fef5e7; color: #7e5109; } .djx-legend b { font-size: 12.5px; }
		.djp-t { width: 100%; border-collapse: collapse; border: 1px solid var(--border-color); }
		.djp-t th { background: #3498DB; color: #fff; font-size: 12px; font-weight: 600; padding: 7px 8px; text-align: left; border-right: 1px solid rgba(255,255,255,.3); }
		.djp-t th.r { text-align: right; } .djp-t th.dr { background: #1f6fb2; } .djp-t th.cr { background: #b9770e; }
		.djp-t td { padding: 7px 8px; border-top: 1px solid var(--border-color); vertical-align: top; }
		.djp-t tr.is-dr td { background: #f4f9fd; } .djp-t tr.is-cr td { background: #fefaf3; }
		.djp-t td .frappe-control { margin: 0; } .djp-t td .form-group { margin: 0; } .djp-t td .control-label, .djp-t td .help-box { display: none; }
		.djp-t td small { color: var(--text-muted); font-size: 11px; }
		.djp-eff { display: inline-block; margin-top: 4px; font-size: 11.5px; font-weight: 600; border-radius: 6px; padding: 1px 7px; }
		.djp-eff.dr { background: #d6eaf8; color: #1b4f72; } .djp-eff.cr { background: #fdebd0; color: #7e5109; }
		.djp-in { display: inline-flex; align-items: center; border: 1.5px solid #3498DB; border-radius: 6px; background: #fff; padding: 0 6px; }
		.djp-in.cr { border-color: #d68910; } .djp-in.cr i { color: #b9770e; }
		.djp-in i { white-space: nowrap; font-style: normal; color: #3498DB; font-weight: 700; font-size: 12px; margin-right: 3px; }
		.djp-in input { border: 0; outline: 0; background: transparent; width: 100px; text-align: right; font-weight: 700; padding: 5px 0; }
		.djp-in:focus-within { box-shadow: 0 0 0 3px rgba(52,152,219,.2); }
		.djp-b { display: inline-flex; align-items: center; gap: 5px; border-radius: 6px; padding: 4px 11px; font-size: 12px; font-weight: 600; cursor: pointer; white-space: nowrap; line-height: 1.5; }
		.djp-b.is-fill { background: #3498DB; border: 1px solid #2e86c1; color: #fff; } .djp-b.is-fill:hover { background: #2e86c1; }
		.djp-b.is-line { background: #fff; border: 1px solid #3498DB; color: #1f6fb2; } .djp-b.is-line:hover { background: #eef6fd; }
		.djp-b.is-red { background: #fff; border: 1px solid #e6b0aa; color: #b03a2e; padding: 4px 8px; } .djp-b.is-red:hover { background: #fdedec; }
		.djs-row { display: flex; justify-content: space-between; padding: 5px 0; font-variant-numeric: tabular-nums; }
		.djs-row span { color: var(--text-muted); font-size: 12.5px; } .djs-row b { font-size: 15px; }
		.djs-row.dr b { color: #1f6fb2; } .djs-row.cr b { color: #b9770e; } .djs-row.is-line { border-top: 1px dashed var(--border-color); }
		.djs-row.ok b { color: #1e8449; } .djs-row.bad b, .djs-row.bad span { color: #b03a2e; }
		.djs-say { margin-top: 8px; font-size: 12px; padding: 6px 9px; border-radius: 6px; background: #eaf7ee; color: #1e8449; }
		.djs-say.is-bad { background: #fdedec; color: #922b21; }`;

		// ── layout: entry types | lines | details + balance ────────────────────────────────
		const groups = [...new Set(T.map(t => t.g))];
		const $lay = d.fields_dict.layout.$wrapper.html(`<style>${css}</style><div class="djx">
			<div><div class="djx-step"><span>1</span>${__("What kind of entry?")}</div>
				<div class="djx-tpls">${groups.map(g => `<div class="djx-g">${g}</div>${T.filter(t => t.g === g).map(t =>
					`<div class="djx-t" data-k="${t.k}"><i class="fa fa-${t.icon}"></i><div><b>${t.label}</b><small>${esc(tpl_drcr(t))}</small></div></div>`).join("")}`).join("")}</div></div>
			<div><div class="djx-step"><span>2</span>${__("Debit and credit lines")}</div>
				<div class="djx-legend">
					<div class="dr"><b>${__("Debit (Dr)")}</b> — ${__("money / asset comes in, an expense is booked, or we owe less")}</div>
					<div class="cr"><b>${__("Credit (Cr)")}</b> — ${__("money / asset goes out, income is earned, or we owe more")}</div>
				</div>
				<div class="djx-lines"></div></div>
			<div class="djx-r">
				<div class="djx-card djx-det"><div class="djx-step" style="margin-bottom:6px;"><span>3</span>${__("Details")}</div></div>
				<div class="djx-card djx-sum"></div>
			</div></div>`);
		d.$wrapper.addClass("djp-dialog");
		["amount", "voucher_type", "posting_date", "cheque_no", "cheque_date", "user_remark"].forEach(f => $lay.find(".djx-det").append(d.fields_dict[f].$wrapper));
		$lay.find(".djx-lines").append(d.fields_dict.lines.$wrapper);
		$lay.find(".djx-sum").append(d.fields_dict.summary.$wrapper);
		$lay.on("click", ".djx-t", (e) => use(T.find(t => t.k === String($(e.currentTarget).data("k")))));

		const use = (t) => {
			tpl = t;
			$lay.find(".djx-t").removeClass("is-on").filter(`[data-k="${t.k}"]`).addClass("is-on");
			const amt = t.multi ? 0 : flt(d.get_value("amount"));
			lines = t.lines.map(l => ({ account: l.key ? (A[l.key] || "") : "", party_type: l.party_type || "", party: "", hint: l.hint || "", f: l.f || "",
				debit: l.side === "Dr" ? amt : 0, credit: l.side === "Cr" ? amt : 0, side: l.side }));
			d.set_value("voucher_type", t.type);
			// the remark follows the pattern unless the user wrote their own
			const cur = d.get_value("user_remark") || "";
			if (!cur || cur === auto_remark) { auto_remark = t.remark || ""; d.set_value("user_remark", auto_remark); }
			load_meta().then(draw);
		};

		// what a debit / credit does on this account, in words
		const effect = (l) => {
			const m = meta[l.account]; if (!m || !(flt(l.debit) || flt(l.credit))) return "";
			const dr = flt(l.debit) > 0, a = esc(short(l.account));
			const t = m.account_type, r = m.root_type;
			let txt;
			if (t === "Bank" || t === "Cash") txt = dr ? __("money comes into {0}", [a]) : __("money goes out of {0}", [a]);
			else if (t === "Receivable") txt = dr ? __("the customer owes us more") : __("the customer owes us less");
			else if (t === "Payable") txt = dr ? __("we owe the supplier less") : __("we owe the supplier more");
			else if (r === "Expense") txt = dr ? __("expense booked: {0}", [a]) : __("expense reduced: {0}", [a]);
			else if (r === "Income") txt = dr ? __("income reduced: {0}", [a]) : __("income booked: {0}", [a]);
			else if (r === "Liability") txt = dr ? __("we owe less on {0}", [a]) : __("we owe more on {0}", [a]);
			else if (r === "Equity") txt = dr ? __("capital goes down") : __("capital goes up");
			else txt = dr ? __("{0} goes up", [a]) : __("{0} goes down", [a]);
			return `<span class="djp-eff ${dr ? "dr" : "cr"}">${dr ? "Dr" : "Cr"} — ${txt}</span>`;
		};
		const load_meta = () => {
			const need = [...new Set(lines.map(l => l.account).filter(a => a && !meta[a]))];
			if (!need.length) return Promise.resolve();
			return frappe.call({ method: "frappe.client.get_list", args: { doctype: "Account", filters: { name: ["in", need] }, fields: ["name", "root_type", "account_type"], limit_page_length: 50 } })
				.then(r => (r.message || []).forEach(a => (meta[a.name] = a)));
		};

		const totals = () => {
			const dr = flt(lines.reduce((a, l) => a + flt(l.debit), 0), 2), cr = flt(lines.reduce((a, l) => a + flt(l.credit), 0), 2);
			return { dr, cr, diff: flt(dr - cr, 2) };
		};
		const paint_sum = () => {
			const t = totals(), ok = Math.abs(t.diff) < 0.005 && t.dr > 0;
			d.fields_dict.summary.$wrapper.html(`
				<div class="djx-step" style="margin-bottom:6px;"><span>4</span>${__("Balance check")}</div>
				<div class="djs-row dr"><span>${__("Total Debit")}</span><b>${money(t.dr)}</b></div>
				<div class="djs-row cr"><span>${__("Total Credit")}</span><b>${money(t.cr)}</b></div>
				<div class="djs-row is-line ${ok ? "ok" : "bad"}"><span>${__("Difference")}</span><b>${money(Math.abs(t.diff))}</b></div>
				${Math.abs(t.diff) > 0.005 && lines.length ? `<button class="djp-b is-fill djp-bal" style="width:100%;justify-content:center;margin-top:6px;"><i class="fa fa-balance-scale"></i> ${__("Balance on the last line")}</button>` : ""}
				<div class="djs-say ${ok ? "" : "is-bad"}">${ok ? __("Balanced — Debit = Credit = {0}. Click Review.", [money(t.dr)])
					: t.dr <= 0 && t.cr <= 0 ? __("Pick the kind of entry on the left and type the Amount.")
					: __("Debit and Credit must be equal: {0} more on the {1} side.", [money(Math.abs(t.diff)), t.diff > 0 ? __("Credit") : __("Debit")])}</div>`);
		};
		const draw = () => {
			const $w = d.fields_dict.lines.$wrapper;
			$w.html(`<table class="djp-t"><tr><th style="width:42%;">${__("Account")}</th><th style="width:22%;">${__("Party")}</th>
				<th class="r dr"><i class="fa fa-pencil"></i> ${__("Debit (Dr)")}</th><th class="r cr"><i class="fa fa-pencil"></i> ${__("Credit (Cr)")}</th><th></th></tr>
				${lines.map((l, i) => `<tr data-i="${i}" class="${flt(l.debit) ? "is-dr" : flt(l.credit) ? "is-cr" : ""}">
					<td><div class="djp-acc"></div>${l.hint && !l.account ? `<small>${esc(__("Choose {0}", [l.hint]))}</small>` : ""}<div>${effect(l)}</div></td>
					<td><div class="djp-party"></div>${l.party_type ? "" : `<small>${__("only for Debtors / Creditors")}</small>`}</td>
					<td style="text-align:right;"><span class="djp-in"><i>₹</i><input type="number" min="0" step="0.01" class="djp-amt" data-k="debit" value="${flt(l.debit) ? flt(l.debit, 2) : ""}" placeholder="—"></span></td>
					<td style="text-align:right;"><span class="djp-in cr"><i>₹</i><input type="number" min="0" step="0.01" class="djp-amt" data-k="credit" value="${flt(l.credit) ? flt(l.credit, 2) : ""}" placeholder="—"></span></td>
					<td><button class="djp-b is-red djp-del" title="${esc(__("Remove line"))}"><i class="fa fa-times"></i></button></td></tr>`).join("")}
				</table>${lines.length ? "" : `<div class="text-muted" style="padding:12px;">${__("Pick the kind of entry on the left — the lines fill in here.")}</div>`}
				<div style="margin-top:8px;"><button class="djp-b is-line djp-add"><i class="fa fa-plus"></i> ${__("Add line")}</button></div>`);
			$w.find("tr[data-i]").each((_, tr) => {
				const i = Number($(tr).data("i")), l = lines[i];
				const filters = Object.assign({ company: setup.company, is_group: 0, disabled: 0 }, F[l.f] || {});
				const acc = frappe.ui.form.make_control({ parent: $(tr).find(".djp-acc"), render_input: true, df: {
					fieldtype: "Link", options: "Account", fieldname: "account" + i, placeholder: __("Choose account"),
					get_query: () => ({ filters }),
					onchange() {
						const v = this.get_value();
						if (v === l.account) return;
						l.account = v; l.party = "";
						if (!v) { l.party_type = ""; return draw(); }
						load_meta().then(() => {
							const at = (meta[v] || {}).account_type || "";
							l.party_type = at === "Receivable" ? "Customer" : at === "Payable" ? "Supplier" : "";
							draw();
						});
					},
				} });
				acc.set_value(l.account || "");
				if (l.party_type) {
					const pc = frappe.ui.form.make_control({ parent: $(tr).find(".djp-party"), render_input: true, df: {
						fieldtype: "Link", options: l.party_type, fieldname: "party" + i, placeholder: __("Choose {0}", [__(l.party_type)]),
						onchange() { l.party = this.get_value(); },
					} });
					pc.set_value(l.party || "");
				}
			});
			$w.find(".djp-amt").on("change", (e) => {
				const i = Number($(e.target).closest("tr").data("i")), k = String($(e.target).data("k"));
				lines[i][k] = Math.max(flt(e.target.value, 2), 0);
				if (lines[i][k]) lines[i][k === "debit" ? "credit" : "debit"] = 0;   // a line is a debit or a credit
				load_meta().then(draw);
			});
			$w.find(".djp-del").on("click", (e) => { lines.splice(Number($(e.currentTarget).closest("tr").data("i")), 1); draw(); });
			$w.find(".djp-add").on("click", () => { lines.push({ account: "", party_type: "", party: "", debit: 0, credit: 0 }); draw(); });
			paint_sum();
		};
		d.fields_dict.summary.$wrapper.on("click", ".djp-bal", () => {
			const t = totals(), last = lines[lines.length - 1];
			if (t.diff > 0) { last.credit = flt(flt(last.credit) + t.diff - flt(last.debit), 2); if (last.credit < 0) { last.debit = -last.credit; last.credit = 0; } else last.debit = 0; }
			else { last.debit = flt(flt(last.debit) - t.diff - flt(last.credit), 2); if (last.debit < 0) { last.credit = -last.debit; last.debit = 0; } else last.credit = 0; }
			load_meta().then(draw);
		});

		// the one Amount fills a two-line entry (each line keeps its side)
		d.fields_dict.amount.df.onchange = () => {
			const a = flt(d.get_value("amount"));
			if (lines.length === 2) {
				lines.forEach((l, i) => {
					const dr = flt(l.debit) ? true : flt(l.credit) ? false : (l.side ? l.side === "Dr" : i === 0);
					l.debit = dr ? a : 0; l.credit = dr ? 0 : a;
				});
				load_meta().then(draw);
			}
		};
		const paint_ref = () => {
			const bank = ["Bank Entry", "Contra Entry"].includes(d.get_value("voucher_type"));
			["cheque_no", "cheque_date"].forEach(f => d.set_df_property(f, "hidden", bank ? 0 : 1));
		};
		d.fields_dict.voucher_type.df.onchange = paint_ref;

		const review = () => {
			const v = d.get_values(); if (!v) return;
			const rows = lines.filter(l => l.account && (flt(l.debit) || flt(l.credit)));
			const t = totals();
			if (rows.length < 2) return frappe.msgprint(__("Add at least two lines with an account and an amount."));
			if (Math.abs(t.diff) > 0.005) return frappe.msgprint(__("Debit and Credit must be equal — difference {0}.", [money(Math.abs(t.diff))]));
			const no_party = rows.find(l => l.party_type && !l.party);
			if (no_party) return frappe.msgprint(__("Choose the {0} for {1}.", [__(no_party.party_type), esc(no_party.account)]));
			const conf = new frappe.ui.Dialog({
				title: __("Confirm Journal Entry"),
				size: "large",
				fields: [{ fieldtype: "HTML", fieldname: "b" }],
				primary_action_label: setup.can_submit ? __("Submit") : __("Save as Draft"),
				primary_action: () => send(setup.can_submit ? 1 : 0),
				secondary_action_label: setup.can_submit ? __("Save as Draft") : undefined,
				secondary_action: setup.can_submit ? () => send(0) : undefined,
			});
			const send = (submit) => {
				conf.get_primary_btn().prop("disabled", true);
				frappe.call({ method: "erp_dacsinc_custom.journal_prompt.make_journal_entry", freeze: true, freeze_message: __("Saving…"),
					args: { submit, data: Object.assign({}, v, { company: setup.company, accounts: rows.map(l => ({ account: l.account, party_type: l.party_type || "", party: l.party_type ? l.party : "", debit: l.debit, credit: l.credit })) }) } })
					.then(r => {
						const m = r.message || {};
						conf.hide(); d.hide();
						frappe.msgprint({ title: m.docstatus === 1 ? __("Journal Entry submitted") : __("Journal Entry saved as draft"), indicator: "green",
							message: `<a href="/app/journal-entry/${encodeURIComponent(m.name)}" target="_blank"><b>${esc(m.name)}</b></a> — ${money(t.dr)}` });
						opts.on_done && opts.on_done(m);
					}).catch(() => conf.get_primary_btn().prop("disabled", false));
			};
			conf.fields_dict.b.$wrapper.html(`<style>${css}</style><div style="font-size:13px;">
				<div style="margin-bottom:10px;"><b>${esc(__(v.voucher_type))}</b> · ${frappe.datetime.str_to_user(v.posting_date)}${v.cheque_no ? " · " + esc(v.cheque_no) : ""} — ${esc(v.user_remark)}</div>
				<table class="djp-t"><tr><th>${__("Account")}</th><th>${__("Party")}</th><th class="r dr">${__("Debit (Dr)")}</th><th class="r cr">${__("Credit (Cr)")}</th></tr>
				${rows.map(l => `<tr class="${flt(l.debit) ? "is-dr" : "is-cr"}"><td><b>${esc(l.account)}</b><div>${effect(l)}</div></td><td>${esc(l.party || "")}</td>
					<td style="text-align:right;">${flt(l.debit) ? money(l.debit) : ""}</td><td style="text-align:right;">${flt(l.credit) ? money(l.credit) : ""}</td></tr>`).join("")}
				<tr><td colspan="2" style="text-align:right;"><b>${__("Total")}</b></td><td style="text-align:right;"><b>${money(t.dr)}</b></td><td style="text-align:right;"><b>${money(t.cr)}</b></td></tr></table>
				<div class="text-muted small" style="margin-top:8px;">${setup.can_submit ? __("Submit posts it to the ledgers now; Save as Draft keeps it for someone to check and submit.") : __("You can save it as a draft; an accounts manager submits it.")}
					· <a href="/app/journal-entry/new" target="_blank">${__("Open the full Journal Entry form")}</a></div></div>`);
			conf.show();
		};

		d.show();
		paint_ref();
		// opens on "Other — I'll fill the lines": two empty lines ready to type; a pattern can be picked any time
		use(T.find(t => t.k === "blank"));
		setTimeout(() => { const el = $lay.find('.djx-t[data-k="blank"]')[0]; el && el.scrollIntoView({ block: "nearest" }); }, 300);
	}
};
