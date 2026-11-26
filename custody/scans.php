<?php
// الإقرار الورقي الموقّع: التحقق من الملفات المرفوعة (PDF أو صور JPG/PNG) وتحويل الصور بالترتيب إلى PDF
// متعدد الصفحات وحفظه مع الأصول خارج مسار الموقع. الصور بتتحط في الـ PDF بنفس بياناتها الأصلية
// من غير إعادة ضغط، فوضوح النص والتوقيع بيفضل زي الأصل.

const SCAN_MIMES = ['application/pdf' => 'pdf', 'image/jpeg' => 'jpg', 'image/png' => 'png'];
const SCAN_FILE_NAME = 'signed.pdf';

function scan_limits()
{
    return [
        'file' => (int)(cfg('scan_max_file_mb') * 1048576),
        'total' => (int)(cfg('scan_max_total_mb') * 1048576),
        'count' => (int)cfg('scan_max_files'),
    ];
}

// فولدر المرفقات (خارج مسار الموقع)، ويتعمل لو مش موجود
function attachments_dir()
{
    $dir = (string)cfg('attachments_path');
    if ($dir === '') {
        $dir = dirname(cfg('db')['sqlite_path'] ?? (__DIR__ . '/data/custody.sqlite')) . '/attachments';
    }
    $dir = rtrim($dir, '/\\');
    if (!is_dir($dir) && !@mkdir($dir, 0750, true)) {
        fail('تعذر إنشاء فولدر حفظ الإقرارات على السيرفر', 500);
    }
    return $dir;
}

function scan_path(array $scan, $file = SCAN_FILE_NAME)
{
    // المسار جاي من قاعدة البيانات ومكوّن من أرقام وحروف بس، ومع ذلك بنتأكد منه
    if (!preg_match('~^handovers/\d+/v\d+-[a-f0-9]{8}$~', $scan['dir']) || !preg_match('~^[a-z0-9.-]+$~', $file)) {
        fail('مسار الملف غير صالح', 500);
    }
    return attachments_dir() . '/' . $scan['dir'] . '/' . $file;
}

// الملفات المرفوعة بنفس ترتيب اختيارها، مع التحقق من الحجم والعدد والنوع الفعلي للمحتوى
function scan_uploaded_files()
{
    $lim = scan_limits();
    $f = $_FILES['files'] ?? null;
    if (!$f || !is_array($f['name'])) {
        fail('اختر ملف الإقرار الموقّع (PDF أو صور)');
    }
    $files = [];
    $total = 0;
    $finfo = new finfo(FILEINFO_MIME_TYPE);
    foreach ($f['name'] as $i => $name) {
        $name = mb_substr(basename((string)$name), 0, 120);
        $err = (int)$f['error'][$i];
        if ($err === UPLOAD_ERR_INI_SIZE || $err === UPLOAD_ERR_FORM_SIZE) {
            fail("الملف \"$name\" أكبر من الحد المسموح (" . cfg('scan_max_file_mb') . ' م.ب)');
        }
        if ($err !== UPLOAD_ERR_OK || !is_uploaded_file($f['tmp_name'][$i])) {
            fail("تعذر استلام الملف \"$name\"، حاول مرة أخرى");
        }
        $size = (int)filesize($f['tmp_name'][$i]);
        if ($size <= 0) {
            fail("الملف \"$name\" فارغ");
        }
        if ($size > $lim['file']) {
            fail("الملف \"$name\" أكبر من الحد المسموح (" . cfg('scan_max_file_mb') . ' م.ب)');
        }
        $total += $size;
        $mime = $finfo->file($f['tmp_name'][$i]);
        if (!isset(SCAN_MIMES[$mime])) {
            fail("الملف \"$name\" ليس PDF أو صورة JPG/PNG");
        }
        $files[] = ['name' => $name, 'tmp' => $f['tmp_name'][$i], 'size' => $size, 'mime' => $mime, 'ext' => SCAN_MIMES[$mime]];
    }
    if (!$files) {
        fail('اختر ملف الإقرار الموقّع (PDF أو صور)');
    }
    if (count($files) > $lim['count']) {
        fail('أقصى عدد للصور ' . $lim['count'] . ' صورة');
    }
    if ($total > $lim['total']) {
        fail('إجمالي حجم الملفات أكبر من ' . cfg('scan_max_total_mb') . ' م.ب');
    }
    $pdfs = array_filter($files, function ($x) {
        return $x['ext'] === 'pdf';
    });
    if ($pdfs && count($files) > 1) {
        fail('ارفع ملف PDF واحد فيه كل الصفحات، أو صور فقط. مينفعش الجمع بين PDF وصور');
    }
    return $files;
}

