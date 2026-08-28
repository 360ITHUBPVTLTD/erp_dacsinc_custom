frappe.pages['roles-and-permissions'].on_page_load = function (wrapper) {
	const page = frappe.ui.make_app_page({
		parent: wrapper,
		title: __('Roles & Permissions'),
		single_column: true,
	});

	const panel = new RolesAndPermissions(page);
	wrapper.on_page_show = function () {
		panel.refresh();
	};

	page.set_primary_action(__('New User'), () => panel.show_new_user_dialog(), 'add');
	page.add_menu_item(__('DAC Matrix'), () => panel.show_dac_matrix_dialog());
	page.add_menu_item(__('Reload'), () => panel.refresh());
};

const RP_AVATAR_PALETTE = [
	'#2490ef', '#29a745', '#e0863b', '#8e5ce6', '#e0507a',
	'#17a2b8', '#6c7ac9', '#c0392b', '#159957', '#9b59b6',
];

const RP_ICONS = {
	edit: '<svg viewBox="0 0 16 16" fill="none"><path d="M11.3 2.3a1.5 1.5 0 012.1 2.1L5.5 12.3l-2.8.6.6-2.8 7.9-7.8z" stroke="currentColor" stroke-width="1.3" stroke-linejoin="round"/></svg>',
	shield: '<svg viewBox="0 0 16 16" fill="none"><path d="M8 1.5l5 1.8v3.9c0 3.6-2.1 6.1-5 7.1-2.9-1-5-3.5-5-7.1V3.3L8 1.5z" stroke="currentColor" stroke-width="1.3" stroke-linejoin="round"/></svg>',
	lock: '<svg viewBox="0 0 16 16" fill="none"><rect x="3.3" y="7.2" width="9.4" height="6.3" rx="1.3" stroke="currentColor" stroke-width="1.3"/><path d="M5.4 7.2V5.3a2.6 2.6 0 015.2 0v1.9" stroke="currentColor" stroke-width="1.3"/></svg>',
	mail: '<svg viewBox="0 0 16 16" fill="none"><rect x="2" y="3.5" width="12" height="9" rx="1.3" stroke="currentColor" stroke-width="1.3"/><path d="M2.5 4.3L8 8.7l5.5-4.4" stroke="currentColor" stroke-width="1.3" stroke-linecap="round"/></svg>',
	power: '<svg viewBox="0 0 16 16" fill="none"><path d="M8 2.3v5.4" stroke="currentColor" stroke-width="1.3" stroke-linecap="round"/><path d="M4.6 4.5a5 5 0 108 0" stroke="currentColor" stroke-width="1.3" stroke-linecap="round"/></svg>',
	pause: '<svg viewBox="0 0 16 16" fill="none"><rect x="4.5" y="3.5" width="2.3" height="9" rx=".6" fill="currentColor"/><rect x="9.2" y="3.5" width="2.3" height="9" rx=".6" fill="currentColor"/></svg>',
	trash: '<svg viewBox="0 0 16 16" fill="none"><path d="M3 4.5h10M6.3 4.5V3a1 1 0 011-1h1.4a1 1 0 011 1v1.5M6 7.2v4.5M10 7.2v4.5M4.2 4.5l.6 8a1 1 0 001 .9h4.4a1 1 0 001-.9l.6-8" stroke="currentColor" stroke-width="1.3" stroke-linecap="round" stroke-linejoin="round"/></svg>',
};

function rp_icon_btn(icon, label) {
	return `<span class="rp-btn-icon">${RP_ICONS[icon]}</span><span class="rp-btn-label">${label}</span>`;
}

class RolesAndPermissions {
	constructor(page) {
		this.page = page;
		this.access_cache = {};
		this.expanded = new Set();
		this.filters = { search: '', profile: '', status: '' };
		this.page_no = 1;
		this.page_size = 20;
		this.build_dom();
		this.refresh();
	}

