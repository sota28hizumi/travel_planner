// サンプルスポットデータ（座標・料金はデモ用の概算値）
// category: "sightseeing"（観光） / "food"（グルメ）
// stayMin: 標準的な滞在時間（分）, cost: 1人あたりの目安費用（円）
const SPOT_DATA = {
  "京都": [
    { id: "kyoto-1", name: "清水寺", category: "sightseeing", desc: "京都を代表する寺院。清水の舞台からの眺めが有名", lat: 34.9949, lng: 135.7850, stayMin: 90, cost: 400 },
    { id: "kyoto-2", name: "伏見稲荷大社", category: "sightseeing", desc: "千本鳥居で有名な全国の稲荷神社の総本宮", lat: 34.9671, lng: 135.7727, stayMin: 90, cost: 0 },
    { id: "kyoto-3", name: "金閣寺（鹿苑寺）", category: "sightseeing", desc: "金箔に覆われた舎利殿が池に映える名所", lat: 35.0394, lng: 135.7292, stayMin: 60, cost: 500 },
    { id: "kyoto-4", name: "嵐山・竹林の小径", category: "sightseeing", desc: "渡月橋と竹林が人気のエリア", lat: 35.0170, lng: 135.6710, stayMin: 90, cost: 0 },
    { id: "kyoto-5", name: "錦市場", category: "food", desc: "「京の台所」と呼ばれる食べ歩きスポット", lat: 35.0050, lng: 135.7649, stayMin: 60, cost: 1500 },
    { id: "kyoto-6", name: "二条城", category: "sightseeing", desc: "徳川家の栄枯盛衰を見守った世界遺産", lat: 35.0142, lng: 135.7481, stayMin: 90, cost: 800 },
    { id: "kyoto-7", name: "祇園・花見小路", category: "sightseeing", desc: "京都らしい街並みが残る花街", lat: 35.0037, lng: 135.7752, stayMin: 60, cost: 0 },
    { id: "kyoto-8", name: "茶寮都路里 祇園本店", category: "food", desc: "抹茶パフェで行列ができる甘味処", lat: 35.0039, lng: 135.7745, stayMin: 60, cost: 1300 }
  ],
  "大阪": [
    { id: "osaka-1", name: "大阪城", category: "sightseeing", desc: "豊臣秀吉が築いた大阪のシンボル", lat: 34.6873, lng: 135.5262, stayMin: 90, cost: 600 },
    { id: "osaka-2", name: "道頓堀", category: "food", desc: "グリコ看板とたこ焼き・串カツの食い倒れエリア", lat: 34.6687, lng: 135.5013, stayMin: 90, cost: 2000 },
    { id: "osaka-3", name: "ユニバーサル・スタジオ・ジャパン", category: "sightseeing", desc: "一日中楽しめる大型テーマパーク", lat: 34.6654, lng: 135.4323, stayMin: 480, cost: 8900 },
    { id: "osaka-4", name: "海遊館", category: "sightseeing", desc: "ジンベエザメが泳ぐ世界最大級の水族館", lat: 34.6545, lng: 135.4290, stayMin: 120, cost: 2700 },
    { id: "osaka-5", name: "新世界・通天閣", category: "sightseeing", desc: "レトロな下町と串カツの聖地", lat: 34.6525, lng: 135.5063, stayMin: 90, cost: 1000 },
    { id: "osaka-6", name: "黒門市場", category: "food", desc: "「大阪の台所」海鮮食べ歩きが人気", lat: 34.6653, lng: 135.5065, stayMin: 60, cost: 1500 },
    { id: "osaka-7", name: "梅田スカイビル 空中庭園", category: "sightseeing", desc: "地上173mから大阪を一望できる展望台", lat: 34.7052, lng: 135.4903, stayMin: 60, cost: 1500 },
    { id: "osaka-8", name: "あべのハルカス展望台", category: "sightseeing", desc: "日本有数の超高層ビルからの絶景", lat: 34.6459, lng: 135.5133, stayMin: 60, cost: 1500 }
  ],
  "東京": [
    { id: "tokyo-1", name: "浅草寺・仲見世通り", category: "sightseeing", desc: "雷門で有名な東京最古の寺院と参道商店街", lat: 35.7148, lng: 139.7967, stayMin: 90, cost: 0 },
    { id: "tokyo-2", name: "東京スカイツリー", category: "sightseeing", desc: "高さ634mの電波塔。展望デッキから関東を一望", lat: 35.7101, lng: 139.8107, stayMin: 90, cost: 2100 },
    { id: "tokyo-3", name: "明治神宮", category: "sightseeing", desc: "都心とは思えない森に囲まれた神社", lat: 35.6764, lng: 139.6993, stayMin: 60, cost: 0 },
    { id: "tokyo-4", name: "渋谷スクランブル交差点", category: "sightseeing", desc: "世界的に有名な交差点。SHIBUYA SKYも近い", lat: 35.6595, lng: 139.7005, stayMin: 30, cost: 0 },
    { id: "tokyo-5", name: "築地場外市場", category: "food", desc: "海鮮丼や玉子焼きの食べ歩きが楽しめる市場", lat: 35.6654, lng: 139.7707, stayMin: 90, cost: 2000 },
    { id: "tokyo-6", name: "東京タワー", category: "sightseeing", desc: "東京のシンボルタワー。夜景も人気", lat: 35.6586, lng: 139.7454, stayMin: 60, cost: 1200 },
    { id: "tokyo-7", name: "上野動物園", category: "sightseeing", desc: "パンダで有名な日本最古の動物園", lat: 35.7156, lng: 139.7714, stayMin: 120, cost: 600 },
    { id: "tokyo-8", name: "チームラボプラネッツ TOKYO", category: "sightseeing", desc: "水に入って鑑賞する没入型デジタルアート", lat: 35.6494, lng: 139.7898, stayMin: 120, cost: 3800 }
  ],
  "札幌・小樽": [
    { id: "sapporo-1", name: "札幌市時計台", category: "sightseeing", desc: "札幌のシンボル的な歴史的建造物", lat: 43.0626, lng: 141.3536, stayMin: 30, cost: 200 },
    { id: "sapporo-2", name: "大通公園・さっぽろテレビ塔", category: "sightseeing", desc: "札幌の中心を貫く公園と展望塔", lat: 43.0611, lng: 141.3564, stayMin: 60, cost: 800 },
    { id: "sapporo-3", name: "白い恋人パーク", category: "sightseeing", desc: "お菓子作り体験もできるテーマパーク", lat: 43.0899, lng: 141.2712, stayMin: 90, cost: 800 },
    { id: "sapporo-4", name: "藻岩山展望台", category: "sightseeing", desc: "日本新三大夜景に選ばれた絶景スポット", lat: 43.0231, lng: 141.3222, stayMin: 90, cost: 2100 },
    { id: "sapporo-5", name: "二条市場", category: "food", desc: "海鮮丼が名物の札幌市民の台所", lat: 43.0574, lng: 141.3595, stayMin: 60, cost: 2000 },
    { id: "sapporo-6", name: "すすきの（ジンギスカン）", category: "food", desc: "北海道名物ジンギスカンと夜の繁華街", lat: 43.0554, lng: 141.3529, stayMin: 90, cost: 3000 },
    { id: "sapporo-7", name: "小樽運河", category: "sightseeing", desc: "ガス灯とレンガ倉庫が並ぶロマンチックな運河", lat: 43.1988, lng: 140.9944, stayMin: 90, cost: 0 },
    { id: "sapporo-8", name: "北海道神宮", category: "sightseeing", desc: "北海道の総鎮守。円山公園に隣接", lat: 43.0545, lng: 141.3079, stayMin: 60, cost: 0 }
  ],
  "福岡": [
    { id: "fukuoka-1", name: "太宰府天満宮", category: "sightseeing", desc: "学問の神様・菅原道真を祀る神社。梅ヶ枝餅も名物", lat: 33.5216, lng: 130.5350, stayMin: 90, cost: 0 },
    { id: "fukuoka-2", name: "大濠公園", category: "sightseeing", desc: "大きな池を囲む市民の憩いの公園", lat: 33.5860, lng: 130.3760, stayMin: 60, cost: 0 },
    { id: "fukuoka-3", name: "福岡タワー", category: "sightseeing", desc: "海浜タワーとしては日本一の高さ", lat: 33.5932, lng: 130.3512, stayMin: 60, cost: 800 },
    { id: "fukuoka-4", name: "キャナルシティ博多", category: "sightseeing", desc: "運河が流れる大型複合商業施設", lat: 33.5899, lng: 130.4114, stayMin: 90, cost: 0 },
    { id: "fukuoka-5", name: "中洲屋台街", category: "food", desc: "とんこつラーメンや焼き鳥が楽しめる屋台の聖地", lat: 33.5937, lng: 130.4066, stayMin: 90, cost: 2500 },
    { id: "fukuoka-6", name: "柳橋連合市場", category: "food", desc: "「博多の台所」と呼ばれる昔ながらの市場", lat: 33.5852, lng: 130.4055, stayMin: 45, cost: 1000 },
    { id: "fukuoka-7", name: "櫛田神社", category: "sightseeing", desc: "博多祇園山笠で有名な博多の総鎮守", lat: 33.5928, lng: 130.4108, stayMin: 45, cost: 0 }
  ],
  "沖縄本島": [
    { id: "okinawa-1", name: "沖縄美ら海水族館", category: "sightseeing", desc: "巨大水槽「黒潮の海」でジンベエザメに会える", lat: 26.6942, lng: 127.8780, stayMin: 180, cost: 2180 },
    { id: "okinawa-2", name: "首里城公園", category: "sightseeing", desc: "琉球王国の栄華を伝える世界遺産", lat: 26.2170, lng: 127.7195, stayMin: 90, cost: 400 },
    { id: "okinawa-3", name: "国際通り", category: "food", desc: "那覇の目抜き通り。お土産と沖縄グルメが集まる", lat: 26.2146, lng: 127.6869, stayMin: 90, cost: 2000 },
    { id: "okinawa-4", name: "万座毛", category: "sightseeing", desc: "象の鼻の形をした断崖と青い海の絶景", lat: 26.5047, lng: 127.8506, stayMin: 45, cost: 100 },
    { id: "okinawa-5", name: "古宇利大橋", category: "sightseeing", desc: "エメラルドグリーンの海の上を走る絶景の橋", lat: 26.6780, lng: 128.0160, stayMin: 60, cost: 0 },
    { id: "okinawa-6", name: "瀬長島ウミカジテラス", category: "food", desc: "白い建物が並ぶリゾート感あふれるグルメスポット", lat: 26.1786, lng: 127.6455, stayMin: 90, cost: 1500 },
    { id: "okinawa-7", name: "第一牧志公設市場", category: "food", desc: "沖縄の食材が集まる那覇の台所", lat: 26.2140, lng: 127.6885, stayMin: 60, cost: 1500 },
    { id: "okinawa-8", name: "斎場御嶽", category: "sightseeing", desc: "琉球王国最高の聖地。世界遺産", lat: 26.1734, lng: 127.8262, stayMin: 60, cost: 300 }
  ]
};

