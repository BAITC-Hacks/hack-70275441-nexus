import type { Content, TDocumentDefinitions, TFontDictionary } from "pdfmake/interfaces";
import type { InvestigationReportModel } from "./reportModel";
import { reportFileName } from "./reportModel";
import { statusLabel } from "./displayLabels";

const FONTS: TFontDictionary = {
  Roboto: {
    normal: "Roboto-Regular.ttf",
    bold: "Roboto-Medium.ttf",
    italics: "Roboto-Italic.ttf",
    bolditalics: "Roboto-MediumItalic.ttf",
  },
};

function section(number: number, title: string, body: Content): Content[] {
  return [{ text: `${number}. ${title}`, style: "sectionHeading" }, body];
}

/**
 * The bundled Roboto TTF pdfmake embeds for the PDF renderer (unrelated to the on-screen web font, which
 * is unaffected) has two known display-layer defects, verified empirically against this exact font build:
 *
 * 1. It has no glyph for the ↔ arrow the on-screen UI uses for evidence variable pairs — it renders as a
 *    missing-glyph box. Fixed by swapping it for the ASCII "<->" before layout.
 * 2. Ordinary English words containing "fi"/"fl" (e.g. "significant", "cash_flow") render visually fine —
 *    PDFKit's font shaper substitutes the correct ligature glyph — but that glyph's ToUnicode mapping is
 *    lost, so the PDF's text layer silently drops the missing letter (copy/paste, search, and screen
 *    readers all see "signifcant", "cash_fow" — confirmed by extracting the generated PDF's text layer).
 *    A zero-width joiner to block the substitution was tried first and made it worse (that joiner has no
 *    glyph in this subset either, so it showed as a visible box and corrupted the following word spacing).
 *    The fix that actually works, verified against this exact renderer: split the string into separate
 *    text runs at the "f" that would start the ligature, so the shaper never sees "fi"/"fl" as one
 *    contiguous run to substitute. Visually identical output; the text layer stays correct.
 *
 * Both are display-only fixes scoped to this PDF renderer — the live UI, the EvidenceRecord, and every
 * other string in the app are untouched.
 */
function ligatureSafeRuns(text: string): string | string[] {
  const runs = text.split(/(f)(?=[fil])/g).filter((run) => run.length > 0);
  return runs.length > 1 ? runs : text;
}
const arrowSafe = (text: string) => text.replaceAll(" ↔ ", " <-> ").replaceAll(" → ", " -> ");
/** For a `text:` leaf. */
const pdfText = (text: string) => ligatureSafeRuns(arrowSafe(text));
/** For a plain-string list item inside `ul`/`ol`, which need an object to carry a run array. */
const pdfListItem = (text: string): Content => ({ text: pdfText(text) });

