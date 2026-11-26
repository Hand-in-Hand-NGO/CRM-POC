<?php
// أدوات مشتركة: الإعدادات، قاعدة البيانات، الجلسة، الصلاحيات، السجل.

$CONFIG = require __DIR__ . '/config.php';
date_default_timezone_set($CONFIG['timezone']);

const ITEM_STATUSES = ['متاحة', 'مسلمة', 'صيانة', 'تالفة', 'مفقودة', 'مكهنة'];
const ITEM_CONDITIONS = ['جديد', 'جيد', 'مستعمل', 'يحتاج صيانة', 'تالف'];
const ROLES = ['admin' => 'مدير النظام', 'editor' => 'مسؤول عهد', 'viewer' => 'مشاهدة فقط'];

function cfg($key)
{
    global $CONFIG;
    return $CONFIG[$key] ?? null;
}

function now()
{
    return date('Y-m-d H:i:s');
}

function today()
{
    return date('Y-m-d');
}

function h($s)
{
    return htmlspecialchars((string)$s, ENT_QUOTES, 'UTF-8');
}

function db()
{
    static $pdo = null;
    if ($pdo) {
        return $pdo;
    }
    $c = cfg('db');
    if ($c['driver'] === 'mysql') {
        $m = $c['mysql'];
        $dsn = "mysql:host={$m['host']};port=" . ($m['port'] ?? 3306) . ";dbname={$m['name']};charset=utf8mb4";
        $pdo = new PDO($dsn, $m['user'], $m['pass']);
    } else {
        $dir = dirname($c['sqlite_path']);
        if (!is_dir($dir)) {
            mkdir($dir, 0775, true);
        }
        $pdo = new PDO('sqlite:' . $c['sqlite_path']);
        $pdo->exec('PRAGMA foreign_keys = ON');
        $pdo->exec('PRAGMA journal_mode = WAL');
        $pdo->exec('PRAGMA busy_timeout = 5000');
    }
    $pdo->setAttribute(PDO::ATTR_ERRMODE, PDO::ERRMODE_EXCEPTION);
    $pdo->setAttribute(PDO::ATTR_DEFAULT_FETCH_MODE, PDO::FETCH_ASSOC);
    install_schema($pdo, $c['driver']);
    return $pdo;
}

const SCHEMA_VERSION = 5;

