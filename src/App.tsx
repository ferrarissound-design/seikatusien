import { useEffect, useRef, useState } from 'react';
import { getDb, onDbChange } from './db/db';
import { useRoute, href, navigate } from './ui/router';
import { useSettings } from './ui/hooks';
import { Icon } from './ui/Icon';
import { Toasts } from './ui/Toasts';
import { Home } from './screens/Home';
import { ChecklistsScreen } from './screens/Checklists';
import { TasksScreen } from './screens/Tasks';
import { MoneyScreen } from './screens/Money';
import { SettingsScreen } from './screens/settings/Settings';
import { FocusScreen } from './screens/Focus';
import { Onboarding } from './screens/Onboarding';
import { useStore } from './lib/store';
import { pwaState, applyUpdate } from './pwa';

/** 設定（テーマ・文字サイズ・動き）を <html> に反映 */
function useApplyDisplaySettings() {
  const s = useSettings();
  useEffect(() => {
    if (!s) return;
    const root = document.documentElement;
    if (s.theme === 'system') root.removeAttribute('data-theme');
    else root.setAttribute('data-theme', s.theme);
    if (s.reduceMotion === 'system') root.removeAttribute('data-motion');
    else root.setAttribute('data-motion', s.reduceMotion);
    root.style.setProperty('--font-scale', String(s.fontScale));
  }, [s]);
}

const NAV = [
  { key: 'home', label: 'ホーム', icon: 'home', feature: null },
  { key: 'checklists', label: '忘れ物', icon: 'bag', feature: 'checklists' },
  { key: 'tasks', label: 'タスク', icon: 'task', feature: 'tasks' },
  { key: 'money', label: 'お金', icon: 'wallet', feature: 'money' },
  { key: 'settings', label: '設定', icon: 'gear', feature: null },
] as const;

function Shell() {
  const route = useRoute();
  const settings = useSettings();
  const pwa = useStore(pwaState);
  useApplyDisplaySettings();

  const section = route.path[0] ?? 'home';
  // 初回起動の判定は起動時に1回だけ行う（保存直後の古い値で引き戻さないため）
  const onboardingChecked = useRef(false);
  useEffect(() => {
    if (!settings || onboardingChecked.current) return;
    onboardingChecked.current = true;
    if (!settings.onboardingDone && (section === 'home' || section === '')) navigate('/onboarding', true);
  }, [settings, section]);

  if (!settings) return <div className="app" aria-busy="true" />;

  if (section === 'focus') {
    return (
      <div className="app" style={{ paddingBottom: 0 }}>
        <FocusScreen />
        <Toasts />
      </div>
    );
  }

  let screen;
  switch (section) {
    case 'onboarding':
      screen = <Onboarding />;
      break;
    case 'checklists':
      screen = <ChecklistsScreen />;
      break;
    case 'tasks':
      screen = <TasksScreen />;
      break;
    case 'money':
      screen = <MoneyScreen />;
      break;
    case 'settings':
      screen = <SettingsScreen />;
      break;
    default:
      screen = <Home />;
  }

  return (
    <div className="app">
      {pwa.updateReady && (
        <div className="banner info spread" style={{ margin: '8px 16px 0', maxWidth: 608, marginInline: 'auto' }} role="status">
          <span className="small">新しいバージョンがあります。記録はそのまま残ります。</span>
          <button type="button" className="btn small primary" onClick={applyUpdate}>
            更新
          </button>
        </div>
      )}
      {screen}
      {section !== 'onboarding' && (
        <nav className="nav" aria-label="メインメニュー">
          <ul>
            {NAV.filter((n) => !n.feature || settings.features[n.feature]).map((n) => (
              <li key={n.key}>
                <a href={href(`/${n.key}`)} aria-current={section === n.key || (section === '' && n.key === 'home') ? 'page' : undefined}>
                  <span className="nav-icon">
                    <Icon name={n.icon} />
                  </span>
                  {n.label}
                </a>
              </li>
            ))}
          </ul>
        </nav>
      )}
      <Toasts />
    </div>
  );
}

/** アカウント切り替え時にDBが変わったら、画面全体を作り直す（他人の記録が残らないように） */
export function App() {
  const [dbName, setDbName] = useState(getDb().name);
  useEffect(() => onDbChange((db) => setDbName(db.name)), []);
  return <Shell key={dbName} />;
}
