"use strict";

(function initializeShippingPdf(root, factory) {
  const api = factory(root);
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  if (root) root.ShippingPdf = api;
})(typeof globalThis !== "undefined" ? globalThis : this, (root) => {
  const A4_LANDSCAPE = [841.89, 595.28];
  const MM_TO_PT = 72 / 25.4;
  const PAGE_MARGIN = 10 * MM_TO_PT;
  const STAMP_WIDTH = 22 * MM_TO_PT;
  const STAMP_BODY_HEIGHT = 14 * MM_TO_PT;
  const TABLE_FONT_SIZE = 6.8;
  const TABLE_LINE_HEIGHT = 8.5;
  const CELL_PADDING = 1.6 * MM_TO_PT;
  const TABLE_BORDER_WIDTH = 0.5;
  const COLUMN_RATIOS = [0.035, 0.045, 0.11, 0.10, 0.085, 0.20, 0.13, 0.105, 0.045, 0.145];
  const DEFAULT_HEADERS = ["No.", "確認欄", "施設名", "部署名", "商品コード", "商品名", "規格", "製品番号", "数量", "ラベルキー"];
  const APPROVAL_COLUMN_RATIOS = [0.05, 0.12, 0.20, 0.16, 0.12, 0.13, 0.12, 0.10];
  const APPROVAL_HEADERS = ["No.", "商品コード", "商品名", "規格", "製品番号", "ラベルキー", "ラベル日付", "対応"];
  const cachedFontBytesByUrl = new Map();
  let cachedInlineFontBytes = null;

  function textValue(value) {
    return value === null || value === undefined ? "" : String(value);
  }

  function sanitizeFilenamePart(value) {
    return textValue(value)
      .replace(/[\\/:*?"<>|\u0000-\u001F]/g, "_")
      .replace(/\s+/g, " ")
      .trim()
      .slice(0, 50) || "未設定";
  }

  function buildPdfFilename(report) {
    const dateKey = textValue(report.fileDate).replace(/\D/g, "").slice(0, 8) || "日付未設定";
    return `SPD出荷_未読取ラベル一覧_${sanitizeFilenamePart(report.scope)}_${dateKey}.pdf`;
  }

  function wrapText(text, font, size, maxWidth) {
    const source = textValue(text).replace(/\r\n?/g, "\n");
    const result = [];
    source.split("\n").forEach((paragraph) => {
      if (!paragraph) {
        result.push("");
        return;
      }
      let line = "";
      for (const character of paragraph) {
        const candidate = line + character;
        if (line && font.widthOfTextAtSize(candidate, size) > maxWidth) {
          result.push(line);
          line = character;
        } else {
          line = candidate;
        }
      }
      result.push(line);
    });
    return result.length ? result : [""];
  }

  function fitSingleLine(text, font, initialSize, maxWidth, minimumSize = 6) {
    let size = initialSize;
    const value = textValue(text);
    while (size > minimumSize && font.widthOfTextAtSize(value, size) > maxWidth) size -= 0.25;
    return { text: value, size };
  }

  function drawBoldText(page, text, options) {
    page.drawText(textValue(text), options);
    page.drawText(textValue(text), { ...options, x: options.x + 0.18 });
  }

  function drawFittedText(page, text, font, options) {
    const fitted = fitSingleLine(text, font, options.size, options.maxWidth, options.minimumSize);
    page.drawText(fitted.text, { x: options.x, y: options.y, size: fitted.size, font, color: options.color });
  }

  function drawSummaryPair(page, font, colors, label, value, x, y, width) {
    const labelWidth = 56;
    drawBoldText(page, label, { x, y, size: 9, font, color: colors.black });
    drawFittedText(page, value, font, { x: x + labelWidth, y, size: 9, minimumSize: 6.5, maxWidth: width - labelWidth, color: colors.black });
  }

  function drawFirstPageHeader(page, font, report, pdfLib) {
    const { width, height } = page.getSize();
    const black = pdfLib.rgb(0, 0, 0);
    let y = height - PAGE_MARGIN - 17;
    drawBoldText(page, report.title, { x: PAGE_MARGIN, y, size: 17, font, color: black });
    y -= 24;
    // 範囲名や複数の予定日も折り返し、切り捨てない。
    for (const value of [`出荷予定日（払出予定伝票日付）：${report.plannedDates}`,
      `印刷日時：${report.printedAt}`, `印刷対象範囲：${report.scope}`,
      `対象期間：${report.period}　未読取ラベル総件数：${report.rows.length}件`]) {
      for (const line of wrapText(value, font, 9, width - PAGE_MARGIN * 2)) {
        page.drawText(line, { x: PAGE_MARGIN, y, size: 9, font, color: black });
        y -= 13;
      }
    }
    return y - 5;
  }

  function columnLayout(pageWidth, ratios = COLUMN_RATIOS) {
    const tableWidth = pageWidth - PAGE_MARGIN * 2;
    const widths = ratios.map((ratio) => tableWidth * ratio);
    const positions = [];
    let x = PAGE_MARGIN;
    widths.forEach((width) => {
      positions.push(x);
      x += width;
    });
    return { tableWidth, widths, positions };
  }

  function fontForText(value, fonts) {
    return /^[\x00-\x7F]*$/.test(textValue(value)) ? fonts.latin : fonts.japanese;
  }

  function prepareCellLines(values, fonts, layout, size = TABLE_FONT_SIZE) {
    return values.map((value, index) => {
      const font = fontForText(value, fonts);
      return { font, lines: wrapText(value, font, size, Math.max(1, layout.widths[index] - CELL_PADDING * 2)) };
    });
  }

  function rowHeightForLines(cells) {
    return Math.max(...cells.map((cell) => cell.lines.length), 1) * TABLE_LINE_HEIGHT + CELL_PADDING * 2;
  }

  function drawTableRow(page, topY, values, fonts, layout, pdfLib, options = {}) {
    const cells = prepareCellLines(values, fonts, layout);
    const rowHeight = rowHeightForLines(cells);
    const fill = options.header ? pdfLib.rgb(0.933, 0.933, 0.933) : undefined;
    const black = pdfLib.rgb(0, 0, 0);
    values.forEach((value, columnIndex) => {
      const x = layout.positions[columnIndex];
      const width = layout.widths[columnIndex];
      page.drawRectangle({
        x,
        y: topY - rowHeight,
        width,
        height: rowHeight,
        color: fill,
        borderColor: pdfLib.rgb(0.33, 0.33, 0.33),
        borderWidth: TABLE_BORDER_WIDTH
      });
      cells[columnIndex].lines.forEach((line, lineIndex) => {
        const textOptions = {
          x: x + CELL_PADDING,
          y: topY - CELL_PADDING - TABLE_FONT_SIZE - lineIndex * TABLE_LINE_HEIGHT,
          size: TABLE_FONT_SIZE,
          font: cells[columnIndex].font,
          color: black
        };
        if (options.header) drawBoldText(page, line, textOptions);
        else page.drawText(line, textOptions);
      });
    });
    return rowHeight;
  }

  function normalizeReport(report) {
    const normalized = {
      title: textValue(report.title) || "SPD出荷 未読取ラベル一覧",
      scope: textValue(report.scope),
      period: textValue(report.period),
      plannedDates: textValue(report.plannedDates),
      facilityName: textValue(report.facilityName),
      departmentName: textValue(report.departmentName),
      endDate: textValue(report.endDate),
      printedAt: textValue(report.printedAt),
      countSummary: textValue(report.countSummary),
      reportType: textValue(report.reportType),
      confirmedBy: textValue(report.confirmedBy),
      confirmedAt: textValue(report.confirmedAt),
      tableTitle: textValue(report.tableTitle),
      emptyMessage: textValue(report.emptyMessage),
      fileDate: textValue(report.fileDate),
      fileScopeParts: Array.isArray(report.fileScopeParts) ? report.fileScopeParts.map(textValue).filter(Boolean) : [],
      headers: (report.headers || DEFAULT_HEADERS).map(textValue),
      columnRatios: (report.columnRatios || COLUMN_RATIOS).map(Number),
      rows: (report.rows || []).map((row) => (report.headers || DEFAULT_HEADERS).map((_, index) => textValue(row?.[index])))
    };
    normalized.sections = Array.isArray(report.sections) ? report.sections.map(normalizeReport) : [];
    return normalized;
  }

  function decodeBase64Font(base64) {
    if (cachedInlineFontBytes) return cachedInlineFontBytes;
    try {
      const binary = root.atob
        ? root.atob(base64)
        : typeof Buffer !== "undefined"
          ? Buffer.from(base64, "base64").toString("binary")
          : "";
      if (!binary) throw new Error("Base64を復号できません。");
      const bytes = new Uint8Array(binary.length);
      for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index);
      cachedInlineFontBytes = bytes;
      return bytes;
    } catch (error) {
      console.error("[SPD出荷チェッカー PDF] 同梱日本語フォントの復号に失敗しました。", error);
      throw new Error("PDF用日本語フォントを準備できませんでした。");
    }
  }

  async function fetchFontBytes(url, label, options) {
    const fetchRef = options.fetchRef || root.fetch?.bind(root);
    if (!fetchRef) throw new Error(`${label}を読み込む機能がありません。`);
    if (!cachedFontBytesByUrl.has(url)) {
      const request = (async () => {
        console.info(`[SPD出荷チェッカー PDF] ${label}の取得を開始します。`, { url });
        let response;
        try {
          response = await fetchRef(url, { cache: "force-cache" });
        } catch (error) {
          console.error(`[SPD出荷チェッカー PDF] ${label}の取得に失敗しました。`, { url, error });
          throw new Error(`${label}を読み込めませんでした（通信失敗 / ${url}）。`);
        }
        const contentType = response.headers?.get?.("content-type") || "";
        console.info(`[SPD出荷チェッカー PDF] ${label}のHTTP応答を受信しました。`, {
          url, status: response.status, ok: response.ok, contentType
        });
        if (!response.ok) throw new Error(`${label}を読み込めませんでした（HTTP ${response.status} / ${url}）。`);
        if (/text\/html/i.test(contentType)) throw new Error(`${label}の代わりにHTMLが返されました（${url}）。`);
        const bytes = await response.arrayBuffer();
        if (!bytes?.byteLength) throw new Error(`${label}が0バイトです（${url}）。`);
        console.info(`[SPD出荷チェッカー PDF] ${label}の取得に成功しました。`, { url, bytes: bytes.byteLength, contentType });
        return bytes;
      })().catch((error) => {
        cachedFontBytesByUrl.delete(url);
        throw error;
      });
      cachedFontBytesByUrl.set(url, request);
    }
    return cachedFontBytesByUrl.get(url);
  }

  async function loadPrimaryFontBytes(options) {
    if (options.fontBytes) return options.fontBytes;
    const inlineBase64 = options.inlineFontBase64 || root.InventoryPdfFontData?.base64;
    if (inlineBase64) return decodeBase64Font(inlineBase64);
    const fontUrl = options.fontUrl || "./vendor/NotoSansCJKjp-PdfCommon.ttf";
    return fetchFontBytes(fontUrl, "PDF用日本語フォント", options);
  }

  function collectReportCodePoints(value, codePoints = new Set()) {
    if (Array.isArray(value)) value.forEach((item) => collectReportCodePoints(item, codePoints));
    else if (value && typeof value === "object") Object.values(value).forEach((item) => collectReportCodePoints(item, codePoints));
    else if (value !== null && value !== undefined) {
      for (const character of String(value)) codePoints.add(character.codePointAt(0));
    }
    return codePoints;
  }

  function findMissingCodePoints(fontkitRef, fontBytes, report) {
    const parsedFont = fontkitRef.create(fontBytes instanceof Uint8Array ? fontBytes : new Uint8Array(fontBytes));
    return [...collectReportCodePoints(report)].filter((codePoint) => !parsedFont.hasGlyphForCodePoint(codePoint));
  }

  function canDisplayText(font, value) {
    return [...value].every((character) => character === "\n" || font.hasGlyphForCodePoint(character.codePointAt(0)));
  }

  function replaceUnsupportedText(value, font, substitutions) {
    const aliases = { "≒": "約", "≈": "約", "≤": "<=", "≥": ">=", "±": "+/-" };
    let output = "";
    for (const character of textValue(value).replace(/\r\n?/g, "\n").replace(/\t/g, "    ")) {
      if (canDisplayText(font, character)) { output += character; continue; }
      const codePoint = character.codePointAt(0);
      const normalized = character.normalize("NFKC");
      const candidates = [aliases[character], normalized !== character ? normalized : "", "[U+" + codePoint.toString(16).toUpperCase() + "]", "?"];
      const replacement = candidates.find((candidate) => candidate && canDisplayText(font, candidate));
      if (!replacement) throw new Error("PDF用フォントで代替文字も表示できません。フォント資材を再読み込みしてください。");
      const previous = substitutions.get(codePoint);
      substitutions.set(codePoint, { codePoint, replacement, count: (previous?.count || 0) + 1 });
      output += replacement;
    }
    return output;
  }

  function prepareReportText(report, font, substitutions) {
    // PDF専用コピーだけを更新する。マスター・画面・履歴は変更しない。
    for (const [key, value] of Object.entries(report)) {
      if (typeof value === "string") report[key] = replaceUnsupportedText(value, font, substitutions);
    }
    report.headers = report.headers.map((value) => replaceUnsupportedText(value, font, substitutions));
    report.rows = report.rows.map((row) => row.map((value) => replaceUnsupportedText(value, font, substitutions)));
    report.sections.forEach((section) => prepareReportText(section, font, substitutions));
  }

  async function chooseCompatibleFontBytes(fontkitRef, report, options) {
    const primaryBytes = await loadPrimaryFontBytes(options);
    // 改行はレイアウト命令であり、フォントの収録文字から除外する。
    const missing = findMissingCodePoints(fontkitRef, primaryBytes, report).filter((point) => ![9, 10, 13].includes(point));
    if (!missing.length) return primaryBytes;
    // 完全フォントで原文を優先。取得失敗時も同梱フォントと代替文字で続行する。
    try {
      return options.fallbackFontBytes
        || await fetchFontBytes(options.fallbackFontUrl || "./vendor/NotoSansCJKjp-Regular.ttf", "PDF用日本語完全フォント", options);
    } catch (error) {
      console.warn("[SPD出荷チェッカー PDF] 完全フォントを取得できないため、同梱フォントと代替文字で出力します。", error);
      return primaryBytes;
    }
  }

  function validateReportLayout(report) {
    if (!report.headers.length || report.headers.length !== report.columnRatios.length || Math.abs(report.columnRatios.reduce((sum, value) => sum + value, 0) - 1) > 0.001) {
      throw new Error("PDF一覧の列数または列幅が正しくありません。");
    }
  }

  function drawReportSection(pdfDoc, report, fonts, pdfLib) {
    validateReportLayout(report);
    const [pageWidth, pageHeight] = A4_LANDSCAPE;
    const layout = columnLayout(pageWidth, report.columnRatios);
    let page = pdfDoc.addPage(A4_LANDSCAPE);
    let currentY = drawFirstPageHeader(page, fonts.japanese, report, pdfLib);
    if (report.tableTitle) {
      drawBoldText(page, report.tableTitle, { x: PAGE_MARGIN, y: currentY - 2, size: 11, font: fonts.japanese, color: pdfLib.rgb(0, 0, 0) });
      currentY -= 20;
    }
    const headerHeight = drawTableRow(page, currentY, report.headers, fonts, layout, pdfLib, { header: true });
    currentY -= headerHeight;

    report.rows.forEach((row) => {
      const lines = prepareCellLines(row, fonts, layout);
      const rowHeight = rowHeightForLines(lines);
      const maximumRowHeight = pageHeight - PAGE_MARGIN * 2 - headerHeight - 55;
      if (rowHeight > maximumRowHeight) throw new Error("1件の文字量が多すぎるためPDFへ配置できません。商品名や規格を確認してください。");
      if (currentY - rowHeight < PAGE_MARGIN + 55) {
        page = pdfDoc.addPage(A4_LANDSCAPE);
        currentY = pageHeight - PAGE_MARGIN;
        currentY -= drawTableRow(page, currentY, report.headers, fonts, layout, pdfLib, { header: true });
      }
      currentY -= drawTableRow(page, currentY, row, fonts, layout, pdfLib);
    });
    // 最終ページ下部の手書き欄を確保し、表の行と重ならないよう全ページで余白を予約する。
    page.drawText("積込最終確認者：________________　　確認時刻：______時______分", {
      x: PAGE_MARGIN, y: PAGE_MARGIN + 22, size: 11, font: fonts.japanese, color: pdfLib.rgb(0, 0, 0)
    });
    if (!report.rows.length && report.emptyMessage) {
      drawBoldText(page, report.emptyMessage, { x: PAGE_MARGIN, y: currentY - 22, size: 11, font: fonts.japanese, color: pdfLib.rgb(0, 0, 0) });
    }
  }

  async function generateShippingPdf(inputReport, options = {}) {
    const pdfLib = options.pdfLib || root.PDFLib;
    const fontkitRef = options.fontkit || root.fontkit;
    if (!pdfLib?.PDFDocument || !pdfLib?.rgb) throw new Error("PDF生成ライブラリを読み込めません。");
    if (!fontkitRef) throw new Error("日本語フォント処理ライブラリを読み込めません。");
    const report = normalizeReport(inputReport || {});
    const fontBytes = await chooseCompatibleFontBytes(fontkitRef, report, options);
    const parsedFont = fontkitRef.create(fontBytes instanceof Uint8Array ? fontBytes : new Uint8Array(fontBytes));
    const substitutions = new Map();
    prepareReportText(report, parsedFont, substitutions);
    const sections = report.sections.length ? report.sections : [report];
    const pdfDoc = await pdfLib.PDFDocument.create();
    pdfDoc.registerFontkit(fontkitRef);
    // iOS標準PDFビューアとの互換性を優先し、通常のcmapを持つ事前サブセットTTFを完全埋込みする。
    // pdf-fontkitによる動的CJKサブセットは使わない。
    const font = await pdfDoc.embedFont(fontBytes, { subset: false });
    const fonts = { japanese: font, latin: await pdfDoc.embedFont(pdfLib.StandardFonts.Helvetica) };
    pdfDoc.setTitle(report.title);
    pdfDoc.setSubject(report.reportType === "departmentApproval" ? "SPD出荷チェッカー 部署確認記録" : "SPD出荷チェッカー 未読取ラベル帳票");
    pdfDoc.setCreator("SPD出荷チェッカー / pdf-lib 1.17.1");
    pdfDoc.setProducer("SPD出荷チェッカー");

    sections.forEach((section) => drawReportSection(pdfDoc, section, fonts, pdfLib));

    if (substitutions.size) {
      const page = pdfDoc.getPages().at(-1);
      page.drawText("※一部の文字をPDF表示用に置換しています。原文はラベルマスタで確認してください。", {
        x: PAGE_MARGIN, y: PAGE_MARGIN + 6, size: 7, font });
    }
    pdfDoc.getPages().forEach((page, index, pages) => {
      const label = `${index + 1} / ${pages.length} ページ`;
      page.drawText(label, { x: (page.getWidth() - font.widthOfTextAtSize(label, 8)) / 2,
        y: PAGE_MARGIN - 10, size: 8, font });
    });
    const bytes = await pdfDoc.save();
    return { bytes, fileName: buildPdfFilename(report), pageCount: pdfDoc.getPageCount(), substitutions: [...substitutions.values()] };
  }

  return {
    A4_LANDSCAPE,
    DEFAULT_HEADERS,
    COLUMN_RATIOS,
    APPROVAL_HEADERS,
    APPROVAL_COLUMN_RATIOS,
    sanitizeFilenamePart,
    buildPdfFilename,
    wrapText,
    generateShippingPdf
  };
});