	build_dom() {
		this.$body = $(`<div class="rp-page">
			<div class="rp-stats"></div>
			<div class="rp-toolbar">
				<div class="rp-search-wrap">
					<svg viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg"><circle cx="6.5" cy="6.5" r="4.5" stroke="currentColor" stroke-width="1.4"/><path d="M13 13L10 10" stroke="currentColor" stroke-width="1.4" stroke-linecap="round"/></svg>
					<input type="text" class="form-control rp-search" placeholder="${__('Search name or email...')}">
				</div>
				<div class="rp-status-toggle">
					<button type="button" class="is-active" data-status="">${__('All')}</button>
					<button type="button" data-status="1">${__('Enabled')}</button>
					<button type="button" data-status="0">${__('Disabled')}</button>
				</div>
				<select class="form-control rp-filter-profile"><option value="">${__('All Role Profiles')}</option></select>
				<button type="button" class="rp-toolbar-clear">${__('Clear filters')}</button>
				<span class="rp-result-count"></span>
			</div>
			<div class="rp-loading text-muted" style="padding: 24px 0;">${__('Loading...')}</div>
			<div class="rp-table-wrap" style="display:none;">
				<table class="rp-table">
					<thead>
						<tr>
							<th style="width:26px;"></th>
							<th>${__('User')}</th>
							<th>${__('Role Profile(s)')}</th>
							<th>${__('Status')}</th>
							<th>${__('Last Login')}</th>
							<th>${__('Actions')}</th>
						</tr>
					</thead>
					<tbody></tbody>
				</table>
			</div>
			<div class="rp-pagination">
				<div class="rp-pagination-info"></div>
				<div class="rp-pagination-controls">
					<select class="form-control rp-page-size">
						<option value="20">20 / ${__('page')}</option>
						<option value="50">50 / ${__('page')}</option>
						<option value="100">100 / ${__('page')}</option>
						<option value="99999">${__('All')}</option>
					</select>
					<button type="button" class="btn btn-xs btn-default rp-page-prev">&larr; ${__('Prev')}</button>
					<span class="rp-page-indicator"></span>
					<button type="button" class="btn btn-xs btn-default rp-page-next">${__('Next')} &rarr;</button>
				</div>
			</div>
		</div>`).appendTo(this.page.main);

		this.$body.find('.rp-search').on('input', frappe.utils.debounce(() => {
			this.filters.search = this.$body.find('.rp-search').val().toLowerCase();
			this.page_no = 1;
			this.render();
		}, 200));
		this.$body.find('.rp-status-toggle button').on('click', (e) => {
			this.filters.status = $(e.currentTarget).attr('data-status') || '';
			this.$body.find('.rp-status-toggle button').removeClass('is-active');
			$(e.currentTarget).addClass('is-active');
			this.page_no = 1;
			this.render();
		});
		this.$body.find('.rp-filter-profile').on('change', (e) => {
			this.filters.profile = $(e.target).val();
			this.page_no = 1;
			this.render();
		});
		this.$body.find('.rp-toolbar-clear').on('click', () => {
			this.filters = { search: '', profile: '', status: '' };
			this.$body.find('.rp-search').val('');
			this.$body.find('.rp-filter-profile').val('');
			this.$body.find('.rp-status-toggle button').removeClass('is-active');
			this.$body.find('.rp-status-toggle button[data-status=""]').addClass('is-active');
			this.page_no = 1;
			this.render();
		});
		this.$body.find('.rp-page-size').on('change', (e) => {
			this.page_size = parseInt($(e.target).val(), 10);
			this.page_no = 1;
			this.render();
		});
		this.$body.find('.rp-page-prev').on('click', () => {
			if (this.page_no > 1) {
				this.page_no -= 1;
				this.render();
			}
		});
		this.$body.find('.rp-page-next').on('click', () => {
			const total_pages = Math.max(1, Math.ceil(this.get_filtered_users().length / this.page_size));
			if (this.page_no < total_pages) {
				this.page_no += 1;
				this.render();
			}
		});
	}

	refresh() {
		this.$body.find('.rp-loading').show();
		this.$body.find('.rp-table-wrap').hide();
		frappe.call({
			method: 'erp_dacsinc_custom.roles_and_permissions_api.get_users_overview',
			callback: (r) => {
				this.data = r.message;
				this.access_cache = {};
				this.page_no = 1;
				this.populate_profile_filter();
				this.render_stats();
				this.render();
				this.$body.find('.rp-loading').hide();
				this.$body.find('.rp-table-wrap').show();
			},
		});
	}

	populate_profile_filter() {
		const $sel = this.$body.find('.rp-filter-profile');
		const current = $sel.val();
		$sel.find('option').slice(1).remove();
		(this.data.available_role_profiles || []).forEach((p) => {
			$sel.append(`<option value="${frappe.utils.escape_html(p)}">${frappe.utils.escape_html(p)}</option>`);
		});
		$sel.val(current || '');
	}

	render_stats() {
		const users = this.data.users;
		const total = users.length;
		const enabled = users.filter((u) => u.enabled).length;
		const disabled = total - enabled;
		const multi = users.filter((u) => u.role_profiles.length > 1).length;
		const unassigned = users.filter((u) => u.role_profiles.length === 0).length;
		this.$body.find('.rp-stats').html([
			this.stat_card(total, __('Total Users'), '#2490ef'),
			this.stat_card(enabled, __('Enabled'), '#29a745'),
			this.stat_card(disabled, __('Disabled'), '#e24c4c'),
			this.stat_card(multi, __('Multiple Profiles'), '#8e5ce6'),
			this.stat_card(unassigned, __('No Profile Assigned'), '#f0932b'),
		].join(''));
	}

