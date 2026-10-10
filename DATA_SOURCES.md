# 数据与第三方来源

## NLM 离线期刊缩写

- 原始来源：[NCBI J_Entrez.txt](https://ftp.ncbi.nih.gov/pubmed/J_Entrez.txt)。
- 官方说明：[List of All Journals Cited in PubMed](https://www.nlm.nih.gov/bsd/serfile_addedinfo.html)。
- 初始快照获取日期：2026-10-10。
- 转换字段：JournalTitle、MedAbbr、IsoAbbr、ISSN (Print)、ISSN (Online)。优先采用 MedAbbr，缺失时采用 IsoAbbr。
- 发布文件：`extension/data/journals.json`；原始文本不提交到仓库。
- 转换规则：规范化检索键、排除同名不同缩写的歧义键，添加无歧义的主标题键；不依据首字母或单词生成缩写。

这些是 NLM / NCBI 提供的期刊元数据，项目不主张其著作权。自编代码的 MIT 许可证不覆盖第三方原始资料的独立权利；使用时仍应参考 [NLM Copyright Information](https://www.nlm.nih.gov/copyright.html)。项目并非 NLM、NCBI 或 NIH 官方产品，也不表示得到其认可。

## 在线元数据

运行时可通过论文 DOI 使用 [Crossref REST API](https://www.crossref.org/documentation/retrieve-metadata/rest-api/)，或通过 PMID 使用 [NCBI E-utilities](https://www.nlm.nih.gov/dataguide/eutilities/utilities.html)。不查询模糊标题、不获取全文、不嵌入 API Key。

API 返回资料遵循各来源的条款；应用只使用命名所需的标题、年份、期刊和标识符。核心/后台测试使用固定的元数据响应结构，不需要联网。

## 图标与截图

`extension/icons/` 为项目自制图标。`界面预览.png` 是扩展本身的展示截图，论文标题为示例，不包含用户浏览记录或真实下载记录。
