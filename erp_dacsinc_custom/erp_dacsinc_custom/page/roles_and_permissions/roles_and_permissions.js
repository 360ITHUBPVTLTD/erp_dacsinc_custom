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
	if (frappe.user.has_role("System Manager") || frappe.session.user === "Administrator") {
		page.add_menu_item(__('Sync Permissions & Users'), () => panel.show_sync_dac_matrix_dialog());
	}
	page.add_menu_item(__('Reload'), () => panel.refresh());
};


const RP_NO_PROFILE_FILTER = '__no_profile__';

const RP_AVATAR_PALETTE = [
	'#2490ef', '#29a745', '#e0863b', '#8e5ce6', '#e0507a',
	'#17a2b8', '#6c7ac9', '#c0392b', '#159957', '#9b59b6',
];

const RP_ICONS = {
	edit: '<svg viewBox="0 0 16 16" fill="none"><path d="M11.3 2.3a1.5 1.5 0 012.1 2.1L5.5 12.3l-2.8.6.6-2.8 7.9-7.8z" stroke="currentColor" stroke-width="1.3" stroke-linejoin="round"/></svg>',
	shield: '<svg viewBox="0 0 16 16" fill="none"><path d="M8 1.5l5 1.8v3.9c0 3.6-2.1 6.1-5 7.1-2.9-1-5-3.5-5-7.1V3.3L8 1.5z" stroke="currentColor" stroke-width="1.3" stroke-linejoin="round"/></svg>',
	lock: '<svg viewBox="0 0 16 16" fill="none"><rect x="3.3" y="7.2" width="9.4" height="6.3" rx="1.3" stroke="currentColor" stroke-width="1.3"/><path d="M5.4 7.2V5.3a2.6 2.6 0 015.2 0v1.9" stroke="currentColor" stroke-width="1.3"/></svg>',
	mail: '<svg viewBox="0 0 16 16" fill="none"><rect x="2" y="3.5" width="12" height="9" rx="1.3" stroke="currentColor" stroke-width="1.3"/><path d="M2.5 4.3L8 8.7l5.5-4.4" stroke="currentColor" stroke-width="1.3" stroke-linecap="round"/></svg>',
	trash: '<svg viewBox="0 0 16 16" fill="none"><path d="M3 4.5h10M6.3 4.5V3a1 1 0 011-1h1.4a1 1 0 011 1v1.5M6 7.2v4.5M10 7.2v4.5M4.2 4.5l.6 8a1 1 0 001 .9h4.4a1 1 0 001-.9l.6-8" stroke="currentColor" stroke-width="1.3" stroke-linecap="round" stroke-linejoin="round"/></svg>',
	chevron: '<svg viewBox="0 0 16 16" fill="none"><path d="M6 4l4 4-4 4" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/></svg>',
	users: '<svg viewBox="0 0 16 16" fill="none"><circle cx="5.6" cy="5.1" r="2.3" stroke="currentColor" stroke-width="1.3"/><path d="M1.6 13.1c.4-2.4 2-3.8 4-3.8s3.6 1.4 4 3.8" stroke="currentColor" stroke-width="1.3" stroke-linecap="round" stroke-linejoin="round"/><circle cx="11.3" cy="5.4" r="1.8" stroke="currentColor" stroke-width="1.2"/><path d="M9.9 9.7c1.7.1 3 1.4 3.4 3.4" stroke="currentColor" stroke-width="1.2" stroke-linecap="round"/></svg>',
	check_circle: '<svg viewBox="0 0 16 16" fill="none"><circle cx="8" cy="8" r="6.3" stroke="currentColor" stroke-width="1.3"/><path d="M5.3 8.2l1.8 1.8 3.6-3.9" stroke="currentColor" stroke-width="1.3" stroke-linecap="round" stroke-linejoin="round"/></svg>',
	x_circle: '<svg viewBox="0 0 16 16" fill="none"><circle cx="8" cy="8" r="6.3" stroke="currentColor" stroke-width="1.3"/><path d="M6 6l4 4M10 6l-4 4" stroke="currentColor" stroke-width="1.3" stroke-linecap="round"/></svg>',
	layers: '<svg viewBox="0 0 16 16" fill="none"><path d="M8 2.1l5.6 2.8L8 7.7 2.4 4.9 8 2.1z" stroke="currentColor" stroke-width="1.2" stroke-linejoin="round"/><path d="M2.4 8.1L8 10.9l5.6-2.8" stroke="currentColor" stroke-width="1.2" stroke-linejoin="round"/><path d="M2.4 11.1L8 13.9l5.6-2.8" stroke="currentColor" stroke-width="1.2" stroke-linejoin="round"/></svg>',
	alert: '<svg viewBox="0 0 16 16" fill="none"><path d="M8 1.8l6.6 11.4H1.4L8 1.8z" stroke="currentColor" stroke-width="1.2" stroke-linejoin="round"/><path d="M8 6.4v3" stroke="currentColor" stroke-width="1.3" stroke-linecap="round"/><circle cx="8" cy="11.3" r=".9" fill="currentColor"/></svg>',
};

// Every search/filter box on this page shares this markup so the icon and
// styling can never drift out of sync between them.
function rp_search_input(cls, placeholder) {
	return `<div class="rp-search-wrap">
		<svg viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg"><circle cx="6.5" cy="6.5" r="4.5" stroke="currentColor" stroke-width="1.4"/><path d="M13 13L10 10" stroke="currentColor" stroke-width="1.4" stroke-linecap="round"/></svg>
		<input type="text" class="form-control ${cls}" placeholder="${placeholder}">
	</div>`;
}

// Cancel and Create both start with "C" — taking the first letter of the
// permission name rendered both as an indistinguishable "C".
const RP_PERM_ORDER = ['read', 'write', 'create', 'submit', 'cancel', 'delete'];
const RP_PERM_LETTERS = { read: 'R', write: 'W', create: 'C', submit: 'S', cancel: 'X', delete: 'D' };

function rp_perm_flags(permissions) {
	const labels = {
		read: __('Read'), write: __('Write'), create: __('Create'),
		submit: __('Submit'), cancel: __('Cancel'), delete: __('Delete'),
	};
	return RP_PERM_ORDER
		.filter((ptype) => permissions[ptype])
		.map((ptype) => {
			const tier = permissions[ptype];
			const cls = tier === 'full' ? 'rp-flag-full' : 'rp-flag-owner';
			const suffix = tier === 'owner' ? ` — ${__('own records only')}` : '';
			return `<span class="rp-flag ${cls}" title="${labels[ptype]}${suffix}">${RP_PERM_LETTERS[ptype]}</span>`;
		})
		.join('');
}