	hash_string(str) {
		let hash = 0;
		for (let i = 0; i < str.length; i++) {
			hash = str.charCodeAt(i) + ((hash << 5) - hash);
		}
		return hash;
	}

	stat_card(value, label, color) {
		const style = color ? ` style="--rp-stat-color:${color};"` : '';
		return `<div class="rp-stat-card"${style}><div class="rp-stat-value">${value}</div><div class="rp-stat-label">${label}</div></div>`;
	}

	get_filtered_users() {
		const { search, profile, status } = this.filters;
		return this.data.users.filter((u) => {
			if (search) {
				const hay = `${u.full_name || ''} ${u.user}`.toLowerCase();
				if (!hay.includes(search)) return false;
			}
			if (profile && !u.role_profiles.includes(profile)) return false;
			if (status !== '' && String(u.enabled) !== status) return false;
			return true;
		});
	}

	render() {
		const $tbody = this.$body.find('tbody').empty();
		const filtered = this.get_filtered_users();
		this.$body.find('.rp-result-count').text(__('{0} of {1} users', [filtered.length, this.data.users.length]));

		const total_pages = Math.max(1, Math.ceil(filtered.length / this.page_size));
		if (this.page_no > total_pages) this.page_no = total_pages;
		const start = (this.page_no - 1) * this.page_size;
		const page_users = filtered.slice(start, start + this.page_size);

		this.render_pagination(filtered.length, start, page_users.length, total_pages);

		if (!page_users.length) {
			$tbody.append(`<tr><td colspan="6" class="text-muted text-center" style="padding:30px;">${__('No users match these filters')}</td></tr>`);
			return;
		}

		page_users.forEach((row) => this.render_user_row($tbody, row));
	}

	render_pagination(total_filtered, start, shown_count, total_pages) {
		const $pagination = this.$body.find('.rp-pagination');
		if (!total_filtered) {
			$pagination.hide();
			return;
		}
		$pagination.show();
		const from = shown_count ? start + 1 : 0;
		const to = start + shown_count;
		this.$body.find('.rp-pagination-info').text(
			__('Showing {0}–{1} of {2}', [from, to, total_filtered])
		);
		this.$body.find('.rp-page-indicator').text(__('Page {0} of {1}', [this.page_no, total_pages]));
		this.$body.find('.rp-page-prev').prop('disabled', this.page_no <= 1);
		this.$body.find('.rp-page-next').prop('disabled', this.page_no >= total_pages);
	}

	render_user_row($tbody, row) {
		const initials = (row.full_name || row.user)
			.split(' ').map((s) => s[0]).filter(Boolean).slice(0, 2).join('').toUpperCase();
		const avatar_color = RP_AVATAR_PALETTE[Math.abs(this.hash_string(row.user)) % RP_AVATAR_PALETTE.length];
		const profiles = row.profile_summaries.length
			? row.profile_summaries.map((p) => `<span class="rp-profile-chip ${row.managed_by_multi_profile ? '' : 'rp-native'}" title="${frappe.utils.escape_html(p.summary)}">${frappe.utils.escape_html(p.profile)}</span>`).join('')
			: `<span class="rp-no-profile">${__('No profile')}</span>`;
		const status = row.enabled
			? `<span class="rp-status-pill rp-status-on">${__('Enabled')}</span>`
			: `<span class="rp-status-pill rp-status-off">${__('Disabled')}</span>`;
		const is_open = this.expanded.has(row.user);

		const locked = !row.enabled;
		const locked_attr = locked ? 'disabled title="' + __('Enable this user first to make changes') + '"' : '';
		const password_icon = this.data.is_system_manager ? 'lock' : 'mail';
		const password_label = this.data.is_system_manager ? __('Password') : __('Send Reset Link');

		const $tr = $(`<tr class="rp-user-row ${locked ? 'rp-user-locked' : ''}">
			<td><span class="rp-expand-btn ${is_open ? 'is-open' : ''}">&#9656;</span></td>
			<td>
				<div class="rp-user-cell">
					<div class="rp-avatar" style="background:${avatar_color};">${initials || '?'}</div>
					<div>
						<div class="rp-user-name">${frappe.utils.escape_html(row.full_name || row.user)}</div>
						<div class="rp-user-email">${frappe.utils.escape_html(row.user)}</div>
					</div>
				</div>
			</td>
			<td>${profiles}</td>
			<td>${status}</td>
			<td class="text-muted small">${row.last_login ? frappe.datetime.comment_when(row.last_login) : __('Never')}</td>
			<td class="rp-actions">
				<div class="rp-btn-row">
					<button class="rp-icon-btn rp-btn-blue rp-edit-profile-fields" ${locked_attr} title="${__('Edit profile')}">${rp_icon_btn('edit', __('Profile'))}</button>
					<button class="rp-icon-btn rp-btn-blue rp-edit-profiles" ${locked_attr} title="${__('Role profiles')}">${rp_icon_btn('shield', __('Role Profiles'))}</button>
					<button class="rp-icon-btn rp-btn-amber rp-reset-password" ${locked_attr} title="${__('Password')}">${rp_icon_btn(password_icon, password_label)}</button>
				</div>
				<div class="rp-btn-row">
					<button class="rp-icon-btn ${row.enabled ? 'rp-btn-grey' : 'rp-btn-green'} rp-toggle-enabled">${rp_icon_btn(row.enabled ? 'pause' : 'power', row.enabled ? __('Disable') : __('Enable'))}</button>
					<button class="rp-icon-btn rp-btn-red rp-delete-user">${rp_icon_btn('trash', __('Delete'))}</button>
				</div>
			</td>
		</tr>`);

		$tr.on('click', (e) => {
			if ($(e.target).closest('.rp-actions').length) return;
			this.toggle_access_row(row);
		});
		$tr.find('.rp-edit-profile-fields').on('click', () => this.show_edit_profile_fields_dialog(row));
		$tr.find('.rp-edit-profiles').on('click', () => this.show_edit_profiles_dialog(row));
		$tr.find('.rp-reset-password').on('click', () => this.handle_password_action(row));
		$tr.find('.rp-toggle-enabled').on('click', () => this.toggle_enabled(row));
		$tr.find('.rp-delete-user').on('click', () => this.delete_user(row));
		$tbody.append($tr);

		if (is_open) {
			$tbody.append(this.build_access_row(row));
		}
	}

