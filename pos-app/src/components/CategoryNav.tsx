import type { Category } from "../types";

interface CategoryNavProps {
  categories: Category[];
  selectedId: string | null;
  onSelect: (id: string | null) => void;
}

export function CategoryNav({ categories, selectedId, onSelect }: CategoryNavProps) {
  const topLevel = categories.filter((c) => !c.parent_id);

  return (
    <div className="flex gap-1.5 px-3 py-2 overflow-x-auto scrollbar-thin scrollbar-track-gray-900 scrollbar-thumb-gray-700 border-b border-gray-800 flex-shrink-0">
      {/* All button */}
      <button
        onClick={() => onSelect(null)}
        className={`flex-shrink-0 px-3 py-1.5 rounded-full text-xs font-semibold transition-all whitespace-nowrap border ${
          selectedId === null
            ? "bg-burgundy-700 text-white border-burgundy-600 shadow-md shadow-burgundy-900/50"
            : "bg-gray-800 text-gray-300 hover:bg-gray-700 border-gray-700"
        }`}
        data-testid="cat-all"
      >
        All
      </button>

      {topLevel.map((cat) => {
        const isActive = selectedId === cat.id;
        const catColor = (cat as any).color as string | undefined;
        return (
          <button
            key={cat.id}
            onClick={() => onSelect(cat.id === selectedId ? null : cat.id)}
            className={`flex-shrink-0 px-3 py-1.5 rounded-full text-xs font-semibold transition-all whitespace-nowrap border active:scale-95 ${
              isActive
                ? "opacity-100 shadow-lg"
                : "opacity-80 hover:opacity-100"
            }`}
            style={
              catColor
                ? {
                    backgroundColor: isActive ? catColor : catColor + "33",
                    borderColor: catColor,
                    color: isActive ? "#fff" : catColor,
                  }
                : isActive
                ? { backgroundColor: "#7c2d44", borderColor: "#9d3654", color: "#fff" }
                : { backgroundColor: "#1f2937", borderColor: "#374151", color: "#d1d5db" }
            }
            data-testid={`cat-${cat.id}`}
          >
            {cat.name}
          </button>
        );
      })}
    </div>
  );
}
