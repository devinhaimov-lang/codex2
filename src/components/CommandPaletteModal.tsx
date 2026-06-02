import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent as ReactKeyboardEvent,
} from 'react';
import { Search, CornerDownLeft, Clock3 } from 'lucide-react';

export interface CommandPaletteItem {
  id: string;
  title: string;
  subtitle?: string;
  group?: string;
  keywords?: string[];
  shortcuts?: string[];
}

interface CommandPaletteModalProps {
  open: boolean;
  items: CommandPaletteItem[];
  recentItemIds?: string[];
  onClose: () => void;
  onExecute: (item: CommandPaletteItem) => void;
}

const MAX_VISIBLE_ITEMS = 12;

function normalizeSearchValue(value: string): string {
  return value.trim().toLowerCase();
}

export default function CommandPaletteModal({
  open,
  items,
  recentItemIds = [],
  onClose,
  onExecute,
}: CommandPaletteModalProps) {
  const [query, setQuery] = useState('');
  const [activeIndex, setActiveIndex] = useState(0);
  const inputRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    if (!open) {
      setQuery('');
      setActiveIndex(0);
      return;
    }
    const timer = window.setTimeout(() => {
      inputRef.current?.focus();
      inputRef.current?.select();
    }, 0);
    return () => {
      window.clearTimeout(timer);
    };
  }, [open]);

  const recentOrder = useMemo(() => {
    return new Map(recentItemIds.map((id, index) => [id, index]));
  }, [recentItemIds]);

  const visibleItems = useMemo(() => {
    const normalizedQuery = normalizeSearchValue(query);
    const ranked = items
      .map((item) => {
        const haystack = normalizeSearchValue(
          [
            item.title,
            item.subtitle,
            item.group,
            ...(item.keywords ?? []),
            ...(item.shortcuts ?? []),
          ]
            .filter(Boolean)
            .join(' '),
        );
        const isRecent = recentOrder.has(item.id);
        const recentRank = recentOrder.get(item.id) ?? Number.MAX_SAFE_INTEGER;

        if (!normalizedQuery) {
          return {
            item,
            score: isRecent ? 2000 - recentRank : 0,
          };
        }
        if (!haystack.includes(normalizedQuery)) {
          return null;
        }
        const title = item.title.toLowerCase();
        const subtitle = item.subtitle?.toLowerCase() ?? '';
        let score = 100;
        if (title.startsWith(normalizedQuery)) score += 120;
        else if (title.includes(normalizedQuery)) score += 80;
        if (subtitle.includes(normalizedQuery)) score += 30;
        if (isRecent) score += 20;
        return { item, score };
      })
      .filter((entry): entry is { item: CommandPaletteItem; score: number } => !!entry)
      .sort((left, right) => right.score - left.score || left.item.title.localeCompare(right.item.title));

    return ranked.slice(0, MAX_VISIBLE_ITEMS).map((entry) => entry.item);
  }, [items, query, recentOrder]);

  useEffect(() => {
    setActiveIndex(0);
  }, [query, open]);

  useEffect(() => {
    if (activeIndex < visibleItems.length) {
      return;
    }
    setActiveIndex(Math.max(visibleItems.length - 1, 0));
  }, [activeIndex, visibleItems.length]);

  const handleKeyDown = (event: ReactKeyboardEvent<HTMLDivElement>) => {
    if (event.key === 'ArrowDown') {
      event.preventDefault();
      setActiveIndex((current) => (visibleItems.length === 0 ? 0 : (current + 1) % visibleItems.length));
      return;
    }
    if (event.key === 'ArrowUp') {
      event.preventDefault();
      setActiveIndex((current) =>
        visibleItems.length === 0 ? 0 : (current - 1 + visibleItems.length) % visibleItems.length,
      );
      return;
    }
    if (event.key === 'Enter') {
      event.preventDefault();
      const item = visibleItems[activeIndex];
      if (item) {
        onExecute(item);
      }
      return;
    }
    if (event.key === 'Escape') {
      event.preventDefault();
      onClose();
    }
  };

  if (!open) {
    return null;
  }

  return (
    <div className="command-palette-overlay" onClick={onClose}>
      <div
        className="command-palette-modal"
        role="dialog"
        aria-modal="true"
        aria-label="Command palette"
        onClick={(event) => event.stopPropagation()}
        onKeyDown={handleKeyDown}
      >
        <div className="command-palette-search">
          <Search size={18} className="command-palette-search-icon" />
          <input
            ref={inputRef}
            type="text"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Search pages and actions"
            aria-label="Search pages and actions"
          />
        </div>
        <div className="command-palette-results">
          {visibleItems.length === 0 ? (
            <div className="command-palette-empty">
              <Search size={16} />
              <span>No matching actions</span>
            </div>
          ) : (
            visibleItems.map((item, index) => {
              const isActive = index === activeIndex;
              const isRecent = recentOrder.has(item.id);
              return (
                <button
                  key={item.id}
                  type="button"
                  className={`command-palette-item${isActive ? ' is-active' : ''}`}
                  onMouseEnter={() => setActiveIndex(index)}
                  onClick={() => onExecute(item)}
                >
                  <div className="command-palette-item-main">
                    <div className="command-palette-item-title-row">
                      <span className="command-palette-item-title">{item.title}</span>
                      {isRecent ? (
                        <span className="command-palette-item-badge">
                          <Clock3 size={12} />
                          Recent
                        </span>
                      ) : null}
                    </div>
                    {item.subtitle ? (
                      <span className="command-palette-item-subtitle">{item.subtitle}</span>
                    ) : null}
                    {item.group ? (
                      <span className="command-palette-item-group">{item.group}</span>
                    ) : null}
                  </div>
                  <div className="command-palette-item-meta">
                    {item.shortcuts?.length ? (
                      <span className="command-palette-item-shortcuts">
                        {item.shortcuts.map((shortcut) => (
                          <kbd key={shortcut}>{shortcut}</kbd>
                        ))}
                      </span>
                    ) : null}
                    {isActive ? <CornerDownLeft size={14} /> : null}
                  </div>
                </button>
              );
            })
          )}
        </div>
      </div>
    </div>
  );
}