// サンプルホテルデータ（料金は1泊1人あたりの目安・概算値）
const HOTEL_DATA = {
  "京都": [
    { id: "h-kyoto-1", name: "ホテルグランヴィア京都", rating: 4.4, price: 18000, desc: "京都駅直結の高級ホテル", lat: 34.9857, lng: 135.7585 },
    { id: "h-kyoto-2", name: "ザ・ゲートホテル京都高瀬川", rating: 4.5, price: 16000, desc: "鴨川近くのデザインホテル", lat: 35.0031, lng: 135.7702 },
    { id: "h-kyoto-3", name: "京都タワーホテル", rating: 4.0, price: 9000, desc: "京都駅前の定番ホテル", lat: 34.9873, lng: 135.7593 },
    { id: "h-kyoto-4", name: "変なホテル京都 八条口", rating: 4.1, price: 7000, desc: "ロボットが出迎えるコスパ宿", lat: 34.9835, lng: 135.7570 },
    { id: "h-kyoto-5", name: "ゲストハウス東山", rating: 3.8, price: 4000, desc: "清水寺エリアの格安ゲストハウス", lat: 34.9980, lng: 135.7750 }
  ],
  "大阪": [
    { id: "h-osaka-1", name: "スイスホテル南海大阪", rating: 4.4, price: 20000, desc: "なんば駅直結の高層ホテル", lat: 34.6620, lng: 135.5028 },
    { id: "h-osaka-2", name: "ホテルニューオータニ大阪", rating: 4.4, price: 17000, desc: "大阪城公園そばのラグジュアリー", lat: 34.6866, lng: 135.5333 },
    { id: "h-osaka-3", name: "ホテル京阪 淀屋橋", rating: 3.9, price: 8000, desc: "ビジネス街の使いやすいホテル", lat: 34.6930, lng: 135.5010 },
    { id: "h-osaka-4", name: "東横INN大阪なんば", rating: 3.7, price: 6500, desc: "ミナミ観光に便利なチェーン", lat: 34.6600, lng: 135.5000 },
    { id: "h-osaka-5", name: "カプセルホテル梅田", rating: 3.5, price: 3500, desc: "キタの格安カプセル", lat: 34.7025, lng: 135.4959 }
  ],
  "東京": [
    { id: "h-tokyo-1", name: "帝国ホテル東京", rating: 4.6, price: 45000, desc: "日比谷の老舗名門ホテル", lat: 35.6720, lng: 139.7585 },
    { id: "h-tokyo-2", name: "ホテルグレイスリー新宿", rating: 4.2, price: 15000, desc: "ゴジラヘッドで有名な歌舞伎町のホテル", lat: 35.6949, lng: 139.7005 },
    { id: "h-tokyo-3", name: "東横INN東京駅新大橋前", rating: 3.8, price: 8000, desc: "東京駅エリアの定番チェーン", lat: 35.6870, lng: 139.7850 },
    { id: "h-tokyo-4", name: "アパホテル浅草 雷門", rating: 3.9, price: 7000, desc: "浅草観光の拠点に便利", lat: 35.7100, lng: 139.7960 },
    { id: "h-tokyo-5", name: "ナインアワーズ大手町", rating: 3.9, price: 4500, desc: "洗練されたカプセルホテル", lat: 35.6880, lng: 139.7660 }
  ],
  "札幌・小樽": [
    { id: "h-sapporo-1", name: "JRタワーホテル日航札幌", rating: 4.5, price: 20000, desc: "札幌駅直結・夜景がきれい", lat: 43.0687, lng: 141.3508 },
    { id: "h-sapporo-2", name: "小樽 ふる川", rating: 4.4, price: 15000, desc: "小樽運河前の温泉旅館", lat: 43.1980, lng: 140.9950 },
    { id: "h-sapporo-3", name: "札幌グランドホテル", rating: 4.3, price: 12000, desc: "大通公園近くの老舗", lat: 43.0611, lng: 141.3497 },
    { id: "h-sapporo-4", name: "ドーミーイン札幌", rating: 4.2, price: 9000, desc: "天然温泉と夜鳴きそばが人気", lat: 43.0560, lng: 141.3530 },
    { id: "h-sapporo-5", name: "東横INNすすきの", rating: 3.7, price: 6000, desc: "すすきの繁華街すぐ", lat: 43.0550, lng: 141.3530 }
  ],
  "福岡": [
    { id: "h-fukuoka-1", name: "ホテルオークラ福岡", rating: 4.4, price: 16000, desc: "中洲川端の高級ホテル", lat: 33.5946, lng: 130.4053 },
    { id: "h-fukuoka-2", name: "ホテル日航福岡", rating: 4.4, price: 14000, desc: "博多駅近くの上質ホテル", lat: 33.5897, lng: 130.4213 },
    { id: "h-fukuoka-3", name: "西鉄イン博多", rating: 4.0, price: 8000, desc: "博多駅前で観光にも便利", lat: 33.5900, lng: 130.4190 },
    { id: "h-fukuoka-4", name: "東横INN博多口駅前", rating: 3.7, price: 6000, desc: "定番の駅前チェーン", lat: 33.5910, lng: 130.4180 },
    { id: "h-fukuoka-5", name: "WeBase博多", rating: 4.0, price: 3500, desc: "おしゃれなホステル", lat: 33.5926, lng: 130.4127 }
  ],
  "沖縄本島": [
    { id: "h-okinawa-1", name: "ハレクラニ沖縄", rating: 4.7, price: 60000, desc: "恩納村の最高級ビーチリゾート", lat: 26.5050, lng: 127.8510 },
    { id: "h-okinawa-2", name: "ホテルムーンビーチ", rating: 4.2, price: 15000, desc: "ビーチ直結の老舗リゾート", lat: 26.4436, lng: 127.7996 },
    { id: "h-okinawa-3", name: "リーガロイヤルグラン沖縄", rating: 4.4, price: 13000, desc: "那覇・旭橋駅直結", lat: 26.2140, lng: 127.6934 },
    { id: "h-okinawa-4", name: "ホテルパームロイヤルNAHA", rating: 4.1, price: 8000, desc: "国際通りそばで観光に便利", lat: 26.2153, lng: 127.6926 },
    { id: "h-okinawa-5", name: "ゲストハウス国際通り", rating: 3.8, price: 3000, desc: "那覇中心部の格安宿", lat: 26.2146, lng: 127.6886 }
  ]
};

