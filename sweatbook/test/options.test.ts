import { test } from "node:test";
import assert from "node:assert/strict";
import { parsePublicUrl, parseUrlSettings } from "../src/options.ts";
import { fetchHaExternalUrl } from "../src/auth/ha-url.ts";

test("options: public URLs are normalised; credentials, query, fragment and other schemes are refused", () => {
  assert.equal(parsePublicUrl("https://ha.example.test/"), "https://ha.example.test");
  assert.equal(parsePublicUrl(" https://ha.example.test:8443 "), "https://ha.example.test:8443");
  for (const bad of ["ftp://x.test", "https://u:p@x.test", "https://x.test/?a=1", "https://x.test/#a", "nope", "", 3]) {
    assert.equal(parsePublicUrl(bad), null, String(bad));
  }
});

test("options: environment beats the options file, unusable values are reported", () => {
  const s = parseUrlSettings({ app_external_url: "https://a.test/", ha_external_url: "nope" }, { APP_EXTERNAL_URL: "https://b.test" });
  assert.equal(s.appExternalUrl, "https://b.test");
  assert.equal(s.haExternalUrl, null);
  assert.deepEqual(s.invalid, ["ha_external_url"]);
  assert.deepEqual(parseUrlSettings({ app_external_url: "", ha_external_url: "" }), { appExternalUrl: null, haExternalUrl: null, invalid: [] });
});

test("ha url: read from Home Assistant's config through the Supervisor, null when unset or unreachable", async () => {
  const answer = (body: unknown, status = 200) => (async () => new Response(JSON.stringify(body), { status })) as typeof fetch;
  let seen: string | null = null;
  const spy = (async (_url: string, init: RequestInit) => {
    seen = new Headers(init.headers).get("authorization");
    return new Response(JSON.stringify({ external_url: "https://ha.example.test/" }));
  }) as unknown as typeof fetch;
  assert.equal(await fetchHaExternalUrl({ token: "sv", fetchFn: spy }), "https://ha.example.test");
  assert.equal(seen, "Bearer sv");
  assert.equal(await fetchHaExternalUrl({ token: "sv", fetchFn: answer({ external_url: null }) }), null);
  assert.equal(await fetchHaExternalUrl({ token: "sv", fetchFn: answer({}, 401) }), null);
  const failing = (async () => {
    throw new TypeError("fetch failed");
  }) as typeof fetch;
  assert.equal(await fetchHaExternalUrl({ token: "sv", fetchFn: failing }), null);
  assert.equal(await fetchHaExternalUrl({ fetchFn: spy }), null);
});
