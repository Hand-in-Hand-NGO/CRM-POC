/* العهد الإلكترونية — واجهة الاستخدام (jQuery + Bootstrap 3) */
(function ($) {
    'use strict';

    var S = { csrf: '', user: null, meta: {}, lookups: { departments: [], branches: [], locations: [] }, tabs: {} };
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

    // background: طلب خلفية (فحص الجلسة) لا يُعتبر نشاطًا من المستخدم ولا يمدد الجلسة
    function api(action, data, method, background, retried) {
        method = method || (data && action.indexOf('.list') < 0 && action.indexOf('.get') < 0 ? 'POST' : 'GET');
        var headers = { 'X-CSRF-Token': S.csrf };
        if (!background) headers['X-Activity'] = '1';
        var opts = { url: 'api.php?action=' + encodeURIComponent(action), method: method, dataType: 'json', headers: headers };
        if (window.FormData && data instanceof FormData) {
            opts.data = data;
            opts.processData = false;
            opts.contentType = false;
            var onProgress = api.onProgress;
            if (onProgress) {
                opts.xhr = function () {
                    var x = $.ajaxSettings.xhr();
                    if (x.upload) x.upload.addEventListener('progress', function (e) { if (e.lengthComputable) onProgress(e.loaded / e.total); });
                    return x;
                };
            }
        } else if (method === 'POST') {
            opts.data = JSON.stringify(data || {});
            opts.contentType = 'application/json';
        } else if (data) {
            opts.url += '&' + $.param(data);
        }
        return $.ajax(opts).then(function (r) {
            if (!background && S.user && !SESS.expired) sessionTouched();
            return r.data;
        }, function (xhr) {
            var msg = (xhr.responseJSON && xhr.responseJSON.error) || 'تعذر الاتصال بالسيرفر';
            // رمز الحماية اتغير (دخول من نافذة تانية مثلًا): نجيب الرمز الحالي ونعيد الطلب مرة واحدة لنفس المستخدم بس
            if (xhr.status === 419 && !retried) {
                return refreshCsrf().then(function (same) {
                    if (same) return api(action, data, method, background, true);
                    return $.Deferred().reject(msg).promise();
                });
            }
            if (action === 'auth.login') return $.Deferred().reject(msg).promise();
            if (xhr.status === 401) {
                sessionExpired(msg);
                return $.Deferred().reject(msg).promise();
            }
            if (background) return $.Deferred().reject(msg).promise();
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

    // ---------- أنواع الأصناف (types.json): لاب توب / موبايل / شريحة

    function typeKeys() { return Object.keys(S.meta.types); }
    // الأنواع المفعّلة (للإضافة والتسليم)، والمستخدمة = المفعّلة + المتوقفة اللي لسه عليها أصناف
    function activeKeys() { return S.meta.active_types || typeKeys(); }
    function usedKeys() { return S.meta.used_types || typeKeys(); }
    function multiType() { return usedKeys().length > 1; }
    function typeTh() { return multiType() ? '<th>النوع</th>' : ''; }
    function typeTd(r) { return multiType() ? '<td>' + typeBadge(r) + '</td>' : ''; }
    function typeDef(t) { return S.meta.types[t]; }
    function fieldOf(t, key) { return typeDef(t).fields.filter(function (f) { return f.key === key; })[0]; }

    function typeBadge(r) {
        var d = typeDef(r.type);
        return d ? '<span class="type-badge type-' + esc(r.type) + '"><i class="fa ' + d.icon + '"></i> ' + esc(d.label) + '</span>' : '';
    }

    function specCell(r, key) {
        var v = r.specs ? r.specs[key] : '';
        if ($.isArray(v)) v = v.join('، ');
        if (v && fieldOf(r.type, key).input === 'number') v = money(v);
        return v ? esc(v) : '-';
    }

    // عناوين وخلايا الأعمدة الخاصة بنوع محدد
    function typeHeads(t) {
        return typeDef(t).columns.map(function (k) { return '<th>' + esc(fieldOf(t, k).label) + '</th>'; }).join('');
    }

    function typeCells(r, t) {
        return typeDef(t).columns.map(function (k) { return '<td' + (fieldOf(t, k).ltr ? ' dir="ltr"' : '') + '>' + specCell(r, k) + '</td>'; }).join('');
    }

    // المعرّف + المواصفات + الملحقات في عمود واحد (لعرض "الكل")
    function itemDetails(r) {
        // كل جزء في <bdi> حتى لا يختلط ترتيب العربي والإنجليزي (مثل "15.6 بوصة / Core i5")
        var html = r.specs_text ? r.specs_text.split(' / ').map(function (x) { return '<bdi>' + esc(x) + '</bdi>'; }).join(' / ') : '';
        if (r.accessories_text) html += (html ? '<br>' : '') + '<small class="info-label">الملحقات: ' + esc(r.accessories_text) + '</small>';
        return html || '-';
    }

    function keyLabel(t) {
        if (t) return fieldOf(t, 'serial_no').label;
        return usedKeys().map(function (k) { return fieldOf(k, 'serial_no').label; }).filter(function (v, i, a) { return a.indexOf(v) === i; }).join(' / ');
    }

    function datalist(id, list) {
        return '<datalist id="' + id + '">' + list.map(function (v) { return '<option value="' + esc(v) + '">'; }).join('') + '</datalist>';
    }

    function statusLabel(s) {
        var cls = { 'متاحة': 'success', 'مسلمة': 'primary', 'صيانة': 'warning', 'تالفة': 'danger', 'مفقودة': 'danger', 'مكهنة': 'default' }[s] || 'default';
        return '<span class="label label-' + cls + '">' + esc(s) + '</span>';
    }

    function ackLabel(at, paper) {
        var html = at ? '<span class="label label-success" title="' + esc(at) + '"><i class="fa fa-check"></i> موقّع إلكترونيًا</span>' : '';
        if (paper) html += (html ? ' ' : '') + '<span class="label label-paper" title="تاريخ التوقيع الورقي ' + esc(paper) + '"><i class="fa fa-file-pdf-o"></i> موقّع ورقيًا</span>';
        return html || '<span class="label label-warning"><i class="fa fa-clock-o"></i> بانتظار التوقيع</span>';
    }

    function fmtSize(b) {
        b = +b || 0;
        return b >= 1048576 ? (b / 1048576).toFixed(1) + ' م.ب' : Math.max(1, Math.round(b / 1024)) + ' ك.ب';
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

    function exportUrl(what, filters) {
        return 'api.php?action=export&what=' + what + '&' + $.param(filters || {});
    }

    function openPrint(url) { window.open(url, '_blank'); }

    // ------------------------------------------------------------ modal

    function modal(title, body, footer, size) {
        var $m = $('#modal');
        $m.removeData('handover hfp');
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
        if (cfg.tabs) html += '<div class="type-tabs"></div>';
        html += '<div class="box box-table"><div class="table-toolbar"><span class="records"></span><span class="toolbar-extra">' + (cfg.toolbar || '') + '</span></div>' +
            '<div class="table-scroll"><table class="table table-bordered table-hover data-table"><thead><tr></tr></thead><tbody></tbody></table></div>' +
            '<div class="pager-wrap"></div></div>';
        var $c = $('#content').html(html);
        var all = [], rows = [], page = 0;
        // تبويبات النوع: تعرض في الجدول أصناف النوع المختار فقط بأعمدته الخاصة
        var tab = cfg.tabs ? (S.tabs[cfg.action] || '') : '';

        // الأنواع الظاهرة: المفعّلة + أي نوع موجود في البيانات. لو نوع واحد بس، مفيش تبويبات والجدول بأعمدته على طول
        function visibleTypes() {
            return typeKeys().filter(function (t) { return activeKeys().indexOf(t) >= 0 || all.some(function (r) { return r.type === t; }); });
        }

        function drawTabs() {
            if (!cfg.tabs) return;
            var vis = visibleTypes();
            if (vis.length === 1) { tab = vis[0]; $c.find('.type-tabs').hide(); return; }
            if (tab && vis.indexOf(tab) < 0) tab = '';
            $c.find('.type-tabs').show();
            var count = function (t) { return all.filter(function (r) { return !t || r.type === t; }).length; };
            var btn = function (t, icon, label) {
                return '<button type="button" class="btn btn-lg btn-default' + (tab === t ? ' active tab-' + (t || 'all') : '') + '" data-tab="' + t + '"><i class="fa ' + icon + '"></i> ' +
                    esc(label) + ' <span class="badge">' + count(t) + '</span></button>';
            };
            $c.find('.type-tabs').html(btn('', 'fa-th-large', 'الكل') + vis.map(function (t) { return btn(t, typeDef(t).icon, typeDef(t).plural); }).join(''));
        }

        function draw() {
            rows = tab ? all.filter(function (r) { return r.type === tab; }) : all;
            $c.find('thead tr').html(typeof cfg.head === 'function' ? cfg.head(tab) : cfg.head);
            var pages = Math.max(1, Math.ceil(rows.length / PAGE_SIZE));
            page = Math.min(page, pages - 1);
            var slice = rows.slice(page * PAGE_SIZE, (page + 1) * PAGE_SIZE);
            var cols = $c.find('thead th').length;
            $c.find('tbody').html(slice.length ? slice.map(function (r) { return cfg.row(r, tab); }).join('') : '<tr><td colspan="' + cols + '" class="empty">لا توجد بيانات</td></tr>');
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

        var applied = {};
        function load() {
            var f = applied = cfg.filters ? formData($c.find('form.filters')) : {};
            $c.find('tbody').html('<tr><td colspan="20" class="empty"><i class="fa fa-spinner fa-spin"></i></td></tr>');
            return api(cfg.action, $.extend({}, cfg.params || {}, f), 'GET').then(function (data) { all = cfg.transform ? cfg.transform(data) : data; page = 0; drawTabs(); draw(); });
        }

        // تحديث في الخلفية: بالفلاتر اللي اتطبقت فعلًا (مش اللي لسه بتتكتب)، من غير ما يمدد الجلسة
        function sync() {
            return api(cfg.action, $.extend({}, cfg.params || {}, applied), 'GET', true).then(function (data) {
                if (!$.contains(document, $c[0])) return;
                var y = window.pageYOffset, x = $c.find('.table-scroll').scrollLeft();
                var checked = $c.find('tbody input[type=checkbox]:checked').map(function () { return this.value; }).get();
                all = cfg.transform ? cfg.transform(data) : data;
                drawTabs();
                draw();
                if (checked.length) {
                    $c.find('tbody input[type=checkbox]').filter(function () { return checked.indexOf(this.value) >= 0; }).prop('checked', true).trigger('change');
                }
                $c.find('.table-scroll').scrollLeft(x);
                window.scrollTo(window.pageXOffset, y);
            });
        }

        $c.on('click', '.type-tabs [data-tab]', function () {
            tab = String($(this).data('tab'));
            S.tabs[cfg.action] = tab;
            page = 0;
            drawTabs();
            draw();
        });

        $c.on('submit', 'form.filters', function (e) { e.preventDefault(); load(); });
        $c.on('reset', 'form.filters', function () { setTimeout(function () { $c.find('form.filters select.s2').trigger('change'); load(); }); });
        $c.on('click', '.pager-wrap a', function (e) { e.preventDefault(); page = +$(this).data('page'); draw(); });
        $c.on('click', '[data-export]', function () {
            window.location = exportUrl($(this).data('export'), $.extend({}, cfg.params || {}, cfg.filters ? formData($c.find('form.filters')) : {}, tab ? { type: tab } : {}));
        });
        if (cfg.init) cfg.init($c);
        load();
        return { reload: load, sync: sync, rows: function () { return rows; }, tab: function () { return tab; }, $c: $c };
    }

    // ------------------------------------------------------------ views

    var current = null;
    var views = {};

    views.dashboard = function (background) {
        if (!background) $('#content').html('<div class="empty"><i class="fa fa-spinner fa-spin"></i></div>');
        return api('dashboard', null, 'GET', !!background).then(function (d) {
            if (background && current) return;
            var st = d.by_status;
            var kpi = function (num, lbl, icon, href) {
                return '<a class="vs-kpi' + (num ? '' : ' zero') + '" href="' + (href || '#') + '"><span class="num">' + esc(num) + '</span><span class="lbl"><i class="fa ' + icon + '"></i> ' + esc(lbl) + '</span></a>';
            };
            var html = '<div class="page-head"><h3><i class="fa fa-dashboard"></i> لوحة المتابعة</h3><div class="page-actions">' +
                (canEdit() ? '<button class="btn btn-primary btn-action" data-act="assign"><i class="fa fa-plus"></i> تسليم عهدة جديدة</button>' : '') + '</div></div>';
            var dashTypes = typeKeys().filter(function (t) { return activeKeys().indexOf(t) >= 0 || d.by_type.some(function (x) { return x.type === t && x.total > 0; }); });
            if (dashTypes.length > 1) html += '<div class="type-kpis">' + dashTypes.map(function (t) {
                var r = d.by_type.filter(function (x) { return x.type === t; })[0] || { total: 0, assigned: 0, available: 0 };
                return '<a class="type-kpi type-' + t + '" href="#custody" data-tab-link="' + t + '"><i class="fa ' + typeDef(t).icon + '"></i><div><b>' + esc(typeDef(t).plural) + '</b>' +
                    '<span>' + r.assigned + ' في العهدة · ' + r.available + ' متاحة · ' + r.total + ' إجمالي</span></div></a>';
            }).join('') + '</div>';
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
            html += '<div class="dash-grid' + (dashTypes.length > 1 ? '' : ' single') + '">';
            if (dashTypes.length > 1) html += '<div class="vs-chart-card"><div class="vs-group-label">الأصناف حسب النوع</div>' + barTable(d.by_type.map(function (c) {
                return { name: c.name, value: +c.total, part: +c.assigned, note: c.assigned + ' في العهدة · ' + c.available + ' متاحة' };
            })) + '</div>';
            html += '<div class="vs-chart-card"><div class="vs-group-label">العهد القائمة حسب القسم</div>' + barTable(d.by_department.map(function (c) {
                return { name: c.name, value: +c.n, note: c.n + ' صنف — ' + money(c.value) };
            })) + '</div>';
            html += '</div>';
            html += '<div class="vs-chart-card"><div class="vs-group-label">آخر السندات</div><div class="table-scroll"><table class="table table-bordered table-condensed">' +
                '<thead><tr><th>رقم السند</th><th>النوع</th><th>الموظف</th><th>التاريخ</th><th>عدد الأصناف</th><th>التوقيع</th><th></th></tr></thead><tbody>' +
                (d.recent.length ? d.recent.map(function (h) {
                    return '<tr class="' + (h.type === 'out' ? 'row-new' : 'row-maint') + '"><td class="key">' + esc(h.doc_no) + '</td><td>' + (h.type === 'out' ? 'تسليم' : 'ارتجاع') + '</td><td>' + esc(h.employee_name) +
                        '</td><td>' + esc(h.doc_date) + '</td><td>' + h.items_count + '</td><td>' + ackLabel(h.ack_at, h.paper_signed_on) + '</td><td><button class="btn btn-default btn-xs" data-act="handover" data-id="' + h.id + '"><i class="fa fa-eye"></i> عرض</button></td></tr>';
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
        var check = canEdit() ? '<th><input type="checkbox" class="check-all"></th>' : '';
        current = listView({
            title: 'العهد', icon: 'fa-exchange', action: 'custody.list', tabs: true,
            actions: canEdit() ? '<button class="btn btn-primary btn-action" data-act="assign"><i class="fa fa-plus"></i> تسليم عهدة جديدة</button>' : '',
            filters:
                '<input class="form-control" name="q" placeholder="موظف / صنف / كود / رقم تسلسلي / رقم سند" style="width:300px"> ' +
                '<select class="form-control" name="state"><option value="active">العهد القائمة</option><option value="returned">تم ارتجاعها</option><option value="all">الكل</option></select> ' +
                '<select class="form-control" name="department">' + options(S.lookups.departments, '', 'كل الأقسام') + '</select> ' +
                '<select class="form-control" name="ack"><option value="">التوقيع: الكل</option><option value="signed">موقّع (أي توقيع)</option><option value="esign">موقّع إلكترونيًا</option><option value="paper">موقّع ورقيًا</option><option value="pending">بانتظار التوقيع</option></select> ' +
                '<label class="inline-label">من</label><input class="form-control" type="date" name="from"> <label class="inline-label">إلى</label><input class="form-control" type="date" name="to">',
            toolbar: (canEdit() ? '<button class="btn btn-warning btn-sm btn-action" data-act="return-selected"><i class="fa fa-undo"></i> ارتجاع المحدد</button> ' +
                '<button class="btn btn-primary btn-sm btn-action" data-act="transfer-selected"><i class="fa fa-random"></i> نقل المحدد لموظف آخر</button> ' : '') +
                '<button class="btn btn-success btn-sm btn-action" data-export="custody"><i class="fa fa-file-excel-o"></i> اكسيل</button>',
            head: function (t) {
                return check + '<th>الموظف</th><th>القسم</th><th>كود الأصل</th>' + (t ? '<th>الصنف</th>' + typeHeads(t) : '<th>النوع</th><th>الصنف</th><th>' + keyLabel('') + '</th><th>المواصفات والملحقات</th>') +
                    '<th>تاريخ التسليم</th><th>سند التسليم</th><th>التوقيع</th><th>الارتجاع</th>';
            },
            row: function (r, t) {
                var active = !r.in_handover_id;
                return '<tr class="' + (active ? '' : 'row-returned') + '">' +
                    (canEdit() ? '<td>' + (active ? '<input type="checkbox" class="row-check" value="' + r.id + '" data-emp="' + r.employee_id + '">' : '') + '</td>' : '') +
                    '<td><a href="#" data-act="employee" data-id="' + r.employee_id + '">' + esc(r.employee_name) + '</a></td><td>' + esc(r.department || '-') + '</td>' +
                    '<td class="key"><a href="#" data-act="item" data-id="' + r.item_id + '">' + esc(r.code) + '</a></td>' +
                    (t ? '<td>' + esc(r.item_name) + '</td>' + typeCells(r, t)
                        : '<td>' + typeBadge(r) + '</td><td>' + esc(r.item_name) + '</td><td dir="ltr">' + esc(r.serial_no || '-') + '</td><td class="details-cell">' + itemDetails(r) + '</td>') +
                    '<td>' + esc(r.assigned_at) + '</td>' +
                    '<td><a href="#" data-act="handover" data-id="' + r.out_handover_id + '">' + esc(r.out_doc_no) + '</a></td><td>' + ackLabel(r.out_ack_at, r.out_paper_on) + '</td>' +
                    '<td>' + (active ? '<span class="label label-primary">قائمة</span>' : dt(r.returned_at) + ' <a href="#" data-act="handover" data-id="' + r.in_handover_id + '">' + esc(r.in_doc_no) + '</a>') + '</td></tr>';
            },
            init: function ($c) {
                $c.on('change', '.check-all', function () { $c.find('.row-check').prop('checked', this.checked); });
            }
        });
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
                '<select class="form-control" name="ack"><option value="">التوقيع: الكل</option><option value="signed">موقّع (أي توقيع)</option><option value="esign">موقّع إلكترونيًا</option><option value="paper">موقّع ورقيًا</option><option value="pending">بانتظار التوقيع</option></select> ' +
                '<label class="inline-label">من</label><input class="form-control" type="date" name="from"> <label class="inline-label">إلى</label><input class="form-control" type="date" name="to">',
            toolbar: '<button class="btn btn-success btn-sm btn-action" data-export="handovers"><i class="fa fa-file-excel-o"></i> اكسيل</button>',
            head: '<th>رقم السند</th><th>النوع</th><th>الموظف</th><th>القسم</th><th>التاريخ</th><th>عدد الأصناف</th><th>التوقيع</th><th>بواسطة</th><th>إجراءات</th>',
            row: function (h) {
                return '<tr class="' + (h.type === 'out' ? 'row-new' : 'row-maint') + '"><td class="key">' + esc(h.doc_no) + '</td><td>' + (h.type === 'out' ? 'تسليم' : 'ارتجاع') + '</td><td>' + esc(h.employee_name) +
                    '</td><td>' + esc(h.department || '-') + '</td><td>' + esc(h.doc_date) + '</td><td>' + h.items_count + '</td><td>' + ackLabel(h.ack_at, h.paper_signed_on) + (h.ack_name ? '<br><small>' + esc(h.ack_name) + '</small>' : '') + '</td><td>' + esc(h.created_by_name || '') +
                    '</td><td class="nowrap"><button class="btn btn-default btn-xs" data-act="handover" data-id="' + h.id + '"><i class="fa fa-eye"></i> عرض</button> ' +
                    '<button class="btn btn-default btn-xs" data-act="print-h" data-id="' + h.id + '"><i class="fa fa-print"></i> طباعة</button></td></tr>';
            }
        });
    };

    views.items = function () {
        current = listView({
            title: 'الأصناف والأصول', icon: 'fa-cubes', action: 'items.list', tabs: true,
            actions: canEdit() ? activeKeys().map(function (t) {
                return '<button class="btn btn-primary btn-action" data-act="item-edit" data-type="' + t + '"><i class="fa fa-plus"></i> إضافة ' + esc(typeDef(t).label) + '</button>';
            }).join(' ') : '',
            filters:
                '<input class="form-control" name="q" placeholder="كود / ماركة / موديل / رقم تسلسلي" style="width:300px"> ' +
                '<select class="form-control" name="status">' + options(S.meta.statuses, '', 'كل الحالات') + '</select>',
            toolbar: '<button class="btn btn-success btn-sm btn-action" data-export="items"><i class="fa fa-file-excel-o"></i> اكسيل</button>',
            head: function (t) {
                return '<th>كود الأصل</th>' + (t ? '<th>الصنف</th>' + typeHeads(t) : '<th>النوع</th><th>الصنف</th><th>' + keyLabel('') + '</th><th>المواصفات والملحقات</th>') +
                    '<th>القيمة</th><th>الحالة الفنية</th><th>الوضع</th><th>في عهدة</th><th>إجراءات</th>';
            },
            row: function (i, t) {
                return '<tr><td class="key">' + esc(i.code) + '</td>' +
                    (t ? '<td>' + esc(i.name) + '</td>' + typeCells(i, t)
                        : '<td>' + typeBadge(i) + '</td><td>' + esc(i.name) + '</td><td dir="ltr">' + esc(i.serial_no || '-') + '</td><td class="details-cell">' + itemDetails(i) + '</td>') +
                    '<td>' + money(i.value) + '</td><td>' + esc(i.item_condition) + '</td><td>' + statusLabel(i.status) + '</td><td>' +
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

    views.users = function () {
        current = listView({
            title: 'المستخدمين', icon: 'fa-user-secret', action: 'users.list',
            actions: '<button class="btn btn-primary btn-action" data-act="user-edit"><i class="fa fa-plus"></i> إضافة مستخدم</button>',
            head: '<th>اسم المستخدم</th><th>الاسم</th><th>الصلاحية</th><th>الحالة</th><th>آخر دخول</th><th>إجراءات</th>',
            row: function (u) {
                return '<tr><td dir="ltr">' + esc(u.username) + '</td><td>' + esc(u.name) + '</td><td>' + esc(S.meta.roles[u.role] || u.role) + '</td><td>' +
                    (+u.active ? '<span class="label label-success">نشط</span>' : '<span class="label label-default">موقوف</span>') + '</td><td>' + esc(u.last_login || '-') +
                    '</td><td class="nowrap"><button class="btn btn-primary btn-xs" data-act="user-edit" data-id="' + u.id + '"><i class="fa fa-pencil"></i> تعديل</button>' +
                    // الدخول كمستخدم: ليس لحسابي الحالي، ومعطّل للحسابات الموقوفة (والسيرفر يتحقق من كل ذلك)
                    (+u.id !== +S.user.id && !S.impersonator ? ' <button class="btn btn-warning btn-xs" data-act="user-impersonate" data-id="' + u.id + '" data-name="' + esc(u.name) + '"' +
                        (+u.active ? '' : ' disabled title="الحساب موقوف"') + '><i class="fa fa-sign-in"></i> الدخول كمستخدم</button>' : '') + '</td></tr>';
            }
        });
    };

    views.log = function () {
        current = listView({
            title: 'سجل العمليات', icon: 'fa-history', action: 'log.list',
            head: '<th>التاريخ</th><th>المستخدم</th><th>العملية</th><th>التفاصيل</th>',
            row: function (l) {
                return '<tr><td class="nowrap">' + esc(l.created_at) + '</td><td>' + esc(l.user_name || 'الموظف (رابط التوقيع)') +
                    (l.impersonator_name ? '<div class="text-muted small"><i class="fa fa-user-secret"></i> بالنيابة بواسطة: ' + esc(l.impersonator_name) + '</div>' : '') +
                    '</td><td>' + esc(l.action) + '</td><td>' + esc(l.details || '') + '</td></tr>';
            }
        });
    };

    // ------------------------------------------------------------ استيراد وتصدير Excel
    // التصدير والقالب بنفس الأوراق والأعمدة. الاستيراد: معاينة على السيرفر الأول، ومفيش حفظ غير بعد التأكيد

    views.data = function () {
        current = null;
        var admin = isAdmin();
        var html = '<div class="page-head"><h3><i class="fa fa-file-excel-o"></i> استيراد وتصدير Excel</h3></div><div class="dx-cards">' +
            '<div class="dx-card"><h4><i class="fa fa-download"></i> تصدير البيانات Excel</h4>' +
            '<p>ملف واحد فيه كل بيانات النظام في أوراق منفصلة: الموظفين، والأصناف بأنواعها (' + esc(typeKeys().map(function (t) { return typeDef(t).label; }).join('، ')) +
            ')، والعهد، والسندات وحالة توقيعها للمراجعة.</p>' +
            '<a class="btn btn-success btn-action" href="api.php?action=data.export"><i class="fa fa-file-excel-o"></i> تصدير البيانات Excel</a></div>' +
            '<div class="dx-card"><h4><i class="fa fa-table"></i> تحميل قالب الاستيراد</h4>' +
            '<p>نفس أوراق وأعمدة التصدير بالظبط من غير بيانات، ومعاه ورقة «تعليمات» فيها الحقول المطلوبة وصيغ التواريخ والقيم المسموحة. ممكن كمان تضيف على ملف التصدير نفسه وترفعه.</p>' +
            '<a class="btn btn-primary btn-action" href="api.php?action=data.template"><i class="fa fa-download"></i> تحميل قالب الاستيراد</a></div>' +
            '<div class="dx-card"><h4><i class="fa fa-upload"></i> استيراد بيانات Excel</h4><form id="dxForm">' +
            '<div class="form-group"><input type="file" class="form-control" id="dxFile" accept=".xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"></div>' +
            '<div class="radio"><label><input type="radio" name="mode" value="add" checked> <b>إضافة سجلات جديدة فقط</b> — الموجود مابيتغيرش</label></div>' +
            '<div class="radio' + (admin ? '' : ' disabled') + '"><label><input type="radio" name="mode" value="update"' + (admin ? '' : ' disabled') + '> إضافة وتحديث السجلات الموجودة' +
            (admin ? '' : ' <small class="text-muted">(لمدير النظام)</small>') + '</label></div>' +
            '<button type="submit" class="btn btn-warning btn-action" id="dxPreviewBtn"><i class="fa fa-search"></i> معاينة الملف</button>' +
            '<small class="info-label dx-note">مفيش أي حاجة بتتحفظ قبل ما تراجع المعاينة وتضغط «تأكيد الاستيراد».</small></form></div></div>' +
            '<div class="progress" id="dxProgress" style="display:none"><div class="progress-bar progress-bar-success progress-bar-striped active" style="width:0%"></div></div>' +
            '<div id="dxResult"></div>';
        var $c = $('#content').html(html), $res = $c.find('#dxResult');

        // تغيير الملف أو الوضع بيلغي المعاينة القديمة، علشان مايتأكدش ملف أو وضع غير اللي اتعاينوا
        $c.on('change', '#dxFile, [name=mode]', function () { $res.empty(); });
        $c.on('submit', '#dxForm', function (e) {
            e.preventDefault();
            var f = $c.find('#dxFile')[0].files[0];
            if (!f) return toast('اختر ملف Excel الأول', 'danger');
            if (!/\.xlsx$/i.test(f.name)) return toast('الملف لازم يكون Excel بصيغة xlsx', 'danger');
            if (f.size > 10 * 1048576) return toast('حجم الملف أكبر من 10 م.ب', 'danger');
            var fd = new FormData();
            fd.append('file', f, f.name);
            fd.append('mode', $c.find('[name=mode]:checked').val());
            $res.empty();
            var $btn = $c.find('#dxPreviewBtn').prop('disabled', true);
            var $bar = $c.find('#dxProgress').show().find('.progress-bar').css('width', '0%').text('');
            api.onProgress = function (r) { $bar.css('width', Math.round(r * 100) + '%').text(r < 1 ? 'جاري الرفع ' + Math.round(r * 100) + '%' : 'جاري فحص الملف…'); };
            var req = api('data.import_preview', fd);
            api.onProgress = null;
            req.then(function (d) { dxRender($res, d, false); }, function (msg) {
                $res.html('<div class="alert alert-danger"><i class="fa fa-times-circle"></i> ' + esc(msg) + '<br>مفيش أي حاجة اتحفظت.</div>');
            }).always(function () { $c.find('#dxProgress').hide(); $btn.prop('disabled', false); });
        });
    };

    function dxTable(heads, rows) {
        return '<div class="table-scroll"><table class="table table-bordered table-condensed dx-table"><thead><tr>' +
            heads.map(function (h) { return '<th>' + esc(h) + '</th>'; }).join('') + '</tr></thead><tbody>' + rows.join('') + '</tbody></table></div>';
    }

    function dxDiffRows(list) {
        var rows = [];
        list.forEach(function (e) {
            e.changes.forEach(function (c) {
                rows.push('<tr><td>' + esc(e.sheet) + '</td><td class="num">' + esc(e.row) + '</td><td dir="auto">' + esc(e.key) + '</td><td>' + esc(c.col) +
                    '</td><td dir="auto"><span class="dx-old">' + esc(c.old || '(فاضي)') + '</span></td><td dir="auto"><span class="dx-new">' + esc(c['new']) + '</span></td></tr>');
            });
        });
        return rows;
    }

    function dxRender($box, d, done) {
        var s = d.summary, t = s.totals, upd = s.mode === 'update';
        var status;
        if (done) {
            status = '<div class="alert alert-success"><i class="fa fa-check-circle"></i> <b>تم الاستيراد بنجاح.</b> اتضاف ' + t['new'] + ' سجل جديد' + (t.update ? ' واتعدّل ' + t.update + ' سجل' : '') + '.' +
                (d.result && d.result.handovers.length ? '<br>سندات التسليم الجديدة (بانتظار التوقيع): <b dir="ltr">' + esc(d.result.handovers.join('، ')) + '</b>' : '') + '</div>';
        } else if (t.errors) {
            status = '<div class="alert alert-danger"><i class="fa fa-times-circle"></i> <b>الملف فيه ' + t.errors + ' خطأ.</b> صلّح الأخطاء دي في الملف وارفعه تاني. مفيش أي حاجة اتحفظت.</div>';
        } else if (!s.can_commit) {
            status = '<div class="alert alert-info"><i class="fa fa-info-circle"></i> مفيش سجلات جديدة' + (upd ? ' ولا تعديلات' : '') + ' في الملف. كل البيانات موجودة بالفعل في النظام.' +
                (t.ignored ? ' فيه ' + t.ignored + ' سجل موجود بقيم مختلفة، وده مابيتغيرش في وضع «إضافة سجلات جديدة فقط».' : '') + '</div>';
        } else {
            status = '<div class="alert alert-warning"><i class="fa fa-eye"></i> <b>معاينة بس، لسه مفيش حاجة اتحفظت.</b> راجع الجديد' + (upd ? ' والتعديلات' : '') + ' وبعدين اضغط «تأكيد الاستيراد».</div>';
        }
        var html = '<div class="dx-box"><div class="info-label"><i class="fa fa-file-excel-o"></i> ' + esc(d.file_name) + ' — ' + (upd ? 'إضافة وتحديث السجلات الموجودة' : 'إضافة سجلات جديدة فقط') + '</div>' + status;
        var cell = function (n, bad) { return '<td class="num' + (bad && n ? ' num-bad' : '') + '">' + n + '</td>'; };
        html += dxTable(['الورقة', 'جديد', 'موجود بدون تغيير', upd ? 'تعديلات' : 'تعديلات هتتجاهل', 'أخطاء'], s.sheets.map(function (x) {
            return '<tr><td>' + esc(x.name) + '</td>' + cell(x['new']) + cell(x.same) + cell(upd ? x.update : x.ignored) + cell(x.errors, true) + '</tr>';
        }));
        if (s.handovers && !done) html += '<p><i class="fa fa-file-text-o"></i> هيتعمل <b>' + s.handovers + '</b> سند تسليم جديد «بانتظار التوقيع» (سند لكل موظف وتاريخ).</p>';
        if (s.errors.length) {
            html += '<h4 class="text-danger"><i class="fa fa-exclamation-triangle"></i> الأخطاء</h4>' + dxTable(['الورقة', 'الصف', 'العمود', 'السبب'], s.errors.map(function (e) {
                return '<tr><td>' + esc(e.sheet) + '</td><td class="num">' + esc(e.row) + '</td><td>' + esc(e.col) + '</td><td>' + esc(e.msg) + '</td></tr>';
            }));
        }
        if (s.warnings.length) {
            html += '<h4><i class="fa fa-info-circle"></i> ملاحظات</h4><ul>' + s.warnings.map(function (w) { return '<li>' + esc(w.sheet) + ': ' + esc(w.msg) + '</li>'; }).join('') + '</ul>';
        }
        if (s.updates.length) {
            html += '<details open><summary>التعديلات على السجلات الموجودة (' + t.update + ')</summary>' +
                dxTable(['الورقة', 'الصف', 'الكود', 'العمود', 'القيمة الحالية', 'القيمة الجديدة'], dxDiffRows(s.updates)) + '</details>';
        }
        if (s['new'].length) {
            html += '<details' + (s['new'].length <= 30 ? ' open' : '') + '><summary>السجلات الجديدة (' + t['new'] + ')</summary>' + dxTable(['الورقة', 'الصف', 'الكود', 'البيان'], s['new'].map(function (e) {
                return '<tr><td>' + esc(e.sheet) + '</td><td class="num">' + esc(e.row) + '</td><td dir="auto">' + esc(e.key) + '</td><td>' + esc(e.label) + '</td></tr>';
            })) + '</details>';
        }
        if (s.ignored.length) {
            html += '<details><summary>سجلات موجودة بقيم مختلفة ومش هتتغير (' + t.ignored + ')</summary><p class="info-label">' +
                (upd ? 'سطور العهد المحفوظة جزء من سندات، فمابتتعدلش من الملف.' : 'في وضع «إضافة سجلات جديدة فقط» السجلات الموجودة مابتتغيرش. لو عايز تحدّثها، مدير النظام يختار «إضافة وتحديث السجلات الموجودة».') +
                '</p>' + dxTable(['الورقة', 'الصف', 'الكود', 'العمود', 'القيمة في النظام', 'القيمة في الملف'], dxDiffRows(s.ignored)) + '</details>';
        }
        if (s.truncated) html += '<p class="info-label">القوايم هنا معروضة لحد 300 سجل. التفاصيل كاملة في ملف التقرير.</p>';
        html += '<div class="dx-actions">';
        if (!done && s.can_commit) {
            if (upd) html += '<div class="checkbox dx-agree"><label><input type="checkbox" id="dxAgree"> راجعت التعديلات اللي فوق، وموافق إن القيم الحالية تتغير للقيم الجديدة.</label></div>';
            html += '<button class="btn btn-success btn-action" id="dxCommit"><i class="fa fa-check"></i> تأكيد الاستيراد</button>';
        }
        html += '<a class="btn btn-default btn-action" href="api.php?action=data.import_report&token=' + encodeURIComponent(d.token) + '"><i class="fa fa-download"></i> ' +
            (done ? 'تنزيل تقرير النتيجة' : 'تنزيل تقرير المعاينة') + '</a></div></div>';
        $box.html(html);
        $box.find('#dxCommit').on('click', function () {
            if (upd && !$box.find('#dxAgree').prop('checked')) return toast('علّم إنك راجعت التعديلات الأول', 'danger');
            var what = t['new'] + ' سجل جديد' + (t.update ? ' و' + t.update + ' تعديل' : '') + (s.handovers ? ' و' + s.handovers + ' سند تسليم' : '');
            confirmBox('هيتم حفظ ' + what + ' في النظام. متابعة؟').then(function () {
                $('#modal').modal('hide');
                var $b = $box.find('#dxCommit').prop('disabled', true);
                api('data.import_commit', { token: d.token }).then(function (r) {
                    toast('تم الاستيراد بنجاح');
                    loadLookups();
                    dxRender($box, { token: r.token, file_name: d.file_name, summary: r.summary, result: r.result }, true);
                    $('#dxFile').val('');
                }, function (msg) {
                    $b.prop('disabled', false);
                    $box.find('.dx-actions').before('<div class="alert alert-danger"><i class="fa fa-times-circle"></i> ' + esc(msg) + '</div>');
                });
            });
        });
    }

    // ------------------------------------------------------------ dialogs

    function handoverDialog(h) {
        var out = h.type === 'out';
        var body = '<div class="handover-head"><div><span class="info-label">الموظف:</span> <b>' + esc(h.employee_name) + '</b> ' + esc(h.department ? '— ' + h.department : '') +
            '</div><div><span class="info-label">التاريخ:</span> ' + dt(h.doc_date) + '</div><div><span class="info-label">بواسطة:</span> ' + esc(h.created_by_name || '') + '</div></div>' +
            '<div class="table-scroll"><table class="table table-bordered table-condensed"><thead><tr><th>#</th>' + typeTh() + '<th>كود الأصل</th><th>الصنف</th><th>' + keyLabel('') + '</th><th>المواصفات والملحقات</th><th>الحالة</th><th>ملاحظات</th></tr></thead><tbody>' +
            h.items.map(function (it, n) {
                return '<tr><td>' + (n + 1) + '</td>' + typeTd(it) + '<td>' + esc(it.code) + '</td><td>' + esc(it.name) + '</td><td dir="ltr">' + esc(it.serial_no || '-') + '</td><td class="details-cell">' + itemDetails(it) + '</td><td>' + esc(out ? it.condition_out : it.condition_in) +
                    '</td><td>' + esc((out ? it.notes_out : it.notes_in) || '') + '</td></tr>';
            }).join('') + '</tbody></table></div>' +
            (h.notes ? '<p><span class="info-label">ملاحظات:</span> ' + esc(h.notes) + '</p>' : '');
        var cur = currentScan(h);
        if (h.ack_at) {
            body += '<div class="alert alert-success"><i class="fa fa-check-circle"></i> وقّع الموظف إلكترونيًا <b>' + esc(h.ack_name) + '</b> بتاريخ ' + dt(h.ack_at) + ' من ' + dt(h.ack_ip || '') + '</div>';
        }
        body += paperBox(h, cur);
        var footer = '<button class="btn btn-default btn-action" data-act="print-h" data-id="' + h.id + '" title="النموذج الأصلي للطباعة والتوقيع، وليس النسخة الموقّعة"><i class="fa fa-print"></i> طباعة نموذج الإقرار</button>' +
            '<button class="btn btn-default btn-action" data-dismiss="modal">إغلاق</button>';
        var $m = modal('<i class="fa fa-file-text-o"></i> ' + (out ? 'سند تسليم عهدة' : 'سند ارتجاع عهدة') + ' ' + esc(h.doc_no), body, footer, 'modal-lg');
        // علشان التحديث التلقائي يعرف إن تفاصيل السند ده مفتوحة
        $m.data('handover', h.id).data('hfp', handoverPrint(h));
    }

    // بصمة حالة السند: لو اتغيرت على السيرفر نعيد رسم التفاصيل المفتوحة
    function handoverPrint(h) {
        return JSON.stringify([h.ack_at, h.paper_scan_id, h.paper_signed_on, (h.scans || []).map(function (x) { return [x.id, x.replaced_at]; })]);
    }

    function showHandover(id) { api('handovers.get', { id: id }, 'GET').then(handoverDialog); }

    // ------------------------------------------------------------ الإقرار الورقي الموقّع (Scan)

    function currentScan(h) {
        return (h.scans || []).filter(function (x) { return +x.id === +h.paper_scan_id; })[0] || null;
    }

    function scanUrl(sc, extra) { return 'api.php?action=handovers.scan_file&id=' + sc.id + (extra || ''); }

    function scanButtons(sc, small) {
        var c = small ? ' btn-xs' : ' btn-action';
        return '<a class="btn btn-primary' + c + '" target="_blank" href="' + scanUrl(sc) + '"><i class="fa fa-eye"></i> عرض' + (small ? '' : ' الإقرار الموقّع') + '</a>' +
            '<a class="btn btn-default' + c + '" href="' + scanUrl(sc, '&download=1') + '"><i class="fa fa-download"></i> تنزيل' + (small ? ' PDF' : ' الإقرار الموقّع PDF') + '</a>' +
            '<button type="button" class="btn btn-default' + c + '" data-act="scan-print" data-url="' + scanUrl(sc) + '"><i class="fa fa-print"></i> طباعة' + (small ? '' : ' الإقرار الموقّع') + '</button>';
    }

    function paperBox(h, cur) {
        var html = '<div class="paper-box"><div class="vs-group-label"><i class="fa fa-file-pdf-o"></i> الإقرار الورقي الموقّع</div>';
        if (cur) {
            html += '<div class="alert alert-paper"><b><i class="fa fa-check-circle"></i> موقّع ورقيًا</b> — تاريخ التوقيع: ' + dt(cur.signed_on) +
                '<div class="paper-meta">رفعه <b>' + esc(cur.uploaded_by_name || '') + '</b> في ' + dt(cur.uploaded_at) + ' · ' + (cur.pages ? cur.pages + ' صفحة · ' : '') + fmtSize(cur.pdf_size) +
                (+cur.version > 1 ? ' · الإصدار ' + cur.version : '') + '</div>' +
                (cur.notes ? '<div class="paper-meta">ملاحظات: ' + esc(cur.notes) + '</div>' : '') + '</div>' +
                '<div class="paper-actions">' + scanButtons(cur, false) +
                (canEdit() ? '<button type="button" class="btn btn-warning btn-action" data-act="scan-upload" data-id="' + h.id + '" data-replace="1"><i class="fa fa-pencil-square-o"></i> تصحيح / استبدال المرفق</button>' : '') +
                '</div><small class="info-label">توقيع ورقي موثّق بواسطة المستخدم اللي رفع الملف، وليس توقيعًا إلكترونيًا أو تحققًا آليًا من صحة التوقيع.</small>';
        } else {
            html += '<p class="info-label">لو الموظف وقّع على الإقرار المطبوع، اعمل له Scan أو صوّره وارفعه هنا على السند نفسه.</p>' +
                (canEdit() ? '<button type="button" class="btn btn-success btn-action" data-act="scan-upload" data-id="' + h.id + '"><i class="fa fa-upload"></i> رفع الإقرار الموقّع</button>'
                    : '<small class="info-label">رفع الإقرار متاح لمدير النظام ومسؤول العهد.</small>');
        }
        var old = (h.scans || []).filter(function (x) { return !cur || +x.id !== +cur.id; });
        if (old.length) {
            html += '<details class="scan-history"><summary>سجل الإصدارات (' + h.scans.length + ')</summary><div class="table-scroll"><table class="table table-bordered table-condensed">' +
                '<thead><tr><th>الإصدار</th><th>تاريخ التوقيع</th><th>الرفع</th><th>سبب التصحيح</th><th>بيانات السند وقت التوثيق</th><th>الملفات</th></tr></thead><tbody>' +
                h.scans.map(function (x) {
                    var snap = x.snapshot || {}, items = snap.items || [];
                    return '<tr' + (cur && +x.id === +cur.id ? ' class="success"' : '') + '><td>' + x.version + (cur && +x.id === +cur.id ? ' <span class="label label-paper">الحالي</span>' : '<br><small class="info-label">استُبدل ' + esc(x.replaced_at || '') + '</small>') +
                        '</td><td>' + dt(x.signed_on) + '</td><td>' + esc(x.uploaded_by_name || '') + '<br><small>' + dt(x.uploaded_at) + '</small></td><td>' + esc(x.reason || '-') +
                        '</td><td><small>' + esc(snap.employee ? snap.employee.name : '') + ' — ' + items.length + ' صنف: ' + esc(items.map(function (i) { return i.code + (i.serial_no ? ' (' + i.serial_no + ')' : ''); }).join('، ')) +
                        '</small></td><td class="nowrap">' + scanButtons(x, true) +
                        (x.originals || []).map(function (o, n) { return '<br><a href="' + scanUrl(x, '&original=' + (n + 1)) + '" target="_blank"><small><i class="fa fa-paperclip"></i> ' + esc(o.name) + ' (' + fmtSize(o.size) + ')</small></a>'; }).join('') +
                        '</td></tr>';
                }).join('') + '</tbody></table></div></details>';
        }
        return html + '</div>';
    }

    // طباعة الـ PDF الموقّع نفسه. على الموبايل بيتفتح في تاب جديدة ويتطبع من عارض الـ PDF
    function printPdf(url) {
        if (/Android|iPhone|iPad|iPod/i.test(navigator.userAgent)) { window.open(url, '_blank'); return; }
        var $f = $('<iframe class="print-frame" aria-hidden="true" tabindex="-1"></iframe>').attr('src', url).appendTo('body'), done = false;
        $f.on('load', function () {
            if (done) return;
            done = true;
            try { this.contentWindow.focus(); this.contentWindow.print(); } catch (e) { window.open(url, '_blank'); }
            setTimeout(function () { $f.remove(); }, 120000);
        });
    }

    function scanDialog(h, replace) {
        var L = S.meta.scan_limits, cur = currentScan(h), files = [], seq = 0;
        var kind = function (f) {
            var n = (f.name || '').toLowerCase();
            if (f.type === 'application/pdf' || /\.pdf$/.test(n)) return 'pdf';
            if (f.type === 'image/jpeg' || /\.(jpe?g)$/.test(n)) return 'jpg';
            if (f.type === 'image/png' || /\.png$/.test(n)) return 'png';
            return '';
        };
        var who = (h.type === 'out' ? 'سند تسليم' : 'سند ارتجاع') + ' رقم ' + h.doc_no + ' للموظف ' + h.employee_name;
        var body = '<form id="scanForm" novalidate>' +
            '<div class="scan-target"><i class="fa fa-file-text-o"></i> ' + esc(h.type === 'out' ? 'سند تسليم' : 'سند ارتجاع') + ' <b>' + esc(h.doc_no) + '</b> — الموظف: <b>' + esc(h.employee_name) + '</b>' +
            (h.employee_code ? ' (' + esc(h.employee_code) + ')' : '') + ' — تاريخ السند ' + dt(h.doc_date) + '</div>' +
            (replace && cur ? '<div class="alert alert-warning"><i class="fa fa-history"></i> الإصدار الحالي (' + cur.version + ') هيفضل محفوظ في سجل الإصدارات، والملف الجديد هيبقى هو الإقرار المعتمد.</div>' : '') +
            '<div class="scan-pick">' +
            '<button type="button" class="btn btn-primary btn-action" id="scanPick"><i class="fa fa-folder-open"></i> اختيار ملفات من الجهاز</button>' +
            '<button type="button" class="btn btn-default btn-action" id="scanCam"><i class="fa fa-camera"></i> تصوير بالكاميرا</button>' +
            '<input type="file" id="scanFiles" accept="application/pdf,image/jpeg,image/png,.pdf,.jpg,.jpeg,.png" multiple style="display:none">' +
            '<input type="file" id="scanCamInput" accept="image/*" capture="environment" style="display:none">' +
            '</div>' +
            '<div class="scan-limits"><i class="fa fa-info-circle"></i> المسموح: <b>ملف PDF واحد</b> فيه كل الصفحات (حتى ' + L.file_mb + ' م.ب)، أو <b>صور JPG / PNG</b> حتى ' + L.files + ' صورة (حتى ' + L.file_mb + ' م.ب للصورة و' + L.total_mb + ' م.ب إجمالًا). ' +
            'الصور بتتحول بنفس الترتيب لملف PDF واحد. لو بتستخدم سكانر، احفظ الناتج PDF أو صور وارفعه. التصوير بالكاميرا متاح على الموبايل والأجهزة اللي بتدعمه.</div>' +
            '<div id="scanList" class="scan-list"></div>' +
            '<div class="row"><div class="col-sm-6 form-group"><label>تاريخ التوقيع الورقي *</label><input class="form-control" type="date" name="signed_on" required min="' + esc(h.doc_date) + '" max="' + esc(S.meta.today) + '" value="' + esc(S.meta.today) + '">' +
            '<small class="info-label">اليوم اللي الموظف وقّع فيه على الورقة، مش وقت الرفع.</small></div></div>' +
            (replace ? '<div class="form-group"><label>سبب التصحيح أو الاستبدال *</label><textarea class="form-control" name="reason" rows="2" maxlength="500" required placeholder="مثال: الملف الأول ناقص صفحة / الصورة مش واضحة"></textarea></div>' : '') +
            '<div class="form-group"><label>ملاحظات</label><textarea class="form-control" name="notes" rows="2" maxlength="1000"></textarea></div>' +
            '<div class="checkbox scan-confirm"><label><input type="checkbox" name="confirm" value="1" required> أؤكد إن الملف ده يخص ' + esc(who) + '، وفيه توقيع الموظف الفعلي على الإقرار.</label></div>' +
            '<div class="progress" id="scanProgress" style="display:none"><div class="progress-bar progress-bar-success progress-bar-striped active" style="width:0%"></div></div>' +
            '<div class="alert alert-danger" id="scanError" style="display:none"></div></form>';
        var footer = '<button type="button" class="btn btn-success btn-action" id="scanSave"><i class="fa fa-save"></i> ' + (replace ? 'حفظ الإصدار الجديد' : 'حفظ الإقرار الموقّع') + '</button>' +
            '<button type="button" class="btn btn-default btn-action" id="scanBack">رجوع للسند</button>';
        var $m = modal('<i class="fa fa-upload"></i> ' + (replace ? 'تصحيح / استبدال الإقرار الموقّع' : 'رفع الإقرار الموقّع'), body, footer, 'modal-lg');
        var showErr = function (msg) { $m.find('#scanError').text(msg).toggle(!!msg); };

        function render() {
            var total = files.reduce(function (a, f) { return a + f.file.size; }, 0);
            $m.find('#scanList').html(files.length ? files.map(function (f, i) {
                return '<div class="scan-item" data-i="' + i + '">' +
                    (f.kind === 'pdf' ? '<div class="scan-thumb pdf"><i class="fa fa-file-pdf-o"></i></div>' : '<img class="scan-thumb" src="' + f.url + '" alt="">') +
                    '<div class="scan-info"><b>' + (f.kind === 'pdf' ? 'ملف PDF' : 'صفحة ' + (i + 1)) + '</b><small dir="auto">' + esc(f.file.name) + '</small><small>' + fmtSize(f.file.size) + '</small></div>' +
                    '<div class="scan-tools">' +
                    '<button type="button" class="btn btn-default btn-xs" data-scan="view" title="معاينة"><i class="fa fa-search-plus"></i></button>' +
                    (files.length > 1 ? '<button type="button" class="btn btn-default btn-xs" data-scan="up" title="لأعلى"' + (i ? '' : ' disabled') + '><i class="fa fa-arrow-up"></i></button>' +
                        '<button type="button" class="btn btn-default btn-xs" data-scan="down" title="لأسفل"' + (i < files.length - 1 ? '' : ' disabled') + '><i class="fa fa-arrow-down"></i></button>' : '') +
                    '<button type="button" class="btn btn-danger btn-xs" data-scan="del" title="إزالة"><i class="fa fa-times"></i></button></div></div>';
            }).join('') + '<div class="scan-sum">' + (files[0].kind === 'pdf' ? 'ملف PDF واحد' : files.length + ' صفحة') + ' · ' + fmtSize(total) + '</div>'
                : '<div class="scan-empty"><i class="fa fa-file-image-o"></i> لم يتم اختيار ملفات بعد</div>');
        }

        function add(list) {
            showErr('');
            var errs = [];
            Array.prototype.forEach.call(list, function (file) {
                var k = kind(file), total = files.reduce(function (a, f) { return a + f.file.size; }, 0);
                if (!k) return errs.push('"' + file.name + '" ليس PDF أو صورة JPG/PNG');
                if (file.size > L.file_mb * 1048576) return errs.push('"' + file.name + '" أكبر من ' + L.file_mb + ' م.ب');
                if (k === 'pdf' && files.length) return errs.push('ملف الـ PDF لازم يترفع لوحده. شيل الملفات التانية الأول');
                if (k !== 'pdf' && files.length && files[0].kind === 'pdf') return errs.push('مينفعش تضيف صور مع ملف PDF');
                if (files.length >= L.files) return errs.push('أقصى عدد ' + L.files + ' صورة');
                if (total + file.size > L.total_mb * 1048576) return errs.push('إجمالي الحجم هيعدّي ' + L.total_mb + ' م.ب');
                files.push({ id: ++seq, file: file, kind: k, url: URL.createObjectURL(file) });
            });
            if (errs.length) showErr(errs.join(' — '));
            render();
        }

        function cleanup() { files.forEach(function (f) { URL.revokeObjectURL(f.url); }); }

        render();
        $m.find('#scanPick').on('click', function () { $m.find('#scanFiles').val('').trigger('click'); });
        $m.find('#scanCam').on('click', function () { $m.find('#scanCamInput').val('').trigger('click'); });
        $m.find('#scanFiles, #scanCamInput').on('change', function () { add(this.files); });
        $m.find('#scanList').on('click', '[data-scan]', function () {
            var i = +$(this).closest('.scan-item').data('i'), a = $(this).data('scan'), t;
            if (a === 'view') window.open(files[i].url, '_blank');
            if (a === 'up' && i > 0) { t = files[i - 1]; files[i - 1] = files[i]; files[i] = t; }
            if (a === 'down' && i < files.length - 1) { t = files[i + 1]; files[i + 1] = files[i]; files[i] = t; }
            if (a === 'del') { URL.revokeObjectURL(files[i].url); files.splice(i, 1); }
            render();
        });
        $m.find('#scanBack').on('click', function () { cleanup(); handoverDialog(h); });
        $m.find('#scanSave').on('click', function () {
            var $f = $m.find('#scanForm'), v = formData($f);
            showErr('');
            if (!files.length) return showErr('اختر ملف الإقرار الموقّع أو صوّره الأول');
            if (!v.signed_on) return showErr('حدد تاريخ التوقيع الورقي');
            if (v.signed_on < h.doc_date || v.signed_on > S.meta.today) return showErr('تاريخ التوقيع لازم يكون من تاريخ السند لحد النهارده');
            if (replace && !$.trim(v.reason || '')) return showErr('اكتب سبب التصحيح أو الاستبدال');
            if (!+v.confirm) return showErr('أكّد إن الملف يخص هذا السند وفيه توقيع الموظف');
            var fd = new FormData();
            fd.append('handover_id', h.id);
            fd.append('signed_on', v.signed_on);
            fd.append('notes', v.notes || '');
            fd.append('confirm', '1');
            if (replace) { fd.append('replace', '1'); fd.append('reason', v.reason); fd.append('current_scan_id', cur ? cur.id : ''); }
            files.forEach(function (f) { fd.append('files[]', f.file, f.file.name); });
            var $btns = $m.find('.modal-footer .btn, #scanPick, #scanCam').prop('disabled', true);
            var $bar = $m.find('#scanProgress').show().find('.progress-bar').css('width', '0%').text('');
            api.onProgress = function (r) { $bar.css('width', Math.round(r * 100) + '%').text(r < 1 ? 'جاري الرفع ' + Math.round(r * 100) + '%' : 'جاري تجهيز الملف…'); };
            var req = api('handovers.paper_upload', fd);
            api.onProgress = null;
            req.then(function (nh) {
                cleanup();
                toast(replace ? 'تم حفظ الإصدار الجديد من الإقرار الموقّع' : 'تم حفظ الإقرار الموقّع، والسند بقى موقّع ورقيًا');
                handoverDialog(nh);
                refresh();
            }, function (msg) {
                $m.find('#scanProgress').hide();
                $btns.prop('disabled', false);
                showErr(msg + ' — لم يتم تغيير حالة السند.');
            });
        });
    }

    function assignDialog(preset) {
        preset = preset || {};
        var lines = [];
        var body = '<form id="assignForm">' +
            '<div class="row"><div class="col-sm-6 form-group"><label>الموظف المستلم</label><select class="form-control" id="asEmp"></select></div>' +
            '<div class="col-sm-3 form-group"><label>تاريخ التسليم</label><input class="form-control" type="date" name="date" value="' + S.meta.today + '" required></div></div>' +
            '<div class="form-group"><label>الأصناف</label><div class="filter-inline as-type">' +
            (activeKeys().length > 1 ? '<div class="btn-group" id="asType"><button type="button" class="btn btn-default active" data-type="">الكل</button>' +
            activeKeys().map(function (t) { return '<button type="button" class="btn btn-default" data-type="' + t + '"><i class="fa ' + typeDef(t).icon + '"></i> ' + esc(typeDef(t).label) + '</button>'; }).join('') +
            '</div>' : '') + '<select class="form-control" id="asItem"></select></div><small class="info-label">ابحث بالكود أو الماركة أو الموديل أو ' + esc(keyLabel('')) + ' — تظهر الأصناف المتاحة فقط</small></div>' +
            '<div class="table-scroll"><table class="table table-bordered table-condensed" id="asLines"><thead><tr>' + typeTh() + '<th>كود الأصل</th><th>الصنف</th><th>' + keyLabel('') + '</th><th>المواصفات والملحقات</th><th>الحالة عند التسليم</th><th>ملاحظات</th><th></th></tr></thead><tbody></tbody></table></div>' +
            '<div class="form-group"><label>ملاحظات السند</label><textarea class="form-control" name="notes" rows="2"></textarea></div></form>';
        var $m = modal('<i class="fa fa-share"></i> تسليم عهدة جديدة', body,
            '<button class="btn btn-success btn-action" id="asSave"><i class="fa fa-check"></i> حفظ وإنشاء سند التسليم</button><button class="btn btn-default btn-action" data-dismiss="modal">إلغاء</button>', 'modal-lg');
        employeeSelect($m.find('#asEmp'));
        if (preset.emp) {
            $m.find('#asEmp').append(new Option(preset.empName, preset.emp, true, true)).trigger('change');
        }
        var $item = $m.find('#asItem'), asType = '';
        $m.find('#asType').on('click', '[data-type]', function () {
            asType = String($(this).data('type'));
            $(this).addClass('active').siblings().removeClass('active');
            $item.select2('open');
        });
        $item.select2({
            dir: 'rtl', width: '100%', dropdownParent: $m, placeholder: 'أضف صنفًا...',
            language: { noResults: function () { return 'لا توجد أصناف متاحة مطابقة'; }, searching: function () { return 'جاري البحث...'; } },
            ajax: {
                url: 'api.php', dataType: 'json', delay: 250,
                data: function (p) { return { action: 'items.list', q: p.term || '', status: 'متاحة', type: asType }; },
                processResults: function (r) {
                    return {
                        results: r.data.slice(0, 50).map(function (i) {
                            return { id: i.id, text: i.type_label + ' — ' + i.code + ' — ' + i.name + (i.serial_no ? ' [' + i.serial_no + ']' : '') + (i.specs_text ? ' — ' + i.specs_text : ''), item: i };
                        })
                    };
                }
            },
            templateResult: function (d) {
                return d.item ? $('<span><i class="fa ' + typeDef(d.item.type).icon + '"></i> ' + esc(d.text) + '</span>') : d.text;
            }
        }).on('select2:select', function (e) {
            addLine(e.params.data.item);
            $item.val(null).trigger('change');
        });

        function addLine(i) {
            if (lines.some(function (l) { return l.id == i.id; })) return;
            lines.push(i);
            $m.find('#asLines tbody').append('<tr data-id="' + i.id + '">' + typeTd(i) + '<td>' + esc(i.code) + '</td><td>' + esc(i.name) + '</td><td dir="ltr">' + esc(i.serial_no || '-') + '</td><td class="details-cell">' + itemDetails(i) + '</td>' +
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
            '<div class="table-scroll"><table class="table table-bordered table-condensed" id="retLines"><thead><tr>' + typeTh() + '<th>كود الأصل</th><th>الصنف</th><th>' + keyLabel('') + '</th><th>الحالة عند الاستلام</th>' +
            (transfer ? '' : '<th>الوضع بعد الارتجاع</th>') + '<th>ملاحظات</th></tr></thead><tbody>' +
            rows.map(function (r) {
                return '<tr data-id="' + r.id + '">' + typeTd(r) + '<td>' + esc(r.code) + '</td><td>' + esc(r.item_name) + (r.accessories_text ? '<br><small class="info-label">الملحقات: ' + esc(r.accessories_text) + '</small>' : '') +
                    '</td><td dir="ltr">' + esc(r.serial_no || '-') + '</td><td><select class="form-control input-sm l-cond">' + options(S.meta.conditions, r.condition_out || 'جيد') + '</select></td>' +
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
                '<div class="vs-kpi' + (d.handovers.filter(function (h) { return !h.ack_at && !h.paper_signed_on; }).length ? '' : ' zero') + '"><span class="num">' + d.handovers.filter(function (h) { return !h.ack_at && !h.paper_signed_on; }).length + '</span><span class="lbl">سندات بانتظار التوقيع</span></div></div>' +
                '<div class="table-scroll"><table class="table table-bordered table-condensed"><thead><tr>' + (canEdit() ? '<th></th>' : '') + typeTh() + '<th>كود الأصل</th><th>الصنف</th><th>' + keyLabel('') + '</th><th>المواصفات والملحقات</th><th>القيمة</th><th>تاريخ التسليم</th><th>السند</th><th>التوقيع</th><th>الارتجاع</th></tr></thead><tbody>' +
                (d.custody.length ? d.custody.map(function (c) {
                    var act = !c.in_handover_id;
                    return '<tr class="' + (act ? '' : 'row-returned') + '">' + (canEdit() ? '<td>' + (act ? '<input type="checkbox" class="emp-check" value="' + c.id + '">' : '') + '</td>' : '') +
                        typeTd(c) + '<td>' + esc(c.code) + '</td><td>' + esc(c.item_name) + '</td><td dir="ltr">' + esc(c.serial_no || '-') + '</td><td class="details-cell">' + itemDetails(c) + '</td><td>' + money(c.value) + '</td><td>' + esc(c.assigned_at) +
                        '</td><td><a href="#" data-act="handover" data-id="' + c.out_handover_id + '">' + esc(c.out_doc_no) + '</a></td><td>' + ackLabel(c.out_ack_at, c.out_paper_on) + '</td><td>' +
                        (act ? '<span class="label label-primary">قائمة</span>' : dt(c.returned_at) + ' — ' + esc(c.in_doc_no)) + '</td></tr>';
                }).join('') : '<tr><td colspan="12" class="empty">لا يوجد سجل عهد لهذا الموظف</td></tr>') + '</tbody></table></div>';
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
            var spec = typeDef(i.type).fields.map(function (f) {
                var v = specCell(i, f.key);
                return v === '-' ? '' : '<span><span class="info-label">' + esc(f.label) + ':</span> ' + v + '</span>';
            }).join('');
            var info = [['الكود', i.code], ['تاريخ الشراء', i.purchase_date], ['القيمة', i.value !== null ? money(i.value) : ''], ['المكان', i.location], ['الحالة الفنية', i.item_condition]]
                .filter(function (x) { return x[1]; }).map(function (x) { return '<span><span class="info-label">' + x[0] + ':</span> ' + esc(x[1]) + '</span>'; }).join('');
            var linked = d.linked_by ? '<p><span class="info-label"><i class="fa ' + typeDef(d.linked_by.type).icon + '"></i> مرتبطة بالجهاز:</span> <a href="#" data-act="item" data-id="' + d.linked_by.id + '">' +
                esc(d.linked_by.code + ' — ' + d.linked_by.name) + '</a></p>' : '';
            var body = '<div class="emp-info">' + typeBadge(i) + ' ' + info + ' ' + statusLabel(i.status) + '</div><div class="emp-info spec-info">' + spec + '</div>' + linked + (i.notes ? '<p><span class="info-label">ملاحظات:</span> ' + esc(i.notes) + '</p>' : '') +
                '<div class="vs-group-label">سجل التداول</div><div class="table-scroll"><table class="table table-bordered table-condensed"><thead><tr><th>الموظف</th><th>القسم</th><th>تاريخ التسليم</th><th>الحالة</th><th>سند التسليم</th><th>تاريخ الارتجاع</th><th>الحالة</th><th>سند الارتجاع</th></tr></thead><tbody>' +
                (d.history.length ? d.history.map(function (c) {
                    return '<tr><td>' + esc(c.employee_name) + '</td><td>' + esc(c.department || '-') + '</td><td>' + esc(c.assigned_at) + '</td><td>' + esc(c.condition_out || '') +
                        '</td><td><a href="#" data-act="handover" data-id="' + c.out_handover_id + '">' + esc(c.out_doc_no) + '</a></td><td>' + esc(c.returned_at || '-') + '</td><td>' + esc(c.condition_in || '-') +
                        '</td><td>' + (c.in_handover_id ? '<a href="#" data-act="handover" data-id="' + c.in_handover_id + '">' + esc(c.in_doc_no) + '</a>' : '-') + '</td></tr>';
                }).join('') : '<tr><td colspan="8" class="empty">لم يُسلَّم هذا الصنف لأي موظف بعد</td></tr>') + '</tbody></table></div>';
            modal('<i class="fa fa-cube"></i> ' + esc(i.code + ' — ' + i.name), body, undefined, 'modal-lg');
        });
    }

    // حقل من حقول نوع الصنف حسب تعريفه في types.json
    function typeFieldInput(t, f, v) {
        // ربط بصنف آخر (مثل شريحة ماكينة POS): القائمة تُملأ من السيرفر بعد فتح النموذج
        if (f.input === 'item_ref') {
            return '<select class="form-control spec item-ref" data-key="' + f.key + '" data-ref-type="' + esc(f.ref_type) + '" data-value="' + esc(v || '') + '">' +
                '<option value="' + esc(v || '') + '">جاري التحميل...</option></select>' +
                '<small class="info-label">اختياري — الشريحة الواحدة تُربط بجهاز واحد فقط</small>';
        }
        if (f.input === 'checks') {
            return '<div class="spec-checks">' + f.options.map(function (o) {
                return '<label class="checkbox-inline"><input type="checkbox" class="spec-check" data-key="' + f.key + '" value="' + esc(o) + '"' + ($.isArray(v) && v.indexOf(o) >= 0 ? ' checked' : '') + '> ' + esc(o) + '</label>';
            }).join('') + '</div>';
        }
        if (f.options) return '<select class="form-control spec" data-key="' + f.key + '"' + (f.required ? ' required' : '') + '>' + options(f.options, v || '', '-- اختر --') + '</select>';
        var type = f.input === 'date' ? 'date' : f.input === 'number' ? 'number' : 'text', dl = 'dl-' + t + '-' + f.key;
        return '<input class="form-control spec" data-key="' + f.key + '" type="' + type + '"' + (type === 'number' ? ' step="0.01" min="0"' : '') + (f.ltr ? ' dir="ltr"' : '') +
            (f.required ? ' required' : '') + (f.placeholder ? ' placeholder="' + esc(f.placeholder) + '"' : '') + (f.suggest ? ' list="' + dl + '"' : '') + ' value="' + esc(v || '') + '">' +
            (f.suggest ? datalist(dl, f.suggest) : '');
    }

    function typeFieldsHtml(t, specs, refs) {
        return '<div class="col-xs-12"><div class="vs-group-label"><i class="fa ' + typeDef(t).icon + '"></i> بيانات ' + esc(typeDef(t).label) + '</div></div>' +
            typeDef(t).fields.map(function (f) {
                var v = f.input === 'item_ref' ? (refs || {})[f.key] : specs[f.key];
                return fg(f.input === 'checks' ? 12 : 4, esc(f.label) + (f.required ? ' *' : ''), typeFieldInput(t, f, v));
            }).join('');
    }

    // يملأ قوائم الربط (الشرائح) ويعطّل المرتبط منها بجهاز آخر
    function loadRefOptions($scope, selfId) {
        $scope.find('select.item-ref').each(function () {
            var $s = $(this), cur = String($s.data('value') || '');
            api('items.ref_options', { type: $s.data('ref-type') }, 'GET').then(function (list) {
                $s.html('<option value="">-- بدون --</option>' + list.map(function (o) {
                    var busy = o.linked_id && String(o.linked_id) !== String(selfId || '');
                    return '<option value="' + o.id + '"' + (String(o.id) === cur ? ' selected' : '') + (busy ? ' disabled' : '') + '>' +
                        esc(o.serial_no + (o.brand ? ' - ' + o.brand : '') + ' (' + o.code + ')' + (busy ? ' — مرتبطة بـ ' + o.linked_code : '')) + '</option>';
                }).join(''));
            });
        });
    }

    function collectSpecs($form) {
        var o = {};
        $form.find('.spec').each(function () { o[$(this).data('key')] = $(this).val(); });
        $form.find('.spec-check:checked').each(function () { var k = $(this).data('key'); (o[k] = o[k] || []).push(this.value); });
        return o;
    }

    function itemForm(id, presetType) {
        var load = id ? api('items.get', { id: id }, 'GET').then(function (d) { return d.item; })
            : $.Deferred().resolve({ type: presetType || (current && current.tab && activeKeys().indexOf(current.tab()) >= 0 && current.tab()) || activeKeys()[0], status: 'متاحة', item_condition: 'جديد', specs: {} }).promise();
        load.then(function (i) {
            var type = i.type, assigned = i.status === 'مسلمة';
            var typePicker = id ? '<p class="form-control-static">' + typeBadge(i) + ' <small class="info-label">نوع الصنف لا يتغير بعد إضافته</small></p>'
                : activeKeys().length === 1 ? '<p class="form-control-static">' + typeBadge(i) + '</p>'
                : '<div class="btn-group" id="itType">' + activeKeys().map(function (t) {
                    return '<button type="button" class="btn btn-default' + (t === type ? ' active' : '') + '" data-type="' + t + '"><i class="fa ' + typeDef(t).icon + '"></i> ' + esc(typeDef(t).label) + '</button>';
                }).join('') + '</div>';
            var body = '<form id="itemForm" class="row">' +
                '<input type="hidden" name="id" value="' + esc(i.id || '') + '">' +
                fg(12, 'نوع الصنف', typePicker) +
                '<div id="itFields" class="clearfix">' + typeFieldsHtml(type, i.specs || {}, i.refs) + '</div>' +
                '<div class="col-xs-12"><div class="vs-group-label"><i class="fa fa-archive"></i> بيانات الأصل</div></div>' +
                fg(4, 'كود الأصل', '<input class="form-control" name="code" value="' + esc(i.code || '') + '" placeholder="يُولَّد تلقائيًا إن تُرك فارغًا">') +
                fg(4, 'تاريخ الشراء', '<input class="form-control" type="date" name="purchase_date" value="' + esc(i.purchase_date || '') + '">') +
                fg(4, 'القيمة (ج.م)', '<input class="form-control" type="number" step="0.01" min="0" name="value" value="' + esc(i.value === null || i.value === undefined ? '' : i.value) + '">') +
                fg(4, 'المكان / المخزن', '<input class="form-control" name="location" list="dlLoc" value="' + esc(i.location || '') + '">' + datalist('dlLoc', S.lookups.locations)) +
                fg(4, 'الحالة الفنية', '<select class="form-control" name="item_condition">' + options(S.meta.conditions, i.item_condition) + '</select>') +
                fg(4, 'الوضع', assigned ? '<p class="form-control-static">' + statusLabel('مسلمة') + ' <small class="info-label">يتغير بالارتجاع</small></p>'
                    : '<select class="form-control" name="status">' + options(S.meta.statuses.filter(function (s) { return s !== 'مسلمة'; }), i.status) + '</select>') +
                fg(12, 'ملاحظات', '<textarea class="form-control" name="notes" rows="2">' + esc(i.notes || '') + '</textarea>') + '</form>';
            var title = function () { return '<i class="fa ' + typeDef(type).icon + '"></i> ' + (id ? 'تعديل ' : 'إضافة ') + esc(typeDef(type).label); };
            var $m = modal(title(), body, saveFooter(), 'modal-lg');
            loadRefOptions($m, id);
            $m.find('#itType').on('click', '[data-type]', function () {
                type = String($(this).data('type'));
                $(this).addClass('active').siblings().removeClass('active');
                $m.find('#itFields').html(typeFieldsHtml(type, {}));
                $m.find('.modal-title').html(title());
                loadRefOptions($m, id);
            });
            $m.find('#btnSave').on('click', function () {
                var $form = $m.find('#itemForm');
                if (!$form[0].checkValidity()) { $form[0].reportValidity(); return; }
                var $b = $(this).prop('disabled', true);
                api('items.save', $.extend(formData($form), { type: type, specs: collectSpecs($form) })).then(function (r) {
                    $m.modal('hide');
                    toast('تم حفظ ' + typeDef(type).label + ' ' + r.code);
                    refresh();
                    loadLookups();
                }).always(function () { $b.prop('disabled', false); });
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
            case 'scan-print': printPdf($t.data('url')); break;
            case 'scan-upload':
                api('handovers.get', { id: id }, 'GET').then(function (h) { scanDialog(h, !!$t.data('replace')); });
                break;
            case 'print-emp': openPrint('print.php?emp=' + id); break;
            case 'employee': employeeCard(id); break;
            case 'item': itemCard(id); break;
            case 'item-edit': itemForm(id, $t.data('type')); break;
            case 'employee-edit': employeeForm(id); break;
            case 'user-edit': userForm(id); break;
            case 'user-impersonate':
                confirmBox('ستدخل النظام باسم "' + $t.data('name') + '" وبصلاحياته فقط. متابعة؟').then(function () {
                    api('auth.impersonate', { id: id }).then(function () { location.hash = 'dashboard'; location.reload(); });
                });
                break;
            case 'item-delete':
                confirmBox('حذف الصنف نهائيًا؟').then(function () { api('items.delete', { id: id }).then(function () { $('#modal').modal('hide'); toast('تم الحذف'); refresh(); }); });
                break;
            case 'employee-delete':
                confirmBox('حذف الموظف نهائيًا؟').then(function () { api('employees.delete', { id: id }).then(function () { $('#modal').modal('hide'); toast('تم الحذف'); refresh(); loadLookups(); }); });
                break;
            case 'return-selected': var r = selectedCustody(); if (r) returnDialog(r, false); break;
            case 'transfer-selected': var t = selectedCustody(); if (t) returnDialog(t, true); break;
        }
    });

    // بطاقات الأنواع في لوحة المتابعة تفتح صفحة العهد على تبويب النوع
    $(document).on('click', '[data-tab-link]', function () { S.tabs['custody.list'] = String($(this).data('tab-link')); });

    $(document).on('click', '[data-copy]', function (e) { e.preventDefault(); copyText($(this).data('copy'), $(this)); });

    // ------------------------------------------------------------ routing + auth

    function route() {
        var name = (location.hash || '#dashboard').slice(1);
        if (!views[name] || ((name === 'users' || name === 'log') && !isAdmin()) || (name === 'data' && !canEdit())) name = 'dashboard';
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
        $('body').removeClass('relogin');
        $('#appView').hide();
        $('#loginView').show();
    }

    // ------------------------------------------------------------ مهلة الجلسة
    // السيرفر هو المرجع: الجلسة تنتهي بعد مهلة خمول، وتتجدد بأي طلب يعمله المستخدم بنفسه أو بتفاعله مع الصفحة.
    // فحص الحالة الدوري في الخلفية لا يمددها. مفيش أي بيانات دخول بتتحفظ في المتصفح.
    var SESS = { idle: 0, warn: 300, deadline: 0, lastPing: 0, lastInput: 0, lastCheck: 0, checking: false, expired: false };

    // أقصى معدل لإبلاغ السيرفر بالتفاعل: دقيقة (أو عُشر المهلة لو أقصر)
    function pingEvery() { return Math.min(60000, SESS.idle * 100); }

    function sessionSync(info) {
        if (!info) return;
        SESS.idle = info.idle;
        SESS.warn = info.warn;
        SESS.deadline = Date.now() + info.remaining * 1000;
        SESS.lastCheck = Date.now();
    }

    function sessionTouched() {
        SESS.deadline = Date.now() + SESS.idle * 1000;
        SESS.lastPing = Date.now();
    }

    function sameIdentity(d) {
        return !!d.user && !!S.user && +d.user.id === +S.user.id && (d.impersonator || null) === (S.impersonator ? +S.impersonator.id : null);
    }

    // يجيب رمز الحماية الحالي، ويرجع true لو الجلسة لسه لنفس المستخدم
    function refreshCsrf() {
        return api('auth.session', null, 'GET', true).then(function (d) {
            S.csrf = d.csrf;
            return !S.user || sameIdentity(d);
        });
    }

    function checkSession(activity) {
        if (SESS.checking) return;
        SESS.checking = true;
        api('auth.session', null, 'GET', !activity).then(function (d) {
            SESS.lastCheck = Date.now();
            S.csrf = d.csrf;
            if (!S.user || SESS.expired) return;
            if (!d.user) { sessionExpired(d.session.message); return; }
            if (!sameIdentity(d)) { location.reload(); return; }
            sessionSync(d.session);
            if (d.user.role !== S.user.role) {
                toast('تم تغيير صلاحيات حسابك، وتم تحديث الصفحة على الصلاحيات الجديدة', 'warning');
                $('#modal').modal('hide');
                boot();
            }
        }).always(function () { SESS.checking = false; });
    }

    function fmtLeft(ms) {
        var s = Math.max(0, Math.ceil(ms / 1000));
        return Math.floor(s / 60) + ':' + ('0' + s % 60).slice(-2);
    }

    function sessionTick() {
        if (!S.user || SESS.expired || !SESS.idle) return;
        var now = Date.now(), left = SESS.deadline - now;
        // قبل التنبيه أو بعد المهلة نتأكد من السيرفر، يمكن المستخدم شغال في نافذة تانية
        if (SESS.lastInput > SESS.lastPing && now - SESS.lastPing > pingEvery()) {
            // تفاعل لسه ماوصلش للسيرفر
            SESS.lastPing = now;
            checkSession(true);
        } else if ((left <= SESS.warn * 1000 && now - SESS.lastCheck > (left <= 0 ? 3000 : 20000)) || now - SESS.lastCheck > 60000) {
            checkSession(false);
        }
        if (left > 0 && left <= SESS.warn * 1000) {
            $('#sessionWarnLeft').text(fmtLeft(left));
            $('#sessionWarn').show();
        } else {
            $('#sessionWarn').hide();
        }
    }

    function sessionExpired(msg) {
        $('#sessionWarn').hide();
        $('#loginNotice').text(msg || 'انتهت الجلسة، سجّل الدخول مرة أخرى').show();
        $('#loginError').hide();
        refreshCsrf();
        if (!S.user) { showLogin(); return; }
        if (SESS.expired) return;
        SESS.expired = true;
        // شاشة الدخول فوق الصفحة الحالية، فالنماذج المفتوحة والبيانات اللي اتكتبت فيها بتفضل زي ما هي
        $(document).off('focusin.bs.modal');
        $('body').addClass('relogin');
        var $v = $('#loginView').show();
        $v.find('[name=username]').val(S.user.username);
        $v.find('[name=password]').val('').trigger('focus');
    }

    function afterRelogin() {
        var prev = S.user;
        return api('auth.me', null, 'GET').then(function (d) {
            SESS.expired = false;
            $('body').removeClass('relogin');
            if (d.user && +d.user.id === +prev.id && d.user.role === prev.role && !S.impersonator && !d.impersonator) {
                S.csrf = d.csrf;
                S.user = d.user;
                sessionSync(d.session);
                SESS.lastPing = Date.now();
                $('#loginView, #loginNotice').hide();
                toast('تم تسجيل الدخول. البيانات اللي كنت بتكتبها لسه موجودة، ولو كنت ضغطت حفظ قبل كده اضغطه تاني', 'success');
                return;
            }
            $('#modal').modal('hide');
            return boot();
        });
    }

    $('#btnKeepSession').on('click', function () { checkSession(true); });
    // التفاعل الفعلي مع الصفحة (ضغط، كتابة، لمس، تمرير) نشاط يمدد الجلسة، بحد أقصى طلب كل دقيقة
    $(document).on('mousedown keydown touchstart wheel', function () {
        if (!S.user || SESS.expired) return;
        SESS.lastInput = Date.now();
        if (Date.now() - SESS.lastPing > pingEvery() || $('#sessionWarn').is(':visible')) {
            SESS.lastPing = Date.now();
            checkSession(true);
        }
    });
    $(document).on('visibilitychange', function () { if (!document.hidden && S.user && !SESS.expired) checkSession(false); });

    // ------------------------------------------------------------ تحديث تلقائي بين الأجهزة والتبويبات
    // كل 5 ثواني والصفحة ظاهرة: طلب خفيف بيرجع رقم إصدار البيانات بس. لو اتغير، نحدّث الجدول أو لوحة المتابعة
    // وتفاصيل السند المفتوحة من السيرفر. طلبات خلفية مابتمددش الجلسة، ومفيش طلبين في نفس الوقت.
    var SYNC = { v: null, busy: false };

    function syncVersion() {
        return api('sync.version', null, 'GET', true).then(function (d) { return d.v; });
    }

    function syncOpenHandover() {
        var $m = $('#modal'), hid = $m.data('handover');
        if (!hid || !$m.hasClass('in')) return $.when();
        return api('handovers.get', { id: hid }, 'GET', true).then(function (h) {
            if ($m.data('handover') !== hid || !$m.hasClass('in') || $m.data('hfp') === handoverPrint(h)) return;
            var top = $m.scrollTop(), open = $m.find('.scan-history').prop('open');
            handoverDialog(h);
            $m.find('.scan-history').prop('open', !!open);
            $m.scrollTop(top);
        });
    }

    function syncApply() {
        var y = window.pageYOffset;
        var page = current && current.sync ? current.sync()
            : (!current && (location.hash || '#dashboard') === '#dashboard' ? views.dashboard(true).then(function () { window.scrollTo(window.pageXOffset, y); }) : $.when());
        return $.when(page, syncOpenHandover());
    }

    function syncCheck() {
        if (!S.user || SESS.expired || SYNC.busy || document.hidden || navigator.onLine === false) return;
        SYNC.busy = true;
        syncVersion().then(function (v) {
            if (SYNC.v === null || v === SYNC.v) { SYNC.v = v; return; }
            return syncApply().then(function () { SYNC.v = v; });
        }).always(function () { SYNC.busy = false; });
    }

    setInterval(syncCheck, 5000);
    $(document).on('visibilitychange', function () { if (!document.hidden) syncCheck(); });
    $(window).on('online focus', syncCheck);
    setInterval(sessionTick, 1000);

    function boot() {
        return api('auth.me', null, 'GET').then(function (d) {
            S.csrf = d.csrf;
            S.meta = d;
            S.user = d.user;
            S.impersonator = d.impersonator;
            SESS.expired = false;
            if (!S.user) {
                $('#loginNotice').text(d.session.message || '').toggle(!!d.session.ended);
                showLogin();
                return;
            }
            sessionSync(d.session);
            SESS.lastPing = Date.now();
            $('body').removeClass('relogin');
            $('#loginNotice, #loginError, #sessionWarn').hide();
            $('#loginView').hide();
            $('#appView').show();
            $('#userName').text(S.user.name + ' — ' + (d.roles[S.user.role] || ''));
            $('.admin-only').toggle(isAdmin());
            $('.edit-only').toggle(!!canEdit());
            // الدخول كمستخدم: شريط دائم بزر العودة، ولا يُطلب تغيير كلمة مرور المستخدم
            $('body').toggleClass('impersonating', !!S.impersonator);
            $('#impBar').toggle(!!S.impersonator);
            $('#impName').text(S.user.name + ' (' + S.user.username + ')');
            $('#btnChangePw').toggle(!S.impersonator);
            SYNC.v = null;
            return $.when(loadLookups(), syncVersion().then(function (v) { SYNC.v = v; }, function () { return $.when(); })).then(function () {
                route();
                if (+S.user.must_change && !S.impersonator) passwordDialog(true);
            });
        });
    }

    $('#loginForm').on('submit', function (e) {
        e.preventDefault();
        $('#loginError').hide();
        var $f = $(this);
        api('auth.login', formData($f)).then(function () {
            $f.find('[name=password]').val('');
            return SESS.expired && S.user ? afterRelogin() : boot();
        }, function (msg) { $('#loginError').text(msg).show(); });
    });

    $('#btnLogout').on('click', function () { api('auth.logout', {}).then(function () { location.hash = ''; location.reload(); }); });
    $('#btnStopImp').on('click', function () {
        $(this).prop('disabled', true);
        api('auth.stop_impersonation', {}).then(function () { location.hash = 'users'; location.reload(); }, function () { $('#btnStopImp').prop('disabled', false); });
    });
    $('#btnChangePw').on('click', function () { passwordDialog(false); });
    $('#sidebarToggle').on('click', function () { $('body').toggleClass('sidebar-open'); });
    $(window).on('hashchange', function () { if (S.user) { $('body').removeClass('sidebar-open'); route(); } });

    boot();
})(jQuery);
