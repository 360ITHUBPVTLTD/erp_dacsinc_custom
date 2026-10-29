// Every list's filter boxes (ID, name, title, mobile… — the "contains" ones): the words typed match as parts in
// order, anything between — "mo ra" finds "Mohan Madhan Raj" (as Link fields do, search_words.py). One word is
// matched as before. Patches Frappe's filter area once, from our app (docs/list-search.md).
(function () {
	const BL = frappe.views && frappe.views.BaseList;
	if (!BL || BL.prototype.__dacs_words) return;
	BL.prototype.__dacs_words = true;
	const setup = BL.prototype.setup_filter_area;
	BL.prototype.setup_filter_area = function () {
		const out = setup.apply(this, arguments);
		const fa = this.filter_area, proto = fa && Object.getPrototypeOf(fa);
		if (proto && !proto.__dacs_words) {
			proto.__dacs_words = true;
			const get = proto.get_standard_filters;
			proto.get_standard_filters = function () {
				return get.apply(this, arguments).map(f => {
					if (f[2] === "like" && typeof f[3] === "string" && /\S\s+\S/.test(f[3].trim())) {
						f = f.slice();
						f[3] = f[3].replace(/\s+/g, "%");
					}
					return f;
				});
			};
		}
		return out;
	};
})();
