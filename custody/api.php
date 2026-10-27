<?php
require __DIR__ . '/lib.php';

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
        fail('انتهت الجلسة، سجّل الدخول مرة أخرى', 401);
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
        fputcsv($out, array_values($r));
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
        $v = mb_substr(trim((string)($input[$k] ?? '')), 0, 190);
        if ($v === '') {
            if (!empty($f['required'])) {
                fail($f['label'] . ' مطلوب');
            }
            continue;
        }
        if ($input_type === 'number') {
            if (!is_numeric($v) || $v < 0) {
                fail($f['label'] . ': أدخل رقمًا صحيحًا');
            }
            $v = (string)round((float)$v, 2);
        } elseif ($input_type === 'date' && !preg_match('/^\d{4}-\d{2}-\d{2}$/', $v)) {
            fail($f['label'] . ': صيغة التاريخ غير صحيحة');
        }
        if (!empty($f['options']) && !in_array($v, $f['options'], true)) {
            fail($f['label'] . ': اختر قيمة من القائمة');
        }
        if (!empty($f['pattern']) && !preg_match('/' . $f['pattern'] . '/u', $v)) {
            fail($f['pattern_msg'] ?? ($f['label'] . ' غير صحيح'));
        }
        if (array_key_exists($k, $cols)) {
            $cols[$k] = $v;
        } else {
            $specs[$k] = $v;
        }
    }
    $nameParts = [];
    foreach ($def['name'] as $k) {
        if (($cols[$k] ?? $specs[$k] ?? '') !== '') {
            $nameParts[] = $cols[$k] ?? $specs[$k];
        }
    }
    $name = trim(($def['name_prefix'] ?? '') . ' ' . implode(' ', $nameParts));
    return [$cols, $specs, $name ?: $def['label']];
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
    db()->beginTransaction();
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
    $ack = in('ack', '');
    if ($ack === 'signed') {
        $where[] = 'ho.ack_at IS NOT NULL';
    } elseif ($ack === 'pending') {
        $where[] = 'ho.ack_at IS NULL';
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
    return decorate_items(q_all("SELECT c.*, i.code, i.type, i.name AS item_name, i.serial_no, i.brand, i.model, i.value, i.specs,
            e.name AS employee_name, e.code AS employee_code, e.department,
            ho.doc_no AS out_doc_no, ho.ack_at AS out_ack_at, ho.token AS out_token,
            hi.doc_no AS in_doc_no, hi.ack_at AS in_ack_at
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
    return $h;
}

// ---------------------------------------------------------------- dispatcher

function handle($action)
{
    switch ($action) {
        // ---------- auth
        case 'auth.me':
            $u = current_user();
            return [
                'user' => $u,
                'csrf' => $_SESSION['csrf'],
                'app_name' => cfg('app_name'),
                'org_name' => cfg('org_name'),
                'statuses' => ITEM_STATUSES,
                'conditions' => ITEM_CONDITIONS,
                'roles' => ROLES,
                'today' => today(),
                'types' => asset_types(),
            ];

        case 'auth.login':
            $u = q_one('SELECT * FROM users WHERE username = ? AND active = 1', [in_str('username', 64)]);
            $attempts = $_SESSION['login_fail'] ?? [0, 0];
            if ($attempts[0] >= 5 && time() - $attempts[1] < 300) {
                fail('محاولات كثيرة، حاول بعد 5 دقائق', 429);
            }
            if (!$u || !password_verify((string)in('password', ''), $u['password_hash'])) {
                $_SESSION['login_fail'] = [$attempts[0] + 1, time()];
                fail('اسم المستخدم أو كلمة المرور غير صحيحة', 401);
            }
            unset($_SESSION['login_fail']);
            session_regenerate_id(true);
            $_SESSION['uid'] = $u['id'];
            $_SESSION['csrf'] = bin2hex(random_bytes(16));
            update('users', $u['id'], ['last_login' => now()]);
            log_activity('تسجيل دخول', 'user', $u['id']);
            return ['ok' => true];

        case 'auth.logout':
            $_SESSION = [];
            session_regenerate_id(true);
            return ['ok' => true];

        case 'auth.change_password':
            need('view');
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
                'pending_ack' => (int)q_val("SELECT COUNT(*) FROM handovers WHERE type = 'out' AND ack_at IS NULL"),
                'by_type' => array_map(function ($r) {
                    return ['type' => $r['type'], 'name' => type_label($r['type']), 'total' => (int)$r['total'], 'assigned' => (int)$r['assigned'], 'available' => (int)$r['available']];
                }, q_all("SELECT type, COUNT(*) AS total,
                        SUM(CASE WHEN status = 'مسلمة' THEN 1 ELSE 0 END) AS assigned,
                        SUM(CASE WHEN status = 'متاحة' THEN 1 ELSE 0 END) AS available
                    FROM items GROUP BY type ORDER BY total DESC")),
                'by_department' => q_all("SELECT COALESCE(NULLIF(e.department, ''), 'بدون قسم') AS name, COUNT(*) AS n, COALESCE(SUM(i.value),0) AS value
                    FROM custody c JOIN employees e ON e.id = c.employee_id JOIN items i ON i.id = c.item_id
                    WHERE c.in_handover_id IS NULL GROUP BY e.department ORDER BY n DESC"),
                'recent' => q_all("SELECT h.id, h.doc_no, h.type, h.doc_date, h.ack_at, e.name AS employee_name,
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
                        ho.doc_no AS out_doc_no, ho.ack_at AS out_ack_at, hi.doc_no AS in_doc_no
                    FROM custody c JOIN items i ON i.id = c.item_id
                    JOIN handovers ho ON ho.id = c.out_handover_id LEFT JOIN handovers hi ON hi.id = c.in_handover_id
                    WHERE c.employee_id = ? ORDER BY (c.in_handover_id IS NULL) DESC, c.id DESC", [$id])),
                'handovers' => q_all('SELECT id, doc_no, type, doc_date, ack_at FROM handovers WHERE employee_id = ? ORDER BY id DESC', [$id]),
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
                'history' => q_all('SELECT c.*, e.name AS employee_name, e.department, ho.doc_no AS out_doc_no, hi.doc_no AS in_doc_no
                    FROM custody c JOIN employees e ON e.id = c.employee_id JOIN handovers ho ON ho.id = c.out_handover_id
                    LEFT JOIN handovers hi ON hi.id = c.in_handover_id WHERE c.item_id = ? ORDER BY c.id DESC', [$id]),
            ];

        case 'items.save':
            return save_item();

        case 'items.delete':
            need('admin');
            $id = in_int('id');
            if (q_val('SELECT COUNT(*) FROM custody WHERE item_id = ?', [$id])) {
                fail('لا يمكن حذف صنف له سجل تسليم، يمكنك تغيير حالته إلى مكهنة');
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
            $params = [];
            $where = ['1=1'];
            if (in_array(in('type'), ['out', 'in'], true)) {
                $where[] = 'h.type = ?';
                $params[] = in('type');
            }
            if (in('ack') === 'signed') {
                $where[] = 'h.ack_at IS NOT NULL';
            } elseif (in('ack') === 'pending') {
                $where[] = 'h.ack_at IS NULL';
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
            return q_all("SELECT h.id, h.doc_no, h.type, h.doc_date, h.notes, h.ack_at, h.ack_name, h.token, h.created_at,
                    e.name AS employee_name, e.department, u.name AS created_by_name,
                    (SELECT COUNT(*) FROM custody c WHERE c.out_handover_id = h.id OR c.in_handover_id = h.id) AS items_count
                FROM handovers h JOIN employees e ON e.id = h.employee_id LEFT JOIN users u ON u.id = h.created_by
                WHERE $where ORDER BY h.id DESC LIMIT 1000", $params);

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
        case 'backup.download':
            need('admin');
            $file = cfg('backup_dir') . '/download-' . bin2hex(random_bytes(8)) . '.sqlite';
            try {
                backup_sqlite($file);
            } catch (RuntimeException $e) {
                fail($e->getMessage());
            }
            log_activity('تحميل نسخة احتياطية', null, null, round(filesize($file) / 1024) . ' KB');
            header('Content-Type: application/octet-stream');
            header('Content-Disposition: attachment; filename="custody-backup-' . date('Y-m-d_His') . '.sqlite"');
            header('Content-Length: ' . filesize($file));
            readfile($file);
            unlink($file);
            exit;

        case 'log.list':
            need('admin');
            return q_all('SELECT l.*, u.name AS user_name FROM activity_log l LEFT JOIN users u ON u.id = l.user_id ORDER BY l.id DESC LIMIT 500');

        // ---------- excel (csv)
        case 'export':
            need('view');
            $what = in('what');
            // عند تحديد نوع (لاب توب / موبايل / شريحة) تُصدَّر كل حقوله في أعمدة منفصلة
            $typeDef = asset_types()[in_str('type', 16)] ?? null;
            $specHeads = $typeDef ? array_column($typeDef['fields'], 'label') : ['النوع', 'الرقم التسلسلي / IMEI / رقم الخط', 'المواصفات', 'الملحقات'];
            $specCells = function ($r) use ($typeDef) {
                if (!$typeDef) {
                    return [$r['type_label'], $r['serial_no'], $r['specs_text'], $r['accessories_text']];
                }
                return array_map(function ($f) use ($r) {
                    $v = $r['specs'][$f['key']] ?? '';
                    return is_array($v) ? implode('، ', $v) : $v;
                }, $typeDef['fields']);
            };
            if ($what === 'custody') {
                $rows = array_map(function ($r) use ($specCells) {
                    return array_merge([$r['out_doc_no'], $r['employee_code'], $r['employee_name'], $r['department'], $r['code'], $r['item_name']], $specCells($r),
                        [$r['value'], $r['assigned_at'], $r['condition_out'], $r['out_ack_at'] ? 'موقّع' : 'بانتظار التوقيع', $r['returned_at'], $r['condition_in'], $r['in_doc_no']]);
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
$INPUT = $_GET;
$method = $_SERVER['REQUEST_METHOD'] ?? 'GET';
$action = (string)($_GET['action'] ?? '');

try {
    if ($method === 'POST') {
        $body = json_decode(file_get_contents('php://input') ?: '[]', true);
        $INPUT = array_merge($_GET, is_array($body) ? $body : []);
        if (!hash_equals($_SESSION['csrf'], (string)($_SERVER['HTTP_X_CSRF_TOKEN'] ?? ''))) {
            fail('انتهت صلاحية الصفحة، أعد تحميلها', 419);
        }
    } elseif (!in_array($action, ['auth.me', 'dashboard', 'lookups', 'employees.list', 'employees.get', 'items.list', 'items.get',
        'custody.list', 'handovers.list', 'handovers.get', 'users.list', 'log.list', 'export', 'backup.download'], true)) {
        fail('طريقة الطلب غير مسموحة', 405);
    }
    $result = handle($action);
    header('Content-Type: application/json; charset=utf-8');
    echo json_encode(['ok' => true, 'data' => $result], JSON_UNESCAPED_UNICODE);
} catch (ApiError $e) {
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
