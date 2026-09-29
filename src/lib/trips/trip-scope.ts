// Legacy: nothing sets trips.archived_at any more (trips are deleted instead); this only keeps rows archived in the past hidden.
export const NOT_ARCHIVED = "t.archived_at is null";
