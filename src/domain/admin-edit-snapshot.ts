export function categorySnapshot(row: {
  position?: number;
  slug: string;
  name: string;
  description: string | null;
  imageCloudinaryId: string | null;
  imageAlt: string | null;
  isActive: boolean;
}) {
  return JSON.stringify([
    row.slug,
    row.name,
    row.description,
    row.imageCloudinaryId,
    row.imageAlt,
    +row.isActive,
    row.position ?? 0,
  ]);
}
