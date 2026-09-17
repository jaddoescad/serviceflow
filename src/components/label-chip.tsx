import type { ProjectLabel } from "@/lib/project-workspace";

export function LabelChip({ label }: { label: ProjectLabel }) {
  return (
    <span
      className="inline-flex rounded px-2 py-1 text-xs font-medium text-slate-900"
      style={{
        backgroundColor: label.color,
        color:
          parseInt(label.color.slice(1, 3), 16) * 0.299 +
            parseInt(label.color.slice(3, 5), 16) * 0.587 +
            parseInt(label.color.slice(5, 7), 16) * 0.114 >
          150
            ? "#172235"
            : "white",
      }}
    >
      {label.name}
    </span>
  );
}