// ---------------------------------------------------------------- التحقق من محتوى الملفات

function scan_check_pdf(array $f)
{
    $data = file_get_contents($f['tmp']);
    $head = strpos(substr($data, 0, 1024), '%PDF-');
    if ($head === false || strpos(substr($data, -2048), '%%EOF') === false) {
        fail("الملف \"{$f['name']}\" ليس PDF سليمًا أو غير مكتمل");
    }
    $pages = preg_match_all('~/Type\s*/Page(?![a-zA-Z])~', $data);
    return ['pages' => $pages ?: null];
}

// قراءة بيانات JPEG من الـ markers: الأبعاد وعدد الألوان، ورفض الصيغ اللي مينفعش تتحط في PDF كما هي
function scan_jpeg_info(array $f)
{
    $data = file_get_contents($f['tmp']);
    $len = strlen($data);
    if (substr($data, 0, 2) !== "\xFF\xD8" || strrpos($data, "\xFF\xD9") === false) {
        fail("الصورة \"{$f['name']}\" تالفة أو غير مكتملة");
    }
    $p = 2;
    while ($p + 4 <= $len) {
        if ($data[$p] !== "\xFF") {
            break;
        }
        $m = ord($data[$p + 1]);
        if ($m === 0xFF) {
            $p++;
            continue;
        }
        if ($m === 0xD8 || ($m >= 0xD0 && $m <= 0xD7) || $m === 0x01) {
            $p += 2;
            continue;
        }
        $seg = unpack('n', substr($data, $p + 2, 2))[1];
        if (in_array($m, [0xC0, 0xC1, 0xC2], true)) {
            $s = unpack('Cbits/nh/nw/Cc', substr($data, $p + 4, 6));
            if ($s['bits'] !== 8 || !in_array($s['c'], [1, 3], true)) {
                fail("الصورة \"{$f['name']}\" بصيغة ألوان غير مدعومة (مثل CMYK). احفظها JPG عادي وارفعها تاني");
            }
            return ['w' => $s['w'], 'h' => $s['h'], 'colors' => $s['c'], 'data' => $data];
        }
        if (($m >= 0xC3 && $m <= 0xCF && $m !== 0xC4 && $m !== 0xC8 && $m !== 0xCC) || $m === 0xDA) {
            break;
        }
        $p += 2 + $seg;
    }
    fail("الصورة \"{$f['name']}\" بصيغة JPEG غير مدعومة");
}

