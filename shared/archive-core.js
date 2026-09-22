(function initArchiveCore(global) {
  "use strict";

  const encoder = new TextEncoder();
  const table = (() => { const rows = new Uint32Array(256); for (let n = 0; n < 256; n += 1) { let c = n; for (let k = 0; k < 8; k += 1) c = (c & 1) ? 0xedb88320 ^ (c >>> 1) : c >>> 1; rows[n] = c >>> 0; } return rows; })();
  const bytes = (value) => value instanceof Uint8Array ? value : value instanceof ArrayBuffer ? new Uint8Array(value) : encoder.encode(String(value));
  const crc32 = (input) => { let crc = 0xffffffff; for (const value of bytes(input)) crc = table[(crc ^ value) & 255] ^ (crc >>> 8); return (crc ^ 0xffffffff) >>> 0; };
  const u16 = (view, offset, value) => view.setUint16(offset, value, true);
  const u32 = (view, offset, value) => view.setUint32(offset, value >>> 0, true);
  const concat = (parts) => { const size = parts.reduce((sum, part) => sum + part.length, 0), output = new Uint8Array(size); let offset = 0; for (const part of parts) { output.set(part, offset); offset += part.length; } return output; };
  const xml = (value) => String(value ?? "").replace(/[&<>"']/g, (character) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&apos;" })[character]);

  class ZipBuilder {
    constructor() { this.files = []; }
    add(name, data) { const fileName = bytes(String(name).replace(/^\/+/, "")), content = bytes(data); this.files.push({ fileName, content, crc: crc32(content) }); return this; }
    blob(type = "application/zip") {
      const local = [], central = []; let offset = 0;
      for (const file of this.files) {
        const header = new Uint8Array(30); const view = new DataView(header.buffer); u32(view, 0, 0x04034b50); u16(view, 4, 20); u16(view, 6, 0x0800); u16(view, 8, 0); u32(view, 14, file.crc); u32(view, 18, file.content.length); u32(view, 22, file.content.length); u16(view, 26, file.fileName.length);
        local.push(header, file.fileName, file.content);
        const record = new Uint8Array(46); const centralView = new DataView(record.buffer); u32(centralView, 0, 0x02014b50); u16(centralView, 4, 20); u16(centralView, 6, 20); u16(centralView, 8, 0x0800); u32(centralView, 16, file.crc); u32(centralView, 20, file.content.length); u32(centralView, 24, file.content.length); u16(centralView, 28, file.fileName.length); u32(centralView, 42, offset); central.push(record, file.fileName);
        offset += header.length + file.fileName.length + file.content.length;
      }
      const centralBytes = concat(central), end = new Uint8Array(22), endView = new DataView(end.buffer); u32(endView, 0, 0x06054b50); u16(endView, 8, this.files.length); u16(endView, 10, this.files.length); u32(endView, 12, centralBytes.length); u32(endView, 16, offset);
      return new Blob([...local, centralBytes, end], { type });
    }
  }

  function paragraph(text, style = "") {
    const lines = String(text ?? "").split("\n");
    const runs = lines.map((line, index) => `${index ? "<w:r><w:br/></w:r>" : ""}<w:r><w:t xml:space="preserve">${xml(line)}</w:t></w:r>`).join("");
    return `<w:p>${style ? `<w:pPr><w:pStyle w:val="${style}"/></w:pPr>` : ""}${runs}</w:p>`;
  }
  function contentText(content, options) {
    const core = global.MultiAIConversationExport;
    if (core?.contentMarkdown) return core.contentMarkdown(content, options);
    if (["markdown", "text", "thinking", "code", "writing_block", "html_widget"].includes(content.type)) return content.content || "";
    if (content.type === "image") return `[Image] ${content.alt || ""} ${content.url || content.imageUrl || ""}`;
    if (content.type === "attachment") return `[Attachment] ${content.name || content.attachment?.name || ""} ${content.url || content.attachment?.url || ""}`;
    if (content.type === "sources") return (content.sources || []).map((source) => `${source.title || source.url}: ${source.url}`).join("\n");
    if (content.type === "image_group") return (content.imageGroup?.images || []).map((image) => `[Image] ${image.title || ""} ${image.imageUrl || image.url || ""}`).join("\n");
    if (content.type === "video_blocks") return (content.videoBlocks || []).map((video) => `${video.title || video.url}: ${video.url}`).join("\n");
    const payload = content.shoppingCard || content.shoppingTable || content.chart || content.fileChanges;
    return payload ? JSON.stringify(payload, null, 2) : "";
  }
  function documentXml(conversation, options = {}) {
    const body = [paragraph(conversation.title, "Title")];
    if (options.includeMetadata !== false) body.push(paragraph(`${conversation.platformName}${conversation.sourceUrl ? ` · ${conversation.sourceUrl}` : ""}`, "Subtitle"));
    for (const message of conversation.messages) {
      const label = message.role === "user" ? (options.userLabel || "User") : (message.model || options.assistantLabel || conversation.platformName || "Assistant");
      body.push(paragraph(`${label}${options.showTimestamp && message.createdAt ? ` · ${new Date(message.createdAt).toLocaleString()}` : ""}`, "Heading1"));
      for (const content of message.contents) {
        if (content.type === "thinking" && !options.includeThinking) continue;
        const value = contentText(content, options);
        if (value) body.push(paragraph(value));
      }
    }
    return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body>${body.join("")}<w:sectPr><w:pgSz w:w="11906" w:h="16838"/><w:pgMar w:top="1134" w:right="1134" w:bottom="1134" w:left="1134"/></w:sectPr></w:body></w:document>`;
  }
  function docxBlob(conversation, options = {}) {
    const zip = new ZipBuilder();
    zip.add("[Content_Types].xml", `<?xml version="1.0" encoding="UTF-8"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/><Override PartName="/word/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.styles+xml"/><Override PartName="/docProps/core.xml" ContentType="application/vnd.openxmlformats-package.core-properties+xml"/></Types>`);
    zip.add("_rels/.rels", `<?xml version="1.0" encoding="UTF-8"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/><Relationship Id="rId2" Type="http://schemas.openxmlformats.org/package/2006/relationships/metadata/core-properties" Target="docProps/core.xml"/></Relationships>`);
    zip.add("word/document.xml", documentXml(conversation, options));
    zip.add("word/_rels/document.xml.rels", `<?xml version="1.0" encoding="UTF-8"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/></Relationships>`);
    zip.add("word/styles.xml", `<?xml version="1.0" encoding="UTF-8"?><w:styles xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:style w:type="paragraph" w:default="1" w:styleId="Normal"><w:name w:val="Normal"/><w:rPr><w:sz w:val="22"/></w:rPr></w:style><w:style w:type="paragraph" w:styleId="Title"><w:name w:val="Title"/><w:rPr><w:b/><w:sz w:val="36"/></w:rPr></w:style><w:style w:type="paragraph" w:styleId="Subtitle"><w:name w:val="Subtitle"/><w:rPr><w:color w:val="64748B"/></w:rPr></w:style><w:style w:type="paragraph" w:styleId="Heading1"><w:name w:val="heading 1"/><w:rPr><w:b/><w:sz w:val="28"/></w:rPr></w:style></w:styles>`);
    zip.add("docProps/core.xml", `<?xml version="1.0" encoding="UTF-8"?><cp:coreProperties xmlns:cp="http://schemas.openxmlformats.org/package/2006/metadata/core-properties" xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns:dcterms="http://purl.org/dc/terms/" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance"><dc:title>${xml(conversation.title)}</dc:title><dc:creator>Multi AI Workbench</dc:creator><dcterms:created xsi:type="dcterms:W3CDTF">${new Date().toISOString()}</dcterms:created></cp:coreProperties>`);
    return zip.blob("application/vnd.openxmlformats-officedocument.wordprocessingml.document");
  }

  global.MultiAIArchive = Object.freeze({ ZipBuilder, crc32, docxBlob });
})(typeof self !== "undefined" ? self : globalThis);
