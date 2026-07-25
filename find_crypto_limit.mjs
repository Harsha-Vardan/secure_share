import { webcrypto } from "node:crypto";
const { subtle, getRandomValues } = webcrypto;

async function testSize(sizeMB) {
  try {
    console.log(`Testing ${sizeMB}MB...`);
    const data = new Uint8Array(sizeMB * 1024 * 1024);
    getRandomValues(data);

    const key = await subtle.generateKey({ name: "AES-GCM", length: 256 }, true, ["encrypt", "decrypt"]);
    const iv = getRandomValues(new Uint8Array(12));

    const start = performance.now();
    const ciphertext = await subtle.encrypt({ name: "AES-GCM", iv }, key, data);
    const time = performance.now() - start;

    console.log(`  ✅ ${sizeMB}MB encrypted OK in ${time.toFixed(0)}ms`);
    return true;
  } catch (err) {
    console.log(`  ❌ ${sizeMB}MB FAILED: ${err.message}`);
    return false;
  }
}

async function run() {
  for (const size of [500, 700, 900, 1024, 1200, 1400, 1600, 2048]) {
    const ok = await testSize(size);
    if (!ok) break;
  }
}
run();
