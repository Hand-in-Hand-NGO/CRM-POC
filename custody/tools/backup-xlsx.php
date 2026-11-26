<?php
// يكتب ملف Excel بكل بيانات النظام من نسخة قاعدة البيانات، بنفس شكل «تصدير البيانات Excel» وقالب الاستيراد.
// بيشغّله سكربت النسخ الاحتياطي اليومي على السيرفر:
//   php tools/backup-xlsx.php /path/snapshot.sqlite /path/out.xlsx
if (PHP_SAPI !== 'cli') {
    http_response_code(404);
    exit;
}
if ($argc < 3 || !is_file($argv[1])) {
    fwrite(STDERR, "usage: php tools/backup-xlsx.php <snapshot.sqlite> <out.xlsx>\n");
    exit(2);
}
require dirname(__DIR__) . '/lib.php';
// القراءة من النسخة، مش من قاعدة الإنتاج
$CONFIG['db'] = ['driver' => 'sqlite', 'sqlite_path' => $argv[1]];
require dirname(__DIR__) . '/dataio.php';
if (!xlsx_available()) {
    fwrite(STDERR, "PHP extensions zip and xml are required\n");
    exit(1);
}
$counts = dx_write_workbook($argv[2], 'backup');
echo 'xlsx ok: ' . implode(', ', array_map(function ($k, $n) {
    return $k . '=' . $n;
}, array_keys($counts), $counts)) . "\n";
