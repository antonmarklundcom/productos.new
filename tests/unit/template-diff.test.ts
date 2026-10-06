import { describe, expect, it } from "vitest";

import { esMixto, maquinariaFaltante } from "../../scripts/template-shared";
import {
  BASELINE_FILE,
  clasificar,
  contenidoBaseline,
  MAQUINARIA,
  MIXTOS,
  parseArgs,
  parseBaseline,
  parseCommits,
} from "../../scripts/template-diff";

/**
 * `pnpm template:diff` (NEW-STORE.md).
 *
 * Los repos hechos con "Use this template" no comparten historia con el
 * original, así que todo el comando se apoya en el SHA guardado en
 * `.template-baseline`. Si ese archivo se lee mal —y "mal" incluye leer basura
 * como si fuera un SHA— el comando o miente diciendo que está todo al día, o
 * lista la historia entera y se vuelve inusable. Eso es lo que se fija acá.
 */

describe("parseArgs", () => {
  it("por defecto mira template/main sin marcar nada", () => {
    expect(parseArgs([])).toEqual({
      remoto: "template",
      rama: "main",
      marcar: false,
      origen: false,
      forzar: false,
    });
  });

  it("acepta otro remoto y otra rama", () => {
    expect(parseArgs(["--remoto", "upstream", "--rama", "produccion"])).toEqual(
      {
        remoto: "upstream",
        rama: "produccion",
        marcar: false,
        origen: false,
        forzar: false,
      }
    );
  });

  it("--marcar es un flag suelto", () => {
    expect(parseArgs(["--marcar"]).marcar).toBe(true);
  });

  it("--origen marca el commit del que salió la tienda, no la punta", () => {
    expect(parseArgs(["--marcar", "--origen"])).toMatchObject({
      marcar: true,
      origen: true,
    });
  });

  it("--forzar marca aunque falte maquinaria (el default es negarse)", () => {
    expect(parseArgs(["--marcar"]).forzar).toBe(false);
    expect(parseArgs(["--marcar", "--forzar"])).toMatchObject({
      marcar: true,
      forzar: true,
    });
  });

  it("una opción desconocida o sin valor no se ignora", () => {
    // `--remoto --marcar` tomaría "--marcar" como nombre de remoto y fallaría
    // después, con un error de git que no dice nada.
    expect(() => parseArgs(["--remto", "x"])).toThrow(/no conozco/);
    expect(() => parseArgs(["--remoto"])).toThrow(/espera un valor/);
    expect(() => parseArgs(["--remoto", "--marcar"])).toThrow(
      /espera un valor/
    );
  });
});

describe("parseBaseline", () => {
  it("lee el SHA salteando comentarios y espacios", () => {
    expect(parseBaseline(contenidoBaseline("abc1234def5678"))).toBe(
      "abc1234def5678"
    );
    expect(parseBaseline("\n\n  # nota\n  4c31eeb  \n")).toBe("4c31eeb");
  });

  it("lo que no es un SHA es null, no un SHA inventado", () => {
    // Devolver basura acá terminaría en `git log basura..template/main`, que
    // falla con un error de git incomprensible. Null cae al camino de "todavía
    // no hay baseline", que explica qué hacer.
    for (const basura of [
      "",
      "# sólo comentarios\n",
      "HEAD",
      "no-es-un-sha",
      "zzzz123",
    ]) {
      expect(parseBaseline(basura), JSON.stringify(basura)).toBeNull();
    }
  });

  it("el archivo que escribe es el que sabe leer", () => {
    // Ida y vuelta: si alguien cambia el formato de un lado, este test cae.
    const sha = "e5f81f9333ab91ba452e32546567e62ecf68a384";
    expect(parseBaseline(contenidoBaseline(sha))).toBe(sha);
    expect(contenidoBaseline(sha)).toContain("#");
    expect(BASELINE_FILE).toBe(".template-baseline");
  });
});

