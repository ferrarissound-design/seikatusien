import { useState } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { getDb } from '../db/db';
import { PageHead, Card, CheckRow, ProgressBar, Sheet, Empty, AddInline, Confirm, Toggle } from '../ui/components';
import { Icon } from '../ui/Icon';
import { href, navigate, useRoute } from '../ui/router';
import { TEMPLATE_ICONS, TEMPLATE_LABELS, BUILTIN_TEMPLATES } from '../db/templates';
import {
  createChecklist,
  addCheckItem,
  toggleCheckItem,
  resetChecklistNow,
  reorder,
  deleteWithUndo,
  saveAsTemplate,
} from '../db/actions';
import { updateRecord } from '../db/repo';
import type { Checklist, CheckItem, TemplateType } from '../db/types';
import { formatJa, isValidTime } from '../lib/date';
import { toast } from '../lib/events';

export function ChecklistsScreen() {
  const route = useRoute();
  const id = route.path[1];
  if (id === 'history') return <ChecklistHistory checklistId={route.path[2]} />;
  if (id) return <ChecklistDetail id={id} />;
  return <ChecklistIndex openNew={route.query.get('new') === '1'} />;
}

function useLists() {
  return useLiveQuery(async () => {
    const db = getDb();
    const lists = (await db.checklists.toArray()).filter((c) => !c.deleted).sort((a, b) => a.sortOrder - b.sortOrder);
    const items = (await db.checkItems.toArray()).filter((i) => !i.deleted);
    return { lists, items };
  }, []);
}

function ChecklistIndex({ openNew }: { openNew: boolean }) {
  const data = useLists();
  const [creating, setCreating] = useState(openNew);
  if (!data) return null;
  const lists = data.lists.filter((l) => !l.isTemplate);
  return (
    <main>
      <PageHead
        title="忘れ物チェック"
        right={
          <a className="icon-btn" href={href('/checklists/history')} aria-label="チェック履歴">
            <Icon name="history" />
          </a>
        }
      />
      {lists.length === 0 && (
        <Card>
          <Empty emoji="🎒">
            <p>出かける前に確認したい持ち物のリストを作りましょう。</p>
            <p className="small">「仕事」「通院」などのひな形から選べます。</p>
          </Empty>
        </Card>
      )}
      {lists.map((l) => {
        const items = data.items.filter((i) => i.checklistId === l.id);
        const done = items.filter((i) => i.checked).length;
        return (
          <a key={l.id} className="card" href={href(`/checklists/${l.id}`)} style={{ display: 'block', textDecoration: 'none', color: 'inherit' }}>
            <div className="spread">
              <strong>
                <span aria-hidden="true">{TEMPLATE_ICONS[l.templateType]} </span>
                {l.name}
              </strong>
              <span className="num muted small">
                {done} / {items.length}
                {items.length > 0 && done === items.length && ' ✅'}
              </span>
            </div>
            <div style={{ marginTop: 8 }}>
              <ProgressBar value={done} max={items.length} label={`${l.name}の確認状況`} />
            </div>
            {l.resetTime && <div className="muted small" style={{ marginTop: 6 }}>毎日 {l.resetTime} にチェックを外します</div>}
          </a>
        );
      })}
      <button type="button" className="btn primary fab" onClick={() => setCreating(true)}>
        <Icon name="plus" /> リストを作る
      </button>
      {creating && <CreateChecklistSheet templates={data.lists.filter((l) => l.isTemplate)} onClose={() => setCreating(false)} />}
    </main>
  );
}

function CreateChecklistSheet({ onClose, templates }: { onClose: () => void; templates: Checklist[] }) {
  const [name, setName] = useState('');
  const create = async (type: TemplateType, fromTemplateId?: string, tplName?: string) => {
    const list = await createChecklist(name || tplName || '', type, undefined, fromTemplateId);
    onClose();
    navigate(`/checklists/${list.id}`, true);
  };
  return (
    <Sheet title="リストを作る" onClose={onClose}>
      <label className="field">
        <span>リストの名前（空欄ならひな形の名前）</span>
        <input type="text" value={name} maxLength={100} onChange={(e) => setName(e.target.value)} placeholder="例：平日の朝" />
      </label>
      <p className="muted small">ひな形を選ぶと、よく使う持ち物が最初から入ります（あとで編集できます）。</p>
      <div className="cat-grid" style={{ marginBottom: 12 }}>
        {(Object.keys(BUILTIN_TEMPLATES) as Exclude<TemplateType, 'custom'>[]).map((t) => (
          <button key={t} type="button" className="cat-btn" onClick={() => void create(t)}>
            <span className="emoji" aria-hidden="true">{TEMPLATE_ICONS[t]}</span>
            {TEMPLATE_LABELS[t]}
          </button>
        ))}
        <button type="button" className="cat-btn" onClick={() => void create('custom')}>
          <span className="emoji" aria-hidden="true">📝</span>
          空のリスト
        </button>
      </div>
      {templates.length > 0 && (
        <>
          <h3>自分のひな形</h3>
          <div className="cat-grid">
            {templates.map((t) => (
              <button key={t.id} type="button" className="cat-btn" onClick={() => void create('custom', t.id, t.name)}>
                <span className="emoji" aria-hidden="true">⭐</span>
                {t.name}
              </button>
            ))}
          </div>
        </>
      )}
    </Sheet>
  );
}

