import { config } from "dotenv";

config({ path: [".env.local", ".env"], quiet: true });

/**
 * `npm run storage:check` - proves the photo bucket works end to end, in the
 * order the app uses it: presign a PUT, upload the way a browser would, confirm
 * the bytes landed, presign a GET, read them back, delete. The one object it
 * writes lives under `_healthcheck/`, outside the prefixes the app uses.
 *
 * It cannot check browser CORS: its PUT carries no Origin header. A green run
 * plus a failing upload in the app is very likely a missing CORS policy on the
 * bucket - see README.
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
    await import("../src/lib/photos/r2");

  console.log("Photo storage check\n");

  for (const name of ["R2_ACCOUNT_ID", "R2_ACCESS_KEY_ID", "R2_SECRET_ACCESS_KEY", "R2_BUCKET"]) {
    console.log(`  ${name.padEnd(22)} ${process.env[name] ? "set" : "MISSING"}`);
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

  // A public bucket would hand every photo to anyone with the URL, so probe
  // for it rather than assume.
  const unsigned = new URL(readUrl);
  unsigned.search = "";
  const anonymous = await fetch(unsigned.toString());
  if (anonymous.ok) {
    fail(
      "the object is readable WITHOUT a signature - the bucket is public.\n" +
        "  Turn off public access. These are identifiable photos of students, and\n" +
        "  the galleries are for signed-in members only.",
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
