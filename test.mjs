import assert from "node:assert/strict";
import { parseCsv, normalizeRecord, colorForNetWorth } from "./utils.js";

let passed = 0;
function test(name, fn) {
  try {
    fn();
    passed++;
    console.log(`  ok  - ${name}`);
  } catch (err) {
    console.error(`FAIL - ${name}`);
    console.error(`       ${err.message}`);
    process.exitCode = 1;
  }
}

console.log("parseCsv");
test("splits a simple row into a header-keyed object", () => {
  const rows = parseCsv("Name,Age\nAlice,30\n");
  assert.deepEqual(rows, [{ name: "Alice", age: "30" }]);
});

test("handles quoted fields containing commas (e.g. formatted currency)", () => {
  const rows = parseCsv('Name,Net Worth\nBob,"$251,260.80"\n');
  assert.deepEqual(rows, [{ name: "Bob", "net worth": "$251,260.80" }]);
});

test("handles escaped double-quotes inside a quoted field", () => {
  const rows = parseCsv('Name,Note\nCarol,"She said ""hi"""\n');
  assert.equal(rows[0].note, 'She said "hi"');
});

test("trims header whitespace and lowercases it (e.g. ' Net Worth ')", () => {
  const rows = parseCsv(" Name , Net Worth \nDan,100\n");
  assert.deepEqual(Object.keys(rows[0]), ["name", "net worth"]);
});

test("skips blank trailing lines", () => {
  const rows = parseCsv("Name,Age\nEve,25\n\n\n");
  assert.equal(rows.length, 1);
});

test("returns an empty array for an empty/header-only input", () => {
  assert.deepEqual(parseCsv(""), []);
  assert.deepEqual(parseCsv("Name,Age\n"), []);
});

console.log("normalizeRecord");
test("parses a formatted currency string into a numeric netWorth", () => {
  const record = normalizeRecord({ name: "Alice", "net worth": "$251,260.80" });
  assert.equal(record.netWorth, 251260.8);
  assert.equal(record.netWorthDisplay, "$251,260.80");
});

test("defaults netWorth to 0 when the field is missing", () => {
  const record = normalizeRecord({ name: "Bob" });
  assert.equal(record.netWorth, 0);
});

test("carries every display field through unchanged", () => {
  const record = normalizeRecord({
    name: "Carol",
    photo: "http://example.com/p.jpg",
    age: "30",
    country: "MY",
    interest: "Cooking",
    "net worth": "$100.00",
  });
  assert.equal(record.photo, "http://example.com/p.jpg");
  assert.equal(record.age, "30");
  assert.equal(record.country, "MY");
  assert.equal(record.interest, "Cooking");
});

console.log("colorForNetWorth (Red < $100K, Orange $100K-$200K, Green > $200K)");
test("under $100,000 is red", () => {
  assert.equal(colorForNetWorth(0), "#e53935");
  assert.equal(colorForNetWorth(99999.99), "#e53935");
});

test("$100,000 up to just under $200,000 is orange", () => {
  assert.equal(colorForNetWorth(100000), "#fb8c00");
  assert.equal(colorForNetWorth(199999.99), "#fb8c00");
});

test("$200,000 and above is green", () => {
  assert.equal(colorForNetWorth(200000), "#43a047");
  assert.equal(colorForNetWorth(1000000), "#43a047");
});

console.log(`\n${passed} test(s) passed${process.exitCode ? ", some FAILED (see above)" : "."}`);