// 交通手段のプリセット（1人あたり片道の目安。出発地・時期で大きく変わるため編集可能）
// durationMin: 所要時間の目安（分）。日程のタイムライン計算に使う
const TRANSPORT_DATA = {
  "京都": [
    { method: "新幹線", icon: "train", price: 14000, durationMin: 135, note: "東京から約2時間15分" },
    { method: "飛行機", icon: "flight", price: 18000, durationMin: 180, note: "伊丹/関空経由" },
    { method: "高速バス", icon: "directions_bus", price: 6000, durationMin: 480, note: "夜行で約8時間" },
    { method: "車", icon: "directions_car", price: 8000, durationMin: 330, note: "高速代＋ガソリン代の目安" }
  ],
  "大阪": [
    { method: "新幹線", icon: "train", price: 14500, durationMin: 150, note: "東京から約2時間30分" },
    { method: "飛行機", icon: "flight", price: 15000, durationMin: 170, note: "伊丹/関空まで" },
    { method: "高速バス", icon: "directions_bus", price: 6500, durationMin: 480, note: "夜行で約8時間" },
    { method: "車", icon: "directions_car", price: 9000, durationMin: 340, note: "高速代＋ガソリン代の目安" }
  ],
  "東京": [
    { method: "新幹線", icon: "train", price: 14000, durationMin: 150, note: "大阪から約2時間30分" },
    { method: "飛行機", icon: "flight", price: 15000, durationMin: 160, note: "羽田まで" },
    { method: "高速バス", icon: "directions_bus", price: 6000, durationMin: 480, note: "夜行で約8時間" },
    { method: "在来線", icon: "directions_railway", price: 8000, durationMin: 540, note: "青春18きっぷ等" }
  ],
  "札幌・小樽": [
    { method: "飛行機", icon: "flight", price: 25000, durationMin: 210, note: "新千歳空港まで" },
    { method: "新幹線＋特急", icon: "train", price: 28000, durationMin: 480, note: "函館経由で約8時間" },
    { method: "フェリー", icon: "directions_boat", price: 12000, durationMin: 1080, note: "大洗/舞鶴などから" }
  ],
  "福岡": [
    { method: "飛行機", icon: "flight", price: 20000, durationMin: 200, note: "福岡空港まで" },
    { method: "新幹線", icon: "train", price: 15000, durationMin: 150, note: "大阪から約2時間30分" },
    { method: "高速バス", icon: "directions_bus", price: 12000, durationMin: 600, note: "夜行" },
    { method: "車", icon: "directions_car", price: 15000, durationMin: 540, note: "高速代＋ガソリン代の目安" }
  ],
  "沖縄本島": [
    { method: "飛行機", icon: "flight", price: 25000, durationMin: 210, note: "那覇空港まで" },
    { method: "フェリー", icon: "directions_boat", price: 25000, durationMin: 1500, note: "鹿児島から約25時間" }
  ]
};