	toggle_access_row(row) {
		if (this.expanded.has(row.user)) {
			this.expanded.delete(row.user);
		} else {
			this.expanded.add(row.user);
		}
		this.render();
	}

	build_user_details_html(row) {
		const f = row.profile_fields || {};
		const detail = (label, value) => `<div class="rp-detail-item">
			<div class="rp-detail-label">${label}</div>
			<div class="rp-detail-value ${value ? '' : 'rp-empty'}">${value ? frappe.utils.escape_html(String(value)) : __('Not set')}</div>
		</div>`;

		const profiles_html = row.profile_summaries.length
			? row.profile_summaries.map((p, i) => {
				const roles_html = (p.roles || []).map((r) => `<span class="rp-role-chip">${frappe.utils.escape_html(r)}</span>`).join('');
				return `
					<div class="rp-profile-detail-row rp-profile-toggle" data-profile-idx="${i}">
						<span class="rp-expand-btn">&#9656;</span>
						<span class="rp-profile-chip ${row.managed_by_multi_profile ? '' : 'rp-native'}">${frappe.utils.escape_html(p.profile)}</span>
						<span class="text-muted small">${frappe.utils.escape_html(p.summary || '')}</span>
					</div>
					<div class="rp-profile-roles-list" data-profile-roles-idx="${i}">${roles_html || `<span class="text-muted small">${__('No roles')}</span>`}</div>
				`;
			}).join('')
			: `<span class="rp-no-profile">${__('No Role Profile assigned yet')}</span>`;

		return `
			<div class="rp-panel-section">
				<div class="rp-panel-section-title">${__('User Details')}</div>
				<div class="rp-detail-grid">
					${detail(__('Full Name'), row.full_name)}
					${detail(__('Email'), row.user)}
					${detail(__('Mobile No'), f.mobile_no)}
					${detail(__('Phone'), f.phone)}
					${detail(__('Gender'), f.gender)}
					${detail(__('Date of Birth'), f.birth_date)}
					${detail(__('Location'), f.location)}
					${detail(__('Time Zone'), f.time_zone)}
					${detail(__('Language'), row.language_display)}
					${detail(__('Status'), row.enabled ? __('Enabled') : __('Disabled'))}
					${detail(__('Last Login'), row.last_login ? frappe.datetime.str_to_user(row.last_login) : __('Never'))}
					${detail(__('Managed via multiple profiles'), row.managed_by_multi_profile ? __('Yes') : __('No'))}
				</div>
			</div>
			<div class="rp-panel-section">
				<div class="rp-panel-section-title">${__('Role Profile(s) Selected')}</div>
				<div class="rp-profile-detail-list">${profiles_html}</div>
			</div>
		`;
	}

