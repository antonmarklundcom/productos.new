import { ProductCardSkeleton } from "@/components/product-card";

export default function SearchLoading() {
  return (
    <main className="mx-auto w-full max-w-6xl px-4 py-8">
      <div className="bg-muted h-7 w-64 animate-pulse rounded" />
      <div className="mt-6 grid grid-cols-2 gap-4 lg:grid-cols-4">
        {Array.from({ length: 8 }, (_, index) => (
          <ProductCardSkeleton key={index} />
        ))}
      </div>
    </main>
  );
}