// PNG: التحقق من كل الـ chunks (CRC) وفك الضغط بالكامل للتأكد إن الصورة سليمة، من غير تحميلها في الذاكرة
function scan_png_info(array $f)
{
    $data = file_get_contents($f['tmp']);
    if (substr($data, 0, 8) !== "\x89PNG\r\n\x1a\n") {
        fail("الصورة \"{$f['name']}\" تالفة");
    }
    $p = 8;
    $len = strlen($data);
    $ihdr = null;
    $plte = '';
    $idat = '';
    $end = false;
    while ($p + 12 <= $len) {
        $n = unpack('N', substr($data, $p, 4))[1];
        $type = substr($data, $p + 4, 4);
        if ($p + 12 + $n > $len) {
            break;
        }
        $body = substr($data, $p + 8, $n);
        if ((crc32($type . $body) & 0xFFFFFFFF) !== unpack('N', substr($data, $p + 8 + $n, 4))[1]) {
            fail("الصورة \"{$f['name']}\" تالفة");
        }
        if ($type === 'IHDR') {
            $ihdr = unpack('Nw/Nh/Cbits/Ctype/Ccomp/Cfilter/Cinterlace', $body);
        } elseif ($type === 'PLTE') {
            $plte = $body;
        } elseif ($type === 'IDAT') {
            $idat .= $body;
        } elseif ($type === 'IEND') {
            $end = true;
            break;
        }
        $p += 12 + $n;
    }
    if (!$ihdr || !$end || $idat === '') {
        fail("الصورة \"{$f['name']}\" تالفة أو غير مكتملة");
    }
    $channels = [0 => 1, 2 => 3, 3 => 1, 4 => 2, 6 => 4][$ihdr['type']] ?? 0;
    $rowBytes = (int)ceil($ihdr['w'] * $channels * $ihdr['bits'] / 8);
    $expected = $ihdr['h'] * (1 + $rowBytes);
    $direct = $ihdr['interlace'] === 0 && in_array($ihdr['type'], [0, 2, 3], true) && $ihdr['bits'] <= 8
        && ($ihdr['type'] !== 3 || $plte !== '');
    if ($direct) {
        // فك الضغط على أجزاء وعدّ الناتج فقط: لازم يطابق حجم الصورة بالظبط
        $z = inflate_init(ZLIB_ENCODING_DEFLATE);
        $out = 0;
        foreach (str_split($idat, 262144) as $chunk) {
            $part = @inflate_add($z, $chunk, ZLIB_SYNC_FLUSH);
            if ($part === false) {
                fail("الصورة \"{$f['name']}\" تالفة");
            }
            $out += strlen($part);
        }
        if ($out !== $expected) {
            fail("الصورة \"{$f['name']}\" تالفة أو غير مكتملة");
        }
    }
    return ['w' => $ihdr['w'], 'h' => $ihdr['h'], 'type' => $ihdr['type'], 'bits' => $ihdr['bits'], 'plte' => $plte, 'idat' => $idat, 'direct' => $direct];
}

// PNG بشفافية أو 16 بت أو interlaced: نفكها بـ GD ونحطها على خلفية بيضاء ونحفظها PNG عادي (بدون فقد في الجودة)
function scan_png_flatten(array $f)
{
    if (!function_exists('imagecreatefrompng')) {
        fail("الصورة \"{$f['name']}\" بصيغة PNG غير مدعومة على السيرفر. احفظها JPG وارفعها تاني");
    }
    $src = @imagecreatefrompng($f['tmp']);
    if (!$src) {
        fail("الصورة \"{$f['name']}\" تالفة");
    }
    $w = imagesx($src);
    $h = imagesy($src);
    $dst = imagecreatetruecolor($w, $h);
    imagefill($dst, 0, 0, imagecolorallocate($dst, 255, 255, 255));
    imagecopy($dst, $src, 0, 0, 0, 0, $w, $h);
    imagedestroy($src);
    imagesavealpha($dst, false);
    $tmp = tempnam(sys_get_temp_dir(), 'scan');
    imagepng($dst, $tmp, 6);
    imagedestroy($dst);
    $info = scan_png_info(['name' => $f['name'], 'tmp' => $tmp]);
    @unlink($tmp);
    if (!$info['direct']) {
        fail("الصورة \"{$f['name']}\" بصيغة PNG غير مدعومة. احفظها JPG وارفعها تاني");
    }
    return $info;
}

// اتجاه الصورة من بيانات EXIF (صور الموبايل): 1 عادي، 3 مقلوبة، 6 و 8 مدورة 90 درجة
function scan_jpeg_orientation($path)
{
    if (!function_exists('exif_read_data')) {
        return 1;
    }
    $exif = @exif_read_data($path);
    $o = (int)($exif['Orientation'] ?? 1);
    return in_array($o, [3, 6, 8], true) ? $o : 1;
}