function ChecklistDetail({ id }: { id: string }) {
  const data = useLiveQuery(async () => {
    const db = getDb();
    const list = await db.checklists.get(id);
    const items = (await db.checkItems.where('checklistId').equals(id).toArray()).filter((i) => !i.deleted).sort((a, b) => a.sortOrder - b.sortOrder);
    return { list, items };
  }, [id]);
  const [sorting, setSorting] = useState(false);
  const [editing, setEditing] = useState<CheckItem | null>(null);
  const [settingsOpen, setSettingsOpen] = useState(false);
  if (!data) return null;
  const { list, items } = data;
  if (!list || list.deleted) {
    return (
      <main>
        <PageHead title="忘れ物チェック" back="/checklists" />
        <Empty emoji="🔍">このリストは見つかりませんでした。</Empty>
      </main>
    );
  }
  const done = items.filter((i) => i.checked).length;
  const allDone = items.length > 0 && done === items.length;

  const move = async (index: number, dir: -1 | 1) => {
    const j = index + dir;
    if (j < 0 || j >= items.length) return;
    const ids = items.map((i) => i.id);
    [ids[index], ids[j]] = [ids[j], ids[index]];
    await reorder('checkItems', ids);
  };

  return (
    <main>
      <PageHead
        title={list.name}
        back="/checklists"
        right={
          <button type="button" className="icon-btn" aria-label="リストの設定" onClick={() => setSettingsOpen(true)}>
            <Icon name="gear" />
          </button>
        }
      />
      {list.isTemplate ? <p className="banner info">これは自分のひな形です。新しいリストを作るときに使えます。</p> : null}
      <Card>
        <div className="spread" style={{ marginBottom: 6 }}>
          <span className="muted">確認済み</span>
          <span className="num" aria-live="polite" style={{ fontWeight: 700 }}>
            {done} / {items.length}
          </span>
        </div>
        <ProgressBar value={done} max={items.length} label="確認状況" />
        {allDone && (
          <p className="banner info" style={{ marginTop: 12, marginBottom: 0 }} role="status">
            <span aria-hidden="true">✅ </span>ぜんぶ確認できました。
          </p>
        )}
      </Card>

      <Card
        action={
          items.length > 1 && (
            <button type="button" className="btn ghost small" onClick={() => setSorting((s) => !s)} aria-pressed={sorting}>
              <Icon name="sort" size={18} /> {sorting ? '並び替え終了' : '並び替え'}
            </button>
          )
        }
        title="持ち物"
      >
        {items.length === 0 && <p className="muted">下の欄から持ち物を追加してください。</p>}
        <ul className="list">
          {items.map((it, i) => (
            <li key={it.id} className="row">
              <div className="grow">
                {sorting ? (
                  <div className="check-row" style={{ cursor: 'default' }}>
                    <span className="label-text">{it.label}</span>
                  </div>
                ) : (
                  <CheckRow checked={!!it.checked} label={it.label} onToggle={() => void toggleCheckItem(it)} />
                )}
              </div>
              {sorting ? (
                <>
                  <button type="button" className="icon-btn" aria-label={`${it.label}を上へ`} disabled={i === 0} onClick={() => void move(i, -1)}>
                    <Icon name="up" />
                  </button>
                  <button type="button" className="icon-btn" aria-label={`${it.label}を下へ`} disabled={i === items.length - 1} onClick={() => void move(i, 1)}>
                    <Icon name="down" />
                  </button>
                </>
              ) : (
                <button type="button" className="icon-btn" aria-label={`${it.label}を編集`} onClick={() => setEditing(it)}>
                  <Icon name="edit" size={20} />
                </button>
              )}
            </li>
          ))}
        </ul>
        <div style={{ marginTop: 12 }}>
          <AddInline label="持ち物を追加" placeholder="持ち物を追加" onAdd={(v) => addCheckItem(list.id, v)} />
        </div>
      </Card>

      <div className="row wrap" style={{ marginTop: 12 }}>
        <button type="button" className="btn grow" onClick={() => void resetChecklistNow(list.id)} disabled={done === 0}>
          <Icon name="undo" size={20} /> チェックを外す
        </button>
        <a className="btn grow" href={href(`/checklists/history/${list.id}`)}>
          <Icon name="history" size={20} /> 履歴
        </a>
      </div>

      {editing && <EditItemSheet item={editing} onClose={() => setEditing(null)} />}
      {settingsOpen && <ChecklistSettingsSheet list={list} onClose={() => setSettingsOpen(false)} />}
    </main>
  );
}

