// Point of Sale page additions (page_js in hooks.py; ERPNext's own files are untouched):
// 1. Walk-in details under the customer — Walk-in Name and Mobile, saved on the POS
//    Invoice (custom_walkin_name / custom_walkin_mobile, pos_walkin.py). Stores bill on
//    one fixed customer; these say who bought, and Recent Orders can search by them.
// 2. A loading indicator while the item list loads or searches.
// 3. Item search also by barcode (Item › Barcodes), see pos_brand_filter.get_items.
// 4. Checkout totals: "Balance to Pay" / "Change to Return" instead of ERPNext's
//    "Change Amount" showing the amount still owed.
// 5. Email Receipt from the store's own email account, with its default message
//    (POS Profile › Receipt Email), see pos_receipt_email.py.
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
			dacs_fit_height();
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
			// One compact row, so the Item Cart keeps its height for the items.
			this.$customer_section.after(`<div class="dacs-walkin">
				<div class="dacs-walkin-title">${__("Walk-in")}</div>
				<div class="dacs-wn"></div><div class="dacs-wm"></div>
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
			this.walkin_name = make(".dacs-wn", "custom_walkin_name", __("Name"), __("Customer name"));
			this.walkin_mobile = make(".dacs-wm", "custom_walkin_mobile", __("Mobile No"), __("Mobile no"), "Phone");
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

		// ---------------- checkout totals (Payment): ERPNext shows the amount still to pay
		// under "Change Amount" (paid ₹1 of ₹199 read "Change Amount ₹198"). The third
		// box now says what it is: Balance to Pay (still owed), Change to Return (paid
		// more than the total, cash back) or Change Amount ₹0 (paid exactly).
		const Pay = PS.Payment.prototype;
		Pay.update_totals_section = function (doc) {
			if (!doc) doc = this.events.get_frm().doc;
			if (!this.$totals.is(":visible")) return;
			const currency = doc.currency;
			const grand_total = cint(frappe.sys_defaults.disable_rounded_total) ? doc.grand_total : doc.rounded_total || doc.grand_total;
			const paid = flt(doc.paid_amount);
			const remaining = flt(grand_total - paid, precision("grand_total", doc));
			let label, value, color;
			if (remaining > 0) { label = __("Balance to Pay"); value = remaining; color = "var(--orange-600, #c2410c)"; }
			else if (remaining < 0) { label = __("Change to Return"); value = -remaining; color = "var(--green-600, #15803d)"; }
			else { label = __("Change Amount"); value = 0; color = ""; }
			this.$totals.html(
				`<div class="col">
					<div class="total-label">${__("Grand Total")}</div>
					<div class="value">${format_currency(grand_total, currency)}</div>
				</div>
				<div class="seperator-y"></div>
				<div class="col">
					<div class="total-label">${__("Paid Amount")}</div>
					<div class="value">${format_currency(paid, currency)}</div>
				</div>
				<div class="seperator-y"></div>
				<div class="col dacs-balance">
					<div class="total-label" ${color ? `style="color:${color}"` : ""}>${label}</div>
					<div class="value" ${color ? `style="color:${color}"` : ""}>${format_currency(value, currency)}</div>
				</div>`
			);
		};

		// ---------------- Email Receipt (PastOrderSummary), pos_receipt_email.py: sent from
		// the store's own account (POS Profile › Receipt Email Account; refused without
		// one), the message box starts with POS Profile › Receipt Email Message, and the
		// customer gets a proper receipt mail with the invoice PDF.
		const Sum = PS.PastOrderSummary.prototype;
		const orig_init_email = Sum.init_email_print_dialog;
		Sum.init_email_print_dialog = function () {
			orig_init_email.call(this);
			const dlg = this.email_dialog, me = this;
			dlg.set_primary_action(__("Send"), () => me.send_email());
			const orig_show = dlg.show.bind(dlg);
			dlg.show = function () {
				const doc = me.doc || (me.events.get_frm() || {}).doc;
				dlg.set_value("content", "");
				dlg.$wrapper.find(".dacs-mail-warn").remove();
				orig_show();
				if (!doc || !doc.name) return;
				frappe.call({ method: "erp_dacsinc_custom.pos_receipt_email.get_receipt_defaults", args: { invoice: doc.name } })
					.then(({ message: d }) => {
						if (!d) return;
						if (d.message && !dlg.get_value("content")) dlg.set_value("content", d.message);
						if (d.last_email && !dlg.get_value("email_id")) dlg.set_value("email_id", d.last_email);
						if (!d.account_set) {
							$(`<div class="dacs-mail-warn alert alert-warning" style="margin:0 0 10px;font-size:var(--text-sm);">
								${__("No email account is set for this store. Ask an admin to choose one in POS Profile {0} › Receipt Email Account.", [frappe.utils.escape_html(d.pos_profile)])}
							</div>`).prependTo(dlg.$wrapper.find(".modal-body"));
						}
					});
			};
		};
		Sum.send_email = function () {
			const dlg = this.email_dialog, values = dlg.get_values();
			if (!values || dlg.__dacs_sending) return;
			const doc = this.doc || this.events.get_frm().doc;
			// One send per click: the button waits for the answer, and the box closes as soon
			// as the receipt is accepted (the mail itself goes out in the background).
			dlg.__dacs_sending = true;
			const btn = dlg.get_primary_btn().prop("disabled", true).text(__("Sending…"));
			const done = () => { dlg.__dacs_sending = false; btn.prop("disabled", false).text(__("Send")); };
			frappe.call({
				method: "erp_dacsinc_custom.pos_receipt_email.send_receipt",
				args: { invoice: doc.name, recipients: values.email_id, message: values.content || "" },
			}).then((r) => {
				done();
				if (!r || r.exc || !r.message) return;
				dlg.hide();
				frappe.show_alert({ message: __("Receipt is on its way to {0}.", [frappe.utils.escape_html(r.message.sent_to.join(", "))]), indicator: "green" });
				try { frappe.utils.play_sound("email"); } catch (e) { /* sound is optional */ }
			}, done);
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

	// Every Point of Sale column is exactly as tall as the space left below the header
	// (whatever the screen, and again when a banner is closed or the window resized),
	// so nothing is pushed off the bottom; each part scrolls inside itself instead.
	function dacs_fit_height() {
		const fit = () => {
			const app = document.querySelector(".point-of-sale-app");
			if (!app || !app.offsetParent) return;
			const top = app.getBoundingClientRect().top + window.scrollY;
			const h = Math.max(420, Math.floor(window.innerHeight - top - 12));
			document.documentElement.style.setProperty("--dacs-pos-h", h + "px");
		};
		fit();
		window.addEventListener("resize", fit);
		if (window.ResizeObserver) new ResizeObserver(fit).observe(document.body);
		setTimeout(fit, 800);
		setTimeout(fit, 2500);
	}

	function dacs_style() {
		if (document.getElementById("dacs-pos-style")) return;
		const css = document.createElement("style");
		css.id = "dacs-pos-style";
		css.textContent = `
			/* same card as the customer / cart cards (.pos-card), kept to one row */
			.point-of-sale-app .customer-cart-container > .dacs-walkin { background-color: var(--fg-color);
				box-shadow: var(--shadow-base); border-radius: var(--border-radius-md); flex-shrink: 0;
				padding: var(--padding-sm) var(--padding-lg); margin-top: var(--margin-sm);
				display: grid; grid-template-columns: auto minmax(0, 1fr) minmax(0, 1fr); gap: var(--margin-sm); align-items: center; }
			.point-of-sale-app .dacs-walkin-title { font-weight: 600; font-size: var(--text-sm); color: var(--text-muted); white-space: nowrap; }
			.point-of-sale-app .dacs-walkin .frappe-control, .point-of-sale-app .dacs-walkin .form-group { margin: 0; }
			.point-of-sale-app .dacs-walkin .control-label, .point-of-sale-app .dacs-walkin .help-box { display: none; }
			.point-of-sale-app .dacs-walkin input { height: 30px; font-size: var(--text-sm); }
			.point-of-sale-app .customer-cart-container > .dacs-walkin + .cart-container { margin-top: var(--margin-sm); }
			@media (max-width: 1199px) {
				.point-of-sale-app .customer-cart-container > .dacs-walkin { grid-template-columns: minmax(0, 1fr) minmax(0, 1fr); }
				.point-of-sale-app .dacs-walkin-title { grid-column: 1 / -1; }
			}
			.point-of-sale-app .dacs-pos-loading { display: flex; align-items: center; justify-content: center; gap: 10px;
				padding: 24px; color: var(--text-muted); font-size: var(--text-md); }
			.point-of-sale-app .dacs-spinner { width: 20px; height: 20px; border-radius: 50%; border: 3px solid var(--gray-300);
				border-top-color: var(--primary); animation: dacs-spin .8s linear infinite; }
			.point-of-sale-app .dacs-pos-empty { padding: 32px; text-align: center; color: var(--text-muted); width: 100%; grid-column: 1 / -1; }
			@keyframes dacs-spin { to { transform: rotate(360deg); } }

			/* ================= layout =================
			   Columns are exactly as tall as the space below the header (--dacs-pos-h,
			   dacs_fit_height); each part scrolls inside itself, so nothing is cut off. */
			.point-of-sale-app { padding-top: 2px; padding-bottom: 0; }
			.point-of-sale-app > section { height: var(--dacs-pos-h, calc(100vh - 12rem)) !important; min-height: 440px !important; }

			/* --- cart column: customer + walk-in keep their size, the cart gets the rest */
			.point-of-sale-app > .customer-cart-container { overflow: hidden; padding: 2px 3px 3px; }
			.point-of-sale-app > .customer-cart-container > .customer-section { flex-shrink: 0; padding: var(--padding-sm) var(--padding-lg) !important; }
			.point-of-sale-app > .customer-cart-container > .cart-container { height: auto !important; flex: 1 1 0; min-height: 0;
				margin-top: var(--margin-sm) !important; }
			.point-of-sale-app .abs-cart-container { padding: var(--padding-sm) var(--padding-lg) var(--padding-md) !important; }
			.point-of-sale-app .abs-cart-container > .cart-label { padding-bottom: var(--padding-xs) !important; }
			.point-of-sale-app .abs-cart-container > .cart-header { padding-bottom: var(--padding-xs) !important; font-size: var(--text-sm) !important; }
			.point-of-sale-app .abs-cart-container > .cart-items-section { flex: 1 1 0 !important; min-height: 120px; overflow-y: auto !important; }
			.point-of-sale-app .abs-cart-container > .cart-totals-section { flex-shrink: 0; padding-top: var(--padding-xs) !important; }
			.point-of-sale-app .cart-totals-section > .add-discount-wrapper { padding: 5px var(--padding-sm) !important; margin-bottom: 4px !important; }
			.point-of-sale-app .cart-totals-section > .item-qty-total-container,
			.point-of-sale-app .cart-totals-section > .net-total-container { padding: 2px 0 !important; font-size: var(--text-sm) !important; }
			.point-of-sale-app .cart-totals-section > .taxes-container { padding: 0 !important; }
			.point-of-sale-app .cart-totals-section .tax-row { padding: 1px 0 !important; font-size: var(--text-sm) !important; line-height: 1.5 !important; }
			.point-of-sale-app .cart-totals-section > .grand-total-container { padding: 4px 0 !important; }
			.point-of-sale-app .cart-totals-section > .checkout-btn,
			.point-of-sale-app .cart-totals-section > .edit-cart-btn { padding: 8px !important; margin-top: 6px !important; }

			/* --- checkout: modes, then fields + number pad (flexes), then totals + button */
			.point-of-sale-app > .payment-container { overflow: hidden !important; min-height: 0; }
			.point-of-sale-app > .payment-container > .section-label { margin-bottom: var(--margin-sm) !important; flex-shrink: 0; }
			.point-of-sale-app > .payment-container > .payment-modes { flex-shrink: 0; }
			.point-of-sale-app > .payment-container > .fields-numpad-container { height: auto !important; flex: 1 1 0 !important; min-height: 0 !important; overflow: hidden; }
			.point-of-sale-app > .payment-container > .fields-numpad-container > .fields-section { height: auto !important; min-height: 0; overflow: hidden; }
			.point-of-sale-app > .payment-container .invoice-fields { height: auto !important; flex: 1 1 0; min-height: 0; overflow-y: auto !important; }
			.point-of-sale-app > .payment-container > .fields-numpad-container > .number-pad { min-height: 0; overflow: hidden; }
			.point-of-sale-app > .payment-container .numpad-btn { height: auto !important; min-height: 38px; }
			.point-of-sale-app > .payment-container > .totals-section { flex-shrink: 0; }
			.point-of-sale-app > .payment-container > .submit-order-btn { flex-shrink: 0; position: static; }

			/* --- item edit mode (a cart item clicked): compact number pad in the cart, Item Details scrolls */
			.point-of-sale-app .abs-cart-container > .numpad-section { flex-shrink: 0; margin-top: 4px !important; padding: 4px var(--padding-xs) 0 !important; }
			.point-of-sale-app .numpad-section > .numpad-totals { margin-bottom: 6px !important; font-size: var(--text-sm) !important; }
			.point-of-sale-app .numpad-section > .numpad-container { gap: 6px !important; margin-bottom: 6px !important; }
			.point-of-sale-app .numpad-section > .numpad-container > .numpad-btn { padding: 4px !important; min-height: 34px; }
			.point-of-sale-app .numpad-section > .checkout-btn { padding: 8px !important; margin-bottom: 4px !important; }
			.point-of-sale-app > .item-details-container { overflow-y: auto !important; }
			.point-of-sale-app > .item-details-container > * { flex-shrink: 0; }

			/* --- recent orders + order summary: scroll inside, buttons stay at the bottom */
			.point-of-sale-app > .past-order-list > .invoices-container { overflow-y: auto !important; min-height: 0; }
			.point-of-sale-app > .past-order-summary { overflow: hidden; }
			.point-of-sale-app > .past-order-summary .abs-container { overflow-y: auto !important; }
			/* cards keep their full height (no squeeze-and-overlap); the whole summary scrolls */
			.point-of-sale-app > .past-order-summary .abs-container > * { flex-shrink: 0 !important; }
			.point-of-sale-app > .past-order-summary .summary-btns { position: static; padding: var(--padding-sm) 0; }
			/* order summary: full item names (wrap, never cut with "…"), qty and amount beside them */
			.point-of-sale-app > .past-order-summary .item-row-wrapper { align-items: flex-start !important; gap: var(--margin-sm); }
			.point-of-sale-app > .past-order-summary .item-row-wrapper > .item-name { white-space: normal !important; overflow: visible !important;
				text-overflow: clip !important; overflow-wrap: anywhere; line-height: 1.35; }
			.point-of-sale-app > .past-order-summary .item-row-wrapper > .item-qty,
			.point-of-sale-app > .past-order-summary .item-row-wrapper > .item-rate-disc { white-space: nowrap; flex-shrink: 0; }
			/* "Additional Information" only when the POS Profile adds fields to it */
			.point-of-sale-app > .payment-container .fields-section:has(.invoice-fields:empty) { display: none !important; }

			/* --- shorter screens (laptops): compact, so at least 5 cart items show */
			@media (max-height: 820px) {
				.point-of-sale-app .customer-display .customer-image { width: 2.25rem !important; height: 2.25rem !important; margin-right: var(--margin-sm) !important; }
				.point-of-sale-app .customer-display .customer-abbr { font-size: var(--text-lg) !important; }
				.point-of-sale-app .customer-display .customer-name { font-size: var(--text-md) !important; }
				.point-of-sale-app .customer-display .customer-desc { font-size: var(--text-xs) !important; }
				.point-of-sale-app .abs-cart-container > .cart-label { display: none !important; }
				.point-of-sale-app .abs-cart-container { padding-top: var(--padding-sm) !important; }
				.point-of-sale-app .abs-cart-container > .cart-items-section { min-height: 170px; }
				.point-of-sale-app .cart-items-section > .cart-item-wrapper { padding: 3px var(--padding-sm) !important; }
				.point-of-sale-app .cart-item-wrapper > .item-image { width: 1.6rem !important; height: 1.6rem !important; margin-right: var(--margin-sm) !important; }
				.point-of-sale-app .cart-item-wrapper > .item-image .item-abbr { font-size: var(--text-sm) !important; }
				.point-of-sale-app .cart-item-wrapper .item-name { font-size: var(--text-sm) !important; }
				.point-of-sale-app .cart-item-wrapper .item-desc { display: none !important; }
				/* item edit mode: pad buttons slimmer; totals line + Checkout share one row under the pad */
				.point-of-sale-app .abs-cart-container > .numpad-section[style*="flex"] { display: grid !important; grid-template-columns: minmax(0, 1fr) auto; column-gap: var(--margin-sm); align-items: center; }
				.point-of-sale-app .numpad-section > .numpad-container { grid-column: 1 / -1; grid-row: 1; }
				.point-of-sale-app .numpad-section > .numpad-totals { grid-row: 2; margin: 0 0 4px !important; font-size: var(--text-xs) !important; gap: var(--margin-sm); flex-wrap: wrap; }
				.point-of-sale-app .numpad-section > .checkout-btn { grid-row: 2; padding: 6px var(--padding-lg) !important; }
				.point-of-sale-app .numpad-section > .numpad-container { gap: 4px !important; margin-bottom: 4px !important; }
				.point-of-sale-app .numpad-section > .numpad-container > .numpad-btn { min-height: 26px; height: 26px; padding: 0 2px !important; }
				.point-of-sale-app .numpad-totals > .numpad-item-qty-total, .point-of-sale-app .numpad-totals > .numpad-net-total { display: none; }
				.point-of-sale-app .numpad-totals > .numpad-grand-total { font-size: var(--text-md); }
				.point-of-sale-app .cart-item-wrapper .item-amount, .point-of-sale-app .cart-item-wrapper .item-qty { font-size: var(--text-sm) !important; }
				/* the ":not" keeps ERPNext's inline display:none (item edit mode shows the number pad instead) */
				.point-of-sale-app .abs-cart-container > .cart-totals-section:not([style*="none"]) { display: grid !important; grid-template-columns: 1fr 1fr; column-gap: var(--margin-lg); }
				.point-of-sale-app .cart-totals-section > .add-discount-wrapper,
				.point-of-sale-app .cart-totals-section > .grand-total-container,
				.point-of-sale-app .cart-totals-section > .checkout-btn,
				.point-of-sale-app .cart-totals-section > .edit-cart-btn,
				.point-of-sale-app .cart-totals-section > .taxes-container { grid-column: 1 / -1; }
				.point-of-sale-app .cart-totals-section > .taxes-container { display: grid !important; grid-template-columns: 1fr 1fr; column-gap: var(--margin-lg); }
				.point-of-sale-app .cart-totals-section > .taxes-container:empty { display: none !important; }
				.point-of-sale-app .cart-totals-section > .grand-total-container { font-size: var(--text-lg) !important; }
				/* checkout */
				.point-of-sale-app > .payment-container { padding: var(--padding-md) var(--padding-lg) !important; }
				.point-of-sale-app > .payment-container .mode-of-payment { padding: var(--padding-sm) var(--padding-md) !important; }
				.point-of-sale-app > .payment-container .numpad-container { gap: 6px !important; row-gap: 6px !important; }
				.point-of-sale-app > .payment-container .numpad-btn { min-height: 30px; padding: 2px 4px !important; margin: 0 !important; }
				.point-of-sale-app > .payment-container .payment-modes { margin-bottom: 4px !important; padding-bottom: 4px !important; }
				.point-of-sale-app > .payment-container .fields-section .section-label { margin-bottom: 4px !important; }
				.point-of-sale-app > .payment-container > .totals-section { margin: var(--margin-sm) 0 !important; }
				.point-of-sale-app > .payment-container > .totals-section .totals { padding: var(--padding-sm) !important; }
				.point-of-sale-app > .payment-container > .totals-section .value { font-size: var(--text-xl) !important; }
			}

			/* --- payment modes: a wrapping grid, never a sideways-scrolling row; every mode is
			   visible, the amount stays inside its card, and the selected mode takes a full row
			   for its amount box and cash shortcuts */
			.point-of-sale-app > .payment-container > .payment-modes { display: grid !important;
				grid-template-columns: repeat(auto-fill, minmax(min(100%, 210px), 1fr)); gap: var(--margin-sm);
				overflow-x: hidden !important; overflow-y: auto !important; max-height: 46%; align-items: start;
				padding: 2px 2px var(--padding-sm) !important; margin-bottom: var(--margin-sm) !important; }
			.point-of-sale-app > .payment-container .payment-mode-wrapper { min-width: 0 !important; max-width: none !important; padding: 0 !important; }
			.point-of-sale-app > .payment-container .payment-mode-wrapper:has(> .mode-of-payment.border-primary) { grid-column: 1 / -1; }
			.point-of-sale-app > .payment-container .mode-of-payment { display: flex; flex-wrap: wrap; align-items: center;
				column-gap: var(--margin-sm); row-gap: 6px; min-height: 46px; width: 100%; margin: 0 !important; line-height: 1.3; }
			.point-of-sale-app > .payment-container .mode-of-payment > .pay-amount,
			.point-of-sale-app > .payment-container .mode-of-payment > .loyalty-amount-name { float: none !important; margin-left: auto; white-space: nowrap; }
			.point-of-sale-app > .payment-container .mode-of-payment > .mode-of-payment-control,
			.point-of-sale-app > .payment-container .mode-of-payment > .cash-shortcuts { flex: 1 1 100%; margin: 0 !important; }
			.point-of-sale-app > .payment-container .mode-of-payment > .mode-of-payment-control .form-group { margin-bottom: 0; }
			/* number pad: a proper keypad at the right, next to the totals */
			.point-of-sale-app > .payment-container > .fields-numpad-container > .number-pad { flex: 0 0 auto !important;
				width: min(340px, 100%); max-width: none !important; margin-left: auto; }
			.point-of-sale-app > .payment-container .number-pad .numpad-container { width: 100%; gap: 8px !important; margin-bottom: var(--margin-sm) !important; }
			.point-of-sale-app > .payment-container .number-pad .numpad-btn { min-height: 44px; font-size: var(--text-lg); font-weight: 500; }
			@media (max-height: 820px) {
				.point-of-sale-app > .payment-container .number-pad .numpad-btn { min-height: 36px; font-size: var(--text-md); }
				.point-of-sale-app > .items-selector .item-wrapper .item-display { height: 6.5rem !important; min-height: 6.5rem !important; }
			}

			/* --- tablets: items on top, cart below; the page scrolls normally */
			@media (max-width: 991px) {
				/* doubled class: beats ERPNext's own "!important" column spans */
				.point-of-sale-app.point-of-sale-app { grid-template-columns: minmax(0, 1fr) !important; }
				.point-of-sale-app.point-of-sale-app > section { grid-column: 1 / -1 !important; }
				.point-of-sale-app > .items-selector, .point-of-sale-app > .past-order-list { height: 60vh !important; min-height: 380px !important; }
				.point-of-sale-app > .customer-cart-container, .point-of-sale-app > .payment-container,
				.point-of-sale-app > .past-order-summary, .point-of-sale-app > .item-details-container { height: auto !important; min-height: 0 !important; }
				/* the cart card grows with its content (checkout totals + Edit Cart are never cut) */
				.point-of-sale-app > .customer-cart-container > .cart-container { flex: none; min-height: 0; }
				.point-of-sale-app .cart-container > .abs-cart-container { position: static !important; height: auto !important; }
				.point-of-sale-app .abs-cart-container > .cart-items-section { min-height: 290px !important; }
				.point-of-sale-app > .payment-container > .fields-numpad-container { flex: none !important; }
				.point-of-sale-app > .payment-container .invoice-fields { max-height: 220px; flex: none; }
				.point-of-sale-app > .past-order-summary .abs-container { position: static !important; }
				/* smaller item cards: 3-4 per row instead of 2 big ones */
				.point-of-sale-app > .items-selector > .items-container { grid-template-columns: repeat(auto-fill, minmax(150px, 1fr)) !important; }
				.point-of-sale-app > .items-selector .item-wrapper .item-display { height: 5.5rem !important; min-height: 5.5rem !important; }
			}
			/* --- phones: one payment mode per row, smaller amounts */
			@media (max-width: 620px) {
				/* page title in full ("Point of Sale"), the store name below it if needed */
				[data-page-route="point-of-sale"] .page-head .title-text { max-width: none !important; overflow: visible !important; white-space: nowrap; }
				[data-page-route="point-of-sale"] .page-head .page-title { flex-wrap: wrap; row-gap: 2px; }
				/* item search: heading on its own row, then search and group side by side at full width */
				.point-of-sale-app > .items-selector > .filter-section { padding: var(--padding-md) !important; row-gap: 6px; }
				.point-of-sale-app > .items-selector > .filter-section > .label { grid-column: 1 / -1 !important; }
				.point-of-sale-app > .items-selector > .filter-section > .search-field { grid-column: span 7 / span 7 !important; margin: 0 6px 0 0 !important; }
				.point-of-sale-app > .items-selector > .filter-section > .item-group-field { grid-column: span 5 / span 5 !important; }
				.point-of-sale-app > .items-selector > .items-container { grid-template-columns: repeat(2, minmax(0, 1fr)) !important; }
				.point-of-sale-app > .items-selector .item-wrapper .item-display { height: 5rem !important; min-height: 5rem !important; }
				.point-of-sale-app > .customer-cart-container .dacs-walkin { grid-template-columns: minmax(0, 1fr) minmax(0, 1fr); }
				.point-of-sale-app .dacs-walkin-title { grid-column: 1 / -1; }
				.point-of-sale-app > .payment-container { padding: var(--padding-md) !important; }
				.point-of-sale-app > .payment-container > .payment-modes { flex-wrap: wrap !important; overflow: visible !important; }
				.point-of-sale-app > .payment-container .payment-mode-wrapper { flex: 1 1 100% !important; min-width: 0 !important; max-width: 100% !important; }
				.point-of-sale-app > .payment-container .mode-of-payment { width: 100% !important; min-width: 0 !important; }
				.point-of-sale-app > .payment-container .cash-shortcuts .shortcut { font-size: var(--text-xs) !important; padding: 4px 2px !important; white-space: nowrap; }
				.point-of-sale-app > .payment-container > .totals-section .total-label { font-size: var(--text-xs) !important; }
				.point-of-sale-app > .payment-container > .totals-section .value { font-size: var(--text-lg) !important; }
			}
`;
		document.head.appendChild(css);
	}
})();