// 出発地が登録されているときの距離ベース見積もり用の交通手段マスタ
// base: 基本料金, perKm: 1kmあたり料金, speed: 実効速度(km/h),
// extraMin: 乗り継ぎ等の固定追加時間(分), minKm/maxKm: 現実的な利用距離の範囲
const TRANSPORT_METHODS = [
  { method: "新幹線・特急", icon: "train", base: 2000, perKm: 24, speed: 180, minKm: 50 },
  { method: "飛行機", icon: "flight", base: 8000, perKm: 18, speed: 700, extraMin: 120, minKm: 300 },
  { method: "高速バス", icon: "directions_bus", base: 1500, perKm: 9, speed: 65, minKm: 30 },
  { method: "車（高速利用）", icon: "directions_car", base: 1000, perKm: 20, speed: 75, maxKm: 900 },
  { method: "在来線", icon: "directions_railway", base: 0, perKm: 15, speed: 60, maxKm: 400 },
  { method: "フェリー", icon: "directions_boat", base: 5000, perKm: 8, speed: 40, minKm: 300 }
];

// 地域ごとに利用できる交通手段（海を渡る地域は制限あり）
const REGION_TRANSPORT_RULES = {
  "沖縄本島": ["飛行機", "フェリー"],
  "札幌・小樽": ["新幹線・特急", "飛行機", "フェリー"]
};
// 上記にない地域のデフォルト
const DEFAULT_TRANSPORT_METHODS = ["新幹線・特急", "飛行機", "高速バス", "車（高速利用）", "在来線"];