function install_schema(PDO $pdo, $driver)
{
    $v = 0;
    try {
        $v = (int)$pdo->query("SELECT v FROM meta WHERE k = 'schema_version'")->fetchColumn();
    } catch (PDOException $e) {
        // الجداول غير موجودة بعد
    }
    if ($v >= SCHEMA_VERSION) {
        return;
    }
    if ($v >= 1) {
        if ($v < 2) {
            // الإصدار 2: نوع الصنف (لاب توب / موبايل / شريحة) ومواصفاته
            $pdo->exec("ALTER TABLE items ADD COLUMN type VARCHAR(16) NOT NULL DEFAULT 'laptop'");
            $pdo->exec('ALTER TABLE items ADD COLUMN specs TEXT');
        }
        if ($v < 3) {
            // الإصدار 3: المدير الذي نفّذ العملية بالنيابة عن المستخدم (الدخول كمستخدم)
            $pdo->exec('ALTER TABLE activity_log ADD COLUMN impersonator_id INT');
        }
        if ($v < 4) {
            // الإصدار 4: ربط ماكينة POS بشريحة. الفهرس الفريد يمنع ربط الشريحة نفسها بأكثر من جهاز
            $pdo->exec('ALTER TABLE items ADD COLUMN linked_sim_id INT');
            $pdo->exec('CREATE UNIQUE INDEX idx_items_linked_sim ON items (linked_sim_id)');
        }
        if ($v < 5) {
            // الإصدار 5: الإقرار الورقي الموقّع (Scan) وإصداراته
            $pk = $driver === 'mysql' ? 'INT AUTO_INCREMENT PRIMARY KEY' : 'INTEGER PRIMARY KEY AUTOINCREMENT';
            $tbl = $driver === 'mysql' ? ' ENGINE=InnoDB DEFAULT CHARSET=utf8mb4' : '';
            $pdo->exec('ALTER TABLE handovers ADD COLUMN paper_scan_id INT');
            $pdo->exec('ALTER TABLE handovers ADD COLUMN paper_signed_on VARCHAR(10)');
            foreach (require __DIR__ . '/schema.php' as $sql) {
                if (preg_match('/handover_scans/', $sql)) {
                    $pdo->exec(str_replace(['{PK}', '{TBL}'], [$pk, $tbl], $sql));
                }
            }
        }
        $pdo->exec("UPDATE meta SET v = '" . SCHEMA_VERSION . "' WHERE k = 'schema_version'");
        return;
    }
    $pk = $driver === 'mysql' ? 'INT AUTO_INCREMENT PRIMARY KEY' : 'INTEGER PRIMARY KEY AUTOINCREMENT';
    $tbl = $driver === 'mysql' ? ' ENGINE=InnoDB DEFAULT CHARSET=utf8mb4' : '';
    foreach (require __DIR__ . '/schema.php' as $sql) {
        $sql = str_replace(['{PK}', '{TBL}'], [$pk, $tbl], $sql);
        try {
            $pdo->exec($sql);
        } catch (PDOException $e) {
            if (!preg_match('/^CREATE (UNIQUE )?INDEX/i', $sql)) {
                throw $e;
            }
        }
    }
    $count = (int)$pdo->query('SELECT COUNT(*) FROM users')->fetchColumn();
    if ($count === 0) {
        $st = $pdo->prepare('INSERT INTO users (username, name, password_hash, role, active, must_change, created_at) VALUES (?, ?, ?, ?, 1, 1, ?)');
        $st->execute(['admin', 'مدير النظام', password_hash('admin123', PASSWORD_DEFAULT), 'admin', now()]);
    }
    $pdo->prepare('INSERT INTO meta (k, v) VALUES (?, ?)')->execute(['schema_version', (string)SCHEMA_VERSION]);
}

function q($sql, $params = [])
{
    $st = db()->prepare($sql);
    $st->execute($params);
    return $st;
}

function q_all($sql, $params = [])
{
    return q($sql, $params)->fetchAll();
}

function q_one($sql, $params = [])
{
    $row = q($sql, $params)->fetch();
    return $row ?: null;
}

function q_val($sql, $params = [])
{
    return q($sql, $params)->fetchColumn();
}

function insert($table, array $row)
{
    $cols = array_keys($row);
    $sql = "INSERT INTO $table (" . implode(', ', $cols) . ') VALUES (' . implode(', ', array_fill(0, count($cols), '?')) . ')';
    q($sql, array_values($row));
    return (int)db()->lastInsertId();
}

function update($table, $id, array $row)
{
    $set = implode(', ', array_map(function ($c) {
        return "$c = ?";
    }, array_keys($row)));
    q("UPDATE $table SET $set WHERE id = ?", array_merge(array_values($row), [$id]));
}

// مهلة الخمول بالثواني (الافتراضي 6 ساعات)
function session_idle_seconds()
{
    return max(60, (int)round(cfg('session_minutes') * 60));
}

// فولدر ملفات الجلسات الخاص بالنظام. تنظيف PHP العام للجلسات (cron كل 30 دقيقة على Ubuntu
// بمهلة 24 دقيقة) كان بيمسح ملفات الجلسات الخاملة قبل مهلة النظام فيخرج المستخدم.
function session_dir()
{
    $dir = (string)cfg('session_path');
    if ($dir === '') {
        $dir = dirname(cfg('db')['sqlite_path'] ?? (__DIR__ . '/data/custody.sqlite')) . '/sessions';
    }
    if (!is_dir($dir)) {
        @mkdir($dir, 0700, true);
    }
    return is_dir($dir) && is_writable($dir) ? $dir : null;
}

