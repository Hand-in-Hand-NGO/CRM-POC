<?php
// تصدير واستيراد بيانات النظام بملف Excel موحّد: التصدير والقالب والنسخة الاحتياطية بنفس الأوراق والأعمدة وترتيبها،
// علشان الملف اللي بيتنزل يتملى ويترفع تاني زي ما هو. الربط بين الأوراق بالأكواد، مش بأرقام الصفوف.
require_once __DIR__ . '/xlsx.php';

const DX_VERSION = 'CUSTODY-XLSX-1';
const DX_MAX_ROWS = 5000;
const DX_MAX_FILE_MB = 10;
const DX_INFO_SHEET = 'تعليمات';
const DX_LIST_LIMIT = 300;

class DxError extends Exception
{
}

// ---------------------------------------------------------------- بنية الملف

function dx_spec()
{
    static $spec = null;
    if ($spec !== null) {
        return $spec;
    }
    $ro = function ($key, $title, $width = 16, $kind = 'text') {
        return ['key' => $key, 'title' => $title . ' (للقراءة فقط)', 'head' => 'ro', 'kind' => $kind, 'width' => $width];
    };
    $spec = [];
    $spec['employees'] = ['name' => 'الموظفين', 'cols' => [
        ['key' => 'code', 'title' => 'كود الموظف *', 'head' => 'req', 'width' => 14, 'ltr' => true, 'max' => 64,
            'help' => 'ثابت ومايتكررش. بيه بيترَبط الموظف بالعهد. مطلوب للموظف الجديد'],
        ['key' => 'name', 'title' => 'الاسم *', 'head' => 'req', 'width' => 28, 'help' => 'مطلوب للموظف الجديد'],
        ['key' => 'national_id', 'title' => 'الرقم القومي', 'width' => 18, 'ltr' => true, 'max' => 32, 'help' => 'نص (14 رقم)'],
        ['key' => 'department', 'title' => 'القسم', 'width' => 18],
        ['key' => 'job_title', 'title' => 'الوظيفة', 'width' => 18],
        ['key' => 'branch', 'title' => 'الفرع', 'width' => 16],
        ['key' => 'phone', 'title' => 'الموبايل', 'width' => 15, 'ltr' => true, 'max' => 32, 'help' => 'نص، علشان الصفر اللي في الأول'],
        ['key' => 'email', 'title' => 'البريد الإلكتروني', 'width' => 24, 'ltr' => true],
        ['key' => 'active', 'title' => 'الحالة', 'kind' => 'list', 'list' => ['نشط', 'موقوف'], 'width' => 10, 'help' => 'فاضي = نشط للموظف الجديد'],
        ['key' => 'notes', 'title' => 'ملاحظات', 'width' => 24, 'max' => 2000],
        $ro('active_count', 'أصناف في عهدته', 14, 'number'),
        $ro('created_at', 'تاريخ الإضافة', 18),
    ]];
    foreach (asset_types() as $t => $def) {
        $cols = [['key' => 'code', 'title' => 'كود الأصل', 'width' => 14, 'ltr' => true, 'max' => 64,
            'help' => 'فاضي = بيتولد تلقائيًا (' . $def['prefix'] . '-00001). لو كتبته لازم مايتكررش. الصنف الموجود بيتعرف بالكود أو بالرقم التسلسلي']];
        foreach ($def['fields'] as $f) {
            $in = $f['input'] ?? 'text';
            $c = ['key' => $f['key'], 'field' => $f, 'width' => 16, 'ltr' => !empty($f['ltr'])];
            if ($in === 'item_ref') {
                $refKey = '';
                foreach (asset_types()[$f['ref_type']]['fields'] as $rf) {
                    if ($rf['key'] === 'serial_no') {
                        $refKey = $rf['label'];
                    }
                }
                $c += ['kind' => 'ref', 'title' => $f['label'] . ' (الكود أو ' . $refKey . ')', 'ltr' => true, 'width' => 22,
                    'help' => 'كود ' . type_label($f['ref_type']) . ' (مثل ' . asset_types()[$f['ref_type']]['prefix'] . '-00003) أو ' . $refKey . '. لازم تكون موجودة في النظام أو في نفس الملف، ومش مربوطة بجهاز تاني'];
            } elseif ($in === 'checks') {
                $c += ['kind' => 'checks', 'title' => $f['label'], 'width' => 24, 'help' => 'قيمة أو أكتر مفصولين بفاصلة (،)'];
            } else {
                $c += ['kind' => $in === 'date' ? 'date' : ($in === 'number' ? 'number' : (!empty($f['options']) ? 'list' : 'text')),
                    'title' => $f['label'] . (!empty($f['required']) ? ' *' : ''), 'head' => !empty($f['required']) ? 'req' : 'opt'];
                if (!empty($f['options'])) {
                    $c['list'] = $f['options'];
                }
                if (!empty($f['pattern_msg'])) {
                    $c['help'] = $f['pattern_msg'];
                }
            }
            if (in_array($f['key'], ['serial_no', 'tid', 'mid', 'imei2', 'iccid', 'mac'], true)) {
                $c['width'] = 20;
            }
            $cols[] = $c;
        }
        $cols[] = ['key' => 'purchase_date', 'title' => 'تاريخ الشراء', 'kind' => 'date', 'width' => 13];
        $cols[] = ['key' => 'value', 'title' => 'القيمة', 'kind' => 'number', 'width' => 11];
        $cols[] = ['key' => 'item_condition', 'title' => 'الحالة الفنية', 'kind' => 'list', 'list' => ITEM_CONDITIONS, 'width' => 13, 'help' => 'فاضي = جيد للصنف الجديد'];
        $cols[] = ['key' => 'status', 'title' => 'الوضع', 'kind' => 'list', 'list' => ITEM_STATUSES, 'width' => 11,
            'help' => 'فاضي = متاحة للصنف الجديد. «مسلمة» بتتحدد لوحدها من ورقة العهد ومتتكتبش بإيدك'];
        $cols[] = ['key' => 'location', 'title' => 'المكان', 'width' => 16];
        $cols[] = ['key' => 'notes', 'title' => 'ملاحظات', 'width' => 24, 'max' => 2000];
        $cols[] = $ro('name', 'اسم الصنف', 24);
        $cols[] = $ro('holder', 'في عهدة', 22);
        $cols[] = $ro('created_at', 'تاريخ الإضافة', 18);
        $spec['items:' . $t] = ['name' => $def['plural'], 'type' => $t, 'cols' => $cols];
    }
    $spec['custody'] = ['name' => 'العهد', 'cols' => [
        ['key' => 'out_doc', 'title' => 'رقم سند التسليم (تلقائي)', 'head' => 'ro', 'width' => 17, 'ltr' => true,
            'help' => 'سيبه فاضي للعهدة الجديدة. النظام بيعمل سند تسليم لكل موظف وتاريخ'],
        ['key' => 'employee_code', 'title' => 'كود الموظف *', 'head' => 'req', 'width' => 14, 'ltr' => true, 'max' => 64,
            'help' => 'موظف موجود في النظام أو في ورقة الموظفين'],
        ['key' => 'item', 'title' => 'كود الأصل أو الرقم التسلسلي *', 'head' => 'req', 'width' => 20, 'ltr' => true, 'max' => 190,
            'help' => 'صنف موجود في النظام أو في أوراق الأصناف، وحالته «متاحة» ومش في عهدة حد'],
        ['key' => 'assigned_at', 'title' => 'تاريخ التسليم *', 'head' => 'req', 'kind' => 'date', 'width' => 13],
        ['key' => 'condition_out', 'title' => 'الحالة عند التسليم', 'kind' => 'list', 'list' => ITEM_CONDITIONS, 'width' => 17,
            'help' => 'فاضي = الحالة الفنية الحالية للصنف'],
        ['key' => 'notes_out', 'title' => 'ملاحظات التسليم', 'width' => 24, 'max' => 500],
        $ro('employee_name', 'اسم الموظف', 24),
        $ro('item_type', 'نوع الصنف', 12),
        $ro('item_name', 'الصنف', 22),
        $ro('ack', 'حالة توقيع السند', 18),
        $ro('returned_at', 'تاريخ الارتجاع', 13),
        $ro('in_doc', 'رقم سند الارتجاع', 17),
        $ro('condition_in', 'الحالة عند الارتجاع', 14),
    ]];
    $spec['handovers'] = ['name' => 'السندات (للقراءة فقط)', 'readonly' => true, 'cols' => array_map(function ($c) {
        return ['key' => $c[0], 'title' => $c[1], 'head' => 'ro', 'width' => $c[2], 'kind' => $c[3] ?? 'text'];
    }, [
        ['doc_no', 'رقم السند', 16], ['type', 'النوع', 9], ['doc_date', 'التاريخ', 12], ['employee_code', 'كود الموظف', 13],
        ['employee_name', 'الموظف', 24], ['department', 'القسم', 16], ['items_count', 'عدد الأصناف', 10, 'number'],
        ['ack', 'حالة التوقيع', 18], ['ack_at', 'وقت التوقيع الإلكتروني', 18], ['ack_name', 'الاسم في التوقيع الإلكتروني', 22],
        ['paper_signed_on', 'تاريخ التوقيع الورقي', 14], ['notes', 'ملاحظات', 24], ['created_by', 'أنشأه', 16], ['created_at', 'وقت الإنشاء', 18],
    ])];
    return $spec;
}

