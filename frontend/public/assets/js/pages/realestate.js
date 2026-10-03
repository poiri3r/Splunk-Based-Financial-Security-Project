// 부동산 시세조회: 지역별 임시 시세(정적 JSON) + 카카오맵.
// 백엔드 v6에는 시세 API가 없다(작업 요청서 R7, 추가 협의 C4). /api/realestate/... 같은 가안 API를 호출하지 않는다.
// KAKAO_MAP_KEY가 없거나 지도 로드에 실패하면 목록·상세만으로 동작한다.
// 지도 위 표시는 HTML 문자열이 아니라 DOM 노드로 만든다(textContent 원칙 유지).
import { KAKAO_MAP_KEY } from '../config.js';
import { el } from '../ui.js';

const DATA_URL = '/assets/data/realestate.json';
const SDK_TIMEOUT_MS = 10000;

const PAGE = location.pathname;
const won = (n) => `${n.toLocaleString('ko-KR')}만원`;
const signed = (n) => `${n > 0 ? '+' : ''}${n.toFixed(2)}%`;
const trend = (n) => (n > 0 ? 'up' : n < 0 ? 'down' : '');

init();

async function init() {
  const errorBox = document.getElementById('re-error');
  let data;
  try {
    const res = await fetch(DATA_URL, { headers: { Accept: 'application/json' } });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    data = await res.json();
  } catch (err) {
    console.error('[realestate] 시세 데이터를 불러오지 못했습니다.', err);
    errorBox.textContent = '시세 정보를 불러오지 못했습니다. 잠시 후 다시 시도해 주세요.';
    errorBox.hidden = false;
    return;
  }

  // 쿼리 값은 데이터에 있는 id일 때만 쓴다. 그 밖의 값은 기본값으로 바꾼다.
  const params = new URLSearchParams(location.search);
  const city = data.cities.find((c) => c.id === params.get('city')) ?? data.cities[0];
  let current = city.regions.find((r) => r.id === params.get('region')) ?? city.regions[0];

  document.getElementById('re-notice').textContent = data.notice;
  document.getElementById('re-unit').textContent = `(${data.unit})`;
  document.getElementById('re-city').value = city.id;

  // 시·도 탭: 링크로 이동한다(?city=).
  document.getElementById('re-cities').replaceChildren(...data.cities.map((c) => {
    const tab = el('a', { href: `${PAGE}?city=${encodeURIComponent(c.id)}`, textContent: c.name });
    if (c === city) tab.setAttribute('aria-current', 'true');
    return tab;
  }));

  const select = document.getElementById('re-region');
  select.replaceChildren(...city.regions.map((r) => el('option', { value: r.id, textContent: r.name })));

  const rowButtons = new Map();
  document.getElementById('re-rows').replaceChildren(...city.regions.map((r) => {
    const button = el('button', { type: 'button', className: 'link-button', textContent: r.name });
    button.addEventListener('click', () => choose(r));
    rowButtons.set(r.id, button);
    return el('tr', {}, [
      el('td', {}, [button]),
      el('td', { className: 'num', textContent: won(r.sale) }),
      el('td', { className: 'num', textContent: won(r.jeonse) }),
      el('td', { className: `num ${trend(r.change)}`, textContent: signed(r.change) }),
    ]);
  }));

  const map = await setupMap(city, (r) => choose(r));

  function render() {
    select.value = current.id;
    document.getElementById('re-detail-city').textContent = `${city.name} · 기준일 ${data.baseDate}`;
    document.getElementById('re-detail-name').textContent = current.name;
    document.getElementById('re-detail-sale').textContent = won(current.sale);
    document.getElementById('re-detail-jeonse').textContent = won(current.jeonse);
    // 표시용 비율이다. 금액 자체를 계산해 보여주는 것이 아니다.
    document.getElementById('re-detail-ratio').textContent = `${((current.jeonse / current.sale) * 100).toFixed(1)}%`;
    const change = document.getElementById('re-detail-change');
    change.textContent = signed(current.change);
    change.className = trend(current.change);
    document.getElementById('re-detail-base').textContent = data.unit;
    rowButtons.forEach((b, id) => b.closest('tr').classList.toggle('selected', id === current.id));
    map?.select(current);
  }

  // 화면 안에서 고르면 새로고침 없이 바꾸고 주소만 갱신한다.
  function choose(region) {
    current = region;
    history.replaceState(null, '', `${PAGE}?city=${encodeURIComponent(city.id)}&region=${encodeURIComponent(region.id)}`);
    render();
  }
  select.addEventListener('change', () => choose(city.regions.find((r) => r.id === select.value)));

  render();
}

