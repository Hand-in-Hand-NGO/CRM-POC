/* نسخة تجريبية: بديل api.php يعمل داخل المتصفح ويحفظ البيانات في localStorage */
(function ($) {
    'use strict';
    var KEY = 'custody-demo-v1';
    var STATUSES = ['متاحة', 'مسلمة', 'صيانة', 'تالفة', 'مفقودة', 'مكهنة'];
    var CONDITIONS = ['جديد', 'جيد', 'مستعمل', 'يحتاج صيانة', 'تالف'];
    var ROLES = { admin: 'مدير النظام', editor: 'مسؤول عهد', viewer: 'مشاهدة فقط' };
    var TERMS_OUT = 'أقر أنا الموقع أدناه بأنني استلمت العهدة الموضحة بهذا السند بحالة جيدة وصالحة للاستخدام، وأتعهد بالمحافظة عليها واستخدامها في أغراض العمل فقط، وعدم التصرف فيها بالبيع أو الإعارة، وردها عند طلبها أو عند انتهاء علاقتي بالعمل، وأتحمل قيمتها في حالة فقدها أو تلفها نتيجة الإهمال.';
    var TERMS_IN = 'تم استلام العهدة الموضحة بهذا السند من الموظف بالحالة المذكورة قرين كل صنف.';

    function pad(n, l) { n = String(n); while (n.length < l) n = '0' + n; return n; }
    function today(offset) { var d = new Date(Date.now() + (offset || 0) * 864e5); return d.getFullYear() + '-' + pad(d.getMonth() + 1, 2) + '-' + pad(d.getDate(), 2); }
    function now() { var d = new Date(); return today() + ' ' + pad(d.getHours(), 2) + ':' + pad(d.getMinutes(), 2) + ':' + pad(d.getSeconds(), 2); }
    function token() { var s = ''; for (var i = 0; i < 40; i++) s += '0123456789abcdef'[Math.floor(Math.random() * 16)]; return s; }

    function fakeSignature(name) {
        var c = document.createElement('canvas'); c.width = 260; c.height = 100;
        var x = c.getContext('2d'); x.strokeStyle = '#1a3d8f'; x.lineWidth = 2.2; x.lineCap = 'round'; x.beginPath();
        var seed = name.length;
        x.moveTo(20, 60);
        for (var i = 1; i < 22; i++) x.lineTo(20 + i * 10, 50 + Math.sin(i * 0.9 + seed) * 25 + Math.cos(i * 1.7) * 8);
        x.stroke();
        return c.toDataURL('image/png');
    }

    // ------------------------------------------------------------ seed data
    function seed() {
        var db = { seq: {}, users: [], employees: [], categories: [], items: [], handovers: [], custody: [], log: [] };
        db.users.push({ id: 1, username: 'admin', name: 'مدير النظام', role: 'admin', active: 1, must_change: 0, last_login: now(), created_at: now(), password: 'admin123' });
        db.users.push({ id: 2, username: 'store', name: 'مسؤول المخزن', role: 'editor', active: 1, must_change: 0, last_login: null, created_at: now(), password: 'store1234' });
        db.seq.users = 2;
        ['لاب توب', 'كمبيوتر مكتبي', 'شاشة', 'موبايل', 'شريحة اتصال', 'تابلت', 'طابعة', 'سيارة', 'أدوات وعدد', 'أثاث', 'مفاتيح', 'أخرى'].forEach(function (n, i) { db.categories.push({ id: i + 1, name: n }); });
        db.seq.categories = 12;
        [['E001', 'أحمد محمد عبد الله', 'الهندسة', 'مهندس تركيب', 'القاهرة', '01012345678'],
         ['E002', 'منى علي حسن', 'المصنع', 'فني تصنيع', 'القاهرة', '01123456789'],
         ['E003', 'كريم حسن مصطفى', 'خدمة العملاء', 'مسؤول كول سنتر', 'القاهرة', '01234567890'],
         ['E004', 'سارة إبراهيم', 'الزيارات', 'أخصائي زيارات', 'الجيزة', '01098765432'],
         ['E005', 'محمود السيد', 'الصيانة', 'فني صيانة', 'الإسكندرية', '01512345678'],
         ['E006', 'ياسمين خالد', 'الاستقبال', 'موظف استقبال', 'القاهرة', '01011122233'],
         ['E007', 'عمرو فتحي', 'الإدارة', 'مدير إداري', 'القاهرة', '01222333444']
        ].forEach(function (e, i) {
            db.employees.push({ id: i + 1, code: e[0], name: e[1], national_id: '2' + pad(90010112345 + i * 7, 13).slice(0, 13), department: e[2], job_title: e[3], branch: e[4], phone: e[5], email: '', active: 1, notes: '', created_at: now() });
        });
        db.seq.employees = 7;
        [[1, 'لاب توب Dell Latitude 5420', 'Dell', '5420', 'DL5420-778', 25000],
         [1, 'لاب توب Lenovo ThinkPad E14', 'Lenovo', 'E14', 'LN-E14-221', 23000],
         [1, 'لاب توب HP ProBook 450', 'HP', '450 G9', 'HP450-993', 21000],
         [4, 'موبايل Samsung A15', 'Samsung', 'A15', '356789012345678', 9000],
         [4, 'موبايل Samsung A25', 'Samsung', 'A25', '356789012399911', 11500],
         [4, 'موبايل Xiaomi Redmi 13', 'Xiaomi', 'Redmi 13', '868123456789012', 7500],
         [5, 'شريحة فودافون', 'Vodafone', '', '01099887766', 0],
         [5, 'شريحة أورانج', 'Orange', '', '01288776655', 0],
         [3, 'شاشة HP 24 بوصة', 'HP', 'P24', 'CN-HP24-55', 5500],
         [6, 'تابلت Lenovo Tab M10', 'Lenovo', 'M10', 'LN-TAB-01', 7000],
         [8, 'سيارة تويوتا هاي إس', 'Toyota', 'Hiace 2022', 'ط ر ب 1234', 950000],
         [9, 'شنطة عدة فنية كاملة', 'Total', '', 'TL-KIT-07', 4200],
         [7, 'طابعة HP LaserJet', 'HP', 'M211', 'HP-M211-31', 8500],
         [2, 'كمبيوتر مكتبي Dell OptiPlex', 'Dell', '7090', 'DO-7090-12', 18000]
        ].forEach(function (it, i) {
            db.items.push({ id: i + 1, code: 'AS-' + pad(i + 1, 5), category_id: it[0], name: it[1], brand: it[2], model: it[3], serial_no: it[4], purchase_date: today(-300 + i * 9),
                value: it[5], item_condition: i < 4 ? 'جديد' : 'جيد', status: 'متاحة', location: 'المخزن الرئيسي', notes: '', created_at: now() });
        });
        db.seq.items = 14;
        db.seq.handovers = 0; db.seq.custody = 0; db.seq.log = 0;
        DB = db;
        var h1 = assign(1, [{ item_id: 1 }, { item_id: 4 }, { item_id: 7 }], today(-40), 'عهدة بداية العمل');
        sign(h1, 'أحمد محمد عبد الله');
        var h2 = assign(5, [{ item_id: 11 }, { item_id: 12 }], today(-25), 'سيارة الصيانة الميدانية');
        sign(h2, 'محمود السيد');
        var h3 = assign(4, [{ item_id: 2 }, { item_id: 5 }, { item_id: 8 }], today(-12), '');
        sign(h3, 'سارة إبراهيم');
        assign(2, [{ item_id: 9 }, { item_id: 14 }], today(-3), '');
        assign(3, [{ item_id: 6 }], today(-1), '');
        var r = doReturn([{ custody_id: DB.custody.filter(function (c) { return c.item_id === 5; })[0].id, condition: 'يحتاج صيانة', status: 'صيانة', notes: 'الشاشة مكسورة' }], today(-2), '');
        sign(r, 'سارة إبراهيم');
        DB.log = DB.log.slice(0, 0);
        log('إنشاء البيانات التجريبية', null, null, '');
        save();
    }

    var DB = null;
    function load() { try { DB = JSON.parse(localStorage.getItem(KEY)); } catch (e) { DB = null; } if (!DB) seed(); }
    function save() { try { localStorage.setItem(KEY, JSON.stringify(DB)); } catch (e) { /* التخزين غير متاح: تبقى البيانات في الذاكرة */ } }
    function nextId(t) { DB.seq[t] = (DB.seq[t] || 0) + 1; return DB.seq[t]; }
    function byId(t, id) { id = +id; for (var i = 0; i < DB[t].length; i++) if (DB[t][i].id === id) return DB[t][i]; return null; }
    function log(action, entity, id, details) { DB.log.unshift({ id: nextId('log'), user_id: 1, action: action, entity: entity, entity_id: id, details: details, created_at: now() }); }
    function fail(msg, code) { var e = new Error(msg); e.code = code || 400; throw e; }
    function str(v, max) { return String(v === undefined || v === null ? '' : v).trim().slice(0, max || 190); }
    function has(s, q) { return String(s || '').toLowerCase().indexOf(q.toLowerCase()) >= 0; }
    function copy(o) { return JSON.parse(JSON.stringify(o)); }
    function catName(id) { var c = byId('categories', id); return c ? c.name : null; }
    function docNo(type, id, date) { return (type === 'out' ? 'TS' : 'RT') + '-' + date.slice(0, 4) + '-' + pad(id, 5); }
    function signUrl(t) { return 'sign.php?t=' + t; }

    // ------------------------------------------------------------ operations
    function createHandover(type, empId, date, notes) {
        var id = nextId('handovers');
        DB.handovers.push({ id: id, doc_no: docNo(type, id, date), type: type, employee_id: +empId, doc_date: date, notes: notes || '', created_by: 1, created_at: now(), token: token(),
            ack_at: null, ack_name: null, ack_ip: null, ack_agent: null, ack_signature: null });
        return id;
    }

    function assign(empId, lines, date, notes) {
        var emp = byId('employees', empId);
        if (!emp) fail('اختر الموظف');
        if (!+emp.active) fail('هذا الموظف موقوف');
        if (!lines.length) fail('اختر صنفًا واحدًا على الأقل');
        lines.forEach(function (l) {
            var it = byId('items', l.item_id);
            if (!it) fail('صنف غير موجود');
            if (it.status !== 'متاحة') fail('الصنف ' + it.code + ' - ' + it.name + ' حالته (' + it.status + ') ولا يمكن تسليمه');
        });
        var hid = createHandover('out', emp.id, date, notes), seen = {};
        lines.forEach(function (l) {
            if (seen[l.item_id]) return; seen[l.item_id] = 1;
            var it = byId('items', l.item_id);
            var cond = CONDITIONS.indexOf(l.condition) >= 0 ? l.condition : it.item_condition;
            DB.custody.push({ id: nextId('custody'), item_id: it.id, employee_id: emp.id, out_handover_id: hid, in_handover_id: null, assigned_at: date, condition_out: cond,
                notes_out: str(l.notes, 500), returned_at: null, condition_in: null, notes_in: null });
            it.status = 'مسلمة'; it.item_condition = cond;
        });
        log('تسليم عهدة', 'handover', hid, emp.name + ' - ' + Object.keys(seen).length + ' صنف');
        return hid;
    }

    function doReturn(lines, date, notes) {
        if (!lines.length) fail('اختر صنفًا واحدًا على الأقل');
        var empId = null, rows = [];
        lines.forEach(function (l) {
            var c = byId('custody', l.custody_id);
            if (!c || c.in_handover_id) fail('أحد الأصناف تم ارتجاعه بالفعل، حدّث الصفحة');
            if (empId !== null && empId !== c.employee_id) fail('سند الارتجاع يجب أن يكون لموظف واحد');
            if (date < c.assigned_at) fail('تاريخ الارتجاع قبل تاريخ التسليم');
            empId = c.employee_id; rows.push([c, l]);
        });
        var hid = createHandover('in', empId, date, notes);
        rows.forEach(function (r) {
            var c = r[0], l = r[1];
            var cond = CONDITIONS.indexOf(l.condition) >= 0 ? l.condition : 'جيد';
            var st = (STATUSES.indexOf(l.status) >= 0 && l.status !== 'مسلمة') ? l.status : 'متاحة';
            c.in_handover_id = hid; c.returned_at = date; c.condition_in = cond; c.notes_in = str(l.notes, 500);
            var it = byId('items', c.item_id); it.status = st; it.item_condition = cond;
        });
        log('ارتجاع عهدة', 'handover', hid, byId('employees', empId).name + ' - ' + rows.length + ' صنف');
        return hid;
    }

    function sign(hid, name, sig) {
        var h = byId('handovers', hid);
        h.ack_at = now(); h.ack_name = name; h.ack_ip = '192.168.1.' + (20 + hid); h.ack_signature = sig || fakeSignature(name);
        log('توقيع الموظف', 'handover', hid, h.doc_no + ' - ' + name);
    }

    function handoverItems(h) {
        var col = h.type === 'out' ? 'out_handover_id' : 'in_handover_id';
        return DB.custody.filter(function (c) { return c[col] === h.id; }).map(function (c) {
            var it = byId('items', c.item_id);
            return $.extend({}, c, { code: it.code, name: it.name, brand: it.brand, model: it.model, serial_no: it.serial_no, value: it.value, category: catName(it.category_id) });
        });
    }

    function handoverView(id, withSig) {
        var h = byId('handovers', id); if (!h) fail('السند غير موجود', 404);
        var e = byId('employees', h.employee_id);
        var v = $.extend({}, h, { employee_name: e.name, employee_code: e.code, department: e.department, job_title: e.job_title, phone: e.phone, national_id: e.national_id,
            created_by_name: (byId('users', h.created_by) || {}).name, items: handoverItems(h), sign_url: signUrl(h.token), has_signature: !!h.ack_signature });
        if (!withSig) delete v.ack_signature;
        return v;
    }

    function custodyRows(p) {
        var state = p.state || 'active', q = str(p.q);
        return DB.custody.slice().reverse().map(function (c) {
            var it = byId('items', c.item_id), e = byId('employees', c.employee_id), ho = byId('handovers', c.out_handover_id), hi = c.in_handover_id ? byId('handovers', c.in_handover_id) : null;
            return $.extend({}, c, { code: it.code, item_name: it.name, serial_no: it.serial_no, brand: it.brand, model: it.model, value: it.value, category: catName(it.category_id), category_id: it.category_id,
                employee_name: e.name, employee_code: e.code, department: e.department, out_doc_no: ho.doc_no, out_ack_at: ho.ack_at, out_token: ho.token,
                in_doc_no: hi ? hi.doc_no : null, in_ack_at: hi ? hi.ack_at : null });
        }).filter(function (r) {
            if (state === 'active' && r.in_handover_id) return false;
            if (state === 'returned' && !r.in_handover_id) return false;
            if (p.employee_id && r.employee_id !== +p.employee_id) return false;
            if (p.department && r.department !== p.department) return false;
            if (p.category_id && r.category_id !== +p.category_id) return false;
            if (p.ack === 'signed' && !r.out_ack_at) return false;
            if (p.ack === 'pending' && r.out_ack_at) return false;
            if (p.from && r.assigned_at < p.from) return false;
            if (p.to && r.assigned_at > p.to) return false;
            if (q && ![r.item_name, r.code, r.serial_no, r.employee_name, r.employee_code, r.out_doc_no].some(function (v) { return has(v, q); })) return false;
            return true;
        });
    }

    function activeOf(empId) { return DB.custody.filter(function (c) { return c.employee_id === empId && !c.in_handover_id; }); }

    function employeeRows(p) {
        var q = str(p.q), a = p.active === undefined ? '1' : p.active;
        return DB.employees.filter(function (e) {
            if (q && ![e.name, e.code, e.national_id, e.phone].some(function (v) { return has(v, q); })) return false;
            if (p.department && e.department !== p.department) return false;
            if ((a === '1' || a === '0') && +e.active !== +a) return false;
            return true;
        }).map(function (e) {
            var act = activeOf(e.id);
            return $.extend({}, e, { active_count: act.length, active_value: act.reduce(function (s, c) { return s + (+byId('items', c.item_id).value || 0); }, 0) });
        }).sort(function (a, b) { return a.name.localeCompare(b.name, 'ar'); });
    }

    function itemRows(p) {
        var q = str(p.q);
        return DB.items.slice().reverse().filter(function (i) {
            if (q && ![i.name, i.code, i.serial_no, i.brand, i.model].some(function (v) { return has(v, q); })) return false;
            if (p.category_id && i.category_id !== +p.category_id) return false;
            if (p.status && i.status !== p.status) return false;
            return true;
        }).map(function (i) {
            var c = DB.custody.filter(function (x) { return x.item_id === i.id && !x.in_handover_id; })[0], e = c ? byId('employees', c.employee_id) : null;
            return $.extend({}, i, { category: catName(i.category_id), holder_id: e ? e.id : null, holder_name: e ? e.name : null, holder_department: e ? e.department : null, assigned_at: c ? c.assigned_at : null });
        });
    }

    function distinct(list, key) {
        var o = {}; list.forEach(function (x) { if (x[key]) o[x[key]] = 1; });
        return Object.keys(o).sort(function (a, b) { return a.localeCompare(b, 'ar'); });
    }

    function csv(name, headers, rows) {
        var esc = function (v) { v = v === null || v === undefined ? '' : String(v); return /[",\n]/.test(v) ? '"' + v.replace(/"/g, '""') + '"' : v; };
        var text = '﻿' + [headers].concat(rows).map(function (r) { return r.map(esc).join(','); }).join('\r\n');
        var a = document.createElement('a');
        a.href = URL.createObjectURL(new Blob([text], { type: 'text/csv;charset=utf-8' }));
        a.download = name; document.body.appendChild(a); a.click(); a.remove();
    }

    // ------------------------------------------------------------ actions
    var A = {};
    A['auth.me'] = function () {
        return { user: { id: 1, username: 'admin', name: 'مدير النظام', role: 'admin', must_change: 0 }, csrf: 'demo', app_name: 'العهد الإلكترونية', org_name: 'Hand in Hand',
            statuses: STATUSES, conditions: CONDITIONS, roles: ROLES, today: today() };
    };
    A['auth.login'] = function () { return { ok: true }; };
    A['auth.logout'] = function () { return { ok: true }; };
    A['auth.change_password'] = function (p) { if (String(p.new_password || '').length < 8) fail('كلمة المرور الجديدة يجب ألا تقل عن 8 أحرف'); return { ok: true }; };

    A.dashboard = function () {
        var by = {}; DB.items.forEach(function (i) { by[i.status] = (by[i.status] || 0) + 1; });
        var active = DB.custody.filter(function (c) { return !c.in_handover_id; });
        var cats = {}; DB.items.forEach(function (i) { var n = catName(i.category_id) || 'بدون تصنيف'; cats[n] = cats[n] || { name: n, total: 0, assigned: 0 }; cats[n].total++; if (i.status === 'مسلمة') cats[n].assigned++; });
        var deps = {}; active.forEach(function (c) { var e = byId('employees', c.employee_id), n = e.department || 'بدون قسم'; deps[n] = deps[n] || { name: n, n: 0, value: 0 }; deps[n].n++; deps[n].value += +byId('items', c.item_id).value || 0; });
        var srt = function (k) { return function (a, b) { return b[k] - a[k]; }; };
        return {
            items_total: DB.items.length, by_status: by,
            active_value: active.reduce(function (s, c) { return s + (+byId('items', c.item_id).value || 0); }, 0),
            employees_with_custody: distinct(active, 'employee_id').length,
            pending_ack: DB.handovers.filter(function (h) { return h.type === 'out' && !h.ack_at; }).length,
            by_category: Object.keys(cats).map(function (k) { return cats[k]; }).sort(srt('total')),
            by_department: Object.keys(deps).map(function (k) { return deps[k]; }).sort(srt('n')),
            recent: DB.handovers.slice().reverse().slice(0, 10).map(function (h) {
                return { id: h.id, doc_no: h.doc_no, type: h.type, doc_date: h.doc_date, ack_at: h.ack_at, employee_name: byId('employees', h.employee_id).name, items_count: handoverItems(h).length };
            })
        };
    };

    A.lookups = function () {
        return {
            categories: DB.categories.map(function (c) { return $.extend({}, c, { items_count: DB.items.filter(function (i) { return i.category_id === c.id; }).length }); })
                .sort(function (a, b) { return a.name.localeCompare(b.name, 'ar'); }),
            departments: distinct(DB.employees, 'department'), branches: distinct(DB.employees, 'branch'), locations: distinct(DB.items, 'location')
        };
    };
    A['categories.save'] = function (p) {
        var name = str(p.name), id = +p.id || 0;
        if (!name) fail('اسم التصنيف مطلوب');
        if (DB.categories.some(function (c) { return c.name === name && c.id !== id; })) fail('التصنيف موجود بالفعل');
        if (id) byId('categories', id).name = name; else { id = nextId('categories'); DB.categories.push({ id: id, name: name }); }
        log('حفظ تصنيف', 'category', id, name); return { id: id };
    };
    A['categories.delete'] = function (p) {
        if (DB.items.some(function (i) { return i.category_id === +p.id; })) fail('لا يمكن حذف تصنيف مرتبط بأصناف');
        DB.categories = DB.categories.filter(function (c) { return c.id !== +p.id; }); log('حذف تصنيف', 'category', +p.id); return { ok: true };
    };

    A['employees.list'] = employeeRows;
    A['employees.get'] = function (p) {
        var e = byId('employees', p.id); if (!e) fail('الموظف غير موجود', 404);
        var rows = custodyRows({ employee_id: e.id, state: 'all' }).sort(function (a, b) { return (!!a.in_handover_id - !!b.in_handover_id) || b.id - a.id; });
        return { employee: copy(e), custody: rows, handovers: DB.handovers.filter(function (h) { return h.employee_id === e.id; }).reverse().map(function (h) { return { id: h.id, doc_no: h.doc_no, type: h.type, doc_date: h.doc_date, ack_at: h.ack_at }; }) };
    };
    A['employees.save'] = function (p) {
        var id = +p.id || 0;
        var row = { code: str(p.code, 64), name: str(p.name), national_id: str(p.national_id, 32), department: str(p.department), job_title: str(p.job_title), branch: str(p.branch),
            phone: str(p.phone, 32), email: str(p.email), active: p.active === undefined ? 1 : (+p.active ? 1 : 0), notes: str(p.notes, 2000) };
        if (!row.name) fail('اسم الموظف مطلوب');
        if (row.code && DB.employees.some(function (e) { return e.code === row.code && e.id !== id; })) fail('كود الموظف مستخدم لموظف آخر');
        if (id && !row.active && activeOf(id).length) fail('لا يمكن إيقاف موظف لديه عهدة قائمة، قم بارتجاع العهدة أولًا');
        if (id) { $.extend(byId('employees', id), row); log('تعديل موظف', 'employee', id, row.name); }
        else { id = nextId('employees'); DB.employees.push($.extend({ id: id, created_at: now() }, row)); log('إضافة موظف', 'employee', id, row.name); }
        return { id: id };
    };
    A['employees.delete'] = function (p) {
        if (DB.handovers.some(function (h) { return h.employee_id === +p.id; })) fail('لا يمكن حذف موظف له سجل عهد، يمكنك إيقافه بدلًا من ذلك');
        DB.employees = DB.employees.filter(function (e) { return e.id !== +p.id; }); log('حذف موظف', 'employee', +p.id); return { ok: true };
    };

    A['items.list'] = itemRows;
    A['items.get'] = function (p) {
        var i = byId('items', p.id); if (!i) fail('الصنف غير موجود', 404);
        return {
            item: $.extend({}, i, { category: catName(i.category_id) }),
            history: DB.custody.filter(function (c) { return c.item_id === i.id; }).reverse().map(function (c) {
                var e = byId('employees', c.employee_id);
                return $.extend({}, c, { employee_name: e.name, department: e.department, out_doc_no: byId('handovers', c.out_handover_id).doc_no, in_doc_no: c.in_handover_id ? byId('handovers', c.in_handover_id).doc_no : null });
            })
        };
    };
    A['items.save'] = function (p) {
        var id = +p.id || 0, old = id ? byId('items', id) : null;
        if (id && !old) fail('الصنف غير موجود', 404);
        var row = { code: str(p.code, 64), category_id: p.category_id ? +p.category_id : null, name: str(p.name), brand: str(p.brand), model: str(p.model), serial_no: str(p.serial_no),
            purchase_date: str(p.purchase_date, 10) || null, value: p.value === '' || p.value === undefined || p.value === null ? null : Math.round(+p.value * 100) / 100,
            item_condition: str(p.item_condition, 32) || 'جيد', location: str(p.location), notes: str(p.notes, 2000) };
        if (!row.name) fail('اسم الصنف مطلوب');
        var st = str(p.status, 32);
        if (old && old.status === 'مسلمة') st = 'مسلمة';
        else if (st === 'مسلمة' || STATUSES.indexOf(st) < 0) st = old ? old.status : 'متاحة';
        row.status = st;
        if (row.code && DB.items.some(function (i) { return i.code === row.code && i.id !== id; })) fail('كود الأصل مستخدم لصنف آخر');
        var dup = row.serial_no && DB.items.filter(function (i) { return i.serial_no === row.serial_no && i.id !== id; })[0];
        if (dup) fail('الرقم التسلسلي مسجل بالفعل للصنف ' + dup.code);
        if (id) { if (!row.code) row.code = old.code; $.extend(old, row); log('تعديل صنف', 'item', id, row.code + ' ' + row.name); }
        else { id = nextId('items'); if (!row.code) row.code = 'AS-' + pad(id, 5); DB.items.push($.extend({ id: id, created_at: now() }, row)); log('إضافة صنف', 'item', id, row.code + ' ' + row.name); }
        return { id: id, code: row.code };
    };
    A['items.delete'] = function (p) {
        if (DB.custody.some(function (c) { return c.item_id === +p.id; })) fail('لا يمكن حذف صنف له سجل تسليم، يمكنك تغيير حالته إلى مكهنة');
        DB.items = DB.items.filter(function (i) { return i.id !== +p.id; }); log('حذف صنف', 'item', +p.id); return { ok: true };
    };

    A['custody.list'] = custodyRows;
    A['custody.assign'] = function (p) { return handoverView(assign(+p.employee_id, p.lines || [], p.date || today(), str(p.notes, 1000))); };
    A['custody.return'] = function (p) { return handoverView(doReturn(p.lines || [], p.date || today(), str(p.notes, 1000))); };
    A['custody.transfer'] = function (p) {
        var lines = p.lines || [], date = p.date || today(), notes = ('نقل عهدة. ' + str(p.notes, 1000)).trim();
        if (!lines.length) fail('اختر صنفًا واحدًا على الأقل');
        var from = (byId('custody', lines[0].custody_id) || {}).employee_id;
        if (+p.to_employee_id === from) fail('لا يمكن النقل لنفس الموظف');
        var to = byId('employees', p.to_employee_id); if (!to || !+to.active) fail('اختر الموظف المستلم');
        var rid = doReturn(lines, date, notes);
        var aid = assign(to.id, lines.map(function (l) { return { item_id: byId('custody', l.custody_id).item_id, condition: l.condition, notes: l.notes }; }), date, notes);
        return { 'return': handoverView(rid), assign: handoverView(aid) };
    };

    A['handovers.list'] = function (p) {
        var q = str(p.q);
        return DB.handovers.slice().reverse().filter(function (h) {
            var e = byId('employees', h.employee_id);
            if ((p.type === 'out' || p.type === 'in') && h.type !== p.type) return false;
            if (p.ack === 'signed' && !h.ack_at) return false;
            if (p.ack === 'pending' && h.ack_at) return false;
            if (p.from && h.doc_date < p.from) return false;
            if (p.to && h.doc_date > p.to) return false;
            if (q && !has(h.doc_no, q) && !has(e.name, q)) return false;
            return true;
        }).map(function (h) {
            var e = byId('employees', h.employee_id);
            return { id: h.id, doc_no: h.doc_no, type: h.type, doc_date: h.doc_date, notes: h.notes, ack_at: h.ack_at, ack_name: h.ack_name, token: h.token, created_at: h.created_at,
                employee_name: e.name, department: e.department, created_by_name: (byId('users', h.created_by) || {}).name, items_count: handoverItems(h).length };
        });
    };
    A['handovers.get'] = function (p) { return handoverView(+p.id); };
    A['handovers.renew_link'] = function (p) {
        var h = byId('handovers', p.id); if (h.ack_at) fail('السند موقّع بالفعل');
        h.token = token(); log('تجديد رابط التوقيع', 'handover', h.id, h.doc_no); return handoverView(h.id);
    };

    A['users.list'] = function () { return DB.users.map(function (u) { var c = copy(u); delete c.password; return c; }); };
    A['users.save'] = function (p) {
        var id = +p.id || 0;
        var row = { username: str(p.username, 64), name: str(p.name), role: str(p.role, 16), active: +p.active ? 1 : 0 };
        if (!row.username || !row.name) fail('اسم المستخدم والاسم مطلوبان');
        if (!/^[A-Za-z0-9._-]{3,64}$/.test(row.username)) fail('اسم المستخدم بالإنجليزية فقط (حروف وأرقام . _ -)');
        if (!ROLES[row.role]) fail('الصلاحية غير صحيحة');
        if (DB.users.some(function (u) { return u.username === row.username && u.id !== id; })) fail('اسم المستخدم مستخدم بالفعل');
        if (id === 1 && (row.role !== 'admin' || !row.active)) fail('لا يمكنك إيقاف حسابك أو تغيير صلاحيتك');
        if (p.password) { if (String(p.password).length < 8) fail('كلمة المرور يجب ألا تقل عن 8 أحرف'); row.must_change = 1; }
        else if (!id) fail('كلمة المرور مطلوبة للمستخدم الجديد');
        if (id) $.extend(byId('users', id), row); else { id = nextId('users'); DB.users.push($.extend({ id: id, created_at: now(), last_login: null }, row)); }
        log('حفظ مستخدم', 'user', id, row.username); return { id: id };
    };
    A['log.list'] = function () { return DB.log.slice(0, 500).map(function (l) { return $.extend({}, l, { user_name: l.user_id ? 'مدير النظام' : null }); }); };

    A.export = function (p) {
        if (p.type === 'custody') {
            csv('custody-' + today() + '.csv', ['رقم سند التسليم', 'كود الموظف', 'الموظف', 'القسم', 'كود الأصل', 'التصنيف', 'الصنف', 'الرقم التسلسلي', 'القيمة', 'تاريخ التسليم', 'الحالة عند التسليم', 'توقيع الموظف', 'تاريخ الارتجاع', 'الحالة عند الارتجاع', 'رقم سند الارتجاع'],
                custodyRows(p).map(function (r) { return [r.out_doc_no, r.employee_code, r.employee_name, r.department, r.code, r.category, r.item_name, r.serial_no, r.value, r.assigned_at, r.condition_out, r.out_ack_at ? 'موقّع' : 'بانتظار التوقيع', r.returned_at, r.condition_in, r.in_doc_no]; }));
        } else if (p.type === 'items') {
            csv('items-' + today() + '.csv', ['كود الأصل', 'التصنيف', 'الصنف', 'الماركة', 'الموديل', 'الرقم التسلسلي', 'تاريخ الشراء', 'القيمة', 'الحالة الفنية', 'الوضع', 'في عهدة', 'المكان', 'ملاحظات'],
                itemRows(p).map(function (r) { return [r.code, r.category, r.name, r.brand, r.model, r.serial_no, r.purchase_date, r.value, r.item_condition, r.status, r.holder_name, r.location, r.notes]; }));
        } else {
            csv('employees-' + today() + '.csv', ['الكود', 'الاسم', 'الرقم القومي', 'القسم', 'الوظيفة', 'الفرع', 'الموبايل', 'البريد', 'الحالة', 'عدد أصناف العهدة', 'قيمة العهدة'],
                employeeRows(p).map(function (r) { return [r.code, r.name, r.national_id, r.department, r.job_title, r.branch, r.phone, r.email, +r.active ? 'نشط' : 'موقوف', r.active_count, r.active_value]; }));
        }
    };

    // ------------------------------------------------------------ ajax transport for api.php
    function params(url, data) {
        var o = {}, qs = url.split('?')[1] || '';
        qs.split('&').forEach(function (kv) { if (!kv) return; var p = kv.split('='); o[decodeURIComponent(p[0])] = decodeURIComponent((p[1] || '').replace(/\+/g, ' ')); });
        if (typeof data === 'string' && data.charAt(0) === '{') $.extend(o, JSON.parse(data));
        return o;
    }

    function call(action, p) {
        load();
        var fn = A[action]; if (!fn) fail('إجراء غير معروف', 404);
        var r = fn(p);
        save();
        return copy(r === undefined ? null : r);
    }

    $.ajaxTransport('+*', function (opts) {
        if (!/^api\.php/.test(opts.url)) return;
        return {
            send: function (headers, complete) {
                setTimeout(function () {
                    var p = params(opts.url, opts.data);
                    try {
                        var data = call(p.action, p);
                        complete(200, 'OK', { text: JSON.stringify({ ok: true, data: data }) });
                    } catch (e) {
                        if (!e.code) console.error(e);
                        complete(e.code || 500, 'error', { text: JSON.stringify({ ok: false, error: e.code ? e.message : 'خطأ غير متوقع' }) });
                    }
                }, 60);
            },
            abort: function () { }
        };
    });

    // ------------------------------------------------------------ demo hooks used by the patched app.js
    var css = function () { return $('#app-css').text(); };

    function signPageHtml(h, body) {
        return '<div class="sign-wrap"><div class="sign-head"><i class="fa fa-briefcase"></i><div><div class="sign-org">Hand in Hand</div><div class="sign-title">العهد الإلكترونية</div></div></div>' +
            '<div class="panel panel-primary"><div class="panel-heading"><b>' + (h.type === 'out' ? 'سند تسليم عهدة' : 'سند ارتجاع عهدة') + '</b><span class="pull-left">' + h.doc_no + '</span></div><div class="panel-body">' + body + '</div></div></div>';
    }

    window.DEMO = {
        exportCsv: function (url) { var p = params(url); call('export', p); },
        print: function (url) {
            load();
            var p = params(url), w = window.open('', '_blank');
            if (!w) { alert('اسمح بالنوافذ المنبثقة للطباعة'); return; }
            w.document.write('<!doctype html><html lang="ar" dir="rtl"><head><meta charset="utf-8"><title>طباعة</title><style>' + css() + '</style></head><body class="print-page">' + printHtml(p) + '</body></html>');
            w.document.close();
        },
        // صفحة توقيع الموظف داخل نافذة جديدة كما يراها على موبايله
        sign: function (url) {
            load();
            var t = params(url).t, h = DB.handovers.filter(function (x) { return x.token === t; })[0];
            var w = window.open('', '_blank', 'width=430,height=880');
            if (!w) { alert('اسمح بالنوافذ المنبثقة لفتح صفحة التوقيع'); return; }
            var body;
            if (!h) body = '<div class="alert alert-danger">الرابط غير صحيح أو تم تجديده.</div>';
            else {
                var v = handoverView(h.id, true), e = esc;
                body = '<div class="sign-info"><div><span class="info-label">الموظف:</span> <b>' + e(v.employee_name) + '</b></div><div><span class="info-label">القسم:</span> ' + e(v.department || '-') +
                    '</div><div><span class="info-label">التاريخ:</span> <span class="d">' + v.doc_date + '</span></div></div><div class="table-scroll"><table class="table table-bordered table-condensed"><thead><tr><th>#</th><th>كود الأصل</th><th>الصنف</th><th>الرقم التسلسلي</th><th>الحالة</th></tr></thead><tbody>' +
                    v.items.map(function (it, n) { return '<tr><td>' + (n + 1) + '</td><td>' + e(it.code) + '</td><td>' + e(it.name) + '</td><td>' + e(it.serial_no || '-') + '</td><td>' + e(v.type === 'out' ? it.condition_out : it.condition_in) + '</td></tr>'; }).join('') +
                    '</tbody></table></div><div class="sign-terms">' + (v.type === 'out' ? TERMS_OUT : TERMS_IN) + '</div>';
                if (v.ack_at) {
                    body += '<div class="alert alert-success text-center"><i class="fa fa-check-circle fa-2x"></i><br>تم التوقيع بواسطة <b>' + e(v.ack_name) + '</b> بتاريخ <span class="d">' + v.ack_at + '</span></div><div class="text-center"><img class="sig-img" src="' + v.ack_signature + '"></div>';
                } else {
                    body += '<form id="f"><div class="form-group"><label>الاسم بالكامل</label><input class="form-control" id="n" value="' + e(v.employee_name) + '"></div>' +
                        '<div class="form-group"><label>التوقيع <small class="info-label">(ارسم بإصبعك أو الماوس)</small></label><div class="sig-box"><canvas id="c"></canvas></div>' +
                        '<button type="button" class="btn btn-default btn-sm btn-action" id="clr">مسح التوقيع</button></div>' +
                        '<div class="checkbox"><label><input type="checkbox" id="ag"> أوافق على ما جاء بالإقرار أعلاه</label></div>' +
                        '<button class="btn btn-success btn-lg btn-block btn-action" type="submit"><i class="fa fa-pencil"></i> توقيع واعتماد</button></form>';
                }
            }
            w.document.write('<!doctype html><html lang="ar" dir="rtl"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>توقيع سند العهدة</title><style>' + css() + '</style></head><body class="sign-page">' +
                (h ? signPageHtml(h, body) : '<div class="sign-wrap">' + body + '</div>') + '</body></html>');
            w.document.close();
            if (!h || h.ack_at) return;
            var d = w.document, c = d.getElementById('c'), x = c.getContext('2d'), drawing = false, drawn = false, last;
            var r = w.devicePixelRatio || 1; c.width = c.offsetWidth * r; c.height = c.offsetHeight * r; x.setTransform(r, 0, 0, r, 0, 0);
            x.lineWidth = 2.2; x.lineCap = 'round'; x.strokeStyle = '#1a3d8f';
            var pos = function (ev) { var b = c.getBoundingClientRect(); return { x: ev.clientX - b.left, y: ev.clientY - b.top }; };
            c.addEventListener('pointerdown', function (ev) { drawing = true; drawn = true; last = pos(ev); c.setPointerCapture(ev.pointerId); });
            c.addEventListener('pointermove', function (ev) { if (!drawing) return; var q = pos(ev); x.beginPath(); x.moveTo(last.x, last.y); x.lineTo(q.x, q.y); x.stroke(); last = q; });
            c.addEventListener('pointerup', function () { drawing = false; });
            d.getElementById('clr').onclick = function () { x.clearRect(0, 0, c.width, c.height); drawn = false; };
            d.getElementById('f').onsubmit = function (ev) {
                ev.preventDefault();
                var name = d.getElementById('n').value.trim();
                if (!d.getElementById('ag').checked) { w.alert('يجب الموافقة على الإقرار'); return; }
                if (!name) { w.alert('اكتب اسمك بالكامل'); return; }
                if (!drawn) { w.alert('من فضلك ارسم توقيعك في المربع'); return; }
                load(); sign(h.id, name, c.toDataURL('image/png')); save();
                DEMO.sign(url); w.close();
                $(window).trigger('hashchange');
            };
        },
        reset: function () { try { localStorage.removeItem(KEY); } catch (e) { } seed(); location.hash = ''; location.reload(); }
    };

    function esc(s) { return String(s === null || s === undefined ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;'); }
    function money2(v) { return Number(v || 0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 }); }

    function printHtml(p) {
        var e = esc, h = null, emp, items, title;
        if (p.h) { h = handoverView(+p.h, true); emp = byId('employees', h.employee_id); items = h.items; title = h.type === 'out' ? 'سند تسليم عهدة' : 'سند ارتجاع عهدة'; }
        else {
            emp = byId('employees', p.emp);
            items = activeOf(emp.id).map(function (c) { var it = byId('items', c.item_id), ho = byId('handovers', c.out_handover_id); return $.extend({}, c, { code: it.code, name: it.name, serial_no: it.serial_no, value: it.value, category: catName(it.category_id), doc_no: ho.doc_no }); });
            title = items.length ? 'بيان عهدة موظف' : 'شهادة إخلاء طرف من العهد';
        }
        var html = '<div class="print-actions no-print"><button class="btn btn-primary btn-action" onclick="window.print()"><i class="fa fa-print"></i> طباعة</button> <button class="btn btn-default btn-action" onclick="window.close()">إغلاق</button></div><div class="sheet">' +
            '<div class="sheet-head"><div><div class="sheet-org">Hand in Hand</div><div class="info-label">العهد الإلكترونية</div></div><h2>' + title + '</h2><div class="sheet-meta">' +
            (h ? '<div><span class="info-label">رقم السند:</span> <b>' + h.doc_no + '</b></div><div><span class="info-label">التاريخ:</span> <span class="d">' + h.doc_date + '</span></div>' : '<div><span class="info-label">تاريخ الطباعة:</span> <span class="d">' + today() + '</span></div>') +
            '</div></div><table class="table table-bordered sheet-info"><tr><td><span class="info-label">اسم الموظف:</span> <b>' + e(emp.name) + '</b></td><td><span class="info-label">الكود:</span> ' + e(emp.code || '-') +
            '</td><td><span class="info-label">الرقم القومي:</span> ' + e(emp.national_id || '-') + '</td></tr><tr><td><span class="info-label">القسم:</span> ' + e(emp.department || '-') + '</td><td colspan="2"><span class="info-label">الوظيفة:</span> ' + e(emp.job_title || '-') + '</td></tr></table>';
        if (items.length) {
            var total = 0;
            html += '<table class="table table-bordered table-condensed sheet-items"><thead><tr><th>#</th><th>كود الأصل</th><th>التصنيف</th><th>الصنف</th><th>الرقم التسلسلي</th><th>القيمة</th>' +
                (h ? '<th>الحالة</th><th>ملاحظات</th>' : '<th>تاريخ التسليم</th><th>رقم السند</th>') + '</tr></thead><tbody>' +
                items.map(function (it, n) {
                    total += +it.value || 0;
                    return '<tr><td>' + (n + 1) + '</td><td>' + e(it.code) + '</td><td>' + e(it.category || '-') + '</td><td>' + e(it.name) + '</td><td>' + e(it.serial_no || '-') + '</td><td>' + (it.value === null ? '-' : money2(it.value)) + '</td>' +
                        (h ? '<td>' + e(h.type === 'out' ? it.condition_out : it.condition_in) + '</td><td>' + e((h.type === 'out' ? it.notes_out : it.notes_in) || '') + '</td>' : '<td>' + it.assigned_at + '</td><td>' + it.doc_no + '</td>') + '</tr>';
                }).join('') + '</tbody><tfoot><tr><th colspan="5">الإجمالي (' + items.length + ' صنف)</th><th>' + money2(total) + '</th><th colspan="2"></th></tr></tfoot></table>';
        }
        var line = function (lbl, extra) { return '<div><div class="info-label">' + lbl + '</div><div class="sig-line"></div>' + (extra || '') + '</div>'; };
        if (h) {
            html += '<div class="sheet-terms">' + (h.type === 'out' ? TERMS_OUT : TERMS_IN) + '</div>' + (h.notes ? '<p><span class="info-label">ملاحظات:</span> ' + e(h.notes) + '</p>' : '') + '<div class="sheet-signs">' +
                (h.ack_at ? '<div><div class="info-label">' + (h.type === 'out' ? 'المستلم (الموظف)' : 'المسلِّم (الموظف)') + '</div><img class="sig-img" src="' + h.ack_signature + '"><div><b>' + e(h.ack_name) + '</b></div><small class="info-label">وُقّع إلكترونيًا <span class="d">' + h.ack_at + '</span></small></div>'
                    : line(h.type === 'out' ? 'المستلم (الموظف)' : 'المسلِّم (الموظف)', '<div>الاسم: ' + e(emp.name) + '</div>')) +
                line('مسؤول العهد', '<div>' + e(h.created_by_name || '') + '</div>') + line('مدير الإدارة') + '</div>';
        } else if (!items.length) {
            html += '<div class="sheet-terms">نشهد بأن الموظف المذكور أعلاه لا توجد في عهدته أي أصناف أو مهمات حتى تاريخه، وقد أُعطيت له هذه الشهادة بناءً على طلبه.</div><div class="sheet-signs">' + line('مسؤول العهد') + line('مدير الموارد البشرية') + '</div>';
        } else {
            html += '<div class="sheet-signs">' + line('الموظف') + line('مسؤول العهد') + '</div>';
        }
        return html + '</div>';
    }

    load();
})(jQuery);

// روابط صفحة التوقيع تفتح نسخة الديمو بدل sign.php، والتصدير يمر عبر DEMO.go
(function ($) {
    $(document).on('click', 'a[href^="sign.php"]', function (e) { e.preventDefault(); DEMO.sign($(this).attr('href')); });
    Object.defineProperty(window.DEMO, 'go', { set: function (url) { DEMO.exportCsv(url); } });
})(jQuery);
