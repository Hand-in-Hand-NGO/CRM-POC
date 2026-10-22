<?php
// صفحة عامة يفتحها الموظف من الرابط المرسل له (أو على تابلت في المكتب) ليوقّع على سند التسليم/الارتجاع.
require __DIR__ . '/lib.php';
start_session();
header('X-Frame-Options: DENY');
header('Referrer-Policy: no-referrer');

$token = (string)($_GET['t'] ?? '');
$h = preg_match('/^[a-f0-9]{40}$/', $token)
    ? q_one('SELECT h.*, e.name AS employee_name, e.code AS employee_code, e.department, e.job_title
        FROM handovers h JOIN employees e ON e.id = h.employee_id WHERE h.token = ?', [$token])
    : null;

$error = '';
if ($h && !$h['ack_at'] && ($_SERVER['REQUEST_METHOD'] ?? '') === 'POST') {
    $name = trim(mb_substr((string)($_POST['ack_name'] ?? ''), 0, 190));
    $sig = (string)($_POST['signature'] ?? '');
    if (!hash_equals($_SESSION['csrf'], (string)($_POST['csrf'] ?? ''))) {
        $error = 'انتهت صلاحية الصفحة، أعد تحميلها وحاول مرة أخرى.';
    } elseif (empty($_POST['agree'])) {
        $error = 'يجب الموافقة على الإقرار.';
    } elseif ($name === '') {
        $error = 'اكتب اسمك بالكامل.';
    } elseif (strpos($sig, 'data:image/png;base64,') !== 0 || strlen($sig) > 700000
        || !($bin = base64_decode(substr($sig, 22), true)) || strncmp($bin, "\x89PNG", 4) !== 0) {
        $error = 'من فضلك ارسم توقيعك في المربع.';
    } else {
        $st = q('UPDATE handovers SET ack_at = ?, ack_name = ?, ack_ip = ?, ack_agent = ?, ack_signature = ? WHERE id = ? AND ack_at IS NULL', [
            now(), $name, $_SERVER['REMOTE_ADDR'] ?? '', mb_substr((string)($_SERVER['HTTP_USER_AGENT'] ?? ''), 0, 255), $sig, $h['id'],
        ]);
        if ($st->rowCount()) {
            log_activity('توقيع الموظف', 'handover', $h['id'], $h['doc_no'] . ' - ' . $name);
        }
        header('Location: sign.php?t=' . urlencode($token));
        exit;
    }
}

page_head('توقيع سند العهدة');
?>
<body class="sign-page">
<div class="sign-wrap">
    <div class="sign-head">
        <i class="fa fa-briefcase"></i>
        <div>
            <div class="sign-org"><?= h(cfg('org_name')) ?></div>
            <div class="sign-title"><?= h(cfg('app_name')) ?></div>
        </div>
    </div>

<?php if (!$h): ?>
    <div class="alert alert-danger"><i class="fa fa-exclamation-triangle"></i> الرابط غير صحيح أو تم تجديده. تواصل مع مسؤول العهد.</div>
<?php else: $items = handover_items($h['id'], $h['type']); ?>
    <div class="panel panel-primary">
        <div class="panel-heading">
            <b><?= $h['type'] === 'out' ? 'سند تسليم عهدة' : 'سند ارتجاع عهدة' ?></b>
            <span class="pull-left"><?= h($h['doc_no']) ?></span>
        </div>
        <div class="panel-body">
            <div class="sign-info">
                <div><span class="info-label">الموظف:</span> <b><?= h($h['employee_name']) ?></b></div>
                <?php if ($h['employee_code']): ?><div><span class="info-label">الكود:</span> <?= h($h['employee_code']) ?></div><?php endif; ?>
                <?php if ($h['department']): ?><div><span class="info-label">القسم:</span> <?= h($h['department']) ?></div><?php endif; ?>
                <div><span class="info-label">التاريخ:</span> <span class="d"><?= h($h['doc_date']) ?></span></div>
            </div>

            <div class="table-scroll">
            <table class="table table-bordered table-condensed">
                <thead><tr><th>#</th><th>الصنف</th><th>S/N / IMEI / رقم الخط</th><th>المواصفات والملحقات</th><th>الحالة</th></tr></thead>
                <tbody>
                <?php foreach ($items as $n => $it): ?>
                    <tr>
                        <td><?= $n + 1 ?></td>
                        <td><?= h($it['name']) ?><br><small class="info-label"><?= h($it['type_label'] . ' — ' . $it['code']) ?></small></td>
                        <td><?= h($it['serial_no'] ?: '-') ?></td>
                        <td class="details-cell"><?= item_details_html($it) ?></td>
                        <td><?= h($h['type'] === 'out' ? $it['condition_out'] : $it['condition_in']) ?></td>
                    </tr>
                <?php endforeach; ?>
                </tbody>
            </table>
            </div>

            <div class="sign-terms"><?= nl2br(h($h['type'] === 'out' ? cfg('ack_terms') : cfg('return_terms'))) ?></div>
            <?php if ($h['notes']): ?><p><span class="info-label">ملاحظات:</span> <?= nl2br(h($h['notes'])) ?></p><?php endif; ?>

        <?php if ($h['ack_at']): ?>
            <div class="alert alert-success text-center">
                <i class="fa fa-check-circle fa-2x"></i><br>
                تم التوقيع بواسطة <b><?= h($h['ack_name']) ?></b> بتاريخ <span class="d"><?= h($h['ack_at']) ?></span>
            </div>
            <div class="text-center"><img class="sig-img" src="<?= h($h['ack_signature']) ?>" alt="التوقيع"></div>
        <?php else: ?>
            <?php if ($error): ?><div class="alert alert-danger"><?= h($error) ?></div><?php endif; ?>
            <form method="post" id="signForm">
                <input type="hidden" name="csrf" value="<?= h($_SESSION['csrf']) ?>">
                <input type="hidden" name="signature" id="signature">
                <div class="form-group">
                    <label>الاسم بالكامل</label>
                    <input class="form-control" name="ack_name" required value="<?= h($_POST['ack_name'] ?? $h['employee_name']) ?>">
                </div>
                <div class="form-group">
                    <label>التوقيع <small class="info-label">(ارسم بإصبعك أو الماوس)</small></label>
                    <div class="sig-box"><canvas id="sigCanvas"></canvas></div>
                    <button type="button" class="btn btn-default btn-sm btn-action" id="sigClear"><i class="fa fa-eraser"></i> مسح التوقيع</button>
                </div>
                <div class="checkbox">
                    <label><input type="checkbox" name="agree" value="1" required> أوافق على ما جاء بالإقرار أعلاه</label>
                </div>
                <button type="submit" class="btn btn-success btn-lg btn-block btn-action"><i class="fa fa-pencil"></i> توقيع واعتماد</button>
            </form>
        <?php endif; ?>
        </div>
    </div>
<?php endif; ?>
</div>

<?php if ($h && !$h['ack_at']): ?>
<script>
(function () {
    var canvas = document.getElementById('sigCanvas');
    var ctx = canvas.getContext('2d');
    var drawing = false, drawn = false, last = null;

    function resize() {
        var data = drawn ? canvas.toDataURL() : null;
        var ratio = window.devicePixelRatio || 1;
        canvas.width = canvas.offsetWidth * ratio;
        canvas.height = canvas.offsetHeight * ratio;
        ctx.setTransform(ratio, 0, 0, ratio, 0, 0);
        ctx.lineWidth = 2.2;
        ctx.lineCap = 'round';
        ctx.lineJoin = 'round';
        ctx.strokeStyle = '#1a3d8f';
        ctx.fillStyle = '#1a3d8f';
        if (data) {
            var img = new Image();
            img.onload = function () { ctx.drawImage(img, 0, 0, canvas.offsetWidth, canvas.offsetHeight); };
            img.src = data;
        }
    }
    function pos(e) {
        var r = canvas.getBoundingClientRect();
        return { x: e.clientX - r.left, y: e.clientY - r.top };
    }
    canvas.addEventListener('pointerdown', function (e) {
        drawing = true; last = pos(e);
        canvas.setPointerCapture(e.pointerId);
        ctx.beginPath(); ctx.arc(last.x, last.y, 1, 0, Math.PI * 2); ctx.fill();
        drawn = true;
    });
    canvas.addEventListener('pointermove', function (e) {
        if (!drawing) return;
        var p = pos(e);
        ctx.beginPath(); ctx.moveTo(last.x, last.y); ctx.lineTo(p.x, p.y); ctx.stroke();
        last = p;
    });
    ['pointerup', 'pointercancel', 'pointerleave'].forEach(function (ev) {
        canvas.addEventListener(ev, function () { drawing = false; });
    });
    document.getElementById('sigClear').onclick = function () {
        ctx.clearRect(0, 0, canvas.width, canvas.height); drawn = false;
    };
    document.getElementById('signForm').onsubmit = function (e) {
        if (!drawn) { e.preventDefault(); alert('من فضلك ارسم توقيعك في المربع'); return; }
        document.getElementById('signature').value = canvas.toDataURL('image/png');
    };
    window.addEventListener('resize', resize);
    resize();
})();
</script>
<?php endif; ?>
</body>
</html>
