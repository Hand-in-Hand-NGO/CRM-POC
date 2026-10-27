<?php
/*
 * نسخة احتياطية تلقائية لقاعدة البيانات (كل البيانات وصور التوقيعات).
 * التشغيل من سطر الأوامر أو Task Scheduler / cron:  php backup.php
 * يحفظ في backup_dir (افتراضيًا data/backups) ويحتفظ بآخر backup_keep نسخة.
 */
if (PHP_SAPI !== 'cli') {
    http_response_code(403);
    exit;
}
require __DIR__ . '/lib.php';

$dir = rtrim(cfg('backup_dir'), '/\\');
$file = $dir . '/custody-' . date('Y-m-d_His') . '.sqlite';
try {
    backup_sqlite($file);
} catch (Throwable $e) {
    fwrite(STDERR, 'فشل النسخ الاحتياطي: ' . $e->getMessage() . PHP_EOL);
    exit(1);
}

$files = glob($dir . '/custody-*.sqlite');
sort($files);
while (count($files) > (int)cfg('backup_keep')) {
    unlink(array_shift($files));
}
echo 'تم: ' . $file . ' (' . round(filesize($file) / 1024) . ' KB)' . PHP_EOL;
