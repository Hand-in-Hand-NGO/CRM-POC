/* نسخة تجريبية: بديل api.php يعمل داخل المتصفح ويحفظ البيانات في localStorage */
(function ($) {
    'use strict';
    var KEY = 'custody-demo-v4';
    var SESSION_IDLE = 21600, SESSION_WARN = 300;   // نفس session_minutes و session_warn_minutes
    var SCAN_LIMITS = { file_mb: 15, total_mb: 60, files: 20 };
    var TYPES = window.CUSTODY_TYPES;   // نفس custody/types.json، يضمّنه build.py
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
        var db = { seq: {}, users: [], employees: [], items: [], handovers: [], custody: [], log: [] };
        db.users.push({ id: 1, username: 'admin', name: 'مدير النظام', role: 'admin', active: 1, must_change: 0, last_login: now(), created_at: now(), password: 'admin123' });
        db.users.push({ id: 2, username: 'store', name: 'مسؤول المخزن', role: 'editor', active: 1, must_change: 0, last_login: null, created_at: now(), password: 'store1234' });
        db.users.push({ id: 3, username: 'viewer', name: 'مراجع الحسابات', role: 'viewer', active: 1, must_change: 0, last_login: null, created_at: now(), password: 'viewer1234' });
        db.seq.users = 3;
        db.sess = { uid: 1, imp: null, imp_started: null, ended: null };
        db.scans = []; db.seq.scans = 0;
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
        db.seq.items = 0; db.seq.handovers = 0; db.seq.custody = 0; db.seq.log = 0;
        DB = db;
        var L = function (brand, model, sn, cpu, ram, st, size, screen, os, acc, value) {
            return ['laptop', { brand: brand, model: model, serial_no: sn, cpu: cpu, ram: ram, storage_type: st, storage: size, screen: screen, os: os, accessories: acc }, value];
        };
        [L('Dell', 'Latitude 5420', 'DL5420-778', 'Core i5', '16GB', 'SSD', '512GB', '14 بوصة', 'Windows 11 Pro', ['شاحن', 'شنطة', 'ماوس'], 25000),
         L('Lenovo', 'ThinkPad E14', 'LN-E14-221', 'Core i7', '16GB', 'NVMe SSD', '512GB', '14 بوصة', 'Windows 11 Pro', ['شاحن', 'شنطة'], 27000),
         L('HP', 'ProBook 450 G9', 'HP450-993', 'Core i5', '8GB', 'SSD', '256GB', '15.6 بوصة', 'Windows 10 Pro', ['شاحن'], 21000),
         L('Apple', 'MacBook Air', 'C02XK1ABCD', 'Apple M2', '8GB', 'SSD', '256GB', '13.3 بوصة', 'macOS', ['شاحن'], 48000),
         L('Asus', 'VivoBook 15', 'ASV15-3321', 'Ryzen 5', '8GB', 'SSD', '512GB', '15.6 بوصة', 'Windows 11 Home', ['شاحن', 'ماوس'], 19000),
         L('Dell', 'Vostro 3520', 'DV3520-104', 'Core i3', '8GB', 'SSD', '256GB', '15.6 بوصة', 'Windows 11 Home', ['شاحن'], 17500),
         L('Lenovo', 'IdeaPad 3', 'LN-IP3-558', 'Ryzen 5', '8GB', 'SSD', '512GB', '15.6 بوصة', 'Windows 11 Home', ['شاحن', 'شنطة'], 18500),
         L('HP', 'EliteBook 840 G8', 'HP840-3310', 'Core i7', '16GB', 'NVMe SSD', '512GB', '14 بوصة', 'Windows 11 Pro', ['شاحن', 'شنطة', 'دوك ستيشن'], 34000),
         L('Acer', 'Aspire 5', 'AC-A5-7781', 'Core i5', '8GB', 'SSD', '512GB', '15.6 بوصة', 'Windows 11 Home', ['شاحن'], 19500),
         L('Dell', 'Latitude 7430', 'DL7430-221', 'Core i7', '32GB', 'NVMe SSD', '1TB', '14 بوصة', 'Windows 11 Pro', ['شاحن', 'شنطة', 'ماوس', 'سماعة'], 42000),
         L('Lenovo', 'ThinkPad T14', 'LN-T14-090', 'Core i5', '16GB', 'NVMe SSD', '512GB', '14 بوصة', 'Windows 11 Pro', ['شاحن'], 31000),
         L('HP', '250 G9', 'HP250-6621', 'Core i3', '8GB', 'SSD', '256GB', '15.6 بوصة', 'Windows 10 Pro', [], 15000)
        ].forEach(function (x, i) {
            A['items.save']({ type: x[0], specs: x[1], value: x[2] || '', purchase_date: today(-300 + i * 9), item_condition: i % 5 === 0 ? 'جديد' : 'جيد', location: 'المخزن الرئيسي' });
        });
        sign(assign(1, [{ item_id: 1 }], today(-40), 'عهدة بداية العمل'), 'أحمد محمد عبد الله');
        sign(assign(5, [{ item_id: 3 }], today(-25), ''), 'محمود السيد');
        sign(assign(4, [{ item_id: 2 }, { item_id: 6 }], today(-12), 'جهاز تاني للتدريب الميداني'), 'سارة إبراهيم');
        sign(assign(7, [{ item_id: 4 }], today(-8), ''), 'عمرو فتحي');
        assign(2, [{ item_id: 5 }], today(-3), '');
        assign(3, [{ item_id: 10 }], today(-1), '');
        // سند عليه إقرار ورقي موقّع (Scan) بدل التوقيع الإلكتروني
        var h5 = assign(6, [{ item_id: 8 }], today(-6), 'جهاز الاستقبال');
        storeScan(h5, { signed_on: today(-5), notes: 'اتعمل Scan من النسخة الورقية', source: 'images', pages: 1,
            originals: [{ name: 'iqrar-page1.jpg', mime: 'image/jpeg', size: 182000 }] }, samplePdf(byId('handovers', h5)));
        var r = doReturn([{ custody_id: DB.custody.filter(function (c) { return c.item_id === 6; })[0].id, condition: 'يحتاج صيانة', status: 'صيانة', notes: 'الشاشة مكسورة' }], today(-2), '');
        sign(r, 'سارة إبراهيم');
        DB.log = [];
        log('إنشاء البيانات التجريبية', null, null, '');
        save();
    }

    var DB = null;
    function load() { try { DB = JSON.parse(localStorage.getItem(KEY)); } catch (e) { DB = null; } if (!DB) seed(); }
    function save() { try { localStorage.setItem(KEY, JSON.stringify(DB)); } catch (e) { /* التخزين غير متاح: تبقى البيانات في الذاكرة */ } }
    function nextId(t) { DB.seq[t] = (DB.seq[t] || 0) + 1; return DB.seq[t]; }
    function byId(t, id) { id = +id; for (var i = 0; i < DB[t].length; i++) if (DB[t][i].id === id) return DB[t][i]; return null; }
    function log(action, entity, id, details, anon) {
        var s = DB.sess || {};
        DB.log.unshift({ id: nextId('log'), user_id: anon ? null : (s.uid || null), impersonator_id: anon ? null : (s.imp || null), action: action, entity: entity, entity_id: id, details: details, created_at: now() });
    }
    function fail(msg, code) { var e = new Error(msg); e.code = code || 400; throw e; }
    function str(v, max) { return String(v === undefined || v === null ? '' : v).trim().slice(0, max || 190); }
    function has(s, q) { return String(s || '').toLowerCase().indexOf(q.toLowerCase()) >= 0; }
    function copy(o) { return JSON.parse(JSON.stringify(o)); }
    // نفس decorate_item في lib.php
    function decorate(row) {
        var t = TYPES[row.type], specs = $.extend({}, row.specs || {}), refs = {}, short = {};
        ['brand', 'model', 'serial_no'].forEach(function (k) { if (row[k] !== undefined) specs[k] = row[k]; });
        (t ? t.fields : []).forEach(function (f) {
            if (f.short) short[f.key] = f.short;
            if (f.input === 'item_ref') {
                var refId = +(row[f.column] || 0);
                refs[f.key] = refId || null;
                var txt = refId ? linkedText(refId) : '';
                if (txt) specs[f.key] = txt;
            }
        });
        return $.extend({}, row, {
            type_label: t ? t.label : '', specs: specs, refs: refs,
            specs_text: (t ? t.summary : []).map(function (k) {
                var v = $.isArray(specs[k]) ? specs[k].join('، ') : String(specs[k] || '');
                return v ? (short[k] ? short[k] + ': ' + v : v) : '';
            }).filter(Boolean).join(' / '),
            accessories_text: (specs.accessories || []).join('، ')
        });
    }
    // نفس linked_item_text في lib.php: "01012345678 - فودافون (SM-00003)"
    function linkedText(id) {
        var r = byId('items', id);
        return r ? ((r.serial_no || '') + (r.brand ? ' - ' + r.brand : '')).trim() + ' (' + r.code + ')' : '';
    }
    function itemFields(it) { return { code: it.code, type: it.type, name: it.name, brand: it.brand, model: it.model, serial_no: it.serial_no, value: it.value, specs: it.specs, linked_sim_id: it.linked_sim_id || null }; }
    // لتعديل صنف موجود من البيانات التجريبية
    function rawCols(id) { var it = byId('items', id); return { brand: it.brand, model: it.model, serial_no: it.serial_no }; }
    function editable(id) {
        var it = byId('items', id);
        return { id: id, code: it.code, purchase_date: it.purchase_date, value: it.value, item_condition: it.item_condition, status: it.status, location: it.location, notes: it.notes };
    }
    // نفس ack_filter_sql: signed (أي توقيع) / esign / paper / pending
    function ackOk(ackAt, paperScan, ack) {
        if (ack === 'signed') return !!(ackAt || paperScan);
        if (ack === 'esign') return !!ackAt;
        if (ack === 'paper') return !!paperScan;
        if (ack === 'pending') return !ackAt && !paperScan;
        return true;
    }
    function ackText(ackAt, paperOn) {
        if (ackAt && paperOn) return 'موقّع إلكترونيًا وورقيًا';
        return ackAt ? 'موقّع إلكترونيًا' : (paperOn ? 'موقّع ورقيًا' : 'بانتظار التوقيع');
    }
    // نفس serial_heading في lib.php
    function serialHeading(types) {
        var out = [];
        types.forEach(function (t) { (TYPES[t] ? TYPES[t].fields : []).forEach(function (f) { if (f.key === 'serial_no' && out.indexOf(f.label) < 0) out.push(f.label); }); });
        return out.join(' / ') || 'الرقم التسلسلي';
    }
    function userName(id) { return (byId('users', id) || {}).name || null; }
    function docNo(type, id, date) { return (type === 'out' ? 'TS' : 'RT') + '-' + date.slice(0, 4) + '-' + pad(id, 5); }
    function signUrl(t) { return 'sign.php?t=' + t; }

    // ------------------------------------------------------------ operations
    function createHandover(type, empId, date, notes) {
        var id = nextId('handovers');
        DB.handovers.push({ id: id, doc_no: docNo(type, id, date), type: type, employee_id: +empId, doc_date: date, notes: notes || '', created_by: (DB.sess || {}).uid || 1, created_at: now(), token: token(),
            ack_at: null, ack_name: null, ack_ip: null, ack_agent: null, ack_signature: null, paper_scan_id: null, paper_signed_on: null });
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
        log('توقيع الموظف', 'handover', hid, h.doc_no + ' - ' + name, true);
    }

    function handoverItems(h) {
        var col = h.type === 'out' ? 'out_handover_id' : 'in_handover_id';
        return DB.custody.filter(function (c) { return c[col] === h.id; }).map(function (c) {
            return decorate($.extend({}, c, itemFields(byId('items', c.item_id))));
        });
    }

    function handoverView(id, withSig) {
        var h = byId('handovers', id); if (!h) fail('السند غير موجود', 404);
        var e = byId('employees', h.employee_id);
        var v = $.extend({}, h, { employee_name: e.name, employee_code: e.code, department: e.department, job_title: e.job_title, phone: e.phone, national_id: e.national_id,
            created_by_name: userName(h.created_by), items: handoverItems(h), sign_url: signUrl(h.token), has_signature: !!h.ack_signature, scans: scansView(h.id) });
        if (!withSig) delete v.ack_signature;
        return v;
    }

    // نفس handover_scans_view في scans.php
    function scansView(hid) {
        return DB.scans.filter(function (x) { return x.handover_id === hid; }).sort(function (a, b) { return b.version - a.version; }).map(function (x) {
            return $.extend({}, x, { uploaded_by_name: userName(x.uploaded_by) });
        });
    }

    function custodyRows(p) {
        var state = p.state || 'active', q = str(p.q);
        return DB.custody.slice().reverse().map(function (c) {
            var it = byId('items', c.item_id), e = byId('employees', c.employee_id), ho = byId('handovers', c.out_handover_id), hi = c.in_handover_id ? byId('handovers', c.in_handover_id) : null;
            return decorate($.extend({}, c, itemFields(it), { item_name: it.name,
                employee_name: e.name, employee_code: e.code, department: e.department, out_doc_no: ho.doc_no, out_ack_at: ho.ack_at, out_token: ho.token,
                out_paper_on: ho.paper_signed_on, _out_paper: ho.paper_scan_id, in_doc_no: hi ? hi.doc_no : null, in_ack_at: hi ? hi.ack_at : null, in_paper_on: hi ? hi.paper_signed_on : null }));
        }).filter(function (r) {
            if (state === 'active' && r.in_handover_id) return false;
            if (state === 'returned' && !r.in_handover_id) return false;
            if (p.employee_id && r.employee_id !== +p.employee_id) return false;
            if (p.department && r.department !== p.department) return false;
            if (TYPES[p.type] && r.type !== p.type) return false;
            if (!ackOk(r.out_ack_at, r._out_paper, p.ack)) return false;
            if (p.from && r.assigned_at < p.from) return false;
            if (p.to && r.assigned_at > p.to) return false;
            if (q && ![r.item_name, r.code, r.serial_no, JSON.stringify(r.specs), r.employee_name, r.employee_code, r.out_doc_no].some(function (v) { return has(v, q); })) return false;
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
            if (q && ![i.name, i.code, i.serial_no, i.brand, i.model, JSON.stringify(i.specs || {})].some(function (v) { return has(v, q); })) return false;
            if (TYPES[p.type] && i.type !== p.type) return false;
            if (p.status && i.status !== p.status) return false;
            return true;
        }).map(function (i) {
            var c = DB.custody.filter(function (x) { return x.item_id === i.id && !x.in_handover_id; })[0], e = c ? byId('employees', c.employee_id) : null;
            return decorate($.extend({}, i, { holder_id: e ? e.id : null, holder_name: e ? e.name : null, holder_department: e ? e.department : null, assigned_at: c ? c.assigned_at : null }));
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
    // نفس active_types(): "active": false في types.json بيوقف النوع
    function activeTypes() { var o = {}; Object.keys(TYPES).forEach(function (t) { if (TYPES[t].active !== false) o[t] = TYPES[t]; }); return o; }
    function sessUser() { var s = DB.sess || {}; var u = s.uid ? byId('users', s.uid) : null; return u && +u.active ? u : null; }
    function sessionInfo() {
        var u = sessUser(), ended = (DB.sess || {}).ended;
        return { idle: SESSION_IDLE, warn: SESSION_WARN, remaining: u ? SESSION_IDLE : 0, ended: u ? null : ended,
            message: u ? null : (ended === 'logout' ? 'تم تسجيل الخروج. سجّل الدخول مرة أخرى' : 'انتهت الجلسة، سجّل الدخول مرة أخرى') };
    }
    A['auth.me'] = function () {
        var u = sessUser(), imp = u && DB.sess.imp ? byId('users', DB.sess.imp) : null;
        return { user: u ? { id: u.id, username: u.username, name: u.name, role: u.role, must_change: 0 } : null,
            impersonator: imp ? { id: imp.id, name: imp.name } : null, csrf: 'demo', session: sessionInfo(),
            app_name: 'العهد الإلكترونية', org_name: 'Hand in Hand', statuses: STATUSES, conditions: CONDITIONS, roles: ROLES, today: today(), types: TYPES, scan_limits: SCAN_LIMITS,
            active_types: Object.keys(activeTypes()), used_types: Object.keys(TYPES).filter(function (t) { return activeTypes()[t] || DB.items.some(function (i) { return i.type === t; }); }) };
    };
    A['auth.session'] = function () {
        var u = sessUser();
        return { user: u ? { id: u.id, role: u.role } : null, impersonator: u ? (DB.sess.imp || null) : null, csrf: 'demo', session: sessionInfo() };
    };
    A['auth.login'] = function (p) {
        var u = DB.users.filter(function (x) { return x.username === str(p.username, 64) && +x.active; })[0];
        if (!u || u.password !== String(p.password || '')) fail('اسم المستخدم أو كلمة المرور غير صحيحة', 401);
        DB.sess = { uid: u.id, imp: null, imp_started: null, ended: null };
        u.last_login = now();
        log('تسجيل دخول', 'user', u.id);
        return { ok: true };
    };
    A['auth.logout'] = function () {
        if (DB.sess.imp) log('انتهاء الدخول كمستخدم', 'user', DB.sess.uid, 'تسجيل خروج');
        DB.sess = { uid: null, imp: null, imp_started: null, ended: 'logout' };
        return { ok: true };
    };
    A['auth.impersonate'] = function (p) {
        if (DB.sess.imp) fail('أنت تستخدم النظام باسم مستخدم آخر بالفعل. عُد لحساب المدير أولًا', 409);
        var t = byId('users', p.id);
        if (!t) fail('المستخدم غير موجود', 404);
        if (t.id === DB.sess.uid) fail('لا يمكنك الدخول بحسابك أنت');
        if (!+t.active) fail('هذا المستخدم موقوف');
        log('بدء الدخول كمستخدم', 'user', t.id, t.name + ' (' + t.username + ') — ' + (ROLES[t.role] || t.role));
        DB.sess = { uid: t.id, imp: DB.sess.uid, imp_started: now(), ended: null };
        return { ok: true };
    };
    A['auth.stop_impersonation'] = function () {
        if (!DB.sess.imp) fail('لا توجد جلسة دخول كمستخدم', 409);
        log('انتهاء الدخول كمستخدم', 'user', DB.sess.uid, 'العودة لحساب المدير — من ' + DB.sess.imp_started);
        DB.sess = { uid: DB.sess.imp, imp: null, imp_started: null, ended: null };
        return { ok: true };
    };
    A['auth.change_password'] = function (p) {
        if (DB.sess.imp) fail('لا يمكن تغيير كلمة مرور المستخدم أثناء الدخول باسمه', 403);
        var u = sessUser();
        if (u.password !== String(p.old_password || '')) fail('كلمة المرور الحالية غير صحيحة');
        if (String(p.new_password || '').length < 8) fail('كلمة المرور الجديدة يجب ألا تقل عن 8 أحرف');
        u.password = String(p.new_password); log('تغيير كلمة المرور', 'user', u.id);
        return { ok: true };
    };
    A['sync.version'] = function () { return { v: DB.seq.log + '-' + DB.scans.length + '-' + DB.handovers.filter(function (h) { return h.ack_at; }).length }; };

    A.dashboard = function () {
        var by = {}; DB.items.forEach(function (i) { by[i.status] = (by[i.status] || 0) + 1; });
        var active = DB.custody.filter(function (c) { return !c.in_handover_id; });
        var types = {}; DB.items.forEach(function (i) {
            var t = types[i.type] = types[i.type] || { type: i.type, name: TYPES[i.type].label, total: 0, assigned: 0, available: 0 };
            t.total++; if (i.status === 'مسلمة') t.assigned++; if (i.status === 'متاحة') t.available++;
        });
        var deps = {}; active.forEach(function (c) { var e = byId('employees', c.employee_id), n = e.department || 'بدون قسم'; deps[n] = deps[n] || { name: n, n: 0, value: 0 }; deps[n].n++; deps[n].value += +byId('items', c.item_id).value || 0; });
        var srt = function (k) { return function (a, b) { return b[k] - a[k]; }; };
        return {
            items_total: DB.items.length, by_status: by,
            active_value: active.reduce(function (s, c) { return s + (+byId('items', c.item_id).value || 0); }, 0),
            employees_with_custody: distinct(active, 'employee_id').length,
            pending_ack: DB.handovers.filter(function (h) { return h.type === 'out' && ackOk(h.ack_at, h.paper_scan_id, 'pending'); }).length,
            by_type: Object.keys(types).map(function (k) { return types[k]; }).sort(srt('total')),
            by_department: Object.keys(deps).map(function (k) { return deps[k]; }).sort(srt('n')),
            recent: DB.handovers.slice().reverse().slice(0, 10).map(function (h) {
                return { id: h.id, doc_no: h.doc_no, type: h.type, doc_date: h.doc_date, ack_at: h.ack_at, paper_signed_on: h.paper_signed_on, employee_name: byId('employees', h.employee_id).name, items_count: handoverItems(h).length };
            })
        };
    };

    A.lookups = function () {
        return { departments: distinct(DB.employees, 'department'), branches: distinct(DB.employees, 'branch'), locations: distinct(DB.items, 'location') };
    };

    A['employees.list'] = employeeRows;
    A['employees.get'] = function (p) {
        var e = byId('employees', p.id); if (!e) fail('الموظف غير موجود', 404);
        var rows = custodyRows({ employee_id: e.id, state: 'all' }).sort(function (a, b) { return (!!a.in_handover_id - !!b.in_handover_id) || b.id - a.id; });
        return { employee: copy(e), custody: rows, handovers: DB.handovers.filter(function (h) { return h.employee_id === e.id; }).reverse().map(function (h) { return { id: h.id, doc_no: h.doc_no, type: h.type, doc_date: h.doc_date, ack_at: h.ack_at, paper_signed_on: h.paper_signed_on }; }) };
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
            item: decorate(i),
            linked_by: (function () { var d = DB.items.filter(function (x) { return x.linked_sim_id === i.id; })[0]; return d ? { id: d.id, code: d.code, name: d.name, type: d.type } : null; })(),
            history: DB.custody.filter(function (c) { return c.item_id === i.id; }).reverse().map(function (c) {
                var e = byId('employees', c.employee_id);
                return $.extend({}, c, { employee_name: e.name, department: e.department, out_doc_no: byId('handovers', c.out_handover_id).doc_no, in_doc_no: c.in_handover_id ? byId('handovers', c.in_handover_id).doc_no : null });
            })
        };
    };
    // نفس read_type_fields + save_item في api.php
    function readTypeFields(type, input) {
        var def = TYPES[type], cols = { brand: '', model: '', serial_no: '' }, specs = {};
        def.fields.forEach(function (f) {
            var k = f.key, kind = f.input || 'text', v;
            if (kind === 'checks') {
                v = f.options.filter(function (o) { return (input[k] || []).indexOf(o) >= 0; });
                if (v.length) specs[k] = v;
                return;
            }
            if (kind === 'item_ref') {
                var refId = +(input[k] || 0), ref = refId ? byId('items', refId) : null;
                if (refId && (!ref || ref.type !== f.ref_type)) fail(f.label + ': اختر ' + TYPES[f.ref_type].label + ' موجودة في النظام');
                if (!refId && f.required) fail(f.label + ' مطلوب');
                cols[f.column] = refId || null;
                return;
            }
            v = str(input[k]);
            if (v === '') { if (f.required) fail(f.label + ' مطلوب'); return; }
            if (kind === 'number') { if (isNaN(+v) || +v < 0) fail(f.label + ': أدخل رقمًا صحيحًا'); v = String(Math.round(+v * 100) / 100); }
            if (f.options && f.options.indexOf(v) < 0) fail(f.label + ': اختر قيمة من القائمة');
            if (f.pattern && !new RegExp(f.pattern).test(v)) fail(f.pattern_msg || (f.label + ' غير صحيح'));
            if (k in cols) cols[k] = v; else specs[k] = v;
        });
        var name = def.name.map(function (k) { return cols[k] !== undefined ? cols[k] : specs[k]; }).filter(Boolean).join(' ');
        return { cols: cols, specs: specs, name: ((def.name_prefix || '') + ' ' + name).trim() || def.label };
    }

    A['items.save'] = function (p) {
        var id = +p.id || 0, old = id ? byId('items', id) : null;
        if (id && !old) fail('الصنف غير موجود', 404);
        var type = old ? old.type : str(p.type, 16);
        if (!TYPES[type]) fail('اختر نوع الصنف');
        if (!old && !activeTypes()[type]) fail('نوع «' + TYPES[type].label + '» متوقف حاليًا، ومينفعش تضيف أصناف جديدة منه');
        var tf = readTypeFields(type, p.specs || {});
        var row = $.extend({}, tf.cols, { code: str(p.code, 64), type: type, name: tf.name, specs: tf.specs,
            purchase_date: str(p.purchase_date, 10) || null, value: p.value === '' || p.value === undefined || p.value === null ? null : Math.round(+p.value * 100) / 100,
            item_condition: str(p.item_condition, 32) || 'جيد', location: str(p.location), notes: str(p.notes, 2000) });
        var st = str(p.status, 32);
        if (old && old.status === 'مسلمة') st = 'مسلمة';
        else if (st === 'مسلمة' || STATUSES.indexOf(st) < 0) st = old ? old.status : 'متاحة';
        row.status = st;
        if (row.code && DB.items.some(function (i) { return i.code === row.code && i.id !== id; })) fail('كود الأصل مستخدم لصنف آخر');
        var dup = row.serial_no && DB.items.filter(function (i) { return i.serial_no === row.serial_no && i.id !== id; })[0];
        if (dup) fail(TYPES[type].fields.filter(function (f) { return f.key === 'serial_no'; })[0].label + ' مسجل بالفعل للصنف ' + dup.code);
        var simDup = row.linked_sim_id && DB.items.filter(function (i) { return i.linked_sim_id === row.linked_sim_id && i.id !== id; })[0];
        if (simDup) fail('هذه الشريحة مرتبطة بالفعل بالجهاز ' + simDup.code + '، ولا يمكن ربطها بأكثر من جهاز');
        if (id) { if (!row.code) row.code = old.code; $.extend(old, row); log('تعديل صنف', 'item', id, row.code + ' ' + row.name); }
        else { id = nextId('items'); if (!row.code) row.code = TYPES[type].prefix + '-' + pad(id, 5); DB.items.push($.extend({ id: id, created_at: now() }, row)); log('إضافة صنف', 'item', id, row.code + ' ' + row.name); }
        return { id: id, code: row.code };
    };
    A['items.ref_options'] = function (p) {
        if (!TYPES[p.type]) fail('نوع غير صحيح');
        return DB.items.filter(function (s) { return s.type === p.type; }).sort(function (a, b) { return a.code < b.code ? -1 : 1; }).map(function (s) {
            var d = DB.items.filter(function (x) { return x.linked_sim_id === s.id; })[0];
            return { id: s.id, code: s.code, serial_no: s.serial_no, brand: s.brand, status: s.status, linked_id: d ? d.id : null, linked_code: d ? d.code : null };
        });
    };
    A['items.delete'] = function (p) {
        if (DB.custody.some(function (c) { return c.item_id === +p.id; })) fail('لا يمكن حذف صنف له سجل تسليم، يمكنك تغيير حالته إلى مكهنة');
        var dev = DB.items.filter(function (x) { return x.linked_sim_id === +p.id; })[0];
        if (dev) fail('هذه الشريحة مرتبطة بالجهاز ' + dev.code + '، ألغِ الربط من بيانات الجهاز أولًا');
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
            if (!ackOk(h.ack_at, h.paper_scan_id, p.ack)) return false;
            if (p.employee_id && h.employee_id !== +p.employee_id) return false;
            if (p.from && h.doc_date < p.from) return false;
            if (p.to && h.doc_date > p.to) return false;
            if (q && !has(h.doc_no, q) && !has(e.name, q)) return false;
            return true;
        }).map(function (h) {
            var e = byId('employees', h.employee_id);
            var sc = h.paper_scan_id ? byId('scans', h.paper_scan_id) : null;
            return { id: h.id, doc_no: h.doc_no, type: h.type, doc_date: h.doc_date, notes: h.notes, ack_at: h.ack_at, ack_name: h.ack_name, token: h.token, created_at: h.created_at,
                paper_scan_id: h.paper_scan_id, paper_signed_on: h.paper_signed_on, paper_uploaded_at: sc ? sc.uploaded_at : null, paper_by_name: sc ? userName(sc.uploaded_by) : null,
                employee_name: e.name, department: e.department, created_by_name: userName(h.created_by), items_count: handoverItems(h).length };
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
        if (id === DB.sess.uid && (row.role !== 'admin' || !row.active)) fail('لا يمكنك إيقاف حسابك أو تغيير صلاحيتك');
        if (p.password) { if (String(p.password).length < 8) fail('كلمة المرور يجب ألا تقل عن 8 أحرف'); row.must_change = 1; }
        else if (!id) fail('كلمة المرور مطلوبة للمستخدم الجديد');
        if (p.password) row.password = String(p.password);
        if (id) $.extend(byId('users', id), row); else { id = nextId('users'); DB.users.push($.extend({ id: id, created_at: now(), last_login: null }, row)); }
        log('حفظ مستخدم', 'user', id, row.username); return { id: id };
    };
    A['log.list'] = function () { return DB.log.slice(0, 500).map(function (l) { return $.extend({}, l, { user_name: userName(l.user_id), impersonator_name: userName(l.impersonator_id) }); }); };
    A['data.import_preview'] = function () { fail('استيراد Excel شغال على السيرفر بس. في النسخة التجريبية تقدر تشوف شكل الصفحة والخطوات.'); };
    A['data.import_commit'] = A['data.import_preview'];

    A.export = function (p) {
        var def = TYPES[p.type];
        var specHeads = def ? def.fields.map(function (f) { return f.label; }) : ['النوع', serialHeading(A['auth.me']().used_types), 'المواصفات', 'الملحقات'];
        var specCells = function (r) {
            if (!def) return [r.type_label, r.serial_no, r.specs_text, r.accessories_text];
            return def.fields.map(function (f) { var v = r.specs[f.key]; return $.isArray(v) ? v.join('، ') : (v || ''); });
        };
        if (p.what === 'handovers') {
            csv('handovers-' + today() + '.csv', ['رقم السند', 'النوع', 'التاريخ', 'الموظف', 'القسم', 'عدد الأصناف', 'حالة التوقيع', 'وقت التوقيع الإلكتروني', 'الاسم في التوقيع الإلكتروني', 'تاريخ التوقيع الورقي', 'رفع الإقرار', 'وقت رفع الإقرار', 'بواسطة'],
                A['handovers.list'](p).map(function (h) { return [h.doc_no, h.type === 'out' ? 'تسليم' : 'ارتجاع', h.doc_date, h.employee_name, h.department, h.items_count, ackText(h.ack_at, h.paper_signed_on), h.ack_at, h.ack_name, h.paper_signed_on, h.paper_by_name, h.paper_uploaded_at, h.created_by_name]; }));
        } else if (p.what === 'custody') {
            csv('custody-' + today() + '.csv', ['رقم سند التسليم', 'كود الموظف', 'الموظف', 'القسم', 'كود الأصل', 'الصنف'].concat(specHeads, ['القيمة', 'تاريخ التسليم', 'الحالة عند التسليم', 'توقيع الموظف', 'تاريخ الارتجاع', 'الحالة عند الارتجاع', 'رقم سند الارتجاع']),
                custodyRows(p).map(function (r) { return [r.out_doc_no, r.employee_code, r.employee_name, r.department, r.code, r.item_name].concat(specCells(r), [r.value, r.assigned_at, r.condition_out, ackText(r.out_ack_at, r.out_paper_on), r.returned_at, r.condition_in, r.in_doc_no]); }));
        } else if (p.what === 'items') {
            csv('items-' + today() + '.csv', ['كود الأصل', 'الصنف'].concat(specHeads, ['تاريخ الشراء', 'القيمة', 'الحالة الفنية', 'الوضع', 'في عهدة', 'المكان', 'ملاحظات']),
                itemRows(p).map(function (r) { return [r.code, r.name].concat(specCells(r), [r.purchase_date, r.value, r.item_condition, r.status, r.holder_name, r.location, r.notes]); }));
        } else {
            csv('employees-' + today() + '.csv', ['الكود', 'الاسم', 'الرقم القومي', 'القسم', 'الوظيفة', 'الفرع', 'الموبايل', 'البريد', 'الحالة', 'عدد أصناف العهدة', 'قيمة العهدة'],
                employeeRows(p).map(function (r) { return [r.code, r.name, r.national_id, r.department, r.job_title, r.branch, r.phone, r.email, +r.active ? 'نشط' : 'موقوف', r.active_count, r.active_value]; }));
        }
    };

    // ------------------------------------------------------------ الإقرار الورقي الموقّع (نفس scans.php)
    // ملف الـ PDF بيتحفظ في المتصفح (localStorage)، ولو المساحة مش كفاية بيفضل في الذاكرة لحد ما الصفحة تتقفل
    var SCAN_MEM = {}, SCAN_URLS = {};
    function scanKey(id) { return KEY + '-scan-' + id; }
    function putScanFile(id, dataUrl) { try { localStorage.setItem(scanKey(id), dataUrl); } catch (e) { SCAN_MEM[id] = dataUrl; } }
    function getScanFile(id) { var v = null; try { v = localStorage.getItem(scanKey(id)); } catch (e) { } return v || SCAN_MEM[id] || null; }

    function bytesToDataUrl(bytes, mime) {
        var bin = '', CH = 0x8000;
        for (var i = 0; i < bytes.length; i += CH) bin += String.fromCharCode.apply(null, bytes.subarray(i, i + CH));
        return 'data:' + mime + ';base64,' + btoa(bin);
    }
    function dataUrlToBytes(u) {
        var bin = atob(u.split(',')[1]), out = new Uint8Array(bin.length);
        for (var i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
        return out;
    }

    // PDF بسيط: صفحة A4 لكل صورة JPEG (نفس فكرة scan_build_pdf)
    function jpegsToPdf(pages) {
        var chunks = [], offsets = [], len = 0, n = 2 + pages.length * 3;
        var push = function (x) { if (typeof x === 'string') { var b = new Uint8Array(x.length); for (var i = 0; i < x.length; i++) b[i] = x.charCodeAt(i) & 255; x = b; } chunks.push(x); len += x.length; };
        var obj = function (num, body, stream) {
            offsets[num] = len;
            push(num + ' 0 obj\n' + body + (stream ? '\nstream\n' : '\nendobj\n'));
            if (stream) { push(stream); push('\nendstream\nendobj\n'); }
        };
        push('%PDF-1.4\n%âãÏÓ\n');
        obj(1, '<< /Type /Catalog /Pages 2 0 R >>');
        obj(2, '<< /Type /Pages /Kids [' + pages.map(function (_, i) { return (3 + i * 3) + ' 0 R'; }).join(' ') + '] /Count ' + pages.length + ' >>');
        pages.forEach(function (pg, i) {
            var W = 595, H = 842, m = 20, sc = Math.min((W - 2 * m) / pg.w, (H - 2 * m) / pg.h), dw = pg.w * sc, dh = pg.h * sc;
            var content = 'q ' + dw.toFixed(2) + ' 0 0 ' + dh.toFixed(2) + ' ' + ((W - dw) / 2).toFixed(2) + ' ' + ((H - dh) / 2).toFixed(2) + ' cm /Im0 Do Q';
            obj(3 + i * 3, '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Resources << /XObject << /Im0 ' + (4 + i * 3) + ' 0 R >> >> /Contents ' + (5 + i * 3) + ' 0 R >>');
            obj(4 + i * 3, '<< /Type /XObject /Subtype /Image /Width ' + pg.w + ' /Height ' + pg.h + ' /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode /Length ' + pg.bytes.length + ' >>', pg.bytes);
            obj(5 + i * 3, '<< /Length ' + content.length + ' >>', content);
        });
        var xref = len, x = 'xref\n0 ' + (n + 1) + '\n0000000000 65535 f \n';
        for (var k = 1; k <= n; k++) x += ('0000000000' + offsets[k]).slice(-10) + ' 00000 n \n';
        push(x + 'trailer\n<< /Size ' + (n + 1) + ' /Root 1 0 R >>\nstartxref\n' + xref + '\n%%EOF\n');
        var out = new Uint8Array(len), at = 0;
        chunks.forEach(function (c) { out.set(c, at); at += c.length; });
        return out;
    }

    function canvasPage(canvas) {
        var u = canvas.toDataURL('image/jpeg', 0.85);
        return { bytes: dataUrlToBytes(u), w: canvas.width, h: canvas.height };
    }

    function fileToPage(file) {
        var d = $.Deferred(), url = URL.createObjectURL(file), img = new Image();
        img.onload = function () {
            var max = 2000, k = Math.min(1, max / Math.max(img.naturalWidth, img.naturalHeight));
            var c = document.createElement('canvas'); c.width = Math.round(img.naturalWidth * k); c.height = Math.round(img.naturalHeight * k);
            var x = c.getContext('2d'); x.fillStyle = '#fff'; x.fillRect(0, 0, c.width, c.height); x.drawImage(img, 0, 0, c.width, c.height);
            URL.revokeObjectURL(url); d.resolve(canvasPage(c));
        };
        img.onerror = function () { URL.revokeObjectURL(url); d.reject(apiError('الملف "' + file.name + '" صورة تالفة أو غير مدعومة')); };
        img.src = url;
        return d.promise();
    }

    function readBytes(file) {
        var d = $.Deferred(), r = new FileReader();
        r.onload = function () { d.resolve(new Uint8Array(r.result)); };
        r.onerror = function () { d.reject(apiError('تعذر قراءة الملف "' + file.name + '"')); };
        r.readAsArrayBuffer(file);
        return d.promise();
    }

    function apiError(msg, code) { var e = new Error(msg); e.code = code || 400; return e; }

    // صفحة إقرار تجريبية "مصوّرة" للبيانات التجريبية
    function samplePdf(h) {
        var c = document.createElement('canvas'); c.width = 900; c.height = 1270;
        var x = c.getContext('2d'), e = byId('employees', h.employee_id);
        x.fillStyle = '#fbfaf6'; x.fillRect(0, 0, c.width, c.height);
        x.fillStyle = '#222'; x.direction = 'rtl'; x.textAlign = 'right';
        x.font = 'bold 40px Tahoma, Arial'; x.fillText('سند تسليم عهدة ' + h.doc_no, 840, 110);
        x.font = '28px Tahoma, Arial';
        x.fillText('الموظف: ' + e.name, 840, 190); x.fillText('التاريخ: ' + h.doc_date, 840, 240);
        handoverItems(h).forEach(function (it, i) { x.fillText((i + 1) + '- ' + it.name + '  (' + it.code + ')', 840, 320 + i * 50); });
        x.font = '24px Tahoma, Arial'; x.fillStyle = '#555';
        x.fillText('أقر أنا الموقع أدناه بأنني استلمت العهدة الموضحة بهذا السند...', 840, 560);
        x.fillText('توقيع المستلم:', 840, 760);
        x.strokeStyle = '#1a3d8f'; x.lineWidth = 4; x.beginPath(); x.moveTo(560, 790);
        for (var i = 0; i < 24; i++) x.lineTo(560 - i * 14, 780 + Math.sin(i * 0.9) * 30);
        x.stroke();
        x.fillStyle = '#999'; x.font = '20px Tahoma, Arial'; x.fillText('(نسخة تجريبية — صورة إقرار ورقي بعد الـ Scan)', 840, 1200);
        return bytesToDataUrl(jpegsToPdf([canvasPage(c)]), 'application/pdf');
    }

    function snapshotOf(h) {
        var v = handoverView(h.id);
        return { doc_no: v.doc_no, type: v.type, doc_date: v.doc_date, created_by: v.created_by_name, notes: v.notes,
            employee: { id: v.employee_id, name: v.employee_name, code: v.employee_code, department: v.department, job_title: v.job_title },
            electronic_ack: v.ack_at ? { at: v.ack_at, name: v.ack_name } : null,
            items: v.items.map(function (it) { return { code: it.code, type: it.type_label, name: it.name, serial_no: it.serial_no, specs: it.specs_text, accessories: it.accessories_text, value: it.value, condition: v.type === 'out' ? it.condition_out : it.condition_in }; }) };
    }

    function storeScan(hid, meta, pdfDataUrl) {
        var h = byId('handovers', hid), cur = h.paper_scan_id ? byId('scans', h.paper_scan_id) : null;
        var id = nextId('scans'), at = now();
        DB.scans.push($.extend({ id: id, handover_id: hid, employee_id: h.employee_id, version: cur ? cur.version + 1 : 1, reason: null, replaced_by: null, replaced_at: null,
            pdf_size: Math.round((pdfDataUrl.length - pdfDataUrl.indexOf(',') - 1) * 3 / 4), snapshot: snapshotOf(h), uploaded_by: (DB.sess || {}).uid || 1, uploaded_at: at }, meta));
        if (cur) { cur.replaced_by = id; cur.replaced_at = at; }
        h.paper_scan_id = id; h.paper_signed_on = meta.signed_on;
        putScanFile(id, pdfDataUrl);
        log(cur ? 'تصحيح الإقرار الموقّع' : 'رفع الإقرار الموقّع', 'handover', hid, h.doc_no + ' — الإصدار ' + (cur ? cur.version + 1 : 1) + ' — توقيع ' + meta.signed_on + (meta.reason ? ' — السبب: ' + meta.reason : ''));
        return id;
    }

    A['handovers.paper_upload'] = function (p) {
        var h = byId('handovers', p.handover_id); if (!h) fail('السند غير موجود', 404);
        var cur = h.paper_scan_id ? byId('scans', h.paper_scan_id) : null, replace = +p.replace === 1, reason = str(p.reason, 500);
        if (cur && !replace) fail('السند عليه إقرار موقّع بالفعل. استخدم "تصحيح / استبدال المرفق"', 409);
        if (cur && !reason) fail('اكتب سبب تصحيح أو استبدال الإقرار');
        if (cur && +cur.id !== +p.current_scan_id) fail('الإقرار اتغير من مستخدم تاني. افتح السند من جديد', 409);
        var signedOn = str(p.signed_on, 10);
        if (!signedOn) fail('حدد تاريخ التوقيع الورقي');
        if (signedOn < h.doc_date || signedOn > today()) fail('تاريخ التوقيع لازم يكون من تاريخ السند (' + h.doc_date + ') لحد النهارده');
        if (!p.confirm) fail('أكّد إن الملف يخص هذا السند ويحتوي على توقيع الموظف');
        var files = p._files || [], total = 0, MB = 1048576;
        if (!files.length) fail('اختر ملف الإقرار الموقّع (PDF أو صور)');
        var kinds = files.map(function (f) {
            var n = (f.name || '').toLowerCase();
            if (!f.size) fail('الملف "' + f.name + '" فارغ');
            if (f.size > SCAN_LIMITS.file_mb * MB) fail('الملف "' + f.name + '" أكبر من الحد المسموح (' + SCAN_LIMITS.file_mb + ' م.ب)');
            total += f.size;
            if (f.type === 'application/pdf' || /\.pdf$/.test(n)) return 'pdf';
            if (/^image\/(jpeg|png)$/.test(f.type) || /\.(jpe?g|png)$/.test(n)) return 'img';
            fail('الملف "' + f.name + '" ليس PDF أو صورة JPG/PNG');
        });
        if (files.length > SCAN_LIMITS.files) fail('أقصى عدد للصور ' + SCAN_LIMITS.files + ' صورة');
        if (total > SCAN_LIMITS.total_mb * MB) fail('إجمالي حجم الملفات أكبر من ' + SCAN_LIMITS.total_mb + ' م.ب');
        if (kinds.indexOf('pdf') >= 0 && files.length > 1) fail('ارفع ملف PDF واحد فيه كل الصفحات، أو صور فقط. مينفعش الجمع بين PDF وصور');
        var isPdf = kinds[0] === 'pdf';
        var build = isPdf ? readBytes(files[0]).then(function (b) {
            var head = String.fromCharCode.apply(null, b.subarray(0, 5));
            if (head !== '%PDF-') return $.Deferred().reject(apiError('الملف "' + files[0].name + '" مش ملف PDF سليم')).promise();
            var txt = String.fromCharCode.apply(null, b.subarray(0, Math.min(b.length, 4000000)));
            return { bytes: b, pages: (txt.match(/\/Type\s*\/Page(?!s)/g) || []).length || null };
        }) : $.when.apply($, files.map(fileToPage)).then(function () {
            var pages = Array.prototype.slice.call(arguments);
            return { bytes: jpegsToPdf(pages), pages: pages.length };
        });
        return build.then(function (pdf) {
            load();
            storeScan(+p.handover_id, { signed_on: signedOn, notes: str(p.notes, 1000), reason: cur ? reason : null, source: isPdf ? 'pdf' : 'images', pages: pdf.pages,
                originals: files.map(function (f) { return { name: f.name, mime: f.type || (isPdf ? 'application/pdf' : 'image/jpeg'), size: f.size }; }) },
                bytesToDataUrl(pdf.bytes, 'application/pdf'));
            return handoverView(+p.handover_id);
        });
    };

    // صلاحيات نفس need() في api.php
    var PUBLIC = { 'auth.me': 1, 'auth.session': 1, 'auth.login': 1, 'auth.logout': 1 };
    var ADMIN = { 'users.list': 1, 'users.save': 1, 'log.list': 1, 'employees.delete': 1, 'items.delete': 1, 'auth.impersonate': 1 };
    var EDIT = { 'employees.save': 1, 'items.save': 1, 'custody.assign': 1, 'custody.return': 1, 'custody.transfer': 1, 'handovers.renew_link': 1, 'handovers.paper_upload': 1, 'data.import_preview': 1, 'data.import_commit': 1 };
    function need(action) {
        if (PUBLIC[action] || action === 'auth.stop_impersonation') return;
        var u = sessUser();
        if (!u) fail('انتهت الجلسة، سجّل الدخول مرة أخرى', 401);
        if (ADMIN[action] && u.role !== 'admin') fail('ليست لديك صلاحية لهذا الإجراء', 403);
        if (EDIT[action] && u.role === 'viewer') fail('ليست لديك صلاحية لهذا الإجراء', 403);
    }

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
        need(action);
        var r = fn(p);
        save();
        return copy(r === undefined ? null : r);
    }

    $.ajaxTransport('+*', function (opts) {
        if (!/^api\.php/.test(opts.url)) return;
        return {
            send: function (headers, complete) {
                setTimeout(function () {
                    var p;
                    if (window.FormData && opts.data instanceof FormData) {
                        p = params(opts.url); p._files = [];
                        opts.data.forEach(function (v, k) { if (window.File && v instanceof File) p._files.push(v); else p[k] = v; });
                    } else p = params(opts.url, opts.data);
                    var ok = function (data) { save(); complete(200, 'OK', { text: JSON.stringify({ ok: true, data: copy(data === undefined ? null : data) }) }); };
                    var bad = function (e) {
                        if (!e || !e.code) console.error(e);
                        complete((e && e.code) || 500, 'error', { text: JSON.stringify({ ok: false, error: e && e.code ? e.message : 'خطأ غير متوقع' }) });
                    };
                    try {
                        load();
                        var fn = A[p.action]; if (!fn) fail('إجراء غير معروف', 404);
                        need(p.action);
                        var r = fn(p);
                        if (r && typeof r.then === 'function') r.then(ok, bad); else ok(r);
                    } catch (e) { bad(e); }
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
        // بديل رابط handovers.scan_file: ملف الـ PDF المحفوظ في المتصفح
        scanUrl: function (sc) {
            if (SCAN_URLS[sc.id]) return SCAN_URLS[sc.id];
            var d = getScanFile(sc.id), blob;
            if (d) blob = new Blob([dataUrlToBytes(d)], { type: 'application/pdf' });
            else blob = new Blob(['<!doctype html><meta charset="utf-8"><body dir="rtl" style="font-family:Tahoma;padding:30px">ملف الإقرار ده مش محفوظ في المتصفح ده (كان أكبر من مساحة التخزين أو اتمسح). ارفعه تاني من تفاصيل السند.</body>'], { type: 'text/html' });
            return (SCAN_URLS[sc.id] = URL.createObjectURL(blob));
        },
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
                    '</div><div><span class="info-label">التاريخ:</span> <span class="d">' + v.doc_date + '</span></div></div><div class="table-scroll"><table class="table table-bordered table-condensed"><thead><tr><th>#</th><th>الصنف</th><th>' + e(serialHeading(v.items.map(function (i) { return i.type; }))) + '</th><th>المواصفات والملحقات</th><th>الحالة</th></tr></thead><tbody>' +
                    v.items.map(function (it, n) { return '<tr><td>' + (n + 1) + '</td><td>' + e(it.name) + '<br><small class="info-label">' + e(it.type_label + ' — ' + it.code) + '</small></td><td>' + e(it.serial_no || '-') + '</td><td class="details-cell">' + detailsHtml(it) + '</td><td>' + e(v.type === 'out' ? it.condition_out : it.condition_in) + '</td></tr>'; }).join('') +
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
    // نفس item_details_html في lib.php
    function detailsHtml(it) {
        var html = it.specs_text ? it.specs_text.split(' / ').map(function (x) { return '<bdi>' + esc(x) + '</bdi>'; }).join(' / ') : '';
        if (it.accessories_text) html += (html ? '<br>' : '') + '<small><span class="info-label">الملحقات:</span> ' + esc(it.accessories_text) + '</small>';
        return html || '-';
    }
    function money2(v) { return Number(v || 0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 }); }

    function printHtml(p) {
        var e = esc, h = null, emp, items, title;
        if (p.h) { h = handoverView(+p.h, true); emp = byId('employees', h.employee_id); items = h.items; title = h.type === 'out' ? 'سند تسليم عهدة' : 'سند ارتجاع عهدة'; }
        else {
            emp = byId('employees', p.emp);
            items = activeOf(emp.id).map(function (c) { var it = byId('items', c.item_id), ho = byId('handovers', c.out_handover_id); return decorate($.extend({}, c, itemFields(it), { doc_no: ho.doc_no })); });
            title = items.length ? 'بيان عهدة موظف' : 'شهادة إخلاء طرف من العهد';
        }
        var html = '<div class="print-actions no-print"><button class="btn btn-primary btn-action" onclick="window.print()"><i class="fa fa-print"></i> طباعة</button> <button class="btn btn-default btn-action" onclick="window.close()">إغلاق</button></div>' +
            (h && h.paper_scan_id ? '<div class="alert alert-info no-print paper-note"><i class="fa fa-info-circle"></i> ده <b>نموذج الإقرار الأصلي</b> زي ما اتولّد من النظام، ومن غير توقيع الموظف الورقي. ' +
                'النسخة الموقّعة ورقيًا (بتاريخ <span class="d">' + h.paper_signed_on + '</span>) محفوظة على السند: افتحها من تفاصيل السند بزر «عرض الإقرار الموقّع».</div>' : '') +
            '<div class="sheet">' +
            '<div class="sheet-head"><div><div class="sheet-org">Hand in Hand</div><div class="info-label">العهد الإلكترونية</div></div><h2>' + title + '</h2><div class="sheet-meta">' +
            (h ? '<div><span class="info-label">رقم السند:</span> <b>' + h.doc_no + '</b></div><div><span class="info-label">التاريخ:</span> <span class="d">' + h.doc_date + '</span></div>' : '<div><span class="info-label">تاريخ الطباعة:</span> <span class="d">' + today() + '</span></div>') +
            '</div></div><table class="table table-bordered sheet-info"><tr><td><span class="info-label">اسم الموظف:</span> <b>' + e(emp.name) + '</b></td><td><span class="info-label">الكود:</span> ' + e(emp.code || '-') +
            '</td><td><span class="info-label">الرقم القومي:</span> ' + e(emp.national_id || '-') + '</td></tr><tr><td><span class="info-label">القسم:</span> ' + e(emp.department || '-') + '</td><td colspan="2"><span class="info-label">الوظيفة:</span> ' + e(emp.job_title || '-') + '</td></tr></table>';
        if (items.length) {
            var total = 0;
            html += '<table class="table table-bordered table-condensed sheet-items"><thead><tr><th>#</th><th>كود الأصل</th><th>الصنف</th><th>' + e(serialHeading(items.map(function (i) { return i.type; }))) + '</th><th>المواصفات والملحقات</th><th>القيمة</th>' +
                (h ? '<th>الحالة</th><th>ملاحظات</th>' : '<th>تاريخ التسليم</th><th>رقم السند</th>') + '</tr></thead><tbody>' +
                items.map(function (it, n) {
                    total += +it.value || 0;
                    return '<tr><td>' + (n + 1) + '</td><td>' + e(it.code) + '</td><td>' + e(it.name) + '<br><small class="info-label">' + e(it.type_label) + '</small></td><td>' + e(it.serial_no || '-') + '</td><td class="details-cell">' + detailsHtml(it) + '</td><td>' + (it.value === null ? '-' : money2(it.value)) + '</td>' +
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
    // ملفات Excel الموحّدة (تصدير / قالب / تقرير) بتتعمل على السيرفر بس
    $(document).on('click', 'a[href^="api.php?action=data."]', function (e) {
        e.preventDefault();
        alert('ملفات Excel (التصدير الموحّد وقالب الاستيراد وتقرير الاستيراد) بتتعمل على السيرفر بس، ومش متاحة في النسخة التجريبية.');
    });
    Object.defineProperty(window.DEMO, 'go', {
        set: function (url) {
            if (url.indexOf('backup.download') >= 0) { alert('النسخة الاحتياطية متاحة على السيرفر فقط، والنسخة التجريبية محفوظة في المتصفح.'); return; }
            DEMO.exportCsv(url);
        }
    });
})(jQuery);
