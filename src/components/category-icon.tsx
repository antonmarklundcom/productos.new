import {
  House,
  Wrench,
  Headphones,
  Sparkles,
  PawPrint,
  Mountain,
  type LucideProps,
} from "lucide-react";

const ICONS = {
  home: House,
  tools: Wrench,
  tech: Headphones,
  beauty: Sparkles,
  pets: PawPrint,
  outdoor: Mountain,
};
export function CategoryIcon({
  name,
  ...props
}: LucideProps & { name: string }) {
  const Icon = ICONS[name as keyof typeof ICONS] ?? House;
  return <Icon aria-hidden {...props} />;
}
