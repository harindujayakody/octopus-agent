import { ClockIcon, FilterIcon, GlobeIcon, PlayIcon } from "../icons";

const ICONS = { running: PlayIcon, direct: GlobeIcon, recent: ClockIcon };

/** A View's icon: a built-in's own, or the filter mark for a custom View. */
export function ViewIcon({ kind, className }: { kind?: keyof typeof ICONS; className?: string }) {
  const Icon = kind ? ICONS[kind] : FilterIcon;
  return <Icon className={className} />;
}