function dx_col_title(array $c)
{
    return $c['title'];
}

// ---------------------------------------------------------------- التصدير

function dx_export_rows()
{
    $out = [];
    $out['employees'] = array_map(function ($e) {
        $e['active'] = $e['active'] ? 'نشط' : 'موقوف';
        return $e;
    }, q_all("SELECT e.*, (SELECT COUNT(*) FROM custody c WHERE c.employee_id = e.id AND c.in_handover_id IS NULL) AS active_count
        FROM employees e ORDER BY e.code, e.name"));
    $codes = array_column(q_all('SELECT id, code FROM items'), 'code', 'id');
    foreach (asset_types() as $t => $def) {
        $rows = decorate_items(q_all("SELECT i.*, e.name AS holder_name, e.code AS holder_code FROM items i
            LEFT JOIN custody c ON c.item_id = i.id AND c.in_handover_id IS NULL LEFT JOIN employees e ON e.id = c.employee_id
            WHERE i.type = ? ORDER BY i.code", [$t]));
        $out['items:' . $t] = array_map(function ($r) use ($def, $codes) {
            $row = ['code' => $r['code'], 'purchase_date' => $r['purchase_date'], 'value' => $r['value'], 'item_condition' => $r['item_condition'],
                'status' => $r['status'], 'location' => $r['location'], 'notes' => $r['notes'], 'name' => $r['name'], 'created_at' => $r['created_at'],
                'holder' => $r['holder_name'] ? $r['holder_name'] . ($r['holder_code'] ? ' (' . $r['holder_code'] . ')' : '') : ''];
            foreach ($def['fields'] as $f) {
                if (($f['input'] ?? '') === 'item_ref') {
                    $id = ((array)$r['refs'])[$f['key']] ?? null;
                    $row[$f['key']] = $id ? ($codes[$id] ?? '') : '';
                    continue;
                }
                $v = $r['specs'][$f['key']] ?? '';
                $row[$f['key']] = is_array($v) ? implode('، ', $v) : $v;
            }
            return $row;
        }, $rows);
    }
    $out['custody'] = array_map(function ($r) {
        return ['out_doc' => $r['out_doc_no'], 'employee_code' => $r['employee_code'], 'item' => $r['code'], 'assigned_at' => $r['assigned_at'],
            'condition_out' => $r['condition_out'], 'notes_out' => $r['notes_out'], 'employee_name' => $r['employee_name'], 'item_type' => type_label($r['type']),
            'item_name' => $r['item_name'], 'ack' => ack_status_text($r['out_ack_at'], $r['out_paper_on']), 'returned_at' => $r['returned_at'],
            'in_doc' => $r['in_doc_no'], 'condition_in' => $r['condition_in']];
    }, q_all('SELECT c.*, i.code, i.type, i.name AS item_name, e.code AS employee_code, e.name AS employee_name,
            ho.doc_no AS out_doc_no, ho.ack_at AS out_ack_at, ho.paper_signed_on AS out_paper_on, hi.doc_no AS in_doc_no
        FROM custody c JOIN items i ON i.id = c.item_id JOIN employees e ON e.id = c.employee_id
        JOIN handovers ho ON ho.id = c.out_handover_id LEFT JOIN handovers hi ON hi.id = c.in_handover_id
        ORDER BY c.out_handover_id, c.id'));
    $out['handovers'] = array_map(function ($h) {
        $h['type'] = $h['type'] === 'out' ? 'تسليم' : 'ارتجاع';
        $h['ack'] = ack_status_text($h['ack_at'], $h['paper_signed_on']);
        return $h;
    }, q_all('SELECT h.doc_no, h.type, h.doc_date, h.ack_at, h.ack_name, h.paper_signed_on, h.notes, h.created_at,
            e.code AS employee_code, e.name AS employee_name, e.department, u.name AS created_by,
            (SELECT COUNT(*) FROM custody c WHERE c.out_handover_id = h.id OR c.in_handover_id = h.id) AS items_count
        FROM handovers h JOIN employees e ON e.id = h.employee_id LEFT JOIN users u ON u.id = h.created_by ORDER BY h.id'));
    return $out;
}

// $kind: export (تصدير) / template (قالب فاضي) / backup (نسخة احتياطية). نفس الأوراق والأعمدة في الثلاثة
function dx_workbook($kind)
{
    $data = $kind === 'template' ? [] : dx_export_rows();
    $sheets = [dx_info_sheet($kind)];
    $counts = [];
    foreach (dx_spec() as $key => $sh) {
        $rows = array_map(function ($r) use ($sh) {
            return array_map(function ($c) use ($r) {
                $v = $r[$c['key']] ?? null;
                return $v === null ? '' : (string)$v;
            }, $sh['cols']);
        }, $data[$key] ?? []);
        $counts[$key] = count($rows);
        $sheets[] = ['name' => $sh['name'], 'cols' => $sh['cols'], 'rows' => $rows, 'table' => true];
    }
    return [$sheets, $counts];
}

function dx_write_workbook($path, $kind)
{
    [$sheets, $counts] = dx_workbook($kind);
    xlsx_write($path, $sheets, ['title' => cfg('app_name') . ' — ' . DX_VERSION, 'creator' => cfg('org_name')]);
    return $counts;
}

function dx_info_sheet($kind)
{
    $kinds = ['export' => 'تصدير بيانات', 'template' => 'قالب استيراد فاضي', 'backup' => 'نسخة احتياطية (بيانات للقراءة)'];
    $rows = [];
    $styles = [];
    $merges = [];
    $heights = [];
    $add = function (array $cells, $style = null) use (&$rows, &$styles) {
        if ($style !== null) {
            $styles[count($rows)] = $style;
        }
        $rows[] = $cells;
    };
    $add(['قالب بيانات نظام ' . cfg('app_name') . ' — ' . cfg('org_name')], XS_TITLE);
    $add([['v' => 'إصدار القالب', 's' => XS_BOLD], DX_VERSION]);
    $add([['v' => 'نوع الملف', 's' => XS_BOLD], $kinds[$kind] ?? $kind]);
    $add([['v' => 'تاريخ الإنشاء', 's' => XS_BOLD], now()]);
    $add([]);
    $add(['طريقة تجهيز الملف'], XS_TITLE);
    foreach ([
        '1. نفس شكل تصدير النظام بالظبط: نفس أسماء الأوراق والأعمدة وترتيبها. ماتغيّرش أسماء الأوراق ولا عناوين الأعمدة ولا ترتيبها، وماتمسحش ورقة «تعليمات».',
        '2. ضيف السجلات الجديدة في صفوف جديدة تحت البيانات. الصفوف الموجودة سيبها زي ما هي أو امسحها من الملف، مش هتتمسح من النظام.',
        '3. العناوين الخضرا عليها * مطلوبة للسجل الجديد، والزرقا اختيارية، والرمادية (للقراءة فقط / تلقائي) بيملاها النظام وأي تعديل فيها بيتجاهل.',
        '4. التواريخ بالشكل 2026-10-29 (سنة-شهر-يوم). مقبول كمان 29/10/2026 أو تاريخ Excel عادي.',
        '5. الأكواد والأرقام التسلسلية وIMEI وTID وMID وأرقام الموبايل والرقم القومي بتتكتب كنص علشان الأصفار اللي في أولها ماتضيعش. الأعمدة متنسقة نص جاهز، ولو بتلصق من ملف تاني استخدم «لصق القيم فقط».',
        '6. الربط بين الأوراق بالأكواد مش بأرقام الصفوف: العهدة بتشاور على «كود الموظف» و«كود الأصل» أو الرقم التسلسلي، وماكينة POS بتشاور على كود الشريحة أو رقم الخط.',
        '7. عهدة جديدة: في ورقة «العهد» سيب «رقم سند التسليم» فاضي. صفوف نفس الموظف بنفس التاريخ بتتجمع في سند تسليم واحد «بانتظار التوقيع». الصنف لازم يكون «متاحة» ومش في عهدة حد.',
        '8. الخلية الفاضية معناها «من غير تغيير» ومابتمسحش قيمة موجودة. وغياب أي سجل من الملف مابيمسحوش من النظام.',
        '9. التوقيعات وحالة التوقيع والإقرارات الموقّعة وكلمات المرور والصلاحيات مابتتستوردش من الملف. ورقة «السندات» للمراجعة بس. ارتجاع العهد بيتعمل من النظام.',
        '10. قبل الحفظ النظام بيعرض معاينة: الجديد والموجود والتعديلات والأخطاء برقم الصف والعمود. ولو فيه خطأ واحد مفيش أي حاجة بتتحفظ.',
        '11. الوضع الافتراضي «إضافة سجلات جديدة فقط». تحديث السجلات الموجودة اختيار منفصل لمدير النظام، وبيظهر فيه كل تعديل قبل التأكيد.',
        '12. رفع نفس الملف تاني مابيكررش البيانات: الموظف بيتعرف بكوده، والصنف بكوده أو برقمه التسلسلي، والعهدة بالموظف والصنف.',
    ] as $line) {
        // السطر متدمج على عرض الورقة كلها وبيلف، علشان مايتقصّش في Excel
        $merges[] = [count($rows), 0, 5];
        $heights[count($rows)] = 32;
        $add([$line], XS_WRAP);
    }
    $add([]);
    $add(['الأعمدة'], XS_TITLE);
    $add([['v' => 'الورقة', 's' => XS_HEAD_OPT], ['v' => 'العمود', 's' => XS_HEAD_OPT], ['v' => 'مطلوب؟', 's' => XS_HEAD_OPT],
        ['v' => 'نوع البيانات', 's' => XS_HEAD_OPT], ['v' => 'القيم المسموحة / الصيغة', 's' => XS_HEAD_OPT], ['v' => 'ملاحظات', 's' => XS_HEAD_OPT]]);
    $kindText = ['text' => 'نص', 'date' => 'تاريخ', 'number' => 'رقم', 'list' => 'اختيار من قائمة', 'checks' => 'قيم متعددة', 'ref' => 'كود'];
    foreach (dx_spec() as $sh) {
        foreach ($sh['cols'] as $c) {
            $kindC = $c['kind'] ?? 'text';
            $allowed = '';
            if (!empty($c['list'])) {
                $allowed = implode('، ', $c['list']);
            } elseif ($kindC === 'checks') {
                $allowed = implode('، ', $c['field']['options']);
            } elseif ($kindC === 'date') {
                $allowed = 'سنة-شهر-يوم، مثال 2026-10-29';
            } elseif ($kindC === 'number') {
                $allowed = 'رقم أكبر من أو يساوي صفر';
            }
            $req = ($c['head'] ?? '') === 'ro' ? 'تلقائي (للقراءة فقط)' : (($c['head'] ?? '') === 'req' ? 'مطلوب للجديد' : 'اختياري');
            $add([['v' => $sh['name'], 's' => XS_WRAP], ['v' => $c['title'], 's' => XS_WRAP], ['v' => $req, 's' => XS_WRAP],
                ['v' => $kindText[$kindC] ?? 'نص', 's' => XS_WRAP], ['v' => $allowed, 's' => XS_WRAP], ['v' => $c['help'] ?? '', 's' => XS_WRAP]]);
        }
    }
    $w = [22, 30, 16, 14, 42, 60];
    return ['name' => DX_INFO_SHEET, 'cols' => array_map(function ($x) {
        return ['width' => $x, 'head' => 'opt'];
    }, $w), 'rows' => $rows, 'styles' => $styles, 'merges' => $merges, 'heights' => $heights];
}

// ---------------------------------------------------------------- قراءة الملف المرفوع

function dx_imports_dir()
{
    $dir = rtrim((string)cfg('imports_path'), '/\\');
    if ($dir === '') {
        $dir = dirname(cfg('db')['sqlite_path'] ?? (__DIR__ . '/data/custody.sqlite')) . '/imports';
    }
    if (!is_dir($dir) && !@mkdir($dir, 0700, true)) {
        throw new DxError('تعذر إنشاء فولدر ملفات الاستيراد على السيرفر');
    }
    return $dir;
}

// يقرأ الملف ويتأكد إنه من قالب النظام وبنفس الأعمدة. يرجع ['sheets' => [key => [[row, v => [colKey => cell]]]], 'errors' => [], 'warnings' => []]
function dx_read($path)
{
    try {
        $book = xlsx_read($path, DX_MAX_ROWS);
    } catch (XlsxError $e) {
        throw new DxError($e->getMessage());
    }
    $out = ['sheets' => [], 'errors' => [], 'warnings' => [], 'date1904' => $book['date1904']];
    $info = $book['sheets'][DX_INFO_SHEET] ?? null;
    $version = null;
    foreach (array_slice($info ?? [], 0, 15, true) as $cells) {
        foreach ($cells as $c) {
            if (preg_match('/^CUSTODY-XLSX-\S+$/', trim($c['v']))) {
                $version = trim($c['v']);
            }
        }
    }
    if ($version === null) {
        throw new DxError('الملف ده مش من قالب النظام (مفيش ورقة «' . DX_INFO_SHEET . '» فيها إصدار القالب). نزّل «قالب الاستيراد» أو «تصدير البيانات» من النظام واملاه.');
    }
    if ($version !== DX_VERSION) {
        throw new DxError('إصدار القالب في الملف (' . $version . ') مختلف عن إصدار النظام (' . DX_VERSION . '). نزّل قالب جديد وانقل البيانات عليه.');
    }
    $known = [DX_INFO_SHEET => true];
    foreach (dx_spec() as $key => $sh) {
        $known[$sh['name']] = true;
        if (!isset($book['sheets'][$sh['name']])) {
            $out['warnings'][] = ['sheet' => $sh['name'], 'row' => '', 'col' => '', 'msg' => 'الورقة مش موجودة في الملف، واتعدّت'];
            continue;
        }
        $rows = $book['sheets'][$sh['name']];
        $head = $rows[1] ?? [];
        $bad = false;
        $max = $head ? max(array_keys($head)) : -1;
        for ($i = 0; $i <= max($max, count($sh['cols']) - 1); $i++) {
            $want = $sh['cols'][$i]['title'] ?? '';
            $got = trim($head[$i]['v'] ?? '');
            if ($want !== $got) {
                $bad = true;
                $out['errors'][] = ['sheet' => $sh['name'], 'row' => 1, 'col' => xlsx_col($i),
                    'msg' => $want === '' ? 'عمود زيادة «' . $got . '» مش موجود في القالب' : 'عنوان العمود المفروض «' . $want . '»' . ($got === '' ? ' والخانة فاضية' : ' ولقيت «' . $got . '»')];
            }
        }
        if ($bad || !empty($sh['readonly'])) {
            continue;
        }
        $list = [];
        foreach ($rows as $n => $cells) {
            if ($n <= 1) {
                continue;
            }
            $v = [];
            $any = false;
            foreach ($sh['cols'] as $i => $c) {
                if (!isset($cells[$i])) {
                    continue;
                }
                $v[$c['key']] = $cells[$i];
                if (($c['head'] ?? '') !== 'ro' || $c['key'] === 'out_doc') {
                    $any = $any || trim($cells[$i]['v']) !== '';
                }
            }
            if ($any) {
                $list[] = ['row' => $n, 'v' => $v];
            }
        }
        $out['sheets'][$key] = $list;
    }
    foreach ($book['sheets'] as $name => $rows) {
        if (!isset($known[$name]) && $rows) {
            $out['warnings'][] = ['sheet' => $name, 'row' => '', 'col' => '', 'msg' => 'ورقة مش من القالب، واتجاهلت'];
        }
    }
    return $out;
}

// ---------------------------------------------------------------- التحقق وخطة الاستيراد

function dx_digits($s)
{
    return strtr($s, ['٠' => '0', '١' => '1', '٢' => '2', '٣' => '3', '٤' => '4', '٥' => '5', '٦' => '6', '٧' => '7', '٨' => '8', '٩' => '9',
        '۰' => '0', '۱' => '1', '۲' => '2', '۳' => '3', '۴' => '4', '۵' => '5', '۶' => '6', '۷' => '7', '۸' => '8', '۹' => '9']);
}

function dx_num_text($v)
{
    $f = (float)$v;
    if (floor($f) == $f && abs($f) < 1e15) {
        return sprintf('%.0f', $f);
    }
    return rtrim(rtrim(sprintf('%.6F', $f), '0'), '.');
}

class DxPlan
{
    public $mode;
    public $date1904 = false;
    public $errors = [];
    public $warnings = [];
    public $counts = [];
    public $new = [];
    public $updates = [];
    public $ignored = [];
    public $ops = ['emp_new' => [], 'emp_upd' => [], 'item_new' => [], 'item_upd' => [], 'links' => [], 'custody' => []];

    function __construct($mode)
    {
        $this->mode = $mode;
        foreach (dx_spec() as $key => $sh) {
            $this->counts[$key] = ['new' => 0, 'same' => 0, 'update' => 0, 'ignored' => 0, 'errors' => 0];
        }
    }

    function err($key, $row, $colKey, $msg)
    {
        $sh = dx_spec()[$key];
        $col = '';
        foreach ($sh['cols'] as $i => $c) {
            if ($c['key'] === $colKey) {
                $col = xlsx_col($i) . ' — ' . $c['title'];
            }
        }
        $this->errors[] = ['sheet' => $sh['name'], 'row' => $row, 'col' => $col, 'msg' => $msg];
        $this->counts[$key]['errors']++;
    }

    function rec($list, $key, $row, $label, $changes = [])
    {
        $item = ['sheet' => dx_spec()[$key]['name'], 'row' => $row, 'key' => $label[0], 'label' => $label[1]];
        if ($changes) {
            $item['changes'] = $changes;
        }
        $this->{$list}[] = $item;
    }

    // قيمة خلية بعد التنظيف حسب نوع العمود. يرجع null لو فيها خطأ (والخطأ اتسجل)
    function val($key, array $r, array $c)
    {
        $cell = $r['v'][$c['key']] ?? null;
        if (!$cell) {
            return '';
        }
        $kind = $c['kind'] ?? 'text';
        $v = $cell['v'];
        if ($cell['num'] && $kind !== 'date') {
            $v = dx_num_text($v);
        }
        $v = str_replace(["\u{200E}", "\u{200F}", "\u{200B}", "\u{FEFF}", "\u{00A0}"], ['', '', '', '', ' '], $v);
        $v = trim(preg_replace('/[ \t]+/u', ' ', $v));
        if (!empty($c['ltr']) || in_array($kind, ['date', 'number', 'ref'], true)) {
            $v = dx_digits($v);
        }
        if ($v === '') {
            return '';
        }
        $max = $c['max'] ?? 190;
        if (mb_strlen($v) > $max) {
            $this->err($key, $r['row'], $c['key'], 'النص أطول من المسموح (' . $max . ' حرف)');
            return null;
        }
        if ($kind === 'date') {
            $d = $cell['num'] ? $this->serial_date($v) : $this->text_date($v);
            if ($d === null) {
                $this->err($key, $r['row'], $c['key'], 'صيغة التاريخ غير صحيحة «' . $v . '». اكتبه بالشكل 2026-10-29');
            }
            return $d;
        }
        if ($kind === 'number') {
            $n = str_replace([',', '٬', ' '], '', $v);
            if (!is_numeric($n) || $n < 0) {
                $this->err($key, $r['row'], $c['key'], 'لازم يكون رقم أكبر من أو يساوي صفر');
                return null;
            }
            return (string)round((float)$n, 2);
        }
        if ($kind === 'list' && !in_array($v, $c['list'], true)) {
            $this->err($key, $r['row'], $c['key'], 'القيمة «' . $v . '» مش من القيم المسموحة: ' . implode('، ', $c['list']));
            return null;
        }
        return $v;
    }

    function serial_date($v)
    {
        $n = (float)$v;
        if ($n < 1 || $n > 80000) {
            return null;
        }
        $base = $this->date1904 ? '1904-01-01' : '1899-12-30';
        return date('Y-m-d', strtotime($base . ' +' . (int)floor($n) . ' days'));
    }

    function text_date($v)
    {
        if (preg_match('~^(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})(?:[ T]\d{1,2}:\d{2}(?::\d{2})?)?$~', $v, $m)) {
            [$y, $mo, $d] = [(int)$m[1], (int)$m[2], (int)$m[3]];
        } elseif (preg_match('~^(\d{1,2})[-/.](\d{1,2})[-/.](\d{4})$~', $v, $m)) {
            [$d, $mo, $y] = [(int)$m[1], (int)$m[2], (int)$m[3]];
        } else {
            return null;
        }
        if ($y < 1950 || $y > 2100 || !checkdate($mo, $d, $y)) {
            return null;
        }
        return sprintf('%04d-%02d-%02d', $y, $mo, $d);
    }
}

function dx_cols_by_key($key)
{
    return array_column(dx_spec()[$key]['cols'], null, 'key');
}

// الخطة: كل اللي هيتعمل، من غير ما يتحفظ حاجة. بتتعمل تاني وقت التأكيد على البيانات الحالية
function dx_plan(array $data, $mode)
{
    $P = new DxPlan($mode);
    $P->date1904 = !empty($data['date1904']);
    $upd = $mode === 'update';

    // ---------- الموظفين
    $emps = q_all('SELECT * FROM employees');
    $byCode = $byNid = $codeless = [];
    foreach ($emps as $e) {
        if ((string)$e['code'] !== '') {
            $byCode[$e['code']] = $e;
        } else {
            $codeless[$e['name']][] = $e;
        }
        if ((string)$e['national_id'] !== '') {
            $byNid[$e['national_id']][] = $e;
        }
    }
    $holding = [];
    foreach (q_all('SELECT employee_id, COUNT(*) AS n FROM custody WHERE in_handover_id IS NULL GROUP BY employee_id') as $r) {
        $holding[$r['employee_id']] = (int)$r['n'];
    }
    // empRef[code] = ['id' => رقم أو null للجديد, 'active' => الحالة بعد الاستيراد, 'name']
    $empRef = [];
    foreach ($byCode as $code => $e) {
        $empRef[$code] = ['id' => (int)$e['id'], 'active' => (int)$e['active'], 'name' => $e['name']];
    }
    $C = dx_cols_by_key('employees');
    $seenCode = $seenNid = [];
    foreach ($data['sheets']['employees'] ?? [] as $r) {
        $n = $r['row'];
        $v = [];
        $bad = false;
        foreach (['code', 'name', 'national_id', 'department', 'job_title', 'branch', 'phone', 'email', 'active', 'notes'] as $k) {
            $v[$k] = $P->val('employees', $r, $C[$k]);
            $bad = $bad || $v[$k] === null;
        }
        if ($bad) {
            continue;
        }
        if ($v['email'] !== '' && !filter_var($v['email'], FILTER_VALIDATE_EMAIL)) {
            $P->err('employees', $n, 'email', 'البريد الإلكتروني غير صحيح');
            continue;
        }
        $active = $v['active'] === '' ? null : ($v['active'] === 'نشط' ? 1 : 0);
        $ex = null;
        if ($v['code'] !== '') {
            if (isset($seenCode[$v['code']])) {
                $P->err('employees', $n, 'code', 'الكود «' . $v['code'] . '» متكرر في الملف (صف ' . $seenCode[$v['code']] . ')');
                continue;
            }
            $seenCode[$v['code']] = $n;
            $ex = $byCode[$v['code']] ?? null;
        } else {
            // موظف قديم من غير كود: بنعرفه بالرقم القومي أو بالاسم لو مفيش غيره بنفس الاسم
            if ($v['national_id'] !== '' && count($byNid[$v['national_id']] ?? []) === 1) {
                $ex = $byNid[$v['national_id']][0];
            } elseif (count($codeless[$v['name']] ?? []) === 1) {
                $ex = $codeless[$v['name']][0];
            }
            if (!$ex) {
                $P->err('employees', $n, 'code', 'كود الموظف مطلوب. لو الموظف موجود في النظام من غير كود، ضيفله كود من صفحة الموظفين الأول');
                continue;
            }
        }
        $label = [$v['code'] !== '' ? $v['code'] : ($ex['code'] ?: $ex['name']), $v['name'] !== '' ? $v['name'] : ($ex['name'] ?? '')];
        // الرقم القومي بيتراجع للموظف الجديد، أو لو هيتغير في وضع التحديث
        if ($v['national_id'] !== '' && (!$ex || ($upd && $ex['national_id'] !== $v['national_id']))) {
            $nidKey = $v['national_id'];
            if (isset($seenNid[$nidKey])) {
                $P->err('employees', $n, 'national_id', 'الرقم القومي متكرر في الملف (صف ' . $seenNid[$nidKey] . ')');
                continue;
            }
            $seenNid[$nidKey] = $n;
            $other = array_filter($byNid[$nidKey] ?? [], function ($e) use ($ex) {
                return !$ex || (int)$e['id'] !== (int)$ex['id'];
            });
            if ($other) {
                $o = reset($other);
                $P->err('employees', $n, 'national_id', 'الرقم القومي مسجل بالفعل للموظف ' . $o['name'] . ($o['code'] ? ' (' . $o['code'] . ')' : ''));
                continue;
            }
        }
        if (!$ex) {
            if ($v['name'] === '') {
                $P->err('employees', $n, 'name', 'اسم الموظف مطلوب');
                continue;
            }
            $row = $v;
            $row['active'] = $active ?? 1;
            $P->ops['emp_new'][] = ['row' => $n, 'data' => $row];
            $P->counts['employees']['new']++;
            $P->rec('new', 'employees', $n, $label);
            $empRef[$v['code']] = ['id' => null, 'active' => $row['active'], 'name' => $v['name']];
            continue;
        }
        $changes = [];
        $set = [];
        foreach (['name', 'national_id', 'department', 'job_title', 'branch', 'phone', 'email', 'notes'] as $k) {
            if ($v[$k] !== '' && $v[$k] !== (string)$ex[$k]) {
                $changes[] = ['col' => $C[$k]['title'], 'old' => (string)$ex[$k], 'new' => $v[$k]];
                $set[$k] = $v[$k];
            }
        }
        if ($active !== null && $active !== (int)$ex['active']) {
            $changes[] = ['col' => $C['active']['title'], 'old' => $ex['active'] ? 'نشط' : 'موقوف', 'new' => $v['active']];
            $set['active'] = $active;
        }
        if (!$changes) {
            $P->counts['employees']['same']++;
            continue;
        }
        if (!$upd) {
            $P->counts['employees']['ignored']++;
            $P->rec('ignored', 'employees', $n, $label, $changes);
            continue;
        }
        if (isset($set['active']) && !$set['active'] && !empty($holding[$ex['id']])) {
            $P->err('employees', $n, 'active', 'لا يمكن إيقاف موظف لديه عهدة قائمة، اعمل ارتجاع العهدة الأول');
            continue;
        }
        $P->ops['emp_upd'][] = ['row' => $n, 'id' => (int)$ex['id'], 'set' => $set];
        $P->counts['employees']['update']++;
        $P->rec('updates', 'employees', $n, $label, $changes);
        if ((string)$ex['code'] !== '' && isset($set['active'])) {
            $empRef[$ex['code']]['active'] = $set['active'];
        }
    }

    // ---------- الأصناف (ورقة لكل نوع)
    $items = q_all('SELECT * FROM items');
    $iByCode = $iBySerial = $iById = $linkedBy = [];
    foreach ($items as $it) {
        $iByCode[$it['code']] = $it;
        $iById[$it['id']] = $it;
        if ((string)$it['serial_no'] !== '') {
            $iBySerial[$it['serial_no']] = $it;
        }
        if ($it['linked_sim_id']) {
            $linkedBy[$it['linked_sim_id']] = $it;
        }
    }
    $active = [];
    foreach (q_all('SELECT c.item_id, c.employee_id, c.assigned_at, e.name, e.code, h.doc_no FROM custody c JOIN employees e ON e.id = c.employee_id
            JOIN handovers h ON h.id = c.out_handover_id WHERE c.in_handover_id IS NULL') as $c) {
        $active[$c['item_id']] = $c;
    }
    // itemRef: بالكود وبالرقم التسلسلي => ['id' => رقم أو null, 'new' => index, 'type', 'status' بعد الاستيراد, 'code', 'label']
    $itemRef = [];
    foreach ($items as $it) {
        $ref = ['id' => (int)$it['id'], 'type' => $it['type'], 'status' => $it['status'], 'label' => $it['code'] . ' ' . $it['name']];
        $itemRef['c:' . $it['code']] = $ref;
        if ((string)$it['serial_no'] !== '') {
            $itemRef['s:' . $it['serial_no']] = $ref;
        }
    }
    $seenICode = $seenSerial = [];
    $pendingRefs = [];
    foreach (asset_types() as $t => $def) {
        $key = 'items:' . $t;
        $C = dx_cols_by_key($key);
        $serialLabel = $C['serial_no']['field']['label'];
        foreach ($data['sheets'][$key] ?? [] as $r) {
            $n = $r['row'];
            $v = [];
            $bad = false;
            foreach ($C as $k => $c) {
                if (($c['head'] ?? '') === 'ro') {
                    continue;
                }
                $v[$k] = $P->val($key, $r, $c);
                $bad = $bad || $v[$k] === null;
            }
            if ($bad) {
                continue;
            }
            $code = $v['code'];
            $serial = $v['serial_no'];
            $ex = null;
            if ($code !== '') {
                if (isset($seenICode[$code])) {
                    $P->err($key, $n, 'code', 'كود الأصل «' . $code . '» متكرر في الملف (' . $seenICode[$code] . ')');
                    continue;
                }
                $seenICode[$code] = dx_spec()[$key]['name'] . ' صف ' . $n;
                $ex = $iByCode[$code] ?? null;
                if (!$ex && $serial !== '' && isset($iBySerial[$serial])) {
                    $P->err($key, $n, 'serial_no', $serialLabel . ' «' . $serial . '» مسجل بالفعل للصنف ' . $iBySerial[$serial]['code'] . '. اكتب كوده أو سيب الكود فاضي');
                    continue;
                }
            } elseif ($serial === '') {
                $P->err($key, $n, 'serial_no', 'اكتب كود الأصل أو ' . $serialLabel);
                continue;
            } else {
                $ex = $iBySerial[$serial] ?? null;
            }
            if ($ex && $ex['type'] !== $t) {
                $P->err($key, $n, $code !== '' ? 'code' : 'serial_no', 'الصنف ' . $ex['code'] . ' مسجل كـ «' . type_label($ex['type']) . '» مش «' . $def['label'] . '». حطه في ورقته');
                continue;
            }
            if ($serial !== '') {
                if (isset($seenSerial[$serial])) {
                    $P->err($key, $n, 'serial_no', $serialLabel . ' «' . $serial . '» متكرر في الملف (' . $seenSerial[$serial] . ')');
                    continue;
                }
                $seenSerial[$serial] = dx_spec()[$key]['name'] . ' صف ' . $n;
            }
            // حقول النوع بنفس قواعد نموذج الصنف
            $cols = [];
            $specs = [];
            $refVal = [];
            foreach ($def['fields'] as $f) {
                $k = $f['key'];
                $in = $f['input'] ?? 'text';
                if ($in === 'item_ref') {
                    $refVal[$k] = $v[$k];
                    continue;
                }
                if ($in === 'checks') {
                    if ($v[$k] === '') {
                        continue;
                    }
                    $parts = array_values(array_filter(array_map('trim', preg_split('/[،,;\n]+/u', $v[$k]))));
                    $badOpt = array_diff($parts, $f['options']);
                    if ($badOpt) {
                        $P->err($key, $n, $k, '«' . implode('، ', $badOpt) . '» مش من القيم المسموحة: ' . implode('، ', $f['options']));
                        $bad = true;
                        continue;
                    }
                    $specs[$k] = array_values(array_intersect($f['options'], $parts));
                    continue;
                }
                $check = $f;
                if ($ex) {
                    unset($check['required']);
                }
                [$fv, $e] = type_field_check($check, $v[$k]);
                if ($e !== null) {
                    $cell = $r['v'][$k] ?? null;
                    $P->err($key, $n, $k, $e . ($cell && $cell['num'] && !empty($f['pattern']) ? ' (القيمة اتسجلت في Excel كرقم؛ نسّق الخانة كنص واكتبها تاني)' : ''));
                    $bad = true;
                    continue;
                }
                if ($fv === '') {
                    continue;
                }
                if (in_array($k, ['brand', 'model', 'serial_no'], true)) {
                    $cols[$k] = $fv;
                } else {
                    $specs[$k] = $fv;
                }
            }
            if ($bad) {
                continue;
            }
            $label = [$code !== '' ? $code : ($ex['code'] ?? $serial), item_name($t, $cols + ['brand' => $ex['brand'] ?? '', 'model' => $ex['model'] ?? ''], $specs)];
            if (!$ex) {
                if ($v['status'] === 'مسلمة') {
                    $P->err($key, $n, 'status', 'الوضع «مسلمة» بيتحدد لوحده لما الصنف يتسلّم من ورقة العهد. اكتب «متاحة» أو سيبه فاضي');
                    continue;
                }
                $idx = count($P->ops['item_new']);
                $P->ops['item_new'][] = ['row' => $n, 'sheet' => $key, 'type' => $t, 'code' => $code, 'cols' => $cols, 'specs' => $specs,
                    'purchase_date' => $v['purchase_date'] ?: null, 'value' => $v['value'] === '' ? null : $v['value'],
                    'item_condition' => $v['item_condition'] ?: 'جيد', 'status' => $v['status'] ?: 'متاحة', 'location' => $v['location'], 'notes' => $v['notes']];
                $ref = ['id' => null, 'new' => $idx, 'type' => $t, 'status' => $v['status'] ?: 'متاحة', 'label' => $label[0] . ' ' . $label[1]];
                if ($code !== '') {
                    $itemRef['c:' . $code] = $ref;
                }
                $itemRef['s:' . $serial] = $ref;
                foreach ($refVal as $k => $rv) {
                    if ($rv !== '') {
                        $pendingRefs[] = ['sheet' => $key, 'row' => $n, 'field' => $k, 'value' => $rv, 'new' => $idx, 'ex' => null, 'label' => $label];
                    }
                }
                $P->counts[$key]['new']++;
                $P->rec('new', $key, $n, $label);
                continue;
            }
            // صنف موجود: الفروق في الخانات اللي فيها قيم بس
            $exSpecs = json_decode((string)$ex['specs'], true) ?: [];
            $changes = [];
            $set = [];
            $newSpecs = $exSpecs;
            foreach ($cols as $k => $fv) {
                if ($fv !== (string)$ex[$k]) {
                    $changes[] = ['col' => $C[$k]['title'], 'old' => (string)$ex[$k], 'new' => $fv];
                    $set[$k] = $fv;
                }
            }
            foreach ($specs as $k => $fv) {
                $old = $exSpecs[$k] ?? (is_array($fv) ? [] : '');
                if ($fv !== $old) {
                    $changes[] = ['col' => $C[$k]['title'], 'old' => is_array($old) ? implode('، ', $old) : (string)$old, 'new' => is_array($fv) ? implode('، ', $fv) : $fv];
                    $newSpecs[$k] = $fv;
                }
            }
            if ($newSpecs !== $exSpecs) {
                $set['specs'] = $newSpecs;
            }
            foreach (['purchase_date', 'item_condition', 'status', 'location', 'notes'] as $k) {
                if ($v[$k] !== '' && $v[$k] !== (string)$ex[$k]) {
                    $changes[] = ['col' => $C[$k]['title'], 'old' => (string)$ex[$k], 'new' => $v[$k]];
                    $set[$k] = $v[$k];
                }
            }
            if ($v['value'] !== '' && ($ex['value'] === null || abs((float)$ex['value'] - (float)$v['value']) > 0.001)) {
                $changes[] = ['col' => $C['value']['title'], 'old' => (string)$ex['value'], 'new' => $v['value']];
                $set['value'] = $v['value'];
            }
            foreach ($refVal as $k => $rv) {
                if ($rv !== '') {
                    $pendingRefs[] = ['sheet' => $key, 'row' => $n, 'field' => $k, 'value' => $rv, 'new' => null, 'ex' => $ex, 'label' => $label];
                }
            }
            if ($upd && $changes) {
                if (isset($set['status']) && ($ex['status'] === 'مسلمة' || $set['status'] === 'مسلمة')) {
                    $P->err($key, $n, 'status', $ex['status'] === 'مسلمة' ? 'الصنف في عهدة موظف، ووضعه بيتغير بالارتجاع من النظام بس' : 'الوضع «مسلمة» بيتحدد لوحده من ورقة العهد');
                    continue;
                }
                if (isset($set['serial_no']) && isset($iBySerial[$set['serial_no']]) && (int)$iBySerial[$set['serial_no']]['id'] !== (int)$ex['id']) {
                    $P->err($key, $n, 'serial_no', $serialLabel . ' «' . $set['serial_no'] . '» مسجل بالفعل للصنف ' . $iBySerial[$set['serial_no']]['code']);
                    continue;
                }
                if (isset($set['status'])) {
                    $itemRef['c:' . $ex['code']]['status'] = $set['status'];
                    if ((string)$ex['serial_no'] !== '') {
                        $itemRef['s:' . $ex['serial_no']]['status'] = $set['status'];
                    }
                }
                $P->ops['item_upd'][] = ['row' => $n, 'sheet' => $key, 'id' => (int)$ex['id'], 'type' => $t, 'set' => $set];
            }
            $P->ops['_rows'][$key . ':' . $n] = ['changes' => $changes, 'label' => $label, 'key' => $key];
        }
    }
    // ربط الشرائح بالماكينات (بعد قراءة كل الأوراق، علشان الشريحة ممكن تكون جديدة في نفس الملف)
    $seenSim = [];
    foreach ($pendingRefs as $p) {
        $f = null;
        foreach (asset_types()[dx_spec()[$p['sheet']]['type']]['fields'] as $ff) {
            if ($ff['key'] === $p['field']) {
                $f = $ff;
            }
        }
        $target = $itemRef['c:' . $p['value']] ?? $itemRef['s:' . $p['value']] ?? null;
        $rowKey = $p['sheet'] . ':' . $p['row'];
        if (!$target || $target['type'] !== $f['ref_type']) {
            $P->err($p['sheet'], $p['row'], $p['field'], '«' . $p['value'] . '» مش ' . type_label($f['ref_type']) . ' موجودة في النظام أو في الملف');
            unset($P->ops['_rows'][$rowKey]);
            continue;
        }
        $simKey = $target['id'] ? 'id:' . $target['id'] : 'new:' . $target['new'];
        if (isset($seenSim[$simKey])) {
            $P->err($p['sheet'], $p['row'], $p['field'], 'الشريحة «' . $p['value'] . '» مربوطة بجهاز تاني في الملف (' . $seenSim[$simKey] . ')');
            unset($P->ops['_rows'][$rowKey]);
            continue;
        }
        $seenSim[$simKey] = dx_spec()[$p['sheet']]['name'] . ' صف ' . $p['row'];
        $selfId = $p['ex'] ? (int)$p['ex']['id'] : 0;
        if ($target['id'] && isset($linkedBy[$target['id']]) && (int)$linkedBy[$target['id']]['id'] !== $selfId) {
            $P->err($p['sheet'], $p['row'], $p['field'], 'الشريحة مربوطة بالفعل بالجهاز ' . $linkedBy[$target['id']]['code'] . '، ولا يمكن ربطها بأكتر من جهاز');
            unset($P->ops['_rows'][$rowKey]);
            continue;
        }
        if ($p['new'] !== null) {
            $P->ops['links'][] = ['item' => ['new' => $p['new']], 'sim' => $target['id'] ? ['id' => $target['id']] : ['new' => $target['new']], 'column' => $f['column']];
            continue;
        }
        $cur = (int)($p['ex'][$f['column']] ?? 0);
        if ($target['id'] && $cur === (int)$target['id']) {
            continue;
        }
        $C = dx_cols_by_key($p['sheet']);
        $old = $cur ? ($iById[$cur]['code'] ?? '') : '';
        $P->ops['_rows'][$rowKey]['changes'][] = ['col' => $C[$p['field']]['title'], 'old' => $old, 'new' => $p['value']];
        if ($upd) {
            $P->ops['_rows'][$rowKey]['link'] = ['item' => ['id' => (int)$p['ex']['id']], 'sim' => $target['id'] ? ['id' => $target['id']] : ['new' => $target['new']], 'column' => $f['column']];
        }
    }
    // تصنيف الأصناف الموجودة: من غير تغيير / تعديل / تعديل اتجاهل (وضع الإضافة)
    $updById = [];
    foreach ($P->ops['item_upd'] as $i => $u) {
        $updById[$u['sheet'] . ':' . $u['row']] = $i;
    }
    foreach ($P->ops['_rows'] ?? [] as $rowKey => $info) {
        [$sheetKey, $row] = [$info['key'], (int)substr($rowKey, strrpos($rowKey, ':') + 1)];
        if (!$info['changes']) {
            $P->counts[$sheetKey]['same']++;
            continue;
        }
        if (!$upd) {
            $P->counts[$sheetKey]['ignored']++;
            $P->rec('ignored', $sheetKey, $row, $info['label'], $info['changes']);
            continue;
        }
        if (!isset($updById[$rowKey]) && empty($info['link'])) {
            continue;
        }
        if (!empty($info['link'])) {
            $P->ops['links'][] = $info['link'];
        }
        $P->counts[$sheetKey]['update']++;
        $P->rec('updates', $sheetKey, $row, $info['label'], $info['changes']);
    }
    // أصناف موجودة مرفوضة بسبب الربط: نشيل تعديلها كمان
    $P->ops['item_upd'] = array_values(array_filter($P->ops['item_upd'], function ($u) use ($P) {
        return isset($P->ops['_rows'][$u['sheet'] . ':' . $u['row']]);
    }));
    unset($P->ops['_rows']);

    // ---------- العهد
    $C = dx_cols_by_key('custody');
    $hByDoc = [];
    foreach (q_all("SELECT id, doc_no, employee_id FROM handovers WHERE type = 'out'") as $h) {
        $hByDoc[$h['doc_no']] = $h;
    }
    $assignedInFile = [];
    foreach ($data['sheets']['custody'] ?? [] as $r) {
        $n = $r['row'];
        $v = [];
        $bad = false;
        foreach (['out_doc', 'employee_code', 'item', 'assigned_at', 'condition_out', 'notes_out'] as $k) {
            $v[$k] = $P->val('custody', $r, $C[$k]);
            $bad = $bad || $v[$k] === null;
        }
        if ($bad) {
            continue;
        }
        $label = [$v['employee_code'] . ' ← ' . $v['item'], ''];
        $item = $v['item'] !== '' ? ($itemRef['c:' . $v['item']] ?? $itemRef['s:' . $v['item']] ?? null) : null;
        if ($v['out_doc'] !== '') {
            // سطر عهدة محفوظ: بيتعرف برقم السند والصنف، ومابيتعدلش من الملف
            $h = $hByDoc[$v['out_doc']] ?? null;
            if (!$h) {
                $P->err('custody', $n, 'out_doc', 'رقم سند التسليم «' . $v['out_doc'] . '» مش موجود. للعهدة الجديدة سيب الخانة فاضية');
                continue;
            }
            $line = $item && $item['id'] ? q_one('SELECT c.*, e.code AS employee_code FROM custody c JOIN employees e ON e.id = c.employee_id
                WHERE c.out_handover_id = ? AND c.item_id = ?', [$h['id'], $item['id']]) : null;
            if (!$line) {
                $P->err('custody', $n, 'item', 'الصنف «' . $v['item'] . '» مش في سند التسليم ' . $v['out_doc']);
                continue;
            }
            $changes = [];
            foreach (['employee_code', 'assigned_at', 'condition_out', 'notes_out'] as $k) {
                if ($v[$k] !== '' && $v[$k] !== (string)$line[$k]) {
                    $changes[] = ['col' => $C[$k]['title'], 'old' => (string)$line[$k], 'new' => $v[$k]];
                }
            }
            if ($changes) {
                // العهدة المحفوظة جزء من سند، فمابتتعدلش من الملف حتى في وضع التحديث
                $P->counts['custody']['ignored']++;
                $P->rec('ignored', 'custody', $n, [$v['out_doc'] . ' / ' . $v['item'], ''], $changes);
            } else {
                $P->counts['custody']['same']++;
            }
            continue;
        }
        foreach (['employee_code' => 'كود الموظف مطلوب', 'item' => 'كود الأصل أو الرقم التسلسلي مطلوب', 'assigned_at' => 'تاريخ التسليم مطلوب'] as $k => $msg) {
            if ($v[$k] === '') {
                $P->err('custody', $n, $k, $msg);
                $bad = true;
            }
        }
        if ($bad) {
            continue;
        }
        $emp = $empRef[$v['employee_code']] ?? null;
        if (!$emp) {
            $P->err('custody', $n, 'employee_code', 'كود الموظف «' . $v['employee_code'] . '» مش موجود في النظام ولا في ورقة الموظفين');
            continue;
        }
        if (!$item) {
            $P->err('custody', $n, 'item', '«' . $v['item'] . '» مش موجود في النظام ولا في أوراق الأصناف');
            continue;
        }
        $label = [$v['employee_code'] . ' ← ' . $v['item'], $emp['name'] . ' — ' . $item['label']];
        if ($item['id'] && isset($active[$item['id']])) {
            $a = $active[$item['id']];
            if ($emp['id'] && (int)$a['employee_id'] === $emp['id']) {
                // نفس الصنف في عهدة نفس الموظف بالفعل (رفع نفس الملف تاني)
                $P->counts['custody']['same']++;
                continue;
            }
            $P->err('custody', $n, 'item', 'الصنف في عهدة ' . $a['name'] . ($a['code'] ? ' (' . $a['code'] . ')' : '') . ' من ' . $a['assigned_at'] . ' بالسند ' . $a['doc_no'] . '. اعمل ارتجاع الأول');
            continue;
        }
        $itemKey = $item['id'] ? 'id:' . $item['id'] : 'new:' . $item['new'];
        if (isset($assignedInFile[$itemKey])) {
            $P->err('custody', $n, 'item', 'الصنف متسلّم في صف تاني في نفس الملف (صف ' . $assignedInFile[$itemKey] . ')، ومينفعش يبقى في أكتر من عهدة');
            continue;
        }
        if (!$emp['active']) {
            $P->err('custody', $n, 'employee_code', 'الموظف ' . $emp['name'] . ' موقوف، ومينفعش يستلم عهدة');
            continue;
        }
        if ($item['status'] !== 'متاحة') {
            $P->err('custody', $n, 'item', 'حالة الصنف «' . $item['status'] . '» ولا يمكن تسليمه. لازم تكون «متاحة»');
            continue;
        }
        if ($v['assigned_at'] > today()) {
            $P->err('custody', $n, 'assigned_at', 'تاريخ التسليم في المستقبل');
            continue;
        }
        $assignedInFile[$itemKey] = $n;
        $P->ops['custody'][] = ['row' => $n, 'employee_code' => $v['employee_code'], 'item' => $item['id'] ? ['id' => $item['id']] : ['new' => $item['new']],
            'date' => $v['assigned_at'], 'condition' => $v['condition_out'], 'notes' => $v['notes_out']];
        $P->counts['custody']['new']++;
        $P->rec('new', 'custody', $n, $label);
    }
    return $P;
}

// عدد سندات التسليم الجديدة: سند لكل موظف وتاريخ
function dx_custody_groups(array $custodyOps)
{
    $g = [];
    foreach ($custodyOps as $op) {
        $g[$op['employee_code'] . '|' . $op['date']][] = $op;
    }
    return $g;
}

function dx_fingerprint(DxPlan $P)
{
    return hash('sha256', json_encode([$P->mode, $P->ops], JSON_UNESCAPED_UNICODE));
}

function dx_summary(DxPlan $P)
{
    $sheets = [];
    foreach (dx_spec() as $key => $sh) {
        if (!empty($sh['readonly'])) {
            continue;
        }
        $sheets[] = ['key' => $key, 'name' => $sh['name']] + $P->counts[$key];
    }
    $total = function ($k) use ($P) {
        return array_sum(array_column($P->counts, $k));
    };
    $cut = function ($list) {
        return array_slice($list, 0, DX_LIST_LIMIT);
    };
    return [
        'mode' => $P->mode,
        'sheets' => $sheets,
        'totals' => ['new' => $total('new'), 'same' => $total('same'), 'update' => $total('update'), 'ignored' => $total('ignored'), 'errors' => count($P->errors)],
        'handovers' => count(dx_custody_groups($P->ops['custody'])),
        'errors' => $cut($P->errors),
        'warnings' => $P->warnings,
        'new' => $cut($P->new),
        'updates' => $cut($P->updates),
        'ignored' => $cut($P->ignored),
        'truncated' => count($P->errors) > DX_LIST_LIMIT || count($P->new) > DX_LIST_LIMIT || count($P->updates) > DX_LIST_LIMIT || count($P->ignored) > DX_LIST_LIMIT,
        'can_commit' => !$P->errors && ($total('new') + $total('update')) > 0,
    ];
}

// ---------------------------------------------------------------- التنفيذ (داخل معاملة واحدة يفتحها المستدعي)

function dx_apply(DxPlan $P, $fileName)
{
    $note = ' — استيراد Excel';
    $empIds = [];
    foreach (q_all("SELECT id, code FROM employees WHERE code IS NOT NULL AND code <> ''") as $e) {
        $empIds[$e['code']] = (int)$e['id'];
    }
    foreach ($P->ops['emp_new'] as $op) {
        $row = $op['data'];
        $row['created_at'] = now();
        $id = insert('employees', $row);
        $empIds[$row['code']] = $id;
        log_activity('إضافة موظف', 'employee', $id, $row['name'] . $note);
    }
    foreach ($P->ops['emp_upd'] as $op) {
        update('employees', $op['id'], $op['set']);
        log_activity('تعديل موظف', 'employee', $op['id'], q_val('SELECT name FROM employees WHERE id = ?', [$op['id']]) . $note);
    }
    $newIds = [];
    $codes = [];
    foreach ($P->ops['item_new'] as $i => $op) {
        $row = array_merge(['brand' => '', 'model' => '', 'serial_no' => ''], $op['cols'], [
            'code' => $op['code'] !== '' ? $op['code'] : 'TMP-' . bin2hex(random_bytes(6)),
            'type' => $op['type'],
            'name' => item_name($op['type'], $op['cols'], $op['specs']),
            'specs' => $op['specs'] ? json_encode($op['specs'], JSON_UNESCAPED_UNICODE) : null,
            'purchase_date' => $op['purchase_date'],
            'value' => $op['value'] === null ? null : (float)$op['value'],
            'item_condition' => $op['item_condition'],
            'status' => $op['status'],
            'location' => $op['location'],
            'notes' => $op['notes'],
            'created_at' => now(),
        ]);
        $id = insert('items', $row);
        if ($op['code'] === '') {
            $base = asset_types()[$op['type']]['prefix'] . '-' . str_pad((string)$id, 5, '0', STR_PAD_LEFT);
            $code = $base;
            for ($k = 2; q_val('SELECT id FROM items WHERE code = ?', [$code]); $k++) {
                $code = $base . '-' . $k;
            }
            update('items', $id, ['code' => $code]);
            $row['code'] = $code;
        }
        $newIds[$i] = $id;
        $codes[] = $row['code'];
        log_activity('إضافة صنف', 'item', $id, $row['code'] . ' ' . $row['name'] . $note);
    }
    foreach ($P->ops['item_upd'] as $op) {
        $ex = q_one('SELECT * FROM items WHERE id = ?', [$op['id']]);
        $set = $op['set'];
        if (isset($set['specs'])) {
            $set['specs'] = $set['specs'] ? json_encode($set['specs'], JSON_UNESCAPED_UNICODE) : null;
        }
        if (isset($set['value'])) {
            $set['value'] = (float)$set['value'];
        }
        $merged = array_merge($ex, $set);
        $set['name'] = item_name($ex['type'], ['brand' => $merged['brand'], 'model' => $merged['model'], 'serial_no' => $merged['serial_no']],
            json_decode((string)$merged['specs'], true) ?: []);
        update('items', $op['id'], $set);
        log_activity('تعديل صنف', 'item', $op['id'], $ex['code'] . ' ' . $set['name'] . $note);
    }
    $rid = function ($ref) use ($newIds) {
        return isset($ref['id']) ? (int)$ref['id'] : $newIds[$ref['new']];
    };
    foreach ($P->ops['links'] as $l) {
        update('items', $rid($l['item']), [$l['column'] => $rid($l['sim'])]);
    }
    $docs = [];
    foreach (dx_custody_groups($P->ops['custody']) as $group) {
        $lines = array_map(function ($op) use ($rid) {
            return ['item_id' => $rid($op['item']), 'condition' => $op['condition'] !== '' ? $op['condition'] : null, 'notes' => $op['notes']];
        }, $group);
        foreach ($lines as &$line) {
            if ($line['condition'] === null) {
                $line['condition'] = q_val('SELECT item_condition FROM items WHERE id = ?', [$line['item_id']]);
            }
        }
        unset($line);
        $empId = $empIds[$group[0]['employee_code']] ?? null;
        // نفس قواعد التسليم من النظام: الموظف نشط والصنف متاحة
        $hid = do_assign($empId, $lines, $group[0]['date'], 'مستورد من ملف Excel: ' . mb_substr($fileName, 0, 150));
        $docs[] = q_val('SELECT doc_no FROM handovers WHERE id = ?', [$hid]);
    }
    return ['item_codes' => $codes, 'handovers' => $docs];
}

// ---------------------------------------------------------------- تقرير المعاينة / النتيجة كملف Excel

function dx_report_workbook(array $meta)
{
    $s = $meta['summary'];
    $kv = function ($k, $v) {
        return [['v' => $k, 's' => XS_BOLD], (string)$v];
    };
    $rows = [
        [['v' => 'تقرير استيراد بيانات Excel', 's' => XS_TITLE]],
        $kv('الملف', $meta['file_name']),
        $kv('المستخدم', $meta['user_name']),
        $kv('وقت المعاينة', $meta['created_at']),
        $kv('الوضع', $s['mode'] === 'update' ? 'إضافة وتحديث السجلات الموجودة' : 'إضافة سجلات جديدة فقط'),
        $kv('النتيجة', ['done' => 'تم الاستيراد ' . ($meta['done_at'] ?? ''), 'failed' => 'فشل الاستيراد ولم يُحفظ أي شيء: ' . ($meta['fail_msg'] ?? '')][$meta['status']] ??
            ($s['errors'] ? 'مرفوض: فيه ' . $s['totals']['errors'] . ' خطأ ولم يُحفظ أي شيء' : 'معاينة فقط، لم يُحفظ أي شيء')),
        [],
        [['v' => 'الورقة', 's' => XS_HEAD_OPT], ['v' => 'جديد', 's' => XS_HEAD_OPT], ['v' => 'موجود بدون تغيير', 's' => XS_HEAD_OPT],
            ['v' => 'تعديلات', 's' => XS_HEAD_OPT], ['v' => 'تعديلات اتجاهلت', 's' => XS_HEAD_OPT], ['v' => 'أخطاء', 's' => XS_HEAD_OPT]],
    ];
    foreach ($s['sheets'] as $sh) {
        $rows[] = [$sh['name'], $sh['new'], $sh['same'], $sh['update'], $sh['ignored'], $sh['errors']];
    }
    if (!empty($meta['result']['handovers'])) {
        $rows[] = [];
        $rows[] = $kv('سندات التسليم الجديدة', implode('، ', $meta['result']['handovers']));
    }
    $numCols = function ($w) {
        return array_map(function ($x) {
            return ['width' => $x, 'head' => 'opt'];
        }, $w);
    };
    $sheets = [['name' => 'الملخص', 'cols' => array_map(function ($x, $i) {
        return ['width' => $x, 'head' => 'opt', 'kind' => $i ? 'number' : 'text'];
    }, [30, 12, 16, 12, 16, 10], array_keys([30, 12, 16, 12, 16, 10])), 'rows' => $rows]];
    $table = function ($name, $heads, $rows, $w) {
        return ['name' => $name, 'table' => true, 'cols' => array_map(function ($h, $x) {
            return ['title' => $h, 'width' => $x, 'head' => 'opt'];
        }, $heads, $w), 'rows' => $rows];
    };
    $sheets[] = $table('الأخطاء', ['الورقة', 'الصف', 'العمود', 'السبب'], array_map(function ($e) {
        return [$e['sheet'], (string)$e['row'], $e['col'], $e['msg']];
    }, array_merge($meta['errors_all'] ?? $s['errors'], $s['warnings'])), [20, 8, 34, 80]);
    $sheets[] = $table('السجلات الجديدة', ['الورقة', 'الصف', 'الكود', 'البيان'], array_map(function ($e) {
        return [$e['sheet'], (string)$e['row'], $e['key'], $e['label']];
    }, $s['new']), [20, 8, 24, 50]);
    $diff = function ($list) {
        $out = [];
        foreach ($list as $e) {
            foreach ($e['changes'] as $c) {
                $out[] = [$e['sheet'], (string)$e['row'], $e['key'], $c['col'], $c['old'], $c['new']];
            }
        }
        return $out;
    };
    $sheets[] = $table('التعديلات', ['الورقة', 'الصف', 'الكود', 'العمود', 'القيمة الحالية', 'القيمة الجديدة'], $diff($s['updates']), [20, 8, 20, 26, 26, 26]);
    $sheets[] = $table('تعديلات اتجاهلت', ['الورقة', 'الصف', 'الكود', 'العمود', 'القيمة في النظام', 'القيمة في الملف'], $diff($s['ignored']), [20, 8, 20, 26, 26, 26]);
    return $sheets;
}