function rp_perm_legend() {
	return `${__('R')}=${__('Read')}, ${__('W')}=${__('Write')}, ${__('C')}=${__('Create')}, ${__('S')}=${__('Submit')}, ${__('X')}=${__('Cancel')}, ${__('D')}=${__('Delete')}`;
}

// `extra_attrs` is rendered before `title` on purpose: a disabled button
// passes its own title explaining WHY it's disabled, and a duplicate
// attribute is resolved by the browser in favour of the first one.
function rp_action_btn(cls, icon, label, title, extra_attrs, color_cls) {
	return `<button type="button" class="rp-icon-btn ${color_cls || 'rp-btn-blue'} ${cls}" ${extra_attrs || ''} title="${title || label}" aria-label="${title || label}">
		<span class="rp-btn-icon">${RP_ICONS[icon]}</span><span class="rp-btn-label">${label}</span>
	</button>`;
}

class RolesAndPermissions {
	constructor(page) {
		this.page = page;
		this.access_cache = {};
		this.expanded = new Set();
		this.filters = { search: '', profile: '', status: '1' };
		this.view = 'users';
		this.profile_search = '';
		this.profile_access_cache = {};
		this.expanded_profile = null;
		this.doctype_search = '';
		this.doctype_access_cache = {};
		this.expanded_doctype = null;
		this.page_no = 1;
		this.page_size = 20;
		this.build_dom();
		this.refresh();
	}