	build_access_row(row) {
		const $tr = $(`<tr class="rp-access-row"><td colspan="6">
			<div class="rp-access-panel">
				${this.build_user_details_html(row)}
				<div class="rp-panel-section">
					<div class="rp-panel-section-title">${__('Doctype Access')}</div>
					<input type="text" class="form-control input-sm rp-access-filter" placeholder="${__('Filter doctypes...')}">
					<div class="rp-access-body"><div class="rp-access-loading">${__('Loading access...')}</div></div>
				</div>
			</div>
		</td></tr>`);

		$tr.find('.rp-profile-toggle').on('click', function () {
			const idx = $(this).attr('data-profile-idx');
			const $list = $tr.find(`.rp-profile-roles-list[data-profile-roles-idx="${idx}"]`);
			$(this).find('.rp-expand-btn').toggleClass('is-open');
			$list.toggleClass('is-open');
		});

		const render_grid = (doctypes, filterText) => {
			const $out = $tr.find('.rp-access-body');
			const filtered = filterText
				? doctypes.filter((d) => d.doctype.toLowerCase().includes(filterText))
				: doctypes;
			if (!filtered.length) {
				$out.html(`<div class="rp-access-empty">${__('No doctype access found')}</div>`);
				return;
			}
			const items = filtered.map((d) => {
				const flags = Object.keys(d.permissions).sort().map((ptype) => {
					const tier = d.permissions[ptype];
					const cls = tier === 'full' ? 'rp-flag-full' : 'rp-flag-owner';
					const label = tier === 'owner' ? ` (${__('own records only')})` : '';
					return `<span class="rp-flag ${cls}" title="${frappe.utils.escape_html(ptype)}${label}">${ptype[0].toUpperCase()}</span>`;
				}).join('');
				return `<div class="rp-access-item">
					<span class="rp-access-doctype" title="${frappe.utils.escape_html(d.doctype)}">${frappe.utils.escape_html(d.doctype)}</span>
					<span class="rp-access-flags">${flags}</span>
				</div>`;
			}).join('');
			$out.html(`
				<div class="rp-access-grid">${items}</div>
				<div class="rp-access-legend">
					R=Read, W=Write, C=Create, S=Submit, D=Delete &nbsp;•&nbsp;
					<span class="rp-flag rp-flag-full" style="width:auto;padding:0 5px;">${__('full')}</span>
					<span class="rp-flag rp-flag-owner" style="width:auto;padding:0 5px;">${__('own records only')}</span>
				</div>
			`);
		};

		if (this.access_cache[row.user]) {
			render_grid(this.access_cache[row.user], '');
		} else {
			frappe.call({
				method: 'erp_dacsinc_custom.roles_and_permissions_api.get_user_doctype_access',
				args: { user: row.user },
				callback: (r) => {
					this.access_cache[row.user] = r.message.doctypes;
					render_grid(r.message.doctypes, $tr.find('.rp-access-filter').val().toLowerCase());
				},
			});
		}

		$tr.find('.rp-access-filter').on('input', frappe.utils.debounce(() => {
			render_grid(this.access_cache[row.user] || [], $tr.find('.rp-access-filter').val().toLowerCase());
		}, 150));

		return $tr;
	}

	show_edit_profiles_dialog(row) {
		const d = new frappe.ui.Dialog({
			title: __('Role Profiles for {0}', [row.user]),
			fields: [
				{
					fieldname: 'info',
					fieldtype: 'HTML',
					options: `<p class="text-muted small">${__('Pick as many Role Profiles as this user needs — e.g. Merchandiser and POS User together. All roles from every profile picked are applied to the user.')}</p>`,
				},
				{
					fieldname: 'role_profiles',
					fieldtype: 'MultiSelectList',
					label: __('Role Profiles'),
					get_data: (txt) => (this.data.available_role_profiles || [])
						.filter((p) => !txt || p.toLowerCase().includes(txt.toLowerCase()))
						.map((p) => ({ value: p, description: '' })),
				},
			],
			primary_action_label: __('Save'),
			primary_action: (values) => {
				frappe.call({
					method: 'erp_dacsinc_custom.roles_and_permissions_api.update_user_role_profiles',
					args: { user: row.user, role_profiles: values.role_profiles || [] },
					freeze: true,
					callback: () => {
						d.hide();
						frappe.show_alert({ message: __('Role profiles updated'), indicator: 'green' });
						delete this.access_cache[row.user];
						this.refresh();
					},
				});
			},
		});
		d.set_value('role_profiles', row.role_profiles || []);
		d.show();
	}

	handle_password_action(row) {
		if (this.data.is_system_manager) {
			this.show_set_password_dialog(row);
		} else {
			frappe.confirm(
				__('Send {0} a password reset link by email?', [row.user]),
				() => {
					frappe.call({
						method: 'erp_dacsinc_custom.roles_and_permissions_api.send_password_reset_email',
						args: { user: row.user },
						freeze: true,
						callback: () => frappe.show_alert({ message: __('Reset link sent'), indicator: 'green' }),
					});
				}
			);
		}
	}

