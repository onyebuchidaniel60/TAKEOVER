import { SLOT_CATEGORIES } from '../lib/slots';

export interface FilterValues {
  q: string;
  category: string;
  location: string;
  from: string;
  to: string;
}

const inputClass =
  'min-h-touch w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm focus:outline-none focus-visible:ring-2 focus-visible:ring-slate-900';

export default function SearchFilters({
  values,
  onChange,
  onClear,
}: {
  values: FilterValues;
  onChange: (next: FilterValues) => void;
  onClear: () => void;
}) {
  const set =
    (key: keyof FilterValues) =>
    (event: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) => {
      onChange({ ...values, [key]: event.target.value });
    };

  return (
    <form
      className="rounded-xl border border-slate-200 bg-white p-4"
      role="search"
      aria-label="Search available slots"
      onSubmit={(event) => event.preventDefault()}
    >
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <div>
          <label htmlFor="slot-search" className="mb-1 block text-xs font-medium text-slate-600">
            Search
          </label>
          <input
            id="slot-search"
            type="search"
            autoComplete="off"
            className={inputClass}
            placeholder="Dinner, yoga, court…"
            value={values.q}
            onChange={set('q')}
          />
        </div>
        <div>
          <label htmlFor="slot-category" className="mb-1 block text-xs font-medium text-slate-600">
            Category
          </label>
          <select
            id="slot-category"
            className={inputClass}
            value={values.category}
            onChange={set('category')}
          >
            <option value="">All categories</option>
            {SLOT_CATEGORIES.map((category) => (
              <option key={category} value={category}>
                {category}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label htmlFor="slot-location" className="mb-1 block text-xs font-medium text-slate-600">
            Area
          </label>
          <input
            id="slot-location"
            type="text"
            autoComplete="off"
            className={inputClass}
            placeholder="Mitte, Kreuzberg…"
            value={values.location}
            onChange={set('location')}
          />
        </div>
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label htmlFor="slot-from" className="mb-1 block text-xs font-medium text-slate-600">
              From
            </label>
            <input
              id="slot-from"
              type="datetime-local"
              className={inputClass}
              value={values.from}
              onChange={set('from')}
            />
          </div>
          <div>
            <label htmlFor="slot-to" className="mb-1 block text-xs font-medium text-slate-600">
              To
            </label>
            <input
              id="slot-to"
              type="datetime-local"
              className={inputClass}
              value={values.to}
              onChange={set('to')}
            />
          </div>
        </div>
      </div>
      <button
        type="button"
        onClick={onClear}
        className="mt-3 min-h-touch rounded-lg border border-slate-300 px-4 py-2 text-sm font-medium text-slate-700 focus:outline-none focus-visible:ring-2 focus-visible:ring-slate-900"
      >
        Clear filters
      </button>
    </form>
  );
}
