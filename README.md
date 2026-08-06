# 狙い台AI v0.4

毎日のパチスロデータをスクリーンショットからまとめて入力し、確認・修正後に端末へ保存して狙い台ランキングを再計算する、GitHub Pages対応の静的PWAです。

## v0.4の主な変更

- 起動直後に入力画面を表示
- 複数スクリーンショットの選択・プレビュー・一括AI読取
- 読取結果を表形式で確認・修正して一括保存
- 日付、ホール、機種、配置番号、台番号、総回転数、BIG、REG、最大放出、グラフ形状、メモを保存
- 元画像をブラウザのIndexedDBへ保存
- 保存直後にランキングを再計算
- v0.3のlocalStorage記録を初回読込時に移行

## 使い方

1. 「入力」で複数のスクリーンショットを選択します。
2. 「AIでまとめて読み取る」を押します。
3. 表の内容を確認・修正して保存します。

手入力や未稼働データ（総回転数0）の保存も可能です。未稼働データは履歴に残り、ランキングの点数は0点になります。

## 保存とセキュリティ

- 記録と設定: `localStorage`
- 元スクリーンショット: `IndexedDB`
- OpenAI APIキーはCloudflare WorkerのSecret `OPENAI_API_KEY`だけに保存し、ブラウザー、ソースコード、JSON出力には含めません。
- ブラウザーはOpenAI APIを直接呼び出さず、固定のWorkerエンドポイントを呼び出します。
- `.env*` とローカルCLI設定 `.gh/` はGit管理対象外です。

## AIバックエンド

`worker/`はCloudflare Workers向けです。許可するOriginを公開中のGitHub Pagesへ固定し、1リクエスト8画像・合計25MBまで、同一接続元は1分10回までに制限しています。

```powershell
npx wrangler login
npx wrangler secret put OPENAI_API_KEY --config worker/wrangler.jsonc
npx wrangler deploy --config worker/wrangler.jsonc
```

本番エンドポイントは`https://neraidai-ai-api.neraidai-ai-nakamuraryota.workers.dev/v1/analyze`です。APIキーを`.dev.vars`やコマンド履歴へ直接書かないでください。

## GitHub Pages

外部ビルドは不要です。リポジトリの Settings → Pages で `main` ブランチのルートを公開元に設定してください。Service Workerは相対パスで動作します。
