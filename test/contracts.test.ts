import test from "node:test";
import assert from "node:assert/strict";
import { parseAndValidateSize, QualitySchema, validateCount, validateQuality } from "../src/contracts.js";
import { sanitizeErrorText, classifyApiError } from "../src/errors.js";

test("accepts documented aligned image sizes", () => {
  assert.deepEqual(parseAndValidateSize("2048x1152"), {
    width: 2048,
    height: 1152,
    normalized: "2048x1152",
    pixels: 2_359_296,
  });
  assert.equal(parseAndValidateSize("2160x3840").normalized, "2160x3840");
});
test("rejects every local size boundary before network access", () => {
  for (const size of ["1920x1080", "128x128", "4096x2160", "3840x1024", "3840x3840"]) {
    assert.throws(() => parseAndValidateSize(size), /Invalid size/);
  }
});

test("high resolution requests force one image", () => {
  assert.throws(() => validateCount(2, parseAndValidateSize("2048x1152")), /require n=1/);
  assert.doesNotThrow(() => validateCount(4, parseAndValidateSize("1024x1024")));
});

test("validates quality by model family", () => {
  assert.doesNotThrow(() => validateQuality("gpt-image-2", "high"));
  assert.equal(QualitySchema.safeParse("max").success, false);
  assert.doesNotThrow(() => validateQuality("gpt-image-2.5-flare", "low"));
  assert.throws(() => validateQuality("gpt-image-2.5-flare", "max"), /only quality low/);
  assert.throws(() => validateQuality("gpt-image-2.5-sunburst", "high"), /only quality low/);
});

test("sanitizes secrets and classifies actionable API errors", () => {
  const key = "sk-secret-value";
  const raw = `Authorization: Bearer ${key}; ${"A".repeat(256)}`;
  const clean = sanitizeErrorText(raw, [key]);
  assert.doesNotMatch(clean, /sk-secret-value/);
  assert.doesNotMatch(clean, /A{128}/);

  const detail = classifyApiError(400, "Invalid quality: supports only 'low'. (request id: req-123)");
  assert.equal(detail.code, "invalid_quality");
  assert.equal(detail.requestId, "req-123");
  assert.match(detail.suggestedChanges[0], /quality='low'/);
});
