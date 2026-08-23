(() => {
  "use strict";

  const API_BASE = "https://d1bfy4olc1sh4g.cloudfront.net";

  const LAYER_COLORS = {
    노상: "#e74c3c",
    노외: "#3498db",
    부설: "#2ecc71",
    거주자우선: "#9b59b6",
    전기차충전소: "#00b894",
    건축물주차장: "#636e72",
  };
  const SEARCH_PIN_COLOR = "#f39c12";

  const state = {
    map: null,
    clusterers: {}, // type -> kakao.maps.MarkerClusterer
    searchMarker: null,
    fetchToken: 0,
    roadview: null,
    roadviewClient: null,
    activeInfoWindow: null,
  };

  function dotMarkerImage(colorHex, size = 22) {
    const svg = `
      <svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}">
        <circle cx="${size / 2}" cy="${size / 2}" r="${size / 2 - 2}"
                fill="${colorHex}" stroke="white" stroke-width="2" />
      </svg>`;
    const url = "data:image/svg+xml;charset=UTF-8," + encodeURIComponent(svg);
    return new kakao.maps.MarkerImage(url, new kakao.maps.Size(size, size), {
      offset: new kakao.maps.Point(size / 2, size / 2),
    });
  }

  function pinMarkerImage(colorHex) {
    const svg = `
      <svg xmlns="http://www.w3.org/2000/svg" width="30" height="40">
        <path d="M15 0C6.7 0 0 6.7 0 15c0 11.2 15 25 15 25s15-13.8 15-25C30 6.7 23.3 0 15 0z"
              fill="${colorHex}" stroke="white" stroke-width="1.5"/>
        <circle cx="15" cy="15" r="5.5" fill="white"/>
      </svg>`;
    const url = "data:image/svg+xml;charset=UTF-8," + encodeURIComponent(svg);
    return new kakao.maps.MarkerImage(url, new kakao.maps.Size(30, 40), {
      offset: new kakao.maps.Point(15, 40),
    });
  }

  function evMarkerImage(colorHex, size = 22) {
    const svg = `
      <svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}">
        <circle cx="${size / 2}" cy="${size / 2}" r="${size / 2 - 2}"
                fill="${colorHex}" stroke="white" stroke-width="2" />
        <path d="M12 4 L7 12 H11 L9 18 L16 9 H12 L14 4 Z"
              fill="white" transform="translate(-1,0) scale(0.72)" />
      </svg>`;
    const url = "data:image/svg+xml;charset=UTF-8," + encodeURIComponent(svg);
    return new kakao.maps.MarkerImage(url, new kakao.maps.Size(size, size), {
      offset: new kakao.maps.Point(size / 2, size / 2),
    });
  }

  function debounce(fn, wait) {
    let t = null;
    return (...args) => {
      clearTimeout(t);
      t = setTimeout(() => fn(...args), wait);
    };
  }

  function enabledLayerTypes() {
    return Array.from(document.querySelectorAll("#layer-toggles input[type=checkbox]"))
      .filter((el) => el.checked)
      .map((el) => el.value);
  }

  function openInfoWindow(marker, html) {
    if (state.activeInfoWindow) {
      state.activeInfoWindow.close();
    }
    const iw = new kakao.maps.InfoWindow({
      content: `<div class="kakao-info-window">${html}</div>`,
      removable: true,
    });
    iw.open(state.map, marker);
    state.activeInfoWindow = iw;
  }

  function kakaoRouteUrl(name, lat, lon) {
    const label = (name || "목적지").replace(/,/g, " ").trim() || "목적지";
    return `https://map.kakao.com/link/to/${encodeURIComponent(label)},${lat},${lon}`;
  }

  function routeLinkHtml(name, lat, lon) {
    return `<a class="route-link" href="${kakaoRouteUrl(name, lat, lon)}" target="_blank" rel="noopener">🚗 카카오맵 길찾기</a>`;
  }

  function roadviewLinkHtml(lat, lon) {
    return `<button type="button" class="roadview-link" onclick="window.__openRoadview(${lat}, ${lon})">🚶 로드뷰</button>`;
  }

  function openRoadview(lat, lon) {
    const modal = document.getElementById("roadview-modal");
    const emptyMsg = document.getElementById("roadview-empty");
    const container = document.getElementById("roadview-container");

    modal.classList.remove("hidden");
    emptyMsg.classList.add("hidden");
    container.style.display = "";

    if (!state.roadview) {
      state.roadview = new kakao.maps.Roadview(container);
      state.roadviewClient = new kakao.maps.RoadviewClient();
    }

    const position = new kakao.maps.LatLng(lat, lon);
    state.roadviewClient.getNearestPanoId(position, 50, (panoId) => {
      if (panoId === null) {
        container.style.display = "none";
        emptyMsg.classList.remove("hidden");
        return;
      }
      state.roadview.setPanoId(panoId, position);
    });
  }

  function closeRoadview() {
    document.getElementById("roadview-modal").classList.add("hidden");
  }

  window.__openRoadview = openRoadview;

  function escapeHtml(str) {
    return String(str ?? "").replace(/[&<>"']/g, (c) => ({
      "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;",
    }[c]));
  }

  function buildParkingLotMarkers(items) {
    return items.map((it) => {
      const marker = new kakao.maps.Marker({
        position: new kakao.maps.LatLng(it.lat, it.lon),
        image: dotMarkerImage(LAYER_COLORS[it.lot_type] || "#999"),
        title: it.name,
      });
      kakao.maps.event.addListener(marker, "click", () => {
        openInfoWindow(marker, `
          <div class="title">${escapeHtml(it.name || "(이름 없음)")}</div>
          <div>${escapeHtml(it.lot_type)} · ${escapeHtml(it.operator_type)}</div>
          <div>${escapeHtml(it.address || "")}</div>
          <div>주차구획수: ${it.capacity ?? "-"}면</div>
          <div class="action-row">${routeLinkHtml(it.name, it.lat, it.lon)}${roadviewLinkHtml(it.lat, it.lon)}</div>
        `);
      });
      return marker;
    });
  }

  function buildResidentMarkers(items) {
    return items.map((it) => {
      const marker = new kakao.maps.Marker({
        position: new kakao.maps.LatLng(it.lat, it.lon),
        image: dotMarkerImage(LAYER_COLORS["거주자우선"]),
        title: it.name,
      });
      kakao.maps.event.addListener(marker, "click", () => {
        openInfoWindow(marker, `
          <div class="title">${escapeHtml(it.name || "(이름 없음)")}</div>
          <div>거주자 우선 주차장 · ${escapeHtml(it.operation_type || "")}</div>
          <div>${escapeHtml(it.address || "")}</div>
          <div>${escapeHtml(it.hours || "")}</div>
          <div>${escapeHtml(it.fee || "")}</div>
          <div class="action-row">${routeLinkHtml(it.name, it.lat, it.lon)}${roadviewLinkHtml(it.lat, it.lon)}</div>
        `);
      });
      return marker;
    });
  }

  function buildEvChargerMarkers(items) {
    return items.map((it) => {
      const marker = new kakao.maps.Marker({
        position: new kakao.maps.LatLng(it.lat, it.lon),
        image: evMarkerImage(LAYER_COLORS["전기차충전소"]),
        title: it.station_name,
      });
      kakao.maps.event.addListener(marker, "click", () => {
        openInfoWindow(marker, `
          <div class="title">${escapeHtml(it.station_name || "(이름 없음)")}</div>
          <div>${escapeHtml(it.address || "")}</div>
          <div>충전기 ${it.connector_count}대 (급속 ${it.fast_count} · 완속 ${it.slow_count})</div>
          <div>${escapeHtml(it.connector_types || "")}</div>
          <div>운영: ${escapeHtml(it.operator_large || "")} ${escapeHtml(it.operator_small || "")} · ${escapeHtml(it.user_limit || "")}</div>
          <div class="action-row">${routeLinkHtml(it.station_name, it.lat, it.lon)}${roadviewLinkHtml(it.lat, it.lon)}</div>
        `);
      });
      return marker;
    });
  }

  function buildingParkingMethodLabel(method) {
    return method === "recap" ? "총괄표제부 기준" : "표제부 기준(단지 내 최댓값)";
  }

  function buildBuildingParkingMarkers(items) {
    return items.map((it) => {
      const marker = new kakao.maps.Marker({
        position: new kakao.maps.LatLng(it.lat, it.lon),
        image: dotMarkerImage(LAYER_COLORS["건축물주차장"]),
        title: it.bld_name,
      });
      kakao.maps.event.addListener(marker, "click", () => {
        openInfoWindow(marker, `
          <div class="title">${escapeHtml(it.bld_name || "(건물명 없음)")}</div>
          <div>${escapeHtml(it.gu || "")} ${escapeHtml(it.dong || "")} · ${escapeHtml(it.main_purpose || "")}</div>
          <div>${escapeHtml(it.road_address || it.jibun_address || "")}</div>
          <div>건축물대장 주차대수: ${it.capacity}대 (${buildingParkingMethodLabel(it.calc_method)})</div>
          <div>동수 ${it.bld_count} · 세대수 ${it.hhld_count}</div>
          <div class="action-row">${routeLinkHtml(it.bld_name, it.lat, it.lon)}${roadviewLinkHtml(it.lat, it.lon)}</div>
        `);
      });
      return marker;
    });
  }

  function ensureClusterer(type) {
    if (!state.clusterers[type]) {
      state.clusterers[type] = new kakao.maps.MarkerClusterer({
        map: state.map,
        averageCenter: true,
        minLevel: 6,
        disableClickZoom: false,
      });
    }
    return state.clusterers[type];
  }

  async function refreshMapData() {
    const bounds = state.map.getBounds();
    const sw = bounds.getSouthWest();
    const ne = bounds.getNorthEast();
    const types = enabledLayerTypes();
    const token = ++state.fetchToken;

    const params = new URLSearchParams({
      min_lat: sw.getLat(),
      max_lat: ne.getLat(),
      min_lon: sw.getLng(),
      max_lon: ne.getLng(),
      types: types.join(","),
    });

    let data;
    try {
      const res = await fetch(`${API_BASE}/api/parking?${params.toString()}`);
      data = await res.json();
    } catch (e) {
      console.error("주차장 데이터 로드 실패", e);
      return;
    }
    if (token !== state.fetchToken) return; // 더 최신 요청이 이미 진행 중

    const note = document.getElementById("viewport-note");
    const noteParts = [];

    for (const lotType of ["노상", "노외", "부설"]) {
      const clusterer = ensureClusterer(lotType);
      clusterer.clear();
      if (types.includes(lotType) && data.parkingLots) {
        const items = data.parkingLots.items.filter((it) => it.lot_type === lotType);
        clusterer.addMarkers(buildParkingLotMarkers(items));
      }
    }
    if (data.parkingLots) {
      noteParts.push(
        `노상·노외·부설 ${data.parkingLots.items.length}건${data.parkingLots.truncated ? " (더 있음, 확대해보세요)" : ""}`
      );
    }

    const residentClusterer = ensureClusterer("거주자우선");
    residentClusterer.clear();
    if (types.includes("거주자우선") && data.residentParking) {
      residentClusterer.addMarkers(buildResidentMarkers(data.residentParking.items));
      noteParts.push(
        `거주자우선 ${data.residentParking.items.length}건${data.residentParking.truncated ? " (더 있음, 확대해보세요)" : ""}`
      );
    }

    const evClusterer = ensureClusterer("전기차충전소");
    evClusterer.clear();
    if (types.includes("전기차충전소") && data.evChargers) {
      evClusterer.addMarkers(buildEvChargerMarkers(data.evChargers.items));
      noteParts.push(
        `전기차충전소 ${data.evChargers.items.length}건${data.evChargers.truncated ? " (더 있음, 확대해보세요)" : ""}`
      );
    }

    const buildingClusterer = ensureClusterer("건축물주차장");
    buildingClusterer.clear();
    if (types.includes("건축물주차장") && data.buildingParkingLots) {
      buildingClusterer.addMarkers(buildBuildingParkingMarkers(data.buildingParkingLots.items));
      noteParts.push(
        `건축물주차장 ${data.buildingParkingLots.items.length}건${data.buildingParkingLots.truncated ? " (더 있음, 확대해보세요)" : ""}`
      );
    }

    note.textContent = noteParts.join(" / ");
  }

  const debouncedRefresh = debounce(refreshMapData, 400);

  function renderResultPanel(html, { isError = false, empty = false } = {}) {
    const panel = document.getElementById("result-panel");
    panel.classList.toggle("empty", empty);
    panel.innerHTML = html;
  }

  async function fetchNearbyParking(lat, lon) {
    try {
      const res = await fetch(`${API_BASE}/api/nearby-parking?lat=${lat}&lon=${lon}&radius_m=500`);
      if (!res.ok) return [];
      return await res.json();
    } catch (e) {
      return [];
    }
  }

  function nearbyItemName(item) {
    return item.kind === "buildingParking" ? item.bld_name : item.name;
  }

  function nearbyItemLabel(item) {
    const name = escapeHtml(nearbyItemName(item) || "(이름 없음)");
    if (item.kind === "parkingLot") {
      return `${name} · ${escapeHtml(item.lot_type)} · ${item.capacity ?? "-"}면`;
    }
    if (item.kind === "buildingParking") {
      return `${name} · 건축물주차장 · ${item.capacity ?? "-"}대`;
    }
    return `${name} · 거주자우선 · ${escapeHtml(item.operation_type || "")}`;
  }

  async function renderBuildingResult(data) {
    if (!data.found) {
      renderResultPanel(`
        <p class="result-title">${escapeHtml(data.resolvedRegion || "")}</p>
        <div class="error-box">${escapeHtml(data.message || "조회 결과가 없습니다.")}</div>
      `);
      return;
    }

    const methodLabel = data.calcMethod === "recap"
      ? "총괄표제부(전체 동 합계) 기준"
      : "표제부 동별 합산 기준";

    const buildingsHtml = data.buildings.map((b) => `
      <div class="building-card">
        <div class="bld-name">${escapeHtml(b.bldNm || "(건물명 없음)")}</div>
        <div>${escapeHtml(b.platPlc || "")}</div>
        <table>
          <tr><td class="k">주용도</td><td>${escapeHtml(b.mainPurpsCdNm || "-")}</td></tr>
          <tr><td class="k">층수(지상/지하)</td><td>${escapeHtml(b.grndFlrCnt)} / ${escapeHtml(b.ugrndFlrCnt)}</td></tr>
          <tr><td class="k">연면적</td><td>${escapeHtml(b.totArea)} ㎡</td></tr>
          <tr><td class="k">사용승인일</td><td>${escapeHtml(b.useAprDay || "-")}</td></tr>
          <tr><td class="k">주차대수(옥내기계/옥외기계/옥내자주/옥외자주)</td>
              <td>${b.parking.indrMech}/${b.parking.oudrMech}/${b.parking.indrAuto}/${b.parking.oudrAuto}</td></tr>
        </table>
      </div>
    `).join("");

    const hasCoords = typeof data.lat === "number" && typeof data.lon === "number";
    const nearby = hasCoords ? await fetchNearbyParking(data.lat, data.lon) : [];

    const destRouteHtml = hasCoords
      ? `<div class="dest-route">${routeLinkHtml(data.resolvedRegion, data.lat, data.lon)}${roadviewLinkHtml(data.lat, data.lon)}</div>`
      : "";

    const nearbyHtml = nearby.length
      ? `
        <div class="nearby-section">
          <p class="nearby-title">주변 주차장 (500m 이내 ${nearby.length}곳)</p>
          ${nearby.map((it) => `
            <div class="nearby-item">
              <div class="nearby-info">
                <div class="nearby-name">${nearbyItemLabel(it)}</div>
                <div class="nearby-dist">${it.distanceM}m</div>
              </div>
              ${routeLinkHtml(nearbyItemName(it), it.lat, it.lon)}
            </div>
          `).join("")}
        </div>
      `
      : hasCoords
        ? `<p class="hint">500m 이내에 등록된 노상/노외/부설/거주자우선 주차장이 없습니다.</p>`
        : "";

    renderResultPanel(`
      <p class="result-title">조회 결과</p>
      <p class="result-region">${escapeHtml(data.resolvedRegion)}</p>
      <div class="result-total">
        <div class="num">${data.totalParkingSpaces}대</div>
        <div class="label">건축물대장 기준 주차대수</div>
        <div class="result-method">${methodLabel}</div>
      </div>
      ${destRouteHtml}
      ${nearbyHtml}
      ${buildingsHtml}
    `);

    if (hasCoords) {
      const pos = new kakao.maps.LatLng(data.lat, data.lon);
      if (state.searchMarker) state.searchMarker.setMap(null);
      state.searchMarker = new kakao.maps.Marker({
        position: pos,
        image: pinMarkerImage(SEARCH_PIN_COLOR),
        map: state.map,
        zIndex: 999,
      });
      state.map.setLevel(4);
      state.map.panTo(pos);
    }
  }

  async function runBuildingLookup(address) {
    const button = document.querySelector("#search-form button");
    button.disabled = true;
    renderResultPanel(`<p class="hint">조회 중입니다...</p>`);

    try {
      const res = await fetch(`${API_BASE}/api/building-parking?address=${encodeURIComponent(address)}`);
      const data = await res.json();
      if (!res.ok) {
        renderResultPanel(`<div class="error-box">${escapeHtml(data.detail || "조회 중 오류가 발생했습니다.")}</div>`);
        return;
      }
      await renderBuildingResult(data);
    } catch (e) {
      renderResultPanel(`<div class="error-box">네트워크 오류로 조회하지 못했습니다.</div>`);
    } finally {
      button.disabled = false;
    }
  }

  async function handleSearchSubmit(evt) {
    evt.preventDefault();
    const input = document.getElementById("address-input");
    const address = input.value.trim();
    if (!address) return;
    await runBuildingLookup(address);
  }

  function reverseGeocode(lat, lng) {
    return new Promise((resolve, reject) => {
      const geocoder = new kakao.maps.services.Geocoder();
      geocoder.coord2Address(lng, lat, (result, status) => {
        if (status === kakao.maps.services.Status.OK && result.length > 0) {
          const addr = result[0].road_address
            ? result[0].road_address.address_name
            : result[0].address.address_name;
          resolve(addr);
        } else {
          reject(new Error("이 위치의 주소를 확인하지 못했습니다."));
        }
      });
    });
  }

  async function handleMapRightClick(mouseEvent) {
    const latlng = mouseEvent.latLng;
    const input = document.getElementById("address-input");
    input.value = "위치 확인 중...";
    renderResultPanel(`<p class="hint">우클릭한 위치의 주소를 확인하는 중입니다...</p>`);

    let address;
    try {
      address = await reverseGeocode(latlng.getLat(), latlng.getLng());
    } catch (e) {
      input.value = "";
      renderResultPanel(`<div class="error-box">${escapeHtml(e.message)}</div>`);
      return;
    }

    input.value = address;
    await runBuildingLookup(address);
  }

  function initMap() {
    const container = document.getElementById("map");
    state.map = new kakao.maps.Map(container, {
      center: new kakao.maps.LatLng(37.5665, 126.9780), // 서울시청
      level: 6,
    });

    kakao.maps.event.addListener(state.map, "idle", debouncedRefresh);
    kakao.maps.event.addListener(state.map, "rightclick", handleMapRightClick);
    container.addEventListener("contextmenu", (e) => e.preventDefault());
    refreshMapData();

    document.querySelectorAll("#layer-toggles input[type=checkbox]").forEach((el) => {
      el.addEventListener("change", refreshMapData);
    });
  }

  function renderMockAd(container) {
    container.innerHTML = `
      <div class="mock-ad mock-ad-image">
        <img src="/한국주차장-ad.png" alt="광고" />
      </div>
    `;
  }

  function loadAdsense(config) {
    const slots = config.adsenseSlots || {};
    const slotEls = Array.from(document.querySelectorAll(".ad-slot"));
    const active = []; // {el, key, slotId}

    slotEls.forEach((el) => {
      const key = el.dataset.adKey;
      const slotId = slots[key];
      const container = el.querySelector(".ad-container");
      if (!config.adsenseClientId || !slotId) {
        renderMockAd(container);
        return;
      }
      active.push({ el, key, slotId });
    });

    if (active.length === 0) return;

    active.forEach(({ el, slotId }) => {
      const ins = document.createElement("ins");
      ins.className = "adsbygoogle";
      ins.style.display = "block";
      ins.setAttribute("data-ad-client", config.adsenseClientId);
      ins.setAttribute("data-ad-slot", slotId);
      ins.setAttribute("data-ad-format", "auto");
      ins.setAttribute("data-full-width-responsive", "true");
      if (config.adsenseTestMode) {
        // 테스트 모드: 실제 수익이 나는 광고 대신 구글 샘플 광고가 뜬다 (심사 전 무효 클릭 방지).
        ins.setAttribute("data-adtest", "on");
      }
      el.querySelector(".ad-container").appendChild(ins);
    });

    const script = document.createElement("script");
    script.async = true;
    script.src = `https://pagead2.googlesyndication.com/pagead/js/adsbygoogle.js?client=${encodeURIComponent(config.adsenseClientId)}`;
    script.crossOrigin = "anonymous";
    script.onload = () => {
      active.forEach(() => {
        try {
          (window.adsbygoogle = window.adsbygoogle || []).push({});
        } catch (e) {
          console.error("애드센스 광고 로드 실패", e);
        }
      });
    };
    document.head.appendChild(script);
  }

  async function main() {
    document.getElementById("search-form").addEventListener("submit", handleSearchSubmit);
    document.getElementById("roadview-close").addEventListener("click", closeRoadview);
    document.getElementById("roadview-modal").addEventListener("click", (e) => {
      if (e.target.id === "roadview-modal") closeRoadview();
    });

    let config;
    try {
      config = await (await fetch(`${API_BASE}/api/config`)).json();
    } catch (e) {
      document.getElementById("kakao-key-banner").classList.remove("hidden");
      return;
    }

    loadAdsense(config);

    if (!config.kakaoJsKey) {
      document.getElementById("kakao-key-banner").classList.remove("hidden");
      return;
    }

    const script = document.createElement("script");
    script.src = `https://dapi.kakao.com/v2/maps/sdk.js?appkey=${encodeURIComponent(config.kakaoJsKey)}&libraries=services,clusterer&autoload=false`;
    script.onload = () => window.kakao.maps.load(initMap);
    script.onerror = () => {
      document.getElementById("kakao-key-banner").classList.remove("hidden");
    };
    document.head.appendChild(script);
  }

  main();
})();
