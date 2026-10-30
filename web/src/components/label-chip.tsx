import type { ProjectLabel } from "@/lib/project-workspace";

/** A project label as a Tag, tinted from the label's own colour. */
export function LabelChip({ label }: { label: ProjectLabel }) {
  return (
    <span
      className="inline-flex h-5 shrink-0 items-center whitespace-nowrap rounded-[5px] px-1.5 text-xs font-medium"
      style={{
        backgroundColor: `color-mix(in srgb, ${label.color} 16%, white)`,
        color: `color-mix(in srgb, ${label.color} 72%, black)`,
      }}
    >
      {label.name}
    </span>
  );
}
