 (function () {
        console.log("Initializing DAC Executive CRM Dashboard v30 - Unified Stable Build...");

        (function injectModalCSS() {
            const css = `
            .dac-wide-modal .modal-dialog {
                max-width: 95% !important;
                width: 95% !important;
            }
            .dac-wide-modal .dac-modal-scroll-wrap {
                overflow-x: auto !important;
                overflow-y: auto !important;
                width: 100% !important;
                max-width: 100% !important;
            }
            .dac-wide-modal table {
                border-collapse: separate !important;
                border-spacing: 0 !important;
                min-width: 100% !important;
                width: max-content !important;
                table-layout: auto !important;
            }
            .dac-wide-modal th {
                white-space: nowrap !important;
                font-size: 13px !important;
                padding: 10px 14px !important;
                border-right: 1px solid rgba(255,255,255,0.15) !important;
                word-break: keep-all !important;
            }
            .dac-wide-modal td {
                white-space: nowrap !important;
                word-break: normal !important;
                overflow-wrap: normal !important;
                font-size: 13.5px !important;
                padding: 10px 14px !important;
            }
            .dac-wide-modal td.dac-email-cell {
                white-space: normal !important;
                max-width: 180px !important;
                width: 180px !important;
                word-break: break-all !important;
                overflow-wrap: anywhere !important;
            }
            .dac-wide-modal td.dac-notes-cell {
                white-space: normal !important;
                max-width: 250px !important;
                min-width: 180px !important;
                word-break: break-word !important;
                overflow-wrap: anywhere !important;
            }
        `;
            const style = document.createElement('style');
            style.type = 'text/css';
            style.appendChild(document.createTextNode(css));
            document.head.appendChild(style);
        })();

        window.makeTableSortable = function (table) {
            const headers = table.querySelectorAll('thead th');
            headers.forEach((th, index) => {
                th.style.cursor = 'pointer';
                th.style.position = 'relative';
                th.title = 'Click to sort';
                let asc = true;
                th.addEventListener('click', () => {
                    const tbody = table.querySelector('tbody');
                    if (!tbody) return;
                    const rows = Array.from(tbody.querySelectorAll('tr'));

                    rows.sort((a, b) => {
                        const cellA = a.children[index] ? a.children[index].textContent.trim() : '';
                        const cellB = b.children[index] ? b.children[index].textContent.trim() : '';

                        if (cellA === '' || cellA === '-') return 1;
                        if (cellB === '' || cellB === '-') return -1;

                        const numA = parseFloat(cellA.replace(/[^\d.-]/g, ''));
                        const numB = parseFloat(cellB.replace(/[^\d.-]/g, ''));
                        if (!isNaN(numA) && !isNaN(numB)) {
                            return asc ? numA - numB : numB - numA;
                        }

                        return asc ? cellA.localeCompare(cellB) : cellB.localeCompare(cellA);
                    });

                    asc = !asc;
                    rows.forEach(row => tbody.appendChild(row));

                    headers.forEach(h => {
                        const text = h.textContent.replace(/ [▴▾]$/, '');
                        h.textContent = text;
                    });
                    th.textContent = th.textContent + (asc ? ' ▾' : ' ▴');
                });
            });
        };

        function $(selector) {
            if (typeof selector === 'string') {
                if (typeof root_element !== 'undefined' && root_element && root_element.querySelector) {
                    const found = jQuery(root_element).find(selector);
                    if (found.length > 0) return found;
                }
                return jQuery(selector);
            }
            return jQuery(selector);
        }

        function getUserDisplayName(userId) {
            if (!userId || userId === '-') return '-';
            return (window.userFullNameMap && window.userFullNameMap[userId]) || userId;
        }

        function getSelectedOptionText(selectId, defaultText) {
            try {
                const el = (typeof root_element !== 'undefined' && root_element && root_element.querySelector)
                    ? root_element.querySelector(selectId)
                    : document.querySelector(selectId);
                if (el && el.options && el.selectedIndex >= 0) {
                    const txt = el.options[el.selectedIndex].text;
                    if (txt && txt.trim()) return txt.trim();
                }
            } catch (e) { }
            return defaultText || "";
        }

        function showSelect(selector) {
            $(selector).each(function () {
                this.style.setProperty('display', 'inline-block', 'important');
            });
        }

        function hideSelect(selector) {
            $(selector).each(function () {
                this.style.setProperty('display', 'none', 'important');
            });
        }

        function enforceSelectStyles() {
            const root = (typeof root_element !== 'undefined' && root_element && root_element.querySelectorAll) ? root_element : document;
            const selects = root.querySelectorAll('select.dac-select');
            selects.forEach(sel => {
                sel.style.setProperty('appearance', 'none', 'important');
                sel.style.setProperty('-webkit-appearance', 'none', 'important');
                sel.style.setProperty('background-color', '#ffffff', 'important');
                sel.style.setProperty('border', '1px solid #cbd5e1', 'important');
                sel.style.setProperty('border-radius', '6px', 'important');
                sel.style.setProperty('padding', '4px 24px 4px 10px', 'important');
                sel.style.setProperty('font-size', '12px', 'important');
                sel.style.setProperty('font-weight', '500', 'important');
                sel.style.setProperty('color', '#1e293b', 'important');
                sel.style.setProperty('height', '30px', 'important');
                sel.style.setProperty('min-width', '140px', 'important');
                if (sel.style.display !== 'none') {
                    sel.style.setProperty('display', 'inline-block', 'important');
                }
                sel.style.setProperty('width', 'auto', 'important');
                sel.style.setProperty('background-image', 'url("data:image/svg+xml,%3Csvg xmlns=%22http://www.w3.org/2000/svg%22 fill=%22none%22 viewBox=%220 0 24 24%22 stroke=%22%2364748b%22 stroke-width=%222%22%3E%3Cpath stroke-linecap=%22round%22 stroke-linejoin=%22round%22 d=%22M19 9l-7 7-7-7%22/%3E%3C/svg%3E")', 'important');
                sel.style.setProperty('background-repeat', 'no-repeat', 'important');
                sel.style.setProperty('background-position', 'right 8px center', 'important');
                sel.style.setProperty('background-size', '12px', 'important');
                sel.style.setProperty('box-shadow', '0 1px 2px rgba(0,0,0,0.05)', 'important');
                sel.style.setProperty('outline', 'none', 'important');
                sel.style.setProperty('cursor', 'pointer', 'important');
            });
        }

        function fmtVal(v) {
            if (!v || v === 0) return "₹0";
            return "₹" + Number(v).toLocaleString('en-IN');
        }

        const dateRangeControls = {};

        function initFrappeDateRange(wrapperId, ctrlKey, onChangeCallback) {
            const container = $(wrapperId);
            if (!container.length) return null;
            if (dateRangeControls[ctrlKey]) return dateRangeControls[ctrlKey];

            container.html('');
            if (typeof frappe !== 'undefined' && frappe.ui && frappe.ui.form && frappe.ui.form.make_control) {
                try {
                    const ctrl = frappe.ui.form.make_control({
                        df: {
                            fieldtype: 'DateRange',
                            fieldname: ctrlKey,
                            placeholder: '📅 Select Date Range (From - To)',
                            change: function () {
                                onChangeCallback();
                            }
                        },
                        parent: container,
                        render_input: true
                    });
                    dateRangeControls[ctrlKey] = ctrl;

                    const inp = container.find('input');
                    if (inp.length) {
                        inp.css({
                            'height': '30px',
                            'font-size': '12px',
                            'font-weight': '500',
                            'border-radius': '6px',
                            'border': '1px solid #cbd5e1',
                            'padding': '4px 8px',
                            'width': '220px',
                            'box-shadow': '0 1px 2px rgba(0,0,0,0.05)',
                            'color': '#1e293b',
                            'background': '#ffffff'
                        });
                    }
                    return ctrl;
                } catch (e) {
                    console.error("Failed to build DateRange control:", e);
                }
            }
            return null;
        }

        function getDateParams(pVal, wrapperId, ctrlKey) {
            if (pVal !== 'custom') return {};
            const ctrl = dateRangeControls[ctrlKey];
            if (ctrl && ctrl.get_value) {
                const val = ctrl.get_value();
                if (val && Array.isArray(val) && val.length === 2 && val[0] && val[1]) {
                    return { from_date: val[0], to_date: val[1] };
                }
            }
            return {};
        }

        let usersList = [];
        let fiscalYearsList = [];
        let industriesList = [];
        let currentFY = "";

        frappe.call({
            method: "erp_dacsinc_custom.custom_lead.get_crm_dashboard_metadata",
            callback: function (r) {
                if (!r.message) return;
                usersList = r.message.users || [];
                fiscalYearsList = r.message.fiscal_years || [];
                industriesList = r.message.industries || [];
                currentFY = r.message.current_fiscal_year || "";
                window.userFullNameMap = r.message.user_map || {};

                populateFilters();
                loadContactData();
                loadLeadData();
                loadTargetVsActual();
                loadActivityData();
            }
        });

        function updateBreakupOptions(periodId, breakupId) {
            const periodVal = $(periodId).val();
            const breakupSelect = $(breakupId);
            // Default fallback changed to 'daily'
            const currentVal = breakupSelect.val() || 'daily';

            let html = '';
            if (periodVal === 'today') {
                html = `<option value="daily">Daily Breakup</option>`;
            } else if (periodVal === 'this_week') {
                html = `
                <option value="daily">Daily Breakup</option>
                <option value="weekly">Weekly Breakup</option>
            `;
            } else if (periodVal === 'this_month' || periodVal === 'last_month') {
                html = `
                <option value="daily">Daily Breakup</option>
                <option value="weekly">Weekly Breakup</option>
                <option value="monthly">Monthly Breakup</option>
            `;
            } else {
                html = `
                <option value="daily">Daily Breakup</option>
                <option value="weekly">Weekly Breakup</option>
                <option value="monthly">Monthly Breakup</option>
            `;
            }
            breakupSelect.html(html);

            if (breakupSelect.find(`option[value="${currentVal}"]`).length > 0) {
                breakupSelect.val(currentVal);
            } else {
                breakupSelect.val('daily');
            }
        }

        function buildPeriodOptions() {
            return `
            <option value="all">All Time</option>
            <option value="today">Today</option>
            <option value="this_week">This Week</option>
            <option value="this_month">This Month</option>
            <option value="last_month">Last Month</option>
            <option value="this_quarter">This Quarter</option>
            <option value="last_quarter">Last Quarter</option>
            <option value="fiscal_year">Fiscal Year</option>
            <option value="custom">Custom Date Range (Between)</option>
        `;
        }

        function getMonthsOptions() {
            return `
            <option value="">All Months</option>
            <option value="4">April</option><option value="5">May</option><option value="6">June</option>
            <option value="7">July</option><option value="8">August</option><option value="9">September</option>
            <option value="10">October</option><option value="11">November</option><option value="12">December</option>
            <option value="1">January</option><option value="2">February</option><option value="3">March</option>
        `;
        }

        function populateFilters() {
            const is_crm_head = (frappe.user_roles || []).includes('DAC CRM Head');
            let uOptions = "";
            if (is_crm_head) {
                uOptions = `<option value="">All Team Members</option>` + usersList.map(u => `<option value="${u.name}">${u.full_name}</option>`).join('');
            } else {
                uOptions = `<option value="${frappe.session.user}">${frappe.session.user_fullname || frappe.session.user}</option>`;
            }

            // Daily Breakup set as default selected option
            const breakupOptions = `
            <option value="daily" selected>Daily Breakup</option>
            <option value="weekly">Weekly Breakup</option>
            <option value="monthly">Monthly Breakup</option>
        `;
            const indOptions = `<option value="">All Industries</option>` + industriesList.map(i => `<option value="${i.name}">${i.name}</option>`).join('');
            const fyOptions = fiscalYearsList.map(f => `<option value="${f.name}" ${f.name === currentFY ? 'selected' : ''}>${f.name}</option>`).join('');
            const monthOptions = getMonthsOptions();

            $('#c_u_filter').html(uOptions);
            $('#c_i_filter').html(indOptions);
            $('#c_period_sel').html(breakupOptions);
            $('#c_p_filter').html(buildPeriodOptions());
            $('#c_fy_filter').html(fyOptions);
            $('#c_m_filter').html(monthOptions);

            $('#l_u_filter').html(uOptions);
            $('#l_i_filter').html(indOptions);
            $('#l_period_sel').html(breakupOptions);
            $('#l_p_filter').html(buildPeriodOptions());
            $('#l_fy_filter').html(fyOptions);
            $('#l_m_filter').html(monthOptions);

            $('#t_u_filter').html(uOptions);
            $('#t_fy_filter').html(fyOptions);
            $('#t_m_filter').html(monthOptions);

            $('#ea_user_sel').html(uOptions);
            $('#ea_p_filter').html(buildPeriodOptions());
            $('#ea_fy_filter').html(fyOptions);
            $('#ea_m_filter').html(monthOptions);
            $('#ea_period_sel').html(breakupOptions);
            $('#ea_entity_sel').html(`
            <option value="All">All Entities (Lead &amp; Contact)</option>
            <option value="Lead">Lead Only</option>
            <option value="Business Contacts">Contact Only</option>
        `);

            if (!is_crm_head) {
                hideSelect('#c_u_filter');
                hideSelect('#l_u_filter');
                hideSelect('#t_u_filter');
                hideSelect('#ea_user_sel');
            } else {
                $('#dac_export_bar').css('display', 'flex');
            }
            updateBreakupOptions('#c_p_filter', '#c_period_sel');
            updateBreakupOptions('#l_p_filter', '#l_period_sel');
            updateBreakupOptions('#ea_p_filter', '#ea_period_sel');

            $('#c_p_filter').val('all');
            hideSelect('#c_fy_filter');
            hideSelect('#c_m_filter');

            $('#l_p_filter').val('all');
            hideSelect('#l_fy_filter');
            hideSelect('#l_m_filter');

            $('#ea_p_filter').val('all');
            hideSelect('#ea_fy_filter');
            hideSelect('#ea_m_filter');

            $('#dac_export_excel_btn').show();

            enforceSelectStyles();
            setupEventListeners();
        }

        function getContactArgs(rowMonth) {
            const pVal = $('#c_p_filter').val();
            let datePart = {};
            if (pVal === 'custom') {
                datePart = getDateParams(pVal, '#c_custom_dates_wrap', 'c_dr');
            } else if (pVal === 'fiscal_year') {
                datePart = {
                    fiscal_year: $('#c_fy_filter').val(),
                    month: rowMonth || $('#c_m_filter').val() || ''
                };
            } else {
                datePart = parsePeriodArg(pVal);
            }
            if (rowMonth) {
                delete datePart.period;
                delete datePart.from_date;
                delete datePart.to_date;
                delete datePart.month;
            }
            return {
                user: $('#c_u_filter').val() || '',
                industry: $('#c_i_filter').val() || '',
                period_type: $('#c_period_sel').val() || 'daily',
                ...datePart,
                month: rowMonth || $('#c_m_filter').val() || datePart.month || ''
            };
        }

        function getLeadArgs(rowMonth) {
            const pVal = $('#l_p_filter').val();
            let datePart = {};
            if (pVal === 'custom') {
                datePart = getDateParams(pVal, '#l_custom_dates_wrap', 'l_dr');
            } else if (pVal === 'fiscal_year') {
                datePart = {
                    fiscal_year: $('#l_fy_filter').val(),
                    month: rowMonth || $('#l_m_filter').val() || ''
                };
            } else {
                datePart = parsePeriodArg(pVal);
            }
            if (rowMonth) {
                delete datePart.period;
                delete datePart.from_date;
                delete datePart.to_date;
                delete datePart.month;
            }
            return {
                user: $('#l_u_filter').val() || '',
                industry: $('#l_i_filter').val() || '',
                period_type: $('#l_period_sel').val() || 'daily',
                ...datePart,
                month: rowMonth || $('#l_m_filter').val() || datePart.month || ''
            };
        }

        function getActivityArgs() {
            const pVal = $('#ea_p_filter').val();
            let datePart = {};
            if (pVal === 'custom') {
                datePart = getDateParams(pVal, '#ea_custom_dates_wrap', 'ea_dr');
            } else if (pVal === 'fiscal_year') {
                datePart = {
                    fiscal_year: $('#ea_fy_filter').val(),
                    month: $('#ea_m_filter').val() || ''
                };
            } else {
                datePart = parsePeriodArg(pVal);
            }
            return {
                user: $('#ea_user_sel').val() || '',
                period_type: $('#ea_period_sel').val() || 'daily',
                reference_type: $('#ea_entity_sel').val() || 'All',
                month: $('#ea_m_filter').val() || datePart.month || '',
                activity_basis: 'completed',
                ...datePart
            };
        }

        function parsePeriodArg(pVal) {
            if (pVal === 'custom' || pVal === 'fiscal_year' || !pVal || pVal === 'all') return { period: pVal };
            const today = new Date();
            const fmt = d => d.toISOString().split('T')[0];
            let from = null, to = null;
            if (pVal === 'today') {
                from = to = fmt(today);
            } else if (pVal === 'this_week') {
                const day = today.getDay();
                const mon = new Date(today); mon.setDate(today.getDate() - ((day + 6) % 7));
                const sun = new Date(mon); sun.setDate(mon.getDate() + 6);
                from = fmt(mon); to = fmt(sun);
            } else if (pVal === 'this_month') {
                from = fmt(new Date(today.getFullYear(), today.getMonth(), 1));
                to = fmt(new Date(today.getFullYear(), today.getMonth() + 1, 0));
            } else if (pVal === 'last_month') {
                from = fmt(new Date(today.getFullYear(), today.getMonth() - 1, 1));
                to = fmt(new Date(today.getFullYear(), today.getMonth(), 0));
            } else if (pVal === 'this_quarter') {
                const q = Math.floor(today.getMonth() / 3);
                from = fmt(new Date(today.getFullYear(), q * 3, 1));
                to = fmt(new Date(today.getFullYear(), q * 3 + 3, 0));
            } else if (pVal === 'last_quarter') {
                const q = Math.floor(today.getMonth() / 3) - 1;
                const yr = q < 0 ? today.getFullYear() - 1 : today.getFullYear();
                const qn = ((q + 4) % 4);
                from = fmt(new Date(yr, qn * 3, 1));
                to = fmt(new Date(yr, qn * 3 + 3, 0));
            }
            if (from && to) return { from_date: from, to_date: to, period: pVal };
            return { period: pVal };
        }

        function toggleBreakup(btnId, wrapId) {
            const rootEl = (typeof root_element !== 'undefined' && root_element) ? root_element : document;
            const btn = rootEl.querySelector(btnId);
            const wrap = rootEl.querySelector(wrapId);
            if (!btn || !wrap) return;
            const isHidden = (wrap.style.display === 'none' || wrap.style.display === '');
            if (isHidden) {
                wrap.style.display = 'block';
                btn.innerHTML = '<span>▲</span> Hide Breakup';
            } else {
                wrap.style.display = 'none';
                btn.innerHTML = '<span>►</span> Show Breakup';
            }
        }

        function setupEventListeners() {
            const rootEl = (typeof root_element !== 'undefined' && root_element) ? root_element : document;
            const cBtn = rootEl.querySelector('#c_breakup_btn');
            const lBtn = rootEl.querySelector('#l_breakup_btn');
            const eaBtn = rootEl.querySelector('#ea_breakup_btn');
            if (cBtn) cBtn.addEventListener('click', function () { toggleBreakup('#c_breakup_btn', '#c_breakup_wrap'); });
            if (lBtn) lBtn.addEventListener('click', function () { toggleBreakup('#l_breakup_btn', '#l_breakup_wrap'); });
            if (eaBtn) eaBtn.addEventListener('click', function () { toggleBreakup('#ea_breakup_btn', '#ea_breakup_wrap'); });

            $('#c_u_filter, #c_i_filter, #c_period_sel, #c_fy_filter, #c_m_filter').on('change', loadContactData);
            $('#c_p_filter').on('change', function () {
                const val = $(this).val();
                updateBreakupOptions('#c_p_filter', '#c_period_sel');
                $('#c_m_filter').val('');
                if (val === 'custom') {
                    hideSelect('#c_fy_filter');
                    hideSelect('#c_m_filter');
                    $('#c_custom_dates_wrap').css('display', 'inline-block');
                    initFrappeDateRange('#c_custom_dates_wrap', 'c_dr', loadContactData);
                } else if (val === 'fiscal_year') {
                    $('#c_custom_dates_wrap').hide();
                    $('#c_fy_filter').show();
                    $('#c_m_filter').show();
                    loadContactData();
                } else if (val === 'this_year' || val === 'last_year') {
                    $('#c_custom_dates_wrap').hide();
                    hideSelect('#c_fy_filter');
                    showSelect('#c_m_filter');
                    loadContactData();
                } else {
                    $('#c_custom_dates_wrap').hide();
                    hideSelect('#c_fy_filter');
                    hideSelect('#c_m_filter');
                    loadContactData();
                }
            });

            $('#l_u_filter, #l_i_filter, #l_period_sel, #l_fy_filter, #l_m_filter').on('change', loadLeadData);
            $('#l_p_filter').on('change', function () {
                const val = $(this).val();
                updateBreakupOptions('#l_p_filter', '#l_period_sel');
                $('#l_m_filter').val('');
                if (val === 'custom') {
                    hideSelect('#l_fy_filter');
                    hideSelect('#l_m_filter');
                    $('#l_custom_dates_wrap').css('display', 'inline-block');
                    initFrappeDateRange('#l_custom_dates_wrap', 'l_dr', loadLeadData);
                } else if (val === 'fiscal_year') {
                    $('#l_custom_dates_wrap').hide();
                    $('#l_fy_filter').show();
                    $('#l_m_filter').show();
                    loadLeadData();
                } else if (val === 'this_year' || val === 'last_year') {
                    $('#l_custom_dates_wrap').hide();
                    hideSelect('#l_fy_filter');
                    showSelect('#l_m_filter');
                    loadLeadData();
                } else {
                    $('#l_custom_dates_wrap').hide();
                    hideSelect('#l_fy_filter');
                    hideSelect('#l_m_filter');
                    loadLeadData();
                }
            });

            $('#t_fy_filter, #t_m_filter, #t_u_filter').on('change', loadTargetVsActual);

            $('#ea_user_sel, #ea_entity_sel, #ea_period_sel, #ea_fy_filter, #ea_m_filter').on('change', loadActivityData);
            $('#ea_p_filter').on('change', function () {
                const val = $(this).val();
                updateBreakupOptions('#ea_p_filter', '#ea_period_sel');
                $('#ea_m_filter').val('');
                if (val === 'custom') {
                    hideSelect('#ea_fy_filter');
                    hideSelect('#ea_m_filter');
                    $('#ea_custom_dates_wrap').css('display', 'inline-block');
                    initFrappeDateRange('#ea_custom_dates_wrap', 'ea_dr', loadActivityData);
                } else if (val === 'fiscal_year') {
                    $('#ea_custom_dates_wrap').hide();
                    $('#ea_fy_filter').show();
                    $('#ea_m_filter').show();
                    loadActivityData();
                } else if (val === 'this_year' || val === 'last_year') {
                    $('#ea_custom_dates_wrap').hide();
                    hideSelect('#ea_fy_filter');
                    showSelect('#ea_m_filter');
                    loadActivityData();
                } else {
                    $('#ea_custom_dates_wrap').hide();
                    hideSelect('#ea_fy_filter');
                    hideSelect('#ea_m_filter');
                    loadActivityData();
                }
            });

            $('#dac_export_excel_btn').on('click', exportDashboardToExcel);
        }

        function renderCountBadge(cnt, onclickJs) {
            const val = parseInt(cnt) || 0;
            if (val === 0) {
                return '<span class="dac-zero-cell" onclick="' + onclickJs + '">0</span>';
            }
            return '<div class="dac-clickable-cell" onclick="' + onclickJs + '">' + val + '</div>';
        }

        function loadContactData() {
            frappe.call({
                method: "erp_dacsinc_custom.custom_lead.get_tabular_dashboard_data",
                args: getContactArgs(),
                callback: function (r) {
                    if (!r.message) return;
                    const ct = r.message.contact_totals || { o: 0, c: 0, e: 0 };
                    $('#c_card_open').text(ct.o || 0);
                    $('#c_card_conv').text(ct.c || 0);
                    $('#c_card_exist').text(ct.e || 0);

                    let rowsHtml = "";
                    (r.message.contacts || []).forEach(row => {
                        rowsHtml += `
                        <tr style="border-bottom: 1px solid #e2e8f0; font-size: 14px;">
                            <td style="padding: 10px 12px; font-weight: 600; color: #0f172a; border-right: 1px solid #e2e8f0;">${row.label}</td>
                            <td style="padding: 6px 8px; text-align: center; border-right: 1px solid #e2e8f0;">${renderCountBadge(row.o, `openDrilldownModal('c_open', 'Open Contacts (${row.label})', '${row.m_num}', ${row.o}, '${row.row_from_date}', '${row.row_to_date}')`)}</td>
                            <td style="padding: 6px 8px; text-align: center; border-right: 1px solid #e2e8f0;">${renderCountBadge(row.c, `openDrilldownModal('c_conv', 'Converted Contacts (${row.label})', '${row.m_num}', ${row.c}, '${row.row_from_date}', '${row.row_to_date}')`)}</td>
                            <td style="padding: 6px 8px; text-align: center;">${renderCountBadge(row.e, `openDrilldownModal('c_exist', 'Existing Customers (${row.label})', '${row.m_num}', ${row.e}, '${row.row_from_date}', '${row.row_to_date}')`)}</td>
                        </tr>
                    `;
                    });
                    rowsHtml += `
                    <tr style="background: #f1f5f9; font-weight: 700; border-top: 2px solid #cbd5e1; font-size: 14px;">
                        <td style="padding: 10px 12px; color: #0f172a; border-right: 1px solid #cbd5e1;">Total</td>
                        <td style="padding: 6px 8px; text-align: center; border-right: 1px solid #cbd5e1;">${renderCountBadge(ct.o, `openDrilldownModal('c_open', 'Open Contacts Total', null, ${ct.o})`)}</td>
                        <td style="padding: 6px 8px; text-align: center; border-right: 1px solid #cbd5e1;">${renderCountBadge(ct.c, `openDrilldownModal('c_conv', 'Converted Contacts Total', null, ${ct.c})`)}</td>
                        <td style="padding: 6px 8px; text-align: center;">${renderCountBadge(ct.e, `openDrilldownModal('c_exist', 'Existing Customers Total', null, ${ct.e})`)}</td>
                    </tr>
                `;
                    $('#c_breakup_body').html(rowsHtml);
                }
            });
        }

        function loadLeadData() {
            frappe.call({
                method: "erp_dacsinc_custom.custom_lead.get_tabular_dashboard_data",
                args: getLeadArgs(),
                callback: function (r) {
                    if (!r.message) return;
                    const lt = r.message.lead_totals || {};
                    $('#l_card_enq_cnt').text(lt.enq_c || 0);
                    $('#l_card_enq_val').text(fmtVal(lt.enq_v));

                    $('#l_card_pipe_cnt').text(lt.pipe_c || 0);
                    $('#l_card_pipe_val').text(fmtVal(lt.pipe_v));

                    $('#l_card_ord_cnt').text(lt.ord_c || 0);
                    $('#l_card_ord_val').text(fmtVal(lt.ord_v));

                    $('#l_card_lenq_cnt').text(lt.lenq_c || 0);
                    $('#l_card_lenq_val').text(fmtVal(lt.lenq_v));

                    $('#l_card_lpipe_cnt').text(lt.lpipe_c || 0);
                    $('#l_card_lpipe_val').text(fmtVal(lt.lpipe_v));

                    let rowsHtml = "";
                    (r.message.leads || []).forEach(row => {
                        rowsHtml += `
                        <tr style="border-bottom: 1px solid #cbd5e1; font-size: 14px;">
                            <td style="padding: 10px 12px; font-weight: 600; color: #0f172a; border-right: 1px solid #cbd5e1;">${row.label}</td>
                            <td style="padding: 6px 8px; text-align: center; border-right: 1px solid #e2e8f0;">
                                ${renderCountBadge(row.enq_c, `openDrilldownModal('l_enq', 'Enquiry Leads (${row.label})', '${row.m_num}', ${row.enq_c}, '${row.row_from_date}', '${row.row_to_date}')`)}
                            </td>
                            <td style="padding: 10px 12px; text-align: right; color: #334155; font-weight: 600; border-right: 1px solid #cbd5e1;">${fmtVal(row.enq_v)}</td>
                            <td style="padding: 6px 8px; text-align: center; border-right: 1px solid #e2e8f0;">
                                ${renderCountBadge(row.pipe_c, `openDrilldownModal('l_pipe', 'Pipeline Leads (${row.label})', '${row.m_num}', ${row.pipe_c}, '${row.row_from_date}', '${row.row_to_date}')`)}
                            </td>
                            <td style="padding: 10px 12px; text-align: right; color: #334155; font-weight: 600; border-right: 1px solid #cbd5e1;">${fmtVal(row.pipe_v)}</td>
                            <td style="padding: 6px 8px; text-align: center; border-right: 1px solid #e2e8f0;">
                                ${renderCountBadge(row.ord_c, `openDrilldownModal('l_ord', 'Order Leads (${row.label})', '${row.m_num}', ${row.ord_c}, '${row.row_from_date}', '${row.row_to_date}')`)}
                            </td>
                            <td style="padding: 10px 12px; text-align: right; color: #15803d; font-weight: 700; border-right: 1px solid #cbd5e1;">${fmtVal(row.ord_v)}</td>
                            <td style="padding: 6px 8px; text-align: center; border-right: 1px solid #e2e8f0;">
                                ${renderCountBadge(row.lenq_c, `openDrilldownModal('l_lenq', 'Lost Enquiry (${row.label})', '${row.m_num}', ${row.lenq_c}, '${row.row_from_date}', '${row.row_to_date}')`)}
                            </td>
                            <td style="padding: 10px 12px; text-align: right; color: #dc2626; font-weight: 600; border-right: 1px solid #cbd5e1;">${fmtVal(row.lenq_v)}</td>
                            <td style="padding: 6px 8px; text-align: center; border-right: 1px solid #e2e8f0;">
                                ${renderCountBadge(row.lpipe_c, `openDrilldownModal('l_lpipe', 'Lost Pipeline (${row.label})', '${row.m_num}', ${row.lpipe_c}, '${row.row_from_date}', '${row.row_to_date}')`)}
                            </td>
                            <td style="padding: 10px 12px; text-align: right; color: #dc2626; font-weight: 600; border-right: 2px solid #cbd5e1;">${fmtVal(row.lpipe_v)}</td>
                            <td style="padding: 6px 8px; text-align: center; border-right: 1px solid #e2e8f0;">
                                ${renderCountBadge(row.conv_bc_to_lead, `openDrilldownModal('conv_bc', 'Contact &rarr; Lead (${row.label})', '${row.m_num}', ${row.conv_bc_to_lead}, '${row.row_from_date}', '${row.row_to_date}')`)}
                            </td>
                            <td style="padding: 6px 8px; text-align: center;">
                                ${renderCountBadge(row.conv_lead_to_order, `openDrilldownModal('conv_lead', 'Lead &rarr; Order (${row.label})', '${row.m_num}', ${row.conv_lead_to_order}, '${row.row_from_date}', '${row.row_to_date}')`)}
                            </td>
                        </tr>
                    `;
                    });

                    rowsHtml += `
                    <tr style="background: #f1f5f9; font-weight: 700; border-top: 2px solid #cbd5e1; font-size: 14px;">
                        <td style="padding: 10px 12px; color: #0f172a; border-right: 1px solid #cbd5e1;">Total</td>
                        <td style="padding: 6px 8px; text-align: center; border-right: 1px solid #e2e8f0;">
                            ${renderCountBadge(lt.enq_c, `openDrilldownModal('l_enq', 'Enquiry Leads Total', null, ${lt.enq_c})`)}
                        </td>
                        <td style="padding: 10px 12px; text-align: right; color: #334155; font-weight: 700; border-right: 1px solid #cbd5e1;">${fmtVal(lt.enq_v)}</td>
                        <td style="padding: 6px 8px; text-align: center; border-right: 1px solid #e2e8f0;">
                            ${renderCountBadge(lt.pipe_c, `openDrilldownModal('l_pipe', 'Pipeline Leads Total', null, ${lt.pipe_c})`)}
                        </td>
                        <td style="padding: 10px 12px; text-align: right; color: #334155; font-weight: 700; border-right: 1px solid #cbd5e1;">${fmtVal(lt.pipe_v)}</td>
                        <td style="padding: 6px 8px; text-align: center; border-right: 1px solid #e2e8f0;">
                            ${renderCountBadge(lt.ord_c, `openDrilldownModal('l_ord', 'Order Leads Total', null, ${lt.ord_c})`)}
                        </td>
                        <td style="padding: 10px 12px; text-align: right; color: #15803d; font-weight: 800; border-right: 1px solid #cbd5e1;">${fmtVal(lt.ord_v)}</td>
                        <td style="padding: 6px 8px; text-align: center; border-right: 1px solid #e2e8f0;">
                            ${renderCountBadge(lt.lenq_c, `openDrilldownModal('l_lenq', 'Lost Enquiry Total', null, ${lt.lenq_c})`)}
                        </td>
                        <td style="padding: 10px 12px; text-align: right; color: #dc2626; font-weight: 700; border-right: 1px solid #cbd5e1;">${fmtVal(lt.lenq_v)}</td>
                        <td style="padding: 6px 8px; text-align: center; border-right: 1px solid #e2e8f0;">
                            ${renderCountBadge(lt.lpipe_c, `openDrilldownModal('l_lpipe', 'Lost Pipeline Total', null, ${lt.lpipe_c})`)}
                        </td>
                        <td style="padding: 10px 12px; text-align: right; color: #dc2626; font-weight: 700; border-right: 2px solid #cbd5e1;">${fmtVal(lt.lpipe_v)}</td>
                        <td style="padding: 6px 8px; text-align: center; border-right: 1px solid #e2e8f0;">
                            ${renderCountBadge(lt.conv_bc_to_lead, `openDrilldownModal('conv_bc', 'Contact &rarr; Lead Total', null, ${lt.conv_bc_to_lead})`)}
                        </td>
                        <td style="padding: 6px 8px; text-align: center;">
                            ${renderCountBadge(lt.conv_lead_to_order, `openDrilldownModal('conv_lead', 'Lead &rarr; Order Total', null, ${lt.conv_lead_to_order})`)}
                        </td>
                    </tr>
                `;
                    $('#l_breakup_body').html(rowsHtml);
                }
            });
        }

        function loadTargetVsActual() {
            const fy = $('#t_fy_filter').val();
            const user = $('#t_u_filter').val() || '';
            const m = $('#t_m_filter').val() || '';

            $('#t_first_header').text(user ? 'Month' : 'Sales Executive');

            frappe.call({
                method: "erp_dacsinc_custom.custom_lead.get_target_vs_actual",
                args: {
                    fiscal_year: fy,
                    month: m,
                    user: user
                },
                callback: function (r) {
                    if (!r.message) return;
                    const data = Array.isArray(r.message) ? r.message : (r.message.data || []);

                    if (r.message && r.message.year_start_date && r.message.year_end_date) {
                        $('#t_date_range_label').text(`${r.message.year_start_date} to ${r.message.year_end_date}`);
                    } else {
                        $('#t_date_range_label').text('');
                    }

                    let rowsHtml = "";
                    data.forEach(row => {
                        const salesPerson = row.sales_person || row.sales_person_name || row.full_name || '-';
                        const targetVal = parseFloat(row.target || row.target_amount || 0);
                        const actualVal = parseFloat(row.actual || row.actual_closed || 0);

                        const currVar = parseFloat(row.curr_variance !== undefined ? row.curr_variance : (row.variance_amount || 0));
                        const currVarStr = currVar < 0 ? `-${fmtVal(Math.abs(currVar))}` : fmtVal(currVar);
                        const currVarColor = currVar < 0 ? '#dc2626' : '#16a34a';

                        const currAch = parseFloat(row.curr_achievement !== undefined ? row.curr_achievement : (row.achievement_percent || 0)).toFixed(1) + '%';

                        const ytdLabel = row.ytd_label || '-';
                        const ytdTarget = parseFloat(row.ytd_target || row.annual_target || 0);

                        const overallVar = parseFloat(row.overall_variance !== undefined ? row.overall_variance : currVar);
                        const overallVarStr = overallVar < 0 ? `-${fmtVal(Math.abs(overallVar))}` : fmtVal(overallVar);
                        const overallVarColor = overallVar < 0 ? '#dc2626' : '#16a34a';

                        const overallAch = parseFloat(row.overall_achievement !== undefined ? row.overall_achievement : (row.achievement_percent || 0)).toFixed(1) + '%';

                        rowsHtml += `
                        <tr style="border-bottom: 1px solid #e2e8f0;">
                            <td style="padding: 8px 10px; font-weight: 700; color: #0f172a; text-align: left; border-right: 1px solid #e2e8f0;">${salesPerson}</td>
                            <td style="padding: 8px 10px; font-weight: 600;">${fmtVal(targetVal)}</td>
                            <td style="padding: 8px 10px; font-weight: 600; border-right: 1px solid #e2e8f0;">${fmtVal(actualVal)}</td>
                            <td style="padding: 8px 10px; font-weight: 700; color: ${currVarColor};">${currVarStr}</td>
                            <td style="padding: 8px 10px; font-weight: 700; border-right: 1px solid #e2e8f0;">${currAch}</td>
                            <td style="padding: 8px 10px; color: #475569;">${ytdLabel}</td>
                            <td style="padding: 8px 10px; font-weight: 600;">${fmtVal(ytdTarget)}</td>
                            <td style="padding: 8px 10px; font-weight: 700; color: ${overallVarColor};">${overallVarStr}</td>
                            <td style="padding: 8px 10px; font-weight: 700;">${overallAch}</td>
                        </tr>
                    `;
                    });

                    if (!data.length) {
                        rowsHtml = `<tr><td colspan="9" style="padding: 16px; text-align: center; color: #94a3b8;">No target data found for selected period.</td></tr>`;
                    }
                    $('#t_table_body').html(rowsHtml);
                }
            });
        }

        function loadActivityData() {
            frappe.call({
                method: "erp_dacsinc_custom.custom_lead.get_event_activity_breakup_data",
                args: getActivityArgs(),
                callback: function (r) {
                    if (!r.message) return;
                    const tot = r.message.totals || {};
                    $('#ea_card_overdue').text(tot.overdue_count || 0);
                    $('#ea_card_today').text(tot.today_count || 0);
                    $('#ea_card_lead_noact').text(tot.lead_noact_count || 0);
                    $('#ea_card_cont_noact').text(tot.cont_noact_count || 0);
                    $('#ea_card_open').text(tot.open_total_count || 0);

                    const categories = r.message.categories || [];
                    const activities = r.message.activities || [];
                    const catTotals = tot.category_totals || {};

                    const entitySel = $('#ea_entity_sel').val() || 'All';

                    // RENDER SUMMARY HEADERS FIRST
                    let headHtml = `
                    <tr style="background: #f8fafc; color: #334155;">
                        <th rowspan="${entitySel === 'All' ? 2 : 1}" style="padding: 8px 10px; font-weight: 700; vertical-align: middle; border-bottom: 2px solid #cbd5e1; border-right: 1px solid #cbd5e1; min-width: 90px;">Period</th>
                `;

                    if (entitySel === 'All') {
                        headHtml += `
                        <th rowspan="2" style="padding: 8px 10px; font-weight: 700; text-align: center; color: #2563eb; vertical-align: middle; border-bottom: 2px solid #cbd5e1; border-right: 1px solid #cbd5e1; min-width: 75px; white-space: nowrap; background: #f0f9ff;">Lead Act.</th>
                        <th rowspan="2" style="padding: 8px 10px; font-weight: 700; text-align: center; color: #0284c7; vertical-align: middle; border-bottom: 2px solid #cbd5e1; border-right: 1px solid #cbd5e1; min-width: 75px; white-space: nowrap; background: #f0f9ff;">Contact Act.</th>
                    `;
                    } else if (entitySel === 'Lead') {
                        headHtml += `<th rowspan="1" style="padding: 8px 10px; font-weight: 700; text-align: center; color: #2563eb; vertical-align: middle; border-bottom: 2px solid #cbd5e1; border-right: 1px solid #cbd5e1; min-width: 75px; white-space: nowrap; background: #f0f9ff;">Lead Act.</th>`;
                    } else {
                        headHtml += `<th rowspan="1" style="padding: 8px 10px; font-weight: 700; text-align: center; color: #0284c7; vertical-align: middle; border-bottom: 2px solid #cbd5e1; border-right: 1px solid #cbd5e1; min-width: 75px; white-space: nowrap; background: #f0f9ff;">Contact Act.</th>`;
                    }

                    headHtml += `
                        <th rowspan="${entitySel === 'All' ? 2 : 1}" style="padding: 8px 10px; font-weight: 700; text-align: center; color: #16a34a; vertical-align: middle; border-bottom: 2px solid #cbd5e1; border-right: 2px solid #cbd5e1; min-width: 90px; background: #f0fdf4;">Total Completed</th>
                    `;

                    categories.forEach(cat => {
                        headHtml += `<th ${entitySel === 'All' ? 'colspan="2"' : ''} style="padding: 6px 10px; font-weight: 700; text-align: center; background: #ffffff; color: #0f172a; border-bottom: 1px solid #cbd5e1; border-right: 1px solid #cbd5e1; min-width: 65px; white-space: pre-wrap;">${cat}</th>`;
                    });

                    headHtml += `</tr>`;

                    if (entitySel === 'All') {
                        headHtml += `<tr style="background: #f8fafc; color: #475569;">`;
                        categories.forEach(cat => {
                            headHtml += `
                            <th style="padding: 4px 6px; font-size: 10px; font-weight: 700; text-align: center; border-bottom: 2px solid #cbd5e1; border-right: 1px solid #e2e8f0; color: #2563eb; min-width:40px;">Lead</th>
                            <th style="padding: 4px 6px; font-size: 10px; font-weight: 700; text-align: center; border-bottom: 2px solid #cbd5e1; border-right: 1px solid #cbd5e1; color: #0284c7; min-width:40px;">Contact</th>
                        `;
                        });
                        headHtml += `</tr>`;
                    }

                    $('#ea_breakup_head').html(headHtml);

                    let rowsHtml = "";
                    activities.forEach(row => {
                        rowsHtml += `<tr style="border-bottom: 1px solid #e2e8f0;"><td style="padding: 8px 10px; font-weight: 600; border-right: 1px solid #cbd5e1; white-space: nowrap;">${row.period_label}</td>`;

                        // SUMMARY COLUMNS FIRST (CLICKABLE)
                        if (entitySel === 'All') {
                            rowsHtml += `
                            <td style="padding: 8px 10px; text-align: center; border-right: 1px solid #e2e8f0;">
                                ${row.lead_cnt > 0 ? `<div class="dac-clickable-cell" style="color: #2563eb;" onclick="openActivityCategoryModal('', 'Lead Activities (${row.period_label})', 'Lead', '${row.row_from_date}', '${row.row_to_date}', '${row.period_label}')">${row.lead_cnt}</div>` : '<span style="color:#94a3b8;">-</span>'}
                            </td>
                            <td style="padding: 8px 10px; text-align: center; border-right: 1px solid #cbd5e1;">
                                ${row.contact_cnt > 0 ? `<div class="dac-clickable-cell" style="color: #0284c7;" onclick="openActivityCategoryModal('', 'Contact Activities (${row.period_label})', 'Business Contacts', '${row.row_from_date}', '${row.row_to_date}', '${row.period_label}')">${row.contact_cnt}</div>` : '<span style="color:#94a3b8;">-</span>'}
                            </td>
                        `;
                        } else if (entitySel === 'Lead') {
                            rowsHtml += `
                            <td style="padding: 8px 10px; text-align: center; border-right: 1px solid #cbd5e1;">
                                ${row.lead_cnt > 0 ? `<div class="dac-clickable-cell" style="color: #2563eb;" onclick="openActivityCategoryModal('', 'Lead Activities (${row.period_label})', 'Lead', '${row.row_from_date}', '${row.row_to_date}', '${row.period_label}')">${row.lead_cnt}</div>` : '<span style="color:#94a3b8;">-</span>'}
                            </td>
                        `;
                        } else {
                            rowsHtml += `
                            <td style="padding: 8px 10px; text-align: center; border-right: 1px solid #cbd5e1;">
                                ${row.contact_cnt > 0 ? `<div class="dac-clickable-cell" style="color: #0284c7;" onclick="openActivityCategoryModal('', 'Contact Activities (${row.period_label})', 'Business Contacts', '${row.row_from_date}', '${row.row_to_date}', '${row.period_label}')">${row.contact_cnt}</div>` : '<span style="color:#94a3b8;">-</span>'}
                            </td>
                        `;
                        }

                        rowsHtml += `
                        <td style="padding: 8px 10px; text-align: center; font-weight: 700; border-right: 2px solid #cbd5e1;">
                            ${row.total_completed > 0 ? `<div class="dac-clickable-cell" style="color: #16a34a;" onclick="openActivityCategoryModal('', 'Total Completed Activities (${row.period_label})', '${entitySel}', '${row.row_from_date}', '${row.row_to_date}', '${row.period_label}')">${row.total_completed}</div>` : '<span style="color:#94a3b8;">-</span>'}
                        </td>
                    `;

                        // CATEGORIES COLUMNS
                        categories.forEach(cat => {
                            const cData = (row.categories && row.categories[cat]) ? row.categories[cat] : { lead: 0, cont: 0 };
                            const lCnt = cData.lead || 0;
                            const cCnt = cData.cont || 0;

                            if (entitySel === 'All' || entitySel === 'Lead') {
                                if (lCnt > 0) {
                                    rowsHtml += `<td style="padding: 8px 10px; text-align: center; border-right: 1px solid ${entitySel === 'Lead' ? '#cbd5e1' : '#e2e8f0'};"><div class="dac-clickable-cell" onclick="openActivityCategoryModal('${cat}', '${cat}', 'Lead', '${row.row_from_date}', '${row.row_to_date}', '${row.period_label}')">${lCnt}</div></td>`;
                                } else {
                                    rowsHtml += `<td style="padding: 8px 10px; text-align: center; color: #94a3b8; border-right: 1px solid ${entitySel === 'Lead' ? '#cbd5e1' : '#e2e8f0'};">-</td>`;
                                }
                            }

                            if (entitySel === 'All' || entitySel === 'Business Contacts') {
                                if (cCnt > 0) {
                                    rowsHtml += `<td style="padding: 8px 10px; text-align: center; border-right: 1px solid #cbd5e1;"><div class="dac-clickable-cell" onclick="openActivityCategoryModal('${cat}', '${cat}', 'Business Contacts', '${row.row_from_date}', '${row.row_to_date}', '${row.period_label}')">${cCnt}</div></td>`;
                                } else {
                                    rowsHtml += `<td style="padding: 8px 10px; text-align: center; color: #94a3b8; border-right: 1px solid #cbd5e1;">-</td>`;
                                }
                            }
                        });

                        rowsHtml += `</tr>`;
                    });

                    // SUMMARY TOTAL ROW
                    let totRowHtml = `<tr style="background: #f1f5f9; font-weight: 700; border-top: 2px solid #cbd5e1;"><td style="padding: 8px 10px; border-right: 1px solid #cbd5e1; white-space: nowrap;">Total</td>`;

                    if (entitySel === 'All') {
                        totRowHtml += `
                        <td style="padding: 8px 10px; text-align: center; font-weight:700; border-right: 1px solid #e2e8f0;">
                            ${tot.cp_lead_cnt > 0 ? `<div class="dac-clickable-cell" style="color: #2563eb;" onclick="openActivityCategoryModal('', 'Total Lead Activities', 'Lead', '', '', 'All Time')">${tot.cp_lead_cnt}</div>` : '0'}
                        </td>
                        <td style="padding: 8px 10px; text-align: center; font-weight:700; border-right: 1px solid #cbd5e1;">
                            ${tot.cp_contact_cnt > 0 ? `<div class="dac-clickable-cell" style="color: #0284c7;" onclick="openActivityCategoryModal('', 'Total Contact Activities', 'Business Contacts', '', '', 'All Time')">${tot.cp_contact_cnt}</div>` : '0'}
                        </td>
                    `;
                    } else if (entitySel === 'Lead') {
                        totRowHtml += `
                        <td style="padding: 8px 10px; text-align: center; font-weight:700; border-right: 1px solid #cbd5e1;">
                            ${tot.cp_lead_cnt > 0 ? `<div class="dac-clickable-cell" style="color: #2563eb;" onclick="openActivityCategoryModal('', 'Total Lead Activities', 'Lead', '', '', 'All Time')">${tot.cp_lead_cnt}</div>` : '0'}
                        </td>
                    `;
                    } else {
                        totRowHtml += `
                        <td style="padding: 8px 10px; text-align: center; font-weight:700; border-right: 1px solid #cbd5e1;">
                            ${tot.cp_contact_cnt > 0 ? `<div class="dac-clickable-cell" style="color: #0284c7;" onclick="openActivityCategoryModal('', 'Total Contact Activities', 'Business Contacts', '', '', 'All Time')">${tot.cp_contact_cnt}</div>` : '0'}
                        </td>
                    `;
                    }

                    totRowHtml += `
                    <td style="padding: 8px 10px; text-align: center; font-weight: 800; border-right: 2px solid #cbd5e1;">
                        ${tot.total_completed > 0 ? `<div class="dac-clickable-cell" style="color: #16a34a;" onclick="openActivityCategoryModal('', 'Total Completed Activities', '${entitySel}', '', '', 'All Time')">${tot.total_completed}</div>` : '0'}
                    </td>
                `;

                    categories.forEach(cat => {
                        const lCnt = (catTotals[cat] && catTotals[cat].lead) ? catTotals[cat].lead : 0;
                        const cCnt = (catTotals[cat] && catTotals[cat].cont) ? catTotals[cat].cont : 0;

                        if (entitySel === 'All' || entitySel === 'Lead') {
                            if (lCnt > 0) {
                                totRowHtml += `<td style="padding: 8px 10px; text-align: center; font-weight: 800; border-right: 1px solid ${entitySel === 'Lead' ? '#cbd5e1' : '#e2e8f0'};"><div class="dac-clickable-cell" onclick="openActivityCategoryModal('${cat}', '${cat}', 'Lead', '', '', 'All Time')" style="color: #2563eb;">${lCnt}</div></td>`;
                            } else {
                                totRowHtml += `<td style="padding: 8px 10px; text-align: center; color: #94a3b8; border-right: 1px solid ${entitySel === 'Lead' ? '#cbd5e1' : '#e2e8f0'};">0</td>`;
                            }
                        }

                        if (entitySel === 'All' || entitySel === 'Business Contacts') {
                            if (cCnt > 0) {
                                totRowHtml += `<td style="padding: 8px 10px; text-align: center; font-weight: 800; border-right: 1px solid #cbd5e1;"><div class="dac-clickable-cell" onclick="openActivityCategoryModal('${cat}', '${cat}', 'Business Contacts', '', '', 'All Time')" style="color: #0284c7;">${cCnt}</div></td>`;
                            } else {
                                totRowHtml += `<td style="padding: 8px 10px; text-align: center; color: #94a3b8; border-right: 1px solid #cbd5e1;">0</td>`;
                            }
                        }
                    });

                    totRowHtml += `</tr>`;

                    $('#ea_breakup_body').html(rowsHtml + totRowHtml);
                }
            });
        }

        function exportDashboardToExcel() {
            const d = new frappe.ui.Dialog({
                title: '📊 Export CRM Executive Report',
                fields: [
                    {
                        label: 'Report Type',
                        fieldname: 'export_type',
                        fieldtype: 'Select',
                        options: [
                            { value: 'applied', label: 'Applied Filter Breakup (Current Dashboard)' },
                            { value: 'daily',   label: 'Daily Report' },
                            { value: 'weekly',  label: 'Weekly Report' },
                            { value: 'monthly', label: 'Monthly Report' }
                        ],
                        default: 'applied',
                        change: function() {
                            const type = d.get_value('export_type');
                            if (type !== 'applied') {
                                frappe.call({
                                    method: 'erp_dacsinc_custom.custom_lead.get_crm_report_emails',
                                    args: { report_type: type },
                                    callback: function(r) {
                                        if (r.message && r.message.emails && r.message.emails.length) {
                                            d.set_value('email_address', r.message.emails.join(', '));
                                        }
                                    }
                                });
                            }
                        }
                    },
                    { fieldtype: 'Section Break' },
                    {
                        label: 'Send Report via Email',
                        fieldname: 'send_email',
                        fieldtype: 'Check',
                        default: 0
                    },
                    {
                        label: 'Email Recipients',
                        fieldname: 'email_address',
                        fieldtype: 'Small Text',
                        depends_on: 'eval:doc.send_email == 1',
                        description: 'Comma-separated email addresses. Pre-filled from Admin Settings for Daily/Weekly/Monthly.'
                    }
                ],
                primary_action_label: 'Generate & Export',
                primary_action: function(values) {
                    if (values.send_email && !values.email_address) {
                        frappe.msgprint({ title: __('Validation'), indicator: 'orange',
                            message: __('Please enter at least one email address.') });
                        return;
                    }
                    d.hide();
                    const btn = $('#dac_export_excel_btn');
                    const origHtml = btn.html();
                    btn.prop('disabled', true).text('Generating...');

                    const cArgs = getContactArgs();
                    const lArgs = getLeadArgs();
                    const eaArgs = getActivityArgs();
                    const payload = {
                        c_user: cArgs.user, c_fiscal_year: cArgs.fiscal_year,
                        c_industry: cArgs.industry, c_period_type: cArgs.period_type,
                        c_from_date: cArgs.from_date, c_to_date: cArgs.to_date,
                        c_month: cArgs.month, c_period: cArgs.period,
                        l_user: lArgs.user, l_fiscal_year: lArgs.fiscal_year,
                        l_industry: lArgs.industry, l_period_type: lArgs.period_type,
                        l_from_date: lArgs.from_date, l_to_date: lArgs.to_date,
                        l_month: lArgs.month, l_period: lArgs.period,
                        t_fiscal_year: $('#t_fy_filter').val(),
                        ea_user: eaArgs.user, ea_fiscal_year: eaArgs.fiscal_year,
                        ea_period_type: eaArgs.period_type, ea_entity: eaArgs.reference_type,
                        ea_from_date: eaArgs.from_date, ea_to_date: eaArgs.to_date,
                        ea_month: eaArgs.month, ea_period: eaArgs.period,
                        export_type: values.export_type,
                        send_email: values.send_email ? 1 : 0,
                        email_address: values.email_address || ''
                    };

                    frappe.call({
                        method: 'erp_dacsinc_custom.custom_lead.export_crm_dashboard_excel',
                        args: payload,
                        callback: function(r) {
                            btn.prop('disabled', false).html(origHtml);
                            if (r.message && r.message.filecontent) {
                                const bytes = atob(r.message.filecontent);
                                const arr = new Uint8Array(bytes.length);
                                for (let i = 0; i < bytes.length; i++) arr[i] = bytes.charCodeAt(i);
                                const blob = new Blob([arr], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
                                const a = document.createElement('a');
                                a.href = URL.createObjectURL(blob);
                                a.download = r.message.filename;
                                document.body.appendChild(a); a.click(); document.body.removeChild(a);
                                let msg = 'Report exported successfully!';
                                if (r.message.email_sent) msg += ' Email sent to recipients.';
                                frappe.show_alert({ message: msg, indicator: 'green' });
                            } else {
                                frappe.msgprint({ title: __('Export Failed'), indicator: 'red',
                                    message: __('Could not generate the report.') });
                            }
                        },
                        error: function() { btn.prop('disabled', false).html(origHtml); }
                    });
                }
            });
            d.$wrapper.addClass('dac-wide-modal');
            d.show();
        }

        // Number Card & Breakup Table Drilldown Modal
        window.openDrilldownModal = function (cardType, cardTitle, rowMonth, expectedCountParam, rowFromDate, rowToDate) {
            let expectedCount = expectedCountParam;
            let monthFilter = rowMonth;

            if (typeof expectedCountParam === 'undefined' && typeof rowMonth === 'number') {
                expectedCount = rowMonth;
                monthFilter = undefined;
            }

            let filterArgs = { card_type: cardType };
            let userDisp = "All Team Members";
            let dateDisp = "All Time";

            let hasRowDates = rowFromDate && rowToDate;

            if (cardType.startsWith('c_')) {
                const cArgs = getContactArgs(monthFilter || '');
                Object.assign(filterArgs, cArgs);
                if (hasRowDates) {
                    filterArgs.from_date = rowFromDate;
                    filterArgs.to_date = rowToDate;
                    filterArgs.is_row_click = 1;
                    delete filterArgs.period;
                    delete filterArgs.month;
                    delete filterArgs.fiscal_year;
                }
                userDisp = getSelectedOptionText('#c_u_filter', 'All Team Members');
                dateDisp = hasRowDates ? cardTitle : (monthFilter ? cardTitle : (cArgs.fiscal_year ? cArgs.fiscal_year + (cArgs.month ? ` (Month: ${cArgs.month})` : '') : (cArgs.from_date ? `${cArgs.from_date} to ${cArgs.to_date}` : getSelectedOptionText('#c_p_filter', 'All Time'))));
            } else if (cardType.startsWith('l_') || cardType.startsWith('conv_')) {
                const lArgs = getLeadArgs(monthFilter || '');
                Object.assign(filterArgs, lArgs);
                if (hasRowDates) {
                    filterArgs.from_date = rowFromDate;
                    filterArgs.to_date = rowToDate;
                    filterArgs.is_row_click = 1;
                    delete filterArgs.period;
                    delete filterArgs.month;
                    delete filterArgs.fiscal_year;
                }
                userDisp = getSelectedOptionText('#l_u_filter', 'All Team Members');
                dateDisp = hasRowDates ? cardTitle : (monthFilter ? cardTitle : (lArgs.fiscal_year ? lArgs.fiscal_year + (lArgs.month ? ` (Month: ${lArgs.month})` : '') : (lArgs.from_date ? `${lArgs.from_date} to ${lArgs.to_date}` : getSelectedOptionText('#l_p_filter', 'All Time'))));
            } else if (cardType.startsWith('ea_')) {
                const eaArgs = getActivityArgs();
                Object.assign(filterArgs, eaArgs);
                userDisp = getSelectedOptionText('#ea_user_sel', 'All Team Members');
                dateDisp = eaArgs.fiscal_year ? eaArgs.fiscal_year + (eaArgs.month ? ` (Month: ${eaArgs.month})` : '') : (eaArgs.from_date ? `${eaArgs.from_date} to ${eaArgs.to_date}` : getSelectedOptionText('#ea_p_filter', 'All Time'));
            }

            if (typeof expectedCount === 'undefined') {
                const countSelectors = {
                    'ea_overdue': '#ea_card_overdue',
                    'ea_today': '#ea_card_today',
                    'ea_lead_noact': '#ea_card_lead_noact',
                    'ea_cont_noact': '#ea_card_cont_noact',
                    'ea_open': '#ea_card_open',
                    'c_open': '#c_card_open',
                    'c_conv': '#c_card_conv',
                    'c_exist': '#c_card_exist',
                    'l_enq': '#l_card_enq_cnt',
                    'l_pipe': '#l_card_pipe_cnt',
                    'l_ord': '#l_card_ord_cnt',
                    'l_lenq': '#l_card_lenq_cnt',
                    'l_lpipe': '#l_card_lpipe_cnt'
                };
                const selector = countSelectors[cardType];
                if (selector) {
                    const countText = $(selector).text().trim();
                    if (countText && countText !== '-') {
                        expectedCount = parseInt(countText) || 0;
                    }
                }
            }

            const handleResponse = function (r) {
                if (!r || !r.message || !r.message.records) return;
                const records = r.message.records;
                const totalCount = records.length;

                let totalValue = 0;
                let isLeadCard = cardType.startsWith('l_') || cardType === 'conv_lead' || cardType === 'ea_lead_noact';
                let isContactCard = cardType.startsWith('c_') || cardType === 'conv_bc' || cardType === 'ea_cont_noact';

                records.forEach(rec => {
                    const dt = rec.doctype || '';
                    if (dt === 'Lead') {
                        isLeadCard = true;
                    } else if (dt === 'Business Contacts') {
                        isContactCard = true;
                    }
                    if (isLeadCard) {
                        totalValue += (parseFloat(rec.po_value || rec.expected_revenue || 0));
                    }
                });

                const topHeaderHtml = `
                    <div style="background: #ffffff; color: #1e293b; padding: 16px 20px; border: 1px solid #e2e8f0; border-left: 4px solid #2563eb; border-radius: 8px; margin-bottom: 16px; box-shadow: 0 4px 6px -1px rgba(0,0,0,0.05);">
                        <div style="display: flex; align-items: center; justify-content: space-between; flex-wrap: wrap; gap: 12px;">
                            <div>
                                <div style="font-size: 16px; font-weight: 700; color: #0f172a; letter-spacing: -0.025em;">${cardTitle}</div>
                                <div style="font-size: 12px; color: #64748b; margin-top: 4px; font-weight: 500;">
                                    User: <span style="color: #0f172a; font-weight: 700;">${userDisp}</span> &nbsp;|&nbsp; Period: <span style="color: #0f172a; font-weight: 700;">${dateDisp}</span>
                                </div>
                            </div>
                            <div style="display: flex; align-items: center; gap: 10px;">
                                <div style="background: #f8fafc; padding: 6px 14px; border-radius: 6px; text-align: center; border: 1px solid #e2e8f0; box-shadow: 0 1px 2px rgba(0,0,0,0.02);">
                                    <div style="font-size: 10px; color: #64748b; font-weight: 600; text-transform: uppercase; letter-spacing: 0.05em;">Total Records</div>
                                    <div style="font-size: 15px; font-weight: 800; color: #2563eb; margin-top: 1px;">${totalCount} Records</div>
                                </div>
                                ${isLeadCard ? `
                                    <div style="background: #f8fafc; padding: 6px 14px; border-radius: 6px; text-align: center; border: 1px solid #e2e8f0; box-shadow: 0 1px 2px rgba(0,0,0,0.02);">
                                        <div style="font-size: 10px; color: #64748b; font-weight: 600; text-transform: uppercase; letter-spacing: 0.05em;">Total Value / PO</div>
                                        <div style="font-size: 15px; font-weight: 800; color: #16a34a; margin-top: 1px;">${fmtVal(totalValue)}</div>
                                    </div>
                                ` : ''}
                            </div>
                        </div>
                    </div>
                `;

                const searchBarHtml = `
                    <div style="margin-bottom: 12px; display: flex; align-items: center; justify-content: space-between; gap: 12px; background: #ffffff; padding: 10px 14px; border-radius: 8px; border: 1px solid #e2e8f0; box-shadow: 0 2px 4px rgba(0,0,0,0.02);">
                        <div style="position: relative; flex: 1;">
                            <input type="text" id="dac_prompt_search_input" placeholder="Live Search by ID, Name, Customer, Mobile, Email, Company, Owner..." style="width: 100%; padding: 8px 12px 8px 34px; border: 1px solid #cbd5e1; border-radius: 6px; font-size: 14.5px; outline: none; background: #f8fafc; color: #0f172a; transition: all 0.2s ease-in-out;">
                            <span style="position: absolute; left: 12px; top: 50%; transform: translateY(-50%); font-size: 14px; color: #64748b;">🔍</span>
                        </div>
                        <div style="font-size: 13.5px; font-weight: 600; color: #475569; white-space: nowrap;">
                            Showing <span id="dac_shown_cnt" style="color: #2563eb; font-weight: 700;">${totalCount}</span> of <b style="color: #0f172a;">${totalCount}</b> Records
                        </div>
                    </div>
                `;

                let headersHtml = "";
                let colCount = 9;
                if (isLeadCard) {
                    colCount = 16;
                    headersHtml = `
                        <tr style="background: #3498db; font-size: 13px; color: #ffffff; text-align: left;">
                            <th style="padding: 10px 14px; width: 40px; border-right: 1px solid #2980b9; text-align: center;">S.No</th>
                            <th style="padding: 10px 14px; border-right: 1px solid #2980b9;">Full Name</th>
                            <th style="padding: 10px 14px; border-right: 1px solid #2980b9;">Organization Name</th>
                            <th style="padding: 10px 14px; border-right: 1px solid #2980b9; width: 180px;">Email ID</th>
                            <th style="padding: 10px 14px; border-right: 1px solid #2980b9;">Mobile No</th>
                            <th style="padding: 10px 14px; border-right: 1px solid #2980b9;">Lead Type</th>
                            <th style="padding: 10px 14px; border-right: 1px solid #2980b9;">Source</th>
                            <th style="padding: 10px 14px; border-right: 1px solid #2980b9;">Industry</th>
                            <th style="padding: 10px 14px; border-right: 1px solid #2980b9; text-align: left;">Expected Revenue</th>
                            <th style="padding: 10px 14px; border-right: 1px solid #2980b9;">Expected Closure Month</th>
                            <th style="padding: 10px 14px; border-right: 1px solid #2980b9;">Lead Owner</th>
                            <th style="padding: 10px 14px; border-right: 1px solid #2980b9;">Created On</th>
                            <th style="padding: 10px 14px; border-right: 1px solid #2980b9;">Age</th>
                            <th style="padding: 10px 14px; border-right: 1px solid #2980b9;">Next Follow Up Date</th>
                            <th style="padding: 10px 14px; border-right: 1px solid #2980b9; text-align: center;">Quotations</th>
                            <th style="padding: 10px 14px;">Last Completed Notes</th>
                        </tr>
                    `;
                } else if (isContactCard) {
                    colCount = 12;
                    headersHtml = `
                        <tr style="background: #3498db; font-size: 13px; color: #ffffff; text-align: left;">
                            <th style="padding: 10px 14px; width: 40px; border-right: 1px solid #2980b9; text-align: center;">S.No</th>
                            <th style="padding: 10px 14px; border-right: 1px solid #2980b9;">Full Name</th>
                            <th style="padding: 10px 14px; border-right: 1px solid #2980b9;">Organization Name</th>
                            <th style="padding: 10px 14px; border-right: 1px solid #2980b9;">Mobile No</th>
                            <th style="padding: 10px 14px; border-right: 1px solid #2980b9; width: 180px;">Email ID</th>
                            <th style="padding: 10px 14px; border-right: 1px solid #2980b9;">Industry</th>
                            <th style="padding: 10px 14px; border-right: 1px solid #2980b9;">Assigned Owner</th>
                            <th style="padding: 10px 14px; border-right: 1px solid #2980b9;">Location</th>
                            <th style="padding: 10px 14px; border-right: 1px solid #2980b9;">Created On</th>
                            <th style="padding: 10px 14px; border-right: 1px solid #2980b9;">Age</th>
                            <th style="padding: 10px 14px; border-right: 1px solid #2980b9;">Next Follow Up Date</th>
                            <th style="padding: 10px 14px;">Last Completed Notes</th>
                        </tr>
                    `;
                } else {
                    colCount = 10;
                    headersHtml = `
                        <tr style="background: #3498db; font-size: 13px; color: #ffffff; text-align: left;">
                            <th style="padding: 10px 14px; width: 40px; border-right: 1px solid #2980b9; text-align: center;">S.No</th>
                            <th style="padding: 10px 14px; border-right: 1px solid #2980b9;">Activity Subject</th>
                            <th style="padding: 10px 14px; border-right: 1px solid #2980b9;">Category</th>
                            <th style="padding: 10px 14px; border-right: 1px solid #2980b9;">Reference Entity</th>
                            <th style="padding: 10px 14px; border-right: 1px solid #2980b9;">Contact Mobile</th>
                            <th style="padding: 10px 14px; border-right: 1px solid #2980b9; width: 180px;">Contact Email</th>
                            <th style="padding: 10px 14px; border-right: 1px solid #2980b9;">Assigned To</th>
                            <th style="padding: 10px 14px; border-right: 1px solid #2980b9;">Next Follow Up Date</th>
                            <th style="padding: 10px 14px; border-right: 1px solid #2980b9; text-align: center;">Days Left</th>
                            <th style="padding: 10px 14px;">Status &amp; Actions</th>
                        </tr>
                    `;
                }

                let rowsHtml = "";
                records.forEach((rec, idx) => {
                    const dt = rec.doctype || (isContactCard ? 'Business Contacts' : (isLeadCard ? 'Lead' : 'Event Activity'));
                    const name = rec.name || '-';
                    const leadName = rec.lead_name || rec.contact_name || rec.subject || name;
                    const company = rec.company || rec.ref_extra || '-';
                    const customerName = rec.customer_name || '-';
                    const mobile = rec.mobile_no || rec.ref_mobile || '-';
                    const email = rec.email_id || rec.ref_email || '-';
                    const owner = rec.owner || '-';
                    const category = rec.category || rec.status || '-';
                    const date = rec.created_on || rec.end_date || rec.starts_on || rec.start_date || '-';
                    const linkUrl = `/app/${frappe.router.slug(dt)}/${name}`;
                    const refLinkUrl = (rec.reference_type && rec.reference_name)
                        ? `/app/${frappe.router.slug(rec.reference_type)}/${encodeURIComponent(rec.reference_name)}`
                        : '';
                    const val = (dt === 'Lead' || isLeadCard) ? fmtVal(rec.po_value || rec.expected_revenue) : '';
                    const territory = rec.territory || '-';
                    const industry = rec.industry || '-';
                    const loc = [rec.city, rec.country].filter(Boolean).join(', ') || territory;

                    const searchStr = `${name} ${leadName} ${company} ${customerName} ${mobile} ${email} ${owner} ${category} ${territory} ${loc}`.toLowerCase();

                    if (isLeadCard) {
                        const ltype = rec.custom_lead_type || '-';
                        const src = rec.source || '-';
                        const expClose = rec.expected_close || 'No Closure Date';
                        const valStr = val ? val : '₹0';

                        let closureIndicatorHtml = '';
                        if (rec.closure_date) {
                            const cDate = new Date(rec.closure_date);
                            const today = new Date();
                            cDate.setHours(0, 0, 0, 0);
                            today.setHours(0, 0, 0, 0);
                            const diffDays = Math.ceil((cDate.getTime() - today.getTime()) / (1000 * 60 * 60 * 24));
                            if (diffDays < 0) {
                                closureIndicatorHtml = ` <span style="background: #fee2e2; color: #dc2626; border: 1px solid #fecaca; padding: 2px 6px; border-radius: 4px; font-size: 11px; font-weight: 700; margin-left: 6px; white-space: nowrap;">Closure Overdue by ${Math.abs(diffDays)} days</span>`;
                            } else if (diffDays === 0) {
                                closureIndicatorHtml = ` <span style="background: #fef9c3; color: #b45309; border: 1px solid #fef08a; padding: 2px 6px; border-radius: 4px; font-size: 11px; font-weight: 700; margin-left: 6px; white-space: nowrap;">Closes Today</span>`;
                            } else {
                                closureIndicatorHtml = ` <span style="background: #eff6ff; color: #1e40af; border: 1px solid #bfdbfe; padding: 2px 6px; border-radius: 4px; font-size: 11px; font-weight: 700; margin-left: 6px; white-space: nowrap;">${diffDays} days left</span>`;
                            }
                        }

                        rowsHtml += `
                            <tr class="dac-prompt-row" data-search="${searchStr}" style="border-bottom: 1px solid #cbd5e1; font-size: 13px; color: #0f172a;">
                                <td style="padding: 10px 14px; color: #1e293b; font-weight: 700; text-align: center;">${idx + 1}</td>
                                <td style="padding: 10px 14px; color: #0f172a; font-weight: 700; cursor: pointer;" onclick="window.open('${linkUrl}', '_blank')">
                                    <a href="${linkUrl}" target="_blank" style="color: #2563eb; font-weight: 700; text-decoration: none;" title="Open Lead Record (${name})">${leadName}</a>
                                </td>
                                <td style="padding: 10px 14px; color: #0f172a; font-weight: 500;">${company}</td>
                                <td class="dac-email-cell" style="padding: 10px 14px; color: #0f172a; font-weight: 500;" title="${email}">${email}</td>
                                <td style="padding: 10px 14px; color: #0f172a; font-weight: 500;">${mobile}</td>
                                <td style="padding: 10px 14px; color: #0f172a; font-weight: 500;">${ltype}</td>
                                <td style="padding: 10px 14px; color: #0f172a; font-weight: 500;">${src}</td>
                                <td style="padding: 10px 14px; color: #0f172a; font-weight: 500;">${industry}</td>
                                <td style="padding: 10px 14px; text-align: left; color: #0f172a; font-weight: 700;">${valStr}</td>
                                <td style="padding: 10px 14px; color: #0f172a; font-weight: 500;">${expClose}${closureIndicatorHtml}</td>
                                <td style="padding: 10px 14px; color: #0f172a; font-weight: 500;">${getUserDisplayName(owner)}</td>
                                <td style="padding: 10px 14px; color: #0f172a; font-weight: 500;">${date}</td>
                                <td style="padding: 10px 14px; color: #0f172a; font-weight: 700;">${rec.age_days || 0} Days</td>
                                <td style="padding: 10px 14px; color: #0f172a; font-weight: 600;">${rec.next_followup || '-'}</td>
                                <td style="padding: 10px 14px; color: #2563eb; font-weight: 700; text-align: center;">${rec.quotation_count || 0}</td>
                                <td class="dac-notes-cell" style="padding: 10px 14px; color: #475569; font-weight: 500;" title="${rec.last_completed_notes || ''}">${rec.last_completed_notes || '-'}</td>
                            </tr>
                        `;
                    } else if (isContactCard) {
                        rowsHtml += `
                            <tr class="dac-prompt-row" data-search="${searchStr}" style="border-bottom: 1px solid #cbd5e1; font-size: 13px; color: #0f172a;">
                                <td style="padding: 10px 14px; color: #1e293b; font-weight: 700; text-align: center;">${idx + 1}</td>
                                <td style="padding: 10px 14px; color: #0f172a; font-weight: 700; cursor: pointer;" onclick="window.open('${linkUrl}', '_blank')">
                                    <a href="${linkUrl}" target="_blank" style="color: #2563eb; font-weight: 700; text-decoration: none;" title="Open Business Contact Record (${name})">${leadName}</a>
                                </td>
                                <td style="padding: 10px 14px; color: #0f172a; font-weight: 500;">${company}</td>
                                <td style="padding: 10px 14px; color: #0f172a; font-weight: 500;">${mobile}</td>
                                <td class="dac-email-cell" style="padding: 10px 14px; color: #0f172a; font-weight: 500;" title="${email}">${email}</td>
                                <td style="padding: 10px 14px; color: #0f172a; font-weight: 500;">${industry}</td>
                                <td style="padding: 10px 14px; color: #0f172a; font-weight: 500;">${getUserDisplayName(owner)}</td>
                                <td style="padding: 10px 14px; color: #0f172a; font-weight: 500;">${loc}</td>
                                <td style="padding: 10px 14px; color: #0f172a; font-weight: 500;">${date}</td>
                                <td style="padding: 10px 14px; color: #0f172a; font-weight: 700;">${rec.age_days || 0} Days</td>
                                <td style="padding: 10px 14px; color: #0f172a; font-weight: 600;">${rec.next_followup || '-'}</td>
                                <td class="dac-notes-cell" style="padding: 10px 14px; color: #475569; font-weight: 500;" title="${rec.last_completion_notes || ''}">${rec.last_completion_notes || '-'}</td>
                            </tr>
                        `;
                    } else {
                        const actStatus = rec.status || 'Open';
                        const actDropdown = window.renderActivityActionDropdown(name, actStatus, rec.reference_type, rec.reference_name);

                        let daysLeftHtml = '-';
                        if (rec.starts_on) {
                            const sDate = new Date(rec.starts_on);
                            const today = new Date();
                            sDate.setHours(0, 0, 0, 0);
                            today.setHours(0, 0, 0, 0);
                            const diffDays = Math.ceil((sDate.getTime() - today.getTime()) / (1000 * 60 * 60 * 24));
                            if (diffDays < 0) {
                                daysLeftHtml = `<span style="background: #fee2e2; color: #dc2626; border: 1px solid #fecaca; padding: 2px 6px; border-radius: 4px; font-size: 11px; font-weight: 700; white-space: nowrap;">Overdue by ${Math.abs(diffDays)} days</span>`;
                            } else if (diffDays === 0) {
                                daysLeftHtml = `<span style="background: #fef9c3; color: #b45309; border: 1px solid #fef08a; padding: 2px 6px; border-radius: 4px; font-size: 11px; font-weight: 700; white-space: nowrap;">Today</span>`;
                            } else {
                                daysLeftHtml = `<span style="background: #eff6ff; color: #1e40af; border: 1px solid #bfdbfe; padding: 2px 6px; border-radius: 4px; font-size: 11px; font-weight: 700; white-space: nowrap;">${diffDays} days left</span>`;
                            }
                        }

                        rowsHtml += `
                            <tr class="dac-prompt-row" data-search="${searchStr}" style="border-bottom: 1px solid #cbd5e1; font-size: 13px; color: #0f172a;">
                                <td style="padding: 10px 14px; color: #1e293b; font-weight: 700; text-align: center;">${idx + 1}</td>
                                <td style="padding: 10px 14px; color: #0f172a; font-weight: 700; cursor: pointer;" onclick="window.open('${linkUrl}', '_blank')">
                                    <a href="${linkUrl}" target="_blank" style="color: #2563eb; font-weight: 700; text-decoration: none;" title="Open Event Activity Record (${name})">${leadName}</a>
                                </td>
                                <td style="padding: 10px 14px; vertical-align: middle;"><span style="background: #eff6ff; color: #1e40af; border: 1px solid #bfdbfe; padding: 4px 10px; border-radius: 12px; font-size: 12px; font-weight: 700; white-space: nowrap;">${category}</span></td>
                                <td style="padding: 10px 14px;">
                                    ${refLinkUrl ? `
                                        <div style="font-weight: 700; color: #0f172a; font-size: 13px;">
                                            <a href="${refLinkUrl}" target="_blank" style="color: #2563eb; font-weight: 700; text-decoration: none;" title="Open ${rec.reference_type} (${rec.reference_name})">
                                                ${rec.reference_type}: ${rec.ref_display_name || rec.reference_name}
                                            </a>
                                        </div>
                                    ` : `
                                        <div style="font-weight: 700; color: #0f172a; font-size: 13px;">${rec.reference_type || ''}${rec.reference_type ? ': ' : ''}${rec.ref_display_name || ''}</div>
                                    `}
                                    ${company !== '-' ? `<div style="font-size: 11px; color: #475569; margin-top: 1px;">${company}</div>` : ''}
                                </td>
                                <td style="padding: 10px 14px; color: #0f172a; font-weight: 500;">${mobile}</td>
                                <td class="dac-email-cell" style="padding: 10px 14px; color: #0f172a; font-weight: 500;" title="${email}">${email}</td>
                                <td style="padding: 10px 14px; color: #0f172a; font-weight: 500;">${getUserDisplayName(owner)}</td>
                                <td style="padding: 10px 14px; color: #0f172a; font-weight: 600;">${rec.start_date || '-'}</td>
                                <td style="padding: 10px 14px; text-align: center;">${daysLeftHtml}</td>
                                <td style="padding: 10px 14px; text-align: left; min-width: 170px;">
                                    ${actDropdown}
                                </td>
                            </tr>
                        `;
                    }
                });

                if (records.length === 0) {
                    rowsHtml = `<tr><td colspan="${colCount}" style="padding: 24px; text-align: center; color: #94a3b8; font-weight: 500;">No records found matching current criteria.</td></tr>`;
                }

                const tableHtml = `
                    <style>
                        .dac-prompt-row:nth-child(even) { background-color: #f9fafb; }
                    </style>
                    <div style="font-family: -apple-system, BlinkMacSystemFont, Segoe UI, Roboto, sans-serif;">
                        ${topHeaderHtml}
                        ${searchBarHtml}
                        <div class="dac-modal-scroll-wrap" style="max-height: calc(75vh - 180px); min-height: 100px; overflow-x: auto !important; overflow-y: auto !important; border: 1px solid #cbd5e1; border-radius: 6px; box-shadow: 0 1px 3px rgba(0,0,0,0.02);">
                            <table style="width: max-content !important; min-width: 100% !important; border-collapse: separate; border-spacing: 0; text-align: left;">
                                <thead style="position: sticky; top: 0; z-index: 10; background: #3498db;">
                                    ${headersHtml}
                                </thead>
                                <tbody>
                                    ${rowsHtml}
                                </tbody>
                            </table>
                        </div>
                    </div>
                `;

                const d = new frappe.ui.Dialog({
                    title: `${cardTitle} (${totalCount} Records)`,
                    size: 'extra-large',
                    fields: [
                        {
                            fieldtype: 'HTML',
                            fieldname: 'records_html',
                            options: tableHtml
                        }
                    ]
                });
                d.$wrapper.addClass('dac-wide-modal');
                d.show();

                setTimeout(() => {
                    const dlgWrapper = d.$wrapper;
                    if (dlgWrapper && dlgWrapper.length) {

                        const tableEl = dlgWrapper.find('table')[0];
                        if (tableEl) {
                            window.makeTableSortable(tableEl);
                        }

                        const searchInput = dlgWrapper.find('#dac_prompt_search_input');
                        searchInput.on('input', function () {
                            const term = $(this).val().toLowerCase().trim();
                            let visibleCnt = 0;
                            dlgWrapper.find('.dac-prompt-row').each(function () {
                                const rowStr = $(this).attr('data-search') || $(this).text().toLowerCase();
                                if (!term || rowStr.includes(term)) {
                                    $(this).show();
                                    visibleCnt++;
                                } else {
                                    $(this).hide();
                                }
                            });
                            dlgWrapper.find('#dac_shown_cnt').text(visibleCnt);
                        });
                    }
                }, 50);
            };

            if (expectedCount === 0) {
                handleResponse({ message: { records: [] } });
            } else {
                frappe.call({
                    method: "erp_dacsinc_custom.custom_lead.get_card_detail_records",
                    args: filterArgs,
                    callback: handleResponse
                });
            }
        };

        window.renderActivityActionDropdown = function (actName, status, refType, refName) {
            const statusBadge = status === 'Completed'
                ? `<span style="background:#dcfce7;color:#15803d;padding:4px 8px;border-radius:4px;font-size:12px;font-weight:700;">Completed</span>`
                : (status === 'Cancelled'
                    ? `<span style="background:#fee2e2;color:#dc2626;padding:4px 8px;border-radius:4px;font-size:12px;font-weight:700;">Cancelled</span>`
                    : `<span style="background:#fef9c3;color:#b45309;padding:4px 8px;border-radius:4px;font-size:12px;font-weight:700;">Open</span>`);

            return `
            <div style="display:flex;align-items:center;gap:6px;flex-wrap:nowrap;">
                ${statusBadge}
                <select onchange="window.handleActivityActionChange(this, '${actName}', '${refType || ''}', '${refName || ''}')" style="background:#ffffff;color:#0f172a;border:1px solid #94a3b8;border-radius:6px;padding:4px 8px;font-size:12px;font-weight:700;cursor:pointer;outline:none;box-shadow:0 1px 2px rgba(0,0,0,0.05);">
                    <option value="" disabled selected>Actions ▾</option>
                    ${status === 'Open' ? `
                        <option value="complete">✓ Mark Completed</option>
                        <option value="complete_new">+ Complete &amp; New</option>
                        <option value="cancel">✕ Cancel Activity</option>
                    ` : `
                        <option value="reopen">↺ Reopen Activity</option>
                    `}
                </select>
            </div>
        `;
        };

        window.handleActivityActionChange = function (selectEl, actName, refType, refName) {
            const val = selectEl.value;
            selectEl.value = "";
            if (val === 'complete') {
                window.quickCompleteActivity(actName, selectEl, refType, refName);
            } else if (val === 'complete_new') {
                window.quickCompleteAndNew(actName, selectEl, refType, refName);
            } else if (val === 'cancel') {
                window.quickCancelActivity(actName, selectEl, refType, refName);
            } else if (val === 'reopen') {
                window.quickReopenActivity(actName, selectEl, refType, refName);
            }
        };

        function showDashboardActivityPrompt(actName, btn, refType, refName, is_new) {
            if (refType === 'Lead') {
                frappe.db.get_value("Lead", refName, "custom_lead_category").then((r) => {
                    let cat = r.message ? r.message.custom_lead_category : 'Enquiry';
                    openDashboardPromptDialog(actName, btn, refType, refName, cat, is_new);
                });
            } else {
                openDashboardPromptDialog(actName, btn, refType, refName, null, is_new);
            }
        }

        function openDashboardPromptDialog(actName, btn, refType, refName, leadCategory, is_new) {
            let fields = [
                {
                    fieldname: "notes",
                    label: "Completion Note",
                    fieldtype: "Small Text",
                    reqd: 1
                }
            ];

            if (refType === "Lead") {
                fields.push(
                    {
                        fieldname: "mark_lost",
                        label: "Mark Lead as Lost",
                        fieldtype: "Check",
                        default: 0
                    },
                    {
                        fieldname: "lost_reason",
                        label: (leadCategory === "Enquiry" ? "Reason for Unqualified Lead" : "Reason for Lost"),
                        fieldtype: "Link",
                        options: (leadCategory === "Enquiry" ? "Lost Enquiry Reasons" : "Quotation Lost Reason"),
                        reqd: 0,
                        depends_on: "eval:doc.mark_lost"
                    },
                    {
                        fieldname: "lost_reason_description",
                        label: "Lost Reason Description",
                        fieldtype: "Small Text",
                        reqd: 0,
                        depends_on: "eval:doc.mark_lost"
                    }
                );
            }

            if (is_new) {
                fields.push(
                    {
                        fieldname: "new_sec",
                        fieldtype: "Section Break",
                        label: "Next Activity Details",
                        depends_on: "eval:!doc.mark_lost"
                    },
                    {
                        fieldname: "new_category",
                        label: "Next Category",
                        fieldtype: "Select",
                        options: [
                            "Initial Call",
                            "Follow Up Call",
                            "Offline Initial Meeting",
                            "Offline Follow up Meeting",
                            "Offline Sample Meeting",
                            "Online Meeting",
                            "Proposal/Quotation",
                            "Order Closure",
                            "Others"
                        ].join("\n"),
                        default: "Follow Up Call",
                        reqd: 0,
                        depends_on: "eval:!doc.mark_lost"
                    },
                    {
                        fieldname: "new_subject",
                        label: "Next Subject",
                        fieldtype: "Data",
                        reqd: 0,
                        depends_on: "eval:!doc.mark_lost"
                    },
                    {
                        fieldname: "new_starts_on",
                        label: "Next Followup Date",
                        fieldtype: "Datetime",
                        default: frappe.datetime.add_days(frappe.datetime.now_datetime(), 1),
                        reqd: 0,
                        depends_on: "eval:!doc.mark_lost"
                    },
                    {
                        fieldname: "new_assigned_to",
                        label: "Next Assigned To",
                        fieldtype: "Link",
                        options: "User",
                        default: frappe.session.user,
                        reqd: 0,
                        depends_on: "eval:!doc.mark_lost"
                    }
                );
            }

            frappe.prompt(fields, (values) => {
                if (values.mark_lost) {
                    if (!values.lost_reason || !values.lost_reason_description) {
                        frappe.msgprint("Please fill Lost Reason and Description");
                        return;
                    }
                    frappe.call({
                        method: "erp_dacsinc_custom.custom_lead.mark_lead_lost_backend",
                        args: {
                            lead_name: refName,
                            category: leadCategory,
                            lost_reason: values.lost_reason,
                            lost_reason_description: values.lost_reason_description,
                            current_activity_id: actName,
                            completion_note: values.notes
                        },
                        callback: function (r) {
                            if (!r.exc) {
                                frappe.show_alert({ message: "Lead marked as LOST", indicator: "red" });
                                loadActivityData();
                                const container = btn.closest('td');
                                if (container) {
                                    container.innerHTML = window.renderActivityActionDropdown(actName, 'Completed', refType, refName);
                                }
                            }
                        }
                    });
                } else {
                    if (is_new) {
                        if (!values.new_subject || !values.new_category || !values.new_starts_on || !values.new_assigned_to) {
                            frappe.msgprint("Please fill all next activity details");
                            return;
                        }
                    }
                    frappe.call({
                        method: 'frappe.client.set_value',
                        args: { doctype: 'Event Activity', name: actName, fieldname: { status: 'Completed', notes: values.notes, ends_on: frappe.datetime.now_datetime() } },
                        callback: () => {
                            frappe.show_alert({ message: actName + ' marked Completed', indicator: 'green' });
                            loadActivityData();
                            const container = btn.closest('td');
                            if (container) {
                                container.innerHTML = window.renderActivityActionDropdown(actName, 'Completed', refType, refName);
                            }

                            if (is_new) {
                                frappe.call({
                                    method: 'frappe.client.insert',
                                    args: {
                                        doc: {
                                            doctype: "Event Activity",
                                            reference_type: refType || '',
                                            reference_name: refName || '',
                                            subject: values.new_subject,
                                            category: values.new_category,
                                            starts_on: values.new_starts_on,
                                            assigned_to: values.new_assigned_to,
                                            status: "Open"
                                        }
                                    },
                                    callback: function (res) {
                                        if (res.message) {
                                            frappe.show_alert({ message: "Next Activity Created Successfully", indicator: "green" });
                                            loadActivityData();
                                        }
                                    }
                                });
                            }
                        }
                    });
                }
            }, is_new ? 'Complete & Create New' : 'Mark as Completed', 'Submit');
        }

        window.quickCompleteActivity = function (actName, btn, refType, refName) {
            showDashboardActivityPrompt(actName, btn, refType, refName, false);
        };

        window.quickCompleteAndNew = function (actName, btn, refType, refName) {
            showDashboardActivityPrompt(actName, btn, refType, refName, true);
        };

        window.quickCancelActivity = function (actName, btn, refType, refName) {
            frappe.prompt([{ label: 'Cancellation Note', fieldname: 'notes', fieldtype: 'Small Text', reqd: 1 }], (v) => {
                frappe.call({
                    method: 'frappe.client.set_value',
                    args: { doctype: 'Event Activity', name: actName, fieldname: { status: 'Cancelled', notes: v.notes, ends_on: frappe.datetime.now_datetime() } },
                    callback: () => {
                        frappe.show_alert({ message: actName + ' Cancelled', indicator: 'orange' });
                        loadActivityData();
                        const container = btn.closest('td');
                        if (container) {
                            container.innerHTML = window.renderActivityActionDropdown(actName, 'Cancelled', refType, refName);
                        }
                    }
                });
            }, 'Cancel Activity', 'Submit');
        };

        window.quickReopenActivity = function (actName, btn, refType, refName) {
            frappe.call({
                method: 'frappe.client.set_value',
                args: { doctype: 'Event Activity', name: actName, fieldname: { status: 'Open', ends_on: null } },
                callback: () => {
                    frappe.show_alert({ message: actName + ' Reopened', indicator: 'blue' });
                    loadActivityData();
                    const container = btn.closest('td');
                    if (container) {
                        container.innerHTML = window.renderActivityActionDropdown(actName, 'Open', refType, refName);
                    }
                }
            });
        };

        window.openActivityCategoryModal = function (catName, catTitle, refType, rowFromDate, rowToDate, periodLabel) {
            const userDisp = getSelectedOptionText('#ea_user_sel', 'All Team Members');
            const userSel = $('#ea_user_sel').val();

            let fromDate = rowFromDate || "";
            let toDate = rowToDate || "";
            let dateDisp = periodLabel || "All Time";
            let periodVal = "";

            if (!fromDate && !toDate) {
                const pVal = $('#ea_p_filter').val();
                if (pVal === 'custom') {
                    const dt = getDateParams(pVal, '#ea_custom_dates_wrap', 'ea_dr');
                    fromDate = dt.from_date;
                    toDate = dt.to_date;
                    dateDisp = `${fromDate} to ${toDate}`;
                } else if (pVal === 'fiscal_year') {
                    const fyVal = $('#ea_fy_filter').val();
                    dateDisp = fyVal;
                } else if (pVal) {
                    periodVal = pVal;
                    dateDisp = getSelectedOptionText('#ea_p_filter', 'All Time');
                }
            }

            const filterArgs = {
                category: catName || '',
                reference_type: refType || 'All',
                user: userSel,
                from_date: fromDate,
                to_date: toDate,
                period: periodVal
            };
            if ($('#ea_p_filter').val() === 'fiscal_year') {
                filterArgs.fiscal_year = $('#ea_fy_filter').val();
            }

            frappe.call({
                method: "erp_dacsinc_custom.custom_lead.get_activity_detail_records",
                args: filterArgs,
                callback: function (r) {
                    if (!r.message || !r.message.records) return;
                    const records = r.message.records;
                    const totalCount = records.length;

                    const topHeaderHtml = `
                    <div style="background: #ffffff; color: #1e293b; padding: 16px 20px; border: 1px solid #e2e8f0; border-left: 4px solid #2563eb; border-radius: 8px; margin-bottom: 16px; box-shadow: 0 4px 6px -1px rgba(0,0,0,0.05);">
                        <div style="display: flex; align-items: center; justify-content: space-between; flex-wrap: wrap; gap: 12px;">
                            <div>
                                <div style="font-size: 16px; font-weight: 700; color: #0f172a; letter-spacing: -0.025em;">${catTitle}</div>
                                <div style="font-size: 12px; color: #64748b; margin-top: 4px; font-weight: 500;">
                                    Category: <span style="color: #0f172a; font-weight: 700;">${catName || 'All Categories'}</span> &nbsp;|&nbsp; Entity: <span style="color: #0f172a; font-weight: 700;">${refType}</span> &nbsp;|&nbsp; User: <span style="color: #0f172a; font-weight: 700;">${userDisp}</span> &nbsp;|&nbsp; Period: <span style="color: #0f172a; font-weight: 700;">${dateDisp}</span>
                                </div>
                            </div>
                            <div style="background: #f8fafc; padding: 6px 14px; border-radius: 6px; text-align: center; border: 1px solid #e2e8f0; box-shadow: 0 1px 2px rgba(0,0,0,0.02);">
                                <div style="font-size: 10px; color: #64748b; font-weight: 600; text-transform: uppercase; letter-spacing: 0.05em;">Completed Activities</div>
                                <div style="font-size: 15px; font-weight: 800; color: #2563eb; margin-top: 1px;">${totalCount} Records</div>
                            </div>
                        </div>
                    </div>
                `;

                    const searchBarHtml = `
                    <div style="margin-bottom: 12px; display: flex; align-items: center; justify-content: space-between; gap: 12px; background: #ffffff; padding: 10px 14px; border-radius: 8px; border: 1px solid #e2e8f0; box-shadow: 0 2px 4px rgba(0,0,0,0.02);">
                        <div style="position: relative; flex: 1;">
                            <input type="text" id="dac_prompt_act_search" placeholder="Live Search by Activity ID, Subject, Reference Name, Mobile, Email, Assigned To..." style="width: 100%; padding: 8px 12px 8px 34px; border: 1px solid #cbd5e1; border-radius: 6px; font-size: 14.5px; outline: none; background: #f8fafc; color: #0f172a; transition: all 0.2s ease-in-out;">
                            <span style="position: absolute; left: 12px; top: 50%; transform: translateY(-50%); font-size: 14px; color: #64748b;">🔍</span>
                        </div>
                        <div style="font-size: 13.5px; font-weight: 600; color: #475569; white-space: nowrap;">
                            Showing <span id="dac_act_shown_cnt" style="color: #2563eb; font-weight: 700;">${totalCount}</span> of <b style="color: #0f172a;">${totalCount}</b> Records
                        </div>
                    </div>
                `;

                    let rowsHtml = "";
                    records.forEach((rec, idx) => {
                        const name = rec.name || '-';
                        const subject = rec.subject || '-';
                        const rType = rec.reference_type || '-';
                        const refName = rec.ref_display_name || rec.reference_name || '-';
                        const companyName = rec.ref_extra || '-';
                        const refExtra = rec.ref_extra ? ` (${rec.ref_extra})` : '';
                        const mobile = rec.ref_mobile || '-';
                        const email = rec.ref_email || '-';
                        const owner = rec.owner || '-';
                        const date = rec.end_date || '-';

                        const linkUrl = `/app/event-activity/${name}`;
                        const refLink = rType === 'Lead' ? `/app/lead/${rec.reference_name}` : (rType === 'Business Contacts' ? `/app/business-contacts/${rec.reference_name}` : '#');
                        const searchStr = `${name} ${subject} ${rType} ${refName} ${refExtra} ${mobile} ${email} ${owner}`.toLowerCase();

                        rowsHtml += `
                        <tr class="dac-prompt-act-row" data-search="${searchStr}" style="border-bottom: 1px solid #cbd5e1; font-size: 13px; color: #0f172a;">
                            <td style="padding: 10px 14px; color: #1e293b; font-weight: 700; text-align: center;">${idx + 1}</td>
                            <td style="padding: 10px 14px; color: #0f172a; font-weight: 700; cursor: pointer;" onclick="window.open('${linkUrl}', '_blank')">
                                <a href="${linkUrl}" target="_blank" style="color: #2563eb; font-weight: 700; text-decoration: none;" title="Open Event Activity Record (${name})">${subject}</a>
                            </td>
                            <td style="padding: 10px 14px; vertical-align: middle;"><span style="background: #eff6ff; color: #1e40af; border: 1px solid #bfdbfe; padding: 4px 10px; border-radius: 12px; font-size: 12px; font-weight: 700; white-space: nowrap;">${rec.category || catName || 'Activity'}</span></td>
                            <td style="padding: 10px 14px;">
                                <div style="font-weight: 700; font-size: 13px;">
                                    ${rType !== '-' ? `<a href="${refLink}" target="_blank" style="color: #0f172a; text-decoration: none;" title="Open ${rType}">${rType}: <span style="color:#2563eb;">${refName}</span></a>` : '-'}
                                </div>
                                ${companyName !== '-' ? `<div style="font-size: 11px; color: #475569; margin-top: 1px;">${companyName}</div>` : ''}
                            </td>
                            <td style="padding: 10px 14px; color: #0f172a; font-weight: 500;">${mobile}</td>
                            <td class="dac-email-cell" style="padding: 10px 14px; color: #0f172a; font-weight: 500;" title="${email}">${email}</td>
                            <td style="padding: 10px 14px; color: #0f172a; font-weight: 500;">${getUserDisplayName(owner)}</td>
                            <td style="padding: 10px 14px; color: #0f172a; font-weight: 500;">${date}</td>
                        </tr>
                    `;
                    });

                    if (records.length === 0) {
                        rowsHtml = `<tr><td colspan="8" style="padding: 24px; text-align: center; color: #94a3b8; font-weight: 500;">No activity records found for ${catTitle}.</td></tr>`;
                    }

                    const actTableHtml = `
                    <style>
                        .dac-prompt-act-row:nth-child(even) { background-color: #f9fafb; }
                    </style>
                    <div style="font-family: -apple-system, BlinkMacSystemFont, Segoe UI, Roboto, sans-serif;">
                        ${topHeaderHtml}
                        ${searchBarHtml}
                        <div class="dac-modal-scroll-wrap" style="max-height: 520px; overflow-y: auto; overflow-x: auto; border: 1px solid #e2e8f0; border-radius: 6px; box-shadow: 0 1px 3px rgba(0,0,0,0.02);">
                            <table style="width: max-content !important; min-width: 100% !important; border-collapse: separate; border-spacing: 0; text-align: left;">
                                <thead style="position: sticky; top: 0; z-index: 10; background: #3498db;">
                                    <tr style="background: #3498db; font-size: 13px; color: #ffffff; text-align: left;">
                                        <th style="padding: 10px 14px; width: 40px; border-right: 1px solid #2980b9; text-align: center;">S.No</th>
                                        <th style="padding: 10px 14px; border-right: 1px solid #2980b9;">Activity Subject</th>
                                        <th style="padding: 10px 14px; border-right: 1px solid #2980b9;">Category</th>
                                        <th style="padding: 10px 14px; border-right: 1px solid #2980b9;">Reference Entity</th>
                                        <th style="padding: 10px 14px; border-right: 1px solid #2980b9;">Contact Mobile</th>
                                        <th style="padding: 10px 14px; border-right: 1px solid #2980b9; width: 180px;">Contact Email</th>
                                        <th style="padding: 10px 14px; border-right: 1px solid #2980b9;">Assigned To</th>
                                        <th style="padding: 10px 14px;">Completion Date</th>
                                    </tr>
                                </thead>
                                <tbody>
                                    ${rowsHtml}
                                </tbody>
                            </table>
                        </div>
                    </div>
                `;

                    const d = new frappe.ui.Dialog({
                        title: `Event Activity Audit: ${catTitle} (${totalCount} Records)`,
                        size: 'extra-large',
                        fields: [
                            {
                                fieldtype: 'HTML',
                                fieldname: 'details_table',
                                options: actTableHtml
                            }
                        ]
                    });
                    d.$wrapper.addClass('dac-wide-modal');
                    d.show();

                    setTimeout(() => {
                        const dlgWrapper = (d.fields_dict && d.fields_dict.details_table && d.fields_dict.details_table.$wrapper) ? d.fields_dict.details_table.$wrapper : null;
                        if (dlgWrapper) {
                            dlgWrapper.html(actTableHtml);

                            const tableEl = dlgWrapper.find('table')[0];
                            if (tableEl) {
                                window.makeTableSortable(tableEl);
                            }

                            const searchInput = dlgWrapper.find('#dac_prompt_act_search');
                            searchInput.on('input', function () {
                                const term = $(this).val().toLowerCase().trim();
                                let visibleCnt = 0;
                                dlgWrapper.find('.dac-prompt-act-row').each(function () {
                                    const rowStr = $(this).attr('data-search') || $(this).text().toLowerCase();
                                    if (!term || rowStr.includes(term)) {
                                        $(this).show();
                                        visibleCnt++;
                                    } else {
                                        $(this).hide();
                                    }
                                });
                                dlgWrapper.find('#dac_act_shown_cnt').text(visibleCnt);
                            });
                        }
                    }, 50);
                }
            });
        };

    })();