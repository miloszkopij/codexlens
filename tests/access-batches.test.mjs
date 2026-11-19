import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import ts from "typescript";

const source = await readFile(new URL("../lib/access-batches.ts", import.meta.url), "utf8");
const compiled = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 } }).outputText;
const { splitAccessBatches, accessBatchComplete, maxAccessBatchSize } = await import(`data:text/javascript;base64,${Buffer.from(compiled).toString("base64")}`);

test("large selections are fully covered by non-overlapping server-sized batches", () => {
  const ids = Array.from({ length: 184 }, (_, index) => `member-${index}`);
  const batches = splitAccessBatches(ids);
  assert.equal(maxAccessBatchSize, 100);
  assert.deepEqual(batches.map((batch) => batch.length), [100, 84]);
  assert.deepEqual(batches.flat(), ids);
  assert.deepEqual(splitAccessBatches([...ids, ids[0]]).flat(), ids);
  assert.deepEqual(splitAccessBatches([]), []);
});

test("a batch advances only after complete verification or a no-change preview", () => {
  assert.equal(accessBatchComplete(99, null, false, false), false);
  assert.equal(accessBatchComplete(99, 98, false, false), false);
  assert.equal(accessBatchComplete(99, 99, true, false), false);
  assert.equal(accessBatchComplete(99, 99, false, true), false);
  assert.equal(accessBatchComplete(99, 99, false, false), true);
  assert.equal(accessBatchComplete(0, null, false, false), true);
});