	show_set_password_dialog(row) {
		const d = new frappe.ui.Dialog({
			title: __('Set Password for {0}', [row.user]),
			fields: [
				{
					fieldname: 'new_password',
					fieldtype: 'Password',
					label: __('New Password'),
					reqd: 1,
					description: __('This sets a brand new password — the existing one can never be viewed, by anyone, at any permission level.'),
				},
			],
			primary_action_label: __('Set Password'),
			primary_action: (values) => {
				frappe.call({
					method: 'erp_dacsinc_custom.roles_and_permissions_api.set_user_password',
					args: { user: row.user, new_password: values.new_password },
					freeze: true,
					callback: () => {
						d.hide();
						frappe.show_alert({ message: __('Password updated'), indicator: 'green' });
						this.show_password_once_dialog(row.user, values.new_password);
					},
				});
			},
		});
		d.show();
	}

	show_password_once_dialog(user, password) {
		// Frappe never stores a password in reversible form — not for
		// System Manager, not for anyone — so this is the only moment it
		// can ever be shown again. Nothing here is persisted; it only
		// exists in this dialog, built from what was just typed.
		const d = new frappe.ui.Dialog({
			title: __('Password Set — Copy It Now'),
			fields: [
				{
					fieldname: 'notice',
					fieldtype: 'HTML',
					options: `<p class="text-muted small">${__('This is shown once and is never stored anywhere. Once you close this, there is no way to retrieve it again — you would have to set a new one.')}</p>`,
				},
				{
					fieldname: 'password_display',
					fieldtype: 'Data',
					label: __('Password for {0}', [user]),
					default: password,
					read_only: 1,
				},
			],
			primary_action_label: __('Copy & Close'),
			primary_action: () => {
				frappe.utils.copy_to_clipboard(password);
				frappe.show_alert({ message: __('Copied to clipboard'), indicator: 'green' });
				d.hide();
			},
		});
		d.show();
	}

	show_edit_profile_fields_dialog(row) {
		const f = row.profile_fields || {};
		const d = new frappe.ui.Dialog({
			title: __('Profile — {0}', [row.user]),
			fields: [
				{ fieldname: 'first_name', fieldtype: 'Data', label: __('First Name'), reqd: 1 },
				{ fieldname: 'last_name', fieldtype: 'Data', label: __('Last Name') },
				{ fieldname: 'column_break_1', fieldtype: 'Column Break' },
				{ fieldname: 'mobile_no', fieldtype: 'Data', options: 'Phone', label: __('Mobile No') },
				{ fieldname: 'phone', fieldtype: 'Data', options: 'Phone', label: __('Phone') },
				{ fieldname: 'section_break_1', fieldtype: 'Section Break' },
				{ fieldname: 'gender', fieldtype: 'Link', options: 'Gender', label: __('Gender') },
				{ fieldname: 'birth_date', fieldtype: 'Date', label: __('Date of Birth') },
				{ fieldname: 'column_break_2', fieldtype: 'Column Break' },
				{ fieldname: 'location', fieldtype: 'Data', label: __('Location') },
				{ fieldname: 'time_zone', fieldtype: 'Autocomplete', label: __('Time Zone'), options: (typeof moment !== 'undefined' && moment.tz) ? moment.tz.names() : [] },
				{ fieldname: 'language', fieldtype: 'Link', options: 'Language', label: __('Language') },
			],
			primary_action_label: __('Save'),
			primary_action: (values) => {
				frappe.call({
					method: 'erp_dacsinc_custom.roles_and_permissions_api.update_user_profile',
					args: { user: row.user, values },
					freeze: true,
					callback: () => {
						d.hide();
						frappe.show_alert({ message: __('Profile updated'), indicator: 'green' });
						this.refresh();
					},
				});
			},
		});
		Object.keys(f).forEach((fieldname) => d.set_value(fieldname, f[fieldname] || ''));
		d.show();
	}

	toggle_enabled(row) {
		frappe.call({
			method: 'erp_dacsinc_custom.roles_and_permissions_api.set_user_enabled',
			args: { user: row.user, enabled: row.enabled ? 0 : 1 },
			freeze: true,
			callback: () => this.refresh(),
		});
	}

