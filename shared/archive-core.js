(function initArchiveCore(global) {
  "use strict";
  const encoder = new TextEncoder();
  const crcTable = (() => { const rows = new Uint32Array(256); for (let n = 0; n < 256; n += 1) { let c = n; for (let k = 0; k < 8; k += 1) c = (c & 1) ? 0xedb88320 ^ (c >>> 1) : c >>> 1; rows[n] = c >>> 0; } return rows; })();
  const bytes = (value) => value instanceof Uint8Array ? value : value instanceof ArrayBuffer ? new Uint8Array(value) : encoder.encode(String(value));
  const crc32 = (input) => { let crc = 0xffffffff; for (const value of bytes(input)) crc = crcTable[(crc ^ value) & 255] ^ (crc >>> 8); return (crc ^ 0xffffffff) >>> 0; };
  const u16 = (view, offset, value) => view.setUint16(offset, value, true), u32 = (view, offset, value) => view.setUint32(offset, value >>> 0, true);
  const concat = (parts) => { const size = parts.reduce((sum, part) => sum + part.length, 0), output = new Uint8Array(size); let offset = 0; for (const part of parts) { output.set(part, offset); offset += part.length; } return output; };
  const xml = (value) => String(value ?? "").replace(/[&<>"']/g, (character) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&apos;" })[character]);

  class ZipBuilder {
    constructor() { this.files = []; }
    add(name, data) { const fileName = bytes(String(name).replace(/^\/+/, "")), content = bytes(data); this.files.push({ fileName, content, crc: crc32(content) }); return this; }
    blob(type = "application/zip") {
      const local = [], central = []; let offset = 0;
      for (const file of this.files) {
        const header = new Uint8Array(30), view = new DataView(header.buffer); u32(view, 0, 0x04034b50); u16(view, 4, 20); u16(view, 6, 0x0800); u16(view, 8, 0); u32(view, 14, file.crc); u32(view, 18, file.content.length); u32(view, 22, file.content.length); u16(view, 26, file.fileName.length); local.push(header, file.fileName, file.content);
        const record = new Uint8Array(46), centralView = new DataView(record.buffer); u32(centralView, 0, 0x02014b50); u16(centralView, 4, 20); u16(centralView, 6, 20); u16(centralView, 8, 0x0800); u32(centralView, 16, file.crc); u32(centralView, 20, file.content.length); u32(centralView, 24, file.content.length); u16(centralView, 28, file.fileName.length); u32(centralView, 42, offset); central.push(record, file.fileName); offset += header.length + file.fileName.length + file.content.length;
      }
      const centralBytes = concat(central), end = new Uint8Array(22), endView = new DataView(end.buffer); u32(endView, 0, 0x06054b50); u16(endView, 8, this.files.length); u16(endView, 10, this.files.length); u32(endView, 12, centralBytes.length); u32(endView, 16, offset); return new Blob([...local, centralBytes, end], { type });
    }
  }

  const run = (text, props = "") => `<w:r>${props ? `<w:rPr>${props}</w:rPr>` : ""}<w:t xml:space="preserve">${xml(text)}</w:t></w:r>`;
  function paragraph(text, style = "", props = "") {
    const lines = String(text ?? "").split("\n"), runs = lines.map((line, index) => `${index ? "<w:r><w:br/></w:r>" : ""}${run(line, props)}`).join("");
    return `<w:p>${style ? `<w:pPr><w:pStyle w:val="${style}"/></w:pPr>` : ""}${runs}</w:p>`;
  }
  const tableCell = (value, heading = false) => `<w:tc><w:tcPr><w:tcW w:w="0" w:type="auto"/><w:shd w:fill="${heading ? "E8ECFF" : "FFFFFF"}"/></w:tcPr>${paragraph(value, "", heading ? "<w:b/>" : "")}</w:tc>`;
  const tableXml = (headers, rows) => `<w:tbl><w:tblPr><w:tblStyle w:val="TableGrid"/><w:tblW w:w="0" w:type="auto"/></w:tblPr>${headers?.length ? `<w:tr>${headers.map((value) => tableCell(value, true)).join("")}</w:tr>` : ""}${(rows || []).map((row) => `<w:tr>${row.map((value) => tableCell(value)).join("")}</w:tr>`).join("")}</w:tbl>`;

  function markdownParts(value) {
    const out = [], lines = String(value || "").replace(/\r\n?/g, "\n").split("\n"); let code = false, language = "", buffer = [];
    const flush = () => { if (!buffer.length) return; out.push({ type: code ? "code" : "paragraph", text: buffer.join(code ? "\n" : " ").trim(), language }); buffer = []; };
    for (const line of lines) {
      const fence = line.match(/^```(.*)$/); if (fence) { flush(); code = !code; language = fence[1].trim(); continue; }
      if (code) { buffer.push(line); continue; }
      const heading = line.match(/^(#{1,6})\s+(.+)$/); if (heading) { flush(); out.push({ type: "heading", level: heading[1].length, text: heading[2] }); continue; }
      if (/^>\s?/.test(line)) { flush(); out.push({ type: "quote", text: line.replace(/^>\s?/, "") }); continue; }
      if (/^\s*([-*+] |\d+\. )/.test(line)) { flush(); out.push({ type: "list", text: line.replace(/^\s*([-*+] |\d+\. )/, "") }); continue; }
      if (!line.trim()) flush(); else buffer.push(line);
    }
    flush(); return out;
  }

  function createDocx(conversation, options = {}, media = new Map()) {
    const core = global.MultiAIConversationExport, data = core.normalizeConversation(conversation), relationships = [{ id: "rId1", type: "styles", target: "styles.xml" }], mediaFiles = [], body = [paragraph(data.title, "Title")]; let relIndex = 2, drawingIndex = 1;
    const hyperlink = (title, url) => { const id = `rId${relIndex++}`; relationships.push({ id, type: "hyperlink", target: url, external: true }); return `<w:p><w:hyperlink r:id="${id}">${run(title || url, '<w:color w:val="365CCB"/><w:u w:val="single"/>')}</w:hyperlink></w:p>`; };
    const findAsset = (url, candidates = []) => {
      if (url && media.has(url)) return media.get(url);
      if (Array.isArray(candidates)) {
        for (const c of candidates) {
          if (c && media.has(c)) return media.get(c);
        }
      }
      return null;
    };
    const image = (url, alt = "image", candidates = []) => {
      const asset = findAsset(url, candidates); if (!asset?.data) return hyperlink(alt, url);
      const id = `rId${relIndex++}`, ext = asset.ext || "png", name = `image${mediaFiles.length + 1}.${ext}`; relationships.push({ id, type: "image", target: `media/${name}` }); mediaFiles.push({ name, data: asset.data, mime: asset.mime || `image/${ext}` });
      const cx = 5_900_000, cy = Math.max(1_800_000, Math.min(6_000_000, Math.round(cx * ((asset.height || 600) / (asset.width || 1000))))), docPr = drawingIndex++;
      return `<w:p><w:r><w:drawing><wp:inline xmlns:wp="http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing" distT="0" distB="0" distL="0" distR="0"><wp:extent cx="${cx}" cy="${cy}"/><wp:docPr id="${docPr}" name="${xml(alt)}"/><a:graphic xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main"><a:graphicData uri="http://schemas.openxmlformats.org/drawingml/2006/picture"><pic:pic xmlns:pic="http://schemas.openxmlformats.org/drawingml/2006/picture"><pic:nvPicPr><pic:cNvPr id="0" name="${xml(name)}"/><pic:cNvPicPr/></pic:nvPicPr><pic:blipFill><a:blip r:embed="${id}"/><a:stretch><a:fillRect/></a:stretch></pic:blipFill><pic:spPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="${cx}" cy="${cy}"/></a:xfrm><a:prstGeom prst="rect"><a:avLst/></a:prstGeom></pic:spPr></pic:pic></a:graphicData></a:graphic></wp:inline></w:drawing></w:r></w:p>`;
    };
    const richText = (value) => markdownParts(value).map((part) => part.type === "heading" ? paragraph(part.text, `Heading${Math.min(3, part.level)}`) : part.type === "code" ? paragraph(part.text, "Code") : part.type === "quote" ? paragraph(part.text, "Quote") : part.type === "list" ? paragraph(`• ${part.text}`, "ListParagraph") : paragraph(part.text)).join("");
    const renderContent = (content) => {
      if (content.type === "thinking" && !options.includeThinking) return "";
      if (["text", "markdown", "writing_block", "blockquote"].includes(content.type)) return `${content.title ? paragraph(content.title, "Heading2") : ""}${richText(content.content)}`;
      if (content.type === "thinking") return paragraph("Thinking", "Heading2") + paragraph(content.content, "Quote");
      if (["code", "code_block"].includes(content.type)) return paragraph(content.language || "Code", "CodeLabel") + paragraph(content.content, "Code");
      if (content.type === "formula") return paragraph(content.content, "Formula");
      if (content.type === "divider") return paragraph("────────────", "Divider");
      if (content.type === "image") return image(content.url, content.alt || content.title, content.candidates);
      if (content.type === "image_group") return `${content.imageGroup.title ? paragraph(content.imageGroup.title, "Heading2") : ""}${content.imageGroup.images.map((item) => image(item.url || item.imageUrl, item.alt || item.title, item.candidates)).join("")}`;
      if (content.type === "attachment") {
        const isImg = (content.mimeType && content.mimeType.startsWith("image/")) || content.imageAccess || /\.(png|jpe?g|gif|webp|svg|bmp)$/i.test(content.url || content.name || "");
        if (isImg && findAsset(content.url, content.candidates)) {
          return image(content.url, content.name || "Image attachment", content.candidates);
        }
        return content.url ? hyperlink(`📎 ${content.name}`, content.url) : paragraph(`📎 ${content.name}`);
      }
      if (content.type === "sources") return `${paragraph(content.title || "Sources", "Heading2")}${content.sources.map((source, index) => hyperlink(`${index + 1}. ${source.title || source.url}`, source.url)).join("")}`;
      if (content.type === "table") return `${content.title ? paragraph(content.title, "Heading2") : ""}${tableXml(content.headers, content.rows)}`;
      if (content.type === "video_blocks") return `${content.videoBlockTitle ? paragraph(content.videoBlockTitle, "Heading2") : ""}${content.videoBlocks.map((video) => `${video.thumbnailUrl ? image(video.thumbnailUrl, video.title) : ""}${hyperlink(video.title || video.url, video.url)}`).join("")}`;
      if (content.type === "shopping_card") { const card = content.shoppingCard || {}, images = card.images || (card.image ? [card.image] : []); return `${paragraph(card.title || "Product", "Heading2")}${images.map((item) => image(typeof item === "string" ? item : item.url || item.imageUrl, card.title)).join("")}${card.price ? paragraph(card.price, "ProductPrice") : ""}${card.description ? paragraph(card.description) : ""}${card.url ? hyperlink("Open product", card.url) : ""}`; }
      if (content.type === "shopping_table") { const table = content.shoppingTable || {}; if (Array.isArray(table.columns) || Array.isArray(table.rows)) return tableXml(table.columns || [], table.rows || []); const attrs = table.attributes || [], headers = ["Product", ...attrs.map((item) => item.title || item.name || String(item))], rows = (table.products || []).map((product) => [product.title || product.name || "", ...(product.attributes || []).map((item) => item.value || item.text || String(item))]); return tableXml(headers, rows); }
      if (content.type === "file_changes") return `${paragraph("File changes", "Heading2")}${(content.fileChanges?.files || []).map((file) => paragraph(`${file.path || file.name || "file"}  +${file.added || 0}  −${file.removed || 0}`, "Code")).join("")}`;
      if (content.type === "html_widget") return `${content.title ? paragraph(content.title, "Heading2") : ""}${paragraph(content.content, "Code")}`;
      if (content.type === "chart") return `${paragraph(content.chart?.title || "Chart", "Heading2")}${paragraph(JSON.stringify(content.chart, null, 2), "Code")}`;
      return paragraph(core.contentMarkdown(content, options));
    };
    if (options.includeMetadata !== false) { body.push(paragraph(data.platformName, "Subtitle")); if (options.includeSource !== false && data.sourceUrl) body.push(hyperlink(data.sourceUrl, data.sourceUrl)); body.push(paragraph(`Exported ${new Date(data.exportedAt).toISOString()}`, "Metadata")); }
    const branchByMessage = new Map(); for (const branch of data.branches) for (const id of branch.messageIds) if (!branchByMessage.has(id)) branchByMessage.set(id, branch.title); let branch = "";
    for (const message of data.messages) {
      const nextBranch = branchByMessage.get(message.id) || ""; if (nextBranch && nextBranch !== branch && data.branches.length > 1) body.push(paragraph(nextBranch, "Heading1")); branch = nextBranch || branch;
      const label = message.role === "user" ? (options.userLabel || "User") : message.role === "system" ? "System" : message.role === "tool" ? "Tool" : (message.displayModel || message.model || options.assistantLabel || data.platformName || "Assistant"), timestamp = options.showTimestamp && message.createdAt ? ` · ${new Date(message.createdAt).toLocaleString()}` : "";
      body.push(paragraph(`${label}${timestamp}`, data.branches.length > 1 ? "Heading2" : "Heading1")); for (const content of message.contents) body.push(renderContent(content));
    }
    const document = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><w:body>${body.join("")}<w:sectPr><w:pgSz w:w="11906" w:h="16838"/><w:pgMar w:top="1134" w:right="1134" w:bottom="1134" w:left="1134"/></w:sectPr></w:body></w:document>`;
    return { data, document, relationships, mediaFiles };
  }

  function packageDocx(result) {
    const zip = new ZipBuilder(), imageDefaults = [...new Set(result.mediaFiles.map((file) => `<Default Extension="${file.name.split(".").pop()}" ContentType="${xml(file.mime)}"/>`))].join("");
    zip.add("[Content_Types].xml", `<?xml version="1.0" encoding="UTF-8"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/>${imageDefaults}<Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/><Override PartName="/word/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.styles+xml"/><Override PartName="/docProps/core.xml" ContentType="application/vnd.openxmlformats-package.core-properties+xml"/></Types>`);
    zip.add("_rels/.rels", `<?xml version="1.0" encoding="UTF-8"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/><Relationship Id="rId2" Type="http://schemas.openxmlformats.org/package/2006/relationships/metadata/core-properties" Target="docProps/core.xml"/></Relationships>`);
    zip.add("word/document.xml", result.document);
    zip.add("word/_rels/document.xml.rels", `<?xml version="1.0" encoding="UTF-8"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">${result.relationships.map((rel) => `<Relationship Id="${rel.id}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/${rel.type}" Target="${xml(rel.target)}"${rel.external ? ' TargetMode="External"' : ""}/>`).join("")}</Relationships>`);
    zip.add("word/styles.xml", `<?xml version="1.0" encoding="UTF-8"?><w:styles xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:style w:type="paragraph" w:default="1" w:styleId="Normal"><w:name w:val="Normal"/><w:rPr><w:sz w:val="22"/><w:lang w:eastAsia="zh-CN"/></w:rPr></w:style><w:style w:type="paragraph" w:styleId="Title"><w:name w:val="Title"/><w:rPr><w:b/><w:color w:val="172033"/><w:sz w:val="40"/></w:rPr></w:style><w:style w:type="paragraph" w:styleId="Subtitle"><w:name w:val="Subtitle"/><w:rPr><w:color w:val="64748B"/><w:sz w:val="24"/></w:rPr></w:style><w:style w:type="paragraph" w:styleId="Metadata"><w:name w:val="Metadata"/><w:rPr><w:color w:val="64748B"/><w:sz w:val="18"/></w:rPr></w:style><w:style w:type="paragraph" w:styleId="Heading1"><w:name w:val="heading 1"/><w:rPr><w:b/><w:color w:val="3F46A5"/><w:sz w:val="30"/></w:rPr></w:style><w:style w:type="paragraph" w:styleId="Heading2"><w:name w:val="heading 2"/><w:rPr><w:b/><w:sz w:val="26"/></w:rPr></w:style><w:style w:type="paragraph" w:styleId="Heading3"><w:name w:val="heading 3"/><w:rPr><w:b/><w:sz w:val="24"/></w:rPr></w:style><w:style w:type="paragraph" w:styleId="Code"><w:name w:val="Code"/><w:pPr><w:shd w:fill="F1F5F9"/><w:spacing w:before="80" w:after="80"/></w:pPr><w:rPr><w:rFonts w:ascii="Consolas" w:hAnsi="Consolas"/><w:sz w:val="19"/></w:rPr></w:style><w:style w:type="paragraph" w:styleId="CodeLabel"><w:name w:val="Code label"/><w:rPr><w:color w:val="64748B"/><w:sz w:val="17"/></w:rPr></w:style><w:style w:type="paragraph" w:styleId="Quote"><w:name w:val="Quote"/><w:pPr><w:ind w:left="360"/><w:shd w:fill="F8FAFC"/></w:pPr><w:rPr><w:color w:val="475569"/><w:i/></w:rPr></w:style><w:style w:type="paragraph" w:styleId="Formula"><w:name w:val="Formula"/><w:pPr><w:jc w:val="center"/></w:pPr><w:rPr><w:rFonts w:ascii="Cambria Math"/><w:sz w:val="24"/></w:rPr></w:style><w:style w:type="paragraph" w:styleId="ProductPrice"><w:name w:val="Product price"/><w:rPr><w:b/><w:color w:val="DC2626"/><w:sz w:val="26"/></w:rPr></w:style><w:style w:type="table" w:styleId="TableGrid"><w:name w:val="Table Grid"/><w:tblPr><w:tblBorders><w:top w:val="single" w:sz="4" w:color="D5DDEA"/><w:left w:val="single" w:sz="4" w:color="D5DDEA"/><w:bottom w:val="single" w:sz="4" w:color="D5DDEA"/><w:right w:val="single" w:sz="4" w:color="D5DDEA"/><w:insideH w:val="single" w:sz="4" w:color="D5DDEA"/><w:insideV w:val="single" w:sz="4" w:color="D5DDEA"/></w:tblBorders></w:tblPr></w:style></w:styles>`);
    zip.add("docProps/core.xml", `<?xml version="1.0" encoding="UTF-8"?><cp:coreProperties xmlns:cp="http://schemas.openxmlformats.org/package/2006/metadata/core-properties" xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns:dcterms="http://purl.org/dc/terms/" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance"><dc:title>${xml(result.data.title)}</dc:title><dc:creator>Multi AI Workbench</dc:creator><dcterms:created xsi:type="dcterms:W3CDTF">${new Date().toISOString()}</dcterms:created></cp:coreProperties>`);
    for (const file of result.mediaFiles) zip.add(`word/media/${file.name}`, file.data); return zip.blob("application/vnd.openxmlformats-officedocument.wordprocessingml.document");
  }

  const extensionFor = (mime, url) => ({ "image/png": "png", "image/jpeg": "jpg", "image/gif": "gif", "image/svg+xml": "svg", "image/bmp": "bmp" })[mime] || url?.match(/\.([a-z0-9]{2,5})(?:[?#]|$)/i)?.[1]?.toLowerCase() || "png";
  function docxBlob(conversation, options = {}) { return packageDocx(createDocx(conversation, options)); }
  async function docxBlobWithAssets(conversation, options = {}, resolved = new Map()) {
    const media = new Map();
    for (const [url, asset] of resolved) { if (!asset?.blob || !String(asset.mime || asset.blob.type).startsWith("image/")) continue; const mime = asset.mime || asset.blob.type; media.set(url, { data: new Uint8Array(await asset.blob.arrayBuffer()), mime, ext: extensionFor(mime, url), width: asset.width, height: asset.height }); }
    return packageDocx(createDocx(conversation, options, media));
  }

  global.MultiAIArchive = Object.freeze({ ZipBuilder, crc32, docxBlob, docxBlobWithAssets });
})(typeof self !== "undefined" ? self : globalThis);
