import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { transpileModule, ModuleKind, JsxEmit } from "typescript";
import { resolveDatasetSchema } from "./schemaResolution.ts";
import { schemaFixtures } from "./schemaFixtures.ts";
test("configuration UI renders registered original/canonical labels, unknowns, ambiguity and override warnings", async () => {
  const source = await readFile(new URL("../../../components/nexus/workspace/SchemaResolutionPanel.tsx", import.meta.url), "utf8");
  const js = transpileModule(source, { compilerOptions: { module: ModuleKind.ESNext, jsx: JsxEmit.ReactJSX } }).outputText
    .replace('"react/jsx-runtime"', JSON.stringify(import.meta.resolve("react/jsx-runtime")))
    .replace('"../../../lib/nexus/domains/registry"', JSON.stringify(new URL("./registry.ts", import.meta.url).href))
    .replace('"../../../lib/nexus/report/displayLabels"', JSON.stringify(new URL("../report/displayLabels.ts", import.meta.url).href));
  const { SchemaResolutionPanel } = await import(`data:text/javascript;base64,${Buffer.from(js).toString("base64")}`);
  const render = (columns: readonly string[], domainId?: string) => renderToStaticMarkup(createElement(SchemaResolutionPanel, { schema: resolveDatasetSchema(columns, domainId ? { domainId } : undefined), canApply: true, onApply: () => {} }));
  const ru = render([...schemaFixtures.mining, "Комментарий"]);
  assert.match(ru, /Предполагаемый домен: Горное производство/);
  assert.match(ru, /Добыча руды/); assert.match(ru, /ore_production/); assert.match(ru, /Комментарий/); assert.match(ru, /Не распознано/);
  assert.match(ru, /не business Evidence/); assert.doesNotMatch(ru, /confidence|уверенность.*%/i);
  assert.match(render(schemaFixtures.ambiguous), /Не удалось однозначно определить отрасль/);
  assert.match(render(schemaFixtures.mining, "retail"), /недостаточно поддержан схемой/);
});