	build_dom() {
		this.$body = $(`<div class="rp-page">
			<div class="rp-view-tabs">
				<button type="button" class="rp-view-tab is-active" data-view="users">${__('Users')}</button>
				<button type="button" class="rp-view-tab" data-view="profiles">${__('Role Profiles')}</button>
				<button type="button" class="rp-view-tab" data-view="doctypes">${__('Doctype Access')}</button>
			</div>
			<div class="rp-view" data-view-panel="users">
			<div class="rp-stats"></div>
			<div class="rp-toolbar">
				<div class="rp-toolbar-filters">
					${rp_search_input('rp-search', __('Search name or email...'))}
					<div class="rp-status-toggle">
						<button type="button" data-status="">${__('All')}</button>
						<button type="button" class="is-active" data-status="1">${__('Enabled')}</button>
						<button type="button" data-status="0">${__('Disabled')}</button>
					</div>
					<select class="form-control rp-filter-profile">
						<option value="">${__('All Role Profiles')}</option>
						<option value="${RP_NO_PROFILE_FILTER}">${__('No Profile')}</option>
					</select>
					<button type="button" class="rp-toolbar-clear" title="${__('Reset to the default view')}">${__('Clear')}</button>
				</div>
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
			</div>
			<div class="rp-view" data-view-panel="profiles" style="display:none;">
				<div class="rp-profiles-intro">${__('Pick a Role Profile to see exactly what it grants — no user involved. Use this to check a profile before handing it to anyone.')}</div>
				<div class="rp-toolbar">
					<div class="rp-toolbar-filters">
						${rp_search_input('rp-profile-search', __('Search Role Profiles...'))}
					</div>
					<span class="rp-profile-count"></span>
				</div>
				<div class="rp-profiles-list"><div class="rp-access-loading">${__('Loading Role Profiles...')}</div></div>
			</div>
			<div class="rp-view" data-view-panel="doctypes" style="display:none;">
				<div class="rp-profiles-intro">${__('Search any doctype to see exactly which roles grant access to it, what each grants, and which users currently hold it.')}</div>
				<div class="rp-toolbar">
					<div class="rp-toolbar-filters">
						${rp_search_input('rp-doctype-search', __('Search doctypes (e.g. Sales Order, Customer)...'))}
					</div>
					<span class="rp-doctype-count"></span>
				</div>
				<div class="rp-doctypes-list"><div class="rp-access-loading">${__('Loading...')}</div></div>
			</div>
		</div>`).appendTo(this.page.main);

		this.$body.find('.rp-view-tab').on('click', (e) => {
			this.switch_view($(e.currentTarget).attr('data-view'));
		});
		this.$body.find('.rp-profile-search').on('input', frappe.utils.debounce(() => {
			this.profile_search = (this.$body.find('.rp-profile-search').val() || '').toLowerCase();
			this.render_profiles();
		}, 200));
		this.$body.find('.rp-doctype-search').on('input', frappe.utils.debounce(() => {
			this.doctype_search = (this.$body.find('.rp-doctype-search').val() || '').toLowerCase();
			this.render_doctype_list();
		}, 200));

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
			this.filters = { search: '', profile: '', status: '1' };
			this.$body.find('.rp-search').val('');
			this.$body.find('.rp-filter-profile').val('');
			this.$body.find('.rp-status-toggle button').removeClass('is-active');
			this.$body.find('.rp-status-toggle button[data-status="1"]').addClass('is-active');
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

	switch_view(view) {
		this.view = view;
		this.$body.find('.rp-view-tab').removeClass('is-active');
		this.$body.find(`.rp-view-tab[data-view="${view}"]`).addClass('is-active');
		this.$body.find('.rp-view').hide();
		this.$body.find(`.rp-view[data-view-panel="${view}"]`).show();
		if (view === 'profiles' && !this.profiles_data) this.load_profiles();
		if (view === 'doctypes' && !this.doctypes_data) this.load_doctypes();
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
		// only once it's been opened — otherwise every page show pays for a
		// view the admin may never look at
		if (this.profiles_data) this.load_profiles();
		if (this.doctypes_data) this.load_doctypes();
	}

	load_profiles() {
		frappe.call({
			method: 'erp_dacsinc_custom.roles_and_permissions_api.get_role_profiles_overview',
			callback: (r) => {
				this.profiles_data = r.message;
				this.profile_access_cache = {};
				this.render_profiles();
			},
		});
	}

	render_profiles() {
		const all = (this.profiles_data && this.profiles_data.profiles) || [];
		const search = this.profile_search || '';
		const list = search ? all.filter((p) => p.profile.toLowerCase().includes(search)) : all;

		this.$body.find('.rp-profile-count').text(__('{0} of {1} profiles', [list.length, all.length]));

		const $out = this.$body.find('.rp-profiles-list').empty();
		if (!list.length) {
			$out.html(`<div class="rp-access-empty">${__('No Role Profile matches that search')}</div>`);
			return;
		}

		list.forEach((p) => {
			const is_open = this.expanded_profile === p.profile;
			const $row = $(`<div class="rp-profile-card ${is_open ? 'is-open' : ''}">
				<div class="rp-profile-card-head">
					<span class="rp-expand-btn ${is_open ? 'is-open' : ''}">${RP_ICONS.chevron}</span>
					<span class="rp-profile-card-name">${frappe.utils.escape_html(p.profile)}</span>
					<span class="rp-profile-card-meta">
						<span class="rp-meta-pill">${__('{0} roles', [p.role_count])}</span>
						<span class="rp-meta-pill rp-meta-pill-link ${p.user_count ? '' : 'rp-meta-zero'}" title="${__('See who has this profile')}">${__('{0} users', [p.user_count])}</span>
					</span>
				</div>
				<div class="rp-profile-card-body" ${is_open ? '' : 'style="display:none;"'}></div>
			</div>`);

			$row.find('.rp-profile-card-head').on('click', () => this.toggle_profile(p));
			$row.find('.rp-meta-pill-link').on('click', (e) => {
				e.stopPropagation();
				if (p.user_count) this.show_profile_users_dialog(p);
			});
			$out.append($row);

			if (is_open) this.fill_profile_card($row, p);
		});
	}

	toggle_profile(p) {
		this.expanded_profile = this.expanded_profile === p.profile ? null : p.profile;
		this.render_profiles();
	}

	// Shared by every "who has this" dialog (Role Profile users, doctype
	// access users) so the row layout can't drift between the two.
	build_user_rows_html(users, empty_message) {
		if (!users.length) {
			return `<div class="rp-access-empty">${empty_message || __('No users currently have this.')}</div>`;
		}
		const rows = users.map((u) => {
			const initials = (u.full_name || u.name)
				.split(' ').map((s) => s[0]).filter(Boolean).slice(0, 2).join('').toUpperCase();
			const color = RP_AVATAR_PALETTE[Math.abs(this.hash_string(u.name)) % RP_AVATAR_PALETTE.length];
			return `<div class="rp-profile-user-row ${u.enabled ? '' : 'rp-profile-user-disabled'}">
				<div class="rp-avatar rp-avatar-sm" style="background:${color};">${initials || '?'}</div>
				<div class="rp-user-text">
					<div class="rp-user-name">${frappe.utils.escape_html(u.full_name || u.name)}</div>
					<div class="rp-user-email">${frappe.utils.escape_html(u.name)}</div>
				</div>
				${u.enabled ? '' : `<span class="rp-status-pill rp-status-off">${__('Disabled')}</span>`}
			</div>`;
		}).join('');
		return `<div class="rp-profile-user-list">${rows}</div>`;
	}

	// Opens immediately and fetches — used where the users aren't already
	// in hand (Role Profile users pill: the overview list only has a count).
	show_profile_users_dialog(p) {
		const d = new frappe.ui.Dialog({
			title: __('Users with {0}', [p.profile]),
			size: 'small',
			fields: [{ fieldname: 'users_area', fieldtype: 'HTML' }],
		});
		d.get_field('users_area').$wrapper.html(`<div class="rp-access-loading">${__('Loading...')}</div>`);
		d.show();

		frappe.call({
			method: 'erp_dacsinc_custom.roles_and_permissions_api.get_role_profile_users',
			args: { role_profile: p.profile },
			callback: (r) => {
				if (!r.message) return;
				const html = this.build_user_rows_html(r.message.users || [], __('No users currently hold this profile.'));
				d.get_field('users_area').$wrapper.html(html);
			},
		});
	}


	fill_profile_card($row, p) {
		const $body = $row.find('.rp-profile-card-body');
		const roles_html = p.roles.length
			? p.roles.map((r) => `<span class="rp-role-chip">${frappe.utils.escape_html(r)}</span>`).join('')
			: `<span class="text-muted small">${__('This profile bundles no roles, so it grants nothing.')}</span>`;

		const roles_section = `<div class="rp-subsection">
			<div class="rp-subsection-title">${__('Roles in this profile ({0})', [p.role_count])}</div>
			<div class="rp-extra-roles-list">${roles_html}</div>
		</div>`;

		const cached = this.profile_access_cache[p.profile];
		if (cached) {
			$body.html(roles_section + this.build_access_preview_html(cached));
			this.wire_access_preview_search($body);
			return;
		}

		$body.html(roles_section + `<div class="rp-access-preview"><div class="rp-access-loading">${__('Checking what this grants...')}</div></div>`);
		frappe.call({
			method: 'erp_dacsinc_custom.roles_and_permissions_api.get_role_profile_access_preview',
			args: { role_profiles: [p.profile] },
			callback: (r) => {
				if (!r.message) return;
				this.profile_access_cache[p.profile] = r.message;
				// the admin may have collapsed it again while this was in flight
				if (this.expanded_profile !== p.profile) return;
				$body.html(roles_section + this.build_access_preview_html(r.message));
				this.wire_access_preview_search($body);
			},
		});
	}

	load_doctypes() {
		frappe.call({
			method: 'erp_dacsinc_custom.roles_and_permissions_api.get_doctype_access_overview',
			callback: (r) => {
				this.doctypes_data = r.message;
				this.doctype_access_cache = {};
				this.render_doctype_list();
			},
		});
	}

	// Serves from cache if this doctype's already been looked up this
	// session; otherwise fetches once and caches. Both the card expand and
	// the "N users" pill go through this, so a doctype is never fetched twice.
	fetch_doctype_detail(doctype, done) {
		const cached = this.doctype_access_cache[doctype];
		if (cached) { done(cached); return; }
		frappe.call({
			method: 'erp_dacsinc_custom.roles_and_permissions_api.get_doctype_access_detail',
			args: { doctype },
			callback: (r) => {
				if (!r.message) return;
				this.doctype_access_cache[doctype] = r.message;
				done(r.message);
			},
		});
	}

	render_doctype_list() {
		const all = (this.doctypes_data && this.doctypes_data.doctypes) || [];
		const search = this.doctype_search || '';
		const $out = this.$body.find('.rp-doctypes-list').empty();

		if (!search) {
			// 495 doctypes on a real ERPNext site — dumping all of them by
			// default would bury the one the admin is looking for. This tab
			// exists specifically for "I know the name, show me who has it."
			this.$body.find('.rp-doctype-count').text(__('{0} doctypes have some role access', [all.length]));
			$out.html(`<div class="rp-access-preview-idle">${__('Type a doctype name above to see who can access it.')}</div>`);
			return;
		}

		const list = all.filter((d) => d.doctype.toLowerCase().includes(search));
		this.$body.find('.rp-doctype-count').text(__('{0} of {1} doctypes', [list.length, all.length]));

		if (!list.length) {
			$out.html(`<div class="rp-access-empty">${__('No doctype matches that search')}</div>`);
			return;
		}

		// A broad term ("e", "order") can still match dozens — cap the DOM,
		// not the search: narrowing the term finds the rest.
		const CAP = 60;
		const capped = list.slice(0, CAP);

		capped.forEach((d) => {
			const is_open = this.expanded_doctype === d.doctype;
			const $row = $(`<div class="rp-profile-card ${is_open ? 'is-open' : ''}">
				<div class="rp-profile-card-head">
					<span class="rp-expand-btn ${is_open ? 'is-open' : ''}">${RP_ICONS.chevron}</span>
					<span class="rp-profile-card-name">${frappe.utils.escape_html(d.doctype)}</span>
					<span class="rp-profile-card-meta">
						<span class="rp-meta-pill ${d.role_count ? '' : 'rp-meta-zero'}">${__('{0} roles', [d.role_count])}</span>
						<span class="rp-meta-pill rp-meta-pill-link ${d.user_count ? '' : 'rp-meta-zero'}" title="${__('See who has access')}">${__('{0} users', [d.user_count])}</span>
					</span>
				</div>
				<div class="rp-profile-card-body" ${is_open ? '' : 'style="display:none;"'}></div>
			</div>`);

			$row.find('.rp-profile-card-head').on('click', () => this.toggle_doctype(d));
			$row.find('.rp-meta-pill-link').on('click', (e) => {
				e.stopPropagation();
				if (!d.user_count) return;
				this.fetch_doctype_detail(d.doctype, (detail) => {
					this.show_doctype_users_dialog(d.doctype, detail.users);
				});
			});
			$out.append($row);

			if (is_open) this.fill_doctype_card($row, d);
		});

		if (list.length > capped.length) {
			$out.append(`<div class="rp-access-note">${__('Showing the first {0} matches — narrow your search to see the rest.', [CAP])}</div>`);
		}
	}

	toggle_doctype(d) {
		this.expanded_doctype = this.expanded_doctype === d.doctype ? null : d.doctype;
		this.render_doctype_list();
	}

	fill_doctype_card($row, d) {
		const $body = $row.find('.rp-profile-card-body');
		$body.html(`<div class="rp-access-preview"><div class="rp-access-loading">${__('Checking access...')}</div></div>`);
		this.fetch_doctype_detail(d.doctype, (detail) => {
			// the admin may have collapsed it again while this was in flight
			if (this.expanded_doctype !== d.doctype) return;
			$body.html(this.build_doctype_detail_html(detail));
			this.wire_role_search($body);
		});
	}

	// A doctype like Sales Order can have 24+ roles granting it — past
	// roughly a screenful that's a wall to scan, not a list, so only show
	// the filter box once there's actually something worth filtering.
	build_doctype_detail_html(detail) {
		const roles = detail.roles || [];
		if (!roles.length) {
			return `<div class="rp-subsection">
				<div class="rp-subsection-title">${__('Roles with access')}</div>
				<div class="rp-access-empty">${__('No role currently grants any access to this doctype.')}</div>
			</div>`;
		}
		const rows = roles.map((r) => `<div class="rp-access-item" data-role="${frappe.utils.escape_html(r.role.toLowerCase())}">
			<span class="rp-access-doctype" title="${frappe.utils.escape_html(r.role)}">${frappe.utils.escape_html(r.role)}</span>
			<span class="rp-access-flags">${rp_perm_flags(r.permissions)}</span>
		</div>`).join('');

		return `<div class="rp-subsection">
			<div class="rp-subsection-head">
				<div class="rp-subsection-title">${__('Roles with access ({0})', [roles.length])}</div>
				${roles.length > 8 ? rp_search_input('rp-role-search', __('Filter roles...')) : ''}
			</div>
			<div class="rp-access-group-items">${rows}</div>
			<div class="rp-role-search-empty" style="display:none;">${__('No role matches that search')}</div>
			<div class="rp-access-legend">${rp_perm_legend()}</div>
		</div>`;
	}

	// Simpler cousin of wire_access_preview_search — a flat item list, no
	// groups to collapse, filtering by role name instead of doctype name.
	wire_role_search($wrapper) {
		const $input = $wrapper.find('.rp-role-search');
		$input.on('input', frappe.utils.debounce(() => {
			const term = ($input.val() || '').toLowerCase();
			let any_visible = false;
			$wrapper.find('.rp-access-item').each(function () {
				const match = !term || ($(this).attr('data-role') || '').includes(term);
				$(this).toggle(match);
				if (match) any_visible = true;
			});
			$wrapper.find('.rp-role-search-empty').toggle(!!term && !any_visible);
		}, 120));
	}

	// Clicking a name expands it in place to show exactly what THAT user
	// gets and which of their roles is the reason — a flat "71 users" list
	// doesn't say who gets read-only vs full CRUD, this does.
	show_doctype_users_dialog(doctype, users) {
		const d = new frappe.ui.Dialog({
			title: __('Users with access to {0}', [doctype]),
			size: 'small',
			fields: [{ fieldname: 'users_area', fieldtype: 'HTML' }],
		});
		d.show();
		const $wrapper = d.get_field('users_area').$wrapper;
		$wrapper.html(this.build_doctype_user_rows_html(doctype, users));
		this.wire_doctype_user_rows($wrapper, doctype);
	}

	build_doctype_user_rows_html(doctype, users) {
		if (!users.length) {
			return `<div class="rp-access-empty">${__('No users currently have access to {0}.', [doctype])}</div>`;
		}
		const rows = users.map((u) => {
			const initials = (u.full_name || u.name)
				.split(' ').map((s) => s[0]).filter(Boolean).slice(0, 2).join('').toUpperCase();
			const color = RP_AVATAR_PALETTE[Math.abs(this.hash_string(u.name)) % RP_AVATAR_PALETTE.length];
			return `<div class="rp-doctype-user-card">
				<div class="rp-profile-user-row rp-doctype-user-row ${u.enabled ? '' : 'rp-profile-user-disabled'}" data-user="${frappe.utils.escape_html(u.name)}">
					<span class="rp-expand-btn">${RP_ICONS.chevron}</span>
					<div class="rp-avatar rp-avatar-sm" style="background:${color};">${initials || '?'}</div>
					<div class="rp-user-text">
						<div class="rp-user-name">${frappe.utils.escape_html(u.full_name || u.name)}</div>
						<div class="rp-user-email">${frappe.utils.escape_html(u.name)}</div>
					</div>
					${u.enabled ? '' : `<span class="rp-status-pill rp-status-off">${__('Disabled')}</span>`}
				</div>
				<div class="rp-doctype-user-access"></div>
			</div>`;
		}).join('');
		return `
			<p class="text-muted small" style="margin-bottom:10px;">${__('Click a user to see exactly what they can do on {0}.', [doctype])}</p>
			<div class="rp-profile-user-list">${rows}</div>
		`;
	}

	wire_doctype_user_rows($wrapper, doctype) {
		const loaded = new Set();
		$wrapper.find('.rp-doctype-user-card').each((_, cardEl) => {
			const $card = $(cardEl);
			const user = $card.find('.rp-doctype-user-row').attr('data-user');

			$card.find('.rp-doctype-user-row').on('click', () => {
				$card.toggleClass('is-open');
				$card.find('.rp-expand-btn').toggleClass('is-open');
				if (loaded.has(user)) return;
				loaded.add(user);

				const $access = $card.find('.rp-doctype-user-access');
				$access.html(`<div class="rp-access-loading">${__('Checking access...')}</div>`);
				frappe.call({
					method: 'erp_dacsinc_custom.roles_and_permissions_api.get_user_access_for_doctype',
					args: { user, doctype },
					callback: (r) => {
						if (!r.message) return;
						$access.html(this.build_user_doctype_access_html(r.message));
					},
				});
			});
		});
	}

	// Merged flags alone don't say WHICH role gives WHAT — two roles with
	// different tiers collapse into one flag row with no way to tell them
	// apart. Show the merged result as a one-line summary, then break it
	// back down per role underneath using the exact same item/flag markup
	// as the doctype's own "Roles with access" list, so the two read as
	// the same information from two directions instead of two different UIs.
	build_user_doctype_access_html(detail) {
		const perms = detail.permissions || {};
		const roles = detail.roles || [];
		if (!Object.keys(perms).length) {
			return `<div class="text-muted small">${__('No access found — this user may have lost the granting role since this list loaded.')}</div>`;
		}

		const roles_html = roles.map((r) => `<div class="rp-access-item">
			<span class="rp-access-doctype" title="${frappe.utils.escape_html(r.role)}">${frappe.utils.escape_html(r.role)}</span>
			<span class="rp-access-flags">${rp_perm_flags(r.permissions)}</span>
		</div>`).join('');

		return `
			<div class="rp-doctype-user-summary">
				<span class="rp-doctype-user-summary-label">${__('Overall access')}</span>
				<span class="rp-access-flags">${rp_perm_flags(perms)}</span>
			</div>
			<div class="rp-doctype-user-via-label">${__('Granted through {0} role(s):', [roles.length])}</div>
			<div class="rp-access-group-items">${roles_html}</div>
		`;
	}

	populate_profile_filter() {
		const $sel = this.$body.find('.rp-filter-profile');
		const current = $sel.val();
		$sel.find('option').slice(2).remove();
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
			this.stat_card('users', total, __('Total Users'), '#2490ef'),
			this.stat_card('check_circle', enabled, __('Enabled'), '#29a745'),
			this.stat_card('x_circle', disabled, __('Disabled'), '#e24c4c'),
			this.stat_card('layers', multi, __('Multiple Profiles'), '#8e5ce6'),
			this.stat_card('alert', unassigned, __('No Profile Assigned'), '#f0932b'),
		].join(''));
	}

	hash_string(str) {
		let hash = 0;
		for (let i = 0; i < str.length; i++) {
			hash = str.charCodeAt(i) + ((hash << 5) - hash);
		}
		return hash;
	}

	stat_card(icon, value, label, color) {
		const style = color ? ` style="--rp-stat-color:${color};"` : '';
		return `<div class="rp-stat-card"${style}>
			<div class="rp-stat-icon">${RP_ICONS[icon]}</div>
			<div class="rp-stat-text">
				<div class="rp-stat-value">${value}</div>
				<div class="rp-stat-label">${label}</div>
			</div>
		</div>`;
	}

	get_filtered_users() {
		const { search, profile, status } = this.filters;
		return this.data.users.filter((u) => {
			if (search) {
				const hay = `${u.full_name || ''} ${u.user}`.toLowerCase();
				if (!hay.includes(search)) return false;
			}
			if (profile === RP_NO_PROFILE_FILTER) {
				if (u.role_profiles.length) return false;
			} else if (profile && !u.role_profiles.includes(profile)) {
				return false;
			}
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
		const is_open = this.expanded.has(row.user);

		const locked = !row.enabled;
		const locked_attr = locked ? 'disabled title="' + __('Enable this user first to make changes') + '"' : '';
		const password_icon = this.data.is_system_manager ? 'lock' : 'mail';
		const password_label = this.data.is_system_manager ? __('Password') : __('Reset Link');
		const password_title = this.data.is_system_manager
			? __('Set a new password for this user')
			: __('Email this user a password reset link');

		const $tr = $(`<tr class="rp-user-row ${locked ? 'rp-user-locked' : ''}">
			<td><span class="rp-expand-btn ${is_open ? 'is-open' : ''}">${RP_ICONS.chevron}</span></td>
			<td>
				<div class="rp-user-cell">
					<div class="rp-avatar" style="background:${avatar_color};">${initials || '?'}</div>
					<div class="rp-user-text">
						<div class="rp-user-name">${frappe.utils.escape_html(row.full_name || row.user)}</div>
						<div class="rp-user-email">${frappe.utils.escape_html(row.user)}</div>
					</div>
				</div>
			</td>
			<td>${profiles}</td>
			<td>
				<div class="rp-status-cell">
					<label class="rp-switch" title="${row.enabled ? __('Click to disable this user') : __('Click to enable this user')}">
						<input type="checkbox" class="rp-status-switch" ${row.enabled ? 'checked' : ''}>
						<span class="rp-switch-track"><span class="rp-switch-thumb"></span></span>
					</label>
					<span class="rp-status-text ${row.enabled ? 'is-on' : 'is-off'}">${row.enabled ? __('Enabled') : __('Disabled')}</span>
				</div>
			</td>
			<td class="text-muted small">${row.last_login ? frappe.datetime.comment_when(row.last_login) : __('Never')}</td>
			<td class="rp-actions">
				<div class="rp-action-row">
					${rp_action_btn('rp-edit-profile-fields', 'edit', __('Profile'), __('Edit name, phone and other profile details'), locked_attr, 'rp-btn-blue')}
					${rp_action_btn('rp-edit-profiles', 'shield', __('Roles'), __('Add or remove Role Profiles'), locked_attr, 'rp-btn-blue')}
					${rp_action_btn('rp-reset-password', password_icon, password_label, password_title, locked_attr, 'rp-btn-amber')}
					${rp_action_btn('rp-delete-user', 'trash', __('Delete'), __('Permanently delete this user'), '', 'rp-btn-red')}
				</div>
			</td>
		</tr>`);

		$tr.on('click', (e) => {
			if ($(e.target).closest('.rp-actions, .rp-status-cell').length) return;
			this.toggle_access_row(row);
		});
		$tr.find('.rp-edit-profile-fields').on('click', () => this.show_edit_profile_fields_dialog(row));
		$tr.find('.rp-edit-profiles').on('click', () => this.show_edit_profiles_dialog(row));
		$tr.find('.rp-reset-password').on('click', () => this.handle_password_action(row));
		$tr.find('.rp-status-switch').on('change', () => this.toggle_enabled(row));
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

	build_overview_html(row) {
		const f = row.profile_fields || {};
		const detail = (label, value) => `<div class="rp-detail-item">
			<div class="rp-detail-label">${label}</div>
			<div class="rp-detail-value ${value ? '' : 'rp-empty'}">${value ? frappe.utils.escape_html(String(value)) : __('Not set')}</div>
		</div>`;

		return `
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
		`;
	}

	build_roles_html(row) {
		const profiles_html = row.profile_summaries.length
			? row.profile_summaries.map((p, i) => {
				const roles_html = (p.roles || []).map((r) => `<span class="rp-role-chip">${frappe.utils.escape_html(r)}</span>`).join('');
				return `
					<div class="rp-profile-detail-row rp-profile-toggle" data-profile-idx="${i}">
						<span class="rp-expand-btn">${RP_ICONS.chevron}</span>
						<span class="rp-profile-chip ${row.managed_by_multi_profile ? '' : 'rp-native'}">${frappe.utils.escape_html(p.profile)}</span>
						<span class="text-muted small">${frappe.utils.escape_html(p.summary || '')}</span>
					</div>
					<div class="rp-profile-roles-list" data-profile-roles-idx="${i}">${roles_html || `<span class="text-muted small">${__('No roles')}</span>`}</div>
				`;
			}).join('')
			: `<span class="rp-no-profile">${__('No Role Profile assigned yet')}</span>`;

		const locked = !row.enabled;
		const remove_attr = locked ? `disabled title="${__('Enable this user first to make changes')}"` : `title="${__('Remove this role')}"`;
		const extra_roles_html = (row.extra_roles || []).length
			? row.extra_roles.map((r) => `
				<span class="rp-role-chip rp-role-chip-extra" title="${__('Assigned directly — not part of any Role Profile')}">
					${frappe.utils.escape_html(r)}
					<button type="button" class="rp-role-remove" data-role="${frappe.utils.escape_html(r)}" ${remove_attr}>&times;</button>
				</span>
			`).join('')
			: `<span class="text-muted small">${__('None')}</span>`;

		return `
			<div class="rp-subsection">
				<div class="rp-subsection-title">${__('Role Profile(s) Selected')}</div>
				<div class="rp-profile-detail-list">${profiles_html}</div>
			</div>
			<div class="rp-subsection">
				<div class="rp-subsection-title">${__('Additional Roles')} <span class="rp-flag-badge" title="${__('Roles assigned directly to this user, outside any Role Profile')}">${__('extra')}</span></div>
				<div class="rp-extra-roles-list">${extra_roles_html}</div>
			</div>
		`;
	}

	build_access_row(row) {
		const $tr = $(`<tr class="rp-access-row"><td colspan="6">
			<div class="rp-access-panel">
				<div class="rp-tabs">
					<button type="button" class="rp-tab is-active" data-tab="overview">${__('Overview')}</button>
					<button type="button" class="rp-tab" data-tab="roles">${__('Roles & Access')}</button>
					<button type="button" class="rp-tab" data-tab="permissions">${__('Doctype Access')}</button>
				</div>
				<div class="rp-tab-panel" data-tab-panel="overview">${this.build_overview_html(row)}</div>
				<div class="rp-tab-panel" data-tab-panel="roles" style="display:none;">${this.build_roles_html(row)}</div>
				<div class="rp-tab-panel" data-tab-panel="permissions" style="display:none;">
					<div class="rp-access-controls">
						${rp_search_input('rp-access-filter', __('Filter doctypes...'))}
						<label class="rp-access-keyonly" title="${__('Hide supporting doctypes like Currency, UOM and tax templates, which come along with the main grants')}">
							<input type="checkbox" class="rp-access-key-toggle" checked>
							<span>${__('Main doctypes only')}</span>
						</label>
					</div>
					<div class="rp-access-body"><div class="rp-access-loading">${__('Loading access...')}</div></div>
				</div>
			</div>
		</td></tr>`);

		$tr.find('.rp-tab').on('click', function () {
			const tab = $(this).attr('data-tab');
			$tr.find('.rp-tab').removeClass('is-active');
			$(this).addClass('is-active');
			$tr.find('.rp-tab-panel').hide();
			$tr.find(`.rp-tab-panel[data-tab-panel="${tab}"]`).show();
		});

		$tr.find('.rp-profile-toggle').on('click', function () {
			const idx = $(this).attr('data-profile-idx');
			const $list = $tr.find(`.rp-profile-roles-list[data-profile-roles-idx="${idx}"]`);
			$(this).find('.rp-expand-btn').toggleClass('is-open');
			$list.toggleClass('is-open');
		});

		$tr.find('.rp-role-remove').on('click', (e) => {
			const role = $(e.currentTarget).attr('data-role');
			frappe.confirm(
				__('Remove the {0} role from {1}? This does not touch their Role Profile(s).', [role, row.user]),
				() => {
					frappe.call({
						method: 'erp_dacsinc_custom.roles_and_permissions_api.toggle_user_role',
						args: { user: row.user, role, enabled: 0 },
						freeze: true,
						callback: () => {
							frappe.show_alert({ message: __('Role removed'), indicator: 'green' });
							delete this.access_cache[row.user];
							this.refresh();
						},
					});
				}
			);
		});

		const render_grid = (doctypes, filterText) => {
			const $out = $tr.find('.rp-access-body');
			const key_only = $tr.find('.rp-access-key-toggle').is(':checked');
			let filtered = key_only ? doctypes.filter((d) => d.is_key) : doctypes;
			const hidden = doctypes.length - filtered.length;
			if (filterText) {
				filtered = filtered.filter((d) => d.doctype.toLowerCase().includes(filterText));
			}
			if (!filtered.length) {
				$out.html(`<div class="rp-access-empty">${__('No doctype access found')}</div>`);
				return;
			}
			const items = filtered.map((d) => `<div class="rp-access-item">
				<span class="rp-access-doctype" title="${frappe.utils.escape_html(d.doctype)}">${frappe.utils.escape_html(d.doctype)}</span>
				<span class="rp-access-flags">${rp_perm_flags(d.permissions)}</span>
			</div>`).join('');
			$out.html(`
				<div class="rp-access-grid">${items}</div>
				<div class="rp-access-legend">
					${rp_perm_legend()} &nbsp;•&nbsp;
					<span class="rp-flag rp-flag-full" style="width:auto;padding:0 5px;">${__('full')}</span>
					<span class="rp-flag rp-flag-owner" style="width:auto;padding:0 5px;">${__('own records only')}</span>
				</div>
				${key_only && hidden ? `<div class="rp-access-note">${__('{0} supporting doctypes hidden — untick "Main doctypes only" to see them.', [hidden])}</div>` : ''}
			`);
		};

		const rerender = () => render_grid(
			this.access_cache[row.user] || [],
			($tr.find('.rp-access-filter').val() || '').toLowerCase()
		);

		if (this.access_cache[row.user]) {
			render_grid(this.access_cache[row.user], '');
		} else {
			frappe.call({
				method: 'erp_dacsinc_custom.roles_and_permissions_api.get_user_doctype_access',
				args: { user: row.user },
				callback: (r) => {
					this.access_cache[row.user] = r.message.doctypes;
					rerender();
				},
			});
		}

		$tr.find('.rp-access-filter').on('input', frappe.utils.debounce(rerender, 150));
		$tr.find('.rp-access-key-toggle').on('change', rerender);

		return $tr;
	}

	// "If I give someone this profile, what can they actually do?" — the
	// curated main doctypes only. Supporting doctypes (Customer, tax
	// templates, UOM, Currency...) ride along with the main grant and are
	// reported as a count, not a list, so the lines that matter stay visible.
	build_access_preview_html(data) {
		const groups = data.groups || [];
		const header = `<div class="rp-subsection-title">${__('Access this grants')}</div>`;

		if (!groups.length) {
			return `<div class="rp-access-preview">${header}
				<div class="rp-access-empty">${__('No access to any of the main business doctypes.')}</div>
			</div>`;
		}

		// data-doctype carries the full, untruncated name to filter against —
		// the visible label can be clipped by CSS ellipsis, the filter never is.
		const body = groups.map((g) => `
			<div class="rp-access-group">
				<div class="rp-access-group-title">${__(g.group)}</div>
				<div class="rp-access-group-items">
					${g.doctypes.map((d) => `<div class="rp-access-item" data-doctype="${frappe.utils.escape_html(d.doctype.toLowerCase())}">
						<span class="rp-access-doctype" title="${frappe.utils.escape_html(d.doctype)}">${frappe.utils.escape_html(d.doctype)}</span>
						<span class="rp-access-flags">${rp_perm_flags(d.permissions)}</span>
					</div>`).join('')}
				</div>
			</div>`).join('');

		const footer = data.supporting_count
			? `<div class="rp-access-note">${__('Plus {0} supporting doctypes (Item Group, Currency, tax templates and similar) that come along automatically with the grants above.', [data.supporting_count])}</div>`
			: '';

		return `<div class="rp-access-preview">
			<div class="rp-subsection-head">
				${header}
				${rp_search_input('rp-access-search', __('Filter doctypes...'))}
			</div>
			<div class="rp-access-groups">${body}</div>
			<div class="rp-access-search-empty" style="display:none;">${__('No doctype matches that search')}</div>
			<div class="rp-access-legend">${rp_perm_legend()}</div>
			${footer}
		</div>`;
	}

	// Purely client-side: everything's already on the page, so filtering
	// hides/shows instead of re-fetching. Call after every .html() that
	// used build_access_preview_html — the search box is inert until wired.
	wire_access_preview_search($wrapper) {
		const $input = $wrapper.find('.rp-access-search');
		$input.on('input', frappe.utils.debounce(() => {
			const term = ($input.val() || '').toLowerCase();
			let any_visible = false;
			$wrapper.find('.rp-access-group').each(function () {
				const $group = $(this);
				let group_has_match = false;
				$group.find('.rp-access-item').each(function () {
					const match = !term || ($(this).attr('data-doctype') || '').includes(term);
					$(this).toggle(match);
					if (match) group_has_match = true;
				});
				$group.toggle(group_has_match);
				if (group_has_match) any_visible = true;
			});
			$wrapper.find('.rp-access-search-empty').toggle(!!term && !any_visible);
		}, 120));
	}

	show_edit_profiles_dialog(row) {
		// `let`, not `const`: the field's onchange can fire while the Dialog
		// constructor is still running, and reading a `const` before its
		// assignment throws instead of being undefined.
		let d;
		const starting = row.role_profiles || [];

		// The MultiSelectList control collapses to "N values selected", which
		// says nothing about WHICH profiles those are — mirror the live
		// selection as chips underneath it.
		const render_selection = () => {
			if (!d) return;
			const selected = d.get_value('role_profiles') || [];
			const chips = selected.length
				? selected.map((p) => {
					const is_new = !starting.includes(p);
					return `<span class="rp-profile-chip${is_new ? ' rp-chip-added' : ''}">${frappe.utils.escape_html(p)}${is_new ? ' <b>+</b>' : ''}</span>`;
				}).join('')
				: `<span class="rp-no-profile">${__('Nothing selected — this user would be left with no profile-based access')}</span>`;
			const dropped = starting.filter((p) => !selected.includes(p));
			const dropped_html = dropped.length
				? `<div class="rp-selected-dropped">${__('Will be removed:')} ${dropped.map((p) => `<span class="rp-profile-chip rp-chip-removed">${frappe.utils.escape_html(p)}</span>`).join('')}</div>`
				: '';

			d.get_field('selected_preview').$wrapper.html(`
				<div class="rp-selected-preview">
					<div class="rp-subsection-title">${__('Selected ({0})', [selected.length])}</div>
					<div class="rp-selected-chips">${chips}</div>
					${dropped_html}
				</div>
			`);
		};

		const render_access = frappe.utils.debounce(() => {
			if (!d) return;
			const selected = d.get_value('role_profiles') || [];
			const $wrapper = d.get_field('access_preview').$wrapper;

			if (!selected.length) {
				$wrapper.html(`<div class="rp-access-preview rp-access-preview-idle">${__('Pick a Role Profile above to see exactly what access it grants.')}</div>`);
				return;
			}
			$wrapper.html(`<div class="rp-access-preview"><div class="rp-access-loading">${__('Checking what this grants...')}</div></div>`);

			frappe.call({
				method: 'erp_dacsinc_custom.roles_and_permissions_api.get_role_profile_access_preview',
				args: { role_profiles: selected },
				callback: (r) => {
					if (!r.message) return;
					// Ticking several profiles quickly fires several requests;
					// drop any that comes back for a selection we've moved on from.
					const current = d.get_value('role_profiles') || [];
					if (current.join('\u0000') !== selected.join('\u0000')) return;
					$wrapper.html(this.build_access_preview_html(r.message));
					this.wire_access_preview_search($wrapper);
				},
			});
		}, 250);

		d = new frappe.ui.Dialog({
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
					onchange: () => { render_selection(); render_access(); },
				},
				{ fieldname: 'selected_preview', fieldtype: 'HTML' },
				{ fieldname: 'access_preview', fieldtype: 'HTML' },
			],
			primary_action_label: __('Save'),
			primary_action: (values) => {
				const next = values.role_profiles || [];
				const current = row.role_profiles || [];
				const added = next.filter((p) => !current.includes(p));
				const removed = current.filter((p) => !next.includes(p));

				if (!added.length && !removed.length) {
					d.hide();
					return;
				}

				// Same "show exactly what will change before touching anything"
				// contract the DAC Matrix dialog holds to — this is the action
				// on this page that most changes what someone can see and do.
				const lines = added.map((p) => `<li>+ <b>${frappe.utils.escape_html(p)}</b></li>`)
					.concat(removed.map((p) => `<li>&minus; ${frappe.utils.escape_html(p)} <span class="text-muted">${__('(removed)')}</span></li>`))
					.join('');

				frappe.confirm(
					`<p>${__('Apply these Role Profile changes for {0}?', [`<b>${frappe.utils.escape_html(row.user)}</b>`])}</p>
					<ul class="small">${lines}</ul>
					<p class="small text-muted">${__('This changes what they can see and do across the system.')}</p>`,
					() => {
						frappe.call({
							method: 'erp_dacsinc_custom.roles_and_permissions_api.update_user_role_profiles',
							args: { user: row.user, role_profiles: next },
							freeze: true,
							callback: () => {
								d.hide();
								frappe.show_alert({ message: __('Role profiles updated'), indicator: 'green' });
								delete this.access_cache[row.user];
								this.refresh();
							},
						});
					}
				);
			},
		});
		d.set_value('role_profiles', starting);
		render_selection();
		render_access();
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
					description: __('This sets a brand new password — the existing one can never be viewed, by anyone, at any permission level. Saving this also signs the user out of every active session.'),
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
		const turning_off = !!row.enabled;
		const who = frappe.utils.escape_html(row.full_name || row.user);
		const message = turning_off
			? `<p>${__('Disable {0}?', [`<b>${who}</b>`])}</p>
				<p class="small text-muted">${__('They lose access immediately and cannot log in until re-enabled. Their profile and roles stay untouched.')}</p>`
			: `<p>${__('Enable {0}?', [`<b>${who}</b>`])}</p>
				<p class="small text-muted">${__('They will be able to log in again with the roles they already have.')}</p>`;

		frappe.confirm(
			message,
			() => {
				frappe.call({
					method: 'erp_dacsinc_custom.roles_and_permissions_api.set_user_enabled',
					args: { user: row.user, enabled: turning_off ? 0 : 1 },
					freeze: true,
					callback: () => this.refresh(),
					error: () => this.render(),
				});
			},
			// The switch flips the moment it's clicked, before anyone has agreed
			// to it — re-render from unchanged local data so dismissing this
			// puts it back instead of showing a state that never happened.
			() => this.render()
		);
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

	show_sync_dac_matrix_dialog() {
		const summary = `
			<h4>${__('Rebuild Permissions & Sync Users')}</h4>
			<p>${__('This action will run the following synchronization procedure:')}</p>
			<ol class="small">
				<li><b>${__('Re-apply Custom DocPerms')}</b>: ${__('Rebuilds and merges all custom doctype, report, and dashboard permissions from the spreadsheet definition matrix.')}</li>
				<li><b>${__('Update User Profiles')}</b>: ${__("Syncs and overwrites each matched employee's Role Profile to exactly match the proposed role profile in the spreadsheet.")}</li>
			</ol>
			<p class="text-danger"><b>${__('Warning:')}</b> ${__("Any additional manually-assigned Role Profiles on these matched users will be overwritten to match the spreadsheet source of truth.")}</p>
			<p>${__('Are you sure you want to run this full synchronization?')}</p>
		`;

		frappe.confirm(summary, () => {
			frappe.call({
				method: 'erp_dacsinc_custom.roles_and_permissions_api.sync_dac_matrix_and_users',
				freeze: true,
				freeze_message: __('Synchronizing roles, permissions, and users...'),
				callback: (r) => {
					if (!r.message) return;
					const updated = r.message.updated || [];
					const skipped = r.message.skipped || [];

					let msg = `<b>${updated.length}</b> ${__('user(s) successfully synced.')}`;
					if (updated.length) {
						const up_items = updated
							.map((u) => `<li><b>${frappe.utils.escape_html(u.employee_name || u.user)}</b>: ${frappe.utils.escape_html(u.previous.join(', ') || 'none')} &rarr; <b>${frappe.utils.escape_html(u.profile)}</b></li>`)
							.join('');
						msg += `<br><ul class="small">${up_items}</ul>`;
					}

					if (skipped.length) {
						const sk_items = skipped
							.map((u) => `<li>${frappe.utils.escape_html(u.employee_name || u.user)} — ${frappe.utils.escape_html(u.reason)}</li>`)
							.join('');
						msg += `<hr><b>${__('Skipped / Failed')}:</b><ul class="small">${sk_items}</ul>`;
					}

					frappe.msgprint({
						title: __('Synchronization Complete'),
						message: msg,
						indicator: updated.length ? 'green' : 'orange',
						wide: true,
					});

					this.refresh();
				}
			});
		});
	}
}

