# もんすたでぃ オンライン対戦の Realtime Database 検証版

## 現行の構成

- GitHub Pages の [対戦画面](https://github.com/k-oota-pixel/english-playroom/blob/main/pet-adventure/online-battle.js) は Firebase Authentication の ID トークンを付けて Render の `task-quest` にアクセスする。対戦中は1秒、待機中は2.5秒、級別ロビーは15秒間隔。画面非表示または一定時間無操作で定期更新を停止する。
- Render で稼働を確認したバックエンドは [`9f6637c`](https://github.com/k-oota-pixel/task-quest/tree/9f6637c4149dac7c467bd2395193722073a7ee55)。Render の無料サービスで、`main` が本番に接続している。
- [認証処理](https://github.com/k-oota-pixel/task-quest/blob/9f6637c4149dac7c467bd2395193722073a7ee55/request-auth.mjs) はリクエストごとに Firebase の本人確認を行い、登録可否の結果を対戦用にキャッシュする。対戦画面が Firebase② に直接ログインする経路はない。
- [対戦処理](https://github.com/k-oota-pixel/task-quest/blob/9f6637c4149dac7c467bd2395193722073a7ee55/online-battle.mjs) は、対戦用のサービスアカウントとプロジェクトが設定されていればルーム、ロビー、成績、ランキングに Firebase② を使う。Firebase① の利用者ドキュメントから入室時にペット情報・所持品を読み、終了時に勝者1コイン、使用アイテム、称号を精算する。精算IDの新規作成と利用者の更新は同じ Firestore コミットに含まれる。
- 各ルームの定期 GET は通常、ルーム1件の読み取り。対戦中の2人が同じ部屋を1分間開くと、現行の1秒間隔では操作分を除いて最大約120件のルーム読み取りになる。攻撃などの操作はルームを読み取り、更新条件付きで書き込む。ロビーの更新は部屋の状態・人数の変化時。終了時は成績、財布、精算記録を扱い、称号の旧成績取り込み時だけ他の級の読み取りが増える。

## 検証版

`online-battle.mjs` の `roomStore` を検証用サービスから渡すと、部屋の読み書きが Realtime Database に切り替わる。2人の操作が同時に来る場合は ETag が一致する更新だけが保存され、競合した操作は最新の部屋を読み直して判定される。攻撃等は試合IDを照合する。操作順序は保存が確定した順で、端末の時計は使わない。

検証ページ `pet-adventure/online-battle-preview.html` は既存のログインを使い、Render の `/api/online-battle-preview` に接続する。対戦状態は Render が Realtime Database から購読し、認証済みの参加者に配信する。各参加者に配る情報から相手の所持品、コイン、称号を除く。

検証 API は Render に `BATTLE_RTDB_PREVIEW_URL`、`BATTLE_RTDB_PREVIEW_UIDS`（検証用 Firebase Authentication UID のカンマ区切り）、`BATTLE_RTDB_PREVIEW_SERVICE_ACCOUNT_B64` のすべてが設定されたときだけ有効になる。現行の `/api/online-battle` は別のサービスインスタンスとして Firestore を使う。検証用の財布は Firebase①の `onlineBattlePreviewUsers/{uid}/apps/english-playroom` に架空のプロフィールを作成する。検証用の成績と精算記録も `onlineBattlePreview` で始まる別コレクションへ書き込む。

Firestore の成績と報酬には試合ごとの記録を使う。Firebase② は成績と処理済み記録を、Firebase① は既存の精算記録とコイン・称号・アイテムを、それぞれ一括保存する。途中で止まった精算は次の対戦 API アクセスで再試行する。正常終了でも②に処理済み記録の読み書きが1件ずつ加わる。入室後から試合終了直前まで、検証した操作による Firestore の対戦データ読み書きは0件。認証や登録可否を確認する読み取りは別に発生する。

優先候補は Firebase② の既定の Realtime Database。ルームと成績の管理先を揃えられ、プレイヤーは現行と同じ Firebase① のログインを使える。Firebase② の実設定を確認した上で決定する。Firebase① に置く場合もブラウザーの認証経路は同じだが、①側に負荷が集まる。

## 再現方法

```powershell
node --test --test-timeout=12000 *.test.mjs
```

このフォルダで実行する。通常は模擬データベースを使う。公式 Realtime Database エミュレーターで再現する場合は、空のローカルエミュレーターを起動し、そのポートを `MONSTUDY_RTDB_EMULATOR_PORT` に指定する。テストは `127.0.0.1` の `demo-monstudy-battle` 名前空間にアクセスし、直接の読み書きを拒否するルールを設定する。Firestore とログインは模擬実装を使う。

試験には、入室、準備完了、攻撃、魔法、アイテム、HPとMP、同時攻撃、連打、勝敗、古い試合のリクエスト、再戦、途中退出、接続切れからの復帰、入室期限、勝者1コイン、称号の精算、精算途中の失敗と二重付与防止を含む。接続切れ直後は部屋を維持し、現行と同じ入室期限で解放する。

公式エミュレーター v4.11.2 の計測例では、2人の初戦から再戦・投了までを含む1回の試験でダウンロードが77,312バイト。内訳は取得・書き込み応答52,403バイト、変更通知24,909バイト。アップロードは34,215バイトで、意図的に失敗させたリクエストの送信本文を含む。Firestore の模擬計数は試験全体で読み取り24回、確定した書き込み12件。途中の通常操作による Firestore の読み書きは0件だった。数字は魔法のダメージ、競合、再試行で変動する。

## クラウド検証に残る項目

- Firebase①② のプラン、既定の Realtime Database の有無・リージョン、公開ルール、Render のサービスアカウントに付与された権限を管理画面で確認する。今回、Firebase 管理画面は Google の本人確認で止まった。GitHub にある Firestore ルールはコード上の確認で、現在デプロイされているルールは未確認。
- 実 Firebase② を使用する場合、Realtime Database の検証用パスをブラウザーから直接読み書きできないようにする。上位パスの許可は子パスの拒否で取り消せない。サーバー側は RTDB REST 用の OAuth スコープと適切な権限を持つ認証情報を使用する。検証用ログイン、成績、コイン、アイテム、称号の保存先を事前に隔離する。ローカル版の初期データは架空の2人分。
- Render 上の接続切断・復帰と、実ブラウザー2台での画面反映を確認する。通信量は [Firebase の Downloads](https://firebase.google.com/docs/database/usage/monitor-usage) で測る。ローカルで測ったバイト数には TLS や HTTP ヘッダーが含まれない。
- Spark の上限は月10 GBダウンロード・100同時接続。検証版は参加者の購読ごとに上流接続を張り、ルーム単位の全状態を配信する。クラウドでの検証では、ルームごとの購読共有、ロビー要約の小型化、再接続頻度の調整を先に評価する。現状のロビーは選択中の級のルームをまとめて読み、空室以外の状態量が通信に影響する。 [Firebase の料金表](https://firebase.google.com/pricing)
- 両者が離脱した直後に Render が停止する場合も精算を回収できるよう、切替前に未精算ルームを再処理できる手順を用意する。別ルームでの同時参加と、日付をまたいで精算が遅れた場合の成績もクラウド検証に含める。

## 切替とロールバック

1. 検証用の入口とデータを分け、既存の対戦入口を継続運用する。既存の対戦ルームをコピーする必要はない。
2. 切替時は新規入室の行き先だけを変更し、進行中の試合は開始時の方式で終了・精算する。試合の途中で保存先を変えると、HPと精算の状態が分岐する。
3. 問題時は Realtime Database 側への新規入室を止め、Firestore 側の既存入口に戻す。Realtime Database に残った対戦と精算記録は保持し、未精算分を試合IDで確認・再試行する。発行済みコインや称号を巻き戻す処理は行わない。
