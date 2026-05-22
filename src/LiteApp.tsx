import { Suspense, lazy, useEffect, useState } from 'react';
import './App.css';
import { listen } from '@tauri-apps/api/event';
import { invoke } from '@tauri-apps/api/core';
import { GlobalModal } from './components/GlobalModal';
import { LiteUnlockGate } from './components/LiteUnlockGate';
import { CodexIcon } from './components/icons/CodexIcon';
import { changeLanguage, getCurrentLanguage, normalizeLanguage, supportedLanguages } from './i18n';


const languageLabels: Record<string, string> = {
  en: 'English',
  'zh-cn': '简体中文',
  'zh-tw': '繁體中文',
  ja: '日本語',
  es: 'Español',
  de: 'Deutsch',
  fr: 'Français',
  'pt-br': 'Português',
  ru: 'Русский',
  ko: '한국어',
  it: 'Italiano',
  tr: 'Türkçe',
  pl: 'Polski',
  cs: 'Čeština',
  vi: 'Tiếng Việt',
  ar: 'العربية',
  id: 'Bahasa Indonesia',
};

type GeneralConfig = Record<string, any>;

function buildSaveGeneralConfigArgs(config: GeneralConfig, language: string) {
  return {
    language,
    defaultTerminal: config.default_terminal ?? 'system',
    theme: config.theme ?? 'system',
    uiScale: config.ui_scale ?? 1,
    autoRefreshMinutes: config.auto_refresh_minutes ?? 10,
    codexAutoRefreshMinutes: config.codex_auto_refresh_minutes ?? 10,
    ghcpAutoRefreshMinutes: config.ghcp_auto_refresh_minutes ?? 10,
    windsurfAutoRefreshMinutes: config.windsurf_auto_refresh_minutes ?? 10,
    kiroAutoRefreshMinutes: config.kiro_auto_refresh_minutes ?? 10,
    cursorAutoRefreshMinutes: config.cursor_auto_refresh_minutes ?? 10,
    geminiAutoRefreshMinutes: config.gemini_auto_refresh_minutes ?? 10,
    geminiSyncWsl: config.gemini_sync_wsl ?? true,
    codebuddyAutoRefreshMinutes: config.codebuddy_auto_refresh_minutes ?? 10,
    codebuddyCnAutoRefreshMinutes: config.codebuddy_cn_auto_refresh_minutes ?? 10,
    workbuddyAutoRefreshMinutes: config.workbuddy_auto_refresh_minutes ?? 10,
    qoderAutoRefreshMinutes: config.qoder_auto_refresh_minutes ?? 10,
    traeAutoRefreshMinutes: config.trae_auto_refresh_minutes ?? 10,
    zedAutoRefreshMinutes: config.zed_auto_refresh_minutes ?? 10,
    closeBehavior: config.close_behavior ?? 'ask',
    minimizeBehavior: config.minimize_behavior,
    hideDockIcon: config.hide_dock_icon,
    trayIconStyle: config.tray_icon_style,
    floatingCardShowOnStartup: config.floating_card_show_on_startup,
    floatingCardAlwaysOnTop: config.floating_card_always_on_top,
    appAutoLaunchEnabled: config.app_auto_launch_enabled,
    antigravityStartupWakeupEnabled: config.antigravity_startup_wakeup_enabled,
    antigravityStartupWakeupDelaySeconds: config.antigravity_startup_wakeup_delay_seconds,
    codexStartupWakeupEnabled: config.codex_startup_wakeup_enabled,
    codexStartupWakeupDelaySeconds: config.codex_startup_wakeup_delay_seconds,
    floatingCardConfirmOnClose: config.floating_card_confirm_on_close,
    opencodeAppPath: config.opencode_app_path ?? '',
    antigravityAppPath: config.antigravity_app_path ?? '',
    codexAppPath: config.codex_app_path ?? '',
    codexSpecifiedAppPath: config.codex_specified_app_path,
    zedAppPath: config.zed_app_path,
    vscodeAppPath: config.vscode_app_path ?? '',
    windsurfAppPath: config.windsurf_app_path,
    kiroAppPath: config.kiro_app_path,
    cursorAppPath: config.cursor_app_path,
    codebuddyAppPath: config.codebuddy_app_path,
    codebuddyCnAppPath: config.codebuddy_cn_app_path,
    qoderAppPath: config.qoder_app_path,
    traeAppPath: config.trae_app_path,
    workbuddyAppPath: config.workbuddy_app_path,
    opencodeSyncOnSwitch: config.opencode_sync_on_switch ?? false,
    opencodeAuthOverwriteOnSwitch: config.opencode_auth_overwrite_on_switch,
    ghcpOpencodeSyncOnSwitch: config.ghcp_opencode_sync_on_switch,
    ghcpOpencodeAuthOverwriteOnSwitch: config.ghcp_opencode_auth_overwrite_on_switch,
    ghcpLaunchOnSwitch: config.ghcp_launch_on_switch,
    openclawAuthOverwriteOnSwitch: config.openclaw_auth_overwrite_on_switch,
    codexLaunchOnSwitch: config.codex_launch_on_switch ?? true,
    codexRestartSpecifiedAppOnSwitch: config.codex_restart_specified_app_on_switch,
    codexLocalAccessEntryVisible: config.codex_local_access_entry_visible,
    antigravityDualSwitchNoRestartEnabled: config.antigravity_dual_switch_no_restart_enabled,
    autoSwitchEnabled: config.auto_switch_enabled,
    autoSwitchThreshold: config.auto_switch_threshold,
    autoSwitchCreditsEnabled: config.auto_switch_credits_enabled,
    autoSwitchCreditsThreshold: config.auto_switch_credits_threshold,
    autoSwitchScopeMode: config.auto_switch_scope_mode,
    autoSwitchSelectedGroupIds: config.auto_switch_selected_group_ids,
    autoSwitchAccountScopeMode: config.auto_switch_account_scope_mode,
    autoSwitchSelectedAccountIds: config.auto_switch_selected_account_ids,
    codexAutoSwitchEnabled: config.codex_auto_switch_enabled,
    codexAutoSwitchPrimaryThreshold: config.codex_auto_switch_primary_threshold,
    codexAutoSwitchSecondaryThreshold: config.codex_auto_switch_secondary_threshold,
    codexAutoSwitchAccountScopeMode: config.codex_auto_switch_account_scope_mode,
    codexAutoSwitchSelectedAccountIds: config.codex_auto_switch_selected_account_ids,
    quotaAlertEnabled: config.quota_alert_enabled,
    quotaAlertThreshold: config.quota_alert_threshold,
    codexQuotaAlertEnabled: config.codex_quota_alert_enabled,
    codexQuotaAlertThreshold: config.codex_quota_alert_threshold,
    zedQuotaAlertEnabled: config.zed_quota_alert_enabled,
    zedQuotaAlertThreshold: config.zed_quota_alert_threshold,
    codexQuotaAlertPrimaryThreshold: config.codex_quota_alert_primary_threshold,
    codexQuotaAlertSecondaryThreshold: config.codex_quota_alert_secondary_threshold,
    ghcpQuotaAlertEnabled: config.ghcp_quota_alert_enabled,
    ghcpQuotaAlertThreshold: config.ghcp_quota_alert_threshold,
    windsurfQuotaAlertEnabled: config.windsurf_quota_alert_enabled,
    windsurfQuotaAlertThreshold: config.windsurf_quota_alert_threshold,
    kiroQuotaAlertEnabled: config.kiro_quota_alert_enabled,
    kiroQuotaAlertThreshold: config.kiro_quota_alert_threshold,
    cursorQuotaAlertEnabled: config.cursor_quota_alert_enabled,
    cursorQuotaAlertThreshold: config.cursor_quota_alert_threshold,
    geminiQuotaAlertEnabled: config.gemini_quota_alert_enabled,
    geminiQuotaAlertThreshold: config.gemini_quota_alert_threshold,
    codebuddyQuotaAlertEnabled: config.codebuddy_quota_alert_enabled,
    codebuddyQuotaAlertThreshold: config.codebuddy_quota_alert_threshold,
    codebuddyCnQuotaAlertEnabled: config.codebuddy_cn_quota_alert_enabled,
    codebuddyCnQuotaAlertThreshold: config.codebuddy_cn_quota_alert_threshold,
    qoderQuotaAlertEnabled: config.qoder_quota_alert_enabled,
    qoderQuotaAlertThreshold: config.qoder_quota_alert_threshold,
    traeQuotaAlertEnabled: config.trae_quota_alert_enabled,
    traeQuotaAlertThreshold: config.trae_quota_alert_threshold,
    workbuddyQuotaAlertEnabled: config.workbuddy_quota_alert_enabled,
    workbuddyQuotaAlertThreshold: config.workbuddy_quota_alert_threshold,
  };
}

