#!/usr/bin/env python3
"""يبني custody-demo.html: نسخة تجريبية من ملف واحد لنظام العهد، من نفس ملفات custody/ مباشرة.
التشغيل: python3 custody-demo/build.py
"""
import base64
import pathlib
import re

ROOT = pathlib.Path(__file__).resolve().parent
APP = ROOT.parent / 'custody'
V = APP / 'assets' / 'vendor'


def read(p):
    return pathlib.Path(p).read_text(encoding='utf-8')


def woff2(p):
    return 'url(data:font/woff2;base64,' + base64.b64encode(pathlib.Path(p).read_bytes()).decode() + ") format('woff2')"


def replace_once(text, old, new):
    assert text.count(old) == 1, f'patch target not found exactly once: {old[:60]!r}'
    return text.replace(old, new)


# ---------- CSS (الخطوط مضمنة)
bootstrap = re.sub(r"@font-face\{font-family:'Glyphicons Halflings';[^}]*\}",
                   "@font-face{font-family:'Glyphicons Halflings';src:" + woff2(V / 'bootstrap/fonts/glyphicons-halflings-regular.woff2') + '}',
                   read(V / 'bootstrap/css/bootstrap.min.css'))
fa = re.sub(r"@font-face\{font-family:'FontAwesome';[^}]*\}",
            "@font-face{font-family:'FontAwesome';src:" + woff2(V / 'font-awesome/fonts/fontawesome-webfont.woff2') + ';font-weight:normal;font-style:normal}',
            read(V / 'font-awesome/css/font-awesome.min.css'))
kufi = re.sub(r"url\((noto-kufi-arabic-arabic-\d+-normal\.woff2)\) format\('woff2'\)",
              lambda m: woff2(V / 'fonts' / m.group(1)), read(V / 'fonts/noto-kufi-arabic.css'))
css = '\n'.join([bootstrap, read(V / 'bootstrap/css/bootstrap-rtl.min.css'), fa, kufi, read(V / 'select2/select2.min.css'),
                 read(APP / 'assets/theme.css'), read(APP / 'assets/app.css'),
                 '.demo-badge{background:#ff6a00;color:#fff;border-radius:10px;padding:2px 10px;font-size:11px;font-weight:700;margin-left:6px}'])

# ---------- HTML (من index.php بعد إزالة PHP)
index = read(APP / 'index.php')
body = index[index.index('<body class="app">') + len('<body class="app">'):index.index('<script src=')]
body = body.replace("<?= h(cfg('app_name')) ?>", 'العهد الإلكترونية').replace("<?= h(cfg('org_name')) ?>", 'Hand in Hand')
assert '<?' not in body, 'unhandled PHP left in index.php body'
body = replace_once(body, '<div class="header-user">',
                    '<div class="header-user"><span class="demo-badge">نسخة تجريبية</span>'
                    '<button class="btn btn-link btn-sm" onclick="if(confirm(\'إرجاع البيانات التجريبية للبداية؟\'))DEMO.reset()" title="إعادة ضبط البيانات"><i class="fa fa-undo"></i></button>')

# ---------- JS (app.js كما هو مع توجيه الطباعة والتصدير للديمو)
app = read(APP / 'assets/app.js')
app = replace_once(app, "function openPrint(url) { window.open(url, '_blank'); }", 'function openPrint(url) { DEMO.print(url); }')
app = replace_once(app, 'window.location = exportUrl(', 'DEMO.go = exportUrl(')
js = '\n;\n'.join([read(V / 'jquery.min.js'), read(V / 'bootstrap/js/bootstrap.min.js'), read(V / 'select2/select2.min.js'),
                    read(ROOT / 'demo-api.js'), app])

html = ('<!doctype html>\n<html lang="ar" dir="rtl">\n<head>\n<meta charset="utf-8">\n'
        '<meta name="viewport" content="width=device-width, initial-scale=1">\n<title>العهد الإلكترونية — نسخة تجريبية</title>\n'
        '<style id="app-css">\n' + css + '\n</style>\n</head>\n<body class="app">' + body +
        '<script>\n' + js.replace('</script', '<\\/script') + '\n</script>\n</body>\n</html>\n')
out = ROOT / 'custody-demo.html'
out.write_text(html, encoding='utf-8')
print(f'{out} — {len(html.encode()) / 1024:.0f} KB')