	delete_user(row) {
		const d = new frappe.ui.Dialog({
			title: __('Delete {0}?', [row.user]),
			fields: [
				{
					fieldname: 'warning',
					fieldtype: 'HTML',
					options: `<p class="text-danger">${__('This permanently deletes the user. It cannot be undone. If they own or created other documents, Frappe will refuse the delete instead of orphaning those records — disable the user instead in that case.')}</p>`,
				},
				{
					fieldname: 'confirm_email',
					fieldtype: 'Data',
					label: __('Type {0} to confirm', [row.user]),
					reqd: 1,
				},
			],
			primary_action_label: __('Delete'),
			primary_action: (values) => {
				if (values.confirm_email !== row.user) {
					frappe.msgprint(__('That does not match — nothing was deleted.'));
					return;
				}
				frappe.call({
					method: 'erp_dacsinc_custom.roles_and_permissions_api.delete_user',
					args: { user: row.user },
					freeze: true,
					callback: () => {
						d.hide();
						frappe.show_alert({ message: __('User deleted'), indicator: 'green' });
						this.refresh();
					},
				});
			},
		});
		d.get_primary_btn().removeClass('btn-primary').addClass('btn-danger');
		d.show();
	}

	show_new_user_dialog() {
		const d = new frappe.ui.Dialog({
			title: __('New User'),
			fields: [
				{ fieldname: 'email', fieldtype: 'Data', options: 'Email', label: __('Email'), reqd: 1 },
				{ fieldname: 'first_name', fieldtype: 'Data', label: __('First Name'), reqd: 1 },
				{ fieldname: 'last_name', fieldtype: 'Data', label: __('Last Name') },
				{
					fieldname: 'role_profiles',
					fieldtype: 'MultiSelectList',
					label: __('Role Profiles'),
					description: __('You can pick more than one.'),
					get_data: (txt) => (this.data.available_role_profiles || [])
						.filter((p) => !txt || p.toLowerCase().includes(txt.toLowerCase()))
						.map((p) => ({ value: p, description: '' })),
				},
			],
			primary_action_label: __('Create'),
			primary_action: (values) => {
				frappe.call({
					method: 'erp_dacsinc_custom.roles_and_permissions_api.create_user',
					args: {
						email: values.email,
						first_name: values.first_name,
						last_name: values.last_name,
						role_profiles: values.role_profiles || [],
					},
					freeze: true,
					callback: () => {
						d.hide();
						frappe.show_alert({ message: __('User created'), indicator: 'green' });
						this.refresh();
					},
				});
			},
		});
		d.show();
	}

	// "DAC Matrix" — reconciles every employee named in
	// erp_dacsinc_custom.dac_permission_matrix.EMPLOYEE_ROLE_PROFILE_TARGETS
	// (the business's Excel-derived source of truth) against their current
	// Role Profile(s). ADDITIVE ONLY: a proposed profile is only ever added
	// on top of whatever the user already has — never a replacement — so a
	// user already on another Role Profile for a second responsibility never
	// loses it here. Nothing changes until the row is ticked AND the
	// frappe.confirm() summary naming every user and profile is accepted.
	show_dac_matrix_dialog() {
		const d = new frappe.ui.Dialog({
			title: __('DAC Matrix — Role Profile Reconciliation'),
			size: 'extra-large',
			fields: [
				{
					fieldname: 'info',
					fieldtype: 'HTML',
					options: `<p class="text-muted small">${__(
						'Every employee named in the DAC permission matrix spreadsheet, and the Role Profile it proposes for them. This only ever ADDS the proposed profile on top of what a user already has — it never removes an existing Role Profile.'
					)}</p>`,
				},
				{ fieldname: 'dac_rows_area', fieldtype: 'HTML' },
			],
			primary_action_label: __('Apply Selected'),
			primary_action: () => this.confirm_and_apply_dac_matrix(d),
		});

		d.show();
		d.get_field('dac_rows_area').$wrapper.html(`<div class="text-muted">${__('Loading...')}</div>`);

		frappe.call({
			method: 'erp_dacsinc_custom.roles_and_permissions_api.get_dac_matrix_assignment_preview',
			callback: (r) => {
				if (!r.message) return;
				this.render_dac_matrix_rows(d, r.message.rows || []);
			},
		});
	}