function start_session()
{
    if (session_status() === PHP_SESSION_ACTIVE) {
        return;
    }
    $idle = session_idle_seconds();
    $dir = session_dir();
    if ($dir) {
        session_save_path($dir);
        ini_set('session.gc_probability', '1');
        ini_set('session.gc_divisor', '100');
    } else {
        error_log('[custody] تعذر إنشاء فولدر الجلسات، يتم استخدام فولدر PHP الافتراضي');
    }
    // ملف الجلسة يبقى أطول من مهلة الخمول، والتحقق الفعلي من المهلة يتم هنا وليس بالحذف
    ini_set('session.gc_maxlifetime', (string)($idle + 3600));
    ini_set('session.use_strict_mode', '1');
    ini_set('session.use_only_cookies', '1');
    ini_set('session.use_trans_sid', '0');
    session_name('custody_sid');
    session_set_cookie_params([
        'lifetime' => 0,
        'path' => '/',
        'httponly' => true,
        'samesite' => 'Lax',
        'secure' => !empty($_SERVER['HTTPS']) && $_SERVER['HTTPS'] !== 'off',
    ]);
    session_start();

    // معرّف قديم بعد تغييره دوريًا: طلب متزامن خرج قبل وصول الكوكي الجديد ينتقل للمعرّف الجديد،
    // لكن استخدامه بعد دقيقتين يعتبر غير موثوق وينهي الجلسة القديمة
    if (!empty($_SESSION['moved_to'])) {
        if (time() - (int)($_SESSION['moved_at'] ?? 0) <= 120) {
            switch_session_id($_SESSION['moved_to']);
        } else {
            $_SESSION = [];
            session_regenerate_id(true);
        }
    }

    if (!empty($_SESSION['uid'])) {
        $last = (int)($_SESSION['last_active'] ?? $_SESSION['seen'] ?? 0);
        if (time() - $last > $idle) {
            // انتهاء الجلسة ينهي الدخول كمستخدم أيضًا، ولا تبقى أي وسيلة للعودة بدون تسجيل دخول
            if (!empty($_SESSION['imp_admin'])) {
                log_impersonation_end((int)$_SESSION['imp_admin'], (int)$_SESSION['uid'], $_SESSION['imp_started'] ?? '', 'انتهاء الجلسة لعدم النشاط');
            }
            end_session('idle');
        } else {
            if (!isset($_SESSION['last_active'])) {
                $_SESSION['last_active'] = $last;
            }
            if (time() - (int)($_SESSION['regen_at'] ?? 0) > cfg('session_regen_minutes') * 60) {
                rotate_session_id();
            }
        }
    }
    unset($_SESSION['seen']);
    if (empty($_SESSION['csrf'])) {
        $_SESSION['csrf'] = bin2hex(random_bytes(16));
    }
}

// تغيير معرّف الجلسة مع الاحتفاظ ببياناتها. الجلسة الجديدة بتتكتب كاملة قبل ما نسيب القديمة،
// والقديمة بتشاور على الجديدة لفترة قصيرة، علشان الطلبات المتزامنة اللي لسه شايلة الكوكي القديم ماتخرجش المستخدم.
function rotate_session_id()
{
    $data = $_SESSION;
    $data['regen_at'] = time();
    $new = session_create_id();
    $file = rtrim(session_save_path() ?: sys_get_temp_dir(), '/') . '/sess_' . $new;
    $_SESSION = $data;
    if (!$new || @file_put_contents($file, session_encode(), LOCK_EX) === false) {
        return;
    }
    @chmod($file, 0600);
    $_SESSION = ['moved_to' => $new, 'moved_at' => time()];
    session_write_close();
    switch_session_id($new);
}

function switch_session_id($id)
{
    if (session_status() === PHP_SESSION_ACTIVE) {
        session_write_close();
    }
    session_id($id);
    session_start();
}

