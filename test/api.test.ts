import test from "node:test";
import assert from "node:assert/strict";
import { MockAgent } from "undici";
import { ZyApiClient } from "../src/zy-api.js";

const tinyPng = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Y9ZlKAAAAAASUVORK5CYII=",
  "base64",
);

test("generation sends the strict zy-api payload and decodes b64_json", async (t) => {
  const mock = new MockAgent();
  mock.disableNetConnect();
  t.after(() => mock.close());
  const pool = mock.get("http://api.test");
  const expectedBody = JSON.stringify({
    model: "gpt-image-2.5-flare",
    prompt: "a precise test image",
    size: "1024x1024",
    n: 1,
    quality: "low",
    output_format: "png",
    response_format: "b64_json",
  });
  pool.intercept({
    path: "/images/generations",
    method: "POST",
    headers: { authorization: "Bearer test-key" },
    body: expectedBody,
  }).reply(200, { data: [{ b64_json: tinyPng.toString("base64") }] });

  const client = new ZyApiClient({ baseUrl: "http://api.test", apiKey: "test-key", timeoutMs: 5_000, dispatcher: mock });
  const images = await client.generate({
    model: "gpt-image-2.5-flare",
    prompt: "a precise test image",
    size: "1024x1024",
    n: 1,
    quality: "low",
    outputFormat: "png",
  });
  assert.equal(images.length, 1);
  assert.deepEqual(images[0].bytes, tinyPng);
  mock.assertNoPendingInterceptors();
});

test("multipart edit uses authorization without placing the key in output", async (t) => {
  const mock = new MockAgent();
  mock.disableNetConnect();
  t.after(() => mock.close());
  const pool = mock.get("http://api.test");
  let encodedBody = "";
  pool.intercept({
    path: "/images/edits",
    method: "POST",
    headers(headers) {
      return headers.authorization === "Bearer body-secret"
        && String(headers["content-type"]).startsWith("multipart/form-data; boundary=");
    },
  }).reply((options) => {
    encodedBody = Buffer.isBuffer(options.body)
      ? options.body.toString("latin1")
      : String(options.body);
    return { statusCode: 200, data: { data: [{ b64_json: tinyPng.toString("base64") }] } };
  });

  const client = new ZyApiClient({ baseUrl: "http://api.test", apiKey: "body-secret", timeoutMs: 5_000, dispatcher: mock });
  const output = await client.edit({
    model: "gpt-image-2.5-sunburst",
    prompt: "combine image one and two",
    size: "1024x1024",
    quality: "low",
    outputFormat: "png",
    images: [
      { bytes: tinyPng, mimeType: "image/png", filename: "one.png" },
      { bytes: tinyPng, mimeType: "image/png", filename: "two.png" },
    ],
  });
  assert.equal(output.length, 1);
  assert.doesNotMatch(encodedBody, /body-secret/);
  mock.assertNoPendingInterceptors();
});