function EditItemSheet({ item, onClose }: { item: CheckItem; onClose: () => void }) {
  const [label, setLabel] = useState(item.label);
  const save = async () => {
    if (!label.trim()) return;
    await updateRecord<CheckItem>('checkItems', item.id, { label: label.trim().slice(0, 200) });
    onClose();
  };
  return (
    <Sheet
      title="持ち物を編集"
      onClose={onClose}
      actions={
        <>
          <button
            type="button"
            className="btn danger"
            onClick={() => {
              void deleteWithUndo('checkItems', item.id, `「${item.label}」`);
              onClose();
            }}
          >
            <Icon name="trash" size={20} /> 削除
          </button>
          <button type="button" className="btn primary" onClick={() => void save()} disabled={!label.trim()}>
            保存
          </button>
        </>
      }
    >
      <label className="field">
        <span>名前</span>
        <input type="text" value={label} maxLength={200} onChange={(e) => setLabel(e.target.value)} data-autofocus="true" />
      </label>
    </Sheet>
  );
}

function ChecklistSettingsSheet({ list, onClose }: { list: Checklist; onClose: () => void }) {
  const [name, setName] = useState(list.name);
  const [resetOn, setResetOn] = useState(!!list.resetTime);
  const [time, setTime] = useState(list.resetTime ?? '04:00');
  const [home, setHome] = useState(list.showOnHome !== 0);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const save = async () => {
    await updateRecord<Checklist>('checklists', list.id, {
      name: name.trim() || list.name,
      resetTime: resetOn && isValidTime(time) ? time : null,
      showOnHome: home ? 1 : 0,
    });
    onClose();
  };
  if (confirmDelete) {
    return (
      <Confirm
        title="リストを削除しますか？"
        message={<p>「{list.name}」を削除します。チェック履歴は残ります。削除直後なら「元に戻す」で戻せます。</p>}
        confirmLabel="削除する"
        danger
        onCancel={() => setConfirmDelete(false)}
        onConfirm={() => {
          void deleteWithUndo('checklists', list.id, `「${list.name}」`);
          onClose();
          navigate('/checklists', true);
        }}
      />
    );
  }
  return (
    <Sheet
      title="リストの設定"
      onClose={onClose}
      actions={
        <button type="button" className="btn primary" onClick={() => void save()}>
          保存
        </button>
      }
    >
      <label className="field">
        <span>リストの名前</span>
        <input type="text" value={name} maxLength={100} onChange={(e) => setName(e.target.value)} />
      </label>
      {!list.isTemplate && (
        <>
          <Toggle label="毎日チェックを外す" description="指定した時刻を過ぎると、チェックを自動で外します（履歴は残ります）" checked={resetOn} onChange={setResetOn} />
          {resetOn && (
            <label className="field">
              <span>リセットする時刻</span>
              <input type="time" value={time} onChange={(e) => setTime(e.target.value)} />
            </label>
          )}
          <Toggle label="ホームに表示する" checked={home} onChange={setHome} />
          <div className="divider" />
          <button
            type="button"
            className="btn block"
            onClick={async () => {
              await saveAsTemplate(list.id, `${list.name}`);
              toast('ひな形として保存しました。新しいリストを作るときに選べます。');
              onClose();
            }}
          >
            ⭐ ひな形として保存
          </button>
        </>
      )}
      <button type="button" className="btn danger block" style={{ marginTop: 12 }} onClick={() => setConfirmDelete(true)}>
        <Icon name="trash" size={20} /> このリストを削除
      </button>
    </Sheet>
  );
}

function ChecklistHistory({ checklistId }: { checklistId?: string }) {
  const history = useLiveQuery(async () => {
    const all = await getDb().checkHistory.orderBy('date').reverse().toArray();
    return all.filter((h) => !h.deleted && (!checklistId || h.checklistId === checklistId)).slice(0, 200);
  }, [checklistId]);
  return (
    <main>
      <PageHead title="チェック履歴" back={checklistId ? `/checklists/${checklistId}` : '/checklists'} />
      {!history?.length ? (
        <Empty emoji="🗓️">まだ履歴はありません。全部確認したときや、毎日のリセット時に記録されます。</Empty>
      ) : (
        history.map((h) => (
          <Card key={h.id}>
            <div className="spread">
              <strong>{formatJa(h.date)}</strong>
              <span className={`tag ${h.checkedCount === h.totalCount ? 'primary' : ''}`}>
                {h.checkedCount === h.totalCount ? '✅ ぜんぶ確認' : `${h.checkedCount} / ${h.totalCount}`}
              </span>
            </div>
            <div className="muted small">{h.checklistName}</div>
            <details className="disclosure">
              <summary>内訳を見る</summary>
              <ul className="small" style={{ margin: 0, paddingLeft: '1.2em' }}>
                {h.items.map((i, k) => (
                  <li key={k}>
                    {i.checked ? '☑' : '☐'} {i.label}
                  </li>
                ))}
              </ul>
            </details>
          </Card>
        ))
      )}
    </main>
  );
}
