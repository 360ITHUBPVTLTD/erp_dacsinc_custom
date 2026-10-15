// Form-side check for public/js/overall_discount.js (keep in step with test_overall_discount.py).
// Runs the script against a minimal stand-in of erpnext.taxes_and_totals; same figures as the Python test.
//   usage (from the app folder):  node scripts/test_overall_discount_js.js
const fs = require("fs");
const round2 = (v) => Math.round((+v + Number.EPSILON) * 100) / 100;
global.flt = (v, p) => (p === undefined ? +v || 0 : round2(+v || 0));
global.precision = () => 2;
global.__ = (s) => s;
global.frappe = { scrub: (s) => s.toLowerCase().replace(/ /g, "_"), throw: (m) => { throw new Error(m); } };
global.window = global; global.$ = () => ({ ready: () => {} });
// minimal stand-in of erpnext.taxes_and_totals (On Net Total taxes + item tax templates)
class TT {
  constructor(doc) { this.frm = { doc, _items: doc.items }; }
  set_in_company_currency() {}
  calc_items() { this.frm._items.forEach((i) => { i.net_amount = i.qty * i.rate; i.net_rate = i.rate; }); }
  _calculate_taxes_and_totals() {
    const d = this.frm.doc; d.net_total = round2(d.items.reduce((s, i) => s + i.net_amount, 0));
    d.taxes.forEach((t) => { t.tax_amount = round2(d.items.reduce((s, i) => { const m = JSON.parse(i.item_tax_rate); return s + i.net_amount * (t.account_head in m ? m[t.account_head] : t.rate) / 100; }, 0)); });
    d.total_taxes_and_charges = round2(d.taxes.reduce((s, t) => s + t.tax_amount, 0)); d.grand_total = round2(d.net_total + d.total_taxes_and_charges);
  }
  get_total_for_discount_amount() { const d = this.frm.doc; return d.apply_discount_on == "Net Total" ? d.net_total : d.grand_total; }
  set_discount_amount() { const d = this.frm.doc; if (d.additional_discount_percentage) d.discount_amount = flt(flt(d[frappe.scrub(d.apply_discount_on)]) * d.additional_discount_percentage / 100, 2); }
  apply_discount_amount() { // ERPNext original (no exclusion)
    const d = this.frm.doc, total = this.get_total_for_discount_amount();
    this.frm._items.forEach((i) => { i.net_amount = flt(i.net_amount - d.discount_amount * i.net_amount / total, 2); });
    this._calculate_taxes_and_totals();
  }
  run() { this.calc_items(); this._calculate_taxes_and_totals(); this.set_discount_amount(); this.apply_discount_amount(); return this.frm.doc; }
}
global.erpnext = { taxes_and_totals: TT };
eval(fs.readFileSync(process.argv[2] || require("path").join(__dirname, "../erp_dacsinc_custom/public/js/overall_discount.js"), "utf8"));
const g5 = JSON.stringify({ "Output Tax SGST - IND": 2.5, "Output Tax CGST - IND": 2.5 }), g18 = JSON.stringify({ "Output Tax SGST - IND": 9, "Output Tax CGST - IND": 9 });
function doc(on, pct, amt, ex) { return { doctype: "Sales Invoice", apply_discount_on: on, additional_discount_percentage: pct, discount_amount: amt, conversion_rate: 1,
  taxes: [{ charge_type: "On Net Total", account_head: "Output Tax SGST - IND", rate: 0 }, { charge_type: "On Net Total", account_head: "Output Tax CGST - IND", rate: 0 }],
  items: [{ qty: 5, rate: 225, item_tax_rate: g5 }, { qty: 5, rate: 475, item_tax_rate: g5 }, { qty: 1, rate: 200, item_tax_rate: g18, custom_exclude_from_overall_discount: ex ? 1 : 0 }] }; }
const cases = [["10% Net", "Net Total", 10, 0, 1, 350, 3543.5], ["10% Grand", "Grand Total", 10, 0, 1, 367.5, 3543.5], ["100 Net", "Net Total", 0, 100, 1, 100, 3806]];
let ok = true;
for (const [n, on, pct, amt, ex, wantDisc, wantGrand] of cases) {
  const d = new TT(doc(on, pct, amt, ex)).run();
  const pass = Math.abs(d.discount_amount - wantDisc) < 0.01 && d.items[2].net_amount === 200 && Math.abs(d.grand_total - wantGrand) < 0.06;
  ok = ok && pass; console.log(n.padEnd(10), "disc", d.discount_amount, "grand", d.grand_total, "freight", d.items[2].net_amount, pass ? "OK" : "FAIL");
}
const c = new TT(doc("Grand Total", 10, 0, 0)).run(); console.log("control   freight", c.items[2].net_amount, "(discounted, standard behaviour)");
console.log(ok ? "JS MATCHES SERVER" : "MISMATCH"); process.exit(ok ? 0 : 1);
