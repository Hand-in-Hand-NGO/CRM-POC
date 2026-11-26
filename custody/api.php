<?php
require __DIR__ . '/lib.php';
require __DIR__ . '/scans.php';
require __DIR__ . '/dataio.php';

class ApiError extends Exception
{
}

function fail($msg, $code = 400)
{
    throw new ApiError($msg, $code);
}

function in($key, $default = null)
{
    global $INPUT;
    return $INPUT[$key] ?? $default;
}

function in_str($key, $max = 190)
{
    $v = trim((string)in($key, ''));
    return mb_substr($v, 0, $max);
}

function in_int($key)
{
    $v = in($key);
    return ($v === null || $v === '') ? null : (int)$v;
}

function in_date($key, $default = null)
{
    $v = trim((string)in($key, ''));
    if ($v === '') {
        return $default;
    }
    if (!preg_match('/^\d{4}-\d{2}-\d{2}$/', $v)) {
        fail('صيغة التاريخ غير صحيحة');
    }
    return $v;
}

function need($perm)
{
    if (!current_user()) {
        fail(session_end_message(), 401);
    }
    if (!can($perm)) {
        fail('ليست لديك صلاحية لهذا الإجراء', 403);
    }
}

function like($s)
{
    return '%' . str_replace(['!', '%', '_'], ['!!', '!%', '!_'], $s) . '%';
}

function csv_out($filename, array $headers, array $rows)
{
    header('Content-Type: text/csv; charset=utf-8');
    header('Content-Disposition: attachment; filename="' . $filename . '"');
    $out = fopen('php://output', 'w');
    fwrite($out, "\xEF\xBB\xBF");
    fputcsv($out, $headers);
    foreach ($rows as $r) {
        // الأرقام التعريفية (TID / MID / IMEI / رقم الخط...) تُكتب كنص في Excel حتى لا تضيع الأصفار في أولها
        fputcsv($out, array_map(function ($v) {
            return is_string($v) && preg_match('/^(0\d+|\d{12,})$/', $v) ? '="' . $v . '"' : $v;
        }, array_values($r)));
    }
    fclose($out);
    exit;
}

// ---------------------------------------------------------------- employees

function employee_filters(&$params)
{
    $where = ['1=1'];
    if (($s = in_str('q')) !== '') {
        $where[] = "(e.name LIKE ? ESCAPE '!' OR e.code LIKE ? ESCAPE '!' OR e.national_id LIKE ? ESCAPE '!' OR e.phone LIKE ? ESCAPE '!')";
        array_push($params, like($s), like($s), like($s), like($s));
    }
    if (($d = in_str('department')) !== '') {
        $where[] = 'e.department = ?';
        $params[] = $d;
    }
    $a = in('active', '1');
    if ($a === '1' || $a === '0') {
        $where[] = 'e.active = ?';
        $params[] = (int)$a;
    }
    return implode(' AND ', $where);
}

