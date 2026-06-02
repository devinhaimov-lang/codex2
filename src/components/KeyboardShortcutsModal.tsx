import { useEffect } from 'react';
import { Keyboard, Search, FileText, Settings2, X } from 'lucide-react';

interface KeyboardShortcutsModalProps {
  open: boolean;
  onClose: () => void;
}

const SHORTCUT_GROUPS = [
  {
    title: 'Global',
    icon: Keyboard,
    items: [
      { keys: ['Ctrl', 'K'], macKeys: ['Cmd', 'K'], description: 'Open quick actions' },
      { keys: ['Ctrl', 'Shift', 'P'], macKeys: ['Cmd', 'Shift', 'P'], description: 'Open quick actions' },
      { keys: ['?'], description: 'Show keyboard shortcuts' },
      { keys: ['Esc'], description: 'Close the current modal' },
    ],
  },
  {
    title: 'Actions',
    icon: Search,
    items: [
      { keys: ['Ctrl', 'R'], macKeys: ['Cmd', 'R'], description: 'Refresh the current page' },
      { keys: ['F5'], description: 'Refresh the current page on Windows' },
    ],
  },
  {
    title: 'Utilities',
    icon: Settings2,
    items: [
      { keys: ['Ctrl', 'K'], macKeys: ['Cmd', 'K'], description: 'Search settings, logs, updates, pages' },
      { keys: ['Type'], description: 'Filter commands by platform or action' },
    ],
  },
];

function formatShortcutKeys(keys: string[]) {
  return keys.join(' + ');
}

export default function KeyboardShortcutsModal({
  open,
  onClose,
}: KeyboardShortcutsModalProps) {
  useEffect(() => {
    if (!open) {
      return;
    }
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        onClose();
      }
    };
    window.addEventListener('keydown', handleKeyDown, true);
    return () => {
      window.removeEventListener('keydown', handleKeyDown, true);
    };
  }, [onClose, open]);

  if (!open) {
    return null;
  }

  return (
    <div className="shortcut-help-overlay" onClick={onClose}>
      <div
        className="shortcut-help-modal"
        role="dialog"
        aria-modal="true"
        aria-label="Keyboard shortcuts"
        onClick={(event) => event.stopPropagation()}
      >
        <div className="shortcut-help-header">
          <div>
            <h2>Keyboard shortcuts</h2>
            <p>Use the quick actions palette to jump across pages and tools.</p>
          </div>
          <button type="button" className="shortcut-help-close" onClick={onClose} aria-label="Close">
            <X size={16} />
          </button>
        </div>
        <div className="shortcut-help-groups">
          {SHORTCUT_GROUPS.map((group) => {
            const Icon = group.icon;
            return (
              <section key={group.title} className="shortcut-help-group">
                <div className="shortcut-help-group-title">
                  <Icon size={16} />
                  <span>{group.title}</span>
                </div>
                <div className="shortcut-help-list">
                  {group.items.map((item) => (
                    <div key={`${group.title}-${item.description}`} className="shortcut-help-item">
                      <div className="shortcut-help-item-label">{item.description}</div>
                      <div className="shortcut-help-item-keys">
                        <kbd>{formatShortcutKeys(item.macKeys ?? item.keys)}</kbd>
                        {item.macKeys ? <kbd>{formatShortcutKeys(item.keys)}</kbd> : null}
                      </div>
                    </div>
                  ))}
                </div>
              </section>
            );
          })}
          <div className="shortcut-help-footer">
            <FileText size={15} />
            <span>Quick actions also include logs, update center, instances, settings, and documentation.</span>
          </div>
        </div>
      </div>
    </div>
  );
}
