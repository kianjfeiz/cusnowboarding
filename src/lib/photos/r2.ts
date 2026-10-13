import type { S3Client } from "@aws-sdk/client-s3";

/**
 * Cloudflare R2, spoken to over the S3 API. Three decisions that are easy to
 * undo by accident:
 *
 * 1. Storage is optional at boot: a missing key degrades the photo pages to
 *    "not configured yet" rather than breaking anything.
 * 2. The bucket stays private and nothing here returns a public object URL.
 *    Every read is a short-lived signature minted after the caller has been
 *    authorised.
 * 3. The SDK is imported lazily, so a deployment with no bucket never pays
 *    for it.
 */

/**
 * Read URLs are signed as of the start of a fixed window rather than "now", so
 * every page load inside one window gets byte-identical URLs and the browser
 * serves repeat views from its cache instead of refetching. A URL therefore
 * lives between one and two windows: long enough to browse a gallery, short
 * enough that a leaked URL dies within half an hour.
 */
const READ_URL_WINDOW_SECONDS = 15 * 60;

/** The browser PUTs immediately after asking, so this only has to survive a slow phone. */
const UPLOAD_URL_TTL_SECONDS = 5 * 60;

export function isPhotoStorageConfigured(): boolean {
  return Boolean(
    process.env.R2_ACCOUNT_ID &&
      process.env.R2_ACCESS_KEY_ID &&
      process.env.R2_SECRET_ACCESS_KEY &&
      process.env.R2_BUCKET,
  );
}

interface Storage {
  client: S3Client;
  bucket: string;
}

let storage: Storage | null | undefined;

async function getStorage(): Promise<Storage | null> {
  if (storage !== undefined) return storage;

  if (!isPhotoStorageConfigured()) {
    storage = null;
    return storage;
  }

  const { S3Client } = await import("@aws-sdk/client-s3");

  storage = {
    bucket: process.env.R2_BUCKET!,
    client: new S3Client({
      // R2 has no regions, but the SigV4 signer insists on a value.
      region: "auto",
      // R2_ENDPOINT points at a local S3-compatible server for development and
      // load measurement; production leaves it unset and talks to R2.
      endpoint:
        process.env.R2_ENDPOINT || `https://${process.env.R2_ACCOUNT_ID}.r2.cloudflarestorage.com`,
      forcePathStyle: Boolean(process.env.R2_ENDPOINT),
      credentials: {
        accessKeyId: process.env.R2_ACCESS_KEY_ID!,
        secretAccessKey: process.env.R2_SECRET_ACCESS_KEY!,
      },
      // Recent SDK versions sign an x-amz-checksum-* header into every
      // presigned PUT. A browser's plain fetch cannot send it, so R2 rejects
      // the upload with a signature mismatch unless checksums are opt-in.
      requestChecksumCalculation: "WHEN_REQUIRED",
      responseChecksumValidation: "WHEN_REQUIRED",
    }),
  };

  return storage;
}

/**
 * A URL the browser can PUT the file to directly. Bytes never transit the
 * Next.js server: serverless request bodies are capped well below a phone photo.
 */
export async function presignUpload(
  storageKey: string,
  contentType: string,
): Promise<string | null> {
  const s = await getStorage();
  if (!s) return null;

  const [{ PutObjectCommand }, { getSignedUrl }] = await Promise.all([
    import("@aws-sdk/client-s3"),
    import("@aws-sdk/s3-request-presigner"),
  ]);

  return getSignedUrl(
    s.client,
    new PutObjectCommand({ Bucket: s.bucket, Key: storageKey, ContentType: contentType }),
    { expiresIn: UPLOAD_URL_TTL_SECONDS },
  );
}

async function signGet(storageKey: string, disposition?: string): Promise<string | null> {
  const s = await getStorage();
  if (!s) return null;

  const [{ GetObjectCommand }, { getSignedUrl }] = await Promise.all([
    import("@aws-sdk/client-s3"),
    import("@aws-sdk/s3-request-presigner"),
  ]);

  const windowMs = READ_URL_WINDOW_SECONDS * 1000;

  try {
    return await getSignedUrl(
      s.client,
      new GetObjectCommand({
        Bucket: s.bucket,
        Key: storageKey,
        ResponseContentDisposition: disposition,
        ResponseCacheControl: `private, max-age=${READ_URL_WINDOW_SECONDS}`,
      }),
      {
        expiresIn: READ_URL_WINDOW_SECONDS * 2,
        signingDate: new Date(Math.floor(Date.now() / windowMs) * windowMs),
      },
    );
  } catch {
    // One unsignable key must not take down a gallery of forty photos.
    return null;
  }
}

/** Mint this only after the caller has been authorised. */
export async function presignRead(storageKey: string): Promise<string | null> {
  return signGet(storageKey);
}

/**
 * Like `presignRead`, but the object comes back as a file to save. The
 * disposition is signed into the URL because `<a download>` is ignored on a
 * cross-origin URL.
 */
export async function presignDownload(
  storageKey: string,
  filename: string,
): Promise<string | null> {
  // Quotes and backslashes would end the filename token early, and a newline
  // would split the header. Non-ASCII is dropped rather than encoded: the name
  // is only ever cosmetic.
  const safe = filename.replace(/[^\x20-\x7e]/g, "").replace(/["\\]/g, "") || "photo";
  return signGet(storageKey, `attachment; filename="${safe}"`);
}

/**
 * What is actually in the bucket. The client tells us a size before it uploads;
 * this is how we find out whether it told the truth.
 */
export async function headObject(
  storageKey: string,
): Promise<{ sizeBytes: number; contentType: string | null } | null> {
  const s = await getStorage();
  if (!s) return null;

  const { HeadObjectCommand } = await import("@aws-sdk/client-s3");

  try {
    const result = await s.client.send(
      new HeadObjectCommand({ Bucket: s.bucket, Key: storageKey }),
    );
    return {
      sizeBytes: Number(result.ContentLength ?? 0),
      contentType: result.ContentType ?? null,
    };
  } catch {
    return null;
  }
}

/** The whole object, for server-side processing. Null when missing or unconfigured. */
export async function getObjectBytes(storageKey: string): Promise<Uint8Array | null> {
  const s = await getStorage();
  if (!s) return null;

  const { GetObjectCommand } = await import("@aws-sdk/client-s3");

  try {
    const result = await s.client.send(new GetObjectCommand({ Bucket: s.bucket, Key: storageKey }));
    return result.Body ? await result.Body.transformToByteArray() : null;
  } catch {
    return null;
  }
}

export async function putObject(
  storageKey: string,
  body: Uint8Array,
  contentType: string,
): Promise<boolean> {
  const s = await getStorage();
  if (!s) return false;

  const { PutObjectCommand } = await import("@aws-sdk/client-s3");

  try {
    await s.client.send(
      new PutObjectCommand({ Bucket: s.bucket, Key: storageKey, Body: body, ContentType: contentType }),
    );
    return true;
  } catch {
    return false;
  }
}

export async function deleteObject(storageKey: string): Promise<boolean> {
  const s = await getStorage();
  if (!s) return false;

  const { DeleteObjectCommand } = await import("@aws-sdk/client-s3");

  try {
    await s.client.send(new DeleteObjectCommand({ Bucket: s.bucket, Key: storageKey }));
    return true;
  } catch {
    return false;
  }
}
