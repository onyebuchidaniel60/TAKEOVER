import { Search } from 'lucide-react';
import { SLOT_CATEGORIES } from '../lib/slots';

export interface FilterValues {
  q: string;
  category: string;
  location: string;
  from: string;
  to: string;
}

// Inset inputs: surface-2 fill, radius-control, no border (the value
// shift off the surface card carries the affordance), global focus ring.
const inputClass =
  'min-h-touch w-full rounded-control bg-surface-2 px-3 py-2 text-body text-text placeholder:text-muted focus:outline-none focus-visible:ring-2 focus-visible:ring-accent';

const chipBase =
  'min-h-touch shrink-0 whitespace-nowrap rounded-pill px-4 py-2 text-body font-medium transition-[background-color,color,transform] duration-ui ease-out-strong active:scale-[0.97] motion-reduce:transition-none';

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
    (event: React.ChangeEvent<HTMLInputElement>) => {
      onChange({ ...values, [key]: event.target.value });
    };

  const setCategory = (category: string): void => {
    onChange({ ...values, category });
  };

  return (
    <form
      className="rounded-card border border-border bg-surface p-4"
      role="search"
      aria-label="Search available slots"
      onSubmit={(event) => event.preventDefault()}
    >
      <div>
        <label htmlFor="slot-search" className="mb-1 block text-small font-medium text-muted">
          Search
        </label>
        <div className="relative">
          <Search
            size={16}
            aria-hidden="true"
            className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-muted"
          />
          <input
            id="slot-search"
            type="search"
            autoComplete="off"
            className={`${inputClass} pl-9`}
            placeholder="Dinner, yoga, court…"
            value={values.q}
            onChange={set('q')}
          />
        </div>
      </div>
      <div className="mt-3">
        <p id="slot-category-label" className="mb-1 block text-small font-medium text-muted">
          Category
        </p>
        <div
          role="group"
          aria-labelledby="slot-category-label"
          className="-mx-4 flex gap-2 overflow-x-auto px-4 pb-1"
        >
          {['', ...SLOT_CATEGORIES].map((category) => {
            const active = values.category === category;
            return (
              <button
                key={category || 'all'}
                type="button"
                aria-pressed={active}
                onClick={() => setCategory(category)}
                className={
                  active
                    ? `${chipBase} bg-accent text-accent-ink`
                    : `${chipBase} bg-surface-2 text-muted`
                }
              >
                {category || 'All'}
              </button>
            );
          })}
        </div>
      </div>
      <div className="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-2">
        <div>
          <label htmlFor="slot-location" className="mb-1 block text-small font-medium text-muted">
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
            <label htmlFor="slot-from" className="mb-1 block text-small font-medium text-muted">
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
            <label htmlFor="slot-to" className="mb-1 block text-small font-medium text-muted">
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
        className="mt-3 min-h-touch rounded-pill border border-border-strong bg-transparent px-4 py-2 text-body font-medium text-text transition-transform duration-press ease-out-strong active:scale-[0.97] motion-reduce:transition-none"
      >
        Clear filters
      </button>
    </form>
  );
}
