(function initMultiAIExportCore(global) {
  "use strict";
  const escapeTableCell = (value) => String(value || "").trim().replace(/\|/g, "\\|").replace(/\r?\n/g, "<br>");
  function tableToMarkdown(inputRows) {
    const rows = (inputRows || []).map((row) => (row || []).map(escapeTableCell));
    if (!rows.length) return "";
    const width = Math.max(...rows.map((row) => row.length), 1);
    const line = (row) => `| ${Array.from({ length: width }, (_, index) => row[index] || "").join(" | ")} |`;
    return `${line(rows[0])}\n${line(Array(width).fill("---"))}${rows.length > 1 ? `\n${rows.slice(1).map(line).join("\n")}` : ""}`;
  }
  function listPrefix(ordered, index) { return ordered ? `${Math.max(1, Number(index) || 1)}.` : "-"; }
  function pageSlices(fullHeight, pageHeight = 14000) {
    const total = Math.max(1, Number(fullHeight) || 1), size = Math.max(1, Number(pageHeight) || 14000), pages = Math.ceil(total / size);
    return Array.from({ length: pages }, (_, index) => ({ offset: index * size, height: Math.min(size, total - index * size) }));
  }
  global.MultiAIExportCore = Object.freeze({ escapeTableCell, tableToMarkdown, listPrefix, pageSlices });
})(typeof self !== "undefined" ? self : window);