function buildDocDefinition(report: InvestigationReportModel): TDocumentDefinitions {
  const content: Content[] = [
    { text: "NEXUS", style: "brand" },
    { text: "Autonomous Risk Investigation System", style: "brandSub" },
    { text: "ОТЧЁТ ПО РАССЛЕДОВАНИЮ", style: "title" },
    { text: [`Сформирован: ${new Date(report.generatedAt).toLocaleString("ru-RU")} · Набор данных: `, pdfText(report.datasetName)].flat(), style: "meta" },

    ...section(1, "Цель расследования", {
      text: report.objective ? pdfText(report.objective) : "Цель не указана — NEXUS провёл описательное исследование без заявленной гипотезы.",
      style: "body",
    }),

    ...section(2, "Краткий итог", [
      { text: pdfText(report.headline), style: "body" },
      { text: pdfText(report.whyItMatters), style: "body", margin: [0, 6, 0, 0] },
    ]),

    ...section(3, "Выявленные сигналы", report.findings.length
      ? { ul: report.findings.map(pdfListItem), style: "body" }
      : { text: "Отдельных сигналов, требующих внимания, не выявлено.", style: "body" }),

    ...section(4, "Цепочка риска", report.riskChainSteps.length
      ? { ol: report.riskChainSteps.map(pdfListItem), style: "chainBody" }
      : { text: "Недостаточно данных для построения цепочки риска.", style: "body" }),

    ...section(5, "Кандидатская гипотеза", [
      { text: pdfText(report.hypothesis.primary), style: "body" },
      report.hypothesis.alternative ? { text: ["Альтернативное объяснение: ", pdfText(report.hypothesis.alternative)].flat(), style: "body", margin: [0, 6, 0, 0] } : null,
    ].filter(Boolean) as Content[]),

    ...section(6, "Критическая проверка (Skeptic)", [
      { text: `Результат проверки: ${statusLabel(report.skeptic.status)}${report.skeptic.revised ? " — гипотеза была пересмотрена по итогам проверки." : ""}`, style: "body" },
      { text: pdfText(report.skeptic.challenge), style: "body", margin: [0, 6, 0, 0] },
      report.skeptic.alternatives.length ? { text: "Проверенные альтернативные объяснения:", style: "body", margin: [0, 8, 0, 2] } : null,
      report.skeptic.alternatives.length ? { ul: report.skeptic.alternatives.map(pdfListItem), style: "body" } : null,
      { text: "Причинно-следственная связь не установлена (CAUSALITY: NOT ESTABLISHED).", style: "disclaimer", margin: [0, 8, 0, 0] },
    ].filter(Boolean) as Content[]),

    ...section(7, "Доказательства", report.evidence.length
      ? report.evidence.map((item) => ({
          stack: [
            { text: `${item.id}`, style: "evidenceId" },
            { text: pdfText(item.variableLabel), style: "evidenceLabel" },
            { text: pdfText(item.resultSummary), style: "body" },
            { text: `Tool: ${item.tool}()`, style: "evidenceTool" },
          ],
          margin: [0, 0, 0, 10] as [number, number, number, number],
        }))
      : { text: "Доказательства не были собраны в ходе расследования.", style: "body" }),

    ...section(8, "Рекомендованные следующие шаги", report.nextSteps.length
      ? { ol: report.nextSteps.map(pdfListItem), style: "body" }
      : { text: "Дополнительные шаги не сформированы.", style: "body" }),

    ...section(9, "Ограничения", report.limitations.length
      ? { ul: report.limitations.map(pdfListItem), style: "body" }
      : { text: "Отдельные ограничения не заявлены сверх методологической оговорки ниже.", style: "body" }),

    ...section(10, "Методологическая оговорка", { text: pdfText(report.methodologyNote), style: "disclaimer" }),
  ];

  return {
    info: { title: "NEXUS — отчёт по расследованию" },
    pageMargins: [40, 50, 40, 50],
    defaultStyle: { font: "Roboto", fontSize: 10, lineHeight: 1.35 },
    content,
    styles: {
      brand: { fontSize: 20, bold: true, margin: [0, 0, 0, 0] },
      brandSub: { fontSize: 9, color: "#5B6478", margin: [0, 2, 0, 14] },
      title: { fontSize: 14, bold: true, margin: [0, 0, 0, 2] },
      meta: { fontSize: 8.5, color: "#5B6478", margin: [0, 0, 0, 18] },
      sectionHeading: { fontSize: 12, bold: true, color: "#2563EB", margin: [0, 16, 0, 6] },
      body: { fontSize: 10, color: "#151923" },
      chainBody: { fontSize: 11, bold: true, color: "#151923" },
      disclaimer: { fontSize: 9, italics: true, color: "#5B6478" },
      evidenceId: { fontSize: 9, bold: true, color: "#2563EB" },
      evidenceLabel: { fontSize: 10, bold: true, margin: [0, 1, 0, 2] },
      evidenceTool: { fontSize: 8, color: "#5B6478", margin: [0, 2, 0, 0] },
    },
  };
}

/**
 * Renders the report client-side and triggers a browser download. Uses only what `buildInvestigationReportModel`
 * already assembled from the finished investigation — no network call, no LLM call, no recomputation.
 */
export async function downloadInvestigationReportPdf(report: InvestigationReportModel): Promise<void> {
  const [{ default: pdfMake }, vfsModule] = await Promise.all([
    import("pdfmake/build/pdfmake"),
    import("pdfmake/build/vfs_fonts"),
  ]);
  // pdfmake@0.2.23's vfs_fonts build exports the font-name → base64 map as its default export
  // (not a nested `.vfs` property, despite what @types/pdfmake@0.2.11 declares) — confirmed empirically.
  const vfs = vfsModule.default as unknown as Record<string, string>;
  const pdf = pdfMake.createPdf(buildDocDefinition(report), undefined, FONTS, vfs);
  await new Promise<void>((resolve) => pdf.download(reportFileName(report.generatedAt), () => resolve()));
}