	render_dac_matrix_rows(dialog, rows) {
		dialog._dac_rows_by_user = {};
		rows.forEach((row) => (dialog._dac_rows_by_user[row.user] = row));

		const $area = dialog.get_field('dac_rows_area').$wrapper;

		if (!rows.length) {
			$area.html(`<div class="text-muted">${__('No employees in the DAC matrix.')}</div>`);
			return;
		}

		const changed_count = rows.filter((r) => r.status === 'ok' && r.will_change).length;

		const header = `
			<div class="flex justify-between align-center mb-2">
				<div><b>${changed_count}</b> ${__('of')} ${rows.length} ${__('will change')}</div>
				<div>
					<button class="btn btn-xs btn-default rp-dac-select-all">${__('Select All Changed')}</button>
					<button class="btn btn-xs btn-default rp-dac-unselect-all">${__('Unselect All')}</button>
				</div>
			</div>`;

		const body = rows
			.map((row) => {
				const selectable = row.status === 'ok';
				const checked = selectable && row.will_change ? 'checked' : '';
				const disabled = selectable ? '' : 'disabled';
				const muted = selectable ? '' : 'text-muted';
				const current = (row.current_role_profiles || []).length
					? row.current_role_profiles
						.map((p) => `<span class="rp-profile-chip rp-native">${frappe.utils.escape_html(p)}</span>`)
						.join(' ')
					: `<span class="rp-no-profile">${__('none')}</span>`;

				let status_badge = '';
				if (row.status === 'user_not_found') {
					status_badge = `<span class="rp-status-pill rp-status-off">${__('User not found')}</span>`;
				} else if (row.status === 'disabled') {
					status_badge = `<span class="rp-status-pill rp-status-off">${__('User disabled')}</span>`;
				} else if (!row.will_change) {
					status_badge = `<span class="rp-status-pill rp-status-on">${__('Already set')}</span>`;
				} else {
					status_badge = `<span class="rp-profile-chip">${__('Will add')}</span>`;
				}

				return `
				<div class="rp-dac-row ${muted}">
					<input type="checkbox" class="rp-dac-check" ${checked} ${disabled}
					       data-user="${frappe.utils.escape_html(row.user)}">
					<div class="rp-dac-col-name">
						${frappe.utils.escape_html(row.employee_name || '')}
						<div class="text-muted small">${frappe.utils.escape_html(row.user)}</div>
					</div>
					<div class="rp-dac-col-current">${current}</div>
					<div class="rp-dac-col-proposed"><span class="rp-profile-chip rp-native">${frappe.utils.escape_html(row.proposed_role_profile)}</span></div>
					<div class="rp-dac-col-status">${status_badge}</div>
				</div>`;
			})
			.join('');

		$area.html(`
			${header}
			<div class="rp-dac-list">${body}</div>`);

		$area.find('.rp-dac-select-all').on('click', () => {
			$area.find('.rp-dac-check:not(:disabled)').prop('checked', true);
		});
		$area.find('.rp-dac-unselect-all').on('click', () => {
			$area.find('.rp-dac-check').prop('checked', false);
		});
	}

	confirm_and_apply_dac_matrix(dialog) {
		const $area = dialog.get_field('dac_rows_area').$wrapper;
		const $checked = $area.find('.rp-dac-check:checked');

		if (!$checked.length) {
			frappe.msgprint(__('Select at least one employee.'));
			return;
		}

		const lines = $checked
			.map((_, el) => {
				const user = $(el).data('user');
				const row = dialog._dac_rows_by_user[user] || {};
				const label = row.employee_name || user;
				return `${frappe.utils.escape_html(label)} → <b>+${frappe.utils.escape_html(row.proposed_role_profile || '')}</b>`;
			})
			.get();

		const summary =
			`<p>${__('This will ADD a Role Profile for {0} user(s) — any Role Profile they already have stays untouched:', [lines.length])}</p>` +
			`<ul class="small">${lines.map((l) => `<li>${l}</li>`).join('')}</ul>`;

		frappe.confirm(summary, () => {
			const users = $checked.map((_, el) => $(el).data('user')).get();

			frappe.call({
				method: 'erp_dacsinc_custom.roles_and_permissions_api.apply_dac_matrix_assignments',
				args: { users },
				freeze: true,
				callback: (r) => {
					if (!r.message) return;
					this.show_dac_matrix_result(r.message.results || []);
					frappe.call({
						method: 'erp_dacsinc_custom.roles_and_permissions_api.get_dac_matrix_assignment_preview',
						callback: (r2) => {
							if (r2.message) this.render_dac_matrix_rows(dialog, r2.message.rows || []);
						},
					});
					this.refresh();
				},
			});
		});
	}

	show_dac_matrix_result(results) {
		const updated = results.filter((r) => r.status === 'updated').length;
		const skipped = results.filter((r) => r.status !== 'updated');

		let msg = `<b>${updated}</b> ${__('user(s) updated')}`;
		if (skipped.length) {
			const items = skipped
				.map((r) => `<li>${frappe.utils.escape_html(r.user)} — ${frappe.utils.escape_html(r.reason || r.status)}</li>`)
				.join('');
			msg += `<hr><b>${__('Skipped')}</b><ul class="small">${items}</ul>`;
		}

		frappe.msgprint({
			title: __('DAC Matrix Update Complete'),
			message: msg,
			indicator: updated ? 'green' : 'orange',
		});
	}
}
