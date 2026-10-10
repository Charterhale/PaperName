"""生成可解压加载的 Edge 安装包；排除原始表、测试下载及临时文件。"""
from pathlib import Path
from zipfile import ZipFile, ZIP_DEFLATED
import json
root = Path(__file__).resolve().parents[1]
manifest = json.loads((root / 'extension/manifest.json').read_text())
target = root / f'PaperName-Edge-v{manifest["version"]}.zip'
with ZipFile(target, 'w', compression=ZIP_DEFLATED, compresslevel=9) as archive:
    for path in sorted((root / 'extension').rglob('*')):
        if path.is_file() and path.name not in ['J_Entrez.txt', '.DS_Store']:
            archive.write(path, 'PaperName/' + str(path.relative_to(root)))
    for name in ['使用说明.md', '验证说明.md', '验证结果.json', 'LICENSE', '界面预览.png']:
        path = root / name
        if path.exists():
            archive.write(path, 'PaperName/' + name)
print(target)
print(f'{target.stat().st_size / 1024 / 1024:.2f} MB')
