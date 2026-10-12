// Manual Safari integration fixture, bound to loopback only; no external network.
const http=require('node:http');
const pdf=Buffer.from('%PDF-1.4\n1 0 obj\n<< /Type /Catalog /Pages 2 0 R >>\nendobj\n2 0 obj\n<< /Type /Pages /Count 0 /Kids [] >>\nendobj\ntrailer\n<< /Root 1 0 R >>\n%%EOF');
http.createServer((req,res)=>{
  if(req.url==='/paper.pdf'){res.writeHead(200,{'content-type':'application/pdf','content-disposition':'attachment; filename="original.pdf"'});res.end(pdf);return;}
  if(req.url==='/error.pdf'){res.writeHead(200,{'content-type':'text/html'});res.end('<h1>Login required</h1>');return;}
  res.writeHead(200,{'content-type':'text/html; charset=utf-8'});
  res.end('<!doctype html><title>PaperName Safari test</title><meta name="citation_title" content="PaperName Safari test"><meta name="citation_journal_title" content="Nature Medicine"><meta name="citation_publication_date" content="2024"><h1>PaperName Safari test</h1><p>Local fixture. No external network.</p><p><a href="/paper.pdf">Download test PDF</a></p><p><a href="/error.pdf">HTML error response test</a></p><p><a href="http://localhost:18764/paper.pdf">Cross-origin original download test</a></p>');
}).listen(18764,'127.0.0.1',()=>console.log('Safari fixture: http://127.0.0.1:18764/'));
