import { test } from "node:test";
import assert from "node:assert/strict";
import { csvRows } from "./csv.ts";

test("a comma-delimited file with a quoted field containing the delimiter does not shift later columns", () => {
  const text = 'name,amount,note\n"Иванов, Иван Иванович",1500,"ok"\n';
  assert.deepEqual(csvRows(text), [
    ["name", "amount", "note"],
    ["Иванов, Иван Иванович", "1500", "ok"],
  ]);
});

test("a semicolon-delimited file (detected from the header row) is unaffected by commas inside quotes", () => {
  const text = 'name;amount;note\n"Иванов, Иван Иванович";1500;"ok"\n';
  assert.deepEqual(csvRows(text), [
    ["name", "amount", "note"],
    ["Иванов, Иван Иванович", "1500", "ok"],
  ]);
});

test("delimiter detection ignores quoted commas in a semicolon header", () => {
  assert.deepEqual(csvRows('"Last, First";amount\n"Doe, Jane";5'), [
    ["Last, First", "amount"],
    ["Doe, Jane", "5"],
  ]);
});

test("delimiter detection ignores quoted semicolons and escaped quotes in a comma header", () => {
  assert.deepEqual(csvRows('"Last; First; Jr",amount\r\n"Doe; ""Jane""",5\r\n'), [
    ["Last; First; Jr", "amount"],
    ['Doe; "Jane"', "5"],
  ]);
});

test("delimiter detection uses the first logical record when a quoted header contains a newline", () => {
  assert.deepEqual(csvRows('"Last,\n First";amount\r\n"Doe, Jane";\r\n'), [
    ["Last,\n First", "amount"],
    ["Doe, Jane", ""],
  ]);
});

test("a quoted field may contain an embedded newline and still stays one cell", () => {
  const text = 'id,note,amount\n1,"line one\nline two",42\n';
  assert.deepEqual(csvRows(text), [
    ["id", "note", "amount"],
    ["1", "line one\nline two", "42"],
  ]);
});

test("a doubled quote inside a quoted field is one literal quote character", () => {
  const text = 'id,note\n1,"she said ""hi"""\n';
  assert.deepEqual(csvRows(text), [
    ["id", "note"],
    ["1", 'she said "hi"'],
  ]);
});

test("a leading UTF-8 BOM is stripped and plain unquoted cells are trimmed, matching prior behavior", () => {
  const text = "﻿id, name \n1, Alpha \n2, Beta \n";
  assert.deepEqual(csvRows(text), [
    ["id", "name"],
    ["1", "Alpha"],
    ["2", "Beta"],
  ]);
});
