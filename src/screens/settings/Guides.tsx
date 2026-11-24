import { PageHead, Card } from '../../ui/components';
import { href } from '../../ui/router';
import { isIOS, isStandalone } from '../../notify/notifier';
import { isCloudConfigured } from '../../sync/supabase';

export function InstallGuide() {
  const standalone = isStandalone();
  return (
    <main>
      <PageHead title="ホーム画面に追加する方法" back="/settings" />
      {standalone && <p className="banner info">いまはホーム画面から開いています。設定は完了しています 👍</p>}
      <Card title="iPhone（Safari）" icon="🍎">
        <ol className="steps">
          <li>
            <strong>Safari</strong> でこのアプリのページを開きます（Chrome など他のアプリからは追加できない場合があります）。
          </li>
          <li>
            画面下（または上）の <strong>共有ボタン</strong>（四角から上向きの矢印）を押します。
          </li>
          <li>
            メニューを下にスクロールして <strong>「ホーム画面に追加」</strong> を押します。
          </li>
          <li>
            右上の <strong>「追加」</strong> を押します。
          </li>
          <li>ホーム画面にできた「Life Partner」のアイコンから開きます。</li>
        </ol>
        <p className="banner warn small">
          iPhone では、Safari で開いたときと、ホーム画面のアイコンから開いたときで<strong>データの保存場所が別々</strong>です。追加したあとは、いつもホーム画面のアイコンから開いてください。
          Safari で入力したデータを移したいときは、Safari 側で <a href={href('/settings/backup')}>バックアップを書き出し</a>、ホーム画面のアプリで読み込んでください。
        </p>
      </Card>
      <Card title="Android（Chrome）" icon="🤖">
        <ol className="steps">
          <li>Chrome でこのアプリのページを開きます。</li>
          <li>右上の「︙」メニューを押します。</li>
          <li>「ホーム画面に追加」または「アプリをインストール」を押します。</li>
        </ol>
      </Card>
      <Card title="ホーム画面に追加すると" icon="✨">
        <ul className="small" style={{ paddingLeft: '1.2em', margin: 0 }}>
          <li>アプリのように全画面で使えます。</li>
          <li>通信がない場所（機内モードなど）でも開けます。</li>
          <li>iOS 16.4 以降では、通知を受け取れるようになります。</li>
        </ul>
      </Card>
      {isIOS() && !standalone && <p className="muted small center">この画面は Safari で表示されています。</p>}
    </main>
  );
}

export function PrivacyPage() {
  return (
    <main>
      <PageHead title="プライバシーについて" back="/settings" />
      <Card title="基本の考え方" icon="🔒">
        <ul className="small" style={{ paddingLeft: '1.2em', margin: 0 }}>
          <li>広告、アクセス解析、利用状況の追跡は入れていません。</li>
          <li>開発者が利用者の記録を見るための機能はありません。</li>
          <li>記録の内容を外部のAIサービスなどに送ることはありません。</li>
          <li>体重の記録も、ほかの記録と同じように扱います。健康に関わる情報なので、端末やバックアップファイルの扱いに気をつけてください。</li>
          <li>エラーの記録にも、金額やタスクの内容などの個人情報は書き出しません。</li>
        </ul>
      </Card>
      <Card title="この端末だけで使う場合" icon="📱">
        <p className="small">記録はこの端末のブラウザ内（IndexedDB）にだけ保存され、外部に送信されません。端末を他の人と共用している場合、その人がこのアプリを開くと記録を見られることがあります。</p>
      </Card>
      <Card title="クラウド同期を使う場合" icon="☁️">
        <ul className="small" style={{ paddingLeft: '1.2em', margin: 0 }}>
          <li>記録は Supabase（クラウドデータベースのサービス）に、通信を暗号化（HTTPS）して送られます。</li>
          <li>データベースの設定（行レベルセキュリティ）により、ログインした本人以外は記録を読み書きできません。</li>
          <li>
            ただし、<strong>サービスを運営する Supabase 社や、このアプリのデータベースを管理する人（運営者）は、技術的にはデータベースの中身にアクセスできます</strong>。記録はアプリ側で暗号化していません（エンドツーエンド暗号化ではありません）。
          </li>
          <li>パスワードは Supabase の認証機能で管理され、このアプリが独自に保存することはありません。</li>
          <li>「保存と同期」からいつでもアカウントとクラウドのデータを削除できます。</li>
        </ul>
        {!isCloudConfigured && <p className="muted small" style={{ marginTop: 8, marginBottom: 0 }}>このアプリでは、現在クラウド同期は設定されていません。</p>}
      </Card>
      <Card title="バックアップファイル" icon="💾">
        <p className="small" style={{ margin: 0 }}>書き出したファイルには記録がそのまま（暗号化せずに）入っています。保存先や送る相手に気をつけてください。</p>
      </Card>
    </main>
  );
}

export function ManualPage() {
  return (
    <main>
      <PageHead title="かんたん使い方ガイド" back="/settings" />
      <Card title="ホーム" icon="🏠">
        <p className="small" style={{ margin: 0 }}>今日の日付、今日使える金額、持ち物チェック、今日やること、これからの予定がまとまっています。ホームから直接チェックや支出の記録ができます。</p>
      </Card>
      <Card title="忘れ物チェック" icon="🎒">
        <ul className="small" style={{ paddingLeft: '1.2em', margin: 0 }}>
          <li>「リストを作る」から、仕事・通院などのひな形を選べます。</li>
          <li>持ち物を押すとチェックが付き、すぐに保存されます。</li>
          <li>毎日決まった時刻（初期設定は朝4時）にチェックが外れます。履歴は残ります。</li>
          <li>右上の歯車から、名前・リセット時刻・ひな形として保存・削除ができます。</li>
        </ul>
      </Card>
      <Card title="タスク" icon="✏️">
        <ul className="small" style={{ paddingLeft: '1.2em', margin: 0 }}>
          <li>「追加」から、やることと「いつやるか」を選ぶだけで登録できます。</li>
          <li>大きなタスクは「小さなステップ」に分けると取りかかりやすくなります。</li>
          <li>終わらなかったタスクは、次の日に自動で繰り越されます。「明日に回す」もできます。</li>
          <li>「集中モード」では、いま取り組む1つだけを大きく表示します。</li>
        </ul>
      </Card>
      <Card title="お金" icon="👛">
        <ul className="small" style={{ paddingLeft: '1.2em', margin: 0 }}>
          <li>最初に「いまの残高」「給料日」「予算」を登録すると、今日使える金額の目安が出ます。</li>
          <li>支出は、金額を入れてカテゴリーを押すだけで記録できます。</li>
          <li>家賃などの固定費を登録し、払ったら「支払った」を押してください。</li>
          <li>「計算の内訳」で、目安額の計算方法を確認できます。</li>
          <li>残高がずれてきたら「残高を登録し直す」で、いまの金額に合わせられます。</li>
        </ul>
      </Card>
      <Card title="データを守るために" icon="💾">
        <ul className="small" style={{ paddingLeft: '1.2em', margin: 0 }}>
          <li>クラウド同期を使うか、ときどきバックアップを書き出してください。</li>
          <li>間違えて消したときは、画面下に出る「元に戻す」を押してください。</li>
        </ul>
      </Card>
    </main>
  );
}
