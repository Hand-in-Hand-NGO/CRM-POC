<?php
// طباعة: سند تسليم/ارتجاع (?h=ID) أو بيان عهدة موظف / إخلاء طرف (?emp=ID)
require __DIR__ . '/lib.php';
if (!current_user()) {
    header('Location: index.php');
    exit;
}

$h = null;
$emp = null;
if (!empty($_GET['h'])) {
    $h = q_one('SELECT h.*, e.name AS employee_name, e.code AS employee_code, e.department, e.job_title, e.national_id, u.name AS created_by_name
        FROM handovers h JOIN employees e ON e.id = h.employee_id LEFT JOIN users u ON u.id = h.created_by WHERE h.id = ?', [(int)$_GET['h']]);
    if (!$h) {
        http_response_code(404);
        exit('السند غير موجود');
    }
    $items = handover_items($h['id'], $h['type']);
    $title = ($h['type'] === 'out' ? 'سند تسليم عهدة' : 'سند ارتجاع عهدة') . ' ' . $h['doc_no'];
} elseif (!empty($_GET['emp'])) {
    $emp = q_one('SELECT * FROM employees WHERE id = ?', [(int)$_GET['emp']]);
    if (!$emp) {
        http_response_code(404);
        exit('الموظف غير موجود');
    }
    $items = q_all('SELECT c.*, i.code, i.name, i.serial_no, i.value, cat.name AS category, ho.doc_no, ho.ack_at
        FROM custody c JOIN items i ON i.id = c.item_id LEFT JOIN categories cat ON cat.id = i.category_id
        JOIN handovers ho ON ho.id = c.out_handover_id
        WHERE c.employee_id = ? AND c.in_handover_id IS NULL ORDER BY c.assigned_at', [$emp['id']]);
    $title = $items ? 'بيان عهدة موظف' : 'شهادة إخلاء طرف من العهد';
} else {
    exit;
}

page_head($title);
?>
<body class="print-page">
<div class="print-actions no-print">
    <button class="btn btn-primary btn-action" onclick="window.print()"><i class="fa fa-print"></i> طباعة</button>
    <button class="btn btn-default btn-action" onclick="window.close()"><i class="fa fa-times"></i> إغلاق</button>
</div>
<div class="sheet">
    <div class="sheet-head">
        <div>
            <div class="sheet-org"><?= h(cfg('org_name')) ?></div>
            <div class="info-label"><?= h(cfg('app_name')) ?></div>
        </div>
        <h2><?= h($h ? ($h['type'] === 'out' ? 'سند تسليم عهدة' : 'سند ارتجاع عهدة') : $title) ?></h2>
        <div class="sheet-meta">
            <?php if ($h): ?>
                <div><span class="info-label">رقم السند:</span> <b><?= h($h['doc_no']) ?></b></div>
                <div><span class="info-label">التاريخ:</span> <span class="d"><?= h($h['doc_date']) ?></span></div>
            <?php else: ?>
                <div><span class="info-label">تاريخ الطباعة:</span> <span class="d"><?= h(today()) ?></span></div>
            <?php endif; ?>
        </div>
    </div>

    <?php $e = $h ?: $emp; ?>
    <table class="table table-bordered sheet-info">
        <tr>
            <td><span class="info-label">اسم الموظف:</span> <b><?= h($h ? $h['employee_name'] : $emp['name']) ?></b></td>
            <td><span class="info-label">الكود:</span> <?= h(($h ? $h['employee_code'] : $emp['code']) ?: '-') ?></td>
            <td><span class="info-label">الرقم القومي:</span> <?= h($e['national_id'] ?: '-') ?></td>
        </tr>
        <tr>
            <td><span class="info-label">القسم:</span> <?= h($e['department'] ?: '-') ?></td>
            <td colspan="2"><span class="info-label">الوظيفة:</span> <?= h($e['job_title'] ?: '-') ?></td>
        </tr>
    </table>

    <?php if ($items): ?>
    <table class="table table-bordered table-condensed sheet-items">
        <thead>
        <tr>
            <th>#</th><th>كود الأصل</th><th>التصنيف</th><th>الصنف</th><th>الرقم التسلسلي</th><th>القيمة</th>
            <?php if ($h): ?><th>الحالة</th><th>ملاحظات</th><?php else: ?><th>تاريخ التسليم</th><th>رقم السند</th><?php endif; ?>
        </tr>
        </thead>
        <tbody>
        <?php $total = 0; foreach ($items as $n => $it): $total += (float)$it['value']; ?>
            <tr>
                <td><?= $n + 1 ?></td>
                <td><?= h($it['code']) ?></td>
                <td><?= h($it['category'] ?: '-') ?></td>
                <td><?= h($it['name']) ?></td>
                <td><?= h($it['serial_no'] ?: '-') ?></td>
                <td><?= $it['value'] !== null ? number_format((float)$it['value'], 2) : '-' ?></td>
                <?php if ($h): ?>
                    <td><?= h($h['type'] === 'out' ? $it['condition_out'] : $it['condition_in']) ?></td>
                    <td><?= h(($h['type'] === 'out' ? $it['notes_out'] : $it['notes_in']) ?: '') ?></td>
                <?php else: ?>
                    <td><?= h($it['assigned_at']) ?></td>
                    <td><?= h($it['doc_no']) ?></td>
                <?php endif; ?>
            </tr>
        <?php endforeach; ?>
        </tbody>
        <tfoot><tr><th colspan="5">الإجمالي (<?= count($items) ?> صنف)</th><th><?= number_format($total, 2) ?></th><th colspan="2"></th></tr></tfoot>
    </table>
    <?php endif; ?>

    <?php if ($h): ?>
        <div class="sheet-terms"><?= nl2br(h($h['type'] === 'out' ? cfg('ack_terms') : cfg('return_terms'))) ?></div>
        <?php if ($h['notes']): ?><p><span class="info-label">ملاحظات:</span> <?= nl2br(h($h['notes'])) ?></p><?php endif; ?>
        <div class="sheet-signs">
            <div>
                <div class="info-label"><?= $h['type'] === 'out' ? 'المستلم (الموظف)' : 'المسلِّم (الموظف)' ?></div>
                <?php if ($h['ack_at']): ?>
                    <img class="sig-img" src="<?= h($h['ack_signature']) ?>" alt="">
                    <div><b><?= h($h['ack_name']) ?></b></div>
                    <small class="info-label">وُقّع إلكترونيًا <span class="d"><?= h($h['ack_at']) ?></span></small>
                <?php else: ?>
                    <div class="sig-line"></div><div>الاسم: <?= h($h['employee_name']) ?></div>
                <?php endif; ?>
            </div>
            <div>
                <div class="info-label">مسؤول العهد</div>
                <div class="sig-line"></div>
                <div><?= h($h['created_by_name']) ?></div>
            </div>
            <div>
                <div class="info-label">مدير الإدارة</div>
                <div class="sig-line"></div>
            </div>
        </div>
    <?php elseif (!$items): ?>
        <div class="sheet-terms">نشهد بأن الموظف المذكور أعلاه لا توجد في عهدته أي أصناف أو مهمات حتى تاريخه، وقد أُعطيت له هذه الشهادة بناءً على طلبه.</div>
        <div class="sheet-signs"><div><div class="info-label">مسؤول العهد</div><div class="sig-line"></div></div><div><div class="info-label">مدير الموارد البشرية</div><div class="sig-line"></div></div></div>
    <?php else: ?>
        <div class="sheet-signs"><div><div class="info-label">الموظف</div><div class="sig-line"></div></div><div><div class="info-label">مسؤول العهد</div><div class="sig-line"></div></div></div>
    <?php endif; ?>
</div>
</body>
</html>
