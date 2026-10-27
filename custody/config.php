<?php
/*
 * الإعدادات الافتراضية. لا تعدّل هذا الملف على السيرفر:
 * انسخ config.local.example.php إلى config.local.php وضع فيه ما تريد تغييره فقط.
 */
$config = [
    'app_name' => 'العهد الإلكترونية',
    'org_name' => 'Hand in Hand',
    'timezone' => 'Africa/Cairo',

    // sqlite (لا يحتاج أي إعداد) أو mysql
    'db' => [
        'driver' => 'sqlite',
        'sqlite_path' => __DIR__ . '/data/custody.sqlite',
        'mysql' => [
            'host' => 'localhost',
            'port' => 3306,
            'name' => 'custody',
            'user' => 'root',
            'pass' => '',
        ],
    ],

    // الرابط العام للنظام لاستخدامه في روابط توقيع الموظفين، مثال: https://custody.handinhand-eg.com
    // اتركه فارغًا ليُستنتج تلقائيًا من الطلب الحالي.
    'base_url' => '',

    // نص الإقرار الذي يظهر للموظف عند التوقيع وفي سند التسليم المطبوع
    'ack_terms' => "أقر أنا الموقع أدناه بأنني استلمت العهدة الموضحة بهذا السند بحالة جيدة وصالحة للاستخدام، "
        . "وأتعهد بالمحافظة عليها واستخدامها في أغراض العمل فقط، وعدم التصرف فيها بالبيع أو الإعارة، "
        . "وردها عند طلبها أو عند انتهاء علاقتي بالعمل، وأتحمل قيمتها في حالة فقدها أو تلفها نتيجة الإهمال.",
    'return_terms' => "تم استلام العهدة الموضحة بهذا السند من الموظف بالحالة المذكورة قرين كل صنف.",

    // النسخ الاحتياطي (backup.php وزر "تحميل نسخة احتياطية"): مكان الحفظ وعدد النسخ المحفوظة
    'backup_dir' => __DIR__ . '/data/backups',
    'backup_keep' => 30,

    // مدة صلاحية جلسة الدخول بالدقائق
    'session_minutes' => 480,
];

if (is_file(__DIR__ . '/config.local.php')) {
    $local = require __DIR__ . '/config.local.php';
    if (is_array($local)) {
        $config = array_replace_recursive($config, $local);
    }
}

return $config;
