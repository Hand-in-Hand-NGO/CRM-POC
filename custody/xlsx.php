<?php
// كتابة وقراءة ملفات Excel (xlsx) بدون مكتبات خارجية. محتاج إضافتي PHP: zip و xml.

function xlsx_available()
{
    return class_exists('ZipArchive') && class_exists('XMLReader') && class_exists('DOMDocument');
}

function xlsx_col($i)
{
    $s = '';
    for ($i++; $i > 0; $i = intdiv($i - 1, 26)) {
        $s = chr(65 + ($i - 1) % 26) . $s;
    }
    return $s;
}

function xlsx_col_index($letters)
{
    $n = 0;
    foreach (str_split(strtoupper($letters)) as $ch) {
        $n = $n * 26 + (ord($ch) - 64);
    }
    return $n - 1;
}

function xlsx_esc($s)
{
    // حروف التحكم غير مسموحة في XML
    $s = preg_replace('/[\x00-\x08\x0B\x0C\x0E-\x1F]/u', '', (string)$s);
    return htmlspecialchars($s, ENT_QUOTES | ENT_XML1, 'UTF-8');
}

// أنماط الخلايا (cellXfs في styles.xml)
const XS_TEXT = 1, XS_NUM = 2, XS_HEAD_REQ = 3, XS_HEAD_OPT = 4, XS_HEAD_RO = 5, XS_RO = 6, XS_TITLE = 7, XS_WRAP = 8, XS_BOLD = 9;

function xlsx_styles()
{
    return '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">
<fonts count="5">
<font><sz val="11"/><name val="Calibri"/><family val="2"/></font>
<font><b/><sz val="11"/><name val="Calibri"/><family val="2"/></font>
<font><sz val="11"/><color rgb="FF7F7F7F"/><name val="Calibri"/><family val="2"/></font>
<font><b/><i/><sz val="11"/><color rgb="FF595959"/><name val="Calibri"/><family val="2"/></font>
<font><b/><sz val="14"/><name val="Calibri"/><family val="2"/></font>
</fonts>
<fills count="5">
<fill><patternFill patternType="none"/></fill>
<fill><patternFill patternType="gray125"/></fill>
<fill><patternFill patternType="solid"><fgColor rgb="FFC6EFCE"/><bgColor indexed="64"/></patternFill></fill>
<fill><patternFill patternType="solid"><fgColor rgb="FFDDEBF7"/><bgColor indexed="64"/></patternFill></fill>
<fill><patternFill patternType="solid"><fgColor rgb="FFE7E6E6"/><bgColor indexed="64"/></patternFill></fill>
</fills>
<borders count="2">
<border><left/><right/><top/><bottom/><diagonal/></border>
<border><left style="thin"><color rgb="FFBFBFBF"/></left><right style="thin"><color rgb="FFBFBFBF"/></right><top style="thin"><color rgb="FFBFBFBF"/></top><bottom style="thin"><color rgb="FFBFBFBF"/></bottom><diagonal/></border>
</borders>
<cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs>
<cellXfs count="10">
<xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/>
<xf numFmtId="49" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1"/>
<xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/>
<xf numFmtId="49" fontId="1" fillId="2" borderId="1" xfId="0" applyNumberFormat="1" applyFont="1" applyFill="1" applyBorder="1" applyAlignment="1"><alignment horizontal="center" vertical="center" wrapText="1"/></xf>
<xf numFmtId="49" fontId="1" fillId="3" borderId="1" xfId="0" applyNumberFormat="1" applyFont="1" applyFill="1" applyBorder="1" applyAlignment="1"><alignment horizontal="center" vertical="center" wrapText="1"/></xf>
<xf numFmtId="49" fontId="3" fillId="4" borderId="1" xfId="0" applyNumberFormat="1" applyFont="1" applyFill="1" applyBorder="1" applyAlignment="1"><alignment horizontal="center" vertical="center" wrapText="1"/></xf>
<xf numFmtId="49" fontId="2" fillId="0" borderId="0" xfId="0" applyNumberFormat="1" applyFont="1"/>
<xf numFmtId="49" fontId="4" fillId="0" borderId="0" xfId="0" applyNumberFormat="1" applyFont="1" applyAlignment="1"><alignment readingOrder="2"/></xf>
<xf numFmtId="49" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1" applyAlignment="1"><alignment vertical="top" wrapText="1" readingOrder="2"/></xf>
<xf numFmtId="49" fontId="1" fillId="0" borderId="0" xfId="0" applyNumberFormat="1" applyFont="1" applyAlignment="1"><alignment vertical="top" wrapText="1" readingOrder="2"/></xf>
</cellXfs>
<cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles>
</styleSheet>';
}

