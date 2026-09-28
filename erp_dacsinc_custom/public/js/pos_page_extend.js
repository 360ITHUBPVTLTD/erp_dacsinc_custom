// Point of Sale page additions (page_js in hooks.py; ERPNext's own files are untouched):
// 1. Walk-in details under the customer — Walk-in Name and Mobile, saved on the POS
//    Invoice (custom_walkin_name / custom_walkin_mobile, pos_walkin.py). Stores bill on
//    one fixed customer; these say who bought, and Recent Orders can search by them.
// 2. A loading indicator while the item list loads or searches.
// 3. Item search also by barcode (Item › Barcodes), see pos_brand_filter.get_items.
(function () {
	const page = frappe.pages["point-of-sale"];
	if (!page || page.__dacs_extended) return;
	page.__dacs_extended = true;
	const original_on_page_load = page.on_page_load;

	page.on_page_load = function (wrapper) {
		// Patch the Point of Sale classes before the screen is built with them.
		frappe.require("point-of-sale.bundle.js", () => {
			dacs_patch_pos();
			original_on_page_load(wrapper);
		});
	};

	function dacs_patch_pos() {
		const PS = erpnext.PointOfSale;
		if (!PS || PS.__dacs_patched) return;
		PS.__dacs_patched = true;
		dacs_style();

		// ---------------- walk-in details (ItemCart)
		const Cart = PS.ItemCart.prototype;
		const orig_init_customer = Cart.init_customer_selector;
		Cart.init_customer_selector = function () {
			orig_init_customer.apply(this, arguments);
			this.dacs_make_walkin();
		};

		Cart.dacs_make_walkin = function () {
			this.$customer_section.after(`<div class="dacs-walkin">
				<div class="dacs-walkin-title">${__("Walk-in customer")}</div>
				<div class="dacs-walkin-fields"><div class="dacs-wn"></div><div class="dacs-wm"></div></div>
			</div>`);
			this.$walkin = this.$component.find(".dacs-walkin");
			const make = (sel, fieldname, label, placeholder, options) => frappe.ui.form.make_control({
				df: {
					fieldtype: "Data", fieldname, label, placeholder, options,
					onchange: () => this.dacs_set_walkin(fieldname),
				},
				parent: this.$walkin.find(sel),
				render_input: true,
			});
			this.walkin_name = make(".dacs-wn", "custom_walkin_name", __("Name"), __("Buyer's name"));
			this.walkin_mobile = make(".dacs-wm", "custom_walkin_mobile", __("Mobile No"), __("Mobile number"), "Phone");
		};

		Cart.dacs_set_walkin = function (fieldname) {
			const frm = this.events.get_frm();
			if (!frm || !frm.doc || frm.doc.docstatus !== 0) return;
			const ctrl = fieldname === "custom_walkin_name" ? this.walkin_name : this.walkin_mobile;
			let value = (ctrl.get_value() || "").trim();
			if (fieldname === "custom_walkin_mobile") value = value.replace(/[^\d+]/g, "");
			if ((frm.doc[fieldname] || "") !== value) frappe.model.set_value(frm.doctype, frm.docname, fieldname, value);
			if ((ctrl.get_value() || "") !== value) ctrl.set_value(value);  // show what is saved
		};

		Cart.dacs_refresh_walkin = function () {
			const frm = this.events.get_frm();
			if (!this.walkin_name || !frm || !frm.doc) return;
			const locked = frm.doc.docstatus !== 0;
			[["custom_walkin_name", this.walkin_name], ["custom_walkin_mobile", this.walkin_mobile]].forEach(([f, c]) => {
				c.set_value(frm.doc[f] || "");
				c.$input && c.$input.prop("readonly", locked);
			});
		};

		const orig_load_invoice = Cart.load_invoice;
		Cart.load_invoice = function () {
			const out = orig_load_invoice.apply(this, arguments);
			this.dacs_refresh_walkin();
			return out;
		};

		// ---------------- loading indicator (ItemSelector)
		const Sel = PS.ItemSelector.prototype;
		const orig_get_items = Sel.get_items;
		Sel.get_items = function () {
			this.dacs_loading(true);
			const call = orig_get_items.apply(this, arguments);
			const done = () => this.dacs_loading(false);
			if (call && call.always) call.always(done);
			else if (call && call.finally) call.finally(done);
			else done();
			return call;
		};

		const orig_render = Sel.render_item_list;
		Sel.render_item_list = function (items) {
			const out = orig_render.apply(this, arguments);
			this.dacs_loading(false);
			if (!items || !items.length) {
				this.$items_container && this.$items_container.html(
					`<div class="dacs-pos-empty">${__("No items found")}</div>`);
			}
			return out;
		};

		// Search also by barcode (Item › Barcodes; the server sends them as `barcodes`).
		// Same order as the screen's own search: loaded items first, then the server.
		// An exact barcode (e.g. a scan) shows just that item, so auto-add still works.
		Sel.filter_items = function ({ search_term = "" } = {}) {
			const term = search_term.toLowerCase().trim();
			if (!term) {
				this.render_item_list(this.all_items || []);
				return;
			}
			const tokens = term.split(/\s+/).filter(Boolean);
			if (this.all_items) {
				const exact = this.all_items.filter(it => (it.barcodes || []).concat(it.barcode || [])
					.some(b => String(b).toLowerCase() === term));
				if (exact.length) {
					this.items = exact;
					this.render_item_list(exact);
					this.perform_auto_add_logic && this.perform_auto_add_logic();
					return;
				}
				const scored = this.all_items.reduce((acc, item) => {
					const codes = (item.barcodes || []).concat(item.barcode || []).join(" ");
					const pool = `${item.item_code} ${item.item_name} ${codes}`.toLowerCase();
					if (tokens.every(t => pool.includes(t))) {
						let score = 0;
						const code = item.item_code.toLowerCase();
						if (code === term) score += 2000;
						else if (code.startsWith(term)) score += 1000;
						if (item.item_name.toLowerCase().includes(term)) score += 500;
						if (codes.toLowerCase().includes(term)) score += 300;
						acc.push({ item, score });
					}
					return acc;
				}, []);
				if (scored.length > 0) {
					scored.sort((a, b) => b.score - a.score);
					this.items = scored.map(s => s.item);
					this.render_item_list(this.items);
					this.perform_auto_add_logic && this.perform_auto_add_logic();
					return;
				}
			}
			this.get_items({ search_term: term }).then(({ message }) => {
				this.render_item_list((message && message.items) || []);
				this.perform_auto_add_logic && this.perform_auto_add_logic();
			});
		};

		Sel.dacs_loading = function (on) {
			const $c = this.$items_container;
			if (!$c) return;
			this.__dacs_pending = Math.max(0, (this.__dacs_pending || 0) + (on ? 1 : -1));
			$c.parent().find(".dacs-pos-loading").remove();
			if (this.__dacs_pending > 0) {
				$c.before(`<div class="dacs-pos-loading"><span class="dacs-spinner"></span>${__("Loading items…")}</div>`);
			}
		};
	}

	function dacs_style() {
		if (document.getElementById("dacs-pos-style")) return;
		const css = document.createElement("style");
		css.id = "dacs-pos-style";
		css.textContent = `
			/* same card as the customer / cart cards (.pos-card) */
			.point-of-sale-app .customer-cart-container > .dacs-walkin { background-color: var(--fg-color);
				box-shadow: var(--shadow-base); border-radius: var(--border-radius-md);
				padding: var(--padding-md) var(--padding-lg); margin-top: var(--margin-md); flex-shrink: 0; }
			.point-of-sale-app .dacs-walkin-title { font-weight: 700; font-size: var(--text-md); color: var(--text-color);
				margin-bottom: var(--margin-sm); }
			.point-of-sale-app .dacs-walkin-fields { display: grid; grid-template-columns: 1fr 1fr; gap: var(--margin-md); }
			.point-of-sale-app .dacs-walkin .frappe-control { margin-bottom: 0; }
			.point-of-sale-app .dacs-walkin .control-label { font-size: var(--text-sm); color: var(--text-muted); margin-bottom: 4px; }
			.point-of-sale-app .dacs-walkin input { height: 34px; }
			.point-of-sale-app .dacs-pos-loading { display: flex; align-items: center; justify-content: center; gap: 10px;
				padding: 24px; color: var(--text-muted); font-size: var(--text-md); }
			.point-of-sale-app .dacs-spinner { width: 20px; height: 20px; border-radius: 50%; border: 3px solid var(--gray-300);
				border-top-color: var(--primary); animation: dacs-spin .8s linear infinite; }
			.point-of-sale-app .dacs-pos-empty { padding: 32px; text-align: center; color: var(--text-muted); width: 100%; grid-column: 1 / -1; }
			@keyframes dacs-spin { to { transform: rotate(360deg); } }`;
		document.head.appendChild(css);
	}
})();
