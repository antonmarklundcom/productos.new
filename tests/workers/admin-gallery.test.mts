import { executeAdminBatch } from "../../workers/d1/admin-batch";
import assert from "node:assert/strict";
import { test } from "node:test";
import { readFileSync, readdirSync } from "node:fs";
import { getPlatformProxy } from "wrangler";
import type { AnyD1Database } from "drizzle-orm/d1";
import { drizzle } from "drizzle-orm/d1";
import { writeD1SupplierOffer } from "../../workers/d1/supplier-costs";
import { categoryGuard } from "../../workers/d1/admin-categories";
import { categorySnapshot } from "../../src/domain/admin-edit-snapshot";
import { writeD1CatalogBatch } from "../../workers/d1/catalog-import-write";
import { storeGalleryFiles } from "../../workers/d1/gallery-write";
import { formatRef, parseRef } from "../../src/lib/imagenes-r2";
import {
  mutationImageBase,
  mutateGallery,
} from "../../workers/d1/gallery-mutations";
import { writeD1SettingsSection } from "../../workers/d1/store-settings-write";
import { DEFAULT_STORE_SETTINGS } from "../../src/domain/store-settings-schema";
import * as schema from "../../workers/d1/schema";
test("deterministic product and category upload names satisfy the actual p1 reference protocol", () => {
  const operation = "12345678-1234-4234-8234-123456789abc";
  for (const prefix of ["synthetic-visible", "categoria-1", "a".repeat(160)]) {
    const base = mutationImageBase(prefix, 1, operation),
      ref = formatRef(base, 640, 480);
    assert.ok(ref);
    assert.equal(parseRef(ref)?.base, base);
    assert.match(base, /-[a-f0-9]{10}-[a-f0-9]{10}$/);
    assert.equal(mutationImageBase(prefix, 1, operation), base);
    assert.notEqual(mutationImageBase(prefix, 2, operation), base);
  }
});
test(
  "gallery receipts, ordering, alt, undo and settings stale guards commit atomically",
  { timeout: 120000 },
  async () => {
    const platform = await getPlatformProxy<{ DB: AnyD1Database }>({
      configPath: "workers/d1/local-settings-test.wrangler.jsonc",
      persist: false,
    });
    try {
      const db = platform.env.DB;
      for (const name of readdirSync("workers/d1/migrations")
        .filter((name) => name.endsWith(".sql"))
        .sort())
        for (const statement of readFileSync(
          "workers/d1/migrations/" + name,
          "utf8"
        ).split("--> statement-breakpoint"))
          if (statement.trim()) await db.prepare(statement).run();
      await db
        .prepare(
          "CREATE TABLE IF NOT EXISTS admin_mutation_receipts(id TEXT PRIMARY KEY,actor_id INTEGER NOT NULL,product_id INTEGER,fingerprint TEXT NOT NULL,result_json TEXT NOT NULL,kind TEXT NOT NULL,created_at TEXT DEFAULT CURRENT_TIMESTAMP)"
        )
        .run();
      await db
        .prepare(
          "CREATE TABLE IF NOT EXISTS gallery_tombstones(id TEXT PRIMARY KEY,actor_id INTEGER NOT NULL,product_id INTEGER NOT NULL,image_id INTEGER NOT NULL,cloudinary_id TEXT NOT NULL,alt TEXT,position INTEGER NOT NULL,expires_at TEXT,restored_at TEXT)"
        )
        .run();
      await db
        .prepare(
          "INSERT INTO categories(id,slug,name) VALUES(1,'gallery','Gallery')"
        )
        .run();
      await db
        .prepare(
          "INSERT INTO products(id,slug,name,category_id,sale_mode,revision) VALUES(1,'gallery','Gallery',1,'enquiry',1)"
        )
        .run();
      const objects = new Set<string>(),
        bucket = {
          put: async (key: string) => {
            objects.add(key);
          },
          delete: async (keys: string[]) => {
            keys.forEach((key) => objects.delete(key));
          },
          head: async (key: string) => (objects.has(key) ? {} : null),
        };
      const files = [
          {
            key: "fixture.webp",
            bytes: new Uint8Array([1, 2, 3]),
            mime: "image/webp",
          },
        ],
        operationId = "11111111-1111-4111-8111-111111111111";
      const lost = {
        prepare: db.prepare.bind(db),
        batch: async (statements: Parameters<typeof db.batch>[0]) => {
          await db.batch(statements);
          throw new Error("LOST_ACK");
        },
      } as AnyD1Database;
      assert.equal(
        (
          await storeGalleryFiles(
            lost,
            bucket,
            1,
            "fixture-ref",
            "Original",
            files,
            1,
            { operationId, expectedRevision: 1 }
          )
        ).revision,
        2
      );
      await storeGalleryFiles(
        db,
        bucket,
        1,
        "fixture-ref",
        "Original",
        files,
        1,
        { operationId, expectedRevision: 1 }
      );
      assert.equal(
        await db
          .prepare("SELECT COUNT(*) FROM product_images")
          .first("COUNT(*)"),
        1
      );
      await assert.rejects(
        storeGalleryFiles(db, bucket, 1, "fixture-ref", "Changed", files, 1, {
          operationId,
          expectedRevision: 1,
        }),
        /otro usuario o borrador/
      );
      await assert.rejects(
        storeGalleryFiles(db, bucket, 1, "fixture-ref", "Original", files, 2, {
          operationId,
          expectedRevision: 1,
        }),
        /otro usuario o borrador/
      );
      let puts = 0;
      const interruptedBucket = {
        ...bucket,
        put: async () => {
          puts++;
          throw new Error("R2_LOST_ACK");
        },
      };
      const pendingId = "77777777-7777-4777-8777-777777777777";
      await assert.rejects(
        storeGalleryFiles(
          db,
          interruptedBucket,
          1,
          "pending-ref",
          "Pending",
          files,
          1,
          { operationId: pendingId, expectedRevision: 2 }
        ),
        /R2_LOST_ACK/
      );
      await assert.rejects(
        storeGalleryFiles(
          db,
          interruptedBucket,
          1,
          "pending-ref",
          "Changed pending",
          files,
          1,
          { operationId: pendingId, expectedRevision: 2 }
        ),
        /otro usuario o borrador/
      );
      assert.equal(puts, 1);
      const image = await db
        .prepare("SELECT id FROM product_images")
        .first<number>("id");
      assert.ok(image);
      await mutateGallery(db, 1, {
        kind: "alt",
        productId: 1,
        imageId: image,
        alt: "Corregida",
        expectedRevision: 2,
        operationId: "22222222-2222-4222-8222-222222222222",
      });
      await assert.rejects(
        mutateGallery(db, 2, {
          kind: "alt",
          productId: 1,
          imageId: image,
          alt: "Vieja",
          expectedRevision: 2,
          operationId: "33333333-3333-4333-8333-333333333333",
        }),
        /borrador sigue aquí/
      );
      await db
        .prepare(
          "INSERT INTO product_images(id,product_id,cloudinary_id,alt,position) VALUES(99,1,'second','Segunda',1)"
        )
        .run();
      await mutateGallery(db, 1, {
        kind: "reorder",
        productId: 1,
        imageIds: [99, image],
        expectedRevision: 3,
        operationId: "44444444-4444-4444-8444-444444444444",
      });
      assert.equal(
        await db
          .prepare("SELECT id FROM product_images ORDER BY position LIMIT 1")
          .first("id"),
        99
      );
      const removed = await mutateGallery(db, 1, {
        kind: "remove",
        productId: 1,
        imageId: 99,
        expectedRevision: 4,
        operationId: "55555555-5555-4555-8555-555555555555",
      });
      assert.ok(removed.tombstoneId);
      const restore = {
        kind: "restore" as const,
        productId: 1,
        tombstoneId: removed.tombstoneId,
        expectedRevision: 5,
        operationId: "66666666-6666-4666-8666-666666666666",
      };
      await assert.rejects(mutateGallery(db, 2, restore), /ya se usó o venció/);
      await mutateGallery(db, 1, restore);
      await mutateGallery(db, 1, restore);
      assert.equal(
        await db
          .prepare("SELECT id FROM product_images ORDER BY position LIMIT 1")
          .first("id"),
        99
      );
      assert.equal(
        await db
          .prepare("SELECT alt FROM product_images WHERE id=?")
          .bind(image)
          .first("alt"),
        "Corregida"
      );
      assert.ok(objects.has("fixture.webp"));
      const native = drizzle(db, { schema });
      const baseline = JSON.stringify(DEFAULT_STORE_SETTINGS.anuncio);
      const updated = await writeD1SettingsSection(
        native,
        "anuncio",
        { ...DEFAULT_STORE_SETTINGS.anuncio, texto: "Primero" },
        { userId: 1, expectedSnapshot: baseline }
      );
      await assert.rejects(
        writeD1SettingsSection(
          native,
          "anuncio",
          { ...DEFAULT_STORE_SETTINGS.anuncio, texto: "Perdedor" },
          { userId: 2, expectedSnapshot: baseline }
        ),
        /borrador sigue aquí/
      );
      assert.equal(updated.anuncio.texto, "Primero");
      const mediaRead = await writeD1SettingsSection(
        native,
        "marca",
        {
          ...DEFAULT_STORE_SETTINGS.marca,
          heroTitulo: "Título anterior",
          heroImagenId: "kept-image",
        },
        {
          userId: 1,
          expectedSnapshot: JSON.stringify(DEFAULT_STORE_SETTINGS.marca),
        }
      );
      const newerBrand = await writeD1SettingsSection(
        native,
        "marca",
        { ...mediaRead.marca, heroTitulo: "Título más reciente" },
        { userId: 2, expectedSnapshot: JSON.stringify(mediaRead.marca) }
      );
      await assert.rejects(
        writeD1SettingsSection(
          native,
          "marca",
          { ...mediaRead.marca, heroImagenId: null },
          { userId: 1, expectedSnapshot: JSON.stringify(mediaRead.marca) }
        ),
        /borrador sigue aquí/
      );
      const afterConflict = await db
        .prepare("SELECT data FROM store_settings WHERE id=1")
        .first<string>("data");
      assert.ok(afterConflict);
      const retainedBrand = JSON.parse(afterConflict).marca;
      assert.equal(retainedBrand.heroTitulo, "Título más reciente");
      assert.equal(retainedBrand.heroImagenId, "kept-image");
      const removedMedia = await writeD1SettingsSection(
        native,
        "marca",
        { ...newerBrand.marca, heroImagenId: null },
        { userId: 1, expectedSnapshot: JSON.stringify(newerBrand.marca) }
      );
      assert.equal(removedMedia.marca.heroImagenId, null);
      assert.equal(removedMedia.marca.heroTitulo, "Título más reciente");

      const token = categorySnapshot({
        slug: "gallery",
        name: "Gallery",
        description: null,
        imageCloudinaryId: null,
        imageAlt: null,
        isActive: true,
      });
      await executeAdminBatch(native, [
        categoryGuard(native, 1, token),
        native.run(
          (await import("drizzle-orm"))
            .sql`UPDATE categories SET name='New category' WHERE id=1`
        ),
      ]);
      await assert.rejects(
        executeAdminBatch(native, [
          categoryGuard(native, 1, token),
          native.run(
            (await import("drizzle-orm"))
              .sql`UPDATE categories SET name='Lost category' WHERE id=1`
          ),
        ])
      );
      assert.equal(
        await db
          .prepare("SELECT name FROM categories WHERE id=1")
          .first("name"),
        "New category"
      );
      await db
        .prepare(
          "INSERT INTO variants(id,product_id,sku,label,price_pyg,is_active) VALUES(1,1,'PRIVATE-1','Only',10000,0)"
        )
        .run();
      const rev = await db
        .prepare("SELECT revision FROM products WHERE id=1")
        .first<number>("revision");
      assert.ok(rev);
      const offer = {
        source: "Private",
        sourceType: "other" as const,
        unitCostPyg: 3000,
        productUrl: null,
        supplierUrl: null,
        supplierStock: null,
        notes: null,
        isConfirmed: true,
        isActive: true,
        isPreferred: true,
        checkedAt: null,
      };
      await writeD1SupplierOffer(native, 1, 1, 1, undefined, offer, rev);
      await assert.rejects(
        writeD1SupplierOffer(
          native,
          2,
          1,
          1,
          undefined,
          { ...offer, unitCostPyg: 99 },
          rev
        ),
        /borrador sigue aquí/
      );
      assert.equal(
        await db
          .prepare("SELECT COUNT(*) FROM supplier_offers")
          .first("COUNT(*)"),
        1
      );
      await db
        .prepare("UPDATE products SET is_active=0,published_at=NULL WHERE id=1")
        .run();
      const imported = {
        slug: "gallery",
        name: "Reimport",
        description: null,
        categoryName: "New category",
        brand: null,
        ivaRate: 10 as const,
        saleMode: "enquiry" as const,
        showPrice: false,
        dropiUrl:
          "https://app.dropi.com.py/dashboard/product-details/123/fixture",
        fotos: [],
        variants: [
          {
            sku: "PRIVATE-1",
            label: "Only",
            pricePyg: 11000,
            compareAtPyg: null,
            onHand: 0,
            unitCostPyg: 4500,
            costSource: "New source",
          },
        ],
      };
      await writeD1CatalogBatch(db, [imported]);
      assert.equal(
        await db
          .prepare("SELECT is_active FROM products WHERE id=1")
          .first("is_active"),
        0
      );
      assert.equal(
        await db
          .prepare("SELECT published_at FROM products WHERE id=1")
          .first("published_at"),
        null
      );
      assert.equal(
        await db
          .prepare("SELECT is_active FROM variants WHERE id=1")
          .first("is_active"),
        0
      );
      assert.equal(
        await db
          .prepare("SELECT source_type FROM supplier_offers")
          .first("source_type"),
        "dropi"
      );
      assert.equal(
        await db
          .prepare("SELECT product_url FROM supplier_offers")
          .first("product_url"),
        "https://app.dropi.com.py/dashboard/product-details/123/fixture"
      );
      const originalUrl = imported.dropiUrl;
      const costOnly = {
        ...imported,
        dropiUrl: undefined,
        variants: imported.variants.map((variant) => ({
          ...variant,
          unitCostPyg: 4700,
          costSource: "Cost refresh only",
        })),
      };
      await writeD1CatalogBatch(db, [costOnly]);
      assert.equal(
        await db
          .prepare("SELECT product_url FROM supplier_offers")
          .first("product_url"),
        originalUrl
      );
      assert.equal(
        await db
          .prepare("SELECT source_type FROM supplier_offers")
          .first("source_type"),
        "dropi"
      );
      assert.equal(
        await db
          .prepare("SELECT unit_cost_pyg FROM supplier_offers")
          .first("unit_cost_pyg"),
        4700
      );
      assert.equal(
        await db
          .prepare("SELECT dropi_url FROM products WHERE id=1")
          .first("dropi_url"),
        originalUrl
      );
      const changedUrl =
        "https://app.dropi.com.py/dashboard/product-details/456/updated-fixture";
      await writeD1CatalogBatch(db, [{ ...costOnly, dropiUrl: changedUrl }]);
      assert.equal(
        await db
          .prepare("SELECT product_url FROM supplier_offers")
          .first("product_url"),
        changedUrl
      );
      assert.equal(
        await db
          .prepare("SELECT source_type FROM supplier_offers")
          .first("source_type"),
        "dropi"
      );
      assert.equal(
        await db
          .prepare("SELECT dropi_url FROM products WHERE id=1")
          .first("dropi_url"),
        changedUrl
      );
      await writeD1CatalogBatch(db, [{ ...costOnly, dropiUrl: null }]);
      assert.equal(
        await db
          .prepare("SELECT product_url FROM supplier_offers")
          .first("product_url"),
        null
      );
      assert.equal(
        await db
          .prepare("SELECT source_type FROM supplier_offers")
          .first("source_type"),
        "other"
      );
      assert.equal(
        await db
          .prepare("SELECT dropi_url FROM products WHERE id=1")
          .first("dropi_url"),
        null
      );
      await writeD1CatalogBatch(
        db,
        [imported],
        false,
        undefined,
        undefined,
        true
      );
      assert.equal(
        await db
          .prepare("SELECT is_active FROM products WHERE id=1")
          .first("is_active"),
        1
      );
      assert.ok(
        await db
          .prepare("SELECT published_at FROM products WHERE id=1")
          .first("published_at")
      );
      assert.equal(
        await db
          .prepare("SELECT is_active FROM variants WHERE id=1")
          .first("is_active"),
        1
      );
    } finally {
      await platform.dispose();
    }
  }
);
