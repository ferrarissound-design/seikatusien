import { useState } from 'react';
import { Card, Toggle } from '../ui/components';
import { useSettings } from '../ui/hooks';
import { saveSettings } from '../db/repo';
import { createChecklist } from '../db/actions';
import { MoneySetup } from './Money';
import { TEMPLATE_ICONS, TEMPLATE_LABELS, BUILTIN_TEMPLATES } from '../db/templates';
import type { TemplateType } from '../db/types';
import { href, navigate } from '../ui/router';
import { isCloudConfigured } from '../sync/supabase';
import { notificationPermission, requestNotificationPermission } from '../notify/notifier';

type Step = 'welcome' | 'features' | 'checklist' | 'money' | 'notify' | 'backup';

/**
 * 初回の設定。どの手順もスキップでき、入力は最小限。
 * あとから「設定」でいつでも変更できる。
 */
export function Onboarding() {
  const s = useSettings();
  const [step, setStep] = useState<Step>('welcome');
  const [made, setMade] = useState<string | null>(null);
  if (!s) return null;
  const f = s.features;

  const order: Step[] = ['welcome', 'features', ...(f.checklists ? (['checklist'] as Step[]) : []), ...(f.money ? (['money'] as Step[]) : []), 'notify', 'backup'];
  const idx = order.indexOf(step);
  const next = () => {
    const n = order[idx + 1];
    if (n) setStep(n);
    else void finish();
  };
  const finish = async () => {
    await saveSettings({ onboardingDone: true });
    navigate('/home', true);
  };

  const skipAll = (
    <button type="button" className="btn ghost small" onClick={() => void finish()}>
      設定をスキップして始める
    </button>
  );

  return (
    <main style={{ paddingTop: 16 }}>
      <div className="spread">
        <span className="muted small">
          {idx + 1} / {order.length}
        </span>
        {skipAll}
      </div>

      {step === 'welcome' && (
        <Card>
          <h1>Life Partner へようこそ</h1>
          <p>忘れ物チェック・やること・お金の管理を、ひとつのアプリでまとめて手伝います。</p>
          <p className="muted small">最初にかんたんな設定をします。どれもあとから変えられるので、わからないところは飛ばして大丈夫です。</p>
          <p className="banner info small">
            記録はまずこの端末に保存されます。iPhone の場合は <a href={href('/settings/install')}>ホーム画面に追加</a> してから使うのがおすすめです。
          </p>
          <button type="button" className="btn primary block" onClick={next}>
            はじめる
          </button>
        </Card>
      )}

      {step === 'features' && (
        <Card title="使いたい機能を選んでください">
          <p className="muted small">使わない機能は隠せます。あとから変更できます。</p>
          <Toggle label="🎒 忘れ物チェック" checked={f.checklists} onChange={(v) => void saveSettings({ features: { ...f, checklists: v } })} />
          <Toggle label="✏️ タスク（やること）" checked={f.tasks} onChange={(v) => void saveSettings({ features: { ...f, tasks: v } })} />
          <Toggle label="👛 お金の管理" checked={f.money} onChange={(v) => void saveSettings({ features: { ...f, money: v } })} />
          <button type="button" className="btn primary block" style={{ marginTop: 12 }} onClick={next}>
            次へ
          </button>
        </Card>
      )}

      {step === 'checklist' && (
        <Card title="持ち物リストを作りますか？">
          <p className="muted small">よく出かける場面を選ぶと、よく使う持ち物が入ったリストができます。</p>
          {made ? (
            <p className="banner info">「{made}」のリストを作りました。</p>
          ) : (
            <div className="cat-grid">
              {(Object.keys(BUILTIN_TEMPLATES) as Exclude<TemplateType, 'custom'>[]).map((t) => (
                <button
                  key={t}
                  type="button"
                  className="cat-btn"
                  onClick={async () => {
                    await createChecklist('', t);
                    setMade(TEMPLATE_LABELS[t]);
                  }}
                >
                  <span className="emoji" aria-hidden="true">{TEMPLATE_ICONS[t]}</span>
                  {TEMPLATE_LABELS[t]}
                </button>
              ))}
            </div>
          )}
          <button type="button" className="btn primary block" style={{ marginTop: 12 }} onClick={next}>
            {made ? '次へ' : 'あとで作る'}
          </button>
        </Card>
      )}

      {step === 'money' && (
        <>
          <Card>
            <h2>お金の設定</h2>
            <p className="muted small">わかる項目だけ入力してください。空欄のままでも進めます。</p>
          </Card>
          <MoneySetup embedded onDone={next} />
          <button type="button" className="btn ghost block" onClick={next}>
            あとで設定する
          </button>
        </>
      )}

      {step === 'notify' && (
        <Card title="通知">
          <p className="small">リマインダーを設定すると、決まった時刻に「持ち物チェック」などをお知らせします。</p>
          {notificationPermission() === 'default' ? (
            <button
              type="button"
              className="btn block"
              onClick={async () => {
                await requestNotificationPermission();
                next();
              }}
            >
              端末の通知を許可する
            </button>
          ) : notificationPermission() === 'needs-install' ? (
            <p className="muted small">iPhone で端末の通知を受け取るには、ホーム画面に追加してから設定してください。それまではアプリ内でお知らせします。</p>
          ) : null}
          <p className="muted small">リマインダーの時刻は「設定 → 通知・リマインダー」で追加できます。</p>
          <button type="button" className="btn primary block" onClick={next}>
            次へ
          </button>
        </Card>
      )}

      {step === 'backup' && (
        <Card title="データのバックアップ">
          <p className="small">
            いまは<strong>この端末にだけ</strong>保存されます。iPhone の故障や、ホーム画面からアプリを削除したときなどに、データが消えることがあります。
          </p>
          {isCloudConfigured ? (
            <a className="btn block" href={href('/settings/sync')} onClick={() => void saveSettings({ onboardingDone: true })}>
              ☁️ クラウドバックアップを設定する
            </a>
          ) : (
            <p className="muted small">ときどき「設定 → バックアップ」からファイルに書き出しておくと安心です。</p>
          )}
          <button type="button" className="btn primary block" style={{ marginTop: 12 }} onClick={() => void finish()}>
            使い始める
          </button>
        </Card>
      )}
    </main>
  );
}