// إنهاء تسجيل الدخول مع حفظ السبب لعرضه للمستخدم: idle / logout / disabled
function end_session($reason)
{
    $_SESSION = ['ended' => $reason, 'csrf' => bin2hex(random_bytes(16))];
    session_regenerate_id(true);
}

// يسجل نشاطًا فعليًا من المستخدم فيتجدد توقيت الخمول. طلبات الخلفية لا تستدعيه.
function mark_activity()
{
    start_session();
    if (!empty($_SESSION['uid'])) {
        $_SESSION['last_active'] = time();
    }
}

function session_info()
{
    start_session();
    $idle = session_idle_seconds();
    $logged = !empty($_SESSION['uid']) && current_user();
    return [
        'idle' => $idle,
        'warn' => (int)round(cfg('session_warn_minutes') * 60),
        'remaining' => $logged ? max(0, $idle - (time() - (int)$_SESSION['last_active'])) : 0,
        'ended' => $logged ? null : ($_SESSION['ended'] ?? null),
        'message' => $logged ? null : session_end_message(),
    ];
}

function idle_text()
{
    $m = (int)round(cfg('session_minutes'));
    if ($m >= 60 && $m % 60 === 0) {
        $h = $m / 60;
        return $h === 1 ? 'ساعة' : ($h === 2 ? 'ساعتين' : $h . ($h <= 10 ? ' ساعات' : ' ساعة'));
    }
    return $m . ($m >= 3 && $m <= 10 ? ' دقائق' : ' دقيقة');
}

function session_end_message()
{
    switch ($_SESSION['ended'] ?? '') {
        case 'idle':
            return 'انتهت الجلسة لعدم النشاط لمدة ' . idle_text() . '. سجّل الدخول مرة أخرى';
        case 'logout':
            return 'تم تسجيل الخروج. سجّل الدخول مرة أخرى';
        case 'disabled':
            return 'تم إيقاف الحساب أو تغيير صلاحياته. سجّل الدخول مرة أخرى أو تواصل مع مدير النظام';
    }
    return 'انتهت الجلسة، سجّل الدخول مرة أخرى';
}

// حالة توقيع الموظف على السند: إلكتروني (من الرابط) و/أو ورقي (إقرار موقّع مرفوع)
function ack_status_text($ackAt, $paperOn)
{
    if ($ackAt && $paperOn) {
        return 'موقّع إلكترونيًا وورقيًا';
    }
    return $ackAt ? 'موقّع إلكترونيًا' : ($paperOn ? 'موقّع ورقيًا' : 'بانتظار التوقيع');
}

// شرط SQL لفلتر التوقيع: signed (أي توقيع) / esign / paper / pending
function ack_filter_sql($ack, $alias)
{
    switch ($ack) {
        case 'signed':
            return "($alias.ack_at IS NOT NULL OR $alias.paper_scan_id IS NOT NULL)";
        case 'esign':
            return "$alias.ack_at IS NOT NULL";
        case 'paper':
            return "$alias.paper_scan_id IS NOT NULL";
        case 'pending':
            return "($alias.ack_at IS NULL AND $alias.paper_scan_id IS NULL)";
    }
    return null;
}

// المستخدم الفعلي للجلسة. أثناء "الدخول كمستخدم" هو المستخدم المستهدف بصلاحياته هو فقط.
// $reset لإعادة القراءة بعد تبديل هوية الجلسة.
function current_user($reset = false)
{
    static $user = false;
    if ($user !== false && !$reset) {
        return $user;
    }
    start_session();
    $user = null;
    if (!empty($_SESSION['imp_admin']) && !impersonator()) {
        return $user = null;
    }
    if (!empty($_SESSION['uid'])) {
        $user = q_one('SELECT id, username, name, role, must_change FROM users WHERE id = ? AND active = 1', [$_SESSION['uid']]);
        if (!$user) {
            // الحساب اتوقف أو اتحذف: الجلسات القائمة تنتهي فورًا
            if (!empty($_SESSION['imp_admin'])) {
                log_impersonation_end((int)$_SESSION['imp_admin'], (int)$_SESSION['uid'], $_SESSION['imp_started'] ?? '', 'إيقاف حساب المستخدم');
            }
            end_session('disabled');
        }
    }
    return $user;
}