// تحويل كل صورة لكائن صورة في الـ PDF، مع التحقق من الأبعاد ومن إن الصورة بتتفك فعلًا
function scan_image_object(array $f)
{
    $size = @getimagesize($f['tmp']);
    $want = $f['ext'] === 'jpg' ? IMAGETYPE_JPEG : IMAGETYPE_PNG;
    if (!$size || $size[2] !== $want) {
        fail("الصورة \"{$f['name']}\" تالفة أو امتدادها لا يطابق محتواها");
    }
    if ($size[0] < 200 || $size[1] < 200) {
        fail("الصورة \"{$f['name']}\" صغيرة جدًا ومش هتكون واضحة. صوّر الإقرار بدقة أعلى");
    }
    if ($size[0] > 12000 || $size[1] > 12000 || $size[0] * $size[1] > 60000000) {
        fail("أبعاد الصورة \"{$f['name']}\" كبيرة جدًا");
    }
    if ($f['ext'] === 'jpg') {
        $j = scan_jpeg_info($f);
        if (function_exists('imagecreatefromjpeg')) {
            $im = @imagecreatefromjpeg($f['tmp']);
            if (!$im) {
                fail("الصورة \"{$f['name']}\" تالفة");
            }
            imagedestroy($im);
        }
        return [
            'w' => $j['w'], 'h' => $j['h'], 'rotate' => scan_jpeg_orientation($f['tmp']),
            'dict' => '/ColorSpace /' . ($j['colors'] === 1 ? 'DeviceGray' : 'DeviceRGB') . ' /BitsPerComponent 8 /Filter /DCTDecode',
            'data' => $j['data'],
        ];
    }
    $p = scan_png_info($f);
    if (!$p['direct']) {
        $p = scan_png_flatten($f);
    }
    $colors = $p['type'] === 2 ? 3 : 1;
    $cs = $p['type'] === 3 ? '[/Indexed /DeviceRGB ' . (intdiv(strlen($p['plte']), 3) - 1) . ' <' . bin2hex($p['plte']) . '>]'
        : '/' . ($p['type'] === 2 ? 'DeviceRGB' : 'DeviceGray');
    return [
        'w' => $p['w'], 'h' => $p['h'], 'rotate' => 1,
        'dict' => "/ColorSpace $cs /BitsPerComponent {$p['bits']} /Filter /FlateDecode"
            . " /DecodeParms << /Predictor 15 /Colors $colors /BitsPerComponent {$p['bits']} /Columns {$p['w']} >>",
        'data' => $p['idat'],
    ];
}

function pdf_text($s)
{
    return '<FEFF' . strtoupper(bin2hex(mb_convert_encoding($s, 'UTF-16BE', 'UTF-8'))) . '>';
}

// PDF متعدد الصفحات: صفحة A4 لكل صورة (بالطول أو العرض حسب الصورة)، والصورة في المنتصف بأكبر حجم ممكن
function scan_build_pdf(array $files, $out, $title)
{
    $fh = fopen($out, 'wb');
    $offsets = [];
    $pos = 0;
    $write = function ($s) use ($fh, &$pos) {
        fwrite($fh, $s);
        $pos += strlen($s);
    };
    $obj = function ($n, $body) use ($write, &$offsets, &$pos) {
        $offsets[$n] = $pos;
        $write("$n 0 obj\n$body\nendobj\n");
    };
    $write("%PDF-1.4\n%\xE2\xE3\xCF\xD3\n");
    $count = count($files);
    $kids = [];
    for ($i = 0; $i < $count; $i++) {
        $kids[] = (4 + $i * 3) . ' 0 R';
    }
    $obj(1, '<< /Type /Catalog /Pages 2 0 R >>');
    $obj(2, '<< /Type /Pages /Kids [' . implode(' ', $kids) . "] /Count $count >>");
    $obj(3, '<< /Title ' . pdf_text($title) . ' /Producer ' . pdf_text(cfg('app_name')) . ' /CreationDate (D:' . date('YmdHis') . ') >>');
    foreach ($files as $i => $f) {
        $img = scan_image_object($f);
        $n = 4 + $i * 3;
        $turned = in_array($img['rotate'], [6, 8], true);
        $iw = $turned ? $img['h'] : $img['w'];
        $ih = $turned ? $img['w'] : $img['h'];
        $pw = $iw > $ih ? 841.89 : 595.28;
        $ph = $iw > $ih ? 595.28 : 841.89;
        $k = min($pw / $iw, $ph / $ih);
        $dw = $iw * $k;
        $dh = $ih * $k;
        $x = ($pw - $dw) / 2;
        $y = ($ph - $dh) / 2;
        $m = [
            1 => [$dw, 0, 0, $dh, $x, $y],
            3 => [-$dw, 0, 0, -$dh, $x + $dw, $y + $dh],
            6 => [0, -$dh, $dw, 0, $x, $y + $dh],
            8 => [0, $dh, -$dw, 0, $x + $dw, $y],
        ][$img['rotate']];
        $content = 'q ' . implode(' ', array_map(function ($v) {
            return rtrim(rtrim(sprintf('%.4F', $v), '0'), '.') ?: '0';
        }, $m)) . " cm /Im0 Do Q\n";
        $obj($n, sprintf('<< /Type /Page /Parent 2 0 R /MediaBox [0 0 %.2F %.2F] /Resources << /XObject << /Im0 %d 0 R >> >> /Contents %d 0 R >>', $pw, $ph, $n + 2, $n + 1));
        $obj($n + 1, '<< /Length ' . strlen($content) . " >>\nstream\n$content\nendstream");
        $offsets[$n + 2] = $pos;
        $write(($n + 2) . " 0 obj\n<< /Type /XObject /Subtype /Image /Width {$img['w']} /Height {$img['h']} {$img['dict']} /Length " . strlen($img['data']) . " >>\nstream\n");
        $write($img['data']);
        $write("\nendstream\nendobj\n");
        unset($img);
    }
    $size = 4 + $count * 3;
    $xref = $pos;
    $write("xref\n0 $size\n0000000000 65535 f \n");
    for ($i = 1; $i < $size; $i++) {
        $write(sprintf("%010d 00000 n \n", $offsets[$i]));
    }
    $write("trailer\n<< /Size $size /Root 1 0 R /Info 3 0 R >>\nstartxref\n$xref\n%%EOF\n");
    fclose($fh);
    return $count;
}

