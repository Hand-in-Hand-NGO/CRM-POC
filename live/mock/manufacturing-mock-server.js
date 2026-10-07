/* =====================================================================
 * MOCK SERVER (preview only) — manufacturing page
 * Answers every $.ajax / $.post call to cms.handinhand-eg.com with fake data,
 * in the same response format the page code expects, so the page works without the backend.
 * Not part of the real page: the developer never needs this block.
 * ===================================================================== */
(function ($) {
    var HOST = /cms\.handinhand-eg\.com/;

    // ------------------------------------------------------------ helpers
    var seed = 20261007;
    function rnd() { seed = (seed * 9301 + 49297) % 233280; return seed / 233280; }
    function pick(list) { return list[Math.floor(rnd() * list.length)]; }
    function pad(n) { return (n < 10 ? '0' : '') + n; }
    function ymd(d) { return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate()); }
    function hm(d) { var h = d.getHours(), ap = h < 12 ? 'ص' : 'م'; h = h % 12 || 12; return h + ':' + pad(d.getMinutes()) + ' ' + ap; }
    function stamp(d) { return ymd(d) + ' ' + pad(d.getHours()) + ':' + pad(d.getMinutes()) + ':00'; }
    function addDays(d, n) { var x = new Date(d.getTime()); x.setDate(x.getDate() + n); x.setHours(9 + Math.floor(rnd() * 8), Math.floor(rnd() * 60)); return x; }
    function dayDiff(a, b) { return Math.round((Date.UTC(b.getFullYear(), b.getMonth(), b.getDate()) - Date.UTC(a.getFullYear(), a.getMonth(), a.getDate())) / 864e5); }
    function esc(s) { return String(s === null || s === undefined ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;'); }
    function parseQuery(str, out) {
        out = out || {};
        if (!str) return out;
        str.replace(/^\?/, '').split('&').forEach(function (kv) {
            if (!kv) return;
            var i = kv.indexOf('='), k = decodeURIComponent((i < 0 ? kv : kv.slice(0, i)).replace(/\+/g, ' ')), v = i < 0 ? '' : decodeURIComponent(kv.slice(i + 1).replace(/\+/g, ' '));
            if (out[k] === undefined) out[k] = v; else out[k] = [].concat(out[k], v);
        });
        return out;
    }
    function list(v) { return v === undefined || v === '' ? [] : [].concat(v); }

    var NOW = new Date();
    var STATUS = {
        design_ready: 'جاهز للتصميم',
        design_progress: 'جاري التصميم',
        print_ready: 'جاهز للطباعة',
        print_progress: 'جاري الطباعة',
        in_progress: 'جاري التجميع',
        new_delivery_ready: 'جاهز للتسليم (مخزن الأطراف الجديدة)',
        maintenance_delivery_ready: 'جاهز للتسليم (مخزن أطراف صيانة)',
        out_for_delivery: 'خرج للتسليم',
        delivered: 'تم التسليم',
        warehouse_of_gones: 'مخزن الهالك',
        gone: 'تم التهليك'
    };
    var STATUS_BORDER = {
        design_ready: '#bce8f1', design_progress: '#c6e2ec', print_ready: '#d3b8ef', print_progress: '#dcc0ec', in_progress: '#f5dca8',
        new_delivery_ready: '#b9e2c4', maintenance_delivery_ready: '#a9ddd5', out_for_delivery: '#f5c4a3', delivered: '#b9e6c6', warehouse_of_gones: '#cfcfcf', gone: '#c4c4c4'
    };
    var START_POINTS = {
        first_time_size: 'مقاس اول مرة',
        new_measurement_taken_an_adjustment_previous_measurement_during_new_prosthetic_limb_delivery: 'تم اخد مقاس جديد (تعديل في المقاس السابق وقت تسليم طرف جديد)',
        new_measurement_taken_an_adjustment_previous_measurement_during_maintenance_assessment: 'تم اخد مقاس جديد (تعديل في المقاس السابق وقت تقييم الصيانة)',
        new_measurement_taken_an_adjustment_previous_measurement_during_maintenance_delivery: 'تم اخد مقاس جديد (تعديل في المقاس السابق وقت تسليم الصيانة)',
        remanufacturing_damage_during_new_prosthetic_limb_delivery: 'إعادة تصنيع (تلف في الطرف وقت تسليم طرف جديد)',
        remanufacturing_damage_during_maintenance_delivery: 'إعادة تصنيع (تلف في الطرف وقت تسليم الصيانة)',
        remanufacturing_damage_to_the_end_during_assembly: 'إعادة تصنيع (تلف فى الطرف وقت التجميع)',
        failed_to_print: 'فشل فى محاولة الطباعة',
        printing_spare_parts: 'طباعة قطع غيار'
    };
    var ENGINEERS = [{ id: 101, text: 'هنا جوهر' }, { id: 102, text: 'أحمد سمير' }, { id: 103, text: 'سارة علي' }];
    var PRINTERS = [{ id: 201, text: 'عبد المقصود' }, { id: 202, text: 'محمد فتحي' }];
    var ASSEMBLERS = [{ id: 301, text: 'جمعة' }, { id: 302, text: 'كريم عادل' }, { id: 303, text: 'ياسر فؤاد' }];
    var MATERIALS = ['PLA', 'PETG', 'TPU', 'Nylon', 'Carbon Fiber'];
    var FIRST = ['محمود', 'عبدالله', 'أحمد', 'الرشيد', 'منى', 'رشا', 'نادية', 'يوسف', 'ياسمين', 'خالد', 'سلمى', 'عمر', 'مريم', 'حسن', 'إبراهيم'];
    var LAST = ['احمد ابراهيم سليمان', 'بدوى عمر جمور', 'محمد صبرى مندوراحمد', 'محمد حسن سليمان', 'عبدالرحمن عوض', 'رمضان فتحى', 'فؤاد السيد', 'علي حسانين', 'مصطفى كامل'];
    function member(id) { return ENGINEERS.concat(PRINTERS, ASSEMBLERS).filter(function (m) { return m.id == id; })[0]; }

    // ------------------------------------------------------------ fake data
    var nextId = 5000;
    var rows = []; // one row = one manufacturing cycle of an order
    var PATH = ['design_ready', 'design_progress', 'print_ready', 'print_progress', 'in_progress', 'delivery_ready', 'out_for_delivery', 'delivered'];

    function readyStatus(r) { return r.type === 'new' ? 'new_delivery_ready' : 'maintenance_delivery_ready'; }
    function push(r, status, date, extra) { var e = $.extend({ id: nextId++, status: status, date: date }, extra || {}); r.history.push(e); return e; }
    function current(r) { return r.history[r.history.length - 1]; }

    function newCycle(base, startPoint, startDate) {
        var r = {
            orderId: base ? base.orderId : nextId++,
            type: base ? base.type : (rnd() < 0.6 ? 'new' : 'maintenance'),
            code: base ? base.code : null, name: base ? base.name : null,
            booking: base ? base.booking : null,
            startPoint: startPoint, cycleNo: base ? base.cycleNo + 1 : 1, closed: false,
            defaultWeight: base ? base.defaultWeight : 400 + Math.floor(rnd() * 25) * 100,
            actualWeight: null, quality: null, history: [],
            team: { design: null, print: null, assembly: null }
        };
        if (!base) {
            r.code = (r.type === 'new' ? pick(['AR', 'AL', 'AK']) : pick(['LL', 'LR', 'MR'])) + (1000 + Math.floor(rnd() * 300000));
            r.name = pick(FIRST) + ' ' + pick(LAST);
        }
        push(r, 'design_ready', startDate);
        rows.push(r);
        return r;
    }

    // walk a cycle forward to `target` step; returns the date reached
    function advance(r, target, d) {
        var steps = PATH.slice(1, PATH.indexOf(target) + 1);
        steps.forEach(function (s) {
            d = addDays(d, s === 'print_progress' || s === 'in_progress' ? 1 + Math.floor(rnd() * 4) : Math.floor(rnd() * 3));
            if (d > NOW) d = new Date(NOW.getTime() - Math.floor(rnd() * 5) * 3600e3);
            if (s === 'design_progress') { r.team.design = pick(ENGINEERS).id; push(r, s, d); }
            else if (s === 'print_ready') {
                push(r, s, d, { designFiles: ['socket_v' + r.cycleNo + '.stl'], printFiles: ['socket_v' + r.cycleNo + '.gcode'], materials: [pick(MATERIALS)], notes: '', engineer: r.team.design });
            }
            else if (s === 'print_progress') { r.team.print = pick(PRINTERS).id; push(r, s, d); }
            else if (s === 'in_progress') { r.quality = pick([70, 80, 85, 90, 95, 100, 100]); push(r, s, d, { quality: r.quality }); }
            else if (s === 'delivery_ready') {
                r.team.assembly = pick(ASSEMBLERS).id;
                r.actualWeight = r.defaultWeight + (Math.floor(rnd() * 21) - 10) * 10;
                push(r, readyStatus(r), d);
            }
            else push(r, s, d);
        });
        return d;
    }

    (function build() {
        var targets = ['design_ready', 'design_progress', 'print_ready', 'print_progress', 'in_progress', 'delivery_ready', 'out_for_delivery', 'delivered'];
        for (var i = 0; i < 42; i++) {
            var start = addDays(NOW, -Math.floor(rnd() * 120));
            var r = newCycle(null, rnd() < 0.55 ? 'first_time_size' : pick(Object.keys(START_POINTS).slice(1, 4).concat('printing_spare_parts')), start);
            if (rnd() < 0.5) r.booking = addDays(NOW, Math.floor(rnd() * 20) - 5);
            var target = pick(targets);
            // some orders had an earlier cycle that failed (print / assembly / delivery damage)
            if (rnd() < 0.22 && target !== 'design_ready') {
                var why = pick(['failed_to_print', 'remanufacturing_damage_to_the_end_during_assembly', 'remanufacturing_damage_during_new_prosthetic_limb_delivery']);
                var d = advance(r, why === 'failed_to_print' ? 'print_progress' : why === 'remanufacturing_damage_to_the_end_during_assembly' ? 'in_progress' : 'out_for_delivery', start);
                r.closed = true;
                r = newCycle(r, why, addDays(d, 1));
                start = current(r).date;
            }
            advance(r, target, start);
            if (target === 'delivered' && rnd() < 0.25) { var g = addDays(current(r).date, 1); push(r, 'warehouse_of_gones', g); if (rnd() < 0.6) push(r, 'gone', addDays(g, 2)); }
        }
    })();

    function rowsOfOrder(orderId) { return rows.filter(function (r) { return r.orderId == orderId; }); }
    function openRow(orderId) { var l = rowsOfOrder(orderId).filter(function (r) { return !r.closed; }); return l[l.length - 1] || rowsOfOrder(orderId).slice(-1)[0]; }
    function rowOf(orderId, cycleNo) { return rowsOfOrder(orderId).filter(function (r) { return r.cycleNo == cycleNo; })[0] || openRow(orderId); }
    function attempts(r) { var n = 0; rowsOfOrder(r.orderId).forEach(function (x) { x.history.forEach(function (h) { if (h.status === 'print_progress') n++; }); }); return n; }
    function entry(r, status) { for (var i = r.history.length - 1; i >= 0; i--) if (r.history[i].status === status) return r.history[i]; return null; }
    function readyEntry(r) { return r.history.filter(function (h) { return /delivery_ready$/.test(h.status); })[0]; }
    function daysOf(r) { var re = readyEntry(r); return { n: dayDiff(r.history[0].date, re ? re.date : NOW), ready: !!re }; }
    function weightDiff(r) { return r.actualWeight === null ? null : (r.actualWeight - r.defaultWeight) / r.defaultWeight * 100; }

    // ------------------------------------------------------------ table cells (same look as the live table)
    function stepBtn(cls, label, r, edit) {
        return '<button type="button" class="btn btn-default btn-sm ' + cls + ' ' + (edit ? 'edit' : 'view') + '" data-cyclenumber="' + r.cycleNo + '" data-actionmode="' + (edit ? 'edit' : 'view') + '">' +
            '<i class="fa fa-plus-circle pull-left" style="font-size: 16px; margin-top: 1px;"></i> ' + label + '</button>';
    }
    function teamLine(title, id) {
        var m = member(id);
        return m ? '<div><span class="titleInfo" style="color: gray;">' + title + ':</span><span class="manufacturingTeam-cell" data-id="' + m.id + '" data-name="' + esc(m.text) + '" style="cursor: pointer;">' + esc(m.text) + '</span></div>' : '';
    }
    function cells(r) {
        var st = current(r).status, open = !r.closed, d = daysOf(r), wd = weightDiff(r);
        var c = [];
        c.push('<span class="label ' + (r.type === 'new' ? 'label-success' : 'label-danger') + '" style="border-radius: 10px; font-size: 12px; padding: 3px 7px;">' + (r.type === 'new' ? 'طلب جديد' : 'طلب صيانة') + '</span>');
        c.push(START_POINTS[r.startPoint] + (r.cycleNo > 1 ? '<br><small style="color: gray;">الدورة رقم ' + r.cycleNo + '</small>' : ''));
        c.push('<div class="info">' + esc(r.code) +
            ' <button type="button" class="btn btn-default btn-xs search-order-code" data-code="' + esc(r.code) + '"><i class="fa fa-search"></i></button>' +
            ' <button type="button" class="btn btn-primary btn-xs copy-order-code" data-code="' + esc(r.code) + '">نسخ</button></div>' +
            '<div class="info" style="color: gray; font-size: 11px; margin-top: 4px;">' + esc(r.name) +
            ' <button type="button" class="btn btn-default btn-xs search-case-name" data-name="' + esc(r.name) + '"><i class="fa fa-search"></i></button>' +
            ' <button type="button" class="btn btn-primary btn-xs copy-case-name" data-name="' + esc(r.name) + '">نسخ</button></div>');
        c.push(r.booking ? ymd(r.booking) + '<br><small>' + hm(r.booking) + '</small>' : '');
        var last = current(r);
        c.push('<b style="color: ' + (d.ready ? '#00a65a' : '#dd4b39') + ';">' + d.n + ' يوم</b>' +
            '<div class="list-history dt-status-' + st + '" style="cursor: pointer; border: 1px solid ' + STATUS_BORDER[st] + '; border-radius: 3px; padding: 3px 6px; margin: 2px 0;" title="تاريخ التصنيع">' + STATUS[st] + '</div>' +
            ymd(last.date) + '<br><small>' + hm(last.date) + '</small>');
        var ed = open && (st === 'design_ready' || st === 'design_progress'),
            ep = open && (st === 'design_progress' || st === 'print_ready'),
            er = open && st === 'print_progress',
            ea = open && st === 'in_progress';
        c.push('<div id="manufacturingSteps">' +
            stepBtn('measurementsReports', 'التقرير الطبي و القياسات', r, ed) +
            stepBtn('designAndPrinting', 'ملفات التصميم والطباعة', r, ep) +
            stepBtn('receivingPrintedParts', 'استلام الأجزاء المطبوعة', r, er) +
            stepBtn('receivingFromAssembly', 'استلام الطرف من التجميع', r, ea) + '</div>');
        c.push(r.defaultWeight);
        c.push(r.actualWeight === null ? '' : r.actualWeight);
        c.push(wd === null ? '-' : wd.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + ' %');
        c.push(r.quality === null ? '' : '<span class="label ' + (r.quality >= 90 ? 'label-success' : r.quality >= 75 ? 'label-warning' : 'label-danger') + '" style="border-radius: 10px;">' + r.quality + '%</span>');
        var out = '';
        if (open) {
            var ofd = entry(r, 'out_for_delivery');
            if (/delivery_ready$/.test(st) && last.restore) out = '<label><input type="checkbox" class="restore" checked> رجوع للمخزن</label>';
            else if (/delivery_ready$/.test(st)) out = '<label><input type="checkbox" class="outForDelivery"> خرج للتسليم</label>';
            else if (st === 'out_for_delivery') out = '<label><input type="checkbox" class="outForDelivery" outForDeliveryId="' + ofd.id + '" checked> خرج للتسليم</label><br><label><input type="checkbox" class="restore"> رجوع للمخزن</label>';
            else if (st === 'delivered') out = '<span class="text-green">تم التسليم</span>';
        }
        c.push(out);
        c.push(attempts(r));
        c.push(r.cycleNo);
        c.push(teamLine('التصميم', r.team.design) + teamLine('الطباعة', r.team.print) + teamLine('التجميع', r.team.assembly));
        var gone = '';
        if (open) {
            var w = entry(r, 'warehouse_of_gones'), g = entry(r, 'gone');
            if (st === 'gone') gone = '<label><input type="checkbox" class="warehouseOfGones" warehouseOfGonesId="' + w.id + '" goneId="' + g.id + '" checked> مخزن الهالك</label><br><label><input type="checkbox" class="damaged" goneId="' + g.id + '" checked> هالك</label>';
            else if (st === 'warehouse_of_gones') gone = '<label><input type="checkbox" class="warehouseOfGones" warehouseOfGonesId="' + w.id + '" checked> مخزن الهالك</label><br><label><input type="checkbox" class="damaged"> هالك</label>';
            else gone = '<label><input type="checkbox" class="warehouseOfGones"> مخزن الهالك</label>';
        }
        c.push(gone);
        var o = { DT_RowId: String(r.orderId) };
        c.forEach(function (v, i) { o[i] = v; });
        return o;
    }

    // ------------------------------------------------------------ filters
    function num(v) { return v === undefined || v === '' ? null : +v; }
    function inRange(v, f, t) { if (f === null && t === null) return true; if (v === null) return false; return (f === null || v >= f) && (t === null || v <= t); }
    function filtered(p, opt) {
        opt = opt || {};
        var q = (p.caseNameOrCode || '').trim().toLowerCase(), team = list(p.manufacturingTeam_ids).join(',').split(',').filter(Boolean);
        return rows.filter(function (r) {
            var st = current(r).status, last = current(r).date, d = daysOf(r), wd = weightDiff(r);
            if (q && (r.code + ' ' + r.name).toLowerCase().indexOf(q) === -1) return false;
            if (p.searchOrderType === 'New' && r.type !== 'new') return false;
            if (p.searchOrderType === 'Maintenance' && r.type !== 'maintenance') return false;
            if (p.booked === '1' && !r.booking) return false;
            if (p.booked === '0' && r.booking) return false;
            if (p.manufacturingLevelStatus && r.startPoint !== p.manufacturingLevelStatus) return false;
            if (p.manufacturingDateFrom && ymd(last) < p.manufacturingDateFrom) return false;
            if (p.manufacturingDateTo && ymd(last) > p.manufacturingDateTo) return false;
            if (p.visitDateFrom && (!r.booking || ymd(r.booking) < p.visitDateFrom)) return false;
            if (p.visitDateTo && (!r.booking || ymd(r.booking) > p.visitDateTo)) return false;
            if (!inRange(attempts(r), num(p.numberOfPrintingAttemptsFrom), num(p.numberOfPrintingAttemptsTo))) return false;
            if (!inRange(r.cycleNo, num(p.numberOfManufacturingCyclesFrom), num(p.numberOfManufacturingCyclesTo))) return false;
            if (!inRange(wd === null ? null : Math.abs(wd), num(p.diffDefaultActualWeightFrom), num(p.diffDefaultActualWeightTo))) return false;
            if (!inRange(r.quality, num(p.qualityOfPrintedPartsFrom), num(p.qualityOfPrintedPartsTo))) return false;
            if (!inRange(d.n, num(p.numberOfDaysBetweenMeasurementTakenAndReadyForDeliveryFrom), num(p.numberOfDaysBetweenMeasurementTakenAndReadyForDeliveryTo))) return false;
            if (team.length && [r.team.design, r.team.print, r.team.assembly].filter(function (x) { return team.indexOf(String(x)) !== -1; }).length === 0) return false;
            if (!opt.ignoreCycle) {
                if (p.cycleStatus === 'Open' && r.closed) return false;
                if (p.cycleStatus === 'Closed' && !r.closed) return false;
            }
            if (!opt.ignoreLevel && p.manufacturingCycleLevel && p.manufacturingCycleLevel !== 'all' && st !== p.manufacturingCycleLevel) return false;
            return true;
        }).sort(function (a, b) { return current(b).date - current(a).date; });
    }

    // ------------------------------------------------------------ popups content
    function designProgressRows(p) {
        var r = rowOf(p.orderId, p.cycleNumber), edit = p.actionMode === 'edit', dp = entry(r, 'design_progress');
        var eng = member(r.team.design);
        var row = [
            '<a href="javascript:void(0)">عرض التقرير</a>',
            '<a href="javascript:void(0)">عرض القياسات</a>',
            ymd(r.history[0].date),
            '<input type="checkbox" class="apply_design_progress" name="applyDesignProgress" value="1"' + (dp ? ' checked design_progress_id="' + dp.id + '"' : '') + (edit ? '' : ' disabled') + '>',
            dp ? '<span class="design-progress-date">' + stamp(dp.date) + '</span><input type="hidden" name="designProgressId" value="' + dp.id + '"><input type="hidden" name="designDate" value="' + stamp(dp.date) + '">' : '',
            (dp && eng ? esc(eng.text) : '') + (edit ? '<div class="designEngineerContainer" style="display: none;"><select class="engineerId form-control" name="engineerId" required>' + (eng ? '<option value="' + eng.id + '" selected>' + esc(eng.text) + '</option>' : '') + '</select></div>' : ''),
            edit ? '<textarea class="form-control" name="notes" rows="1"></textarea>' : ''
        ];
        return [row];
    }
    function printReadyRows(p) {
        var r = rowOf(p.orderId, p.cycleNumber), edit = p.actionMode === 'edit', st = current(r).status;
        var sessions = r.history.filter(function (h) { return h.status === 'print_ready'; }), pp = entry(r, 'print_progress');
        return sessions.map(function (s, i) {
            var isLast = i === sessions.length - 1, eng = member(s.engineer);
            var files = function (l) { return (l || []).map(function (f) { return '<a href="javascript:void(0)"><i class="fa fa-download"></i> ' + esc(f) + '</a>'; }).join('<br>') || '-'; };
            return [
                files(s.designFiles), files(s.printFiles), stamp(s.date), (s.materials || []).join('، ') || '-', esc(s.notes) || '-', eng ? esc(eng.text) : '-',
                edit && st === 'print_ready' ? '<button type="button" class="btn btn-danger btn-xs delete_print_ready" id="' + s.id + '"><i class="fa fa-trash"></i></button>' : '-',
                isLast ? '<input type="checkbox" class="apply_print_progress"' + (pp ? ' checked print_progress_id="' + pp.id + '"' : '') + (edit && (st === 'print_ready' || st === 'print_progress') ? '' : ' disabled') + '>' : '-'
            ];
        });
    }
    function printReadyForm(p) {
        var r = rowOf(p.Id, p.CycleNumber);
        if (p.ActionMode !== 'edit' || r.closed) return '';
        return '<div class="row">' +
            '<div class="col-md-6"><label class="control-label">ملفات التصميم</label><div class="control-fileupload designingFiles"><label for="designingFiles"></label><input type="file" id="designingFiles" name="designingFiles[]" multiple></div></div>' +
            '<div class="col-md-6"><label class="control-label">ملفات الطباعة</label><div class="control-fileupload printingFiles"><label for="printingFiles"></label><input type="file" id="printingFiles" name="printingFiles[]" multiple></div></div>' +
            '</div><div class="row" style="margin-top: 10px;">' +
            '<div class="col-md-4"><label class="control-label">مهندس التصميم</label><select class="engineerId form-control" name="engineerId"></select></div>' +
            '<div class="col-md-4"><label class="control-label">الخامات المطلوبة للطباعة</label><select class="manufacturingLevel form-control" name="materials[]" multiple>' + MATERIALS.map(function (m) { return '<option>' + m + '</option>'; }).join('') + '</select></div>' +
            '<div class="col-md-4"><label class="control-label">الملاحظات</label><textarea class="form-control" name="notes" rows="1"></textarea></div>' +
            '</div><div class="row" style="margin-top: 10px;"><div class="col-md-12"><button type="button" class="btn btn-primary" id="add-print-ready"><i class="fa fa-plus"></i> إضافة</button></div></div>';
    }
    function receivingPrintedForm(p) {
        var r = rowOf(p.Id, p.CycleNumber), edit = p.ActionMode === 'edit' && current(r).status === 'print_progress' && !r.closed;
        if (!edit) {
            var acc = entry(r, 'in_progress');
            return '<table class="table table-bordered"><tr><th>جودة الأجزاء المطبوعة</th><td>' + (acc ? acc.quality + '%' : '-') + '</td></tr><tr><th>تاريخ الاستلام</th><td>' + (acc ? stamp(acc.date) : '-') + '</td></tr></table>';
        }
        return '<div class="form-group"><label class="col-sm-3 control-label">جودة الأجزاء المطبوعة</label><div class="col-sm-6"><select class="form-control" name="qualityOfPrintedParts" required><option value="">اختر</option>' +
            [100, 95, 90, 85, 80, 70, 60, 50].map(function (q) { return '<option value="' + q + '">' + q + '%</option>'; }).join('') + '</select></div></div>' +
            '<div class="form-group"><label class="col-sm-3 control-label">الملاحظات</label><div class="col-sm-6"><textarea class="form-control" name="notes"></textarea></div></div>' +
            '<div class="text-center"><button type="button" class="btn btn-success" id="saveAccepted"><i class="fa fa-check"></i> قبول</button> <button type="button" class="btn btn-danger" id="saveNotAccepted"><i class="fa fa-times"></i> رفض (فشل فى الطباعة)</button></div>';
    }
    function receivingAssemblyForm(p) {
        var r = rowOf(p.Id, p.CycleNumber), edit = p.ActionMode === 'edit' && current(r).status === 'in_progress' && !r.closed;
        if (!edit) {
            var re = readyEntry(r), a = member(r.team.assembly);
            return '<table class="table table-bordered"><tr><th>فنى التجميع</th><td>' + (a ? esc(a.text) : '-') + '</td></tr><tr><th>الوزن الفعلى</th><td>' + (r.actualWeight === null ? '-' : r.actualWeight) + '</td></tr><tr><th>تاريخ الاستلام</th><td>' + (re ? stamp(re.date) : '-') + '</td></tr></table>';
        }
        return '<div class="form-group"><label class="col-sm-3 control-label">فنى التجميع</label><div class="col-sm-6"><select class="assemblyTechnicianId form-control" name="assemblyTechnicianId" required></select></div></div>' +
            '<div class="form-group"><label class="col-sm-3 control-label">الوزن الفعلى</label><div class="col-sm-6"><input type="number" class="form-control" name="actualWeight" required></div></div>' +
            '<div class="form-group"><label class="col-sm-3 control-label">الملاحظات</label><div class="col-sm-6"><textarea class="form-control" name="notes"></textarea></div></div>' +
            '<div class="text-center"><button type="button" class="btn btn-success" id="saveAcceptReceiving"><i class="fa fa-check"></i> قبول</button> <button type="button" class="btn btn-danger" id="saveNotAcceptReceiving"><i class="fa fa-times"></i> رفض (تلف أثناء التجميع)</button></div>';
    }
    function historyHtml(p) {
        var html = '';
        rowsOfOrder(p.Id).forEach(function (r) {
            html += '<h4 style="margin-top: 0;">الدورة رقم ' + r.cycleNo + ' <small>' + START_POINTS[r.startPoint] + (r.closed ? ' — متوقفة' : '') + '</small></h4>' +
                '<table class="table table-bordered table-striped"><thead><tr><th>#</th><th>الحالة</th><th>التاريخ</th></tr></thead><tbody>' +
                r.history.map(function (h, i) { return '<tr><td>' + (i + 1) + '</td><td><span class="dt-status-' + h.status + '" style="padding: 2px 6px; border-radius: 3px;">' + STATUS[h.status] + '</span></td><td>' + stamp(h.date) + '</td></tr>'; }).join('') +
                '</tbody></table>';
        });
        return html;
    }

    // ------------------------------------------------------------ actions (change the fake data)
    function failCycle(orderId, why) {
        var r = openRow(orderId);
        r.closed = true;
        newCycle(r, why, new Date());
    }
    function removeEntries(ids) {
        ids = list(ids).map(String);
        rows.forEach(function (r) {
            r.history = r.history.filter(function (h, i) { return i === 0 || ids.indexOf(String(h.id)) === -1; });
            // what the row shows comes from the steps it still has
            var acc = entry(r, 'in_progress');
            r.quality = acc ? acc.quality : null;
            if (!readyEntry(r)) { r.actualWeight = null; r.team.assembly = null; }
            if (!entry(r, 'print_progress')) r.team.print = null;
            if (!entry(r, 'design_progress')) r.team.design = null;
        });
    }

    // ------------------------------------------------------------ dashboard (same logic as the dashboard notes)
    var DELIVERY_DAMAGE = ['remanufacturing_damage_during_new_prosthetic_limb_delivery', 'remanufacturing_damage_during_maintenance_delivery'];
    function avg(l) { return l.length ? Math.round(l.reduce(function (a, b) { return a + b; }, 0) / l.length * 10) / 10 : null; }
    function between(d, f, t) { var s = ymd(d); return s >= f && s <= t; }
    function countEvents(list, f, t) {
        var o = { started: 0, designed: 0, printed: 0, ready: 0, delivered: 0, remade: 0, gone: 0 };
        list.forEach(function (r) {
            r.history.forEach(function (h, i) {
                if (!between(h.date, f, t) || h.restore) return;
                if (i === 0) { o.started++; if (r.cycleNo > 1) o.remade++; return; }
                if (h.status === 'print_ready') o.designed++;
                else if (h.status === 'print_progress') o.printed++;
                else if (/delivery_ready$/.test(h.status)) o.ready++;
                else if (h.status === 'delivered') o.delivered++;
                else if (h.status === 'gone') o.gone++;
            });
        });
        return o;
    }
    function dashboard(p) {
        var list = filtered(p, { ignoreLevel: true, ignoreCycle: true }), f = p.from, t = p.to;
        var ready = list.filter(function (r) { var re = readyEntry(r); return re && between(re.date, f, t); });
        var days = ready.map(function (r) { return daysOf(r).n; });
        var q = [];
        list.forEach(function (r) { var e = entry(r, 'in_progress'); if (e && between(e.date, f, t)) q.push(e.quality); });
        var designs = {}, assembly = {}, dmg = [0, 0, 0];
        ENGINEERS.forEach(function (m) { designs[m.id] = 0; });
        ASSEMBLERS.forEach(function (m) { assembly[m.id] = 0; });
        list.forEach(function (r) {
            r.history.forEach(function (h, i) {
                if (!between(h.date, f, t)) return;
                if (i === 0 && r.cycleNo > 1) {
                    if (r.startPoint === 'failed_to_print') dmg[0]++;
                    if (r.startPoint === 'remanufacturing_damage_to_the_end_during_assembly') dmg[1]++;
                    if (DELIVERY_DAMAGE.indexOf(r.startPoint) !== -1) dmg[2]++;
                }
                if (h.status === 'print_ready' && designs[h.engineer] !== undefined) designs[h.engineer]++;
                if (/delivery_ready$/.test(h.status) && !h.restore && assembly[r.team.assembly] !== undefined) assembly[r.team.assembly]++;
            });
        });
        function team(members, counts) { return members.map(function (m) { return { name: m.text, count: counts[m.id] }; }).sort(function (a, b) { return b.count - a.count; }); }
        var wd = ready.filter(function (r) { return weightDiff(r) !== null; }).map(function (r) { return Math.round(Math.abs(weightDiff(r)) * 10) / 10; });
        // trend: N buckets of the same unit, ending at the selected period
        var meta = { today: [14, 'آخر 14 يوم — عدد مستقل لكل يوم'], week: [10, 'آخر 10 أسابيع — عدد مستقل لكل أسبوع'], month: [12, 'آخر 12 شهر — عدد مستقل لكل شهر'], quarter: [6, 'آخر 6 أرباع — عدد مستقل لكل ربع'], year: [3, 'آخر 3 سنوات — عدد مستقل لكل سنة'] }[p.period];
        var end = moment.min(moment(t), moment()), trend = [];
        for (var i = meta[0] - 1; i >= 0; i--) {
            var b, e, name;
            if (p.period === 'today') { b = end.clone().subtract(i, 'days'); e = b.clone(); name = b.format('DD/MM'); }
            else if (p.period === 'week') { e = end.clone().subtract(i * 7, 'days'); b = e.clone().subtract(6, 'days'); name = b.format('DD/MM'); }
            else if (p.period === 'month') { b = end.clone().subtract(i, 'months').startOf('month'); e = b.clone().endOf('month'); name = b.format('MM/YYYY'); }
            else if (p.period === 'quarter') { b = end.clone().subtract(i * 3, 'months').startOf('quarter'); e = b.clone().endOf('quarter'); name = 'Q' + b.quarter() + ' ' + b.format('YYYY'); }
            else { b = end.clone().subtract(i, 'years').startOf('year'); e = b.clone().endOf('year'); name = b.format('YYYY'); }
            var bf = b.format('YYYY-MM-DD'), bt = e.format('YYYY-MM-DD');
            var pt = $.extend({ name: name }, countEvents(list, bf, bt));
            pt.avgDays = avg(list.filter(function (r) { var re = readyEntry(r); return re && between(re.date, bf, bt); }).map(function (r) { return daysOf(r).n; }));
            trend.push(pt);
        }
        return {
            key: p.period, from: f, to: t,
            values: countEvents(list, f, t),
            days: {
                n: ready.length, avg: avg(days), min: days.length ? Math.min.apply(null, days) : null, max: days.length ? Math.max.apply(null, days) : null,
                avgNew: avg(ready.filter(function (r) { return r.type === 'new'; }).map(function (r) { return daysOf(r).n; })),
                avgMaint: avg(ready.filter(function (r) { return r.type === 'maintenance'; }).map(function (r) { return daysOf(r).n; })),
                within14: days.filter(function (x) { return x <= 14; }).length, weight: avg(wd)
            },
            quality: { avg: avg(q), n: q.length },
            team: {
                designs: team(ENGINEERS, designs), assembly: team(ASSEMBLERS, assembly),
                damage: [{ name: 'فشل فى الطباعة', count: dmg[0] }, { name: 'تلف أثناء التجميع', count: dmg[1] }, { name: 'تلف أثناء التسليم', count: dmg[2] }]
            },
            trend: trend, trendLabel: meta[1]
        };
    }

    // ------------------------------------------------------------ router
    var OK = { status: true };
    function handle(url, p) {
        var path = url.replace(/^https?:\/\/[^/]+/, '').split('?')[0];
        var act = path.split('/').pop();
        switch (act) {
            case 'orders_manufacturing_pagination':
                var all = filtered(p), start = +p.iDisplayStart || 0, len = +p.iDisplayLength || 20;
                return { sEcho: p.sEcho, iTotalRecords: all.length, iTotalDisplayRecords: all.length, aaData: (len === -1 ? all : all.slice(start, start + len)).map(cells) };
            case 'get_manufacturing_status_count':
                var counts = {};
                Object.keys(STATUS).forEach(function (s) { counts[s] = { open: 0, closed: 0 }; });
                filtered(p, { ignoreLevel: true, ignoreCycle: true }).forEach(function (r) { counts[current(r).status][r.closed ? 'closed' : 'open']++; });
                return counts;
            case 'manufacturing_dashboard': return dashboard(p);
            case 'order_sessions_design_progress_pagination':
                var d1 = designProgressRows(p); return { sEcho: p.sEcho, iTotalRecords: d1.length, iTotalDisplayRecords: d1.length, aaData: d1 };
            case 'order_sessions_print_ready_pagination':
                var d2 = printReadyRows(p); return { sEcho: p.sEcho, iTotalRecords: d2.length, iTotalDisplayRecords: d2.length, aaData: d2 };
            case 'get_print_ready_form': return printReadyForm(p);
            case 'get_receiving_printed_parts_form': return receivingPrintedForm(p);
            case 'get_receiving_from_assembly_form': return receivingAssemblyForm(p);
            case 'get_manufacturing_history': return historyHtml(p);

            case 'add_order_design_progress':
                var r1 = openRow(p.orderId), dp = entry(r1, 'design_progress');
                if (p.designDate && !dp) { push(r1, 'design_progress', new Date()); r1.team.design = +p.engineerId || null; }
                else if (!p.designDate && dp && current(r1) === dp) removeEntries([dp.id]);
                return OK;
            case 'add_order_print_ready':
                var r2 = openRow(p.orderId), meta = JSON.parse(p.filesMeta || '[]');
                push(r2, 'print_ready', new Date(), {
                    designFiles: meta.filter(function (m) { return m.type === 'design'; }).map(function (m) { return m.name; }),
                    printFiles: meta.filter(function (m) { return m.type === 'print'; }).map(function (m) { return m.name; }),
                    materials: list(p['materials[]']), notes: p.notes || '', engineer: +p.engineerId || r2.team.design
                });
                if (p.engineerId) r2.team.design = +p.engineerId;
                return { status: true, uploads: [] };
            case 'add_order_print_progress': var r3 = openRow(p.orderId); push(r3, 'print_progress', new Date()); r3.team.print = pick(PRINTERS).id; return OK;
            case 'accept_receiving_printed_parts': var r4 = openRow(p.orderId); r4.quality = +p.qualityOfPrintedParts || 100; push(r4, 'in_progress', new Date(), { quality: r4.quality }); return OK;
            case 'reject_receiving_printed_parts': failCycle(p.orderId, 'failed_to_print'); return OK;
            case 'accept_receiving_from_assembly':
                var r5 = openRow(p.orderId); r5.team.assembly = +p.assemblyTechnicianId || ASSEMBLERS[0].id; r5.actualWeight = +p.actualWeight || r5.defaultWeight; push(r5, readyStatus(r5), new Date()); return OK;
            case 'reject_receiving_from_assembly': failCycle(p.orderId, 'remanufacturing_damage_to_the_end_during_assembly'); return OK;
            case 'add_order_out_for_delivery': push(openRow(p.orderId), 'out_for_delivery', new Date()); return OK;
            case 'restore_order': var r6 = openRow(p.orderId); push(r6, readyStatus(r6), new Date(), { restore: true }); return OK;
            case 'remove_restore_order': var r7 = openRow(p.orderId); if (current(r7).restore) removeEntries([current(r7).id]); return OK;
            case 'add_order_warehouse_of_gones': push(openRow(p.orderId), 'warehouse_of_gones', new Date()); return OK;
            case 'order_damaged': push(openRow(p.orderId), 'gone', new Date()); return OK;
            case 'remove_order_manufacturing': removeEntries(p['manufacturingId[]'] !== undefined ? p['manufacturingId[]'] : p.manufacturingId); return OK;

            case 'engineer': return ENGINEERS;
            case 'assembly_technician': return ASSEMBLERS;
            case 'autocompleteMembers': return ENGINEERS.concat(PRINTERS, ASSEMBLERS);
            case 'isLoggedIn': return '1';
            case 'get_user_notifications': return { count: 0, list: '' };
            case 'get_calendar_view': return { html: $('#calendar-ajax-container').html(), label: $('#cal-current-label').text() };
            default: return OK;
        }
    }

    // every ajax call to the CMS host is answered here (after a short delay, like a real request)
    $.ajaxTransport('+*', function (opts) {
        if (!HOST.test(opts.url)) return;
        var timer;
        return {
            send: function (headers, done) {
                var p = parseQuery(opts.url.split('?')[1]);
                if (opts.data instanceof FormData) opts.data.forEach(function (v, k) { if (typeof v === 'string') p[k] = p[k] === undefined ? v : [].concat(p[k], v); });
                else if (typeof opts.data === 'string') parseQuery(opts.data, p);
                timer = setTimeout(function () {
                    var res;
                    try { res = handle(opts.url, p); } catch (e) { console.error('mock server', opts.url, e); return done(500, 'error'); }
                    done(200, 'success', { text: typeof res === 'string' ? res : JSON.stringify(res) }, 'Content-Type: text/html; charset=utf-8');
                }, 120);
            },
            abort: function () { clearTimeout(timer); }
        };
    });
})(jQuery);