function can($perm)
{
    $u = current_user();
    if (!$u) {
        return false;
    }
    if ($perm === 'view') {
        return true;
    }
    if ($perm === 'edit') {
        return in_array($u['role'], ['admin', 'editor'], true);
    }
    return $u['role'] === 'admin';
}

// المدير الأصلي أثناء "الدخول كمستخدم" (محفوظ في الجلسة على السيرفر فقط)، أو null.
// لو المدير لم يعد نشطًا أو لم يعد مديرًا تُلغى الجلسة بالكامل.
function impersonator()
{
    static $admin = false;
    if ($admin !== false) {
        return $admin;
    }
    start_session();
    $admin = null;
    if (!empty($_SESSION['imp_admin'])) {
        $admin = q_one("SELECT id, username, name FROM users WHERE id = ? AND active = 1 AND role = 'admin'", [$_SESSION['imp_admin']]);
        if (!$admin) {
            end_session('disabled');
            current_user(true);
        }
    }
    return $admin;
}

function log_activity($action, $entity = null, $entityId = null, $details = null)
{
    $u = current_user();
    insert('activity_log', [
        'user_id' => $u ? $u['id'] : null,
        'action' => $action,
        'entity' => $entity,
        'entity_id' => $entityId,
        'details' => is_array($details) ? json_encode($details, JSON_UNESCAPED_UNICODE) : $details,
        'created_at' => now(),
        // العملية تُنسب للمستخدم، مع توضيح المدير الذي نفّذها بالنيابة عنه
        'impersonator_id' => $u && !empty($_SESSION['imp_admin']) ? (int)$_SESSION['imp_admin'] : null,
    ]);
}

// سجل انتهاء "الدخول كمستخدم" باسم المدير الأصلي: عودة للمدير، أو تسجيل خروج، أو انتهاء الجلسة
function log_impersonation_end($adminId, $targetId, $started, $reason)
{
    $t = q_one('SELECT username, name FROM users WHERE id = ?', [$targetId]);
    insert('activity_log', [
        'user_id' => $adminId,
        'action' => 'إنهاء الدخول كمستخدم',
        'entity' => 'user',
        'entity_id' => $targetId,
        'details' => ($t ? $t['name'] . ' (' . $t['username'] . ')' : '#' . $targetId) . ' — بدأت ' . $started . ' — السبب: ' . $reason,
        'created_at' => now(),
        'impersonator_id' => null,
    ]);
}

function base_url()
{
    $b = rtrim((string)cfg('base_url'), '/');
    if ($b !== '') {
        return $b;
    }
    $https = (!empty($_SERVER['HTTPS']) && $_SERVER['HTTPS'] !== 'off') || (($_SERVER['HTTP_X_FORWARDED_PROTO'] ?? '') === 'https');
    $host = $_SERVER['HTTP_HOST'] ?? 'localhost';
    $dir = rtrim(str_replace('\\', '/', dirname($_SERVER['SCRIPT_NAME'] ?? '/')), '/');
    return ($https ? 'https' : 'http') . '://' . $host . $dir;
}

function sign_url($token)
{
    return base_url() . '/sign.php?t=' . urlencode($token);
}

function doc_no($type, $id, $date)
{
    return ($type === 'out' ? 'TS' : 'RT') . '-' . substr($date, 0, 4) . '-' . str_pad((string)$id, 5, '0', STR_PAD_LEFT);
}

// أنواع الأصناف وحقول كل نوع (types.json)
function asset_types()
{
    static $types = null;
    if ($types === null) {
        $types = json_decode(file_get_contents(__DIR__ . '/types.json'), true);
    }
    return $types;
}