function employees_query()
{
    $params = [];
    $where = employee_filters($params);
    return q_all("SELECT e.*,
            (SELECT COUNT(*) FROM custody c WHERE c.employee_id = e.id AND c.in_handover_id IS NULL) AS active_count,
            (SELECT COALESCE(SUM(i.value), 0) FROM custody c JOIN items i ON i.id = c.item_id WHERE c.employee_id = e.id AND c.in_handover_id IS NULL) AS active_value
        FROM employees e WHERE $where ORDER BY e.name", $params);
}

function save_employee()
{
    need('edit');
    $id = in_int('id');
    $row = [
        'code' => in_str('code', 64),
        'name' => in_str('name'),
        'national_id' => in_str('national_id', 32),
        'department' => in_str('department'),
        'job_title' => in_str('job_title'),
        'branch' => in_str('branch'),
        'phone' => in_str('phone', 32),
        'email' => in_str('email'),
        'active' => in('active', 1) ? 1 : 0,
        'notes' => in_str('notes', 2000),
    ];
    if ($row['name'] === '') {
        fail('اسم الموظف مطلوب');
    }
    if ($row['code'] !== '' && q_val('SELECT id FROM employees WHERE code = ? AND id <> ?', [$row['code'], $id ?: 0])) {
        fail('كود الموظف مستخدم لموظف آخر');
    }
    if ($id && !$row['active'] && q_val('SELECT COUNT(*) FROM custody WHERE employee_id = ? AND in_handover_id IS NULL', [$id])) {
        fail('لا يمكن إيقاف موظف لديه عهدة قائمة، قم بارتجاع العهدة أولًا');
    }
    if ($id) {
        update('employees', $id, $row);
        log_activity('تعديل موظف', 'employee', $id, $row['name']);
    } else {
        $row['created_at'] = now();
        $id = insert('employees', $row);
        log_activity('إضافة موظف', 'employee', $id, $row['name']);
    }
    return ['id' => $id];
}

// ---------------------------------------------------------------- items

function items_query()
{
    $params = [];
    $where = ['1=1'];
    if (($s = in_str('q')) !== '') {
        $where[] = "(i.name LIKE ? ESCAPE '!' OR i.code LIKE ? ESCAPE '!' OR i.serial_no LIKE ? ESCAPE '!' OR i.brand LIKE ? ESCAPE '!' OR i.model LIKE ? ESCAPE '!' OR i.specs LIKE ? ESCAPE '!')";
        array_push($params, like($s), like($s), like($s), like($s), like($s), like($s));
    }
    if (isset(asset_types()[$t = in_str('type', 16)])) {
        $where[] = 'i.type = ?';
        $params[] = $t;
    }
    if (($st = in_str('status')) !== '') {
        $where[] = 'i.status = ?';
        $params[] = $st;
    }
    $where = implode(' AND ', $where);
    return decorate_items(q_all("SELECT i.*, e.id AS holder_id, e.name AS holder_name, e.department AS holder_department, c.assigned_at
        FROM items i
        LEFT JOIN custody c ON c.item_id = i.id AND c.in_handover_id IS NULL
        LEFT JOIN employees e ON e.id = c.employee_id
        WHERE $where ORDER BY i.id DESC", $params));
}

// يقرأ حقول نوع الصنف من الطلب ويتحقق منها حسب types.json
function read_type_fields($type)
{
    $def = asset_types()[$type];
    $input = (array)in('specs', []);
    $cols = ['brand' => '', 'model' => '', 'serial_no' => ''];
    $specs = [];
    foreach ($def['fields'] as $f) {
        $k = $f['key'];
        $input_type = $f['input'] ?? 'text';
        if ($input_type === 'checks') {
            $v = array_values(array_intersect($f['options'], array_map('strval', (array)($input[$k] ?? []))));
            if ($v) {
                $specs[$k] = $v;
            }
            continue;
        }
        if ($input_type === 'item_ref') {
            // ربط بصنف آخر من نوع محدد (مثل شريحة ماكينة POS)، يُحفظ في عمود مستقل
            $refId = (int)($input[$k] ?? 0);
            if ($refId && q_val('SELECT type FROM items WHERE id = ?', [$refId]) !== $f['ref_type']) {
                fail($f['label'] . ': اختر ' . type_label($f['ref_type']) . ' موجودة في النظام');
            }
            if (!$refId && !empty($f['required'])) {
                fail($f['label'] . ' مطلوب');
            }
            $cols[$f['column']] = $refId ?: null;
            continue;
        }
        [$v, $err] = type_field_check($f, $input[$k] ?? '');
        if ($err !== null) {
            fail($err);
        }
        if ($v === '') {
            continue;
        }
        if (array_key_exists($k, $cols)) {
            $cols[$k] = $v;
        } else {
            $specs[$k] = $v;
        }
    }
    return [$cols, $specs, item_name($type, $cols, $specs)];
}

function save_item()
{
    need('edit');
    $id = in_int('id');
    $old = $id ? q_one('SELECT * FROM items WHERE id = ?', [$id]) : null;
    if ($id && !$old) {
        fail('الصنف غير موجود', 404);
    }
    // نوع الصنف لا يتغير بعد إضافته
    $type = $old ? $old['type'] : in_str('type', 16);
    if (!isset(asset_types()[$type])) {
        fail('اختر نوع الصنف');
    }
    if (!$old && !isset(active_types()[$type])) {
        fail('نوع «' . type_label($type) . '» متوقف حاليًا، ومينفعش تضيف أصناف جديدة منه');
    }
    [$cols, $specs, $name] = read_type_fields($type);
    $value = in('value');
    $row = array_merge($cols, [
        'code' => in_str('code', 64),
        'type' => $type,
        'name' => $name,
        'specs' => $specs ? json_encode($specs, JSON_UNESCAPED_UNICODE) : null,
        'purchase_date' => in_date('purchase_date'),
        'value' => ($value === null || $value === '') ? null : round((float)$value, 2),
        'item_condition' => in_str('item_condition', 32) ?: 'جيد',
        'location' => in_str('location'),
        'notes' => in_str('notes', 2000),
    ]);
    if (!in_array($row['item_condition'], ITEM_CONDITIONS, true)) {
        fail('حالة الصنف غير صحيحة');
    }
    // حالة "مسلمة" تتغير فقط من خلال سندات التسليم والارتجاع
    $status = in_str('status', 32);
    if ($old && $old['status'] === 'مسلمة') {
        $status = 'مسلمة';
    } elseif ($status === 'مسلمة' || !in_array($status, ITEM_STATUSES, true)) {
        $status = $old ? $old['status'] : 'متاحة';
    }
    $row['status'] = $status;
    if ($row['code'] !== '' && q_val('SELECT id FROM items WHERE code = ? AND id <> ?', [$row['code'], $id ?: 0])) {
        fail('كود الأصل مستخدم لصنف آخر');
    }
    $keyLabel = '';
    foreach (asset_types()[$type]['fields'] as $f) {
        if ($f['key'] === 'serial_no') {
            $keyLabel = $f['label'];
        }
    }
    if ($row['serial_no'] !== '' && ($dup = q_val('SELECT code FROM items WHERE serial_no = ? AND id <> ?', [$row['serial_no'], $id ?: 0]))) {
        fail($keyLabel . ' مسجل بالفعل للصنف ' . $dup);
    }
    if (!empty($row['linked_sim_id']) && ($dup = q_val('SELECT code FROM items WHERE linked_sim_id = ? AND id <> ?', [$row['linked_sim_id'], $id ?: 0]))) {
        fail('هذه الشريحة مرتبطة بالفعل بالجهاز ' . $dup . '، ولا يمكن ربطها بأكثر من جهاز');
    }
    db()->beginTransaction();
    try {
        if ($id) {
            if ($row['code'] === '') {
                $row['code'] = $old['code'];
            }
            update('items', $id, $row);
            log_activity('تعديل صنف', 'item', $id, $row['code'] . ' ' . $row['name']);
        } else {
            $auto = $row['code'] === '';
            if ($auto) {
                $row['code'] = 'TMP-' . bin2hex(random_bytes(6));
            }
            $row['created_at'] = now();
            $id = insert('items', $row);
            if ($auto) {
                $row['code'] = asset_types()[$type]['prefix'] . '-' . str_pad((string)$id, 5, '0', STR_PAD_LEFT);
                update('items', $id, ['code' => $row['code']]);
            }
            log_activity('إضافة صنف', 'item', $id, $row['code'] . ' ' . $row['name']);
        }
    } catch (PDOException $e) {
        // الفهرس الفريد على linked_sim_id (لو حُفظ ربط نفس الشريحة من مكانين في نفس اللحظة)
        if ((string)$e->getCode() === '23000' && !empty($row['linked_sim_id'])) {
            fail('هذه الشريحة مرتبطة بالفعل بجهاز آخر، ولا يمكن ربطها بأكثر من جهاز');
        }
        throw $e;
    }
    db()->commit();
    return ['id' => $id, 'code' => $row['code']];
}

// ---------------------------------------------------------------- custody

function custody_query()
{
    $params = [];
    $where = ['1=1'];
    $state = in('state', 'active');
    if ($state === 'active') {
        $where[] = 'c.in_handover_id IS NULL';
    } elseif ($state === 'returned') {
        $where[] = 'c.in_handover_id IS NOT NULL';
    }
    if ($e = in_int('employee_id')) {
        $where[] = 'c.employee_id = ?';
        $params[] = $e;
    }
    if (($d = in_str('department')) !== '') {
        $where[] = 'e.department = ?';
        $params[] = $d;
    }
    if (isset(asset_types()[$t = in_str('type', 16)])) {
        $where[] = 'i.type = ?';
        $params[] = $t;
    }
    if ($w = ack_filter_sql(in('ack', ''), 'ho')) {
        $where[] = $w;
    }
    if (($s = in_str('q')) !== '') {
        $where[] = "(i.name LIKE ? ESCAPE '!' OR i.code LIKE ? ESCAPE '!' OR i.serial_no LIKE ? ESCAPE '!' OR i.specs LIKE ? ESCAPE '!' OR e.name LIKE ? ESCAPE '!' OR e.code LIKE ? ESCAPE '!' OR ho.doc_no LIKE ? ESCAPE '!')";
        array_push($params, like($s), like($s), like($s), like($s), like($s), like($s), like($s));
    }
    if ($from = in_date('from')) {
        $where[] = 'c.assigned_at >= ?';
        $params[] = $from;
    }
    if ($to = in_date('to')) {
        $where[] = 'c.assigned_at <= ?';
        $params[] = $to;
    }
    $where = implode(' AND ', $where);
    return decorate_items(q_all("SELECT c.*, i.code, i.type, i.name AS item_name, i.serial_no, i.brand, i.model, i.value, i.specs, i.linked_sim_id,
            e.name AS employee_name, e.code AS employee_code, e.department,
            ho.doc_no AS out_doc_no, ho.ack_at AS out_ack_at, ho.paper_signed_on AS out_paper_on, ho.token AS out_token,
            hi.doc_no AS in_doc_no, hi.ack_at AS in_ack_at, hi.paper_signed_on AS in_paper_on
        FROM custody c
        JOIN items i ON i.id = c.item_id
        JOIN employees e ON e.id = c.employee_id
        JOIN handovers ho ON ho.id = c.out_handover_id
        LEFT JOIN handovers hi ON hi.id = c.in_handover_id
        WHERE $where ORDER BY c.id DESC", $params));
}

function create_handover($type, $employeeId, $date, $notes)
{
    $id = insert('handovers', [
        'type' => $type,
        'employee_id' => $employeeId,
        'doc_date' => $date,
        'notes' => $notes,
        'created_by' => current_user()['id'],
        'created_at' => now(),
        'token' => bin2hex(random_bytes(20)),
    ]);
    update('handovers', $id, ['doc_no' => doc_no($type, $id, $date)]);
    return $id;
}

function do_assign($employeeId, array $lines, $date, $notes)
{
    $emp = q_one('SELECT * FROM employees WHERE id = ?', [$employeeId]);
    if (!$emp) {
        fail('اختر الموظف');
    }
    if (!$emp['active']) {
        fail('هذا الموظف موقوف');
    }
    if (!$lines) {
        fail('اختر صنفًا واحدًا على الأقل');
    }
    $hid = create_handover('out', $employeeId, $date, $notes);
    $seen = [];
    foreach ($lines as $line) {
        $itemId = (int)($line['item_id'] ?? 0);
        if (isset($seen[$itemId])) {
            continue;
        }
        $seen[$itemId] = true;
        $item = q_one('SELECT * FROM items WHERE id = ?', [$itemId]);
        if (!$item) {
            fail('صنف غير موجود');
        }
        if ($item['status'] !== 'متاحة') {
            fail("الصنف {$item['code']} - {$item['name']} حالته ({$item['status']}) ولا يمكن تسليمه");
        }
        $cond = (string)($line['condition'] ?? $item['item_condition']);
        if (!in_array($cond, ITEM_CONDITIONS, true)) {
            $cond = $item['item_condition'];
        }
        insert('custody', [
            'item_id' => $itemId,
            'employee_id' => $employeeId,
            'out_handover_id' => $hid,
            'assigned_at' => $date,
            'condition_out' => $cond,
            'notes_out' => mb_substr(trim((string)($line['notes'] ?? '')), 0, 500),
        ]);
        update('items', $itemId, ['status' => 'مسلمة', 'item_condition' => $cond]);
    }
    log_activity('تسليم عهدة', 'handover', $hid, $emp['name'] . ' - ' . count($seen) . ' صنف');
    return $hid;
}

function do_return(array $lines, $date, $notes)
{
    if (!$lines) {
        fail('اختر صنفًا واحدًا على الأقل');
    }
    $employeeId = null;
    $rows = [];
    foreach ($lines as $line) {
        $c = q_one('SELECT * FROM custody WHERE id = ?', [(int)($line['custody_id'] ?? 0)]);
        if (!$c || $c['in_handover_id']) {
            fail('أحد الأصناف تم ارتجاعه بالفعل، حدّث الصفحة');
        }
        if ($employeeId !== null && $employeeId !== (int)$c['employee_id']) {
            fail('سند الارتجاع يجب أن يكون لموظف واحد');
        }
        if ($date < $c['assigned_at']) {
            fail('تاريخ الارتجاع قبل تاريخ التسليم');
        }
        $employeeId = (int)$c['employee_id'];
        $rows[] = [$c, $line];
    }
    $hid = create_handover('in', $employeeId, $date, $notes);
    foreach ($rows as [$c, $line]) {
        $cond = (string)($line['condition'] ?? 'جيد');
        if (!in_array($cond, ITEM_CONDITIONS, true)) {
            $cond = 'جيد';
        }
        $status = (string)($line['status'] ?? 'متاحة');
        if ($status === 'مسلمة' || !in_array($status, ITEM_STATUSES, true)) {
            $status = 'متاحة';
        }
        update('custody', $c['id'], [
            'in_handover_id' => $hid,
            'returned_at' => $date,
            'condition_in' => $cond,
            'notes_in' => mb_substr(trim((string)($line['notes'] ?? '')), 0, 500),
        ]);
        update('items', $c['item_id'], ['status' => $status, 'item_condition' => $cond]);
    }
    $emp = q_val('SELECT name FROM employees WHERE id = ?', [$employeeId]);
    log_activity('ارتجاع عهدة', 'handover', $hid, $emp . ' - ' . count($rows) . ' صنف');
    return [$hid, $employeeId];
}

function handovers_query()
{
    $params = [];
    $where = ['1=1'];
    if (in_array(in('type'), ['out', 'in'], true)) {
        $where[] = 'h.type = ?';
        $params[] = in('type');
    }
    if ($w = ack_filter_sql(in('ack', ''), 'h')) {
        $where[] = $w;
    }
    if ($e = in_int('employee_id')) {
        $where[] = 'h.employee_id = ?';
        $params[] = $e;
    }
    if (($s = in_str('q')) !== '') {
        $where[] = "(h.doc_no LIKE ? ESCAPE '!' OR e.name LIKE ? ESCAPE '!')";
        array_push($params, like($s), like($s));
    }
    if ($from = in_date('from')) {
        $where[] = 'h.doc_date >= ?';
        $params[] = $from;
    }
    if ($to = in_date('to')) {
        $where[] = 'h.doc_date <= ?';
        $params[] = $to;
    }
    $where = implode(' AND ', $where);
    return q_all("SELECT h.id, h.doc_no, h.type, h.doc_date, h.notes, h.ack_at, h.ack_name, h.token, h.created_at, h.paper_scan_id, h.paper_signed_on,
            e.name AS employee_name, e.department, u.name AS created_by_name, s.uploaded_at AS paper_uploaded_at, su.name AS paper_by_name,
            (SELECT COUNT(*) FROM custody c WHERE c.out_handover_id = h.id OR c.in_handover_id = h.id) AS items_count
        FROM handovers h JOIN employees e ON e.id = h.employee_id LEFT JOIN users u ON u.id = h.created_by
        LEFT JOIN handover_scans s ON s.id = h.paper_scan_id LEFT JOIN users su ON su.id = s.uploaded_by
        WHERE $where ORDER BY h.id DESC LIMIT 1000", $params);
}

function handover_view($id)
{
    $h = q_one('SELECT h.*, e.name AS employee_name, e.code AS employee_code, e.department, e.job_title, e.phone, u.name AS created_by_name
        FROM handovers h JOIN employees e ON e.id = h.employee_id LEFT JOIN users u ON u.id = h.created_by WHERE h.id = ?', [$id]);
    if (!$h) {
        fail('السند غير موجود', 404);
    }
    $h['items'] = handover_items($id, $h['type']);
    $h['sign_url'] = sign_url($h['token']);
    $h['has_signature'] = !empty($h['ack_signature']);
    unset($h['ack_signature']);
    $h['scans'] = handover_scans_view($id);
    return $h;
}

// ---------------------------------------------------------------- استيراد وتصدير Excel

function dx_need_lib()
{
    if (!xlsx_available()) {
        fail('إضافات PHP المطلوبة لملفات Excel (zip و xml) مش متثبتة على السيرفر', 500);
    }
}

function dx_send_xlsx($path, $filename)
{
    header('Content-Type: application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    header('Content-Disposition: attachment; filename="' . $filename . '"');
    header('Content-Length: ' . filesize($path));
    header('Cache-Control: no-store');
    header('X-Content-Type-Options: nosniff');
    readfile($path);
    @unlink($path);
    exit;
}

// ملفات الاستيراد المرفوعة وتقاريرها بتتمسح بعد 30 يوم
function dx_cleanup()
{
    foreach (glob(dx_imports_dir() . '/*') ?: [] as $f) {
        if (is_file($f) && filemtime($f) < time() - 30 * 86400) {
            @unlink($f);
        }
    }
}

function dx_base($token)
{
    if (!preg_match('/^[a-f0-9]{32}$/', (string)$token)) {
        fail('ملف الاستيراد غير موجود', 404);
    }
    return dx_imports_dir() . '/' . $token;
}

// بيانات عملية الاستيراد: لصاحبها أو لمدير النظام بس
function dx_meta_load($token)
{
    $base = dx_base($token);
    $meta = is_file($base . '.json') ? json_decode((string)file_get_contents($base . '.json'), true) : null;
    if (!$meta || ((int)$meta['user_id'] !== (int)current_user()['id'] && !can('admin'))) {
        fail('ملف الاستيراد غير موجود أو انتهت صلاحيته. ارفع الملف تاني', 404);
    }
    return $meta;
}

function dx_meta_save(array $meta)
{
    $f = dx_base($meta['token']) . '.json';
    file_put_contents($f, json_encode($meta, JSON_UNESCAPED_UNICODE), LOCK_EX);
    @chmod($f, 0600);
}

function dx_preview_file($path, $mode)
{
    $data = dx_read($path);
    $P = dx_plan($data, $mode);
    $P->errors = array_merge($data['errors'], $P->errors);
    $P->warnings = array_merge($data['warnings'], $P->warnings);
    return [$P, dx_summary($P)];
}

function dx_counts_text(array $summary)
{
    $parts = [];
    foreach ($summary['sheets'] as $s) {
        if ($s['new'] || $s['update']) {
            $parts[] = $s['name'] . ': ' . $s['new'] . ' جديد' . ($s['update'] ? '، ' . $s['update'] . ' تعديل' : '');
        }
    }
    return $parts ? implode(' — ', $parts) : 'مفيش جديد';
}

function dx_import_preview()
{
    need('edit');
    dx_need_lib();
    $mode = in('mode') === 'update' ? 'update' : 'add';
    if ($mode === 'update') {
        // تحديث السجلات الموجودة بالجملة لمدير النظام بس
        need('admin');
    }
    $f = $_FILES['file'] ?? null;
    if (!$f || is_array($f['name'])) {
        fail('اختر ملف Excel');
    }
    if (in_array($f['error'], [UPLOAD_ERR_INI_SIZE, UPLOAD_ERR_FORM_SIZE], true) || $f['size'] > DX_MAX_FILE_MB * 1048576) {
        fail('حجم الملف أكبر من ' . DX_MAX_FILE_MB . ' م.ب');
    }
    if ($f['error'] !== UPLOAD_ERR_OK || !is_uploaded_file($f['tmp_name'])) {
        fail('تعذر رفع الملف، حاول تاني');
    }
    $name = mb_substr(basename(str_replace('\\', '/', (string)$f['name'])), 0, 150);
    if (!preg_match('/\.xlsx$/i', $name)) {
        fail('الملف لازم يكون Excel بصيغة xlsx. لو معاك xls أو csv، افتحه في Excel واحفظه بصيغة xlsx');
    }
    dx_cleanup();
    $token = bin2hex(random_bytes(16));
    $base = dx_base($token);
    if (!move_uploaded_file($f['tmp_name'], $base . '.xlsx')) {
        fail('تعذر حفظ الملف على السيرفر', 500);
    }
    @chmod($base . '.xlsx', 0600);
    try {
        [$P, $summary] = dx_preview_file($base . '.xlsx', $mode);
    } catch (DxError $e) {
        @unlink($base . '.xlsx');
        log_activity('استيراد Excel مرفوض', 'data', null, $name . ' — ' . $e->getMessage());
        fail($e->getMessage());
    }
    $u = current_user();
    dx_meta_save([
        'token' => $token, 'user_id' => (int)$u['id'], 'user_name' => $u['name'], 'file_name' => $name, 'size' => (int)$f['size'],
        'sha256' => hash_file('sha256', $base . '.xlsx'), 'mode' => $mode, 'created_at' => now(), 'status' => 'preview',
        'fingerprint' => dx_fingerprint($P), 'summary' => $summary, 'errors_all' => $P->errors,
    ]);
    if ($P->errors) {
        log_activity('استيراد Excel مرفوض', 'data', null, $name . ' — ' . count($P->errors) . ' خطأ، ولم يُحفظ أي شيء');
    }
    return ['token' => $token, 'file_name' => $name, 'summary' => $summary];
}

function dx_import_commit()
{
    need('edit');
    dx_need_lib();
    $meta = dx_meta_load(in_str('token', 64));
    $base = dx_base($meta['token']);
    if ($meta['mode'] === 'update') {
        need('admin');
    }
    // علشان الضغط مرتين أو من تابين مايستوردش الملف مرتين
    $lock = fopen($base . '.lock', 'c');
    if (!$lock || !flock($lock, LOCK_EX | LOCK_NB)) {
        fail('الاستيراد ده شغال بالفعل', 409);
    }
    $meta = dx_meta_load($meta['token']);
    if ($meta['status'] === 'done') {
        fail('الملف ده اتستورد بالفعل', 409);
    }
    if (!is_file($base . '.xlsx') || hash_file('sha256', $base . '.xlsx') !== $meta['sha256']) {
        fail('ملف الاستيراد مش موجود على السيرفر. ارفعه تاني', 409);
    }
    db()->beginTransaction();
    // قفل الكتابة قبل إعادة التحقق: استيرادين في نفس اللحظة مايعدّوش نفس الفحص
    q("UPDATE meta SET v = v WHERE k = 'schema_version'");
    try {
        [$P, $summary] = dx_preview_file($base . '.xlsx', $meta['mode']);
    } catch (DxError $e) {
        fail($e->getMessage(), 409);
    }
    if ($P->errors) {
        fail('ظهرت أخطاء في الملف مع البيانات الحالية في النظام. اعمل معاينة تاني', 409);
    }
    if (dx_fingerprint($P) !== $meta['fingerprint']) {
        fail('البيانات في النظام اتغيرت من وقت المعاينة. اعمل معاينة تاني قبل التأكيد', 409);
    }
    if (!$summary['can_commit']) {
        fail('مفيش سجلات جديدة أو تعديلات للاستيراد', 409);
    }
    try {
        $result = dx_apply($P, $meta['file_name']);
        log_activity('استيراد بيانات Excel', 'data', null, $meta['file_name'] . ' — ' . ($meta['mode'] === 'update' ? 'إضافة وتحديث' : 'إضافة فقط') . ' — ' .
            dx_counts_text($summary) . ($result['handovers'] ? ' — سندات: ' . implode('، ', $result['handovers']) : ''));
        db()->commit();
    } catch (Throwable $e) {
        if (db()->inTransaction()) {
            db()->rollBack();
        }
        $msg = $e instanceof ApiError ? $e->getMessage() : 'حدث خطأ غير متوقع في السيرفر';
        if (!$e instanceof ApiError) {
            error_log('[custody] import ' . $e);
        }
        $meta['status'] = 'failed';
        $meta['fail_msg'] = $msg;
        dx_meta_save($meta);
        log_activity('استيراد Excel فشل', 'data', null, $meta['file_name'] . ' — ' . $msg . ' — لم يُحفظ أي شيء');
        fail('فشل الاستيراد ولم يُحفظ أي شيء: ' . $msg, 409);
    }
    $meta['status'] = 'done';
    $meta['done_at'] = now();
    $meta['summary'] = $summary;
    $meta['result'] = $result;
    dx_meta_save($meta);
    return ['token' => $meta['token'], 'summary' => $summary, 'result' => $result];
}

// ---------------------------------------------------------------- dispatcher

function handle($action)
{
    switch ($action) {
        // ---------- auth
        case 'auth.me':
            $u = current_user();
            $imp = $u ? impersonator() : null;
            return [
                'user' => $u,
                'impersonator' => $imp ? ['id' => (int)$imp['id'], 'name' => $imp['name']] : null,
                'csrf' => $_SESSION['csrf'],
                'session' => session_info(),
                'app_name' => cfg('app_name'),
                'org_name' => cfg('org_name'),
                'statuses' => ITEM_STATUSES,
                'conditions' => ITEM_CONDITIONS,
                'roles' => ROLES,
                'today' => today(),
                'types' => asset_types(),
                'active_types' => array_keys(active_types()),
                'used_types' => array_keys(used_types()),
                'scan_limits' => ['file_mb' => cfg('scan_max_file_mb'), 'total_mb' => cfg('scan_max_total_mb'), 'files' => cfg('scan_max_files')],
            ];

        // حالة الجلسة لطلبات الخلفية: لا تُعتبر نشاطًا ولا تمدد المهلة
        case 'auth.session':
            $u = current_user();
            $imp = $u ? impersonator() : null;
            return [
                'user' => $u ? ['id' => (int)$u['id'], 'role' => $u['role']] : null,
                'impersonator' => $imp ? (int)$imp['id'] : null,
                'csrf' => $_SESSION['csrf'],
                'session' => session_info(),
            ];

        case 'auth.login':
            $u = q_one('SELECT * FROM users WHERE username = ? AND active = 1', [in_str('username', 64)]);
            if (!$u || !password_verify((string)in('password', ''), $u['password_hash'])) {
                fail('اسم المستخدم أو كلمة المرور غير صحيحة', 401);
            }
            session_regenerate_id(true);
            unset($_SESSION['imp_admin'], $_SESSION['imp_started'], $_SESSION['ended']);
            $_SESSION['uid'] = $u['id'];
            $_SESSION['csrf'] = bin2hex(random_bytes(16));
            $_SESSION['last_active'] = $_SESSION['regen_at'] = time();
            current_user(true);
            update('users', $u['id'], ['last_login' => now()]);
            log_activity('تسجيل دخول', 'user', $u['id']);
            return ['ok' => true];

        case 'auth.logout':
            // الخروج ينهي الجلسة بالكامل، ومعها هوية المدير الأصلية
            if (!empty($_SESSION['imp_admin']) && !empty($_SESSION['uid'])) {
                log_impersonation_end((int)$_SESSION['imp_admin'], (int)$_SESSION['uid'], $_SESSION['imp_started'] ?? '', 'تسجيل خروج');
            }
            end_session('logout');
            return ['ok' => true];

        // ---------- الدخول كمستخدم (لمدير النظام فقط)
        case 'auth.impersonate':
            need('admin');
            if (!empty($_SESSION['imp_admin'])) {
                fail('أنت تستخدم النظام باسم مستخدم آخر بالفعل. عُد لحساب المدير أولًا', 409);
            }
            $admin = current_user();
            $target = q_one('SELECT id, username, name, role, active FROM users WHERE id = ?', [in_int('id')]);
            if (!$target) {
                fail('المستخدم غير موجود', 404);
            }
            if ((int)$target['id'] === (int)$admin['id']) {
                fail('لا يمكنك الدخول بحسابك أنت');
            }
            if (!(int)$target['active']) {
                fail('هذا المستخدم موقوف');
            }
            log_activity('بدء الدخول كمستخدم', 'user', $target['id'], $target['name'] . ' (' . $target['username'] . ') — ' . (ROLES[$target['role']] ?? $target['role']));
            session_regenerate_id(true);
            $_SESSION['imp_admin'] = (int)$admin['id'];
            $_SESSION['imp_started'] = now();
            $_SESSION['uid'] = (int)$target['id'];
            $_SESSION['csrf'] = bin2hex(random_bytes(16));
            $_SESSION['regen_at'] = time();
            current_user(true);
            return ['ok' => true];

        case 'auth.stop_impersonation':
            if (empty($_SESSION['imp_admin']) || empty($_SESSION['uid'])) {
                fail('لا توجد جلسة دخول كمستخدم', 409);
            }
            $admin = impersonator();
            if (!$admin) {
                fail('انتهت الجلسة، سجّل الدخول مرة أخرى', 401);
            }
            log_impersonation_end((int)$admin['id'], (int)$_SESSION['uid'], $_SESSION['imp_started'] ?? '', 'العودة لحساب المدير');
            session_regenerate_id(true);
            unset($_SESSION['imp_admin'], $_SESSION['imp_started']);
            $_SESSION['uid'] = (int)$admin['id'];
            $_SESSION['csrf'] = bin2hex(random_bytes(16));
            $_SESSION['regen_at'] = time();
            current_user(true);
            return ['ok' => true];

        case 'auth.change_password':
            need('view');
            if (!empty($_SESSION['imp_admin'])) {
                fail('لا يمكن تغيير كلمة مرور المستخدم أثناء الدخول باسمه', 403);
            }
            $u = q_one('SELECT * FROM users WHERE id = ?', [current_user()['id']]);
            if (!password_verify((string)in('old_password', ''), $u['password_hash'])) {
                fail('كلمة المرور الحالية غير صحيحة');
            }
            $new = (string)in('new_password', '');
            if (mb_strlen($new) < 8) {
                fail('كلمة المرور الجديدة يجب ألا تقل عن 8 أحرف');
            }
            update('users', $u['id'], ['password_hash' => password_hash($new, PASSWORD_DEFAULT), 'must_change' => 0]);
            log_activity('تغيير كلمة المرور', 'user', $u['id']);
            return ['ok' => true];

        // ---------- dashboard
        case 'dashboard':
            need('view');
            $byStatus = [];
            foreach (q_all('SELECT status, COUNT(*) AS n FROM items GROUP BY status') as $r) {
                $byStatus[$r['status']] = (int)$r['n'];
            }
            return [
                'items_total' => array_sum($byStatus),
                'by_status' => $byStatus,
                'active_value' => (float)q_val('SELECT COALESCE(SUM(i.value),0) FROM custody c JOIN items i ON i.id = c.item_id WHERE c.in_handover_id IS NULL'),
                'employees_with_custody' => (int)q_val('SELECT COUNT(DISTINCT employee_id) FROM custody WHERE in_handover_id IS NULL'),
                'pending_ack' => (int)q_val("SELECT COUNT(*) FROM handovers h WHERE h.type = 'out' AND " . ack_filter_sql('pending', 'h')),
                'by_type' => array_map(function ($r) {
                    return ['type' => $r['type'], 'name' => type_label($r['type']), 'total' => (int)$r['total'], 'assigned' => (int)$r['assigned'], 'available' => (int)$r['available']];
                }, q_all("SELECT type, COUNT(*) AS total,
                        SUM(CASE WHEN status = 'مسلمة' THEN 1 ELSE 0 END) AS assigned,
                        SUM(CASE WHEN status = 'متاحة' THEN 1 ELSE 0 END) AS available
                    FROM items GROUP BY type ORDER BY total DESC")),
                'by_department' => q_all("SELECT COALESCE(NULLIF(e.department, ''), 'بدون قسم') AS name, COUNT(*) AS n, COALESCE(SUM(i.value),0) AS value
                    FROM custody c JOIN employees e ON e.id = c.employee_id JOIN items i ON i.id = c.item_id
                    WHERE c.in_handover_id IS NULL GROUP BY e.department ORDER BY n DESC"),
                'recent' => q_all("SELECT h.id, h.doc_no, h.type, h.doc_date, h.ack_at, h.paper_signed_on, e.name AS employee_name,
                        (SELECT COUNT(*) FROM custody c WHERE c.out_handover_id = h.id OR c.in_handover_id = h.id) AS items_count
                    FROM handovers h JOIN employees e ON e.id = h.employee_id ORDER BY h.id DESC LIMIT 10"),
            ];

        // ---------- lookups
        case 'lookups':
            need('view');
            return [
                'departments' => array_column(q_all("SELECT DISTINCT department FROM employees WHERE department IS NOT NULL AND department <> '' ORDER BY department"), 'department'),
                'branches' => array_column(q_all("SELECT DISTINCT branch FROM employees WHERE branch IS NOT NULL AND branch <> '' ORDER BY branch"), 'branch'),
                'locations' => array_column(q_all("SELECT DISTINCT location FROM items WHERE location IS NOT NULL AND location <> '' ORDER BY location"), 'location'),
            ];

        // ---------- employees
        case 'employees.list':
            need('view');
            return employees_query();

        case 'employees.get':
            need('view');
            $id = in_int('id');
            $e = q_one('SELECT * FROM employees WHERE id = ?', [$id]);
            if (!$e) {
                fail('الموظف غير موجود', 404);
            }
            return [
                'employee' => $e,
                'custody' => decorate_items(q_all("SELECT c.*, i.code, i.type, i.name AS item_name, i.brand, i.model, i.serial_no, i.value, i.specs,
                        ho.doc_no AS out_doc_no, ho.ack_at AS out_ack_at, ho.paper_signed_on AS out_paper_on, hi.doc_no AS in_doc_no
                    FROM custody c JOIN items i ON i.id = c.item_id
                    JOIN handovers ho ON ho.id = c.out_handover_id LEFT JOIN handovers hi ON hi.id = c.in_handover_id
                    WHERE c.employee_id = ? ORDER BY (c.in_handover_id IS NULL) DESC, c.id DESC", [$id])),
                'handovers' => q_all('SELECT id, doc_no, type, doc_date, ack_at, paper_signed_on FROM handovers WHERE employee_id = ? ORDER BY id DESC', [$id]),
            ];

        case 'employees.save':
            return save_employee();

        case 'employees.delete':
            need('admin');
            $id = in_int('id');
            if (q_val('SELECT COUNT(*) FROM handovers WHERE employee_id = ?', [$id])) {
                fail('لا يمكن حذف موظف له سجل عهد، يمكنك إيقافه بدلًا من ذلك');
            }
            $name = q_val('SELECT name FROM employees WHERE id = ?', [$id]);
            q('DELETE FROM employees WHERE id = ?', [$id]);
            log_activity('حذف موظف', 'employee', $id, $name);
            return ['ok' => true];

        // ---------- items
        case 'items.list':
            need('view');
            return items_query();

        case 'items.get':
            need('view');
            $id = in_int('id');
            $item = q_one('SELECT * FROM items WHERE id = ?', [$id]);
            if (!$item) {
                fail('الصنف غير موجود', 404);
            }
            return [
                'item' => decorate_item($item),
                // للشريحة: الجهاز المرتبطة به
                'linked_by' => q_one('SELECT id, code, name, type FROM items WHERE linked_sim_id = ?', [$id]),
                'history' => q_all('SELECT c.*, e.name AS employee_name, e.department, ho.doc_no AS out_doc_no, hi.doc_no AS in_doc_no
                    FROM custody c JOIN employees e ON e.id = c.employee_id JOIN handovers ho ON ho.id = c.out_handover_id
                    LEFT JOIN handovers hi ON hi.id = c.in_handover_id WHERE c.item_id = ? ORDER BY c.id DESC', [$id]),
            ];

        case 'items.save':
            return save_item();

        // الأصناف المتاحة للربط في حقل item_ref (مثل الشرائح لماكينات POS)، مع الجهاز المرتبطة به حاليًا
        case 'items.ref_options':
            need('view');
            $refType = in_str('type', 16);
            if (!isset(asset_types()[$refType])) {
                fail('نوع غير صحيح');
            }
            return q_all('SELECT s.id, s.code, s.serial_no, s.brand, s.status, d.id AS linked_id, d.code AS linked_code
                FROM items s LEFT JOIN items d ON d.linked_sim_id = s.id WHERE s.type = ? ORDER BY s.code', [$refType]);

        case 'items.delete':
            need('admin');
            $id = in_int('id');
            if (q_val('SELECT COUNT(*) FROM custody WHERE item_id = ?', [$id])) {
                fail('لا يمكن حذف صنف له سجل تسليم، يمكنك تغيير حالته إلى مكهنة');
            }
            if ($dev = q_val('SELECT code FROM items WHERE linked_sim_id = ?', [$id])) {
                fail('هذه الشريحة مرتبطة بالجهاز ' . $dev . '، ألغِ الربط من بيانات الجهاز أولًا');
            }
            $code = q_val('SELECT code FROM items WHERE id = ?', [$id]);
            q('DELETE FROM items WHERE id = ?', [$id]);
            log_activity('حذف صنف', 'item', $id, $code);
            return ['ok' => true];

        // ---------- custody operations
        case 'custody.list':
            need('view');
            return custody_query();

        case 'custody.assign':
            need('edit');
            db()->beginTransaction();
            $hid = do_assign(in_int('employee_id'), (array)in('lines', []), in_date('date', today()), in_str('notes', 1000));
            db()->commit();
            return handover_view($hid);

        case 'custody.return':
            need('edit');
            db()->beginTransaction();
            [$hid] = do_return((array)in('lines', []), in_date('date', today()), in_str('notes', 1000));
            db()->commit();
            return handover_view($hid);

        case 'custody.transfer':
            need('edit');
            $to = in_int('to_employee_id');
            $date = in_date('date', today());
            $notes = in_str('notes', 1000);
            $lines = (array)in('lines', []);
            db()->beginTransaction();
            [$rid, $fromId] = do_return($lines, $date, trim('نقل عهدة. ' . $notes));
            if ($to === $fromId) {
                fail('لا يمكن النقل لنفس الموظف');
            }
            $assign = [];
            foreach ($lines as $line) {
                $itemId = q_val('SELECT item_id FROM custody WHERE id = ?', [(int)$line['custody_id']]);
                $assign[] = ['item_id' => $itemId, 'condition' => $line['condition'] ?? null, 'notes' => $line['notes'] ?? ''];
            }
            $aid = do_assign($to, $assign, $date, trim('نقل عهدة. ' . $notes));
            db()->commit();
            return ['return' => handover_view($rid), 'assign' => handover_view($aid)];

        // ---------- handovers
        case 'handovers.list':
            need('view');
            return handovers_query();

        // ---------- الإقرار الورقي الموقّع (Scan)
        case 'handovers.paper_upload':
            need('edit');
            return save_paper_scan();

        case 'handovers.scan_file':
            need('view');
            send_scan_file();
            break;

        // رقم يتغير مع أي تعديل في البيانات، علشان الصفحات المفتوحة تتحدث لوحدها (طلب خلفية خفيف)
        case 'sync.version':
            need('view');
            return ['v' => implode('-', [
                (int)q_val('SELECT COALESCE(MAX(id), 0) FROM activity_log'),
                (int)q_val('SELECT COALESCE(MAX(id), 0) FROM handover_scans'),
                (int)q_val('SELECT COUNT(ack_at) FROM handovers'),
            ])];

        case 'handovers.get':
            need('view');
            return handover_view(in_int('id'));

        case 'handovers.renew_link':
            need('edit');
            $id = in_int('id');
            $h = q_one('SELECT * FROM handovers WHERE id = ?', [$id]);
            if (!$h) {
                fail('السند غير موجود', 404);
            }
            if ($h['ack_at']) {
                fail('السند موقّع بالفعل');
            }
            update('handovers', $id, ['token' => bin2hex(random_bytes(20))]);
            log_activity('تجديد رابط التوقيع', 'handover', $id, $h['doc_no']);
            return handover_view($id);

        // ---------- users
        case 'users.list':
            need('admin');
            return q_all('SELECT id, username, name, role, active, must_change, last_login, created_at FROM users ORDER BY id');

        case 'users.save':
            need('admin');
            $id = in_int('id');
            $row = [
                'username' => in_str('username', 64),
                'name' => in_str('name'),
                'role' => in_str('role', 16),
                'active' => in('active', 1) ? 1 : 0,
            ];
            if ($row['username'] === '' || $row['name'] === '') {
                fail('اسم المستخدم والاسم مطلوبان');
            }
            if (!preg_match('/^[A-Za-z0-9._-]{3,64}$/', $row['username'])) {
                fail('اسم المستخدم بالإنجليزية فقط (حروف وأرقام . _ -)');
            }
            if (!isset(ROLES[$row['role']])) {
                fail('الصلاحية غير صحيحة');
            }
            if (q_val('SELECT id FROM users WHERE username = ? AND id <> ?', [$row['username'], $id ?: 0])) {
                fail('اسم المستخدم مستخدم بالفعل');
            }
            if ($id === (int)current_user()['id'] && ($row['role'] !== 'admin' || !$row['active'])) {
                fail('لا يمكنك إيقاف حسابك أو تغيير صلاحيتك');
            }
            $pw = (string)in('password', '');
            if ($pw !== '') {
                if (mb_strlen($pw) < 8) {
                    fail('كلمة المرور يجب ألا تقل عن 8 أحرف');
                }
                $row['password_hash'] = password_hash($pw, PASSWORD_DEFAULT);
                $row['must_change'] = 1;
            } elseif (!$id) {
                fail('كلمة المرور مطلوبة للمستخدم الجديد');
            }
            if ($id) {
                update('users', $id, $row);
            } else {
                $row['created_at'] = now();
                $id = insert('users', $row);
            }
            log_activity('حفظ مستخدم', 'user', $id, $row['username']);
            return ['id' => $id];

        // ---------- activity log
        case 'log.list':
            need('admin');
            return q_all('SELECT l.*, u.name AS user_name, a.name AS impersonator_name FROM activity_log l
                LEFT JOIN users u ON u.id = l.user_id LEFT JOIN users a ON a.id = l.impersonator_id ORDER BY l.id DESC LIMIT 500');

        // ---------- ملف Excel موحّد لكل البيانات (تصدير / قالب / استيراد)
        case 'data.export':
        case 'data.template':
            need('edit');
            dx_need_lib();
            $tpl = $action === 'data.template';
            $tmp = tempnam(dx_imports_dir(), 'x');
            $counts = dx_write_workbook($tmp, $tpl ? 'template' : 'export');
            log_activity($tpl ? 'تحميل قالب الاستيراد' : 'تصدير بيانات Excel', 'data', null, $tpl ? DX_VERSION : implode('، ', array_map(function ($k, $n) {
                return dx_spec()[$k]['name'] . ' ' . $n;
            }, array_keys($counts), $counts)));
            dx_send_xlsx($tmp, $tpl ? 'custody-import-template.xlsx' : 'custody-data-' . date('Y-m-d-His') . '.xlsx');
            break;

        case 'data.import_preview':
            return dx_import_preview();

        case 'data.import_commit':
            return dx_import_commit();

        case 'data.import_report':
            need('edit');
            dx_need_lib();
            $meta = dx_meta_load(in('token'));
            $tmp = tempnam(dx_imports_dir(), 'x');
            xlsx_write($tmp, dx_report_workbook($meta), ['title' => 'تقرير استيراد']);
            dx_send_xlsx($tmp, 'custody-import-report-' . date('Y-m-d-His') . '.xlsx');
            break;

        // ---------- excel (csv)
        case 'export':
            need('view');
            $what = in('what');
            // عند تحديد نوع (لاب توب / موبايل / شريحة) تُصدَّر كل حقوله في أعمدة منفصلة
            $typeDef = asset_types()[in_str('type', 16)] ?? null;
            $specHeads = $typeDef ? array_column($typeDef['fields'], 'label') : ['النوع', serial_heading(array_keys(used_types())), 'المواصفات', 'الملحقات'];
            $specCells = function ($r) use ($typeDef) {
                if (!$typeDef) {
                    return [$r['type_label'], $r['serial_no'], $r['specs_text'], $r['accessories_text']];
                }
                return array_map(function ($f) use ($r) {
                    $v = $r['specs'][$f['key']] ?? '';
                    return is_array($v) ? implode('، ', $v) : $v;
                }, $typeDef['fields']);
            };
            if ($what === 'handovers') {
                $rows = array_map(function ($h) {
                    return [$h['doc_no'], $h['type'] === 'out' ? 'تسليم' : 'ارتجاع', $h['doc_date'], $h['employee_name'], $h['department'], $h['items_count'],
                        ack_status_text($h['ack_at'], $h['paper_signed_on']), $h['ack_at'], $h['ack_name'], $h['paper_signed_on'], $h['paper_by_name'], $h['paper_uploaded_at'],
                        $h['created_by_name']];
                }, handovers_query());
                csv_out('handovers-' . today() . '.csv', ['رقم السند', 'النوع', 'التاريخ', 'الموظف', 'القسم', 'عدد الأصناف', 'حالة التوقيع',
                    'وقت التوقيع الإلكتروني', 'الاسم في التوقيع الإلكتروني', 'تاريخ التوقيع الورقي', 'رفع الإقرار', 'وقت رفع الإقرار', 'بواسطة'], $rows);
            }
            if ($what === 'custody') {
                $rows = array_map(function ($r) use ($specCells) {
                    return array_merge([$r['out_doc_no'], $r['employee_code'], $r['employee_name'], $r['department'], $r['code'], $r['item_name']], $specCells($r),
                        [$r['value'], $r['assigned_at'], $r['condition_out'], ack_status_text($r['out_ack_at'], $r['out_paper_on']), $r['returned_at'], $r['condition_in'], $r['in_doc_no']]);
                }, custody_query());
                csv_out('custody-' . today() . '.csv', array_merge(['رقم سند التسليم', 'كود الموظف', 'الموظف', 'القسم', 'كود الأصل', 'الصنف'], $specHeads,
                    ['القيمة', 'تاريخ التسليم', 'الحالة عند التسليم', 'توقيع الموظف', 'تاريخ الارتجاع', 'الحالة عند الارتجاع', 'رقم سند الارتجاع']), $rows);
            }
            if ($what === 'items') {
                $rows = array_map(function ($r) use ($specCells) {
                    return array_merge([$r['code'], $r['name']], $specCells($r),
                        [$r['purchase_date'], $r['value'], $r['item_condition'], $r['status'], $r['holder_name'], $r['location'], $r['notes']]);
                }, items_query());
                csv_out('items-' . today() . '.csv', array_merge(['كود الأصل', 'الصنف'], $specHeads,
                    ['تاريخ الشراء', 'القيمة', 'الحالة الفنية', 'الوضع', 'في عهدة', 'المكان', 'ملاحظات']), $rows);
            }
            if ($what === 'employees') {
                $rows = array_map(function ($r) {
                    return [$r['code'], $r['name'], $r['national_id'], $r['department'], $r['job_title'], $r['branch'], $r['phone'], $r['email'],
                        $r['active'] ? 'نشط' : 'موقوف', $r['active_count'], $r['active_value']];
                }, employees_query());
                csv_out('employees-' . today() . '.csv', ['الكود', 'الاسم', 'الرقم القومي', 'القسم', 'الوظيفة', 'الفرع', 'الموبايل', 'البريد', 'الحالة',
                    'عدد أصناف العهدة', 'قيمة العهدة'], $rows);
            }
            fail('نوع التصدير غير معروف');
    }
    fail('إجراء غير معروف', 404);
}

// ---------------------------------------------------------------- bootstrap

start_session();
// الطلبات اللي بيعملها المستخدم بنفسه بتبعت X-Activity، أما فحص الجلسة في الخلفية فلا
if (($_SERVER['HTTP_X_ACTIVITY'] ?? '') === '1') {
    mark_activity();
}
$INPUT = $_GET;
$method = $_SERVER['REQUEST_METHOD'] ?? 'GET';
$action = (string)($_GET['action'] ?? '');

try {
    if ($method === 'POST') {
        if (stripos($_SERVER['CONTENT_TYPE'] ?? '', 'multipart/form-data') === 0) {
            // رفع ملفات (الإقرار الموقّع). لو الطلب أكبر من post_max_size بيوصل فاضي
            $INPUT = array_merge($_GET, $_POST);
            if (!$_POST && !$_FILES && (int)($_SERVER['CONTENT_LENGTH'] ?? 0) > 0) {
                fail('إجمالي حجم الملفات أكبر من المسموح على السيرفر (' . cfg('scan_max_total_mb') . ' م.ب)', 413);
            }
        } else {
            $body = json_decode(file_get_contents('php://input') ?: '[]', true);
            $INPUT = array_merge($_GET, is_array($body) ? $body : []);
        }
        if (!hash_equals($_SESSION['csrf'], (string)($_SERVER['HTTP_X_CSRF_TOKEN'] ?? ''))) {
            if (empty($_SESSION['uid']) && $action !== 'auth.login') {
                fail(session_end_message(), 401);
            }
            fail('انتهت صلاحية الصفحة، أعد تحميلها', 419);
        }
    } elseif (!in_array($action, ['auth.me', 'auth.session', 'dashboard', 'lookups', 'employees.list', 'employees.get', 'items.list', 'items.get',
        'custody.list', 'handovers.list', 'handovers.get', 'users.list', 'log.list', 'export', 'items.ref_options', 'handovers.scan_file', 'sync.version',
        'data.export', 'data.template', 'data.import_report'], true)) {
        fail('طريقة الطلب غير مسموحة', 405);
    }
    $result = handle($action);
    header('Content-Type: application/json; charset=utf-8');
    echo json_encode(['ok' => true, 'data' => $result], JSON_UNESCAPED_UNICODE);
} catch (ApiError | DxError $e) {
    if (db()->inTransaction()) {
        db()->rollBack();
    }
    http_response_code($e->getCode() ?: 400);
    header('Content-Type: application/json; charset=utf-8');
    echo json_encode(['ok' => false, 'error' => $e->getMessage()], JSON_UNESCAPED_UNICODE);
} catch (Throwable $e) {
    if (db()->inTransaction()) {
        db()->rollBack();
    }
    error_log('[custody] ' . $e);
    http_response_code(500);
    header('Content-Type: application/json; charset=utf-8');
    echo json_encode(['ok' => false, 'error' => 'حدث خطأ غير متوقع في السيرفر'], JSON_UNESCAPED_UNICODE);
}
