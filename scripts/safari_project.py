"""Optional Xcode packaging; does not sign, install or change developer settings."""
import subprocess
from pathlib import Path
root = Path(__file__).resolve().parents[1]
extension = root / 'dist/safari/extension'
if not extension.is_dir():
    raise SystemExit('First run: python3 scripts/package.py --browser safari')
for tool in ['safari-web-extension-packager', 'safari-web-extension-converter']:
    result = subprocess.run(['xcrun', '--find', tool], capture_output=True, text=True)
    if result.returncode == 0:
        subprocess.run([result.stdout.strip(), str(extension), '--project-location', str(root / 'dist/safari-xcode'),
                        '--app-name', 'PaperName', '--bundle-identifier', 'io.github.charterhale.papername',
                        '--swift', '--macos-only', '--no-open', '--no-prompt'], check=True)
        break
else:
    raise SystemExit('Xcode with Safari extension packaging tools is required. Safari 27+ can load the folder temporarily; see SAFARI.md.')
