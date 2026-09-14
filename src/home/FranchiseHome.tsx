import { FranchisePrototype } from "./prototype/FranchisePrototype";

export function FranchiseHome({ preview = false }: { preview?: boolean }) {
  return <FranchisePrototype key={preview ? "preview" : "home"} />;
}
