import type { TemplateType } from './types';

export const TEMPLATE_LABELS: Record<TemplateType, string> = {
  work: '仕事',
  school: '学校',
  shopping: '買い物',
  hospital: '通院',
  travel: '旅行',
  outing: '日常の外出',
  custom: 'オリジナル',
};

export const TEMPLATE_ICONS: Record<TemplateType, string> = {
  work: '💼',
  school: '🎒',
  shopping: '🛒',
  hospital: '🏥',
  travel: '🧳',
  outing: '🚪',
  custom: '📝',
};

export const BUILTIN_TEMPLATES: Record<Exclude<TemplateType, 'custom'>, string[]> = {
  work: ['スマホ', '財布', '鍵', '社員証', 'イヤホン', '充電器', '飲み物'],
  school: ['スマホ', '財布', '鍵', '学生証', '教科書・ノート', '筆記用具', '定期券'],
  shopping: ['スマホ', '財布', '鍵', 'エコバッグ', '買い物メモ', 'ポイントカード'],
  hospital: ['スマホ', '財布', '鍵', '保険証（マイナ保険証）', '診察券', 'お薬手帳', '聞きたいことのメモ'],
  travel: ['スマホ', '財布', '鍵', '充電器・モバイルバッテリー', '着替え', '洗面用具', '常備薬', 'チケット・予約確認'],
  outing: ['スマホ', '財布', '鍵', 'ハンカチ・ティッシュ', 'マスク'],
};
