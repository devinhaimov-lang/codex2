import { useCallback, useEffect, useRef, useState } from 'react';
import { Image, Link, Save, Settings, Trash2, X } from 'lucide-react';

const STORAGE_KEY = 'codexTools.customPromo.v3';

type CustomPromoConfig = {
  enabled: boolean;
  imageUrl: string;
  linkUrl: string;
  altText: string;
};

const DEFAULT_CONFIG: CustomPromoConfig = {
  enabled: true,
  imageUrl: '/custom-promo.webp',
  linkUrl: '',
  altText: '小懂不懂经典推广图',
};

function loadConfig(): CustomPromoConfig {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return DEFAULT_CONFIG;
    const parsed = JSON.parse(raw) as Partial<CustomPromoConfig>;
    return {
      ...DEFAULT_CONFIG,
      ...parsed,
      imageUrl:
        typeof parsed.imageUrl === 'string' && parsed.imageUrl.trim()
          ? parsed.imageUrl
          : DEFAULT_CONFIG.imageUrl,
      linkUrl: typeof parsed.linkUrl === 'string' ? parsed.linkUrl : '',
      altText: typeof parsed.altText === 'string' ? parsed.altText : DEFAULT_CONFIG.altText,
      enabled: parsed.enabled !== false,
    };
  } catch {
    return DEFAULT_CONFIG;
  }
}

function saveConfig(config: CustomPromoConfig) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(config));
}

function normalizeUrl(value: string): string {
  const trimmed = value.trim();
  if (!trimmed) return '';
  if (/^(https?:|data:image\/|blob:|file:)/i.test(trimmed)) return trimmed;
  return `https://${trimmed}`;
}

export function CustomPromoBanner() {
  const [config, setConfig] = useState<CustomPromoConfig>(() => loadConfig());
  const [draft, setDraft] = useState<CustomPromoConfig>(() => loadConfig());
  const [editing, setEditing] = useState(false);
  const [dragging, setDragging] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    saveConfig(config);
  }, [config]);

  const openEditor = useCallback(() => {
    setDraft(config);
    setEditing(true);
  }, [config]);

  const closeEditor = useCallback(() => {
    setDraft(config);
    setEditing(false);
    setDragging(false);
  }, [config]);

  const applyImageFile = useCallback((file: File | null) => {
    if (!file || !file.type.startsWith('image/')) return;
    const reader = new FileReader();
    reader.onload = () => {
      const result = reader.result;
      if (typeof result === 'string') {
        setDraft((prev) => ({ ...prev, imageUrl: result }));
      }
    };
    reader.readAsDataURL(file);
  }, []);

  const saveDraft = useCallback(() => {
    setConfig({
      ...draft,
      imageUrl: normalizeUrl(draft.imageUrl),
      linkUrl: normalizeUrl(draft.linkUrl),
      altText: draft.altText.trim() || DEFAULT_CONFIG.altText,
    });
    setEditing(false);
    setDragging(false);
  }, [draft]);

  const clearPromo = useCallback(() => {
    const next = { ...DEFAULT_CONFIG, enabled: false };
    setDraft(next);
    setConfig(next);
  }, []);

  const hasImage = config.enabled && config.imageUrl.trim();

  return (
    <div className={`custom-promo-shell${hasImage ? ' has-image' : ''}`}>
      {hasImage ? (
        <div className="custom-promo-banner">
          {config.linkUrl ? (
            <a className="custom-promo-link" href={config.linkUrl} target="_blank" rel="noreferrer">
              <img src={config.imageUrl} alt={config.altText} />
            </a>
          ) : (
            <img src={config.imageUrl} alt={config.altText} />
          )}
          <button className="custom-promo-edit" type="button" onClick={openEditor} title="设置推广位">
            <Settings size={15} />
          </button>
        </div>
      ) : (
        <button className="custom-promo-empty" type="button" onClick={openEditor}>
          <Image size={16} />
          <span>设置推广位图片</span>
        </button>
      )}

      {editing && (
        <div className="custom-promo-modal" role="dialog" aria-modal="true">
          <div className="custom-promo-panel">
            <div className="custom-promo-panel-header">
              <div>
                <h2>推广位设置</h2>
                <p>用于展示你自己的账号、二维码或引流图片。</p>
              </div>
              <button type="button" className="custom-promo-icon-btn" onClick={closeEditor} aria-label="关闭">
                <X size={18} />
              </button>
            </div>

            <label
              className={`custom-promo-dropzone${dragging ? ' is-dragging' : ''}`}
              onDragOver={(event) => {
                event.preventDefault();
                setDragging(true);
              }}
              onDragLeave={() => setDragging(false)}
              onDrop={(event) => {
                event.preventDefault();
                setDragging(false);
                applyImageFile(event.dataTransfer.files[0] ?? null);
              }}
            >
              {draft.imageUrl ? (
                <img src={draft.imageUrl} alt={draft.altText || DEFAULT_CONFIG.altText} />
              ) : (
                <div className="custom-promo-dropzone-placeholder">
                  <Image size={28} />
                  <span>拖入图片，或点击选择</span>
                </div>
              )}
              <input
                ref={fileInputRef}
                type="file"
                accept="image/*"
                onChange={(event) => applyImageFile(event.target.files?.[0] ?? null)}
              />
            </label>

            <label className="custom-promo-field">
              <span>图片链接</span>
              <input
                value={draft.imageUrl.startsWith('data:image/') ? '' : draft.imageUrl}
                placeholder="https://... 或拖入本地图片"
                onChange={(event) => setDraft((prev) => ({ ...prev, imageUrl: event.target.value }))}
              />
            </label>

            <label className="custom-promo-field">
              <span>点击跳转链接</span>
              <div className="custom-promo-input-with-icon">
                <Link size={15} />
                <input
                  value={draft.linkUrl}
                  placeholder="例如你的主页、群链接、公众号文章"
                  onChange={(event) => setDraft((prev) => ({ ...prev, linkUrl: event.target.value }))}
                />
              </div>
            </label>

            <label className="custom-promo-field">
              <span>图片说明</span>
              <input
                value={draft.altText}
                placeholder="用于无障碍说明"
                onChange={(event) => setDraft((prev) => ({ ...prev, altText: event.target.value }))}
              />
            </label>

            <label className="custom-promo-toggle">
              <input
                type="checkbox"
                checked={draft.enabled}
                onChange={(event) => setDraft((prev) => ({ ...prev, enabled: event.target.checked }))}
              />
              <span>显示推广位</span>
            </label>

            <div className="custom-promo-actions">
              <button type="button" className="btn btn-secondary" onClick={clearPromo}>
                <Trash2 size={15} />
                清空
              </button>
              <button type="button" className="btn btn-secondary" onClick={closeEditor}>
                取消
              </button>
              <button type="button" className="btn btn-primary" onClick={saveDraft}>
                <Save size={15} />
                保存
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
