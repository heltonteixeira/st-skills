"""Run the live harness for every eval run that has an extension.

Usage: python -I run_all.py <iteration-dir-glob-root> [filter]
Env:   same as harness.mjs (ST_URL, ST_DATA, ST_USER, CDP_URL).
Writes <run>/live.json next to outputs/.
"""
import glob, json, os, re, subprocess, sys

HERE = os.path.dirname(os.path.abspath(__file__))
TEST_FOR = {
    'slash-command-wordcount': 'wordcount',
    'background-mood-tagger': 'loadOnly',
    'dice-tool-with-server-log': 'toolInvoke',
    'scene-notes-settings-panel': 'sceneNotes',
    'message-button-and-wand-menu': 'tokenButtons',
}

root = sys.argv[1]
flt = sys.argv[2] if len(sys.argv) > 2 else ''
for run in sorted(glob.glob(os.path.join(root, '*', 'iteration-*', 'eval-*', '*_skill'))):
    if flt not in run:
        continue
    ext = os.path.join(run, 'outputs', 'extension')
    if not os.path.isfile(os.path.join(ext, 'manifest.json')):
        print('skip (no extension):', run)
        continue
    eval_name = os.path.basename(os.path.dirname(run))[len('eval-'):]
    test = TEST_FOR[eval_name]
    folder = 'test-ext'
    for js in glob.glob(os.path.join(ext, '**', '*.js'), recursive=True):
        # Only a string literal naming the folder counts (not prose in comments).
        m = re.search(r"[`'\"](?:/?scripts/extensions/)?third-party/([A-Za-z0-9_.\-]+)[`'\"/]", open(js, encoding='utf-8', errors='replace').read())
        if m and '$' not in m.group(1):
            folder = m.group(1)
            break
    out = os.path.join(run, 'live.json')
    r = subprocess.run(['node', os.path.join(HERE, 'harness.mjs'), ext, folder, test, out],
                       capture_output=True, text=True, timeout=400)
    print(os.path.relpath(run, root), '->', folder, r.stdout.strip() or r.stderr.strip()[-300:])
