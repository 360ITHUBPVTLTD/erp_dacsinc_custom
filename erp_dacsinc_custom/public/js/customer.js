// Customer form: renders the "Add Contact" button + contact list inside the
// custom_contact_details_html field, and lets a Contact be created/edited
// inline without leaving the Customer form.
frappe.ui.form.on('Customer', {
	refresh(frm) {
		render_contact_widget(frm);
	},
});

function render_contact_widget(frm) {
	frm.fields_dict.custom_contact_details_html.$wrapper.html(`
		<div>
			<button class="btn btn-primary btn-sm" id="add_contact_btn">
				${__('Add Contact')}
			</button>
		</div>
		<div id="contact_list" style="margin-top:10px;"></div>
	`);

	frm.fields_dict.custom_contact_details_html.$wrapper
		.find('#add_contact_btn')
		.off('click')
		.on('click', function () {
			prompt_contact_details(frm);
		});

	render_contact_list(frm);
}

function contact_prompt_fields(defaults = {}) {
	return [
		{ fieldname: 'first_name', fieldtype: 'Data', label: __('Contact Person Name'), reqd: 1, default: defaults.first_name },
		{ fieldname: 'mobile_no', fieldtype: 'Data', label: __('Mobile No'), reqd: 1, default: defaults.mobile_no },
		{ fieldname: 'email_id', fieldtype: 'Data', options: 'Email', label: __('Email Id'), default: defaults.email_id },
	];
}

// email_id is optional, so `values.email_id` can come back blank. Only build
// a phone_nos/email_ids row when there's an actual value to put in it — an
// email_ids row with is_primary set but no email_id crashes core
// Contact.set_primary_email() (`d.email_id.strip()` on a None email_id).
function build_contact_doc(values, extra = {}) {
	const first_name = (values.first_name || '').trim();
	const mobile_no = (values.mobile_no || '').trim();
	const email_id = (values.email_id || '').trim();

	return Object.assign({ doctype: 'Contact' }, extra, {
		first_name: first_name,
		phone_nos: mobile_no
			? [{ phone: mobile_no, is_primary_phone: 1, is_primary_mobile_no: 1 }]
			: [],
		email_ids: email_id ? [{ email_id: email_id, is_primary: 1 }] : [],
	});
}

function prompt_contact_details(frm) {
	frappe.prompt(
		contact_prompt_fields(),
		function (values) {
			frappe.call({
				method: 'frappe.client.insert',
				args: {
					doc: build_contact_doc(values, {
						links: [{ link_doctype: 'Customer', link_name: frm.doc.name }],
					}),
				},
				callback: function (r) {
					if (r.exc) return;
					const new_contact = r.message;

					frappe.call({
						method: 'frappe.client.set_value',
						args: {
							doctype: 'Customer',
							name: frm.doc.name,
							fieldname: { customer_primary_contact: new_contact.name },
						},
						callback: function () {
							frappe.show_alert({
								message: __('Contact created and set as Primary Contact'),
								indicator: 'green',
							});
							frm.reload_doc();
						},
					});
				},
			});
		},
		__('New Contact'),
		__('Create')
	);
}

function render_contact_list(frm) {
	if (!frm.doc.name) return;

	frappe.call({
		method: 'erp_dacsinc_custom.custom_script.get_customer_contacts',
		args: { customer: frm.doc.name },
		callback: function (r) {
			const container = frm.fields_dict.custom_contact_details_html.$wrapper.find('#contact_list');
			container.empty();

			if (!r.message || r.message.length === 0) {
				container.html(`<p class="text-muted">${__('No contacts found for this customer.')}</p>`);
				return;
			}

			r.message.forEach((details) => {
				// Values here come back from the database (first_name,
				// last_name, phone, email) — escape before interpolating
				// into HTML so a contact record can't inject markup.
				const name = frappe.utils.escape_html(details.first_name || '') +
					(details.last_name ? ' ' + frappe.utils.escape_html(details.last_name) : '');
				const phone = frappe.utils.escape_html(details.phone || '-');
				const email = frappe.utils.escape_html(details.email || '-');

				const $row = $(`
					<div class="contact-card d-flex justify-content-between align-items-center"
						 style="border:1px solid #d1d8dd; padding:8px; margin-bottom:6px; border-radius:4px;">
						<div>
							<b>${name}</b><br>
							📞 ${phone}<br>
							📧 ${email}
						</div>
						<div>
							<button class="btn btn-xs btn-secondary edit-contact-btn">
								${__('Edit')}
							</button>
						</div>
					</div>
				`);
				$row.find('.edit-contact-btn').on('click', function () {
					open_edit_prompt(details.name, frm);
				});
				container.append($row);
			});
		},
	});
}

function open_edit_prompt(contact_name, frm) {
	frappe.call({
		method: 'frappe.client.get',
		args: { doctype: 'Contact', name: contact_name },
		callback: function (r) {
			if (!r.message) return;
			const c = r.message;
			const phone = c.phone_nos?.length ? c.phone_nos[0].phone : '';
			const email = c.email_ids?.length ? c.email_ids[0].email_id : '';

			frappe.prompt(
				contact_prompt_fields({ first_name: c.first_name, mobile_no: phone, email_id: email }),
				function (values) {
					// Build on top of the full fetched doc (not just {name})
					// so unrelated fields (salutation, department, address,
					// ...) survive the save instead of being blanked out.
					const updated_doc = build_contact_doc(values, c);

					frappe.call({
						method: 'frappe.client.save',
						args: { doc: updated_doc },
						callback: function (save_r) {
							if (save_r.exc) return;
							frappe.show_alert({ message: __('Contact updated successfully'), indicator: 'green' });
							render_contact_list(frm);
						},
					});
				},
				__('Edit Contact'),
				__('Save')
			);
		},
	});
}