function rrmdir($dir)
{
    if (!is_dir($dir)) {
        return;
    }
    foreach (scandir($dir) as $f) {
        if ($f !== '.' && $f !== '..') {
            is_dir("$dir/$f") ? rrmdir("$dir/$f") : @unlink("$dir/$f");
        }
    }
    @rmdir($dir);
}

// نسخة بيانات السند وقت التوثيق: لو بيانات الأصناف اتعدلت بعد كده، يفضل واضح إيه اللي اتوقع عليه
function handover_snapshot(array $h)
{
    return [
        'doc_no' => $h['doc_no'],
        'type' => $h['type'],
        'doc_date' => $h['doc_date'],
        'employee' => ['id' => (int)$h['employee_id'], 'name' => $h['employee_name'], 'code' => $h['employee_code'], 'department' => $h['department'], 'job_title' => $h['job_title']],
        'created_by' => $h['created_by_name'],
        'notes' => $h['notes'],
        'terms' => $h['type'] === 'out' ? cfg('ack_terms') : cfg('return_terms'),
        'electronic_ack' => $h['ack_at'] ? ['at' => $h['ack_at'], 'name' => $h['ack_name']] : null,
        'items' => array_map(function ($it) use ($h) {
            return [
                'code' => $it['code'], 'type' => $it['type_label'], 'name' => $it['name'], 'serial_no' => $it['serial_no'],
                'specs' => $it['specs_text'], 'accessories' => $it['accessories_text'], 'value' => $it['value'],
                'condition' => $h['type'] === 'out' ? $it['condition_out'] : $it['condition_in'],
            ];
        }, $h['items']),
    ];
}

