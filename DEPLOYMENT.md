# DEPLOYMENT（iPhone だけで公開・管理する手順）

すべて iPhone の Safari で操作できます。パソコンは不要です。
**有料プランへの変更は不要です**（Vercel Hobby・Supabase Free で動作する構成です）。契約内容は各サービスの画面で必ずご自身で確認してください。

---

## 0. 全体の流れ

1. （GitHub）変更を `main` ブランチに取り込む
2. （GitHub Pages または Vercel）公開する → この時点で「端末にのみ保存」モードで使えます
3. （任意・推奨）Supabase を設定し、クラウド同期を有効にする
4. （任意・試験的）Web Push 通知を設定する

---

## 1. GitHub：変更を main に取り込む

1. Safari で github.com を開き、このリポジトリを表示します。
2. 「Pull requests」タブ → Claude が作成したプルリクエストを開きます。
3. 内容と CI（緑のチェック）を確認し、「Merge pull request」→「Confirm merge」。

> Vercel は `main` を「本番」として公開します。プルリクエストごとに「プレビュー URL」も自動で作られるので、マージ前にそこで動作確認もできます。

---

## 2-A. GitHub Pages で公開する（追加のサービス登録なし・いちばん簡単）

公開先：`https://<GitHubのユーザー名>.github.io/seikatusien/`

1. このリポジトリの **Settings → Pages** を開きます。
2. 「Build and deployment」の **Source** を **「GitHub Actions」** に変更します。
   （「Deploy from a branch」のままだと README が表示されるだけで、アプリは動きません）
3. プルリクエストを `main` にマージすると、`Deploy to GitHub Pages` ワークフローが自動で動き、数分で公開されます。
   進み具合は **Actions** タブで確認できます。手動で動かすときは Actions →「Deploy to GitHub Pages」→「Run workflow」。
4. 公開 URL を Safari で開き、ホーム画面に追加します。

Supabase を使う場合（3章のあと）：**Settings → Secrets and variables → Actions → Variables** に
`VITE_SUPABASE_URL` と `VITE_SUPABASE_ANON_KEY` を登録し、もう一度ワークフローを実行します（anon キーは公開してよいキーです。service_role キーは登録しないでください）。
Supabase の「Authentication → URL Configuration」の Site URL には Pages の URL を入れてください。

> GitHub Pages ではレスポンスヘッダーを設定できないため、CSP は HTML 内の `<meta>` で設定しています（`frame-ancestors` 等の一部はヘッダーでしか効かず、Vercel の方がやや堅くなります）。
> 非公開リポジトリで Pages を使うには GitHub の有料プランが必要な場合があります。

Vercel を使う場合は次の 2-B へ。どちらか一方で十分です。

## 2-B. Vercel：公開する

1. Safari で **vercel.com** を開き、「Sign Up」→「Continue with GitHub」。
2. 「Add New…」→「Project」→ このリポジトリの「Import」。
   - GitHub へのアクセス許可を求められたら、このリポジトリだけを許可すれば十分です。
3. 設定画面：
   - Framework Preset：**Vite**（自動で選ばれます）
   - Build Command：`npm run build`／Output Directory：`dist`（`vercel.json` で設定済み）
   - Environment Variables：Supabase をまだ設定しない場合は空のままで OK
4. 「Deploy」を押し、数分待ちます。表示された URL（例 `https://xxxx.vercel.app`）を開けば完成です。
5. iPhone のホーム画面に追加します（アプリ内「設定 > ホーム画面に追加する方法」参照）。

以後、`main` に変更が入るたびに自動で再公開されます。利用中のアプリには「新しいバージョンがあります → 更新」が表示され、押すと切り替わります（データはそのまま残ります）。

---

## 3. Supabase：クラウド同期を有効にする（推奨）

### 3-1. プロジェクトを作る
1. Safari で **supabase.com** →「Start your project」→「Continue with GitHub」。
2. 「New project」
   - Name：`life-partner` など
   - Database Password：「Generate a password」を押し、iPhone のパスワード管理に保存
   - Region：**Northeast Asia (Tokyo)**
   - Plan：Free
3. 「Create new project」を押し、準備完了まで数分待ちます。

### 3-2. データベースを作る（SQL を2つ実行）
1. GitHub でリポジトリの `supabase/migrations/20261124000000_init.sql` を開き、「Raw」を押します。
2. 画面を長押し →「すべてを選択」→「コピー」。
3. Supabase の左メニュー「SQL Editor」→「New query」に貼り付け →「Run」。「Success」と出れば OK。
4. 同じ手順で `supabase/migrations/20261124000100_rls.sql` を実行します。
5. 確認：左メニュー「Table Editor」に `records` があり、「RLS enabled」になっていること。