// الأنواع المفعّلة. "active": false في types.json بيوقف إضافة أصناف جديدة من النوع ويخفيه من الواجهة
function active_types()
{
    return array_filter(asset_types(), function ($def) {
        return $def['active'] ?? true;
    });
}

// الأنواع المفعّلة + أي نوع متوقف لسه عليه أصناف متسجلة، علشان بياناته ماتختفيش
function used_types()
{
    static $used = null;
    if ($used === null) {
        $present = array_column(q_all('SELECT DISTINCT type FROM items'), 'type');
        $used = array_filter(asset_types(), function ($def, $t) use ($present) {
            return ($def['active'] ?? true) || in_array($t, $present, true);
        }, ARRAY_FILTER_USE_BOTH);
    }
    return $used;
}

// عنوان عمود المعرّف حسب الأنواع، مثل "الرقم التسلسلي (S/N)" أو "الرقم التسلسلي (S/N) / IMEI 1"
function serial_heading(array $typeKeys)
{
    $labels = [];
    foreach (array_unique($typeKeys) as $t) {
        foreach (asset_types()[$t]['fields'] ?? [] as $f) {
            if ($f['key'] === 'serial_no') {
                $labels[$f['label']] = true;
            }
        }
    }
    return $labels ? implode(' / ', array_keys($labels)) : 'الرقم التسلسلي';
}

function type_label($type)
{
    return asset_types()[$type]['label'] ?? $type;
}

// اسم الصنف من حقول النوع، مثل: "Dell Latitude 5420" أو "خط فودافون"
function item_name($type, array $cols, array $specs)
{
    $def = asset_types()[$type];
    $nameParts = [];
    foreach ($def['name'] as $k) {
        if (($cols[$k] ?? $specs[$k] ?? '') !== '') {
            $nameParts[] = $cols[$k] ?? $specs[$k];
        }
    }
    $name = trim(($def['name_prefix'] ?? '') . ' ' . implode(' ', $nameParts));
    return $name ?: $def['label'];
}

// يتحقق من قيمة حقل نصي / رقم / تاريخ من حقول النوع (types.json). يرجع [القيمة بعد التنظيف, رسالة الخطأ أو null]
// مشترك بين نموذج الصنف واستيراد Excel علشان القواعد تبقى واحدة
function type_field_check(array $f, $v)
{
    $v = mb_substr(trim((string)$v), 0, 190);
    if ($v === '') {
        return ['', !empty($f['required']) ? $f['label'] . ' مطلوب' : null];
    }
    $input = $f['input'] ?? 'text';
    if ($input === 'number') {
        if (!is_numeric($v) || $v < 0) {
            return [$v, $f['label'] . ': أدخل رقمًا صحيحًا'];
        }
        $v = (string)round((float)$v, 2);
    } elseif ($input === 'date' && !preg_match('/^\d{4}-\d{2}-\d{2}$/', $v)) {
        return [$v, $f['label'] . ': صيغة التاريخ غير صحيحة'];
    }
    if (!empty($f['options']) && !in_array($v, $f['options'], true)) {
        return [$v, $f['label'] . ': اختر قيمة من القائمة'];
    }
    if (!empty($f['pattern']) && !preg_match('/' . $f['pattern'] . '/u', $v)) {
        return [$v, $f['pattern_msg'] ?? ($f['label'] . ' غير صحيح')];
    }
    return [$v, null];
}

