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
        className={`flex-shrink-0 px-3 py-1.5 rounded-lg text-xs font-medium transition-colors ${
          selectedId === null
            ? "bg-burgundy-700 text-white"
            : "bg-gray-800 text-gray-300 hover:bg-gray-700"
        }`}
        data-testid="cat-all"
      >
        All
      </button>

      {topLevel.map((cat) => (
        <button
          key={cat.id}
          onClick={() => onSelect(cat.id === selectedId ? null : cat.id)}
          className={`flex-shrink-0 px-3 py-1.5 rounded-lg text-xs font-medium transition-colors whitespace-nowrap ${
            selectedId === cat.id
              ? "bg-burgundy-700 text-white"
              : "bg-gray-800 text-gray-300 hover:bg-gray-700"
          }`}
          data-testid={`cat-${cat.id}`}
        >
          {cat.name}
        </button>
      ))}
    </div>
  );
}
