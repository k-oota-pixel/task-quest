# 教材別利用回数の差分集計 — Firestore インデックス

管理画面の教材別利用回数を初回の全件集計後は増分のみで更新するため、以下の単一フィールドインデックスが必要です。

- コレクショングループID: `events`
- フィールド: `recordedAt`
- スコープ: **コレクショングループ** (Collection group)
- 並び順: **昇順** (Ascending)

Firestore コンソールの **Indexes → Single field → Add exemption / Add field override** で、`events` / `recordedAt` / Collection group / Ascending を追加し、ビルド完了を確認してください。

※ このインデックスはリポジトリへのコード反映だけでは作成されません。
※ 既存の複合インデックス設定を把握せずに、空の `indexes` 配列を含む `firestore.indexes.json` をデプロイすると既存設定を削除する恐れがあるため、インデックス管理ファイルの全置換は行いません。

初回集計は従来の履歴を一度だけ読んで `analytics/material-usage-snapshot-v2` に保存します。以降は、タイムスタンプが前回の集計範囲に入っていなかった新しいレシートを対象にします。読み落としを避けるため、集計は現在より60秒前までの記録が対象です。
