# Builds manufacturing-live-mock.html = manufacturing-live-dashboard.html + the mock server inlined right after jQuery.
# Nothing else changes, so the mock page always matches the page given to the developer.
import os
here = os.path.dirname(os.path.abspath(__file__))
src = open(os.path.join(here, '..', 'manufacturing-live-dashboard.html'), encoding='utf-8').read()
js = open(os.path.join(here, 'manufacturing-mock-server.js'), encoding='utf-8').read()
anchor = '<script src="https://cms.handinhand-eg.com/plugins/jQuery/jQuery-2.1.4.min.js"></script>\n'
assert src.count(anchor) == 1
block = '    <!-- MOCK DATA (preview only): start -->\n    <script>\n' + js + '    </script>\n    <!-- MOCK DATA (preview only): end -->\n'
open(os.path.join(here, '..', 'manufacturing-live-mock.html'), 'w', encoding='utf-8').write(src.replace(anchor, anchor + block))
