"""将 NLM 官方 J_Entrez.txt 转换为离线缩写表；不推断或生成缩写。"""
import json, re, pathlib, datetime
root = pathlib.Path(__file__).resolve().parents[1]
raw = root / 'extension/data/J_Entrez.txt'
def key(value):
    import unicodedata
    return re.sub(r'[.,:;\s&\-–—]+', '', unicodedata.normalize('NFKC', value).lower())
title_candidates, issn_candidates, short_names = {}, {}, {}
records = 0
for block in re.split(r'-{10,}\s*', raw.read_text()):
    fields = dict(line.split(': ', 1) for line in block.splitlines() if ': ' in line)
    abbreviation = fields.get('MedAbbr', '').strip() or fields.get('IsoAbbr', '').strip()
    title = fields.get('JournalTitle', '').strip()
    if not abbreviation or not title:
        continue
    records += 1
    for name in [title, fields.get('MedAbbr', ''), fields.get('IsoAbbr', '')]:
        if name:
            title_candidates.setdefault(key(name), set()).add(abbreviation)
    # NLM sometimes includes descriptive subtitles. Only add an unambiguous short title.
    short = re.split(r'\s*:\s*', title, maxsplit=1)[0].strip()
    if short != title:
        short_names.setdefault(key(short), set()).add(abbreviation)
    for field in ['ISSN (Print)', 'ISSN (Online)']:
        if fields.get(field):
            issn_candidates.setdefault(fields[field], set()).add(abbreviation)
titles = {name: next(iter(values)) for name, values in title_candidates.items() if len(values) == 1}
issns = {name: next(iter(values)) for name, values in issn_candidates.items() if len(values) == 1}
for name, abbreviations in short_names.items():
    if len(abbreviations) == 1 and name not in title_candidates:
        titles[name] = next(iter(abbreviations))
payload = {'source': 'https://ftp.ncbi.nih.gov/pubmed/J_Entrez.txt', 'retrieved': datetime.date.today().isoformat(), 'records': records, 'titles': titles, 'issns': issns}
(root / 'extension/data/journals.json').write_text(json.dumps(payload, ensure_ascii=False, separators=(',', ':')))
print(f'NLM 期刊表：{records} 个条目，{len(titles)} 个名称键，{len(issns)} 个 ISSN 键。')