// 地域の玄関口（駅・空港・港）。手段ごとにどこへ到着するかを定義する
// access: 玄関口から市街の拠点駅までの標準アクセス（所要・料金は目安）
const REGION_GATEWAYS = {
  "京都": [
    { name: "京都駅", lat: 34.9858, lng: 135.7588,
      methods: ["新幹線・特急", "高速バス", "車（高速利用）", "在来線"] },
    { name: "伊丹空港", lat: 34.7855, lng: 135.4382, methods: ["飛行機"],
      access: { method: "リムジンバス", icon: "directions_bus", min: 55, price: 1340,
        to: { name: "京都駅", lat: 34.9858, lng: 135.7588 } } },
    { name: "関西空港", lat: 34.4342, lng: 135.2328, methods: ["飛行機"],
      access: { method: "特急はるか", icon: "train", min: 80, price: 2900,
        to: { name: "京都駅", lat: 34.9858, lng: 135.7588 } } }
  ],
  "大阪": [
    { name: "新大阪駅", lat: 34.7335, lng: 135.5002, methods: ["新幹線・特急"] },
    { name: "大阪駅", lat: 34.7025, lng: 135.4959, methods: ["高速バス", "車（高速利用）", "在来線"] },
    { name: "伊丹空港", lat: 34.7855, lng: 135.4382, methods: ["飛行機"],
      access: { method: "空港リムジンバス", icon: "directions_bus", min: 30, price: 650,
        to: { name: "大阪駅", lat: 34.7025, lng: 135.4959 } } },
    { name: "関西空港", lat: 34.4342, lng: 135.2328, methods: ["飛行機"],
      access: { method: "関空快速", icon: "train", min: 65, price: 1210,
        to: { name: "大阪駅", lat: 34.7025, lng: 135.4959 } } }
  ],
  "東京": [
    { name: "東京駅", lat: 35.6812, lng: 139.7671,
      methods: ["新幹線・特急", "高速バス", "車（高速利用）", "在来線"] },
    { name: "羽田空港", lat: 35.5494, lng: 139.7798, methods: ["飛行機"],
      access: { method: "京急線・モノレール", icon: "train", min: 25, price: 500,
        to: { name: "東京駅", lat: 35.6812, lng: 139.7671 } } },
    { name: "成田空港", lat: 35.7720, lng: 140.3929, methods: ["飛行機"],
      access: { method: "スカイライナー・NEX", icon: "train", min: 60, price: 2600,
        to: { name: "東京駅", lat: 35.6812, lng: 139.7671 } } }
  ],
  "札幌・小樽": [
    { name: "札幌駅", lat: 43.0686, lng: 141.3508, methods: ["新幹線・特急"] },
    { name: "新千歳空港", lat: 42.7752, lng: 141.6923, methods: ["飛行機"],
      access: { method: "快速エアポート", icon: "train", min: 40, price: 1150,
        to: { name: "札幌駅", lat: 43.0686, lng: 141.3508 } } },
    { name: "苫小牧港", lat: 42.6339, lng: 141.6222, methods: ["フェリー"],
      access: { method: "連絡バス・JR", icon: "directions_bus", min: 80, price: 1500,
        to: { name: "札幌駅", lat: 43.0686, lng: 141.3508 } } }
  ],
  "福岡": [
    { name: "博多駅", lat: 33.5902, lng: 130.4207,
      methods: ["新幹線・特急", "高速バス", "車（高速利用）", "在来線"] },
    { name: "福岡空港", lat: 33.5859, lng: 130.4508, methods: ["飛行機"],
      access: { method: "地下鉄空港線", icon: "subway", min: 6, price: 260,
        to: { name: "博多駅", lat: 33.5902, lng: 130.4207 } } }
  ],
  "沖縄本島": [
    { name: "那覇空港", lat: 26.2068, lng: 127.6465, methods: ["飛行機"],
      access: { method: "ゆいレール", icon: "tram", min: 15, price: 270,
        to: { name: "県庁前駅（那覇中心部）", lat: 26.2122, lng: 127.6792 } } },
    { name: "那覇港", lat: 26.2185, lng: 127.6712, methods: ["フェリー"] }
  ]
};

// 地域ごとの地図初期表示中心とズーム
const REGION_CENTER = {
  "京都": { lat: 35.005, lng: 135.755, zoom: 12 },
  "大阪": { lat: 34.675, lng: 135.495, zoom: 12 },
  "東京": { lat: 35.685, lng: 139.765, zoom: 12 },
  "札幌・小樽": { lat: 43.08, lng: 141.25, zoom: 11 },
  "福岡": { lat: 33.575, lng: 130.41, zoom: 12 },
  "沖縄本島": { lat: 26.45, lng: 127.85, zoom: 10 }
};
