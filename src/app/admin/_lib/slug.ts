function slugify(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80);
}

function isSlugCollision(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    error.code === "23505" &&
    "constraint" in error &&
    typeof error.constraint === "string" &&
    error.constraint.endsWith("_slug_unique")
  );
}

/**
 * Inserts under a slug made from the title, trying -2, -3 and so on while it
 * collides. Null when the title has no letters or digits to make one from.
 * A slug is fixed once created - members hold links to it - so nothing edits it.
 */
export async function insertWithFreeSlug<T>(
  title: string,
  insert: (slug: string) => Promise<T>,
): Promise<{ slug: string; result: T } | null> {
  const base = slugify(title);
  if (!base) return null;

  for (let n = 1; n <= 50; n++) {
    const suffix = n === 1 ? "" : `-${n}`;
    const slug = base.slice(0, 80 - suffix.length).replace(/-+$/, "") + suffix;
    try {
      return { slug, result: await insert(slug) };
    } catch (error) {
      if (!isSlugCollision(error)) throw error;
    }
  }
  throw new Error(`No free URL slug for "${title}".`);
}
