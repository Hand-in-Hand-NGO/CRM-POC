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

const SCHEMA_VERSION = 2;

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
    if ($v === 1) {
        // الإصدار 2: نوع الصنف (لاب توب / موبايل / شريحة) ومواصفاته
        $pdo->exec("ALTER TABLE items ADD COLUMN type VARCHAR(16) NOT NULL DEFAULT 'laptop'");
        $pdo->exec('ALTER TABLE items ADD COLUMN specs TEXT');
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
            if (stripos($sql, 'CREATE INDEX') !== 0) {
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

function start_session()
{
    if (session_status() === PHP_SESSION_ACTIVE) {
        return;
    }
    session_name('custody_sid');
    session_set_cookie_params([
        'lifetime' => 0,
        'path' => '/',
        'httponly' => true,
        'samesite' => 'Lax',
        'secure' => !empty($_SERVER['HTTPS']) && $_SERVER['HTTPS'] !== 'off',
    ]);
    session_start();
    if (!empty($_SESSION['uid']) && (time() - ($_SESSION['seen'] ?? 0)) > cfg('session_minutes') * 60) {
        $_SESSION = [];
        session_regenerate_id(true);
    }
    $_SESSION['seen'] = time();
    if (empty($_SESSION['csrf'])) {
        $_SESSION['csrf'] = bin2hex(random_bytes(16));
    }
}

function current_user()
{
    static $user = false;
    if ($user !== false) {
        return $user;
    }
    start_session();
    $user = null;
    if (!empty($_SESSION['uid'])) {
        $user = q_one('SELECT id, username, name, role, must_change FROM users WHERE id = ? AND active = 1', [$_SESSION['uid']]);
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

// نسخة احتياطية متسقة من قاعدة SQLite وهي شغالة (تشمل كل البيانات وصور التوقيعات)
function backup_sqlite($dest)
{
    if (cfg('db')['driver'] !== 'sqlite') {
        throw new RuntimeException('النسخ الاحتياطي من هنا لقاعدة SQLite فقط، ولقاعدة MySQL استخدم mysqldump');
    }
    if (!is_dir(dirname($dest))) {
        mkdir(dirname($dest), 0775, true);
    }
    if (is_file($dest)) {
        unlink($dest);
    }
    db()->exec('VACUUM INTO ' . db()->quote($dest));
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

function type_label($type)
{
    return asset_types()[$type]['label'] ?? $type;
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
    $row['type_label'] = $t ? $t['label'] : '';
    $row['specs'] = $specs;
    $parts = [];
    foreach ($t ? $t['summary'] : [] as $k) {
        if (($specs[$k] ?? '') !== '') {
            $parts[] = $specs[$k];
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
    return decorate_items(q_all("SELECT c.*, i.code, i.type, i.name, i.brand, i.model, i.serial_no, i.value, i.specs
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
<link rel="stylesheet" href="assets/theme.css">
<link rel="stylesheet" href="assets/app.css">
</head>
<?php
}
