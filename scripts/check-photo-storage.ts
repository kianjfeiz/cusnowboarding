import { config } from "dotenv";

config({ path: [".env.local", ".env"], quiet: true });

/**
 * Proves the photo bucket actually works, end to end, before a trip depends on
 * it.
 *
 * Every step the app performs is performed here in the same order: presign a
 * PUT, upload over plain HTTP the way a browser would, confirm the bytes
 * landed, presign a GET, read them back, delete. A misconfiguration usually
 * looks fine until exactly one of these fails, and the failure surfaces to a
 * member as a silent broken image on a trip page.
 *
 *   npm run storage:check
 *
 * It writes and removes one small object under `_healthcheck/`, which is
 * deliberately outside the `trips/` prefix the app uses so nothing here can
 * collide with a real photo.
 *
 * What it cannot check is browser CORS: this script is not a browser, so its
 * PUT carries no Origin header and R2 never applies a CORS rule to it. A green
 * run here plus a failing upload in the app is very likely a missing CORS
 * policy on the bucket - see README.
 */

const KEY = `_healthcheck/${Date.now()}.txt`;
const BODY = "cusnowboarding storage check";
const CONTENT_TYPE = "text/plain";

function fail(message: string, detail?: unknown): never {
  console.error(`\n  FAILED: ${message}`);
  if (detail) console.error(detail);
  process.exit(1);
}

async function main() {
  const { isPhotoStorageConfigured, presignUpload, presignRead, headObject, deleteObject } =
    await import("../src/lib/storage/r2");

  console.log("Photo storage check\n");

  const present = (name: string) => (process.env[name] ? "set" : "MISSING");
  for (const name of [
    "R2_ACCOUNT_ID",
    "R2_ACCESS_KEY_ID",
    "R2_SECRET_ACCESS_KEY",
    "R2_BUCKET",
  ]) {
    console.log(`  ${name.padEnd(22)} ${present(name)}`);
  }

  if (!isPhotoStorageConfigured()) {
    fail(
      "storage is not configured. The four variables above must all be set in .env.local.\n" +
        "  Until they are, the app degrades to a 'photos are not set up' notice rather than breaking.",
    );
  }

  console.log(`\n  bucket                 ${process.env.R2_BUCKET}`);
  console.log(`  key                    ${KEY}\n`);

  const uploadUrl = await presignUpload(KEY, CONTENT_TYPE);
  if (!uploadUrl) fail("could not presign an upload");
  console.log("  presign upload         ok");

  // Exactly what the uploader does, minus the progress reporting.
  const put = await fetch(uploadUrl, {
    method: "PUT",
    headers: { "Content-Type": CONTENT_TYPE },
    body: BODY,
  });
  if (!put.ok) {
    fail(
      `the upload was refused with ${put.status} ${put.statusText}.\n` +
        "  403 usually means the API token cannot write to this bucket;\n" +
        "  404 usually means the bucket name or account id is wrong.",
      await put.text().catch(() => undefined),
    );
  }
  console.log("  upload                 ok");

  const head = await headObject(KEY);
  if (!head) fail("the object was not found after uploading it");
  if (head.sizeBytes !== BODY.length) {
    fail(`the stored object is ${head.sizeBytes} bytes, expected ${BODY.length}`);
  }
  console.log(`  head                   ok (${head.sizeBytes} bytes, ${head.contentType})`);

  const readUrl = await presignRead(KEY);
  if (!readUrl) fail("could not presign a read");

  const get = await fetch(readUrl);
  if (!get.ok) fail(`the signed read failed with ${get.status} ${get.statusText}`);
  const body = await get.text();
  if (body !== BODY) fail("the bytes read back did not match the bytes written");
  console.log("  signed read            ok");

  /*
    The bucket must not serve this object without a signature. A public bucket
    would hand every trip photo to anyone with the URL, which is the one thing
    lib/photos.ts exists to prevent, so it is worth an explicit probe rather
    than an assumption.
  */
  const unsigned = new URL(readUrl);
  unsigned.search = "";
  const anonymous = await fetch(unsigned.toString());
  if (anonymous.ok) {
    fail(
      "the object is readable WITHOUT a signature - the bucket is public.\n" +
        "  Turn off public access. These are identifiable photos of students and the\n" +
        "  access rule is per trip roster, which a public URL cannot express.",
    );
  }
  console.log(`  private without signature  ok (${anonymous.status})`);

  if (!(await deleteObject(KEY))) fail("could not delete the test object");
  console.log("  delete                 ok");

  console.log("\n  Storage is working. Uploads from a browser also need CORS on the bucket;");
  console.log("  this script cannot test that. See README.\n");
  process.exit(0);
}

main().catch((error) => {
  fail("unexpected error", error);
});
