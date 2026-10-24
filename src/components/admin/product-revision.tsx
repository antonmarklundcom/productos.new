"use client";
import {
  createContext,
  useContext,
  useRef,
  useState,
  type ReactNode,
} from "react";
type RevisionState = {
  revision: number | undefined;
  acknowledge: (expected: number | undefined, next?: number) => void;
};
const Context = createContext<RevisionState | null>(null);
/** Only acknowledged writes from this mounted editor advance its baseline. A
 * refresh from another editor never silently rebases an existing draft. */
export function ProductRevisionProvider({
  revision,
  children,
}: {
  revision: number;
  children: ReactNode;
}) {
  const current = useRef(revision);
  const [value, setValue] = useState(revision);
  return (
    <Context.Provider
      value={{
        revision: value,
        acknowledge(expected, next) {
          if (expected === current.current) {
            current.current = next ?? expected + 1;
            setValue(current.current);
          }
        },
      }}
    >
      {children}
    </Context.Provider>
  );
}
export function useProductRevision(fallback?: number) {
  const context = useContext(Context);
  const [revision, setRevision] = useState(fallback);
  return (
    context ?? {
      revision,
      acknowledge(expected: number | undefined, next?: number) {
        if (expected === revision)
          setRevision(
            next ?? (expected === undefined ? undefined : expected + 1)
          );
      },
    }
  );
}
