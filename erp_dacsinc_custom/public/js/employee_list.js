// Adds "Allocate Monthly Leaves" to the Employee list view.
// Picks a month, lists every employee with an eligibility verdict, and
// allocates 1 SL + 1 CL to the ticked ones. All validation is server-side.

frappe.listview_settings["Employee"] = frappe.listview_settings["Employee"] || {};

const _existing_onload = frappe.listview_settings["Employee"].onload;

frappe.listview_settings["Employee"].onload = function (listview) {
	if (_existing_onload) _existing_onload(listview);

	listview.page.add_inner_button(__("Allocate Monthly Leaves"), () => {
		show_leave_allocation_dialog();
	});
};

function show_leave_allocation_dialog() {
	const today = frappe.datetime.str_to_obj(frappe.datetime.get_today());
	const months = [
		"January", "February", "March", "April", "May", "June",
		"July", "August", "September", "October", "November", "December",
	];

	const dialog = new frappe.ui.Dialog({
		title: __("Allocate Monthly Leaves"),
		size: "large",
		fields: [
			{
				fieldname: "year",
				label: __("Year"),
				fieldtype: "Select",
				options: ["2025", "2026", "2027", "2028", "2029", "2030"],
				default: String(today.getFullYear()),
				reqd: 1,
				onchange: () => load_employees(dialog),
			},
			{ fieldtype: "Column Break" },
			{
				fieldname: "month",
				label: __("Month"),
				fieldtype: "Select",
				options: months,
				default: months[today.getMonth()],
				reqd: 1,
				onchange: () => load_employees(dialog),
			},
			{ fieldtype: "Section Break" },
			{ fieldname: "employees_area", fieldtype: "HTML" },
		],
		primary_action_label: __("Allocate Leaves"),
		primary_action: () => allocate(dialog),
	});

	dialog.show();
	load_employees(dialog);
}

function load_employees(dialog) {
	const { year, month } = dialog.get_values(true);
	if (!year || !month) return;

	const $area = dialog.get_field("employees_area").$wrapper;
	$area.html(`<div class="text-muted">${__("Loading...")}</div>`);

	frappe.call({
		method: "erp_dacsinc_custom.custom_leave.get_employees_for_month",
		args: { year, month },
		callback: (r) => {
			if (!r.message) return;
			render_employees(dialog, r.message);
		},
	});
}

function render_employees(dialog, data) {
	const $area = dialog.get_field("employees_area").$wrapper;
	const rows = data.employees || [];

	if (!rows.length) {
		$area.html(`<div class="text-muted">${__("No employees found.")}</div>`);
		return;
	}

	const header = `
		<div class="flex justify-between align-center mb-2">
			<div>
				<b>${data.eligible_count}</b> ${__("eligible")} /
				${rows.length} ${__("employees")}
				<span class="text-muted small">
					&nbsp;&mdash;&nbsp; ${data.from_date} ${__("to")} ${data.to_date}
				</span>
			</div>
			<div>
				<button class="btn btn-xs btn-default select-all">${__("Select All")}</button>
				<button class="btn btn-xs btn-default unselect-all">${__("Unselect All")}</button>
			</div>
		</div>`;

	const body = rows
		.map((row) => {
			const disabled = row.eligible ? "" : "disabled";
			const checked = row.eligible ? "checked" : "";
			const muted = row.eligible ? "" : "text-muted";
			const indicator = row.eligible ? "green" : "gray";

			return `
			<div class="employee-row ${muted}"
			     style="display:flex; gap:8px; align-items:center; padding:4px 0;
			            border-bottom:1px solid var(--border-color);">
				<input type="checkbox" class="employee-check" ${checked} ${disabled}
				       data-employee="${frappe.utils.escape_html(row.employee)}">
				<div style="flex:2;">${frappe.utils.escape_html(row.employee_name || "")}</div>
				<div style="flex:1;" class="small">${frappe.utils.escape_html(row.branch || "")}</div>
				<div style="flex:1;" class="small">${frappe.utils.escape_html(row.status || "")}</div>
				<div style="flex:2;">
					<span class="indicator ${indicator} small">
						${frappe.utils.escape_html(row.reason)}
					</span>
				</div>
			</div>`;
		})
		.join("");

	$area.html(`
		${header}
		<div style="max-height:340px; overflow-y:auto; border-top:1px solid var(--border-color);">
			${body}
		</div>`);

	// Select All / Unselect All only touch rows that are actually allocatable.
	$area.find(".select-all").on("click", () => {
		$area.find(".employee-check:not(:disabled)").prop("checked", true);
	});
	$area.find(".unselect-all").on("click", () => {
		$area.find(".employee-check").prop("checked", false);
	});
}

function allocate(dialog) {
	const { year, month } = dialog.get_values(true);
	const $area = dialog.get_field("employees_area").$wrapper;

	const selected = $area
		.find(".employee-check:checked")
		.map((_, el) => $(el).data("employee"))
		.get();

	if (!selected.length) {
		frappe.msgprint(__("Select at least one employee."));
		return;
	}

	frappe.confirm(
		__("Allocate 1 Sick Leave + 1 Casual Leave to {0} employee(s) for {1} {2}?", [
			selected.length,
			month,
			year,
		]),
		() => {
			dialog.set_primary_action(__("Allocating..."), null);
			dialog.get_primary_btn().prop("disabled", true);

			frappe.call({
				method: "erp_dacsinc_custom.custom_leave.allocate_for_employees",
				args: { year, month, employees: selected },
				callback: (r) => {
					dialog.get_primary_btn().prop("disabled", false);
					dialog.set_primary_action(__("Allocate Leaves"), () => allocate(dialog));

					if (!r.message) return;
					show_result(r.message, month, year);
					load_employees(dialog);
				},
				error: () => {
					dialog.get_primary_btn().prop("disabled", false);
					dialog.set_primary_action(__("Allocate Leaves"), () => allocate(dialog));
				},
			});
		}
	);
}

function show_result(result, month, year) {
	const s = result.stats || {};
	let msg = `<b>${__("Created")}: ${s.created || 0}</b> ${__("allocation(s)")}
		${__("for")} ${month} ${year}<br>
		<span class="text-muted small">
			${__("Already allocated")}: ${s.already_present || 0} &nbsp;
			${__("Overlapping")}: ${s.overlapping || 0} &nbsp;
			${__("Failed")}: ${s.failed || 0}
		</span>`;

	if (result.skipped && result.skipped.length) {
		const items = result.skipped
			.map((x) => `<li>${frappe.utils.escape_html(x)}</li>`)
			.join("");
		msg += `<hr><b>${__("Skipped")}</b><ul class="small">${items}</ul>`;
	}

	frappe.msgprint({
		title: __("Allocation Complete"),
		message: msg,
		indicator: s.created ? "green" : "orange",
	});
}
