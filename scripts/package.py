"""Build Chrome/Edge packages and Safari development resources from shared source."""
from pathlib import Path
from zipfile import ZipFile, ZIP_DEFLATED
import argparse
import json
import shutil
root = Path(__file__).resolve().parents[1]
parser = argparse.ArgumentParser()
parser.add_argument('--browser', choices=['all', 'chrome', 'edge', 'safari'], default='all')
args = parser.parse_args()
manifest = json.loads((root / 'extension/manifest.json').read_text())
for browser in (['chrome', 'edge', 'safari'] if args.browser == 'all' else [args.browser]):
    folder = root / 'dist' / browser / 'extension'
    if folder.exists():
        shutil.rmtree(folder)
    shutil.copytree(root / 'extension', folder, ignore=shutil.ignore_patterns('J_Entrez.txt', '.DS_Store'))
    if browser == 'safari':
        config = dict(manifest)
        config.pop('minimum_chrome_version', None)
        config['permissions'] = ['storage', 'tabs']
        config['background'] = {'page': 'background.html', 'persistent': False}
        (folder / 'background.html').write_text('<!doctype html><meta charset="UTF-8"><script src="lib/core.js"></script><script src="lib/platform.js"></script><script src="lib/download.js"></script><script src="background.js"></script>\n')
        (folder / 'manifest.json').write_text(json.dumps(config, ensure_ascii=False, indent=2) + '\n')
    label = 'Safari-development' if browser == 'safari' else browser.capitalize()
    target = root / 'dist' / f'PaperName-{label}-v{manifest["version"]}.zip'
    with ZipFile(target, 'w', compression=ZIP_DEFLATED, compresslevel=9) as archive:
        for path in sorted(folder.rglob('*')):
            if path.is_file():
                archive.write(path, 'PaperName/extension/' + str(path.relative_to(folder)))
        for name in ['README.md', 'SAFARI.md', 'DATA_SOURCES.md', '使用说明.md', '验证说明.md', 'LICENSE']:
            archive.write(root / name, 'PaperName/' + name)
    print(target)
