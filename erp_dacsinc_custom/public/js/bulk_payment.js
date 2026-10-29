// Receive / Pay — the one payment prompt (docs/bulk-payment.md): one invoice, several invoices of one
// party, or one amount for several parties and their invoices — the same window for all of them.
// One column, top to bottom: 1 who — the customers / suppliers who owe (search, click to add), most
// due first, with what the chosen ones owe in total ("Received the full ₹…" takes it all); 2 the
// amount, mode, date, cheque / UTR; 3 their unpaid invoices, grouped by party — the amount is spread
// oldest due first by itself until the user types a row; then bank charges / TDS / write-off and
// remarks (folded); a summary bar fixed at the bottom: due on selected | amount = on invoices +
// advance / still to allocate (→ into bank), Auto-allocate, Clear, and one plain sentence.
// Submit (bulk_payment.make_payment): one party → one Payment Entry; several → a Bulk Payment that
// makes one Payment Entry per party. From a draft Bulk Payment form (opts.frm) it fills the table.
//
// Opened for one party (a customer / supplier form, an invoice row): no search — a header with the party and
// what they owe, and a short "this pays" list (oldest first) with "Change which items" for the full table.
// Dues are invoices / bills, opening balances and other Journal Entries (bulk_payment.get_open_invoices).
//
// opts: { payment_type: "Receive" | "Pay", party, invoice (put first when spreading), amount (its outstanding),
//         frm, from_form (opened from an invoice form), on_done(result) }
window.dacs_payment_dialog = function (opts) {
	opts = opts || {};
	const frm = opts.frm;
	const receive = (frm ? frm.doc.payment_type : opts.payment_type) !== "Pay";
	const P = "erp_dacsinc_custom.erp_dacsinc_custom.doctype.bulk_payment.bulk_payment.";
	const company = (frm && frm.doc.company) || frappe.defaults.get_user_default("Company");
	frappe.call({ method: P + "get_payment_setup", args: { payment_type: receive ? "Receive" : "Pay", company } })
		.then(r => r.message && open_dialog(r.message));

	function open_dialog(setup) {
		const party_dt = receive ? "Customer" : "Supplier";
		const inv_dt = receive ? "Sales Invoice" : "Purchase Invoice";
		const who = receive ? __("customer") : __("supplier");
		const whos = receive ? __("customers") : __("suppliers");
		// what is due: invoices / bills and Journal Entries (opening balances) — "items" in the prompt
		const bills = __("items");
		const esc = frappe.utils.escape_html;
		const money = (v) => format_currency(flt(v, 2), setup.currency);
		const mode_by_name = Object.fromEntries((setup.modes || []).map(m => [m.name, m]));
		const selected = new Map();   // party → name, in the order picked
		let parties_due = [];         // the picker list
		let invoices = [];            // open invoices of the selected parties
		let loaded = false;           // invoices loaded for the current choice (until then no chip shows "nothing due")
		const amt = {}, tds = {}, wo = {};
		let manual = false;           // the user typed a row: stop spreading the total by itself
		// Calculator: with no amount typed, the amount is the sum of what is ticked (total_auto); once the
		// user types it, it is fixed and nothing can be allocated beyond it.
		let total_auto = true, setting_total = false;
		// a message about the last change, shown inside the prompt (above the invoices) until the next one
		let flash_msg = null;
		const flash = (m) => { flash_msg = m; };
		const first = opts.invoice || null;
		// one party known (customer / supplier form, an invoice): the short form — no search, a compact list
		const simple = !!(opts.party && !frm);
		let detail = !simple, picking = false;
		const KIND = {
			invoice: receive ? __("Invoice") : __("Bill"), opening_invoice: receive ? __("Opening invoice") : __("Opening bill"),
			opening: __("Opening balance"), journal: __("Journal Entry"),
		};
		const kind_chip = (r) => `<span class="dbp-kind k-${esc(r.kind || "invoice")}">${KIND[r.kind] || KIND.invoice}</span>`;
		const doc_url = (r) => `/app/${frappe.router.slug(r.doctype || inv_dt)}/${encodeURIComponent(r.name)}`;
		const acc_q = () => ({ filters: { company, is_group: 0, root_type: "Expense", disabled: 0 } });

		const d = new frappe.ui.Dialog({
			title: receive ? __("Receive Payment") : __("Make Payment"),
			size: "extra-large",
			fields: [
				{ fieldtype: "HTML", fieldname: "layout" },
				{ fieldtype: "Currency", fieldname: "total_amount", label: receive ? __("Amount received") : __("Amount paid"), options: setup.currency,
				  default: frm ? frm.doc.total_amount : undefined,
				  description: __("Leave empty to add up the {0} you tick.", [receive ? __("invoices") : __("bills")]) },
				{ fieldtype: "Select", fieldname: "mode_of_payment", label: __("Mode of Payment"),
				  options: [""].concat((setup.modes || []).map(m => m.name)).join("\n"), default: frm ? frm.doc.mode_of_payment : undefined },
				{ fieldtype: "HTML", fieldname: "mode_info" },
				{ fieldtype: "Date", fieldname: "posting_date", label: __("Payment Date"),
				  default: frm ? frm.doc.posting_date : frappe.datetime.get_today() },
				{ fieldtype: "Data", fieldname: "reference_no", label: __("Cheque / UTR No"), default: frm ? frm.doc.reference_no : undefined },
				{ fieldtype: "Date", fieldname: "reference_date", label: __("Cheque / UTR Date"), default: frm ? frm.doc.reference_date : undefined },
				{ fieldtype: "HTML", fieldname: "picker" },
				{ fieldtype: "HTML", fieldname: "list" },
				{ fieldtype: "HTML", fieldname: "summary" },
				{ fieldtype: "Currency", fieldname: "bank_charges", options: setup.currency, default: frm ? frm.doc.bank_charges : undefined,
				  label: receive ? __("Bank charges cut by the bank") : __("Bank charges paid by us (extra)") },
				{ fieldtype: "Link", fieldname: "bank_charges_account", label: __("Bank Charges Account"), options: "Account",
				  default: (frm && frm.doc.bank_charges_account) || setup.defaults.bank_charges_account, get_query: acc_q },
				{ fieldtype: "Check", fieldname: "show_cuts", label: __("TDS / write-off per invoice (adds columns)") },
				{ fieldtype: "Link", fieldname: "tds_account", label: __("TDS Account"), options: "Account",
				  default: (frm && frm.doc.tds_account) || setup.defaults.tds_account,
				  description: receive ? "" : __("Blank: each supplier's own TDS ledger"),
				  get_query: () => ({ filters: [["company", "=", company], ["is_group", "=", 0], ["disabled", "=", 0],
					["account_name", "like", "%TDS%"], ["root_type", "in", ["Asset", "Liability"]]] }) },
				{ fieldtype: "Link", fieldname: "write_off_account", label: __("Write Off Account"), options: "Account",
				  default: (frm && frm.doc.write_off_account) || setup.defaults.write_off_account, get_query: acc_q },
				{ fieldtype: "Small Text", fieldname: "remarks", label: __("Remarks"), default: frm ? frm.doc.remarks : undefined },
			],
			primary_action_label: frm ? __("Fill the table") : __("Review & submit"),
			primary_action: () => finish(),
		});

		// Layout: left = ① customers, ② their invoices; right (stays in view) = the payment, the running
		// sum, deductions, remarks. The Frappe fields above are moved into place.
		// One screen, three numbered parts — 1 who, 2 how much and how, 3 which invoices — then "Review &
		// submit" opens a short check with a tick. The Frappe fields above are moved into their parts.
		const $lay = d.fields_dict.layout.$wrapper.html(`<div class="wz">
			<section class="wz-sec" data-s="1">
				<div class="wz-q"><span class="wz-n">1</span>${receive ? __("Who paid you?") : __("Whom are you paying?")}</div>
				<div class="dpz-picker"></div><div class="dpz-sel"></div></section>
			<section class="wz-sec" data-s="2">
				<div class="wz-who"></div>
				<div class="wz-q"><span class="wz-n">2</span>${receive ? __("How much did you receive?") : __("How much are you paying?")}</div>
				<div class="wz-amtrow"><div class="dpz-amt"></div><div class="wz-full"></div></div>
				<div class="wz-hint">${__("Not sure yet? Leave it empty — it will add up from the {0} you tick in part 3.", [bills])}</div>
				<div class="wz-q" style="margin-top:16px;">${__("How?")}</div>
				<div class="wz-modes"></div><div class="dpz-mode"></div>
				<div class="wz-row"><div class="dpz-date"></div><div class="dpz-ref"></div></div>
				<details class="dpz-more"><summary><i class="fa fa-scissors"></i> ${__("Bank charges, TDS, write-off")} <small>${__("only if any")}</small></summary><div class="dpz-ded"></div></details>
				<details class="dpz-more"><summary><i class="fa fa-comment-o"></i> ${__("Remarks")} <small>${__("optional")}</small></summary><div class="dpz-rem"></div></details>
			</section>
			<section class="wz-sec" data-s="3">
				<div class="wz-q"><span class="wz-n">3</span>${__("What is it for?")}</div>
				<div class="dpz-foot"></div>
				<div class="dpz-list"></div>
			</section>
			<section class="wz-sec" data-s="4"><div class="wz-review"></div></section>
		</div>`);
		if (simple) {
			$lay.find(".wz").addClass("is-simple");
			$lay.find('.wz-sec[data-s="2"] .wz-n').text("1");
			$lay.find('.wz-sec[data-s="3"] .wz-n').text("2");
			$lay.find('.wz-sec[data-s="3"] .wz-q').contents().last().replaceWith(receive ? __("What does it pay? (oldest first)") : __("What does it pay? (oldest first)"));
			$lay.find(".wz-hint").first().text(__("Leave it empty to add up the items you tick below."));
		}
		const move = (sel, names) => names.forEach(f => $lay.find(sel).append(d.fields_dict[f].$wrapper));
		move(".dpz-picker", ["picker"]); move(".dpz-list", ["list"]);
		move(".dpz-amt", ["total_amount"]); move(".dpz-mode", ["mode_of_payment", "mode_info"]); move(".dpz-date", ["posting_date"]);
		move(".dpz-ref", ["reference_no", "reference_date"]);
		move(".dpz-foot", ["summary"]);
		move(".dpz-ded", ["bank_charges", "bank_charges_account", "show_cuts", "tds_account", "write_off_account"]);
		move(".dpz-rem", ["remarks"]);
		d.fields_dict.mode_of_payment.$wrapper.hide();   // chosen with the big buttons
		d.fields_dict.total_amount.df.description = ""; d.fields_dict.total_amount.refresh();
		if (frm && (frm.doc.bank_charges || 0)) $lay.find(".dpz-more").first().attr("open", true);

		const css = `
		.dacs-pay-dialog .modal-dialog { max-width: 1000px; width: 96vw; }
		.wz-sec { display: block; border: 1px solid var(--border-color); border-radius: 12px; padding: 14px 16px; margin-bottom: 14px; background: var(--card-bg, #fff); }
		.wz-sec[data-s="4"] { display: none; }
		.wz-n { width: 26px; height: 26px; border-radius: 50%; background: #3498DB; color: #fff; display: inline-flex; align-items: center; justify-content: center; font-size: 13px; margin-right: 9px; vertical-align: 2px; }
		.wz-who { display: none !important; }
		.wz.is-simple .wz-sec[data-s="2"] .wz-who { display: flex !important; }
		.wz.is-simple:not(.is-picking) .wz-sec[data-s="1"] { display: none; }
		.dbp-kind { display: inline-block; border-radius: 6px; padding: 1px 7px; font-size: 11px; font-weight: 700; margin-right: 6px; background: #eaf2f8; color: #21618c; white-space: nowrap; }
		.dbp-kind.k-opening, .dbp-kind.k-opening_invoice { background: #f4ecf7; color: #6c3483; } .dbp-kind.k-journal { background: #fef5e7; color: #935116; }
		.dbp-mini { width: 100%; border-collapse: collapse; font-size: 13px; }
		.dbp-mini td { padding: 8px 10px; border-bottom: 1px solid var(--border-color); vertical-align: middle; }
		.dbp-mini td.r { text-align: right; white-space: nowrap; font-variant-numeric: tabular-nums; }
		.dbp-mini td small { display: block; color: var(--text-muted); font-size: 11.5px; }
		.dbp-mini tr.is-none td { color: var(--text-muted); }
		.dbp-more { margin-top: 10px; }
		.wz-sec .dpp .dpp-list { max-height: 170px; }
		.wz-q { font-size: 17px; font-weight: 700; margin: 0 0 4px; }
		.wz-hint { font-size: 12.5px; color: var(--text-muted); margin-bottom: 10px; }
		.wz-who { display: flex; flex-wrap: wrap; gap: 8px 16px; align-items: center; padding: 10px 14px; background: #eef6fd; border: 1px solid #aed6f1; border-radius: 10px; margin-bottom: 16px; }
		.wz-who b { font-size: 14px; } .wz-who span { color: #5d6d7e; font-size: 12.5px; } .wz-who .wz-edit { margin-left: auto; }
		.wz-amtrow { display: flex; flex-wrap: wrap; gap: 10px; align-items: flex-start; }
		.wz-amtrow .dpz-amt { flex: 0 1 340px; }
		.wz-amtrow [data-fieldname="total_amount"] .control-label { display: none; }
		.wz-amtrow [data-fieldname="total_amount"] input { font-size: 24px !important; font-weight: 800; height: 50px !important; color: #21618c; border: 2px solid #3498DB !important; background: #fff !important; }
		.wz-full { display: flex; gap: 6px; flex-wrap: wrap; padding-top: 6px; }
		.wz-modes { display: flex; flex-wrap: wrap; gap: 8px; margin: 6px 0 10px; }
		.wz-mode { border: 1.5px solid var(--border-color); background: #fff; border-radius: 10px; padding: 9px 14px; font-size: 13.5px; font-weight: 600; cursor: pointer; display: inline-flex; gap: 8px; align-items: center; }
		.wz-mode .fa { color: #3498DB; } .wz-mode:hover { border-color: #3498DB; }
		.wz-mode.is-on { border-color: #3498DB; background: #3498DB; color: #fff; } .wz-mode.is-on .fa { color: #fff; }
		.wz-row { display: grid; grid-template-columns: 200px 1fr; gap: 12px; margin: 6px 0 12px; } @media (max-width: 640px) { .wz-row { grid-template-columns: 1fr; } }
		.wz-sec .dpz-more { margin-top: 10px; }
		.wz-sec .dpz-foot { position: static; box-shadow: none; margin-bottom: 12px; }
		.wz-rv { border: 1px solid var(--border-color); border-radius: 10px; overflow: hidden; }
		.wz-rv__top { padding: 14px 16px; background: #eef6fd; text-align: center; }
		.wz-rv__top span { display: block; font-size: 12.5px; color: #5d6d7e; } .wz-rv__top b { font-size: 26px; color: #21618c; }
		.wz-rv__row { display: flex; justify-content: space-between; gap: 12px; padding: 8px 16px; border-top: 1px solid var(--border-color); font-size: 13.5px; }
		.wz-rv__row span { color: var(--text-muted); }
		.wz-rv table { width: 100%; border-collapse: collapse; } .wz-rv th { background: #3498DB; color: #fff; font-size: 12px; padding: 7px 16px; text-align: left; }
		.wz-rv td { padding: 8px 16px; border-top: 1px solid var(--border-color); font-size: 13px; } .wz-rv .r { text-align: right; white-space: nowrap; }
		.wz-ok { display: flex; gap: 10px; align-items: center; margin-top: 14px; padding: 12px 14px; border: 1.5px solid #f5d98b; background: #fffbea; border-radius: 10px; font-weight: 600; cursor: pointer; }
		.wz-ok input { width: 18px; height: 18px; }
		.dpz-sec { border: 1px solid var(--border-color); border-radius: 10px; padding: 12px 14px; margin-bottom: 12px; background: var(--card-bg, #fff); }
		.dpz-h { display: flex; align-items: center; gap: 9px; font-weight: 700; font-size: 14px; margin-bottom: 10px; }
		.dpz-h span { width: 24px; height: 24px; border-radius: 50%; background: #3498DB; color: #fff; display: inline-flex; align-items: center; justify-content: center; font-size: 12.5px; flex: none; }
		.dpz-pay { display: grid; grid-template-columns: 1.3fr 1fr 0.8fr 1.4fr; gap: 12px; align-items: start; }
		@media (max-width: 900px) { .dpz-pay { grid-template-columns: 1fr 1fr; } }
		.dpz-ref { display: grid; grid-template-columns: 1fr 1fr; gap: 8px; }
		.dpz-sec .frappe-control { margin-bottom: 0; } .dpz-sec .form-group { margin-bottom: 0; }
		.dpz-sec .control-label { font-size: 12px; margin-bottom: 3px; } .dpz-sec .help-box { font-size: 11px !important; margin-top: 2px; }
		.dpz-amt [data-fieldname="total_amount"] input { font-size: 18px !important; font-weight: 800; height: 38px !important; color: #21618c; border: 1.5px solid #3498DB !important; background: #fff !important; }
		.dpz-sel { margin-top: 10px; }
		.dpz-selbar { display: flex; flex-wrap: wrap; gap: 10px 18px; align-items: center; background: #eef6fd; border: 1px solid #aed6f1; border-radius: 8px; padding: 8px 12px; }
		.dpz-selbar div { display: flex; flex-direction: column; } .dpz-selbar span { font-size: 11px; color: #5d6d7e; font-weight: 600; }
		.dpz-selbar b { font-size: 16px; font-variant-numeric: tabular-nums; color: #1b4f72; } .dpz-selbar b.is-late { color: #b03a2e; }
		.dpz-selbar .dbp-b { margin-left: auto; }
		.dpz-opt { display: grid; grid-template-columns: 1fr 1fr; gap: 12px; margin-bottom: 12px; }
		@media (max-width: 900px) { .dpz-opt { grid-template-columns: 1fr; } }
		.dpz-more { border: 1px solid var(--border-color); border-radius: 10px; padding: 10px 14px; background: var(--card-bg, #fff); }
		.dpz-more summary { cursor: pointer; font-weight: 700; font-size: 13px; list-style: none; display: flex; gap: 7px; align-items: center; }
		.dpz-more summary::-webkit-details-marker { display: none; }
		.dpz-more summary .fa { color: #3498DB; } .dpz-more summary small { font-weight: 500; color: var(--text-muted); }
		.dpz-more summary::after { content: "▸"; margin-left: auto; color: var(--text-muted); } .dpz-more[open] summary::after { content: "▾"; }
		.dpz-more[open] summary { margin-bottom: 8px; } .dpz-more .frappe-control { margin-bottom: 8px; }
		.dpz-foot { position: sticky; bottom: 0; z-index: 3; background: var(--card-bg, #fff); border: 1.5px solid #3498DB; border-radius: 10px; padding: 10px 14px; box-shadow: 0 -4px 14px rgba(0,0,0,.08); }
		.dpf { display: flex; flex-wrap: wrap; gap: 6px 16px; align-items: center; }
		.dpf-i { display: flex; flex-direction: column; } .dpf-i span { font-size: 11px; color: var(--text-muted); font-weight: 600; white-space: nowrap; }
		.dpf-i b { font-size: 16px; font-variant-numeric: tabular-nums; white-space: nowrap; }
		.dpf-i.is-main b { font-size: 19px; color: #21618c; } .dpf-i.is-adv b { color: #2490ef; } .dpf-i.is-bad b, .dpf-i.is-bad span { color: #b03a2e; }
		.dpf-i.is-bank b { color: #1e7e34; } .dpf-i.is-due b { color: #5d6d7e; }
		.dpf-op { font-size: 18px; font-weight: 700; color: var(--text-muted); }
		.dpf-btns { margin-left: auto; display: flex; gap: 6px; }
		.dpz-foot .dbp-say { margin: 8px 0 0; }
		.dpp .dpp-chips { display: flex; flex-wrap: wrap; gap: 6px; margin-bottom: 8px; min-height: 26px; align-items: center; }
		.dpp .dpp-chip { background: #2490ef; color: #fff; border-radius: 14px; padding: 3px 6px 3px 11px; font-size: 12px; font-weight: 600; display: inline-flex; gap: 6px; align-items: center; }
		.dpp .dpp-chip button { border: 0; background: rgba(255,255,255,.25); color: #fff; border-radius: 50%; width: 18px; height: 18px; line-height: 16px; padding: 0; cursor: pointer; }
		.dpp .dpp-hint { color: var(--text-muted); font-size: 12px; }
		.dpp .dpp-search { margin-bottom: 6px; }
		.dpp .dpp-list { max-height: 210px; overflow: auto; border: 1px solid var(--border-color); border-radius: 8px; }
		.dpp .dpp-p { display: grid; grid-template-columns: 22px 1fr auto auto; gap: 10px; align-items: center; padding: 6px 10px; border-bottom: 1px solid var(--border-color); cursor: pointer; font-size: 12.5px; }
		.dpp .dpp-p:last-child { border-bottom: 0; } .dpp .dpp-p:hover { background: var(--subtle-fg); }
		.dpp .dpp-p.is-on { background: #eef6fd; } .dpp .dpp-p .fa { color: #2490ef; }
		.dpp .dpp-p small { color: var(--text-muted); display: block; } .dpp .dpp-p .due { font-weight: 700; text-align: right; font-variant-numeric: tabular-nums; }
		.dpp .dpp-p .late { color: #b03a2e; font-size: 11px; }
		.dpp .dpp-p .due small { font-weight: 500; text-align: right; }
		.dpp .dpp-empty { text-align: center; padding: 16px; color: var(--text-muted); }
		.dbp-calc { display: flex; flex-wrap: wrap; gap: 8px; align-items: stretch; margin: 2px 0 6px; }
		.dbp-eq { border: 1px solid var(--border-color); border-radius: 8px; padding: 6px 12px; min-width: 130px; background: var(--card-bg, #fff); display: flex; flex-direction: column; justify-content: center; }
		.dbp-eq span { font-size: 11px; color: var(--text-muted); font-weight: 600; } .dbp-eq span i { font-style: normal; font-weight: 500; color: #2490ef; }
		.dbp-eq b { font-size: 16px; font-variant-numeric: tabular-nums; }
		.dbp-eq.is-main { border-color: #3498DB; background: #eef6fd; } .dbp-eq.is-main b { color: #21618c; font-size: 18px; }
		.dbp-eq.is-adv { border-color: #aed6f1; } .dbp-eq.is-adv b { color: #2490ef; }
		.dbp-eq.is-bad { border-color: #f5b7b1; background: #fdedec; } .dbp-eq.is-bad b { color: #b03a2e; }
		.dbp-eq.is-bank { margin-left: 6px; border-color: rgba(39,174,96,.35); background: rgba(39,174,96,.06); } .dbp-eq.is-bank b { color: #1e7e34; }
		.dbp-op { align-self: center; font-size: 18px; font-weight: 700; color: var(--text-muted); }
		.dbp-calc__btns { margin-left: auto; display: flex; gap: 6px; align-items: center; }
		.dbp-say { font-size: 12.5px; margin: 0 0 10px; padding: 6px 10px; border-radius: 6px; background: #eef6fd; color: #1b4f72; }
		.dbp-say.is-bad { background: #fdedec; color: #922b21; }
		.dbp-b { display: inline-flex; align-items: center; gap: 5px; border-radius: 6px; padding: 4px 11px; font-size: 12px; font-weight: 600; cursor: pointer; white-space: nowrap; line-height: 1.5; transition: background .12s, box-shadow .12s; }
		.dbp-b .fa { font-size: 11px; }
		.dbp-b.is-fill { background: #3498DB; border: 1px solid #2e86c1; color: #fff; } .dbp-b.is-fill:hover { background: #2e86c1; box-shadow: 0 1px 4px rgba(46,134,193,.4); }
		.dbp-b.is-line { background: #fff; border: 1px solid #3498DB; color: #1f6fb2; } .dbp-b.is-line:hover { background: #eef6fd; }
		.dbp-b.is-red { background: #fff; border: 1px solid #e6b0aa; color: #b03a2e; } .dbp-b.is-red:hover { background: #fdedec; border-color: #cd6155; }
		.dbp-b.is-icon { padding: 4px 8px; }
		.dbp-b[disabled] { opacity: .45; cursor: not-allowed; }
		.dbp-acts { display: inline-flex; gap: 5px; }
		.dbp-say.is-warn { background: #fef5e7; color: #935116; border: 1px solid #f8c471; font-weight: 600; }
		.dbp-in { display: inline-flex; align-items: center; border: 1.5px solid #3498DB; border-radius: 6px; background: #fff; padding: 0 6px; box-shadow: 0 0 0 3px rgba(52,152,219,.08); }
		.dbp-in i { font-style: normal; color: #3498DB; font-weight: 700; font-size: 12px; margin-right: 3px; }
		.dbp-in input { border: 0; outline: 0; background: transparent; width: 105px; text-align: right; font-weight: 700; font-size: 13px; padding: 4px 0; color: var(--text-color); }
		.dbp-in.sm input { width: 70px; font-weight: 600; }
		.dbp-in:focus-within { border-color: #1f6fb2; box-shadow: 0 0 0 3px rgba(52,152,219,.25); }
		.dbp-in input::placeholder { color: #aab7c4; font-weight: 500; }
		.dbp-t th.dbp-th-edit { background: #1f6fb2; } .dbp-th-edit .fa { font-size: 10px; }
		.dbp-bar { display: flex; flex-wrap: wrap; gap: 8px; align-items: center; margin: 2px 0 10px; }
		.dbp-tile { border: 1px solid var(--border-color); border-radius: 8px; padding: 5px 12px; min-width: 118px; background: var(--card-bg, #fff); }
		.dbp-tile b { display: block; font-size: 15px; font-variant-numeric: tabular-nums; } .dbp-tile span { font-size: 11px; color: var(--text-muted); }
		.dbp-tile.is-ok b { color: #1e7e34; } .dbp-tile.is-bad b { color: #b03a2e; } .dbp-tile.is-adv b { color: #2490ef; }
		.dbp-tile.is-bank { background: rgba(39,174,96,.08); border-color: rgba(39,174,96,.35); } .dbp-tile.is-bank b { color: #1e7e34; }
		.dbp-scroll { max-height: 46vh; overflow: auto; }
		.dbp-party { border: 1px solid var(--border-color); border-left: 4px solid #c0c6cc; border-radius: 8px; margin-bottom: 12px; overflow: hidden; }
		.dbp-party.is-full { border-left-color: #27ae60; } .dbp-party.is-part { border-left-color: #f39c12; }
		.dbp-party__head { display: flex; flex-wrap: wrap; gap: 12px; align-items: center; padding: 8px 12px; background: var(--subtle-fg); }
		.dbp-party__who { display: grid; flex: 1 1 220px; } .dbp-party__who b { font-size: 13.5px; } .dbp-party__who small { color: var(--text-muted); }
		.dbp-party__fig { display: grid; text-align: right; } .dbp-party__fig span { font-size: 10.5px; color: var(--text-muted); font-weight: 600; }
		.dbp-party__fig b { font-size: 15px; font-variant-numeric: tabular-nums; } .dbp-party__fig small { font-size: 11px; color: var(--text-muted); }
		.dbp-prog { height: 4px; background: var(--border-color); } .dbp-prog i { display: block; height: 100%; background: #27ae60; }
		.dbp-party.is-part .dbp-prog i { background: #f39c12; }
		.dbp-pill { display: inline-block; border-radius: 10px; padding: 2px 9px; font-size: 11px; font-weight: 700; white-space: nowrap; }
		.dbp-pill.is-full { background: rgba(39,174,96,.14); color: #1e8449; } .dbp-pill.is-part { background: rgba(243,156,18,.16); color: #a66a00; }
		.dbp-pill.is-none { background: var(--subtle-fg); color: var(--text-muted); }
		.dbp-t { width: 100%; border-collapse: collapse; font-size: 12.5px; }
		.dbp-t th { background: #3498DB; color: #fff; font-weight: 600; font-size: 11.5px; padding: 6px 8px; border-right: 1px solid rgba(255,255,255,.3); text-align: center; white-space: nowrap; }
		.dbp-t td { padding: 6px 8px; border-bottom: 1px solid var(--border-color); text-align: center; vertical-align: middle; }
		.dbp-t tr:last-child td { border-bottom: 0; }
		.dbp-t td.l, .dbp-t th.l { text-align: left; } .dbp-t td.r, .dbp-t th.r { text-align: right; font-variant-numeric: tabular-nums; white-space: nowrap; }
		.dbp-t td.l small { display: block; color: var(--text-muted); font-size: 11px; }
		.dbp-t tr.is-full td { background: rgba(39,174,96,.06); } .dbp-t tr.is-part td { background: rgba(243,156,18,.07); }
		.dbp-zero { color: #1e8449; font-weight: 700; }
		.dbp-late { color: #b03a2e; font-weight: 600; }
		.dbp-empty { text-align: center; padding: 18px; color: var(--text-muted); border: 1px dashed var(--border-color); border-radius: 8px; }
		.dbp-modeinfo { font-size: 12px; margin: -4px 0 8px; color: var(--text-muted); }
		@media (max-width: 640px) { .dpp .dpp-p { grid-template-columns: 22px 1fr auto; } .dpp .dpp-p .late { display: none; } }
		/* ── theme: one accent, slate neutrals, soft status colours (scoped to the dialog) ── */
		.dacs-pay-dialog { --acc: #2563eb; --acc-d: #1d4ed8; --acc-50: #eff6ff; --acc-100: #dbeafe; --acc-200: #bfdbfe;
			--ok: #059669; --ok-50: #ecfdf5; --warn: #b45309; --warn-50: #fffbeb; --bad: #dc2626; --bad-50: #fef2f2;
			--ink: #0f172a; --ink2: #334155; --mut: #64748b; --line: #e2e8f0; --line2: #cbd5e1; --soft: #f8fafc; }
		.dacs-pay-dialog .modal-content { border-radius: 16px; border: 0; box-shadow: 0 24px 48px -12px rgba(15,23,42,.25); }
		.dacs-pay-dialog .modal-header { border-bottom: 1px solid var(--line); padding: 14px 22px; }
		.dacs-pay-dialog .modal-title { font-size: 17px; font-weight: 700; color: var(--ink); }
		.dacs-pay-dialog .modal-body { background: var(--soft); padding: 18px 22px; }
		.dacs-pay-dialog .modal-footer { border-top: 1px solid var(--line); background: #fff; }
		.dacs-pay-dialog .modal-footer .btn-primary { background: var(--acc); border-color: var(--acc); border-radius: 10px; padding: 8px 18px; font-weight: 600; }
		.dacs-pay-dialog .modal-footer .btn-primary:hover { background: var(--acc-d); }
		.dacs-pay-dialog .wz-sec { border: 1px solid var(--line); border-radius: 14px; padding: 18px 20px; box-shadow: 0 1px 2px rgba(15,23,42,.04); background: #fff; }
		.dacs-pay-dialog .wz-q { font-size: 16px; color: var(--ink); letter-spacing: -.01em; }
		.dacs-pay-dialog .wz-n { background: var(--acc-50); color: var(--acc-d); border: 1px solid var(--acc-200); font-weight: 700; }
		.dacs-pay-dialog .wz-hint, .dacs-pay-dialog .dpp .dpp-hint { color: var(--mut); font-size: 12.5px; }
		.dacs-pay-dialog .wz-sec input.form-control, .dacs-pay-dialog .wz-sec select.form-control, .dacs-pay-dialog .wz-sec textarea.form-control, .dacs-pay-dialog .dpp-search {
			background: #fff !important; border: 1px solid var(--line2) !important; border-radius: 9px !important; box-shadow: none !important; color: var(--ink); }
		.dacs-pay-dialog .wz-sec input.form-control:focus, .dacs-pay-dialog .wz-sec select.form-control:focus, .dacs-pay-dialog .dpp-search:focus { border-color: var(--acc) !important; box-shadow: 0 0 0 3px rgba(37,99,235,.15) !important; }
		.dacs-pay-dialog .wz-amtrow [data-fieldname="total_amount"] input { border: 2px solid var(--acc) !important; color: var(--ink) !important; font-size: 24px !important; border-radius: 12px !important; }
		.dacs-pay-dialog .dpp .dpp-chip { background: var(--acc-50); color: var(--acc-d); border: 1px solid var(--acc-200); }
		.dacs-pay-dialog .dpp .dpp-chip button { background: var(--acc-100); color: var(--acc-d); }
		.dacs-pay-dialog .dpp .dpp-chip.is-idle { background: #fdf2e9; color: #a04000; border-color: #f5cba7; }
		.dpp .dpp-chip small { font-weight: 400; opacity: .85; }
		.dacs-pay-dialog .dpp .dpp-list { border: 1px solid var(--line); border-radius: 12px; }
		.dacs-pay-dialog .dpp .dpp-p { border-bottom: 1px solid var(--line); padding: 9px 12px; }
		.dacs-pay-dialog .dpp .dpp-p:hover { background: var(--soft); }
		.dacs-pay-dialog .dpp .dpp-p.is-on { background: var(--acc-50); box-shadow: inset 3px 0 0 var(--acc); }
		.dacs-pay-dialog .dpp .dpp-p .fa { color: var(--acc); font-size: 15px; }
		.dacs-pay-dialog .dpp .dpp-p b { color: var(--ink); } .dacs-pay-dialog .dpp .dpp-p small { color: var(--mut); }
		.dacs-pay-dialog .dpp .dpp-p small .fa { color: var(--mut); font-size: 11px; }
		.dacs-pay-dialog .dpp .dpp-p .late { color: var(--warn); }
		.dacs-pay-dialog .dpp-av { width: 30px; height: 30px; border-radius: 50%; background: var(--acc-100); color: var(--acc-d); font-size: 11.5px; font-weight: 700; display: inline-flex; align-items: center; justify-content: center; margin-right: 9px; flex: none; }
		.dacs-pay-dialog .dpp-nm { display: flex; align-items: center; min-width: 0; }
		.dacs-pay-dialog .dpz-selbar { background: #fff; border: 1px solid var(--line); border-radius: 12px; }
		.dacs-pay-dialog .dpz-selbar span { color: var(--mut); } .dacs-pay-dialog .dpz-selbar b { color: var(--ink); }
		.dacs-pay-dialog .dpz-selbar b.is-late { color: var(--bad); }
		.dacs-pay-dialog .wz-mode { border: 1px solid var(--line2); border-radius: 12px; color: var(--ink2); padding: 10px 16px; transition: all .12s; }
		.dacs-pay-dialog .wz-mode .fa { color: var(--mut); }
		.dacs-pay-dialog .wz-mode:hover { border-color: var(--acc); color: var(--acc-d); }
		.dacs-pay-dialog .wz-mode.is-on { background: var(--acc-50); border: 1.5px solid var(--acc); color: var(--acc-d); }
		.dacs-pay-dialog .wz-mode.is-on .fa { color: var(--acc); }
		.dacs-pay-dialog .dbp-modeinfo { color: var(--mut); }
		.dacs-pay-dialog .dbp-b { border-radius: 9px; padding: 6px 13px; }
		.dacs-pay-dialog .dbp-b.is-fill { background: var(--acc); border-color: var(--acc); } .dacs-pay-dialog .dbp-b.is-fill:hover { background: var(--acc-d); box-shadow: none; }
		.dacs-pay-dialog .dbp-b.is-line { border-color: var(--line2); color: var(--ink2); } .dacs-pay-dialog .dbp-b.is-line:hover { background: var(--soft); border-color: var(--acc); color: var(--acc-d); }
		.dacs-pay-dialog .dbp-b.is-red { border-color: #fecaca; color: var(--bad); } .dacs-pay-dialog .dbp-b.is-red:hover { background: var(--bad-50); }
		.dacs-pay-dialog .dpz-more { border: 1px solid var(--line); border-radius: 12px; background: #fff; }
		.dacs-pay-dialog .dpz-more summary .fa { color: var(--acc); }
		.dacs-pay-dialog .dpz-foot { border: 1px solid var(--line); border-radius: 12px; background: var(--soft); }
		.dacs-pay-dialog .dpf-i span { color: var(--mut); } .dacs-pay-dialog .dpf-i.is-main b { color: var(--acc-d); }
		.dacs-pay-dialog .dpf-i.is-adv b { color: var(--acc); } .dacs-pay-dialog .dpf-i.is-bad b, .dacs-pay-dialog .dpf-i.is-bad span { color: var(--bad); }
		.dacs-pay-dialog .dpf-i.is-bank b { color: var(--ok); } .dacs-pay-dialog .dpf-op { color: var(--line2); }
		.dacs-pay-dialog .dbp-say { background: var(--acc-50); color: #1e3a8a; border-radius: 9px; }
		.dacs-pay-dialog .dbp-say.is-bad { background: var(--bad-50); color: #991b1b; }
		.dacs-pay-dialog .dbp-say.is-warn { background: var(--warn-50); color: #92400e; border: 1px solid #fde68a; }
		.dacs-pay-dialog .dbp-party { border: 1px solid var(--line); border-left: 3px solid var(--line2); border-radius: 12px; background: #fff; }
		.dacs-pay-dialog .dbp-party.is-full { border-left-color: var(--ok); } .dacs-pay-dialog .dbp-party.is-part { border-left-color: #f59e0b; }
		.dacs-pay-dialog .dbp-party__head { background: #fff; padding: 12px 14px; }
		.dacs-pay-dialog .dbp-party__who b { color: var(--ink); } .dacs-pay-dialog .dbp-party__who small, .dacs-pay-dialog .dbp-party__fig small, .dacs-pay-dialog .dbp-party__fig span { color: var(--mut); }
		.dacs-pay-dialog .dbp-prog { height: 3px; background: var(--line); } .dacs-pay-dialog .dbp-prog i { background: var(--ok); }
		.dacs-pay-dialog .dbp-party.is-part .dbp-prog i { background: #f59e0b; }
		.dacs-pay-dialog .dbp-t th { background: var(--acc-50); color: var(--acc-d); border-right: 0; border-bottom: 1px solid var(--acc-100); font-size: 11.5px; letter-spacing: .02em; text-transform: uppercase; }
		.dacs-pay-dialog .dbp-t th.dbp-th-edit { background: var(--acc-100); color: var(--acc-d); }
		.dacs-pay-dialog .dbp-t td { border-bottom: 1px solid var(--line); color: var(--ink2); }
		.dacs-pay-dialog .dbp-t tr.is-full td { background: #f6fef9; } .dacs-pay-dialog .dbp-t tr.is-part td { background: #fffdf5; }
		.dacs-pay-dialog .dbp-inv { color: var(--ink); }
		.dacs-pay-dialog .dbp-in { border: 1.5px solid var(--acc-200); border-radius: 9px; box-shadow: none; }
		.dacs-pay-dialog .dbp-in:focus-within { border-color: var(--acc); box-shadow: 0 0 0 3px rgba(37,99,235,.15); }
		.dacs-pay-dialog .dbp-in i { color: var(--acc); }
		.dacs-pay-dialog .dbp-pill { border-radius: 999px; padding: 2px 10px; font-weight: 600; }
		.dacs-pay-dialog .dbp-pill.is-full { background: var(--ok-50); color: var(--ok); border: 1px solid #a7f3d0; }
		.dacs-pay-dialog .dbp-pill.is-part { background: var(--warn-50); color: var(--warn); border: 1px solid #fde68a; }
		.dacs-pay-dialog .dbp-pill.is-none { background: var(--soft); color: var(--mut); border: 1px solid var(--line); }
		.dacs-pay-dialog .dbp-zero { color: var(--ok); } .dacs-pay-dialog .dbp-late { color: var(--bad); }
		/* check window and the success screen */
		.wz-rv { border-color: #e2e8f0; border-radius: 14px; }
		.wz-rv__top { background: linear-gradient(135deg, #eff6ff, #f8fafc); padding: 18px; } .wz-rv__top b { color: #1d4ed8; }
		.wz-rv th { background: #eff6ff; color: #1d4ed8; text-transform: uppercase; font-size: 11.5px; letter-spacing: .02em; }
		.wz-ok { border-radius: 12px; border: 1px solid #fde68a; background: #fffbeb; }
		.dpd { text-align: center; padding: 6px 4px 2px; }
		.dpd-ic { width: 64px; height: 64px; border-radius: 50%; background: #ecfdf5; color: #059669; display: inline-flex; align-items: center; justify-content: center; font-size: 30px; margin-bottom: 10px; }
		.dpd h3 { font-size: 18px; font-weight: 700; margin: 0 0 2px; color: #0f172a; } .dpd .amt { font-size: 28px; font-weight: 800; color: #0f172a; }
		.dpd .sub { color: #64748b; font-size: 13px; margin-bottom: 14px; }
		.dpd-list { text-align: left; border: 1px solid #e2e8f0; border-radius: 12px; overflow: hidden; margin: 0 0 14px; }
		.dpd-list div { display: flex; justify-content: space-between; align-items: center; gap: 10px; padding: 9px 14px; border-top: 1px solid #e2e8f0; font-size: 13px; }
		.dpd-list div:first-child { border-top: 0; }
		.dpd-print { display: inline-flex; gap: 8px; align-items: center; background: #2563eb; color: #fff; border: 0; border-radius: 12px; padding: 12px 22px; font-size: 15px; font-weight: 700; cursor: pointer; }
		.dpd-print:hover { background: #1d4ed8; }
		.dpd-sm { border: 1px solid #cbd5e1; background: #fff; color: #334155; border-radius: 8px; padding: 4px 10px; font-size: 12px; font-weight: 600; cursor: pointer; }
		.dpd-sm:hover { border-color: #2563eb; color: #1d4ed8; }
`;

		// ── ② the party picker ─────────────────────────────────────────────────────────────
		const $pk = d.fields_dict.picker.$wrapper;
		$pk.html(`<style>${css}</style><div class="dpp">
			<div class="dpp-chips"></div>
			<input type="text" class="form-control dpp-search" placeholder="${esc(__("Search {0} by name, mobile, city, pincode, GSTIN or ID…", [who]))}">
			<div class="dpp-list"></div>
			<div class="dpp-hint" style="margin-top:6px;">${esc(__("Click a {0} to add or remove. Only {1} with something unpaid are listed — most due first. For an advance from someone else, search their name.", [who, whos]))}</div>
		</div>`);
		// a chosen party with nothing open (no invoice, opening balance or journal) — known once its items are loaded
		const idle_party = (p) => loaded && !invoices.some(r => r.party === p);
		const paint_chips = () => {
			$pk.find(".dpp-chips").html(selected.size
				? [...selected].map(([p, n]) => `<span class="dpp-chip ${idle_party(p) ? "is-idle" : ""}">${esc(n || p)}${idle_party(p) ? ` <small>· ${__("nothing due")}</small>` : ""}<button type="button" data-p="${esc(p)}" title="${esc(__("Remove"))}">×</button></span>`).join("")
				: `<span class="dpp-hint">${esc(__("No {0} chosen yet.", [who]))}</span>`);
		};
		const paint_parties = () => {
			const today = frappe.datetime.get_today();
			$pk.find(".dpp-list").html(parties_due.length ? parties_due.map(p => `
				<div class="dpp-p ${selected.has(p.party) ? "is-on" : ""}" data-p="${esc(p.party)}" data-n="${esc(p.party_name || "")}">
					<i class="fa ${selected.has(p.party) ? "fa-check-square" : "fa-square-o"}"></i>
					<div class="dpp-nm"><span class="dpp-av">${esc((p.party_name || p.party).split(/\s+/).filter(Boolean).slice(0, 2).map(w => w[0]).join("").toUpperCase())}</span>
						<div style="min-width:0;"><b>${esc(p.party_name || p.party)}</b><small>${[esc(p.party), p.mobile ? `<i class="fa fa-phone"></i> ${esc(p.mobile)}` : "", p.place ? `<i class="fa fa-map-marker"></i> ${esc(p.place)}` : "",
							p.gstin ? esc(p.gstin) : "", p.invoices ? "" : __("nothing due — advance")].filter(Boolean).join(" · ")}</small></div></div>
					<span class="late">${p.oldest_due ? (p.oldest_due < today ? __("overdue since {0}", [frappe.datetime.str_to_user(p.oldest_due)]) : __("due {0}", [frappe.datetime.str_to_user(p.oldest_due)])) : ""}</span>
					<span class="due">${p.due ? `${money(p.due)}<small>${p.invoices} ${p.invoices === 1 ? __("item") : bills}</small>` : ""}</span>
				</div>`).join("") : `<div class="dpp-empty">${esc(__("No {0} found.", [who]))}</div>`);
		};
		let search_timer;
		const search = (txt) => frappe.call({ method: P + "get_parties_due", args: { payment_type: receive ? "Receive" : "Pay", company, txt } })
			.then(r => {
				parties_due = r.message || [];   // a search also brings parties with nothing due (for an advance)
				paint_parties();
			});
		$pk.on("input", ".dpp-search", (e) => { clearTimeout(search_timer); search_timer = setTimeout(() => search(e.target.value.trim()), 300); });
		$pk.on("click", ".dpp-p", (e) => {
			const $p = $(e.currentTarget), p = String($p.data("p"));
			if (selected.has(p)) selected.delete(p); else selected.set(p, String($p.data("n") || p));
			paint_chips(); paint_parties(); load();
		});
		$lay.on("click", ".wz-pick", () => { picking = !picking; $lay.find(".wz").toggleClass("is-picking", picking); });
		$pk.on("click", ".dpp-chip button", (e) => { selected.delete(String($(e.currentTarget).data("p"))); paint_chips(); paint_parties(); load(); });

		// ── ③ invoices and totals ──────────────────────────────────────────────────────────
		const show_cuts = () => !!d.get_value("show_cuts");
		const calc = () => {
			const total = flt(d.get_value("total_amount"), 2);
			const sum = (o) => flt(Object.values(o).reduce((a, v) => a + flt(v), 0), 2);
			const allocated = sum(amt), t = show_cuts() ? sum(tds) : 0, w = show_cuts() ? sum(wo) : 0;
			const charges = flt(d.get_value("bank_charges"), 2);
			const remaining = flt(total - allocated, 2);
			const bank = flt(receive ? total - t - w - charges : total - t - w + charges, 2);
			const n_parties = new Set(invoices.filter(r => flt(amt[r.name]) > 0).map(r => r.party)).size || selected.size;
			return { total, allocated, remaining, tds: t, wo: w, charges, bank, n_parties };
		};
		const spread = () => {
			// the total over the invoices: the invoice it was opened from first, then oldest due
			Object.keys(amt).forEach(k => delete amt[k]);
			let left = flt(d.get_value("total_amount"), 2);
			const order = invoices.slice().sort((a, b) => (b.name === first) - (a.name === first));
			for (const r of order) {
				if (left <= 0.005) break;
				const a = Math.min(left, flt(r.outstanding_amount, 2));
				amt[r.name] = flt(a, 2); left = flt(left - a, 2);
			}
		};
		// one plain sentence for what will happen
		const say = (c, adv_ok, n_on) => {
			if (!selected.size) return __("Start with part 1: click the {0}.", [whos]);
			if (c.total <= 0) return __("Type the amount in part 2, or tick {0} below — the amount adds up as you go.", [bills]);
			if (c.remaining < -0.005) return __("The {0} add up to more than the amount — lower one of them.", [bills]);
			if (!n_on) return adv_ok ? __("No {0} chosen: the whole {1} is kept as advance.", [__("item"), money(c.total)])
				: __("Tick the {0} this amount is for.", [bills]);
			if (c.remaining > 0.005) return adv_ok ? __("{0} goes on {1}; the other {2} stays as advance and can be adjusted later.", [money(c.allocated), n_on === 1 ? __("1 {0}", [__("item")]) : __("{0} {1}", [n_on, bills]), money(c.remaining)])
				: c.n_parties > 1 ? __("With several {0} the whole amount must go on {1} — {2} still to allocate.", [whos, bills, money(c.remaining)])
				: __("An advance can't go with bank charges, TDS or write-off — allocate the {0} or take them off.", [money(c.remaining)]);
			return __("The whole {0} goes on {1}.", [money(c.total), n_on === 1 ? __("1 {0}", [__("item")]) : __("{0} {1}", [n_on, bills])]);
		};
		const allocated_except = (name) => flt(Object.entries(amt).reduce((a, [k, v]) => a + (k === name ? 0 : flt(v)), 0), 2);
		const set_total = (v) => { setting_total = true; Promise.resolve(d.set_value("total_amount", flt(v, 2))).then(() => { setting_total = false; render(); }); };
		// put `want` on invoice r — never more than it owes, and (amount typed) never more than is left
		const put = (r, want, quiet) => {
			let v = Math.min(flt(want, 2), flt(r.outstanding_amount, 2));
			if (!total_auto) {
				const left = flt(flt(d.get_value("total_amount")) - allocated_except(r.name), 2);
				if (v > left) {
					v = Math.max(left, 0);
					if (!quiet) flash(v > 0
						? __("Only {0} of the amount is left — {1} is part paid.", [money(v), r.name])
						: __("The whole {0} is already allocated. Lower another {1} or raise the amount.", [money(d.get_value("total_amount")), __("item")]));
				}
			}
			if (v > 0.005) amt[r.name] = flt(v, 2); else { [amt, tds, wo].forEach(o => delete o[r.name]); }
		};
		const after_change = () => { if (total_auto) set_total(Object.values(amt).reduce((a, v) => a + flt(v), 0)); else render(); };
		// amount lowered below what is ticked: take the excess off the last ones
		const fit = () => {
			let over = flt(calc().allocated - flt(d.get_value("total_amount")), 2);
			const order = invoices.filter(r => flt(amt[r.name]) > 0).reverse();
			for (const r of order) {
				if (over <= 0.005) break;
				const cut = Math.min(over, flt(amt[r.name]));
				put(r, flt(amt[r.name]) - cut, true); over = flt(over - cut, 2);
			}
		};
		// under part 1: what the chosen customers owe; part 2's "Full due" takes all of it
		const paint_sel = () => {
			const $s = $lay.find(".dpz-sel");
			const due0 = flt(invoices.reduce((x, r) => x + flt(r.outstanding_amount), 0), 2);
			if (simple) {
				const late0 = flt(invoices.filter(r => r.due_date && r.due_date < frappe.datetime.get_today()).reduce((x, r) => x + flt(r.outstanding_amount), 0), 2);
				$lay.find(".wz-who").html(`<i class="fa fa-user" style="color:#3498DB;"></i><b>${[...selected.values()].map(esc).join(", ")}</b>
					<span>${due0 > 0.005 ? (receive ? __("owes {0} on {1} item(s)", [money(due0), invoices.length]) : __("we owe {0} on {1} item(s)", [money(due0), invoices.length]))
						: (receive ? __("owes nothing now — the amount will be an advance") : __("nothing due now — the amount will be an advance"))}${late0 > 0.005 ? " · " + __("{0} overdue", [money(late0)]) : ""}</span>
					<button type="button" class="dbp-b is-line wz-edit wz-pick"><i class="fa fa-pencil"></i> ${__("Change")}</button>`);
			}
			if (!simple) $lay.find(".wz-who").html(selected.size ? `<i class="fa fa-user" style="color:#3498DB;"></i><b>${[...selected.values()].map(esc).join(", ")}</b>
				<span>${__("owe{0} {1} on {2} {3}", [selected.size === 1 ? "s" : "", money(due0), invoices.length, invoices.length === 1 ? __("item") : bills])}</span>
				<button type="button" class="dbp-b is-line wz-edit" data-go="1"><i class="fa fa-pencil"></i> ${__("Change")}</button>` : "");
			$lay.find(".wz-full").html(due0 > 0.005 ? `<button type="button" class="dbp-b is-fill dpz-takeall"><i class="fa fa-check-circle"></i> ${__("Full due {0}", [money(due0)])}</button>` : "");
			if (!selected.size) { $s.html(""); return; }
			const today = frappe.datetime.get_today();
			const due = flt(invoices.reduce((x, r) => x + flt(r.outstanding_amount), 0), 2);
			const late = invoices.filter(r => r.due_date && r.due_date < today);
			const late_amt = flt(late.reduce((x, r) => x + flt(r.outstanding_amount), 0), 2);
			$s.html(`<div class="dpz-selbar">
				<div><span>${__("Selected")}</span><b>${selected.size} ${selected.size === 1 ? who : whos}</b></div>
				<div><span>${__("Total due")}</span><b>${money(due)}</b></div>
				<div><span>${__("Items")}</span><b>${invoices.length}</b></div>
				<div><span>${__("Overdue")}</span><b class="${late_amt ? "is-late" : ""}">${money(late_amt)}</b></div>

			</div>`);
		};
		const render = () => {
			const $w = d.fields_dict.list.$wrapper;
			const c = calc();
			const adv_ok = c.n_parties <= 1 && !c.tds && !c.wo && !c.charges;
			const n_on = invoices.filter(r => flt(amt[r.name]) > 0).length;
			const due_sel = flt(invoices.reduce((x, r) => x + flt(r.outstanding_amount), 0), 2);
			const bar = `<div class="dpf">
				<div class="dpf-i is-due"><span>${__("Due on selected")}</span><b>${money(due_sel)}</b></div>
				<span class="dpf-op">│</span>
				<div class="dpf-i is-main"><span>${receive ? __("Amount received") : __("Amount paid")}${total_auto ? " · " + __("adds up as you tick") : ""}</span><b>${money(c.total)}</b></div>
				<span class="dpf-op">=</span>
				<div class="dpf-i"><span>${__("On {0} {1}", [n_on, n_on === 1 ? __("item") : bills])}</span><b>${money(c.allocated)}</b></div>
				${Math.abs(c.remaining) < 0.005 ? "" : `<span class="dpf-op">+</span>${c.remaining > 0 && adv_ok
					? `<div class="dpf-i is-adv"><span>${__("Kept as advance")}</span><b>${money(c.remaining)}</b></div>`
					: c.remaining > 0 ? `<div class="dpf-i is-bad"><span>${__("Still to allocate")}</span><b>${money(c.remaining)}</b></div>`
					: `<div class="dpf-i is-bad"><span>${__("Over by")}</span><b>${money(-c.remaining)}</b></div>`}`}
				${(c.tds || c.wo || c.charges) ? `<span class="dpf-op">→</span><div class="dpf-i is-bank"><span>${receive ? __("Into bank after deductions") : __("Out of bank")}</span><b>${money(c.bank)}</b></div>` : ""}
				<div class="dpf-btns">
					<button class="dbp-b is-line dbp-auto" ${invoices.length ? "" : "disabled"} title="${esc(__("Spread the amount over the invoices, oldest due first"))}"><i class="fa fa-magic"></i> ${__("Auto-allocate")}</button>
					<button class="dbp-b is-line dbp-clear" ${invoices.length ? "" : "disabled"}><i class="fa fa-eraser"></i> ${__("Clear")}</button>
				</div>
			</div>
			${flash_msg ? `<div class="dbp-say is-warn"><i class="fa fa-exclamation-triangle"></i> ${flash_msg}</div>` : ""}
			<div class="dbp-say ${c.remaining < -0.005 || (c.remaining > 0.005 && !adv_ok) ? "is-bad" : ""}"><i class="fa fa-info-circle"></i> ${say(c, adv_ok, n_on)}</div>`;
			flash_msg = null;
			d.fields_dict.summary.$wrapper.html(bar);
			paint_sel();
			if (!invoices.length) {
				$w.html(`<div class="dbp-empty">${selected.size
					? __("No unpaid {0} for the chosen {1} — the whole amount will be an advance.", [bills, selected.size === 1 ? who : whos])
					: __("Click the {0} in part 1 — their unpaid {1} appear here.", [whos, bills])}</div>`);
				return;
			}
			if (!detail) {
				// the short list: what this payment pays, oldest first; the full table on "Change which items"
				const today0 = frappe.datetime.get_today();
				const rows0 = invoices.map(r => {
					const paying = flt(amt[r.name]), out = flt(r.outstanding_amount);
					const st = paying <= 0.005 ? "none" : (out - paying <= 0.005 ? "full" : "part");
					const PL = { full: ["is-full", __("fully paid")], part: ["is-part", __("part paid — {0} left", [money(out - paying)])], none: ["is-none", __("not paid now")] };
					return `<tr class="is-${st}"><td>${kind_chip(r)}<a href="${doc_url(r)}" target="_blank">${esc(r.name)}</a>
						<small>${r.due_date ? (r.due_date < today0 ? `<span class="dbp-late">${__("overdue since {0}", [frappe.datetime.str_to_user(r.due_date)])}</span>` : __("due {0}", [frappe.datetime.str_to_user(r.due_date)])) : ""}${r.remark ? " · " + esc(r.remark) : ""}</small></td>
						<td class="r">${__("due")} <b>${money(out)}</b></td>
						<td class="r"><b>${paying > 0.005 ? money(paying) : "—"}</b></td>
						<td class="r"><span class="dbp-pill ${PL[st][0]}">${PL[st][1]}</span></td></tr>`;
				}).join("");
				$w.html(`<table class="dbp-mini">${rows0}</table>
					<div class="dbp-more"><button type="button" class="dbp-b is-line dbp-detail"><i class="fa fa-list"></i> ${__("Change which items or amounts")}</button>
					<span class="wz-hint" style="margin-left:8px;">${__("The amount is set against the oldest first.")}</span></div>`);
				return;
			}
			const groups = {};
			invoices.forEach(r => (groups[r.party] = groups[r.party] || []).push(r));
			const today = frappe.datetime.get_today();
			const cuts = show_cuts();
			// each invoice: Fully paid / Part paid / Not paid now, and what stays due after this payment
			const state = (paying, out) => paying <= 0.005 ? "none" : (out - paying <= 0.005 ? "full" : "part");
			const PILL = { full: ["is-full", __("Fully paid")], part: ["is-part", __("Part paid")], none: ["is-none", __("Not paid now")] };
			const cards = Object.keys(groups).map(p => {
				const rows = groups[p];
				const sum = rows.reduce((a, r) => a + flt(amt[r.name]), 0);
				const due = rows.reduce((a, r) => a + flt(r.outstanding_amount), 0);
				const n = { full: 0, part: 0, none: 0 };
				rows.forEach(r => n[state(flt(amt[r.name]), flt(r.outstanding_amount))]++);
				const pst = state(sum, due);
				const pct = due ? Math.min(100, Math.round(sum / due * 100)) : 0;
				const counts = [n.full ? __("{0} fully paid", [n.full]) : "", n.part ? __("{0} part paid", [n.part]) : "",
					n.none ? __("{0} not paid now", [n.none]) : ""].filter(Boolean).join(" · ");
				return `<div class="dbp-party is-${pst}">
					<div class="dbp-party__head">
						<div class="dbp-party__who"><b>${esc(rows[0].party_name || p)}</b><small>${esc(p)} · ${counts}</small></div>
						<div class="dbp-party__fig"><span>${__("Paying now")}</span><b>${money(sum)}</b><small>${__("of {0} due", [money(due)])} · ${__("{0} left after", [money(due - sum)])}</small></div>
						<span class="dbp-pill ${PILL[pst][0]}">${PILL[pst][1]}</span>
						${pst === "full" ? "" : `<button class="dbp-b is-fill dbp-pfull" data-p="${esc(p)}"><i class="fa fa-check-circle"></i> ${__("Pay all in full")}</button>`}
					</div>
					<div class="dbp-prog"><i style="width:${pct}%"></i></div>
					<div class="dbp-tw"><table class="dbp-t"><thead><tr><th class="l">${__("Item")}</th>
						<th class="r">${__("Due now")}</th><th class="r dbp-th-edit"><i class="fa fa-pencil"></i> ${__("Paying now")}</th>
						${cuts ? `<th class="r dbp-th-edit"><i class="fa fa-pencil"></i> ${receive ? __("TDS") : __("TDS")}</th><th class="r dbp-th-edit"><i class="fa fa-pencil"></i> ${__("W/off")}</th>` : ""}
						<th class="r">${__("Left after")}</th><th></th></tr></thead>
					<tbody>${rows.map(r => {
						const paying = flt(amt[r.name]), out = flt(r.outstanding_amount), st = state(paying, out);
						return `<tr class="is-${st}">
						<td class="l">${kind_chip(r)}<a class="dbp-inv" href="${doc_url(r)}" target="_blank">${esc(r.name)}</a>
							<small>${receive ? "" : (r.bill_no ? esc(r.bill_no) + " · " : "")}${r.remark ? esc(r.remark) + " · " : ""}${__("total {0}", [money(r.invoice_total)])}${r.due_date
								? ` · <span class="${r.due_date < today ? "dbp-late" : ""}">${r.due_date < today ? __("overdue {0}", [frappe.datetime.str_to_user(r.due_date)]) : __("due {0}", [frappe.datetime.str_to_user(r.due_date)])}</span>` : ""}</small></td>
						<td class="r"><b>${money(out)}</b></td>
						<td class="r"><span class="dbp-in" title="${esc(__("Type the amount for this invoice"))}"><i>₹</i><input type="number" step="0.01" min="0" class="dbp-amt" data-k="amt" data-inv="${esc(r.name)}" value="${paying ? flt(paying, 2) : ""}" placeholder="${esc(__("type"))}"></span></td>
						${cuts ? `<td class="r"><span class="dbp-in sm"><i>₹</i><input type="number" step="0.01" min="0" class="dbp-amt" data-k="tds" data-inv="${esc(r.name)}" value="${tds[r.name] ? flt(tds[r.name], 2) : ""}" placeholder="0"></span></td>
							<td class="r"><span class="dbp-in sm"><i>₹</i><input type="number" step="0.01" min="0" class="dbp-amt" data-k="wo" data-inv="${esc(r.name)}" value="${wo[r.name] ? flt(wo[r.name], 2) : ""}" placeholder="0"></span></td>` : ""}
						<td class="r"><b class="${st === "full" ? "dbp-zero" : ""}">${money(out - paying)}</b><br><span class="dbp-pill ${PILL[st][0]}">${PILL[st][1]}</span></td>
						<td class="dbp-actcell">${st === "full"
							? `<button class="dbp-b is-red is-icon dbp-none" data-inv="${esc(r.name)}" title="${esc(__("Don't pay this one now"))}"><i class="fa fa-times"></i></button>`
							: `<span class="dbp-acts">${st === "part" ? `<button class="dbp-b is-red is-icon dbp-none" data-inv="${esc(r.name)}" title="${esc(__("Don't pay this one now"))}"><i class="fa fa-times"></i></button>` : ""}<button class="dbp-b is-fill dbp-full" data-inv="${esc(r.name)}" title="${esc(__("Pay the whole amount due"))}"><i class="fa fa-check"></i> ${__("Full")}</button></span>`}</td></tr>`;
					}).join("")}</tbody></table></div></div>`;
			}).join("");
			$w.html(`<div class="dbp-scroll">${cards}</div>`);
		};
		const by_name = (n) => invoices.find(r => r.name === n);
		const $list = d.fields_dict.list.$wrapper;
		$list.on("click", ".dbp-detail", () => { detail = true; render(); });
		$list.on("change", ".dbp-amt", (e) => {
			const k = String($(e.target).data("k")), r = by_name(String($(e.target).data("inv")));
			const store = { amt, tds, wo }[k];
			let v = flt(e.target.value, 2);
			if (k === "amt") {
				manual = true;
				if (v > flt(r.outstanding_amount)) flash(__("Not more than what is due on {0}", [r.name]));
				put(r, v);
				return after_change();
			}
			if (v > flt(amt[r.name])) {
				v = flt(amt[r.name], 2); flash(__("TDS / write-off are part of the amount on {0}", [r.name]));
			}
			if (v > 0) store[r.name] = v; else delete store[r.name];
			render();
		});
		$list.on("click", ".dbp-full", (e) => { manual = true; put(by_name(String($(e.currentTarget).data("inv"))), Infinity); after_change(); });
		$list.on("click", ".dbp-none", (e) => {
			manual = true; const n = String($(e.currentTarget).data("inv"));
			[amt, tds, wo].forEach(o => delete o[n]); after_change();
		});
		$list.on("click", ".dbp-pfull", (e) => {
			manual = true; const p = String($(e.currentTarget).data("p"));
			invoices.filter(r => r.party === p).forEach(r => put(r, Infinity, true));
			if (!total_auto && invoices.some(r => r.party === p && flt(amt[r.name]) < flt(r.outstanding_amount) - 0.005))
				flash(__("The amount ran out — the rest stays due."));
			after_change();
		});
		const $sumw = d.fields_dict.summary.$wrapper;
		$lay.on("click", ".dpz-takeall", () => {
			const due = flt(invoices.reduce((x, r) => x + flt(r.outstanding_amount), 0), 2);
			manual = false; total_auto = false;
			setting_total = true;
			Promise.resolve(d.set_value("total_amount", due)).then(() => { setting_total = false; spread(); render(); });
		});
		$sumw.on("click", ".dbp-clear", () => { manual = true; [amt, tds, wo].forEach(o => Object.keys(o).forEach(k => delete o[k])); after_change(); });
		$sumw.on("click", ".dbp-auto", () => {
			if (total_auto || flt(d.get_value("total_amount")) <= 0) {
				flash(__("Type the amount in part 2 first — Auto-allocate spreads it over the {0}, oldest due first.", [bills]));
				return render();
			}
			manual = false; spread(); render();
			const c = calc();
			if (c.remaining > 0.005) flash(c.n_parties > 1
				? __("{0} is more than these {1} together — add another {2} or lower the amount.", [money(c.total), bills, who])
				: __("{0} more than the {1} — kept as advance.", [money(c.remaining), bills]));
			if (flash_msg) render();
		});

		const load = () => {
			const parties = [...selected.keys()];
			loaded = false;
			if (!parties.length) { invoices = []; paint_chips(); render(); return; }
			frappe.call({ method: P + "get_open_invoices", args: { payment_type: receive ? "Receive" : "Pay", parties, company } })
				.then(r => {
					invoices = r.message || [];
					loaded = true; paint_chips();
					[amt, tds, wo].forEach(o => Object.keys(o).forEach(k => { if (!by_name(k)) delete o[k]; }));
					if (!manual && !total_auto) spread(); else if (!total_auto) fit();
					after_change();
				});
		};

		// ── ① mode, reference, bank charges ledger ────────────────────────────────────────
		let auto_charges_acc = d.get_value("bank_charges_account") || "";
		const mode_icon = (m) => /cash/i.test(m.name) ? "money" : /card/i.test(m.name) ? "credit-card" : /upi|razorpay/i.test(m.name) ? "mobile" : /cheque|draft/i.test(m.name) ? "file-text-o" : "university";
		$lay.on("click", ".wz-mode", (e) => d.set_value("mode_of_payment", String($(e.currentTarget).data("m"))));
		const paint_mode = () => {
			const m = mode_by_name[d.get_value("mode_of_payment")];
			$lay.find(".wz-modes").html((setup.modes || []).map(x => `<button type="button" class="wz-mode ${m && m.name === x.name ? "is-on" : ""}" data-m="${esc(x.name)}"><i class="fa fa-${mode_icon(x)}"></i>${esc(x.name)}</button>`).join(""));
			const is_bank = m && m.account_type === "Bank";
			["reference_no", "reference_date"].forEach(f => d.set_df_property(f, "hidden", is_bank ? 0 : 1));   // checked by the wizard (next)
			d.fields_dict.mode_info.$wrapper.html(m
				? `<div class="dbp-modeinfo"><i class="fa fa-${is_bank ? "university" : "money"}"></i> ${receive ? __("Money goes into") : __("Money goes out of")} <b>${esc(m.account)}</b></div>`
				: (setup.modes || []).length ? "" : `<div class="dbp-modeinfo text-warning">${__("No Mode of Payment is ticked \"Show in Payment Entry\".")}</div>`);
			// bank charges ledger follows the mode (card → Card Swipe Bank Charges); a hand-picked one stays
			const want = (m && /card/i.test(m.name) && setup.defaults.card_charges_account) || setup.defaults.bank_charges_account || "";
			const cur = d.get_value("bank_charges_account") || "";
			if (want && cur !== want && (!cur || cur === auto_charges_acc)) { auto_charges_acc = want; d.set_value("bank_charges_account", want); }
		};
		d.fields_dict.mode_of_payment.df.onchange = paint_mode;
		d.fields_dict.total_amount.df.onchange = () => {
			if (setting_total) return;
			total_auto = flt(d.get_value("total_amount")) <= 0;   // typed by the user: fixed from now on
			if (total_auto) { if (Object.keys(amt).length) set_total(calc().allocated); else render(); return; }
			if (!manual) spread(); else fit();
			render();
		};
		d.fields_dict.bank_charges.df.onchange = () => render();
		d.fields_dict.show_cuts.df.onchange = () => render();

		// ── Review and submit ─────────────────────────────────────────────────────────────
		const collect = () => {
			const v = d.get_values();
			if (!v) return null;
			const c = calc();
			if (!selected.size) { frappe.msgprint(__("Choose the {0} in part 1.", [who])); return null; }
			if (c.total <= 0) { frappe.msgprint(__("Enter the Total Amount.")); return null; }
			if (c.remaining < -0.005) { frappe.msgprint(__("The amounts on the {0} are {1} more than the total.", [bills, money(-c.remaining)])); return null; }
			if (c.remaining > 0.005 && (c.n_parties > 1 || selected.size > 1)) {
				frappe.msgprint(__("Allocated {0} of {1} — {2} still to allocate. With several {3} the amounts must add up to the total.",
					[money(c.allocated), money(c.total), money(c.remaining), whos])); return null;
			}
			if (c.remaining > 0.005 && (c.tds || c.wo || c.charges)) {
				frappe.msgprint(__("{0} more than the {1} would be kept as advance — that can't go with bank charges, TDS or write-off.", [money(c.remaining), bills])); return null;
			}
			if (c.bank <= 0) { frappe.msgprint(__("The bank charges / TDS / write-off are as much as the total.")); return null; }
			if (c.charges && !v.bank_charges_account) { frappe.msgprint(__("Choose the Bank Charges Account.")); return null; }
			if (c.tds && receive && !v.tds_account) { frappe.msgprint(__("Choose the TDS Account.")); return null; }
			if (c.wo && !v.write_off_account) { frappe.msgprint(__("Choose the Write Off Account.")); return null; }
			const cuts = show_cuts();
			const allocations = invoices.filter(r => flt(amt[r.name]) > 0).map(r => ({
				party: r.party, party_name: r.party_name, invoice: r.name, doctype: r.doctype || inv_dt, amount: flt(amt[r.name], 2),
				tds: cuts ? flt(tds[r.name], 2) : 0, write_off: cuts ? flt(wo[r.name], 2) : 0 }));
			const parties = [...new Set(allocations.map(a => a.party))];
			if (selected.size > 1 && parties.length < selected.size) {
				const idle = [...selected.keys()].filter(p => !parties.includes(p));
				const none_due = idle.filter(idle_party), names = (l) => l.map(p => esc(selected.get(p) || p)).join(", ");
				const remove = () => { idle.forEach(p => selected.delete(p)); paint_chips(); paint_parties(); load(); };
				frappe.msgprint({ title: __("Nothing to pay for {0}", [names(idle)]), indicator: "orange",
					message: (none_due.length ? __("{0}: nothing unpaid (no invoice, opening balance or journal is open).", [names(none_due)]) + "<br><br>" : "")
						+ __("With several {0} in one payment, every one of them must pay something here. Remove {1}, or put an amount on their items.", [whos, names(idle)])
						+ (none_due.length ? "<br>" + __("For an advance from them, make a separate payment for them alone.") : ""),
					primary_action: { label: __("Remove {0}", [names(idle)]), action: () => { frappe.hide_msgprint(); remove(); } } });
				return null;
			}
			return { v, c, allocations, party: [...selected.keys()][0] };
		};

		const fill_form = () => {
			const x = collect(); if (!x) return;
			if (!x.allocations.length) return frappe.msgprint(__("A Bulk Payment needs at least one invoice."));
			["total_amount", "mode_of_payment", "posting_date", "reference_no", "reference_date", "remarks",
			 "bank_charges", "bank_charges_account", "tds_account", "write_off_account"].forEach(f => frm.set_value(f, x.v[f] || null));
			frm.clear_table("allocations");
			x.allocations.forEach(a => frm.add_child("allocations", {
				party_type: party_dt, party: a.party, party_name: a.party_name, reference_doctype: a.doctype || inv_dt,
				reference_name: a.invoice, allocated_amount: a.amount, tds_amount: a.tds, write_off_amount: a.write_off }));
			frm.refresh_field("allocations");
			d.hide();
		};

		// the check window's content: everything shown back, a tick
		let pending = null;
		const review = () => {
			const x = collect(); if (!x) return false;
			const { v, c } = x;
			const by = {};
			x.allocations.forEach(a => (by[a.party] = by[a.party] || { name: a.party_name, rows: [] }).rows.push(a));
			if (!x.allocations.length) by[x.party] = { name: selected.get(x.party), rows: [] };
			const many = Object.keys(by).length > 1;
			const m = mode_by_name[v.mode_of_payment];
			const rows = Object.entries(by).map(([p, g]) => {
				const inv = g.rows.map(r => `${esc(r.invoice)} — ${money(r.amount)}${r.tds ? ` (TDS ${money(r.tds)})` : ""}${r.write_off ? ` (${__("write-off")} ${money(r.write_off)})` : ""}`);
				if (!many && c.remaining > 0.005) inv.push(__("Advance {0}", [money(c.remaining)]));
				return `<tr><td><b>${esc(g.name || p)}</b></td><td>${inv.join("<br>") || __("Advance")}</td>
					<td class="r"><b>${money(g.rows.reduce((a, r) => a + r.amount, 0) + (many ? 0 : c.remaining))}</b></td></tr>`;
			}).join("");
			$lay.find(".wz-review").html(`<div class="wz-rv">
				<div class="wz-rv__top"><span>${receive ? __("You are receiving") : __("You are paying")}</span><b>${money(c.bank)}</b>
					<span>${receive ? __("into") : __("from")} ${esc((m && m.account) || "")}</span></div>
				<div class="wz-rv__row"><span>${__("Mode")}</span><b>${esc(v.mode_of_payment)}${v.reference_no ? " · " + esc(v.reference_no) : ""}</b></div>
				<div class="wz-rv__row"><span>${__("Date")}</span><b>${frappe.datetime.str_to_user(v.posting_date)}</b></div>
				${c.charges || c.tds || c.wo ? `<div class="wz-rv__row"><span>${__("Settled on invoices")}</span><b>${money(c.total)}</b></div>` : ""}
				${c.charges ? `<div class="wz-rv__row"><span>${__("Bank charges")}</span><b>${money(c.charges)}</b></div>` : ""}
				${c.tds ? `<div class="wz-rv__row"><span>${__("TDS")}</span><b>${money(c.tds)}</b></div>` : ""}
				${c.wo ? `<div class="wz-rv__row"><span>${__("Written off")}</span><b>${money(c.wo)}</b></div>` : ""}
				<table><tr><th>${receive ? __("Customer") : __("Supplier")}</th><th>${__("Items")}</th><th class="r">${__("Amount")}</th></tr>${rows}</table>
			</div>
			${many ? `<div class="wz-hint" style="margin-top:8px;">${__("One Payment Entry per {0}, kept together as one Bulk Payment with one receipt. To undo, cancel the Bulk Payment.", [who])}</div>` : ""}
			<label class="wz-ok"><input type="checkbox" class="wz-okbox"> ${__("I have checked the amount, the mode / reference and every {0}", [__("item")])}</label>`);
			pending = x;
			return true;
		};
		// "Review & submit": the parts checked, then a short check window with the tick and Submit
		const finish = () => {
			if (!selected.size) return frappe.msgprint(__("Choose the {0} in part 1.", [who]));
			const m = mode_by_name[d.get_value("mode_of_payment")];
			if (!m) return frappe.msgprint(__("Choose how the money came: Cash, NEFT, UPI… (part 2)."));
			if (!d.get_value("posting_date")) return frappe.msgprint(__("Choose the payment date."));
			if (m.account_type === "Bank" && (!d.get_value("reference_no") || !d.get_value("reference_date")))
				return frappe.msgprint(__("Type the cheque / UTR number and date (part 2)."));
			if (frm) return fill_form();
			if (!review()) return;
			const cd = new frappe.ui.Dialog({
				title: __("Check & submit"),
				size: "large",
				fields: [{ fieldtype: "HTML", fieldname: "b" }],
				primary_action_label: __("Submit payment"),
				primary_action: () => submit(cd),
				secondary_action_label: __("Go back and change"),
				secondary_action: () => cd.hide(),
			});
			cd.$wrapper.addClass("dacs-pay-dialog");
			cd.fields_dict.b.$wrapper.html(`<style>${css}</style>`).append($lay.find(".wz-review").children().clone());
			cd.show();
		};
		const submit = (cd) => {
			if (!pending) return;
			if (!cd.$wrapper.find(".wz-okbox").prop("checked")) { cd.$wrapper.find(".wz-ok").css("border-color", "#e67e22"); return frappe.show_alert({ indicator: "orange", message: __("Tick the box to confirm.") }); }
			const { v, c } = pending;
			cd.get_primary_btn().prop("disabled", true);
			frappe.call({
				method: P + "make_payment",
				args: { data: Object.assign({}, v, { payment_type: receive ? "Receive" : "Pay", company, party: pending.party,
					total_amount: c.total, bank_charges: c.charges, allocations: pending.allocations, from_form: opts.from_form ? 1 : 0 }) },
				freeze: true, freeze_message: __("Making the Payment Entries…"),
			}).then(r => {
				const res = r.message || {};
				cd.hide(); d.hide();
				done(res, c);
				opts.on_done && opts.on_done(res);
			}).catch(() => cd.get_primary_btn().prop("disabled", false));
		};

		// after Submit: a success screen — the big button prints the receipt for the whole amount (Bulk
		// Payment Receipt for several parties, else the Payment Entry's receipt); each entry prints too
		const done = (res, c) => {
			const pes = res.payment_entries || [];
			const link = (dt, n) => `<a href="/app/${frappe.router.slug(dt)}/${encodeURIComponent(n)}" target="_blank">${esc(n)}</a>`;
			const main_url = res.bulk_payment ? dacs_print_url("Bulk Payment", res.bulk_payment) : dacs_print_url("Payment Entry", pes[0]);
			const dd = new frappe.ui.Dialog({ title: receive ? __("Payment received") : __("Payment made"), fields: [{ fieldtype: "HTML", fieldname: "b" }] });
			dd.$wrapper.addClass("dacs-pay-dialog");
			dd.fields_dict.b.$wrapper.html(`<style>${css}</style><div class="dpd">
				<div class="dpd-ic"><i class="fa fa-check"></i></div>
				<h3>${__("Payment saved")}</h3>
				<div class="amt">${money(c.bank)}</div>
				<div class="sub">${[...selected.values()].map(esc).join(", ")}</div>
				<div class="dpd-list">
					${res.bulk_payment ? `<div><span>${__("Bulk Payment")} <b>${link("Bulk Payment", res.bulk_payment)}</b></span><span>${money(c.total)}</span></div>` : ""}
					${pes.map(p => `<div><span>${__("Payment Entry")} <b>${link("Payment Entry", p)}</b></span>
						<button type="button" class="dpd-sm dpd-one" data-pe="${esc(p)}"><i class="fa fa-print"></i> ${__("Print")}</button></div>`).join("")}
				</div>
				<button type="button" class="dpd-print"><i class="fa fa-print"></i> ${__("Print Voucher")}</button>
				<div class="sub" style="margin:10px 0 0;">${__("You can print it again any time from the Payment Entry or Bulk Payment.")}</div>
			</div>`);
			dd.fields_dict.b.$wrapper.on("click", ".dpd-print", () => window.open(main_url, "_blank"));
			dd.fields_dict.b.$wrapper.on("click", ".dpd-one", (e) => window.open(dacs_print_url("Payment Entry", String($(e.currentTarget).data("pe"))), "_blank"));
			dd.set_primary_action(__("Done"), () => dd.hide());
			dd.show();
		};

		// ── start ─────────────────────────────────────────────────────────────────────────
		d.$wrapper.addClass("dacs-pay-dialog");
		d.show();
		paint_mode();
		if (frm && (frm.doc.allocations || []).length) {
			manual = true;
			frm.doc.allocations.forEach(a => {
				if (!a.reference_name) return;
				amt[a.reference_name] = flt(a.allocated_amount);
				if (flt(a.tds_amount)) tds[a.reference_name] = flt(a.tds_amount);
				if (flt(a.write_off_amount)) wo[a.reference_name] = flt(a.write_off_amount);
				if (a.party) selected.set(a.party, a.party_name || a.party);
			});
			if (Object.keys(tds).length || Object.keys(wo).length) d.set_value("show_cuts", 1);
		}
		const begin = () => { total_auto = flt(d.get_value("total_amount")) <= 0; paint_chips(); search(""); load(); };
		if (opts.party) {
			frappe.db.get_value(party_dt, opts.party, receive ? "customer_name" : "supplier_name").then(r => {
				selected.set(opts.party, ((r && r.message) || {})[receive ? "customer_name" : "supplier_name"] || opts.party);
				// opened from one invoice: the amount starts at its outstanding
				if (first && !d.get_value("total_amount") && opts.amount) {
					d.set_value("total_amount", flt(opts.amount));
					begin();
				} else if (first && !d.get_value("total_amount")) {
					frappe.db.get_value(inv_dt, first, "outstanding_amount").then(o => {
						d.set_value("total_amount", flt(((o && o.message) || {}).outstanding_amount));
						begin();
					});
				} else begin();
			});
		} else {
			begin();
		}
	}
};
// earlier name (Bulk Payment form, Order Flow before the merge)
window.dacs_bulk_payment_dialog = window.dacs_payment_dialog;

// Open the prompt for one invoice / bill (Order Flow › Finance rows, the invoice forms).
window.dacs_pay_invoice = function (doctype, name, on_done, opts) {
	const receive = doctype === "Sales Invoice";
	frappe.db.get_value(doctype, name, receive ? "customer" : "supplier").then(r => {
		const party = ((r && r.message) || {})[receive ? "customer" : "supplier"];
		dacs_payment_dialog(Object.assign({ payment_type: receive ? "Receive" : "Pay", party, invoice: name, on_done }, opts || {}));
	});
};
