// Customer / Supplier list views: each row shows what is outstanding with that party
// (party_balance.get_party_balances — the ledger "Party Balance"): red "₹ due · n Inv" (supplier "n Bills")
// (! when any is overdue) for a supplier "₹ to pay", green "₹ advance" when the balance is the
// other way, nothing at zero. One call per page of rows, after every list refresh. Wired by
// customer_list.js / supplier_list.js; extends ERPNext's own list settings.
window.dacs_party_balance_list = function (doctype) {
	const s = (frappe.listview_settings[doctype] = frappe.listview_settings[doctype] || {});
	if (s.__dacs_party_balance) return;
	s.__dacs_party_balance = true;
	const customer = doctype === "Customer";

	if (!document.getElementById("dacs-bal-css")) {
		const st = document.createElement("style");
		st.id = "dacs-bal-css";
		st.textContent = `.dacs-bal { display: inline-flex; align-items: center; gap: 4px; margin-right: 8px; font-size: 11.5px;
			font-weight: 600; padding: 2px 8px; border-radius: 10px; white-space: nowrap; font-variant-numeric: tabular-nums; }
			.dacs-bal.is-due { background: #fdecea; color: #b03a2e; } .dacs-bal.is-adv { background: #e6f4ea; color: #1e7e34; }
						.dacs-bal small { font-weight: 500; opacity: .85; } .dacs-bal em { font-style: normal; background: #b03a2e; color: #fff; border-radius: 8px; padding: 0 5px; }`;
		document.head.appendChild(st);
	}

	const paint = (lv) => {
		// only finance roles see a party's money (party_balance.FINANCE_ROLES — the server checks too)
		if (!frappe.user.has_role(["Admin", "System Manager", "Accounts Executive", "Accounts Manager"])) return;
		const names = (lv.data || []).map(d => d.name);
		if (!names.length) return;
		frappe.call({
			method: "erp_dacsinc_custom.party_balance.get_party_balances",
			args: { party_type: doctype, names },
		}).then(r => {
			const m = r.message || {};
			lv.$result.find(".dacs-bal").remove();
			Object.entries(m).forEach(([name, b]) => {
				const bal = flt(b.balance);
				if (Math.abs(bal) < 0.005 && !b.open) return;
				const $row = lv.$result.find(`.list-row-checkbox[data-name="${CSS.escape(name)}"]`).closest(".list-row");
				if (!$row.length) return;
				// short pill in the right-hand strip, in place of the "last updated" time (the columns on the
				// left keep their width); the detail is in its tooltip
				const money = (v) => format_currency(v, null, 0);
				let html;
				if (bal > 0.005) {
					const docs = customer ? (b.open === 1 ? __("invoice") : __("invoices")) : (b.open === 1 ? __("bill") : __("bills"));
					const tip = `${customer ? __("Outstanding (ledger balance)") : __("To pay (ledger balance)")}: ${format_currency(bal)}`
						+ (b.open ? ` — ${b.open} ${__("unpaid")} ${docs}` : "") + (b.overdue ? `, ${b.overdue} ${__("overdue")}` : "");
					html = `<span class="dacs-bal is-due" title="${frappe.utils.escape_html(tip)}">${money(bal)} ${customer ? __("due") : __("to pay")}${b.open ? ` <small>· ${b.open} ${customer ? __("Inv") : (b.open === 1 ? __("Bill") : __("Bills"))}</small>` : ""}${b.overdue ? ' <em title="overdue">!</em>' : ""}</span>`;
				} else if (bal < -0.005) {
					html = `<span class="dacs-bal is-adv" title="${customer ? __("They have paid more than billed — advance / credit with us") : __("We paid more than billed — advance with the supplier")}">${money(-bal)} ${__("advance")}</span>`;
				} else {
					return;
				}
				const $right = $row.find(".level-right").first();
				$right.find(".frappe-timestamp").closest(".list-row-activity > span, .frappe-timestamp").first().hide();
				$right.find(".list-row-activity").first().prepend(html);
			});
		});
	};

	const prev_refresh = s.refresh;
	s.refresh = function (lv) {
		if (prev_refresh) { try { prev_refresh(lv); } catch (e) { /* keep ours working */ } }
		clearTimeout(lv.__dacs_bal_t);
		lv.__dacs_bal_t = setTimeout(() => paint(lv), 150);   // after the rows are drawn
	};
};