> 2回実行しても壊れないように作ってあります。途中で失敗したら、もう一度最初から実行してください。

### 3-3. ログインの設定
1. 左メニュー「Authentication」→「Sign In / Providers」→ **Email** が有効になっていることを確認。
2. 「Authentication」→「URL Configuration」
   - Site URL：Vercel の URL（例 `https://xxxx.vercel.app`）
   - Redirect URLs：同じ URL を追加
3. メール確認について：
   - 有効（初期値）の場合：登録後に届くメールのリンクを開く必要があります。リンクは Safari で開きますが、確認が終わったら **ホーム画面のアプリに戻って「ログイン」** すれば使えます。
   - 推奨設定：「Authentication > Sign In / Providers > Email」で「Minimum password length」を 8 以上にしてください。

### 3-4. Vercel に接続情報を設定
1. Supabase 左下「Project Settings」→「API」（または「Data API」）。
2. 次の2つをコピーします：
   - **Project URL**（`https://xxxx.supabase.co`）
   - **anon public** キー（「Publishable」と表示される場合もあります）
   - ⚠️ **service_role（secret）キーは絶対に使わないでください。**
3. Vercel → プロジェクト →「Settings」→「Environment Variables」で追加：
   - `VITE_SUPABASE_URL` ＝ Project URL
   - `VITE_SUPABASE_ANON_KEY` ＝ anon public キー
   - Environment は Production / Preview の両方にチェック
4. 「Deployments」→ 最新の「…」→「Redeploy」。
5. アプリの「設定 > 保存と同期」に「クラウドバックアップ」のログイン画面が出れば成功です。

### 3-5. 動作確認
- アカウントを作成 → 何か記録 →「今すぐ同期」→「クラウドと同期済み」になること。
- Supabase の「Table Editor > records」に行が増えていること（中身は JSON）。

---

## 4. Web Push 通知（任意・試験的・未検証）

アプリを閉じていても通知を届けるための設定です。**この機能はクラウド開発環境では検証できていません。** 設定しなくても、アプリ内のお知らせは動作します。

1. VAPID 鍵（公開鍵・秘密鍵の組）を用意します。
   - Claude Code に「VAPID 鍵を生成して」と依頼すると `npx web-push generate-vapid-keys` で作れます。ただし秘密鍵が会話に残るため、気になる場合は信頼できる別の方法で生成してください。
2. Supabase「Edge Functions」→「Secrets」に追加：
   `VAPID_PUBLIC_KEY`、`VAPID_PRIVATE_KEY`、`VAPID_SUBJECT`（例 `mailto:自分のメール`）、`CRON_SECRET`（長いランダム文字列）
3. Edge Function `send-reminders` をデプロイ（`supabase/functions/send-reminders/index.ts`）。
   ダッシュボードの「Edge Functions」→「Deploy a new function」→「Via Editor」に貼り付けてデプロイできます。
4. 「Database > Extensions」で `pg_cron` と `pg_net` を有効化し、`supabase/optional/push_cron.sql` の `<PROJECT_REF>` と `<CRON_SECRET>` を置き換えて SQL Editor で実行。
5. Vercel に `VITE_VAPID_PUBLIC_KEY`（公開鍵）を追加して Redeploy。
6. iPhone：ホーム画面のアプリ →「設定 > 通知・リマインダー」→ 通知を許可 →「アプリを閉じていても通知を受け取る」。
7. IPHONE_TEST.md の「通知」の項目で受信を確認してください。

---

## 5. トラブルシューティング

| 症状 | 対処 |
|---|---|
| 画面が古いまま | アプリ上部の「更新」を押す。出ない場合は「設定 > データの削除・アプリの更新 > キャッシュを消して読み込み直す」（データは消えません） |
| 「同期できませんでした」 | 端末には保存されています。電波の良い場所で「今すぐ同期」。続く場合は Vercel の環境変数と Supabase の SQL 実行を確認 |
| ログインできない | メール確認が済んでいるか、パスワードが正しいかを確認 |
| ビルドが失敗する | Vercel の「Deployments > 失敗したもの > Build Logs」を Claude Code に貼り付けて相談 |

## 6. ローカル（開発者向け）

```bash
cp .env.example .env.local   # 値を設定
npm install
npm run dev
```
