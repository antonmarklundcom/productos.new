/**
 * Re-exporta el contrato de `data-testid` para los specs de este directorio.
 *
 * La fuente única es `src/lib/testids.ts`, porque los componentes cliente
 * también lo importan (con el alias `@/lib/testids`) y un contrato con dos
 * copias es un contrato que se desincroniza. Este archivo existe para que el
 * import desde un spec sea corto y quede documentado dónde vive.
 */
export { TESTIDS, type TestId } from "../../src/lib/testids";
