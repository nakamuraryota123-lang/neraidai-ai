# 狙い台AI v0.6

毎日のパチスロデータをスクリーンショットからまとめて入力し、確認・修正後に端末へ保存して狙い台ランキングを再計算する、GitHub Pages対応の静的PWAです。

## v0.6の主な変更

- 配置、末尾、曜日、前日不発後の実績からホールの癖候補を分析
- 稼働あり・最大放出2,000枚以上を代理的中として母数と的中率を表示
- 少数サンプルを抑制した最大20点のホール傾向スコアをランキングへ加点
- 癖分析の信頼度を低・中・高で表示
- 予想日より後のデータを使わず、予想スナップショットへ傾向根拠も固定保存

## v0.5の主な変更

- ランキングの狙い根拠とAIスコア内訳を展開表示
- 翌日分の予想ランキングを再計算しないスナップショットとして保存
- 翌日の実績入力後、上位3台を最大放出2,000枚基準で自動評価（0G除外）
- 的中率、良かった点、反省点、次回改善案を表示
- `records`、`deletedRecordIds`、`predictions`をGoogle Driveへ後方互換同期

## v0.4で追加した機能

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