describe("parseCommits", () => {
  it("parte cada línea en sha y asunto", () => {
    expect(
      parseCommits("4c31eeb Runbook del deploy\nc48b403 Toolchain fijada\n")
    ).toEqual([
      { sha: "4c31eeb", asunto: "Runbook del deploy" },
      { sha: "c48b403", asunto: "Toolchain fijada" },
    ]);
  });

  it("la salida vacía de git es cero commits, no uno vacío", () => {
    // `git log a..b` sin nada devuelve "" — leerlo como un commit haría que el
    // comando diga "1 commit pendiente" para siempre.
    expect(parseCommits("")).toEqual([]);
    expect(parseCommits("\n  \n")).toEqual([]);
  });

  it("un asunto con espacios no se corta", () => {
    const [commit] = parseCommits(
      "abc1234 Pagos sin pedido vivo: las dos acciones"
    );
    expect(commit?.asunto).toBe("Pagos sin pedido vivo: las dos acciones");
  });
});

describe("clasificar", () => {
  const commits = [
    { sha: "aaa1111", asunto: "Arreglo de stock" },
    { sha: "bbb2222", asunto: "Nueva foto en la home" },
  ];

  it("marca los que tocan la maquinaria", () => {
    expect(clasificar(commits, ["aaa1111"])).toEqual([
      {
        sha: "aaa1111",
        asunto: "Arreglo de stock",
        maquinaria: true,
        mixto: false,
      },
      {
        sha: "bbb2222",
        asunto: "Nueva foto en la home",
        maquinaria: false,
        mixto: false,
      },
    ]);
  });

  it("sin maquinaria tocada, ninguno queda marcado", () => {
    expect(clasificar(commits, []).every((commit) => !commit.maquinaria)).toBe(
      true
    );
  });

  it("los mixtos se marcan aparte, y la maquinaria le gana al mixto", () => {
    // El `~` es "leé el diff", el `*` es "cherry-pickealo". Un commit que toca
    // las dos cosas ya está cubierto por el `*`; marcarlo también como mixto
    // haría que el mismo commit se explique dos veces con consejos distintos.
    const [soloMixto, ambos] = clasificar(
      [
        { sha: "ccc3333", asunto: "Checkout: campos y validación" },
        { sha: "ddd4444", asunto: "Cotización de envío, form y action" },
      ],
      ["ddd4444"],
      ["ccc3333", "ddd4444"]
    );

    expect(soloMixto).toEqual({
      sha: "ccc3333",
      asunto: "Checkout: campos y validación",
      maquinaria: false,
      mixto: true,
    });
    expect(ambos?.maquinaria).toBe(true);
    expect(ambos?.mixto).toBe(false);
  });

  it("la lista de maquinaria es la de NEW-STORE.md", () => {
    // Si mañana se agrega una carpeta de dominio y no entra acá, los arreglos
    // de esa carpeta van a salir listados como si fueran piel.
    expect(MAQUINARIA).toContain("src/domain");
    expect(MAQUINARIA).toContain("src/lib");
    expect(MAQUINARIA).toContain("src/db");
    expect(MAQUINARIA).toContain("src/app/api");
    expect(MAQUINARIA).toContain("drizzle");
  });

  it("las server actions son maquinaria: ahí está el camino de la plata", () => {
    // El bug que esto fija: sin `src/app/actions`, `pnpm template:diff` no
    // miraba el archivo que crea pedidos y cobra. En una tienda real listó 29
    // archivos de maquinaria con diferencias y ninguno era una action, mientras
    // `checkout.ts` difería del template y `shipping-quote.ts` faltaba.
    //
    // Y con `--marcar` era peor: el listado por commits filtra con la misma
    // lista, así que un commit del template que SÓLO tocara server actions no
    // se le mostraba nunca a ninguna tienda.
    expect(MAQUINARIA).toContain("src/app/actions");
  });

  it("los archivos de plata de src/app/actions caen adentro de la maquinaria", () => {
    // Prefijos, no nombres: lo que se le pasa a `git log -- <ruta>` es la
    // carpeta. Este test es el que cae si alguien la saca o la escribe mal
    // ("src/actions", "app/actions"), que compilaría igual porque es un string.
    const plata = [
      "src/app/actions/checkout.ts",
      "src/app/actions/shipping-quote.ts",
      "src/app/actions/cart.ts",
      "src/app/actions/admin-payments.ts",
      "src/app/actions/receipt.ts",
      "src/app/actions/order-lookup.ts",
    ];

    for (const archivo of plata) {
      expect(
        MAQUINARIA.some((ruta) => archivo.startsWith(`${ruta}/`)),
        archivo
      ).toBe(true);
    }
  });

  it("/admin es mixto, pero sus actions siguen siendo maquinaria", () => {
    // NEW-STORE.md §5 llama a "/admin completo" maquinaria, y en el fondo tiene
    // razón, pero son páginas: la tienda que le cambió el logo o los colores al
    // panel las vería listadas para siempre. Va como mixto.
    //
    // Lo que no se negocia es la plata: las actions de admin están en
    // MAQUINARIA y tienen que seguir ahí, no acá.
    expect(MIXTOS).toContain("src/app/admin");
    expect(MAQUINARIA).not.toContain("src/app/admin");

    for (const accion of [
      "src/app/actions/admin-payments.ts",
      "src/app/actions/admin-orders.ts",
    ]) {
      expect(
        MAQUINARIA.some((ruta) => accion.startsWith(`${ruta}/`)),
        accion
      ).toBe(true);
      expect(
        MIXTOS.some((ruta) => accion.startsWith(`${ruta}/`)),
        accion
      ).toBe(false);
    }
  });

  it("ninguna ruta está en las dos listas a la vez", () => {
    // Estar en las dos haría que el mismo commit se explique con `*` y con `~`.
    // `clasificar` ya le da prioridad a la maquinaria, pero la lista igual sería
    // una contradicción sobre qué es cada carpeta.
    for (const ruta of MIXTOS) {
      expect(MAQUINARIA, ruta).not.toContain(ruta);
    }
  });

  it("checkout-form.tsx se avisa como mixto, no como maquinaria", () => {
    // Es markup que cada tienda rediseña, así que en MAQUINARIA iba a diferir
    // siempre y el ruido apagaría la señal del `*`. Pero tiene lógica
    // compartida adentro, así que callarlo del todo deja sin aviso el día que
    // esa lógica cambia. Va en la lista de al lado.
    expect(esMixto("src/components/checkout-form.tsx")).toBe(true);
    expect(MAQUINARIA).not.toContain("src/components");
    expect(
      MAQUINARIA.some((ruta) =>
        "src/components/checkout-form.tsx".startsWith(`${ruta}/`)
      )
    ).toBe(false);
  });
});