async function persistLanguage(language: string) {
  try {
    const config = await invoke<GeneralConfig>('get_general_config');
    await invoke('save_general_config', buildSaveGeneralConfigArgs(config, language));
  } catch (error) {
    console.warn('[LiteApp] Failed to persist language to general config:', error);
  }
}

const CodexAccountsPage = lazy(() =>
  import('./pages/CodexAccountsPage').then((module) => ({ default: module.CodexAccountsPage })),
);

const suspenseFallback = (
  <div className="loading-container">
    <div className="loading-spinner" />
  </div>
);

export default function LiteApp() {
  const [language, setLanguage] = useState(getCurrentLanguage());

  useEffect(() => {
    let disposed = false;
    let unlisten: (() => void) | undefined;

    const syncInitialLanguage = async () => {
      try {
        const config = await invoke<GeneralConfig>('get_general_config');
        const nextLanguage = normalizeLanguage(String(config.language || ''));
        if (!disposed && nextLanguage) {
          await changeLanguage(nextLanguage);
          setLanguage(nextLanguage);
        }
      } catch (error) {
        console.warn('[LiteApp] Failed to load saved language:', error);
      }
    };

    void syncInitialLanguage();

    listen<string>('settings:language_changed', (event) => {
      const nextLanguage = normalizeLanguage(String(event.payload || ''));
      if (!nextLanguage) return;
      void changeLanguage(nextLanguage).then(() => {
        setLanguage(nextLanguage);
        window.dispatchEvent(
          new CustomEvent('general-language-updated', { detail: { language: nextLanguage } }),
        );
      });
    }).then((fn) => {
      unlisten = fn;
    });

    return () => {
      disposed = true;
      unlisten?.();
    };
  }, []);

  const handleLanguageChange = async (value: string) => {
    const nextLanguage = normalizeLanguage(value);
    setLanguage(nextLanguage);
    await changeLanguage(nextLanguage);
    window.dispatchEvent(
      new CustomEvent('general-language-updated', { detail: { language: nextLanguage } }),
    );
    void persistLanguage(nextLanguage);
  };

  return (
    <LiteUnlockGate>
      <div className="lite-app-shell">
      <aside className="lite-sidebar">
        <div className="lite-brand">
          <CodexIcon size={24} />
          <div>
            <div className="lite-brand-title">Codex Lite</div>
            <div className="lite-brand-subtitle">Account Manager</div>
          </div>
        </div>

        <div className="lite-nav-item active">
          <CodexIcon size={18} />
          <span>Codex</span>
        </div>

        <label className="lite-language-select">
          <span>Language</span>
          <select value={language} onChange={(e) => void handleLanguageChange(e.target.value)}>
            {supportedLanguages.map((item) => (
              <option key={item} value={item}>
                {languageLabels[item] || item}
              </option>
            ))}
          </select>
        </label>
      </aside>

      <main className="lite-main">
        <Suspense fallback={suspenseFallback}>
          <CodexAccountsPage />
        </Suspense>
      </main>

        <GlobalModal />
      </div>
    </LiteUnlockGate>
  );
}
