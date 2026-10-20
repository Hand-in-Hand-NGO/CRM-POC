/* العهد الإلكترونية — واجهة الاستخدام (jQuery + Bootstrap 3) */
(function ($) {
    'use strict';

    var S = { csrf: '', user: null, meta: {}, lookups: { categories: [], departments: [], branches: [], locations: [] } };
    var PAGE_SIZE = 50;

    // ------------------------------------------------------------ helpers

    function esc(s) {
        return String(s === null || s === undefined ? '' : s)
            .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
    }

    function dt(s) { return '<span class="d">' + esc(s) + '</span>'; }

    function money(v) {
        if (v === null || v === undefined || v === '') return '-';
        return Number(v).toLocaleString('en-US', { minimumFractionDigits: 0, maximumFractionDigits: 2 });
    }

    function api(action, data, method) {
        method = method || (data && action.indexOf('.list') < 0 && action.indexOf('.get') < 0 ? 'POST' : 'GET');
        var opts = { url: 'api.php?action=' + encodeURIComponent(action), method: method, dataType: 'json', headers: { 'X-CSRF-Token': S.csrf } };
        if (method === 'POST') {
            opts.data = JSON.stringify(data || {});
            opts.contentType = 'application/json';
        } else if (data) {
            opts.url += '&' + $.param(data);
        }
        return $.ajax(opts).then(function (r) { return r.data; }, function (xhr) {
            var msg = (xhr.responseJSON && xhr.responseJSON.error) || 'تعذر الاتصال بالسيرفر';
            if (action === 'auth.login') return $.Deferred().reject(msg).promise();
            if (xhr.status === 401) { showLogin(); }
            toast(msg, 'danger');
            return $.Deferred().reject(msg).promise();
        });
    }

    function toast(msg, type) {
        var $t = $('<div class="toast-item alert alert-' + (type || 'success') + '">' + esc(msg) + '</div>').appendTo('#toast');
        setTimeout(function () { $t.fadeOut(300, function () { $t.remove(); }); }, type === 'danger' ? 5000 : 2500);
    }

    function canEdit() { return S.user && (S.user.role === 'admin' || S.user.role === 'editor'); }
    function isAdmin() { return S.user && S.user.role === 'admin'; }

    function options(list, selected, placeholder) {
        var html = placeholder !== undefined ? '<option value="">' + esc(placeholder) + '</option>' : '';
        list.forEach(function (o) {
            var v = typeof o === 'object' ? o.value : o, t = typeof o === 'object' ? o.text : o;
            html += '<option value="' + esc(v) + '"' + (String(v) === String(selected) ? ' selected' : '') + '>' + esc(t) + '</option>';
        });
        return html;
    }

    function catOptions(selected, placeholder) {
        return options(S.lookups.categories.map(function (c) { return { value: c.id, text: c.name }; }), selected, placeholder);
    }

    function datalist(id, list) {
        return '<datalist id="' + id + '">' + list.map(function (v) { return '<option value="' + esc(v) + '">'; }).join('') + '</datalist>';
    }

    function statusLabel(s) {
        var cls = { 'متاحة': 'success', 'مسلمة': 'primary', 'صيانة': 'warning', 'تالفة': 'danger', 'مفقودة': 'danger', 'مكهنة': 'default' }[s] || 'default';
        return '<span class="label label-' + cls + '">' + esc(s) + '</span>';
    }

    function ackLabel(at) {
        return at ? '<span class="label label-success" title="' + esc(at) + '"><i class="fa fa-check"></i> موقّع</span>'
            : '<span class="label label-warning"><i class="fa fa-clock-o"></i> بانتظار التوقيع</span>';
    }

    function copyText(text, $btn) {
        var done = function () {
            if (!$btn) { toast('تم النسخ'); return; }
            var html = $btn.html();
            $btn.addClass('copied').html('<i class="fa fa-check"></i> تم');
            setTimeout(function () { $btn.removeClass('copied').html(html); }, 1000);
        };
        if (navigator.clipboard && window.isSecureContext) {
            navigator.clipboard.writeText(text).then(done);
        } else {
            var $ta = $('<textarea>').val(text).css({ position: 'fixed', opacity: 0 }).appendTo('body');
            $ta[0].select();
            document.execCommand('copy');
            $ta.remove();
            done();
        }
    }

    function formData($form) {
        var o = {};
        $form.serializeArray().forEach(function (f) { o[f.name] = f.value; });
        $form.find('input[type=checkbox][name]').each(function () { o[this.name] = this.checked ? 1 : 0; });
        return o;
    }

    function exportUrl(type, filters) {
        return 'api.php?action=export&type=' + type + '&' + $.param(filters || {});
    }

    function openPrint(url) { window.open(url, '_blank'); }

    // ------------------------------------------------------------ modal

    function modal(title, body, footer, size) {
        var $m = $('#modal');
        $m.find('.select2-hidden-accessible').select2('destroy');
        var bs = $m.data('bs.modal');
        if (bs) { bs.options.backdrop = true; bs.options.keyboard = true; }
        $m.find('.close').show();
        $m.find('.modal-dialog').attr('class', 'modal-dialog ' + (size || ''));
        $m.find('.modal-title').html(title);
        $m.find('.modal-body').html(body);
        $m.find('.modal-footer').html(footer === undefined ? '<button class="btn btn-default btn-action" data-dismiss="modal">إغلاق</button>' : footer);
        $m.modal('show');
        return $m;
    }

    function confirmBox(msg) {
        var d = $.Deferred();
        var $m = modal('<i class="fa fa-question-circle"></i> تأكيد', '<p>' + esc(msg) + '</p>',
            '<button class="btn btn-danger btn-action" id="cfYes">نعم</button><button class="btn btn-default btn-action" data-dismiss="modal">إلغاء</button>', 'modal-sm');
        $m.find('#cfYes').one('click', function () { d.resolve(); });
        return d.promise();
    }

    function employeeSelect($el, opts) {
        opts = opts || {};
        $el.select2({
            dir: 'rtl', width: '100%', dropdownParent: opts.parent || $('#modal'), placeholder: opts.placeholder || 'اختر الموظف', allowClear: !!opts.allowClear,
            language: { noResults: function () { return 'لا توجد نتائج'; }, searching: function () { return 'جاري البحث...'; } },
            ajax: {
                url: 'api.php', dataType: 'json', delay: 250,
                data: function (p) { return { action: 'employees.list', q: p.term || '', active: '1' }; },
                processResults: function (r) {
                    return {
                        results: r.data.filter(function (e) { return e.id != opts.exclude; }).slice(0, 50).map(function (e) {
                            return { id: e.id, text: e.name + (e.code ? ' (' + e.code + ')' : '') + (e.department ? ' - ' + e.department : '') };
                        })
                    };
                }
            }
        });
    }

    // ------------------------------------------------------------ list view (filters + table + pager)

    function listView(cfg) {
        var html = '<div class="page-head"><h3><i class="fa ' + cfg.icon + '"></i> ' + esc(cfg.title) + '</h3><div class="page-actions">' + (cfg.actions || '') + '</div></div>';
        if (cfg.filters) {
            html += '<div class="panel panel-primary filters-panel"><div class="panel-heading"><i class="fa fa-filter"></i> بحث</div><div class="panel-body"><form class="filters form-inline">' +
                cfg.filters + ' <button class="btn btn-success btn-action" type="submit"><span class="glyphicon glyphicon-search"></span> بحث</button>' +
                ' <button class="btn btn-danger btn-action" type="reset"><i class="fa fa-times"></i> مسح</button></form></div></div>';
        }
        html += '<div class="box box-table"><div class="table-toolbar"><span class="records"></span><span class="toolbar-extra">' + (cfg.toolbar || '') + '</span></div>' +
            '<div class="table-scroll"><table class="table table-bordered table-hover data-table"><thead><tr>' + cfg.head + '</tr></thead><tbody></tbody></table></div>' +
            '<div class="pager-wrap"></div></div>';
        var $c = $('#content').html(html);
        var rows = [], page = 0;

        function draw() {
            var pages = Math.max(1, Math.ceil(rows.length / PAGE_SIZE));
            page = Math.min(page, pages - 1);
            var slice = rows.slice(page * PAGE_SIZE, (page + 1) * PAGE_SIZE);
            var cols = $c.find('thead th').length;
            $c.find('tbody').html(slice.length ? slice.map(cfg.row).join('') : '<tr><td colspan="' + cols + '" class="empty">لا توجد بيانات</td></tr>');
            $c.find('.records').text('عدد السجلات: ' + rows.length);
            var p = '';
            if (pages > 1) {
                p = '<ul class="pagination pagination-sm">';
                for (var i = 0; i < pages; i++) {
                    p += '<li class="' + (i === page ? 'active' : '') + '"><a href="#" data-page="' + i + '">' + (i + 1) + '</a></li>';
                }
                p += '</ul>';
            }
            $c.find('.pager-wrap').html(p);
            if (cfg.drawn) cfg.drawn($c, slice);
        }

        function load() {
            var f = cfg.filters ? formData($c.find('form.filters')) : {};
            $c.find('tbody').html('<tr><td colspan="20" class="empty"><i class="fa fa-spinner fa-spin"></i></td></tr>');
            return api(cfg.action, $.extend({}, cfg.params || {}, f), 'GET').then(function (data) { rows = cfg.transform ? cfg.transform(data) : data; page = 0; draw(); });
        }

        $c.on('submit', 'form.filters', function (e) { e.preventDefault(); load(); });
        $c.on('reset', 'form.filters', function () { setTimeout(function () { $c.find('form.filters select.s2').trigger('change'); load(); }); });
        $c.on('click', '.pager-wrap a', function (e) { e.preventDefault(); page = +$(this).data('page'); draw(); });
        $c.on('click', '[data-export]', function () {
            window.location = exportUrl($(this).data('export'), $.extend({}, cfg.params || {}, cfg.filters ? formData($c.find('form.filters')) : {}));
        });
        if (cfg.init) cfg.init($c);
        load();
        return { reload: load, rows: function () { return rows; }, $c: $c };
    }

    // ------------------------------------------------------------ views

    var current = null;
    var views = {};

    views.dashboard = function () {
        $('#content').html('<div class="empty"><i class="fa fa-spinner fa-spin"></i></div>');
        api('dashboard', null, 'GET').then(function (d) {
            var st = d.by_status;
            var kpi = function (num, lbl, icon, href) {
                return '<a class="vs-kpi' + (num ? '' : ' zero') + '" href="' + (href || '#') + '"><span class="num">' + esc(num) + '</span><span class="lbl"><i class="fa ' + icon + '"></i> ' + esc(lbl) + '</span></a>';
            };
            var html = '<div class="page-head"><h3><i class="fa fa-dashboard"></i> لوحة المتابعة</h3><div class="page-actions">' +
                (canEdit() ? '<button class="btn btn-primary btn-action" data-act="assign"><i class="fa fa-plus"></i> تسليم عهدة جديدة</button>' : '') + '</div></div>';
            html += '<div class="vs-kpi-grid kpi-6">' +
                kpi(d.items_total, 'إجمالي الأصناف', 'fa-cubes', '#items') +
                kpi(st['مسلمة'] || 0, 'في عهدة الموظفين', 'fa-exchange', '#custody') +
                kpi(st['متاحة'] || 0, 'متاحة بالمخزن', 'fa-check', '#items') +
                kpi(st['صيانة'] || 0, 'في الصيانة', 'fa-wrench', '#items') +
                kpi((st['تالفة'] || 0) + (st['مفقودة'] || 0), 'تالفة / مفقودة', 'fa-exclamation-triangle', '#items') +
                kpi(d.pending_ack, 'سندات بانتظار توقيع الموظف', 'fa-pencil', '#handovers') +
                kpi(d.employees_with_custody, 'موظفين لديهم عهدة', 'fa-users', '#employees') +
                kpi(money(d.active_value), 'قيمة العهد القائمة', 'fa-money', '#custody') +
                '</div>';
            html += '<div class="dash-grid">';
            html += '<div class="vs-chart-card"><div class="vs-group-label">الأصناف حسب التصنيف</div>' + barTable(d.by_category.map(function (c) {
                return { name: c.name, value: +c.total, part: +c.assigned, note: c.assigned + ' مسلمة من ' + c.total };
            })) + '</div>';
            html += '<div class="vs-chart-card"><div class="vs-group-label">العهد القائمة حسب القسم</div>' + barTable(d.by_department.map(function (c) {
                return { name: c.name, value: +c.n, note: c.n + ' صنف — ' + money(c.value) };
            })) + '</div>';
            html += '</div>';
            html += '<div class="vs-chart-card"><div class="vs-group-label">آخر السندات</div><div class="table-scroll"><table class="table table-bordered table-condensed">' +
                '<thead><tr><th>رقم السند</th><th>النوع</th><th>الموظف</th><th>التاريخ</th><th>عدد الأصناف</th><th>التوقيع</th><th></th></tr></thead><tbody>' +
                (d.recent.length ? d.recent.map(function (h) {
                    return '<tr class="' + (h.type === 'out' ? 'row-new' : 'row-maint') + '"><td class="key">' + esc(h.doc_no) + '</td><td>' + (h.type === 'out' ? 'تسليم' : 'ارتجاع') + '</td><td>' + esc(h.employee_name) +
                        '</td><td>' + esc(h.doc_date) + '</td><td>' + h.items_count + '</td><td>' + ackLabel(h.ack_at) + '</td><td><button class="btn btn-default btn-xs" data-act="handover" data-id="' + h.id + '"><i class="fa fa-eye"></i> عرض</button></td></tr>';
                }).join('') : '<tr><td colspan="7" class="empty">لا توجد سندات بعد</td></tr>') + '</tbody></table></div></div>';
            $('#content').html(html);
        });
    };

    function barTable(list) {
        if (!list.length) return '<div class="vs-chart-empty">لا توجد بيانات</div>';
        var max = Math.max.apply(null, list.map(function (r) { return r.value; })) || 1;
        return '<div class="bars">' + list.map(function (r) {
            var w = Math.round(r.value / max * 100), pw = r.part !== undefined ? Math.round(r.part / max * 100) : null;
            return '<div class="bar-row"><div class="bar-name">' + esc(r.name) + '</div><div class="vs-bar-track"><div class="vs-bar-fill bar-total" style="width:' + w + '%"></div>' + (pw !== null ? '<div class="vs-bar-fill ok bar-part" style="width:' + pw + '%"></div>' : '') +
                '</div><div class="bar-note">' + esc(r.note) + '</div></div>';
        }).join('') + '</div>';
    }

    views.custody = function () {
        var cats = catOptions('', 'كل التصنيفات');
        var view = listView({
            title: 'العهد', icon: 'fa-exchange', action: 'custody.list',
            actions: canEdit() ? '<button class="btn btn-primary btn-action" data-act="assign"><i class="fa fa-plus"></i> تسليم عهدة جديدة</button>' : '',
            filters:
                '<input class="form-control" name="q" placeholder="موظف / صنف / كود / سيريال / رقم سند" style="width:260px"> ' +
                '<select class="form-control" name="state"><option value="active">العهد القائمة</option><option value="returned">تم ارتجاعها</option><option value="all">الكل</option></select> ' +
                '<select class="form-control" name="department">' + options(S.lookups.departments, '', 'كل الأقسام') + '</select> ' +
                '<select class="form-control" name="category_id">' + cats + '</select> ' +
                '<select class="form-control" name="ack"><option value="">التوقيع: الكل</option><option value="signed">موقّع</option><option value="pending">بانتظار التوقيع</option></select> ' +
                '<label class="inline-label">من</label><input class="form-control" type="date" name="from"> <label class="inline-label">إلى</label><input class="form-control" type="date" name="to">',
            toolbar: (canEdit() ? '<button class="btn btn-warning btn-sm btn-action" data-act="return-selected"><i class="fa fa-undo"></i> ارتجاع المحدد</button> ' +
                '<button class="btn btn-primary btn-sm btn-action" data-act="transfer-selected"><i class="fa fa-random"></i> نقل المحدد لموظف آخر</button> ' : '') +
                '<button class="btn btn-success btn-sm btn-action" data-export="custody"><i class="fa fa-file-excel-o"></i> اكسيل</button>',
            head: (canEdit() ? '<th><input type="checkbox" class="check-all"></th>' : '') + '<th>الموظف</th><th>القسم</th><th>كود الأصل</th><th>الصنف</th><th>الرقم التسلسلي</th><th>القيمة</th><th>تاريخ التسليم</th><th>سند التسليم</th><th>التوقيع</th><th>الارتجاع</th>',
            row: function (r) {
                var active = !r.in_handover_id;
                return '<tr class="' + (active ? '' : 'row-returned') + '">' +
                    (canEdit() ? '<td>' + (active ? '<input type="checkbox" class="row-check" value="' + r.id + '" data-emp="' + r.employee_id + '">' : '') + '</td>' : '') +
                    '<td><a href="#" data-act="employee" data-id="' + r.employee_id + '">' + esc(r.employee_name) + '</a></td><td>' + esc(r.department || '-') + '</td>' +
                    '<td class="key"><a href="#" data-act="item" data-id="' + r.item_id + '">' + esc(r.code) + '</a></td><td>' + esc(r.item_name) + ' <small class="info-label">' + esc(r.category || '') + '</small></td>' +
                    '<td>' + esc(r.serial_no || '-') + '</td><td>' + money(r.value) + '</td><td>' + esc(r.assigned_at) + '</td>' +
                    '<td><a href="#" data-act="handover" data-id="' + r.out_handover_id + '">' + esc(r.out_doc_no) + '</a></td><td>' + ackLabel(r.out_ack_at) + '</td>' +
                    '<td>' + (active ? '<span class="label label-primary">قائمة</span>' : dt(r.returned_at) + ' <a href="#" data-act="handover" data-id="' + r.in_handover_id + '">' + esc(r.in_doc_no) + '</a>') + '</td></tr>';
            },
            init: function ($c) {
                $c.on('change', '.check-all', function () { $c.find('.row-check').prop('checked', this.checked); });
            }
        });
        current = view;
    };

    function selectedCustody() {
        var ids = [], emp = null, mixed = false;
        $('#content .row-check:checked').each(function () {
            ids.push(+this.value);
            if (emp !== null && emp !== $(this).data('emp')) mixed = true;
            emp = $(this).data('emp');
        });
        if (!ids.length) { toast('حدد الأصناف أولًا', 'warning'); return null; }
        if (mixed) { toast('حدد أصناف موظف واحد فقط', 'warning'); return null; }
        var rows = current.rows().filter(function (r) { return ids.indexOf(+r.id) >= 0; });
        return rows;
    }

    views.handovers = function () {
        current = listView({
            title: 'السندات والتوقيعات', icon: 'fa-file-text-o', action: 'handovers.list',
            filters:
                '<input class="form-control" name="q" placeholder="رقم السند / اسم الموظف" style="width:220px"> ' +
                '<select class="form-control" name="type"><option value="">كل الأنواع</option><option value="out">سندات تسليم</option><option value="in">سندات ارتجاع</option></select> ' +
                '<select class="form-control" name="ack"><option value="">التوقيع: الكل</option><option value="signed">موقّع</option><option value="pending">بانتظار التوقيع</option></select> ' +
                '<label class="inline-label">من</label><input class="form-control" type="date" name="from"> <label class="inline-label">إلى</label><input class="form-control" type="date" name="to">',
            head: '<th>رقم السند</th><th>النوع</th><th>الموظف</th><th>القسم</th><th>التاريخ</th><th>عدد الأصناف</th><th>التوقيع</th><th>بواسطة</th><th>إجراءات</th>',
            row: function (h) {
                return '<tr class="' + (h.type === 'out' ? 'row-new' : 'row-maint') + '"><td class="key">' + esc(h.doc_no) + '</td><td>' + (h.type === 'out' ? 'تسليم' : 'ارتجاع') + '</td><td>' + esc(h.employee_name) +
                    '</td><td>' + esc(h.department || '-') + '</td><td>' + esc(h.doc_date) + '</td><td>' + h.items_count + '</td><td>' + ackLabel(h.ack_at) + (h.ack_name ? '<br><small>' + esc(h.ack_name) + '</small>' : '') + '</td><td>' + esc(h.created_by_name || '') +
                    '</td><td class="nowrap"><button class="btn btn-default btn-xs" data-act="handover" data-id="' + h.id + '"><i class="fa fa-eye"></i> عرض</button> ' +
                    '<button class="btn btn-default btn-xs" data-act="print-h" data-id="' + h.id + '"><i class="fa fa-print"></i> طباعة</button></td></tr>';
            }
        });
    };

    views.items = function () {
        current = listView({
            title: 'الأصناف والأصول', icon: 'fa-cubes', action: 'items.list',
            actions: canEdit() ? '<button class="btn btn-primary btn-action" data-act="item-edit"><i class="fa fa-plus"></i> إضافة صنف</button>' : '',
            filters:
                '<input class="form-control" name="q" placeholder="اسم / كود / سيريال / ماركة" style="width:240px"> ' +
                '<select class="form-control" name="category_id">' + catOptions('', 'كل التصنيفات') + '</select> ' +
                '<select class="form-control" name="status">' + options(S.meta.statuses, '', 'كل الحالات') + '</select>',
            toolbar: '<button class="btn btn-success btn-sm btn-action" data-export="items"><i class="fa fa-file-excel-o"></i> اكسيل</button>',
            head: '<th>كود الأصل</th><th>التصنيف</th><th>الصنف</th><th>الماركة / الموديل</th><th>الرقم التسلسلي</th><th>القيمة</th><th>الحالة الفنية</th><th>الوضع</th><th>في عهدة</th><th>إجراءات</th>',
            row: function (i) {
                return '<tr><td class="key">' + esc(i.code) + '</td><td>' + esc(i.category || '-') + '</td><td>' + esc(i.name) + '</td><td>' + esc([i.brand, i.model].filter(Boolean).join(' / ') || '-') +
                    '</td><td>' + esc(i.serial_no || '-') + '</td><td>' + money(i.value) + '</td><td>' + esc(i.item_condition) + '</td><td>' + statusLabel(i.status) + '</td><td>' +
                    (i.holder_id ? '<a href="#" data-act="employee" data-id="' + i.holder_id + '">' + esc(i.holder_name) + '</a><br><small class="info-label">منذ ' + dt(i.assigned_at) + '</small>' : '-') +
                    '</td><td class="nowrap"><button class="btn btn-default btn-xs" data-act="item" data-id="' + i.id + '"><i class="fa fa-history"></i> السجل</button> ' +
                    (canEdit() ? '<button class="btn btn-primary btn-xs" data-act="item-edit" data-id="' + i.id + '"><i class="fa fa-pencil"></i> تعديل</button> ' : '') +
                    (canEdit() && i.status === 'متاحة' ? '<button class="btn btn-success btn-xs" data-act="assign" data-item="' + i.id + '"><i class="fa fa-share"></i> تسليم</button> ' : '') +
                    (isAdmin() ? '<button class="btn btn-danger btn-xs" data-act="item-delete" data-id="' + i.id + '"><i class="fa fa-trash"></i></button>' : '') + '</td></tr>';
            }
        });
    };

    views.employees = function () {
        current = listView({
            title: 'الموظفين', icon: 'fa-users', action: 'employees.list',
            actions: canEdit() ? '<button class="btn btn-primary btn-action" data-act="employee-edit"><i class="fa fa-plus"></i> إضافة موظف</button>' : '',
            filters:
                '<input class="form-control" name="q" placeholder="الاسم / الكود / الرقم القومي / الموبايل" style="width:260px"> ' +
                '<select class="form-control" name="department">' + options(S.lookups.departments, '', 'كل الأقسام') + '</select> ' +
                '<select class="form-control" name="active"><option value="1">النشطين</option><option value="0">الموقوفين</option><option value="">الكل</option></select>',
            toolbar: '<button class="btn btn-success btn-sm btn-action" data-export="employees"><i class="fa fa-file-excel-o"></i> اكسيل</button>',
            head: '<th>الكود</th><th>الاسم</th><th>القسم</th><th>الوظيفة</th><th>الفرع</th><th>الموبايل</th><th>أصناف العهدة</th><th>قيمة العهدة</th><th>الحالة</th><th>إجراءات</th>',
            row: function (e) {
                return '<tr><td class="key">' + esc(e.code || '-') + '</td><td><a href="#" data-act="employee" data-id="' + e.id + '">' + esc(e.name) + '</a></td><td>' + esc(e.department || '-') + '</td><td>' + esc(e.job_title || '-') +
                    '</td><td>' + esc(e.branch || '-') + '</td><td dir="ltr">' + esc(e.phone || '-') + '</td><td><b>' + e.active_count + '</b></td><td>' + money(e.active_value) + '</td><td>' +
                    (+e.active ? '<span class="label label-success">نشط</span>' : '<span class="label label-default">موقوف</span>') + '</td><td class="nowrap">' +
                    '<button class="btn btn-default btn-xs" data-act="employee" data-id="' + e.id + '"><i class="fa fa-id-card-o"></i> كارت العهدة</button> ' +
                    (canEdit() ? '<button class="btn btn-primary btn-xs" data-act="employee-edit" data-id="' + e.id + '"><i class="fa fa-pencil"></i> تعديل</button> ' : '') +
                    (canEdit() && +e.active ? '<button class="btn btn-success btn-xs" data-act="assign" data-emp="' + e.id + '" data-emp-name="' + esc(e.name) + '"><i class="fa fa-share"></i> تسليم</button> ' : '') +
                    (isAdmin() ? '<button class="btn btn-danger btn-xs" data-act="employee-delete" data-id="' + e.id + '"><i class="fa fa-trash"></i></button>' : '') + '</td></tr>';
            }
        });
    };

    views.categories = function () {
        current = listView({
            title: 'التصنيفات', icon: 'fa-tags', action: 'lookups', transform: function (d) { S.lookups = d; return d.categories; },
            actions: canEdit() ? '<button class="btn btn-primary btn-action" data-act="cat-edit"><i class="fa fa-plus"></i> إضافة تصنيف</button>' : '',
            head: '<th>التصنيف</th><th>عدد الأصناف</th><th>إجراءات</th>',
            row: function (c) {
                return '<tr><td>' + esc(c.name) + '</td><td>' + c.items_count + '</td><td>' +
                    (canEdit() ? '<button class="btn btn-primary btn-xs" data-act="cat-edit" data-id="' + c.id + '" data-name="' + esc(c.name) + '"><i class="fa fa-pencil"></i> تعديل</button> ' +
                        (+c.items_count ? '' : '<button class="btn btn-danger btn-xs" data-act="cat-delete" data-id="' + c.id + '"><i class="fa fa-trash"></i></button>') : '') + '</td></tr>';
            }
        });
    };

    views.users = function () {
        current = listView({
            title: 'المستخدمين', icon: 'fa-user-secret', action: 'users.list',
            actions: '<button class="btn btn-primary btn-action" data-act="user-edit"><i class="fa fa-plus"></i> إضافة مستخدم</button>',
            head: '<th>اسم المستخدم</th><th>الاسم</th><th>الصلاحية</th><th>الحالة</th><th>آخر دخول</th><th>إجراءات</th>',
            row: function (u) {
                return '<tr><td dir="ltr">' + esc(u.username) + '</td><td>' + esc(u.name) + '</td><td>' + esc(S.meta.roles[u.role] || u.role) + '</td><td>' +
                    (+u.active ? '<span class="label label-success">نشط</span>' : '<span class="label label-default">موقوف</span>') + '</td><td>' + esc(u.last_login || '-') +
                    '</td><td><button class="btn btn-primary btn-xs" data-act="user-edit" data-id="' + u.id + '"><i class="fa fa-pencil"></i> تعديل</button></td></tr>';
            }
        });
    };

    views.log = function () {
        current = listView({
            title: 'سجل العمليات', icon: 'fa-history', action: 'log.list',
            head: '<th>التاريخ</th><th>المستخدم</th><th>العملية</th><th>التفاصيل</th>',
            row: function (l) {
                return '<tr><td class="nowrap">' + esc(l.created_at) + '</td><td>' + esc(l.user_name || 'الموظف (رابط التوقيع)') + '</td><td>' + esc(l.action) + '</td><td>' + esc(l.details || '') + '</td></tr>';
            }
        });
    };

    // ------------------------------------------------------------ dialogs

    function handoverDialog(h) {
        var out = h.type === 'out';
        var body = '<div class="handover-head"><div><span class="info-label">الموظف:</span> <b>' + esc(h.employee_name) + '</b> ' + esc(h.department ? '— ' + h.department : '') +
            '</div><div><span class="info-label">التاريخ:</span> ' + dt(h.doc_date) + '</div><div><span class="info-label">بواسطة:</span> ' + esc(h.created_by_name || '') + '</div></div>' +
            '<div class="table-scroll"><table class="table table-bordered table-condensed"><thead><tr><th>#</th><th>كود الأصل</th><th>الصنف</th><th>الرقم التسلسلي</th><th>الحالة</th><th>ملاحظات</th></tr></thead><tbody>' +
            h.items.map(function (it, n) {
                return '<tr><td>' + (n + 1) + '</td><td>' + esc(it.code) + '</td><td>' + esc(it.name) + '</td><td>' + esc(it.serial_no || '-') + '</td><td>' + esc(out ? it.condition_out : it.condition_in) +
                    '</td><td>' + esc((out ? it.notes_out : it.notes_in) || '') + '</td></tr>';
            }).join('') + '</tbody></table></div>' +
            (h.notes ? '<p><span class="info-label">ملاحظات:</span> ' + esc(h.notes) + '</p>' : '');
        if (h.ack_at) {
            body += '<div class="alert alert-success"><i class="fa fa-check-circle"></i> وقّع الموظف <b>' + esc(h.ack_name) + '</b> بتاريخ ' + dt(h.ack_at) + ' من ' + dt(h.ack_ip || '') + '</div>';
        } else {
            var phone = String(h.phone || '').replace(/\D/g, '').replace(/^0(1\d{9})$/, '20$1');
            body += '<div class="sign-link-box"><div class="vs-group-label">رابط توقيع الموظف</div>' +
                '<div class="filter-inline"><input class="form-control" readonly dir="ltr" value="' + esc(h.sign_url) + '">' +
                '<button class="btn btn-primary btn-action" data-copy="' + esc(h.sign_url) + '"><i class="fa fa-copy"></i> نسخ</button>' +
                '<a class="btn btn-success btn-action" target="_blank" href="https://wa.me/' + phone + '?text=' + encodeURIComponent('برجاء مراجعة وتوقيع ' + (out ? 'سند تسليم العهدة' : 'سند ارتجاع العهدة') + ' رقم ' + h.doc_no + ':\n' + h.sign_url) + '"><i class="fa fa-whatsapp"></i> واتساب</a>' +
                '<a class="btn btn-warning btn-action" target="_blank" href="' + esc(h.sign_url) + '"><i class="fa fa-pencil"></i> التوقيع الآن</a></div>' +
                '<small class="info-label">أرسل الرابط للموظف ليوقّع من موبايله، أو افتح "التوقيع الآن" على جهاز/تابلت أمامه.</small></div>';
        }
        var footer = '<button class="btn btn-primary btn-action" data-act="print-h" data-id="' + h.id + '"><i class="fa fa-print"></i> طباعة السند</button>' +
            (!h.ack_at && canEdit() ? '<button class="btn btn-default btn-action" data-act="renew-link" data-id="' + h.id + '"><i class="fa fa-refresh"></i> تجديد الرابط</button>' : '') +
            '<button class="btn btn-default btn-action" data-dismiss="modal">إغلاق</button>';
        modal('<i class="fa fa-file-text-o"></i> ' + (out ? 'سند تسليم عهدة' : 'سند ارتجاع عهدة') + ' ' + esc(h.doc_no), body, footer, 'modal-lg');
    }

    function showHandover(id) { api('handovers.get', { id: id }, 'GET').then(handoverDialog); }

    function assignDialog(preset) {
        preset = preset || {};
        var lines = [];
        var body = '<form id="assignForm">' +
            '<div class="row"><div class="col-sm-6 form-group"><label>الموظف المستلم</label><select class="form-control" id="asEmp"></select></div>' +
            '<div class="col-sm-3 form-group"><label>تاريخ التسليم</label><input class="form-control" type="date" name="date" value="' + S.meta.today + '" required></div></div>' +
            '<div class="form-group"><label>الأصناف</label><select class="form-control" id="asItem"></select><small class="info-label">ابحث بالاسم أو الكود أو الرقم التسلسلي — تظهر الأصناف المتاحة فقط</small></div>' +
            '<div class="table-scroll"><table class="table table-bordered table-condensed" id="asLines"><thead><tr><th>كود الأصل</th><th>الصنف</th><th>الرقم التسلسلي</th><th>الحالة عند التسليم</th><th>ملاحظات</th><th></th></tr></thead><tbody></tbody></table></div>' +
            '<div class="form-group"><label>ملاحظات السند</label><textarea class="form-control" name="notes" rows="2"></textarea></div></form>';
        var $m = modal('<i class="fa fa-share"></i> تسليم عهدة جديدة', body,
            '<button class="btn btn-success btn-action" id="asSave"><i class="fa fa-check"></i> حفظ وإنشاء سند التسليم</button><button class="btn btn-default btn-action" data-dismiss="modal">إلغاء</button>', 'modal-lg');
        employeeSelect($m.find('#asEmp'));
        if (preset.emp) {
            $m.find('#asEmp').append(new Option(preset.empName, preset.emp, true, true)).trigger('change');
        }
        var $item = $m.find('#asItem');
        $item.select2({
            dir: 'rtl', width: '100%', dropdownParent: $m, placeholder: 'أضف صنفًا...',
            language: { noResults: function () { return 'لا توجد أصناف متاحة مطابقة'; }, searching: function () { return 'جاري البحث...'; } },
            ajax: {
                url: 'api.php', dataType: 'json', delay: 250,
                data: function (p) { return { action: 'items.list', q: p.term || '', status: 'متاحة' }; },
                processResults: function (r) {
                    return {
                        results: r.data.slice(0, 50).map(function (i) {
                            return { id: i.id, text: i.code + ' — ' + i.name + (i.serial_no ? ' [' + i.serial_no + ']' : ''), item: i };
                        })
                    };
                }
            }
        }).on('select2:select', function (e) {
            addLine(e.params.data.item);
            $item.val(null).trigger('change');
        });

        function addLine(i) {
            if (lines.some(function (l) { return l.id == i.id; })) return;
            lines.push(i);
            $m.find('#asLines tbody').append('<tr data-id="' + i.id + '"><td>' + esc(i.code) + '</td><td>' + esc(i.name) + '</td><td>' + esc(i.serial_no || '-') + '</td>' +
                '<td><select class="form-control input-sm l-cond">' + options(S.meta.conditions, i.item_condition) + '</select></td>' +
                '<td><input class="form-control input-sm l-notes"></td><td><button type="button" class="btn btn-danger btn-xs l-del"><i class="fa fa-times"></i></button></td></tr>');
        }
        $m.find('#asLines').on('click', '.l-del', function () {
            var id = $(this).closest('tr').data('id');
            lines = lines.filter(function (l) { return l.id != id; });
            $(this).closest('tr').remove();
        });
        if (preset.item) {
            api('items.get', { id: preset.item }, 'GET').then(function (d) { addLine(d.item); });
        }
        $m.find('#asSave').on('click', function () {
            var f = formData($m.find('#assignForm'));
            var payload = {
                employee_id: $m.find('#asEmp').val(), date: f.date, notes: f.notes,
                lines: $m.find('#asLines tbody tr').map(function () {
                    return { item_id: $(this).data('id'), condition: $(this).find('.l-cond').val(), notes: $(this).find('.l-notes').val() };
                }).get()
            };
            if (!payload.employee_id) { toast('اختر الموظف', 'warning'); return; }
            if (!payload.lines.length) { toast('أضف صنفًا واحدًا على الأقل', 'warning'); return; }
            var $b = $(this).prop('disabled', true);
            api('custody.assign', payload).then(function (h) {
                toast('تم إنشاء سند التسليم ' + h.doc_no);
                refresh();
                handoverDialog(h);
            }).always(function () { $b.prop('disabled', false); });
        });
    }

    function returnDialog(rows, transfer) {
        var body = '<form id="retForm"><p><span class="info-label">الموظف:</span> <b>' + esc(rows[0].employee_name) + '</b></p>' +
            '<div class="row">' + (transfer ? '<div class="col-sm-6 form-group"><label>نقل إلى الموظف</label><select class="form-control" id="toEmp"></select></div>' : '') +
            '<div class="col-sm-3 form-group"><label>' + (transfer ? 'تاريخ النقل' : 'تاريخ الارتجاع') + '</label><input class="form-control" type="date" name="date" value="' + S.meta.today + '" required></div></div>' +
            '<div class="table-scroll"><table class="table table-bordered table-condensed" id="retLines"><thead><tr><th>كود الأصل</th><th>الصنف</th><th>الحالة عند الاستلام</th>' +
            (transfer ? '' : '<th>الوضع بعد الارتجاع</th>') + '<th>ملاحظات</th></tr></thead><tbody>' +
            rows.map(function (r) {
                return '<tr data-id="' + r.id + '"><td>' + esc(r.code) + '</td><td>' + esc(r.item_name) + '</td><td><select class="form-control input-sm l-cond">' + options(S.meta.conditions, r.condition_out || 'جيد') + '</select></td>' +
                    (transfer ? '' : '<td><select class="form-control input-sm l-status">' + options(S.meta.statuses.filter(function (s) { return s !== 'مسلمة'; }), 'متاحة') + '</select></td>') +
                    '<td><input class="form-control input-sm l-notes"></td></tr>';
            }).join('') + '</tbody></table></div>' +
            '<div class="form-group"><label>ملاحظات السند</label><textarea class="form-control" name="notes" rows="2"></textarea></div></form>';
        var $m = modal(transfer ? '<i class="fa fa-random"></i> نقل عهدة لموظف آخر' : '<i class="fa fa-undo"></i> ارتجاع عهدة', body,
            '<button class="btn btn-success btn-action" id="retSave"><i class="fa fa-check"></i> حفظ</button><button class="btn btn-default btn-action" data-dismiss="modal">إلغاء</button>', 'modal-lg');
        if (transfer) employeeSelect($m.find('#toEmp'), { exclude: rows[0].employee_id });
        $m.find('#retSave').on('click', function () {
            var f = formData($m.find('#retForm'));
            var payload = {
                date: f.date, notes: f.notes,
                lines: $m.find('#retLines tbody tr').map(function () {
                    return { custody_id: $(this).data('id'), condition: $(this).find('.l-cond').val(), status: $(this).find('.l-status').val(), notes: $(this).find('.l-notes').val() };
                }).get()
            };
            if (transfer) {
                payload.to_employee_id = $m.find('#toEmp').val();
                if (!payload.to_employee_id) { toast('اختر الموظف المستلم', 'warning'); return; }
            }
            var $b = $(this).prop('disabled', true);
            api(transfer ? 'custody.transfer' : 'custody.return', payload).then(function (r) {
                refresh();
                if (transfer) {
                    toast('تم النقل: ' + r['return'].doc_no + ' و ' + r.assign.doc_no);
                    handoverDialog(r.assign);
                } else {
                    toast('تم إنشاء سند الارتجاع ' + r.doc_no);
                    handoverDialog(r);
                }
            }).always(function () { $b.prop('disabled', false); });
        });
    }

    function employeeCard(id) {
        api('employees.get', { id: id }, 'GET').then(function (d) {
            var e = d.employee, active = d.custody.filter(function (c) { return !c.in_handover_id; });
            var total = active.reduce(function (s, c) { return s + (+c.value || 0); }, 0);
            var info = [['الكود', e.code], ['الرقم القومي', e.national_id], ['القسم', e.department], ['الوظيفة', e.job_title], ['الفرع', e.branch], ['الموبايل', e.phone], ['البريد', e.email]]
                .filter(function (x) { return x[1]; }).map(function (x) { return '<span><span class="info-label">' + x[0] + ':</span> ' + esc(x[1]) + '</span>'; }).join('');
            var body = '<div class="emp-info">' + info + (+e.active ? '' : ' <span class="label label-default">موقوف</span>') + '</div>' +
                '<div class="vs-kpi-grid"><div class="vs-kpi"><span class="num">' + active.length + '</span><span class="lbl">أصناف في العهدة</span></div>' +
                '<div class="vs-kpi"><span class="num">' + money(total) + '</span><span class="lbl">قيمة العهدة</span></div>' +
                '<div class="vs-kpi' + (d.handovers.filter(function (h) { return !h.ack_at; }).length ? '' : ' zero') + '"><span class="num">' + d.handovers.filter(function (h) { return !h.ack_at; }).length + '</span><span class="lbl">سندات بانتظار التوقيع</span></div></div>' +
                '<div class="table-scroll"><table class="table table-bordered table-condensed"><thead><tr>' + (canEdit() ? '<th></th>' : '') + '<th>كود الأصل</th><th>الصنف</th><th>الرقم التسلسلي</th><th>القيمة</th><th>تاريخ التسليم</th><th>السند</th><th>التوقيع</th><th>الارتجاع</th></tr></thead><tbody>' +
                (d.custody.length ? d.custody.map(function (c) {
                    var act = !c.in_handover_id;
                    return '<tr class="' + (act ? '' : 'row-returned') + '">' + (canEdit() ? '<td>' + (act ? '<input type="checkbox" class="emp-check" value="' + c.id + '">' : '') + '</td>' : '') +
                        '<td>' + esc(c.code) + '</td><td>' + esc(c.item_name) + '</td><td>' + esc(c.serial_no || '-') + '</td><td>' + money(c.value) + '</td><td>' + esc(c.assigned_at) +
                        '</td><td><a href="#" data-act="handover" data-id="' + c.out_handover_id + '">' + esc(c.out_doc_no) + '</a></td><td>' + ackLabel(c.out_ack_at) + '</td><td>' +
                        (act ? '<span class="label label-primary">قائمة</span>' : dt(c.returned_at) + ' — ' + esc(c.in_doc_no)) + '</td></tr>';
                }).join('') : '<tr><td colspan="9" class="empty">لا يوجد سجل عهد لهذا الموظف</td></tr>') + '</tbody></table></div>';
            var footer = (canEdit() && +e.active ? '<button class="btn btn-success btn-action" data-act="assign" data-emp="' + e.id + '" data-emp-name="' + esc(e.name) + '"><i class="fa fa-share"></i> تسليم عهدة</button>' : '') +
                (canEdit() && active.length ? '<button class="btn btn-warning btn-action" id="empReturn"><i class="fa fa-undo"></i> ارتجاع المحدد</button><button class="btn btn-primary btn-action" id="empTransfer"><i class="fa fa-random"></i> نقل المحدد</button>' : '') +
                '<button class="btn btn-default btn-action" data-act="print-emp" data-id="' + e.id + '"><i class="fa fa-print"></i> ' + (active.length ? 'طباعة بيان العهدة' : 'طباعة إخلاء طرف') + '</button>' +
                '<button class="btn btn-default btn-action" data-dismiss="modal">إغلاق</button>';
            var $m = modal('<i class="fa fa-id-card-o"></i> كارت عهدة: ' + esc(e.name), body, footer, 'modal-lg');
            var picked = function () {
                var ids = $m.find('.emp-check:checked').map(function () { return +this.value; }).get();
                if (!ids.length) { toast('حدد الأصناف أولًا', 'warning'); return null; }
                return d.custody.filter(function (c) { return ids.indexOf(+c.id) >= 0; }).map(function (c) { return $.extend({ employee_name: e.name }, c); });
            };
            $m.find('#empReturn').on('click', function () { var r = picked(); if (r) returnDialog(r, false); });
            $m.find('#empTransfer').on('click', function () { var r = picked(); if (r) returnDialog(r, true); });
        });
    }

    function itemCard(id) {
        api('items.get', { id: id }, 'GET').then(function (d) {
            var i = d.item;
            var info = [['الكود', i.code], ['التصنيف', i.category], ['الماركة', i.brand], ['الموديل', i.model], ['الرقم التسلسلي', i.serial_no], ['تاريخ الشراء', i.purchase_date],
                ['القيمة', i.value !== null ? money(i.value) : ''], ['المكان', i.location], ['الحالة الفنية', i.item_condition]]
                .filter(function (x) { return x[1]; }).map(function (x) { return '<span><span class="info-label">' + x[0] + ':</span> ' + esc(x[1]) + '</span>'; }).join('');
            var body = '<div class="emp-info">' + info + ' ' + statusLabel(i.status) + '</div>' + (i.notes ? '<p><span class="info-label">ملاحظات:</span> ' + esc(i.notes) + '</p>' : '') +
                '<div class="vs-group-label">سجل التداول</div><div class="table-scroll"><table class="table table-bordered table-condensed"><thead><tr><th>الموظف</th><th>القسم</th><th>تاريخ التسليم</th><th>الحالة</th><th>سند التسليم</th><th>تاريخ الارتجاع</th><th>الحالة</th><th>سند الارتجاع</th></tr></thead><tbody>' +
                (d.history.length ? d.history.map(function (c) {
                    return '<tr><td>' + esc(c.employee_name) + '</td><td>' + esc(c.department || '-') + '</td><td>' + esc(c.assigned_at) + '</td><td>' + esc(c.condition_out || '') +
                        '</td><td><a href="#" data-act="handover" data-id="' + c.out_handover_id + '">' + esc(c.out_doc_no) + '</a></td><td>' + esc(c.returned_at || '-') + '</td><td>' + esc(c.condition_in || '-') +
                        '</td><td>' + (c.in_handover_id ? '<a href="#" data-act="handover" data-id="' + c.in_handover_id + '">' + esc(c.in_doc_no) + '</a>' : '-') + '</td></tr>';
                }).join('') : '<tr><td colspan="8" class="empty">لم يُسلَّم هذا الصنف لأي موظف بعد</td></tr>') + '</tbody></table></div>';
            modal('<i class="fa fa-cube"></i> ' + esc(i.code + ' — ' + i.name), body, undefined, 'modal-lg');
        });
    }

    function itemForm(id) {
        var load = id ? api('items.get', { id: id }, 'GET').then(function (d) { return d.item; }) : $.Deferred().resolve({ status: 'متاحة', item_condition: 'جديد' }).promise();
        load.then(function (i) {
            var assigned = i.status === 'مسلمة';
            var body = '<form id="itemForm" class="row">' +
                '<input type="hidden" name="id" value="' + esc(i.id || '') + '">' +
                fg(4, 'كود الأصل', '<input class="form-control" name="code" value="' + esc(i.code || '') + '" placeholder="يُولَّد تلقائيًا إن تُرك فارغًا">') +
                fg(4, 'التصنيف', '<select class="form-control" name="category_id">' + catOptions(i.category_id, '-- اختر --') + '</select>') +
                fg(4, 'اسم الصنف *', '<input class="form-control" name="name" required value="' + esc(i.name || '') + '">') +
                fg(4, 'الماركة', '<input class="form-control" name="brand" value="' + esc(i.brand || '') + '">') +
                fg(4, 'الموديل', '<input class="form-control" name="model" value="' + esc(i.model || '') + '">') +
                fg(4, 'الرقم التسلسلي / IMEI', '<input class="form-control" name="serial_no" dir="ltr" value="' + esc(i.serial_no || '') + '">') +
                fg(4, 'تاريخ الشراء', '<input class="form-control" type="date" name="purchase_date" value="' + esc(i.purchase_date || '') + '">') +
                fg(4, 'القيمة (ج.م)', '<input class="form-control" type="number" step="0.01" min="0" name="value" value="' + esc(i.value === null || i.value === undefined ? '' : i.value) + '">') +
                fg(4, 'المكان / المخزن', '<input class="form-control" name="location" list="dlLoc" value="' + esc(i.location || '') + '">' + datalist('dlLoc', S.lookups.locations)) +
                fg(4, 'الحالة الفنية', '<select class="form-control" name="item_condition">' + options(S.meta.conditions, i.item_condition) + '</select>') +
                fg(4, 'الوضع', assigned ? '<p class="form-control-static">' + statusLabel('مسلمة') + ' <small class="info-label">يتغير بالارتجاع</small></p>'
                    : '<select class="form-control" name="status">' + options(S.meta.statuses.filter(function (s) { return s !== 'مسلمة'; }), i.status) + '</select>') +
                fg(12, 'ملاحظات', '<textarea class="form-control" name="notes" rows="2">' + esc(i.notes || '') + '</textarea>') + '</form>';
            var $m = modal('<i class="fa fa-cube"></i> ' + (id ? 'تعديل صنف' : 'إضافة صنف'), body, saveFooter(), 'modal-lg');
            $m.find('#btnSave').on('click', function () {
                saveForm($m, 'items.save', $m.find('#itemForm'), 'تم حفظ الصنف').then(function () { loadLookups(); });
            });
        });
    }

    function employeeForm(id) {
        var load = id ? api('employees.get', { id: id }, 'GET').then(function (d) { return d.employee; }) : $.Deferred().resolve({ active: 1 }).promise();
        load.then(function (e) {
            var body = '<form id="empForm" class="row"><input type="hidden" name="id" value="' + esc(e.id || '') + '">' +
                fg(6, 'الاسم بالكامل *', '<input class="form-control" name="name" required value="' + esc(e.name || '') + '">') +
                fg(3, 'كود الموظف', '<input class="form-control" name="code" value="' + esc(e.code || '') + '">') +
                fg(3, 'الرقم القومي', '<input class="form-control" name="national_id" dir="ltr" maxlength="14" value="' + esc(e.national_id || '') + '">') +
                fg(4, 'القسم', '<input class="form-control" name="department" list="dlDep" value="' + esc(e.department || '') + '">' + datalist('dlDep', S.lookups.departments)) +
                fg(4, 'الوظيفة', '<input class="form-control" name="job_title" value="' + esc(e.job_title || '') + '">') +
                fg(4, 'الفرع', '<input class="form-control" name="branch" list="dlBr" value="' + esc(e.branch || '') + '">' + datalist('dlBr', S.lookups.branches)) +
                fg(4, 'الموبايل', '<input class="form-control" name="phone" dir="ltr" value="' + esc(e.phone || '') + '">') +
                fg(5, 'البريد الإلكتروني', '<input class="form-control" type="email" name="email" dir="ltr" value="' + esc(e.email || '') + '">') +
                fg(3, 'الحالة', '<div class="checkbox"><label><input type="checkbox" name="active"' + (+e.active ? ' checked' : '') + '> نشط</label></div>') +
                fg(12, 'ملاحظات', '<textarea class="form-control" name="notes" rows="2">' + esc(e.notes || '') + '</textarea>') + '</form>';
            var $m = modal('<i class="fa fa-user"></i> ' + (id ? 'تعديل موظف' : 'إضافة موظف'), body, saveFooter(), 'modal-lg');
            $m.find('#btnSave').on('click', function () {
                saveForm($m, 'employees.save', $m.find('#empForm'), 'تم حفظ بيانات الموظف').then(function () { loadLookups(); });
            });
        });
    }

    function userForm(id) {
        var u = id ? (current.rows().filter(function (r) { return r.id == id; })[0] || {}) : { active: 1, role: 'editor' };
        var roles = Object.keys(S.meta.roles).map(function (k) { return { value: k, text: S.meta.roles[k] }; });
        var body = '<form id="userForm" class="row"><input type="hidden" name="id" value="' + esc(u.id || '') + '">' +
            fg(6, 'اسم المستخدم (إنجليزي)', '<input class="form-control" name="username" dir="ltr" required value="' + esc(u.username || '') + '">') +
            fg(6, 'الاسم', '<input class="form-control" name="name" required value="' + esc(u.name || '') + '">') +
            fg(6, 'الصلاحية', '<select class="form-control" name="role">' + options(roles, u.role) + '</select>') +
            fg(6, id ? 'كلمة مرور جديدة (اتركها فارغة لعدم التغيير)' : 'كلمة المرور', '<input class="form-control" type="password" name="password" dir="ltr" autocomplete="new-password">') +
            fg(6, 'الحالة', '<div class="checkbox"><label><input type="checkbox" name="active"' + (+u.active ? ' checked' : '') + '> نشط</label></div>') + '</form>';
        var $m = modal('<i class="fa fa-user-secret"></i> ' + (id ? 'تعديل مستخدم' : 'إضافة مستخدم'), body, saveFooter());
        $m.find('#btnSave').on('click', function () { saveForm($m, 'users.save', $m.find('#userForm'), 'تم حفظ المستخدم'); });
    }

    function categoryForm(id, name) {
        var body = '<form id="catForm"><input type="hidden" name="id" value="' + esc(id || '') + '"><div class="form-group"><label>اسم التصنيف</label><input class="form-control" name="name" required value="' + esc(name || '') + '"></div></form>';
        var $m = modal('<i class="fa fa-tag"></i> ' + (id ? 'تعديل تصنيف' : 'إضافة تصنيف'), body, saveFooter(), 'modal-sm');
        $m.find('#btnSave').on('click', function () {
            saveForm($m, 'categories.save', $m.find('#catForm'), 'تم الحفظ');
        });
    }

    function passwordDialog(forced) {
        var body = (forced ? '<div class="alert alert-warning">يجب تغيير كلمة المرور الافتراضية قبل المتابعة.</div>' : '') +
            '<form id="pwForm"><div class="form-group"><label>كلمة المرور الحالية</label><input class="form-control" type="password" name="old_password" dir="ltr" autocomplete="current-password"></div>' +
            '<div class="form-group"><label>كلمة المرور الجديدة (8 أحرف على الأقل)</label><input class="form-control" type="password" name="new_password" dir="ltr" autocomplete="new-password"></div>' +
            '<div class="form-group"><label>تأكيد كلمة المرور الجديدة</label><input class="form-control" type="password" name="confirm" dir="ltr" autocomplete="new-password"></div></form>';
        var $m = modal('<i class="fa fa-key"></i> تغيير كلمة المرور', body, '<button class="btn btn-success btn-action" id="btnSave"><i class="fa fa-check"></i> حفظ</button>' +
            (forced ? '' : '<button class="btn btn-default btn-action" data-dismiss="modal">إلغاء</button>'));
        if (forced) { $m.data('bs.modal').options.backdrop = 'static'; $m.data('bs.modal').options.keyboard = false; $m.find('.close').hide(); }
        $m.find('#btnSave').on('click', function () {
            var f = formData($m.find('#pwForm'));
            if (f.new_password !== f.confirm) { toast('كلمتا المرور غير متطابقتين', 'warning'); return; }
            api('auth.change_password', f).then(function () {
                S.user.must_change = 0;
                $m.find('.close').show();
                $m.modal('hide');
                toast('تم تغيير كلمة المرور');
            });
        });
    }

    function fg(cols, label, input) {
        return '<div class="col-sm-' + cols + ' form-group"><label>' + label + '</label>' + input + '</div>';
    }

    function saveFooter() {
        return '<button class="btn btn-success btn-action" id="btnSave"><i class="fa fa-check"></i> حفظ</button><button class="btn btn-default btn-action" data-dismiss="modal">إلغاء</button>';
    }

    function saveForm($m, action, $form, msg, noRefresh) {
        if (!$form[0].checkValidity()) { $form[0].reportValidity(); return $.Deferred().reject().promise(); }
        var $b = $m.find('#btnSave').prop('disabled', true);
        return api(action, formData($form)).then(function (r) {
            $m.modal('hide');
            toast(msg);
            if (!noRefresh) refresh();
            return r;
        }).always(function () { $b.prop('disabled', false); });
    }

    function refresh() {
        if (current && current.reload) current.reload();
        else if (location.hash === '#dashboard' || !location.hash) views.dashboard();
    }

    // ------------------------------------------------------------ global actions

    $(document).on('click', '[data-act]', function (e) {
        e.preventDefault();
        var $t = $(this), id = $t.data('id');
        switch ($t.data('act')) {
            case 'assign': assignDialog({ emp: $t.data('emp'), empName: $t.data('emp-name'), item: $t.data('item') }); break;
            case 'handover': showHandover(id); break;
            case 'print-h': openPrint('print.php?h=' + id); break;
            case 'print-emp': openPrint('print.php?emp=' + id); break;
            case 'renew-link':
                confirmBox('سيتوقف الرابط القديم عن العمل. متابعة؟').then(function () { api('handovers.renew_link', { id: id }).then(handoverDialog); });
                break;
            case 'employee': employeeCard(id); break;
            case 'item': itemCard(id); break;
            case 'item-edit': itemForm(id); break;
            case 'employee-edit': employeeForm(id); break;
            case 'user-edit': userForm(id); break;
            case 'cat-edit': categoryForm(id, $t.data('name')); break;
            case 'item-delete':
                confirmBox('حذف الصنف نهائيًا؟').then(function () { api('items.delete', { id: id }).then(function () { $('#modal').modal('hide'); toast('تم الحذف'); refresh(); }); });
                break;
            case 'employee-delete':
                confirmBox('حذف الموظف نهائيًا؟').then(function () { api('employees.delete', { id: id }).then(function () { $('#modal').modal('hide'); toast('تم الحذف'); refresh(); loadLookups(); }); });
                break;
            case 'cat-delete':
                confirmBox('حذف التصنيف؟').then(function () { api('categories.delete', { id: id }).then(function () { $('#modal').modal('hide'); toast('تم الحذف'); refresh(); }); });
                break;
            case 'return-selected': var r = selectedCustody(); if (r) returnDialog(r, false); break;
            case 'transfer-selected': var t = selectedCustody(); if (t) returnDialog(t, true); break;
        }
    });

    $(document).on('click', '[data-copy]', function (e) { e.preventDefault(); copyText($(this).data('copy'), $(this)); });

    // ------------------------------------------------------------ routing + auth

    function route() {
        var name = (location.hash || '#dashboard').slice(1);
        if (!views[name] || ((name === 'users' || name === 'log') && !isAdmin())) name = 'dashboard';
        current = null;
        $('#menu li').removeClass('active').filter('[data-view="' + name + '"]').addClass('active');
        $('#modal').modal('hide');
        $('#content').off();
        views[name]();
    }

    function loadLookups() {
        return api('lookups', null, 'GET').then(function (d) { S.lookups = d; return d; });
    }

    function showLogin() {
        $('#appView').hide();
        $('#loginView').show();
    }

    function boot() {
        return api('auth.me', null, 'GET').then(function (d) {
            S.csrf = d.csrf;
            S.meta = d;
            S.user = d.user;
            if (!S.user) { showLogin(); return; }
            $('#loginView').hide();
            $('#appView').show();
            $('#userName').text(S.user.name + ' — ' + (d.roles[S.user.role] || ''));
            $('.admin-only').toggle(isAdmin());
            return loadLookups().then(function () {
                route();
                if (+S.user.must_change) passwordDialog(true);
            });
        });
    }

    $('#loginForm').on('submit', function (e) {
        e.preventDefault();
        $('#loginError').hide();
        api('auth.login', formData($(this))).then(boot, function (msg) { $('#loginError').text(msg).show(); });
    });

    $('#btnLogout').on('click', function () { api('auth.logout', {}).then(function () { location.hash = ''; location.reload(); }); });
    $('#btnChangePw').on('click', function () { passwordDialog(false); });
    $('#sidebarToggle').on('click', function () { $('body').toggleClass('sidebar-open'); });
    $(window).on('hashchange', function () { if (S.user) { $('body').removeClass('sidebar-open'); route(); } });

    boot();
})(jQuery);
