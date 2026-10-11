// ============================================================
// 地図アダプタ
// CONFIG.GOOGLE_MAPS_API_KEY が設定されていれば Google Maps ＋ Places 検索、
// 未設定なら Leaflet + OpenStreetMap（無料・キー不要）で動く。
// app.js からは TravelMap.init / render / flyTo / searchPlaces を呼ぶだけ。
// ============================================================
const TravelMap = (() => {
  const useGoogle = typeof CONFIG !== "undefined" && !!CONFIG.GOOGLE_MAPS_API_KEY;
  let clickHandler = null; // 地図クリック時に app.js 側へ通知するコールバック

  // --- Google Maps 用の内部状態 ---
  let gmap = null;
  let gOverlays = []; // 表示中のマーカー・ルート線
  let gInfo = null;

  // --- Leaflet 用の内部状態 ---
  let lmap = null;
  let lLayer = null;

  function esc(s) {
    return String(s)
      .replaceAll("&", "&amp;").replaceAll("<", "&lt;")
      .replaceAll(">", "&gt;").replaceAll('"', "&quot;");
  }
  function showMapError(msg) {
    document.getElementById("map").innerHTML = `<p class="map-error">${esc(msg)}</p>`;
  }

  async function init(center, zoom, onMapClick) {
    clickHandler = onMapClick;
    if (useGoogle) {
      try {
        await initGoogle(center, zoom);
      } catch (e) {
        console.error(e);
        showMapError("Google Maps を読み込めませんでした。APIキー・課金設定・ネット接続を確認してください。");
      }
    } else {
      initLeaflet(center, zoom);
    }
  }

  // ============================================================
  // Google Maps 実装
  // ============================================================
  function loadGoogleScript(key) {
    return new Promise((resolve, reject) => {
      if (window.google && window.google.maps) { resolve(); return; }
      window.__gmapsReady = resolve;
      const s = document.createElement("script");
      s.src = "https://maps.googleapis.com/maps/api/js?key=" + encodeURIComponent(key)
        + "&v=weekly&language=ja&region=JP&loading=async&callback=__gmapsReady";
      s.onerror = () => reject(new Error("Google Maps script load error"));
      document.head.appendChild(s);
    });
  }

  async function initGoogle(center, zoom) {
    await loadGoogleScript(CONFIG.GOOGLE_MAPS_API_KEY);
    const { Map, InfoWindow } = await google.maps.importLibrary("maps");
    await google.maps.importLibrary("marker");
    gmap = new Map(document.getElementById("map"), {
      center,
      zoom,
      mapId: "DEMO_MAP_ID", // AdvancedMarker の利用に必要。本運用では自分の Map ID に差し替え可
      gestureHandling: "greedy",
      streetViewControl: false,
      mapTypeControl: false,
      // 全画面は自前ボタン（.map-wrapごと全画面化）で行う。
      // 組み込みコントロールは #map 単体を全画面にするため、検索欄・シートが消えてしまう
      fullscreenControl: false
    });
    gInfo = new InfoWindow();
    gmap.addListener("click", (e) => {
      if (clickHandler) clickHandler({ lat: e.latLng.lat(), lng: e.latLng.lng() });
    });
  }

  function gClear() {
    gOverlays.forEach((o) => {
      if (o.setMap) o.setMap(null); // Polyline
      else o.map = null;            // AdvancedMarkerElement
    });
    gOverlays = [];
  }

  // スポット系ピン（候補・番号・宿）クリックの通知先。登録されていれば
  // InfoWindow の代わりにこちらへ渡す（app.js が共通ポップアップを出す）
  let spotPinClickHandler = null;
  function onSpotPinClick(cb) {
    spotPinClickHandler = cb;
  }

  // 宿ピンのクリックで渡すデータ（isHotel で app.js 側が宿の詳細モーダルに振り分ける）
  function hotelPinData(hotel) {
    return {
      isHotel: true,
      name: hotel.name,
      lat: hotel.lat,
      lng: hotel.lng,
      rating: hotel.rating != null ? hotel.rating : null,
      price: hotel.price,
      desc: hotel.desc || "",
      placeId: hotel.placeId || null
    };
  }

  function gAddMarker(pos, contentEl, title, popupHtml, spotData) {
    const m = new google.maps.marker.AdvancedMarkerElement({
      map: gmap, position: pos, content: contentEl, title, gmpClickable: true
    });
    if (popupHtml || spotData) {
      // AdvancedMarker のクリックは "click" が非推奨のため "gmp-click" を使う
      m.addEventListener("gmp-click", () => {
        if (spotData && spotPinClickHandler) {
          spotPinClickHandler(spotData); // 共通ポップアップ（写真＋名称＋評価）
        } else if (popupHtml) {
          gInfo.setContent(popupHtml);
          gInfo.open({ map: gmap, anchor: m });
        }
      });
    }
    gOverlays.push(m);
  }

  function renderGoogle(candidates, route, hotel, journeys, fitMode) {
    if (!gmap) return;
    gClear();
    // その日の宿
    if (hotel && hotel.lat != null) {
      const el = document.createElement("div");
      el.className = "hotel-marker";
      el.textContent = "🏨";
      gAddMarker({ lat: hotel.lat, lng: hotel.lng }, el, hotel.name, `<b>泊：${esc(hotel.name)}</b>`,
        hotelPinData(hotel));
    }
    // 候補スポット（未追加）：小さい丸ピン
    candidates.forEach((s) => {
      const dot = document.createElement("div");
      dot.className = "dot-marker" + (s.category === "food" ? " food" : "");
      gAddMarker({ lat: s.lat, lng: s.lng }, dot, s.name,
        `<b>${esc(s.name)}</b><br>${esc(s.desc || "")}`, s);
    });
    // その日の予定：番号ピン＋ルート線
    const path = [];
    route.forEach((r, idx) => {
      path.push({ lat: r.lat, lng: r.lng });
      const badge = document.createElement("div");
      badge.className = "num-marker";
      badge.textContent = String(idx + 1);
      gAddMarker({ lat: r.lat, lng: r.lng }, badge, r.name, `<b>${idx + 1}. ${esc(r.name)}</b>`, r);
    });
    if (path.length >= 2) {
      const line = new google.maps.Polyline({
        map: gmap, path, strokeColor: "#1e5f5a", strokeOpacity: 0.9, strokeWeight: 3 // 訪問順ピンと同色

      });
      gOverlays.push(line);
    }
    // 出発地からの経路（往路・復路）：青い点線＋絵文字マーカー
    const journeyPts = [];
    const seen = new Set();
    (journeys || []).forEach((j) => {
      const linePath = j.points.map((p) => ({ lat: p.lat, lng: p.lng }));
      let full = linePath;
      if (path.length > 0) {
        // 1日目は最初のスポットへ、最終日は最後のスポットからつなぐ
        if (j.attach === "before") full = linePath.concat([path[0]]);
        else if (j.attach === "after") full = [path[path.length - 1]].concat(linePath);
      }
      if (full.length >= 2) {
        const line = new google.maps.Polyline({
          map: gmap, path: full, strokeOpacity: 0,
          icons: [{ icon: { path: "M 0,-1 0,1", strokeOpacity: 0.8, strokeColor: "#1a73e8", scale: 3 }, offset: "0", repeat: "14px" }]
        });
        gOverlays.push(line);
      }
      j.points.forEach((p) => {
        journeyPts.push({ lat: p.lat, lng: p.lng });
        const k = p.lat + "," + p.lng;
        if (seen.has(k)) return; // 日帰りで往路・復路が重なる点は1つだけ
        seen.add(k);
        const el = document.createElement("div");
        el.className = "gw-marker";
        el.textContent = p.emoji;
        gAddMarker({ lat: p.lat, lng: p.lng }, el, p.name, `<b>${esc(p.emoji)} ${esc(p.name)}</b>`);
      });
    });
    // fitMode に応じてズームし直す（編集のたびに地図が飛ばないように）
    const fitPts = fitMode === "all" ? path.concat(journeyPts) : (fitMode === "route" ? path : []);
    if (fitPts.length === 1) {
      // 1点だけ fitBounds すると極端にズームインするため固定ズームにする
      gmap.setCenter(fitPts[0]);
      gmap.setZoom(14);
    } else if (fitPts.length > 0) {
      const b = new google.maps.LatLngBounds();
      fitPts.forEach((p) => b.extend(p));
      gmap.fitBounds(b, 60);
    }
  }

  // Places Text Search（New）で場所を検索して簡易オブジェクトで返す
  // opts.basic: true なら評価などの上位SKUフィールドを要求しない（出発地検索など向け）
  // opts.bounds: true なら地図の表示範囲内に限定して検索（地図上の検索欄用）
  // opts.national: true なら地図中心へのバイアスをかけない（行き先の全国検索用）
  async function searchPlaces(query, opts) {
    const national = !!(opts && opts.national);
    if (!useGoogle || (!gmap && !national)) return [];
    if (typeof google === "undefined" || !google.maps) return []; // スクリプト読み込み前
    const { Place } = await google.maps.importLibrary("places");
    const fields = (opts && opts.basic)
      ? ["id", "displayName", "location", "formattedAddress", "types"]
      // rating / userRatingCount は Pro SKU（無料枠 月5,000回）。抑えたい場合はこの2つを外す
      : ["id", "displayName", "location", "formattedAddress", "types", "rating", "userRatingCount"];
    const req = {
      textQuery: query,
      fields,
      language: "ja",
      region: "jp",
      maxResultCount: 8
    };
    if (opts && opts.bounds) req.locationRestriction = gmap.getBounds(); // 表示範囲内に矩形制限
    else if (!national) req.locationBias = gmap.getCenter(); // 従来どおり地図中心を優先するバイアス
    const { places } = await Place.searchByText(req);
    return (places || []).map(toSimplePlace);
  }

  // Place を検索結果の簡易オブジェクトに変換（searchPlaces / searchPopularSpots 共用）
  function toSimplePlace(p) {
    return {
      placeId: p.id,
      name: p.displayName,
      lat: p.location.lat(),
      lng: p.location.lng(),
      address: p.formattedAddress || "",
      types: p.types || [],
      rating: p.rating != null ? p.rating : null,
      ratingCount: p.userRatingCount != null ? p.userRatingCount : null
    };
  }

  // 表示範囲内の人気スポットを検索する（Nearby Search・人気順）
  // opts.food: true ならレストラン、false なら観光スポット
  // opts.types: 検索タイプの直接指定（例 ["lodging"]。food より優先）
  // opts.center / opts.radius: 指定があれば表示範囲の代わりにその円で検索
  //（行き先変更直後は地図の移動が終わっておらず bounds が古いため、中心指定で呼ぶ）
  async function searchPopularSpots(opts) {
    if (!useGoogle || !gmap) return [];
    if (typeof google === "undefined" || !google.maps) return [];
    const { Place, SearchNearbyRankPreference } = await google.maps.importLibrary("places");
    let center = opts && opts.center;
    let radius = opts && opts.radius;
    if (!center || !radius) {
      // searchNearby は円形指定のみのため、中心〜北東角の距離を半径にする
      const b = gmap.getBounds();
      if (!b) return [];
      const c = gmap.getCenter();
      const ne = b.getNorthEast();
      center = { lat: c.lat(), lng: c.lng() };
      const toRad = (d) => (d * Math.PI) / 180;
      const dLat = toRad(ne.lat() - center.lat);
      const dLng = toRad(ne.lng() - center.lng);
      const a = Math.sin(dLat / 2) ** 2
        + Math.cos(toRad(center.lat)) * Math.cos(toRad(ne.lat())) * Math.sin(dLng / 2) ** 2;
      radius = 6371000 * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
    }
    radius = Math.max(200, Math.min(50000, radius)); // APIの上限は50km
    const req = {
      fields: ["id", "displayName", "location", "formattedAddress", "types", "rating", "userRatingCount"],
      locationRestriction: { center, radius },
      includedPrimaryTypes: (opts && opts.types) || (opts && opts.food ? ["restaurant"] : ["tourist_attraction"]),
      maxResultCount: 10,
      language: "ja",
      region: "jp"
    };
    // 人気順（デフォルトだが明示。テストスタブ等で enum が無ければ省略）
    if (SearchNearbyRankPreference && SearchNearbyRankPreference.POPULARITY) {
      req.rankPreference = SearchNearbyRankPreference.POPULARITY;
    }
    const { places } = await Place.searchNearby(req);
    return (places || []).map(toSimplePlace);
  }

  // ============================================================
  // 地図上の検索の仮ピン（Googleモード専用・state には保存しない）
  // 訪問順の番号ピンと区別するため A〜H のラベル付きピンで表示する
  // ============================================================
  let gSearchPins = [];

  let searchPinClickHandler = null; // 仮ピンクリックを app.js 側へ通知するコールバック

  // 仮ピンクリック時の通知先を登録する（cb には結果リストのインデックスが渡る）
  function onSearchPinClick(cb) {
    searchPinClickHandler = cb;
  }

  function showSearchPins(results) {
    clearSearchPins();
    if (!useGoogle || !gmap) return;
    results.forEach((r, i) => {
      const el = document.createElement("div");
      el.className = "search-marker";
      el.textContent = String.fromCharCode(65 + i); // A, B, C…（結果リストのラベルと対応）
      const m = new google.maps.marker.AdvancedMarkerElement({
        map: gmap,
        position: { lat: r.lat, lng: r.lng },
        content: el,
        title: r.name,
        gmpClickable: true,
        zIndex: 50 // 既存ピンより手前に出す
      });
      // ピンクリックで対応する結果の詳細を開けるようにする
      m.addEventListener("gmp-click", () => {
        if (searchPinClickHandler) searchPinClickHandler(i);
      });
      gSearchPins.push(m);
    });
  }

  function clearSearchPins() {
    gSearchPins.forEach((m) => { m.map = null; });
    gSearchPins = [];
  }

  // ============================================================
  // スポットのポップアップ（Agoda流：写真＋名称＋評価のカードをピンの上に表示）
  // スポット選択で地図移動したとき、どのピンの話かを示す。stateには保存しない
  // ============================================================
  let gSpotPopup = null; // Googleモード: AdvancedMarkerElement ／ Leafletモード: L.popup

  // ポップアップカードをクリック/Enterで詳細を開けるようにする（onOpenDetail 指定時のみ）
  function attachPopupOpen(card, info) {
    if (!card || typeof info.onOpenDetail !== "function") return;
    card.classList.add("spot-popup-open");
    card.setAttribute("role", "button");
    card.setAttribute("tabindex", "0");
    card.setAttribute("aria-label", `${info.name} の詳細を見る`);
    card.addEventListener("click", (e) => { e.stopPropagation(); info.onOpenDetail(); });
    card.addEventListener("keydown", (e) => {
      if (e.key === "Enter" || e.key === " ") { e.preventDefault(); info.onOpenDetail(); }
    });
  }

  // info: { lat, lng, name, rating, ratingCount, photoUrl, onOpenDetail }
  function showSpotPopup(info) {
    hideSpotPopup();
    if (info == null || info.lat == null || info.lng == null) return;
    const ratingHtml = info.rating != null
      ? `<div class="spot-popup-rating">★ ${esc(info.rating)}${info.ratingCount != null ? ` <span class="count">(${Number(info.ratingCount).toLocaleString()}件)</span>` : ""}</div>`
      : "";
    const moreHtml = typeof info.onOpenDetail === "function"
      ? '<div class="spot-popup-more">詳細を見る</div>'
      : "";
    const cardHtml = `
      ${info.photoUrl ? `<img class="spot-popup-photo" src="${esc(info.photoUrl)}" alt="" loading="lazy">` : ""}
      <div class="spot-popup-body">
        <div class="spot-popup-name">${esc(info.name)}</div>
        ${ratingHtml}${moreHtml}
      </div>`;
    if (useGoogle && gmap) {
      // ラッパーの下余白でピンを隠さない位置に持ち上げる（矢印はCSSの::after）
      const wrap = document.createElement("div");
      wrap.className = "spot-popup-wrap";
      wrap.innerHTML = `<div class="spot-popup">${cardHtml}<button type="button" class="spot-popup-close" aria-label="閉じる">✕</button></div>`;
      const closeBtn = wrap.querySelector(".spot-popup-close");
      if (closeBtn && closeBtn.addEventListener) {
        closeBtn.addEventListener("click", (e) => { e.stopPropagation(); hideSpotPopup(); });
      }
      attachPopupOpen(wrap.querySelector(".spot-popup"), info);
      gSpotPopup = new google.maps.marker.AdvancedMarkerElement({
        map: gmap,
        position: { lat: info.lat, lng: info.lng },
        content: wrap,
        title: info.name,
        gmpClickable: true,
        zIndex: 70 // 検索仮ピン（50）より手前
      });
    } else if (lmap) {
      // クリック処理を付けるためDOMで組み立てて渡す（閉じるボタンはLeaflet標準）
      const holder = document.createElement("div");
      holder.innerHTML = `<div class="spot-popup">${cardHtml}</div>`;
      const card = holder.firstElementChild;
      attachPopupOpen(card, info);
      gSpotPopup = L.popup({ offset: [0, -6], className: "spot-popup-leaflet" })
        .setLatLng([info.lat, info.lng])
        .setContent(card)
        .openOn(lmap);
    }
  }

  function hideSpotPopup() {
    if (!gSpotPopup) return;
    if (useGoogle) gSpotPopup.map = null;
    else if (lmap && lmap.closePopup) lmap.closePopup(gSpotPopup);
    gSpotPopup = null;
  }

  // 結果リストのホバー/タップに合わせて i 番目の仮ピンを強調（-1 で解除）
  function highlightSearchPin(i) {
    gSearchPins.forEach((m, idx) => {
      if (m.content && m.content.classList) m.content.classList.toggle("active", idx === i);
    });
  }

  // パン・ズーム完了（idle）を app.js に通知する（「このエリアを検索」ボタン用）
  function onViewportChange(cb) {
    if (useGoogle && gmap) gmap.addListener("idle", cb);
  }

  // 全画面切替などでコンテナサイズが変わったときに地図へ再計算を促す
  function resize() {
    if (useGoogle && gmap) google.maps.event.trigger(gmap, "resize");
    else if (lmap) lmap.invalidateSize();
  }

  // 指定座標を「見えている範囲の中心」に置く。
  // coveredLeftPx = 左側がパネル等のUIで隠れている幅（px）。その半分だけ中心を左へずらすと、
  // スポットが残りの見えている領域のちょうど真ん中に来る
  function panToVisibleCenter(pos, coveredLeftPx) {
    const dx = Math.round((coveredLeftPx || 0) / 2);
    if (useGoogle && gmap) {
      gmap.setCenter(pos);
      if (dx > 0) gmap.panBy(-dx, 0);
    } else if (lmap) {
      lmap.setView([pos.lat, pos.lng]);
      if (dx > 0) lmap.panBy([-dx, 0]);
    }
  }

  // 表示範囲の識別文字列。同一範囲での再検索スキップ判定に使う（範囲未確定は null）
  function getBoundsSig() {
    if (useGoogle && gmap && gmap.getBounds) {
      const b = gmap.getBounds();
      return b ? b.toUrlValue() : null;
    }
    return null;
  }

  // 詳細表示で取得するフィールド
  // ※ 営業時間・電話・クチコミなどは上位SKU扱いで無料枠が少なめ（個人利用なら十分）
  const DETAIL_FIELDS = [
    "id", "displayName", "formattedAddress", "location",
    "rating", "userRatingCount", "regularOpeningHours",
    "nationalPhoneNumber", "websiteURI", "googleMapsURI",
    "photos", "editorialSummary", "reviews"
  ];

  // スポットの詳細情報（Google Mapと同等）を取得する
  // placeId があれば直接取得、なければ名前＋座標付近で検索して先頭の結果を使う
  async function getPlaceDetails(opts) {
    if (!useGoogle) return null;
    const { Place } = await google.maps.importLibrary("places");
    let place = null;
    if (opts.placeId) {
      place = new Place({ id: opts.placeId });
      await place.fetchFields({ fields: DETAIL_FIELDS.filter((f) => f !== "id") });
    } else {
      const { places } = await Place.searchByText({
        textQuery: opts.query,
        fields: DETAIL_FIELDS,
        language: "ja",
        region: "jp",
        maxResultCount: 1,
        locationBias: opts.lat != null ? { lat: opts.lat, lng: opts.lng } : undefined
      });
      place = (places && places[0]) || null;
    }
    if (!place) return null;
    return normalizePlace(place);
  }

  // 行き先カード用の写真URLを1枚取得する（placeId 優先、なければテキスト検索）
  // photos は基本フィールド扱いだが、写真の実表示ごとに Photos SKU が発生する点に注意
  async function getDestinationPhoto(opts) {
    if (!useGoogle) return null;
    if (typeof google === "undefined" || !google.maps) return null; // スクリプト読み込み前
    const { Place } = await google.maps.importLibrary("places");
    let place = null;
    if (opts.placeId) {
      place = new Place({ id: opts.placeId });
      await place.fetchFields({ fields: ["displayName", "photos"] });
    } else {
      const { places } = await Place.searchByText({
        textQuery: opts.query,
        fields: ["id", "displayName", "photos"],
        language: "ja",
        region: "jp",
        maxResultCount: 1
      });
      place = (places && places[0]) || null;
    }
    if (!place || !place.photos || place.photos.length === 0) return null;
    return place.photos[0].getURI({ maxWidth: 800 });
  }

  // Place オブジェクトを表示用の素朴なオブジェクトに変換
  function normalizePlace(p) {
    const summary = p.editorialSummary
      ? (typeof p.editorialSummary === "string" ? p.editorialSummary : p.editorialSummary.text || "")
      : "";
    return {
      placeId: p.id,
      name: p.displayName,
      address: p.formattedAddress || "",
      rating: p.rating != null ? p.rating : null,
      ratingCount: p.userRatingCount != null ? p.userRatingCount : null,
      openingHours: (p.regularOpeningHours && p.regularOpeningHours.weekdayDescriptions) || [],
      phone: p.nationalPhoneNumber || "",
      website: p.websiteURI || "",
      mapsUrl: p.googleMapsURI || "",
      summary,
      photos: (p.photos || []).slice(0, 3).map((ph) => ph.getURI({ maxWidth: 500 })),
      reviews: (p.reviews || []).slice(0, 3).map((rv) => ({
        rating: rv.rating != null ? rv.rating : null,
        text: rv.text ? (typeof rv.text === "string" ? rv.text : rv.text.text || "") : "",
        author: (rv.authorAttribution && rv.authorAttribution.displayName) || "",
        when: rv.relativePublishTimeDescription || ""
      }))
    };
  }

  // ============================================================
  // Routes API — 2地点間のルート（徒歩・公共交通・車）を取得
  // ※ Google Cloud で「Routes API」の有効化が必要。未有効なら 403 が返り、
  //    app.js 側が概算表示にフォールバックする
  // ※ 日本の公共交通（TRANSIT）はデータライセンスの都合でAPIから経路が
  //    返らない（空レスポンス）。その場合は null を返し概算のままにする
  // ============================================================
  // Google の車両タイプ → Material Symbols のアイコン名
  function vehicleIcon(type) {
    switch (type) {
      case "SUBWAY": case "METRO_RAIL": return "subway";
      case "BUS": case "INTERCITY_BUS": case "TROLLEYBUS": return "directions_bus";
      case "TRAM": case "LIGHT_RAIL": case "MONORAIL": return "tram";
      case "FUNICULAR": case "GONDOLA_LIFT": case "CABLE_CAR": return "tram";
      case "FERRY": return "directions_boat";
      case "HEAVY_RAIL": case "COMMUTER_TRAIN": case "HIGH_SPEED_TRAIN":
      case "LONG_DISTANCE_TRAIN": case "RAIL": return "train";
      default: return "directions_transit";
    }
  }

  // アプリ内の手段名 → Routes API の travelMode
  const ROUTES_TRAVEL_MODES = { walk: "WALK", transit: "TRANSIT", car: "DRIVE" };

  // ルートを取得して { min, km, price, lines } で返す（経路なしは null）
  // price は公共交通の運賃（取得できた場合のみ）。徒歩・車は null
  // departIso: 出発予定時刻（ISO文字列。公共交通のみ使用、未指定なら現在時刻）
  async function getRoute(from, to, mode, departIso) {
    const travelMode = ROUTES_TRAVEL_MODES[mode];
    if (!useGoogle || !travelMode) return null;
    const body = {
      origin: { location: { latLng: { latitude: from.lat, longitude: from.lng } } },
      destination: { location: { latLng: { latitude: to.lat, longitude: to.lng } } },
      travelMode,
      languageCode: "ja",
      units: "METRIC"
    };
    if (travelMode === "TRANSIT" && departIso) body.departureTime = departIso;
    const res = await fetch("https://routes.googleapis.com/directions/v2:computeRoutes", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Goog-Api-Key": CONFIG.GOOGLE_MAPS_API_KEY,
        "X-Goog-FieldMask": "routes.duration,routes.distanceMeters,routes.legs.steps.transitDetails,routes.travelAdvisory.transitFare"
      },
      body: JSON.stringify(body)
    });
    if (!res.ok) {
      const err = new Error("Routes API error: HTTP " + res.status);
      err.status = res.status;
      throw err;
    }
    const data = await res.json();
    const route = data.routes && data.routes[0];
    if (!route) return null; // 経路が見つからなかった（日本のTRANSITは常にこれ）
    const min = Math.max(1, Math.round(parseInt(route.duration, 10) / 60));
    const km = route.distanceMeters != null ? route.distanceMeters / 1000 : null;
    const fare = route.travelAdvisory && route.travelAdvisory.transitFare;
    const price = fare && fare.units != null ? Number(fare.units) : null;
    const lines = [];
    (route.legs || []).forEach((leg) => (leg.steps || []).forEach((st) => {
      const line = st.transitDetails && st.transitDetails.transitLine;
      if (!line) return;
      lines.push({
        name: line.nameShort || line.name || "",
        icon: vehicleIcon(line.vehicle && line.vehicle.type)
      });
    }));
    return { min, km, price, lines };
  }

  // ============================================================
  // Leaflet（OpenStreetMap）実装 — キー不要のフォールバック
  // ============================================================
  function initLeaflet(center, zoom) {
    if (typeof L === "undefined") {
      showMapError("地図を読み込めませんでした（ネット接続が必要です）");
      return;
    }
    lmap = L.map("map").setView([center.lat, center.lng], zoom);
    L.tileLayer("https://tile.openstreetmap.org/{z}/{x}/{y}.png", {
      attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
    }).addTo(lmap);
    lLayer = L.layerGroup().addTo(lmap);
    lmap.on("click", (e) => {
      if (clickHandler) clickHandler({ lat: e.latlng.lat, lng: e.latlng.lng });
    });
  }

  function renderLeaflet(candidates, route, hotel, journeys, fitMode) {
    if (!lmap) return;
    lLayer.clearLayers();
    // Leaflet標準popupの代わりに共通ポップアップへ流す（登録時のみ。未登録なら従来表示）
    const attachSpotClick = (marker, spotData, fallbackHtml) => {
      if (spotPinClickHandler) marker.on("click", () => spotPinClickHandler(spotData));
      else marker.bindPopup(fallbackHtml);
      return marker;
    };
    // その日の宿
    if (hotel && hotel.lat != null) {
      const icon = L.divIcon({
        className: "hotel-marker",
        html: "🏨",
        iconSize: [28, 28],
        iconAnchor: [14, 14]
      });
      attachSpotClick(
        L.marker([hotel.lat, hotel.lng], { icon }),
        hotelPinData(hotel),
        `<b>泊：${esc(hotel.name)}</b>`
      ).addTo(lLayer);
    }
    candidates.forEach((s) => {
      attachSpotClick(
        L.circleMarker([s.lat, s.lng], {
          radius: 7,
          color: s.category === "food" ? "#b8792a" : "#3e6e5c",     // Googleモードの .dot-marker と同系色
          fillColor: s.category === "food" ? "#e2a84a" : "#5f9a83",
          fillOpacity: 0.7,
          weight: 2,
          // クリックを地図へ伝播させない（伝播すると地図クリック扱いで
          // 開いた直後のポップアップが即閉じられ、位置指定も誤発火する）
          bubblingMouseEvents: false
        }),
        s,
        `<b>${esc(s.name)}</b><br>${esc(s.desc || "")}`
      ).addTo(lLayer);
    });
    const latlngs = [];
    route.forEach((r, idx) => {
      latlngs.push([r.lat, r.lng]);
      const icon = L.divIcon({
        className: "num-marker",
        html: String(idx + 1),
        iconSize: [28, 28],
        iconAnchor: [14, 14]
      });
      attachSpotClick(L.marker([r.lat, r.lng], { icon }), r, `<b>${idx + 1}. ${esc(r.name)}</b>`).addTo(lLayer);
    });
    if (latlngs.length >= 2) {
      L.polyline(latlngs, { color: "#1e5f5a", weight: 3, dashArray: "6 6" }).addTo(lLayer); // 訪問順ピンと同色
    }
    // 出発地からの経路（往路・復路）：青い点線＋絵文字マーカー
    const journeyPts = [];
    const seen = new Set();
    (journeys || []).forEach((j) => {
      const linePath = j.points.map((p) => [p.lat, p.lng]);
      let full = linePath;
      if (latlngs.length > 0) {
        if (j.attach === "before") full = linePath.concat([latlngs[0]]);
        else if (j.attach === "after") full = [latlngs[latlngs.length - 1]].concat(linePath);
      }
      if (full.length >= 2) {
        L.polyline(full, { color: "#1a73e8", weight: 3, dashArray: "2 8", opacity: 0.8 }).addTo(lLayer);
      }
      j.points.forEach((p) => {
        journeyPts.push([p.lat, p.lng]);
        const k = p.lat + "," + p.lng;
        if (seen.has(k)) return; // 日帰りで往路・復路が重なる点は1つだけ
        seen.add(k);
        const icon = L.divIcon({
          className: "gw-marker",
          html: p.emoji,
          iconSize: [28, 28],
          iconAnchor: [14, 14]
        });
        L.marker([p.lat, p.lng], { icon })
          .bindPopup(`<b>${esc(p.emoji)} ${esc(p.name)}</b>`)
          .addTo(lLayer);
      });
    });
    // fitMode に応じてズームし直す（編集のたびに地図が飛ばないように）
    const fitPts = fitMode === "all" ? latlngs.concat(journeyPts) : (fitMode === "route" ? latlngs : []);
    if (fitPts.length === 1) {
      // 1点だけ fitBounds すると極端にズームインするため固定ズームにする
      lmap.setView(fitPts[0], 14);
    } else if (fitPts.length > 0) {
      lmap.fitBounds(L.latLngBounds(fitPts).pad(0.3));
    }
  }

  // ============================================================
  // 共通の公開インターフェース
  // ============================================================
  // 前回描画時の内容を覚えておき、変わった部分に応じてズームを調整する
  //  - 出発地からの経路が変わった（交通の選択・日タブ切替）→ 経路全体にフィット
  //  - 訪問ルートだけ変わった（削除・並び替え）→ その日のルート範囲だけにフィット
  //  - focus 指定あり（スポット追加）→ フィットせず追加地点へズームイン
  let lastRouteSig = null;
  let lastJourneySig = null;
  let pendingFit = null; // 非表示中に保留したフィット（表示後の描画で適用する）
  function render(candidates, route, hotel, journeys, focus) {
    journeys = journeys || [];
    const routeSig = JSON.stringify(route.map((r) => [r.lat, r.lng]));
    const journeySig = JSON.stringify(journeys.map((j) => j.points.map((p) => [p.lat, p.lng])));
    let fitMode = null; // null | "route" | "all"
    if (journeySig !== lastJourneySig) fitMode = "all";
    else if (routeSig !== lastRouteSig) fitMode = "route";
    lastRouteSig = routeSig;
    lastJourneySig = journeySig;
    // 地図が非表示（幅0。別モード表示中など）のときにフィットするとズームが狂うので、
    // 表示後の描画（Projects.switchMode → renderMapView）まで保留する
    const mapEl = typeof document !== "undefined" ? document.getElementById("map") : null;
    const isHidden = !!(mapEl && mapEl.offsetWidth === 0 && mapEl.offsetHeight === 0);
    if (isHidden) {
      if (fitMode) pendingFit = pendingFit === "all" ? "all" : fitMode;
      fitMode = null;
    } else if (pendingFit) {
      fitMode = pendingFit === "all" || fitMode === "all" ? "all" : (fitMode || pendingFit);
      pendingFit = null;
    }
    const hasFocus = focus && focus.lat != null;
    if (hasFocus) fitMode = null;
    if (useGoogle) renderGoogle(candidates, route, hotel, journeys, fitMode);
    else renderLeaflet(candidates, route, hotel, journeys, fitMode);
    if (hasFocus) flyTo(focus, 15); // 追加したスポットに焦点を当てる
  }
  function flyTo(center, zoom) {
    if (useGoogle && gmap) { gmap.setCenter(center); gmap.setZoom(zoom); }
    else if (lmap) lmap.setView([center.lat, center.lng], zoom);
  }
  // ズームは変えずに指定地点へ移動
  function panTo(center) {
    if (useGoogle && gmap) gmap.panTo(center);
    else if (lmap) lmap.panTo([center.lat, center.lng]);
  }
  function getCenter() {
    if (useGoogle && gmap) {
      const c = gmap.getCenter();
      return { lat: c.lat(), lng: c.lng() };
    }
    if (lmap) {
      const c = lmap.getCenter();
      return { lat: c.lat, lng: c.lng };
    }
    return null;
  }

  return {
    init, render, flyTo, panTo, getCenter, searchPlaces, searchPopularSpots, getPlaceDetails, getDestinationPhoto, getRoute,
    showSpotPopup, hideSpotPopup, onSpotPinClick,
    showSearchPins, clearSearchPins, highlightSearchPin, onSearchPinClick, onViewportChange,
    getBoundsSig, resize, panToVisibleCenter, isGoogle: useGoogle
  };
})();