// يضيف للصف: اسم النوع، المواصفات كمصفوفة، وملخص نصي للمواصفات والملحقات
function decorate_item(array $row)
{
    $types = asset_types();
    $t = $types[$row['type'] ?? ''] ?? null;
    $specs = json_decode((string)($row['specs'] ?? ''), true) ?: [];
    foreach (['brand', 'model', 'serial_no'] as $col) {
        if (isset($row[$col])) {
            $specs[$col] = $row[$col];
        }
    }
    // حقول الربط بصنف آخر (مثل شريحة ماكينة POS): المعرّف في refs، والنص المعروض في specs
    $row['refs'] = [];
    foreach ($t ? $t['fields'] : [] as $f) {
        if (($f['input'] ?? '') === 'item_ref') {
            $refId = (int)($row[$f['column']] ?? 0);
            $row['refs'][$f['key']] = $refId ?: null;
            $text = $refId ? linked_item_text($refId) : '';
            if ($text !== '') {
                $specs[$f['key']] = $text;
            }
        }
    }
    $row['refs'] = (object)$row['refs'];
    $row['type_label'] = $t ? $t['label'] : '';
    $row['specs'] = $specs;
    $short = $t ? array_column($t['fields'], 'short', 'key') : [];
    $parts = [];
    foreach ($t ? $t['summary'] : [] as $k) {
        $v = is_array($specs[$k] ?? '') ? implode('، ', $specs[$k]) : (string)($specs[$k] ?? '');
        if ($v !== '') {
            $parts[] = isset($short[$k]) ? $short[$k] . ': ' . $v : $v;
        }
    }
    $row['specs_text'] = implode(' / ', $parts);
    $row['accessories_text'] = implode('، ', (array)($specs['accessories'] ?? []));
    return $row;
}

function decorate_items(array $rows)
{
    return array_map('decorate_item', $rows);
}

// وصف مختصر لصنف مرتبط، مثل: "01012345678 - فودافون (SM-00003)"
function linked_item_text($id)
{
    static $cache = [];
    if (!array_key_exists($id, $cache)) {
        $r = q_one('SELECT code, serial_no, brand FROM items WHERE id = ?', [$id]);
        $cache[$id] = $r ? trim($r['serial_no'] . ($r['brand'] ? ' - ' . $r['brand'] : '')) . ' (' . $r['code'] . ')' : '';
    }
    return $cache[$id];
}

// خلية "المواصفات والملحقات" في السندات المطبوعة وصفحة التوقيع
function item_details_html(array $it)
{
    $html = $it['specs_text'] !== '' ? implode(' / ', array_map(function ($x) {
        return '<bdi>' . h($x) . '</bdi>';
    }, explode(' / ', $it['specs_text']))) : '';
    if ($it['accessories_text'] !== '') {
        $html .= ($html !== '' ? '<br>' : '') . '<small><span class="info-label">الملحقات:</span> ' . h($it['accessories_text']) . '</small>';
    }
    return $html !== '' ? $html : '-';
}

function handover_items($handoverId, $type)
{
    $col = $type === 'out' ? 'out_handover_id' : 'in_handover_id';
    return decorate_items(q_all("SELECT c.*, i.code, i.type, i.name, i.brand, i.model, i.serial_no, i.value, i.specs, i.linked_sim_id
        FROM custody c JOIN items i ON i.id = c.item_id
        WHERE c.$col = ? ORDER BY c.id", [$handoverId]));
}

// صفحة HTML مشتركة (head) لكل الصفحات
function page_head($title)
{
    ?><!doctype html>
<html lang="ar" dir="rtl">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title><?= h($title) ?></title>
<link rel="stylesheet" href="assets/vendor/bootstrap/css/bootstrap.min.css">
<link rel="stylesheet" href="assets/vendor/bootstrap/css/bootstrap-rtl.min.css">
<link rel="stylesheet" href="assets/vendor/font-awesome/css/font-awesome.min.css">
<link rel="stylesheet" href="assets/vendor/fonts/noto-kufi-arabic.css">
<link rel="stylesheet" href="<?= asset('assets/theme.css') ?>">
<link rel="stylesheet" href="<?= asset('assets/app.css') ?>">
</head>
<?php
}

// رابط ملف ثابت برقم إصدار حسب تاريخ تعديله، حتى لا يستخدم المتصفح نسخة قديمة بعد التحديث
function asset($path)
{
    $f = __DIR__ . '/' . $path;
    return h($path . (is_file($f) ? '?v=' . filemtime($f) : ''));
}