// ---------------------------------------------------------------------------
// 카카오맵

function showMapFallback(message) {
  document.getElementById('re-map').hidden = true;
  document.getElementById('re-map-message').textContent = message;
  document.getElementById('re-map-fallback').hidden = false;
}

function loadKakaoSdk(key) {
  if (window.kakao?.maps) return new Promise((resolve) => window.kakao.maps.load(resolve));
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('timeout')), SDK_TIMEOUT_MS);
    const script = document.createElement('script');
    script.src = `https://dapi.kakao.com/v2/maps/sdk.js?appkey=${encodeURIComponent(key)}&autoload=false`;
    script.onload = () => {
      clearTimeout(timer);
      if (!window.kakao?.maps) return reject(new Error('sdk'));
      window.kakao.maps.load(resolve);
    };
    script.onerror = () => { clearTimeout(timer); reject(new Error('load')); };
    document.head.append(script);
  });
}

// 지도를 만들고 { select(region) }를 돌려준다. 실패하면 null.
async function setupMap(city, onPick) {
  if (!KAKAO_MAP_KEY) {
    showMapFallback('지도 키가 설정되지 않아 목록으로 표시합니다.');
    return null;
  }
  try {
    await loadKakaoSdk(KAKAO_MAP_KEY);
  } catch (err) {
    // 키 오류, 등록되지 않은 도메인, 네트워크 차단이 모두 여기로 온다.
    console.error('[realestate] 카카오맵을 불러오지 못했습니다. 키와 등록 도메인을 확인하세요.', err);
    showMapFallback('지도를 불러오지 못했습니다.');
    return null;
  }

  const { maps } = window.kakao;
  const map = new maps.Map(document.getElementById('re-map'), {
    center: new maps.LatLng(city.lat, city.lng),
    level: city.level,
  });
  map.addControl(new maps.ZoomControl(), maps.ControlPosition.RIGHT);

  const markers = new Map();
  for (const region of city.regions) {
    const node = el('button', { type: 'button', className: 're-marker' }, [
      el('strong', { textContent: region.name }),
      el('span', { textContent: won(region.sale) }),
    ]);
    node.addEventListener('click', () => onPick(region));
    const overlay = new maps.CustomOverlay({
      map, position: new maps.LatLng(region.lat, region.lng), content: node, yAnchor: 1.1, clickable: true, zIndex: 1,
    });
    // 도심 쪽은 마커가 겹치므로 마우스를 올린 마커를 위로 올린다.
    node.addEventListener('mouseenter', () => overlay.setZIndex(3));
    node.addEventListener('mouseleave', () => overlay.setZIndex(node.classList.contains('selected') ? 2 : 1));
    markers.set(region.id, { node, overlay });
  }

  // 처음에는 모든 지역이 보이도록 범위를 맞춘다. 이후 선택은 확대 수준을 유지한 채 이동만 한다.
  const bounds = new maps.LatLngBounds();
  city.regions.forEach((r) => bounds.extend(new maps.LatLng(r.lat, r.lng)));
  map.setBounds(bounds);
  let first = true;

  return {
    select(region) {
      markers.forEach(({ node, overlay }, id) => {
        const selected = id === region.id;
        node.classList.toggle('selected', selected);
        overlay.setZIndex(selected ? 2 : 1); // 선택한 마커는 겹쳐도 위에 보이게 한다
      });
      if (first) { first = false; return; } // 첫 표시는 전체 범위를 유지한다
      map.panTo(new maps.LatLng(region.lat, region.lng));
    },
  };
}