describe("maquinariaFaltante", () => {
  const tiene = (rutas: string[]) => (ruta: string) => rutas.includes(ruta);

  it("lista la maquinaria que la tienda no tiene, aunque el template no la haya cambiado", () => {
    // El caso de productos: src/lib/spreadsheet.ts faltaba con el baseline al
    // día, y admin-products.ts (que lo importa) sí estaba.
    const template = [
      "src/lib/spreadsheet.ts",
      "src/app/actions/admin-products.ts",
      "tests/unit/log.test.ts",
    ];
    expect(
      maquinariaFaltante(template, tiene(["src/app/actions/admin-products.ts"]))
    ).toEqual(["src/lib/spreadsheet.ts", "tests/unit/log.test.ts"]);
  });

  it("la piel, lo que es sólo del template y el baseline no cuentan", () => {
    const template = [
      "src/components/site-header.tsx",
      "src/styles/temas/calido.css",
      "fable/plan.md",
      "tiendas.json",
      ".github/dependabot.yml",
      BASELINE_FILE,
    ];
    expect(maquinariaFaltante(template, tiene([]))).toEqual([]);
  });

  it("una tienda con todo: nada", () => {
    const template = ["src/domain/orders.ts", "package.json"];
    expect(maquinariaFaltante(template, tiene(template))).toEqual([]);
  });
});
