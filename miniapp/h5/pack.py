import os
import zipfile

ROOT = os.path.dirname(os.path.abspath(__file__))
DIST = os.path.join(ROOT, '..', 'dist-h5')
OUT = os.path.join(ROOT, '..', 'gomoku-minitool.zip')

with zipfile.ZipFile(OUT, 'w', zipfile.ZIP_DEFLATED) as zf:
    for base, _, files in os.walk(DIST):
        for name in sorted(files):
            path = os.path.join(base, name)
            zf.write(path, os.path.relpath(path, DIST))
print(OUT)
