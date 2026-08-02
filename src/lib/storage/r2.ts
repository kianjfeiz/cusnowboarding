import type { S3Client } from "@aws-sdk/client-s3";

/**
 * Cloudflare R2, spoken to over the S3 API.
 *
 * Three decisions worth stating, because each is easy to undo by accident:
 *
 * 1. Storage is optional at boot. The club may run a
 *    season before anyone provisions a bucket, and a missing key must degrade
 *    the photo pages to "not configured yet" rather than break the trip pages
 *    sitting next to them.
 *
 * 2. The bucket stays private and nothing here ever returns a public object
 *    URL. A public URL is permanent and cannot be scoped to a trip roster,
 *    which is the entire access rule for these photos. Every read is a fresh,
 *    short-lived signature minted only after the caller has been authorised.
 *
 * 3. The SDK is imported lazily. It is a large dependency that a deployment
 *    with no bucket never needs, so importing photo code costs nothing until
 *    someone actually uploads.
 */

/** Long enough to load a gallery and open a few photos, short enough that a leaked URL dies fast. */
export const READ_URL_TTL_SECONDS = 15 * 60;

/** The browser PUTs immediately after asking, so this only has to survive a slow phone. */
export const UPLOAD_URL_TTL_SECONDS = 5 * 60;

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
      endpoint: `https://${process.env.R2_ACCOUNT_ID}.r2.cloudflarestorage.com`,
      credentials: {
        accessKeyId: process.env.R2_ACCESS_KEY_ID!,
        secretAccessKey: process.env.R2_SECRET_ACCESS_KEY!,
      },
      /**
       * Recent SDK versions add an x-amz-checksum-* header to every PUT. A
       * presigned URL signs that header, but a browser doing a plain fetch PUT
       * cannot send it, so R2 rejects the upload with a signature mismatch.
       * Asking for checksums only when a command requires them keeps the
       * presigned upload a signature a browser can actually satisfy.
       */
      requestChecksumCalculation: "WHEN_REQUIRED",
      responseChecksumValidation: "WHEN_REQUIRED",
    }),
  };

  return storage;
}

/**
 * A URL the browser can PUT the file to directly.
 *
 * Bytes never transit the Next.js server: serverless request bodies are size
 * capped well below a modern phone photo, and streaming 25MB through a function
 * would be slow and expensive even where it fits.
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

/** Mint this only after the caller has been checked against the trip roster. */
export async function presignRead(
  storageKey: string,
  expiresIn: number = READ_URL_TTL_SECONDS,
): Promise<string | null> {
  const s = await getStorage();
  if (!s) return null;

  const [{ GetObjectCommand }, { getSignedUrl }] = await Promise.all([
    import("@aws-sdk/client-s3"),
    import("@aws-sdk/s3-request-presigner"),
  ]);

  try {
    return await getSignedUrl(
      s.client,
      new GetObjectCommand({ Bucket: s.bucket, Key: storageKey }),
      { expiresIn },
    );
  } catch {
    // One unsignable key must not take down a gallery of forty photos.
    return null;
  }
}

/**
 * Like `presignRead`, but the object comes back as a file to save rather than
 * something to render.
 *
 * The disposition is signed into the URL rather than set by the browser,
 * because `<a download>` is ignored on a cross-origin URL - the attribute only
 * works same-origin. Asking R2 to send `Content-Disposition: attachment` is
 * what actually makes the browser save it, and it means the bytes still travel
 * R2 to browser without passing through this app, exactly like uploads.
 */
export async function presignDownload(
  storageKey: string,
  filename: string,
  expiresIn: number = READ_URL_TTL_SECONDS,
): Promise<string | null> {
  const s = await getStorage();
  if (!s) return null;

  const [{ GetObjectCommand }, { getSignedUrl }] = await Promise.all([
    import("@aws-sdk/client-s3"),
    import("@aws-sdk/s3-request-presigner"),
  ]);

  // Quotes and backslashes would end the filename token early; a header split
  // on a newline is worse. Anything outside plain ASCII is dropped rather than
  // encoded, and `filename*` is deliberately not used - the fallback name is
  // only ever cosmetic.
  const safe = filename.replace(/[^\x20-\x7e]/g, "").replace(/["\\]/g, "") || "photo";

  try {
    return await getSignedUrl(
      s.client,
      new GetObjectCommand({
        Bucket: s.bucket,
        Key: storageKey,
        ResponseContentDisposition: `attachment; filename="${safe}"`,
      }),
      { expiresIn },
    );
  } catch {
    return null;
  }
}

export interface StoredObject {
  sizeBytes: number;
  contentType: string | null;
}

/**
 * What is actually in the bucket. The client tells us a size before it uploads;
 * this is how we find out whether it told the truth.
 */
export async function headObject(storageKey: string): Promise<StoredObject | null> {
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