// رفع الإقرار الموقّع أو استبداله. الحالة مابتتغيرش غير بعد ما الملفات تتحفظ وتتجهز بنجاح.
function save_paper_scan()
{
    @ini_set('memory_limit', '512M');
    @set_time_limit(180);
    $id = in_int('handover_id');
    $h = handover_view($id);
    $current = $h['paper_scan_id'] ? q_one('SELECT * FROM handover_scans WHERE id = ?', [$h['paper_scan_id']]) : null;
    $replace = (int)in('replace', 0) === 1;
    if ($current && !$replace) {
        fail('السند عليه إقرار موقّع بالفعل. استخدم "تصحيح / استبدال المرفق"', 409);
    }
    $reason = in_str('reason', 500);
    if ($current && $reason === '') {
        fail('اكتب سبب تصحيح أو استبدال الإقرار');
    }
    if ($current && (int)$current['id'] !== (int)in_int('current_scan_id')) {
        fail('الإقرار اتغير من مستخدم تاني. افتح السند من جديد', 409);
    }
    $signedOn = in_date('signed_on');
    if (!$signedOn) {
        fail('حدد تاريخ التوقيع الورقي');
    }
    if ($signedOn < $h['doc_date'] || $signedOn > today()) {
        fail('تاريخ التوقيع لازم يكون من تاريخ السند (' . $h['doc_date'] . ') لحد النهارده');
    }
    if (!in('confirm')) {
        fail('أكّد إن الملف يخص هذا السند ويحتوي على توقيع الموظف');
    }
    $notes = in_str('notes', 1000);
    $files = scan_uploaded_files();

    // التجهيز في فولدر مؤقت، وبعدين نقله لمكانه النهائي مرة واحدة
    $root = attachments_dir();
    $version = (int)q_val('SELECT COALESCE(MAX(version), 0) FROM handover_scans WHERE handover_id = ?', [$id]) + 1;
    $rel = 'handovers/' . $id . '/v' . $version . '-' . bin2hex(random_bytes(4));
    $tmp = $root . '/tmp/' . bin2hex(random_bytes(8));
    if (!@mkdir($tmp, 0750, true)) {
        fail('تعذر تجهيز فولدر الحفظ على السيرفر', 500);
    }
    try {
        $originals = [];
        foreach ($files as $i => $f) {
            $stored = sprintf('original-%02d.%s', $i + 1, $f['ext']);
            if (!copy($f['tmp'], "$tmp/$stored")) {
                throw new RuntimeException('copy failed');
            }
            $originals[] = ['name' => $f['name'], 'file' => $stored, 'mime' => $f['mime'], 'size' => $f['size'], 'sha256' => hash_file('sha256', "$tmp/$stored")];
        }
        $title = 'إقرار موقّع ' . $h['doc_no'] . ' - ' . $h['employee_name'];
        if ($files[0]['ext'] === 'pdf') {
            $pages = scan_check_pdf($files[0])['pages'];
            copy("$tmp/{$originals[0]['file']}", "$tmp/" . SCAN_FILE_NAME);
            $source = 'pdf';
        } else {
            $pages = scan_build_pdf($files, "$tmp/" . SCAN_FILE_NAME, $title);
            $source = 'images';
        }
        $pdfSize = (int)filesize("$tmp/" . SCAN_FILE_NAME);
        if ($pdfSize <= 0) {
            throw new RuntimeException('empty pdf');
        }
        if (!is_dir(dirname("$root/$rel")) && !@mkdir(dirname("$root/$rel"), 0750, true)) {
            throw new RuntimeException('mkdir failed');
        }
        if (!@rename($tmp, "$root/$rel")) {
            throw new RuntimeException('rename failed');
        }
    } catch (ApiError $e) {
        rrmdir($tmp);
        throw $e;
    } catch (Throwable $e) {
        rrmdir($tmp);
        error_log('[custody] scan save: ' . $e);
        fail('تعذر حفظ الملف على السيرفر، ولم يتم تغيير حالة السند', 500);
    }

    $uid = (int)current_user()['id'];
    $now = now();
    try {
        db()->beginTransaction();
        $sid = insert('handover_scans', [
            'handover_id' => $id, 'employee_id' => (int)$h['employee_id'], 'version' => $version, 'signed_on' => $signedOn,
            'notes' => $notes, 'reason' => $current ? $reason : null, 'dir' => $rel, 'source' => $source, 'pages' => $pages,
            'pdf_size' => $pdfSize, 'pdf_sha256' => hash_file('sha256', "$root/$rel/" . SCAN_FILE_NAME),
            'originals' => json_encode($originals, JSON_UNESCAPED_UNICODE), 'snapshot' => json_encode(handover_snapshot($h), JSON_UNESCAPED_UNICODE),
            'uploaded_by' => $uid, 'uploaded_at' => $now,
        ]);
        if ($current) {
            update('handover_scans', $current['id'], ['replaced_by' => $sid, 'replaced_at' => $now]);
        }
        // الحالة تتغير مع آخر خطوة، والسند ما يتغيرش فيه أي حاجة تانية (التاريخ والأصناف والتوقيع الإلكتروني)
        $st = q('UPDATE handovers SET paper_scan_id = ?, paper_signed_on = ? WHERE id = ? AND ' . ($current ? 'paper_scan_id = ?' : 'paper_scan_id IS NULL'),
            $current ? [$sid, $signedOn, $id, $current['id']] : [$sid, $signedOn, $id]);
        if ($st->rowCount() !== 1) {
            throw new ApiError('الإقرار اتغير من مستخدم تاني. افتح السند من جديد', 409);
        }
        $details = $h['doc_no'] . ' — ' . $h['employee_name'] . ' — إصدار ' . $version . ' — تاريخ التوقيع ' . $signedOn . ' — ' . ($pages ? $pages . ' صفحة' : 'PDF');
        log_activity($current ? 'استبدال الإقرار الموقّع' : 'توثيق توقيع ورقي', 'handover', $id, $details . ($current ? ' — السبب: ' . $reason : ''));
        db()->commit();
    } catch (Throwable $e) {
        if (db()->inTransaction()) {
            db()->rollBack();
        }
        rrmdir("$root/$rel");
        if ($e instanceof ApiError) {
            throw $e;
        }
        if ($e instanceof PDOException && ($e->getCode() === '23000' || stripos($e->getMessage(), 'UNIQUE') !== false)) {
            fail('في رفع تاني لنفس السند حصل في نفس اللحظة. افتح السند من جديد', 409);
        }
        throw $e;
    }
    return handover_view($id);
}