/*
 * يكتب ملف xlsx. كل ورقة:
 *   name, cols: [[title, width, head (req|opt|ro|none), kind (text|number), list (قيم مسموحة اختيارية)]],
 *   rows: [[قيم]], table (صف عناوين + فلتر + تثبيت), styles: [rowIndex => style] لأوراق التعليمات
 * أي خلية ممكن تكون ['v' => قيمة, 's' => نمط].
 */
function xlsx_write($path, array $sheets, array $props = [])
{
    $zip = new ZipArchive();
    if ($zip->open($path, ZipArchive::CREATE | ZipArchive::OVERWRITE) !== true) {
        throw new RuntimeException('cannot create xlsx: ' . $path);
    }
    $n = count($sheets);
    $ct = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
<Default Extension="xml" ContentType="application/xml"/>
<Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>
<Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>
<Override PartName="/docProps/core.xml" ContentType="application/vnd.openxmlformats-package.core-properties+xml"/>
<Override PartName="/docProps/app.xml" ContentType="application/vnd.openxmlformats-officedocument.extended-properties+xml"/>';
    for ($i = 1; $i <= $n; $i++) {
        $ct .= "\n<Override PartName=\"/xl/worksheets/sheet$i.xml\" ContentType=\"application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml\"/>";
    }
    $zip->addFromString('[Content_Types].xml', $ct . "\n</Types>");
    $zip->addFromString('_rels/.rels', '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/>
<Relationship Id="rId2" Type="http://schemas.openxmlformats.org/package/2006/relationships/metadata/core-properties" Target="docProps/core.xml"/>
<Relationship Id="rId3" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/extended-properties" Target="docProps/app.xml"/>
</Relationships>');
    $stamp = gmdate('Y-m-d\TH:i:s\Z');
    $zip->addFromString('docProps/core.xml', '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<cp:coreProperties xmlns:cp="http://schemas.openxmlformats.org/package/2006/metadata/core-properties" xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns:dcterms="http://purl.org/dc/terms/" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance">
<dc:title>' . xlsx_esc($props['title'] ?? '') . '</dc:title><dc:creator>' . xlsx_esc($props['creator'] ?? '') . '</dc:creator>
<dcterms:created xsi:type="dcterms:W3CDTF">' . $stamp . '</dcterms:created><dcterms:modified xsi:type="dcterms:W3CDTF">' . $stamp . '</dcterms:modified>
</cp:coreProperties>');
    $zip->addFromString('docProps/app.xml', '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Properties xmlns="http://schemas.openxmlformats.org/officeDocument/2006/extended-properties"><Application>Microsoft Excel</Application></Properties>');
    $zip->addFromString('xl/styles.xml', xlsx_styles());

    $wbSheets = $rels = $names = '';
    foreach (array_values($sheets) as $i => $sh) {
        $id = $i + 1;
        $wbSheets .= '<sheet name="' . xlsx_esc($sh['name']) . '" sheetId="' . $id . '" r:id="rId' . $id . '"/>';
        $rels .= '<Relationship Id="rId' . $id . '" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet' . $id . '.xml"/>';
        if (!empty($sh['table']) && $sh['cols']) {
            $last = xlsx_col(count($sh['cols']) - 1) . '$' . max(1, count($sh['rows'] ?? []) + 1);
            $names .= '<definedName name="_xlnm._FilterDatabase" localSheetId="' . $i . '" hidden="1">\'' . xlsx_esc(str_replace("'", "''", $sh['name'])) . '\'!$A$1:$' . $last . '</definedName>';
        }
        $zip->addFromString("xl/worksheets/sheet$id.xml", xlsx_sheet_xml($sh, $i === 0));
    }
    $zip->addFromString('xl/workbook.xml', '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">
<workbookPr/><bookViews><workbookView activeTab="' . (int)($props['active'] ?? 0) . '"/></bookViews>
<sheets>' . $wbSheets . '</sheets>' . ($names ? '<definedNames>' . $names . '</definedNames>' : '') . '
</workbook>');
    $zip->addFromString('xl/_rels/workbook.xml.rels', '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' . $rels . '
<Relationship Id="rId' . ($n + 1) . '" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/>
</Relationships>');
    if (!$zip->close()) {
        throw new RuntimeException('cannot write xlsx: ' . $path);
    }
}

function xlsx_sheet_xml(array $sh, $first)
{
    $cols = $sh['cols'] ?? [];
    $table = !empty($sh['table']);
    $rowsCount = count($sh['rows'] ?? []);
    $x = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">';
    $x .= '<sheetViews><sheetView workbookViewId="0" rightToLeft="1"' . ($first ? ' tabSelected="1"' : '') . '>' .
        ($table ? '<pane ySplit="1" topLeftCell="A2" activePane="bottomLeft" state="frozen"/><selection pane="bottomLeft" activeCell="A2" sqref="A2"/>' : '') .
        '</sheetView></sheetViews><sheetFormatPr defaultRowHeight="15"/>';
    if ($cols) {
        $x .= '<cols>';
        foreach ($cols as $i => $c) {
            // نمط العمود بيتطبق على الخلايا الجديدة اللي المستخدم بيكتبها: نص علشان الأصفار والأرقام الطويلة ماتضيعش
            $style = ($c['kind'] ?? 'text') === 'number' ? XS_NUM : (($c['head'] ?? '') === 'ro' ? XS_RO : XS_TEXT);
            $x .= '<col min="' . ($i + 1) . '" max="' . ($i + 1) . '" width="' . ($c['width'] ?? 16) . '" customWidth="1" style="' . $style . '"/>';
        }
        $x .= '</cols>';
    }
    $x .= '<sheetData>';
    $r = 0;
    if ($table) {
        $r = 1;
        $x .= '<row r="1" ht="45" customHeight="1">';
        foreach ($cols as $i => $c) {
            $hs = ['req' => XS_HEAD_REQ, 'ro' => XS_HEAD_RO][$c['head'] ?? ''] ?? XS_HEAD_OPT;
            $x .= xlsx_cell(xlsx_col($i) . '1', $c['title'], $hs, 'text');
        }
        $x .= '</row>';
    }
    foreach ($sh['rows'] ?? [] as $ri => $row) {
        $r++;
        $rowStyle = $sh['styles'][$ri] ?? null;
        $ht = isset($sh['heights'][$ri]) ? ' ht="' . $sh['heights'][$ri] . '" customHeight="1"' : '';
        $cells = '';
        foreach (array_values($row) as $i => $v) {
            $s = null;
            if (is_array($v)) {
                $s = $v['s'] ?? null;
                $v = $v['v'] ?? null;
            }
            if ($v === null || $v === '') {
                continue;
            }
            $c = $cols[$i] ?? [];
            $kind = $c['kind'] ?? 'text';
            $s = $s ?? $rowStyle ?? ($kind === 'number' ? XS_NUM : (($c['head'] ?? '') === 'ro' ? XS_RO : XS_TEXT));
            $cells .= xlsx_cell(xlsx_col($i) . $r, $v, $s, $kind === 'number' && is_numeric($v) ? 'number' : 'text');
        }
        $x .= '<row r="' . $r . '"' . $ht . '>' . $cells . '</row>';
    }
    $x .= '</sheetData>';
    if ($table && $cols) {
        $x .= '<autoFilter ref="A1:' . xlsx_col(count($cols) - 1) . max(1, $rowsCount + 1) . '"/>';
    }
    // دمج خلايا (لسطور النص الطويلة في ورقة التعليمات)، بأرقام الصفوف في rows من 0
    if (!empty($sh['merges'])) {
        $x .= '<mergeCells count="' . count($sh['merges']) . '">';
        foreach ($sh['merges'] as [$ri, $c1, $c2]) {
            $x .= '<mergeCell ref="' . xlsx_col($c1) . ($ri + 1) . ':' . xlsx_col($c2) . ($ri + 1) . '"/>';
        }
        $x .= '</mergeCells>';
    }
    // قوائم القيم المسموحة (dropdown) لحد 5000 صف
    $dv = '';
    $dvCount = 0;
    foreach ($table ? $cols : [] as $i => $c) {
        if (empty($c['list'])) {
            continue;
        }
        $formula = '"' . str_replace('"', '""', implode(',', $c['list'])) . '"';
        if (mb_strlen($formula) > 255) {
            continue;
        }
        $col = xlsx_col($i);
        $dv .= '<dataValidation type="list" allowBlank="1" showInputMessage="1" showErrorMessage="1" errorTitle="قيمة غير مسموحة" error="اختر قيمة من القائمة" sqref="' .
            $col . '2:' . $col . '5001"><formula1>' . xlsx_esc($formula) . '</formula1></dataValidation>';
        $dvCount++;
    }
    if ($dvCount) {
        $x .= '<dataValidations count="' . $dvCount . '">' . $dv . '</dataValidations>';
    }
    $x .= '<pageMargins left="0.5" right="0.5" top="0.6" bottom="0.6" header="0.3" footer="0.3"/>';
    return $x . '</worksheet>';
}

function xlsx_cell($ref, $v, $style, $type)
{
    if ($type === 'number') {
        return '<c r="' . $ref . '" s="' . $style . '"><v>' . (0 + $v) . '</v></c>';
    }
    $v = (string)$v;
    $sp = preg_match('/^\s|\s$|\n/', $v) ? ' xml:space="preserve"' : '';
    return '<c r="' . $ref . '" s="' . $style . '" t="inlineStr"><is><t' . $sp . '>' . xlsx_esc($v) . '</t></is></c>';
}

// ---------------------------------------------------------------- القراءة

class XlsxError extends Exception
{
}

/*
 * يقرأ كل أوراق الملف: ['sheets' => [اسم الورقة => [رقم الصف => [رقم العمود => ['v' => نص, 'num' => bool]]]], 'date1904' => bool]
 * الصفوف بأرقامها الحقيقية في Excel، والأعمدة من 0.
 */
function xlsx_read($path, $maxRows = 5000, $maxBytes = 104857600)
{
    $zip = new ZipArchive();
    if ($zip->open($path, ZipArchive::RDONLY) !== true) {
        throw new XlsxError('الملف مش ملف Excel بصيغة xlsx، أو تالف');
    }
    try {
        // حماية من الملفات المضغوطة المفخخة: إجمالي الحجم بعد فك الضغط
        $total = 0;
        if ($zip->numFiles > 2000) {
            throw new XlsxError('الملف فيه عدد كبير جدًا من المكونات');
        }
        for ($i = 0; $i < $zip->numFiles; $i++) {
            $total += (int)$zip->statIndex($i)['size'];
        }
        if ($total > $maxBytes) {
            throw new XlsxError('حجم بيانات الملف بعد فك الضغط كبير جدًا');
        }
        $wb = xlsx_dom($zip, 'xl/workbook.xml');
        if (!$wb) {
            throw new XlsxError('الملف مش ملف Excel بصيغة xlsx، أو تالف');
        }
        $date1904 = false;
        foreach ($wb->getElementsByTagNameNS('*', 'workbookPr') as $p) {
            $date1904 = in_array(strtolower($p->getAttribute('date1904')), ['1', 'true'], true);
        }
        $targets = [];
        $rels = xlsx_dom($zip, 'xl/_rels/workbook.xml.rels');
        foreach ($rels ? $rels->getElementsByTagNameNS('*', 'Relationship') : [] as $rel) {
            $t = $rel->getAttribute('Target');
            $targets[$rel->getAttribute('Id')] = $t[0] === '/' ? ltrim($t, '/') : 'xl/' . $t;
        }
        $shared = xlsx_shared_strings($zip);
        $sheets = [];
        foreach ($wb->getElementsByTagNameNS('*', 'sheet') as $s) {
            $rid = $s->getAttributeNS('http://schemas.openxmlformats.org/officeDocument/2006/relationships', 'id');
            if (!isset($targets[$rid])) {
                continue;
            }
            $sheets[$s->getAttribute('name')] = xlsx_sheet_rows($zip, xlsx_norm_path($targets[$rid]), $shared, $maxRows, $s->getAttribute('name'));
        }
        return ['sheets' => $sheets, 'date1904' => $date1904];
    } finally {
        $zip->close();
    }
}

function xlsx_norm_path($p)
{
    $out = [];
    foreach (explode('/', $p) as $part) {
        if ($part === '..') {
            array_pop($out);
        } elseif ($part !== '.' && $part !== '') {
            $out[] = $part;
        }
    }
    return implode('/', $out);
}

function xlsx_dom(ZipArchive $zip, $name)
{
    $xml = $zip->getFromName($name);
    if ($xml === false) {
        return null;
    }
    $d = new DOMDocument();
    if (!@$d->loadXML($xml, LIBXML_NONET | LIBXML_COMPACT | LIBXML_PARSEHUGE)) {
        throw new XlsxError('الملف تالف (تعذر قراءة ' . $name . ')');
    }
    return $d;
}

// نص العنصر بدون النطق الصوتي (rPh)
function xlsx_text(DOMNode $n)
{
    $s = '';
    foreach ($n->getElementsByTagNameNS('*', 't') as $t) {
        if ($t->parentNode && $t->parentNode->localName === 'rPh') {
            continue;
        }
        $s .= $t->textContent;
    }
    return $s;
}

function xlsx_shared_strings(ZipArchive $zip)
{
    $out = [];
    $name = 'xl/sharedStrings.xml';
    if ($zip->locateName($name) === false) {
        return $out;
    }
    $r = new XMLReader();
    $r->XML($zip->getFromName($name), 'UTF-8', LIBXML_NONET | LIBXML_COMPACT | LIBXML_PARSEHUGE);
    // بعد next() بنكون واقفين على العنصر اللي بعده مباشرة، فمانقراش تاني قبل ما نفحصه
    $ok = @$r->read();
    while ($ok) {
        if ($r->nodeType === XMLReader::ELEMENT && $r->localName === 'si') {
            $node = $r->expand();
            $out[] = $node ? xlsx_text($node) : '';
            $ok = @$r->next();
            continue;
        }
        $ok = @$r->read();
    }
    $r->close();
    return $out;
}

function xlsx_sheet_rows(ZipArchive $zip, $name, array $shared, $maxRows, $sheetName)
{
    $xml = $zip->getFromName($name);
    if ($xml === false) {
        return [];
    }
    $r = new XMLReader();
    $r->XML($xml, 'UTF-8', LIBXML_NONET | LIBXML_COMPACT | LIBXML_PARSEHUGE);
    $rows = [];
    $rowNum = 0;
    $ok = @$r->read();
    while ($ok) {
        if ($r->nodeType !== XMLReader::ELEMENT || $r->localName !== 'row') {
            $ok = @$r->read();
            continue;
        }
        $rowNum = (int)($r->getAttribute('r') ?: $rowNum + 1);
        $node = $r->expand();
        $cells = [];
        $col = -1;
        foreach ($node ? $node->childNodes : [] as $c) {
            if (!$c instanceof DOMElement || $c->localName !== 'c') {
                continue;
            }
            $ref = $c->getAttribute('r');
            $col = $ref !== '' && preg_match('/^([A-Za-z]+)/', $ref, $m) ? xlsx_col_index($m[1]) : $col + 1;
            $t = $c->getAttribute('t');
            $v = null;
            foreach ($c->childNodes as $ch) {
                if ($ch instanceof DOMElement && $ch->localName === 'v') {
                    $v = $ch->textContent;
                }
            }
            $num = false;
            if ($t === 's') {
                $v = $shared[(int)$v] ?? '';
            } elseif ($t === 'inlineStr') {
                $v = '';
                foreach ($c->childNodes as $ch) {
                    if ($ch instanceof DOMElement && $ch->localName === 'is') {
                        $v = xlsx_text($ch);
                    }
                }
            } elseif ($t === 'b') {
                $v = $v === '1' ? 'TRUE' : 'FALSE';
            } elseif ($t === 'e' || $t === 'str' || $t === 'd') {
                $v = (string)$v;
            } else {
                $num = $v !== null && $v !== '';
            }
            if ($v === null || $v === '') {
                continue;
            }
            $cells[$col] = ['v' => (string)$v, 'num' => $num];
        }
        if ($cells) {
            if (count($rows) >= $maxRows) {
                $r->close();
                throw new XlsxError('الورقة «' . $sheetName . '» فيها أكتر من ' . $maxRows . ' صف. قسّم الملف لأكتر من ملف');
            }
            $rows[$rowNum] = $cells;
        }
        $ok = @$r->next();
    }
    $r->close();
    return $rows;
}
