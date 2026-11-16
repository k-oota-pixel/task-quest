# 英語レベル判定の差分集計：Firestoreインデックス

差分集計は `users/{uid}/apps/english-playroom` の既存フィールド
`assessmentUpdatedAt`（受験結果保存時の serverTimestamp）を使います。
受験者側には新たな write は不要です。

## 一度だけ行う設定

Firebase Console → Firestore Database → インデックス → 「単一フィールド」で、以下の設定を追加します。

- コレクション ID: `apps`
- フィールドパス: `assessmentUpdatedAt`
- クエリスコープ: **コレクショングループ**
- 並べ替え: **昇順（Ascending）**

単一フィールドの Collection Group Scope のインデックスです。
`apps` の全サブコレクションに適用されますが、
実際の検索は `assessmentUpdatedAt` があるデータだけを返します。

Firebase CLI で既存のインデックス定義を管理している場合は、
既存の `firestore.indexes.json` の `fieldOverrides` に
次の設定を **マージ** してください（既存定義を上書きしないこと）。

```json
{
  "collectionGroup": "apps",
  "fieldPath": "assessmentUpdatedAt",
  "indexes": [
    {"order": "ASCENDING", "queryScope": "COLLECTION"},
    {"order": "DESCENDING", "queryScope": "COLLECTION"},
    {"order": "ASCENDING", "queryScope": "COLLECTION_GROUP"}
  ]
}
```

## 動作とread

- 初回更新：従来の統計には利用者別の内訳がないため、管理者以外の利用者の
  `assessmentLatest` だけをバッチ取得し、利用者別の前回スコアを
  管理者用集計ドキュメントへ保存します（人数分のread＋1write）。
- 2回目以降：このインデックスで `assessmentUpdatedAt` が
  前回集計以降のドキュメントのみ検索し、該当者の点数だけ置き換えます。
  Aさんだけ1回再受験なら概ね1件の変更を取得（＋集計ドキュメント1read＋1write）。
- 変更がなければ集計ドキュメントを書き換えません。
- インデックスが未作成の場合、管理APIは HTTP 412 を返し、
  **全ユーザーの再読込にフォールバックしません**。
- このインデックスは新しいデータ保存を要求しません。
- 最新版の英語レベル判定 `pilot-2-grade2` のみを集計します。
  旧尺度 `pilot-1` のスコアと混在させません。

※Firestoreコンソール側のインデックス作成は、このリポジトリへの
コード反映とは別作業です。Firestore設定完了前に差分更新すると412が返ります。