// عرض أو تنزيل الإقرار الموقّع (أو ملف أصلي) بعد التحقق من الدخول والصلاحية
function send_scan_file()
{
    $scan = q_one('SELECT s.*, h.doc_no FROM handover_scans s JOIN handovers h ON h.id = s.handover_id WHERE s.id = ?', [in_int('id')]);
    if (!$scan) {
        fail('الملف غير موجود', 404);
    }
    $n = in_int('original');
    if ($n) {
        $orig = json_decode($scan['originals'], true)[$n - 1] ?? null;
        if (!$orig) {
            fail('الملف غير موجود', 404);
        }
        $path = scan_path($scan, $orig['file']);
        $mime = $orig['mime'];
        $name = $scan['doc_no'] . '-v' . $scan['version'] . '-original-' . $n . '.' . pathinfo($orig['file'], PATHINFO_EXTENSION);
    } else {
        $path = scan_path($scan);
        $mime = 'application/pdf';
        $name = 'اقرار-موقع-' . $scan['doc_no'] . ($scan['replaced_by'] ? '-v' . $scan['version'] : '') . '.pdf';
    }
    if (!is_file($path)) {
        error_log('[custody] missing scan file: ' . $path);
        fail('ملف الإقرار غير موجود على السيرفر. استرجعه من النسخة الاحتياطية', 404);
    }
    session_write_close();
    $ascii = preg_replace('/[^A-Za-z0-9._-]+/', '-', $name);
    header('Content-Type: ' . $mime);
    header('Content-Length: ' . filesize($path));
    header('Content-Disposition: ' . (in('download') ? 'attachment' : 'inline') . '; filename="' . $ascii . '"; filename*=UTF-8\'\'' . rawurlencode($name));
    header('Cache-Control: private, no-store');
    header('X-Content-Type-Options: nosniff');
    header('X-Frame-Options: SAMEORIGIN');
    readfile($path);
    exit;
}

// بيانات الإقرار الحالي وكل إصداراته للعرض في تفاصيل السند
function handover_scans_view($handoverId)
{
    $rows = q_all('SELECT s.id, s.version, s.signed_on, s.notes, s.reason, s.source, s.pages, s.pdf_size, s.originals, s.snapshot,
            s.uploaded_at, s.replaced_at, u.name AS uploaded_by_name
        FROM handover_scans s LEFT JOIN users u ON u.id = s.uploaded_by WHERE s.handover_id = ? ORDER BY s.version DESC', [$handoverId]);
    return array_map(function ($r) {
        $r['originals'] = array_map(function ($o) {
            return ['name' => $o['name'], 'mime' => $o['mime'], 'size' => $o['size']];
        }, json_decode($r['originals'], true) ?: []);
        $r['snapshot'] = json_decode($r['snapshot'], true);
        return $r;
    }, $rows);
}
